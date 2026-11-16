"""Durable investigation orchestration worker.

The worker owns leasing only. All domain side effects are delegated to
InvestigationService, which in turn uses the Tool Registry and application
actions.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import timedelta

from sqlalchemy import select, update

from .composition import get_object_store_for_settings
from .config import get_settings
from .database import SessionLocal
from .investigation_models import InvestigationRecord
from .investigation_service import InvestigationService
from .models import new_id, utc_now
from .service_principals import (
    SERVICE_INVESTIGATION_WORKER,
    ensure_service_principals,
    service_identity_for_work,
)


def recover_expired_leases(session) -> int:  # type: ignore[no-untyped-def]
    now = utc_now()
    changed = session.execute(
        update(InvestigationRecord)
        .where(
            InvestigationRecord.lease_owner.is_not(None),
            InvestigationRecord.lease_expires_at.is_not(None),
            InvestigationRecord.lease_expires_at < now,
            InvestigationRecord.status.in_(("ACTIVE", "WAITING_FOR_RESULT")),
        )
        .values(lease_owner=None, lease_expires_at=None)
    )
    if changed.rowcount:
        session.commit()
    return int(changed.rowcount or 0)


def claim_next_investigation(session, worker_id: str, lease_seconds: int = 120):
    """Return one claimed record using a SQLite-compatible compare-and-set."""
    now = utc_now()
    row = session.scalar(
        select(InvestigationRecord)
        .where(
            InvestigationRecord.status.in_(("ACTIVE", "WAITING_FOR_RESULT")),
            (InvestigationRecord.lease_owner.is_(None))
            | (InvestigationRecord.lease_expires_at.is_(None))
            | (InvestigationRecord.lease_expires_at <= now),
        )
        .order_by(InvestigationRecord.updated_at.asc())
        .limit(1)
    )
    if row is None:
        return None
    claimed = session.execute(
        update(InvestigationRecord)
        .where(
            InvestigationRecord.id == row.id,
            InvestigationRecord.status.in_(("ACTIVE", "WAITING_FOR_RESULT")),
            (InvestigationRecord.lease_owner.is_(None))
            | (InvestigationRecord.lease_expires_at.is_(None))
            | (InvestigationRecord.lease_expires_at <= now),
        )
        .values(
            lease_owner=worker_id,
            lease_expires_at=now + timedelta(seconds=lease_seconds),
        )
    )
    if claimed.rowcount != 1:
        session.rollback()
        return None
    session.commit()
    return row.id, row.project_id


def run_once(worker_id: str = "local-investigation-worker") -> bool:
    # Every claim has a unique owner token. A previous invocation with the same
    # configured worker name cannot heartbeat/release a successor's lease.
    worker_id = f"{worker_id[:120]}:{new_id()}"
    settings = get_settings()
    if settings.auto_create_schema:
        from .database import Base, engine

        Base.metadata.create_all(engine)
    with SessionLocal() as session:
        ensure_service_principals(session)
        recover_expired_leases(session)
        claimed = claim_next_investigation(session, worker_id, settings.investigation_lease_seconds)
        if claimed is None:
            return False
        investigation_id, project_id = claimed
        identity = service_identity_for_work(
            session, SERVICE_INVESTIGATION_WORKER, investigation_id
        )
        service = InvestigationService(
            session,
            identity,
            get_object_store_for_settings(settings),
            settings,
            heartbeat_callback=lambda: service.heartbeat(project_id, investigation_id, worker_id),
        )
        try:
            service.heartbeat(project_id, investigation_id, worker_id)
            service.resume(project_id, investigation_id, worker_id=worker_id)
        finally:
            service.release_lease(project_id, investigation_id, worker_id)
        return True


def run(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run the ChemDFT investigation worker.")
    parser.add_argument(
        "--once",
        action="store_true",
        help="claim and process at most one investigation, then exit",
    )
    arguments = parser.parse_args(sys.argv[1:] if argv is None else argv)
    worker_id = os.environ.get("CHEMDFT_INVESTIGATION_WORKER_ID", "local-investigation-worker")
    once = arguments.once or os.environ.get("CHEMDFT_INVESTIGATION_WORKER_ONCE") == "1"
    poll_seconds = float(os.environ.get("CHEMDFT_INVESTIGATION_WORKER_POLL_SECONDS", "2"))
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
