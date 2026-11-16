# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""PF-7 server-owned product context. No secret or artifact bytes in this contract."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints, model_serializer

from .ai_models import AIModelCapability
from .base import ContractModel
from .billing import BYOKStatusView
from .navigator import ActionId, GoalId, ReasonCode
from .provenance import ProvenanceClass, VerificationState
from .results import ResultAuthority

AIProvider = Literal["openai", "openrouter", "huggingface", "nvidia", "moonshot", "fake"]
AIMode = Literal["NONE", "MANAGED", "BYOK"]


class AIPreferencesInput(ContractModel):
    mode: AIMode
    provider: AIProvider
    model: Annotated[str, StringConstraints(min_length=1, max_length=120)]


class AIProviderOption(ContractModel):
    provider: AIProvider
    models: tuple[str, ...] = Field(max_length=3)
    local_test_only: bool = False


class AIAvailability(ContractModel):
    mode: AIMode
    provider: AIProvider
    model: str
    available: bool
    error_code: str | None = None
    managed_enabled: bool
    byok_enabled: bool
    secret_storage_available: bool
    local_test_only: bool = False
    allowance_status: Literal["NOT_APPLICABLE", "AVAILABLE", "EXCEEDED", "DISABLED"]


class AISettingsView(ContractModel):
    preferences: AIPreferencesInput
    availability: AIAvailability
    providers: tuple[AIProviderOption, ...] = Field(max_length=4)
    credentials: tuple[BYOKStatusView, ...] = Field(max_length=3)
    model_capabilities: tuple[AIModelCapability, ...] = Field(default=(), max_length=32)


class ProductSelection(ContractModel):
    """IDs are hints; no convergence, role, numeric value, or allowed-tool claim accepted."""

    selected_structure_id: UUID | None = None
    selected_structure_version_id: UUID | None = None
    selected_result_id: UUID | None = None
    selected_document_id: UUID | None = None
    selected_spectrum_id: UUID | None = None
    # Additive (0.0.18). Hints like the ids above: the server checks each belongs to the
    # project, ignores any that does not (neutral note, no leak) and grounds stored records.
    compared_result_ids: tuple[UUID, ...] | None = Field(default=None, max_length=8)
    selected_claim_id: UUID | None = None
    selected_job_id: UUID | None = None
    goal: GoalId | None = None
    current_view: Annotated[str, StringConstraints(max_length=500)] | None = None

    @model_serializer(mode="wrap")
    def _omit_unset_ids(self, handler):
        """The 0.0.18 id fields are absent when not given, so older payloads stay byte-identical."""
        data = handler(self)
        for key in ("compared_result_ids", "selected_claim_id", "selected_job_id"):
            if data.get(key) is None:
                data.pop(key, None)
        return data


class GroundingFact(ContractModel):
    """A stored record the researcher is looking at (claim, job or compared result), 0.0.18."""

    kind: Literal["claim", "job", "compared_result"]
    entity_id: UUID
    label: Annotated[str, StringConstraints(max_length=200)]
    evidence_class: Annotated[str, StringConstraints(max_length=80)]
    verification_note: Annotated[str, StringConstraints(max_length=120)] | None = None
    facts: dict[str, str | float | int | bool | None] = Field(default_factory=dict, max_length=20)


class ProductResource(ContractModel):
    entity_type: Literal[
        "structure.version",
        "calculation.result",
        "imported.result",
        "document",
        "experimental.dataset",
    ]
    entity_id: UUID
    source_class: ProvenanceClass
    verification_state: VerificationState
    authority: ResultAuthority | None = None
    authoritative_calculation: bool = False
    reference_structure: bool = False
    provenance_id: UUID | None = None
    artifact_id: UUID | None = None
    sha256: str | None = None
    calculation_id: UUID | None = None
    structure_version_id: UUID | None = None
    label: Annotated[str, StringConstraints(max_length=160)]
    scalar_summary: dict[str, str | float | int | bool | None] = Field(
        default_factory=dict, max_length=8
    )


class ProductBlocked(ContractModel):
    action_id: ActionId
    reasons: tuple[ReasonCode, ...] = Field(max_length=16)


class ProductNavigator(ContractModel):
    goal: GoalId | None
    have: tuple[str, ...] = Field(max_length=64)
    next: tuple[ActionId, ...] = Field(max_length=32)
    blocked: tuple[ProductBlocked, ...] = Field(max_length=32)
    notices: tuple[str, ...] = Field(max_length=16)


class AIToolPolicy(ContractModel):
    tool_id: str
    description: str
    input_schema_ref: str
    output_schema_ref: str
    required_capabilities: tuple[str, ...]
    required_project_role: Literal["READ", "WRITE"]
    project_scope: Literal["CURRENT_PROJECT", "PUBLIC_CATALOGUE"]
    category: Literal["READ", "NAVIGATION", "MUTATION", "SCIENTIFIC_EXECUTION"]
    approval_required: bool
    mutates: bool
    scientific_compute: bool
    deterministic: bool = True
    authoritative_output: bool = False
    audit_category: str


class ProductContext(ContractModel):
    context_version: Literal["1.0.0"] = "1.0.0"
    human_id: UUID
    organization_id: UUID
    project_id: UUID
    project_name: str
    project_kind: Literal["NORMAL", "LEGACY_LOCAL", "ACCEPTANCE_FROZEN", "EXAMPLE_TEMPLATE"]
    role: str
    can_write: bool
    sealed: bool
    published_example: bool
    example_slug: str | None = None
    view_hint: str | None = None
    view_hint_is_untrusted: Literal[True] = True
    selection: ProductSelection
    navigator: ProductNavigator
    resources: tuple[ProductResource, ...] = Field(max_length=8)
    ai: AIAvailability
    allowed_tools: tuple[AIToolPolicy, ...] = Field(max_length=32)
    # Additive (0.0.18): facts for the ids named in the selection, read from stored records only.
    grounding_policy: str | None = None
    grounding_facts: tuple[GroundingFact, ...] = Field(default=(), max_length=16)
    grounding_notes: tuple[Annotated[str, StringConstraints(max_length=200)], ...] = Field(
        default=(), max_length=8
    )
    generated_at: datetime
    interpretation_source_class: Literal["AI_HYPOTHESIS"] = "AI_HYPOTHESIS"

    @model_serializer(mode="wrap")
    def _omit_empty_grounding(self, handler):
        """0.0.18 fields are absent, not empty, when no id was grounded: the payload (and the
        model prompt, whose token budget is tight) is byte-identical to the previous release."""
        data = handler(self)
        if not self.grounding_facts and not self.grounding_notes:
            for key in ("grounding_policy", "grounding_facts", "grounding_notes"):
                data.pop(key, None)
        return data


class AIExamplesOutput(ContractModel):
    slugs: tuple[str, ...] = Field(max_length=3)
    scope: str = (
        "Published structure-only references; copying requires the explicit product action."
    )
