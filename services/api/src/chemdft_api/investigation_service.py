from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, timedelta
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .ai.budgets import AIBudgetExceededError, AIRunBudget
from .ai.gateway import (
    ModelGateway,
    ModelMessage,
    ModelRequest,
    ModelTier,
)
from .ai_models import AIApprovalRecord, AIConversationRecord, AIModelInvocationRecord, AIRunRecord
from .config import Settings
from .context import Identity
from .contracts.ai import AIApprovalView
from .contracts.investigations import (
    CreateAssessmentInput,
    CreateHypothesisInput,
    CreateInvestigationInput,
    CreateObservationInput,
    CreatePlanInput,
    InvestigationAssessmentView,
    InvestigationDecision,
    InvestigationHypothesisView,
    InvestigationListOutput,
    InvestigationObservationView,
    InvestigationPlanView,
    InvestigationPolicy,
    InvestigationStepView,
    InvestigationUserInput,
    InvestigationView,
)
from .errors import (
    ApplicationError,
    CrossProjectReference,
    InvalidLifecycleTransition,
    ProjectAccessDenied,
    ScientificReferenceNotFound,
    ScientificValidationFailed,
)
from .investigation_models import (
    InvestigationAssessmentRecord,
    InvestigationDecisionRecord,
    InvestigationHypothesisRecord,
    InvestigationObservationRecord,
    InvestigationPlanRecord,
    InvestigationRecord,
    InvestigationStepRecord,
)
from .models import new_id, utc_now
from .project_access import ProjectCapability, can
from .scientific_models import (
    CalculationRecord,
    CalculationResultRecord,
    ComputeExecutionRecord,
    EvidenceCandidateRecord,
    ExperimentalDatasetRecord,
)
from .storage import ObjectStore

_TERMINAL = {"COMPLETED", "FAILED", "CANCELED"}


