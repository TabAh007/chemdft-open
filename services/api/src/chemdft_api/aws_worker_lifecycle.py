"""On-demand AWS worker lifecycle: ask the guard to start the scientific worker for waiting jobs.

The compute worker (the only process with AWS credentials) calls ``advance`` on every loop. When
approved AWS jobs are waiting it asks the guard Lambda for ``ensure_started`` (idempotent: the
guard's ledger admits at most one start, enforces the monthly allowance, the kill switch and the
restart cool-down); otherwise it only ``poll``s, and no more often than once a minute. It can never
call EC2, never calls the guard's ``start``/``stop``, and never retries a failed start inside the
hold window.

It publishes two small local files on the shared object volume, so the credential-less API process
can read them:

* the session record (the existing ``chemdft.aws.session.v1`` file): written OPEN only while the
  worker is running and past its boot grace, CLOSED otherwise. The existing claim gate
  (``session_is_authorized``) therefore claims AWS jobs only when the worker is genuinely ready;
* a worker-state file, used for the researcher-visible startup message (STARTING / READY / ...).

Jobs stay durably queued in PostgreSQL the whole time; nothing here changes a job or a result.
"""

from __future__ import annotations

import contextlib
import json
import os
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .aws_compute import (
    AWS_PROVIDER,
    AwsCli,
    AwsProviderError,
    AwsSession,
    session_record_json,
)
from .config import Settings

STATE_SCHEMA = "chemdft.aws.worker-state.v1"
GUARD_OPERATIONS = ("poll", "ensure_started")  # never "start", never "stop"

IDLE = "IDLE"  # worker stopped, nothing waiting
STARTING = "STARTING"  # start requested / instance pending / booting
READY = "READY"  # running, past boot grace, enough session time for another job
EXPIRING = "EXPIRING"  # running but too little session time left; waits for it to stop
STOPPING = "STOPPING"
WAITING = "WAITING"  # restart cool-down after a recent start
REFUSED = "REFUSED"  # kill switch or monthly allowance
STARTUP_FAILED = "STARTUP_FAILED"  # did not reach running in time; no retry until the hold ends
UNAVAILABLE = "UNAVAILABLE"  # the guard or AWS could not be reached

_MESSAGES = {
    IDLE: "The AWS worker is stopped and starts automatically when an approved calculation waits.",
    STARTING: "The AWS worker is starting for your calculation; it stays queued until it is ready.",
    READY: "The AWS worker is running and ready.",
    EXPIRING: "The AWS worker session is nearly over; the calculation waits for the next start.",
    STOPPING: "The AWS worker is shutting down; the calculation waits and a new start follows.",
    WAITING: "The AWS worker restarts shortly (minimum pause between starts).",
    REFUSED: "AWS compute is paused (monthly allowance used or switched off by the owner).",
    STARTUP_FAILED: "The AWS worker did not start in time; the calculation stays queued.",
    UNAVAILABLE: "The AWS worker could not be reached; the calculation stays queued.",
}


@dataclass(frozen=True, slots=True)
class WorkerState:
    state: str
    updated_epoch: int
    requested_epoch: int | None = None
    deadline_epoch: int | None = None
    opened_epoch: int | None = None
    hold_until_epoch: int | None = None
    code: str | None = None

    @property
    def message(self) -> str:
        return _MESSAGES.get(self.state, _MESSAGES[UNAVAILABLE])


def state_json(state: WorkerState) -> str:
    return json.dumps({"schema": STATE_SCHEMA, **asdict(state)}, sort_keys=True)


def parse_state(text: str) -> WorkerState | None:
    try:
        data = json.loads(text)
        if data.get("schema") != STATE_SCHEMA or data["state"] not in _MESSAGES:
            return None

        def number(key):
            value = data.get(key)
            return None if value is None else int(value)

        return WorkerState(
            state=data["state"],
            updated_epoch=int(data["updated_epoch"]),
            requested_epoch=number("requested_epoch"),
            deadline_epoch=number("deadline_epoch"),
            opened_epoch=number("opened_epoch"),
            hold_until_epoch=number("hold_until_epoch"),
            code=data.get("code") if isinstance(data.get("code"), str) else None,
        )
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


