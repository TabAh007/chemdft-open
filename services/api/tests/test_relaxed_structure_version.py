"""Release 0.0.45: "Save relaxed structure as a new version" for a Quantum ESPRESSO relaxation result."""

from __future__ import annotations

from uuid import uuid4

from chemdft_api.citation_block import citation_block, citation_block_text, detect_project_tools
from chemdft_api.scientific_models import (
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from sqlalchemy import select
from test_structure_workspace import CIF_NACL, _create_project, _import

NOTE = "cell fixed; positions relaxed with Quantum ESPRESSO 7.6 PBE+U"
RELAXED = [
    {"index": 0, "element": "Na", "species": "Na", "fractional": [0.012345, 0.001, -0.002]},
    {"index": 1, "element": "Cl", "species": "Cl", "fractional": [0.4875, 0.5, 0.5]},
]


def seed_qe_calculation(sessions, project_id: str, version_id: str, *, relaxation="relaxed", engine="qe", positions=None) -> str:
    """A finished QE calculation row with a stored result document (the worker's output shape)."""
    with sessions() as session:
        version = session.get(StructureVersionRecord, version_id)
        canonical = session.get(ScientificArtifactRecord, version.canonical_artifact_id)
        calculation = CalculationRecord(project_id=project_id, state="SUCCEEDED", created_by=version.created_by)
        session.add(calculation)
        session.flush()
        input_artifact = ScientificArtifactRecord(
            project_id=project_id, kind="CALCULATION_INPUT", media_type="application/json", format_identifier="chemdft.input",
            format_version="1.0.0", size_bytes=2, sha256="a" * 64, storage_key=f"projects/{project_id}/raw/{uuid4()}", created_by=version.created_by,
            extensions_json=[],
        )
        session.add(input_artifact)
        session.flush()
        session.add(
            CalculationInputRecord(
                project_id=project_id, calculation_id=calculation.id, structure_version_id=version_id,
                specification_json={"task_type": "PERIODIC_ENERGY", "engine_preference": {"engine": engine}},
                normalized_input_artifact_id=input_artifact.id,
            )
        )
        provenance = ProvenanceRecordRow(
            project_id=project_id, subject_type="calculation.result", subject_id=str(uuid4()), source_class="CALCULATED",
            detail="DIRECT_ACQUISITION", verification_state="UNVERIFIED", producer_kind="SOFTWARE", producer_identifier="qe",
            operation="qe", operation_version="1", parameters_json=[], correlation_id=str(uuid4()),
        )
        session.add(provenance)
        session.flush()
        payload: dict = {"engine": engine, "engine_version": "7.6", "converged": True}
        if relaxation == "relaxed":
            payload["relaxation"] = {"converged": True, "final_positions": positions or RELAXED}
        session.add(
            CalculationResultRecord(
                project_id=project_id, calculation_id=calculation.id, calculation_input_id=session.scalar(
                    select(CalculationInputRecord.id).where(CalculationInputRecord.calculation_id == calculation.id)
                ), result_type="periodic-energy", authority="CALCULATED", source_class="CALCULATED",
                verification_state="UNVERIFIED", validation_state="VALIDATED", trusted_producer_id="p", trusted_producer_type="t",
                producer_attestation_id="a", producer_software_json={}, payload_json=payload, provenance_record_id=provenance.id,
                raw_artifacts_json=[], idempotency_key=f"seed:{uuid4()}", request_id=str(uuid4()), correlation_id=str(uuid4()),
            )
        )
        session.commit()
        return calculation.id


def import_nacl(client):
    project = _create_project(client, "relaxed")
    body = _import(client, project["id"], "nacl.cif", CIF_NACL, "CIF").json()
    return project, body["structure"]["id"], body["version"]


def test_saves_the_relaxed_positions_as_version_two_and_never_touches_version_one(api):
    client, sessions, _ = api
    project, structure_id, v1 = import_nacl(client)
    calculation_id = seed_qe_calculation(sessions, project["id"], v1["id"])
    response = client.post(f"/v1/projects/{project['id']}/calculations/{calculation_id}/relaxed-structure-version")
    assert response.status_code == 201, response.text
    v2 = response.json()["version"]
    assert (v2["revision"], v2["origin"], v2["parent_version_id"]) == (2, "DERIVED", v1["id"])
    assert v2["periodic_cell"] == v1["periodic_cell"]  # cell fixed
    assert [(a["element"], a["x"], a["y"], a["z"]) for a in v2["coordinates"]["atoms"]] == [
        ("Na", 0.012345, 0.001, -0.002), ("Cl", 0.4875, 0.5, 0.5)]
    unchanged = client.get(f"/v1/projects/{project['id']}/structures/{structure_id}/versions/{v1['id']}").json()
    unchanged = unchanged.get("version", unchanged)
    assert unchanged["coordinates"]["atoms"] == v1["coordinates"]["atoms"]
    with sessions() as session:
        record = session.get(StructureVersionRecord, v2["id"])
        provenance = session.get(ProvenanceRecordRow, record.provenance_record_id)
        assert provenance.source_class == "CALCULATED" and provenance.source_class != "USER_SUPPLIED"
        parameters = {p["key"]: p["value"] for p in provenance.parameters_json}
        assert parameters["calculation_id"] == calculation_id and parameters["note"] == NOTE
        inputs = session.scalars(select(ProvenanceInputRow).where(ProvenanceInputRow.provenance_record_id == provenance.id)).all()
        assert {row.input_id for row in inputs} >= {v1["id"], calculation_id}
        assert record.representation_json["relaxation"]["note"] == NOTE


def test_saving_twice_is_idempotent(api):
    client, sessions, _ = api
    project, _structure, v1 = import_nacl(client)
    calculation_id = seed_qe_calculation(sessions, project["id"], v1["id"])
    url = f"/v1/projects/{project['id']}/calculations/{calculation_id}/relaxed-structure-version"
    first, second = client.post(url).json()["version"], client.post(url).json()["version"]
    assert first["id"] == second["id"]
    with sessions() as session:
        assert len(session.scalars(select(StructureVersionRecord).where(StructureVersionRecord.project_id == project["id"])).all()) == 2


def test_refuses_a_result_without_relaxed_positions_and_non_qe_results(api):
    client, sessions, _ = api
    project, _structure, v1 = import_nacl(client)
    plain = seed_qe_calculation(sessions, project["id"], v1["id"], relaxation="none")
    other = seed_qe_calculation(sessions, project["id"], v1["id"], engine="pyscf")
    for calculation_id in (plain, other):
        response = client.post(f"/v1/projects/{project['id']}/calculations/{calculation_id}/relaxed-structure-version")
        assert response.status_code in {400, 422}, response.text
    with sessions() as session:
        assert len(session.scalars(select(StructureVersionRecord).where(StructureVersionRecord.project_id == project["id"])).all()) == 1


def test_refuses_positions_that_do_not_match_the_calculated_atoms(api):
    client, sessions, _ = api
    project, _structure, v1 = import_nacl(client)
    calculation_id = seed_qe_calculation(sessions, project["id"], v1["id"], positions=[{**RELAXED[0], "element": "K"}, RELAXED[1]])
    response = client.post(f"/v1/projects/{project['id']}/calculations/{calculation_id}/relaxed-structure-version")
    assert response.status_code in {400, 422}


def test_a_user_without_access_is_refused(multiuser):
    alice, bob = multiuser.actor("alice"), multiuser.actor("bob")
    project = alice.create_project("relaxed-access")
    body = alice.post(
        f"/v1/projects/{project['id']}/structures/imports",
        data={"file_format": "CIF", "idempotency_key": f"i-{uuid4().hex}"}, files={"upload": ("nacl.cif", CIF_NACL, "chemical/x-cif")},
    ).json()
    calculation_id = seed_qe_calculation(multiuser.sessions, project["id"], body["version"]["id"])
    denied = bob.post(f"/v1/projects/{project['id']}/calculations/{calculation_id}/relaxed-structure-version")
    assert denied.status_code in {403, 404}
    allowed = alice.post(f"/v1/projects/{project['id']}/calculations/{calculation_id}/relaxed-structure-version")
    assert allowed.status_code == 201


def test_the_original_source_stays_citable_for_the_new_version(api):
    client, sessions, _ = api
    project, _structure, v1 = import_nacl(client)
    calculation_id = seed_qe_calculation(sessions, project["id"], v1["id"])
    v2 = client.post(f"/v1/projects/{project['id']}/calculations/{calculation_id}/relaxed-structure-version").json()["version"]
    with sessions() as session:
        parent = session.get(StructureVersionRecord, v1["id"])
        child = session.get(StructureVersionRecord, v2["id"])
        for key in ("cif_source_reference", "source_reference"):
            assert child.representation_json.get(key) == parent.representation_json.get(key)
        tools = detect_project_tools(session, project["id"])
    block = citation_block([], tools_used=tools)
    assert "pymatgen" in tools
    assert "cite the original source" in block["also_cite"]["reminder"]
    assert "cite the original source" in citation_block_text(block)
