"""Project queue and worker status, read from persisted jobs, executions and leases only."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .config import Settings
from .context import Identity
from .contracts.workflows import ActiveExecution, QueueCounts, QueueStatus
from .scientific_models import ComputeExecutionRecord, ComputeJobRecord, ComputeLeaseRecord

NOTICE = (
    "Counts, leases and heartbeats are read from the job database. ChemDFT cannot observe a worker "
    "process directly: with no active lease an idle worker looks the same as a stopped one. Queue "
    "position across other projects is not shown."
)
_ACTIVE = ("LEASED", "RUNNING", "CANCEL_REQUESTED")


def _aware(value: datetime | None) -> datetime | None:
    return None if value is None else (value if value.tzinfo else value.replace(tzinfo=UTC))


def get_queue_status(
    session: Session, identity: Identity, settings: Settings, project_id: str
) -> QueueStatus:
    project, _member = authorize_project_access(session, identity, project_id)
    now = datetime.now(UTC)
    by_state = dict(
        session.execute(
            select(ComputeJobRecord.state, func.count())
            .where(ComputeJobRecord.project_id == project.id)
            .group_by(ComputeJobRecord.state)
        ).all()
    )

    def count(*states: str) -> int:
        return sum(int(by_state.get(str(s), 0)) for s in states)

    oldest = session.scalar(
        select(func.min(ComputeJobRecord.created_at)).where(
            ComputeJobRecord.project_id == project.id,
            ComputeJobRecord.state.in_(("PENDING", "READY")),
        )
    )
    active: list[ActiveExecution] = []
    for job in session.scalars(
        select(ComputeJobRecord)
        .where(ComputeJobRecord.project_id == project.id, ComputeJobRecord.state.in_(_ACTIVE))
        .order_by(ComputeJobRecord.created_at)
    ):
        execution = session.scalar(
            select(ComputeExecutionRecord)
            .where(ComputeExecutionRecord.job_id == job.id)
            .order_by(ComputeExecutionRecord.created_at.desc())
            .limit(1)
        )
        lease = session.scalar(
            select(ComputeLeaseRecord)
            .where(ComputeLeaseRecord.job_id == job.id, ComputeLeaseRecord.state == "ACTIVE")
            .order_by(ComputeLeaseRecord.issued_at.desc())
            .limit(1)
        )
        beat = _aware(
            (lease.heartbeat_at if lease else None)
            or (execution.heartbeat_at if execution else None)
        )
        age = max(0.0, (now - beat).total_seconds()) if beat else None
        if lease is not None:
            # Same rule as job diagnostics: the scheduler's own lease deadline decides.
            status = "STALE" if _aware(lease.heartbeat_deadline_at) < now else "FRESH"  # type: ignore[operator]
        elif age is not None:
            status = "STALE" if age > settings.compute_heartbeat_seconds else "FRESH"
        else:
            status = "NOT_REPORTED"
        active.append(
            ActiveExecution(
                job_id=UUID(job.id),
                calculation_id=UUID(job.calculation_id),
                job_state=str(job.state),
                worker_id=execution.worker_id if execution else None,
                lease_owner=lease.owner if lease else None,
                started_at=execution.started_at if execution else None,
                heartbeat_at=beat,
                heartbeat_age_seconds=age,
                heartbeat_status=status,  # type: ignore[arg-type]
            )
        )
    return QueueStatus(
        project_id=UUID(project.id),
        server_time=now,
        counts=QueueCounts(
            queued=count("PENDING", "READY"),
            leased=count("LEASED"),
            running=count("RUNNING"),
            cancel_requested=count("CANCEL_REQUESTED"),
            succeeded=count("SUCCEEDED"),
            failed=count("FAILED"),
            canceled=count("CANCELED"),
        ),
        oldest_queued_at=oldest,
        active=tuple(active),
        heartbeat_stale_after_seconds=float(settings.compute_heartbeat_seconds),
        notice=NOTICE,
    )
