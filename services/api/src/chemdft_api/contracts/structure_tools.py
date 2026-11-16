# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from .base import ContractModel, ContractVersion


class StructureEditOperation(ContractModel):
    op_type: Literal["add_atom", "remove_atom", "move_atom", "replace_element"]
    index: int | None = None
    element: str | None = None
    coordinates: tuple[float, float, float] | None = None


class AddedAtomDiff(ContractModel):
    index: int
    element: str
    coordinates: tuple[float, float, float]


class RemovedAtomDiff(ContractModel):
    index: int
    element: str
    coordinates: tuple[float, float, float] | None = None


class MovedAtomDiff(ContractModel):
    index: int
    element: str
    old_coordinates: tuple[float, float, float] | None = None
    new_coordinates: tuple[float, float, float]


class ReplacedElementDiff(ContractModel):
    index: int
    old_element: str
    new_element: str


class StructureEditDiffView(ContractModel):
    parent_version_id: UUID
    formula_before: str
    formula_after: str
    atom_count_before: int
    atom_count_after: int
    atoms_added: tuple[AddedAtomDiff, ...] = ()
    atoms_removed: tuple[RemovedAtomDiff, ...] = ()
    atoms_moved: tuple[MovedAtomDiff, ...] = ()
    elements_replaced: tuple[ReplacedElementDiff, ...] = ()
    min_distance_before: float | None = None
    min_distance_after: float | None = None
    distance_warnings: tuple[str, ...] = ()


class StructureEditProposeInput(ContractModel):
    structure_version_id: UUID
    operations: tuple[StructureEditOperation, ...] = Field(min_length=1, max_length=100)
    reason: Annotated[str, StringConstraints(min_length=1, max_length=500)] | None = None
    diff: StructureEditDiffView | None = None


class StructureEditProposeOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    proposal_id: UUID | None = None
    structure_id: UUID
    parent_version_id: UUID
    diff: StructureEditDiffView
    operations: tuple[StructureEditOperation, ...] = ()
    status: Literal["PROPOSED", "APPLIED"] = "PROPOSED"
    created_version_id: UUID | None = None
