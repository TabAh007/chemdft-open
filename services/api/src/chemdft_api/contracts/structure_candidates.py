# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import math
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator

from .base import ContractModel, ContractVersion
from .catalog import StructureVersionProvenance
from .phase7 import SourceAnchor
from .provenance import ProvenanceClass
from .scientific import (
    Atom,
    Bond,
    CoordinateSystem,
    CoordinateUnit,
    PeriodicCell,
    Structure,
    StructureKind,
    StructureVersion,
)


class StructureCandidateSourceType(StrEnum):
    REPORTED_FIGURE = "REPORTED_FIGURE"
    IMAGE_RECONSTRUCTION = "IMAGE_RECONSTRUCTION"
    TEXT_RECONSTRUCTION = "TEXT_RECONSTRUCTION"
    USER_DRAFT = "USER_DRAFT"
    IMPORTED_COORDINATES_PENDING_REVIEW = "IMPORTED_COORDINATES_PENDING_REVIEW"


class StructureCandidateState(StrEnum):
    DETECTED = "DETECTED"
    REVIEWED = "REVIEWED"
    REJECTED = "REJECTED"
    PROMOTED = "PROMOTED"


class CandidateRepresentationType(StrEnum):
    IMAGE_REFERENCE = "IMAGE_REFERENCE"
    SMILES = "SMILES"
    MOL = "MOL"
    MOL_BLOCK = "MOL_BLOCK"
    COORDINATES = "COORDINATES"
    CARTESIAN_COORDINATES = "CARTESIAN_COORDINATES"
    CRYSTAL_COORDINATES = "CRYSTAL_COORDINATES"


class CandidateRepresentationOrigin(StrEnum):
    SOURCE_REFERENCE = "SOURCE_REFERENCE"
    USER_DRAFT = "USER_DRAFT"
    TEXT_RECONSTRUCTION = "TEXT_RECONSTRUCTION"
    IMAGE_RECONSTRUCTION = "IMAGE_RECONSTRUCTION"
    AI_HYPOTHESIS = "AI_HYPOTHESIS"
    DERIVED_PREVIEW = "DERIVED_PREVIEW"


class CandidateRepresentationValidationState(StrEnum):
    NOT_APPLICABLE = "NOT_APPLICABLE"
    INVALID = "INVALID"
    PARSEABLE = "PARSEABLE"
    PREVIEWABLE = "PREVIEWABLE"


class CandidateRepresentationReviewState(StrEnum):
    NOT_REVIEWED = "NOT_REVIEWED"
    REVIEWED = "REVIEWED"
    REJECTED = "REJECTED"


class CandidateCoordinateOrigin(StrEnum):
    USER_IMPORTED_FILE = "USER_IMPORTED_FILE"
    USER_PASTED = "USER_PASTED"
    USER_CREATED = "USER_CREATED"
    USER_EDITED = "USER_EDITED"
    EXTERNAL_DATABASE_IMPORT = "EXTERNAL_DATABASE_IMPORT"
    GENERATED_CONFORMER = "GENERATED_CONFORMER"


class CandidateCoordinateInputFormat(StrEnum):
    XYZ = "XYZ"
    MOL = "MOL"
    SDF = "SDF"
    CIF = "CIF"
    PASTED_CARTESIAN = "PASTED_CARTESIAN"
    PASTED_FRACTIONAL = "PASTED_FRACTIONAL"
    GENERATED_CONFORMER = "GENERATED_CONFORMER"


class CandidateCoordinates(ContractModel):
    coordinate_system: CoordinateSystem
    unit: CoordinateUnit
    dimensionality: Literal[3] = 3
    atom_ordering: Literal["AS_LISTED"] = "AS_LISTED"
    atoms: tuple[Atom, ...] = Field(min_length=1, max_length=2_000)
    bonds: tuple[Bond, ...] = Field(default=(), max_length=8_000)

    @model_validator(mode="after")
    def validate_candidate_atom_order(self) -> CandidateCoordinates:
        if [atom.index for atom in self.atoms] != list(range(len(self.atoms))):
            raise ValueError("Candidate atom indices must match serialized ordering")
        if any(
            bond.atom_index_a >= len(self.atoms)
            or bond.atom_index_b >= len(self.atoms)
            or bond.atom_index_a == bond.atom_index_b
            for bond in self.bonds
        ):
            raise ValueError("Candidate bonds must reference distinct existing atoms")
        if any(
            not math.isfinite(value) for atom in self.atoms for value in (atom.x, atom.y, atom.z)
        ):
            raise ValueError("Candidate coordinates must be finite")
        return self


