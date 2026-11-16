"""Resolve the approved human review and freeze policy-dev V1 QRELs/split.

This script validates the existing local authoring companion against the pinned
manifest. It never downloads or rebuilds corpus content and never runs retrieval.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from embedding_eval.policy_dev_corpus import DEFAULT_MANIFEST_PATH
from embedding_eval.retrieval_policy import split_isolated
from embedding_eval.source_locators import validate_target_integrity

ROOT = Path(__file__).resolve().parents[1]
REVIEW_DIR = ROOT / "review"
REVIEW_JSON = REVIEW_DIR / "retrieval-policy-dev-v1-qrels-review.json"
REVIEW_CSV = REVIEW_DIR / "retrieval-policy-dev-v1-qrels-review.csv"
DEFAULT_CORPUS = Path("/tmp/chemdft-retrieval-policy-dev-v1-corpus.json")
REVIEWER = "external-human-review-2026-09-24"
REVIEW_DATE = "2026-09-24"
SPLIT_SEED = 20260924
HOLDOUT_FRACTION = 0.30
EXPECTED_MANIFEST_SHA256 = "1f9bd97fddd758463cfdb0814713a3d3673e8e9ab67ede4abdc52663be2503bc"
EXPECTED_CHUNK_INVENTORY_SHA256 = "0cced278caafbda97b1b22d8a499a6aaa1a73c17ab9e2ef700425524eebea94e"

FROZEN_QRELS_PATH = ROOT / "retrieval-policy-dev-v1-qrels-frozen.json"
SPLIT_PATH = ROOT / "retrieval-policy-dev-v1-split-frozen.json"
DEV_QRELS_PATH = ROOT / "retrieval-policy-dev-v1-dev-qrels.json"
HOLDOUT_QRELS_PATH = ROOT / "retrieval-policy-dev-v1-holdout-qrels.json"
REVIEW_RECORD_PATH = REVIEW_DIR / "retrieval-policy-dev-v1-review-record.md"

CORRECTIONS: dict[str, dict[str, Any]] = {
    "rpdev1-a001": {
        "alternates": {
            "pmc6538633-p00051-f3345a3a8c09": "pubId = ‘MamunHighT2019’",
            "pmc6538633-p00021-2e272ad1542a": "get_reactions(pubId = ‘MamunHighT2019’,",
            "pmc6538633-p00039-3e32b0724307": "‘pubId’: ‘MamunHighT2019’,",
            "pmc6538633-p00053-189f125d0e64": "pub_id = MamunHighT2019, relaxed = 1",
            "pmc6538633-p00055-23b616f75b62": "Pt,pub_id = MamunHighT2019,relaxed = 1,",
        },
        "review_notes": "Added five independently sufficient direct pubId/permanent-identifier chunks as alternate targets; primary target retained.",
    },
    "rpdev1-a014": {
        "alternates": {
            "pmc10934912-p00021-d6c2d0adc15b": "fresh CeZrPAl samples prepared using the sol–gel, impregnation, and mechanical mixing methods",
        },
        "review_notes": "Added the XRD paragraph independently naming the three preparation routes as an alternate target; primary target retained.",
    },
    "rpdev1-a024": {
        "query": "In the preparation-method comparison (Figure 1), which 2θ peaks were assigned to the cubic CeₓZr₁₋ₓO₂ phase in fresh CeZrPAl supports?",
        "review_notes": "Query narrowed to the Figure 1 preparation-method comparison to remove ambiguity between fresh-support series.",
    },
    "rpdev1-a025": {
        "alternates": {
            "pmc10934912-p00041-2644e8cd921a": "after aging, the diffraction peak of γ-Al 2 O 3 disappears at 2θ = 66.5°, and new diffraction peaks of δ-Al 2 O 3 appear",
        },
        "review_notes": "Added the Figure 4 paragraph independently stating γ-Al2O3 disappears and δ-Al2O3 appears after aging; primary target retained.",
    },
    "rpdev1-a027": {
        "alternates": {
            "pmc10934912-p00054-e639c408d3ad": "the range of pore sizes expands from 2–16 nm to 2–100 nm",
        },
        "review_notes": "Added the Figure 6 paragraph independently reporting the same fresh-to-aged pore-size range; primary target retained.",
    },
    "rpdev1-a039": {
        "alternates": {
            "pmc4335811-p00025-264b891a0caf": "Cr V2C XES energies with an acceptably small error of 0.5 eV",
            "pmc4335811-p00039-4e3f714d24da": "DFT consistently predicts Cr V2C XES band energies within 0.5 eV",
        },
        "review_notes": "Added two independently sufficient results/conclusion chunks that report the approximate 0.5 eV accuracy; primary target retained.",
    },
    "rpdev1-a056": {
        "primary_chunk_id": "pmc6222785-p00009-5c23423b41b7",
        "primary_excerpt": "The V s,max value of [C 4 mim] + [Al 2 Cl 7 ] − is much higher than that of [C 4 mim] + [AlCl 4 ] − : 52.596 vs. 48.275.",
        "review_notes": "Primary target changed to the complete paragraph independently identifying both ionic species and their 52.596 vs. 48.275 values; no joint evidence target used.",
    },
    "rpdev1-a062": {
        "alternates": {
            "pmc12550025-p00052-bf5f923d8605": "three main modules: catalyst embedding module, condition embedding module, and autoencoder module",
        },
        "review_notes": "Added the Methods architecture paragraph independently naming the CVAE and all three requested modules; primary target retained.",
    },
}


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def pretty_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _validate_authoring_corpus(
    corpus_path: Path,
) -> tuple[dict[str, Any], dict[str, Any], str, str]:
    manifest_bytes = DEFAULT_MANIFEST_PATH.read_bytes()
    manifest_hash = sha256_bytes(manifest_bytes)
    if manifest_hash != EXPECTED_MANIFEST_SHA256:
        raise ValueError("Authoring manifest hash differs from the approved 6-paper checkpoint.")
    manifest = json.loads(manifest_bytes)
    if manifest.get("benchmark_id") != "retrieval-policy-dev-v1":
        raise ValueError("Unexpected authoring benchmark ID.")
    if len(manifest["documents"]) != 6 or len(manifest["chunks"]) != 342:
        raise ValueError("Authoring corpus must remain exactly 6 documents and 342 chunks.")
    chunk_inventory_hash = sha256_bytes(canonical_bytes(manifest["chunks"]))
    if chunk_inventory_hash != EXPECTED_CHUNK_INVENTORY_SHA256:
        raise ValueError("Authoring chunk inventory hash differs from the approved checkpoint.")

    corpus = _read(corpus_path)
    if len(corpus.get("documents", [])) != 6 or len(corpus.get("chunks", [])) != 342:
        raise ValueError(
            "Local authoring companion must remain exactly 6 documents and 342 chunks."
        )
    manifest_documents = {row["document_id"]: row for row in manifest["documents"]}
    corpus_documents = {row["document_id"]: row for row in corpus["documents"]}
    if set(manifest_documents) != set(corpus_documents):
        raise ValueError("Local authoring document set differs from the frozen manifest.")
    for document_id, document in corpus_documents.items():
        if document["source_xml_sha256"] != manifest_documents[document_id]["source_xml_sha256"]:
            raise ValueError(f"Local source XML hash mismatch for {document_id}.")

    manifest_chunks = {row["chunk_id"]: row for row in manifest["chunks"]}
    corpus_chunks = {row["chunk_id"]: row for row in corpus["chunks"]}
    if set(manifest_chunks) != set(corpus_chunks):
        raise ValueError("Local authoring chunk IDs differ from the frozen inventory.")
    for chunk_id, chunk in corpus_chunks.items():
        indexed = manifest_chunks[chunk_id]
        if any(
            chunk[key] != indexed[indexed_key]
            for key, indexed_key in (
                ("document_id", "document_id"),
                ("section", "section"),
                ("source_locator", "source_locator"),
                ("content_sha256", "content_sha256"),
            )
        ):
            raise ValueError(f"Local chunk identity/locator/hash mismatch for {chunk_id}.")
    return manifest, corpus, manifest_hash, chunk_inventory_hash


def _target(
    chunk_id: str,
    excerpt: str,
    documents: dict[str, dict[str, Any]],
    chunks: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    chunk = chunks.get(chunk_id)
    if chunk is None:
        raise ValueError(f"Approved QREL target chunk does not exist: {chunk_id}.")
    document = documents.get(chunk["document_id"])
    if document is None:
        raise ValueError(f"Approved QREL target document does not exist: {chunk['document_id']}.")
    locator = chunk["source_locator"]
    if chunk["section"] != locator["section_path"]:
        raise ValueError(f"Section and locator disagree for {chunk_id}.")
    target = {
        "expected_document_id": document["document_id"],
        "expected_page": None,
        "expected_chunk_id": chunk_id,
        "source_locator": locator,
        "content_sha256": chunk["content_sha256"],
        "source_xml_sha256": document["source_xml_sha256"],
        "evidence_excerpt": excerpt,
    }
    validate_target_integrity(
        target,
        documents,
        chunks,
        evidence_excerpt=excerpt,
    )
    return target


def _resolve_qrels(
    draft: dict[str, Any], corpus: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if draft.get("benchmark_id") != "retrieval-policy-dev-v1":
        raise ValueError("Unexpected QREL benchmark ID.")
    if draft.get("status") != "UNREVIEWED" or len(draft["qrels"]) != 101:
        raise ValueError("Expected the original 101-row unreviewed candidate pack.")
    qrels = [dict(row) for row in draft["qrels"]]
    by_id = {row["query_id"]: row for row in qrels}
    if len(by_id) != 101 or set(CORRECTIONS) - set(by_id):
        raise ValueError("QREL IDs or approved correction mapping do not match.")
    if sum(not row["no_answer"] for row in qrels) != 71:
        raise ValueError("Expected exactly 71 answerable QRELs.")
    if sum(row["no_answer"] for row in qrels) != 30:
        raise ValueError("Expected exactly 30 no-answer QRELs.")

    docs = {row["document_id"]: row for row in corpus["documents"]}
    chunks = {row["chunk_id"]: row for row in corpus["chunks"]}
    for query_id, correction in CORRECTIONS.items():
        if "query" in correction:
            by_id[query_id]["query"] = correction["query"]

    for qrel in qrels:
        if qrel["no_answer"]:
            continue
        correction = CORRECTIONS.get(qrel["query_id"], {})
        primary_chunk_id = correction.get("primary_chunk_id", qrel["expected_chunk_id"])
        primary_excerpt = correction.get("primary_excerpt", qrel["evidence_excerpt"])
        targets = [_target(primary_chunk_id, primary_excerpt, docs, chunks)]
        alternates = correction.get("alternates")
        if alternates is None:
            alternates = {
                target["expected_chunk_id"]: target.get(
                    "evidence_excerpt", qrel["evidence_excerpt"]
                )
                for target in qrel.get("alternate_targets", [])
            }
        for alternate_id, excerpt in alternates.items():
            if alternate_id != primary_chunk_id:
                targets.append(_target(alternate_id, excerpt, docs, chunks))
        qrel["expected_document_id"] = targets[0]["expected_document_id"]
        qrel["expected_page"] = None
        qrel["expected_chunk_id"] = targets[0]["expected_chunk_id"]
        qrel["source_locator"] = targets[0]["source_locator"]
        qrel["document_title"] = docs[qrel["expected_document_id"]]["title"]
        qrel["evidence_excerpt"] = targets[0]["evidence_excerpt"]
        qrel["acceptable_targets"] = targets
        qrel["alternate_targets"] = targets[1:]

    approved_unchanged = 0
    corrected = 0
    for qrel in qrels:
        query_id = qrel["query_id"]
        qrel["reviewer"] = REVIEWER
        qrel["review_date"] = REVIEW_DATE
        if query_id in CORRECTIONS:
            qrel["review_status"] = "CORRECTED"
            qrel["review_decision"] = "CORRECT"
            qrel["review_notes"] = CORRECTIONS[query_id]["review_notes"]
            corrected += 1
        else:
            qrel["review_status"] = "APPROVED"
            qrel["review_decision"] = "APPROVE"
            if qrel["no_answer"]:
                qrel["review_notes"] = (
                    "Approved per the owner-provided independent review after deterministic "
                    "corpus-wide inspection of all 342 authoring chunks; no direct answer found."
                )
            else:
                qrel["review_notes"] = (
                    "Approved unchanged per the owner-provided independent review; primary "
                    "target and source integrity validated against the pinned corpus."
                )
            approved_unchanged += 1

        if qrel["no_answer"]:
            if (
                any(
                    qrel.get(key) is not None
                    for key in ("expected_document_id", "expected_chunk_id")
                )
                or qrel.get("acceptable_targets")
                or qrel.get("alternate_targets")
            ):
                raise ValueError(f"No-answer QREL {query_id} has an answer target.")
            if qrel.get("source_locator") != {"kind": "CORPUS_WIDE"}:
                raise ValueError(f"No-answer QREL {query_id} lacks a corpus-wide locator.")
        else:
            targets = qrel.get("acceptable_targets", [])
            target_ids = [target["expected_chunk_id"] for target in targets]
            if not targets or len(target_ids) != len(set(target_ids)):
                raise ValueError(f"Answerable QREL {query_id} has missing/duplicate targets.")
            if qrel["expected_page"] is not None:
                raise ValueError(f"XML QREL {query_id} must not contain an expected page.")
            if targets[0]["expected_chunk_id"] != qrel["expected_chunk_id"]:
                raise ValueError(f"Primary target mismatch for {query_id}.")
            if targets[0]["source_locator"] != qrel["source_locator"]:
                raise ValueError(f"Primary locator mismatch for {query_id}.")
            if qrel["alternate_targets"] != targets[1:]:
                raise ValueError(f"Alternate target list mismatch for {query_id}.")
            for target in targets:
                validate_target_integrity(
                    target,
                    docs,
                    chunks,
                    evidence_excerpt=target["evidence_excerpt"],
                )

    summary = {
        "approved_unchanged": approved_unchanged,
        "corrected": corrected,
        "rejected": 0,
        "unreviewed": sum(row["review_status"] == "UNREVIEWED" for row in qrels),
    }
    if summary != {"approved_unchanged": 93, "corrected": 8, "rejected": 0, "unreviewed": 0}:
        raise ValueError(f"Unexpected human review result: {summary}.")
    return sorted(qrels, key=lambda row: row["query_id"]), summary


def _partition_stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    groups: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        if row.get("leakage_group_id"):
            groups[row["leakage_group_id"]].append(row["query_id"])
    return {
        "count": len(rows),
        "answerable_count": sum(not row["no_answer"] for row in rows),
        "no_answer_count": sum(row["no_answer"] for row in rows),
        "language_distribution": dict(sorted(Counter(row["language"] for row in rows).items())),
        "class_distribution": dict(sorted(Counter(row["query_class"] for row in rows).items())),
        "leakage_group_distribution": dict(
            sorted((key, sorted(value)) for key, value in groups.items())
        ),
    }


def _csv_rows(qrels: list[dict[str, Any]], corpus: dict[str, Any]) -> list[dict[str, str]]:
    documents = {row["document_id"]: row for row in corpus["documents"]}
    chunks = {row["chunk_id"]: row for row in corpus["chunks"]}
    rows: list[dict[str, str]] = []
    for qrel in qrels:
        chunk = chunks.get(qrel["expected_chunk_id"])
        document = documents.get(qrel["expected_document_id"])
        locator = qrel["source_locator"]
        rows.append(
            {
                "query_id": qrel["query_id"],
                "query": qrel["query"],
                "language": qrel["language"],
                "class": qrel["query_class"],
                "document_title": qrel["document_title"],
                "source_kind": locator["kind"],
                "section": locator.get("section_path", ""),
                "paragraph_ordinal": str(locator.get("paragraph_ordinal", "")),
                "chunk_ordinal": str(locator.get("chunk_ordinal", "")),
                "xml_node_id": str(locator.get("xml_node_id") or ""),
                "expected_page": str(qrel["expected_page"] or ""),
                "expected_document_id": qrel["expected_document_id"] or "",
                "expected_chunk_id": qrel["expected_chunk_id"] or "",
                "evidence_excerpt": qrel["evidence_excerpt"],
                "alternate_targets": json.dumps(
                    qrel["alternate_targets"], ensure_ascii=False, sort_keys=True
                ),
                "no_answer": str(qrel["no_answer"]).lower(),
                "leakage_group_id": qrel["leakage_group_id"] or "",
                "review_status": qrel["review_status"],
                "review_decision": qrel["review_decision"],
                "reviewer": qrel["reviewer"],
                "review_notes": qrel["review_notes"],
                "assistant_recommendation": qrel["assistant_recommendation"],
                "assistant_review_notes": qrel["assistant_review_notes"],
                "source_text_sha256": chunk["content_sha256"] if chunk else "",
                "source_xml_sha256": document["source_xml_sha256"] if document else "",
            }
        )
    return rows


def build_artifacts(corpus_path: Path = DEFAULT_CORPUS) -> dict[Path, str]:
    _, corpus, manifest_hash, chunk_inventory_hash = _validate_authoring_corpus(corpus_path)
    draft = _read(REVIEW_JSON)
    qrels, review_summary = _resolve_qrels(draft, corpus)
    qrel_hash = sha256_bytes(canonical_bytes(qrels))
    qrels_by_id = {row["query_id"]: row for row in qrels}
    dev_rows, holdout_rows = split_isolated(
        qrels,
        holdout_fraction=HOLDOUT_FRACTION,
        seed=SPLIT_SEED,
    )
    dev_ids = {row["query_id"] for row in dev_rows}
    holdout_ids = {row["query_id"] for row in holdout_rows}
    membership = {
        query_id: "DEV" if query_id in dev_ids else "HOLDOUT" for query_id in sorted(qrels_by_id)
    }
    if len(dev_ids) + len(holdout_ids) != 101 or dev_ids & holdout_ids:
        raise ValueError("Split does not assign each query exactly once.")
    group_partitions: dict[str, set[str]] = defaultdict(set)
    for query_id, partition in membership.items():
        group_id = qrels_by_id[query_id].get("leakage_group_id")
        if group_id:
            group_partitions[group_id].add(partition)
    crossover = sum(len(partitions) > 1 for partitions in group_partitions.values())
    if crossover:
        raise ValueError(f"Leakage groups cross partitions: {crossover}.")

    frozen = {
        "schema_version": "1.0",
        "benchmark_id": "retrieval-policy-dev-v1",
        "status": "FROZEN",
        "review_date": REVIEW_DATE,
        "reviewer": REVIEWER,
        "review_complete": True,
        "qrel_count": len(qrels),
        "answerable_count": sum(not row["no_answer"] for row in qrels),
        "no_answer_count": sum(row["no_answer"] for row in qrels),
        "review_summary": review_summary,
        "corpus_manifest_sha256": manifest_hash,
        "chunk_inventory_sha256": chunk_inventory_hash,
        "qrels_sha256": qrel_hash,
        "hash_definition": "SHA-256 of canonical JSON qrels array (UTF-8, sorted keys, compact separators).",
        "qrels": qrels,
    }
    split = {
        "schema_version": "1.0",
        "benchmark_id": "retrieval-policy-dev-v1",
        "status": "FROZEN",
        "split_seed": SPLIT_SEED,
        "holdout_fraction": HOLDOUT_FRACTION,
        "strategy": "Deterministic greedy marginal stratification; leakage groups are indivisible.",
        "frozen_qrels_sha256": qrel_hash,
        "corpus_manifest_sha256": manifest_hash,
        "chunk_inventory_sha256": chunk_inventory_hash,
        "membership": membership,
        "split_sha256": sha256_bytes(canonical_bytes(membership)),
        "split_hash_definition": "SHA-256 of canonical JSON query_id-to-partition mapping.",
        "dev": _partition_stats(dev_rows),
        "holdout": _partition_stats(holdout_rows),
        "explicit_leakage_group_count": len(group_partitions),
        "leakage_crossover_count": crossover,
    }
    if split["dev"]["count"] + split["holdout"]["count"] != 101:
        raise ValueError("DEV and HOLDOUT counts do not sum to the QREL count.")

    updated_review = dict(draft)
    updated_review.update(
        {
            "status": "FROZEN",
            "judgment_source": "Owner-provided independent human review; source integrity validated against the pinned authoring corpus.",
            "reviewer": REVIEWER,
            "review_date": REVIEW_DATE,
            "review_summary": review_summary,
            "review_complete": True,
            "review_gate": {"can_freeze": True, "unreviewed_count": 0},
            "corpus_manifest_sha256": manifest_hash,
            "chunk_inventory_sha256": chunk_inventory_hash,
            "qrels_sha256": qrel_hash,
            "qrels": qrels,
        }
    )
    updated_review["query_class_distribution"] = dict(
        sorted(Counter(row["query_class"] for row in qrels).items())
    )
    updated_review["language_distribution"] = dict(
        sorted(Counter(row["language"] for row in qrels).items())
    )

    artifacts = {
        FROZEN_QRELS_PATH: pretty_json(frozen),
        SPLIT_PATH: pretty_json(split),
        DEV_QRELS_PATH: pretty_json(
            {
                "schema_version": "1.0",
                "benchmark_id": "retrieval-policy-dev-v1",
                "status": "FROZEN",
                "partition": "DEV",
                "qrels_sha256": qrel_hash,
                "split_sha256": split["split_sha256"],
                "qrels": dev_rows,
            }
        ),
        HOLDOUT_QRELS_PATH: pretty_json(
            {
                "schema_version": "1.0",
                "benchmark_id": "retrieval-policy-dev-v1",
                "status": "FROZEN",
                "partition": "HOLDOUT",
                "qrels_sha256": qrel_hash,
                "split_sha256": split["split_sha256"],
                "qrels": holdout_rows,
            }
        ),
        REVIEW_JSON: pretty_json(updated_review),
    }
    csv_rows = _csv_rows(qrels, corpus)
    fieldnames = list(csv_rows[0])
    from io import StringIO

    buffer = StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, lineterminator="\n")
    writer.writeheader()
    writer.writerows(csv_rows)
    artifacts[REVIEW_CSV] = buffer.getvalue()

    record = f"""# Retrieval policy dev V1 — human review and freeze record

