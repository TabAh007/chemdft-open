from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path

import pytest
from chemdft_api.calculation_actions import process_next_compute_job
from chemdft_api.context import Identity
from chemdft_api.scientific_models import CalculationInputRecord, ScientificArtifactRecord
from chemdft_api.storage import LocalObjectStore
from result_provenance_checks import assert_published_result_binding
from sqlalchemy import select


@pytest.mark.scientific_integration
@pytest.mark.skipif(
    os.environ.get("CHEMDFT_RUN_SCIENTIFIC_INTEGRATION") != "1",
    reason="requires the separately provisioned pinned PySCF worker",
)
def test_real_pyscf_h2_energy_flows_through_firewall(api) -> None:
    client, sessions, settings = api
    project = client.post(
        "/v1/projects", json={"name": "PySCF integration", "slug": "pyscf-integration"}
    ).json()
    imported = client.post(
        f"/v1/projects/{project['id']}/structures/imports",
        files={
            "upload": (
                "h2.xyz",
                b"2\nH2 0.74 angstrom\nH 0 0 -0.37\nH 0 0 0.37\n",
                "chemical/x-xyz",
            )
        },
        data={
            "file_format": "XYZ",
            "idempotency_key": "integration-h2-import",
            "structure_name": "H2",
        },
    )
    assert imported.status_code == 201, imported.text
    version = imported.json()["version"]
    response = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.version",
                "entity_id": version["id"],
            },
            "specification": {
                "task_type": "ENERGY",
                "method": {
                    "identifier": "hf",
                    "display_name": "Hartree-Fock",
                    "registry": "chemdft.method",
                },
                "basis": {
                    "identifier": "sto-3g",
                    "display_name": "STO-3G",
                    "registry": "chemdft.basis",
                },
                "charge": 0,
                "multiplicity": 1,
                "engine_preference": {"engine": "pyscf", "allowed_version": "2.14.0"},
            },
            "idempotency_key": "integration-h2-hf-sto3g",
        },
    )
    assert response.status_code == 201, response.text
    detail = response.json()
    assert detail["calculation"]["state"] == "QUEUED"
    assert detail["compute_job"]["state"] == "READY"
    with sessions() as session:
        processed = process_next_compute_job(
            session,
            Identity(
                user_id=settings.dev_user_id,
                organization_id=settings.dev_organization_id,
            ),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="integration-worker",
        )
        assert processed is not None
    detail = client.get(
        f"/v1/projects/{project['id']}/calculations/{detail['calculation']['id']}"
    ).json()
    assert detail["calculation"]["state"] == "SUCCEEDED"
    assert detail["compute_job"]["state"] == "SUCCEEDED"
    assert detail["compute_execution"]["state"] == "FINISHED"
    assert detail["result"]["source_class"] == "CALCULATED"
    assert_published_result_binding(sessions, detail["result"]["id"], version["id"])
    assert detail["result"]["producer_software"]["version"] == "2.14.0"
    library_versions = detail["result"]["producer_software"]["library_versions"]
    assert {item["key"] for item in library_versions[0]["values"]} == {"numpy", "scipy"}
    log_artifact_id = detail["attempt"]["raw_artifacts"][1]["artifact_id"]
    log_download = client.get(
        f"/v1/projects/{project['id']}/calculations/{detail['calculation']['id']}"
        f"/artifacts/{log_artifact_id}"
    )
    assert log_download.status_code == 200
    assert "converged SCF energy" in log_download.text
    assert "storage_key" not in log_download.headers.get("content-disposition", "")
    energy = detail["result"]["payload"]["total_energy"]["value"]
    assert energy == pytest.approx(-1.1167593073964255, abs=1e-10)

    with sessions() as session:
        calculation_input = session.scalar(
            select(CalculationInputRecord).where(
                CalculationInputRecord.calculation_id == detail["calculation"]["id"]
            )
        )
        assert calculation_input is not None
        normalized = session.get(
            ScientificArtifactRecord, calculation_input.normalized_input_artifact_id
        )
        assert normalized is not None
        normalized_bytes = (Path(settings.object_root) / normalized.storage_key).read_bytes()
        assert hashlib.sha256(normalized_bytes).hexdigest() == detail["calculation_input_hash"]
        parsed_result = session.scalar(
            select(ScientificArtifactRecord).where(
                ScientificArtifactRecord.project_id == project["id"],
                ScientificArtifactRecord.kind == "NORMALIZED_RESULT",
            )
        )
        assert parsed_result is not None
        worker_result = json.loads(
            (Path(settings.object_root) / parsed_result.storage_key).read_text()
        )
        assert worker_result["total_energy_hartree"] == energy


