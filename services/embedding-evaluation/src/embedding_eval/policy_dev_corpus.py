"""Build the local text companion for retrieval-policy-dev-v1 from CC-BY PMC articles."""

from __future__ import annotations

import argparse
import hashlib
import json
import urllib.request
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

BENCHMARK_ID = "retrieval-policy-dev-v1"
SOURCE_RECORDS = (
    {
        "pmcid": "PMC6538633",
        "topic": "bimetallic alloy surface catalysis",
        "license_evidence_url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6538633/",
    },
    {
        "pmcid": "PMC10934912",
        "topic": "palladium catalyst support and propane oxidation",
        "license_evidence_url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC10934912/",
    },
    {
        "pmcid": "PMC4335811",
        "topic": "chromium X-ray emission spectroscopy",
        "license_evidence_url": "https://pubs.acs.org/doi/10.1021/ic502152r",
        "verified_license": "CC-BY-4.0",
        "verified_license_url": "https://creativecommons.org/licenses/by/4.0/",
    },
    {
        "pmcid": "PMC9396622",
        "topic": "cobalt molecular hydrogenation catalysis",
        "license_evidence_url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC9396622/",
    },
    {
        "pmcid": "PMC6222785",
        "topic": "chlorometallate ionic-liquid acidity",
        "license_evidence_url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6222785/",
    },
    {
        "pmcid": "PMC12550025",
        "topic": "reaction-conditioned catalyst design",
        "license_evidence_url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC12550025/",
    },
)
EUROPE_PMC_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/{pmcid}/fullTextXML"
LICENSE_ALLOWLIST = {
    "https://creativecommons.org/licenses/by/4.0/": "CC-BY-4.0",
    "http://creativecommons.org/licenses/by/4.0/": "CC-BY-4.0",
}
MAX_WORDS = 220
OVERLAP_WORDS = 30
DEFAULT_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2] / "retrieval-policy-dev-v1-manifest.json"
)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _text(element: ET.Element) -> str:
    return " ".join(" ".join(element.itertext()).split())


def _article_text(root: ET.Element) -> list[tuple[str, str, int, str | None]]:
    body = next((element for element in root.iter() if _local(element.tag) == "body"), None)
    if body is None:
        raise ValueError("Article XML has no body text.")
    paragraphs: list[tuple[str, str, int, str | None]] = []
    paragraph_ordinal = 0

    def visit(element: ET.Element, section_path: tuple[str, ...]) -> None:
        nonlocal paragraph_ordinal
        title = next((child for child in element if _local(child.tag) == "title"), None)
        path = section_path + ((_text(title),) if title is not None and _text(title) else ())
        for child in element:
            tag = _local(child.tag)
            if tag in {"ref-list", "fig", "table-wrap", "supplementary-material", "ack"}:
                continue
            if tag == "p":
                content = _text(child)
                if content:
                    paragraph_ordinal += 1
                    xml_node_id = child.attrib.get(
                        "{http://www.w3.org/XML/1998/namespace}id"
                    ) or child.attrib.get("id")
                    paragraphs.append(
                        (" / ".join(path) or "article", content, paragraph_ordinal, xml_node_id)
                    )
            elif tag == "sec":
                visit(child, path)

    visit(body, ())
    if not paragraphs:
        raise ValueError("Article XML contained no eligible body paragraphs.")
    return paragraphs


def _split_words(content: str) -> list[str]:
    words = content.split()
    if len(words) <= MAX_WORDS:
        return [content]
    output: list[str] = []
    start = 0
    while start < len(words):
        end = min(start + MAX_WORDS, len(words))
        output.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start = end - OVERLAP_WORDS
    return output


def _find_text(root: ET.Element, local_tag: str) -> str | None:
    for element in root.iter():
        if _local(element.tag) == local_tag:
            value = _text(element)
            if value:
                return value
    return None


def _license_details(
    root: ET.Element, source: dict[str, str] | None = None
) -> tuple[str, str] | None:
    if source and source.get("verified_license") == "CC-BY-4.0":
        verified_url = source.get("verified_license_url")
        if verified_url in LICENSE_ALLOWLIST:
            return "CC-BY-4.0", verified_url
    for element in root.iter():
        if _local(element.tag) == "license":
            for child in element.iter():
                for name, value in child.attrib.items():
                    if _local(name) == "href" and "creativecommons.org/licenses/by/" in value:
                        license_url = value.rstrip(".")
                        license_name = LICENSE_ALLOWLIST.get(license_url)
                        if license_name:
                            return license_name, license_url
    return None


