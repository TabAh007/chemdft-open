# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Versioned, provider-neutral advisory contract. IDs and keys, never generated advice."""

from typing import Literal

from .base import ContractModel

ActionId = Literal[
    "structure.draw",
    "structure.import",
    "structure.inspect",
    "structure.edit",
    "structure.inspect_unit_cell",
    "structure.build_supercell",
    "calculation.single_point",
    "calculation.optimize",
    "calculation.orbitals",
    "spectra.predict_ir",
    "spectra.predict_raman",
    "spectra.predict_uv_vis",
    "spectra.upload_experimental",
    "spectra.inspect_experimental",
    "spectra.process_experimental",
    "spectra.compare",
    "spectra.inspect_computed",
    "electronic.inspect_orbitals",
    "electronic.inspect_homo_lumo",
    "electronic.inspect_density",
    "electronic.inspect_esp",
    "thermochemistry.calculate",
    "thermochemistry.inspect",
    "evidence.import_document",
    "evidence.import_calculation",
    "evidence.inspect_provenance",
    "jobs.review",
]
GoalId = Literal[
    "optimize",
    "energy",
    "ir",
    "raman",
    "uv_vis",
    "orbitals",
    "thermochemistry",
    "compare",
    "crystal",
]
Launch = Literal[
    "draw",
    "structure_import",
    "inspect",
    "edit",
    "cell",
    "supercell",
    "energy",
    "optimization",
    "orbitals",
    "ir",
    "raman",
    "uvvis",
    "spectrum_import",
    "experimental",
    "compare",
    "spectra",
    "mo",
    "density",
    "esp",
    "thermochemistry",
    "document_import",
    "calculation_import",
    "provenance",
    "jobs",
]
ReasonCode = Literal[
    "structure_missing",
    "coordinates_3d_required",
    "charge_required",
    "multiplicity_required",
    "molecule_required",
    "lattice_required",
    "crystal_required",
    "periodic_compute_unsupported",
    "optimization_required",
    "worker_unavailable",
    "optimizer_unavailable",
    "job_in_progress",
    "editor_required",
    "template_sealed",
    "frequency_required",
    "imaginary_frequencies",
    "stationarity_unproven",
    "frequency_geometry_mismatch",
    "closed_shell_required",
    "matching_level_required",
    "orbitals_required",
    "computed_spectrum_required",
    "experimental_spectrum_required",
    "spectrum_association_required",
    "experimental_peaks_required",
    "matching_spectrum_type_required",
    "thermochemistry_required",
    "provenance_required",
    "job_required",
    "history_limit_reached",
]


class NavigatorTarget(ContractModel):
    route: Literal["workspace", "jobs"] = "workspace"
    launch: Launch
    selection_kind: (
        Literal["structureVersion", "calculationResult", "experimentalSpectrum"] | None
    ) = None
    selection_id: str | None = None
    source_id: str | None = None


class NavigatorReason(ContractModel):
    code: ReasonCode
    message_key: str


class NavigatorAction(ContractModel):
    action_id: ActionId
    category: str
    title_key: str
    description_key: str
    required_capability: Literal["read", "write"]
    minimum_role_key: str
    required_facts: tuple[str, ...]
    conflicting_facts: tuple[str, ...]
    resulting_fact: str
    goal_ids: tuple[GoalId, ...]
    target: NavigatorTarget | None = None
    reasons: tuple[NavigatorReason, ...] = ()


class NavigatorHave(ContractModel):
    state_id: str
    label_key: str
    detail: str | None = None


class NavigatorGoal(ContractModel):
    goal_id: GoalId
    title_key: str
    satisfied: bool


class NavigatorFactsSummary(ContractModel):
    sealed: bool = False
    structure_version_id: str | None = None
    structure_id: str | None = None
    structure_name: str | None = None
    structure_type: Literal["molecule", "crystal"] | None = None
    atom_count: int = 0
    coordinate_dimensionality: int | None = None
    charge: int | None = None
    multiplicity: int | None = None
    optimized: bool = False
    valid_frequency: bool = False
    computed_spectrum_types: tuple[str, ...] = ()
    experimental_spectrum_types: tuple[str, ...] = ()
    running_jobs: int = 0
    failed_jobs: int = 0
    can_write: bool = False
    history_complete: bool = True


class NavigatorContext(ContractModel):
    goal: GoalId | None
    have_ids: tuple[str, ...]
    next_ids: tuple[ActionId, ...]
    blocked: dict[ActionId, tuple[ReasonCode, ...]]


class NavigatorState(ContractModel):
    version: Literal[1] = 1
    project_id: str
    goal: GoalId | None
    have: tuple[NavigatorHave, ...]
    next: tuple[NavigatorAction, ...]
    blocked: tuple[NavigatorAction, ...]
    goals: tuple[NavigatorGoal, ...]
    facts_summary: NavigatorFactsSummary
    notices: tuple[str, ...] = ()
    context: NavigatorContext
