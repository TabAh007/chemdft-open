from __future__ import annotations

import math

import numpy as np
import pytest
from chemdft_api.contracts.volumetric import VolumetricFieldRequest
from chemdft_api.scientific.engines.electronic_fields import (
    BOHR_PER_ANGSTROM,
    density_integral,
    derive_density_matrix,
    matrix_hash,
    sample_trilinear,
    standard_grid,
    surface_statistics,
)
from pydantic import ValidationError


def channel(occupation=(2.0, 0.0), spin="restricted"):
    return {"spin_channel": spin, "coefficients": np.eye(2).tolist(), "occupations": occupation}


def test_restricted_and_unrestricted_density_matrices():
    restricted = derive_density_matrix([channel()], 2, 2)
    assert np.array_equal(restricted, np.diag([2.0, 0.0]))
    unrestricted = derive_density_matrix(
        [channel((1.0, 0.0), "alpha"), channel((1.0, 0.0), "beta")], 2, 2
    )
    assert np.array_equal(restricted, unrestricted)
    assert matrix_hash(restricted) == matrix_hash(unrestricted)


@pytest.mark.parametrize("occupation", [(float("nan"), 0), (-1, 3), (3, -1), (1, 0)])
def test_invalid_density_matrix_rejected(occupation):
    with pytest.raises(ValueError):
        derive_density_matrix([channel(occupation)], 2, 2)


def test_coefficient_dimensions_and_finiteness_rejected():
    for coefficients in ([[1]], [[float("inf"), 0], [0, 1]]):
        source = channel()
        source["coefficients"] = coefficients
        with pytest.raises(ValueError):
            derive_density_matrix([source], 2, 2)


def test_standard_grid_deterministic_bounded_and_avoids_nuclei():
    atoms = [{"xyz_angstrom": [0, 0, 0]}, {"xyz_angstrom": [0.9266, 0, 0.9572]}]
    origin, dims = standard_grid(atoms)
    assert (origin, dims) == standard_grid(atoms)
    assert math.prod(dims) <= 250000
    assert all(n > 21 for n in dims)
    for atom in atoms:
        position = (np.asarray(atom["xyz_angstrom"]) - origin) / 0.12
        assert not np.allclose(position, np.round(position))
    with pytest.raises(ValueError, match="cap"):
        standard_grid([{"xyz_angstrom": [0, 0, 0]}, {"xyz_angstrom": [100, 100, 100]}])


def test_density_integral_trapezoidal_units():
    density = np.ones((3, 3, 3))
    assert density_integral(density, 1 / BOHR_PER_ANGSTROM) == pytest.approx(8)


def test_trilinear_potential_and_surface_statistics():
    x, y, z = np.indices((5, 5, 5))
    potential = 2 * x + 3 * y - z
    assert sample_trilinear(potential, np.array([[1.2, 2.3, 0.4]]))[0] == pytest.approx(8.9)
    assert sample_trilinear(potential, np.array([[4, 4, 4]]))[0] == 16
    with pytest.raises(ValueError):
        sample_trilinear(potential, np.array([[-1, 0, 0]]))
    density = 0.002 * np.exp(-((x - 2) ** 2 + (y - 2) ** 2 + (z - 2) ** 2))
    stats = surface_statistics(density, potential, [0, 0, 0], 1)
    assert stats["minimum"] < stats["maximum"]
    assert stats["triangle_count"] > 0
    assert stats["vertex_count"] == stats["triangle_count"] * 3


@pytest.mark.parametrize("kind", ["ELECTRON_DENSITY", "ELECTROSTATIC_POTENTIAL"])
def test_clients_cannot_supply_fields_or_density_matrices(kind):
    for extra in ({"field_values": [1, 2]}, {"density_matrix": [[2]]}, {"source": "PreviewScene"}):
        with pytest.raises(ValidationError):
            VolumetricFieldRequest.model_validate({"field_kind": kind, **extra})
    with pytest.raises(ValidationError):
        VolumetricFieldRequest(field_kind=kind, orbital_index=0)


