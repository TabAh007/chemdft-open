"""Durable, monotonic activity events for AI Scientist runs.

Events live in the relational database (ai_run_events) so they share the transaction of the state
change they describe (AS-0 section 5):
- The sequence is allocated by a single atomic ``UPDATE ... SET last_event_sequence = last + 1
  RETURNING`` on the run row, and (run_id, sequence) is unique, so concurrent writers and restarts
  can neither collide nor reuse a number.
- ``record_event`` never commits. The caller commits it together with the state change, so an event
  can only exist if (and exactly when) the effect it advertises was committed.
- Nothing is swallowed: a failed insert fails the surrounding transaction.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..ai_models import AIRunEventRecord, AIRunRecord
from ..models import utc_now

MAX_EVENTS_PER_REPLAY = 1000


@dataclass(frozen=True, slots=True)
class AIRunEvent:
    sequence: int
    run_id: str
    project_id: str
    event_type: str
    occurred_at: str
    summary: str
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _to_event(row: AIRunEventRecord) -> AIRunEvent:
    return AIRunEvent(
        sequence=row.sequence,
        run_id=row.run_id,
        project_id=row.project_id,
        event_type=row.event_type,
        occurred_at=row.occurred_at.isoformat(),
        summary=row.summary,
        payload=dict(row.payload_json or {}),
    )


class AIRunEventManager:
    def __init__(self, session: Session):
        self._session = session

    def record_event(
        self,
        project_id: str,
        run_id: str,
        event_type: str,
        summary: str,
        payload: dict[str, Any] | None = None,
        *,
        epoch: int | None = None,
        dedupe_on: tuple[str, str] | None = None,
    ) -> AIRunEvent | None:
        """Append an event inside the caller's transaction (no commit).

        ``dedupe_on=(payload_key, value)`` makes the append idempotent for domain events that must
        appear exactly once per effect (e.g. ``object.created`` for one candidate).
        """
        body = dict(payload or {})
        if dedupe_on is not None:
            key, value = dedupe_on
            for existing in self._session.scalars(
                select(AIRunEventRecord).where(
                    AIRunEventRecord.run_id == run_id,
                    AIRunEventRecord.project_id == project_id,
                    AIRunEventRecord.event_type == event_type,
                )
            ):
                if (existing.payload_json or {}).get(key) == value:
                    return None
        sequence = self._session.execute(
            update(AIRunRecord)
            .where(AIRunRecord.id == run_id, AIRunRecord.project_id == project_id)
            .values(last_event_sequence=AIRunRecord.last_event_sequence + 1)
            .returning(AIRunRecord.last_event_sequence)
            .execution_options(synchronize_session=False)
        ).scalar_one_or_none()
        if sequence is None:
            raise LookupError("Cannot record an event for a run that does not exist.")
        row = AIRunEventRecord(
            project_id=project_id,
            run_id=run_id,
            sequence=sequence,
            event_type=event_type,
            summary=summary[:2000],
            payload_json=body,
            epoch=epoch,
            occurred_at=utc_now(),
        )
        self._session.add(row)
        self._session.flush()
        return _to_event(row)

    def get_events(
        self,
        project_id: str,
        run_id: str,
        after_sequence: int = 0,
    ) -> tuple[AIRunEvent, ...]:
        rows = self._session.scalars(
            select(AIRunEventRecord)
            .where(
                AIRunEventRecord.run_id == run_id,
                AIRunEventRecord.project_id == project_id,
                AIRunEventRecord.sequence > after_sequence,
            )
            .order_by(AIRunEventRecord.sequence.asc())
            .limit(MAX_EVENTS_PER_REPLAY)
        ).all()
        return tuple(_to_event(row) for row in rows)
