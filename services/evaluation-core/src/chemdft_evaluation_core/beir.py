"""Deterministic BEIR/TREC-style projection; canonical records retain provenance."""

from __future__ import annotations

from typing import Any

from .schema import AnswerableQrel, ChemDFTBenchmark


def export_ir(benchmark: ChemDFTBenchmark) -> dict[str, Any]:
    """Export reviewed scoring rows; no-answer rows remain only in canonical data."""
    if any(row.content is None for row in benchmark.chunks):
        raise ValueError("IR corpus export requires chunk content")
    included = {
        row.query_id: row for row in benchmark.scoring_qrels() if isinstance(row, AnswerableQrel)
    }
    return {
        "corpus": {
            row.chunk_id: {"text": row.content, "document_id": row.document_id}
            for row in sorted(benchmark.chunks, key=lambda r: r.chunk_id)
        },
        "queries": {
            row.query_id: row.text
            for row in sorted(benchmark.queries, key=lambda r: r.query_id)
            if row.query_id in included
        },
        "qrels": {
            qid: {
                chunk_id: 1
                for chunk_id in sorted(
                    target.chunk_id for target in (row.primary_target, *row.alternate_targets)
                )
            }
            for qid, row in sorted(included.items())
        },
    }


def import_ir_projection(data: dict[str, Any]) -> tuple[dict, dict, dict]:
    """Normalize an IR projection; it cannot create a full scientific benchmark."""
    if set(data) != {"corpus", "queries", "qrels"}:
        raise ValueError("expected corpus, queries, qrels")
    if set(data["queries"]) != set(data["qrels"]):
        raise ValueError("every imported query needs qrels")
    for targets in data["qrels"].values():
        if not targets or any(
            chunk not in data["corpus"] or grade <= 0 for chunk, grade in targets.items()
        ):
            raise ValueError("missing or invalid relevance target")
    return (
        dict(sorted(data["corpus"].items())),
        dict(sorted(data["queries"].items())),
        {qid: dict(sorted(targets.items())) for qid, targets in sorted(data["qrels"].items())},
    )
