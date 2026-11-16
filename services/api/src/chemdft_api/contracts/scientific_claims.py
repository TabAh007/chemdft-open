# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from .base import ContractModel
from .result_state import EffectiveResultState


class ScientificClaim(ContractModel):
    effective_result_state: EffectiveResultState | None = None
    """Read-only scientific statement projected from an existing project record."""

    id: UUID
    project_id: UUID
    claim_type: str
    subject: str
    predicate: str
    quantity_key: str | None = None
    value: Any = None
    unit: str | None = None
    # Additive, read-only (0.0.17): the number exactly as written in the stored source quote
    # (e.g. "24.480"). Null when the quote has no unambiguous matching token. Never invented.
    original_value_text: str | None = None
    qualifier: str | None = None
    uncertainty: Any = None
    source_authority: str
    source_record_type: str
    source_record_id: UUID
    source_document_id: UUID | None = None
    page: int | None = None
    figure: str | None = None
    table: str | None = None
    evidence_id: UUID | None = None
    provenance_hash: str | None = None
    review_state: str
    semantic_status: str = "EXPLICIT"
    source_label: str
    source_href: str | None = None
    created_at: datetime | None = None


class ScientificClaimRelation(ContractModel):
    left_claim_id: UUID
    right_claim_id: UUID
    relation: str
    rationale: str
    numeric_delta: float | None = None
    delta_unit: str | None = None


class ProjectScientificClaimsOutput(ContractModel):
    project_id: UUID
    claims: tuple[ScientificClaim, ...]
    relations: tuple[ScientificClaimRelation, ...]


class ScientificComparisonRow(ContractModel):
    id: str
    section: str
    topic: str
    quantity_key: str | None = None
    source_document_id: UUID | None = None
    source_claims: tuple[ScientificClaim, ...] = ()
    project_claims: tuple[ScientificClaim, ...] = ()
    relation: str
    delta: float | None = None
    delta_unit: str | None = None
    comparison_rule: str | None = None
    authority_summary: tuple[str, ...] = ()
    review_summary: tuple[str, ...] = ()
    unresolved_reason: str | None = None


class ScientificComparisonSummary(ContractModel):
    source_claims: int
    project_claims: int
    directly_comparable_pairs: int
    not_directly_comparable: int
    source_only_claims: int
    project_only_claims: int
    reconstructed_structures: int
    digitized_datasets: int
    calculated_results: int


class ProjectScientificComparisonOutput(ContractModel):
    project_id: UUID
    rows: tuple[ScientificComparisonRow, ...]
    summary: ScientificComparisonSummary
