# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Versioned exact context for a bounded, explicitly selected planning task."""

from typing import Literal
from uuid import UUID

from .ai_foundation import ProductContext
from .base import ContractModel, Sha256
from .catalog import StructureVersionDetail


class PlanningElectronicState(ContractModel):
    authority: Literal["STRUCTURE_VERSION", "USER_DECLARED_XYZ", "CALCULATION_USER_DECLARED"]
    structure_version_id: UUID
    source_artifact_id: UUID | None = None
    source_sha256: Sha256 | None = None
    structure_provenance_id: UUID | None = None


class EnergyPlanningContext(ProductContext):
    context_version: Literal["1.1.0"] = "1.1.0"
    planning_profile: Literal["PYSCF_ENERGY_PROPOSAL"] = "PYSCF_ENERGY_PROPOSAL"
    scientific_input: StructureVersionDetail
    electronic_state_authority: PlanningElectronicState
    execution_requires_researcher_approval: Literal[True] = True


class PeriodicEnergyPlanningContext(ProductContext):
    context_version: Literal["1.1.0"] = "1.1.0"
    planning_profile: Literal["PERIODIC_ENERGY_PROPOSAL"] = "PERIODIC_ENERGY_PROPOSAL"
    scientific_input: StructureVersionDetail
    electronic_state_authority: PlanningElectronicState
    execution_requires_researcher_approval: Literal[True] = True


class StructureEditPlanningContext(ProductContext):
    context_version: Literal["1.1.0"] = "1.1.0"
    planning_profile: Literal["STRUCTURE_EDIT_PROPOSAL"] = "STRUCTURE_EDIT_PROPOSAL"
    scientific_input: StructureVersionDetail
    execution_requires_researcher_approval: Literal[True] = True
