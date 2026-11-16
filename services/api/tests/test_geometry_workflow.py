from __future__ import annotations

import copy
from uuid import uuid4

import pytest
from chemdft_api.geometry_eligibility import require_calculation_geometry
from chemdft_api.scientific.adapters.molecular.rdkit_adapter import parse_mol
from chemdft_api.scientific.molecular_geometry import (
    GeometryValidationFailed,
    generate_conformer,
    validate_geometry,
)
from chemdft_api.scientific_models import (
    CalculationRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from chemdft_api.storage import LocalObjectStore
from rdkit import Chem
from rdkit.Chem import AllChem
from sqlalchemy import func, select
from test_calculation_engine import _specification
from test_structure_workspace import XYZ_WATER, _create_project, _import


def drawing(smiles="CCCCCC"):
    molecule = Chem.MolFromSmiles(smiles)
    AllChem.Compute2DCoords(molecule)
    return Chem.MolToMolBlock(molecule)


def generate(client, project, **extra):
    return client.post(
        f"/v1/projects/{project}/geometry-candidates",
        json={
            "mol_block": drawing(),
            "name": "n-Hexane",
            **extra,
        },
    )


def accept(client, project, candidate, **extra):
    return client.post(
        f"/v1/projects/{project}/geometry-candidates/{candidate['id']}/accept",
        json={
            "candidate_sha256": candidate["candidate_artifact"]["sha256"],
            "inspected_geometry": True,
            "understands_not_optimized": True,
            **extra,
        },
    )


def submission(project, version):
    return {
        "structure_version": {
            "project_id": project,
            "entity_type": "structure.version",
            "entity_id": version,
        },
        "specification": _specification().model_dump(mode="json"),
        "idempotency_key": f"geometry-test-{uuid4()}",
    }


@pytest.mark.parametrize(
    ("smiles", "formula", "total", "hydrogens"),
    [
        ("CCCCCC", "C6H14", 20, 14),
        ("CCO", "C2H6O", 9, 6),
        ("c1ccccc1", "C6H6", 12, 6),
        ("C1CCCCC1", "C6H12", 18, 12),
    ],
)
def test_real_etkdg_preserves_identity_and_expands_hydrogens(smiles, formula, total, hydrogens):
    mol = Chem.MolFromMolBlock(drawing(smiles), removeHs=False)
    generated = generate_conformer(mol, smiles)
    assert generated.formula == formula
    assert len(generated.coordinates.coordinates.atoms) == total
    assert generated.explicit_hydrogen_count == hydrogens
    assert generated.source_atom_indices[: mol.GetNumAtoms()] == tuple(range(mol.GetNumAtoms()))
    assert all(i is None for i in generated.source_atom_indices[mol.GetNumAtoms() :])
    assert generated.coordinates.coordinates.unit.value == "angstrom"
    assert generated.coordinates.overall_charge == 0
    assert generated.coordinates.multiplicity == 1
    repeated = generate_conformer(mol, smiles)
    assert repeated == generated


def test_hexane_candidate_requires_exact_explicit_acceptance_and_binds_lineage(api, monkeypatch):
    client, sessions, settings = api
    project = _create_project(client, "Drawing geometry")["id"]
    original = drawing()
    response = generate(client, project, mol_block=original)
    assert response.status_code == 201, response.text
    candidate = response.json()
    assert candidate["state"] == "PENDING_ACCEPTANCE"
    assert candidate["calculation_eligible"] is False
    assert candidate["manifest"]["formula"] == "C6H14"
    assert candidate["manifest"]["explicit_hydrogen_count"] == 14
    assert len(candidate["manifest"]["atom_mapping"]) == 20
    listed = client.get(f"/v1/projects/{project}/geometry-candidates")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()["candidates"]] == [candidate["id"]]
    assert client.get(f"/v1/projects/{project}/structures").json() == []
    source = client.get(f"/v1/projects/{project}/geometry-candidates/{candidate['id']}/drawing")
    assert source.content == original.encode()
    wrong = accept(client, project, candidate, candidate_sha256="0" * 64)
    assert wrong.status_code == 422 and "GEOMETRY_PREVIEW_MISMATCH" in wrong.text
    missing_review = accept(client, project, candidate, inspected_geometry=False)
    assert missing_review.status_code == 422
    assert (
        client.post(
            f"/v1/projects/{project}/calculations", json=submission(project, candidate["id"])
        ).status_code
        == 404
    )
    accepted = accept(client, project, candidate)
    assert accepted.status_code == 201, accepted.text
    body = accepted.json()
    version = body["version"]
    assert version["origin"] == "GENERATED"
    detail = client.get(
        f"/v1/projects/{project}/structures/{body['structure']['id']}/versions/{version['id']}"
    ).json()
    assert detail["provenance"]["geometry_candidate_id"] == candidate["id"]
    assert detail["provenance"]["candidate_sha256"] == candidate["candidate_artifact"]["sha256"]
    assert version["coordinates"]["structure_version_id"] == version["id"]
    assert len(version["coordinates"]["atoms"]) == 20
    assert len(version["coordinates"]["bonds"]) == 19
    assert body["calculation_eligibility"]["eligible"] is True
    repeated = accept(client, project, candidate)
    assert repeated.json()["version"]["id"] == version["id"]
    assert (
        client.get(f"/v1/projects/{project}/geometry-candidates/{candidate['id']}").json()["state"]
        == "ACCEPTED"
    )
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(StructureVersionRecord)) == 1
        record = session.get(StructureVersionRecord, version["id"])
        require_calculation_geometry(session, LocalObjectStore(settings.object_root), record)
        provenance = session.get(ProvenanceRecordRow, record.provenance_record_id)
        assert provenance.subject_id == record.id
        assert provenance.operation == "chemdft.geometry.accept"
        assert provenance.approximate is True
        assert provenance.producer_identifier == record.created_by
        inputs = session.scalars(
            select(ProvenanceInputRow).where(
                ProvenanceInputRow.provenance_record_id == provenance.id
            )
        ).all()
        assert {i.input_id for i in inputs} == {
            record.source_artifact_id,
            record.canonical_artifact_id,
            candidate["id"],
        }
    # Verify submission only; no scientific worker or energy values are mocked.
    monkeypatch.setattr("chemdft_api.calculation_actions.validate_capability", lambda *a: None)
    queued = client.post(
        f"/v1/projects/{project}/calculations", json=submission(project, version["id"])
    )
    assert queued.status_code == 201, queued.text
    assert queued.json()["calculation"]["state"] == "QUEUED"


