"""Rebuild preserved Gate A.1 source in a NEW directory; never install/replace the accepted binary.

Requires the persistent reproduction bundle and its existing pinned isolated toolchain.
A new binary must pass scientific acceptance and receive a separately reviewed digest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_SCRATCH = "/private/tmp/chemdft-pf8c-gate-a1-dk6614q5"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", required=True, type=Path)
    parser.add_argument(
        "--reproduction",
        type=Path,
        default=ROOT / ".chemdft/engines/crest-3.0.2-ewinfix-a1/reproduction",
    )
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    destination = args.destination.resolve()
    source = args.reproduction.resolve()
    if destination.exists():
        parser.error("Destination must be new; existing builds are never overwritten.")
    records = json.loads((source / "source-final-manifest.json").read_text())
    for record in records:
        path = source / "source" / record["path"]
        if "sha256" in record:
            with path.open("rb") as f:
                actual = hashlib.file_digest(f, "sha256").hexdigest()
            if actual != record["sha256"]:
                raise ValueError(f"Source digest mismatch: {record['path']}")
    # The prepared source already includes the documented common packaging patch and EWIN patch.
    shutil.copytree(source / "source", destination / "source")
    configure = json.loads((source / "build-evidence/configure/invocation.json").read_text())
    build = json.loads(
        (source / "build-evidence/build-negative-control/invocation.json").read_text()
    )

    def relocate(text):
        return text.replace(ORIGINAL_SCRATCH, str(destination))

    environment = {k: relocate(v) for k, v in configure["environment"].items()}
    environment["HOME"] = str(destination)
    environment["TMPDIR"] = str(destination)
    commands = [[relocate(x) for x in record["argv"]] for record in (configure, build)]
    (destination / "rebuild-plan.json").write_text(
        json.dumps(
            {
                "commands": commands,
                "environment": environment,
                "source_manifest": str(source / "source-final-manifest.json"),
                "never_install": True,
            },
            indent=2,
        )
        + "\n"
    )
    if args.prepare_only:
        print(destination / "rebuild-plan.json")
        return
    for index, argv in enumerate(commands):
        with (destination / f"build-{index}.log").open("wb") as log:
            subprocess.run(
                argv,
                cwd=destination,
                env=environment,
                stdout=log,
                stderr=subprocess.STDOUT,
                check=True,
                timeout=1200,
            )
    binary = destination / "build/crest"
    with binary.open("rb") as f:
        sha = hashlib.file_digest(f, "sha256").hexdigest()
    (destination / "rebuilt-binary.json").write_text(
        json.dumps({"path": str(binary), "sha256": sha, "accepted": False}, indent=2) + "\n"
    )
    print("Rebuilt candidate only; no installation or scientific acceptance:", binary)


if __name__ == "__main__":
    main()