@pytest.mark.scientific_integration
@pytest.mark.skipif(
    os.environ.get("CHEMDFT_RUN_SCIENTIFIC_INTEGRATION") != "1",
    reason="requires the separately provisioned pinned PySCF worker",
)
def test_real_pyscf_water_orbitals_publish_and_cache_deterministic_grids(api, monkeypatch) -> None:
    client, sessions, settings = api
    project_response = client.post(
        "/v1/projects",
        json={"name": "Electronic structure acceptance — water", "slug": "mo-water-acceptance"},
    )
    assert project_response.status_code == 201, project_response.text
    project = project_response.json()
    imported = client.post(
        f"/v1/projects/{project['id']}/structures/imports",
        files={
            "upload": (
                "test-user-supplied-water.xyz",
                (
                    Path(__file__).parent / "fixtures/structures/test-user-supplied-water.xyz"
                ).read_bytes(),
                "chemical/x-xyz",
            )
        },
        data={
            "file_format": "XYZ",
            "idempotency_key": "mo-water-user-geometry-import",
            "structure_name": "TEST USER-SUPPLIED WATER GEOMETRY",
        },
    )
    assert imported.status_code == 201, imported.text
    version = imported.json()["version"]
    assert version["origin"] == "IMPORTED"
    response = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.version",
                "entity_id": version["id"],
            },
            "specification": {
                "task_type": "ORBITAL",
                "method": {
                    "identifier": "hf",
                    "display_name": "Restricted Hartree-Fock",
                    "registry": "chemdft.method",
                },
                "basis": {
                    "identifier": "sto-3g",
                    "display_name": "STO-3G",
                    "registry": "chemdft.basis",
                },
                "charge": 0,
                "multiplicity": 1,
                "scf": {"convergence_threshold": 1e-10, "max_iterations": 100},
                "engine_preference": {"engine": "pyscf", "allowed_version": "2.14.0"},
            },
            "idempotency_key": "mo-water-rhf-sto3g",
        },
    )
    assert response.status_code == 201, response.text
    queued = response.json()
    assert queued["calculation"]["state"] == "QUEUED"
    with sessions() as session:
        processed = process_next_compute_job(
            session,
            Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="mo-water-integration-worker",
        )
        assert processed is not None
    detail = client.get(f"/v1/projects/{project['id']}/calculations/{queued['calculation']['id']}")
    assert detail.status_code == 200, detail.text
    result = detail.json()["result"]
    assert_published_result_binding(sessions, result["id"], version["id"])
    assert detail.json()["calculation"]["state"] == "SUCCEEDED", json.dumps(detail.json(), indent=2)
    assert result["result_type"] == "chemdft.molecular-orbitals"
    assert result["authority"] == "AUTHORITATIVE"
    assert result["source_class"] == "CALCULATED"
    assert result["validation_state"] == "VALIDATED"
    payload = result["payload"]
    assert payload["engine_version"] == "2.14.0"
    assert payload["electron_count"] == 10
    assert payload["alpha_electron_count"] == payload["beta_electron_count"] == 5
    assert payload["basis_function_count"] == payload["molecular_orbital_count"] == 7
    assert sum(orbital["occupation"] for orbital in payload["orbitals"]) == pytest.approx(10)
    assert payload["frontier_by_spin"][0]["spin_channel"] == "restricted"
    frontier = payload["frontier_by_spin"][0]
    orbitals = {orbital["index"]: orbital for orbital in payload["orbitals"]}
    assert orbitals[frontier["homo_index"]]["occupation"] == pytest.approx(2)
    assert orbitals[frontier["lumo_index"]]["occupation"] == pytest.approx(0)
    assert frontier["gap_hartree"] > 0
    assert payload["orbital_gap_note"] == (
        "Orbital-energy difference; not an excited-state calculation."
    )

    conversation = client.post(
        f"/v1/projects/{project['id']}/ai/conversations",
        json={"title": "Orbital result provenance"},
    )
    assert conversation.status_code == 201, conversation.text
    summary = client.post(
        f"/v1/projects/{project['id']}/ai/conversations/"
        f"{conversation.json()['conversation']['id']}/messages",
        json={
            "content": (
                "What are the HOMO and LUMO in this project, what is their "
                "orbital-energy gap, and how were these values calculated?"
            )
        },
    )
    assert summary.status_code == 201, summary.text
    summary_message = summary.json()["messages"][-1]
    assert "charge 0; multiplicity 1" in summary_message["content"]
    assert "HOMO-LUMO orbital-energy gap" in summary_message["content"]
    assert summary_message["evidence_status"] == "SUPPORTED"

    grid_url = (
        f"/v1/projects/{project['id']}/calculations/{queued['calculation']['id']}/orbitals/grid"
    )
    request = {"orbital_index": frontier["homo_index"], "spin_channel": "restricted"}
    first_grid = client.post(grid_url, json=request)
    assert first_grid.status_code == 200, first_grid.text
    grid = first_grid.json()
    assert grid["manifest"]["calculation_result_id"] == result["id"]
    assert grid["manifest"]["result_sha256"] == payload["result_sha256"]
    assert len(grid["field_values"]) == math.prod(grid["manifest"]["dimensions"])
    assert all(math.isfinite(value) for value in grid["field_values"])
    assert min(grid["field_values"]) < 0 < max(grid["field_values"])
    repeated_grid = client.post(grid_url, json=request)
    assert repeated_grid.status_code == 200, repeated_grid.text
    assert (
        repeated_grid.json()["manifest"]["artifact"]["artifact_id"]
        == grid["manifest"]["artifact"]["artifact_id"]
    )
    assert repeated_grid.json()["manifest"]["grid_sha256"] == grid["manifest"]["grid_sha256"]
    invalid_orbital = client.post(
        grid_url, json={"orbital_index": 999, "spin_channel": "restricted"}
    )
    assert invalid_orbital.status_code == 404

    # Preserve legacy profile and original immutable result while deriving linked fields.
    legacy = client.post(grid_url, json={**request, "grid_profile": "LEGACY"})
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["manifest"]["spacing_angstrom"] == 0.35
    assert grid["manifest"]["spacing_angstrom"] == 0.12
    fields_url = grid_url.replace("orbitals/grid", "fields/grid")
    density_response = client.post(fields_url, json={"field_kind": "ELECTRON_DENSITY"})
    assert density_response.status_code == 200, density_response.text
    density = density_response.json()
    manifest = density["manifest"]
    assert manifest["source_class"] == "CALCULATED"
    assert manifest["verification_state"] == "UNVERIFIED"
    assert manifest["calculation_result_id"] == result["id"]
    assert manifest["density_matrix_electron_count"] == pytest.approx(10, abs=1e-8)
    assert manifest["density_integral_electrons"] == pytest.approx(10, rel=0.05)
    assert manifest["field_unit"] == "e/a0^3"
    assert min(density["field_values"]) >= -1e-8
    esp_response = client.post(fields_url, json={"field_kind": "ELECTROSTATIC_POTENTIAL"})
    assert esp_response.status_code == 200, esp_response.text
    esp = esp_response.json()
    assert esp["manifest"]["field_unit"] == "a.u."
    assert esp["manifest"]["dimensions"] == manifest["dimensions"]
    assert esp["manifest"]["origin_angstrom"] == manifest["origin_angstrom"]
    assert esp["manifest"]["density_matrix_sha256"] == manifest["density_matrix_sha256"]
    assert all(math.isfinite(v) for v in esp["field_values"])
    stats = esp["manifest"]["surface_statistics"]
    assert stats["minimum"] < 0 < stats["maximum"]
    assert stats["triangle_count"] > 0
    assert stats["density_grid_sha256"] == manifest["grid_sha256"]
    from chemdft_api.compute_gateway import LocalComputeProvider
    from chemdft_api.scientific_models import ProvenanceRecordRow

    # Cache read must not execute a scientific worker, including after new HTTP sessions.
    def no_recompute(*args, **kwargs):
        raise AssertionError("Cached fields must not rerun worker/SCF")

    monkeypatch.setattr(LocalComputeProvider, "execute", no_recompute)
    for kind, saved in (("ELECTRON_DENSITY", density), ("ELECTROSTATIC_POTENTIAL", esp)):
        repeated = client.post(fields_url, json={"field_kind": kind})
        assert repeated.status_code == 200, repeated.text
        assert repeated.json() == saved
        assert (
            client.post(fields_url, json={"field_kind": kind, "field_values": [0]}).status_code
            == 422
        )
        with sessions() as session:
            provenance = session.scalar(
                select(ProvenanceRecordRow).where(
                    ProvenanceRecordRow.subject_id == saved["manifest"]["artifact"]["artifact_id"]
                )
            )
            assert provenance is not None and provenance.source_class == "CALCULATED"
    assert client.get(grid_url.removesuffix("/orbitals/grid")).json()["result"] == result
    assert client.post(grid_url, json={**request, "grid_profile": "LEGACY"}).json() == legacy.json()

    fields_summary = client.post(
        f"/v1/projects/{project['id']}/ai/conversations/"
        f"{conversation.json()['conversation']['id']}/messages",
        json={
            "content": "What electron-density and electrostatic-potential results are available "
            "in this project, how were they calculated, and what do the surface colors mean?"
        },
    )
    assert fields_summary.status_code == 201, fields_summary.text
    message = fields_summary.json()["messages"][-1]
    assert message["evidence_status"] == "SUPPORTED"
    assert "e/a₀³" in message["content"] and "a.u." in message["content"]
    assert "trilinearly" in message["content"] and "phase, not charge" in message["content"]
    assert "minimum" in message["content"] and "saved HF/STO-3G" in message["content"]
    assert "oxygen is negative" not in message["content"].lower()

    # A failed/nonconverged calculation cannot supply a derived field.
    from chemdft_api.scientific_models import CalculationRecord

    with sessions() as session:
        calculation = session.get(CalculationRecord, queued["calculation"]["id"])
        calculation.state = "FAILED"
        session.commit()
    assert client.post(fields_url, json={"field_kind": "ELECTRON_DENSITY"}).status_code == 404
    with sessions() as session:
        calculation = session.get(CalculationRecord, queued["calculation"]["id"])
        calculation.state = "SUCCEEDED"
        session.commit()

    # Corruption is rejected on cache read, never published as a replacement result.
    with sessions() as session:
        artifact = session.get(ScientificArtifactRecord, manifest["artifact"]["artifact_id"])
        assert artifact is not None
        path = Path(settings.object_root) / artifact.storage_key
        original = path.read_bytes()
        path.write_bytes(b"corrupt field")
    broken = client.post(fields_url, json={"field_kind": "ELECTRON_DENSITY"})
    assert broken.status_code == 422, broken.text
    path.write_bytes(original)


