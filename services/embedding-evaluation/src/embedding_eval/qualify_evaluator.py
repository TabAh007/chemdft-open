"""Non-blind qualification ONLY: pinned DEV loader or generated synthetic fixtures."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import numpy as np

from . import one_shot_blind_evaluation as evaluator


def seal_fixture(package: Path, qrels: list, chunks: list, purpose: str) -> str:
    """Materialize only caller-provided DEV/synthetic rows in an explicit temp directory."""
    evaluator._expect(purpose in {"DEV_QUALIFICATION", "SYNTHETIC_QUALIFICATION"}, "NONBLIND_ONLY")
    package.mkdir()
    payloads = {
        "qrels.json": {"schema_version": 1, "qrels": qrels},
        "corpus.json": {"schema_version": 1, "chunks": chunks},
        "review.json": {"qualification_only": True, "scientific_review_complete": False},
    }
    files = {}
    for name, value in payloads.items():
        raw = evaluator.canonical_bytes(value)
        (package / name).write_bytes(raw)
        files[name] = evaluator.sha256_bytes(raw)
    manifest = {
        "schema_version": 2,
        "benchmark_id": purpose.lower(),
        "purpose": purpose,
        "counts": {
            "qrels": len(qrels),
            "answerable": sum(not q["no_answer"] for q in qrels),
            "no_answer": sum(q["no_answer"] for q in qrels),
            "chunks": len(chunks),
            "documents": len({c["document_id"] for c in chunks}),
        },
        "files": files,
    }
    raw = evaluator.canonical_bytes(manifest)
    (package / evaluator.MANIFEST_NAME).write_bytes(raw)
    return evaluator.sha256_bytes(raw)


def synthetic_inputs():
    chunks = [
        {"chunk_id": f"c{i}", "document_id": f"d{i}", "content": f"synthetic document {i}"}
        for i in range(6)
    ]
    qrels = [
        {
            "query_id": "s1",
            "query": "synthetic answerable",
            "no_answer": False,
            "acceptable_targets": [
                {"expected_chunk_id": "c1", "expected_document_id": "d1"},
                {"expected_chunk_id": "c3", "expected_document_id": "d3"},
            ],
            "language": "en",
            "query_class": "numeric",
        },
        {
            "query_id": "s2",
            "query": "synthetic missing answer",
            "no_answer": True,
            "language": "ru",
            "query_class": "semantic",
        },
    ]
    return qrels, chunks


def qualify_dev(repo: Path) -> dict:
    from .policy_dev_runner import _load_inputs, _rank_metrics, _summary

    qrels, chunks, _ = _load_inputs()  # Pinned DEV loader plus digest-verified DEV companion only.
    _, policy = evaluator.load_policy(repo)
    model = evaluator._load_model(policy)
    docs = evaluator._embed(model, [c["content"] for c in chunks], 16)
    queries = evaluator._embed(model, [q["query"] for q in qrels], 16)
    # Compare against the original Candidate A pathway, which embeds one query per call.
    single_queries = np.vstack([evaluator._embed(model, [q["query"]], 16) for q in qrels])
    ranking, scores = evaluator.rank_dense(qrels, chunks, docs, queries)
    single_ranking, single_scores = evaluator.rank_dense(qrels, chunks, docs, single_queries)
    evaluator._expect(ranking == single_ranking, "STOP_CANDIDATE_A_RANKING_CHANGED")
    evaluator._expect(
        all(
            (scores[k] >= evaluator.THRESHOLD) == (single_scores[k] >= evaluator.THRESHOLD)
            for k in scores
        ),
        "STOP_ABSTENTION_CHANGED",
    )
    mapping = {c["chunk_id"]: c["document_id"] for c in chunks}
    # Independent original DEV ranker and acceptable-target scoring, all 71 queries.
    original_metrics = []
    for i, row in enumerate(qrels):
        dense = docs @ single_queries[i]
        original_order = sorted(
            mapping, key=lambda key: (-float(dense[list(mapping).index(key)]), key)
        )[:5]
        evaluator._expect(
            original_order == ranking[row["query_id"]], "STOP_CANDIDATE_A_RANKING_CHANGED"
        )
        if not row["no_answer"]:
            old = _rank_metrics(original_order, row, mapping)
            new = evaluator.score_answerable(original_order, row["acceptable_targets"], mapping)
            for key, value in old.items():
                actual = new[key]["rate"] if key.startswith("recall_at_") else new[key]
                evaluator._expect(abs(actual - value) < 1e-12, "STOP_TARGET_SCORING_CHANGED")
            original_metrics.append(old)
    baseline = json.loads(
        (
            repo / "services/embedding-evaluation/results/retrieval-policy-dev-v1/evaluation.json"
        ).read_bytes()
    )
    historical = baseline["candidate_unthresholded_answerable_metrics"]["A"]
    summary = _summary(original_metrics)
    # Historical MRR/nDCG used the entire ranking; compare top-k metrics only.
    for key in summary:
        if key not in {"mrr", "ndcg_at_5"}:
            evaluator._expect(
                abs(summary[key] - historical[key]) < 1e-12, "STOP_HISTORICAL_CANDIDATE_A_CHANGED"
            )
    with tempfile.TemporaryDirectory(prefix="chemdft-dev-qualification-") as temp:
        package = Path(temp).resolve() / "dev"
        digest = seal_fixture(package, qrels, chunks, "DEV_QUALIFICATION")
        result = evaluator.run(repo, package, expected_package_sha256=digest)
        reference_metrics, _ = evaluator.compute_metrics(
            qrels, ranking, scores, mapping, evaluator.THRESHOLD
        )
        evaluator._expect(result["metrics"] == reference_metrics, "STOP_FULL_RUN_METRICS_CHANGED")
        synthetic_package = Path(temp).resolve() / "synthetic"
        synthetic_rows, synthetic_chunks = synthetic_inputs()
        synthetic_sha = seal_fixture(
            synthetic_package, synthetic_rows, synthetic_chunks, "SYNTHETIC_QUALIFICATION"
        )
        synthetic_result = evaluator.run(
            repo, synthetic_package, expected_package_sha256=synthetic_sha
        )
        return {
            "purpose": "DEV_QUALIFICATION",
            "status": "COMPLETED",
            "synthetic_real_model": {
                "purpose": "SYNTHETIC_QUALIFICATION",
                "status": "COMPLETED",
                "counts": synthetic_result["counts"],
                "metrics": synthetic_result["metrics"],
                "result_sha256": synthetic_result["blind_evaluation_result_sha256"],
            },
            "counts": result["counts"],
            "metrics": result["metrics"],
            "result_sha256": result["blind_evaluation_result_sha256"],
            "candidate_a_rankings_identical": True,
            "threshold_decisions_identical": True,
            "acceptable_target_scores_identical": True,
            "historical_top_k_metrics_identical": True,
            "max_batch_vs_single_score_difference": max(
                abs(scores[k] - single_scores[k]) for k in scores
            ),
        }


def main():
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = qualify_dev(args.repo)
    args.output.write_bytes(evaluator.canonical_bytes(result) + b"\n")
    print(
        json.dumps(
            {
                "status": result["status"],
                "counts": result["counts"],
                "candidate_a_rankings_identical": True,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
