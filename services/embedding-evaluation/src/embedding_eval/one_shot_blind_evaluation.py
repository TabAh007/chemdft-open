"""Frozen evaluator v1.1: fresh packages only; V2 is permanently retired.

Package schema 2 and execution journal contract are documented in
BLIND_EVALUATOR_FREEZE.md. No discovery, policy selection or recovery scoring.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

EVALUATOR_VERSION = "1.1.0"
RESULT_SCHEMA_VERSION = 2
STATUS_MACHINE_VERSION = 1
POLICY_SHA256 = "70b06bf55aa8a312ee82fac8bd79321fcb4c9ec9b658ff30562ed4af3aa6f166"
POLICY_COMMIT = "07aa27009029e819927807f65c9e171f5cea0ba7"
EXPECTED_MODEL_REVISION = "5617a9f61b028005a4858fdac845db406aefb181"
RETIRED_PACKAGE_SHA256 = "212d60c9a3f185b02d92273d29038b1ba146307486a331160338ded8def44b04"
RETIRED_PATH = Path("<local-path>/Desktop/chemdft-holdout-v2")
THRESHOLD = 0.5555248856544495
SELECTED_POLICY_RELATIVE = Path(
    "services/embedding-evaluation/results/retrieval-policy-dev-v1/selected-policy.json"
)
JOURNAL_NAME = ".blind-evaluator-run"
MANIFEST_NAME = "evaluator-package.json"
PACKAGE_FILES = ("corpus.json", "qrels.json", "review.json")
STATES = ("PRECHECK", "CLAIMED", "SCORING", "RESULT_WRITTEN", "COMPLETED")


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def result_digest(result: dict[str, Any]) -> str:
    return sha256_bytes(
        canonical_bytes({k: v for k, v in result.items() if k != "blind_evaluation_result_sha256"})
    )


def _expect(condition: bool, code: str) -> None:
    if not condition:
        raise ValueError(code)


def _load_json(raw: bytes) -> dict[str, Any]:
    def pairs(items):
        result = {}
        for key, value in items:
            _expect(key not in result, "DUPLICATE_JSON_KEY")
            result[key] = value
        return result

    def nonfinite(value):
        raise ValueError("NONFINITE_JSON")

    value = json.loads(raw, object_pairs_hook=pairs, parse_constant=nonfinite)
    _expect(isinstance(value, dict), "EXPECTED_JSON_OBJECT")
    return value


def load_policy(repo: Path) -> tuple[bytes, dict[str, Any]]:
    raw = (repo / SELECTED_POLICY_RELATIVE).read_bytes()
    _expect(sha256_bytes(raw) == POLICY_SHA256, "POLICY_HASH_MISMATCH")
    policy = _load_json(raw)
    _expect(sha256_bytes(canonical_bytes(policy)) == POLICY_SHA256, "POLICY_HASH_MISMATCH")
    return raw, policy


def reject_retired_path(package: Path) -> Path:
    # Lexical check precedes resolve/stat/open, including paths below the retired root.
    lexical = Path(os.path.abspath(package))
    _expect(not lexical.is_relative_to(RETIRED_PATH), "RETIRED_BENCHMARK")
    # Reject symlink components without resolving their targets (no access via aliases).
    for part in (*reversed(lexical.parents), lexical):
        _expect(not part.is_symlink(), "PACKAGE_SYMLINK")
    return lexical


def _field(row: dict[str, Any], names: tuple[str, ...], code: str) -> str:
    values = [row[n] for n in names if n in row]
    _expect(bool(values) and all(isinstance(v, str) and bool(v) for v in values), code)
    _expect(len(set(values)) == 1, "CONFLICTING_" + code)
    return values[0]


def normalize_targets(targets: Any) -> list[dict[str, str]]:
    _expect(isinstance(targets, list), "TARGET_SCHEMA")
    output = []
    for target in targets:
        _expect(isinstance(target, dict), "TARGET_SCHEMA")
        output.append(
            {
                "chunk_id": _field(
                    target, ("chunk_id", "expected_chunk_id"), "TARGET_CHUNK_ID_REQUIRED"
                ),
                "benchmark_document_id": _field(
                    target,
                    ("benchmark_document_id", "expected_document_id"),
                    "TARGET_DOCUMENT_ID_REQUIRED",
                ),
            }
        )
    _expect(len({t["chunk_id"] for t in output}) == len(output), "DUPLICATE_TARGET")
    return output


def validate_inputs(qrels_artifact: dict[str, Any], corpus: dict[str, Any]):
    _expect(qrels_artifact.get("schema_version") == 1, "QREL_SCHEMA_VERSION")
    _expect(corpus.get("schema_version") == 1, "CORPUS_SCHEMA_VERSION")
    qrels, chunks = qrels_artifact.get("qrels"), corpus.get("chunks")
    _expect(isinstance(qrels, list) and bool(qrels), "QREL_SCHEMA")
    _expect(isinstance(chunks, list) and bool(chunks), "CHUNK_SCHEMA")
    normalized_chunks = []
    for chunk in chunks:
        _expect(isinstance(chunk, dict), "CHUNK_SCHEMA")
        normalized_chunks.append(
            {
                "chunk_id": _field(chunk, ("chunk_id",), "CHUNK_ID_REQUIRED"),
                "document_id": _field(chunk, ("document_id",), "DOCUMENT_ID_REQUIRED"),
                "content": _field(chunk, ("content",), "CONTENT_REQUIRED"),
            }
        )
    mapping = {c["chunk_id"]: c["document_id"] for c in normalized_chunks}
    _expect(len(mapping) == len(chunks), "DUPLICATE_CHUNK_ID")
    normalized = []
    for row in qrels:
        _expect(isinstance(row, dict), "QREL_SCHEMA")
        qid = _field(row, ("query_id",), "QUERY_ID_REQUIRED")
        query = _field(row, ("query",), "QUERY_REQUIRED")
        _expect(type(row.get("no_answer")) is bool, "NO_ANSWER_BOOLEAN_REQUIRED")
        targets = normalize_targets(
            row.get("acceptable_targets", []) if row["no_answer"] else row.get("acceptable_targets")
        )
        _expect(bool(targets) != row["no_answer"], "ANSWERABILITY_TARGET_MISMATCH")
        for target in targets:
            _expect(target["chunk_id"] in mapping, "TARGET_CHUNK_MISSING")
            _expect(
                mapping[target["chunk_id"]] == target["benchmark_document_id"],
                "TARGET_DOCUMENT_MISMATCH",
            )
        normalized.append(row | {"query_id": qid, "query": query, "acceptable_targets": targets})
    _expect(len({q["query_id"] for q in normalized}) == len(normalized), "DUPLICATE_QUERY_ID")
    return normalized, normalized_chunks


def rate(hits: int, total: int) -> dict[str, Any]:
    return {"hits": hits, "n": total, "rate": hits / total if total else None}


def binary_ndcg(ranks: list[int], total_relevant: int, k: int = 5) -> float:
    if total_relevant <= 0:
        return 0.0
    dcg = sum(1 / math.log2(rank + 1) for rank in ranks if rank <= k)
    ideal = sum(1 / math.log2(rank + 1) for rank in range(1, min(k, total_relevant) + 1))
    return dcg / ideal if ideal else 0.0


def score_answerable(
    ranked_chunk_ids: list[str],
    acceptable_targets: list[dict[str, Any]],
    chunk_to_doc: dict[str, str],
) -> dict[str, Any]:
    """Score all frozen acceptable targets; alternatives are all relevant targets."""
    acceptable_targets = normalize_targets(acceptable_targets)
    relevant_chunks = {target["chunk_id"] for target in acceptable_targets}
    relevant_docs = {target["benchmark_document_id"] for target in acceptable_targets}
    chunk_ranks = [
        i for i, chunk_id in enumerate(ranked_chunk_ids, 1) if chunk_id in relevant_chunks
    ]
    relevant_ranks = [
        i
        for i, chunk_id in enumerate(ranked_chunk_ids, 1)
        if chunk_to_doc[chunk_id] in relevant_docs
    ]
    result: dict[str, Any] = {}
    for k in (1, 3, 5):
        result[f"recall_at_{k}"] = rate(
            sum(rank <= k for rank in chunk_ranks), len(relevant_chunks)
        )
        result[f"chunk_hit_at_{k}"] = bool(any(rank <= k for rank in chunk_ranks))
        result[f"document_hit_at_{k}"] = bool(any(rank <= k for rank in relevant_ranks))
    result["mrr"] = 1 / chunk_ranks[0] if chunk_ranks else 0.0
    result["ndcg_at_5"] = binary_ndcg(chunk_ranks, len(relevant_chunks), 5)
    return result


def _query_language(qrel: dict[str, Any]) -> str:
    if qrel.get("query_class") == "cross_language" or str(
        qrel.get("source_spec_id", "")
    ).startswith("cross_"):
        return "cross-language"
    language = str(qrel.get("language", "other")).lower()
    return {"en": "English", "english": "English", "ru": "Russian", "russian": "Russian"}.get(
        language, "other"
    )


def _class_slice(qrel: dict[str, Any]) -> str:
    value = str(qrel.get("query_class", "other")).lower()
    if value in {"numeric_unit", "numeric_value", "numeric"}:
        return "numeric"
    if value in {"method_basis", "method/basis"}:
        return "method/basis"
    if value in {"semantic", "paraphrase", "semantic/paraphrase"}:
        return "semantic/paraphrase"
    if value in {"formula", "identifier"}:
        return value
    return "other"


def summarize_slice(rows: list[tuple[dict[str, Any], dict[str, Any]]]) -> dict[str, Any]:
    answerable = [(q, m) for q, m in rows if not q["no_answer"]]
    accepted = sum(m["accepted"] for _, m in answerable)
    safe_hits = sum(m["accepted"] and m["chunk_hit_at_5"] for _, m in answerable)
    targets = sum(len(q["acceptable_targets"]) for q, _ in answerable)
    found_targets = sum(m["recall_at_5"]["hits"] for _, m in answerable)
    return {
        "answerable_queries": len(answerable),
        "accepted": rate(accepted, len(answerable)),
        "correct_chunk_hit_at_5": rate(
            sum(m["chunk_hit_at_5"] for _, m in answerable), len(answerable)
        ),
        "safe_recall_at_5_queries": rate(safe_hits, len(answerable)),
        "target_recall_at_5": rate(found_targets, targets),
        "mrr": sum(m["mrr"] for _, m in answerable) / len(answerable) if answerable else None,
    }


def compute_metrics(
    qrels: list[dict[str, Any]],
    ranked: dict[str, list[str]],
    dense_top_scores: dict[str, float],
    chunk_to_doc: dict[str, str],
    threshold: float,
) -> tuple[dict[str, Any], dict[str, Any]]:
    answerable: list[tuple[dict[str, Any], dict[str, Any]]] = []
    no_answer_count = false_accepts = 0
    all_rows: list[tuple[dict[str, Any], dict[str, Any]]] = []
    per_query: dict[str, dict[str, Any]] = {}
    for qrel in qrels:
        qid = qrel["query_id"]
        accepted = dense_top_scores[qid] >= threshold
        if qrel["no_answer"]:
            no_answer_count += 1
            false_accepts += int(accepted)
            scored = {"accepted": accepted}
        else:
            scored = score_answerable(ranked[qid], qrel["acceptable_targets"], chunk_to_doc)
            scored["accepted"] = accepted
            answerable.append((qrel, scored))
        all_rows.append((qrel, scored))
        # Aggregate-only output: opaque query IDs and ranks are not published.
        per_query[qid] = scored

    n_answerable = len(answerable)
    n_answer = no_answer_count
    retrieval: dict[str, Any] = {}
    for k in (1, 3, 5):
        total_targets = sum(len(q["acceptable_targets"]) for q, _ in answerable)
        target_hits = sum(m[f"recall_at_{k}"]["hits"] for _, m in answerable)
        retrieval[f"recall_at_{k}"] = rate(target_hits, total_targets)
        for kind in ("document", "chunk"):
            field = f"{kind}_hit_at_{k}"
            retrieval[field] = rate(sum(bool(m[field]) for _, m in answerable), n_answerable)
    retrieval["mrr"] = sum(m["mrr"] for _, m in answerable) / n_answerable if n_answerable else None
    retrieval["ndcg_at_5"] = (
        sum(m["ndcg_at_5"] for _, m in answerable) / n_answerable if n_answerable else None
    )
    accepted_answerable = sum(m["accepted"] for _, m in answerable)
    safe_hits = sum(m["accepted"] and m["chunk_hit_at_5"] for _, m in answerable)
    abstention = {
        "no_answer_false_accept_count": false_accepts,
        "no_answer_correct_abstain_count": n_answer - false_accepts,
        "no_answer_false_accept_rate": rate(false_accepts, n_answer),
        "answerable_accepted_count": accepted_answerable,
        "answerable_abstained_count": n_answerable - accepted_answerable,
        "answerable_acceptance_rate": rate(accepted_answerable, n_answerable),
        "safe_recall_at_5": rate(safe_hits, n_answerable),
    }
    language: dict[str, list[tuple[dict[str, Any], dict[str, Any]]]] = defaultdict(list)
    classes: dict[str, list[tuple[dict[str, Any], dict[str, Any]]]] = defaultdict(list)
    for qrel, metrics in all_rows:
        language[_query_language(qrel)].append((qrel, metrics))
        classes[_class_slice(qrel)].append((qrel, metrics))
    slices = {
        "language": {name: summarize_slice(rows) for name, rows in sorted(language.items())},
        "query_class": {name: summarize_slice(rows) for name, rows in sorted(classes.items())},
    }
    return {
        "counts": {"qrels": len(qrels), "answerable": n_answerable, "no_answer": n_answer},
        "retrieval": retrieval,
        "abstention": abstention,
        "slices": slices,
    }, per_query


def _load_model(policy: dict[str, Any]) -> Any:
    from huggingface_hub import snapshot_download
    from sentence_transformers import SentenceTransformer

    model_info = policy["model"]
    snapshot = snapshot_download(
        repo_id=model_info["identifier"], revision=model_info["revision"], local_files_only=True
    )
    model = SentenceTransformer(snapshot, device=model_info["device"], trust_remote_code=False)
    _expect(model.get_sentence_embedding_dimension() == 1024, "MODEL_DIMENSION_MISMATCH")
    _expect(
        all(str(parameter.dtype) == "torch.float32" for parameter in model.parameters()),
        "MODEL_DTYPE_MISMATCH",
    )
    return model


def _embed(model: Any, texts: list[str], batch_size: int) -> np.ndarray:
    vectors = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,
        prompt="",
    )
    vectors = np.asarray(vectors, dtype=np.float32)
    if vectors.ndim != 2 or vectors.shape[1] != 1024:
        raise ValueError("EMBEDDING_SHAPE_MISMATCH")
    return vectors


def _fsync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _atomic_json_create(path: Path, value: dict[str, Any]) -> None:
    """Publish complete, read-only bytes atomically; never replace an existing record."""
    raw = canonical_bytes(value) + b"\n"
    fd, name = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fchmod(stream.fileno(), 0o444)
            os.fsync(stream.fileno())
        os.link(temporary, path)
        _fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


class ExecutionJournal:
    """Append-only journal. Directory reservation consumes the attempt, even on crash."""

    def __init__(self, package: Path, identity: dict[str, Any]):
        self.path = package / JOURNAL_NAME
        self.path.mkdir()  # Exclusive reservation; prior/failed/completed attempts block.
        _fsync_directory(package)
        self.identity = identity
        self.state: str | None = None
        self.metrics_produced: bool | None = False
        self.transition("PRECHECK")

    def transition(self, state: str) -> None:
        _expect(self.state not in {"FAILED", "COMPLETED"}, "TERMINAL_STATUS")
        next_index = 0 if self.state is None else STATES.index(self.state) + 1
        _expect(
            state == "FAILED" or (next_index < len(STATES) and state == STATES[next_index]),
            "INVALID_STATUS_TRANSITION",
        )
        if state == "SCORING":
            self.metrics_produced = None  # Unknown if killed during computation.
        if state in {"RESULT_WRITTEN", "COMPLETED"}:
            self.metrics_produced = True
        record = self.identity | {
            "status_machine_version": STATUS_MACHINE_VERSION,
            "status": state,
            "previous_status": self.state,
            "scientific_metrics_produced": self.metrics_produced,
            "result_published": (self.path / "result.json").exists(),
        }
        name = "FAILED.json" if state == "FAILED" else f"{next_index:02d}-{state}.json"
        _atomic_json_create(self.path / name, record)
        self.state = state

    def fail(self, exc: BaseException) -> None:
        # Error messages may contain private queries. Persist only the exception class.
        _atomic_json_create(
            self.path / "failure.json",
            {
                **self.identity,
                "status": "FAILED",
                "failed_during": self.state,
                "error_type": type(exc).__name__,
                "scientific_metrics_produced": self.metrics_produced,
                "result_published": (self.path / "result.json").exists(),
                "rerun_allowed": False,
            },
        )
        self.transition("FAILED")


def record_interrupted_failure(package: Path) -> None:
    """Explicit operator action AFTER confirming the process has stopped; never scores."""
    package = reject_retired_path(package)
    journal = package / JOURNAL_NAME
    _expect(journal.is_dir() and not journal.is_symlink(), "JOURNAL_REQUIRED")
    _expect(not (journal / "04-COMPLETED.json").exists(), "ALREADY_COMPLETED")
    _expect(not (journal / "FAILED.json").exists(), "ALREADY_FAILED")
    previous = None
    for index, state in enumerate(STATES[:-1]):
        path = journal / f"{index:02d}-{state}.json"
        if path.exists():
            previous = _load_json(path.read_bytes())
    published = (journal / "result.json").exists()
    record = {
        "status_machine_version": STATUS_MACHINE_VERSION,
        "status": "FAILED",
        "error_type": "InterruptedProcess",
        "previous_status": previous["status"] if previous else "RESERVED",
        "scientific_metrics_produced": True
        if published
        else (previous["scientific_metrics_produced"] if previous else False),
        "result_published": published,
        "rerun_allowed": False,
    }
    _atomic_json_create(journal / "failure.json", record)
    _atomic_json_create(journal / "FAILED.json", record)


def verify_identities(repo: Path, package: Path, expected_package_sha256: str):
    package = reject_retired_path(package)
    raw_policy, policy = load_policy(repo)
    _expect(bool(re.fullmatch(r"[0-9a-f]{64}", expected_package_sha256)), "PACKAGE_HASH_REQUIRED")
    _expect(expected_package_sha256 != RETIRED_PACKAGE_SHA256, "RETIRED_BENCHMARK")
    for marker in (
        "blind-holdout-evaluation-claim.json",
        "blind-holdout-evaluation-status.json",
        "blind-holdout-result.json",
        "blind-holdout-opened-for-diagnostics.json",
    ):
        _expect(not (package / marker).exists(), "PACKAGE_ALREADY_USED_OR_OPENED")
    snapshots = {}
    for name in (MANIFEST_NAME, *PACKAGE_FILES):
        path = package / name
        _expect(
            not path.is_symlink() and path.is_file() and path.stat().st_nlink == 1,
            "REGULAR_PACKAGE_FILE_REQUIRED",
        )
        snapshots[name] = path.read_bytes()
    manifest = _load_json(snapshots[MANIFEST_NAME])
    _expect(
        sha256_bytes(canonical_bytes(manifest)) == expected_package_sha256, "PACKAGE_HASH_MISMATCH"
    )
    _expect(manifest.get("schema_version") == 2, "PACKAGE_SCHEMA_VERSION")
    benchmark = _field(manifest, ("benchmark_id",), "BENCHMARK_ID_REQUIRED")
    _expect("holdout-v2" not in benchmark.lower(), "RETIRED_BENCHMARK")
    _expect(
        manifest.get("purpose") in {"BLIND", "DEV_QUALIFICATION", "SYNTHETIC_QUALIFICATION"},
        "PURPOSE_REQUIRED",
    )
    files = manifest.get("files")
    _expect(isinstance(files, dict) and set(files) == set(PACKAGE_FILES), "PACKAGE_FILES_SCHEMA")
    for name in PACKAGE_FILES:
        _expect(sha256_bytes(snapshots[name]) == files[name], "PACKAGE_FILE_HASH_MISMATCH")
    review = _load_json(snapshots["review.json"])
    if manifest["purpose"] == "BLIND":
        _expect(
            review.get("scientific_review_complete") is True
            and review.get("fresh_sources_verified") is True
            and review.get("unreviewed_count") == 0,
            "REVIEW_INCOMPLETE",
        )
    return snapshots, manifest, raw_policy, policy


def rank_dense(qrels, chunks, doc_vectors, query_vectors):
    # Identical float32 dot product, score ordering, tie break and top-k to 76eda20.
    scores = np.asarray(query_vectors @ doc_vectors.T, dtype=np.float32)
    _expect(
        scores.shape == (len(qrels), len(chunks)) and bool(np.isfinite(scores).all()),
        "DENSE_SCORE_SCHEMA",
    )
    chunk_ids = [row["chunk_id"] for row in chunks]
    ranked, dense_top = {}, {}
    for index, qrel in enumerate(qrels):
        order = sorted(range(len(chunks)), key=lambda j: (-float(scores[index, j]), chunk_ids[j]))[
            :5
        ]
        ranked[qrel["query_id"]] = [chunk_ids[j] for j in order]
        dense_top[qrel["query_id"]] = float(scores[index, order[0]])
    return ranked, dense_top


def run(repo: Path, package: Path, *, expected_package_sha256: str) -> dict[str, Any]:
    # Check the prohibited lexical path and retired identity BEFORE any package I/O.
    _expect(expected_package_sha256 != RETIRED_PACKAGE_SHA256, "RETIRED_BENCHMARK")
    package = reject_retired_path(package)
    _expect(not package.is_relative_to(Path(os.path.abspath(repo))), "EXTERNAL_PACKAGE_REQUIRED")
    identity = {
        "package_sha256": expected_package_sha256,
        "selected_policy_sha256": POLICY_SHA256,
        "evaluator_version": EVALUATOR_VERSION,
        "one_shot": True,
    }
    journal = ExecutionJournal(package, identity)
    try:
        snapshots, manifest, policy_raw, policy = verify_identities(
            repo, package, expected_package_sha256
        )
        # Freeze the runtime before any scientific data is parsed or embedded.
        from .evaluator_lock import implementation_digest, verify_lock

        if manifest["purpose"] == "BLIND":
            evaluator_sha = verify_lock(repo)["blind_evaluator_sha256"]
        else:
            evaluator_sha = implementation_digest(repo)
        qrels, chunks = validate_inputs(
            _load_json(snapshots["qrels.json"]), _load_json(snapshots["corpus.json"])
        )
        counts = {
            "qrels": len(qrels),
            "answerable": sum(not q["no_answer"] for q in qrels),
            "no_answer": sum(q["no_answer"] for q in qrels),
            "chunks": len(chunks),
            "documents": len({c["document_id"] for c in chunks}),
        }
        _expect(manifest.get("counts") == counts, "PACKAGE_COUNTS_MISMATCH")
        journal.transition("CLAIMED")
        journal.transition("SCORING")
        journal.metrics_produced = False  # Caught errors can report what this process knows.
        model = _load_model(policy)
        doc_vectors = _embed(
            model, [c["content"] for c in chunks], policy["embedding"]["batch_size"]
        )
        query_vectors = _embed(model, [q["query"] for q in qrels], policy["model"]["batch_size"])
        ranked, dense_top = rank_dense(qrels, chunks, doc_vectors, query_vectors)
        metrics, _ = compute_metrics(
            qrels, ranked, dense_top, {c["chunk_id"]: c["document_id"] for c in chunks}, THRESHOLD
        )
        journal.metrics_produced = True
        for name, raw in snapshots.items():
            _expect((package / name).read_bytes() == raw, "PACKAGE_CHANGED_DURING_EVALUATION")
        _expect(
            (repo / SELECTED_POLICY_RELATIVE).read_bytes() == policy_raw,
            "POLICY_CHANGED_DURING_EVALUATION",
        )
        result = {
            "schema_version": RESULT_SCHEMA_VERSION,
            **identity,
            "evaluator_sha256": evaluator_sha,
            "benchmark_id": manifest["benchmark_id"],
            "purpose": manifest["purpose"],
            "counts": counts,
            "model_revision": EXPECTED_MODEL_REVISION,
            "policy_commit": POLICY_COMMIT,
            "threshold": THRESHOLD,
            "metrics": metrics,
            "scientific_metrics_produced": True,
        }
        result["blind_evaluation_result_sha256"] = result_digest(result)
        _atomic_json_create(journal.path / "result.json", result)
        journal.transition("RESULT_WRITTEN")
        journal.transition("COMPLETED")
        return result
    except BaseException as exc:
        journal.fail(exc)
        raise


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--expected-package-sha256", required=True)
    args = parser.parse_args(argv)
    try:
        result = run(args.repo, args.package, expected_package_sha256=args.expected_package_sha256)
    except Exception as exc:  # noqa: BLE001 — privacy boundary: never print private errors
        print(
            json.dumps(
                {"run_status": "FAILED_OR_BLOCKED", "error": type(exc).__name__}, sort_keys=True
            )
        )
        return 2
    print(
        json.dumps(
            {
                "run_status": "COMPLETED",
                "purpose": result["purpose"],
                "result_sha256": result["blind_evaluation_result_sha256"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
