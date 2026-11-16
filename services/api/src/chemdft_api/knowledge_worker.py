"""Durable asynchronous project knowledge indexing worker."""

from __future__ import annotations

import os
import time
from datetime import timedelta

from sqlalchemy import select, update

from .config import get_settings
from .database import SessionLocal
from .knowledge.service import KnowledgeService
from .knowledge_models import KnowledgeIndexAttemptRecord, KnowledgeIndexJobRecord, utc_now
from .models import new_id
from .service_principals import (
    SERVICE_KNOWLEDGE_WORKER,
    ensure_service_principals,
    service_identity_for_work,
)


def recover_expired_jobs(session) -> int:  # type: ignore[no-untyped-def]
    now = utc_now()
    jobs = session.scalars(
        select(KnowledgeIndexJobRecord).where(
            KnowledgeIndexJobRecord.state.in_(["LEASED", "RUNNING"]),
            KnowledgeIndexJobRecord.expires_at < now,
        )
    ).all()
    for job in jobs:
        if job.attempt_count >= job.max_attempts:
            job.state = "FAILED"
            job.last_error_code = "LEASE_EXPIRED"
        else:
            job.state = "PENDING"
        job.lease_id = None
        job.lease_owner = None
        job.expires_at = None
        job.diagnostic = "Worker lease expired; job recovered."[:1000]
        job.updated_at = now
    if jobs:
        session.commit()
    return len(jobs)


def claim_next_job(session, worker_id: str, lease_seconds: int = 300):  # type: ignore[no-untyped-def]
    """Claim exactly one job using row locking on PostgreSQL and CAS on SQLite."""
    now = utc_now()
    stmt = (
        select(KnowledgeIndexJobRecord)
        .where(KnowledgeIndexJobRecord.state == "PENDING")
        .order_by(KnowledgeIndexJobRecord.priority.desc(), KnowledgeIndexJobRecord.created_at.asc())
        .limit(1)
    )
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        job = session.scalar(stmt.with_for_update(skip_locked=True))
        if job is None:
            return None
    else:
        job = session.scalar(stmt)
        if job is None:
            return None
        claimed = session.execute(
            update(KnowledgeIndexJobRecord)
            .where(
                KnowledgeIndexJobRecord.id == job.id,
                KnowledgeIndexJobRecord.state == "PENDING",
            )
            .values(state="LEASED", lease_owner=worker_id)
        )
        if claimed.rowcount != 1:
            session.rollback()
            return None
        session.refresh(job)
    lease_id = new_id()
    job.state = "LEASED"
    job.lease_id = lease_id
    job.lease_owner = worker_id
    job.issued_at = now
    job.expires_at = now + timedelta(seconds=lease_seconds)
    job.heartbeat_at = now
    job.attempt_count += 1
    job.updated_at = now
    attempt = KnowledgeIndexAttemptRecord(
        id=new_id(),
        job_id=job.id,
        attempt_number=job.attempt_count,
        worker_id=worker_id,
        lease_id=lease_id,
        started_at=now,
        heartbeat_at=now,
        state="RUNNING",
    )
    session.add(attempt)
    session.commit()
    return job.id, lease_id, attempt.id


def heartbeat(session, job_id: str, lease_id: str, lease_seconds: int = 300) -> bool:
    now = utc_now()
    job = session.scalar(
        select(KnowledgeIndexJobRecord).where(
            KnowledgeIndexJobRecord.id == job_id,
            KnowledgeIndexJobRecord.lease_id == lease_id,
            KnowledgeIndexJobRecord.state.in_(["LEASED", "RUNNING"]),
        )
    )
    if job is None:
        return False
    job.state = "RUNNING"
    job.heartbeat_at = now
    job.expires_at = now + timedelta(seconds=lease_seconds)
    session.commit()
    return True


def run_once(worker_id: str = "local-knowledge-worker") -> bool:
    settings = get_settings()
    if settings.auto_create_schema:
        from .database import Base, engine

        Base.metadata.create_all(engine)
    with SessionLocal() as session:
        ensure_service_principals(session)
        recover_expired_jobs(session)
        claimed = claim_next_job(session, worker_id, settings.knowledge_lease_seconds)
        if claimed is None:
            return False
        job_id, _lease_id, attempt_id = claimed
        job = session.get(KnowledgeIndexJobRecord, job_id)
        attempt = session.get(KnowledgeIndexAttemptRecord, attempt_id)
        assert job is not None and attempt is not None
        job.state = "RUNNING"
        session.commit()
        identity = service_identity_for_work(session, SERVICE_KNOWLEDGE_WORKER, job_id)
        status = process_claimed_job(session, identity, job_id, attempt_id)
        return status


def process_claimed_job(session, identity, job_id: str, attempt_id: str) -> bool:  # type: ignore[no-untyped-def]
    job = session.get(KnowledgeIndexJobRecord, job_id)
    attempt = session.get(KnowledgeIndexAttemptRecord, attempt_id)
    if job is None or attempt is None:
        return False
    status = KnowledgeService(
        session,
        identity,
        batch_size=get_settings().knowledge_max_chunks_per_batch,
        heartbeat_callback=lambda: heartbeat(
            session, job_id, job.lease_id or "", get_settings().knowledge_lease_seconds
        ),
    ).index_project(job.project_id, generation=job.source_revision)
    attempt.finished_at = utc_now()
    attempt.heartbeat_at = utc_now()
    if status.status == "READY":
        attempt.state = "SUCCEEDED"
        job.state = "SUCCEEDED"
        job.diagnostic = None
    else:
        attempt.state = "FAILED"
        attempt.error_code = "INDEX_FAILED"
        attempt.diagnostic = status.diagnostic
        job.last_error_code = "INDEX_FAILED"
        job.diagnostic = status.diagnostic
        job.state = "PENDING" if job.attempt_count < job.max_attempts else "FAILED"
    job.lease_id = None
    job.lease_owner = None
    job.expires_at = None
    job.updated_at = utc_now()
    session.commit()
    return True


def run() -> None:
    worker_id = os.environ.get("CHEMDFT_KNOWLEDGE_WORKER_ID", "local-knowledge-worker")
    once = os.environ.get("CHEMDFT_KNOWLEDGE_WORKER_ONCE") == "1"
    poll_seconds = float(os.environ.get("CHEMDFT_KNOWLEDGE_WORKER_POLL_SECONDS", "2"))
    while True:
        try:
            ran = run_once(worker_id)
            if once:
                return
            if not ran:
                time.sleep(poll_seconds)
        except Exception:
            if once:
                raise
            time.sleep(poll_seconds)


if __name__ == "__main__":
    run()
