# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from .base import ArtifactReference, ContractModel, EntityReference, Sha256
from .catalog import StructureImportOutput
from .structure_candidates import CandidateCoordinateRepresentation


class MolecularDrawingGenerateInput(ContractModel):
    mol_block: Annotated[
        str, StringConstraints(min_length=1, max_length=2_000_000, strip_whitespace=False)
    ]
    name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    expected_charge: int = 0
    multiplicity: int = Field(default=1, ge=1)
    parent_structure_version: EntityReference | None = None


class GeometryAtomMapping(ContractModel):
    generated_atom_index: int = Field(ge=0)
    source_atom_index: int | None = Field(default=None, ge=0)
    hydrogen_parent_source_index: int | None = Field(default=None, ge=0)


class GeometryCandidateManifest(ContractModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    source_drawing: ArtifactReference
    source_graph_sha256: Sha256
    canonical_smiles: str
    formula: str
    source_atom_count: int
    explicit_hydrogen_count: int
    atom_mapping: tuple[GeometryAtomMapping, ...]
    generation_method: Literal["rdkit.etkdg3.preview-conformer"]
    generation_parameters: dict[str, str | int | bool]
    geometry_class: Literal["GENERATED_CONFORMER_NOT_OPTIMIZED"] = (
        "GENERATED_CONFORMER_NOT_OPTIMIZED"
    )
    coordinate_representation: CandidateCoordinateRepresentation
    parent_structure_version: EntityReference | None = None


class GeometryCandidateAcceptInput(ContractModel):
    candidate_sha256: Sha256
    inspected_geometry: Literal[True]
    understands_not_optimized: Literal[True]


class GeometryEligibility(ContractModel):
    structure_version_id: UUID
    eligible: bool
    code: str
    detail: str


class GeometryCandidateView(ContractModel):
    id: UUID
    project_id: UUID
    candidate_artifact: ArtifactReference
    state: Literal["PENDING_ACCEPTANCE", "ACCEPTED"]
    calculation_eligible: Literal[False] = False
    manifest: GeometryCandidateManifest
    accepted_structure_version_id: UUID | None = None


class GeometryCandidateAcceptOutput(StructureImportOutput):
    candidate_id: UUID
    calculation_eligibility: GeometryEligibility


class GeometryCandidateListOutput(ContractModel):
    candidates: tuple[GeometryCandidateView, ...] = Field(default=(), max_length=256)
