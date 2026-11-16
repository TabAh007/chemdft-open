# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Isolated hosted CREST worker (runs inside the pinned AWS image, one container per job).

It calls the same `crest.execute_native` that the local runner uses, with the container's real
limits, and writes the normalized candidate to --result and every native evidence file to
`native/` beside it. The API side re-parses those bytes (`crest.parse_evidence`) before anything is
published; this worker's own result is never trusted on its own.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace

CALCULATION_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
NATIVE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,96}$")
# Limits that fit the container: 1 CPU, 4 GiB, 512 MiB /tmp tmpfs and a 20 MiB output directory.
LIMITS = SimpleNamespace(
    crest_max_scratch_bytes=256 * 1024 * 1024,
    crest_max_output_bytes=8 * 1024 * 1024,
    crest_max_retained_bytes=12 * 1024 * 1024,
    crest_min_free_bytes=64 * 1024 * 1024,
    crest_timeout_seconds=3600,
)


def run(
    input_path: Path, result_path: Path, log_path: Path, executable: Path, *, calculation_id: str
) -> int:
    from chemdft_api.scientific.engines.crest import execute_native

    # The Result Firewall binds invocation.json to the real calculation id. Never fall back to
    # another id (hosted job 79e6c6ae was rejected for writing the structure version id).
    if not CALCULATION_ID.fullmatch(calculation_id or ""):
        raise ValueError("a valid --calculation-id is required")
    document = json.loads(input_path.read_text())
    outcome = execute_native(
        document,
        executable,
        LIMITS,
        calculation_id=calculation_id,
        workdir=Path("/tmp/crest-run"),
    )
    native_dir = result_path.parent / "native"
    native_dir.mkdir(parents=True, exist_ok=True)
    for name, data in sorted(outcome.native_artifacts.items()):
        if NATIVE_NAME.fullmatch(name) and name != "engine.log":
            (native_dir / name).write_bytes(data)
    stdout = outcome.native_artifacts.get("stdout.txt", b"")
    stderr = outcome.native_artifacts.get("stderr.txt", b"")
    log_path.write_bytes(stdout + b"\nSTDERR\n" + stderr)
    if outcome.result_document is None:
        return 3
    result_path.write_text(json.dumps(outcome.result_document, allow_nan=False))
    return 0 if outcome.exit_code == 0 else 3


def main() -> int:
    parser = argparse.ArgumentParser(description="ChemDFT isolated CREST scientific worker")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--result", required=True, type=Path)
    parser.add_argument("--log", required=True, type=Path)
    parser.add_argument("--steps", type=Path)  # accepted for the common host command line; unused
    parser.add_argument("--crest-executable", required=True, type=Path)
    parser.add_argument("--calculation-id", required=True)
    args = parser.parse_args()
    try:
        return run(
            args.input, args.result, args.log, args.crest_executable,
            calculation_id=args.calculation_id,
        )
    except Exception as error:
        print(f"CREST worker failed: {error}", file=sys.stderr)
        args.log.write_text(f"CREST worker failed: {error}\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
