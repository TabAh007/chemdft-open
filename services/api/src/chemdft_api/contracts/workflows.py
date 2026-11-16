# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""RW-3 workflow contracts: results overview, saved comparisons, reuse plan, queue status.

Everything here is a read-time projection of persisted records, except `SavedComparison*`, which
is the one thing RW-3 stores: a named *selection* plus a labelled historical snapshot. A saved
comparison never carries scientific authority of its own; the live effective state is recomputed
every time it is opened.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from .analysis import (
    CalculationComparisonOutput,
    ComparabilityLabel,
    EvidenceUse,
    StoredConditions,
    SummaryQuantity,
)
from .base import ContractModel
from .result_state import EffectiveResultState

# --------------------------------------------------------------------------------------------
# Saved comparisons
# --------------------------------------------------------------------------------------------

SavedComparisonStatus = Literal["CURRENT", "CHANGED", "UNAVAILABLE"]
SourceRevalidationStatus = Literal["UNCHANGED", "STATE_CHANGED", "SOURCE_CHANGED", "MISSING"]


class SavedComparisonCreate(ContractModel):
    name: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    note: Annotated[str, StringConstraints(max_length=500)] | None = None
    #: Ordered; the first result is the reference exactly as in a live comparison.
    result_ids: tuple[UUID, ...] = Field(min_length=2, max_length=8)


class SavedComparisonSource(ContractModel):
    """Identity and standing of one source result *when the comparison was saved*."""

    result_id: UUID
    calculation_id: UUID
    result_payload_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    provenance_record_id: UUID
    structure_version_id: UUID | None = None
    stored_authority: str
    stored_validation_state: str
    stored_verification_state: str
    source_lineage_validity: str
    evidence_use: EvidenceUse


class SavedComparisonSnapshot(ContractModel):
    schema_id: Literal["chemdft.saved-comparison-snapshot.v1"] = (
        "chemdft.saved-comparison-snapshot.v1"
    )
    saved_at: datetime
    #: Comparability label at save time; historical context, never current authority.
    overall: ComparabilityLabel | None = None
    sources: tuple[SavedComparisonSource, ...]


class SavedComparisonSummary(ContractModel):
    id: UUID
    project_id: UUID
    name: str
    note: str | None = None
    result_ids: tuple[UUID, ...]
    created_by: UUID
    created_at: datetime
    archived: bool = False
    schema_version: int = 1


class SourceRevalidation(ContractModel):
    result_id: UUID
    status: SourceRevalidationStatus
    detail: Annotated[str, StringConstraints(max_length=400)]
    saved: SavedComparisonSource
    #: Recomputed now; None only when the result no longer exists in this project.
    current_effective_state: EffectiveResultState | None = None
    current_evidence_use: EvidenceUse | None = None


class SavedComparisonOpenOutput(ContractModel):
    schema_id: Literal["chemdft.saved-comparison-open.v1"] = "chemdft.saved-comparison-open.v1"
    saved: SavedComparisonSummary
    #: Historical record of what was true at save time. Never present it as current.
    snapshot: SavedComparisonSnapshot
    revalidated_at: datetime
    status: SavedComparisonStatus
    revalidation: tuple[SourceRevalidation, ...]
    #: Live comparison computed from the current stored specifications and effective states;
    #: None when a source result is missing.
    comparison: CalculationComparisonOutput | None = None
    notice: str


class SavedComparisonListOutput(ContractModel):
    project_id: UUID
    #: NOT_ACTIVATED: the 0026 migration has not been applied to this database.
    availability: Literal["ACTIVE", "NOT_ACTIVATED"]
    comparisons: tuple[SavedComparisonSummary, ...] = ()


# --------------------------------------------------------------------------------------------
# Project results overview
# --------------------------------------------------------------------------------------------

Visualization = Literal[
    "trajectory",
    "ir-spectrum",
    "raman-spectrum",
    "uv-vis-spectrum",
    "molecular-orbitals",
    "electron-density",
    "thermochemistry",
    "conformers",
]


class OverviewRow(ContractModel):
    calculation_id: UUID
    calculation_state: str
    task: str
    engine: str | None = None
    engine_version: str | None = None
    method: str | None = None
    basis: str | None = None
    dispersion: str | None = None
    solvation: str | None = None
    charge: int | None = None
    multiplicity: int | None = None
    structure_id: UUID | None = None
    structure_name: str | None = None
    structure_version_id: UUID | None = None
    structure_revision: int | None = None
    formula_hill: str | None = None
    atom_count: int | None = None
    created_at: datetime
    updated_at: datetime
    job_id: UUID | None = None
    job_state: str | None = None
    #: Persisted failure code/diagnostic exactly as stored; None unless the job failed.
    failure: str | None = None
    result_id: UUID | None = None
    result_type: str | None = None
    quantities: tuple[SummaryQuantity, ...] = ()
    #: Stored thermochemical conditions (thermochemistry results only; None when not recorded).
    conditions: StoredConditions | None = None
    effective_state: EffectiveResultState | None = None
    #: NO_RESULT when nothing was published; HISTORICAL_ONLY when the effective state is inactive.
    evidence_use: EvidenceUse
    visualizations: tuple[Visualization, ...] = ()
    #: Export format keys available for this calculation right now.
    exports: tuple[str, ...] = ()
    saved_comparison_ids: tuple[UUID, ...] = ()


