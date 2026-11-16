# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator

from .base import (
    ArtifactReference,
    ContractModel,
    ContractVersion,
    EntityReference,
    NamespacedIdentifier,
)


class AuditOutcome(StrEnum):
    SUCCEEDED = "SUCCEEDED"
    REJECTED = "REJECTED"
    FAILED = "FAILED"


class SafeAuditField(ContractModel):
    key: NamespacedIdentifier
    value: Annotated[str, StringConstraints(max_length=500)]


class AuditEvent(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    occurred_at: datetime
    event_name: NamespacedIdentifier
    actor_or_service_id: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    organization_id: UUID
    project_id: UUID | None = None
    request_id: UUID
    tool_name: NamespacedIdentifier | None = None
    tool_version: Annotated[str, StringConstraints(max_length=32)] | None = None
    targets: tuple[EntityReference, ...] = Field(default=(), max_length=128)
    outcome: AuditOutcome
    error_category: Annotated[str, StringConstraints(max_length=80)] | None = None
    approval_reference: UUID | None = None
    artifacts: tuple[ArtifactReference, ...] = Field(default=(), max_length=128)
    safe_metadata: tuple[SafeAuditField, ...] = Field(default=(), max_length=32)

    @model_validator(mode="after")
    def references_match_project(self) -> AuditEvent:
        if self.project_id is None and (self.targets or self.artifacts):
            raise ValueError("Project-scoped audit references require a project")
        if self.project_id and any(
            reference.project_id != self.project_id
            for reference in (*self.targets, *self.artifacts)
        ):
            raise ValueError("Audit references cannot cross project boundaries")
        return self
