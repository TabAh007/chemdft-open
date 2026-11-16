#!/usr/bin/env python3
"""Build / verify the pinned cclib wheel used by services/import-worker.

The wheel is a build of cclib commit b1364ecf5ac21042c5a37ed5446771217e0431ea (1.8.1.post1278). PyPI cclib 1.8.1 cannot parse ORCA 6.x, and
nothing may be installed from GitHub at runtime, so the wheel is committed and locked by SHA-256 (services/import-worker/uv.lock).

Wheel BYTES are not reproducible across builds (timestamps), but the CONTENT DIGEST below (SHA-256 over sorted (path, file-sha256) of every
member except RECORD) is. `verify` rebuilds from the pinned commit and compares content digests with the committed wheel.

  python tools/build_cclib_wheel.py verify [--source <existing cclib checkout>]
  python tools/build_cclib_wheel.py digest <wheel>
"""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

COMMIT = "b1364ecf5ac21042c5a37ed5446771217e0431ea"
WHEEL = Path(__file__).resolve().parents[1] / "services/import-worker/wheels/cclib-1.8.1.post1278+b1364ecf-py3-none-any.whl"
EXPECTED_CONTENT_DIGEST = "9762a1ebd08d313ef46f94d229ca9ee05adcfd7ea8de80984a23ad5b4a256361"
EXPECTED_WHEEL_SHA256 = "ea74d47a5ffe35f563475e51ee5c471189e0eadf5ee51bb647e29efca544eab5"


def content_digest(path: Path) -> str:
    archive = zipfile.ZipFile(path)
    items = [(name, hashlib.sha256(archive.read(name)).hexdigest()) for name in sorted(archive.namelist()) if not name.endswith("/RECORD")]
    return hashlib.sha256("\n".join(f"{n} {h}" for n, h in items).encode()).hexdigest()


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(source: Path, out: Path) -> Path:
    subprocess.run(["uv", "build", "--wheel", "--out-dir", str(out)], cwd=source, check=True)
    return next(out.glob("*.whl"))


def verify(source: Path | None) -> int:
    ok = True
    sha = file_sha256(WHEEL)
    print(f"committed wheel sha256   {sha}  {'OK' if sha == EXPECTED_WHEEL_SHA256 else 'MISMATCH'}")
    ok &= sha == EXPECTED_WHEEL_SHA256
    digest = content_digest(WHEEL)
    print(f"committed content digest {digest}  {'OK' if digest == EXPECTED_CONTENT_DIGEST else 'MISMATCH'}")
    ok &= digest == EXPECTED_CONTENT_DIGEST
    with tempfile.TemporaryDirectory() as tmp:
        checkout = source
        if checkout is None:
            checkout = Path(tmp) / "cclib"
            subprocess.run(["git", "clone", "-q", "https://github.com/cclib/cclib.git", str(checkout)], check=True)
        subprocess.run(["git", "checkout", "-q", COMMIT], cwd=checkout, check=True)
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=checkout, check=True, capture_output=True, text=True).stdout.strip()
        assert head == COMMIT, head
        rebuilt = build(checkout, Path(tmp) / "dist")
        rebuilt_digest = content_digest(rebuilt)
        print(f"rebuilt  content digest  {rebuilt_digest}  {'OK (matches committed wheel)' if rebuilt_digest == digest else 'MISMATCH'}")
        ok &= rebuilt_digest == digest
    return 0 if ok else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("verify")
    v.add_argument("--source", type=Path)
    d = sub.add_parser("digest")
    d.add_argument("wheel", type=Path)
    args = parser.parse_args()
    if args.cmd == "digest":
        print(content_digest(args.wheel))
        sys.exit(0)
    sys.exit(verify(args.source))
