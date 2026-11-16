"""Source-type-aware locators used by evaluation review artifacts."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def validate_source_locator(locator: Mapping[str, Any]) -> None:
    kind = locator.get("kind")
    if kind == "PDF_PAGE":
        page = locator.get("page")
        if not isinstance(page, int) or isinstance(page, bool) or page < 1:
            raise ValueError("PDF_PAGE locators require a positive one-based page.")
        return
    if kind == "XML_PARAGRAPH":
        if not locator.get("section_path"):
            raise ValueError("XML_PARAGRAPH locators require a section_path.")
        for field in ("paragraph_ordinal", "chunk_ordinal"):
            value = locator.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                raise ValueError(f"XML_PARAGRAPH locators require positive {field}.")
        return
    raise ValueError(f"Unsupported source locator kind: {kind!r}.")


def resolve_xml_locator(
    document_id: str,
    locator: Mapping[str, Any],
    chunks: Sequence[Mapping[str, Any]],
) -> list[Mapping[str, Any]]:
    validate_source_locator(locator)
    if locator["kind"] != "XML_PARAGRAPH":
        raise ValueError("Only XML_PARAGRAPH locators can be resolved against XML chunks.")
    return [
        chunk
        for chunk in chunks
        if chunk.get("document_id") == document_id and chunk.get("source_locator") == locator
    ]


def validate_target_integrity(
    target: Mapping[str, Any],
    documents: Mapping[str, Mapping[str, Any]],
    chunks: Mapping[str, Mapping[str, Any]],
    *,
    evidence_excerpt: str | None = None,
) -> None:
    document_id = target.get("expected_document_id")
    chunk_id = target.get("expected_chunk_id")
    document = documents.get(document_id)
    chunk = chunks.get(chunk_id)
    if document is None or chunk is None:
        raise ValueError("QREL target references an unknown document or chunk.")
    if chunk.get("document_id") != document_id:
        raise ValueError("QREL target chunk does not belong to its document.")
    if target.get("content_sha256") != chunk.get("content_sha256"):
        raise ValueError("QREL target source-text hash does not match its chunk.")
    if target.get("source_xml_sha256") != document.get("source_xml_sha256"):
        raise ValueError("QREL target source XML hash does not match its document.")
    locator = target.get("source_locator")
    if not isinstance(locator, Mapping):
        raise TypeError("QREL targets require a source_locator mapping.")
    validate_source_locator(locator)
    if locator.get("kind") == "XML_PARAGRAPH":
        if target.get("expected_page") is not None:
            raise ValueError("XML paragraph targets must not invent a PDF page.")
        if chunk.get("source_locator") != locator:
            raise ValueError("XML locator does not resolve to the target chunk.")
    elif locator.get("kind") == "PDF_PAGE":
        if target.get("expected_page") != locator["page"]:
            raise ValueError("PDF page target and source locator disagree.")
    if evidence_excerpt:
        normalized_content = " ".join(str(chunk.get("content", "")).casefold().split())
        normalized_excerpt = " ".join(evidence_excerpt.casefold().split())
        if normalized_excerpt not in normalized_content:
            raise ValueError("Evidence excerpt does not occur in the target chunk.")
