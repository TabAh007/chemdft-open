"""Read-only job diagnostics projected from persisted execution, attempt and lease records.

No progress percentage is produced: none of the native engines publishes a trustworthy one, and
elapsed time says nothing about scientific convergence. Heartbeat freshness is judged against the
same lease deadline the scheduler itself uses to declare an execution lost.
"""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .config import Settings
from .context import Identity
from .contracts.analysis import (
    DiagnosticArtifact,
    DiagnosticAttempt,
    DiagnosticExecution,
    DiagnosticLease,
    JobDiagnostics,
    JobLogOutput,
)
from .errors import ScientificReferenceNotFound, ScientificValidationFailed
from .scientific_models import (
    CalculationAttemptRecord,
    ComputeExecutionRecord,
    ComputeJobRecord,
    ComputeLeaseRecord,
    ScientificArtifactRecord,
)
from .storage import ObjectStore

LOG_TAIL_BYTES = 64 * 1024
_TERMINAL = {"SUCCEEDED", "FAILED", "CANCELED"}
_PROGRESS_NOTE = (
    "Native engines do not report a trustworthy percent-complete, so none is shown. "
    "State, heartbeat and persisted engine logs are the only progress evidence."
)


def _aware(value: datetime | None) -> datetime | None:
    return None if value is None else (value if value.tzinfo else value.replace(tzinfo=UTC))


def _log_readable(artifact: ScientificArtifactRecord) -> bool:
    name = artifact.format_identifier.lower()
    return (
        artifact.kind == "ENGINE_LOG"
        or artifact.media_type.startswith("text/")
        or name.endswith((".log", ".txt", "stdout", "stderr"))
    )


def _job(session: Session, project_id: str, job_id: str) -> ComputeJobRecord:
    job = session.scalar(
        select(ComputeJobRecord).where(
            ComputeJobRecord.id == job_id, ComputeJobRecord.project_id == project_id
        )
    )
    if job is None:
        raise ScientificReferenceNotFound("Compute job does not exist in this project.")
    return job


def _attempt_artifacts(
    session: Session, project_id: str, attempt: CalculationAttemptRecord
) -> list[ScientificArtifactRecord]:
    ids = [
        str(ref["artifact_id"])
        for ref in (attempt.raw_artifacts_json or [])
        if ref.get("artifact_id")
    ]
    if not ids:
        return []
    rows = session.scalars(
        select(ScientificArtifactRecord).where(
            ScientificArtifactRecord.project_id == project_id, ScientificArtifactRecord.id.in_(ids)
        )
    ).all()
    order = {artifact_id: index for index, artifact_id in enumerate(ids)}
    return sorted(rows, key=lambda row: order[row.id])


_WORKLOAD_ENGINE = re.compile(r"^chemdft\.([a-z0-9]+)\.")


def attempt_engine_name(job: ComputeJobRecord, engine_identity: dict | None) -> str | None:
    """Engine shown for an attempt: the recorded identity, else the engine the job's workload
    names (a failed attempt records none), so a failed QE run is never an unknown engine."""
    name = (engine_identity or {}).get("name")
    if name:
        return str(name)
    match = _WORKLOAD_ENGINE.match(str((job.workload_json or {}).get("workload_type", "")))
    return match.group(1) if match else None


def attempt_worker_label(job: ComputeJobRecord, worker_id: str | None) -> str:
    """Release 0.0.45: hosted jobs carried a `local.pyscf` worker id whatever the engine."""
    worker = worker_id or ""
    if job.provider == "aws" and (not worker or worker.startswith("local.")):
        return "backend-compute (AWS host)"
    return worker


