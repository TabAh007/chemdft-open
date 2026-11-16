from __future__ import annotations

import io
from uuid import uuid4

import numpy as np
import pytest
from chemdft_api.contracts.base import ArtifactReference
from chemdft_api.contracts.results import MolecularOrbitalGridManifest, MolecularOrbitalGridOutput
from chemdft_api.scientific.engines.orbitals import (
    deterministic_npz,
    molecular_orbital_result_hash,
    validate_orbital_candidate,
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
        "task": "ORBITAL",
        "method": "hf",
        "basis": "sto-3g",
    }


def _water_candidate() -> dict:
    return {
        "schema": "chemdft.worker.molecular-orbitals",
        "schema_version": "1.0.0",
        "task": "ORBITAL",
        "engine": "pyscf",
        "engine_version": "2.14.0",
        "adapter_version": "1.0.0",
        "method": "hf",
        "basis": "sto-3g",
        "charge": 0,
        "multiplicity": 1,
        "converged": True,
        "finite": True,
        "total_energy_hartree": -74.0,
        "electron_count": 10,
        "alpha_electron_count": 5,
        "beta_electron_count": 5,
        "basis_function_count": 7,
        "molecular_orbital_count": 7,
        "orbital_channels": [
            {
                "spin_channel": "restricted",
                "coefficients": np.eye(7).tolist(),
                "energies_hartree": [-20, -1.2, -0.8, -0.6, -0.4, 0.2, 0.5],
                "occupations": [2, 2, 2, 2, 2, 0, 0],
            }
        ],
    }


def test_orbital_candidate_derives_frontier_from_occupations_and_saves_safe_arrays() -> None:
    result, artifact = validate_orbital_candidate(_water_candidate(), _water_input())

    frontier = result["frontier_by_spin"][0]
    assert frontier["homo_index"] == 4
    assert frontier["lumo_index"] == 5
    assert frontier["gap_hartree"] == pytest.approx(0.6)
    assert result["electron_count"] == sum(item["occupation"] for item in result["orbitals"])
    assert result["coefficient_artifact_sha256"]
    with np.load(io.BytesIO(artifact), allow_pickle=False) as arrays:
        assert arrays["coefficients_restricted"].shape == (7, 7)
        assert arrays["input_coordinates_angstrom"].shape == (3, 3)


def test_orbital_candidate_rejects_nonconverged_or_wrong_electron_count() -> None:
    candidate = _water_candidate()
    candidate["converged"] = False
    with pytest.raises(ValueError, match="converged"):
        validate_orbital_candidate(candidate, _water_input())

    candidate = _water_candidate()
    candidate["electron_count"] = 9
    with pytest.raises(ValueError, match="electron counts"):
        validate_orbital_candidate(candidate, _water_input())


def test_deterministic_coefficient_artifact_has_stable_bytes_and_result_hash() -> None:
    arrays = {"coefficients_restricted": np.eye(2), "occupations": np.asarray([2.0, 0.0])}
    first = deterministic_npz(arrays)
    second = deterministic_npz(arrays)
    assert first == second
    assert molecular_orbital_result_hash({"result": {"energy": -1.0}}) == (
        molecular_orbital_result_hash({"result": {"energy": -1.0}})
    )


def _grid_manifest() -> MolecularOrbitalGridManifest:
    project_id = uuid4()
    artifact_id = uuid4()
    return MolecularOrbitalGridManifest(
        artifact=ArtifactReference(
            project_id=project_id,
            artifact_id=artifact_id,
            sha256="a" * 64,
        ),
        calculation_id=uuid4(),
        calculation_result_id=uuid4(),
        result_sha256="b" * 64,
        orbital_index=4,
        spin_channel="restricted",
        dimensions=(2, 2, 2),
        origin_angstrom=(-3.0, -3.0, -3.0),
        voxel_vectors_angstrom=((0.35, 0.0, 0.0), (0.0, 0.35, 0.0), (0.0, 0.0, 0.35)),
        field_min=-0.1,
        field_max=0.2,
        field_sha256="c" * 64,
        grid_sha256="d" * 64,
        grid_specification_hash="e" * 64,
        grid_generator_version="1.0.0",
        spacing_angstrom=0.35,
        molecular_margin_angstrom=3.0,
    )


def test_grid_output_checks_finite_field_and_voxel_dimensions() -> None:
    grid = MolecularOrbitalGridOutput(
        manifest=_grid_manifest(), field_values=(-0.1, 0.0, 0.2, 0, 0, 0, 0, 0)
    )
    assert len(grid.field_values) == 8
    with pytest.raises(ValidationError, match="finite"):
        MolecularOrbitalGridOutput(
            manifest=_grid_manifest(), field_values=(-0.1, 0.0, 0.2, 0, 0, 0, 0, float("nan"))
        )
    with pytest.raises(ValidationError, match="dimensions"):
        MolecularOrbitalGridOutput(manifest=_grid_manifest(), field_values=(0.0,) * 9)


def test_grid_manifest_rejects_oversized_dimensions() -> None:
    values = _grid_manifest().model_dump()
    values["dimensions"] = (96, 96, 96)
    with pytest.raises(ValidationError, match="voxel count"):
        MolecularOrbitalGridManifest.model_validate(values)
