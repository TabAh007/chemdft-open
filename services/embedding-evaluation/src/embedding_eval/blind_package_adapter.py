"""Read-only V3 to evaluator 1.1.0 schema adapter. Never invokes retrieval."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

ADAPTER_VERSION = "1.0.0"
SOURCE_SCHEMA = "blind-retrieval-holdout-v3/package-1"
DESTINATION_SCHEMA = "evaluator-1.1.0/package-2,qrels-1,corpus-1"
SOURCE_NAMES = {
    "manifest": "blind-holdout-v3-final-manifest.json",
    "freeze": "blind-holdout-v3-freeze.json",
    "package": "blind-holdout-v3-package.json",
    "qrels": "blind-holdout-v3-qrels.json",
    "corpus": "blind-holdout-v3-corpus.json",
    "inventory": "blind-holdout-v3-chunks.json",
    "review": "review/blind-holdout-v3-final-review-state.json",
    "provenance": "provenance/blind-holdout-v3-review-provenance.json",
}
EXPECTED = {
    "policy": "70b06bf55aa8a312ee82fac8bd79321fcb4c9ec9b658ff30562ed4af3aa6f166",
    "evaluator": "a65107e31052d109b5a47c014035910905d0b4d597e7ccdc9400c13b6c03b0fa",
    "qrels": "85ca7dd7e9e3212853e21ba5d501c7ec3425db347156288947b0b626c5de1f0c",
    "package": "2fdfaaa432ba9f47a53d394c78fe4acbb1bf569c955b22ba2d3fa1eb863f08f9",
    "manifest": "1331836c6a4e80213eaa35f752dfb3b19338d2b10be34acbead0aa46a8c7c82b",
    "inventory": "77175e4cb8ecc92ca184d787a614140b6faa9a57e0c6af474dad1504edf6b032",
    "corpus": "d1d57ad0038a0f05e88e3cbab79e74f582f97b1528ac14eb79ad543361710172",
    "provenance": "df1523a1371de3e4a3deaf961b754e639c341891aa5a278ef1005ea6b86aaac7",
}


def canonical(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def require(condition: bool, code: str) -> None:
    if not condition:
        raise ValueError(code)


def load_json(raw: bytes) -> Any:
    def unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in pairs:
            require(key not in value, "DUPLICATE_JSON_KEY")
            value[key] = item
        return value

    def nonfinite(_value: str) -> Any:
        raise ValueError("NONFINITE_JSON")

    return json.loads(raw, object_pairs_hook=unique, parse_constant=nonfinite)


def adapter_sha256() -> str:
    return digest(Path(__file__).read_bytes())


def verify_adapter_lock(repo: Path) -> dict[str, Any]:
    lock_path = (
        repo / "services/embedding-evaluation/results/blind-package-adapter-v1/adapter-lock.json"
    )
    lock = load_json(lock_path.read_bytes())
    require(
        lock.get("adapter_version") == ADAPTER_VERSION
        and lock.get("blind_package_adapter_sha256") == adapter_sha256()
        and lock.get("source_package_schema") == SOURCE_SCHEMA
        and lock.get("evaluator_destination_schema") == DESTINATION_SCHEMA
        and lock.get("selected_policy_sha256") == EXPECTED["policy"]
        and lock.get("evaluator_sha256") == EXPECTED["evaluator"],
        "ADAPTER_LOCK_MISMATCH",
    )
    return lock


def _regular_bytes(root: Path, name: str) -> bytes:
    relative = Path(name)
    require(not relative.is_absolute() and ".." not in relative.parts, "UNSAFE_SOURCE_PATH")
    path = root / relative
    require(
        not path.is_symlink() and path.is_file() and path.stat().st_nlink == 1,
        "SOURCE_FILE_NOT_REGULAR",
    )
    return path.read_bytes()


def verify_v3(root: Path, repo: Path) -> dict[str, Any]:
    """Verify byte identities before parsing any query-bearing artifact."""
    require(root.is_absolute() and root.is_dir() and not root.is_symlink(), "SOURCE_ROOT_INVALID")
    for marker in (
        "blind-holdout-evaluation-claim.json",
        "blind-holdout-evaluation-status.json",
        "blind-holdout-result.json",
        "blind-holdout-opened-for-diagnostics.json",
        ".blind-evaluator-run",
    ):
        require(not (root / marker).exists(), "V3_ALREADY_USED_OR_OPENED")
    policy = (
        repo / "services/embedding-evaluation/results/retrieval-policy-dev-v1/selected-policy.json"
    )
    require(digest(policy.read_bytes()) == EXPECTED["policy"], "POLICY_HASH_MISMATCH")
    lock = load_json(
        (
            repo / "services/embedding-evaluation/results/blind-evaluator-v1/evaluator-lock.json"
        ).read_bytes()
    )
    require(isinstance(lock, dict), "EVALUATOR_LOCK_SCHEMA")
    require(lock.get("blind_evaluator_sha256") == EXPECTED["evaluator"], "EVALUATOR_HASH_MISMATCH")
    require(
        digest(canonical({k: v for k, v in lock.items() if k != "blind_evaluator_sha256"}))
        == EXPECTED["evaluator"],
        "EVALUATOR_HASH_MISMATCH",
    )
    for name, expected in lock["source_files_sha256"].items():
        require(digest((repo / name).read_bytes()) == expected, "EVALUATOR_SOURCE_CHANGED")
    raw = {key: _regular_bytes(root, name) for key, name in SOURCE_NAMES.items()}
    for key in ("qrels", "manifest", "inventory", "corpus", "provenance"):
        require(digest(raw[key]) == EXPECTED[key], "V3_" + key.upper() + "_HASH_MISMATCH")
    manifest = load_json(raw["manifest"])
    require(isinstance(manifest, dict) and manifest.get("status") == "FROZEN", "V3_MANIFEST_SCHEMA")
    require(
        digest(canonical({k: v for k, v in manifest.items() if k != "final_package_sha256"}))
        == EXPECTED["package"],
        "V3_PACKAGE_HASH_MISMATCH",
    )
    require(manifest.get("final_package_sha256") == EXPECTED["package"], "V3_PACKAGE_HASH_MISMATCH")
    require(
        manifest.get("final_frozen_qrel_sha256") == EXPECTED["qrels"], "V3_QREL_REFERENCE_MISMATCH"
    )
    require(
        manifest.get("chunk_inventory_sha256") == EXPECTED["inventory"]
        and manifest.get("corpus_sha256") == EXPECTED["corpus"]
        and manifest.get("review_provenance_sha256") == EXPECTED["provenance"],
        "V3_REFERENCE_MISMATCH",
    )
    files = manifest.get("files")
    require(
        isinstance(files, dict)
        and set(SOURCE_NAMES.values()) - {SOURCE_NAMES["manifest"], SOURCE_NAMES["freeze"]}
        <= set(files),
        "V3_FILE_LIST_MISSING",
    )
    for name, expected in files.items():
        require(digest(_regular_bytes(root, name)) == expected, "V3_FILE_HASH_MISMATCH")
    freeze = load_json(raw["freeze"])
    require(
        freeze.get("manifest_sha256") == EXPECTED["manifest"]
        and freeze.get("final_package_sha256") == EXPECTED["package"]
        and freeze.get("status") == "FROZEN",
        "V3_FREEZE_MISMATCH",
    )
    package = load_json(raw["package"])
    require(
        package.get("status") == "FROZEN"
        and package.get("retrieval_scoring") == "NOT_RUN"
        and package.get("scoring_qrels") == SOURCE_NAMES["qrels"]
        and package.get("review_state") == SOURCE_NAMES["review"],
        "V3_PACKAGE_SCHEMA",
    )
    return {key: load_json(value) for key, value in raw.items()}


def target_projection(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Full target records retain their scientific metadata; aliases are ignored."""
    projected = []
    for row in rows:

        def original(target: dict[str, Any]) -> dict[str, Any]:
            return {
                k: v for k, v in target.items() if k not in {"chunk_id", "benchmark_document_id"}
            }

        projected.append(
            {
                "query_id": row["query_id"],
                "answerable": row["answerable"],
                "primary": [row["expected_document_id"], row["expected_chunk_id"]],
                "acceptable": [original(t) for t in row["acceptable_targets"]],
                "alternates": [original(t) for t in row["legitimate_alternate_targets"]],
            }
        )
    return sorted(projected, key=lambda item: item["query_id"])


