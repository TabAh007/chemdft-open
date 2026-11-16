from __future__ import annotations

import math
from uuid import uuid4

import pytest
from chemdft_api.contracts.catalog import CalculationSubmitInput
from chemdft_api.scientific.engines.optimization import validate_result, validate_step
from pydantic import ValidationError

ATOMS = [
    {"index": 0, "element": "H", "atomic_number": 1},
    {"index": 1, "element": "H", "atomic_number": 1},
]
STEP = {
    "index": 0,
    "engine_cycle": 1,
    "coordinates_angstrom": [[0.0, 0.0, 0.0], [0.0, 0.0, 1.2]],
    "energy_hartree": -1.005,
    "gradient_norm_hartree_per_bohr": 0.16,
    "gradient_rms_hartree_per_bohr": 0.06,
    "timestamp": "2026-01-01T00:00:00Z",
}
SPEC = {
    "method": {"identifier": "hf"},
    "basis": {"identifier": "sto-3g"},
    "charge": 0,
    "multiplicity": 1,
}
INPUT = {"engine_version": "2.14.0", "optimizer_version": "1.1.1"}


def test_engine_steps_reject_malformed_coordinates_energy_and_order() -> None:
    for candidate in (
        {**STEP, "coordinates_angstrom": [[0, 0, 0]]},
        {**STEP, "coordinates_angstrom": [[0, 0, math.inf], [0, 0, 1.2]]},
        {**STEP, "energy_hartree": math.nan},
        {**STEP, "engine_cycle": 2},
    ):
        with pytest.raises((ValueError, ValidationError)):
            validate_step(candidate, ATOMS, 0)


def test_trajectory_requires_observed_steps_engine_provenance_and_exact_final_frame() -> None:
    observed = [validate_step(STEP, ATOMS, 0)]
    candidate = {
        "schema": "chemdft.worker.optimization",
        "task": "GEOMETRY_OPTIMIZATION",
        "engine": "pyscf",
        "engine_version": "2.14.0",
        "optimizer": "geometric",
        "optimizer_version": "1.1.1",
        "environment": {},
        "method": "hf",
        "basis": "sto-3g",
        "charge": 0,
        "multiplicity": 1,
        "steps": [STEP],
        "converged": True,
        "final_coordinates_angstrom": STEP["coordinates_angstrom"],
    }
    assert validate_result(candidate, ATOMS, observed, SPEC, INPUT) == observed
    for invalid in (
        {**candidate, "engine_version": None},
        {**candidate, "optimizer_version": "forged"},
        {**candidate, "steps": [{**STEP, "energy_hartree": -99}]},
        {**candidate, "final_coordinates_angstrom": [[0, 0, 0], [0, 0, 9]]},
    ):
        with pytest.raises(ValueError):
            validate_result(invalid, ATOMS, observed, SPEC, INPUT)


def test_public_optimization_request_rejects_forged_results() -> None:
    project_id = str(uuid4())
    payload = {
        "structure_version": {
            "project_id": project_id,
            "entity_type": "structure.version",
            "entity_id": str(uuid4()),
        },
        "specification": {
            "task_type": "GEOMETRY_OPTIMIZATION",
            "method": {"identifier": "hf", "display_name": "HF", "registry": "chemdft.method"},
            "basis": {
                "identifier": "sto-3g",
                "display_name": "STO-3G",
                "registry": "chemdft.basis",
            },
            "charge": 0,
            "multiplicity": 1,
            "engine_preference": {"engine": "pyscf"},
            "optimization": {"max_steps": 10},
        },
        "idempotency_key": "optimization-public",
        "trajectory": [STEP],
    }
    with pytest.raises(ValidationError):
        CalculationSubmitInput.model_validate(payload)


def test_candidate_reference_cannot_bypass_structure_version_gate(api) -> None:
    client, _sessions, _settings = api
    project = client.post(
        "/v1/projects", json={"name": "Authority gate", "slug": "authority-gate"}
    ).json()
    response = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.candidate",
                "entity_id": str(uuid4()),
            },
            "specification": {
                "task_type": "GEOMETRY_OPTIMIZATION",
                "method": {"identifier": "hf", "display_name": "HF", "registry": "chemdft.method"},
                "basis": {
                    "identifier": "sto-3g",
                    "display_name": "STO-3G",
                    "registry": "chemdft.basis",
                },
                "charge": 0,
                "multiplicity": 1,
                "engine_preference": {"engine": "pyscf"},
                "optimization": {},
            },
            "idempotency_key": "candidate-denied-1",
        },
    )
    assert response.status_code == 404
    assert "StructureVersion" in response.json()["detail"]
