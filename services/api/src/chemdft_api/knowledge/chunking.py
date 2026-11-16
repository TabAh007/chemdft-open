from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any

from ..scientific_evidence import format_scientific_evidence

CHUNKER_VERSION = "deterministic-scientific-v2"


@dataclass(frozen=True, slots=True)
class SourceChunk:
    source_type: str
    source_entity_id: str
    source_revision: str | None
    content: str
    document_id: str | None = None
    page_number: int | None = None
    anchor_id: str | None = None
    evidence_id: str | None = None
    source_class: str | None = None
    verification_state: str | None = None
    metadata: dict[str, Any] | None = None

    @property
    def content_hash(self) -> str:
        identity = "|".join(
            [
                self.source_type,
                self.source_entity_id,
                self.source_revision or "",
                str(self.page_number or ""),
                self.content,
                CHUNKER_VERSION,
            ]
        )
        return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def normalize_text(value: str) -> str:
    value = value.replace("Å", "angstrom").replace("Å", "angstrom").replace("å", "angstrom")
    value = value.replace("\N{EN DASH}", "-").replace("\N{EM DASH}", "-")
    value = re.sub(r"(?<=\d),(?=\d)", ".", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value.casefold()


def scientific_document_chunks(document: Any, candidates: list[Any]) -> list[SourceChunk]:
    chunks: list[SourceChunk] = []
    for page in document.text_json or []:
        text = str(page.get("text") or "").strip()
        if not text:
            continue
        page_number = int(page.get("page_number") or page.get("page") or 1)
        paragraphs = [
            part.strip() for part in re.split(r"\n{2,}|(?<=[.!?])\s{2,}", text) if part.strip()
        ]
        for ordinal, paragraph in enumerate(paragraphs):
            chunks.append(
                SourceChunk(
                    source_type="DOCUMENT_TEXT",
                    source_entity_id=str(document.id),
                    source_revision=document.sha256,
                    content=paragraph[:8000],
                    document_id=str(document.id),
                    page_number=page_number,
                    source_class="EXTRACTED",
                    verification_state="UNVERIFIED",
                    metadata={"paragraph": ordinal, "document_type": document.document_type},
                )
            )
    for candidate in candidates:
        payload = candidate.payload_json or {}
        raw = str(payload.get("raw_text") or payload.get("value") or "").strip()
        if not raw:
            raw = format_scientific_evidence(payload)
        if not raw.strip():
            continue
        anchor = getattr(candidate, "anchor", None)
        chunks.append(
            SourceChunk(
                source_type="DOCUMENT_EVIDENCE",
                source_entity_id=str(candidate.id),
                source_revision=document.sha256,
                content=raw[:8000],
                document_id=str(document.id),
                page_number=getattr(anchor, "page_number", None),
                anchor_id=getattr(anchor, "id", None),
                evidence_id=str(candidate.id),
                source_class=str(candidate.source_class),
                verification_state=str(candidate.review_state),
                metadata={"evidence_type": candidate.evidence_type},
            )
        )
    return chunks
