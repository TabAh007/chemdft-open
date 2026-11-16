from __future__ import annotations

import argparse
import json
import statistics
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from .corpus import DOCUMENTS, DOCUMENT_METADATA, QUERIES, document_sha256
from .exact_query import classify_exact_query, guardrail_score
from .metrics import ndcg_at_k, ranking_metrics
from .models import MODEL_CANDIDATES, DeterministicFakeEmbeddingGateway, HuggingFaceSentenceGateway
from .retrieval import hybrid_score, lexical_score

EXACT_CATEGORIES = {"exact_identifier", "formula", "numeric"}
SCORE_THRESHOLD = 0.5


def _cosine(left: tuple[float, ...], right: tuple[float, ...]) -> float:
    return max(0.0, min(1.0, sum(a * b for a, b in zip(left, right, strict=True))))


def _percentile(values: list[float], percent: int) -> float:
    return float(values[0]) if len(values) == 1 else float(np.percentile(values, percent))


def _hits(ranked: list[str], gold: set[str], k: int) -> float:
    return float(bool(set(ranked[:k]) & gold))


def _judge_row(
    query: Any, ranked: list[tuple[str, float]], by_id: dict[str, Any]
) -> dict[str, Any]:
    ranked_ids = [item_id for item_id, _ in ranked]
    gold = set(query.relevant_ids)
    relevant = [by_id[item_id] for item_id in gold]
    result = ranking_metrics(ranked_ids, gold)
    result["ndcg_at_5"] = ndcg_at_k(ranked_ids, gold, 5)
    for k in (1, 3, 5):
        top = [by_id[item_id] for item_id in ranked_ids[:k]]
        result[f"document_hit_at_{k}"] = float(
            any(found.source_id == expected.source_id for found in top for expected in relevant)
        )
        result[f"page_hit_at_{k}"] = float(
            any(
                found.source_id == expected.source_id and found.page == expected.page
                for found in top
                for expected in relevant
            )
        )
        result[f"evidence_hit_at_{k}"] = _hits(ranked_ids, gold, k)
    result["no_answer_false_retrieval_at_050"] = (
        float(bool(ranked) and ranked[0][1] >= SCORE_THRESHOLD) if query.no_answer else None
    )
    return result


def _failure_category(query: Any, top_id: str | None, by_id: dict[str, Any]) -> str:
    if query.no_answer:
        return "no_answer_false_retrieval" if top_id else "no_answer_correctly_unanswered"
    if top_id in query.relevant_ids:
        return "none"
    expected = [by_id[item_id] for item_id in query.relevant_ids]
    found = by_id.get(top_id) if top_id else None
    if query.category == "numeric":
        return "numeric_mismatch"
    if query.category == "formula":
        return "formula_confusion"
    if query.language.startswith("cross_") or query.language == "ru":
        return "cross_language_or_russian_miss"
    if found and any(found.source_id == item.source_id for item in expected):
        return "wrong_page_or_chunk"
    return "wrong_document_or_semantic_near_miss"


def _mean(rows: list[dict[str, Any]], metric: str) -> float | None:
    values = [row[metric] for row in rows if row[metric] is not None]
    return round(statistics.mean(values), 4) if values else None


