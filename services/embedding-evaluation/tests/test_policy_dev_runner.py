"""Focused tests for the DEV-only retrieval-policy experiment harness."""

from __future__ import annotations

import ast
import hashlib
import inspect

import pytest

from embedding_eval.frozen_policy_dev_v1 import load_dev_qrels
from embedding_eval.policy_dev_runner import (
    ABSTENTION_SEARCH,
    FOLDS,
    _canonical,
    _choose_rule,
    _policy_stats,
    _rank_metrics,
    build_selected_policy,
    create_blind_authorization,
    grouped_folds,
)
from embedding_eval.retrieval_policy import RRF_K, rank_by_score


def test_dev_loader_has_exact_pinned_counts() -> None:
    rows = load_dev_qrels()
    assert len(rows) == 71
    assert sum(not row["no_answer"] for row in rows) == 50
    assert sum(row["no_answer"] for row in rows) == 21


def test_grouped_folds_are_deterministic_balanced_and_keep_groups_atomic() -> None:
    rows = load_dev_qrels()
    assignment = grouped_folds(rows)
    assert assignment == grouped_folds(rows)
    assert len(set(assignment.values())) == FOLDS
    for group in {row.get("leakage_group_id") or row["query_id"] for row in rows}:
        assert (
            len(
                {
                    assignment[row["query_id"]]
                    for row in rows
                    if (row.get("leakage_group_id") or row["query_id"]) == group
                }
            )
            == 1
        )
    fold_sizes = [sum(fold == assignment[row["query_id"]] for row in rows) for fold in range(FOLDS)]
    assert sorted(fold_sizes) == [14, 14, 14, 14, 15]


def test_deterministic_ranking_and_fixed_rrf_constant() -> None:
    assert rank_by_score({"b": 0.5, "a": 0.5, "c": 0.1}) == ["a", "b", "c"]
    assert RRF_K == 60


def test_abstention_rule_selection_and_decision_are_deterministic() -> None:
    def signals(dense: float) -> dict[str, float]:
        return {family: 0.0 for family in ABSTENTION_SEARCH["rule_families"]} | {
            "top1_dense_score": dense
        }

    rows = []
    for index in range(10):
        rows.append(
            {
                "query_id": f"a{index}",
                "no_answer": False,
                "signals": signals(0.8 if index < 8 else 0.2),
                "metrics": {"chunk_hit_at_5": int(index < 8), "mrr": 1.0, "ndcg_at_5": 1.0},
            }
        )
    for index in range(10):
        rows.append(
            {
                "query_id": f"n{index}",
                "no_answer": True,
                "signals": signals(0.1),
                "metrics": {},
            }
        )
    rule = _choose_rule(rows, 1.0)
    assert rule == _choose_rule(rows, 1.0)
    accepts = {row["query_id"]: row["signals"][rule["family"]] >= rule["threshold"] for row in rows}
    stats = _policy_stats(rows, accepts)
    assert stats["no_answer_false_accept_rate"] == 0.0
    assert stats["answerable_acceptance"] >= 0.5


def test_legitimate_alternate_target_scores_as_acceptable() -> None:
    row = {
        "acceptable_targets": [
            {"expected_chunk_id": "primary", "expected_document_id": "doc-a"},
            {"expected_chunk_id": "alternate", "expected_document_id": "doc-b"},
        ]
    }
    metrics = _rank_metrics(
        ["same-document-other-chunk", "alternate", "primary"],
        row,
        {
            "same-document-other-chunk": "doc-b",
            "alternate": "doc-b",
            "primary": "doc-a",
        },
    )
    assert metrics["chunk_hit_at_1"] == 0
    assert metrics["document_hit_at_1"] == 1
    assert metrics["recall_at_3"] == 1


def test_policy_canonicalization_and_behavioral_hashing() -> None:
    split = {
        "frozen_qrels_sha256": "a" * 64,
        "split_sha256": "b" * 64,
        "corpus_manifest_sha256": "e" * 64,
        "chunk_inventory_sha256": "f" * 64,
    }
    model = {
        "identifier": "BAAI/bge-m3",
        "revision": "r",
        "dimension": 1024,
        "library_versions": {"torch": "1"},
    }
    values = {
        "selected": "A",
        "final_rule": {"family": "top1_dense_score", "threshold": 0.5},
        "split": split,
        "model": model,
        "evaluation_commit": "c" * 40,
        "evaluator_sha256": "d" * 64,
    }
    first = build_selected_policy(**values)
    second = build_selected_policy(**values)
    assert _canonical(first) == _canonical(second)
    first_sha = hashlib.sha256(_canonical(first)).hexdigest()
    changed = build_selected_policy(
        **(values | {"final_rule": {"family": "top1_dense_score", "threshold": 0.6}})
    )
    assert hashlib.sha256(_canonical(changed)).hexdigest() != first_sha


def test_policy_cannot_be_frozen_when_dev_gate_fails() -> None:
    with pytest.raises(ValueError, match="Cannot freeze"):
        build_selected_policy(
            selected=None,
            final_rule=None,
            split={},
            model={},
            evaluation_commit="",
            evaluator_sha256="",
        )


def test_blind_authorization_requires_selected_policy_sha() -> None:
    with pytest.raises(ValueError, match="requires a passing gate"):
        create_blind_authorization(None, {}, "2026-09-25T00:00:00Z", "PASS")


def test_experiment_path_does_not_import_blind_scoring_or_discover_qrels() -> None:
    from embedding_eval import policy_dev_runner

    tree = ast.parse(inspect.getsource(policy_dev_runner))
    imported = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imported.append(node.module)
    assert not any("blind" in (name or "").lower() for name in imported)
    source = inspect.getsource(policy_dev_runner)
    assert "load_dev_qrels()" in source
    assert ".glob(" not in source
    assert ".rglob(" not in source