class CandidateCoordinateRepresentation(ContractModel):
    kind: StructureKind
    name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    coordinates: CandidateCoordinates
    periodic_cell: PeriodicCell | None = None
    overall_charge: int = 0
    multiplicity: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def validate_periodic_coordinates(self) -> CandidateCoordinateRepresentation:
        if self.kind is StructureKind.PERIODIC:
            if self.periodic_cell is None:
                raise ValueError("Periodic candidate coordinates require a cell")
            if self.coordinates.coordinate_system is not CoordinateSystem.FRACTIONAL:
                raise ValueError("Periodic candidate coordinates must be fractional")
            if self.coordinates.unit is not self.periodic_cell.unit:
                raise ValueError("Fractional coordinate and cell units must match")
        elif self.periodic_cell is not None:
            raise ValueError("Molecular candidate coordinates cannot include a periodic cell")
        return self


class CandidateCellParameters(ContractModel):
    unit: CoordinateUnit = CoordinateUnit.ANGSTROM
    a: float = Field(gt=0, allow_inf_nan=False)
    b: float = Field(gt=0, allow_inf_nan=False)
    c: float = Field(gt=0, allow_inf_nan=False)
    alpha: float = Field(gt=0, lt=180, allow_inf_nan=False)
    beta: float = Field(gt=0, lt=180, allow_inf_nan=False)
    gamma: float = Field(gt=0, lt=180, allow_inf_nan=False)

    def to_periodic_cell(self) -> PeriodicCell:
        alpha, beta, gamma = (math.radians(value) for value in (self.alpha, self.beta, self.gamma))
        sin_gamma = math.sin(gamma)
        if abs(sin_gamma) < 1e-8:
            raise ValueError("Cell angle gamma cannot produce a valid lattice.")
        ax, ay, az = self.a, 0.0, 0.0
        bx, by, bz = self.b * math.cos(gamma), self.b * sin_gamma, 0.0
        cx = self.c * math.cos(beta)
        cy = self.c * (math.cos(alpha) - math.cos(beta) * math.cos(gamma)) / sin_gamma
        cz_squared = self.c**2 - cx**2 - cy**2
        if cz_squared <= 1e-10:
            raise ValueError("Cell dimensions and angles do not define a positive-volume cell.")
        return PeriodicCell(
            unit=self.unit,
            a=self.a,
            b=self.b,
            c=self.c,
            alpha=self.alpha,
            beta=self.beta,
            gamma=self.gamma,
            lattice_vectors=((ax, ay, az), (bx, by, bz), (cx, cy, math.sqrt(cz_squared))),
        )


class CandidateRepresentationReviewChecklist(ContractModel):
    inspected_source: bool = False
    understands_missing_paper_coordinates: bool = False
    coordinate_source_declared: bool = False
    units_checked: bool = False
    cell_checked_if_used: bool = False
    validation_warnings_reviewed: bool = False
    differences_acknowledged: bool = False
    stereochemistry_reviewed: bool | None = None
    charges_reviewed: bool | None = None

    def complete(self) -> bool:
        """Legacy seven-item completeness; an explicit False on a B3 item still blocks."""
        return self.complete_for(stereochemistry_required=False, charges_required=False)

    def complete_for(self, *, stereochemistry_required: bool, charges_required: bool) -> bool:
        """Completeness for a representation whose chemistry makes the B3 items applicable.

        An applicable B3 item must be explicitly true: a missing (None) answer is not a review.
        An explicit False always blocks, applicable or not.
        """
        core = (
            self.inspected_source
            and self.understands_missing_paper_coordinates
            and self.coordinate_source_declared
            and self.units_checked
            and self.cell_checked_if_used
            and self.validation_warnings_reviewed
            and self.differences_acknowledged
        )
        if not core:
            return False
        if self.stereochemistry_reviewed is False or self.charges_reviewed is False:
            return False
        if stereochemistry_required and self.stereochemistry_reviewed is not True:
            return False
        return not (charges_required and self.charges_reviewed is not True)


