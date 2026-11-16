"""Server-owned action identity and atomic action receipts (AS-0 section 4, crash contract).

An AI-driven mutation is identified by a key the *server* derives from the project, conversation,
tool and normalized arguments. The model never supplies or influences it. The receipt row
(``ai_run_actions``, unique on ``(project_id, action_key)``) has this life cycle:

    INTENT     committed by the orchestrator before dispatch (also the crash marker)
    COMPLETED  committed in the *same transaction* as the domain effect and its event
    FAILED     the handler rejected the action; retryable with the same key
    ABANDONED  the run was stopped before the effect committed; never completes

Recovery after a crash is therefore decided by the database alone: an effect exists if and only if
its receipt is COMPLETED, so a replay returns the stored result and an INTENT is re-dispatched.
``complete_action`` also performs the final fencing check inside the effect transaction, so a worker
whose epoch was superseded by Pause/Stop/Resume cannot commit even if it was already past dispatch.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import and_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..ai_models import AIActionReceiptRecord, AIRunRecord
from ..models import utc_now
from .events import AIRunEventManager
from .execution import ACTIVE_STATES, StaleWorkerFencedError


class ActionConflictError(Exception):
    """The same action key was presented with different normalized arguments."""

    def __init__(self, action_key: str):
        self.action_key = action_key
        super().__init__(
            "This action identity was already used with different arguments; the request "
            "was rejected before any effect."
        )


class ActionAbandonedError(Exception):
    """The run that owned this action was stopped; the action can never complete."""


class ActionOwnershipLostError(ActionAbandonedError):
    """Another run (or epoch) owns this unfinished action; this worker may not complete it."""


class ActionBusyError(Exception):
    """A different run is actively executing this action."""


@dataclass(frozen=True, slots=True)
class ReceiptState:
    id: str
    status: str
    result: dict[str, Any] | None
    effect_entity_id: str | None
    run_id: str | None = None


def canonical_digest(value: dict[str, Any]) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def server_action_key(
    project_id: str,
    conversation_id: str | None,
    turn_id: str | None,
    tool_name: str,
    digest: str,
    occurrence: int = 0,
) -> str:
    """Stable, server-owned *logical* action identity.

    One researcher request (``turn_id``) authorizes its own actions; the Nth request for identical
    arguments inside that turn is a separate logical action (``occurrence``). A retry, crash replay
    or Resume of the same turn re-derives the same keys (one effect), while a later request or a
    second identical step gets a distinct key (a distinct effect).
    """
    scope = (
        f"{project_id}|{conversation_id or '-'}|{turn_id or '-'}|{tool_name}|{digest}|{occurrence}"
    )
    return "act-" + hashlib.sha256(scope.encode("utf-8")).hexdigest()[:48]


def _owner_is(run_id: str | None, epoch: int | None):
    run_match = (
        AIActionReceiptRecord.run_id.is_(None)
        if run_id is None
        else AIActionReceiptRecord.run_id == run_id
    )
    epoch_match = (
        AIActionReceiptRecord.epoch.is_(None)
        if epoch is None
        else AIActionReceiptRecord.epoch == epoch
    )
    return and_(run_match, epoch_match)


def _state(row: AIActionReceiptRecord) -> ReceiptState:
    return ReceiptState(
        id=row.id,
        status=row.status,
        result=dict(row.result_json) if row.result_json is not None else None,
        effect_entity_id=row.effect_entity_id,
        run_id=row.run_id,
    )


def _fetch(session: Session, project_id: str, action_key: str) -> AIActionReceiptRecord | None:
    return session.scalar(
        select(AIActionReceiptRecord).where(
            AIActionReceiptRecord.project_id == project_id,
            AIActionReceiptRecord.action_key == action_key,
        )
    )


def begin_action(
    session: Session,
    *,
    project_id: str,
    run_id: str | None,
    epoch: int | None,
    tool_name: str,
    action_key: str,
    arguments_sha256: str,
) -> ReceiptState:
    """Commit the action intent (or return the existing receipt). Idempotent and race-safe.

    Raises ``ActionConflictError`` for the same key with different arguments and
    ``ActionAbandonedError`` for an action whose run was stopped.
    """
    for _ in range(3):
        existing = _fetch(session, project_id, action_key)
        if existing is None:
            session.add(
                AIActionReceiptRecord(
                    project_id=project_id,
                    run_id=run_id,
                    action_key=action_key,
                    tool_name=tool_name,
                    arguments_sha256=arguments_sha256,
                    epoch=epoch,
                    status="INTENT",
                )
            )
            try:
                session.commit()
            except IntegrityError:
                session.rollback()  # lost the race; re-read the winner's row
                continue
            existing = _fetch(session, project_id, action_key)
            assert existing is not None
            return _state(existing)
        if existing.arguments_sha256 != arguments_sha256 or existing.tool_name != tool_name:
            raise ActionConflictError(action_key)
        if existing.status == "COMPLETED":
            return _state(existing)
        if existing.run_id == run_id and existing.epoch == epoch:
            if existing.status == "ABANDONED":
                raise ActionAbandonedError()
            return _state(existing)
        if existing.run_id is not None and existing.run_id != run_id:
            owner_status = session.scalar(
                select(AIRunRecord.status).where(AIRunRecord.id == existing.run_id)
            )
            if owner_status in ACTIVE_STATES:
                raise ActionBusyError()  # never hijack an action a live run is executing
        if existing.run_id == run_id and existing.status == "ABANDONED":
            raise ActionAbandonedError()
        # Compare-and-set takeover from a paused/stopped/finished owner (or a newer epoch of the
        # same run); losing the race means someone else took it, so re-read.
        taken = session.execute(
            update(AIActionReceiptRecord)
            .where(
                AIActionReceiptRecord.id == existing.id,
                AIActionReceiptRecord.status == existing.status,
                _owner_is(existing.run_id, existing.epoch),
            )
            .values(run_id=run_id, epoch=epoch, status="INTENT", completed_at=None)
            .execution_options(synchronize_session=False)
        )
        session.commit()
        if taken.rowcount != 1:
            continue
        existing = _fetch(session, project_id, action_key)
        assert existing is not None
        return _state(existing)
    raise RuntimeError("Could not establish the action receipt.")


def get_receipt(session: Session, project_id: str, action_key: str) -> ReceiptState | None:
    row = _fetch(session, project_id, action_key)
    return _state(row) if row is not None else None


def fail_action(session: Session, project_id: str, action_key: str, error_code: str) -> None:
    session.execute(
        update(AIActionReceiptRecord)
        .where(
            AIActionReceiptRecord.project_id == project_id,
            AIActionReceiptRecord.action_key == action_key,
            AIActionReceiptRecord.status == "INTENT",
        )
        .values(status="FAILED", error_code=error_code[:64])
        .execution_options(synchronize_session=False)
    )
    session.commit()


def complete_action(
    session: Session,
    events: AIRunEventManager,
    *,
    project_id: str,
    action_key: str,
    run_id: str | None,
    epoch: int | None,
    result: dict[str, Any],
    effect_entity_id: str,
    event: tuple[str, str, dict[str, Any], tuple[str, str]] | None,
) -> tuple[bool, ReceiptState]:
    """Atomically commit the pending domain effect, its receipt and its event.

    The caller has already flushed the effect rows into ``session`` without committing. Returns
    ``(True, receipt)`` when this call committed the effect, or ``(False, receipt)`` when another
    worker had already completed the same action (the pending effect rows are rolled back).
    Raises ``StaleWorkerFencedError`` (after rolling the effect back) if the fencing epoch or run
    state no longer permits this worker to publish.
    """
    if run_id is not None and epoch is not None:
        row = session.execute(
            select(AIRunRecord.fencing_epoch, AIRunRecord.status)
            .where(AIRunRecord.id == run_id, AIRunRecord.project_id == project_id)
            .with_for_update()
        ).one_or_none()
        if row is None or row[0] != epoch or row[1] not in ACTIVE_STATES:
            session.rollback()
            raise StaleWorkerFencedError(run_id, epoch, None if row is None else int(row[0]))
    claimed = session.execute(
        update(AIActionReceiptRecord)
        .where(
            AIActionReceiptRecord.project_id == project_id,
            AIActionReceiptRecord.action_key == action_key,
            AIActionReceiptRecord.status.in_(("INTENT", "FAILED")),
            _owner_is(run_id, epoch),
        )
        .values(
            status="COMPLETED",
            result_json=result,
            effect_entity_id=effect_entity_id,
            error_code=None,
            completed_at=utc_now(),
        )
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        session.rollback()
        existing = _fetch(session, project_id, action_key)
        if existing is None or existing.status != "COMPLETED":
            if existing is not None and existing.status in {"INTENT", "FAILED"}:
                raise ActionOwnershipLostError()
            raise ActionAbandonedError()
        return False, _state(existing)
    if event is not None and run_id is not None:
        event_type, summary, payload, dedupe = event
        events.record_event(
            project_id, run_id, event_type, summary, payload, epoch=epoch, dedupe_on=dedupe
        )
    session.commit()
    completed = _fetch(session, project_id, action_key)
    assert completed is not None
    return True, _state(completed)
