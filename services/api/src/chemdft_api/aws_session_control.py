"""Owner-run AWS session control: the ONLY code that can ask the Lambda guard to start EC2.

The application, the API and the compute worker never import this module (a test enforces it).
It is driven by ``tools/aws_session.py`` after the researcher has approved ONE session:

* ``open`` needs the exact approval phrase and an interactive typed confirmation, verifies the
  operator identity, refuses to run if a usable session or a running instance already exists,
  asks the guard to start the existing instance (the guard enforces the monthly quota, the
  two-hour limit and the independent shutdown timer), waits until the guard reports ``running``
  and only then writes the local session record that lets the worker claim AWS jobs.
* ``close`` asks the guard to stop, independently confirms ``stopped`` and removes the record.
* ``status`` is read-only.

Nothing here overrides, refunds or resets the guard's quota; a refusal is reported as a refusal.
"""

from __future__ import annotations

import contextlib
import json
import os
import time
from collections.abc import Callable
from pathlib import Path

from .aws_compute import (
    SESSION_KEY,
    SESSION_SCHEMA,
    AwsCli,
    AwsProviderError,
    AwsSession,
    read_session,
    session_record_json,
)
from .config import Settings

APPROVAL_PHRASE = "START ONE CHEMDFT AWS SESSION"
CONFIRM_PHRASE = "YES START"
FLUSH_SECONDS = 20  # let the logged SSM transcript upload finish before the guard stops the host


class SessionController:
    def __init__(
        self,
        settings: Settings,
        cli: AwsCli | None = None,
        *,
        wall: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._settings = settings
        self._cli = cli or AwsCli(settings, guard_operations=("poll", "start", "stop", "disable"))
        self._wall = wall
        self._sleep = sleep

    def _require_configured(self) -> Path:
        s = self._settings
        if not s.compute_aws_enabled:
            raise AwsProviderError("AWS_DISABLED", "compute_aws_enabled is false")
        if s.aws_session_file is None or not s.aws_instance_id:
            raise AwsProviderError("AWS_MISCONFIGURED", "aws_session_file/aws_instance_id missing")
        return s.aws_session_file

    def status(self) -> dict[str, object]:
        self._cli.verify_identity()
        guard = self._cli.poll_guard()
        session = read_session(self._settings.aws_session_file)
        return {
            "guard": guard,
            "instance_state": self._cli.instance_state(),
            "session_record": None
            if session is None
            else {
                "instance_id": session.instance_id,
                "deadline_epoch": session.deadline_epoch,
                "seconds_remaining": int(session.remaining(self._wall())),
            },
        }

    def open(self, *, approval: str, confirm: Callable[[str], str]) -> AwsSession:
        path = self._require_configured()
        if approval != APPROVAL_PHRASE:
            raise AwsProviderError("SESSION_NOT_APPROVED", "exact owner approval phrase required")
        self._cli.verify_identity()
        existing = read_session(path)
        if existing is not None and existing.remaining(self._wall()) > 0:
            raise AwsProviderError("SESSION_ALREADY_OPEN", "a session record is still valid")
        before = self._cli.poll_guard()
        if before.get("status") != "stopped":
            raise AwsProviderError("INSTANCE_NOT_STOPPED", f"guard status {before.get('status')}")
        if self._cli.instance_state() != "stopped":
            raise AwsProviderError("INSTANCE_NOT_STOPPED", "independent read disagrees")
        answer = confirm(
            "This reserves up to two guard-metered hours of the monthly quota and starts the "
            f"pilot EC2 instance. Type '{CONFIRM_PHRASE}' to continue: "
        )
        if answer.strip() != CONFIRM_PHRASE:
            raise AwsProviderError("SESSION_NOT_CONFIRMED", "typed confirmation did not match")
        started = self._cli.invoke_guard("start")  # the single start request; never retried
        status = started.get("status")
        if status == "QUOTA_EXHAUSTED_OR_MONTH_END":
            raise AwsProviderError("GUARD_ADMISSION_REFUSED", "quota exhausted or month end")
        deadline = started.get("deadline")
        if status != "START_REQUESTED" or not isinstance(deadline, int):
            raise AwsProviderError("GUARD_ERROR", f"unexpected start response {status}")
        for _ in range(60):
            state = self._cli.poll_guard()
            if state.get("status") == "running" and state.get("deadline") == deadline:
                break
            if state.get("status") in {"stopped", "stopping", "STOP_REQUESTED"}:
                raise AwsProviderError(
                    "INSTANCE_NOT_STARTED", f"guard status {state.get('status')}"
                )
            self._sleep(5)
        else:
            self.close()  # fail closed: do not leave a half-started instance running
            raise AwsProviderError("INSTANCE_START_TIMEOUT", "guard never reported running")
        session = AwsSession(self._settings.aws_instance_id or "", deadline, int(self._wall()))
        self._write_record(path, session)
        self._publish(session)
        return session

    def _publish(self, session: AwsSession | None) -> None:
        """Mirror the record to S3 for the hosted backend's worker (owner tool only)."""
        if not self._settings.aws_session_publish:
            return
        import tempfile

        with tempfile.TemporaryDirectory(prefix="chemdft-publish-") as directory:
            target = Path(directory) / "current.json"
            target.write_text(
                session_record_json(session, self._settings.aws_instance_id or "", self._wall())
            )
            self._cli.put(target, SESSION_KEY)

    def close(self) -> None:
        path = self._require_configured()
        self._cli.verify_identity()
        # The hosted worker stops claiming AWS jobs before the host stops; a publish failure
        # must never prevent the stop.
        with contextlib.suppress(AwsProviderError):
            self._publish(None)
        self._sleep(FLUSH_SECONDS)
        try:
            self._cli.invoke_guard("stop")
        finally:
            # Remove the record first so the worker stops claiming AWS jobs immediately.
            if path.exists() and not path.is_symlink():
                path.unlink()
        for _ in range(36):
            if self._cli.instance_state() == "stopped":
                return
            self._sleep(5)
        raise AwsProviderError("INSTANCE_NOT_CONFIRMED_STOPPED", "stop requested; confirm manually")

    def disable(self) -> dict[str, object]:
        """Emergency stop: pause every start and stop a running worker (re-arm = ledger edit)."""
        self._cli.verify_identity()
        return self._cli.invoke_guard("disable")

    @staticmethod
    def _write_record(path: Path, session: AwsSession) -> None:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = path.with_suffix(".tmp")
        payload = {
            "schema": SESSION_SCHEMA,
            "instance_id": session.instance_id,
            "deadline_epoch": session.deadline_epoch,
            "opened_epoch": session.opened_epoch,
        }
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(json.dumps(payload, sort_keys=True))
        os.replace(temporary, path)
