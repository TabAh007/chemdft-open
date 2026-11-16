"""Explicit, read-only historical evaluator-1 QREL/corpus compatibility."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..schema import (
    AnswerableQrel,
    BenchmarkIdentity,
    ChemDFTBenchmark,
    Chunk,
    NoAnswerQrel,
    Query,
    Review,
    Source,
    Target,
)


def _alias(row: Mapping[str, Any], first: str, second: str) -> str:
    values = [row[key] for key in (first, second) if key in row]
    if not values or any(not isinstance(value, str) or not value for value in values):
        raise ValueError(f"missing {first}/{second}")
    if len(set(values)) != 1:
        raise ValueError(f"conflicting {first}/{second} aliases")
    return values[0]


def evaluator_v1_to_canonical(
    *,
    identity: BenchmarkIdentity,
    corpus: Mapping[str, Any],
    qrels: Mapping[str, Any],
    reviews: list[Review],
    source_metadata: Mapping[str, Source],
    chunk_metadata: Mapping[str, Chunk],
    no_answer_notes: Mapping[str, str] | None = None,
) -> ChemDFTBenchmark:
    """Adapt schema-1 evaluator rows using verified external scientific metadata.

    The evaluator format lacks complete source hashes and locators, so callers
    must supply them. This never writes into a historical package.
    """
    if corpus.get("schema_version") != 1 or qrels.get("schema_version") != 1:
        raise ValueError("expected evaluator-1 corpus and QREL envelopes")
    chunks = []
    for row in corpus["chunks"]:
        chunk_id = row["chunk_id"]
        canonical = chunk_metadata[chunk_id]
        if canonical.document_id != row["document_id"]:
            raise ValueError("legacy chunk metadata mismatch")
        chunks.append(canonical)
    parsed_qrels = []
    queries = []
    for row in qrels["qrels"]:
        query_id = row["query_id"]
        queries.append(
            Query(
                query_id=query_id,
                text=row["query"],
                language=row.get("language"),
                query_class=row.get("query_class"),
                leakage_group=row.get("leakage_group", query_id),
            )
        )
        targets = row.get("acceptable_targets", [])
        if row["no_answer"]:
            if targets:
                raise ValueError("no-answer legacy row has targets")
            note = row.get("corpus_review_note") or (no_answer_notes or {}).get(query_id)
            if not note:
                raise ValueError("no-answer legacy row needs a corpus-wide review note")
            parsed_qrels.append(
                NoAnswerQrel(
                    query_id=query_id,
                    corpus_review_note=note,
                )
            )
        else:
            normalized = [
                Target(
                    document_id=_alias(t, "benchmark_document_id", "expected_document_id"),
                    chunk_id=_alias(t, "chunk_id", "expected_chunk_id"),
                )
                for t in targets
            ]
            if not normalized:
                raise ValueError("answerable legacy row has no target")
            parsed_qrels.append(
                AnswerableQrel(
                    query_id=query_id,
                    primary_target=normalized[0],
                    alternate_targets=tuple(normalized[1:]),
                )
            )
    return ChemDFTBenchmark(
        identity=identity,
        sources=tuple(source_metadata.values()),
        chunks=tuple(chunks),
        queries=tuple(queries),
        qrels=tuple(parsed_qrels),
        reviews=tuple(reviews),
    )