def get_job_diagnostics(
    session: Session, identity: Identity, settings: Settings, project_id: str, job_id: str
) -> JobDiagnostics:
    project, _member = authorize_project_access(session, identity, project_id)
    job = _job(session, project.id, job_id)
    now = datetime.now(UTC)

    executions = session.scalars(
        select(ComputeExecutionRecord)
        .where(
            ComputeExecutionRecord.job_id == job.id, ComputeExecutionRecord.project_id == project.id
        )
        .order_by(ComputeExecutionRecord.created_at, ComputeExecutionRecord.id)
    ).all()
    attempts = session.scalars(
        select(CalculationAttemptRecord)
        .where(
            CalculationAttemptRecord.calculation_id == job.calculation_id,
            CalculationAttemptRecord.project_id == project.id,
        )
        .order_by(CalculationAttemptRecord.attempt_number)
    ).all()
    lease = session.scalar(
        select(ComputeLeaseRecord)
        .where(
            ComputeLeaseRecord.job_id == job.id,
            ComputeLeaseRecord.project_id == project.id,
            ComputeLeaseRecord.state == "ACTIVE",
        )
        .order_by(ComputeLeaseRecord.issued_at.desc())
        .limit(1)
    )

    attempt_views: list[DiagnosticAttempt] = []
    logs_available = False
    for attempt in attempts:
        artifacts = _attempt_artifacts(session, project.id, attempt)
        views = tuple(
            DiagnosticArtifact(
                artifact_id=a.id,
                kind=a.kind,
                format_identifier=a.format_identifier,  # type: ignore[arg-type]
                media_type=a.media_type,
                size_bytes=a.size_bytes,
                sha256=a.sha256,
                log_readable=_log_readable(a),
            )
            for a in artifacts
        )
        logs_available = logs_available or any(v.log_readable for v in views)
        engine = attempt.engine_identity_json or {}
        attempt_views.append(
            DiagnosticAttempt(
                attempt_id=attempt.id,
                attempt_number=attempt.attempt_number,
                state=attempt.state,  # type: ignore[arg-type]
                worker_id=attempt_worker_label(job, attempt.worker_id),
                started_at=attempt.started_at,
                finished_at=attempt.finished_at,
                failure_code=attempt.failure_code,
                diagnostic=attempt.diagnostic,
                engine_name=attempt_engine_name(job, engine),
                engine_version=engine.get("version"),
                artifacts=views,
            )
        )

    stale_after = float(settings.compute_heartbeat_seconds)
    age: float | None = None
    status = "NOT_APPLICABLE" if job.state in _TERMINAL else "NOT_REPORTED"
    if job.state not in _TERMINAL:
        newest = lease.heartbeat_at if lease and lease.heartbeat_at else None
        if newest is None and executions:
            newest = executions[-1].heartbeat_at
        newest = _aware(newest)
        if newest is not None:
            age = max(0.0, (now - newest).total_seconds())
        if lease is not None:
            # The scheduler declares the execution lost once this deadline passes unrenewed.
            status = "STALE" if _aware(lease.heartbeat_deadline_at) < now else "FRESH"  # type: ignore[operator]
        elif age is not None:
            status = "STALE" if age > stale_after else "FRESH"

    return JobDiagnostics(
        project_id=project.id,  # type: ignore[arg-type]
        job_id=job.id,  # type: ignore[arg-type]
        calculation_id=job.calculation_id,  # type: ignore[arg-type]
        job_state=str(job.state),
        server_time=now,
        executions=tuple(
            DiagnosticExecution(
                execution_id=e.id,
                attempt_id=e.calculation_attempt_id,
                state=e.state,  # type: ignore[arg-type]
                provider=e.provider,
                worker_id=attempt_worker_label(job, e.worker_id) if e.worker_id else e.worker_id,
                started_at=e.started_at,
                heartbeat_at=e.heartbeat_at,
                finished_at=e.finished_at,
                failure_code=e.failure_code,
                diagnostic=e.diagnostic,
                created_at=getattr(e, "created_at", None),
            )
            for e in executions
        ),
        attempts=tuple(attempt_views),
        active_lease=DiagnosticLease(
            owner=lease.owner,
            state=lease.state,
            issued_at=lease.issued_at,
            expires_at=lease.expires_at,
            heartbeat_deadline_at=lease.heartbeat_deadline_at,
            heartbeat_at=lease.heartbeat_at,
        )
        if lease
        else None,
        heartbeat_age_seconds=age,
        heartbeat_status=status,  # type: ignore[arg-type]
        heartbeat_stale_after_seconds=stale_after,
        progress_note=_PROGRESS_NOTE,
        logs_available=logs_available,
    )


def read_job_log(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    project_id: str,
    job_id: str,
    artifact_id: str,
) -> JobLogOutput:
    project, _member = authorize_project_access(session, identity, project_id)
    job = _job(session, project.id, job_id)
    try:
        UUID(artifact_id)
    except ValueError as error:
        raise ScientificReferenceNotFound("Log artifact does not exist for this job.") from error
    attempts = session.scalars(
        select(CalculationAttemptRecord).where(
            CalculationAttemptRecord.calculation_id == job.calculation_id,
            CalculationAttemptRecord.project_id == project.id,
        )
    ).all()
    owner = next(
        (
            a
            for a in attempts
            for ref in (a.raw_artifacts_json or [])
            if str(ref.get("artifact_id")) == artifact_id
        ),
        None,
    )
    artifact = session.get(ScientificArtifactRecord, artifact_id) if owner else None
    # Only artifacts persisted by an attempt of *this* job are reachable; never an arbitrary id.
    if owner is None or artifact is None or artifact.project_id != project.id:
        raise ScientificReferenceNotFound("Log artifact does not exist for this job.")
    if not _log_readable(artifact):
        raise ScientificValidationFailed("This artifact is not a text log; download it instead.")
    data = object_store.get_bytes(artifact.storage_key, settings.scientific_max_output_bytes)
    if hashlib.sha256(data).hexdigest() != artifact.sha256:
        from .errors import ArtifactHashMismatch

        raise ArtifactHashMismatch()
    tail = data[-LOG_TAIL_BYTES:]
    text = tail.decode("utf-8", errors="replace")
    # Logs may contain terminal control sequences; keep only printable text and line structure.
    text = "".join(ch for ch in text if ch in "\n\t" or (ch >= " " and ch != "\x7f"))
    return JobLogOutput(
        artifact_id=artifact.id,
        attempt_id=owner.id,
        kind=artifact.kind,  # type: ignore[arg-type]
        media_type=artifact.media_type,
        size_bytes=len(data),
        returned_bytes=len(tail),
        truncated=len(data) > len(tail),
        sha256=artifact.sha256,
        text=text,
    )
