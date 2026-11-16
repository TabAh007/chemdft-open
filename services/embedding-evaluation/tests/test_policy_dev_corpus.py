import hashlib
import json
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from embedding_eval.models import MODEL_CANDIDATES
from embedding_eval.policy_dev_corpus import (
    BENCHMARK_ID,
    DEFAULT_MANIFEST_PATH,
    SOURCE_RECORDS,
    _article_text,
    _license_details,
    _split_words,
)
from embedding_eval.source_locators import (
    resolve_xml_locator,
    validate_source_locator,
    validate_target_integrity,
)


def test_dev_corpus_sources_are_distinct_from_frozen_v1() -> None:
    root = Path(__file__).resolve().parents[1]
    frozen = json.loads((root / "real-paper-v1-manifest.json").read_text())
    frozen_pmcs = {
        paper.get("pmcid", "").upper() for paper in frozen["papers"] if paper.get("pmcid")
    }
    frozen_dois = {paper["doi"].casefold() for paper in frozen["papers"]}
    assert len(SOURCE_RECORDS) == 6
    assert not {source["pmcid"] for source in SOURCE_RECORDS} & frozen_pmcs
    manifest = json.loads(DEFAULT_MANIFEST_PATH.read_text())
    assert not {paper["doi"].casefold() for paper in manifest["documents"]} & frozen_dois
    assert all("content" not in chunk for chunk in manifest["chunks"])
    assert manifest["status"] == "CORPUS_LABELS_UNREVIEWED"
    assert all(paper["license"] == "CC-BY-4.0" for paper in manifest["documents"])
    assert all(
        paper["license"] == "CC-BY-4.0"
        and paper["license_url"].rstrip("/").endswith("/licenses/by/4.0")
        and paper["license_evidence_url"].startswith("https://")
        for paper in manifest["documents"]
    )
    assert all(
        paper["license_evidence_url"]
        == next(
            source["license_evidence_url"]
            for source in SOURCE_RECORDS
            if source["pmcid"].lower() == paper["document_id"]
        )
        for paper in manifest["documents"]
    )
    assert BENCHMARK_ID == "retrieval-policy-dev-v1"


def test_only_explicit_attribution_licenses_are_accepted() -> None:
    by_xml = ET.fromstring(
        '<article xmlns:xlink="http://www.w3.org/1999/xlink"><license>'
        "<license-p>Creative Commons Attribution 4.0</license-p>"
        '<ext-link xlink:href="https://creativecommons.org/licenses/by/4.0/">'
        "license</ext-link></license></article>"
    )
    nc_xml = ET.fromstring(
        '<article xmlns:xlink="http://www.w3.org/1999/xlink"><license>'
        "<license-p>Creative Commons Attribution-NonCommercial</license-p>"
        '<ext-link xlink:href="https://creativecommons.org/licenses/by-nc/4.0/">'
        "license</ext-link></license></article>"
    )
    versionless_xml = ET.fromstring(
        "<article><license><license-p>This is a Creative Commons Attribution (CC-BY) "
        "license permitting unrestricted reproduction.</license-p></license></article>"
    )
    assert _license_details(by_xml) == (
        "CC-BY-4.0",
        "https://creativecommons.org/licenses/by/4.0/",
    )
    assert _license_details(nc_xml) is None
    assert _license_details(versionless_xml) is None
    assert _license_details(
        versionless_xml,
        {
            "verified_license": "CC-BY-4.0",
            "verified_license_url": "https://creativecommons.org/licenses/by/4.0/",
        },
    ) == ("CC-BY-4.0", "https://creativecommons.org/licenses/by/4.0/")


def test_article_paragraphs_preserve_section_context_and_skip_figures() -> None:
    article = ET.fromstring(
        "<article><body><sec><title>Methods</title>"
        "<p>B3LYP calculations used a 6-31G basis.</p>"
        "<fig><caption><p>Figure caption not indexed as body text.</p></caption></fig>"
        "</sec></body></article>"
    )
    assert _article_text(article) == [
        ("Methods", "B3LYP calculations used a 6-31G basis.", 1, None)
    ]


