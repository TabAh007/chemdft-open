"""Run the frozen real-paper retrieval benchmark without changing production data."""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.metadata
import json
import os
import platform
import statistics
import subprocess
import sys
import time
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from .metrics import ndcg_at_k
from .models import MODEL_CANDIDATES, DeterministicFakeEmbeddingGateway, HuggingFaceSentenceGateway
from .retrieval import hybrid_score, lexical_score


ROOT = Path(__file__).resolve().parents[4]
EVAL_ROOT = ROOT / "services" / "embedding-evaluation"
OUTPUT_ROOT = EVAL_ROOT / "results" / "real-scientific-retrieval-v1"
CHUNKER_VERSION = "deterministic-scientific-v2"
SCORE_THRESHOLD = 0.50
RANK_REPEATS = 5
EXPECTED_HASHES = {
    "frozen_qrels_sha256": "a3943955b1c0fb163c1d2a4828bf417f8e13fa816b2c5c49c97c101b2e998d6d",
    "corpus_manifest_sha256": "21e3a1fd05c88d764f30391e9c5b9870c30ddea7e705ad404218fb246c751f28",
    "chunk_inventory_sha256": "a1b7541447ba6df2f30cc5bf630e37b114e6c7d9d17c6dd4550fcc8bb35d4d2c",
}
OUTPUTS = {
    "json": "frozen-v1-results.json",
    "csv": "frozen-v1-results.csv",
    "category_csv": "frozen-v1-category-summary.csv",
    "failure_csv": "frozen-v1-failure-analysis.csv",
    "run": "frozen-v1-run.json",
}
STRATEGY_NAMES = (
    "lexical_only",
    "deterministic_hash_v1_semantic_only",
    "deterministic_64d_hybrid",
    "multilingual_e5_base_semantic_only",
    "multilingual_e5_base_hybrid",
    "bge_m3_semantic_only",
    "bge_m3_hybrid",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_frozen_inputs(eval_root: Path = EVAL_ROOT) -> dict[str, str]:
    paths = {
        "frozen_qrels_sha256": eval_root / "real-paper-qrels-v1-frozen.json",
        "corpus_manifest_sha256": eval_root / "real-paper-v1-manifest.json",
        "chunk_inventory_sha256": eval_root / "real-paper-v1-chunks.json",
    }
    actual = {name: sha256_file(path) for name, path in paths.items()}
    if actual != EXPECTED_HASHES:
        raise ValueError(f"Frozen input hash mismatch; benchmark was not run: {actual}")
    return actual


def _chunk_content_hash(document_id: str, pdf_sha256: str, page: int, content: str) -> str:
    identity = "|".join(
        ["DOCUMENT_TEXT", document_id, pdf_sha256, str(page), content, CHUNKER_VERSION]
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def load_frozen_corpus(
    chunk_text_path: Path,
    eval_root: Path = EVAL_ROOT,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    hashes = verify_frozen_inputs(eval_root)
    qrel_pack = json.loads((eval_root / "real-paper-qrels-v1-frozen.json").read_text())
    manifest = json.loads((eval_root / "real-paper-v1-manifest.json").read_text())
    inventory = json.loads((eval_root / "real-paper-v1-chunks.json").read_text())
    text_data = json.loads(chunk_text_path.read_text(encoding="utf-8"))

    if qrel_pack.get("status") != "FROZEN" or qrel_pack["review"]["qrel_count"] != 73:
        raise ValueError("The benchmark QREL pack is not the expected frozen 73-query set.")
    if any(qrel["review_status"] not in {"APPROVED", "CORRECTED"} for qrel in qrel_pack["qrels"]):
        raise ValueError("The frozen QREL pack contains a non-final judgment.")
    if text_data.get("benchmark_id") != "real-scientific-retrieval-v1":
        raise ValueError("Local chunk text belongs to a different benchmark.")
    if text_data.get("status") != "LOCAL_AUTHORING_ONLY":
        raise ValueError("Expected the local-only text companion, not a public text artifact.")

    papers = {paper["benchmark_document_id"]: paper for paper in manifest["papers"]}
    inventory_docs = {
        document["benchmark_document_id"]: document for document in inventory["documents"]
    }
    if set(text_data["documents"]) != set(inventory_docs) or set(papers) != set(inventory_docs):
        raise ValueError("Manifest, chunk inventory, and local text documents do not match.")

    records: list[dict[str, Any]] = []
    by_chunk_id: dict[str, dict[str, Any]] = {}
    for benchmark_document_id, document in inventory_docs.items():
        paper = papers[benchmark_document_id]
        text_records = text_data["documents"][benchmark_document_id]
        inventory_by_id = {chunk["chunk_id"]: chunk for chunk in document["chunks"]}
        if len(text_records) != len(inventory_by_id):
            raise ValueError(f"Chunk text count mismatch for {benchmark_document_id}.")
        for text_record in text_records:
            chunk_id = text_record["chunk_id"]
            chunk = inventory_by_id.get(chunk_id)
            if chunk is None or chunk_id in by_chunk_id:
                raise ValueError(f"Unexpected or duplicate local chunk: {chunk_id}.")
            page = int(text_record["page_number"])
            content = str(text_record["content"])
            if (
                text_record["document_id"] != document["document_id"]
                or page != chunk["page_number"]
                or page < 1
                or page > paper["page_count"]
                or _chunk_content_hash(document["document_id"], paper["pdf_sha256"], page, content)
                != chunk["content_hash"]
            ):
                raise ValueError(f"Frozen chunk content integrity mismatch: {chunk_id}.")
            record = {
                "chunk_id": chunk_id,
                "document_id": document["document_id"],
                "benchmark_document_id": benchmark_document_id,
                "title": paper["title"],
                "page": page,
                "content": content,
                "content_hash": chunk["content_hash"],
                "pdf_sha256": paper["pdf_sha256"],
                "source_type": chunk["source_type"],
                "language": paper["language"],
            }
            records.append(record)
            by_chunk_id[chunk_id] = record

    if len(records) != 349:
        raise ValueError(f"Expected exactly 349 frozen chunks, got {len(records)}.")
    for qrel in qrel_pack["qrels"]:
        for target in qrel["acceptable_targets"]:
            found = by_chunk_id.get(target["chunk_id"])
            if (
                found is None
                or found["benchmark_document_id"] != target["benchmark_document_id"]
                or found["document_id"] != target["document_id"]
                or found["page"] != target["page"]
                or found["content_hash"] != target["content_hash"]
            ):
                raise ValueError(f"Frozen target integrity mismatch: {qrel['query_id']}.")
    if len(qrel_pack["qrels"]) != 73 or len(hashes) != 3:
        raise ValueError("Unexpected frozen benchmark shape.")
    return qrel_pack, manifest, records


def _cosine(left: tuple[float, ...], right: tuple[float, ...]) -> float:
    if len(left) != len(right):
        raise ValueError("Embedding dimension mismatch.")
    return max(0.0, min(1.0, sum(a * b for a, b in zip(left, right, strict=True))))


def _percentile(values: list[float], percent: int) -> float:
    return float(values[0]) if len(values) == 1 else float(np.percentile(values, percent))


def _count_rate(hits: int, count: int) -> dict[str, Any]:
    return {"hits": hits, "n": count, "rate": round(hits / count, 6) if count else None}


def score_ranking(
    ranked_ids: list[str],
    qrel: dict[str, Any],
    by_chunk: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    targets = qrel["acceptable_targets"]
    relevant_chunks = {target["chunk_id"] for target in targets}
    relevant_doc_pages = {(target["benchmark_document_id"], target["page"]) for target in targets}
    relevant_docs = {target["benchmark_document_id"] for target in targets}
    result: dict[str, Any] = {}
    for k in (1, 3, 5):
        top = ranked_ids[:k]
        chunk_hits = len(set(top) & relevant_chunks)
        page_hits = any(
            (by_chunk[chunk_id]["benchmark_document_id"], by_chunk[chunk_id]["page"])
            in relevant_doc_pages
            for chunk_id in top
        )
        document_hits = any(
            by_chunk[chunk_id]["benchmark_document_id"] in relevant_docs for chunk_id in top
        )
        result[f"recall_at_{k}"] = chunk_hits / len(relevant_chunks) if relevant_chunks else None
        result[f"chunk_hit_at_{k}"] = bool(chunk_hits)
        result[f"page_hit_at_{k}"] = page_hits
        result[f"document_hit_at_{k}"] = document_hits
    result["mrr"] = next(
        (
            1 / rank
            for rank, chunk_id in enumerate(ranked_ids, start=1)
            if chunk_id in relevant_chunks
        ),
        0.0,
    )
    result["ndcg_at_5"] = ndcg_at_k(ranked_ids, relevant_chunks, 5)
    return result


def language_group(qrel: dict[str, Any], papers: dict[str, Any]) -> str:
    if qrel["no_answer"]:
        return "no_answer"
    if str(qrel.get("source_spec_id", "")).startswith("cross_"):
        return "cross_language"
    query_language = qrel["language"]
    target_languages = [
        set(papers[target["benchmark_document_id"]]["language"])
        for target in qrel["acceptable_targets"]
    ]
    if any(query_language not in languages for languages in target_languages):
        return "cross_language"
    return "russian" if query_language == "ru" else "english"


def _failure_label(
    qrel: dict[str, Any],
    top: dict[str, Any] | None,
    lexical_value: float,
    papers: dict[str, Any],
) -> tuple[str, str]:
    if qrel["no_answer"]:
        return ("NO_ANSWER", "false_retrieval") if top else ("NONE", "correctly_unanswered")
    if top is None:
        return "RETRIEVAL_FAILURE", "no_result"
    targets = qrel["acceptable_targets"]
    target_chunks = {target["chunk_id"] for target in targets}
    if top["chunk_id"] in target_chunks:
        return "NONE", "none"
    matching_targets = [
        target
        for target in targets
        if target["benchmark_document_id"] == top["benchmark_document_id"]
    ]
    if matching_targets:
        if any(target["page"] == top["page"] for target in matching_targets):
            return "RETRIEVAL_FAILURE", "wrong_chunk"
        return "RETRIEVAL_FAILURE", "wrong_page"
    if qrel["query_class"] == "formula":
        return "RETRIEVAL_FAILURE", "formula_confusion"
    if qrel["query_class"] == "numeric_value":
        return "RETRIEVAL_FAILURE", "numeric_confusion"
    group = language_group(qrel, papers)
    if group == "cross_language" or qrel["language"] == "ru":
        return "RETRIEVAL_FAILURE", "cross_language_miss"
    if lexical_value > 0:
        return "RETRIEVAL_FAILURE", "semantic_near_miss_literal_query_token_overlap"
    return "RETRIEVAL_FAILURE", "wrong_document"


def _model_file_hashes(repository: str, revision: str) -> dict[str, Any]:
    from huggingface_hub import snapshot_download

    snapshot = Path(snapshot_download(repository, revision=revision, local_files_only=True))
    files = []
    for path in sorted(item for item in snapshot.rglob("*") if item.is_file()):
        files.append(
            {
                "path": path.relative_to(snapshot).as_posix(),
                "size_bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    digest = hashlib.sha256(
        json.dumps(files, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return {"snapshot_path": str(snapshot), "files": files, "tree_sha256": digest}


def _runtime_record() -> dict[str, Any]:
    packages = {}
    for name in ("numpy", "sentence-transformers", "transformers", "torch", "huggingface-hub"):
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    cpu_brand = "Apple M3" if platform.system() == "Darwin" else platform.processor()
    try:
        output = subprocess.run(
            ["sysctl", "-n", "machdep.cpu.brand_string"],
            check=True,
            capture_output=True,
            text=True,
        )
        cpu_brand = output.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        pass
    try:
        git_commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        git_commit = None
    return {
        "timestamp_utc": datetime.now(UTC).isoformat(),
        "git_commit": git_commit,
        "evaluator_sha256": sha256_file(Path(__file__)),
        "python": sys.version,
        "platform": platform.platform(),
        "hardware": cpu_brand,
        "packages": packages,
        "hf_home": os.environ.get("HF_HOME"),
        "offline": True,
    }


def _score_summaries(
    qrels: list[dict[str, Any]],
    papers: dict[str, Any],
    rows: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    qrel_by_id = {qrel["query_id"]: qrel for qrel in qrels}
    answerable = [qrel for qrel in qrels if not qrel["no_answer"]]
    strategies: dict[str, Any] = {}
    category_rows: list[dict[str, Any]] = []
    group_specs: dict[str, dict[str, list[dict[str, Any]]]] = {
        "query_class": defaultdict(list),
        "language": defaultdict(list),
        "exact_query_type": defaultdict(list),
    }
    for qrel in qrels:
        group_specs["query_class"][qrel["query_class"]].append(qrel)
        group_specs["language"][language_group(qrel, papers)].append(qrel)
        if qrel["query_class"] in {"identifier", "formula", "method_basis", "numeric_value"}:
            group_specs["exact_query_type"][qrel["query_class"]].append(qrel)

    rows_by_strategy: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        rows_by_strategy[row["strategy"]].append(row)
    metrics = [
        "recall_at_1",
        "recall_at_3",
        "recall_at_5",
        "mrr",
        "ndcg_at_5",
        "document_hit_at_1",
        "document_hit_at_5",
        "page_hit_at_1",
        "page_hit_at_5",
        "chunk_hit_at_1",
        "chunk_hit_at_5",
    ]
    for strategy in STRATEGY_NAMES:
        if strategy not in rows_by_strategy:
            continue
        strategy_rows = rows_by_strategy[strategy]
        answer_rows = [row for row in strategy_rows if not row["no_answer"]]
        top_scores = {
            "answerable": [row["top_score"] for row in answer_rows],
            "no_answer": [row["top_score"] for row in strategy_rows if row["no_answer"]],
        }
        strategy_summary: dict[str, Any] = {
            "n_queries": len(strategy_rows),
            "n_answerable": len(answer_rows),
            "metrics": {},
            "score_distribution": {},
            "failure_reason_counts": dict(
                Counter(
                    row["failure_reason"]
                    for row in strategy_rows
                    if row["failure_reason"] != "none"
                )
            ),
            "failure_level_counts": dict(Counter(row["failure_level"] for row in strategy_rows)),
        }
        for metric in metrics:
            values = [row[metric] for row in answer_rows]
            if metric.startswith("recall_"):
                target_total = sum(len(qrel["acceptable_targets"]) for qrel in answerable)
                target_hits = sum(
                    round(row[metric] * len(qrel_by_id[row["query_id"]]["acceptable_targets"]))
                    for row in answer_rows
                )
                strategy_summary["metrics"][metric] = {
                    "macro_rate": round(statistics.mean(values), 6),
                    "micro_hits": target_hits,
                    "micro_targets": target_total,
                    "micro_rate": round(target_hits / target_total, 6),
                    "n_queries": len(values),
                }
            elif metric.endswith("_hit_at_1") or metric.endswith("_hit_at_5"):
                hits = sum(bool(value) for value in values)
                strategy_summary["metrics"][metric] = _count_rate(hits, len(values))
            else:
                strategy_summary["metrics"][metric] = {
                    "mean": round(statistics.mean(values), 6),
                    "sum": round(sum(values), 6),
                    "n_queries": len(values),
                }
        negatives = [row for row in strategy_rows if row["no_answer"]]
        false_answers = sum(row["threshold_crossed"] for row in negatives)
        strategy_summary["no_answer_behavior"] = {
            "threshold": SCORE_THRESHOLD,
            "false_answer_hits": false_answers,
            "n_no_answer": len(negatives),
            "false_answer_rate": round(false_answers / len(negatives), 6) if negatives else None,
            "top_results": [
                {
                    "query_id": row["query_id"],
                    "top_score": row["top_score"],
                    "top_document": row["top_document"],
                    "top_chunk_id": row["top_chunk_id"],
                    "threshold_crossed": row["threshold_crossed"],
                }
                for row in negatives
            ],
        }
        for label, values in top_scores.items():
            strategy_summary["score_distribution"][label] = _distribution(values)
        strategies[strategy] = strategy_summary

        for group_type, group_map in group_specs.items():
            for group_name, selected_qrels in group_map.items():
                selected_ids = {qrel["query_id"] for qrel in selected_qrels}
                selected = [row for row in strategy_rows if row["query_id"] in selected_ids]
                selected_answerable = [row for row in selected if not row["no_answer"]]
                record = {
                    "strategy": strategy,
                    "group_type": group_type,
                    "group": group_name,
                    "n": len(selected),
                    "n_answerable": len(selected_answerable),
                    "n_no_answer": len(selected) - len(selected_answerable),
                }
                for metric in ("recall_at_1", "recall_at_3", "recall_at_5", "mrr", "ndcg_at_5"):
                    vals = [row[metric] for row in selected_answerable]
                    record[metric] = round(statistics.mean(vals), 6) if vals else None
                for k in (1, 3, 5):
                    target_count = sum(
                        len(qrel_by_id[row["query_id"]]["acceptable_targets"])
                        for row in selected_answerable
                    )
                    target_hits = sum(
                        round(
                            row[f"recall_at_{k}"]
                            * len(qrel_by_id[row["query_id"]]["acceptable_targets"])
                        )
                        for row in selected_answerable
                    )
                    record[f"recall_at_{k}_micro_hits"] = target_hits
                    record[f"recall_at_{k}_micro_targets"] = target_count
                for metric in (
                    "document_hit_at_1",
                    "document_hit_at_5",
                    "page_hit_at_1",
                    "page_hit_at_5",
                    "chunk_hit_at_1",
                    "chunk_hit_at_5",
                ):
                    vals = [bool(row[metric]) for row in selected_answerable]
                    record[metric] = _count_rate(sum(vals), len(vals))["rate"]
                    record[f"{metric}_hits"] = sum(vals)
                record["no_answer_false_hits"] = sum(
                    row["threshold_crossed"] for row in selected if row["no_answer"]
                )
                category_rows.append(record)
    return strategies, category_rows


def _distribution(values: list[float]) -> dict[str, Any] | None:
    if not values:
        return None
    ordered = sorted(values)
    return {
        "n": len(values),
        "min": round(min(values), 6),
        "p50": round(statistics.median(values), 6),
        "p95": round(_percentile(values, 95), 6),
        "max": round(max(values), 6),
        "mean": round(statistics.mean(values), 6),
        "values": [round(value, 6) for value in ordered],
    }


def _rank_strategy(
    strategy: str,
    qrels: list[dict[str, Any]],
    queries: dict[str, tuple[float, ...] | None],
    document_vectors: dict[str, tuple[float, ...]] | None,
    chunks: list[dict[str, Any]],
    papers: dict[str, Any],
    query_embedding_seconds: dict[str, float],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    by_chunk = {chunk["chunk_id"]: chunk for chunk in chunks}
    output_rows: list[dict[str, Any]] = []
    failure_rows: list[dict[str, Any]] = []
    for qrel in qrels:
        query_id = qrel["query_id"]
        query = qrel["query"]
        timings = []
        ordered: list[tuple[dict[str, Any], float]] = []
        for _ in range(RANK_REPEATS):
            started = time.perf_counter()
            values = []
            for chunk in chunks:
                lexical = (
                    lexical_score(query, chunk["content"])
                    if not strategy.endswith("semantic_only")
                    else 0.0
                )
                if strategy == "lexical_only":
                    score = lexical
                else:
                    if document_vectors is None or queries[query_id] is None:
                        raise ValueError("Semantic ranking needs query and document embeddings.")
                    semantic = _cosine(queries[query_id], document_vectors[chunk["chunk_id"]])
                    score = (
                        semantic
                        if strategy.endswith("semantic_only")
                        else hybrid_score(lexical, semantic)
                    )
                values.append((chunk, float(score)))
            ordered = sorted(values, key=lambda item: (-item[1], item[0]["chunk_id"]))
            timings.append(time.perf_counter() - started)
        ranking_seconds = statistics.mean(timings)
        top_items = ordered[:5]
        ranked_ids = [item[0]["chunk_id"] for item in top_items]
        scored = score_ranking(ranked_ids, qrel, by_chunk)
        lexical_top = lexical_score(query, top_items[0][0]["content"]) if top_items else 0.0
        top_score = top_items[0][1] if top_items else 0.0
        failure_level, failure_reason = _failure_label(
            qrel,
            None
            if qrel["no_answer"] and top_score < SCORE_THRESHOLD
            else (top_items[0][0] if top_items else None),
            lexical_top,
            papers,
        )
        top_document = top_items[0][0]["benchmark_document_id"] if top_items else None
        top_chunk_id = top_items[0][0]["chunk_id"] if top_items else None
        row = {
            "strategy": strategy,
            "query_id": query_id,
            "query": query,
            "query_class": qrel["query_class"],
            "language": qrel["language"],
            "language_group": language_group(qrel, papers),
            "no_answer": qrel["no_answer"],
            "n_acceptable_targets": len(qrel["acceptable_targets"]),
            **scored,
            "top_score": round(top_score, 8),
            "top_query_token_overlap": round(lexical_top, 8),
            "top_document": top_document,
            "top_chunk_id": top_chunk_id,
            "threshold_crossed": bool(qrel["no_answer"] and top_score >= SCORE_THRESHOLD),
            "embedding_ms": round(query_embedding_seconds.get(query_id, 0.0) * 1000, 6),
            "ranking_ms": round(ranking_seconds * 1000, 6),
            "end_to_end_ms": round(
                (ranking_seconds + query_embedding_seconds.get(query_id, 0.0)) * 1000, 6
            ),
            "top_5": [
                {
                    "document_id": item[0]["document_id"],
                    "benchmark_document_id": item[0]["benchmark_document_id"],
                    "page": item[0]["page"],
                    "chunk_id": item[0]["chunk_id"],
                    "score": round(item[1], 8),
                }
                for item in top_items
            ],
            "failure_level": failure_level,
            "failure_reason": failure_reason,
        }
        output_rows.append(row)
        if failure_level != "NONE" or failure_reason != "none":
            failure_rows.append(
                {
                    "strategy": strategy,
                    "query_id": query_id,
                    "query_class": qrel["query_class"],
                    "language_group": row["language_group"],
                    "no_answer": qrel["no_answer"],
                    "failure_level": failure_level,
                    "failure_reason": failure_reason,
                    "top_document": top_document,
                    "top_page": top_items[0][0]["page"] if top_items else None,
                    "top_chunk_id": top_chunk_id,
                    "top_score": round(top_score, 8),
                    "top_query_token_overlap": round(lexical_top, 8),
                    "expected_documents": sorted(
                        {target["benchmark_document_id"] for target in qrel["acceptable_targets"]}
                    ),
                    "expected_pages": sorted(
                        {target["page"] for target in qrel["acceptable_targets"]}
                    ),
                    "expected_chunks": sorted(
                        {target["chunk_id"] for target in qrel["acceptable_targets"]}
                    ),
                }
            )
    return output_rows, failure_rows


def _encoding_run(
    name: str,
    gateway: Any,
    qrels: list[dict[str, Any]],
    chunks: list[dict[str, Any]],
    papers: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    document_start = time.perf_counter()
    doc_embeddings = gateway.embed_documents([chunk["content"] for chunk in chunks])
    document_seconds = time.perf_counter() - document_start
    if len(doc_embeddings) != len(chunks):
        raise ValueError(f"{name} document embedding count mismatch.")
    dimension = int(doc_embeddings[0].dimension)
    document_vectors = {
        chunk["chunk_id"]: embedding.vector
        for chunk, embedding in zip(chunks, doc_embeddings, strict=True)
    }
    gateway.embed_query("warmup query")
    query_vectors: dict[str, tuple[float, ...] | None] = {}
    query_seconds: dict[str, float] = {}
    for qrel in qrels:
        started = time.perf_counter()
        embedding = gateway.embed_query(qrel["query"])
        query_seconds[qrel["query_id"]] = time.perf_counter() - started
        if embedding.dimension != dimension:
            raise ValueError(f"{name} emitted inconsistent embedding dimensions.")
        query_vectors[qrel["query_id"]] = embedding.vector

    strategy_rows = []
    failure_rows = []
    names = {
        "deterministic_hash_v1": (
            "deterministic_hash_v1_semantic_only",
            "deterministic_64d_hybrid",
        ),
        "multilingual-e5-base": (
            "multilingual_e5_base_semantic_only",
            "multilingual_e5_base_hybrid",
        ),
        "bge-m3": ("bge_m3_semantic_only", "bge_m3_hybrid"),
    }[name]
    for strategy in names:
        rows, failures = _rank_strategy(
            strategy, qrels, query_vectors, document_vectors, chunks, papers, query_seconds
        )
        strategy_rows.extend(rows)
        failure_rows.extend(failures)

    model_info: dict[str, Any] = {
        "name": name,
        "provider": getattr(gateway, "provider", "unknown"),
        "dimension": dimension,
        "document_embedding_seconds": round(document_seconds, 6),
        "document_embeddings_per_second": round(len(chunks) / document_seconds, 3),
        "document_vectors_bytes_float32": len(chunks) * dimension * 4,
        "query_embedding_ms_p50": round(statistics.median(query_seconds.values()) * 1000, 6),
        "query_embedding_ms_p95": round(_percentile(list(query_seconds.values()), 95) * 1000, 6),
    }
    if name in MODEL_CANDIDATES:
        config = MODEL_CANDIDATES[name]
        model_info.update(
            {
                "repository": config["repository"],
                "revision": config["revision"],
                "license": config["license"],
                "query_prefix": config["query_prefix"],
                "passage_prefix": config["document_prefix"],
                "device": getattr(gateway, "device", "unknown"),
                "model_files": _model_file_hashes(config["repository"], config["revision"]),
            }
        )
    else:
        model_info["revision"] = "Phase 9 DeterministicFakeEmbeddingGateway policy_version=fake-v1"
    return model_info, strategy_rows, failure_rows


def _lexical_run(
    qrels: list[dict[str, Any]], chunks: list[dict[str, Any]], papers: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return _rank_strategy("lexical_only", qrels, {}, None, chunks, papers, {})


def _latency_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "query_embedding_ms_p50": round(
            statistics.median([row["embedding_ms"] for row in rows]), 6
        ),
        "query_embedding_ms_p95": round(_percentile([row["embedding_ms"] for row in rows], 95), 6),
        "ranking_ms_p50": round(statistics.median([row["ranking_ms"] for row in rows]), 6),
        "ranking_ms_p95": round(_percentile([row["ranking_ms"] for row in rows], 95), 6),
        "end_to_end_ms_p50": round(statistics.median([row["end_to_end_ms"] for row in rows]), 6),
        "end_to_end_ms_p95": round(_percentile([row["end_to_end_ms"] for row in rows], 95), 6),
    }


def _exact_query_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    result = {}
    for label, query_class in (
        ("identifier", "identifier"),
        ("formula", "formula"),
        ("method_basis", "method_basis"),
        ("numeric_value", "numeric_value"),
    ):
        subset = [row for row in rows if row["query_class"] == query_class and not row["no_answer"]]
        result[label] = {
            "n": len(subset),
            **{
                f"chunk_hit_at_{k}": _count_rate(
                    sum(bool(row[f"chunk_hit_at_{k}"]) for row in subset), len(subset)
                )
                for k in (1, 3, 5)
            },
        }
    return result


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("\n", encoding="utf-8")
        return
    fields = list(dict.fromkeys(key for row in rows for key in row))
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    key: json.dumps(value, ensure_ascii=False, sort_keys=True)
                    if isinstance(value, (dict, list))
                    else value
                    for key, value in row.items()
                }
            )


def run_benchmark(
    chunk_text_path: Path,
    *,
    eval_root: Path = EVAL_ROOT,
    include_models: bool = True,
    output_root: Path = OUTPUT_ROOT,
) -> dict[str, Any]:
    # This gate runs before local model initialization or any embedding work.
    hashes = verify_frozen_inputs(eval_root)
    qrel_pack, manifest, chunks = load_frozen_corpus(chunk_text_path, eval_root)
    qrels = qrel_pack["qrels"]
    papers = {paper["benchmark_document_id"]: paper for paper in manifest["papers"]}
    all_rows, all_failures = _lexical_run(qrels, chunks, papers)
    model_records = []
    gateway_factories: list[tuple[str, Any]] = [
        ("deterministic_hash_v1", DeterministicFakeEmbeddingGateway)
    ]
    if include_models:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        gateway_factories.extend(
            [
                (
                    "multilingual-e5-base",
                    lambda: HuggingFaceSentenceGateway("multilingual-e5-base", offline=True),
                ),
                ("bge-m3", lambda: HuggingFaceSentenceGateway("bge-m3", offline=True)),
            ]
        )
    for name, gateway_factory in gateway_factories:
        gateway = gateway_factory()
        model_info, rows, failures = _encoding_run(name, gateway, qrels, chunks, papers)
        model_records.append(model_info)
        all_rows.extend(rows)
        all_failures.extend(failures)
        del gateway
        try:
            import torch

            if torch.backends.mps.is_available():
                torch.mps.empty_cache()
        except (ImportError, AttributeError):
            pass

    strategies, category_rows = _score_summaries(qrels, papers, all_rows)
    strategy_rows = defaultdict(list)
    for row in all_rows:
        strategy_rows[row["strategy"]].append(row)
    latency = {name: _latency_summary(rows) for name, rows in strategy_rows.items()}
    exact = {name: _exact_query_summary(rows) for name, rows in strategy_rows.items()}
    dimensions = {record["name"]: record["dimension"] for record in model_records}
    storage = {
        name: {
            "dimension": dimension,
            "actual_349_float32_bytes": 349 * dimension * 4,
            "100k_float32_bytes": 100_000 * dimension * 4,
            "100k_mib": round(100_000 * dimension * 4 / 1024**2, 3),
            "1m_float32_bytes": 1_000_000 * dimension * 4,
            "1m_mib": round(1_000_000 * dimension * 4 / 1024**2, 3),
        }
        for name, dimension in dimensions.items()
    }
    answerable = [row for row in all_rows if not row["no_answer"]]
    if len(answerable) != 69 * (1 + 2 * len(model_records)):
        raise ValueError("Unexpected scored query count.")
    results = {
        "schema": "chemdft-real-scientific-retrieval-results-v1",
        "benchmark": {
            "id": "real-scientific-retrieval-v1",
            "status": "FROZEN",
            "query_count": len(qrels),
            "answerable_query_count": sum(not qrel["no_answer"] for qrel in qrels),
            "no_answer_query_count": sum(qrel["no_answer"] for qrel in qrels),
            "document_count": len(manifest["papers"]),
            "chunk_count": len(chunks),
            "chunker_version": CHUNKER_VERSION,
            **hashes,
        },
        "configuration": {
            "hybrid": "0.65 lexical + 0.35 cosine, current evaluation implementation",
            "top_k": 5,
            "exact_query_guardrail": False,
            "bge_sparse_or_colbert": False,
            "no_answer_threshold": SCORE_THRESHOLD,
            "threshold_note": "Fixed exploratory threshold inherited from prior evaluation; not calibrated or tuned here.",
            "ranking_repeats_for_latency": RANK_REPEATS,
            "input_text_path": str(chunk_text_path),
            "input_text_is_committed": False,
            "input_text_sha256": sha256_file(chunk_text_path),
        },
        "runtime": _runtime_record(),
        "models": model_records,
        "strategies": strategies,
        "latency": latency,
        "exact_query_analysis": exact,
        "storage": storage,
        "query_results": all_rows,
        "failure_analysis": all_failures,
        "failure_taxonomy": {
            strategy: {
                "retrieval_failure": sum(
                    row["strategy"] == strategy and row["failure_level"] == "RETRIEVAL_FAILURE"
                    for row in all_rows
                ),
                "chunking_failure_observed": 0,
                "parser_extraction_failure_observed": 0,
                "qrel_multi_target_effect_observed": 0,
                "note": "All frozen target chunks were present and content-hash validated; all frozen alternatives count as relevant. Ranking misses are retrieval failures. No chunk/QREL edits were made.",
            }
            for strategy in strategies
        },
        "limitations": [
            "73 reviewed queries over eight papers remain a modest benchmark.",
            "Scores are retrieval similarities, not calibrated answerability probabilities.",
            "No model rankings, QRELs, corpus, chunks, production embeddings, or production code were changed.",
            "All model inference was local and offline; results do not establish general chemistry-retrieval superiority.",
            "Structured scientific facts remain authoritative ahead of lexical and semantic retrieval.",
        ],
    }

    # Keep public artifacts free of passage text and embedding vectors.
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / OUTPUTS["json"]).write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    _write_csv(output_root / OUTPUTS["csv"], all_rows)
    _write_csv(output_root / OUTPUTS["category_csv"], category_rows)
    _write_csv(output_root / OUTPUTS["failure_csv"], all_failures)
    run_record = {
        "benchmark": results["benchmark"],
        "runtime": results["runtime"],
        "configuration": results["configuration"],
        "models": model_records,
        "strategy_names": list(strategies),
    }
    (output_root / OUTPUTS["run"]).write_text(
        json.dumps(run_record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--chunk-text",
        type=Path,
        default=Path("/tmp/chemdft-real-paper-v1-chunk-text.json"),
    )
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_ROOT)
    parser.add_argument(
        "--fake-only", action="store_true", help="Run deterministic 64D tests only."
    )
    args = parser.parse_args()
    result = run_benchmark(
        args.chunk_text,
        include_models=not args.fake_only,
        output_root=args.output_dir,
    )
    print(
        json.dumps(
            {
                "benchmark": result["benchmark"],
                "strategies": {
                    name: {
                        "metrics": details["metrics"],
                        "no_answer_behavior": {
                            key: details["no_answer_behavior"][key]
                            for key in (
                                "threshold",
                                "false_answer_hits",
                                "n_no_answer",
                                "false_answer_rate",
                            )
                        },
                    }
                    for name, details in result["strategies"].items()
                },
                "latency": result["latency"],
                "storage": result["storage"],
                "output_dir": str(args.output_dir),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
