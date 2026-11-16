#!/usr/bin/env python3
"""Seed a clearly synthetic saved DECIMER proposal in a guarded disposable stack.

Neural inference is skipped. RDKit parsing, validation, embedding, review, promotion,
and all HTTP actions in the browser acceptance are real and unpatched.
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/api/src"))


def main() -> None:
    from chemdft_api.config import get_settings
    from chemdft_api.test_environment import TestEnvironmentError, validate_test_process

    if os.environ.get("CHEMDFT_TEST_MODE") != "1":
        raise TestEnvironmentError("TEST_MODE_MISSING")
    validate_test_process(get_settings(), ROOT)
    from chemdft_api.database import SessionLocal
    from chemdft_api.main import app
    from chemdft_api.scientific_models import CandidateRepresentationRecord
    from fastapi.testclient import TestClient
    from rdkit import Chem
    from rdkit.Chem import AllChem

    data = json.load(sys.stdin)
    project = data["project_id"]
    smiles = data.get("smiles", "CCO")
    with TestClient(app) as client:
        pdf = (ROOT / "apps/web/tests/fixtures/b2-ethanol-diagram.pdf").read_bytes()
        uploaded = client.post(
            f"/v1/projects/{project}/documents/imports",
            files={"upload": ("Synthetic saved proposal.pdf", pdf, "application/pdf")},
        )
        uploaded.raise_for_status()
        document = uploaded.json()["document"]["id"]
        extracted = client.post(f"/v1/projects/{project}/documents/{document}/figures/extract")
        extracted.raise_for_status()
        candidate = extracted.json()["candidates"][0]
        molecule = Chem.MolFromSmiles(smiles)
        if molecule is None:
            raise ValueError("Synthetic proposal SMILES must parse")
        AllChem.Compute2DCoords(molecule)
        molecule.SetProp("_Name", "")  # Exercise the blank MOL title line.
        mol = Chem.MolToMolBlock(molecule)
        validated = client.post(
            f"/v1/projects/{project}/structure-candidates/{candidate['id']}/validate-graph",
            json={"content": smiles, "format": "SMILES"},
        )
        validated.raise_for_status()
        graph = validated.json()
        user = client.get("/v1/me").json()["id"]
        # Existing saved synthetic predictions are allowed; never claim neural inference occurred.
        proposal = {
            "status": "MANUAL_REVIEW_REQUIRED",
            "recognition_engine": "DECIMER-Image_Transformer",
            "engine_version": "synthetic-saved-fixture-no-inference",
            "raw_model_output": smiles,
            "proposed_smiles": smiles,
            "canonical_isomeric_smiles": smiles,
            "formula": graph["formula"],
            "formal_charge": graph["formal_charge"],
            "heavy_atom_count": graph["heavy_atom_count"],
            "elements": graph["elements"],
            "has_stereochemistry": graph["has_stereochemistry"],
            "confidence": None,
            "validation_warnings": [
                "SYNTHETIC SAVED PROPOSAL — neural inference was not run.",
                *graph["validation_warnings"],
            ],
            "diagnostics": [],
            "unresolved_ambiguities": [],
            "figure_region": [0, 0, 1, 1],
            "source_page_number": 1,
            "source_figure_number": "1",
            "runtime_ms": 0,
            "is_scientifically_verified": False,
        }
        session = SessionLocal()
        try:
            common = dict(
                project_id=project,
                candidate_id=candidate["id"],
                representation_origin="IMAGE_RECONSTRUCTION",
                provenance_class=candidate["provenance_class"],
                method="synthetic.saved-decimer-fixture",
                method_version="test",
                approximation="UNVERIFIED_PROPOSAL",
                validation_state="PARSEABLE",
                created_by=user,
            )
            original = CandidateRepresentationRecord(
                **common, revision=2, representation_type="SMILES", payload_json=proposal
            )
            session.add(original)
            session.flush()
            drawing = CandidateRepresentationRecord(
                **common,
                revision=3,
                representation_type="MOL_BLOCK",
                payload_json={"mol_block": mol},
                source_representation_id=original.id,
            )
            session.add(drawing)
            session.commit()
            print(
                json.dumps(
                    {
                        "candidate_id": candidate["id"],
                        "original_id": original.id,
                        "drawing_id": drawing.id,
                        "mol_block": mol,
                    }
                )
            )
        finally:
            session.close()


if __name__ == "__main__":
    main()