def test_chunking_is_deterministic_and_bounded() -> None:
    words = " ".join(f"w{index}" for index in range(450))
    chunks = _split_words(words)
    assert [len(chunk.split()) for chunk in chunks] == [220, 220, 70]
    assert chunks[0].split()[-30:] == chunks[1].split()[:30]
    assert _split_words(words) == chunks


def test_dev_harness_keeps_pinned_bge_and_does_not_add_models() -> None:
    assert set(MODEL_CANDIDATES) == {"multilingual-e5-base", "bge-m3"}
    assert MODEL_CANDIDATES["bge-m3"]["revision"] == ("5617a9f61b028005a4858fdac845db406aefb181")
    assert DEFAULT_MANIFEST_PATH.name == "retrieval-policy-dev-v1-manifest.json"


def test_active_api_embedding_gateway_remains_deterministic_fake() -> None:
    root = Path(__file__).resolve().parents[3]
    service = (root / "services/api/src/chemdft_api/knowledge/service.py").read_text()
    assert "gateway or DeterministicFakeEmbeddingGateway()" in service
    assert "bge-m3" not in service.casefold()


def test_historical_review_artifacts_are_unchanged_without_loading_labels() -> None:
    review_dir = Path(__file__).resolve().parents[1] / "review"
    hashes = {
        "retrieval-policy-dev-v1-no-answer-review.csv": "9d409b88be9e45ab7462061c2bc3edf7f17feacb9b72b1f644dc22b1db57d141",
        "retrieval-policy-dev-v1-qrels-review.json": "b99888b8ad776040729585632e3073ea6ebae3ce47f3891b5b4a8def327ab901",
        "retrieval-policy-dev-v1-qrels-review.csv": "fceda0f63e83bb79f391bb3a7bc3fc7d7a29faf321e49da18f5ec92a82adbddb",
    }
    for name, expected in hashes.items():
        assert hashlib.sha256((review_dir / name).read_bytes()).hexdigest() == expected


def test_dev_review_is_complete_and_source_typed() -> None:
    from embedding_eval.frozen_policy_dev_v1 import load_dev_qrels

    qrels = load_dev_qrels()
    assert len(qrels) == 71
    assert sum(not row["no_answer"] for row in qrels) == 50
    assert sum(row["no_answer"] for row in qrels) == 21
    assert len({row["query_id"] for row in qrels}) == len(qrels)
    assert all(row["review_status"] in {"APPROVED", "CORRECTED"} for row in qrels)
    for row in qrels:
        if row["no_answer"]:
            assert row["expected_document_id"] is None
            assert row["expected_chunk_id"] is None
            assert row["acceptable_targets"] == []
            assert row["alternate_targets"] == []
            assert row["source_locator"] == {"kind": "CORPUS_WIDE"}
        else:
            assert row["expected_page"] is None
            assert row["source_locator"]["kind"] == "XML_PARAGRAPH"
            assert row["acceptable_targets"][0]["expected_chunk_id"] == row["expected_chunk_id"]
            assert row["acceptable_targets"][0]["content_sha256"]
            assert row["acceptable_targets"][0]["source_xml_sha256"]
            target_ids = [target["expected_chunk_id"] for target in row["acceptable_targets"]]
            assert len(target_ids) == len(set(target_ids))
    assert all(
        "all 342 authoring chunks" in row["review_notes"] for row in qrels if row["no_answer"]
    )


