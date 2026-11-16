# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from .base import ContractModel, ContractVersion


class MoleculeAlternative(ContractModel):
    name: str
    canonical_isomeric_smiles: str
    formula: str
    description: str


class MoleculeResolveInput(ContractModel):
    name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    allow_smiles: bool = True
    allow_pubchem: bool = False


class MoleculeResolveOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    resolved: bool
    name: str
    canonical_isomeric_smiles: str | None = None
    formula: str | None = None
    charge: int | None = None
    multiplicity: int | None = None
    stereo_status: Literal["NONE", "SPECIFIED", "AMBIGUOUS"] | None = None
    identity_source: Literal["REVIEWED_CATALOGUE", "EXPLICIT_SMILES", "PUBCHEM"] | None = None
    source_hash: str | None = None
    heavy_atom_count: int | None = None
    clarification_required: bool = False
    clarification_prompt: str | None = None
    alternatives: tuple[MoleculeAlternative, ...] = ()
    diagnostics: tuple[str, ...] = ()


class MoleculeDraftCreateInput(ContractModel):
    name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    canonical_isomeric_smiles: Annotated[str, StringConstraints(min_length=1, max_length=2000)]
    action_key: Annotated[str, StringConstraints(min_length=4, max_length=128)]
    expected_charge: int = 0
    multiplicity: int = Field(default=1, ge=1)


class MoleculeDraftCreateOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    candidate_id: UUID
    project_id: UUID
    name: str
    canonical_smiles: str
    formula: str
    source_atom_count: int
    explicit_hydrogen_count: int
    state: Literal["PENDING_ACCEPTANCE", "ACCEPTED"] = "PENDING_ACCEPTANCE"
    geometry_class: Literal["GENERATED_CONFORMER_NOT_OPTIMIZED"] = (
        "GENERATED_CONFORMER_NOT_OPTIMIZED"
    )
    candidate_artifact_id: UUID
    drawing_artifact_id: UUID
    provenance_id: UUID