def evaluate_gateway(gateway: Any) -> dict[str, Any]:
    embed_started = time.perf_counter()
    document_embeddings = gateway.embed_documents([item.text for item in DOCUMENTS])
    document_embedding_seconds = time.perf_counter() - embed_started
    doc_vectors = {
        item.id: vector.vector for item, vector in zip(DOCUMENTS, document_embeddings, strict=True)
    }
    dimension = document_embeddings[0].dimension

    gateway.embed_query("warmup query")
    query_times: list[float] = []
    query_vectors = {}
    for query in QUERIES:
        started = time.perf_counter()
        query_vectors[query.id] = gateway.embed_query(query.text).vector
        query_times.append(time.perf_counter() - started)

    retrieval_times: list[float] = []
    query_rankings: dict[str, dict[str, list[str]]] = {}
    rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    failures: dict[str, Counter[str]] = defaultdict(Counter)
    by_id = {item.id: item for item in DOCUMENTS}
    exact_route_counts = Counter()

    for query in QUERIES:
        route = classify_exact_query(query.text)
        exact_route_counts["routed" if route else "not_routed"] += 1
        exact_route_counts[f"route:{route or 'none'}"] += 1
        ranked = {name: [] for name in ("lexical", "semantic", "current_hybrid")}
        started = time.perf_counter()
        for document in DOCUMENTS:
            lexical = lexical_score(query.text, document.text)
            semantic = _cosine(query_vectors[query.id], doc_vectors[document.id])
            ranked["lexical"].append((document.id, lexical))
            ranked["semantic"].append((document.id, semantic))
            ranked["current_hybrid"].append((document.id, hybrid_score(lexical, semantic)))
            if getattr(gateway, "model", "") in {"bge-m3", "BAAI/bge-m3"}:
                ranked.setdefault("exact_guardrail", []).append(
                    (document.id, guardrail_score(route, lexical, hybrid_score(lexical, semantic)))
                )
        retrieval_times.append(time.perf_counter() - started)
        query_rankings[query.id] = {}
        for strategy, values in ranked.items():
            ordered = sorted(values, key=lambda entry: (-entry[1], entry[0]))
            query_rankings[query.id][strategy] = [item_id for item_id, _ in ordered[:5]]
            result = _judge_row(query, ordered, by_id)
            rows[strategy].append(
                {
                    "query_id": query.id,
                    "category": query.category,
                    "language": query.language,
                    **result,
                }
            )
            if query.no_answer:
                reason = (
                    "no_answer_false_retrieval"
                    if ordered and ordered[0][1] >= SCORE_THRESHOLD
                    else "no_answer_correctly_unanswered"
                )
            else:
                reason = _failure_category(query, ordered[0][0] if ordered else None, by_id)
            if reason != "none":
                failures[strategy][reason] += 1

    strategies: dict[str, Any] = {}
    metrics = (
        "recall_at_1",
        "recall_at_3",
        "recall_at_5",
        "mrr",
        "ndcg_at_5",
        "document_hit_at_1",
        "document_hit_at_3",
        "document_hit_at_5",
        "page_hit_at_1",
        "page_hit_at_3",
        "page_hit_at_5",
        "evidence_hit_at_1",
        "evidence_hit_at_3",
        "evidence_hit_at_5",
        "no_answer_false_retrieval_at_050",
    )
    for strategy, result_rows in rows.items():
        strategies[strategy] = {metric: _mean(result_rows, metric) for metric in metrics}
        for group, selected in (
            (
                "query_class",
                {
                    key: [row for row in result_rows if row["category"] == key]
                    for key in sorted({row["category"] for row in result_rows})
                },
            ),
            (
                "language",
                {
                    key: [row for row in result_rows if row["language"] == key]
                    for key in sorted({row["language"] for row in result_rows})
                },
            ),
        ):
            strategies[strategy][f"by_{group}"] = {
                key: {
                    "count": len(group_rows),
                    **{
                        metric: _mean(group_rows, metric)
                        for metric in (
                            "recall_at_1",
                            "recall_at_3",
                            "recall_at_5",
                            "mrr",
                            "ndcg_at_5",
                            "document_hit_at_5",
                            "page_hit_at_5",
                            "evidence_hit_at_5",
                            "no_answer_false_retrieval_at_050",
                        )
                    },
                }
                for key, group_rows in selected.items()
            }
        strategies[strategy]["failure_categories"] = dict(failures[strategy])
        negative_rows = [
            row
            for row in result_rows
            if next(item for item in QUERIES if item.id == row["query_id"]).no_answer
        ]
        strategies[strategy]["no_answer_false_retrieval_rate"] = _mean(
            negative_rows, "no_answer_false_retrieval_at_050"
        )
        strategies[strategy]["exact_query_success_at_1"] = round(
            statistics.mean(
                row["evidence_hit_at_1"]
                for row in result_rows
                if next(item for item in QUERIES if item.id == row["query_id"]).category
                in EXACT_CATEGORIES
            ),
            4,
        )
        strategies[strategy]["numeric_evidence_success_at_5"] = (
            strategies[strategy]["by_query_class"].get("numeric", {}).get("evidence_hit_at_5", 0.0)
        )

    return {
        "model": getattr(gateway, "model", "unknown"),
        "provider": getattr(gateway, "provider", "unknown"),
        "dimension": dimension,
        "document_count": len({item.source_id for item in DOCUMENTS}),
        "evidence_chunk_count": len(DOCUMENTS),
        "query_count": len(QUERIES),
        "query_classes": dict(Counter(query.category for query in QUERIES)),
        "query_languages": dict(Counter(query.language for query in QUERIES)),
        "source_metadata": DOCUMENT_METADATA,
        "document_sha256": {item.id: document_sha256(item) for item in DOCUMENTS},
        "document_manifest": [
            {
                "document_id": item.id,
                "source_id": item.source_id,
                "title": item.title,
                "page": item.page,
                "language": item.language,
                "evidence_type": item.evidence_type,
                "source": item.source,
                "license": item.license,
                "sha256": item.sha256,
            }
            for item in DOCUMENTS
        ],
        "judgments": [
            {
                "query_id": query.id,
                "query": query.text,
                "language": query.language,
                "query_class": query.category,
                "no_answer": query.no_answer,
                "relevant_document_ids": query.relevant_document_ids,
                "relevant_pages": query.relevant_pages,
                "relevant_targets": [
                    {
                        "document_id": next(
                            item for item in DOCUMENTS if item.id == evidence_id
                        ).source_id,
                        "page": next(item for item in DOCUMENTS if item.id == evidence_id).page,
                        "evidence_id": evidence_id,
                    }
                    for evidence_id in query.relevant_ids
                ],
                "acceptable_alternates": [],
            }
            for query in QUERIES
        ],
        "exact_router": {
            "counts": dict(exact_route_counts),
            "exact_class_route_rate": round(
                statistics.mean(
                    bool(classify_exact_query(query.text))
                    for query in QUERIES
                    if query.category in EXACT_CATEGORIES
                ),
                4,
            ),
            "semantic_class_overroute_rate": round(
                statistics.mean(
                    bool(classify_exact_query(query.text))
                    for query in QUERIES
                    if query.category in {"semantic", "paraphrase", "multilingual"}
                ),
                4,
            ),
            "score_threshold_for_no_answer_false_retrieval": SCORE_THRESHOLD,
        },
        "document_embedding_seconds": round(document_embedding_seconds, 4),
        "document_embeddings_per_second": round(
            len(DOCUMENTS) / max(document_embedding_seconds, 1e-9), 3
        ),
        "query_latency_ms_p50": round(statistics.median(query_times) * 1000, 3),
        "query_latency_ms_p95": round(_percentile(query_times, 95) * 1000, 3),
        "hybrid_retrieval_ms_p50": round(statistics.median(retrieval_times) * 1000, 3),
        "hybrid_retrieval_ms_p95": round(_percentile(retrieval_times, 95) * 1000, 3),
        "vector_index_bytes_float32": len(DOCUMENTS) * dimension * 4,
        "estimated_api_cost_usd": 0.0,
        "strategies": strategies,
        "query_rankings": query_rankings,
        "notes": {
            "hybrid": "0.65 lexical + 0.35 cosine semantic; exact guardrail routes only classified queries to lexical ranking.",
            "query_latency": "Local query-embedding encode only after warmup; excludes model load and HTTP transport.",
            "hybrid_retrieval_latency": "Scoring and sorting over the fixed 30-evidence corpus; excludes embedding time.",
            "index_size": "Dense float32 vectors only; excludes database rows, JSON copies, ANN overhead and metadata.",
            "no_answer": "False retrieval is top-1 score >= fixed 0.50; all unthresholded top-k lists naturally contain candidates.",
            "judgments": "Hand-authored against stable synthetic evidence IDs; no evaluated model generated or relabeled golds.",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=["fake", *MODEL_CANDIDATES, "all"], default="all")
    parser.add_argument(
        "--output", type=Path, default=Path("/tmp/chemdft-document-embedding-results.json")
    )
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    names = ["fake", *MODEL_CANDIDATES] if args.model == "all" else [args.model]
    results = []
    for name in names:
        gateway = (
            DeterministicFakeEmbeddingGateway()
            if name == "fake"
            else HuggingFaceSentenceGateway(name, offline=args.offline)
        )
        results.append(evaluate_gateway(gateway))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2), encoding="utf-8")
    compact = []
    for item in results:
        compact.append(
            {
                "model": item["model"],
                "dimension": item["dimension"],
                "query_count": item["query_count"],
                "query_latency_ms_p50": item["query_latency_ms_p50"],
                "query_latency_ms_p95": item["query_latency_ms_p95"],
                "document_embeddings_per_second": item["document_embeddings_per_second"],
                "vector_index_bytes_float32": item["vector_index_bytes_float32"],
                "strategies": {
                    name: {
                        key: value[key]
                        for key in (
                            "recall_at_1",
                            "recall_at_3",
                            "recall_at_5",
                            "mrr",
                            "ndcg_at_5",
                            "document_hit_at_5",
                            "page_hit_at_5",
                            "evidence_hit_at_5",
                            "exact_query_success_at_1",
                            "numeric_evidence_success_at_5",
                            "no_answer_false_retrieval_at_050",
                        )
                    }
                    for name, value in item["strategies"].items()
                },
            }
        )
    print(json.dumps(compact, indent=2))


if __name__ == "__main__":
    main()
