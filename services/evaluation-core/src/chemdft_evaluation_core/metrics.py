"""Future IR scoring. Historical V3 metric names and values stay unchanged."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

import ir_measures
from ir_measures import RR, R, nDCG

from .schema import AnswerableQrel, ChemDFTBenchmark


def rate(hits: int, n: int) -> dict[str, float | int | None]:
    return {"hits": hits, "n": n, "rate": hits / n if n else None}


def target_recall_at_k(ranked: Sequence[str], targets: set[str], k: int) -> float:
    return len(set(ranked[:k]) & targets) / len(targets) if targets else 0.0


def reciprocal_rank(ranked: Sequence[str], targets: set[str]) -> float:
    return next((1 / i for i, chunk in enumerate(ranked, 1) if chunk in targets), 0.0)


def binary_ndcg_at_k(ranked: Sequence[str], targets: set[str], k: int) -> float:
    if not targets:
        return 0.0
    dcg = sum(1 / math.log2(i + 1) for i, chunk in enumerate(ranked[:k], 1) if chunk in targets)
    ideal = sum(1 / math.log2(i + 1) for i in range(1, min(k, len(targets)) + 1))
    return dcg / ideal


def score(
    benchmark: ChemDFTBenchmark,
    rankings: Mapping[str, Sequence[str]],
    accepted: Mapping[str, bool],
) -> dict[str, Any]:
    """Score reviewed rows. Rankings must contain each corpus chunk at most once."""
    scoring = benchmark.scoring_qrels()
    ids = {row.query_id for row in scoring}
    if set(rankings) != ids or set(accepted) != ids:
        raise ValueError("rankings and decisions must match the reviewed scoring set")
    chunks = {row.chunk_id: row.document_id for row in benchmark.chunks}
    for ranking in rankings.values():
        if len(ranking) != len(set(ranking)) or not set(ranking) <= chunks.keys():
            raise ValueError("ranking has duplicate or unknown chunk IDs")
    answerable = [row for row in scoring if isinstance(row, AnswerableQrel)]
    no_answer = [row for row in scoring if not isinstance(row, AnswerableQrel)]
    qrels = []
    run = []
    target_hits = {k: 0 for k in (1, 3, 5)}
    chunk_hits = {k: 0 for k in (1, 3, 5)}
    doc_hits = {k: 0 for k in (1, 3, 5)}
    safe_hits = 0
    target_count = 0
    for row in answerable:
        targets = (row.primary_target, *row.alternate_targets)
        relevant = {target.chunk_id for target in targets}
        documents = {target.document_id for target in targets}
        target_count += len(relevant)
        ranking = rankings[row.query_id]
        qrels.extend(ir_measures.Qrel(row.query_id, chunk, 1) for chunk in relevant)
        run.extend(
            ir_measures.ScoredDoc(row.query_id, chunk, float(len(ranking) - i))
            for i, chunk in enumerate(ranking)
        )
        for k in (1, 3, 5):
            target_hits[k] += len(set(ranking[:k]) & relevant)
            chunk_hits[k] += int(bool(set(ranking[:k]) & relevant))
            doc_hits[k] += int(any(chunks[chunk] in documents for chunk in ranking[:k]))
        safe_hits += int(accepted[row.query_id] and bool(set(ranking[:5]) & relevant))
    standard = (
        ir_measures.calc_aggregate([R @ 1, R @ 3, R @ 5, RR, nDCG @ 5], qrels, run)
        if answerable
        else {}
    )
    false_accepts = sum(bool(accepted[row.query_id]) for row in no_answer)
    return {
        "counts": {
            "answerable": len(answerable),
            "no_answer": len(no_answer),
            "acceptable_targets": target_count,
        },
        "standard_macro": {
            "recall_at_1": standard.get(R @ 1),
            "recall_at_3": standard.get(R @ 3),
            "recall_at_5": standard.get(R @ 5),
            "mrr": standard.get(RR),
            "ndcg_at_5": standard.get(nDCG @ 5),
        },
        "chemdft": {
            "pooled_target_recall": {str(k): rate(target_hits[k], target_count) for k in (1, 3, 5)},
            "chunk_hit": {str(k): rate(chunk_hits[k], len(answerable)) for k in (1, 3, 5)},
            "document_hit": {str(k): rate(doc_hits[k], len(answerable)) for k in (1, 3, 5)},
            "answerable_acceptance": rate(
                sum(bool(accepted[r.query_id]) for r in answerable), len(answerable)
            ),
            "safe_recall_at_5": rate(safe_hits, len(answerable)),
            "no_answer_false_accept": rate(false_accepts, len(no_answer)),
        },
    }
