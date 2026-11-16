from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest
from chemdft_api.calculation_actions import process_next_compute_job
from chemdft_api.context import Identity
from chemdft_api.scientific.engines.vibrational import (
    expected_mode_count,
    validate_frequency_candidate,
)
from chemdft_api.storage import LocalObjectStore
from result_provenance_checks import assert_published_result_binding


def test_vibrational_mode_count_accounts_for_linear_geometry() -> None:
    water = [[0.0, 0.0, 0.0], [0.0, 0.75, 0.6], [0.0, -0.75, 0.6]]
    carbon_dioxide = [[0.0, 0.0, -1.16], [0.0, 0.0, 0.0], [0.0, 0.0, 1.16]]
    assert expected_mode_count(water) == 3
    assert expected_mode_count(carbon_dioxide) == 4


def test_frequency_parser_rejects_wrong_mode_or_hessian_dimensions() -> None:
    coordinates = [[0.0, 0.0, 0.0], [0.0, 0.0, 0.74]]
    candidate = {
        "schema": "chemdft.worker.vibrational-analysis",
        "task": "FREQUENCY",
        "converged": True,
        "finite": True,
        "mode_count": 1,
        "hessian_hartree_per_bohr2": [[[[1.0, 0.0, 0.0]]]],
        "frequencies_cm1": [100.0],
        "normal_modes_amu_minus_half": [[[1.0, 0.0, 0.0]]],
        "reduced_masses_amu": [1.0],
        "method": "hf",
        "basis": "sto-3g",
        "charge": 0,
        "multiplicity": 1,
        "engine": "pyscf",
        "engine_version": "2.14.0",
        "mode_ordering": "ascending_eigenvalue",
        "vector_convention": "pyscf_thermo_norm_mode",
        "equilibrium_coordinates_angstrom": coordinates,
    }
    with pytest.raises(ValueError, match="Hessian atom dimension"):
        validate_frequency_candidate(
            candidate,
            {
                "atoms": [
                    {"element": "H", "xyz_angstrom": coordinates[0]},
                    {"element": "H", "xyz_angstrom": coordinates[1]},
                ],
                "method": "hf",
                "basis": "sto-3g",
                "charge": 0,
                "multiplicity": 1,
            },
        )


@pytest.mark.scientific_integration
@pytest.mark.skipif(
    os.environ.get("CHEMDFT_RUN_SCIENTIFIC_INTEGRATION") != "1",
    reason="requires the separately provisioned pinned PySCF worker",
)
def test_real_pyscf_water_frequency_persists_engine_modes_and_hessian(api) -> None:
    client, sessions, settings = api
    settings.scientific_worker_python = (
        Path(__file__).resolve().parents[3] / "services/scientific-worker/.venv/bin/python"
    )
    project = client.post(
        "/v1/projects", json={"name": "Vibrational acceptance", "slug": "vibrational-acceptance"}
    ).json()
    imported = client.post(
        f"/v1/projects/{project['id']}/structures/imports",
        files={
            "upload": (
                "water.xyz",
                b"3\nwater\nO 0 0 0\nH 0 0.758 0.588\nH 0 -0.758 0.588\n",
                "chemical/x-xyz",
            )
        },
        data={
            "file_format": "XYZ",
            "idempotency_key": "vibrational-water-import",
            "structure_name": "Water",
        },
    )
    assert imported.status_code == 201, imported.text
    source = imported.json()["version"]
    submitted = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.version",
                "entity_id": source["id"],
            },
            "specification": {
                "task_type": "FREQUENCY",
                "method": {
                    "identifier": "b3lyp",
                    "display_name": "B3LYP",
                    "registry": "chemdft.method",
                },
                "basis": {
                    "identifier": "def2-svp",
                    "display_name": "def2-SVP",
                    "registry": "chemdft.basis",
                },
                "charge": 0,
                "multiplicity": 1,
                "hessian": {
                    "strategy": "ANALYTIC",
                    "exclude_translation_rotation": True,
                    "coordinate_unit": "angstrom",
                    "hessian_unit": "Eh/bohr^2",
                    "frequency_unit": "cm^-1",
                },
                "engine_preference": {"engine": "pyscf", "allowed_version": "2.14.0"},
            },
            "idempotency_key": "vibrational-water-b3lyp-def2svp",
        },
    )
    assert submitted.status_code == 201, submitted.text
    queued = submitted.json()
    with sessions() as session:
        processed = process_next_compute_job(
            session,
            Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
        )
        assert processed is not None
    detail = client.get(
        f"/v1/projects/{project['id']}/calculations/{queued['calculation']['id']}"
    ).json()
    assert detail["calculation"]["state"] == "SUCCEEDED", (
        detail.get("attempt", {}).get("diagnostic"),
        detail.get("attempt", {}).get("failure_code"),
    )
    result = detail["result"]
    assert_published_result_binding(sessions, result["id"], source["id"])
    payload = result["payload"]
    assert result["result_type"] == "chemdft.vibrational-analysis"
    assert result["source_class"] == "CALCULATED"
    assert result["producer_software"]["name"] == "pyscf"
    assert len(payload["modes"]) == 3
    assert all(len(mode["displacement_vectors"]) == 3 for mode in payload["modes"])
    assert all(mode["raman_activity"] is None for mode in payload["modes"])
    assert all(mode["ir_intensity"] is not None for mode in payload["modes"])
    assert all(mode["ir_intensity"]["unit"]["code"] == "km/mol" for mode in payload["modes"])
    assert all(mode["ir_intensity"]["value"] > 0 for mode in payload["modes"])
    # Mode 1 (bend) is the most intense band (~55 km/mol)
    assert payload["modes"][0]["ir_intensity"]["value"] > 40.0
    assert payload["dipole_derivative_method"] == "central_finite_difference"
    assert payload["finite_difference_step_bohr"] == 0.0100
    assert payload["intensity_unit"] == "km/mol"
    assert payload["result_sha256"]
    assert payload["hessian_artifact"]["sha256"] == payload["hessian_sha256"]
    with sessions() as session:
        from chemdft_api.scientific_models import ScientificArtifactRecord

        hessian = session.get(ScientificArtifactRecord, payload["hessian_artifact"]["artifact_id"])
        assert hessian is not None and hessian.kind == "HESSIAN_MATRIX"
        raw = (Path(settings.object_root) / hessian.storage_key).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == payload["hessian_sha256"]
        parsed = json.loads(raw)
        assert len(parsed["hessian"]) == 3