class StereocenterInfo(ContractModel):
    atom_index: int = Field(ge=0)
    element: str
    stereo: str
    is_assigned: bool


class DoubleBondStereoInfo(ContractModel):
    bond_index: int = Field(ge=0)
    begin_atom_index: int = Field(ge=0)
    end_atom_index: int = Field(ge=0)
    stereo: str
    is_assigned: bool


class MolecularGraphDifference(ContractModel):
    category: str
    description: str
    original_value: str | None = None
    corrected_value: str | None = None


class CandidateRepresentationView(ContractModel):
    id: UUID
    representation_type: CandidateRepresentationType
    revision: int = Field(ge=1)
    content_sha256: str | None = None
    representation_origin: CandidateRepresentationOrigin
    coordinates_available: bool
    validation_state: CandidateRepresentationValidationState
    validation_diagnostics: tuple[str, ...] = Field(default=(), max_length=50)
    review_state: CandidateRepresentationReviewState = (
        CandidateRepresentationReviewState.NOT_REVIEWED
    )
    source_representation_id: UUID | None = None
    provenance_class: ProvenanceClass
    method: str
    method_version: str
    approximation: str
    created_by: UUID
    created_at: datetime
    generation_parameters: dict[str, str | int | float | bool] = Field(default_factory=dict)
    coordinate_provenance: dict[str, object] | None = None
    cell_provenance: dict[str, object] | None = None
    review_checklist: CandidateRepresentationReviewChecklist | None = None


class CandidateRepresentationDetail(CandidateRepresentationView):
    candidate_id: UUID
    smiles: str | None = None
    mol_block: Annotated[str, StringConstraints(strip_whitespace=False)] | None = None
    coordinate_representation: CandidateCoordinateRepresentation | None = None
    # Batch B2: the stored diagram-recognition proposal (status, formula, charge, warnings,
    # ambiguities) exactly as it was produced; present only on image-reconstruction SMILES output.
    recognition_proposal: dict[str, object] | None = None
    # Batch B3: differences from parent proposal when correcting a recognized diagram
    differences_from_parent: tuple[MolecularGraphDifference, ...] | None = None


class CandidateRepresentationCreateInput(ContractModel):
    representation_type: Literal[
        "SMILES", "MOL", "MOL_BLOCK", "CARTESIAN_COORDINATES", "CRYSTAL_COORDINATES"
    ]
    smiles: Annotated[str, StringConstraints(min_length=1, max_length=10_000)] | None = None
    # A MOL block's first line is a (usually blank) title; stripping it breaks the fixed header.
    mol_block: (
        Annotated[
            str, StringConstraints(min_length=1, max_length=2_000_000, strip_whitespace=False)
        ]
        | None
    ) = None
    coordinate_representation: CandidateCoordinateRepresentation | None = None
    coordinate_origin: CandidateCoordinateOrigin | None = None
    parent_representation_id: UUID | None = None
    cell_source_evidence_id: UUID | None = None

    @model_validator(mode="after")
    def enforce_typed_content(self) -> CandidateRepresentationCreateInput:
        if self.representation_type == "SMILES":
            if self.smiles is None or self.mol_block is not None or self.coordinate_representation:
                raise ValueError("SMILES representations require only smiles content.")
        elif self.representation_type in {"MOL", "MOL_BLOCK"}:
            if self.mol_block is None or self.smiles is not None or self.coordinate_representation:
                raise ValueError("MOL representations require only mol_block content.")
        else:
            if (
                self.coordinate_representation is None
                or self.smiles is not None
                or self.mol_block is not None
            ):
                raise ValueError(
                    "Coordinate representations require only coordinate_representation."
                )
            is_periodic = self.coordinate_representation.kind is StructureKind.PERIODIC
            expected_type = "CRYSTAL_COORDINATES" if is_periodic else "CARTESIAN_COORDINATES"
            if self.representation_type != expected_type:
                raise ValueError("Representation type does not match coordinate structure kind.")
        if self.representation_type in {"SMILES", "MOL", "MOL_BLOCK"} and (
            self.coordinate_origin is not None
            or self.cell_source_evidence_id is not None
        ):
            raise ValueError(
                "Coordinate provenance fields require coordinate representation input."
            )
        return self