Status: **QRELS FROZEN / SPLIT FROZEN / RETRIEVAL NOT YET SCORED**

- Review date: {REVIEW_DATE}
- Reviewer: `{REVIEWER}` (owner-provided independent review outcome)
- QRELs: 101 total; 71 answerable; 30 no-answer
- Review: 93 approved unchanged; 8 corrected; 0 rejected; 0 unreviewed
- Frozen QREL SHA-256: `{qrel_hash}`
- Split SHA-256: `{split["split_sha256"]}`
- Manifest SHA-256: `{manifest_hash}`
- Chunk inventory SHA-256: `{chunk_inventory_hash}`
- Split seed: `{SPLIT_SEED}`; DEV: {split["dev"]["count"]}; HOLDOUT: {split["holdout"]["count"]}
- Leakage groups: {split["explicit_leakage_group_count"]}; crossover: {crossover}

No retrieval ranking, policy comparison, or abstention analysis was run. The local
corpus companion remains outside version control. Review changes and target checks
are preserved in the combined review pack and frozen QREL artifact.
"""
    artifacts[REVIEW_RECORD_PATH] = record

    for path in (
        FROZEN_QRELS_PATH,
        SPLIT_PATH,
        DEV_QRELS_PATH,
        HOLDOUT_QRELS_PATH,
        REVIEW_RECORD_PATH,
    ):
        if path.exists():
            raise FileExistsError(f"Refusing to overwrite frozen artifact: {path.name}.")
    return artifacts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    args = parser.parse_args()
    artifacts = build_artifacts(args.corpus)
    for path, content in artifacts.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="")
    print(
        json.dumps(
            {
                "artifacts_written": len(artifacts),
                "paths": [str(path) for path in artifacts],
                "qrels_sha256": json.loads(artifacts[FROZEN_QRELS_PATH])["qrels_sha256"],
                "split_sha256": json.loads(artifacts[SPLIT_PATH])["split_sha256"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
