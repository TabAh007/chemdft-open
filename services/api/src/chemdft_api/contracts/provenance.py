# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator

from .base import (
    ArtifactReference,
    ContractModel,
    ContractVersion,
    EntityReference,
    NamespacedExtension,
    NamespacedIdentifier,
)
from .scientific import ScientificQuantity


class ProvenanceClass(StrEnum):
    EXPERIMENTAL = "EXPERIMENTAL"
    CALCULATED = "CALCULATED"
    EXTRACTED = "EXTRACTED"
    DIGITIZED = "DIGITIZED"
    USER_SUPPLIED = "USER_SUPPLIED"
    AI_HYPOTHESIS = "AI_HYPOTHESIS"
    IMPORTED = "IMPORTED"


class ProvenanceDetail(StrEnum):
    AI_RECONSTRUCTED = "AI_RECONSTRUCTED"
    PARSER_EXTRACTED = "PARSER_EXTRACTED"
    MANUAL_ENTRY = "MANUAL_ENTRY"
    IMPORTED_ENGINE_RESULT = "IMPORTED_ENGINE_RESULT"
    DETERMINISTIC_TRANSFORM = "DETERMINISTIC_TRANSFORM"
    DIRECT_ACQUISITION = "DIRECT_ACQUISITION"


class VerificationState(StrEnum):
    UNVERIFIED = "UNVERIFIED"
    VERIFIED = "VERIFIED"
    DISPUTED = "DISPUTED"
    SUPERSEDED = "SUPERSEDED"
    RETRACTED = "RETRACTED"


class ProducerKind(StrEnum):
    USER = "USER"
    SERVICE = "SERVICE"
    SOFTWARE = "SOFTWARE"
    MODEL = "MODEL"


class ProducerReference(ContractModel):
    kind: ProducerKind
    identifier: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    software_version: Annotated[str, StringConstraints(max_length=64)] | None = None


class ProvenanceInput(ContractModel):
    entity: EntityReference | None = None
    artifact: ArtifactReference | None = None
    provenance_record_id: UUID | None = None

    @model_validator(mode="after")
    def exactly_one_input(self) -> ProvenanceInput:
        candidates = (self.entity, self.artifact, self.provenance_record_id)
        if sum(value is not None for value in candidates) != 1:
            raise ValueError("A lineage input must identify exactly one source")
        return self