class MolecularGraphValidateInput(ContractModel):
    content: Annotated[
        str, StringConstraints(min_length=1, max_length=2_000_000, strip_whitespace=False)
    ]
    format: Literal["SMILES", "MOL", "MOL_BLOCK"] = "SMILES"
    parent_representation_id: UUID | None = None


class MolecularGraphValidateOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    is_valid: bool
    canonical_isomeric_smiles: str | None = None
    formula: str | None = None
    formal_charge: int | None = None
    heavy_atom_count: int | None = None
    elements: tuple[str, ...] = ()
    has_stereochemistry: bool = False
    stereocenters: tuple[StereocenterInfo, ...] = Field(default=(), max_length=200)
    double_bond_stereochemistry: tuple[DoubleBondStereoInfo, ...] = Field(
        default=(), max_length=200
    )
    unassigned_stereocenters: tuple[str, ...] = Field(default=(), max_length=200)
    unassigned_double_bonds: tuple[str, ...] = Field(default=(), max_length=200)
    disconnected_fragments: int = 1
    fragment_formulas: tuple[str, ...] = Field(default=(), max_length=50)
    is_organic: bool = True
    unsupported_elements: tuple[str, ...] = Field(default=(), max_length=50)
    can_generate_3d: bool = False
    validation_warnings: tuple[str, ...] = Field(default=(), max_length=50)
    validation_diagnostics: tuple[str, ...] = Field(default=(), max_length=50)
    differences_from_parent: tuple[MolecularGraphDifference, ...] = Field(default=(), max_length=50)


class ConformerGenerationInput(ContractModel):
    name: Annotated[str, StringConstraints(min_length=1, max_length=160)] | None = None
    multiplicity: int = Field(default=1, ge=1)


class CandidateRepresentationListInput(ContractModel):
    candidate_id: UUID


class CandidateRepresentationListOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    candidate_id: UUID
    representations: tuple[CandidateRepresentationView, ...] = Field(default=(), max_length=256)


class CandidateRepresentationCreateOutput(ContractModel):
    representation: CandidateRepresentationDetail
    generated_representation: CandidateRepresentationDetail | None = None


class CandidateRepresentationReviewInput(ContractModel):
    notes: Annotated[str, StringConstraints(max_length=500)] | None = None
    checklist: CandidateRepresentationReviewChecklist | None = None


class CandidateCoordinatePasteInput(ContractModel):
    name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    coordinate_system: CoordinateSystem
    unit: CoordinateUnit
    coordinate_text: Annotated[str, StringConstraints(min_length=1, max_length=500_000)]
    parent_representation_id: UUID | None = None
    cell: CandidateCellParameters | None = None
    cell_source: Literal["USER_ENTERED", "PAPER_EVIDENCE"] | None = None
    cell_source_evidence_id: UUID | None = None

    @model_validator(mode="after")
    def validate_cell_source(self) -> CandidateCoordinatePasteInput:
        if self.coordinate_system is CoordinateSystem.FRACTIONAL and self.cell is None:
            raise ValueError("Fractional coordinates require an explicit unit cell.")
        if self.coordinate_system is CoordinateSystem.CARTESIAN and self.cell is not None:
            raise ValueError("Cartesian paste input cannot include a periodic cell.")
        if self.cell is None and (self.cell_source or self.cell_source_evidence_id):
            raise ValueError("Cell provenance requires a cell.")
        if self.cell_source == "PAPER_EVIDENCE" and self.cell_source_evidence_id is None:
            raise ValueError("Paper cell provenance requires a source evidence identifier.")
        if self.cell_source != "PAPER_EVIDENCE" and self.cell_source_evidence_id is not None:
            raise ValueError("Cell evidence identifier requires PAPER_EVIDENCE source.")
        return self


