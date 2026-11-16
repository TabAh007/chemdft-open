# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Public metadata is curated separately from project-private administrative records."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from .base import ContractModel
from .catalog import StructureVersionDetail
from .navigator import NavigatorState


class ExampleSummary(ContractModel):
    slug: str
    title: str
    formula: str
    type: Literal["molecule", "crystal"]
    template_project_id: UUID
    template_version: str
    sealed: Literal[True] = True
    publication_state: Literal["PUBLISHED"] = "PUBLISHED"
    data_class: Literal["REFERENCE_STRUCTURE"] = "REFERENCE_STRUCTURE"
    atom_count: int
    source: str
    source_identifier: str
    source_url: str
    source_sha256: str
    citation: str
    citation_url: str
    reuse_basis: str
    licence_url: str
    review_date: str
    space_group: str | None
    description: str
    related_context: str | None
    available_result_types: tuple[str, ...] = ()


class ExampleDetail(ContractModel):
    example: ExampleSummary
    structure: StructureVersionDetail
    navigator: NavigatorState


class ExampleCopyOutput(ContractModel):
    project_id: UUID
    organization_id: UUID
    kind: Literal["NORMAL"] = "NORMAL"
    template_project_id: UUID
    template_version: str
    example_slug: str
    copied_at: datetime
    copied_result_count: Literal[0] = 0
