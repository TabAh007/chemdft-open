# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from ..ai.budgets import (
    DEFAULT_MAX_INPUT_TOKENS,
    DEFAULT_MAX_MODEL_CALLS,
    DEFAULT_MAX_OUTPUT_TOKENS,
    DEFAULT_MAX_TOOL_CALLS,
)
from .ai_foundation import ProductSelection
from .base import ContractModel, ContractVersion, JsonScalar
from .catalog import ComputeEstimate, StructureSummary
from .phase7 import EvidenceCandidate


class AICitation(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    citation_type: Literal["DOCUMENT", "CALCULATION", "STRUCTURE", "DATASET", "PROJECT_RECORD"]
    entity_id: UUID
    label: str
    reference_text: str
    page_number: int | None = None
    source_anchor_id: UUID | None = None
    citation_id: str | None = None
    knowledge_chunk_id: UUID | None = None
    source_record_type: str | None = None


class AIEvidenceView(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    citation_id: str
    knowledge_item_id: UUID
    knowledge_chunk_id: UUID
    source_title: str
    source_type: str
    source_class: str | None = None
    verification_state: str | None = None
    passage: str
    document_id: UUID | None = None
    page_number: int | None = None
    source_anchor_id: UUID | None = None
    section_path: str | None = None
    paragraph_ordinal: int | None = None
    available: bool = True


class AIMessageView(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    conversation_id: UUID
    run_id: UUID | None = None
    role: Literal["user", "assistant", "system"]
    content: str
    citations: tuple[AICitation, ...] = Field(default=(), max_length=100)
    evidence: tuple[AIEvidenceView, ...] = Field(default=(), max_length=25)
    evidence_status: Literal["SUPPORTED", "PARTIAL", "INSUFFICIENT_EVIDENCE"] | None = None
    evidence_note: str | None = None
    created_at: datetime


class ProposalSampling(ContractModel):
    """The sampling settings the proposing model call actually used (recorded, not requested)."""

    source: Literal["MODEL_CARD_PROFILE", "SERVER_DEFAULT"]
    temperature: float
    top_p: float | None = None
    chat_template_kwargs: dict[str, bool] | None = None


class ProposalProvenance(ContractModel):
    """Which model proposed a calculation, how it was selected and how many repairs it needed."""

    provider: str
    model: str
    eligibility: Literal["STANDARD", "DEVELOPMENT", "NONE"] | None = None
    sampling: ProposalSampling | None = None
    repair_attempts: int = Field(default=0, ge=0)


class RequestMatchItem(ContractModel):
    """One scientific parameter: what the researcher asked for against what was proposed."""

    parameter: str
    outcome: Literal["MATCH", "MISMATCH", "NOT_SPECIFIED", "AMBIGUOUS"]
    requested: str | int | None = None
    proposed: str | int | bool | None = None
    requested_available: bool | None = None
    mention: str | None = None
    excluded: bool = False


class BlockerIssue(ContractModel):
    code: str
    field: str | None = None
    message: str
    requested: str | int | None = None
    proposed: str | int | bool | None = None
    allowed: tuple[str, ...] = Field(default=(), max_length=8)


class ProposalBlocker(ContractModel):
    """Why no valid proposal reached approval: the last refusal, server-authored and value-free."""

    code: str
    summary: str
    issues: tuple[BlockerIssue, ...] = Field(default=(), max_length=8)
    next_step: str
    attempts: int = Field(ge=1)


class AIApprovalView(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    run_id: UUID
    tool_name: str
    tool_version: str
    action_fingerprint: str
    scientific_summary: str
    project_id: UUID | None = None
    normalized_arguments: dict[str, object] = Field(default_factory=dict)
    creates_or_changes: str = "Registered product action only"
    estimated_compute: ComputeEstimate | None = None
    proposal_provenance: ProposalProvenance | None = None
    request_match: tuple[RequestMatchItem, ...] = Field(default=(), max_length=9)
    reason: str
    status: Literal["PENDING", "APPROVED", "REJECTED", "EXPIRED"]
    expires_at: datetime
    created_at: datetime


class AIRunStepView(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    step_number: int
    step_type: str
    status: str
    tool_name: str | None = None
    tool_version: str | None = None
    summary: str | None = None
    error_code: str | None = None
    error_detail: str | None = None
    created_at: datetime
    finished_at: datetime | None = None


class ResearcherGateView(ContractModel):
    """A pending human review the run is suspended on (never completed by the AI)."""

    schema_version: ContractVersion = "1.0.0"
    step_id: UUID
    status: Literal["WAITING"] = "WAITING"
    candidate_id: UUID
    expected_representation_id: UUID
    source_document_id: UUID | None = None
    review_reason: str
    requested_at: datetime


class AIRunView(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    conversation_id: UUID
    project_id: UUID
    status: Literal[
        "CREATED",
        "PLANNING",
        "WAITING_FOR_APPROVAL",
        "EXECUTING",
        "WAITING_FOR_CALCULATION",
        "SUCCEEDED",
        "FAILED",
        "CANCELED",
        "PAUSED",
    ]
    current_step: int
    max_steps: int
    waiting_calculation_id: UUID | None = None
    pending_approval: AIApprovalView | None = None
    pending_researcher_gate: ResearcherGateView | None = None
    blocker: ProposalBlocker | None = None
    steps: tuple[AIRunStepView, ...] = Field(default=(), max_length=100)
    error_code: str | None = None
    error_detail: str | None = None
    ai_provider: str | None = None
    ai_model: str | None = None
    budget: dict[str, object] | None = None
    created_at: datetime
    updated_at: datetime


class AIRunEventView(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    sequence: int
    run_id: UUID
    project_id: UUID
    event_type: str
    occurred_at: datetime
    summary: str
    payload: dict[str, object] = Field(default_factory=dict)


class AIRunEventsOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    events: tuple[AIRunEventView, ...] = Field(default=(), max_length=1000)


class AIConversationSummary(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    title: str | None = None
    created_at: datetime
    updated_at: datetime


class AIConversationDetail(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    conversation: AIConversationSummary
    messages: tuple[AIMessageView, ...] = Field(default=(), max_length=10_000)
    latest_run: AIRunView | None = None


class AIConversationListOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    conversations: tuple[AIConversationSummary, ...] = Field(default=(), max_length=1000)


class CreateConversationInput(ContractModel):
    title: Annotated[str, StringConstraints(min_length=1, max_length=255)] | None = None


class AIRunLimitsInput(ContractModel):
    """Optional lower limits for a new run; never an allocation or quota increase."""

    max_input_tokens: int | None = Field(
        default=None, strict=True, ge=1, le=DEFAULT_MAX_INPUT_TOKENS
    )
    max_output_tokens: int | None = Field(
        default=None, strict=True, ge=1, le=DEFAULT_MAX_OUTPUT_TOKENS
    )
    max_model_calls: int | None = Field(default=None, strict=True, ge=1, le=DEFAULT_MAX_MODEL_CALLS)
    max_tool_calls: int | None = Field(default=None, strict=True, ge=1, le=DEFAULT_MAX_TOOL_CALLS)


class PostMessageInput(ProductSelection):
    content: Annotated[str, StringConstraints(min_length=1, max_length=10000)]
    mode: Literal["STANDARD", "EVIDENCE", "CHAT"] = "STANDARD"
    planning_profile: Literal[
        "GENERAL",
        "PYSCF_ENERGY_PROPOSAL",
        "STRUCTURE_EDIT_PROPOSAL",
        "PERIODIC_ENERGY_PROPOSAL",
    ] = "GENERAL"
    selected_structure_id: UUID | None = None
    selected_structure_version_id: UUID | None = None
    selected_document_id: UUID | None = None
    current_view: Annotated[str, StringConstraints(max_length=500)] | None = None
    run_limits: AIRunLimitsInput | None = None


# A molfile starts with a blank title line; whitespace stripping would shift every later line.
Molfile = Annotated[str, StringConstraints(strip_whitespace=False, max_length=200_000)]


class DrawHistoryTurn(ContractModel):
    role: Literal["user", "assistant"]
    content: Annotated[str, StringConstraints(max_length=600)]


class DrawInput(ContractModel):
    """One DRAW request: the researcher's words plus the current drawing as a molfile."""

    schema_version: ContractVersion = "1.0.0"
    content: Annotated[str, StringConstraints(min_length=1, max_length=1000)]
    molfile: Molfile | None = None
    previous_molfile: Molfile | None = None
    history: tuple[DrawHistoryTurn, ...] = Field(default=(), max_length=6)


class DrawClarifyOption(ContractModel):
    label: str
    message: str


class DrawClarify(ContractModel):
    question: str
    options: tuple[DrawClarifyOption, ...] = Field(max_length=4)


class DrawStepView(ContractModel):
    index: int
    op: dict[str, JsonScalar | list[int]]
    ok: bool
    error: str | None = None
    suggestion: str | None = None
    molfile: Molfile | None = None
    smiles: str | None = None
    formula: str | None = None
    new_atom_numbers: tuple[int, ...] = ()
    atom_count: int = 0
    description: str = ""


class DrawFinal(ContractModel):
    molfile: Molfile
    smiles: str
    formula: str
    atom_count: int


class DrawProposal(ContractModel):
    label: str
    smiles: str
    note: str


class DrawReferenceCheck(ContractModel):
    """The drawing matched the built-in table of common molecules (partial safeguard)."""

    name: str
    formula: str
    note: str


class DrawResponse(ContractModel):
    """Validated result of a DRAW request. Schematic only: never a scientific value."""

    schema_version: ContractVersion = "1.0.0"
    status: Literal[
        "OK", "PARTIAL", "NEEDS_ATTENTION", "REJECTED", "CLARIFY", "REFUSED", "NO_CHANGE", "ERROR"
    ]
    label: Literal["AI-drafted · schematic"] = "AI-drafted · schematic"
    reply: str
    steps: tuple[DrawStepView, ...] = Field(default=(), max_length=100)
    final: DrawFinal | None = None
    clarify: DrawClarify | None = None
    reference_check: DrawReferenceCheck | None = None
    proposals: tuple[DrawProposal, ...] = ()
    warnings: tuple[str, ...] = ()
    # Facts, not problems (for example "6 molecules" when six were asked for).
    info: tuple[str, ...] = ()
    error_code: str | None = None
    error: str | None = None
    repaired: bool = False
    run_id: UUID | None = None
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


class ApprovalDecisionInput(ContractModel):
    decision: Literal["APPROVE", "REJECT"]
    decision_notes: Annotated[str, StringConstraints(max_length=1000)] | None = None


# Tool-specific inputs and outputs for Tool Registry
class StructureListInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"


class StructureListOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    structures: tuple[StructureSummary, ...] = Field(max_length=10_000)


class StructureGetInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    structure_id: UUID


class StructureVersionGetInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    structure_id: UUID
    version_id: UUID


class DocumentListInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"


class DocumentGetInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    document_id: UUID


class DocumentEvidenceListInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    document_id: UUID | None = None


class DocumentEvidenceListOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    evidence: tuple[EvidenceCandidate, ...] = Field(default=(), max_length=10_000)


class ExperimentListInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"


class DatasetGetInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    dataset_id: UUID


class CalculationCancelInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    calculation_id: UUID


class ComputeEstimateInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    specification: dict[str, object]
    provider_preference: Literal["AUTO", "LOCAL", "CLOUD"] = "AUTO"


class ComputeEstimateOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    estimate: ComputeEstimate