def test_frozen_qrel_and_split_hashes_and_membership_are_pinned() -> None:
    eval_root = Path(__file__).resolve().parents[1]
    status = json.loads((eval_root / "retrieval-policy-dev-v1-blind-status.json").read_bytes())
    split = json.loads((eval_root / "retrieval-policy-dev-v1-split-frozen.json").read_text())

    def canonical(value: object) -> bytes:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()

    # Byte pins preserve the canonical QREL hash verified at freeze and repair
    # without deserializing combined/old-holdout plaintext in ordinary tests.
    assert status["frozen_file_sha256"] == {
        "retrieval-policy-dev-v1-qrels-frozen.json": "5708b2ec5fd406fe5ed3710b90fac251207fd92f466ca9f675bbf598a4295442",
        "retrieval-policy-dev-v1-split-frozen.json": "d24f34bce8e84b3c5f9d47903fb5b6a410aaece57c0d9383e681b3083b47d4c7",
        "retrieval-policy-dev-v1-manifest.json": "1f9bd97fddd758463cfdb0814713a3d3673e8e9ab67ede4abdc52663be2503bc",
        "retrieval-policy-dev-v1-dev-qrels.json": "08402888b2e1dfe3f5571745d109122ea522a244f8f565dc2e30c933ecacc537",
        "retrieval-policy-dev-v1-holdout-qrels.json": "11c09e02733f5721b03cf3e3e0ac6e6ca09fa5c8a0d8436f6f3474bd54a7dcc4",
    }
    for name, expected in status["frozen_file_sha256"].items():
        assert hashlib.sha256((eval_root / name).read_bytes()).hexdigest() == expected
    assert status["benchmark_status"] == "FROZEN_VALID"
    assert status["counts"]["qrels"] == {"total": 101, "answerable": 71, "no_answer": 30}
    assert status["counts"]["dev"] == {"total": 71, "answerable": 50, "no_answer": 21}
    assert status["counts"]["old_holdout"] == {"total": 30, "answerable": 21, "no_answer": 9}
    assert status["blind_evaluation_status"] == "CONTAMINATED_FOR_BLIND_EVAL"
    assert status["dev_status"] == "VALID_FOR_POLICY_DEVELOPMENT"
    assert status["final_blind_certification_allowed"] is False
    assert status["allowed_use"] == "NON_BLIND_DIAGNOSTICS_ONLY"
    assert status["frozen_qrels_sha256"] == (
        "9cb8b50648cedf9a7fd702a4ddf7224280d233aacdb56817b845638023edc2f7"
    )
    assert split["split_sha256"] == (
        "161443e1c6d5982645f56655181477b83af7da50d1e61f686100ff4bad6c9758"
    )
    assert status["split_sha256"] == split["split_sha256"]
    assert hashlib.sha256(canonical(split["membership"])).hexdigest() == split["split_sha256"]
    assert len(split["membership"]) == 101
    assert set(split["membership"].values()) == {"DEV", "HOLDOUT"}
    assert split["dev"]["count"] + split["holdout"]["count"] == 101
    assert split["dev"]["count"] == 71
    assert split["holdout"]["count"] == 30
    assert split["dev"]["no_answer_count"] == 21
    assert split["holdout"]["no_answer_count"] == 9
    assert "identifier" in split["dev"]["class_distribution"]
    assert "identifier" in split["holdout"]["class_distribution"]
    assert "ru" in split["dev"]["language_distribution"]
    assert "ru" in split["holdout"]["language_distribution"]
    assert "cross_language" in split["dev"]["class_distribution"]
    assert "cross_language" in split["holdout"]["class_distribution"]
    assert split["leakage_crossover_count"] == 0
    assert split["split_seed"] == 20260924

    manifest = json.loads((eval_root / "retrieval-policy-dev-v1-manifest.json").read_text())
    assert status["corpus_manifest_sha256"] == (
        "1f9bd97fddd758463cfdb0814713a3d3673e8e9ab67ede4abdc52663be2503bc"
    )
    assert status["chunk_inventory_sha256"] == (
        "0cced278caafbda97b1b22d8a499a6aaa1a73c17ab9e2ef700425524eebea94e"
    )
    assert (
        hashlib.sha256(canonical(manifest["chunks"])).hexdigest()
        == (status["chunk_inventory_sha256"])
    )
    from embedding_eval.frozen_policy_dev_v1 import load_dev_qrels

    manifest_documents = {row["document_id"]: row for row in manifest["documents"]}
    manifest_chunks = {row["chunk_id"]: row for row in manifest["chunks"]}
    for row in load_dev_qrels():
        for target in row["acceptable_targets"]:
            chunk = manifest_chunks[target["expected_chunk_id"]]
            document = manifest_documents[target["expected_document_id"]]
            assert chunk["document_id"] == target["expected_document_id"]
            assert chunk["content_sha256"] == target["content_sha256"]
            assert chunk["source_locator"] == target["source_locator"]
            assert target["source_xml_sha256"] == document["source_xml_sha256"]
            assert target["expected_page"] is None

    # The split is historical evidence, not something to recompute in DEV tests.
    assert split["membership"]["rpdev1-a012"] == split["membership"]["rpdev1-a013"]