def test_raw_2d_import_and_editor_save_are_blocked(api):
    client, _sessions, _settings = api
    project = _create_project(client)["id"]
    response = _import(client, project, "drawing.mol", drawing().encode(), "MOL")
    assert response.status_code == 422 and "GEOMETRY_2D_REQUIRES_GENERATION" in response.text
    imported = _import(client, project, "water.xyz", XYZ_WATER, "XYZ").json()
    edited = client.post(
        f"/v1/projects/{project}/structures/{imported['structure']['id']}/versions/imports",
        data={
            "file_format": "MOL",
            "parent_version_id": imported["version"]["id"],
            "idempotency_key": "unsafe-editor-save",
        },
        files={"upload": ("edit.mol", drawing().encode(), "chemical/x-mdl-molfile")},
    )
    assert edited.status_code == 422 and "GEOMETRY_2D_REQUIRES_GENERATION" in edited.text


def test_historical_2d_record_is_rejected_without_mutation(api, monkeypatch):
    client, sessions, _settings = api
    project = _create_project(client)["id"]
    # Reproduce the previous vulnerable importer only while creating this isolated fixture.
    with monkeypatch.context() as m:
        m.setattr(
            "chemdft_api.scientific.adapters.molecular.rdkit_adapter.require_computational_mol",
            lambda mol: None,
        )
        old = _import(client, project, "ketcher-new.mol", drawing().encode(), "MOL").json()
    before = copy.deepcopy(old)
    request = submission(project, old["version"]["id"])
    response = client.post(f"/v1/projects/{project}/calculations", json=request)
    assert response.status_code == 422 and "GEOMETRY_2D_REQUIRES_GENERATION" in response.text
    detail = client.get(
        f"/v1/projects/{project}/structures/{old['structure']['id']}/versions/{old['version']['id']}"
    ).json()
    assert detail["version"] == before["version"]
    eligibility = client.get(
        f"/v1/projects/{project}/structures/{old['structure']['id']}/versions/{old['version']['id']}/calculation-eligibility"
    ).json()
    assert eligibility["eligible"] is False
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(CalculationRecord)) == 0


def test_acceptance_creates_child_version_and_preserves_parent(api):
    client, sessions, _settings = api
    project = _create_project(client)["id"]
    original = _import(client, project, "water.xyz", XYZ_WATER, "XYZ").json()
    candidate = generate(
        client,
        project,
        mol_block=drawing("O"),
        name="Water conformer",
        parent_structure_version={
            "project_id": project,
            "entity_type": "structure.version",
            "entity_id": original["version"]["id"],
        },
    ).json()
    result = accept(client, project, candidate)
    assert result.status_code == 201, result.text
    assert result.json()["version"]["parent_version_id"] == original["version"]["id"]
    assert result.json()["version"]["revision"] == 2
    with sessions() as session:
        parent = session.get(StructureVersionRecord, original["version"]["id"])
        assert parent.origin == "IMPORTED" and parent.revision == 1


