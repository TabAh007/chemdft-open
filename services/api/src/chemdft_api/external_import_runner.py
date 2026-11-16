"""Run the isolated import worker (services/import-worker) on one uploaded file.

The API never imports cclib. The worker runs in its own virtual environment in a subprocess with:
  * a wall-clock timeout enforced here (the whole process group is killed),
  * CPU and memory limits applied inside the worker (RLIMIT_CPU / RLIMIT_AS / RSS watchdog),
  * a minimal environment (no inherited secrets, no proxies), cwd = a private temp directory,
  * no URL access and no archive readers (enforced and instrumented inside the worker).
Any worker failure becomes a REJECTED report; a failure can never become a scientific record.
"""
# ruff: noqa: E501  (long human-readable diagnostics and separators)

from __future__ import annotations

import hashlib
import json
import os
import signal
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .config import Settings
from .contracts.external_import import body_sha256
from .errors import ExternalImportWorkerUnavailable
from .scientific.engines.registry import configured_path

# Must equal chemdft_import_worker.PARSER_INFO / IMPORTER_VERSION (asserted by tests).
IMPORTER_VERSION = "chemdft.external-import/1.0.0"
NORMALIZATION_VERSION = "chemdft.import.units/1.0.0"
PARSER_INFO = {
    "name": "cclib",
    "version": "1.8.1.post1278+b1364ecf",
    "commit": "b1364ecf5ac21042c5a37ed5446771217e0431ea",
    "wheel_sha256": "ea74d47a5ffe35f563475e51ee5c471189e0eadf5ee51bb647e29efca544eab5",
}
MAX_REPORT_BYTES = 48 * 1024 * 1024
RESOURCE_EXIT_CODE = 97


@dataclass(frozen=True)
class WorkerOutcome:
    report: dict
    worker: dict


ImportRunner = Callable[[Path, Settings], WorkerOutcome]


def sanitize_filename(name: str | None) -> str:
    """Display-only: basename, no control characters, restricted alphabet, bounded length. Never used for paths or detection."""
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = "".join(
        ch if (ch.isalnum() or ch in "._+-() ") else "_" for ch in base if ch.isprintable()
    )
    cleaned = cleaned.strip(" .") or "output"
    return cleaned[:120]


def rejected_report(source_sha256: str, size_bytes: int, code: str, message: str) -> dict:
    body = {
        "importer_version": IMPORTER_VERSION,
        "normalization_version": NORMALIZATION_VERSION,
        "parser": dict(PARSER_INFO),
        "source": {"sha256": source_sha256, "size_bytes": size_bytes},
        "status": "REJECTED",
        "program": {"engine": None, "version": None, "label": None},
        "job": None,
        "jobs": [],
        "items": [
            {
                "id": f"reject-{code}",
                "state": "REJECTED",
                "title": code.replace("_", " ").capitalize(),
                "detail": message,
                "result_type": None,
            }
        ],
        "results": [],
        "diagnostics": [{"code": code, "severity": "reject", "message": message, "line": None}],
        "cclib": None,
    }
    return {
        "schema": "chemdft.external-import.preview",
        "schema_version": "1.0.0",
        "body": body,
        "preview_sha256": body_sha256(body),
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
    }


def run_import_worker(input_path: Path, settings: Settings) -> WorkerOutcome:
    interpreter = configured_path(settings.import_worker_python)
    source_dir = configured_path(settings.import_worker_source)
    raw_size = input_path.stat().st_size
    digest = hashlib.sha256()
    with input_path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    source_sha256 = digest.hexdigest()
    if not interpreter.is_file() or not source_dir.is_dir():
        raise ExternalImportWorkerUnavailable()
    with tempfile.TemporaryDirectory(prefix="chemdft-import-run-") as tmp:
        work = Path(tmp)
        output_path = work / "report.json"
        stderr_path = work / "stderr.log"
        with stderr_path.open("wb") as stderr:
            process = subprocess.Popen(
                [
                    str(interpreter),
                    "-s",  # no user site-packages; NOT -I, which would also drop PYTHONPATH (the worker source dir)
                    "-m",
                    "chemdft_import_worker.cli",
                    "--input",
                    str(input_path),
                    "--output",
                    str(output_path),
                    "--cpu-seconds",
                    str(settings.import_parse_cpu_seconds),
                    "--memory-bytes",
                    str(settings.import_parse_memory_bytes),
                ],
                cwd=work,
                env=_minimal_environment(source_dir),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=stderr,
                start_new_session=True,
            )
            try:
                process.wait(timeout=settings.import_parse_wall_seconds)
            except subprocess.TimeoutExpired:
                _kill_group(process)
                return WorkerOutcome(
                    rejected_report(
                        source_sha256,
                        raw_size,
                        "PARSE_TIMEOUT",
                        f"The parser exceeded the {settings.import_parse_wall_seconds}-second "
                        "wall-clock limit and was stopped.",
                    ),
                    {"failure": "timeout"},
                )
        if process.returncode != 0 or not output_path.is_file():
            tail = stderr_path.read_bytes()[-400:].decode("utf-8", "replace")
            if process.returncode == RESOURCE_EXIT_CODE or "MEMORY_LIMIT" in tail:
                return WorkerOutcome(
                    rejected_report(
                        source_sha256,
                        raw_size,
                        "PARSE_RESOURCE_LIMIT",
                        "The parser exceeded its memory limit and was stopped.",
                    ),
                    {"failure": "memory"},
                )
            if process.returncode in (-signal.SIGXCPU, -signal.SIGKILL, 128 + signal.SIGXCPU):
                return WorkerOutcome(
                    rejected_report(
                        source_sha256,
                        raw_size,
                        "PARSE_RESOURCE_LIMIT",
                        "The parser exceeded its CPU limit and was stopped.",
                    ),
                    {"failure": "cpu"},
                )
            return WorkerOutcome(
                rejected_report(
                    source_sha256,
                    raw_size,
                    "PARSER_CRASHED",
                    f"The parser process ended unexpectedly (exit {process.returncode}).",
                ),
                {"failure": "crash", "stderr_tail": tail},
            )
        data = output_path.read_bytes()
        if len(data) > MAX_REPORT_BYTES:
            return WorkerOutcome(
                rejected_report(
                    source_sha256,
                    raw_size,
                    "REPORT_TOO_LARGE",
                    "The parsed result is too large to import.",
                ),
                {"failure": "report-size"},
            )
        try:
            document = json.loads(data)
            report = document["report"]
            if body_sha256(report["body"]) != report["preview_sha256"]:
                raise ValueError("preview hash does not match its body")
            reported = report["body"]["source"]
            if reported["sha256"] != source_sha256 or reported["size_bytes"] != raw_size:
                raise ValueError("the worker reported a different source file")
        except (ValueError, KeyError, TypeError) as error:
            return WorkerOutcome(
                rejected_report(
                    source_sha256,
                    raw_size,
                    "WORKER_OUTPUT_INVALID",
                    f"The parser produced an invalid report: {error}",
                ),
                {"failure": "invalid-output"},
            )
        return WorkerOutcome(report, document.get("worker", {}))


def _kill_group(process: subprocess.Popen) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        process.kill()
    process.wait()
