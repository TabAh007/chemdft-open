# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""RW-2 analysis contracts: result summaries, exports, calculation comparison, job diagnostics.

Everything here is a read-time projection of already persisted scientific records. Nothing in this
module is stored, hashed into a result payload, or able to change a result's authority.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from .base import ContractModel
from .result_state import EffectiveResultState

EvidenceUse = Literal["CURRENT", "HISTORICAL_ONLY", "UNKNOWN", "NO_RESULT"]
ExportFormatKey = Literal[
    "result-json",
    "trajectory-xyz",
    "spectrum-csv",
    "cube",
    "report",
    "reproducibility-bundle",
]
ComparabilityLabel = Literal[
    "DIRECTLY_COMPARABLE", "COMPARABLE_WITH_LIMITATIONS", "NOT_SCIENTIFICALLY_COMPARABLE"
]


# --------------------------------------------------------------------------------------------
# Result summary (shared by export and comparison)
# --------------------------------------------------------------------------------------------


class SummaryQuantity(ContractModel):
    key: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    label: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    value: float
    unit: Annotated[str, StringConstraints(min_length=1, max_length=32)]
    #: Quantities sharing a kind have the same physical definition (e.g. total electronic energy).
    kind: Annotated[str, StringConstraints(min_length=1, max_length=64)]


class StructureIdentity(ContractModel):
    structure_version_id: UUID | None = None
    #: "INPUT" geometry the engine started from, or "OPTIMIZED_FINAL" for an optimization result.
    geometry_role: Literal["INPUT", "OPTIMIZED_FINAL"] = "INPUT"
    formula_hill: str | None = None
    atom_count: int | None = Field(default=None, ge=0)
    element_sequence: tuple[Annotated[str, StringConstraints(max_length=2)], ...] = ()


class StoredConditions(ContractModel):
    """Thermochemical conditions exactly as stored in the result payload (never defaulted or computed)."""

    temperature_k: float
    pressure_pa: float


class ResultSummary(ContractModel):
    result_id: UUID
    calculation_id: UUID
    result_type: str
    task: str
    engine: str | None = None
    engine_version: str | None = None
    method: str | None = None
    basis: str | None = None
    dispersion: str | None = None
    solvation: str | None = None
    charge: int | None = None
    multiplicity: int | None = None
    structure: StructureIdentity
    quantities: tuple[SummaryQuantity, ...] = ()
    #: Stored temperature and pressure of a thermochemistry result; None for every other result type
    #: and whenever the payload does not record both.
    conditions: StoredConditions | None = None
    created_at: datetime
    effective_state: EffectiveResultState | None = None
    evidence_use: EvidenceUse


# --------------------------------------------------------------------------------------------
# Export catalog
# --------------------------------------------------------------------------------------------


class ExportVariant(ContractModel):
    key: Annotated[str, StringConstraints(min_length=1, max_length=96)]
    label: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    detail: Annotated[str, StringConstraints(max_length=400)] | None = None


class ExportFormatOption(ContractModel):
    format: ExportFormatKey
    label: str
    available: bool
    media_type: str
    file_extension: str
    unsupported_reason: str | None = None
    variants: tuple[ExportVariant, ...] = ()


class CalculationExportCatalog(ContractModel):
    schema_id: Literal["chemdft.export-catalog.v1"] = "chemdft.export-catalog.v1"
    project_id: UUID
    calculation_id: UUID
    result_id: UUID | None = None
    evidence_use: EvidenceUse
    formats: tuple[ExportFormatOption, ...]


# --------------------------------------------------------------------------------------------
# Multi-calculation comparison
# --------------------------------------------------------------------------------------------


class ComparisonRuleOutcome(ContractModel):
    rule_id: Annotated[str, StringConstraints(min_length=1, max_length=48)]
    outcome: Literal["PASS", "LIMITATION", "FAIL"]
    detail: Annotated[str, StringConstraints(max_length=400)]


class ComparisonDelta(ContractModel):
    quantity_kind: str
    label: str
    reference_value: float
    other_value: float
    unit: str
    #: other minus reference, in the quantity's native unit. Only present when the label allows it.
    delta: float | None = None
    delta_kcal_per_mol: float | None = None
    delta_kj_per_mol: float | None = None
    assumptions: tuple[str, ...] = ()


