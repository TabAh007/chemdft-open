"""Worker entry point: `python -m chemdft_import_worker.cli --input <file> --output <json> --cpu-seconds N --memory-bytes N`."""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from . import limits


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--cpu-seconds", type=int, default=limits.DEFAULT_CPU_SECONDS)
    ap.add_argument("--memory-bytes", type=int, default=limits.DEFAULT_MEMORY_BYTES)
    args = ap.parse_args(argv)
    limits.apply_process_limits(args.cpu_seconds, args.memory_bytes)
    started = time.monotonic()
    raw = args.input.read_bytes()
    from .pipeline import analyze
    from .report import canonical_json

    report = analyze(raw)
    args.output.write_bytes(canonical_json({"report": report, "worker": {"elapsed_seconds": round(time.monotonic() - started, 3)}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