class CandidateRepresentationRejectInput(ContractModel):
    reason: Annotated[str, StringConstraints(max_length=500)] | None = None


class CandidateRepresentationReviewOutput(ContractModel):
    representation: CandidateRepresentationDetail


class StructureCandidatePromotionInput(ContractModel):
    representation_id: UUID | None = None


class StructureCandidate(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    source_type: StructureCandidateSourceType
    source_evidence_id: UUID
    source_document_id: UUID
    source_page: int | None = Field(default=None, ge=1)
    source_anchor_id: UUID | None = None
    source_anchor: SourceAnchor | None = None
    candidate_state: StructureCandidateState
    provenance_class: ProvenanceClass
    method: str
    method_version: str
    approximation: str
    representations: tuple[CandidateRepresentationView, ...] = Field(default=(), max_length=32)
    representation_types: tuple[CandidateRepresentationType, ...] = Field(default=(), max_length=32)
    coordinates_available: bool
    created_by: UUID
    created_at: datetime
    reviewed_by: UUID | None = None
    reviewed_at: datetime | None = None
    promoted_structure_version_id: UUID | None = None


class StructureCandidateListOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    candidates: tuple[StructureCandidate, ...] = Field(default=(), max_length=10_000)


class StructureCandidateListInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"


class StructureCandidateGetInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    candidate_id: UUID


class StructureCandidateReviewInput(ContractModel):
    notes: Annotated[str, StringConstraints(max_length=500)] | None = None


class StructureCandidateRejectInput(ContractModel):
    reason: Annotated[str, StringConstraints(max_length=500)] | None = None


class CandidateRecognitionInput(ContractModel):
    engine: Annotated[str, StringConstraints(max_length=80)] | None = None
    category_hint: Annotated[str, StringConstraints(max_length=80)] | None = None


class StructureCandidateReviewOutput(ContractModel):
    candidate: StructureCandidate


class StructureCandidatePromotionOutput(ContractModel):
    candidate: StructureCandidate
    structure: Structure
    version: StructureVersion
    provenance: StructureVersionProvenance


class DocumentFiguresExtractInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    document_id: UUID


class DocumentFiguresExtractOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    document_id: UUID
    candidates: tuple[StructureCandidate, ...] = Field(default=(), max_length=10_000)


class StructureCandidateRecognizeInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    candidate_id: UUID
    engine_preference: Annotated[str, StringConstraints(max_length=80)] = "decimer"
    category_hint: Annotated[str, StringConstraints(max_length=80)] | None = None


class StructureCandidateRecognizeOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    candidate: StructureCandidate
    status: str
    canonical_isomeric_smiles: str | None = None
    formula: str | None = None
    proposal: dict[str, object] = Field(default_factory=dict)
    # The immutable raw DECIMER proposal representation this output describes, and whether it was
    # produced by an earlier identical inference (True) or by this call (False).
    representation_id: UUID | None = None
    reused: bool = False


class StructureCandidateValidateGraphInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    candidate_id: UUID
    content: Annotated[
        str, StringConstraints(min_length=1, max_length=2_000_000, strip_whitespace=False)
    ]
    format: Literal["SMILES", "MOL", "MOL_BLOCK"] = "SMILES"
    parent_representation_id: UUID | None = None


class StructureCandidateRequestReviewInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    candidate_id: UUID
    expected_representation_id: UUID | None = None
    review_reason: Annotated[str, StringConstraints(min_length=1, max_length=500)]


class StructureCandidateRequestReviewOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    gate_status: str
    run_id: UUID | None = None
    project_id: UUID
    candidate_id: UUID
    expected_representation_id: UUID | None = None
    source_document_id: UUID | None = None
    review_reason: str