class OverviewStructure(ContractModel):
    structure_id: UUID
    name: str
    kind: str
    latest_version_id: UUID | None = None
    latest_revision: int | None = None
    formula_hill: str | None = None
    atom_count: int | None = None
    calculation_count: int = Field(ge=0)


class ResearchOverview(ContractModel):
    schema_id: Literal["chemdft.research-overview.v1"] = "chemdft.research-overview.v1"
    project_id: UUID
    generated_at: datetime
    rows: tuple[OverviewRow, ...]
    structures: tuple[OverviewStructure, ...]
    saved_comparisons: SavedComparisonListOutput
    #: True when the project holds more calculations than the overview returns.
    truncated: bool = False
    total_calculations: int = Field(ge=0)


class WithoutResultCounts(ContractModel):
    """Calculations with no published result, by what became of them (Jobs owns the detail)."""

    pending: int = Field(ge=0)
    failed: int = Field(ge=0)
    canceled: int = Field(ge=0)
    no_result: int = Field(ge=0)


class PublishedResultsFacets(ContractModel):
    """Distinct values across ALL of the project's published results, for building filter menus."""

    tasks: tuple[str, ...] = ()
    engines: tuple[str, ...] = ()


class PublishedResultsPage(ContractModel):
    """One page of the project's published scientific results.

    Every row is backed by a stored result record (a calculation with two results yields two
    rows). Counts are exact: `total_published` is every result in the project, `total_matching`
    every result matching the filters. Ordering is stable (sort value, then result id) and the
    cursor is keyset-based.
    """

    schema_id: Literal["chemdft.published-results.v1"] = "chemdft.published-results.v1"
    project_id: UUID
    generated_at: datetime
    rows: tuple[OverviewRow, ...]
    total_published: int = Field(ge=0)
    total_matching: int = Field(ge=0)
    #: Every calculation record in the project (published or not), never a count of results.
    total_calculations: int = Field(ge=0)
    without_result: WithoutResultCounts
    facets: PublishedResultsFacets
    saved_comparisons: SavedComparisonListOutput
    limit: int = Field(ge=1)
    sort: Literal["updated", "task", "engine", "formula", "energy"]
    direction: Literal["asc", "desc"]
    #: Opaque keyset cursor for the next page; None on the last page.
    next_cursor: str | None = None


# --------------------------------------------------------------------------------------------
# Calculation reuse
# --------------------------------------------------------------------------------------------


class ReuseCheck(ContractModel):
    check_id: Annotated[str, StringConstraints(min_length=1, max_length=48)]
    outcome: Literal["PASS", "WARNING", "FAIL"]
    detail: Annotated[str, StringConstraints(max_length=500)]


class ReusePlan(ContractModel):
    schema_id: Literal["chemdft.reuse-plan.v1"] = "chemdft.reuse-plan.v1"
    project_id: UUID
    source_calculation_id: UUID
    source_state: str
    task: str | None = None
    engine: str | None = None
    method: str | None = None
    basis: str | None = None
    charge: int | None = None
    multiplicity: int | None = None
    structure_version_id: UUID | None = None
    #: True only when no check FAILED. Submission re-runs every scientific gate regardless.
    can_reuse: bool
    checks: tuple[ReuseCheck, ...]
    #: Existing calculations in this project with the same structure version and an identical
    #: specification. Reuse creates a NEW calculation; it never replaces or edits these.
    equivalent_calculation_ids: tuple[UUID, ...] = ()
    #: The exact specification a new calculation would be submitted with; None when blocked.
    specification: dict | None = None
    notice: str


# --------------------------------------------------------------------------------------------
# Queue and worker status
# --------------------------------------------------------------------------------------------


class QueueCounts(ContractModel):
    queued: int = Field(ge=0)
    leased: int = Field(ge=0)
    running: int = Field(ge=0)
    cancel_requested: int = Field(ge=0)
    succeeded: int = Field(ge=0)
    failed: int = Field(ge=0)
    canceled: int = Field(ge=0)


class ActiveExecution(ContractModel):
    job_id: UUID
    calculation_id: UUID
    job_state: str
    worker_id: str | None = None
    lease_owner: str | None = None
    started_at: datetime | None = None
    heartbeat_at: datetime | None = None
    heartbeat_age_seconds: float | None = None
    heartbeat_status: Literal["FRESH", "STALE", "NOT_REPORTED"]


class QueueStatus(ContractModel):
    schema_id: Literal["chemdft.queue-status.v1"] = "chemdft.queue-status.v1"
    project_id: UUID
    server_time: datetime
    counts: QueueCounts
    oldest_queued_at: datetime | None = None
    active: tuple[ActiveExecution, ...] = ()
    heartbeat_stale_after_seconds: float
    #: Always False: ChemDFT reads persisted leases and heartbeats only. With no active lease the
    #: API cannot tell an idle worker from a stopped one.
    worker_process_observable: Literal[False] = False
    notice: str