def test_candidate_preview_or_missing_calculation_cannot_generate_fields(api):
    from uuid import uuid4

    client, _, _ = api
    project = client.post(
        "/v1/projects", json={"name": "Field firewall", "slug": "field-firewall"}
    ).json()
    for kind in ("ELECTRON_DENSITY", "ELECTROSTATIC_POTENTIAL"):
        response = client.post(
            f"/v1/projects/{project['id']}/calculations/{uuid4()}/fields/grid",
            json={"field_kind": kind},
        )
        assert response.status_code == 404
        for source in ("CandidateRepresentation", "PreviewScene"):
            assert (
                client.post(
                    f"/v1/projects/{project['id']}/calculations/{uuid4()}/fields/grid",
                    json={"field_kind": kind, "source": source},
                ).status_code
                == 422
            )


def test_public_registration_cannot_publish_calculated_field_artifacts(api):
    from uuid import UUID, uuid4

    from chemdft_api.context import Identity
    from chemdft_api.contracts.artifacts import ScientificArtifactRegistration
    from chemdft_api.errors import ScientificValidationFailed
    from chemdft_api.scientific_actions import register_scientific_artifact

    client, sessions, settings = api
    project = client.post(
        "/v1/projects", json={"name": "No field injection", "slug": "no-field-injection"}
    ).json()
    with sessions() as session:
        for kind in ("VOLUMETRIC_GRID", "ORBITAL_GRID", "MO_COEFFICIENTS"):
            with pytest.raises(ScientificValidationFailed, match="engine execution"):
                register_scientific_artifact(
                    session,
                    Identity(
                        user_id=settings.dev_user_id, organization_id=settings.dev_organization_id
                    ),
                    ScientificArtifactRegistration(
                        project_id=UUID(project["id"]),
                        stored_file_id=uuid4(),
                        kind=kind,
                        format_identifier="forged-calculated-field",
                    ),
                )


def test_field_manifest_rejects_nonfinite_wrong_shape_units_and_negative_density():
    from datetime import UTC, datetime
    from uuid import uuid4

    from chemdft_api.contracts.volumetric import VolumetricFieldManifest, VolumetricFieldOutput

    identifier = uuid4()
    values = dict(
        artifact={"project_id": identifier, "artifact_id": identifier, "sha256": "a" * 64},
        calculation_id=identifier,
        calculation_result_id=identifier,
        result_sha256="a" * 64,
        provenance_record_id=identifier,
        input_structure_version_id=identifier,
        calculation_input_hash="a" * 64,
        coefficient_artifact_sha256="a" * 64,
        density_matrix_sha256="a" * 64,
        density_matrix_electron_count=2,
        electron_count=2,
        dimensions=(2, 2, 2),
        origin_angstrom=(0, 0, 0),
        spacing_angstrom=0.12,
        voxel_vectors_angstrom=((0.12, 0, 0), (0, 0.12, 0), (0, 0, 0.12)),
        molecular_margin_angstrom=3,
        field_min=1,
        field_max=1,
        field_minimum_position_angstrom=(0, 0, 0),
        field_maximum_position_angstrom=(0, 0, 0),
        field_sha256="a" * 64,
        grid_sha256="a" * 64,
        grid_specification_hash="a" * 64,
        grid_generator_version="2.0.0",
        grid_profile="STANDARD",
        grid_profile_version="2.0.0",
        field_quantity="ELECTRON_DENSITY",
        field_unit="e/a0^3",
        producer_version="2.14.0",
        method="hf",
        basis="sto-3g",
        density_integral_electrons=2,
        singularity_treatment="Lattice excludes nuclei",
        generation_seconds=1,
        artifact_size_bytes=100,
        created_at=datetime.now(UTC),
    )
    manifest = VolumetricFieldManifest(**values)
    assert VolumetricFieldOutput(manifest=manifest, field_values=(1,) * 8)
    for overrides in (
        {"field_min": -1},
        {"field_unit": "a.u."},
        {"field_max": float("inf")},
        {"dimensions": (200, 2, 2)},
    ):
        with pytest.raises(ValidationError):
            VolumetricFieldManifest(**{**values, **overrides})
    for field in ((1,) * 9, (float("nan"),) * 8, (float("inf"),) * 8, (2,) * 8):
        with pytest.raises(ValidationError):
            VolumetricFieldOutput(manifest=manifest, field_values=field)
