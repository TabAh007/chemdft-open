from __future__ import annotations

import io
from uuid import uuid4

import numpy as np
import pytest
from chemdft_api.contracts.results import DominantTransition, ExcitedState, TddftResult
from chemdft_api.scientific.engines.tddft import (
    EV_PER_HARTREE,
    HC_EV_NM,
    tddft_result_hash,
    validate_tddft_candidate,
    validate_tddft_result_hash,
)
from pydantic import ValidationError


def _water_input() -> dict:
    return {
        "schema": "chemdft.calculation_input",
        "schema_version": "1.0.0",
        "structure_version_id": str(uuid4()),
        "atom_ordering": "AS_LISTED",
        "coordinate_unit": "angstrom",
        "atoms": [
            {"index": 0, "atomic_number": 8, "element": "O", "xyz_angstrom": [0, 0, 0]},
            {"index": 1, "atomic_number": 1, "element": "H", "xyz_angstrom": [0, 0, 0.9572]},
            {"index": 2, "atomic_number": 1, "element": "H", "xyz_angstrom": [0.9266, 0, -0.24]},
        ],
        "charge": 0,
        "multiplicity": 1,
        "task": "TDDFT",
        "method": "b3lyp",
        "basis": "def2-svpd",
    }


def _water_tddft_candidate() -> dict:
    eh1 = 0.260689
    ev1 = eh1 * EV_PER_HARTREE
    nm1 = HC_EV_NM / ev1

    eh2 = 0.364300
    ev2 = eh2 * EV_PER_HARTREE
    nm2 = HC_EV_NM / ev2

    return {
        "schema": "chemdft.worker.tddft",
        "schema_version": "1.0.0",
        "task": "TDDFT",
        "engine": "pyscf",
        "engine_version": "2.14.0",
        "adapter_version": "1.0.0",
        "method": "b3lyp",
        "basis": "def2-svpd",
        "charge": 0,
        "multiplicity": 1,
        "converged": True,
        "finite": True,
        "total_scf_energy_hartree": -76.4,
        "scf_iterations": 12,
        "nocc": 5,
        "nvir": 34,
        "homo_energy_hartree": -0.35,
        "lumo_energy_hartree": 0.05,
        "excited_states": [
            {
                "index": 0,
                "state_label": "S1",
                "energy_hartree": eh1,
                "energy_ev": ev1,
                "wavelength_nm": nm1,
                "oscillator_strength": 0.0453,
                "oscillator_strength_gauge": "length",
                "transition_dipole": [0.51, 0.0, 0.0],
                "converged": True,
                "dominant_transitions": [
                    {
                        "occupied_mo_index": 4,
                        "virtual_mo_index": 5,
                        "occupied_label": "MO 5",
                        "virtual_label": "MO 6",
                        "x": 0.7059,
                        "y": -0.0103,
                        "magnitude": 0.7059,
                    }
                ],
            },
            {
                "index": 1,
                "state_label": "S2",
                "energy_hartree": eh2,
                "energy_ev": ev2,
                "wavelength_nm": nm2,
                "oscillator_strength": 0.1115,
                "oscillator_strength_gauge": "length",
                "transition_dipole": [0.0, 0.48, 0.48],
                "converged": True,
                "dominant_transitions": [
                    {
                        "occupied_mo_index": 3,
                        "virtual_mo_index": 5,
                        "occupied_label": "MO 4",
                        "virtual_label": "MO 6",
                        "x": 0.684,
                        "y": -0.0089,
                        "magnitude": 0.684,
                    }
                ],
            },
        ],
        "xy_amplitudes": [
            {"x": np.ones((5, 34)).tolist(), "y": np.zeros((5, 34)).tolist()},
            {"x": np.ones((5, 34)).tolist(), "y": np.zeros((5, 34)).tolist()},
        ],
    }


def test_tddft_candidate_validation_and_artifact_packing() -> None:
    result, amplitudes_bytes = validate_tddft_candidate(_water_tddft_candidate(), _water_input())

    assert result["payload_schema"] == "chemdft.tddft"
    assert result["converged"] is True
    assert result["requested_roots"] == 2
    assert result["converged_roots"] == 2
    assert result["dominant_state_index"] == 1  # S2 has 0.1115 > S1 has 0.0453
    assert result["max_oscillator_strength"] == pytest.approx(0.1115)
    assert result["nocc"] == 5
    assert result["homo_index"] == 4
    assert result["lumo_index"] == 5
    assert result["homo_lumo_gap_hartree"] == pytest.approx(0.40)

    # Verify NPZ artifact contents
    stream = io.BytesIO(amplitudes_bytes)
    loaded = np.load(stream)
    assert "state_0_x" in loaded
    assert "state_0_y" in loaded
    assert loaded["state_0_x"].shape == (5, 34)


def test_tddft_candidate_rejects_unconverged() -> None:
    candidate = _water_tddft_candidate()
    candidate["converged"] = False
    with pytest.raises(ValueError, match="not a converged TDDFT"):
        validate_tddft_candidate(candidate, _water_input())


def test_tddft_candidate_rejects_method_mismatch() -> None:
    candidate = _water_tddft_candidate()
    candidate["method"] = "pbe"
    with pytest.raises(ValueError, match="differs from validated input"):
        validate_tddft_candidate(candidate, _water_input())


def test_tddft_state_contract_validates_unit_conversions() -> None:
    eh = 0.260689
    ev = eh * EV_PER_HARTREE
    nm = HC_EV_NM / ev

    state = ExcitedState(
        index=0,
        state_label="S1",
        energy_hartree=eh,
        energy_ev=ev,
        wavelength_nm=nm,
        oscillator_strength=0.0453,
        oscillator_strength_gauge="length",
        transition_dipole=(0.51, 0.0, 0.0),
        converged=True,
        dominant_transitions=(
            DominantTransition(
                occupied_mo_index=4,
                virtual_mo_index=5,
                occupied_label="MO 5",
                virtual_label="MO 6",
                x=0.7059,
                y=-0.0103,
                magnitude=0.7059,
            ),
        ),
    )
    assert state.energy_ev == pytest.approx(ev)

    # Inconsistent eV conversion should raise ValidationError
    with pytest.raises(ValidationError):
        ExcitedState(
            index=0,
            state_label="S1",
            energy_hartree=eh,
            energy_ev=ev + 10.0,  # wrong
            wavelength_nm=nm,
            oscillator_strength=0.0453,
            oscillator_strength_gauge="length",
            transition_dipole=(0.51, 0.0, 0.0),
            converged=True,
        )


def test_tddft_result_hash_validation() -> None:
    candidate = _water_tddft_candidate()
    result, _ = validate_tddft_candidate(candidate, _water_input())
    artifact_id = uuid4()
    proj_id = uuid4()

    full_payload = {
        **result,
        "calculation_id": uuid4(),
        "input_structure_id": uuid4(),
        "input_structure_version_id": uuid4(),
        "input_structure_hash": "a" * 64,
        "calculation_input_hash": "b" * 64,
        "amplitudes_artifact": {
            "artifact_id": artifact_id,
            "project_id": proj_id,
            "sha256": "c" * 64,
        },
        "amplitudes_artifact_sha256": "c" * 64,
        "amplitudes_format": "chemdft.tddft-amplitudes.npz",
        "result_sha256": "0" * 64,
    }

    model = TddftResult.model_validate(full_payload)
    canonical = model.model_dump(mode="json", exclude={"result_sha256"})
    h = tddft_result_hash(canonical)
    model = model.model_copy(update={"result_sha256": h})

    validate_tddft_result_hash(model)
