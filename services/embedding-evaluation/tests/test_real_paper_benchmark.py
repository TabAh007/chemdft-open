from __future__ import annotations

import csv
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
EVAL_ROOT = ROOT / "services" / "embedding-evaluation"


def _load(relative_path: str) -> dict[str, Any]:
    return json.loads((EVAL_ROOT / relative_path).read_text(encoding="utf-8"))


def _sensitive_keys(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, nested in value.items():
            key_lower = key.lower()
            if any(token in key_lower for token in ("storage_key", "object_key", "vector")):
                found.add(key)
            found |= _sensitive_keys(nested)
    elif isinstance(value, list):
        for nested in value:
            found |= _sensitive_keys(nested)
    return found


def test_real_corpus_manifest_has_redistribution_and_reproduction_metadata() -> None:
    manifest = _load("real-paper-v1-manifest.json")
    assert manifest["status"] == "UNREVIEWED"
    papers = manifest["papers"]
    assert len(papers) == 8
    assert len({paper["doi"] for paper in papers}) == len(papers)
    assert len({paper["benchmark_document_id"] for paper in papers}) == len(papers)

    for paper in papers:
        assert paper["title"]
        assert paper["publisher"]
        assert paper["domain_tags"]
        assert paper["language"]
        assert paper["license"] == "CC-BY-4.0"
        assert paper["license_url"] == "https://creativecommons.org/licenses/by/4.0/"
        assert paper["license_evidence_url"].startswith("https://")
        assert paper["source_url"].startswith("https://")
        assert paper["pdf_source_url"].startswith("https://")
        assert paper["download_date"] == "2026-09-24"
        assert re.fullmatch(r"[0-9a-f]{64}", paper["pdf_sha256"])
        assert paper["page_count"] > 0
        assert paper["chunk_count"] > 0
        assert paper["parser_version"] == manifest["parser_version"]
        assert paper["chunker_version"] == "deterministic-scientific-v2"

    assert all("chromium" not in paper["title"].lower() for paper in papers)


def test_chunk_inventory_matches_manifest_and_phase9_record_shape() -> None:
    manifest = _load("real-paper-v1-manifest.json")
    inventory = _load("real-paper-v1-chunks.json")
    assert inventory["status"] == "UNREVIEWED"
    assert inventory["schema"] == "Phase 9 KnowledgeChunkRecord"
    assert inventory["benchmark_id"] == manifest["benchmark_id"]
    assert len(inventory["documents"]) == len(manifest["papers"])

    manifest_by_id = {paper["benchmark_document_id"]: paper for paper in manifest["papers"]}
    total_chunks = 0
    for document in inventory["documents"]:
        paper = manifest_by_id[document["benchmark_document_id"]]
        assert document["pdf_sha256"] == paper["pdf_sha256"]
        assert document["document_id"] == paper["document_id"]
        assert document["page_count"] == paper["page_count"]
        assert document["chunk_count"] == paper["chunk_count"] == len(document["chunks"])
        assert document["chunker_version"] == "deterministic-scientific-v2"
        assert len({chunk["chunk_id"] for chunk in document["chunks"]}) == len(document["chunks"])
        for chunk in document["chunks"]:
            assert chunk["document_id"] == document["document_id"]
            assert 1 <= chunk["page_number"] <= document["page_count"]
            assert chunk["source_type"] == "DOCUMENT_TEXT"
            assert chunk["source_class"] == "EXTRACTED"
            assert chunk["verification_state"] == "UNVERIFIED"
            assert re.fullmatch(r"[0-9a-f]{64}", chunk["content_hash"])
            assert "page_number" in chunk["metadata"]
        total_chunks += len(document["chunks"])

    assert total_chunks == 349
    assert not _sensitive_keys(inventory)
    serialized = json.dumps(inventory).lower()
    assert "chromium" not in serialized
    assert "object_key" not in serialized
    assert "storage_key" not in serialized


def test_qrels_are_complete_unreviewed_and_reference_real_page_chunks() -> None:
    manifest = _load("real-paper-v1-manifest.json")
    inventory = _load("real-paper-v1-chunks.json")
    qrel_pack = _load("real-paper-qrels-v1.json")
    assert qrel_pack["status"] == "UNREVIEWED"
    qrels = qrel_pack["qrels"]
    assert 70 <= len(qrels) <= 100
    assert len({qrel["query_id"] for qrel in qrels}) == len(qrels)

    chunks = {
        chunk["chunk_id"]: (
            document["benchmark_document_id"],
            document["document_id"],
            chunk["page_number"],
        )
        for document in inventory["documents"]
        for chunk in document["chunks"]
    }
    page_counts = {
        paper["benchmark_document_id"]: paper["page_count"] for paper in manifest["papers"]
    }
    for qrel in qrels:
        assert qrel["review_status"] == "UNREVIEWED"
        assert qrel["reviewer"] is None
        assert qrel["query"] and qrel["query_class"] and qrel["language"]
        assert 1 <= len(qrel["evidence_excerpt"].split()) <= 45
        assert qrel["no_answer"] is (not qrel["acceptable_targets"])
        assert qrel["alternate_targets"] == qrel["acceptable_targets"][1:]
        if qrel["no_answer"]:
            assert qrel["expected_chunk_id"] is None
            assert qrel["expected_page"] is None
            continue
        assert qrel["expected_chunk_id"] in chunks
        for target in qrel["acceptable_targets"]:
            assert chunks[target["chunk_id"]] == (
                target["benchmark_document_id"],
                target["document_id"],
                target["page"],
            )
            assert 1 <= target["page"] <= page_counts[target["benchmark_document_id"]]

    assert sum(qrel["no_answer"] for qrel in qrels) == 4
    assert sum(len(qrel["acceptable_targets"]) > 1 for qrel in qrels) == 2
    assert {qrel["language"] for qrel in qrels} == {"en", "ru"}
    assert any(qrel["query_class"] == "noisy_partial" for qrel in qrels)
    assert not _sensitive_keys(qrel_pack)
    assert "chromium" not in json.dumps(qrel_pack).lower()


def test_review_csv_is_a_lossless_frozen_qrel_record() -> None:
    qrel_pack = _load("real-paper-qrels-v1-frozen.json")
    csv_path = EVAL_ROOT / "review" / "real-paper-qrels-v1.csv"
    with csv_path.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    assert len(rows) == len(qrel_pack["qrels"])
    assert [row["query_id"] for row in rows] == [qrel["query_id"] for qrel in qrel_pack["qrels"]]
    assert [row["review_status"] for row in rows] == [
        qrel["review_status"] for qrel in qrel_pack["qrels"]
    ]
    assert all(row["review_status"] in {"APPROVED", "CORRECTED"} for row in rows)
    assert all(row["reviewer"] for row in rows)
    assert all(row["review_notes"] for row in rows)
    assert "expected_chunk_id" in rows[0]
    assert "expected_evidence_anchor_id" in rows[0]


def test_frozen_qrels_have_complete_human_review_and_source_backed_targets() -> None:
    frozen = _load("real-paper-qrels-v1-frozen.json")
    manifest = _load("real-paper-v1-manifest.json")
    inventory = _load("real-paper-v1-chunks.json")
    qrels = frozen["qrels"]
    by_id = {qrel["query_id"]: qrel for qrel in qrels}

    assert frozen["status"] == "FROZEN"
    assert frozen["review"]["benchmark_version"] == "real-scientific-retrieval-v1"
    assert frozen["review"]["qrel_count"] == 73
    assert frozen["review"]["judgment_counts"] == {
        "APPROVED": 64,
        "CORRECTED": 9,
        "REJECTED": 0,
    }
    assert frozen["review"]["retrieval_benchmark_run"] is False
    assert all(qrel["review_status"] in {"APPROVED", "CORRECTED"} for qrel in qrels)
    assert all(qrel["reviewer"] and qrel["review_notes"] for qrel in qrels)
    assert sum(qrel["no_answer"] for qrel in qrels) == 4

    chunks = {
        chunk["chunk_id"]: (document["benchmark_document_id"], chunk["page_number"])
        for document in inventory["documents"]
        for chunk in document["chunks"]
    }
    for qrel in qrels:
        assert qrel["no_answer"] is (not qrel["acceptable_targets"])
        if qrel["no_answer"]:
            assert qrel["expected_chunk_id"] is None
            continue
        assert qrel["expected_chunk_id"] in chunks
        for target in qrel["acceptable_targets"]:
            assert chunks[target["chunk_id"]] == (
                target["benchmark_document_id"],
                target["page"],
            )

    assert len(by_id["rpv1-070"]["acceptable_targets"]) == 6
    assert len(by_id["rpv1-071"]["acceptable_targets"]) == 5
    assert by_id["rpv1-071"]["expected_page"] == 12
    assert by_id["rpv1-071"]["expected_chunk_id"] == "d6d2ae2d-01c6-5b0a-a736-3cfdef636bcb"
    assert "Какие варианты" in by_id["rpv1-008"]["query"]
    assert "Ag nanoparticles" in by_id["rpv1-019"]["query"]
    assert "pH 12" in by_id["rpv1-021"]["review_notes"]
    assert "Com-Tetra" in by_id["rpv1-034"]["evidence_excerpt"]
    assert all(
        by_id[f"rpv1-{query_id:03}"]["review_status"] == "APPROVED" for query_id in range(66, 70)
    )
    assert all(by_id[f"rpv1-{query_id:03}"]["review_notes"] for query_id in range(66, 70))
    assert {paper["benchmark_document_id"] for paper in manifest["papers"]} == {
        document["benchmark_document_id"] for document in inventory["documents"]
    }


def test_frozen_review_record_hashes_match_committed_artifacts() -> None:
    review_record = (EVAL_ROOT / "review" / "real-paper-qrels-v1-review-record.md").read_text(
        encoding="utf-8"
    )
    assert "- APPROVED unchanged: 60" in review_record
    expected = {
        "Frozen QREL SHA-256": EVAL_ROOT / "real-paper-qrels-v1-frozen.json",
        "Corpus manifest SHA-256": EVAL_ROOT / "real-paper-v1-manifest.json",
        "Chunk inventory SHA-256": EVAL_ROOT / "real-paper-v1-chunks.json",
    }
    for label, path in expected.items():
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        assert f"- {label}: `{digest}`" in review_record


def test_ingestion_script_uses_existing_parser_chunker_and_phase9_models() -> None:
    script = (EVAL_ROOT / "scripts" / "ingest_real_paper_v1.py").read_text(encoding="utf-8")
    assert "pdf_parser_worker.py" in script
    assert "scientific_document_chunks" in script
    assert "KnowledgeItemRecord" in script
    assert "KnowledgeChunkRecord" in script
    assert "normalize_text(source.content)" in script
    assert "deterministic-scientific-v2" not in script  # Version is imported from production.
    assert "EmbeddingGateway" not in script
    assert "create_embedding" not in script


def test_qrel_generation_does_not_import_or_store_model_rankings() -> None:
    script = (EVAL_ROOT / "scripts" / "build_real_paper_qrel_review_pack.py").read_text(
        encoding="utf-8"
    )
    forbidden = (
        "sentence_transformers",
        "transformers",
        "faiss",
        "torch",
        "rank_documents",
        "embedding_eval",
    )
    assert not any(token in script.lower() for token in forbidden)
    qrel_pack = _load("real-paper-qrels-v1.json")
    assert all("ranking" not in qrel for qrel in qrel_pack["qrels"])


def test_local_pdf_hashes_match_manifest_when_source_directory_is_provided() -> None:
    pdf_dir_value = os.environ.get("CHEMDFT_REAL_PAPER_PDF_DIR")
    if not pdf_dir_value:
        return
    pdf_dir = Path(pdf_dir_value)
    manifest = _load("real-paper-v1-manifest.json")
    for paper in manifest["papers"]:
        digest = hashlib.sha256((pdf_dir / paper["local_pdf_name"]).read_bytes()).hexdigest()
        assert digest == paper["pdf_sha256"]
