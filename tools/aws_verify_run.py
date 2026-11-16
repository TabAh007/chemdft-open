#!/usr/bin/env python3
"""Independently re-verify one AWS run's evidence from S3 (read-only; never starts anything).

    .venv/bin/python tools/aws_verify_run.py <run id | aws:<run id>>

Downloads status.json, receipt.json and the listed files through the same strict, allow-listed AWS
CLI wrapper the provider uses, recomputes every SHA-256, and prints what the real engine reported
(engine, version, platform, converged, total energy). Needs the CHEMDFT_AWS_* settings.
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from pathlib import Path

from chemdft_api.aws_compute import JOB_FILES, AwsCli, AwsProviderError
from chemdft_api.config import get_settings


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    run_id = sys.argv[1].removeprefix("aws:")
    cli = AwsCli(get_settings())
    prefix = f"pilot/chemdft-jobs/{run_id}"
    ok = True
    with tempfile.TemporaryDirectory(prefix="chemdft-verify-") as directory:
        work = Path(directory)
        try:
            cli.verify_identity()
            for name in ("status.json", "receipt.json"):
                if not cli.get(f"{prefix}/{name}", work / name):
                    raise SystemExit(f"FAIL: {name} not found for run {run_id}")
            status = json.loads((work / "status.json").read_text())
            receipt = json.loads((work / "receipt.json").read_text())
            digest = hashlib.sha256((work / "status.json").read_bytes()).hexdigest()
            print(f"status.json matches receipt: {digest == receipt['status_sha256']}")
            ok &= digest == receipt["status_sha256"]
            print(
                f"host state: {status['state']} exit={status['exit_code']} native_log={status['native_log']}"
            )
            known = {"in__input.json", *JOB_FILES.values()}
            for relative, info in status["files"].items():
                name = relative.replace("/", "__")
                if name not in known:
                    continue
                if not cli.get(f"{prefix}/{name}", work / name):
                    print(f"MISSING {relative}")
                    ok = False
                    continue
                data = (work / name).read_bytes()
                same = (
                    hashlib.sha256(data).hexdigest() == info["sha256"]
                    and len(data) == info["bytes"]
                )
                print(f"{relative}: sha256 {'OK' if same else 'MISMATCH'}")
                ok &= same
            if ok and (work / "out__result.json").exists():
                result = json.loads((work / "out__result.json").read_text())
                env = result.get("environment", {})
                print(
                    f"engine={result.get('engine')} {result.get('engine_version')} "
                    f"platform={env.get('platform')} arch={env.get('architecture')} "
                    f"converged={result.get('converged')} "
                    f"total_energy_hartree={result.get('total_energy_hartree')!r}"
                )
        except AwsProviderError as error:
            print(f"FAIL: {error}")
            return 1
    print("VERIFIED" if ok else "NOT VERIFIED")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
