"""Presentation for new and historical result data without changing scientific records."""

from __future__ import annotations


def legacy_v3_retrieval_labels(retrieval: dict) -> dict:
    """Rename only display labels. Do not change numbers or the frozen result."""
    return {
        **{f"pooled_target_recall_at_{k}": retrieval[f"recall_at_{k}"] for k in (1, 3, 5)},
        **{f"chunk_hit_at_{k}": retrieval[f"chunk_hit_at_{k}"] for k in (1, 3, 5)},
        **{f"document_hit_at_{k}": retrieval[f"document_hit_at_{k}"] for k in (1, 3, 5)},
        "mrr": retrieval["mrr"],
        "ndcg_at_5": retrieval["ndcg_at_5"],
    }
