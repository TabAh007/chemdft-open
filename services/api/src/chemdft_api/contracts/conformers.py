# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Additive CREST ensemble contracts; members are not optimization steps."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from .base import ArtifactReference, ContractModel, Sha256
from .scientific import Conformer, ScientificQuantity


class ConformerEnsembleMember(ContractModel):
    """Native CREST member; gradient convergence does not verify a local minimum."""

    conformer: Conformer
    native_rank: int = Field(ge=1)
    application_rank: int = Field(ge=1)
    native_electronic_energy: ScientificQuantity = Field(
        description="Native electronic energy; energy ranking does not establish minimum status."
    )
    native_record_sha256: Sha256
    minimum_status: Literal["UNVERIFIED"] = Field(
        default="UNVERIFIED",
        description="No qualifying frequency/Hessian evidence is supplied by this CREST search.",
    )
    geometry_convergence: Literal["NATIVE_GRADIENT_CONVERGED"] = Field(
        default="NATIVE_GRADIENT_CONVERGED",
        description="Validated native VTIGHT gradient convergence, not a local-minimum proof.",
    )

    @model_validator(mode="after")
    def canonical_units(self):
        if self.native_electronic_energy.unit.code != "Eh":
            raise ValueError("Native conformer energy requires Hartree")
        if (
            self.conformer.relative_energy is None
            or self.conformer.relative_energy.unit.code != "kcal/mol"
        ):
            raise ValueError("Relative conformer energy requires kcal/mol")
        if self.conformer.rank != self.application_rank:
            raise ValueError("Conformer ranking differs from application ranking")
        if self.conformer.coordinates.unit.value != "angstrom":
            raise ValueError("Native CREST coordinates require angstrom")
        return self


class ConformerNativeArtifact(ContractModel):
    name: str = Field(min_length=1, max_length=160)
    artifact: ArtifactReference


class ConformerIntermediateMinimum(ContractModel):
    stdout_line: int = Field(ge=1)
    energy_hartree: float = Field(allow_inf_nan=False)
    protocol: Literal["CRUDE", "TIGHT", "VTIGHT", "UNCLASSIFIED"]
    comparable_to_final: bool


class ConformerEnsembleManifest(ContractModel):
    payload_schema: Literal["chemdft.conformer-ensemble-manifest"] = (
        "chemdft.conformer-ensemble-manifest"
    )
    schema_version: Literal["1.0.0"] = "1.0.0"
    project_id: UUID
    calculation_id: UUID
    calculation_input_id: UUID
    execution_id: UUID
    attempt_number: int = Field(ge=1)
    input_structure_version_id: UUID
    input_structure_sha256: Sha256
    calculation_input_sha256: Sha256
    executable_sha256: Sha256
    engine: Literal["crest"] = "crest"
    engine_version: Literal["3.0.2+pf8c-ewinfix-a1"] = "3.0.2+pf8c-ewinfix-a1"
    calculator: Literal["embedded-tblite-0.3.0-fork"] = "embedded-tblite-0.3.0-fork"
    method: Literal["gfn2"] = "gfn2"
    charge: int
    multiplicity: Literal[1] = 1
    coordinate_unit: Literal["angstrom"] = "angstrom"
    energy_unit: Literal["Eh"] = "Eh"
    relative_energy_unit: Literal["kcal/mol"] = "kcal/mol"
    requested_ewin_kcal_mol: Literal[6.0] = 6.0
    effective_ewin_kcal_mol: Literal[6.0] = 6.0
    search_completed: Literal[True] = True
    native_optimized_count: int = Field(ge=1)
    native_duplicate_count: int = Field(ge=0)
    native_rotamer_count: int = Field(ge=1)
    restart_count: int = Field(ge=0)
    intermediate_minima: tuple[ConformerIntermediateMinimum, ...] = Field(max_length=10000)
    members: tuple[ConformerEnsembleMember, ...] = Field(min_length=1, max_length=1000)
    native_artifacts: tuple[ConformerNativeArtifact, ...] = Field(min_length=1, max_length=128)
    limitations: tuple[str, ...] = Field(min_length=1, max_length=32)

    @model_validator(mode="after")
    def scope_and_order(self):
        if [m.native_rank for m in self.members] != list(range(1, len(self.members) + 1)):
            raise ValueError("Native conformer ranks must be complete and ordered")
        if [m.application_rank for m in self.members] != list(range(1, len(self.members) + 1)):
            raise ValueError("Application conformer ranks must be complete and ordered")
        if len({m.conformer.id for m in self.members}) != len(self.members):
            raise ValueError("Conformer identities must be unique")
        if any(
            m.conformer.project_id != self.project_id
            or m.conformer.structure_version_id != self.input_structure_version_id
            for m in self.members
        ):
            raise ValueError("Ensemble members must reference the authorized input")
        if any(a.artifact.project_id != self.project_id for a in self.native_artifacts):
            raise ValueError("Native artifacts cannot cross projects")
        if len({a.name for a in self.native_artifacts}) != len(self.native_artifacts):
            raise ValueError("Native artifact names must be unique")
        return self


class ConformerEnsembleResult(ContractModel):
    payload_schema: Literal["chemdft.conformer-ensemble"] = "chemdft.conformer-ensemble"
    payload_schema_version: Literal["1.0.0"] = "1.0.0"
    task_type: Literal["CONFORMER_SEARCH"] = "CONFORMER_SEARCH"
    manifest: ConformerEnsembleManifest
    manifest_artifact: ArtifactReference
    artifacts: tuple[ArtifactReference, ...] = Field(min_length=1, max_length=128)
