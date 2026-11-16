"""Run the isolated experimental spectra worker (services/spectra-worker) for one request.

The API never imports numpy, scipy or pybaselines. The worker runs in its own virtual environment in a subprocess with:
  * a wall-clock timeout enforced here (the whole process group is killed),
  * CPU and memory limits applied inside the worker (RLIMIT_CPU / RLIMIT_AS / RSS watchdog),
  * a minimal environment (no inherited secrets, no proxies, single-threaded numerics), cwd = a private temp directory,
  * no URL access, no archive readers, no execution of uploaded content.
A worker failure never becomes a scientific record: previews turn it into a REJECTED preview, other requests into a refusal.
"""
# ruff: noqa: E501  (long human-readable diagnostics and separators)

from __future__ import annotations

import json
import os
import signal
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .config import Settings
from .contracts.experimental_spectra import PREVIEW_SCHEMA
from .errors import ExperimentalSpectrumWorkerUnavailable
from .scientific.engines.registry import configured_path

# Must equal chemdft_spectra_worker.WORKER_VERSION / PARSER_VERSION (asserted by tests).
WORKER_VERSION = "chemdft.spectra-worker/1.0.0"
PARSER_NAME = "chemdft-spectra-text"
PARSER_VERSION = "1.0.0"
SCHEMA_VERSION = "1.0.0"
MAX_DOCUMENT_BYTES = 48 * 1024 * 1024
MAX_ARRAYS_BYTES = 16 * 1024 * 1024
RESOURCE_EXIT_CODE = 97


@dataclass(frozen=True)
class RunnerOutcome:
    document: dict | None
    arrays: bytes | None = None
    aux: bytes | None = None
    failure: str | None = None  # timeout | memory | cpu | crash | invalid-output
    detail: str | None = None


SpectraRunner = Callable[..., RunnerOutcome]


def rejected_preview_body(technique: str, source_sha256: str, size_bytes: int, code: str, message: str) -> dict:
    """The preview an unreachable or failed worker is turned into. Same shape as the worker's own REJECTED body (hash it with `body_sha256`)."""
    return {
        "schema": PREVIEW_SCHEMA,
        "schema_version": SCHEMA_VERSION,
        "worker_version": WORKER_VERSION,
        "technique": technique,
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "source": {
            "sha256": source_sha256,
            "size_bytes": size_bytes,
            "encoding": None,
            "newline": None,
            "delimiter": None,
            "decimal": None,
            "orientation": None,
            "first_data_line": None,
            "last_data_line": None,
            "header_line_count": 0,
        },
        "status": "REJECTED",
        "needs": [],
        "columns": [],
        "choice": None,
        "x": None,
        "y": None,
        "y_error": None,
        "proposals": {"x": None, "y": None},
        "point_count": 0,
        "display": None,
        "arrays": None,
        "metadata_verbatim": [],
        "acquisition": {},
        "instrument": {"status": "NOT_SUPPLIED", "value": None, "as_written": None, "line": None, "file_reported": None},
        "sample": {"status": "NOT_SUPPLIED", "value": None, "as_written": None, "line": None, "file_reported": None},
        "display_name": None,
        "diagnostics": [{"code": code, "severity": "error", "message": message, "line": None}],
    }


def _minimal_environment(source_dir: Path) -> dict[str, str]:
    return {
        "PATH": os.defpath,
        "PYTHONNOUSERSITE": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONPATH": str(source_dir),
        "OMP_NUM_THREADS": "1",
        "OPENBLAS_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
        "VECLIB_MAXIMUM_THREADS": "1",
    }


def run_spectra_worker(
    command: str,
    request: dict,
    settings: Settings,
    *,
    source_path: Path | None = None,
    arrays_in: bytes | None = None,
    want_arrays: bool = False,
    want_aux: bool = False,
) -> RunnerOutcome:
    interpreter = configured_path(settings.spectra_worker_python)
    source_dir = configured_path(settings.spectra_worker_source)
    if not interpreter.is_file() or not source_dir.is_dir():
        raise ExperimentalSpectrumWorkerUnavailable()
    with tempfile.TemporaryDirectory(prefix="chemdft-spectra-run-") as tmp:
        work = Path(tmp)
        request_path, output_path = work / "request.json", work / "result.json"
        arrays_in_path, arrays_out_path, aux_out_path = work / "in.f64", work / "out.f64", work / "aux.f64"
        request_path.write_text(json.dumps(request, sort_keys=True, allow_nan=False))
        args = [str(interpreter), "-s", "-m", "chemdft_spectra_worker.cli", command, "--request", str(request_path), "--output", str(output_path)]
        if source_path is not None:
            args += ["--input", str(source_path)]
        if arrays_in is not None:
            arrays_in_path.write_bytes(arrays_in)
            args += ["--arrays-in", str(arrays_in_path)]
        if want_arrays:
            args += ["--arrays-out", str(arrays_out_path)]
        if want_aux:
            args += ["--aux-out", str(aux_out_path)]
        args += ["--cpu-seconds", str(settings.spectra_cpu_seconds), "--memory-bytes", str(settings.spectra_memory_bytes)]
        stderr_path = work / "stderr.log"
        with stderr_path.open("wb") as stderr:
            process = subprocess.Popen(
                args,
                cwd=work,
                env=_minimal_environment(source_dir),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=stderr,
                start_new_session=True,
            )
            try:
                process.wait(timeout=settings.spectra_wall_seconds)
            except subprocess.TimeoutExpired:
                _kill_group(process)
                return RunnerOutcome(None, failure="timeout", detail=f"The spectra worker exceeded the {settings.spectra_wall_seconds}-second wall-clock limit and was stopped.")
        if process.returncode != 0 or not output_path.is_file():
            tail = stderr_path.read_bytes()[-400:].decode("utf-8", "replace")
            if process.returncode == RESOURCE_EXIT_CODE or "MEMORY_LIMIT" in tail:
                return RunnerOutcome(None, failure="memory", detail="The spectra worker exceeded its memory limit and was stopped.")
            if process.returncode in (-signal.SIGXCPU, -signal.SIGKILL, 128 + signal.SIGXCPU):
                return RunnerOutcome(None, failure="cpu", detail="The spectra worker exceeded its CPU limit and was stopped.")
            return RunnerOutcome(None, failure="crash", detail=f"The spectra worker ended unexpectedly (exit {process.returncode}): {tail.strip()[-200:]}")
        data = output_path.read_bytes()
        if len(data) > MAX_DOCUMENT_BYTES:
            return RunnerOutcome(None, failure="invalid-output", detail="The worker result is too large.")
        try:
            document = json.loads(data)
            if not isinstance(document, dict):
                raise ValueError("the worker result is not an object")
        except ValueError as error:
            return RunnerOutcome(None, failure="invalid-output", detail=f"The worker produced an invalid result: {error}")
        arrays = _read_limited(arrays_out_path) if want_arrays else None
        aux = _read_limited(aux_out_path) if want_aux else None
        if (want_arrays and arrays is None and "error" not in document and document.get("has_arrays", True)) or (arrays is not None and len(arrays) > MAX_ARRAYS_BYTES):
            return RunnerOutcome(None, failure="invalid-output", detail="The worker arrays are missing or too large.")
        return RunnerOutcome(document, arrays, aux)


def _read_limited(path: Path) -> bytes | None:
    if not path.is_file():
        return None
    size = path.stat().st_size
    if size > MAX_ARRAYS_BYTES + 1:
        return b"\x00" * (MAX_ARRAYS_BYTES + 1)
    return path.read_bytes()


def _kill_group(process: subprocess.Popen) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        process.kill()
    process.wait()
