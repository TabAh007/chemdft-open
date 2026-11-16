# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import contextlib
import json
import os
import signal
import subprocess
import tempfile
import time
from collections.abc import Callable
from pathlib import Path

from .interfaces import ExecutionResult, LocalSubprocessRequest

DEFAULT_TICK_INTERVAL_SECONDS = 15.0


def _bounded_read(path: Path, limit: int, *, offset: int = 0) -> bytes:
    if not path.is_file() or path.is_symlink():
        return b""
    with path.open("rb") as stream:
        stream.seek(offset)
        return stream.read(max(0, limit))


def _scratch_exceeded(workdir: Path, limit: int | None) -> bool:
    """Sample only this job's scratch; this is a watchdog, not a hard quota."""
    if limit is None:
        return False
    total = 0
    for path in workdir.rglob("*"):
        if path.is_symlink():
            return True
        try:
            if path.is_file():
                total += path.stat().st_size
        except FileNotFoundError:
            continue  # native code can remove its own temporary files
        if total > limit:
            return True
    return False


def _kill_group(proc: subprocess.Popen, sig: signal.Signals) -> None:
    try:
        os.killpg(proc.pid, sig)
    except (ProcessLookupError, PermissionError):
        pass
    except Exception:
        try:
            if sig == signal.SIGKILL:
                proc.kill()
            else:
                proc.terminate()
        except ProcessLookupError:
            pass