def test_planar_3d_metadata_is_accepted_without_planarity_heuristics(api):
    client, sessions, settings = api
    mol = Chem.AddHs(Chem.MolFromSmiles("c1ccccc1"))
    AllChem.Compute2DCoords(mol, bondLength=1.4)
    # Bonded H lengths from Compute2DCoords are schematic; use generated coordinates,
    # project benzene into its plane, and explicitly retain 3D coordinate metadata.
    AllChem.EmbedMolecule(mol, randomSeed=104729)
    conf = mol.GetConformer()
    import numpy as np

    positions = np.array(conf.GetPositions())
    center = positions.mean(axis=0)
    _, _, axes = np.linalg.svd(positions - center)
    planar = (positions - center) @ axes.T
    for i, point in enumerate(planar):
        conf.SetAtomPosition(i, (float(point[0]), float(point[1]), 0.0))
    conf.Set3D(True)
    block = Chem.MolToMolBlock(mol)
    assert parse_mol(block.encode()).coordinates["dimensionality"] == 3
    project = _create_project(client)["id"]
    result = _import(client, project, "planar-3d.mol", block.encode(), "MOL")
    assert result.status_code == 201, result.text
    with sessions() as session:
        require_calculation_geometry(
            session,
            LocalObjectStore(settings.object_root),
            session.get(StructureVersionRecord, result.json()["version"]["id"]),
        )


@pytest.mark.parametrize("smiles", ["[Na+]", "[CH3]", "C.C", "[Cu+2]"])
def test_unsupported_chemistry_fails_closed(api, smiles):
    client, _sessions, _settings = api
    project = _create_project(client)["id"]
    response = generate(client, project, mol_block=drawing(smiles))
    assert response.status_code == 422 and "GEOMETRY_UNSUPPORTED" in response.text
    assert client.get(f"/v1/projects/{project}/structures").json() == []


def test_invalid_graph_charge_multiplicity_and_degenerate_geometry(api):
    client, _sessions, _settings = api
    project = _create_project(client)["id"]
    for extra, code in [
        ({"mol_block": "not MOL"}, "GEOMETRY_INVALID_GRAPH"),
        ({"expected_charge": 1}, "GEOMETRY_CHARGE_MISMATCH"),
        ({"multiplicity": 2}, "GEOMETRY_MULTIPLICITY"),
    ]:
        response = generate(client, project, **extra)
        assert response.status_code == 422 and code in response.text
    generated = generate_conformer(Chem.MolFromSmiles("CCO"), "ethanol").coordinates
    payload = generated.model_dump(mode="json")
    payload["coordinates"]["atoms"][1].update(
        {axis: payload["coordinates"]["atoms"][0][axis] for axis in ("x", "y", "z")}
    )
    with pytest.raises(GeometryValidationFailed, match="GEOMETRY_DEGENERATE"):
        validate_geometry(type(generated).model_validate(payload))


def test_candidate_source_hash_tampering_and_project_isolation(api):
    client, sessions, settings = api
    project = _create_project(client)["id"]
    candidate = generate(client, project).json()
    other = _create_project(client)["id"]
    assert accept(client, other, candidate).status_code == 404
    with sessions() as session:
        source = session.get(
            ScientificArtifactRecord, candidate["manifest"]["source_drawing"]["artifact_id"]
        )
        (settings.object_root / source.storage_key).write_bytes(b"changed")
    response = accept(client, project, candidate)
    assert response.status_code == 422 and "GEOMETRY_ARTIFACT_CHANGED" in response.text


@pytest.mark.parametrize("fault", ["nonfinite", "long_bond"])
def test_invalid_coordinate_values_are_rejected(fault):
    representation = generate_conformer(Chem.MolFromSmiles("CCO"), "ethanol").coordinates
    payload = representation.model_dump(mode="json")
    payload["coordinates"]["atoms"][0]["x"] = float("nan") if fault == "nonfinite" else 1000.0
    # Copy without revalidation to exercise the scientific check independently of Pydantic.
    atoms = list(representation.coordinates.atoms)
    atoms[0] = atoms[0].model_copy(update=payload["coordinates"]["atoms"][0])
    coordinates = representation.coordinates.model_copy(update={"atoms": tuple(atoms)})
    invalid = representation.model_copy(update={"coordinates": coordinates})
    code = "GEOMETRY_INVALID_COORDINATES" if fault == "nonfinite" else "GEOMETRY_BOND_DISTANCE"
    with pytest.raises(GeometryValidationFailed, match=code):
        validate_geometry(invalid)


def test_embedding_failure_does_not_create_candidate(api, monkeypatch):
    client, sessions, _settings = api
    project = _create_project(client)["id"]
    monkeypatch.setattr(
        "chemdft_api.scientific.molecular_geometry.AllChem.EmbedMolecule", lambda *args: -1
    )
    response = generate(client, project)
    assert response.status_code == 422 and "GEOMETRY_GENERATION_FAILED" in response.text
    assert client.get(f"/v1/projects/{project}/geometry-candidates").json()["candidates"] == []
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(StructureVersionRecord)) == 0


def test_backend_rejects_degenerate_explicit_xyz_before_submission(api):
    client, _sessions, _settings = api
    project = _create_project(client)["id"]
    imported = _import(client, project, "overlapping.xyz", b"2\nbad\nH 0 0 0\nH 0 0 0\n", "XYZ")
    assert imported.status_code == 201, imported.text
    response = client.post(
        f"/v1/projects/{project}/calculations",
        json=submission(project, imported.json()["version"]["id"]),
    )
    assert response.status_code == 422 and "GEOMETRY_DEGENERATE" in response.text
