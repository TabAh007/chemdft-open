# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from .ai import AIApprovalView
from .base import ContractModel, ContractVersion
from .result_state import EffectiveResultState

InvestigationStatus = Literal[
    "DRAFT",
    "PLANNED",
    "WAITING_FOR_APPROVAL",
    "ACTIVE",
    "WAITING_FOR_RESULT",
    "WAITING_FOR_USER",
    "PAUSED",
    "COMPLETED",
    "FAILED",
    "CANCELED",
]
HypothesisStatus = Literal["OPEN", "SUPPORTED", "NOT_SUPPORTED", "INCONCLUSIVE"]
InvestigationDecisionKind = Literal[
    "COMPLETE",
    "PROPOSE_STEP",
    "ASSESS_AND_COMPLETE",
    "ASSESS_AND_CONTINUE",
    "REQUEST_USER_INPUT",
    "INCONCLUSIVE",
]


class InvestigationDecision(ContractModel):
    """Strict, untrusted model output for one persisted reasoning cycle."""

    decision: InvestigationDecisionKind
    rationale_summary: Annotated[str, StringConstraints(min_length=1, max_length=10_000)]
    hypothesis_assessment: HypothesisStatus | None = None
    proposed_action: dict[str, object] | None = None
    cited_observation_ids: tuple[UUID, ...] = ()
    user_question: Annotated[str, StringConstraints(max_length=2_000)] | None = None


class InvestigationPolicy(ContractModel):
    max_steps: int = Field(default=10, ge=1, le=50)
    max_calculations: int = Field(default=3, ge=0, le=20)
    max_ai_calls: int = Field(default=10, ge=0, le=100)
    max_ai_input_tokens: int = Field(default=60_000, ge=0, le=2_000_000)
    max_ai_output_tokens: int = Field(default=12_000, ge=0, le=200_000)
    max_elapsed_seconds: int = Field(default=3600, ge=1, le=86_400)
    max_compute_minor_units: int = Field(default=0, ge=0, le=10_000_000_000)
    allowed_tool_classes: tuple[str, ...] = Field(
        default=("read_only", "scientific.expensive"), max_length=32
    )
    approval_required_for_expensive: bool = True


class CreateInvestigationInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    title: Annotated[str, StringConstraints(min_length=1, max_length=255)]
    objective: Annotated[str, StringConstraints(min_length=1, max_length=10_000)]
    policy: InvestigationPolicy = InvestigationPolicy()


class CreateHypothesisInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    statement: Annotated[str, StringConstraints(min_length=1, max_length=10_000)]
    source_class: Literal["AI_HYPOTHESIS", "USER"] = "USER"


class CreatePlanStepInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    action: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    intent: Annotated[str, StringConstraints(min_length=1, max_length=10_000)]
    approval_class: Literal["NONE", "USER_REQUIRED", "EXPENSIVE"] = "NONE"
    estimated_cost: dict[str, object] = Field(default_factory=dict)
    tool_arguments: dict[str, object] = Field(default_factory=dict)
    dependencies: tuple[UUID, ...] = ()


class CreatePlanInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    steps: tuple[CreatePlanStepInput, ...] = Field(min_length=1, max_length=50)


class CreateObservationInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    source_entity_type: Literal[
        "CALCULATION_RESULT", "EXPERIMENTAL_DATASET", "EVIDENCE_CANDIDATE", "DIGITIZED_DATASET"
    ]
    source_entity_id: UUID
    source_class: Literal["CALCULATED", "EXPERIMENTAL", "EXTRACTED", "DIGITIZED"]
    summary: Annotated[str, StringConstraints(min_length=1, max_length=10_000)]
    step_id: UUID | None = None
    citations: tuple[dict[str, object], ...] = Field(default=(), max_length=32)


class CreateAssessmentInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    hypothesis_id: UUID
    outcome: HypothesisStatus
    rationale: Annotated[str, StringConstraints(min_length=1, max_length=10_000)]
    observation_ids: tuple[UUID, ...] = Field(min_length=1, max_length=100)


class InvestigationGetInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    investigation_id: UUID


class InvestigationUserInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    answer: Annotated[str, StringConstraints(min_length=1, max_length=10_000)]


class InvestigationHypothesisView(ContractModel):
    historical_status: HypothesisStatus | None = None
    id: UUID
    statement: str
    source_class: Literal["AI_HYPOTHESIS", "USER"]
    status: HypothesisStatus
    support_refs: tuple[dict[str, object], ...] = ()
    contradiction_refs: tuple[dict[str, object], ...] = ()
    created_at: datetime


class InvestigationStepView(ContractModel):
    id: UUID
    step_number: int
    action: str
    intent: str
    dependencies: tuple[UUID, ...] = ()
    status: str
    approval_class: str
    estimated_cost: dict[str, object]
    result_ref: dict[str, object] | None = None
    failure: dict[str, object] | None = None


class InvestigationPlanView(ContractModel):
    id: UUID
    revision: int
    status: str
    steps: tuple[InvestigationStepView, ...] = ()
    created_at: datetime


class InvestigationObservationView(ContractModel):
    current: bool = True
    effective_result_state: EffectiveResultState | None = None
    id: UUID
    source_entity_type: str
    source_entity_id: UUID
    source_class: str
    summary: str
    citations: tuple[dict[str, object], ...] = ()
    created_at: datetime


class InvestigationAssessmentView(ContractModel):
    current: bool = True
    id: UUID
    hypothesis_id: UUID
    outcome: HypothesisStatus
    rationale: str
    observation_ids: tuple[UUID, ...]
    created_at: datetime


class InvestigationView(ContractModel):
    stored_status: InvestigationStatus | None = None
    current_evidence_valid: bool = True
    inactive_observation_ids: tuple[UUID, ...] = ()
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    title: str
    objective: str
    status: InvestigationStatus
    policy: InvestigationPolicy
    budget: dict[str, object]
    stop_conditions: tuple[dict[str, object], ...]
    limit_reason: str | None = None
    started_at: datetime | None = None
    pending_approval_id: UUID | None = None
    pending_approval: AIApprovalView | None = None
    user_input: dict[str, object] | None = None
    hypotheses: tuple[InvestigationHypothesisView, ...] = ()
    plans: tuple[InvestigationPlanView, ...] = ()
    observations: tuple[InvestigationObservationView, ...] = ()
    assessments: tuple[InvestigationAssessmentView, ...] = ()
    created_at: datetime
    updated_at: datetime


class InvestigationListOutput(ContractModel):
    investigations: tuple[InvestigationView, ...]