class ProvenanceRecord(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    subject: EntityReference
    source_class: ProvenanceClass
    detail: ProvenanceDetail
    verification_state: VerificationState
    producer: ProducerReference
    inputs: tuple[ProvenanceInput, ...] = Field(default=(), max_length=256)
    source_artifact: ArtifactReference | None = None
    operation: NamespacedIdentifier
    operation_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    parameters: tuple[NamespacedExtension, ...] = Field(default=(), max_length=8)
    approximate: bool = False
    supersedes_id: UUID | None = None
    correlation_id: UUID
    created_at: datetime

    @model_validator(mode="after")
    def enforce_project_scope(self) -> ProvenanceRecord:
        references = [self.subject.project_id]
        if self.source_artifact:
            references.append(self.source_artifact.project_id)
        for item in self.inputs:
            if item.entity:
                references.append(item.entity.project_id)
            if item.artifact:
                references.append(item.artifact.project_id)
            if item.provenance_record_id == self.id:
                raise ValueError("A provenance record cannot depend on itself")
        if any(project_id != self.project_id for project_id in references):
            raise ValueError("Provenance lineage cannot cross project boundaries")
        if (
            self.source_class is ProvenanceClass.AI_HYPOTHESIS
            and self.verification_state is VerificationState.VERIFIED
        ):
            raise ValueError(
                "AI hypotheses cannot become authoritative merely by changing verification state"
            )
        return self


class EvidenceDirection(StrEnum):
    SUPPORTING = "SUPPORTING"
    CONTRADICTING = "CONTRADICTING"
    NEUTRAL_RELATED = "NEUTRAL_RELATED"


class CitationLocation(ContractModel):
    page: int | None = Field(default=None, ge=1)
    section: Annotated[str, StringConstraints(max_length=160)] | None = None
    table: Annotated[str, StringConstraints(max_length=80)] | None = None
    figure: Annotated[str, StringConstraints(max_length=80)] | None = None
    excerpt_hash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")] | None = None


class Citation(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    knowledge_source_id: UUID
    locator: CitationLocation
    created_at: datetime


class KnowledgeSource(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    title: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    source_artifact: ArtifactReference | None = None
    external_identifier: Annotated[str, StringConstraints(max_length=500)] | None = None
    created_at: datetime

    @model_validator(mode="after")
    def source_is_project_scoped(self) -> KnowledgeSource:
        if self.source_artifact and self.source_artifact.project_id != self.project_id:
            raise ValueError("Knowledge source artifact cannot cross project boundaries")
        return self


class Evidence(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    claim_or_hypothesis: EntityReference
    evidence_source: EntityReference
    direction: EvidenceDirection
    citation_id: UUID | None = None
    created_by: UUID
    created_at: datetime

    @model_validator(mode="after")
    def evidence_is_project_scoped(self) -> Evidence:
        if any(
            reference.project_id != self.project_id
            for reference in (self.claim_or_hypothesis, self.evidence_source)
        ):
            raise ValueError("Evidence references cannot cross project boundaries")
        return self


class HypothesisStatus(StrEnum):
    PROPOSED = "PROPOSED"
    ACCEPTED_AS_WORKING = "ACCEPTED_AS_WORKING"
    REJECTED = "REJECTED"
    SUPERSEDED = "SUPERSEDED"


class Hypothesis(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    authority: Literal["CANDIDATE"] = "CANDIDATE"
    id: UUID
    project_id: UUID
    statement: Annotated[str, StringConstraints(min_length=1, max_length=8000)]
    author: ProducerReference
    status: HypothesisStatus
    linked_entities: tuple[EntityReference, ...] = Field(default=(), max_length=256)
    evidence_ids: tuple[UUID, ...] = Field(default=(), max_length=256)
    supersedes_id: UUID | None = None
    created_at: datetime

    @model_validator(mode="after")
    def hypothesis_is_project_scoped(self) -> Hypothesis:
        if any(reference.project_id != self.project_id for reference in self.linked_entities):
            raise ValueError("Hypothesis references cannot cross project boundaries")
        return self


class CorrectionValue(ContractModel):
    text: Annotated[str, StringConstraints(max_length=4000)] | None = None
    quantity: ScientificQuantity | None = None
    reference: EntityReference | ArtifactReference | None = None

    @model_validator(mode="after")
    def exactly_one_value(self) -> CorrectionValue:
        if sum(value is not None for value in (self.text, self.quantity, self.reference)) != 1:
            raise ValueError("A correction must contain exactly one typed replacement value")
        return self


class UserCorrection(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    original: EntityReference
    corrected_value: CorrectionValue
    author_id: UUID
    reason: Annotated[str, StringConstraints(min_length=1, max_length=4000)]
    verification_state: VerificationState = VerificationState.UNVERIFIED
    created_at: datetime

    @model_validator(mode="after")
    def correction_is_project_scoped(self) -> UserCorrection:
        if self.original.project_id != self.project_id:
            raise ValueError("Correction original cannot cross project boundaries")
        reference = self.corrected_value.reference
        if reference and reference.project_id != self.project_id:
            raise ValueError("Correction value cannot cross project boundaries")
        return self


class VerificationRecord(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    subject: EntityReference
    state: VerificationState
    method: NamespacedIdentifier
    verifier: ProducerReference
    notes: Annotated[str, StringConstraints(max_length=4000)] | None = None
    created_at: datetime

    @model_validator(mode="after")
    def verification_is_project_scoped(self) -> VerificationRecord:
        if self.subject.project_id != self.project_id:
            raise ValueError("Verification subject cannot cross project boundaries")
        return self
