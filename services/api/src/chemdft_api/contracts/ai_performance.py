# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Operational model telemetry derived from existing run records; never research content."""

from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from .base import ContractModel

Count = Annotated[int, Field(ge=0)]


class LatencySummary(ContractModel):
    """Successful single-request durations only; None means too few or no observations."""

    observations: Count
    median_ms: int | None = None
    p95_ms: int | None = None
    max_ms: int | None = None


class RequestOutcomes(ContractModel):
    dispatched: Count
    succeeded: Count
    timeout: Count
    provider_error: Count
    unclassified_failure: Count
    not_dispatched: Count
    in_flight: Count


class TokenSummary(ContractModel):
    """Provider-reported counts only. Totals are None (UNKNOWN) when nothing was reported."""

    requests_reported: Count
    requests_unknown: Count
    input_tokens: int | None = None
    output_tokens: int | None = None


class ToolCallSummary(ContractModel):
    emitted: Count
    rejected_by_validation: Count
    outside_run_scope: Count
    conformance_rate: float | None = Field(default=None, ge=0, le=1)


class ProposalSummary(ContractModel):
    """Deterministic validation of calculation proposals. Not scientific correctness."""

    validated_for_approval: Count
    rejected_by_validation: Count
    validity_rate: float | None = Field(default=None, ge=0, le=1)
    # Repair behaviour (AI-6). A run's first proposal that reached approval without any earlier
    # refusal counts as first-attempt; refusals that preceded a later validated proposal count as
    # repairs; a run that ended PROPOSAL_NOT_REPAIRED counts as unrepaired. Reasons are the stable
    # refusal classes only (never any model or researcher text).
    accepted_first_attempt: Count = 0
    repairs_before_approval: Count = 0
    unrepaired_runs: Count = 0
    rejections_by_reason: dict[str, int] = Field(default_factory=dict, max_length=12)


class RunOutcomes(ContractModel):
    runs: Count
    succeeded: Count
    failed: Count
    canceled: Count
    other: Count


class ModelPerformanceRow(ContractModel):
    model_provider: Annotated[str, StringConstraints(max_length=64)]
    model_name: Annotated[str, StringConstraints(max_length=120)]
    # Offline fixture rows carry synthetic timings and counts: not evidence about any model.
    synthetic: bool
    requests: RequestOutcomes
    request_latency: LatencySummary
    tokens: TokenSummary
    tool_calls: ToolCallSummary
    proposals: ProposalSummary
    run_outcomes: RunOutcomes


class MetricDefinition(ContractModel):
    metric: str
    definition: str
    measured_in: str
    denominator: str
    missing_data: str


class PerformanceWindow(ContractModel):
    runs_considered: Count
    invocations_considered: Count
    # True when more runs exist than the bounded window; the newest runs are included.
    truncated: bool
    unattributed_runs: Count


class AIModelPerformanceView(ContractModel):
    scope: Literal["CURRENT_USER_OWN_RUNS"] = "CURRENT_USER_OWN_RUNS"
    window: PerformanceWindow
    rows: tuple[ModelPerformanceRow, ...] = Field(max_length=32)
    metric_definitions: tuple[MetricDefinition, ...] = Field(max_length=16)
    caveats: tuple[str, ...] = Field(max_length=12)