def build_local_corpus(
    *,
    output_path: Path,
    manifest_path: Path | None = DEFAULT_MANIFEST_PATH,
    sources: tuple[dict[str, str], ...] = SOURCE_RECORDS,
) -> dict[str, Any]:
    """Download, verify CC-BY metadata, and write a non-versioned local text companion."""
    documents: list[dict[str, Any]] = []
    chunk_records: list[dict[str, Any]] = []
    for source in sources:
        pmcid = source["pmcid"]
        request = urllib.request.Request(
            EUROPE_PMC_URL.format(pmcid=pmcid),
            headers={"User-Agent": "ChemDFT-retrieval-policy-eval/1.0"},
        )
        with urllib.request.urlopen(request, timeout=45) as response:
            xml_bytes = response.read()
        root = ET.fromstring(xml_bytes)
        license_details = _license_details(root, source)
        if license_details is None:
            raise ValueError(f"{pmcid} does not have a confirmed attribution-only license.")
        license_name, license_url = license_details
        article_ids = {
            element.attrib.get("pub-id-type"): _text(element)
            for element in root.iter()
            if _local(element.tag) == "article-id"
        }
        title = _find_text(root, "article-title")
        doi = article_ids.get("doi")
        if not title or not doi:
            raise ValueError(f"{pmcid} is missing its article title or DOI metadata.")
        paragraphs = _article_text(root)
        document_id = pmcid.lower()
        paper_record = {
            "document_id": document_id,
            "pmcid": pmcid,
            "title": title,
            "doi": doi,
            "topic": source["topic"],
            "source_url": f"https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/",
            "full_text_url": EUROPE_PMC_URL.format(pmcid=pmcid),
            "license": license_name,
            "license_url": license_url,
            "license_evidence_url": source["license_evidence_url"],
            "source_xml_sha256": hashlib.sha256(xml_bytes).hexdigest(),
            "paragraph_count": len(paragraphs),
            "chunk_ids": [],
        }
        paragraph_index = 0
        for section, paragraph, paragraph_ordinal, xml_node_id in paragraphs:
            for piece_ordinal, piece in enumerate(_split_words(paragraph), start=1):
                paragraph_index += 1
                content_hash = hashlib.sha256(piece.encode("utf-8")).hexdigest()
                chunk_id = f"{document_id}-p{paragraph_index:05d}-{content_hash[:12]}"
                record = {
                    "chunk_id": chunk_id,
                    "document_id": document_id,
                    "section": section,
                    "source_locator": {
                        "kind": "XML_PARAGRAPH",
                        "section_path": section,
                        "paragraph_ordinal": paragraph_ordinal,
                        "chunk_ordinal": piece_ordinal,
                        "xml_node_id": xml_node_id,
                    },
                    "content": piece,
                    "content_sha256": content_hash,
                    "word_count": len(piece.split()),
                }
                chunk_records.append(record)
                paper_record["chunk_ids"].append(chunk_id)
        paper_record["chunk_count"] = len(paper_record["chunk_ids"])
        documents.append(paper_record)

    payload = {
        "benchmark_id": BENCHMARK_ID,
        "status": "LOCAL_AUTHORING_ONLY",
        "source_count": len(documents),
        "chunk_count": len(chunk_records),
        "built_at": datetime.now(UTC).isoformat(),
        "documents": documents,
        "chunks": chunk_records,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    if manifest_path is not None:
        public_manifest = {
            "benchmark_id": BENCHMARK_ID,
            "status": "CORPUS_LABELS_UNREVIEWED",
            "corpus_source_count": len(documents),
            "chunk_count": len(chunk_records),
            "chunker": {"max_words": MAX_WORDS, "overlap_words": OVERLAP_WORDS},
            "documents": [
                {key: value for key, value in document.items() if key != "chunk_ids"}
                for document in documents
            ],
            "chunks": [
                {key: value for key, value in record.items() if key != "content"}
                for record in chunk_records
            ],
        }
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(public_manifest, ensure_ascii=False, indent=2) + "\n")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("/tmp/chemdft-retrieval-policy-dev-v1-corpus.json"),
        help="Local-only path for extracted CC-BY body text; do not commit this file.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST_PATH,
        help="Repository-safe source metadata and content-hash inventory output.",
    )
    args = parser.parse_args()
    payload = build_local_corpus(output_path=args.output, manifest_path=args.manifest)
    print(
        json.dumps(
            {
                "benchmark_id": payload["benchmark_id"],
                "sources": payload["source_count"],
                "chunks": payload["chunk_count"],
                "output": str(args.output),
                "manifest": str(args.manifest),
            }
        )
    )


if __name__ == "__main__":
    main()