def read_state(path: Path | None) -> WorkerState | None:
    try:
        if path is None or not path.is_file() or path.is_symlink():
            return None
        return parse_state(path.read_text())
    except OSError:
        return None


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(text)
    os.replace(temporary, path)


def on_demand_ready_to_queue(settings: Settings) -> bool:
    """Configuration needed for on-demand mode (no AWS call)."""
    return bool(
        settings.compute_aws_enabled
        and settings.aws_on_demand_enabled
        and settings.aws_session_file is not None
        and settings.aws_worker_state_file is not None
        and settings.aws_guard_poll_enabled
        and not settings.aws_session_s3_key
    )


def visible_diagnostic(settings: Settings, now: float | None = None) -> str | None:
    """The researcher-facing startup message, read from the shared state file (API process).

    ``None`` when on-demand mode is off. A stale file is reported honestly as not reporting."""
    if not settings.aws_on_demand_enabled:
        return None
    wall = time.time() if now is None else now
    state = read_state(settings.aws_worker_state_file)
    if state is None or wall - state.updated_epoch > 3 * settings.aws_lifecycle_idle_poll_seconds:
        return "The AWS worker controller is not reporting; the calculation stays queued."
    detail = state.message
    if state.state == STARTING and state.requested_epoch:
        detail += f" (requested {int(wall - state.requested_epoch)} s ago)"
    return detail