class GeometryRelation(ContractModel):
    relation: Literal[
        "IDENTICAL_STRUCTURE_VERSION",
        "SAME_ATOM_ORDER_DIFFERENT_COORDINATES",
        "NOT_ATOM_ALIGNED",
        "UNAVAILABLE",
    ]
    rmsd_angstrom: float | None = None
    note: Annotated[str, StringConstraints(max_length=300)] | None = None


class CalculationPairComparison(ContractModel):
    reference_result_id: UUID
    other_result_id: UUID
    label: ComparabilityLabel
    rules: tuple[ComparisonRuleOutcome, ...]
    limitations: tuple[str, ...]
    blockers: tuple[str, ...]
    geometry: GeometryRelation
    deltas: tuple[ComparisonDelta, ...]
    #: CURRENT only when both results are currently eligible; otherwise historical context only.
    evidence_standing: Literal["CURRENT", "HISTORICAL_CONTEXT"]


class CalculationComparisonOutput(ContractModel):
    schema_id: Literal["chemdft.calculation-comparison.v1"] = "chemdft.calculation-comparison.v1"
    project_id: UUID
    reference_result_id: UUID
    results: tuple[ResultSummary, ...]
    pairs: tuple[CalculationPairComparison, ...]
    overall: ComparabilityLabel
    delta_convention: Literal["other minus reference"] = "other minus reference"
    conversion_factors: dict[str, float]
    agreement_is_not_verification: Literal[True] = True
    notice: str


class ComparisonCandidate(ContractModel):
    summary: ResultSummary


class ComparisonCandidateListOutput(ContractModel):
    project_id: UUID
    candidates: tuple[ComparisonCandidate, ...]


# --------------------------------------------------------------------------------------------
# Job diagnostics
# --------------------------------------------------------------------------------------------


class DiagnosticArtifact(ContractModel):
    artifact_id: UUID
    kind: str
    format_identifier: str
    media_type: str
    size_bytes: int = Field(ge=0)
    sha256: str
    #: Only text-like engine logs may be read inline; everything else is download-only.
    log_readable: bool


class DiagnosticAttempt(ContractModel):
    attempt_id: UUID
    attempt_number: int = Field(ge=1)
    state: str
    worker_id: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    failure_code: str | None = None
    diagnostic: str | None = None
    engine_name: str | None = None
    engine_version: str | None = None
    artifacts: tuple[DiagnosticArtifact, ...] = ()


class DiagnosticExecution(ContractModel):
    execution_id: UUID
    attempt_id: UUID | None = None
    state: str
    provider: str
    worker_id: str | None = None
    started_at: datetime | None = None
    heartbeat_at: datetime | None = None
    finished_at: datetime | None = None
    failure_code: str | None = None
    diagnostic: str | None = None
    created_at: datetime | None = None


class DiagnosticLease(ContractModel):
    owner: str
    state: str
    issued_at: datetime
    expires_at: datetime
    heartbeat_deadline_at: datetime
    heartbeat_at: datetime | None = None


class JobDiagnostics(ContractModel):
    schema_id: Literal["chemdft.job-diagnostics.v1"] = "chemdft.job-diagnostics.v1"
    project_id: UUID
    job_id: UUID
    calculation_id: UUID
    job_state: str
    #: Server clock at read time so heartbeat age never depends on the browser clock.
    server_time: datetime
    executions: tuple[DiagnosticExecution, ...]
    attempts: tuple[DiagnosticAttempt, ...]
    active_lease: DiagnosticLease | None = None
    #: Seconds since the newest heartbeat of the active execution; None when none was recorded.
    heartbeat_age_seconds: float | None = None
    heartbeat_status: Literal["FRESH", "STALE", "NOT_APPLICABLE", "NOT_REPORTED"]
    heartbeat_stale_after_seconds: float
    #: Native engines do not publish trustworthy percent-complete; this is always False.
    progress_reported: Literal[False] = False
    progress_note: str
    #: True once any engine log has been persisted for an attempt.
    logs_available: bool


class JobLogOutput(ContractModel):
    artifact_id: UUID
    attempt_id: UUID | None = None
    kind: str
    media_type: str
    size_bytes: int = Field(ge=0)
    returned_bytes: int = Field(ge=0)
    truncated: bool
    sha256: str
    text: str
