#!/usr/bin/env python3
"""Seed a clearly labelled COMPARE TEST FIXTURE project into a DISPOSABLE evidence stack.

Used only to look at the Compare workstation's plots and verdicts with a NONZERO difference, which the accepted
evidence does not contain. Run it against the stack started by tools/rw2_evidence_stack.py:

    .venv/bin/python tools/compare_fixture_seed.py --api-url http://127.0.0.1:8191 \
        --database /tmp/chemdft-rw2-evidence-XXXX/data/evidence.db --out output/compare-fixture.json

Everything is test-only and deterministic. The payloads and specifications are the accepted PySCF HF/STO-3G water
record from services/api/tests/fixtures/rw2_evidence.json; the ONLY invented numbers are the total-energy offsets listed
in FIXTURE_OFFSETS_EH, applied to copies of that record so the server's own comparison evaluator produces nonzero deltas.
These results are not ChemDFT scientific results; the project and the structure say so in their names. The script refuses
to write anywhere except an /tmp/chemdft-rw2-evidence-* database.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/api/src"))
sys.path.insert(0, str(ROOT / "services/api/tests"))

import httpx  # noqa: E402
import rw2_support as support  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

#: Test-only offsets (hartree) added to the copied accepted energy. Labelled; never presented as science.
FIXTURE_OFFSETS_EH = {"directly_comparable": 0.0123456, "with_limitations": 0.0000345, "incompatible_other_level": -0.5}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    database = Path(args.database).resolve()
    if not (str(database).startswith("/private/tmp/chemdft-rw2-evidence-") or str(database).startswith("/tmp/chemdft-rw2-evidence-")):
        raise SystemExit("REFUSED: the fixture is only ever written to a disposable /tmp/chemdft-rw2-evidence-* copy")
    if not args.api_url.rstrip("/").endswith(("8191", "8192", "8193")):
        raise SystemExit("REFUSED: use the disposable stack's API port")

    sessions = sessionmaker(create_engine(f"sqlite:///{database}"))
    energy = support.EVIDENCE["energy"]["payload"]["total_energy"]
    reference_value = energy["value"]

    def payload(offset: float, **extra):
        return {"total_energy": {**energy, "value": reference_value + offset}, **extra}

    with httpx.Client(base_url=args.api_url, timeout=60) as client:
        project = support.create_project(client, "COMPARE TEST FIXTURE (deterministic test values, not scientific results)")
        version = support.import_structure(client, project, name="FIXTURE water (test values, not scientific evidence)")
    ids = {
        "reference": support.seed_result(sessions, project, version, "energy")[1],
        "directly_comparable": support.seed_result(sessions, project, version, "energy", payload=payload(FIXTURE_OFFSETS_EH["directly_comparable"]))[1],
        "with_limitations": support.seed_result(
            sessions, project, version, "energy", payload=payload(FIXTURE_OFFSETS_EH["with_limitations"]), producer={"version": "fixture-9.9"}
        )[1],
        "incompatible_other_level": support.seed_result(
            sessions, project, version, "energy", payload=payload(FIXTURE_OFFSETS_EH["incompatible_other_level"], method="b3lyp", basis="def2-svp"),
            spec={"method": {"display_name": "B3LYP", "identifier": "b3lyp", "registry": "chemdft.method", "registry_version": None},
                  "basis": {"display_name": "def2-SVP", "identifier": "def2-svp", "registry": "chemdft.basis", "registry_version": None}},
        )[1],
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"project_id": project, "results": ids, "offsets_eh": FIXTURE_OFFSETS_EH, "reference_value_eh": reference_value}, indent=2))
    print(f"COMPARE_FIXTURE_READY project={project} -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