@pytest.mark.scientific_integration
@pytest.mark.skipif(
    os.environ.get("CHEMDFT_RUN_SCIENTIFIC_INTEGRATION") != "1",
    reason="requires the separately provisioned pinned PySCF worker",
)
@pytest.mark.parametrize("task,method,basis,result_type", [
    ("TDDFT", "b3lyp", "def2-svpd", "chemdft.tddft"),
    ("ORBITAL", "hf", "sto-3g", "chemdft.molecular-orbitals"),
])
def test_real_electronic_publication_has_canonical_provenance(
    api, task, method, basis, result_type
):
    from uuid import uuid4

    from test_xtb_optimization import run_job

    client, sessions, _settings = api
    project = client.post(
        "/v1/projects", json={"name": "TDDFT provenance", "slug": f"tddft-provenance-{uuid4()}"}
    ).json()["id"]
    imported = client.post(
        f"/v1/projects/{project}/structures/imports",
        files={
            "upload": (
                "water.xyz",
                b"3\nwater\nO 0 0 0\nH 0 0.758 0.588\nH 0 -0.758 0.588\n",
                "chemical/x-xyz",
            )
        },
        data={"file_format": "XYZ", "idempotency_key": str(uuid4())},
    )
    assert imported.status_code == 201, imported.text
    version = imported.json()["version"]
    queued = client.post(
        f"/v1/projects/{project}/calculations",
        json={
            "structure_version": {
                "project_id": project,
                "entity_type": "structure.version",
                "entity_id": version["id"],
            },
            "specification": {
                "task_type": task,
                "method": {
                    "identifier": method,
                    "display_name": method,
                    "registry": "chemdft.method",
                },
                "basis": {
                    "identifier": basis,
                    "display_name": basis,
                    "registry": "chemdft.basis",
                },
                "charge": 0,
                "multiplicity": 1,
                "engine_preference": {"engine": "pyscf"},
            },
            "idempotency_key": str(uuid4()),
        },
    )
    assert queued.status_code == 201, queued.text
    detail = run_job(api)
    assert detail.calculation.state == "SUCCEEDED", detail
    assert detail.result.result_type == result_type
    assert_published_result_binding(sessions, detail.result.id, version["id"])
