"""Build a metadata-only inventory with the actual Phase 7 PDF parser and Phase 9 chunker.

Run with the API environment so its parser and ORM models are available:
  uv run --project services/api python services/embedding-evaluation/scripts/ingest_real_paper_v1.py \
    --pdf-dir /path/to/local/pdfs

PDFs remain local and are never copied into the repository by this script.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
API_SRC = ROOT / "services" / "api" / "src"
EVAL_ROOT = ROOT / "services" / "embedding-evaluation"
MANIFEST_PATH = EVAL_ROOT / "real-paper-v1-manifest.json"
CHUNK_INVENTORY_PATH = EVAL_ROOT / "real-paper-v1-chunks.json"
INTERNAL_CHUNKS_PATH = Path("/tmp/chemdft-real-paper-v1-chunk-text.json")
PARSER_VERSION = "pypdf-5-isolated-1"
BENCHMARK_ID = "real-scientific-retrieval-v1"
PROJECT_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, f"chemdft:{BENCHMARK_ID}:project"))

sys.path.insert(0, str(API_SRC))

from chemdft_api.knowledge.chunking import (  # noqa: E402
    CHUNKER_VERSION,
    normalize_text,
    scientific_document_chunks,
)
from chemdft_api.knowledge_models import KnowledgeChunkRecord, KnowledgeItemRecord  # noqa: E402


def load_manifest() -> dict[str, Any]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def _stable_id(namespace: str, value: str) -> str:
    return str(uuid.uuid5(uuid.uuid5(uuid.NAMESPACE_URL, namespace), value))


def ingest(pdf_dir: Path) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    manifest = load_manifest()
    if manifest["status"] != "UNREVIEWED":
        raise ValueError(
            "Real-paper V1 must remain UNREVIEWED during ingestion and qrel authoring."
        )
    if manifest["parser_version"] != PARSER_VERSION:
        raise ValueError("Manifest parser version does not match the Phase 7 parser contract.")
    if manifest["chunker_version"] != CHUNKER_VERSION:
        raise ValueError("Manifest chunker version does not match the Phase 9 implementation.")

    parser_worker = API_SRC / "chemdft_api" / "pdf_parser_worker.py"
    inventory_documents: list[dict[str, Any]] = []
    internal_documents: dict[str, Any] = {}
    for paper in manifest["papers"]:
        paper["parser_version"] = PARSER_VERSION
        paper["chunker_version"] = CHUNKER_VERSION
        paper["pdf_source_url"] = paper["pdf_url"]
        paper["download_date"] = paper.get("download_date", manifest["download_date"])
        path = pdf_dir / paper["local_pdf_name"]
        pdf_bytes = path.read_bytes()
        digest = hashlib.sha256(pdf_bytes).hexdigest()
        if digest != paper["pdf_sha256"]:
            raise ValueError(f"PDF hash mismatch for {paper['benchmark_document_id']}.")
        parsed_result = subprocess.run(
            [sys.executable, str(parser_worker)],
            input=pdf_bytes,
            capture_output=True,
            check=True,
        )
        parsed = json.loads(parsed_result.stdout)
        pages = [
            {"page": item.get("page"), "page_number": item.get("page"), "text": item.get("text")}
            for item in parsed.get("pages", [])
        ]
        document_id = _stable_id(BENCHMARK_ID, f"{paper['benchmark_document_id']}|{digest}")
        document = SimpleNamespace(
            id=document_id,
            sha256=digest,
            text_json=pages,
            document_type="SCIENTIFIC_ARTICLE",
        )
        source_chunks = scientific_document_chunks(document, [])
        chunk_inventory: list[dict[str, Any]] = []
        text_records: list[dict[str, Any]] = []
        for source_index, source in enumerate(source_chunks):
            identity = json.dumps(
                {
                    "content_hash": source.content_hash,
                    "page_number": source.page_number,
                    "source_index": source_index,
                    "metadata": source.metadata or {},
                },
                sort_keys=True,
                ensure_ascii=False,
            )
            item_id = _stable_id(document_id, identity)
            chunk_id = _stable_id(item_id, "phase9-knowledge-chunk:ordinal-0")
            item = KnowledgeItemRecord(
                id=item_id,
                project_id=PROJECT_ID,
                source_type=source.source_type,
                source_entity_id=source.source_entity_id,
                source_revision=source.source_revision,
                content_hash=source.content_hash,
                document_id=source.document_id,
                page_number=source.page_number,
                anchor_id=source.anchor_id,
                evidence_id=source.evidence_id,
                source_class=source.source_class,
                verification_state=source.verification_state,
                content=source.content,
                normalized_content=normalize_text(source.content),
                chunker_version=CHUNKER_VERSION,
            )
            chunk = KnowledgeChunkRecord(
                id=chunk_id,
                project_id=item.project_id,
                knowledge_item_id=item.id,
                ordinal=0,
                content=source.content,
                content_hash=source.content_hash,
                metadata_json={
                    **(source.metadata or {}),
                    "document_id": source.document_id,
                    "page_number": source.page_number,
                    "anchor_id": source.anchor_id,
                },
            )
            chunk_inventory.append(
                {
                    "chunk_id": chunk.id,
                    "knowledge_item_id": chunk.knowledge_item_id,
                    "project_id": chunk.project_id,
                    "document_id": source.document_id,
                    "page_number": source.page_number,
                    "ordinal": chunk.ordinal,
                    "source_type": source.source_type,
                    "content_hash": chunk.content_hash,
                    "anchor_id": source.anchor_id,
                    "evidence_id": source.evidence_id,
                    "source_class": source.source_class,
                    "verification_state": source.verification_state,
                    "metadata": chunk.metadata_json,
                }
            )
            text_records.append(
                {
                    "chunk_id": chunk.id,
                    "document_id": source.document_id,
                    "page_number": source.page_number,
                    "content": chunk.content,
                }
            )
        page_count = int(parsed.get("page_count", 0))
        paper["page_count"] = page_count
        paper["chunk_count"] = len(chunk_inventory)
        paper["document_id"] = document_id
        inventory_documents.append(
            {
                "benchmark_document_id": paper["benchmark_document_id"],
                "document_id": document_id,
                "pdf_sha256": digest,
                "page_count": page_count,
                "chunk_count": len(chunk_inventory),
                "parser_version": PARSER_VERSION,
                "chunker_version": CHUNKER_VERSION,
                "chunks": chunk_inventory,
            }
        )
        internal_documents[paper["benchmark_document_id"]] = text_records

    inventory = {
        "benchmark_id": BENCHMARK_ID,
        "status": "UNREVIEWED",
        "project_id": PROJECT_ID,
        "schema": "Phase 9 KnowledgeChunkRecord",
        "documents": inventory_documents,
    }
    internal = {
        "benchmark_id": BENCHMARK_ID,
        "status": "LOCAL_AUTHORING_ONLY",
        "documents": internal_documents,
    }
    return manifest, inventory, internal


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-dir", type=Path, required=True)
    args = parser.parse_args()
    manifest, inventory, internal = ingest(args.pdf_dir)
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    CHUNK_INVENTORY_PATH.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n")
    INTERNAL_CHUNKS_PATH.write_text(json.dumps(internal, ensure_ascii=False) + "\n")
    print(
        json.dumps(
            {
                "papers": len(manifest["papers"]),
                "chunks": sum(document["chunk_count"] for document in inventory["documents"]),
                "page_counts": {
                    paper["benchmark_document_id"]: paper["page_count"]
                    for paper in manifest["papers"]
                },
                "chunk_counts": {
                    paper["benchmark_document_id"]: paper["chunk_count"]
                    for paper in manifest["papers"]
                },
                "chunk_inventory": str(CHUNK_INVENTORY_PATH.relative_to(ROOT)),
                "raw_text_output": str(INTERNAL_CHUNKS_PATH),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
