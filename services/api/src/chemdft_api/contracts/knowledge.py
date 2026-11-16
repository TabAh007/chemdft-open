# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from .base import ContractModel, ContractVersion


class KnowledgeSearchFilters(ContractModel):
    source_types: tuple[str, ...] = Field(default=(), max_length=20)
    source_classes: tuple[
        Literal["EXPERIMENTAL", "EXTRACTED", "DIGITIZED", "CALCULATED", "AI_HYPOTHESIS"], ...
    ] = Field(default=(), max_length=10)
    document_id: UUID | None = None
    structure_id: UUID | None = None
    calculation_id: UUID | None = None
    year: int | None = Field(default=None, ge=1800, le=2200)
    doi: str | None = None


class KnowledgeSearchInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    query: Annotated[str, StringConstraints(min_length=1, max_length=1000)]
    filters: KnowledgeSearchFilters = Field(default_factory=KnowledgeSearchFilters)
    limit: int = Field(default=10, ge=1, le=25)


class KnowledgeRetrievalResult(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    knowledge_item_id: UUID
    knowledge_chunk_id: UUID
    source_type: str
    source_entity_id: UUID
    source_revision: str | None = None
    content: str
    lexical_score: float = Field(ge=0)
    semantic_score: float = Field(ge=0)
    combined_score: float = Field(ge=0)
    source_class: str | None = None
    verification_state: str | None = None
    document_id: UUID | None = None
    page_number: int | None = None
    source_anchor_id: UUID | None = None
    citation_type: Literal[
        "DOCUMENT", "EVIDENCE", "CALCULATION", "DATASET", "STRUCTURE", "PROJECT_NOTE"
    ]
    index_version: str


class KnowledgeSearchOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    query: str
    results: tuple[KnowledgeRetrievalResult, ...] = Field(default=(), max_length=25)
    index_version: str


class KnowledgeIndexStatus(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    project_id: UUID
    status: Literal["PENDING", "INDEXING", "READY", "FAILED", "STALE"]
    index_version: str
    chunk_count: int = Field(ge=0)
    diagnostic: str | None = None
    updated_at: datetime


class KnowledgeItemView(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    source_type: str
    source_entity_id: UUID
    source_revision: str | None = None
    content_hash: str
    document_id: UUID | None = None
    page_number: int | None = None
    source_anchor_id: UUID | None = None
    evidence_id: UUID | None = None
    source_class: str | None = None
    verification_state: str | None = None
    content: str
    chunker_version: str
    created_at: datetime


class ProjectMemoryCreateInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    memory_type: Literal["PROJECT_NOTE", "USER_CONFIRMED_FACT", "WORKFLOW_DECISION"]
    content: Annotated[str, StringConstraints(min_length=1, max_length=4000)]
    source_conversation_id: UUID | None = None
    source_links: tuple[dict[str, str], ...] = Field(default=(), max_length=20)


class ProjectMemoryView(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    memory_type: str
    content: str
    confirmation_state: Literal["CONFIRMED"]
    created_by: UUID
    source_conversation_id: UUID | None = None
    created_at: datetime


class ProjectMemoryListOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    memories: tuple[ProjectMemoryView, ...] = Field(default=(), max_length=1000)