class InvestigationService:
    def __init__(
        self,
        session: Session,
        identity: Identity,
        object_store: ObjectStore | None = None,
        settings: Settings | None = None,
        gateway: ModelGateway | None = None,
        heartbeat_callback: Callable[[], bool] | None = None,
    ) -> None:
        self._session = session
        self._identity = identity
        self._object_store = object_store
        self._settings = settings
        self._gateway = gateway
        self._decision_product = None
        self._decision_human = None
        self._heartbeat_callback = heartbeat_callback
        self._active_worker_id: str | None = None

    def _guard_worker(
        self, project_id: str, investigation_id: str, *, guard_api: bool = False
    ) -> None:
        if self._active_worker_id is None and not guard_api:
            return
        now = utc_now()
        lease_condition = (
            (InvestigationRecord.lease_owner == self._active_worker_id)
            & (InvestigationRecord.lease_expires_at > now)
            if self._active_worker_id is not None else
            InvestigationRecord.lease_owner.is_(None)
            | (InvestigationRecord.lease_expires_at <= now)
        )
        with self._session.no_autoflush:
            owned = self._session.execute(
                update(InvestigationRecord).where(
                InvestigationRecord.id == investigation_id,
                InvestigationRecord.project_id == project_id,
                lease_condition,
                InvestigationRecord.status.in_(("ACTIVE", "WAITING_FOR_RESULT")),
                ).values(state_version=InvestigationRecord.state_version)
                .execution_options(synchronize_session=False)
            )
        # The conditional UPDATE both fences the writer and holds the row lock
        # until its pending state changes commit, including on PostgreSQL.
        if owned.rowcount != 1:
            self._session.rollback()
            raise InvalidLifecycleTransition("Investigation worker lease is stale.")

    def _commit_worker(self, project_id: str, investigation_id: str) -> None:
        self._guard_worker(project_id, investigation_id, guard_api=True)
        self._session.commit()

    def _update_budget(self, project_id: str, investigation_id: str, mutate: Callable,
                       *, fenced: bool = True, commit: bool = True) -> dict:
        """Update the latest budget with a database CAS, never an ORM snapshot.

        The successful version update and pending step writes commit together.
        Workers must still own an unexpired lease; API resumes cannot race an
        active worker. Retry only before any external side effect is performed.
        """
        for _ in range(12):
            if fenced:
                self._guard_worker(project_id, investigation_id)
            stored, version = self._session.execute(
                select(InvestigationRecord.budget_json, InvestigationRecord.state_version)
                .where(InvestigationRecord.id == investigation_id,
                       InvestigationRecord.project_id == project_id)
            ).one()
            budget = dict(stored or {})
            mutate(budget)
            conditions = [
                InvestigationRecord.id == investigation_id,
                InvestigationRecord.project_id == project_id,
                InvestigationRecord.state_version == version,
            ]
            now = utc_now()
            if fenced and self._active_worker_id is not None:
                conditions.extend([
                    InvestigationRecord.lease_owner == self._active_worker_id,
                    InvestigationRecord.lease_expires_at > now,
                    InvestigationRecord.status.in_(("ACTIVE", "WAITING_FOR_RESULT")),
                ])
            elif fenced:
                conditions.append(
                    InvestigationRecord.lease_owner.is_(None)
                    | (InvestigationRecord.lease_expires_at <= now)
                )
            changed = self._session.execute(
                update(InvestigationRecord).where(*conditions)
                .values(budget_json=budget, state_version=version + 1)
                .execution_options(synchronize_session=False)
            )
            if changed.rowcount == 1:
                if commit:
                    self._session.commit()
                self._session.expire_all()
                return budget
            if not commit:
                raise InvalidLifecycleTransition(
                    "Budget changed inside the accounting transaction."
                )
            self._session.rollback()
        raise InvalidLifecycleTransition("Investigation is busy; retry after its worker finishes.")

    def _compute_cost_snapshot(self, project_id: str, investigation_id: str) -> dict:
        """Rebuild actual spend from every authoritative execution attempt.

        Execution IDs are counted once, including failures/cancellations. A
        fresh snapshot also picks up late and corrected metering after the
        investigation has completed, without making GET perform a mutation.
        """
        steps = self._session.scalars(
            select(InvestigationStepRecord)
            .join(InvestigationPlanRecord,
                  InvestigationPlanRecord.id == InvestigationStepRecord.plan_id)
            .where(InvestigationPlanRecord.investigation_id == investigation_id,
                   InvestigationStepRecord.project_id == project_id)
        ).all()
        calculation_ids = {
            str(step.result_ref_json["calculation_id"])
            for step in steps
            if (step.result_ref_json or {}).get("calculation_id")
        }
        executions = self._session.scalars(
            select(ComputeExecutionRecord).where(
                ComputeExecutionRecord.project_id == project_id,
                ComputeExecutionRecord.calculation_id.in_(calculation_ids),
            ).execution_options(populate_existing=True)
        ).all() if calculation_ids else []
        total = 0
        unknown = calculation_ids - {row.calculation_id for row in executions}
        costs = {}
        for row in executions:
            money = row.actual_cost_json
            if money is None:
                unknown.add(row.calculation_id)
                continue
            if (not isinstance(money, dict) or money.get("currency") != "USD"
                    or type(money.get("minor_units")) is not int
                    or money["minor_units"] < 0):
                raise ScientificValidationFailed(
                    "Invalid authoritative execution cost or currency."
                )
            costs[row.id] = money["minor_units"]
            total += money["minor_units"]
        return {
            "compute_actual_minor_units": None if unknown else total,
            "compute_known_actual_minor_units": total,
            "compute_actual_currency": "USD",
            "compute_usage_complete": not unknown,
            "unmetered_calculation_ids": sorted(unknown),
            "execution_costs_minor_units": costs,
        }

    def _reserve_compute(self, project_id: str, investigation: InvestigationRecord,
                         step: InvestigationStepRecord, estimate: int) -> None:
        def reserve(budget):
            reservations = dict(budget.get("compute_reservations", {}))
            if step.id in reservations:
                return
            used = int(budget.get("calculations_used", 0))
            if used >= int(investigation.policy_json.get("max_calculations", 3)):
                raise ScientificValidationFailed("Investigation calculation budget reached.")
            snapshot = self._compute_cost_snapshot(project_id, investigation.id)
            reserved = int(budget.get("compute_reserved_minor_units", 0))
            ceiling = int(investigation.policy_json.get("max_compute_minor_units", 0))
            projected = max(reserved, snapshot["compute_known_actual_minor_units"]) + estimate
            if ceiling > 0 and projected > ceiling:
                raise ScientificValidationFailed("Investigation compute budget reached.")
            reservations[step.id] = estimate
            budget.update(snapshot)
            budget.update(compute_reservations=reservations,
                          compute_reserved_minor_units=reserved + estimate,
                          calculations_used=used + 1,
                          steps_used=int(budget.get("steps_used", 0)) + 1)
        self._update_budget(project_id, investigation.id, reserve)

    def _project(self, project_id: str, *, edit: bool = False):
        project, member = authorize_project_access(self._session, self._identity, project_id)
        if edit and not can(member, ProjectCapability.WRITE):
            raise ProjectAccessDenied()
        return project

    def create(self, project_id: str, payload: CreateInvestigationInput) -> InvestigationView:
        project = self._project(project_id, edit=True)
        policy = payload.policy
        record = InvestigationRecord(
            id=new_id(),
            project_id=project.id,
            title=payload.title,
            objective=payload.objective,
            status="DRAFT",
            created_by=self._identity.user_id,
            policy_json=policy.model_dump(mode="json"),
            budget_json={"steps_used": 0, "calculations_used": 0, "ai_calls_used": 0},
            stop_conditions_json=[
                {"kind": "MAX_STEPS", "value": policy.max_steps},
                {"kind": "MAX_CALCULATIONS", "value": policy.max_calculations},
            ],
        )
        self._session.add(record)
        self._session.commit()
        return self.get(project_id, record.id)

    def list(self, project_id: str) -> InvestigationListOutput:
        project = self._project(project_id)
        rows = self._session.scalars(
            select(InvestigationRecord)
            .where(InvestigationRecord.project_id == project.id)
            .order_by(InvestigationRecord.created_at.desc())
        ).all()
        return InvestigationListOutput(
            investigations=tuple(self._view(project.id, row) for row in rows)
        )

    def get(self, project_id: str, investigation_id: str) -> InvestigationView:
        project = self._project(project_id)
        row = self._session.scalar(
            select(InvestigationRecord).where(
                InvestigationRecord.id == investigation_id,
                InvestigationRecord.project_id == project.id,
            )
        )
        if row is None:
            raise ScientificReferenceNotFound("Investigation does not exist.")
        return self._view(project.id, row)

    def add_hypothesis(
        self, project_id: str, investigation_id: str, payload: CreateHypothesisInput
    ) -> InvestigationView:
        project = self._project(project_id, edit=True)
        investigation = self._require(project.id, investigation_id)
        if investigation.status in _TERMINAL:
            raise InvalidLifecycleTransition("A terminal investigation cannot receive hypotheses.")
        self._session.add(
            InvestigationHypothesisRecord(
                id=new_id(),
                project_id=project.id,
                investigation_id=investigation.id,
                statement=payload.statement,
                source_class=payload.source_class,
                actor_id=self._identity.user_id if payload.source_class == "USER" else None,
                status="OPEN",
                support_refs_json=[],
                contradiction_refs_json=[],
            )
        )
        investigation.status = "PLANNED"
        self._session.commit()
        return self.get(project_id, investigation.id)

    def add_plan(
        self, project_id: str, investigation_id: str, payload: CreatePlanInput
    ) -> InvestigationView:
        project = self._project(project_id, edit=True)
        investigation = self._require(project.id, investigation_id)
        if investigation.status in _TERMINAL:
            raise InvalidLifecycleTransition("A terminal investigation cannot be revised.")
        previous = self._session.scalar(
            select(InvestigationPlanRecord)
            .where(InvestigationPlanRecord.investigation_id == investigation.id)
            .order_by(InvestigationPlanRecord.revision.desc())
        )
        plan = InvestigationPlanRecord(
            id=new_id(),
            project_id=project.id,
            investigation_id=investigation.id,
            revision=(previous.revision + 1 if previous else 1),
            status="DRAFT",
            created_by=self._identity.user_id,
        )
        self._session.add(plan)
        for number, step in enumerate(payload.steps, 1):
            if step.approval_class == "EXPENSIVE" and not investigation.policy_json.get(
                "approval_required_for_expensive", True
            ):
                raise ScientificValidationFailed(
                    "Expensive steps must remain approval-gated by server policy."
                )
            self._session.add(
                InvestigationStepRecord(
                    id=new_id(),
                    project_id=project.id,
                    plan_id=plan.id,
                    step_number=number,
                    action=step.action,
                    intent=step.intent,
                    dependencies_json=[str(value) for value in step.dependencies],
                    status="PLANNED",
                    approval_class=step.approval_class,
                    estimated_cost_json=step.estimated_cost,
                    result_ref_json={"tool_arguments": step.tool_arguments},
                )
            )
        investigation.status = "PLANNED"
        self._session.commit()
        return self.get(project_id, investigation.id)

    def add_observation(
        self, project_id: str, investigation_id: str, payload: CreateObservationInput
    ) -> InvestigationView:
        project = self._project(project_id, edit=True)
        investigation = self._require(project.id, investigation_id)
        source_id = str(payload.source_entity_id)
        source_class = self._validate_source(
            project.id, payload.source_entity_type, source_id, payload.source_class
        )
        if payload.step_id:
            step = self._session.scalar(
                select(InvestigationStepRecord)
                .join(
                    InvestigationPlanRecord,
                    InvestigationStepRecord.plan_id == InvestigationPlanRecord.id,
                )
                .where(
                    InvestigationStepRecord.id == str(payload.step_id),
                    InvestigationPlanRecord.investigation_id == investigation.id,
                    InvestigationStepRecord.project_id == project.id,
                )
            )
            if step is None:
                raise CrossProjectReference("Observation step is not part of this investigation.")
        self._session.add(
            InvestigationObservationRecord(
                id=new_id(),
                project_id=project.id,
                investigation_id=investigation.id,
                step_id=str(payload.step_id) if payload.step_id else None,
                source_entity_type=payload.source_entity_type,
                source_entity_id=source_id,
                source_class=source_class,
                summary=payload.summary,
                citations_json=list(payload.citations),
            )
        )
        self._session.commit()
        return self.get(project_id, investigation.id)

    def assess(
        self, project_id: str, investigation_id: str, payload: CreateAssessmentInput
    ) -> InvestigationView:
        project = self._project(project_id, edit=True)
        investigation = self._require(project.id, investigation_id)
        self._require_current_observations(project.id, investigation.id)
        hypothesis = self._session.scalar(
            select(InvestigationHypothesisRecord).where(
                InvestigationHypothesisRecord.id == str(payload.hypothesis_id),
                InvestigationHypothesisRecord.investigation_id == investigation.id,
                InvestigationHypothesisRecord.project_id == project.id,
            )
        )
        if hypothesis is None:
            raise ScientificReferenceNotFound("Hypothesis does not exist in this investigation.")
        observations = self._session.scalars(
            select(InvestigationObservationRecord).where(
                InvestigationObservationRecord.investigation_id == investigation.id,
                InvestigationObservationRecord.project_id == project.id,
                InvestigationObservationRecord.id.in_(
                    [str(value) for value in payload.observation_ids]
                ),
            )
        ).all()
        if len(observations) != len(payload.observation_ids):
            raise ScientificReferenceNotFound(
                "Assessment observations must be committed investigation observations."
            )
        hypothesis.status = payload.outcome
        self._session.add(
            InvestigationAssessmentRecord(
                id=new_id(),
                project_id=project.id,
                investigation_id=investigation.id,
                hypothesis_id=hypothesis.id,
                outcome=payload.outcome,
                rationale=payload.rationale,
                observation_ids_json=[str(value) for value in payload.observation_ids],
            )
        )
        if payload.outcome in {"SUPPORTED", "NOT_SUPPORTED"}:
            investigation.status = "COMPLETED"
        self._session.commit()
        return self.get(project_id, investigation.id)

    def transition(self, project_id: str, investigation_id: str, target: str) -> InvestigationView:
        project = self._project(project_id, edit=True)
        investigation = self._require(project.id, investigation_id)
        allowed = {"PAUSED", "ACTIVE", "CANCELED"}
        if target == "ACTIVE":
            self._require_current_observations(project.id, investigation.id)
        if target not in allowed or (investigation.status in _TERMINAL and target != "CANCELED"):
            raise InvalidLifecycleTransition("Investigation lifecycle transition is not permitted.")
        if target == "ACTIVE" and investigation.status not in {
            "DRAFT",
            "PLANNED",
            "PAUSED",
            "WAITING_FOR_APPROVAL",
            "WAITING_FOR_RESULT",
        }:
            raise InvalidLifecycleTransition(
                "Only planned or paused investigations can be activated."
            )
        investigation.status = target
        self._session.commit()
        return self.get(project_id, investigation.id)

    def start(self, project_id: str, investigation_id: str) -> InvestigationView:
        project = self._project(project_id, edit=True)
        investigation = self._require(project.id, investigation_id)
        self._require_current_observations(project.id, investigation.id)
        if investigation.status not in {"DRAFT", "PLANNED", "PAUSED"}:
            raise InvalidLifecycleTransition(
                "Only draft, planned, or paused investigations can start."
            )
        investigation.status = "ACTIVE"
        investigation.started_at = investigation.started_at or utc_now()
        investigation.state_version += 1
        self._session.commit()
        return self.resume(project_id, investigation_id)

    def claim_lease(self, project_id: str, investigation_id: str, worker_id: str) -> bool:
        """Claim one investigation with a database CAS; safe on SQLite and PostgreSQL."""
        project = self._project(project_id)
        investigation = self._require(project.id, investigation_id)
        now = utc_now()
        if investigation.status in {
            "PAUSED",
            "CANCELED",
            "COMPLETED",
            "FAILED",
            "WAITING_FOR_APPROVAL",
            "WAITING_FOR_USER",
        }:
            return False
        if investigation.lease_owner and investigation.lease_owner != worker_id:
            expires = investigation.lease_expires_at
            if expires is not None:
                if expires.tzinfo is None:
                    expires = expires.replace(tzinfo=UTC)
                if expires > now:
                    return False
        # A single UPDATE predicate is the concurrency boundary.  SQLite's write
        # serialization gives the same deterministic result as row locking.
        from sqlalchemy import update

        claimed = self._session.execute(
            update(InvestigationRecord)
            .where(
                InvestigationRecord.id == investigation.id,
                InvestigationRecord.project_id == project.id,
                InvestigationRecord.status.in_(("ACTIVE", "WAITING_FOR_RESULT")),
                (InvestigationRecord.lease_owner.is_(None))
                | (InvestigationRecord.lease_expires_at.is_(None))
                | (InvestigationRecord.lease_expires_at <= now)
                | (InvestigationRecord.lease_owner == worker_id),
            )
            .values(
                lease_owner=worker_id,
                lease_expires_at=now + timedelta(seconds=self._lease_seconds()),
            )
        )
        if claimed.rowcount != 1:
            self._session.rollback()
            return False
        self._session.commit()
        return True

    def heartbeat(self, project_id: str, investigation_id: str, worker_id: str) -> bool:
        from sqlalchemy import update

        now = utc_now()
        updated = self._session.execute(
            update(InvestigationRecord)
            .where(
                InvestigationRecord.id == investigation_id,
                InvestigationRecord.project_id == project_id,
                InvestigationRecord.lease_owner == worker_id,
                InvestigationRecord.lease_expires_at > now,
            )
            .values(lease_expires_at=now + timedelta(seconds=self._lease_seconds()))
        )
        self._session.commit()
        return updated.rowcount == 1

    def release_lease(self, project_id: str, investigation_id: str, worker_id: str) -> None:
        from sqlalchemy import update

        self._session.execute(
            update(InvestigationRecord)
            .where(
                InvestigationRecord.id == investigation_id,
                InvestigationRecord.project_id == project_id,
                InvestigationRecord.lease_owner == worker_id,
            )
            .values(lease_owner=None, lease_expires_at=None)
        )
        self._session.commit()

    def _lease_seconds(self) -> int:
        return int(getattr(self._settings, "investigation_lease_seconds", 300))

    def resume(
        self, project_id: str, investigation_id: str, *, worker_id: str | None = None
    ) -> InvestigationView:
        project = self._project(project_id, edit=True)
        investigation = self._require(project.id, investigation_id)
        self._active_worker_id = worker_id
        if worker_id is not None:
            self._guard_worker(project.id, investigation.id)
        elif investigation.lease_owner:
            expires = investigation.lease_expires_at
            if expires is None or (
                expires.replace(tzinfo=UTC) if expires.tzinfo is None else expires
            ) > utc_now():
                # A browser request may observe progress but cannot run a
                # second reasoning/dispatch cycle alongside the lease owner.
                return self.get(project_id, investigation_id)
        if not self._recover_ai_reservation(investigation):
            return self.get(project_id, investigation_id)
        self._require_current_observations(project.id, investigation.id)
        if investigation.status == "CANCELED":
            raise InvalidLifecycleTransition("Canceled investigations cannot resume.")
        if investigation.status == "COMPLETED":
            return self.get(project_id, investigation.id)
        if worker_id is not None and investigation.lease_owner != worker_id:
            return self.get(project_id, investigation.id)
        if investigation.status == "PAUSED":
            investigation.status = "ACTIVE"
        self._enforce_runtime_limits(investigation)
        if investigation.status in _TERMINAL or investigation.status == "PAUSED":
            self._session.commit()
            return self.get(project_id, investigation.id)
        plan = self._session.scalar(
            select(InvestigationPlanRecord)
            .where(InvestigationPlanRecord.investigation_id == investigation.id)
            .order_by(InvestigationPlanRecord.revision.desc())
        )
        if plan is None:
            investigation.status = "ACTIVE"
            self._session.commit()
            if worker_id is None:
                return self.get(project_id, investigation.id)
            return self._evaluate_decision(project.id, investigation, worker_id=worker_id)
        waiting = self._session.scalar(
            select(InvestigationStepRecord).where(
                InvestigationStepRecord.plan_id == plan.id,
                InvestigationStepRecord.status == "WAITING_FOR_RESULT",
            )
        )
        if waiting is not None:
            return self._resume_waiting(project.id, investigation, waiting)
        step = self._session.scalar(
            select(InvestigationStepRecord)
            .where(
                InvestigationStepRecord.plan_id == plan.id,
                InvestigationStepRecord.status.in_(("PLANNED", "READY", "WAITING_FOR_APPROVAL")),
            )
            .order_by(InvestigationStepRecord.step_number)
        )
        if step is None:
            return self._evaluate_decision(project.id, investigation, worker_id=worker_id)
        return self._dispatch_step(project.id, investigation, plan, step)

    def decide_approval(
        self, project_id: str, investigation_id: str, approval_id: str, decision: str
    ) -> InvestigationView:
        project = self._project(project_id, edit=True)
        investigation = self._require(project.id, investigation_id)
        self._require_current_observations(project.id, investigation.id)

        if investigation.status in _TERMINAL:
            raise InvalidLifecycleTransition(
                "Cannot decide approval for investigation in terminal state "
                f"'{investigation.status}'."
            )
        if investigation.status != "WAITING_FOR_APPROVAL":
            raise InvalidLifecycleTransition(
                f"Investigation is not awaiting approval (status '{investigation.status}')."
            )

        approval_record = self._session.get(AIApprovalRecord, approval_id)
        if approval_record is None:
            raise ScientificReferenceNotFound("Investigation approval does not exist.")
        if (
            approval_record.project_id != project.id
            or approval_record.investigation_id != investigation.id
        ):
            raise CrossProjectReference("Approval belongs to another project or investigation.")
        if approval_record.status != "PENDING":
            raise InvalidLifecycleTransition("Investigation approval is no longer pending.")
        approval = approval_record

        run = self._session.get(AIRunRecord, approval.run_id)
        from .ai.service import _is_expired

        if (
            run is None
            or run.actor_id != self._identity.user_id
            or approval.actor_id not in (None, self._identity.user_id)
            or approval.organization_id not in (None, self._identity.organization_id)
        ):
            raise ProjectAccessDenied("Approval belongs to another human.")

        if run.project_id != project.id or (
            run.investigation_id and run.investigation_id != investigation.id
        ):
            raise CrossProjectReference("Run belongs to another project or investigation.")
        if run.status in _TERMINAL:
            raise InvalidLifecycleTransition(
                f"This run reached terminal state '{run.status}'; no action may execute."
            )
        if run.status != "WAITING_FOR_APPROVAL":
            raise InvalidLifecycleTransition(
                f"Run is not awaiting approval (status '{run.status}')."
            )

        if _is_expired(approval.expires_at):
            raise ScientificValidationFailed("Approval request has expired.")
        if self._fingerprint(approval.normalized_arguments_json) != approval.action_fingerprint:
            raise ScientificValidationFailed("Approval parameters no longer match.")

        step = self._session.scalar(
            select(InvestigationStepRecord)
            .join(
                InvestigationPlanRecord,
                InvestigationStepRecord.plan_id == InvestigationPlanRecord.id,
            )
            .where(
                InvestigationStepRecord.id == approval.step_id,
                InvestigationPlanRecord.investigation_id == investigation.id,
                InvestigationStepRecord.project_id == project.id,
            )
        )
        if step is None:
            step_any = self._session.get(InvestigationStepRecord, approval.step_id)
            if step_any is not None:
                raise CrossProjectReference(
                    "Investigation step belongs to another project or investigation."
                )
            raise ScientificReferenceNotFound("Approved investigation step does not exist.")
        if step.status != "WAITING_FOR_APPROVAL":
            raise InvalidLifecycleTransition(
                f"Investigation step is no longer awaiting approval (status '{step.status}')."
            )
        if step.action != approval.tool_name:
            raise ScientificValidationFailed(
                "Approved investigation step action does not match approval tool."
            )
        step_args = (step.result_ref_json or {}).get("tool_arguments")
        if step_args is not None and self._fingerprint(step_args) != approval.action_fingerprint:
            raise ScientificValidationFailed(
                "Approved investigation step arguments do not match approval."
            )
        if decision == "REJECT":
            approval.status = "REJECTED"
            step.status = "SKIPPED"
            investigation.status = "PAUSED"
            investigation.limit_reason = "APPROVAL_REJECTED"
        elif decision == "APPROVE":
            approval.status = "APPROVED"
            step.status = "READY"
            investigation.status = "ACTIVE"
        else:
            raise ScientificValidationFailed("Unknown investigation approval decision.")
        approval.decided_by = self._identity.user_id
        approval.decided_at = utc_now()
        self._session.commit()
        return (
            self.resume(project_id, investigation.id)
            if decision == "APPROVE"
            else self.get(project_id, investigation.id)
        )

    def answer_user(
        self, project_id: str, investigation_id: str, payload: InvestigationUserInput
    ) -> InvestigationView:
        project = self._project(project_id, edit=True)
        investigation = self._require(project.id, investigation_id)
        self._require_current_observations(project.id, investigation.id)
        if investigation.status != "WAITING_FOR_USER":
            raise InvalidLifecycleTransition("This investigation is not waiting for user input.")
        investigation.user_input_json = {
            "question": None,
            "answer": payload.answer,
        }
        investigation.status = "ACTIVE"
        investigation.state_version += 1
        self._session.commit()
        return self.resume(project_id, investigation_id)

    def _enforce_runtime_limits(self, investigation: InvestigationRecord) -> None:
        policy = investigation.policy_json
        started_at = investigation.started_at or investigation.created_at
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=UTC)
        elapsed = (utc_now() - started_at).total_seconds()
        if elapsed > int(policy.get("max_elapsed_seconds", 3600)):
            investigation.status = "PAUSED"
            investigation.limit_reason = "TIME_LIMIT_REACHED"
            return
        plan = self._session.scalar(
            select(InvestigationPlanRecord)
            .where(InvestigationPlanRecord.investigation_id == investigation.id)
            .order_by(InvestigationPlanRecord.revision.desc())
        )
        if plan is None:
            return
        executed = (
            self._session.query(InvestigationStepRecord)
            .join(
                InvestigationPlanRecord,
                InvestigationStepRecord.plan_id == InvestigationPlanRecord.id,
            )
            .filter(
                InvestigationPlanRecord.investigation_id == investigation.id,
                InvestigationStepRecord.status.in_(("EXECUTING", "SUCCEEDED", "FAILED", "SKIPPED")),
            )
            .count()
        )
        if executed >= int(policy.get("max_steps", 10)) and investigation.status == "ACTIVE":
            investigation.status = "PAUSED"
            investigation.limit_reason = "STEP_LIMIT_REACHED"
        budget = investigation.budget_json or {}
        if (
            int(budget.get("calculations_used", 0)) >= int(policy.get("max_calculations", 3))
            and investigation.status == "ACTIVE"
        ):
            investigation.status = "PAUSED"
            investigation.limit_reason = "CALCULATION_LIMIT_REACHED"

    def _dispatch_step(
        self,
        project_id: str,
        investigation: InvestigationRecord,
        plan: InvestigationPlanRecord,
        step: InvestigationStepRecord,
    ) -> InvestigationView:
        self._require_current_observations(project_id, investigation.id)
        if investigation.status != "ACTIVE":
            return self.get(project_id, investigation.id)
        if step.status == "WAITING_FOR_APPROVAL":
            return self.get(project_id, investigation.id)
        args = dict((step.result_ref_json or {}).get("tool_arguments", {}))
        if step.action != "calculation.submit":
            step.status = "FAILED"
            step.failure_json = {
                "code": "UNSUPPORTED_CAPABILITY",
                "detail": f"Unsupported investigation action: {step.action}",
            }
            investigation.status = "FAILED"
            self._commit_worker(project_id, investigation.id)
            return self.get(project_id, investigation.id)
        if not args:
            step.status = "FAILED"
            step.failure_json = {
                "code": "MISSING_TOOL_ARGUMENTS",
                "detail": "Calculation step requires typed tool arguments.",
            }
            investigation.status = "FAILED"
            self._commit_worker(project_id, investigation.id)
            return self.get(project_id, investigation.id)
        from .contracts.catalog import CalculationSubmitInput
        args.setdefault("idempotency_key", f"scientific:{self._fingerprint(args)}")
        args = CalculationSubmitInput.model_validate(args).model_dump(mode="json")
        step.result_ref_json = {
            **(step.result_ref_json or {}),
            "tool_arguments": args,
            "action_fingerprint": self._fingerprint(args),
        }
        # Canonical scientific request identity: the hash of everything except
        # the idempotency key. Two requests with the same idempotency key but
        # different scientific inputs are a conflict, never a silent reuse.
        request_hash = self._request_hash(args)
        # Authoritative server-side compute estimate. The caller/model-provided
        # ``estimated_cost_json`` is never trusted for enforceable limits: a
        # model-supplied zero must not bypass the investigation compute ceiling.
        try:
            estimated_minor_units = self._authoritative_compute_cost_minor_units(
                project_id, args
            )
        except ScientificValidationFailed as error:
            step.status = "FAILED"
            step.failure_json = {
                "code": "COMPUTE_ESTIMATE_UNAVAILABLE",
                "detail": error.detail,
            }
            investigation.status = "PAUSED"
            investigation.limit_reason = "COMPUTE_ESTIMATE_UNAVAILABLE"
            self._commit_worker(project_id, investigation.id)
            return self.get(project_id, investigation.id)
        budget = investigation.budget_json or {}
        ceiling = int(investigation.policy_json.get("max_compute_minor_units", 0))
        if (
            ceiling
            and int(budget.get("compute_reserved_minor_units", 0)) + estimated_minor_units > ceiling
        ):
            investigation.status = "PAUSED"
            investigation.limit_reason = "COMPUTE_BUDGET_REACHED"
            self._commit_worker(project_id, investigation.id)
            return self.get(project_id, investigation.id)
        # Conflict detection: an idempotency key already bound to a different
        # scientific request must never silently resolve to that calculation.
        existing_by_key = self._session.scalar(
            select(CalculationRecord).where(
                CalculationRecord.project_id == project_id,
                CalculationRecord.idempotency_key == str(args["idempotency_key"]),
            )
        )
        if existing_by_key is not None and existing_by_key.request_hash != request_hash:
            step.status = "FAILED"
            step.failure_json = {
                "code": "IDEMPOTENCY_CONFLICT",
                "detail": "A different calculation already uses this idempotency key.",
            }
            investigation.status = "FAILED"
            self._commit_worker(project_id, investigation.id)
            return self.get(project_id, investigation.id)
        # Look for an equivalent immutable calculation by canonical request hash.
        # If one exists, this is a reuse candidate and the Navigator's
        # "already in progress / completed" guard does not apply.
        existing_by_hash = self._session.scalar(
            select(CalculationRecord).where(
                CalculationRecord.project_id == project_id,
                CalculationRecord.request_hash == request_hash,
            )
            .order_by(CalculationRecord.created_at.asc())
        )
        has_reusable = existing_by_key is not None or existing_by_hash is not None
        if not has_reusable:
            from .ai.tool_policy import validate_compute_guidance
            from .context import Identity
            from .tool_registry.registry import ToolInvocationError

            human = Identity(investigation.created_by, self._identity.organization_id)
            try:
                validate_compute_guidance(
                    self._session,
                    self._settings,
                    human,
                    project_id,
                    args,
                    object_store=self._object_store,
                )
            except (ToolInvocationError, ScientificValidationFailed) as error:
                step.status = "FAILED"
                step.failure_json = {"code": "NAVIGATOR_BLOCKED", "detail": error.detail}
                investigation.status = "PAUSED"
                investigation.limit_reason = "NAVIGATOR_BLOCKED"
                self._commit_worker(project_id, investigation.id)
                return self.get(project_id, investigation.id)
        # calculation.submit is always an expensive side effect in the registry;
        # never allow a plan-local NONE class to bypass its approval verifier.
        approved = self._session.scalar(
            select(AIApprovalRecord).where(
                AIApprovalRecord.investigation_id == investigation.id,
                AIApprovalRecord.step_id == step.id,
                AIApprovalRecord.status == "APPROVED",
                AIApprovalRecord.action_fingerprint == self._fingerprint(args),
            )
        )
        if approved is None:
            return self._request_approval(project_id, investigation, plan, step, args)
        # Approval has been granted. Reuse the equivalent calculation or submit
        # a new one. Never bypass approval.
        existing = existing_by_key or existing_by_hash
        if existing is not None:
            step.result_ref_json = {
                **step.result_ref_json,
                "calculation_id": existing.id,
                "dispatch": "REUSED_EXISTING_RESULT",
            }
            step.status = "WAITING_FOR_RESULT"
            investigation.status = "WAITING_FOR_RESULT"
            self._commit_worker(project_id, investigation.id)
            return self.get(project_id, investigation.id)
        return self._invoke_calculation(project_id, investigation, plan, step, args, approved)

    def _request_approval(
        self,
        project_id: str,
        investigation: InvestigationRecord,
        plan: InvestigationPlanRecord,
        step: InvestigationStepRecord,
        args: dict[str, object],
    ) -> InvestigationView:
        existing = self._session.scalar(
            select(AIApprovalRecord).where(
                AIApprovalRecord.investigation_id == investigation.id,
                AIApprovalRecord.step_id == step.id,
                AIApprovalRecord.status == "PENDING",
                AIApprovalRecord.action_fingerprint == self._fingerprint(args),
            )
        )
        if existing is None:
            conversation = AIConversationRecord(
                id=new_id(),
                project_id=project_id,
                title=f"Investigation {investigation.title}",
                created_by=investigation.created_by,
            )
            run = AIRunRecord(
                id=new_id(),
                project_id=project_id,
                conversation_id=conversation.id,
                actor_id=investigation.created_by,
                status="WAITING_FOR_APPROVAL",
                current_step=step.step_number,
                max_steps=int(investigation.policy_json.get("max_steps", 10)),
                investigation_id=investigation.id,
            )
            self._session.add_all([conversation, run])
            self._session.flush()
            approval = AIApprovalRecord(
                id=new_id(),
                project_id=project_id,
                run_id=run.id,
                step_id=step.id,
                investigation_id=investigation.id,
                actor_id=investigation.created_by,
                organization_id=self._identity.organization_id,
                plan_revision=plan.revision,
                tool_name=step.action,
                tool_version="1.0.0",
                normalized_arguments_json=args,
                action_fingerprint=self._fingerprint(args),
                scientific_summary=step.intent,
                estimated_compute_json=step.estimated_cost_json,
                reason="Investigation step requires explicit approval.",
                status="PENDING",
                expires_at=utc_now() + timedelta(hours=1),
            )
            self._session.add(approval)
        step.status = "WAITING_FOR_APPROVAL"
        investigation.status = "WAITING_FOR_APPROVAL"
        self._commit_worker(project_id, investigation.id)
        return self.get(project_id, investigation.id)

    def _invoke_calculation(
        self,
        project_id: str,
        investigation: InvestigationRecord,
        plan: InvestigationPlanRecord,
        step: InvestigationStepRecord,
        args: dict[str, object],
        approval: AIApprovalRecord | None,
    ) -> InvestigationView:
        if self._object_store is None or self._settings is None:
            raise ScientificValidationFailed(
                "Investigation execution is not configured with the application providers."
            )
        # Persist the authoritative reservation before submission commits a
        # queue effect. A repeat of this exact step cannot reserve twice.
        authoritative_cost = self._authoritative_compute_cost_minor_units(project_id, args)
        self._reserve_compute(project_id, investigation, step, authoritative_cost)
        self._guard_worker(project_id, investigation.id, guard_api=True)
        # Worker orchestration retains its narrow work grant; actions recheck the requesting
        # human's current membership instead of granting a generic AI standing editor rights.
        from .context import Identity
        from .tool_registry.catalog import build_application_tool_registry
        from .tool_registry.registry import ToolInvocationContext

        human = Identity(
            user_id=investigation.created_by, organization_id=self._identity.organization_id
        )
        _project, member = authorize_project_access(self._session, human, project_id)
        if not can(member, ProjectCapability.WRITE):
            raise ProjectAccessDenied()
        invocation = self._session.scalar(
            select(AIModelInvocationRecord)
            .join(AIRunRecord, AIModelInvocationRecord.run_id == AIRunRecord.id)
            .where(
                AIRunRecord.investigation_id == investigation.id,
                AIRunRecord.actor_id == human.user_id,
            )
            .order_by(AIModelInvocationRecord.created_at.desc())
        )
        context = ToolInvocationContext(
            request_id=UUID(new_id()),
            identity=human,
            project_id=UUID(project_id),
            capabilities=frozenset({"calculation.submit"}),
            approval_references=frozenset({UUID(approval.id)}) if approval else frozenset(),
            transport="investigation",
            provider=invocation.provider if invocation else None,
            model=invocation.model if invocation else None,
        )
        registry = build_application_tool_registry(
            self._session, self._object_store, self._settings
        )
        from .ai.service import _make_approval_verifier

        registry._approval_verifier = _make_approval_verifier(self._session)
        # Transition the investigation's AIRunRecord to the EXECUTING dispatch state before
        # invoking the tool. The approval verifier requires run.status == "EXECUTING" for
        # both investigation and non-investigation runs, preventing stale or terminal runs
        # from re-consuming an approval.
        if approval is not None:
            inv_run = self._session.get(AIRunRecord, approval.run_id)
            if inv_run is not None and inv_run.status not in ("SUCCEEDED", "FAILED", "CANCELED"):
                inv_run.status = "EXECUTING"
                self._session.flush()
        try:
            output = registry.invoke("calculation.submit", args, context)
        except Exception as error:
            step.status = "FAILED"
            # Persist only the safe, user-facing detail from ApplicationError
            # subclasses. Unexpected exceptions may carry internal paths,
            # connection strings, or worker stderr; never write those into a
            # persisted step record.
            safe_detail = (
                error.detail
                if isinstance(error, ApplicationError)
                else "Calculation dispatch failed; see server logs for details."
            )
            step.failure_json = {"code": "DISPATCH_FAILED", "detail": safe_detail}
            investigation.status = "FAILED"
            self._commit_worker(project_id, investigation.id)
            return self.get(project_id, investigation.id)
        detail = output.model_dump(mode="json")
        calculation_id = detail.get("calculation", {}).get("id")
        compute_job_id = (detail.get("compute_job") or {}).get("id")
        step.result_ref_json = {
            **(step.result_ref_json or {}),
            "calculation_id": calculation_id,
            "compute_job_id": compute_job_id,
            "dispatch": "SUBMITTED",
        }
        step.status = "WAITING_FOR_RESULT"
        investigation.status = "WAITING_FOR_RESULT"
        self._commit_worker(project_id, investigation.id)
        return self.get(project_id, investigation.id)

    def _resume_waiting(
        self, project_id: str, investigation: InvestigationRecord, step: InvestigationStepRecord
    ) -> InvestigationView:
        calculation_id = (step.result_ref_json or {}).get("calculation_id")
        if not calculation_id:
            raise ScientificValidationFailed(
                "Waiting investigation step has no expected calculation reference."
            )
        from .calculation_actions import get_calculation

        self._update_budget(
            project_id, investigation.id,
            lambda budget: budget.update(self._compute_cost_snapshot(project_id, investigation.id)),
        )
        detail = get_calculation(self._session, self._identity, project_id, str(calculation_id))
        if detail.result is not None:
            existing = self._session.scalar(
                select(InvestigationObservationRecord).where(
                    InvestigationObservationRecord.investigation_id == investigation.id,
                    InvestigationObservationRecord.step_id == step.id,
                )
            )
            if existing is None:
                self._session.add(
                    InvestigationObservationRecord(
                        id=new_id(),
                        project_id=project_id,
                        investigation_id=investigation.id,
                        step_id=step.id,
                        source_entity_type="CALCULATION_RESULT",
                        source_entity_id=str(detail.result.id),
                        source_class="CALCULATED",
                        summary="Firewall-published calculation result is available.",
                        citations_json=[
                            {
                                "entity_type": "CALCULATION_RESULT",
                                "entity_id": str(detail.result.id),
                            }
                        ],
                    )
                )
            step.status = "SUCCEEDED"
            step.result_ref_json = {
                **(step.result_ref_json or {}),
                "result_id": str(detail.result.id),
            }
            investigation.status = "ACTIVE"
            investigation.state_version += 1
            self._commit_worker(project_id, investigation.id)
            return self._evaluate_decision(project_id, investigation)
        if detail.compute_job and detail.compute_job.state in {"FAILED", "CANCELED"}:
            step.status = "FAILED"
            step.failure_json = {"code": f"CALCULATION_{detail.compute_job.state}"}
            investigation.status = "ACTIVE"
            investigation.state_version += 1
            self._commit_worker(project_id, investigation.id)
            return self._evaluate_decision(project_id, investigation)
        return self.get(project_id, investigation.id)

    def _evaluate_decision(
        self, project_id: str, investigation: InvestigationRecord, *, worker_id: str | None = None
    ) -> InvestigationView:
        """Run one persisted, schema-validated reasoning cycle.

        The gateway is advisory: only IDs already present in the database may be
        cited, and only the typed proposed action is ever persisted or executed.
        """
        self._require_current_observations(project_id, investigation.id)
        if investigation.status in {
            "PAUSED",
            "CANCELED",
            "COMPLETED",
            "FAILED",
            "WAITING_FOR_USER",
        }:
            return self.get(project_id, investigation.id)
        observations = self._session.scalars(
            select(InvestigationObservationRecord)
            .where(InvestigationObservationRecord.investigation_id == investigation.id)
            .order_by(InvestigationObservationRecord.created_at)
        ).all()
        hypotheses = self._session.scalars(
            select(InvestigationHypothesisRecord)
            .where(InvestigationHypothesisRecord.investigation_id == investigation.id)
            .order_by(InvestigationHypothesisRecord.created_at)
        ).all()
        if not hypotheses:
            hypothesis = InvestigationHypothesisRecord(
                id=new_id(),
                project_id=project_id,
                investigation_id=investigation.id,
                statement=investigation.objective,
                source_class="AI_HYPOTHESIS",
                actor_id=None,
                status="OPEN",
                support_refs_json=[],
                contradiction_refs_json=[],
            )
            self._session.add(hypothesis)
            self._session.flush()
            hypotheses = [hypothesis]
        cycle = self._fingerprint(
            {
                "investigation": investigation.id,
                "version": investigation.state_version,
                "observations": [item.id for item in observations],
            }
        )
        cached = self._session.scalar(
            select(InvestigationDecisionRecord).where(
                InvestigationDecisionRecord.investigation_id == investigation.id,
                InvestigationDecisionRecord.cycle_fingerprint == cycle,
            )
        )
        if cached is not None:
            decision = InvestigationDecision.model_validate(cached.decision_json)
            return self._apply_decision(
                project_id, investigation, hypotheses[0], observations, decision, worker_id
            )
        budget = dict(investigation.budget_json or {})
        policy = investigation.policy_json or {}
        if int(budget.get("ai_calls_used", 0)) >= int(policy.get("max_ai_calls", 10)):
            investigation.status = "PAUSED"
            investigation.limit_reason = "AI_CALL_LIMIT_REACHED"
            self._commit_worker(project_id, investigation.id)
            return self.get(project_id, investigation.id)
        if self._settings is None or self._object_store is None:
            investigation.status = "PAUSED"
            investigation.limit_reason = "AI_UNAVAILABLE"
            self._commit_worker(project_id, investigation.id)
            return self.get(project_id, investigation.id)
        self._decision_investigation = investigation
        from .ai.context_tools import add_context_tools
        from .ai.product_context import ProductContextBuilder
        from .tool_registry.catalog import build_application_tool_registry

        human = Identity(investigation.created_by, self._identity.organization_id)
        registry = build_application_tool_registry(
            self._session, self._object_store, self._settings
        )
        add_context_tools(registry, self._session, self._settings)
        self._decision_product = ProductContextBuilder(
            self._session, human, self._settings, registry
        ).build(project_id)
        self._decision_human = human
        context = {
            "ProductContext": self._decision_product.model_dump(mode="json"),
            "objective": investigation.objective[:2000],
            "hypothesis": hypotheses[0].statement,
            "observations": [
                {"id": item.id, "source_class": item.source_class, "summary": item.summary[:1000]}
                for item in observations[-12:]
            ],
            "candidate_next_action": self._candidate_action(
                project_id, investigation, observations
            ),
            "allowed_decisions": [
                "COMPLETE",
                "PROPOSE_STEP",
                "ASSESS_AND_COMPLETE",
                "ASSESS_AND_CONTINUE",
                "REQUEST_USER_INPUT",
                "INCONCLUSIVE",
            ],
        }
        if self._heartbeat_callback and not self._heartbeat_callback():
            raise InvalidLifecycleTransition("Investigation worker lease is stale.")
        try:
            decision = self._model_decision(context)
        except AIBudgetExceededError:
            investigation.status = "PAUSED"
            investigation.limit_reason = "AI_TOKEN_BUDGET_REACHED"
            self._commit_worker(project_id, investigation.id)
            return self.get(project_id, investigation.id)
        if self._heartbeat_callback and not self._heartbeat_callback():
            raise InvalidLifecycleTransition("Investigation worker lease is stale.")
        self._guard_worker(project_id, investigation.id)
        self._session.add(
            InvestigationDecisionRecord(
                id=new_id(),
                project_id=project_id,
                investigation_id=investigation.id,
                cycle_fingerprint=cycle,
                decision_json=decision.model_dump(mode="json"),
                rationale=decision.rationale_summary,
            )
        )
        investigation.state_version += 1
        self._commit_worker(project_id, investigation.id)
        return self._apply_decision(
            project_id, investigation, hypotheses[0], observations, decision, worker_id
        )

    def _model_decision(self, context: dict[str, object]) -> InvestigationDecision:
        if self._settings is None or self._decision_human is None:
            return InvestigationDecision(
                decision="INCONCLUSIVE", rationale_summary="No model gateway is configured."
            )
        import json

        request = ModelRequest(
            system_prompt=(
                "CHEMDFT_INVESTIGATION_DECISION_V1. Return JSON only matching the typed "
                "InvestigationDecision schema. Model output is untrusted; never invent values. "
                "Cite only observation IDs in the supplied context."
            ),
            messages=(ModelMessage(role="user", content=json.dumps(context, sort_keys=True)),),
            model_tier=ModelTier.REASONING,
            temperature=0.0,
            max_attempts=1,
        )
        try:
            from dataclasses import replace

            from .ai.providers import AIProviderService

            providers = AIProviderService(self._session, self._decision_human, self._settings)
            gateway, state = providers.gateway()
            request, invocation_id = self._reserve_ai_invocation(
                replace(request, model_identifier=state.model), state
            )
            try:
                response = (self._gateway or gateway).generate(request)
            except Exception as error:
                from .ai.gateway import ModelGatewayError, ModelResponse, not_dispatched_reason

                if isinstance(error, ModelGatewayError) and not error.request_sent:
                    # Rejected before any network I/O: release, never charge, the reservation.
                    self._release_unsent_ai_invocation(invocation_id, not_dispatched_reason(error))
                    raise
                self._settle_ai_invocation(
                    invocation_id,
                    ModelResponse(
                        content=None,
                        provider=state.provider,
                        model_identifier=state.model,
                        usage=getattr(error, "usage", None),
                        reported_usage=getattr(error, "reported_usage", None),
                    ),
                    status="FAILED_UNCERTAIN",
                )
                raise
            self._settle_ai_invocation(invocation_id, response)
            if response.provider != state.provider or response.model_identifier != state.model:
                raise ValueError("provider/model identity mismatch")
            if state.mode == "BYOK":
                providers.mark_validated(state.provider)
            if not response.content:
                raise ValueError("empty model response")
            payload = json.loads(response.content)
            return InvestigationDecision.model_validate(payload)
        except (AIBudgetExceededError, InvalidLifecycleTransition):
            raise
        except Exception:
            self._session.rollback()
            return InvestigationDecision(
                decision="INCONCLUSIVE",
                rationale_summary=(
                    "AI decision unavailable or invalid; "
                    "no provider/model/source fallback was used."
                ),
            )

    def _reserve_ai_invocation(self, request, state):
        from dataclasses import replace

        from .ai.usage_accounting import reserve_invocation

        investigation = self._decision_investigation
        policy = investigation.policy_json or {}
        run = self._session.scalar(
            select(AIRunRecord)
            .where(
                AIRunRecord.investigation_id == investigation.id,
                AIRunRecord.actor_id == self._decision_human.user_id,
            )
            .order_by(AIRunRecord.created_at.desc())
        )
        if run is None:
            conversation = AIConversationRecord(
                id=new_id(),
                project_id=investigation.project_id,
                title=f"Investigation {investigation.title}",
                created_by=investigation.created_by,
            )
            run = AIRunRecord(
                id=new_id(),
                project_id=investigation.project_id,
                conversation_id=conversation.id,
                actor_id=investigation.created_by,
                status="SUCCEEDED",
                investigation_id=investigation.id,
            )
            self._session.add_all([conversation, run])
            self._session.commit()
        run_id = run.id
        invocation_id = new_id()
        # INPUT_RESERVATION_V1 at the conservative one-token-per-byte fallback: the same estimate
        # the AI Scientist uses (ai/token_policy.py), derived from the exact serialized request
        # including tool schemas and message framing. It is a reservation, not an observed
        # tokenizer count. Oversized context is rejected before dispatch, never trimmed.
        from .ai.gateway import request_input_bound

        bound = request_input_bound(request, 1.0)
        input_reserve = bound.tokens
        reservation = {}

        def reserve(budget):
            used = int(budget.get("ai_calls_used", 0))
            if used >= int(policy.get("max_ai_calls", 10)):
                raise AIBudgetExceededError(
                    "model calls", int(policy.get("max_ai_calls", 10)), used
                )
            if budget.get("ai_reservation") is not None:
                raise InvalidLifecycleTransition(
                    "An investigation model call is already in flight."
                )
            stored = budget.get("ai_token_budget")
            if stored is None and used:
                raise InvalidLifecycleTransition(
                    "Historical investigation token allocation is unspecified; "
                    "explicit allocation review is required."
                )
            tokens = (
                AIRunBudget.from_dict(stored)
                if stored
                else AIRunBudget(
                    max_input_tokens=int(policy.get("max_ai_input_tokens", 60000)),
                    max_output_tokens=int(policy.get("max_ai_output_tokens", 12000)),
                    max_model_calls=int(policy.get("max_ai_calls", 10)),
                )
            )
            remaining_input = tokens.max_input_tokens - tokens.input_tokens_used
            if input_reserve > remaining_input:
                raise AIBudgetExceededError("input reservation", remaining_input, input_reserve)
            output_reserve = min(
                self._settings.ai_max_tokens_per_run,
                2048,
                tokens.max_output_tokens - tokens.output_tokens_used,
            )
            tokens.reserve_model_call(input_reserve, output_reserve)
            reservation.update(
                bound.reservation_fields(),
                input_tokens=tokens.reserved_input_tokens,
                output_tokens=tokens.reserved_output_tokens,
                owner=self._active_worker_id,
                expires_at=(
                    utc_now() + timedelta(seconds=self._settings.ai_timeout_seconds + 60)
                ).isoformat(),
            )
            reserve_invocation(
                self._session,
                project_id=investigation.project_id,
                run_id=run_id,
                provider=state.provider,
                model=state.model,
                mode=state.mode,
                prompt_version="INVESTIGATION_DECISION_V1",
                reservation=reservation,
                invocation_id=invocation_id,
                identity=self._decision_human,
                settings=self._settings,
            )
            budget["ai_calls_used"] = used + 1
            budget["ai_token_budget"] = tokens.to_dict()
            budget["ai_reservation"] = {"invocation_id": invocation_id, **reservation}

        self._update_budget(investigation.project_id, investigation.id, reserve)
        return (
            replace(
                request,
                max_tokens=reservation["output_tokens"],
                reserved_input_tokens=reservation["input_tokens"],
                input_bytes_per_token_floor=bound.bytes_per_token_floor,
            ),
            invocation_id,
        )

    def _release_unsent_ai_invocation(self, invocation_id, reason):
        """Undo a reservation whose request never left the process (no spend, no model call)."""
        from .ai.usage_accounting import release_undispatched_invocation

        investigation = self._decision_investigation
        # Same lock order as settlement: investigation row first, then the receipt.
        self._session.execute(
            update(InvestigationRecord)
            .where(
                InvestigationRecord.id == investigation.id,
                InvestigationRecord.project_id == investigation.project_id,
            )
            .values(state_version=InvestigationRecord.state_version)
            .execution_options(synchronize_session=False)
        )
        closed = release_undispatched_invocation(
            self._session, invocation_id, reason=reason, commit=False
        )
        if closed:

            def release(budget):
                pending = budget.get("ai_reservation") or {}
                if pending.get("invocation_id") != invocation_id:
                    return  # recovered or replaced reservation: leave the successor alone
                tokens = AIRunBudget.from_dict(budget.get("ai_token_budget"))
                tokens.release_unsent_reservation()
                budget["ai_token_budget"] = tokens.to_dict()
                budget["ai_reservation"] = None
                budget["ai_calls_used"] = max(0, int(budget.get("ai_calls_used", 0)) - 1)

            self._update_budget(
                investigation.project_id, investigation.id, release, fenced=False, commit=False
            )
        self._session.commit()

    def _settle_ai_invocation(self, invocation_id, response=None, *, status="SUCCEEDED"):
        from .ai.usage_accounting import finish_invocation

        investigation = self._decision_investigation
        # Always acquire the investigation lock before the receipt/ledger locks.
        # Accounting may finish after its worker was fenced, but cannot execute
        # a scientific action or settle a successor's reservation.
        self._session.execute(
            update(InvestigationRecord)
            .where(
                InvestigationRecord.id == investigation.id,
                InvestigationRecord.project_id == investigation.project_id,
            )
            .values(state_version=InvestigationRecord.state_version)
            .execution_options(synchronize_session=False)
        )
        row, changed, late = finish_invocation(
            self._session,
            self._decision_human,
            self._settings,
            invocation_id,
            response,
            status=status,
            commit=False,
        )
        failure = []
        if changed:

            def settle(budget):
                tokens = AIRunBudget.from_dict(budget.get("ai_token_budget"))
                pending = budget.get("ai_reservation") or {}
                if late:
                    reserved = row.reservation_json or {}
                    tokens.input_tokens_used += int(
                        reserved.get("settlement_delta_input_tokens", 0)
                    )
                    tokens.output_tokens_used += int(
                        reserved.get("settlement_delta_output_tokens", 0)
                    )
                elif pending.get("invocation_id") != invocation_id:
                    raise InvalidLifecycleTransition(
                        "Usage receipt does not match its reservation."
                    )
                else:
                    if response is not None and response.usage is not None:
                        try:
                            tokens.reconcile_model_usage(
                                response.usage.input_tokens, response.usage.output_tokens
                            )
                        except AIBudgetExceededError as error:
                            failure.append(error)
                    else:
                        tokens.settle_uncertain()
                        reserved = row.reservation_json or {}
                        tokens.input_tokens_used += max(
                            0,
                            int(reserved.get("accounted_input_tokens", 0))
                            - int(reserved.get("input_tokens", 0)),
                        )
                        tokens.output_tokens_used += max(
                            0,
                            int(reserved.get("accounted_output_tokens", 0))
                            - int(reserved.get("output_tokens", 0)),
                        )
                    budget["ai_reservation"] = None
                budget["ai_token_budget"] = tokens.to_dict()
                if (
                    tokens.input_tokens_used > tokens.max_input_tokens
                    or tokens.output_tokens_used > tokens.max_output_tokens
                ):
                    failure.append(
                        AIBudgetExceededError(
                            "settled tokens", tokens.max_output_tokens, tokens.output_tokens_used
                        )
                    )

            self._update_budget(
                investigation.project_id, investigation.id, settle, fenced=False, commit=False
            )
        self._session.commit()
        if failure:
            raise failure[0]

    def _recover_ai_reservation(self, investigation):
        from datetime import datetime

        pending = (investigation.budget_json or {}).get("ai_reservation")
        if not pending:
            return True
        expires = datetime.fromisoformat(pending["expires_at"])
        predecessor = pending.get("owner")
        if expires > utc_now() and (predecessor is None or predecessor == self._active_worker_id):
            return False
        self._decision_investigation = investigation
        self._decision_human = Identity(investigation.created_by, self._identity.organization_id)
        self._settle_ai_invocation(pending["invocation_id"], status="FAILED_UNCERTAIN")
        return True

    def _candidate_action(
        self,
        project_id: str,
        investigation: InvestigationRecord,
        observations: list[InvestigationObservationRecord],
    ) -> dict[str, object] | None:
        if len(observations) != 1 or "compare" not in investigation.objective.lower():
            return None
        step = self._session.scalar(
            select(InvestigationStepRecord)
            .join(
                InvestigationPlanRecord,
                InvestigationStepRecord.plan_id == InvestigationPlanRecord.id,
            )
            .where(InvestigationPlanRecord.investigation_id == investigation.id)
            .order_by(
                InvestigationPlanRecord.revision.desc(), InvestigationStepRecord.step_number.desc()
            )
        )
        if step is None:
            return None
        args = dict((step.result_ref_json or {}).get("tool_arguments", {}))
        specification = dict(args.get("specification", {}))
        method = dict(specification.get("method", {}))
        basis = dict(specification.get("basis", {}))
        if str(method.get("identifier", "")).lower() in {"b3lyp", "pbe"}:
            return None
        method.update({"identifier": "b3lyp", "display_name": "B3LYP"})
        basis.update({"identifier": "def2-svp", "display_name": "def2-SVP"})
        specification["method"] = method
        specification["basis"] = basis
        args["specification"] = specification
        args.pop("idempotency_key", None)
        return {
            "action": "calculation.submit",
            "intent": "Run B3LYP/def2-SVP for deterministic comparison",
            "approval_class": "EXPENSIVE",
            "estimated_cost": {"minor_units": 0},
            "tool_arguments": args,
        }

    def _apply_decision(
        self,
        project_id: str,
        investigation: InvestigationRecord,
        hypothesis: InvestigationHypothesisRecord,
        observations: list[InvestigationObservationRecord],
        decision: InvestigationDecision,
        worker_id: str | None,
    ) -> InvestigationView:
        self._require_current_observations(project_id, investigation.id)
        cited = {str(item) for item in decision.cited_observation_ids}
        available = {item.id for item in observations}
        if not cited.issubset(available):
            decision = InvestigationDecision(
                decision="INCONCLUSIVE", rationale_summary="Decision cited an unknown observation."
            )
        if decision.decision == "REQUEST_USER_INPUT":
            investigation.user_input_json = {
                "question": decision.user_question or decision.rationale_summary
            }
            investigation.status = "WAITING_FOR_USER"
            investigation.state_version += 1
            self._commit_worker(project_id, investigation.id)
            return self.get(project_id, investigation.id)
        if decision.decision in {"COMPLETE", "ASSESS_AND_COMPLETE", "INCONCLUSIVE"}:
            outcome = decision.hypothesis_assessment or (
                "INCONCLUSIVE" if decision.decision == "INCONCLUSIVE" else "SUPPORTED"
            )
            if observations:
                rationale = decision.rationale_summary
                result_ids = [
                    item.source_entity_id
                    for item in observations
                    if item.source_entity_type == "CALCULATION_RESULT"
                ]
                if len(result_ids) >= 2:
                    from .investigation_comparison import compare_energy_results

                    comparison = compare_energy_results(
                        self._session, project_id, result_ids[0], result_ids[1]
                    )
                    # Keep arithmetic server-owned; the model only supplied the
                    # typed assessment and rationale.
                    rationale = f"{rationale} Comparison: {comparison}"
                hypothesis.status = outcome
                existing_assessment = self._session.scalar(
                    select(InvestigationAssessmentRecord)
                    .where(
                        InvestigationAssessmentRecord.investigation_id == investigation.id,
                        InvestigationAssessmentRecord.hypothesis_id == hypothesis.id,
                    )
                    .order_by(InvestigationAssessmentRecord.created_at.desc())
                )
                if existing_assessment is None:
                    self._session.add(
                        InvestigationAssessmentRecord(
                            id=new_id(),
                            project_id=project_id,
                            investigation_id=investigation.id,
                            hypothesis_id=hypothesis.id,
                            outcome=outcome,
                            rationale=rationale,
                            observation_ids_json=[item.id for item in observations],
                        )
                    )
            investigation.status = "COMPLETED"
            investigation.state_version += 1
            self._commit_worker(project_id, investigation.id)
            return self.get(project_id, investigation.id)
        if decision.decision in {"PROPOSE_STEP", "ASSESS_AND_CONTINUE"}:
            action = decision.proposed_action or self._candidate_action(
                project_id, investigation, observations
            )
            if action is None:
                investigation.status = "COMPLETED"
                investigation.limit_reason = "NO_SUPPORTED_NEXT_ACTION"
                investigation.state_version += 1
                self._commit_worker(project_id, investigation.id)
                return self.get(project_id, investigation.id)
            fingerprint = self._fingerprint(action)
            if investigation.last_action_fingerprint == fingerprint:
                investigation.repeated_action_count += 1
            else:
                investigation.last_action_fingerprint = fingerprint
                investigation.repeated_action_count = 1
            if investigation.repeated_action_count > 1:
                investigation.status = "PAUSED"
                investigation.limit_reason = "REPEATED_ACTION"
                investigation.state_version += 1
                self._commit_worker(project_id, investigation.id)
                return self.get(project_id, investigation.id)
            existing_step = None
            for candidate_step in self._session.scalars(
                select(InvestigationStepRecord)
                .join(
                    InvestigationPlanRecord,
                    InvestigationStepRecord.plan_id == InvestigationPlanRecord.id,
                )
                .where(InvestigationPlanRecord.investigation_id == investigation.id)
            ).all():
                candidate_args = (candidate_step.result_ref_json or {}).get("tool_arguments", {})
                if self._fingerprint({
                    "action": candidate_step.action,
                    "intent": candidate_step.intent,
                    "approval_class": candidate_step.approval_class,
                    "estimated_cost": candidate_step.estimated_cost_json,
                    "tool_arguments": candidate_args,
                }) == fingerprint:
                    existing_step = candidate_step
                    break
            if existing_step is not None:
                plan = self._session.get(InvestigationPlanRecord, existing_step.plan_id)
                if plan is not None:
                    return self._dispatch_step(project_id, investigation, plan, existing_step)
            previous = self._session.scalar(
                select(InvestigationPlanRecord)
                .where(InvestigationPlanRecord.investigation_id == investigation.id)
                .order_by(InvestigationPlanRecord.revision.desc())
            )
            plan = InvestigationPlanRecord(
                id=new_id(),
                project_id=project_id,
                investigation_id=investigation.id,
                revision=(previous.revision + 1 if previous else 1),
                status="DRAFT",
                created_by=self._identity.user_id,
            )
            self._session.add(plan)
            step = InvestigationStepRecord(
                id=new_id(),
                project_id=project_id,
                plan_id=plan.id,
                step_number=1,
                action=str(action.get("action", "")),
                intent=str(action.get("intent", "")),
                dependencies_json=[],
                status="PLANNED",
                approval_class=str(action.get("approval_class", "EXPENSIVE")),
                estimated_cost_json=dict(action.get("estimated_cost", {})),
                result_ref_json={"tool_arguments": dict(action.get("tool_arguments", {}))},
            )
            self._session.add(step)
            investigation.status = "ACTIVE"
            investigation.state_version += 1
            self._commit_worker(project_id, investigation.id)
            return self._dispatch_step(project_id, investigation, plan, step)
        investigation.status = "COMPLETED"
        investigation.limit_reason = "INCONCLUSIVE"
        investigation.state_version += 1
        self._commit_worker(project_id, investigation.id)
        return self.get(project_id, investigation.id)

    @staticmethod
    def _fingerprint(value: object) -> str:
        import hashlib
        import json

        return hashlib.sha256(
            json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
        ).hexdigest()

    @staticmethod
    def _request_hash(args: dict[str, object]) -> str:
        """Canonical scientific request identity.

        Excludes the idempotency key so that two requests with the same
        scientific inputs but different keys are recognised as equivalent,
        while two requests with the same key but different inputs are a
        conflict.
        """
        import hashlib
        import json

        payload = {k: v for k, v in args.items() if k != "idempotency_key"}
        return hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

    def _authoritative_compute_cost_minor_units(
        self, project_id: str, args: dict[str, object]
    ) -> int:
        """Compute the authoritative server-side estimate for a calculation.

        The model/caller-provided ``estimated_cost_json`` is never trusted for
        enforceable budget limits. This mirrors the requirement-building logic
        in ``calculation_actions.submit_calculation`` and returns the
        ``cost_high`` minor units from the deterministic ``estimate_for_requirement``.

        Returns the non-negative minor-unit cost. Raises ``ScientificValidationFailed``
        if an authoritative estimate cannot be produced, so the investigation
        fails closed rather than silently treating the step as free.
        """
        from uuid import UUID

        from .compute_gateway import (
            choose_provider,
            default_requirement,
            estimate_for_requirement,
        )
        from .contracts.catalog import CalculationSubmitInput
        from .contracts.scientific import CalculationTaskType

        try:
            command = CalculationSubmitInput.model_validate(args)
        except Exception as error:
            raise ScientificValidationFailed(
                "Cannot produce an authoritative compute estimate for malformed "
                f"calculation arguments: {error}"
            ) from error
        try:
            provider = choose_provider(self._settings, command.provider_preference)
        except Exception as error:
            raise ScientificValidationFailed(
                f"Cannot determine compute provider for estimate: {error}"
            ) from error
        requirement = default_requirement(self._settings, provider)
        if command.specification.task_type is CalculationTaskType.CONFORMER_SEARCH:
            requirement = requirement.model_copy(
                update={
                    "cpu_count": 2,
                    "runtime_limit_seconds": min(
                        command.specification.conformer_search.timeout_seconds,
                        self._settings.crest_timeout_seconds,
                    ),
                    "temporary_storage_bytes": self._settings.crest_max_scratch_bytes,
                }
            )
        if command.specification.engine_preference.engine == "psi4":
            from .scientific.engines.psi4 import (
                MAX_DIRECTORY,
                MAX_WALL,
                MEMORY_BYTES,
            )

            requirement = requirement.model_copy(
                update={
                    "cpu_count": 1,
                    "memory_bytes": MEMORY_BYTES,
                    "runtime_limit_seconds": min(
                        MAX_WALL, self._settings.scientific_execution_timeout_seconds
                    ),
                    "temporary_storage_bytes": min(
                        MAX_DIRECTORY,
                        self._settings.compute_local_temporary_storage_bytes,
                    ),
                }
            )
        estimate = estimate_for_requirement(
            estimate_id=UUID(new_id()),
            project_id=UUID(project_id),
            requirement=requirement,
            provider=provider,
        )
        cost_high = estimate.cost_high
        if cost_high is None:
            # No authoritative cost available: fail closed rather than treating
            # the step as free and allowing a model-provided zero estimate to
            # bypass the investigation compute ceiling.
            raise ScientificValidationFailed(
                "Authoritative compute estimate is unavailable for this calculation; "
                "the investigation compute budget cannot be enforced."
            )
        if not isinstance(cost_high.minor_units, int) or cost_high.minor_units < 0:
            raise ScientificValidationFailed(
                "Authoritative compute estimate reported an invalid cost."
            )
        if cost_high.currency != "USD":
            raise ScientificValidationFailed(
                f"Unsupported compute estimate currency: {cost_high.currency}."
            )
        return cost_high.minor_units

    def _require(self, project_id: str, investigation_id: str) -> InvestigationRecord:
        row = self._session.scalar(
            select(InvestigationRecord).where(
                InvestigationRecord.id == investigation_id,
                InvestigationRecord.project_id == project_id,
            )
        )
        if row is None:
            raise ScientificReferenceNotFound("Investigation does not exist.")
        return row

    def _validate_source(self, project_id: str, kind: str, source_id: str, requested: str) -> str:
        if kind == "CALCULATION_RESULT":
            row = self._session.scalar(
                select(CalculationResultRecord).where(
                    CalculationResultRecord.id == source_id,
                    CalculationResultRecord.project_id == project_id,
                )
            )
            expected = "CALCULATED"
        elif kind == "EXPERIMENTAL_DATASET" or kind == "DIGITIZED_DATASET":
            row = self._session.scalar(
                select(ExperimentalDatasetRecord).where(
                    ExperimentalDatasetRecord.id == source_id,
                    ExperimentalDatasetRecord.project_id == project_id,
                )
            )
            expected = "DIGITIZED" if kind == "DIGITIZED_DATASET" else "EXPERIMENTAL"
        else:
            row = self._session.scalar(
                select(EvidenceCandidateRecord).where(
                    EvidenceCandidateRecord.id == source_id,
                    EvidenceCandidateRecord.project_id == project_id,
                )
            )
            expected = "EXTRACTED"
        if row is None:
            raise ScientificReferenceNotFound("Observation source does not exist in this project.")
        if kind == "CALCULATION_RESULT":
            from .effective_result_state import require_current_result
            require_current_result(self._session, row)
        if requested != expected:
            raise ScientificValidationFailed(
                "Observation source class does not match the authoritative source entity."
            )
        return expected

    def _observation_states(self, project_id, investigation_id):
        from .effective_result_state import effective_result_state
        states = {}
        observations = self._session.scalars(select(InvestigationObservationRecord).where(
            InvestigationObservationRecord.project_id == project_id,
            InvestigationObservationRecord.investigation_id == investigation_id,
            InvestigationObservationRecord.source_entity_type == "CALCULATION_RESULT",
        )).all()
        for observation in observations:
            result = self._session.scalar(select(CalculationResultRecord).where(
                CalculationResultRecord.id == observation.source_entity_id,
                CalculationResultRecord.project_id == project_id,
            ))
            states[observation.id] = (
                effective_result_state(self._session, result) if result else None
            )
        return states

    def _require_current_observations(self, project_id, investigation_id):
        if any(state is None or not state.eligible_for_derivation
               for state in self._observation_states(project_id, investigation_id).values()):
            raise ScientificValidationFailed(
                "Investigation contains inactive scientific evidence; "
                "historical observations cannot support new derivations."
            )

    def _view(self, project_id: str, row: InvestigationRecord) -> InvestigationView:
        hypotheses = self._session.scalars(
            select(InvestigationHypothesisRecord)
            .where(InvestigationHypothesisRecord.investigation_id == row.id)
            .order_by(InvestigationHypothesisRecord.created_at)
        ).all()
        plans = self._session.scalars(
            select(InvestigationPlanRecord)
            .where(InvestigationPlanRecord.investigation_id == row.id)
            .order_by(InvestigationPlanRecord.revision)
        ).all()
        observations = self._session.scalars(
            select(InvestigationObservationRecord)
            .where(InvestigationObservationRecord.investigation_id == row.id)
            .order_by(InvestigationObservationRecord.created_at)
        ).all()
        assessments = self._session.scalars(
            select(InvestigationAssessmentRecord)
            .where(InvestigationAssessmentRecord.investigation_id == row.id)
            .order_by(InvestigationAssessmentRecord.created_at)
        ).all()
        states = self._observation_states(project_id, row.id)
        inactive = {
            key
            for key, value in states.items()
            if value is None or not value.eligible_for_derivation
        }
        inactive_hypotheses = {
            a.hypothesis_id for a in assessments if inactive.intersection(a.observation_ids_json)
        }
        policy = InvestigationPolicy.model_validate(row.policy_json)
        pending_approval = self._session.scalar(
            select(AIApprovalRecord).where(
                AIApprovalRecord.investigation_id == row.id,
                AIApprovalRecord.project_id == project_id,
                AIApprovalRecord.status == "PENDING",
            )
        )
        return InvestigationView(
            id=UUID(row.id),
            project_id=UUID(project_id),
            title=row.title,
            objective=row.objective,
            status="PAUSED" if inactive and row.status not in _TERMINAL else row.status,
            stored_status=row.status,
            current_evidence_valid=not inactive,
            inactive_observation_ids=tuple(UUID(key) for key in sorted(inactive)),
            policy=policy,
            budget={**(row.budget_json or {}),
                    **self._compute_cost_snapshot(project_id, row.id)},
            stop_conditions=tuple(row.stop_conditions_json),
            limit_reason="INACTIVE_SCIENTIFIC_EVIDENCE"
            if inactive and row.status not in _TERMINAL
            else row.limit_reason,
            started_at=row.started_at,
            pending_approval_id=UUID(pending_approval.id) if pending_approval else None,
            pending_approval=AIApprovalView(
                id=UUID(pending_approval.id),
                run_id=UUID(pending_approval.run_id),
                project_id=UUID(project_id),
                tool_name=pending_approval.tool_name,
                tool_version=pending_approval.tool_version,
                normalized_arguments=pending_approval.normalized_arguments_json,
                action_fingerprint=pending_approval.action_fingerprint,
                scientific_summary=pending_approval.scientific_summary,
                reason=pending_approval.reason,
                status=pending_approval.status,
                expires_at=pending_approval.expires_at,
                created_at=pending_approval.created_at,
                creates_or_changes="Calculation and compute job queued through existing engines",
            )
            if pending_approval
            else None,
            user_input=row.user_input_json,
            hypotheses=tuple(
                InvestigationHypothesisView(
                    id=UUID(item.id),
                    statement=item.statement,
                    source_class=item.source_class,
                    status="INCONCLUSIVE" if item.id in inactive_hypotheses else item.status,
                    historical_status=item.status,
                    support_refs=tuple(item.support_refs_json),
                    contradiction_refs=tuple(item.contradiction_refs_json),
                    created_at=item.created_at,
                )
                for item in hypotheses
            ),
            plans=tuple(self._plan_view(item) for item in plans),
            observations=tuple(
                InvestigationObservationView(
                    id=UUID(item.id),
                    source_entity_type=item.source_entity_type,
                    source_entity_id=UUID(item.source_entity_id),
                    source_class=item.source_class,
                    summary=("Historical inactive evidence: " + item.summary)
                    if item.id in inactive
                    else item.summary,
                    current=item.id not in inactive,
                    effective_result_state=states.get(item.id),
                    citations=tuple(item.citations_json),
                    created_at=item.created_at,
                )
                for item in observations
            ),
            assessments=tuple(
                InvestigationAssessmentView(
                    id=UUID(item.id),
                    hypothesis_id=UUID(item.hypothesis_id),
                    outcome=item.outcome,
                    rationale=("Historical assessment; inactive evidence: " + item.rationale)
                    if inactive.intersection(item.observation_ids_json)
                    else item.rationale,
                    current=not bool(inactive.intersection(item.observation_ids_json)),
                    observation_ids=tuple(UUID(value) for value in item.observation_ids_json),
                    created_at=item.created_at,
                )
                for item in assessments
            ),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _plan_view(self, plan: InvestigationPlanRecord) -> InvestigationPlanView:
        steps = self._session.scalars(
            select(InvestigationStepRecord)
            .where(InvestigationStepRecord.plan_id == plan.id)
            .order_by(InvestigationStepRecord.step_number)
        ).all()
        return InvestigationPlanView(
            id=UUID(plan.id),
            revision=plan.revision,
            status=plan.status,
            steps=tuple(
                InvestigationStepView(
                    id=UUID(item.id),
                    step_number=item.step_number,
                    action=item.action,
                    intent=item.intent,
                    dependencies=tuple(UUID(value) for value in item.dependencies_json),
                    status=item.status,
                    approval_class=item.approval_class,
                    estimated_cost=item.estimated_cost_json,
                    result_ref=item.result_ref_json,
                    failure=item.failure_json,
                )
                for item in steps
            ),
            created_at=plan.created_at,
        )
