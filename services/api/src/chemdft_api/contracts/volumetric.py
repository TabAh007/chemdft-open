# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import math
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, FiniteFloat, model_validator

from .base import ArtifactReference, ContractModel, Sha256


class VolumetricFieldRequest(ContractModel):
    field_kind: Literal["MO_AMPLITUDE", "ELECTRON_DENSITY", "ELECTROSTATIC_POTENTIAL"]
    grid_profile: Literal["STANDARD"] = "STANDARD"
    orbital_index: int | None = Field(default=None, ge=0)
    spin_channel: Literal["restricted", "alpha", "beta"] | None = None

    @model_validator(mode="after")
    def validate_selection(self) -> VolumetricFieldRequest:
        if self.field_kind == "MO_AMPLITUDE":
            if self.orbital_index is None or self.spin_channel is None:
                raise ValueError("MO amplitude requires an orbital and spin channel")
        elif self.orbital_index is not None or self.spin_channel is not None:
            raise ValueError("Total density and ESP do not accept an orbital selection")
        return self


class VolumetricGridMetadata(ContractModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    artifact: ArtifactReference
    calculation_id: UUID
    calculation_result_id: UUID
    result_sha256: Sha256
    dimensions: tuple[int, int, int] = Field(json_schema_extra={"items": {"type": "integer"}})
    origin_angstrom: tuple[float, float, float] = Field(
        json_schema_extra={"items": {"type": "number"}}
    )
    voxel_vectors_angstrom: tuple[
        tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]
    ]
    coordinate_unit: Literal["angstrom"] = "angstrom"
    coordinate_frame: Literal["INPUT_STRUCTURE_VERSION_CARTESIAN"] = (
        "INPUT_STRUCTURE_VERSION_CARTESIAN"
    )
    field_min: float
    field_max: float
    field_sha256: Sha256
    grid_sha256: Sha256
    grid_specification_hash: Sha256
    grid_generator_version: str
    grid_profile: Literal["LEGACY", "STANDARD"] = "LEGACY"
    grid_profile_version: str = "1.0.0"
    spacing_angstrom: float = Field(gt=0, allow_inf_nan=False)
    molecular_margin_angstrom: float = Field(ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_grid(self) -> VolumetricGridMetadata:
        cap = 100_000 if self.grid_profile == "LEGACY" else 250_000
        if (
            any(size < 2 or size > 160 for size in self.dimensions)
            or math.prod(self.dimensions) > cap
        ):
            raise ValueError("Grid exceeds supported dimensions or voxel count")
        if not all(
            math.isfinite(v) for v in (*self.origin_angstrom, self.field_min, self.field_max)
        ):
            raise ValueError("Grid metadata must be finite")
        if self.field_min > self.field_max:
            raise ValueError("Grid minimum exceeds maximum")
        expected = tuple(
            tuple(self.spacing_angstrom if i == j else 0.0 for j in range(3)) for i in range(3)
        )
        if self.voxel_vectors_angstrom != expected:
            raise ValueError("Grid axes must match the Cartesian spacing")
        return self


class SurfacePotentialStatistics(ContractModel):
    density_grid_sha256: Sha256
    density_isovalue: float = Field(gt=0, allow_inf_nan=False)
    density_unit: Literal["e/a0^3"] = "e/a0^3"
    potential_unit: Literal["a.u."] = "a.u."
    minimum: float = Field(allow_inf_nan=False)
    maximum: float = Field(allow_inf_nan=False)
    minimum_position_angstrom: tuple[float, float, float]
    maximum_position_angstrom: tuple[float, float, float]
    vertex_count: int = Field(gt=0)
    triangle_count: int = Field(gt=0)
    renderer_version: Literal["marching-tetrahedra-2.0.0"] = "marching-tetrahedra-2.0.0"
    interpolator_version: Literal["trilinear-1.0.0"] = "trilinear-1.0.0"

    @model_validator(mode="after")
    def validate_extrema(self) -> SurfacePotentialStatistics:
        if self.minimum >= self.maximum or not all(
            math.isfinite(v)
            for v in (*self.minimum_position_angstrom, *self.maximum_position_angstrom)
        ):
            raise ValueError("Surface extrema or locations are invalid")
        return self


class VolumetricFieldManifest(VolumetricGridMetadata):
    grid_profile: Literal["STANDARD"] = "STANDARD"
    grid_profile_version: Literal["2.0.0"] = "2.0.0"
    grid_generator_version: Literal["2.0.0"] = "2.0.0"
    field_quantity: Literal["MO_AMPLITUDE", "ELECTRON_DENSITY", "ELECTROSTATIC_POTENTIAL"]
    field_unit: Literal["a0^-3/2", "e/a0^3", "a.u."]
    grid_generator: Literal["pyscf.scf-fields"] = "pyscf.scf-fields"
    provenance_record_id: UUID
    field_minimum_position_angstrom: tuple[FiniteFloat, FiniteFloat, FiniteFloat]
    field_maximum_position_angstrom: tuple[FiniteFloat, FiniteFloat, FiniteFloat]
    input_structure_version_id: UUID
    calculation_input_hash: Sha256
    coefficient_artifact_sha256: Sha256
    density_matrix_sha256: Sha256
    density_matrix_electron_count: float = Field(ge=0, allow_inf_nan=False)
    electron_count: int = Field(gt=0)
    orbital_index: int | None = Field(default=None, ge=0)
    spin_channel: Literal["restricted", "alpha", "beta"] | None = None
    authority: Literal["AUTHORITATIVE"] = "AUTHORITATIVE"
    source_class: Literal["CALCULATED"] = "CALCULATED"
    verification_state: Literal["UNVERIFIED"] = "UNVERIFIED"
    validation_state: Literal["VALIDATED"] = "VALIDATED"
    producer: Literal["pyscf"] = "pyscf"
    producer_version: str
    method: str
    basis: str
    density_integral_electrons: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    density_integral_relative_error: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    density_integral_tolerance: Literal[0.05] = 0.05
    density_integral_note: str | None = None
    potential_method: str | None = None
    singularity_treatment: str
    surface_statistics: SurfacePotentialStatistics | None = None
    generation_seconds: float = Field(ge=0, allow_inf_nan=False)
    artifact_size_bytes: int = Field(gt=0)
    created_at: datetime

    @model_validator(mode="after")
    def validate_semantics(self) -> VolumetricFieldManifest:
        expected = {
            "MO_AMPLITUDE": "a0^-3/2",
            "ELECTRON_DENSITY": "e/a0^3",
            "ELECTROSTATIC_POTENTIAL": "a.u.",
        }
        if self.field_unit != expected[self.field_quantity]:
            raise ValueError("Field quantity and unit disagree")
        if self.field_quantity == "MO_AMPLITUDE":
            if self.orbital_index is None or self.spin_channel is None:
                raise ValueError("MO field selection is missing")
        elif self.orbital_index is not None or self.spin_channel is not None:
            raise ValueError("Total fields cannot declare a selected orbital")
        if self.field_quantity == "ELECTRON_DENSITY" and (
            self.field_min < -1e-8 or self.density_integral_electrons is None
        ):
            raise ValueError("Density must be nonnegative and include an integration diagnostic")
        if self.field_quantity == "ELECTROSTATIC_POTENTIAL" and (
            not self.potential_method or self.surface_statistics is None
        ):
            raise ValueError("ESP requires potential method and density-surface statistics")
        return self


class VolumetricFieldOutput(ContractModel):
    manifest: VolumetricFieldManifest
    field_values: tuple[float, ...] = Field(min_length=8, max_length=250_000)

    @model_validator(mode="after")
    def validate_values(self) -> VolumetricFieldOutput:
        if len(self.field_values) != math.prod(self.manifest.dimensions) or not all(
            math.isfinite(v) for v in self.field_values
        ):
            raise ValueError("Field values are non-finite or disagree with dimensions")
        if (
            min(self.field_values) != self.manifest.field_min
            or max(self.field_values) != self.manifest.field_max
        ):
            raise ValueError("Field extrema disagree with manifest")
        return self