def test_dev_loader_never_returns_holdout_rows() -> None:
    from embedding_eval.frozen_policy_dev_v1 import load_dev_qrels

    development = load_dev_qrels()
    split = json.loads(
        (
            Path(__file__).resolve().parents[1] / "retrieval-policy-dev-v1-split-frozen.json"
        ).read_bytes()
    )
    assert {row["query_id"] for row in development} == {
        query_id for query_id, partition in split["membership"].items() if partition == "DEV"
    }
    assert len(development) == 71
    assert sum(partition == "HOLDOUT" for partition in split["membership"].values()) == 30


def test_source_type_aware_locators_resolve_xml_and_accept_pdf_pages() -> None:
    locator = {
        "kind": "XML_PARAGRAPH",
        "section_path": "Methods / Synthesis",
        "paragraph_ordinal": 8,
        "chunk_ordinal": 1,
        "xml_node_id": "p8",
    }
    chunk = {
        "chunk_id": "doc-p00008-abcd",
        "document_id": "doc",
        "source_locator": locator,
        "content_sha256": "chunk-hash",
        "content": "The Ce:Zr ratio was 1:1 by mole.",
    }
    document = {"source_xml_sha256": "source-hash"}
    target = {
        "expected_document_id": "doc",
        "expected_chunk_id": chunk["chunk_id"],
        "expected_page": None,
        "source_locator": locator,
        "content_sha256": "chunk-hash",
        "source_xml_sha256": "source-hash",
    }
    assert resolve_xml_locator("doc", locator, [chunk]) == [chunk]
    validate_target_integrity(
        target,
        {"doc": document},
        {chunk["chunk_id"]: chunk},
        evidence_excerpt="Ce:Zr ratio was 1:1",
    )
    validate_source_locator({"kind": "PDF_PAGE", "page": 12, "anchor_id": "page-12"})


def test_xml_qrel_integrity_rejects_stale_hash_page_or_excerpt() -> None:
    locator = {
        "kind": "XML_PARAGRAPH",
        "section_path": "Results",
        "paragraph_ordinal": 2,
        "chunk_ordinal": 1,
        "xml_node_id": None,
    }
    chunk = {
        "chunk_id": "doc-p00002-abcd",
        "document_id": "doc",
        "source_locator": locator,
        "content_sha256": "chunk-hash",
        "content": "The measured value was 48.275 kcal/mol.",
    }
    target = {
        "expected_document_id": "doc",
        "expected_chunk_id": chunk["chunk_id"],
        "expected_page": None,
        "source_locator": locator,
        "content_sha256": "chunk-hash",
        "source_xml_sha256": "source-hash",
    }
    documents = {"doc": {"source_xml_sha256": "source-hash"}}
    chunks = {chunk["chunk_id"]: chunk}
    with pytest.raises(ValueError, match="source-text hash"):
        validate_target_integrity({**target, "content_sha256": "stale"}, documents, chunks)
    with pytest.raises(ValueError, match="must not invent"):
        validate_target_integrity({**target, "expected_page": 4}, documents, chunks)
    with pytest.raises(ValueError, match="does not occur"):
        validate_target_integrity(
            target, documents, chunks, evidence_excerpt="made-up scientific result"
        )
