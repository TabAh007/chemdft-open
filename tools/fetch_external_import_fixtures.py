#!/usr/bin/env python3
"""Fetch the third-party Gaussian/ORCA outputs used by the External Import corpus tests.

The files are NOT redistributed in this repository (vendor terms for proprietary-engine output text were not audited). Each entry in
services/api/tests/external_import_fixtures_manifest.json pins an immutable upstream commit URL and the expected SHA-256; a file whose
hash differs is deleted and reported. Upstream sources: patonlab/GoodVibes (MIT) and cclib/cclib `data/` (BSD-3-Clause).

  python tools/fetch_external_import_fixtures.py            # download missing files into .chemdft/external-fixtures
  python tools/fetch_external_import_fixtures.py --verify   # only verify SHA-256 of what is present
"""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "services/api/tests/external_import_fixtures_manifest.json"
DEFAULT_DEST = ROOT / ".chemdft/external-fixtures"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    manifest = json.loads(MANIFEST.read_text())["fixtures"]
    bad = missing = ok = 0
    for fixture_id, entry in manifest.items():
        if args.only and fixture_id not in args.only:
            continue
        name = entry["upstream_url"].rsplit("/", 1)[-1]
        target = args.dest / fixture_id / name
        if not target.exists():
            if args.verify:
                missing += 1
                print(f"MISSING  {fixture_id}")
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(entry["upstream_url"], timeout=120) as response:
                target.write_bytes(response.read())
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest != entry["output_sha256"]:
            bad += 1
            print(f"MISMATCH {fixture_id}: {digest} != {entry['output_sha256']}")
            if not args.verify:
                target.unlink()
        else:
            ok += 1
    print(f"{ok} verified, {bad} mismatched, {missing} missing")
    return 1 if bad or missing else 0


if __name__ == "__main__":
    sys.exit(main())
