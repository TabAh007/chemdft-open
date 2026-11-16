# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from .base import ContractModel, ContractVersion, NamespacedIdentifier


class SemanticVersion(ContractModel):
    major: int = Field(ge=1)
    minor: int = Field(ge=0)
    patch: int = Field(ge=0)

    def __str__(self) -> str:
        return f"{self.major}.{self.minor}.{self.patch}"


class PermissionClass(StrEnum):
    READ = "READ"
    LOW_COST_REVERSIBLE = "LOW_COST_REVERSIBLE"
    EXPENSIVE = "EXPENSIVE"
    DESTRUCTIVE_EXTERNAL = "DESTRUCTIVE_EXTERNAL"


class SideEffectClass(StrEnum):
    PURE = "PURE"
    READ_ONLY = "READ_ONLY"
    MUTATING_REVERSIBLE = "MUTATING_REVERSIBLE"
    DURABLE_JOB = "DURABLE_JOB"
    DESTRUCTIVE = "DESTRUCTIVE"
    EXTERNAL_SIDE_EFFECT = "EXTERNAL_SIDE_EFFECT"


class ApprovalPolicy(StrEnum):
    NONE = "NONE"
    POLICY_DEPENDENT = "POLICY_DEPENDENT"
    EXPLICIT = "EXPLICIT"


class IdempotencyBehavior(StrEnum):
    NATURAL = "NATURAL"
    KEY_REQUIRED = "KEY_REQUIRED"
    KEY_OPTIONAL = "KEY_OPTIONAL"
    NOT_IDEMPOTENT = "NOT_IDEMPOTENT"


class ToolAvailability(StrEnum):
    EXECUTABLE = "EXECUTABLE"
    FUTURE = "FUTURE"
    DISABLED = "DISABLED"


class ToolErrorCode(StrEnum):
    VALIDATION_ERROR = "VALIDATION_ERROR"
    NOT_FOUND = "NOT_FOUND"
    FORBIDDEN = "FORBIDDEN"
    CONFLICT = "CONFLICT"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"
    CAPABILITY_UNAVAILABLE = "CAPABILITY_UNAVAILABLE"
    TOOL_VERSION_UNSUPPORTED = "TOOL_VERSION_UNSUPPORTED"
    SCIENTIFIC_VALIDATION_FAILED = "SCIENTIFIC_VALIDATION_FAILED"
    DEPENDENCY_UNAVAILABLE = "DEPENDENCY_UNAVAILABLE"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class AuthoritativeFieldPolicy(StrEnum):
    NONE = "NONE"
    CANDIDATE_ONLY = "CANDIDATE_ONLY"
    SERVER_OWNED = "SERVER_OWNED"
    TRUSTED_PRODUCER_ONLY = "TRUSTED_PRODUCER_ONLY"


class ToolDefinition(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    name: NamespacedIdentifier
    version: SemanticVersion
    description: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    input_schema_ref: NamespacedIdentifier
    output_schema_ref: NamespacedIdentifier
    permission_class: PermissionClass
    required_capabilities: tuple[NamespacedIdentifier, ...] = Field(default=(), max_length=64)
    cost_class: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    risk_class: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    approval_policy: ApprovalPolicy
    side_effect: SideEffectClass
    reversible: bool
    idempotency: IdempotencyBehavior
    provenance_obligations: tuple[NamespacedIdentifier, ...] = Field(default=(), max_length=32)
    authoritative_field_policy: AuthoritativeFieldPolicy
    availability: ToolAvailability
    tags: tuple[NamespacedIdentifier, ...] = Field(default=(), max_length=32)
    error_codes: tuple[ToolErrorCode, ...] = Field(default=(), max_length=32)


class ToolInvocationRecord(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    request_id: UUID
    organization_id: UUID
    project_id: UUID | None = None
    actor_id: UUID
    tool_name: NamespacedIdentifier
    tool_version: SemanticVersion
    transport: Literal["REST", "WEB_UI", "AI_SCIENTIST", "WEBMCP", "MCP", "INTERNAL"]
    input_fingerprint: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    outcome: Literal["SUCCEEDED", "REJECTED", "FAILED"]
    error_code: ToolErrorCode | None = None
    result_reference: Annotated[str, StringConstraints(max_length=500)] | None = None
    invoked_at: datetime