def corpus_projection(corpus: dict[str, Any]) -> dict[str, Any]:
    return {"documents": corpus["documents"], "chunks": corpus["chunks"]}


def transform(
    source: dict[str, Any], binding: dict[str, Any], purpose: str = "BLIND"
) -> tuple[dict[str, bytes], dict[str, Any]]:
    """Pure transformation shared by real V3, synthetic, and DEV-shaped fixtures."""
    require(purpose in {"BLIND", "SYNTHETIC_QUALIFICATION", "DEV_QUALIFICATION"}, "PURPOSE_INVALID")
    qrels, corpus, inventory = source["qrels"], source["corpus"], source["inventory"]
    review, provenance = source["review"], source["provenance"]
    rows, chunks, documents = qrels.get("qrels"), corpus.get("chunks"), corpus.get("documents")
    require(
        qrels.get("schema_version") == 1 and corpus.get("schema_version") == 1,
        "SOURCE_SCHEMA_MISMATCH",
    )
    require(
        isinstance(rows, list)
        and isinstance(chunks, list)
        and isinstance(documents, list)
        and isinstance(inventory, list),
        "SOURCE_ROWS_INVALID",
    )
    require(len(rows) > 0 and len(chunks) > 0, "SOURCE_EMPTY")
    counts = {
        "qrels": len(rows),
        "answerable": 0,
        "no_answer": 0,
        "chunks": len(chunks),
        "documents": len(documents),
    }
    decisions = review.get("decisions")
    require(isinstance(decisions, list), "REVIEW_DECISIONS_MISSING")
    retained = {d["query_id"] for d in decisions if d.get("retained_for_scoring") is True}
    rejected = {d["query_id"] for d in decisions if d.get("retained_for_scoring") is False}
    require(
        len(retained) + len(rejected) == len(decisions)
        and len({d["query_id"] for d in decisions}) == len(decisions),
        "REVIEW_DECISION_INVALID",
    )
    require(
        {r["query_id"] for r in rows} == retained
        and not ({r["query_id"] for r in rows} & rejected),
        "REJECTED_ROW_INCLUDED",
    )
    require(
        all(
            d.get("review_status") in {"APPROVED", "CORRECTED"}
            and d.get("decision") in {"APPROVE", "CORRECT"}
            for d in decisions
            if d["query_id"] in retained
        ),
        "REVIEW_INCOMPLETE",
    )
    require(
        all(
            d.get("review_status") == "REJECTED" and d.get("decision") == "REJECT"
            for d in decisions
            if d["query_id"] in rejected
        ),
        "REVIEW_DECISION_INVALID",
    )
    require(
        provenance.get("rejected_row", {}).get("query_id") in rejected if rejected else True,
        "REJECTED_PROVENANCE_MISMATCH",
    )
    review_counts = review.get("review_status_counts", {})
    require(
        review_counts.get("UNREVIEWED") == 0
        and review_counts.get("NEEDS_SOURCE_CHECK") == 0
        and review_counts.get("REJECTED") == len(rejected)
        and review_counts.get("APPROVED") + review_counts.get("CORRECTED") == len(retained),
        "REVIEW_INCOMPLETE",
    )
    decisions_by_id = {d["query_id"]: d for d in decisions}
    require(
        all(
            row.get("review_status") == decisions_by_id[row["query_id"]]["review_status"]
            for row in rows
        ),
        "REVIEW_STATUS_MISMATCH",
    )
    doc_ids = {d["document_id"] for d in documents}
    chunk_map = {c["chunk_id"]: c for c in chunks}
    require(
        len(doc_ids) == len(documents) and len(chunk_map) == len(chunks), "CORPUS_IDS_DUPLICATE"
    )
    require(
        all(
            c["document_id"] in doc_ids and digest(c["content"].encode()) == c["content_sha256"]
            for c in chunks
        ),
        "CORPUS_CONTENT_MISMATCH",
    )
    require(
        [{k: v for k, v in c.items() if k != "content"} for c in chunks] == inventory,
        "CHUNK_INVENTORY_MISMATCH",
    )
    adapted = []
    for row in rows:
        require(type(row.get("answerable")) is bool, "ADAPTER_MAPPING_UNSAFE")
        answerable = row["answerable"]
        counts["answerable" if answerable else "no_answer"] += 1
        targets, alternates = row.get("acceptable_targets"), row.get("legitimate_alternate_targets")
        require(isinstance(targets, list) and isinstance(alternates, list), "TARGET_SCHEMA")
        require(
            (bool(targets) and targets[1:] == alternates)
            if answerable
            else (not targets and not alternates),
            "TARGET_STRUCTURE_MISMATCH",
        )
        require(
            (
                isinstance(row.get("expected_chunk_id"), str)
                and isinstance(row.get("expected_document_id"), str)
            )
            if answerable
            else (row.get("expected_chunk_id") is None and row.get("expected_document_id") is None),
            "PRIMARY_TARGET_MISMATCH",
        )
        require(
            not answerable
            or (
                targets[0]["expected_chunk_id"] == row["expected_chunk_id"]
                and targets[0]["expected_document_id"] == row["expected_document_id"]
            ),
            "PRIMARY_TARGET_MISMATCH",
        )
        mapped_targets = []
        for target in targets:
            chunk_id, document_id = target["expected_chunk_id"], target["expected_document_id"]
            require(
                chunk_id in chunk_map
                and chunk_map[chunk_id]["document_id"] == document_id
                and target["content_sha256"] == chunk_map[chunk_id]["content_sha256"],
                "TARGET_CORPUS_MISMATCH",
            )
            mapped_targets.append(
                target | {"chunk_id": chunk_id, "benchmark_document_id": document_id}
            )
        require(row.get("review_status") in {"APPROVED", "CORRECTED"}, "REVIEW_INCOMPLETE")
        adapted.append(row | {"no_answer": not answerable, "acceptable_targets": mapped_targets})
    require(len({r["query_id"] for r in rows}) == len(rows), "QUERY_IDS_DUPLICATE")
    before_targets = digest(canonical(target_projection(rows)))
    after_targets = digest(canonical(target_projection(adapted)))
    require(
        qrels.get("summary", {}).get("qrel_count") == counts["qrels"]
        and qrels["summary"].get("answerable_count") == counts["answerable"]
        and qrels["summary"].get("no_answer_count") == counts["no_answer"],
        "QREL_COUNTS_MISMATCH",
    )
    require(
        corpus.get("chunk_count") == counts["chunks"]
        and corpus.get("source_count") == counts["documents"],
        "CORPUS_COUNTS_MISMATCH",
    )
    require(
        review.get("retained_count") == counts["qrels"]
        and review.get("candidate_count") == len(decisions),
        "REVIEW_COUNTS_MISMATCH",
    )
    payloads = {
        "qrels.json": {"schema_version": 1, "qrels": adapted, "adapter_provenance": binding},
        "corpus.json": {
            "schema_version": 1,
            "chunks": chunks,
            "documents": documents,
            "adapter_provenance": binding,
        },
        "review.json": {
            "scientific_review_complete": True,
            "fresh_sources_verified": True,
            "unreviewed_count": 0,
            "source_review_status_counts": review.get("review_status_counts"),
            "adapter_provenance": binding,
        },
    }
    before_corpus = digest(canonical(corpus_projection(corpus)))
    after_corpus = digest(canonical(corpus_projection(payloads["corpus.json"])))
    require(
        before_targets == after_targets and before_corpus == after_corpus, "PRESERVATION_FAILURE"
    )
    evidence = {
        "counts": counts,
        "target_set_sha256_before": before_targets,
        "target_set_sha256_after": after_targets,
        "corpus_sha256_before": before_corpus,
        "corpus_sha256_after": after_corpus,
        "rejected_count": len(rejected),
    }
    raw = {name: canonical(value) for name, value in payloads.items()}
    manifest = {
        "schema_version": 2,
        "benchmark_id": qrels["benchmark_id"],
        "purpose": purpose,
        "counts": counts,
        "files": {name: digest(value) for name, value in raw.items()},
        "adapter_provenance": binding,
    }
    raw["evaluator-package.json"] = canonical(manifest)
    return raw, evidence


