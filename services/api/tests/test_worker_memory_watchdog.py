"""Isolated-worker memory watchdogs must measure the worker, not the process that launched it.

On Linux, ``ru_maxrss`` survives fork+exec: a worker started by a long-running API process
reports that parent's peak RSS. With the old watchdog, a parent whose peak exceeded the
worker limit made every spectra/import job fail at start-up with "exceeded its memory limit"
(seen in full backend test runs, where the pytest process passes 1 GiB). These tests rebuild
that condition with a parent that touches more memory than the limit, then start a worker.
"""

from __future__ import annotations

import json
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
WATCHDOG_MODULES = {
    "spectra": ROOT / "services/spectra-worker/src/chemdft_spectra_worker/limits.py",
    "import": ROOT / "services/import-worker/src/chemdft_import_worker/limits.py",
}
LIMIT_BYTES = 1024 * 1024 * 1024
PARENT_BYTES = 1280 * 1024 * 1024

pytestmark = pytest.mark.skipif(
    not sys.platform.startswith("linux"), reason="ru_maxrss inheritance across exec is Linux behaviour"
)

# The parent touches PARENT_BYTES (so they are resident), then runs CHILD and relays its stdout.
PARENT = textwrap.dedent(
    """
    import subprocess, sys
    blob = b"\\x01" * int(sys.argv[1])
    result = subprocess.run(sys.argv[2:], capture_output=True, text=True)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    sys.exit(result.returncode)
    """
)

CHILD = textwrap.dedent(
    """
    import importlib.util, json, resource, sys
    spec = importlib.util.spec_from_file_location("limits", sys.argv[1])
    limits = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(limits)
    print(json.dumps({
        "inherited_peak": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
        "watched": limits._watched_rss_bytes(),
    }))
    """
)


def _run_from_large_parent(*child_args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", PARENT, str(PARENT_BYTES), *child_args],
        capture_output=True,
        text=True,
        timeout=120,
    )


@pytest.mark.parametrize("worker", sorted(WATCHDOG_MODULES))
def test_watchdog_ignores_the_launching_process_peak(worker):
    result = _run_from_large_parent(sys.executable, "-c", CHILD, str(WATCHDOG_MODULES[worker]))
    assert result.returncode == 0, result.stderr
    measured = json.loads(result.stdout)
    # The condition is real: the fresh child inherits a peak above the limit ...
    assert measured["inherited_peak"] > LIMIT_BYTES
    # ... but the watchdog measures the child itself.
    assert 0 < measured["watched"] < LIMIT_BYTES // 2


def test_spectra_worker_runs_when_its_launcher_peaked_above_the_limit(tmp_path):
    interpreter = ROOT / "services/spectra-worker/.venv/bin/python"
    if not interpreter.is_file():
        pytest.skip("spectra worker environment is not installed")
    source = tmp_path / "spectrum.csv"
    source.write_text("x,y\n1000,0.1\n1100,0.5\n1200,0.2\n")
    request, output = tmp_path / "request.json", tmp_path / "result.json"
    request.write_text("{}")
    result = _run_from_large_parent(
        "/usr/bin/env",
        "-i",
        "PATH=/usr/bin:/bin",
        f"PYTHONPATH={ROOT / 'services/spectra-worker/src'}",
        "OPENBLAS_NUM_THREADS=1",
        "OMP_NUM_THREADS=1",
        str(interpreter),
        "-s",
        "-m",
        "chemdft_spectra_worker.cli",
        "resolve",
        "--input",
        str(source),
        "--request",
        str(request),
        "--output",
        str(output),
        "--cpu-seconds",
        "60",
        "--memory-bytes",
        str(LIMIT_BYTES),
    )
    assert "MEMORY_LIMIT" not in result.stderr
    assert result.returncode == 0, result.stderr[-400:]
    assert output.is_file()
