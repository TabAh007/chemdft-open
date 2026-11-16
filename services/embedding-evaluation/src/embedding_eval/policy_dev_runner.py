"""DEV-only grouped evaluation for the predeclared retrieval policy candidates.

This module imports judgments only through the pinned DEV loader and reads the
local-only corpus companion at its fixed path. It never discovers QREL files.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import itertools
import json
import math
import statistics
import time
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from .frozen_policy_dev_v1 import EVAL_ROOT, load_dev_qrels
from .metrics import ndcg_at_k
from .models import MODEL_CANDIDATES, HuggingFaceSentenceGateway
from .retrieval import hybrid_score, lexical_score
from .retrieval_policy import (
    RRF_K,
    abstention_signals,
    reciprocal_rank_fusion,
    semantic_with_exact_boost,
)

ROOT = EVAL_ROOT.parents[1]
MANIFEST_PATH = EVAL_ROOT / "retrieval-policy-dev-v1-manifest.json"
SPLIT_PATH = EVAL_ROOT / "retrieval-policy-dev-v1-split-frozen.json"
CORPUS_PATH = Path("/tmp/chemdft-retrieval-policy-dev-v1-corpus.json")
RESULT_PATH = EVAL_ROOT / "results" / "retrieval-policy-dev-v1" / "evaluation.json"
POLICY_PATH = EVAL_ROOT / "results" / "retrieval-policy-dev-v1" / "selected-policy.json"
AUTHORIZATION_PATH = (
    EVAL_ROOT / "results" / "retrieval-policy-dev-v1" / "blind-evaluation-authorization.json"
)
FOLDS = 5
FOLD_SEED = 20260925
ABSTENTION_SEARCH = {
    "rule_families": [
        "top1_dense_score",
        "top1_top2_margin",
        "top1_top5_spread",
        "top1_lexical_score",
        "inverse_top1_lexical_rank",
        "top5_document_diversity",
        "top1_exact_token_overlap",
        "semantic_lexical_agreement",
        "dense_and_lexical_corroboration",
        "dense_and_semantic_lexical_agreement",
    ],
    "thresholds": "all distinct training-fold signal cut points; midpoint for continuous signals; fixed Boolean cut at true",
    "inner_folds": 4,
    "selection": "max SAFE_RECALL@5 subject to false-accept-rate <= 10% and answerable acceptance >= 50%; then answerable Recall@5, MRR, nDCG@5, lower p95 latency; deterministic rule-name and threshold tie-break",
    "no_query_specific_rules": True,
}


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _load_inputs() -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    qrels = load_dev_qrels()
    if (
        len(qrels) != 71
        or sum(not row["no_answer"] for row in qrels) != 50
        or sum(row["no_answer"] for row in qrels) != 21
    ):
        raise ValueError("Pinned DEV loader returned an unexpected count.")
    split = json.loads(SPLIT_PATH.read_bytes())
    manifest = json.loads(MANIFEST_PATH.read_bytes())
    if split["status"] != "FROZEN" or split["dev"]["count"] != 71:
        raise ValueError("Frozen DEV split metadata failed preflight.")
    if (
        hashlib.sha256(MANIFEST_PATH.read_bytes()).hexdigest()
        != "1f9bd97fddd758463cfdb0814713a3d3673e8e9ab67ede4abdc52663be2503bc"
    ):
        raise ValueError("Frozen corpus manifest digest mismatch.")
    if _sha(split["membership"]) != split["split_sha256"]:
        raise ValueError("Frozen split mapping digest mismatch.")
    if _sha(manifest["chunks"]) != split["chunk_inventory_sha256"]:
        raise ValueError("Frozen chunk inventory digest mismatch.")
    companion = json.loads(CORPUS_PATH.read_bytes())
    if (
        companion.get("benchmark_id") != "retrieval-policy-dev-v1"
        or companion.get("status") != "LOCAL_AUTHORING_ONLY"
    ):
        raise ValueError("Local corpus companion identity mismatch.")
    inventory = {chunk["chunk_id"]: chunk for chunk in manifest["chunks"]}
    records = companion["chunks"]
    if (
        len(records) != 342
        or len(inventory) != 342
        or len({row["chunk_id"] for row in records}) != 342
    ):
        raise ValueError("Frozen corpus chunk count or uniqueness mismatch.")
    for record in records:
        expected = inventory.get(record["chunk_id"])
        if (
            expected is None
            or expected["content_sha256"] != record["content_sha256"]
            or hashlib.sha256(record["content"].encode()).hexdigest() != record["content_sha256"]
        ):
            raise ValueError("Local corpus chunk differs from the frozen inventory.")
    chunk_ids = set(inventory)
    for row in qrels:
        for target in row["acceptable_targets"]:
            if target["expected_chunk_id"] not in chunk_ids:
                raise ValueError("A DEV acceptable target is absent from the frozen corpus.")
    return qrels, records, split


def _group_key(row: dict[str, Any]) -> str:
    return str(row.get("leakage_group_id") or row["query_id"])


def grouped_folds(
    rows: list[dict[str, Any]], n_folds: int = FOLDS, seed: int = FOLD_SEED
) -> dict[str, int]:
    """Greedy deterministic grouped stratification; leakage groups are indivisible."""
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[_group_key(row)].append(row)
    totals: Counter[str] = Counter()
    features: dict[str, Counter[str]] = {}
    for group, members in groups.items():
        item: Counter[str] = Counter()
        for row in members:
            item[f"answer:{int(not row['no_answer'])}"] += 1
            item[f"language:{row.get('language', 'unknown')}"] += 1
            item[f"class:{row.get('query_class', 'unknown')}"] += 1
        features[group] = item
        totals.update(item)
    fold_counts = [Counter() for _ in range(n_folds)]
    fold_sizes = [0] * n_folds
    assignment: dict[str, int] = {}
    ordered = sorted(
        groups,
        key=lambda group: (
            -len(groups[group]),
            hashlib.sha256(f"{seed}:{group}".encode()).hexdigest(),
        ),
    )
    for group in ordered:
        size = len(groups[group])

        def cost(
            fold: int,
            group: str = group,
            size: int = size,
            group_features: Counter[str] = features[group],
        ) -> tuple[float, int, str]:
            target_size = len(rows) / n_folds
            score = (
                (fold_sizes[fold] + size - target_size) ** 2 - (fold_sizes[fold] - target_size) ** 2
            ) / max(1, target_size**2)
            for feature, total in totals.items():
                desired = total / n_folds
                current = fold_counts[fold][feature]
                updated = current + group_features[feature]
                score += ((updated - desired) ** 2 - (current - desired) ** 2) / max(1, desired**2)
            return (
                score,
                fold_sizes[fold],
                hashlib.sha256(f"{seed}:{group}:{fold}".encode()).hexdigest(),
            )

        chosen = min(range(n_folds), key=cost)
        assignment[group] = chosen
        fold_sizes[chosen] += size
        fold_counts[chosen].update(features[group])
    query_assignment = {row["query_id"]: assignment[_group_key(row)] for row in rows}
    for group, members in groups.items():
        if len({query_assignment[row["query_id"]] for row in members}) != 1:
            raise AssertionError("A leakage group crossed grouped folds.")
    return query_assignment


def _rank_metrics(
    ranking: list[str], row: dict[str, Any], document_by_chunk: dict[str, str]
) -> dict[str, float | int]:
    targets = row["acceptable_targets"]
    relevant = {target["expected_chunk_id"] for target in targets}
    relevant_docs = {target["expected_document_id"] for target in targets}
    hit = {k: int(bool(set(ranking[:k]) & relevant)) for k in (1, 3, 5)}
    document_hit = {
        k: int(any(document_by_chunk.get(item) in relevant_docs for item in ranking[:k]))
        for k in (1, 3, 5)
    }
    recall = {
        k: len(set(ranking[:k]) & relevant) / len(relevant) if relevant else 0.0 for k in (1, 3, 5)
    }
    return {
        **{f"chunk_hit_at_{k}": hit[k] for k in hit},
        **{f"document_hit_at_{k}": document_hit[k] for k in document_hit},
        **{f"recall_at_{k}": recall[k] for k in recall},
        "mrr": next(
            (1.0 / rank for rank, chunk in enumerate(ranking, 1) if chunk in relevant), 0.0
        ),
        "ndcg_at_5": ndcg_at_k(ranking, relevant, 5),
    }


def _signals(
    semantic_scores: dict[str, float],
    lexical_scores: dict[str, float],
    records_by_id: dict[str, dict[str, Any]],
    query: str,
) -> dict[str, float]:
    sem = sorted(semantic_scores, key=lambda key: (-semantic_scores[key], key))
    docs = [records_by_id[key]["document_id"] for key in sem[:5]]
    target_signals = abstention_signals(
        semantic_scores,
        lexical_scores,
        {key: record["document_id"] for key, record in records_by_id.items()},
        {key: record["content"] for key, record in records_by_id.items()},
        query,
    )
    lexical_rank = target_signals["top1_lexical_rank"]
    return {
        "top1_dense_score": float(target_signals["top1_dense_score"] or 0.0),
        "top1_top2_margin": float(target_signals["top1_top2_margin"] or 0.0),
        "top1_top5_spread": float(target_signals["top1_top5_spread"] or 0.0),
        "top1_lexical_score": float(target_signals["top1_lexical_score"] or 0.0),
        "inverse_top1_lexical_rank": 1.0 / lexical_rank if lexical_rank else 0.0,
        "top5_document_diversity": len(set(docs)) / max(1, len(docs)),
        "top1_exact_token_overlap": float(bool(target_signals["top1_exact_token_overlap"])),
        "semantic_lexical_agreement": float(bool(target_signals["semantic_lexical_agreement"])),
        "dense_and_lexical_corroboration": min(
            float(target_signals["top1_dense_score"] or 0.0),
            float(target_signals["top1_lexical_score"] or 0.0),
        ),
        "dense_and_semantic_lexical_agreement": float(target_signals["top1_dense_score"] or 0.0)
        * float(bool(target_signals["semantic_lexical_agreement"])),
    }


def _rule_thresholds(values: list[float]) -> list[float]:
    unique = sorted(set(values))
    if len(unique) <= 1:
        return [unique[0] if unique else math.inf]
    return [
        unique[0] - 1e-12,
        *(a + (b - a) / 2 for a, b in itertools.pairwise(unique)),
        unique[-1] + 1e-12,
    ]


def _policy_stats(rows: list[dict[str, Any]], accepts: dict[str, bool]) -> dict[str, float | int]:
    ans = [row for row in rows if not row["no_answer"]]
    neg = [row for row in rows if row["no_answer"]]
    false_accept = sum(accepts[row["query_id"]] for row in neg)
    accepted = sum(accepts[row["query_id"]] for row in ans)
    safe_hits = sum(accepts[row["query_id"]] and row["metrics"]["chunk_hit_at_5"] for row in ans)
    return {
        "no_answer_false_accept_count": false_accept,
        "no_answer_correct_abstain_count": len(neg) - false_accept,
        "no_answer_false_accept_rate": false_accept / len(neg) if neg else 0.0,
        "answerable_acceptance": accepted / len(ans) if ans else 0.0,
        "safe_recall_at_5": safe_hits / len(ans) if ans else 0.0,
        "answerable_recall_at_5_before_abstention": sum(
            row["metrics"]["chunk_hit_at_5"] for row in ans
        )
        / len(ans)
        if ans
        else 0.0,
        "mrr": sum(row["metrics"]["mrr"] for row in ans) / len(ans) if ans else 0.0,
        "ndcg_at_5": sum(row["metrics"]["ndcg_at_5"] for row in ans) / len(ans) if ans else 0.0,
    }


def _choose_rule(train_rows: list[dict[str, Any]], latency_p95: float) -> dict[str, Any]:
    if not train_rows:
        raise ValueError("Cannot choose abstention rule without training-fold rows.")
    best: tuple[tuple[float, ...], dict[str, Any]] | None = None
    families = ABSTENTION_SEARCH["rule_families"]
    for family in families:
        thresholds = _rule_thresholds([row["signals"][family] for row in train_rows])
        for threshold in thresholds:
            accepts = {row["query_id"]: row["signals"][family] >= threshold for row in train_rows}
            stats = _policy_stats(train_rows, accepts)
            if (
                stats["no_answer_false_accept_rate"] > 0.10 + 1e-12
                or stats["answerable_acceptance"] < 0.50 - 1e-12
            ):
                continue
            key = (
                stats["safe_recall_at_5"],
                stats["answerable_recall_at_5_before_abstention"],
                stats["mrr"],
                stats["ndcg_at_5"],
                -latency_p95,
                -families.index(family),
                -threshold,
            )
            rule = {"family": family, "threshold": float(threshold)}
            if best is None or key > best[0]:
                best = (key, rule)
    return best[1] if best else {"family": "always_abstain", "threshold": None}


def _summary(metrics: list[dict[str, Any]]) -> dict[str, Any]:
    keys = [
        "recall_at_1",
        "recall_at_3",
        "recall_at_5",
        "mrr",
        "ndcg_at_5",
        "document_hit_at_1",
        "document_hit_at_3",
        "document_hit_at_5",
        "chunk_hit_at_1",
        "chunk_hit_at_3",
        "chunk_hit_at_5",
    ]
    return {
        key: sum(row[key] for row in metrics) / len(metrics) if metrics else None for key in keys
    }


def _model_versions() -> dict[str, Any]:
    names = [
        "sentence-transformers",
        "transformers",
        "torch",
        "numpy",
        "tokenizers",
        "huggingface-hub",
    ]
    return {name: importlib.metadata.version(name) for name in names}


def build_selected_policy(
    *,
    selected: str | None,
    final_rule: dict[str, Any] | None,
    split: dict[str, Any],
    model: dict[str, Any],
    evaluation_commit: str,
    evaluator_sha256: str,
) -> dict[str, Any]:
    """Construct a behavior-complete policy only after the predeclared gate passes."""
    if selected is None or final_rule is None:
        raise ValueError("Cannot freeze a retrieval policy when DEV_POLICY_GATE failed.")
    retrieval: dict[str, Any] = {
        "candidate_id": selected,
        "ranking": {
            "A": "BGE cosine similarity, descending",
            "B": "0.65 deterministic lexical + 0.35 BGE cosine, descending",
            "C": "reciprocal rank fusion of BGE and lexical rankings",
            "D": "BGE semantic ranking with fixed exact-token nudge",
        }[selected],
        "top_k": 5,
        "tie_break": "chunk_id ascending",
    }
    if selected == "B":
        retrieval["weights"] = {"lexical": 0.65, "dense_cosine": 0.35}
    if selected == "C":
        retrieval["rrf_k"] = RRF_K
    if selected == "D":
        retrieval["exact_token_nudge"] = {
            "max_semantic_rank": 10,
            "boost_ranks": 1,
            "signals": [
                "DOI",
                "recognized_formula",
                "numeric_value_plus_unit",
                "known_method_or_basis",
            ],
        }
    if selected in {"B", "C"}:
        retrieval["lexical"] = {
            "implementation": "embedding_eval.retrieval.lexical_score",
            "normalization": "NFKC, casefold, whitespace collapse",
            "score": "query-token overlap fraction plus 0.35 exact normalized substring bonus, capped at 1.0",
            "tokenizer": "TOKEN_RE from evaluation code",
        }
    return {
        "schema_version": 1,
        "development_partition_only": True,
        "holdout_scored": False,
        "production_changed": False,
        "retriever": retrieval,
        "model": model,
        "embedding": {
            "dimension": 1024,
            "normalization": "L2",
            "pooling": "SentenceTransformers configured pooling",
            "query_prefix": "",
            "document_prefix": "",
            "dtype": "float32",
            "batch_size": 16,
        },
        "abstention": {
            "decision": "accept iff signal >= threshold; otherwise return NO SUFFICIENT EVIDENCE",
            "signal": final_rule["family"],
            "threshold": final_rule["threshold"],
            "signal_definition": {
                "top1_dense_score": "cosine similarity of the highest-ranked BGE chunk",
                "top1_top2_margin": "highest minus second-highest BGE cosine score",
                "top1_top5_spread": "highest minus fifth-highest BGE cosine score",
                "top1_lexical_score": "deterministic lexical score of the highest-ranked BGE chunk",
                "inverse_top1_lexical_rank": "1 divided by the rank of the highest-ranked BGE chunk in lexical ranking; zero if absent",
                "top5_document_diversity": "distinct source documents among top five BGE chunks divided by five",
                "top1_exact_token_overlap": "whether the top BGE chunk shares a recognized exact token with query",
                "semantic_lexical_agreement": "whether BGE and lexical rankings share the same top chunk",
                "dense_and_lexical_corroboration": "minimum of top BGE cosine score and top BGE chunk lexical score",
                "dense_and_semantic_lexical_agreement": "top BGE cosine score when lexical and semantic top chunks agree, else zero",
            }[final_rule["family"]],
            "tuning": "finite predeclared signal families and training-fold cut points, selected on DEV only",
        },
        "seeds": {"grouped_folds": FOLD_SEED},
        "package_versions": model["library_versions"],
        "evaluation_code": {
            "git_commit_before_experiment": evaluation_commit,
            "runner_sha256": evaluator_sha256,
        },
        "dev_qrels_sha256": split["frozen_qrels_sha256"],
        "dev_split_sha256": split["split_sha256"],
        "dev_corpus_manifest_sha256": split["corpus_manifest_sha256"],
        "dev_chunk_inventory_sha256": split["chunk_inventory_sha256"],
        "selection_rule_version": "dev-policy-gate-v1-safe-recall5",
    }


def create_blind_authorization(
    policy_sha256: str | None, hashes: dict[str, str], timestamp: str, gate: str
) -> dict[str, Any]:
    if gate != "PASS" or not policy_sha256 or len(policy_sha256) != 64:
        raise ValueError("Blind authorization requires a passing gate and selected policy SHA-256.")
    return {
        "selected_policy_sha256": policy_sha256,
        "dev_benchmark_hashes": hashes,
        "selection_timestamp_utc": timestamp,
        "policy_gate": "PASS",
        "blind_data_accessed": False,
        "old_contaminated_holdout_scored": False,
        "policy_frozen_before_blind_evaluation": True,
    }


def run(*, persist: bool = True) -> dict[str, Any]:
    qrels, chunks, split = _load_inputs()
    records_by_id = {row["chunk_id"]: row for row in chunks}
    config = MODEL_CANDIDATES["bge-m3"]
    gateway = HuggingFaceSentenceGateway("bge-m3", offline=False)
    corpus_texts = [row["content"] for row in chunks]
    started = time.perf_counter()
    doc_embeddings = gateway.embed_documents(corpus_texts)
    corpus_seconds = time.perf_counter() - started
    matrix = np.asarray([embedding.vector for embedding in doc_embeddings], dtype=np.float32)
    if matrix.shape != (len(chunks), config["dimension"]):
        raise ValueError("Pinned BGE model returned an unexpected vector matrix.")
    chunk_ids = [row["chunk_id"] for row in chunks]
    document_by_chunk = {row["chunk_id"]: row["document_id"] for row in chunks}
    qrels_by_id = {row["query_id"]: row for row in qrels}
    folds = grouped_folds(qrels)
    if grouped_folds(qrels) != folds:
        raise AssertionError("Fold assignment is not deterministic.")
    raw: dict[str, dict[str, Any]] = {candidate: {} for candidate in ("A", "B", "C", "D")}
    query_latencies: list[float] = []
    total_query_latencies: list[float] = []
    ranking_latencies: dict[str, list[float]] = defaultdict(list)
    for qrel in qrels:
        query_total_started = time.perf_counter()
        started = time.perf_counter()
        query_embedding = gateway.embed_query(qrel["query"])
        query_ms = (time.perf_counter() - started) * 1000
        query_latencies.append(query_ms)
        dense = matrix @ np.asarray(query_embedding.vector, dtype=np.float32)
        dense_scores = {
            chunk_id: float(score) for chunk_id, score in zip(chunk_ids, dense, strict=True)
        }
        lexical_scores = {
            row["chunk_id"]: lexical_score(qrel["query"], row["content"]) for row in chunks
        }
        ranking_started = time.perf_counter()
        semantic_order = sorted(chunk_ids, key=lambda key: (-dense_scores[key], key))
        lexical_order = sorted(chunk_ids, key=lambda key: (-lexical_scores[key], key))
        hybrid_scores = {
            key: hybrid_score(lexical_scores[key], dense_scores[key]) for key in chunk_ids
        }
        rrf_order, _ = reciprocal_rank_fusion(semantic_order, lexical_order, k=RRF_K)
        exact_order, _ = semantic_with_exact_boost(
            qrel["query"], semantic_order, {key: records_by_id[key]["content"] for key in chunk_ids}
        )
        rankings = {
            "A": semantic_order,
            "B": sorted(chunk_ids, key=lambda key: (-hybrid_scores[key], key)),
            "C": rrf_order,
            "D": exact_order,
        }
        signals = _signals(dense_scores, lexical_scores, records_by_id, qrel["query"])
        ranking_elapsed_ms = (time.perf_counter() - ranking_started) * 1000 / len(rankings)
        for candidate, ranking in rankings.items():
            ranking_latencies[candidate].append(ranking_elapsed_ms)
            raw[candidate][qrel["query_id"]] = {
                "query_id": qrel["query_id"],
                "fold": folds[qrel["query_id"]],
                "no_answer": bool(qrel["no_answer"]),
                "language": qrel.get("language", "unknown"),
                "query_class": qrel.get("query_class", "unknown"),
                "signals": signals,
                "metrics": (
                    _rank_metrics(ranking, qrel, document_by_chunk) if not qrel["no_answer"] else {}
                ),
                "top5": ranking[:5],
            }
        total_query_latencies.append((time.perf_counter() - query_total_started) * 1000)
    oof_results: dict[str, Any] = {}
    unthresholded: dict[str, Any] = {}
    for candidate, by_id in raw.items():
        rows = list(by_id.values())
        answer_rows = [row for row in rows if not row["no_answer"]]
        unthresholded[candidate] = _summary([row["metrics"] for row in answer_rows])
        decision: dict[str, bool] = {}
        selected_rules: dict[str, Any] = {}
        for outer in range(FOLDS):
            train = [row for row in rows if row["fold"] != outer]
            validation = [row for row in rows if row["fold"] == outer]
            inner_assignment = grouped_folds(
                [qrels_by_id[row["query_id"]] for row in train],
                n_folds=min(
                    4, max(2, len({_group_key(qrels_by_id[row["query_id"]]) for row in train}))
                ),
                seed=FOLD_SEED + outer + 1,
            )
            inner_oof: list[dict[str, Any]] = []
            for inner in sorted(set(inner_assignment.values())):
                inner_oof.extend(row for row in train if inner_assignment[row["query_id"]] == inner)
            p95 = float(np.percentile(ranking_latencies[candidate], 95))
            rule = _choose_rule(inner_oof, p95)
            selected_rules[str(outer)] = rule
            for row in validation:
                decision[row["query_id"]] = (
                    rule["family"] != "always_abstain"
                    and row["signals"][rule["family"]] >= rule["threshold"]
                )
        if len(decision) != len(rows):
            raise AssertionError("OOF abstention decisions are incomplete.")
        stats = _policy_stats(rows, decision)
        eligible = (
            stats["no_answer_false_accept_rate"] <= 0.10 + 1e-12
            and stats["answerable_acceptance"] >= 0.50 - 1e-12
        )
        oof_results[candidate] = {
            **stats,
            "eligible": eligible,
            "answerable_retrieval_metrics_before_abstention": unthresholded[candidate],
            "selected_rule_by_outer_fold": selected_rules,
            "out_of_fold_decision_count": len(decision),
        }
    eligible_candidates = [
        candidate for candidate in ("A", "B", "C", "D") if oof_results[candidate]["eligible"]
    ]
    selected = (
        max(
            eligible_candidates,
            key=lambda candidate: (
                oof_results[candidate]["safe_recall_at_5"],
                oof_results[candidate]["answerable_recall_at_5_before_abstention"],
                oof_results[candidate]["mrr"],
                oof_results[candidate]["ndcg_at_5"],
                -float(np.percentile(ranking_latencies[candidate], 95)),
                -ord(candidate),
            ),
        )
        if eligible_candidates
        else None
    )
    timestamp = datetime.now(UTC).isoformat()
    policy_sha = None
    final_rule = None
    model_metadata = {
        "identifier": config["repository"],
        "revision": config["revision"],
        "dimension": config["dimension"],
        "normalization": "L2-normalized embeddings; float32 cosine dot product",
        "pooling": "SentenceTransformers configured pooling",
        "query_prefix": config["query_prefix"],
        "document_prefix": config["document_prefix"],
        "device": gateway.device,
        "dtype": "float32",
        "batch_size": 16,
        "library_versions": _model_versions(),
    }
    benchmark_hashes = {
        "frozen_qrels_sha256": split["frozen_qrels_sha256"],
        "split_sha256": split["split_sha256"],
        "manifest_sha256": hashlib.sha256(MANIFEST_PATH.read_bytes()).hexdigest(),
        "chunk_inventory_sha256": split["chunk_inventory_sha256"],
    }
    if selected is not None:
        selected_rows = list(raw[selected].values())
        final_rule = _choose_rule(
            selected_rows, float(np.percentile(ranking_latencies[selected], 95))
        )
        import subprocess

        evaluation_commit = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True
        ).stdout.strip()
        evaluator_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        policy = build_selected_policy(
            selected=selected,
            final_rule=final_rule,
            split=split,
            model=model_metadata,
            evaluation_commit=evaluation_commit,
            evaluator_sha256=evaluator_sha,
        )
        policy_bytes = _canonical(policy)
        policy_sha = hashlib.sha256(policy_bytes).hexdigest()
        if persist:
            POLICY_PATH.parent.mkdir(parents=True, exist_ok=True)
            POLICY_PATH.write_bytes(policy_bytes)
            authorization = create_blind_authorization(
                policy_sha, benchmark_hashes, timestamp, "PASS"
            )
            AUTHORIZATION_PATH.write_bytes(_canonical(authorization))
    model_ms = {
        "query_embedding_p50": statistics.median(query_latencies),
        "query_embedding_p95": float(np.percentile(query_latencies, 95)),
    }
    ranking_ms = {
        candidate: {"p50": statistics.median(values), "p95": float(np.percentile(values, 95))}
        for candidate, values in ranking_latencies.items()
    }
    slices: dict[str, Any] = {}
    for candidate, by_id in raw.items():
        slices[candidate] = {}
        slice_keys = [
            {
                "language": row["language"],
                "query_class": row["query_class"],
            }
            for row in by_id.values()
            if not row["no_answer"]
        ]
        for dimension in ("language", "query_class"):
            values = sorted({item[dimension] for item in slice_keys})
            slices[candidate][dimension] = {}
            for value in values:
                subset = [
                    row["metrics"]
                    for row in by_id.values()
                    if not row["no_answer"]
                    and (row["language"] if dimension == "language" else row["query_class"])
                    == value
                ]
                slices[candidate][dimension][value] = {"n": len(subset), **_summary(subset)}
    output = {
        "schema_version": 1,
        "benchmark_id": "retrieval-policy-dev-v1",
        "partition": "DEV",
        "blind_external_access": "NONE",
        "old_holdout_scoring": "NOT_RUN",
        "benchmark_hashes": benchmark_hashes,
        "firewall_audit": {
            "dev_loader": "pinned DEV-only loader",
            "generic_qrel_discovery": False,
            "blind_package_imports": False,
            "blind_path_environment_variables": "none present",
            "old_holdout_scoring": "NOT_RUN",
            "external_blind_access": "NONE",
            "output_contains_query_text": False,
        },
        "counts": {
            "dev": len(qrels),
            "answerable": sum(not row["no_answer"] for row in qrels),
            "no_answer": sum(row["no_answer"] for row in qrels),
        },
        "fold_seed": FOLD_SEED,
        "fold_assignment": {row["query_id"]: folds[row["query_id"]] for row in qrels},
        "fold_group_count": len({_group_key(row) for row in qrels}),
        "candidate_unthresholded_answerable_metrics": unthresholded,
        "candidate_dev_slices": slices,
        "candidate_oof_abstention": oof_results,
        "selected_candidate": selected,
        "selected_abstention_rule": final_rule,
        "selected_policy_sha256": policy_sha,
        "dev_policy_gate": "PASS" if selected else "FAILED",
        "abstention_search_predeclared": ABSTENTION_SEARCH,
        "retriever": {
            "candidate_A": "BGE semantic-only",
            "candidate_B": "fixed 0.65 lexical + 0.35 cosine hybrid",
            "candidate_C": "RRF BGE + lexical, k=60",
            "candidate_D": "BGE semantic with exact-token rank nudge 1 within top 10; DOI/formula/numeric-unit/known-method tokens",
            "candidate_D_predeclared": True,
            "lexical": "embedding_eval.retrieval.lexical_score deterministic token overlap plus exact normalized substring +0.35, clipped at 1.0",
        },
        "model": {
            "identifier": config["repository"],
            "revision": config["revision"],
            "dimension": config["dimension"],
            "normalization": "L2-normalized embeddings; float32 cosine dot product",
            "pooling": "SentenceTransformers configured pooling",
            "query_prefix": config["query_prefix"],
            "document_prefix": config["document_prefix"],
            "device": gateway.device,
            "dtype": "float32",
            "batch_size": 16,
            "library_versions": _model_versions(),
        },
        "latency_ms": {
            "corpus_embedding_seconds": corpus_seconds,
            **model_ms,
            "ranking": ranking_ms,
            "total_query_p50": statistics.median(total_query_latencies),
            "total_query_p95": float(np.percentile(total_query_latencies, 95)),
            "ranking_scope": "rank generation and sorting averaged across four candidates; serialization excluded",
        },
        "storage_estimate_bytes_float32": {
            "100k_chunks": 100_000 * config["dimension"] * 4,
            "1M_chunks": 1_000_000 * config["dimension"] * 4,
        },
        "timestamp_utc": timestamp,
    }
    if persist:
        RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
        RESULT_PATH.write_text(
            json.dumps(output, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        )
    return output


if __name__ == "__main__":
    result = run()
    print(
        json.dumps(
            {
                key: result[key]
                for key in (
                    "counts",
                    "candidate_unthresholded_answerable_metrics",
                    "candidate_oof_abstention",
                    "selected_candidate",
                    "dev_policy_gate",
                    "benchmark_hashes",
                    "model",
                    "latency_ms",
                )
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
