"""Durable execution state, fencing epochs, and Pause/Resume/Stop for AI Scientist runs.

Replaces the object-store JSON checkpoint (AS-0 section 4 crash/concurrency contracts):

- The authoritative state is the ``ai_runs`` row: ``status``, ``fencing_epoch``, ``state_version``
  and ``budget_json``. There is no second copy that can disagree or silently reset.
- Every transition is a single compare-and-set ``UPDATE ... WHERE status IN (...) [AND
  fencing_epoch = :epoch]`` whose row count decides the outcome. A stale worker, a late callback or
  a racing control request therefore cannot overwrite Stop/Pause, and cannot revive a stopped run.
- Pause, Resume and Stop bump ``fencing_epoch`` in the same statement that changes the status. A
  worker holds the epoch it was started with and must present it for every state write and for the
  final commit of any domain effect (see ``action_receipts.complete_action``).
- Budget counters are updated by optimistic compare-and-set on ``state_version`` so reservations
  and settlements cannot be lost or double counted, and they survive restarts and Resume.
- Nothing here swallows an error: a failed write fails the caller.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..actions import authorize_project_access
from ..ai_models import AIActionReceiptRecord, AIApprovalRecord, AIRunRecord
from ..context import Identity
from ..errors import ApplicationError, ProjectAccessDenied, ScientificReferenceNotFound
from ..models import utc_now
from ..project_access import ProjectCapability, can
from .budgets import AIBudgetExceededError, AIRunBudget
from .events import AIRunEventManager
from .token_policy import InputReservationBound

ACTIVE_STATES: tuple[str, ...] = ("PLANNING", "EXECUTING")
STOPPABLE_STATES: tuple[str, ...] = (
    "CREATED",
    "PLANNING",
    "EXECUTING",
    "PAUSED",
    "WAITING_FOR_APPROVAL",
    "WAITING_FOR_CALCULATION",
)
TERMINAL_STATES: tuple[str, ...] = ("SUCCEEDED", "FAILED", "CANCELED")
_CAS_RETRIES = 8


class StaleWorkerFencedError(ApplicationError):
    def __init__(self, run_id: str, expected_epoch: int, actual_epoch: int | None):
        self.code = "STALE_WORKER_FENCED"
        self.status_code = 409
        current = "unavailable" if actual_epoch is None else str(actual_epoch)
        super().__init__(f"Worker epoch {expected_epoch} is stale; current run epoch is {current}.")


class RunControlInvalidStateError(ApplicationError):
    def __init__(self, action: str, current_status: str):
        self.code = "INVALID_RUN_STATE"
        self.status_code = 409
        super().__init__(f"Cannot {action} run in status '{current_status}'.")


@dataclass(frozen=True, slots=True)
class RunFence:
    status: str
    epoch: int
    state_version: int


class AIRunExecutionManager:
    def __init__(self, session: Session, event_manager: AIRunEventManager):
        self._session = session
        self._events = event_manager

    # ------------------------------------------------------------------ reads
    def read_fence(self, project_id: str, run_id: str) -> RunFence:
        """Fresh column read; never served from the ORM identity map."""
        row = self._session.execute(
            select(AIRunRecord.status, AIRunRecord.fencing_epoch, AIRunRecord.state_version).where(
                AIRunRecord.id == run_id, AIRunRecord.project_id == project_id
            )
        ).one_or_none()
        if row is None:
            raise ScientificReferenceNotFound("Run does not exist.")
        return RunFence(status=row[0], epoch=int(row[1]), state_version=int(row[2]))

    def verify_worker_epoch(self, project_id: str, run_id: str, worker_epoch: int) -> None:
        fence = self.read_fence(project_id, run_id)
        if fence.epoch != worker_epoch or fence.status not in ACTIVE_STATES:
            raise StaleWorkerFencedError(run_id, worker_epoch, fence.epoch)

    def _own_run(
        self,
        identity: Identity,
        project_id: str,
        run_id: str,
        *,
        capability: ProjectCapability = ProjectCapability.READ,
    ) -> AIRunRecord:
        _project, member = authorize_project_access(self._session, identity, project_id)
        if not can(member, capability):
            raise ProjectAccessDenied()
        run = self._session.scalar(
            select(AIRunRecord).where(
                AIRunRecord.id == run_id,
                AIRunRecord.project_id == project_id,
                AIRunRecord.actor_id == identity.user_id,
            )
        )
        if run is None:
            raise ScientificReferenceNotFound("Run does not exist.")
        return run

    # ------------------------------------------------------------ worker start
    def claim_execution(self, project_id: str, run_id: str) -> tuple[int, AIRunBudget]:
        """Bind a worker to the current epoch and recover any unreconciled model reservation."""
        fence = self.read_fence(project_id, run_id)
        if fence.status not in ACTIVE_STATES:
            raise StaleWorkerFencedError(run_id, fence.epoch, fence.epoch)

        def recover(budget: AIRunBudget) -> bool:
            return budget.settle_uncertain()

        budget = self._update_budget(project_id, run_id, recover, epoch=fence.epoch)
        return fence.epoch, budget

    # ---------------------------------------------------------------- budgets
    def _update_budget(
        self,
        project_id: str,
        run_id: str,
        mutate: Callable[[AIRunBudget], bool],
        *,
        epoch: int | None,
        commit: bool = True,
    ) -> AIRunBudget:
        """Optimistic read-modify-write of the persisted budget.

        ``mutate`` returns True when the budget changed. With ``epoch`` set the write is fenced;
        without it (usage settlement) the write is accounting only and never an effect.
        """
        for _ in range(_CAS_RETRIES):
            row = self._session.execute(
                select(
                    AIRunRecord.budget_json,
                    AIRunRecord.state_version,
                    AIRunRecord.fencing_epoch,
                    AIRunRecord.status,
                ).where(AIRunRecord.id == run_id, AIRunRecord.project_id == project_id)
            ).one_or_none()
            if row is None:
                raise ScientificReferenceNotFound("Run does not exist.")
            stored, version, current_epoch, status = row
            if epoch is not None and (current_epoch != epoch or status not in ACTIVE_STATES):
                raise StaleWorkerFencedError(run_id, epoch, current_epoch)
            budget = AIRunBudget.from_dict(stored)
            if not mutate(budget):
                return budget
            conditions = [
                AIRunRecord.id == run_id,
                AIRunRecord.project_id == project_id,
                AIRunRecord.state_version == version,
            ]
            if epoch is not None:
                conditions += [
                    AIRunRecord.fencing_epoch == epoch,
                    AIRunRecord.status.in_(ACTIVE_STATES),
                ]
            result = self._session.execute(
                update(AIRunRecord)
                .where(*conditions)
                .values(budget_json=budget.to_dict(), state_version=AIRunRecord.state_version + 1)
                .execution_options(synchronize_session=False)
            )
            if result.rowcount == 1:
                if commit:
                    self._session.commit()
                return budget
            if not commit:
                raise ApplicationError("Budget changed inside the accounting transaction.")
            self._session.commit()  # release the read snapshot, then re-read
        raise ApplicationError("AI run state is too contended to update; retry.")

    def reserve_model_call(
        self, project_id: str, run_id: str, epoch: int, input_tokens: int, output_tokens: int
    ) -> AIRunBudget:
        def reserve(budget: AIRunBudget) -> bool:
            budget.reserve_model_call(input_tokens, output_tokens)
            return True

        return self._update_budget(project_id, run_id, reserve, epoch=epoch)

    def reserve_model_request(
        self,
        project_id: str,
        run_id: str,
        epoch: int | None,
        *,
        request_bytes: int,
        message_count: int,
        tool_count: int,
        configured_bytes_per_token_floor: float,
        output_tokens: int,
        dynamic_bytes: int = 0,
    ) -> tuple[AIRunBudget, InputReservationBound]:
        """Atomically reserve input derived from the exact request plus bounded output."""
        chosen: list[InputReservationBound] = []

        def reserve(budget: AIRunBudget) -> bool:
            chosen[:] = [
                budget.reserve_request(
                    request_bytes,
                    message_count,
                    tool_count,
                    configured_bytes_per_token_floor,
                    output_tokens,
                    dynamic_bytes,
                )
            ]
            return True

        return self._update_budget(project_id, run_id, reserve, epoch=epoch), chosen[0]

    def settle_model_usage(
        self,
        project_id: str,
        run_id: str,
        input_tokens: int,
        output_tokens: int,
        *,
        reservation_id: str | None = None,
        commit: bool = True,
    ) -> AIBudgetExceededError | None:
        """Record actual usage even if the worker was fenced meanwhile (the spend happened).

        Returns the budget error, if the settlement pushed the run over a limit.
        """
        failure: list[AIBudgetExceededError] = []

        def settle(budget: AIRunBudget) -> bool:
            if not budget.model_call_in_flight:
                return False  # recovery already settled this reservation conservatively
            if reservation_id is not None and budget.reservation_id != reservation_id:
                return False
            try:
                budget.reconcile_model_usage(input_tokens, output_tokens)
            except AIBudgetExceededError as error:
                failure.append(error)
            return True

        self._update_budget(project_id, run_id, settle, epoch=None, commit=commit)
        return failure[0] if failure else None

    def settle_uncertain_usage(
        self,
        project_id: str,
        run_id: str,
        *,
        reservation_id: str | None = None,
        commit: bool = True,
    ) -> AIBudgetExceededError | None:
        """Count an in-flight call as fully spent when provider usage is unknown.

        Used when a model call completed but the provider did not report usage
        (or the response was truncated). The reservation is recorded as spent
        rather than treated as zero.
        """
        failure: list[AIBudgetExceededError] = []

        def settle(budget: AIRunBudget) -> bool:
            if not budget.model_call_in_flight:
                return False
            if reservation_id is not None and budget.reservation_id != reservation_id:
                return False
            try:
                budget.settle_uncertain()
            except AIBudgetExceededError as error:
                failure.append(error)
            return True

        self._update_budget(project_id, run_id, settle, epoch=None, commit=commit)
        return failure[0] if failure else None

    def release_unsent_reservation(
        self,
        project_id: str,
        run_id: str,
        *,
        reservation_id: str | None,
        commit: bool = True,
    ) -> bool:
        """Release the reservation of a request that never left the process.

        Idempotent and reservation-scoped: a recovered, replaced or already-settled reservation
        is left untouched, so a late release can never free a successor's in-flight slot.
        """
        if reservation_id is None:
            return False
        released: list[bool] = []

        def release(budget: AIRunBudget) -> bool:
            if not budget.model_call_in_flight or budget.reservation_id != reservation_id:
                return False
            released.append(budget.release_unsent_reservation())
            return True

        self._update_budget(project_id, run_id, release, epoch=None, commit=commit)
        return bool(released)

    def record_tool_call(self, project_id: str, run_id: str, epoch: int) -> AIRunBudget:
        def count(budget: AIRunBudget) -> bool:
            budget.record_tool_call()
            return True

        return self._update_budget(project_id, run_id, count, epoch=epoch)

    # ------------------------------------------------------------ transitions
    def transition(
        self,
        project_id: str,
        run_id: str,
        epoch: int,
        to_status: str,
        *,
        from_states: Iterable[str] = ACTIVE_STATES,
        error_code: str | None = None,
        error_detail: str | None = None,
        waiting_calculation_id: str | None = None,
        commit: bool = True,
        event: tuple[str, str, dict[str, Any]] | None = None,
    ) -> None:
        """Worker-side status change, fenced by epoch. Commits the caller's pending rows with it.

        If the epoch or state no longer matches, everything pending in the session (for example a
        final assistant message) is rolled back and ``StaleWorkerFencedError`` is raised.
        """
        values: dict[str, Any] = {
            "status": to_status,
            "state_version": AIRunRecord.state_version + 1,
            "updated_at": utc_now(),
        }
        if waiting_calculation_id is not None:
            values["waiting_calculation_id"] = waiting_calculation_id
        if error_code is not None:
            values["error_code"] = error_code
            values["error_detail"] = error_detail
        result = self._session.execute(
            update(AIRunRecord)
            .where(
                AIRunRecord.id == run_id,
                AIRunRecord.project_id == project_id,
                AIRunRecord.fencing_epoch == epoch,
                AIRunRecord.status.in_(tuple(from_states)),
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            self._session.rollback()
            fence = self.read_fence(project_id, run_id)
            raise StaleWorkerFencedError(run_id, epoch, fence.epoch)
        if event is not None:
            event_type, summary, payload = event
            self._events.record_event(
                project_id, run_id, event_type, summary, payload, epoch=epoch
            )
        if commit:
            self._session.commit()

    # --------------------------------------------------------------- controls
    def _control(
        self,
        run: AIRunRecord,
        allowed_from: tuple[str, ...],
        to_status: str,
        action: str,
        summary: str,
        *,
        extra_effects: Callable[[], None] | None = None,
        epoch_effects: Callable[[int], None] | None = None,
    ) -> int:
        """Atomic status change + epoch bump + event. Returns the new epoch."""
        result = self._session.execute(
            update(AIRunRecord)
            .where(
                AIRunRecord.id == run.id,
                AIRunRecord.project_id == run.project_id,
                AIRunRecord.status.in_(allowed_from),
            )
            .values(
                status=to_status,
                fencing_epoch=AIRunRecord.fencing_epoch + 1,
                state_version=AIRunRecord.state_version + 1,
                updated_at=utc_now(),
            )
            .returning(AIRunRecord.fencing_epoch)
            .execution_options(synchronize_session=False)
        )
        new_epoch = result.scalar_one_or_none()
        if new_epoch is None:
            self._session.rollback()
            current = self.read_fence(run.project_id, run.id)
            raise RunControlInvalidStateError(action, current.status)
        if extra_effects is not None:
            extra_effects()
        if epoch_effects is not None:
            epoch_effects(int(new_epoch))
        self._events.record_event(
            run.project_id,
            run.id,
            "status.changed",
            summary,
            {"status": to_status, "epoch": int(new_epoch)},
            epoch=int(new_epoch),
        )
        self._session.commit()
        self._session.refresh(run)
        return int(new_epoch)

    def pause_run(
        self, session: Session, identity: Identity, project_id: str, run_id: str
    ) -> AIRunRecord:
        run = self._own_run(identity, project_id, run_id)
        self._control(run, ACTIVE_STATES, "PAUSED", "pause", "Execution paused by user.")
        return run

    def resume_run(
        self,
        session: Session,
        identity: Identity,
        project_id: str,
        run_id: str,
        *,
        epoch_effects: Callable[[int], None] | None = None,
    ) -> tuple[AIRunRecord, int]:
        # Resume re-enables autonomous execution that may create records: it needs a *current*
        # WRITE role (Pause and Stop only reduce activity and stay available with READ).
        run = self._own_run(identity, project_id, run_id, capability=ProjectCapability.WRITE)
        # ``epoch_effects`` run inside the same transaction as the PAUSED -> PLANNING compare-and-
        # set, so they happen only for the one caller that wins the transition (for example
        # clearing a researcher gate exactly once).
        epoch = self._control(
            run,
            ("PAUSED",),
            "PLANNING",
            "resume",
            "Execution resumed; counters preserved.",
            epoch_effects=epoch_effects,
        )
        return run, epoch

    def stop_run(
        self, session: Session, identity: Identity, project_id: str, run_id: str
    ) -> AIRunRecord:
        run = self._own_run(identity, project_id, run_id)
        if run.status == "CANCELED":
            return run  # idempotent
        if run.status in TERMINAL_STATES:
            raise RunControlInvalidStateError("stop", run.status)

        def revoke_unused() -> None:
            self._session.execute(
                update(AIApprovalRecord)
                .where(AIApprovalRecord.run_id == run.id, AIApprovalRecord.status == "PENDING")
                .values(status="REJECTED", decided_by=identity.user_id, decided_at=utc_now())
            )
            # An action intent that has not committed its effect can never complete after Stop.
            self._session.execute(
                update(AIActionReceiptRecord)
                .where(
                    AIActionReceiptRecord.run_id == run.id,
                    AIActionReceiptRecord.status.in_(("INTENT", "FAILED")),
                )
                .values(status="ABANDONED", completed_at=utc_now())
                .execution_options(synchronize_session=False)
            )

        try:
            self._control(
                run,
                STOPPABLE_STATES,
                "CANCELED",
                "stop",
                "Execution stopped.",
                extra_effects=revoke_unused,
            )
        except RunControlInvalidStateError:
            self._session.refresh(run)
            if run.status == "CANCELED":
                return run
            raise
        return run