class LocalSubprocessRunner:
    def execute(
        self,
        request: LocalSubprocessRequest,
        *,
        on_step: Callable[[dict], bool] | None = None,
        on_tick: Callable[[], bool | None] | None = None,
        tick_interval_seconds: float = DEFAULT_TICK_INTERVAL_SECONDS,
    ) -> ExecutionResult:
        """Run the worker subprocess, polling it until it exits or times out.

        `on_tick` is called from the polling loop at most once per `tick_interval_seconds` while the
        subprocess runs, whatever the task type; callers use it to keep a worker lease alive. It is
        best-effort: an exception it raises is dropped and never affects the subprocess or result.
        An explicit False return requests termination of this worker's process group.
        """
        with tempfile.TemporaryDirectory(prefix="chemdft-calculation-") as temporary:
            workdir = Path(temporary).resolve()
            input_path = workdir / "input.json"
            result_path = workdir / "result.json"
            log_path = workdir / "engine.log"
            steps_path = workdir / "steps.jsonl"
            stdout_path = workdir / "stdout.log"
            stderr_path = workdir / "stderr.log"
            input_path.write_bytes(request.normalized_input)
            if _scratch_exceeded(workdir, request.max_scratch_bytes):
                return ExecutionResult(
                    exit_code=-1,
                    timed_out=False,
                    stdout=b"",
                    stderr=b"Scratch allocation exceeded.",
                    engine_log=b"",
                    result_document=None,
                    failure_code="SCRATCH_LIMIT_EXCEEDED",
                )
            environment = {
                "PATH": os.defpath,
                "OMP_NUM_THREADS": str(request.threads),
                "MKL_NUM_THREADS": str(request.threads),
                "OPENBLAS_NUM_THREADS": str(request.threads),
                "PYTHONNOUSERSITE": "1",
                "PYTHONDONTWRITEBYTECODE": "1",
                "TMPDIR": str(workdir),
                "TMP": str(workdir),
                "TEMP": str(workdir),
                "PYSCF_TMPDIR": str(workdir),
            }
            with stdout_path.open("wb") as stdout_file, stderr_path.open("wb") as stderr_file:
                process = subprocess.Popen(
                    [
                        str(request.interpreter),
                        str(request.worker_script),
                        "--input",
                        str(input_path),
                        "--result",
                        str(result_path),
                        "--log",
                        str(log_path),
                        "--steps",
                        str(steps_path),
                        *request.extra_args,
                    ],
                    cwd=workdir,
                    env=environment,
                    stdout=stdout_file,
                    stderr=stderr_file,
                    start_new_session=True,
                )
                try:
                    started = time.monotonic()
                    last_tick = started
                    consumed = 0
                    pending = b""
                    timed_out = False
                    resource_failure = None
                    while True:
                        if _scratch_exceeded(workdir, request.max_scratch_bytes):
                            resource_failure = "SCRATCH_LIMIT_EXCEEDED"
                        elif (
                            steps_path.exists()
                            and steps_path.stat().st_size > request.max_output_bytes
                        ):
                            resource_failure = "STEP_OUTPUT_LIMIT_EXCEEDED"
                        if resource_failure:
                            _kill_group(process, signal.SIGKILL)
                            break
                        if steps_path.exists():
                            with steps_path.open("rb") as steps_file:
                                steps_file.seek(consumed)
                                chunk = steps_file.read(max(0, request.max_output_bytes - consumed))
                                consumed += len(chunk)
                            pending += chunk
                            while b"\n" in pending:
                                line, pending = pending.split(b"\n", 1)
                                if line and on_step:
                                    try:
                                        should_continue = on_step(json.loads(line))
                                    except (ValueError, TypeError):
                                        should_continue = False
                                    if should_continue is False and process.poll() is None:
                                        _kill_group(process, signal.SIGTERM)
                        if process.poll() is not None:
                            break
                        if time.monotonic() - started > request.timeout_seconds:
                            timed_out = True
                            _kill_group(process, signal.SIGKILL)
                            break
                        if (
                            on_tick is not None
                            and time.monotonic() - last_tick >= tick_interval_seconds
                        ):
                            last_tick = time.monotonic()
                            with contextlib.suppress(
                                Exception
                            ):  # a heartbeat must not disturb the run
                                if on_tick() is False:
                                    _kill_group(process, signal.SIGTERM)
                        time.sleep(0.2)
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        _kill_group(process, signal.SIGKILL)
                        process.wait(timeout=5)
                finally:
                    if process.poll() is None:
                        _kill_group(process, signal.SIGKILL)
                        process.wait(timeout=5)
            # Drain evaluations written just before process exit (including fast native runs).
            if steps_path.exists() and on_step:
                tail = _bounded_read(
                    steps_path, request.max_output_bytes - consumed, offset=consumed
                )
                for line in (pending + tail).splitlines():
                    if line:
                        with contextlib.suppress(ValueError, TypeError):
                            on_step(json.loads(line))
            native_artifacts = {}
            from .xtb_optimization import NATIVE_FILES

            native_dir = workdir / "native"
            for name in NATIVE_FILES:
                path = native_dir / name
                if path.is_file() and not path.is_symlink():
                    if path.stat().st_size > request.max_output_bytes:
                        continue  # Missing required evidence will fail closed at validation.
                    native_artifacts[name] = _bounded_read(path, request.max_output_bytes)
            result_document = None
            if (
                not resource_failure
                and result_path.is_file()
                and result_path.stat().st_size <= request.max_output_bytes
            ):
                with contextlib.suppress(ValueError, UnicodeError):
                    result_document = json.loads(
                        _bounded_read(result_path, request.max_output_bytes)
                    )
            if result_document is None and on_step and "xtbopt.log" in native_artifacts:
                # Preserve only complete genuine native samples after a crash/timeout. They
                # never become an authoritative endpoint without the full result validation.
                import hashlib

                from .xtb_optimization import frames

                document = json.loads(request.normalized_input)
                atoms = document.get("atoms", [])
                lines = native_artifacts["xtbopt.log"].splitlines(keepends=True)
                width = len(atoms) + 2
                for index, offset in enumerate(range(0, len(lines) - width + 1, width)):
                    try:
                        sample = frames(b"".join(lines[offset : offset + width]), atoms)[0]
                        if (
                            on_step(
                                {
                                    **sample,
                                    "index": index,
                                    "engine_cycle": index + 1,
                                    "evaluation_kind": "OPTIMIZER",
                                    "source_file": "xtbopt.log",
                                    "source_frame_index": index,
                                    "source_sha256": hashlib.sha256(
                                        native_artifacts["xtbopt.log"]
                                    ).hexdigest(),
                                }
                            )
                            is False
                        ):
                            break
                    except (ValueError, TypeError, KeyError):
                        break
            return ExecutionResult(
                exit_code=process.returncode if not resource_failure else -1,
                timed_out=timed_out,
                stdout=_bounded_read(stdout_path, request.max_output_bytes),
                stderr=_bounded_read(stderr_path, request.max_output_bytes),
                engine_log=_bounded_read(log_path, request.max_output_bytes),
                result_document=result_document,
                native_artifacts=native_artifacts,
                failure_code=resource_failure,
            )
