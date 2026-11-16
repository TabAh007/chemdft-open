from __future__ import annotations

from typing import Any
import math


def ranking_metrics(ranked_ids: list[str], relevant_ids: set[str]) -> dict[str, float]:
    if not relevant_ids:
        return {f"recall_at_{k}": 0.0 for k in (1, 3, 5)} | {"mrr": 0.0}
    result: dict[str, float] = {}
    for k in (1, 3, 5):
        result[f"recall_at_{k}"] = len(set(ranked_ids[:k]) & relevant_ids) / len(relevant_ids)
    result["mrr"] = next(
        (1.0 / rank for rank, item_id in enumerate(ranked_ids, start=1) if item_id in relevant_ids),
        0.0,
    )
    return result


def source_page_hit(result: dict[str, Any], judgment: dict[str, Any]) -> bool:
    return (
        result.get("source_id") == judgment.get("source_id")
        and result.get("page") in judgment.get("pages", [])
        and result.get("evidence_type") in judgment.get("evidence_types", [])
    )


def ndcg_at_k(ranked_ids: list[str], relevant_ids: set[str], k: int = 5) -> float:
    """Binary-gain normalized discounted cumulative gain."""
    if not relevant_ids:
        return 0.0
    dcg = sum(
        1.0 / math.log2(rank + 1)
        for rank, item_id in enumerate(ranked_ids[:k], start=1)
        if item_id in relevant_ids
    )
    ideal_count = min(k, len(relevant_ids))
    ideal = sum(1.0 / math.log2(rank + 1) for rank in range(1, ideal_count + 1))
    return dcg / ideal
