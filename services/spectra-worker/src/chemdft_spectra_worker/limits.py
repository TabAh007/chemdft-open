"""Resource limits for the spectra worker subprocess (same mechanism as the External Import worker).

* CPU: RLIMIT_CPU (soft + hard) works on Linux and macOS.
* Memory: RLIMIT_AS on Linux; macOS does not enforce it, so a watchdog thread also polls RSS and hard-exits
  (current RSS on Linux, where peak RSS is inherited across exec; peak RSS on macOS).
* Wall clock: enforced by the parent (process-group kill).
"""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import contextlib
import os
import resource
import sys
import threading
import time

DEFAULT_CPU_SECONDS = 60
DEFAULT_MEMORY_BYTES = 1024 * 1024 * 1024
RESOURCE_EXIT_CODE = 97  # worker exits with this code when its own watchdog trips


def apply_process_limits(cpu_seconds: int, memory_bytes: int) -> None:
    with contextlib.suppress(ValueError, OSError):
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 5))
    if sys.platform.startswith("linux"):
        with contextlib.suppress(ValueError, OSError):
            resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    with contextlib.suppress(ValueError, OSError):
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    threading.Thread(target=_memory_watchdog, args=(memory_bytes,), daemon=True).start()


def _watched_rss_bytes() -> int:
    """Resident memory of THIS process, as the watchdog compares it with the limit.

    On Linux, ru_maxrss survives fork+exec: a freshly started worker reports the
    peak RSS of the process that launched it, so a long-running API server with a
    peak above the limit made every job "exceed" it at start-up. Linux therefore
    reads the current resident set (RLIMIT_AS remains the hard cap there); macOS
    keeps peak RSS, which it reports per process and in bytes.
    """
    if sys.platform.startswith("linux"):
        try:
            with open("/proc/self/statm", "rb") as statm:
                resident_pages = int(statm.read().split()[1])
            return resident_pages * os.sysconf("SC_PAGE_SIZE")
        except (OSError, ValueError, IndexError):
            return 0
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak if sys.platform == "darwin" else peak * 1024  # macOS reports bytes, others kilobytes


def _memory_watchdog(limit_bytes: int) -> None:
    while True:
        if _watched_rss_bytes() > limit_bytes:
            os.write(2, b"SPECTRA_WORKER_MEMORY_LIMIT\n")
            os._exit(RESOURCE_EXIT_CODE)
        time.sleep(0.02)