def adapt_v3(source_root: Path, output: Path, repo: Path) -> dict[str, Any]:
    source_root, output, repo = source_root.absolute(), output.absolute(), repo.absolute()
    verify_adapter_lock(repo)
    require(
        not output.is_relative_to(source_root.resolve())
        and not output.resolve().is_relative_to(source_root.resolve()),
        "OUTPUT_INSIDE_V3",
    )
    require(not output.exists(), "OUTPUT_ALREADY_EXISTS")
    source = verify_v3(source_root, repo)
    binding = {
        "source_v3_package_sha256": EXPECTED["package"],
        "source_v3_qrel_sha256": EXPECTED["qrels"],
        "adapter_version": ADAPTER_VERSION,
        "adapter_sha256": adapter_sha256(),
        "source_schema_version": SOURCE_SCHEMA,
        "destination_evaluator_schema_version": DESTINATION_SCHEMA,
    }
    raw, evidence = transform(source, binding)
    require(
        evidence["counts"]
        == {"qrels": 37, "answerable": 28, "no_answer": 9, "chunks": 147, "documents": 5}
        and evidence["rejected_count"] == 1,
        "V3_COUNTS_MISMATCH",
    )
    require(
        source["manifest"].get("prior_source_overlap_count") == 0
        and source["manifest"].get("all_source_licenses_explicit_versioned") is True,
        "SOURCE_REVIEW_INCOMPLETE",
    )
    output.mkdir(parents=True)
    for name, value in raw.items():
        path = output / name
        with path.open("xb") as stream:
            stream.write(value)
        os.chmod(path, 0o444)
    return {
        **evidence,
        "evaluator_package_sha256": digest(raw["evaluator-package.json"]),
        "adapter_sha256": binding["adapter_sha256"],
        "derived_file_sha256": {name: digest(value) for name, value in raw.items()},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-v3", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--repo", required=True, type=Path)
    args = parser.parse_args()
    print(canonical(adapt_v3(args.source_v3, args.output, args.repo)).decode())


if __name__ == "__main__":
    main()
