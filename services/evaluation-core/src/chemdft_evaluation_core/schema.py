"""Canonical authoring schema. Historical artifacts are adapted at the boundary."""

from __future__ import annotations

import hashlib
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Identifier = Annotated[str, StringConstraints(min_length=1, strip_whitespace=True)]
Sha256 = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PDFLocator(StrictModel):
    kind: Literal["PDF_PAGE"] = "PDF_PAGE"
    page: int = Field(ge=1)
    anchor_id: str | None = None


class XMLLocator(StrictModel):
    kind: Literal["XML_PARAGRAPH"] = "XML_PARAGRAPH"
    section_path: Identifier
    paragraph_ordinal: int = Field(ge=1)
    chunk_ordinal: int = Field(ge=1)
    xml_node_id: str | None = None


Locator = Annotated[PDFLocator | XMLLocator, Field(discriminator="kind")]


class Source(StrictModel):
    document_id: Identifier
    source_kind: Literal["PDF", "XML"]
    source_sha256: Sha256
    title: str | None = None
    doi: str | None = None
    license: str | None = None
    provenance_url: str | None = None


class Chunk(StrictModel):
    chunk_id: Identifier
    document_id: Identifier
    content_sha256: Sha256
    locator: Locator
    content: str | None = None

    @model_validator(mode="after")
    def content_matches_digest(self) -> Chunk:
        if (
            self.content is not None
            and hashlib.sha256(self.content.encode("utf-8")).hexdigest() != self.content_sha256
        ):
            raise ValueError("chunk content hash mismatch")
        return self


class Query(StrictModel):
    query_id: Identifier
    text: Identifier
    language: str | None = None
    query_class: str | None = None
    leakage_group: Identifier


class Target(StrictModel):
    document_id: Identifier
    chunk_id: Identifier
    evidence_excerpt: str | None = None


class AnswerableQrel(StrictModel):
    query_id: Identifier
    no_answer: Literal[False] = False
    primary_target: Target
    alternate_targets: tuple[Target, ...] = ()

    @model_validator(mode="after")
    def unique_targets(self) -> AnswerableQrel:
        ids = [target.chunk_id for target in (self.primary_target, *self.alternate_targets)]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate acceptable target")
        return self


class NoAnswerQrel(StrictModel):
    query_id: Identifier
    no_answer: Literal[True] = True
    corpus_review_note: Identifier


Qrel = Annotated[AnswerableQrel | NoAnswerQrel, Field(discriminator="no_answer")]


class ReviewDecision(StrEnum):
    APPROVED = "APPROVED"
    CORRECTED = "CORRECTED"
    REJECTED = "REJECTED"


class Review(StrictModel):
    query_id: Identifier
    decision: ReviewDecision
    reviewer: Identifier
    evidence_sha256: Sha256
    note: str | None = None


class BenchmarkIdentity(StrictModel):
    benchmark_id: Identifier
    version: Identifier
    schema_version: Literal[1] = 1


class ChemDFTBenchmark(StrictModel):
    identity: BenchmarkIdentity
    sources: tuple[Source, ...]
    chunks: tuple[Chunk, ...]
    queries: tuple[Query, ...]
    qrels: tuple[Qrel, ...]
    reviews: tuple[Review, ...] = ()

    @model_validator(mode="after")
    def integrity(self) -> ChemDFTBenchmark:
        for name, rows, field in (
            ("document", self.sources, "document_id"),
            ("chunk", self.chunks, "chunk_id"),
            ("query", self.queries, "query_id"),
            ("qrel", self.qrels, "query_id"),
            ("review", self.reviews, "query_id"),
        ):
            ids = [getattr(row, field) for row in rows]
            if len(ids) != len(set(ids)):
                raise ValueError(f"duplicate {name} ID")
        sources = {row.document_id: row for row in self.sources}
        chunks = {row.chunk_id: row for row in self.chunks}
        queries = {row.query_id for row in self.queries}
        if {row.query_id for row in self.qrels} != queries:
            raise ValueError("every query needs exactly one QREL")
        if not {row.query_id for row in self.reviews} <= queries:
            raise ValueError("review references unknown query")
        for chunk in self.chunks:
            source = sources.get(chunk.document_id)
            if source is None:
                raise ValueError("chunk references unknown source")
            if source.source_kind != ("PDF" if isinstance(chunk.locator, PDFLocator) else "XML"):
                raise ValueError("locator and source type disagree")
        for qrel in self.qrels:
            if isinstance(qrel, NoAnswerQrel):
                continue
            for target in (qrel.primary_target, *qrel.alternate_targets):
                chunk = chunks.get(target.chunk_id)
                if chunk is None or chunk.document_id != target.document_id:
                    raise ValueError("target does not resolve to its document and chunk")
        return self

    def scoring_qrels(self) -> tuple[AnswerableQrel | NoAnswerQrel, ...]:
        """Only independently accepted judgments can be scored."""
        decisions = {row.query_id: row.decision for row in self.reviews}
        if len(decisions) != len(self.qrels):
            raise ValueError("all QRELs require a review decision before scoring")
        return tuple(
            row for row in self.qrels if decisions[row.query_id] != ReviewDecision.REJECTED
        )