class AwsWorkerLifecycle:
    def __init__(
        self,
        settings: Settings,
        cli: AwsCli | None = None,
        *,
        wall: Callable[[], float] = time.time,
    ) -> None:
        self._s = settings
        self._cli = cli or AwsCli(settings, guard_operations=GUARD_OPERATIONS)
        self._wall = wall

    # -- one decision step; never raises for AWS-side problems --------------------------------
    def advance(self, waiting_jobs: bool) -> WorkerState | None:
        s = self._s
        if not on_demand_ready_to_queue(s):
            return None
        now = int(self._wall())
        from .aws_compute import AwsEc2ComputeProvider

        if AwsEc2ComputeProvider(s).missing_configuration():
            # Never start the worker (and never burn an approved job) while the provider itself
            # could not execute: a misconfiguration is reported, the job stays queued.
            return self._publish(WorkerState(UNAVAILABLE, now, code="MISCONFIGURED"))
        prev = read_state(s.aws_worker_state_file)
        hold = prev.hold_until_epoch if prev else None
        interval = (
            s.aws_lifecycle_poll_seconds if waiting_jobs else s.aws_lifecycle_idle_poll_seconds
        )
        if prev and hold and now < hold:
            # A failed start is never retried inside the hold window; only the heartbeat advances
            # so the researcher-visible message is not mistaken for a silent controller.
            if now - prev.updated_epoch >= interval:
                return self._publish(replace(prev, updated_epoch=now))
            return prev
        if prev and now - prev.updated_epoch < interval:
            return prev
        was_starting = bool(prev and prev.state == STARTING)
        requested = prev.requested_epoch if was_starting else None
        operation = "ensure_started" if waiting_jobs else "poll"
        try:
            self._cli.verify_identity()
            response = self._cli.invoke_guard(operation)
        except AwsProviderError as error:
            return self._publish(WorkerState(UNAVAILABLE, now, requested, code=error.code))
        return self._publish(self._classify(response, now, requested, was_starting))

    def _classify(self, response, now: int, requested, was_starting: bool) -> WorkerState:
        s = self._s
        status = str(response.get("status"))
        deadline = response.get("deadline")
        deadline = deadline if isinstance(deadline, int) else None
        if status in {"running", "pending"}:
            started = response.get("started")
            opened = started if isinstance(started, int) and started > 0 else None
            if opened is None and deadline is not None:
                opened = deadline - 7080  # the guard's reservation window
            if status == "pending" or opened is None or deadline is None:
                return self._starting(now, requested, deadline, opened)
            if now < opened + s.aws_boot_grace_seconds:
                return self._starting(now, requested, deadline, opened)
            needed = s.scientific_execution_timeout_seconds + s.aws_job_overhead_seconds + 120
            kind = READY if deadline - now >= needed else EXPIRING
            return WorkerState(kind, now, requested, deadline, opened)
        if status == "START_ALREADY_REQUESTED":
            return self._starting(now, requested or now, deadline, None)
        if status == "START_REQUESTED":
            if was_starting:
                # The guard had to start it AGAIN: the previous start did not hold. Do not thrash.
                return self._failed(now, requested, "RESTARTED_DURING_START")
            return self._starting(now, now, deadline, None)
        if was_starting and status in {"stopped", "stopping", "STOP_REQUESTED"}:
            return self._failed(now, requested, "STOPPED_DURING_START")
        if status == "stopped":
            return WorkerState(IDLE, now)
        if status in {"stopping", "STOP_REQUESTED"}:
            return WorkerState(STOPPING, now)
        if status == "COOLDOWN":
            return WorkerState(WAITING, now)
        if status == "DISABLED":
            return WorkerState(REFUSED, now, code="DISABLED")
        if status == "QUOTA_EXHAUSTED_OR_MONTH_END":
            return WorkerState(REFUSED, now, code=status)
        return WorkerState(UNAVAILABLE, now, code="GUARD_STATUS_" + status[:40])

    def _starting(self, now: int, requested, deadline, opened) -> WorkerState:
        requested = requested or now
        if now - requested > self._s.aws_start_timeout_seconds:
            return self._failed(now, requested, "START_TIMEOUT")
        return WorkerState(STARTING, now, requested, deadline, opened)

    def _failed(self, now: int, requested, code: str) -> WorkerState:
        return WorkerState(
            STARTUP_FAILED,
            now,
            requested,
            hold_until_epoch=now + self._s.aws_start_failure_hold_seconds,
            code=code,
        )

    # -- publication ----------------------------------------------------------------------------
    def _publish(self, state: WorkerState) -> WorkerState:
        s = self._s
        open_session = state.state in {READY, EXPIRING} and state.deadline_epoch is not None
        session = (
            AwsSession(s.aws_instance_id or "", state.deadline_epoch, state.opened_epoch or 0)
            if open_session
            else None
        )
        # Close the claim gate first; open it only for a worker that is really ready.
        _write(
            s.aws_session_file,
            session_record_json(session, s.aws_instance_id or "", float(state.updated_epoch)),
        )
        _write(s.aws_worker_state_file, state_json(state))
        return state


def stale_cutoff(settings: Settings, now: datetime | None = None) -> datetime:
    return (now or datetime.now(UTC)) - timedelta(seconds=settings.aws_job_max_wait_seconds)


def waiting_aws_jobs(session, max_age_seconds: int | None = None) -> int:
    """Approved AWS jobs that are queued, unclaimed and not stale (what justifies a worker start)."""
    from sqlalchemy import func, select

    from .contracts.catalog import ComputeJobState
    from .scientific_models import ComputeJobRecord

    query = (
        select(func.count())
        .select_from(ComputeJobRecord)
        .where(
            ComputeJobRecord.provider == AWS_PROVIDER,
            ComputeJobRecord.state.in_([ComputeJobState.READY, ComputeJobState.PENDING]),
        )
    )
    if max_age_seconds is not None:
        cutoff = datetime.now(UTC) - timedelta(seconds=max_age_seconds)
        query = query.where(ComputeJobRecord.created_at >= cutoff)
    return int(session.scalar(query) or 0)


def advance_for_queue(session, settings: Settings, lifecycle: AwsWorkerLifecycle | None = None):
    """Worker-loop hook. Lifecycle problems must never stop the queue from draining."""
    if not on_demand_ready_to_queue(settings):
        return None
    with contextlib.suppress(Exception):
        return (lifecycle or AwsWorkerLifecycle(settings)).advance(
            waiting_aws_jobs(session, settings.aws_job_max_wait_seconds) > 0
        )
    return None
