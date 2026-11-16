from __future__ import annotations

import logging
import os
import time

from .ai.calculation_completion import reconcile_completed_calculations
from .aws_worker_lifecycle import advance_for_queue
from .calculation_actions import process_next_compute_job, recover_expired_compute_leases
from .composition import get_object_store_for_settings
from .config import get_settings
from .database import SessionLocal
from .service_principals import (
    SERVICE_COMPUTE_WORKER,
    ensure_service_principals,
    service_identity,
)

logger = logging.getLogger("chemdft.compute_worker")
ERROR_LOG_INTERVAL_SECONDS = 60.0


def run_once(worker_id: str = "local-dev-worker") -> bool:
    settings = get_settings()
    identity = service_identity(SERVICE_COMPUTE_WORKER)
    if settings.auto_create_schema:
        from .database import Base, engine

        Base.metadata.create_all(engine)
    with SessionLocal() as session:
        ensure_service_principals(session)
        recover_expired_compute_leases(session)
        # On-demand AWS: start the worker for waiting approved jobs (no-op unless enabled).
        advance_for_queue(session, settings)
        store = get_object_store_for_settings(settings)
        detail = process_next_compute_job(
            session,
            identity,
            store,
            settings,
            worker_id=worker_id,
        )
        completed = reconcile_completed_calculations(session, store)
        return detail is not None or completed > 0


def run() -> None:
    worker_id = os.environ.get("CHEMDFT_COMPUTE_WORKER_ID", "local-dev-worker")
    once = os.environ.get("CHEMDFT_COMPUTE_WORKER_ONCE") == "1"
    poll_seconds = float(os.environ.get("CHEMDFT_COMPUTE_WORKER_POLL_SECONDS", "2"))
    last_error, last_logged = "", float("-inf")
    while True:
        try:
            ran = run_once(worker_id)
            if once:
                return
            if not ran:
                time.sleep(poll_seconds)
        except Exception as error:
            if once:
                raise
            # A failing poll used to be swallowed, leaving jobs queued with no trace: log it.
            now = time.monotonic()
            key = f"{type(error).__name__}: {error}"
            if key != last_error or now - last_logged >= ERROR_LOG_INTERVAL_SECONDS:
                logger.exception("compute worker poll failed; jobs may not be claimed: %s", key)
                last_error, last_logged = key, now
            time.sleep(poll_seconds)


if __name__ == "__main__":
    run()
