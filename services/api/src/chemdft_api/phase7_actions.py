from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
import subprocess
import sys
from datetime import UTC, datetime
from typing import BinaryIO
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .actions import authorize_project_access, register_raw_file
from .config import Settings
from .context import Identity
from .contracts.artifacts import ScientificArtifactKind, ScientificArtifactRegistration
from .contracts.base import ArtifactReference
from .contracts.catalog import StructureImportInput
from .contracts.phase7 import (
    DigitizedDatasetInput,
    DocumentSourceType,
    EvidenceCandidate,
    EvidenceReviewInput,
    EvidenceReviewOutput,
    EvidenceReviewState,
    ExperimentalDatasetListOutput,
    ExperimentalDatasetView,
    ExperimentalImportInput,
    GraphAxisCalibration,
    GraphDigitizationSession,
    GraphDigitizedDatasetInput,
    GraphDigitizedPoint,
    ScientificDocument,
    ScientificDocumentImportOutput,
    ScientificDocumentListOutput,
    SourceAnchor,
    SourcePixelPoint,
    XrdAxisCalibration,
    XrdDigitizationSession,
    XrdDigitizedDatasetInput,
    XrdDigitizedPoint,
    XrdReportedPeak,
)
from .contracts.provenance import ProvenanceClass
from .contracts.scientific import (
    DatasetProcessingState,
    ExperimentModality,
    QuantityDimension,
    UnitReference,
    UnitStandard,
)
from .errors import (
    ArtifactHashMismatch,
    ProjectAccessDenied,
    ScientificReferenceNotFound,
    ScientificValidationFailed,
)
from .models import StoredFile, new_id
from .project_access import ProjectCapability, can
from .scientific_actions import import_structure, register_scientific_artifact
from .scientific_models import (
    DocumentSourceAnchorRecord,
    EvidenceCandidateRecord,
    EvidenceReviewRecord,
    ExperimentalDatasetRecord,
    ExperimentRecord,
    ScientificArtifactRecord,
    ScientificDocumentRecord,
)
from .storage import ObjectStore

MAX_PDF_PAGES = 500
MAX_PDF_TEXT_BYTES = 20 * 1024 * 1024
PDF_PARSER_VERSION = "pypdf-5-isolated-1"
DIGITIZER_VERSION = "manual-calibration-1"


def _artifact_ref(record: ScientificArtifactRecord) -> ArtifactReference:
    return ArtifactReference(
        project_id=UUID(record.project_id), artifact_id=UUID(record.id), sha256=record.sha256
    )


def _run_pdf_parser(data: bytes, settings: Settings) -> dict[str, object]:
    if len(data) > settings.max_upload_bytes:
        raise ScientificValidationFailed("PDF exceeds the configured upload limit.")
    try:
        completed = subprocess.run(
            [sys.executable, "-m", "chemdft_api.pdf_parser_worker"],
            input=data,
            capture_output=True,
            timeout=settings.pdf_parse_timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise ScientificValidationFailed("PDF parser timed out.") from error
    if completed.returncode != 0:
        raise ScientificValidationFailed("PDF_PARSE_FAILED")
    if len(completed.stdout) > MAX_PDF_TEXT_BYTES:
        raise ScientificValidationFailed("PDF extracted text exceeds the configured bound.")
    try:
        parsed = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ScientificValidationFailed("PDF parser returned invalid output.") from error
    if int(parsed.get("page_count", 0)) > MAX_PDF_PAGES:
        raise ScientificValidationFailed("PAGE_LIMIT_EXCEEDED")
    return parsed


def _fit(value: str | None, limit: int) -> str | None:
    """Clamp PDF-supplied text to its column width and drop NUL characters.

    PDF metadata is untrusted and can be arbitrarily long; PostgreSQL enforces varchar lengths and
    rejects NUL, so an unclamped value passes SQLite tests but fails the real import with a 500.
    """
    if value is None:
        return None
    cleaned = value.replace("\x00", "").strip()
    return cleaned[:limit] or None


def _metadata(parsed: dict[str, object], pages: list[dict[str, object]]) -> dict[str, object]:
    raw = parsed.get("metadata") if isinstance(parsed.get("metadata"), dict) else {}
    metadata = {str(key).lower(): str(value) for key, value in (raw or {}).items()}
    all_text = "\n".join(str(page.get("text", "")) for page in pages)
    metadata_title = metadata.get("title")
    title = (
        metadata_title if _valid_article_title(metadata_title) else _extract_article_title(pages)
    )
    doi_match = re.search(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", all_text, re.I)
    year_match = re.search(r"\b(19\d{2}|20\d{2})\b", all_text)
    return {
        "title": _fit(title, 500),
        "doi": _fit(doi_match.group(0) if doi_match else metadata.get("doi"), 240),
        "authors": tuple(
            item.strip() for item in metadata.get("author", "").split(",") if item.strip()
        ),
        "journal": _fit(metadata.get("subject") or metadata.get("journal"), 240),
        "publication_year": int(year_match.group(0)) if year_match else None,
        "language": None,
    }


def _valid_article_title(value: str | None) -> bool:
    if not value or len(value.strip()) < 8:
        return False
    title = value.strip()
    return not bool(
        re.match(
            r"(?i)^(?:u[dkc]|у[дд]к|doi\s*:|10\.\d{4,9}/|\d{1,4}\s*$|"  # noqa: RUF001
            r"scientific article|original article|research article|научная статья)$",
            title,
        )
    ) and not bool(
        re.search(
            r"(?i)\b(?:u[dkc]|удк)\s*\d|10\.\d{4,9}/|\bISSN\b|\bISBN\b|\b\d{4}-\d{3}[\dX]\b",
            title,
        )
    )  # running headers such as "ISSN: print - 1726-4685 ... UDC 547" are not titles (F-021)


def _extract_article_title(pages: list[dict[str, object]]) -> str | None:
    if not pages:
        return None
    lines = [line.strip() for line in str(pages[0].get("text", "")).splitlines()]
    marker = next(
        (
            index
            for index, line in enumerate(lines)
            if re.search(r"(?i)\bdoi\s*:|10\.\d{4,9}/", line)
        ),
        -1,
    )
    if marker < 0:
        marker = next(
            (
                index
                for index, line in enumerate(lines)
                if re.match(
                    r"(?i)^(?:original article|scientific article|research article|научная статья)$",  # noqa: E501
                    line,
                )
            ),
            -1,
        )
    candidates = lines[marker + 1 :] if marker >= 0 else lines
    title_lines: list[str] = []
    for line in candidates:
        if not line:
            if title_lines:
                continue
            continue
        if re.match(
            r"(?i)^(?:u[dkc]|удк|doi\s*:|10\.\d{4,9}/|original article|"
            r"scientific article|research article|научная статья|\d{1,4}\s*$|"
            r"[\w.+-]+@[\w.-]+)$",
            line,
        ) or re.search(r"(?i)\b(?:удк|u[dkc])\s*\d|10\.\d{4,9}/", line):
            continue
        if title_lines and (
            re.search(
                r"(?i)\b(?:al\.?|et al\.?|authors?|abstract|аннотация|ключевые слова)\b", line
            )
            or re.search(r"\d+\s*,\s*\d+", line)
        ):
            break
        if len(line) < 12:
            if title_lines:
                break
            continue
        title_lines.append(line)
        if len(title_lines) == 2:
            break
    title = " ".join(title_lines).strip()
    return title[:500] if _valid_article_title(title) else None


def _figure_evidence_type(caption: str) -> str:
    lowered = caption.lower()
    if re.search(r"\b(xrd|diffraction|2\s*theta|2θ|diffractogram)\b", lowered):
        return "XRD_FIGURE"
    if re.search(r"\b(tg|dtg|dta|thermograv|thermal)\b", lowered):
        return "TG_DTG_DTA_FIGURE"
    if re.search(r"\b(dls|dynamic light scattering|hydrodynamic|particle size)\b", lowered):
        return "DLS_FIGURE"
    if re.search(
        r"\b(structure|molecular structure|crystal structure|scheme)\b|"
        r"структур|строени|кристаллографическ",
        lowered,
    ):
        return "STRUCTURE_FIGURE_CANDIDATE"
    return "FIGURE"


def _reported_values(text: str) -> list[dict[str, object]]:
    values: list[dict[str, object]] = []
    p_token = r"(?:[abc\u0430\u0441]|alpha|beta|gamma|\u03b1|\u03b2|\u03b3)"
    for match in re.finditer(
        r"(?i)\b("
        + p_token
        + r"(?:\s*[=≈~]\s*"
        + p_token
        + r")*)\s*[=≈~]\s*([0-9]+(?:[.,][0-9]+)?)\s*(\u212b|\u00c5|Å|A|nm|deg|degree|\u00b0|°)?",
        text,
    ):
        chain_str = match.group(1)
        raw_val = match.group(2).replace(",", ".")
        val = float(raw_val)
        unit = match.group(3)
        tokens = re.split(r"\s*[=≈~]\s*", chain_str)
        for token in tokens:
            name = (
                token.strip()
                .lower()
                .replace("\u0430", "a")
                .replace("\u0441", "c")
                .replace("\u03b1", "alpha")
                .replace("\u03b2", "beta")
                .replace("\u03b3", "gamma")
            )
            reported_unit = unit or ("degree" if name in {"alpha", "beta", "gamma"} else "angstrom")
            values.append(
                {
                    "parameter": name,
                    "reported_value": val,
                    "reported_unit": reported_unit,
                    "snippet": match.group(0),
                }
            )
    for match in re.finditer(
        r"(?i)\b([0-9]+(?:[.,][0-9]+)?)\s*(?:°|deg)?\s*[\(（]?\s*"  # noqa: RUF001
        r"(?:2\s*theta|2θ)\s*[\)）]?|\b(?:2\s*theta|2θ)\s*(?:=|:)?\s*"  # noqa: RUF001
        r"([0-9]+(?:[.,][0-9]+)?)",
        text,
    ):
        raw = match.group(1) or match.group(2)
        if raw:
            values.append(
                {
                    "quantity": "2theta",
                    "reported_value": float(raw.replace(",", ".")),
                    "reported_unit": "degree",
                    "snippet": match.group(0),
                }
            )
    return values


def _anchor(
    session: Session,
    *,
    project_id: str,
    document_id: str,
    page: int,
    source_type: DocumentSourceType,
    snippet: str | None = None,
    caption: str | None = None,
    figure_number: str | None = None,
    table_number: str | None = None,
) -> DocumentSourceAnchorRecord:
    record = DocumentSourceAnchorRecord(
        project_id=project_id,
        document_id=document_id,
        page_number=page,
        source_type=source_type,
        x=0.0,
        y=0.0,
        width=1.0,
        height=1.0,
        snippet=snippet[:4000] if snippet else None,
        caption=caption[:1000] if caption else None,
        figure_number=figure_number,
        table_number=table_number,
    )
    session.add(record)
    session.flush()
    return record


def _candidate(
    record: EvidenceCandidateRecord, anchor: DocumentSourceAnchorRecord | None
) -> EvidenceCandidate:
    anchor_contract = None
    if anchor:
        anchor_contract = SourceAnchor(
            document_id=UUID(anchor.document_id),
            page_number=anchor.page_number,
            source_type=anchor.source_type,
            x=anchor.x,
            y=anchor.y,
            width=anchor.width,
            height=anchor.height,
            caption=anchor.caption,
            figure_number=anchor.figure_number,
            table_number=anchor.table_number,
            snippet=anchor.snippet,
        )
    return EvidenceCandidate(
        id=UUID(record.id),
        project_id=UUID(record.project_id),
        document_id=UUID(record.document_id),
        evidence_type=record.evidence_type,
        source_class=record.source_class,
        structured_payload=record.payload_json,
        source_anchor=anchor_contract,
        extraction_method=record.extraction_method,
        extractor_version=record.extractor_version,
        diagnostics=tuple(record.diagnostics_json),
        review_state=record.review_state,
        created_at=record.created_at,
    )


def _document(
    record: ScientificDocumentRecord, artifact: ScientificArtifactRecord
) -> ScientificDocument:
    return ScientificDocument(
        id=UUID(record.id),
        project_id=UUID(record.project_id),
        raw_artifact=_artifact_ref(artifact),
        sha256=record.sha256,
        media_type=record.media_type,
        title=(
            record.title
            if _valid_article_title(record.title)
            else _extract_article_title(record.text_json)
        ),
        doi=record.doi,
        authors=tuple(record.authors_json),
        journal=record.journal,
        publication_year=record.publication_year,
        language=record.language,
        page_count=record.page_count,
        document_type=record.document_type,
        parser_identifier=record.parser_identifier,
        parser_version=record.parser_version,
        diagnostics=tuple(record.diagnostics_json),
        created_by=UUID(record.created_by),
        created_at=record.created_at,
    )


def import_scientific_document(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    *,
    project_id: str,
    original_name: str | None,
    media_type: str | None,
    stream: BinaryIO,
) -> ScientificDocumentImportOutput:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    stored = register_raw_file(
        session,
        identity,
        object_store,
        project_id,
        original_name,
        media_type or "application/pdf",
        stream,
        settings.max_upload_bytes,
        settings=settings,
    )
    existing = session.scalar(
        select(ScientificDocumentRecord).where(
            ScientificDocumentRecord.project_id == project.id,
            ScientificDocumentRecord.sha256 == stored.sha256,
        )
    )
    if existing:
        artifact_row = session.get(ScientificArtifactRecord, existing.raw_artifact_id)
        if artifact_row is None:
            raise ScientificReferenceNotFound()
        duplicate_file = session.get(StoredFile, stored.id)
        if duplicate_file is not None:
            object_store.delete(duplicate_file.object_key)
            session.delete(duplicate_file)
            session.commit()
        from .structure_candidate_actions import ensure_document_structure_candidates

        ensure_document_structure_candidates(session, identity, project.id, existing.id)
        session.commit()
        rows = session.scalars(
            select(EvidenceCandidateRecord).where(
                EvidenceCandidateRecord.project_id == project.id,
                EvidenceCandidateRecord.document_id == existing.id,
            )
        ).all()
        return ScientificDocumentImportOutput(
            document=_document(existing, artifact_row),
            candidates=tuple(
                _candidate(row, session.get(DocumentSourceAnchorRecord, row.anchor_id))
                for row in rows
            ),
        )
    artifact = register_scientific_artifact(
        session,
        identity,
        ScientificArtifactRegistration(
            project_id=UUID(project.id),
            stored_file_id=UUID(stored.id),
            kind=ScientificArtifactKind.REPORT,
            format_identifier="PDF",
        ),
    )
    source = session.get(ScientificArtifactRecord, str(artifact.id))
    if source is None:
        raise ScientificReferenceNotFound()
    parsed = _run_pdf_parser(
        object_store.get_bytes(source.storage_key, settings.max_upload_bytes), settings
    )
    pages = list(parsed.get("pages", []))
    info = _metadata(parsed, pages)
    document_diagnostics = (
        []
        if any(str(page.get("text", "")).strip() for page in pages)
        else [
            {
                "code": "OCR_REQUIRED",
                "message": "No usable text layer was found; OCR is required.",
            }
        ]
    )
    document = ScientificDocumentRecord(
        project_id=project.id,
        raw_artifact_id=source.id,
        sha256=source.sha256,
        media_type=source.media_type,
        title=info["title"],
        doi=info["doi"],
        authors_json=list(info["authors"]),
        journal=info["journal"],
        publication_year=info["publication_year"],
        language=info["language"],
        page_count=int(parsed.get("page_count", 0)),
        document_type="SCIENTIFIC_ARTICLE",
        parser_identifier="pypdf",
        parser_version=PDF_PARSER_VERSION,
        text_json=pages,
        diagnostics_json=document_diagnostics,
        created_by=identity.user_id,
    )
    session.add(document)
    session.flush()
    for page in pages:
        page_number = int(page.get("page", 1))
        text = str(page.get("text", ""))
        if text:
            anchor = _anchor(
                session,
                project_id=project.id,
                document_id=document.id,
                page=page_number,
                source_type=DocumentSourceType.TEXT,
                snippet=text[:4000],
            )
            session.add(
                EvidenceCandidateRecord(
                    project_id=project.id,
                    document_id=document.id,
                    evidence_type="DOCUMENT_TEXT",
                    source_class=ProvenanceClass.EXTRACTED,
                    payload_json={"text": text[:4000]},
                    anchor_id=anchor.id,
                    extraction_method="text-layer",
                    extractor_version=PDF_PARSER_VERSION,
                    diagnostics_json=[],
                    review_state=EvidenceReviewState.DETECTED,
                )
            )
        for match in re.finditer(r"(?i)(figure|fig\.|рис\.)\s*([0-9]+)[.:\s-]*(.{0,240})", text):
            caption = match.group(3).strip()
            evidence_type = _figure_evidence_type(caption)
            anchor = _anchor(
                session,
                project_id=project.id,
                document_id=document.id,
                page=page_number,
                source_type=DocumentSourceType.FIGURE,
                snippet=match.group(0),
                caption=caption,
                figure_number=match.group(2),
            )
            session.add(
                EvidenceCandidateRecord(
                    project_id=project.id,
                    document_id=document.id,
                    evidence_type=evidence_type,
                    source_class=ProvenanceClass.EXTRACTED,
                    payload_json={
                        "figure_number": match.group(2),
                        "caption": caption,
                        "classification": evidence_type,
                        "authoritative_structure_version_created": False,
                    },
                    anchor_id=anchor.id,
                    extraction_method="caption-detector",
                    extractor_version=PDF_PARSER_VERSION,
                    diagnostics_json=[],
                    review_state=EvidenceReviewState.DETECTED,
                )
            )
        for reported in _reported_values(text):
            anchor = _anchor(
                session,
                project_id=project.id,
                document_id=document.id,
                page=page_number,
                source_type=DocumentSourceType.TEXT,
                snippet=str(reported.pop("snippet", "")),
            )
            session.add(
                EvidenceCandidateRecord(
                    project_id=project.id,
                    document_id=document.id,
                    evidence_type="REPORTED_NUMERIC_VALUE",
                    source_class=ProvenanceClass.EXTRACTED,
                    payload_json=reported,
                    anchor_id=anchor.id,
                    extraction_method="reported-value-regex",
                    extractor_version=PDF_PARSER_VERSION,
                    diagnostics_json=[],
                    review_state=EvidenceReviewState.DETECTED,
                )
            )
        cell_token = r"(?:[abc\u0430\u0441])"
        for match in re.finditer(
            r"(?i)\b("
            + cell_token
            + r"(?:\s*[=≈~]\s*"
            + cell_token
            + r")*)\s*[=≈~]\s*([0-9]+(?:[.,][0-9]+)?)\s*(\u212b|\u00c5|Å|A|nm)",
            text,
        ):
            chain_str = match.group(1)
            raw_val = match.group(2).replace(",", ".")
            val = float(raw_val)
            unit = match.group(3)
            tokens = re.split(r"\s*[=≈~]\s*", chain_str)
            for token in tokens:
                param = token.strip().lower().replace("\u0430", "a").replace("\u0441", "c")
                anchor = _anchor(
                    session,
                    project_id=project.id,
                    document_id=document.id,
                    page=page_number,
                    source_type=DocumentSourceType.TEXT,
                    snippet=match.group(0),
                )
                session.add(
                    EvidenceCandidateRecord(
                        project_id=project.id,
                        document_id=document.id,
                        evidence_type="REPORTED_CELL_PARAMETER",
                        source_class=ProvenanceClass.EXTRACTED,
                        payload_json={
                            "parameter": param,
                            "reported_value": val,
                            "reported_unit": unit,
                        },
                        anchor_id=anchor.id,
                        extraction_method="cell-parameter-regex",
                        extractor_version=PDF_PARSER_VERSION,
                        diagnostics_json=[],
                        review_state=EvidenceReviewState.DETECTED,
                    )
                )
        if re.search(r"(?i)\b(xrd|diffraction|2\s*theta|2θ)\b", text):
            anchor = _anchor(
                session,
                project_id=project.id,
                document_id=document.id,
                page=page_number,
                source_type=DocumentSourceType.TEXT,
                snippet=text[:1000],
            )
            session.add(
                EvidenceCandidateRecord(
                    project_id=project.id,
                    document_id=document.id,
                    evidence_type="XRD_EVIDENCE",
                    source_class=ProvenanceClass.EXTRACTED,
                    payload_json={"reported_text": text[:1000]},
                    anchor_id=anchor.id,
                    extraction_method="modality-keyword-detector",
                    extractor_version=PDF_PARSER_VERSION,
                    diagnostics_json=[],
                    review_state=EvidenceReviewState.DETECTED,
                )
            )
        if re.search(r"(?i)\b(tg|dtg|dta|thermal analysis)\b", text):
            anchor = _anchor(
                session,
                project_id=project.id,
                document_id=document.id,
                page=page_number,
                source_type=DocumentSourceType.TEXT,
                snippet=text[:1000],
            )
            session.add(
                EvidenceCandidateRecord(
                    project_id=project.id,
                    document_id=document.id,
                    evidence_type="THERMAL_EVIDENCE",
                    source_class=ProvenanceClass.EXTRACTED,
                    payload_json={"reported_text": text[:1000]},
                    anchor_id=anchor.id,
                    extraction_method="modality-keyword-detector",
                    extractor_version=PDF_PARSER_VERSION,
                    diagnostics_json=[],
                    review_state=EvidenceReviewState.DETECTED,
                )
            )
        if re.search(r"(?i)\b(dls|hydrodynamic diameter|particle size)\b", text):
            anchor = _anchor(
                session,
                project_id=project.id,
                document_id=document.id,
                page=page_number,
                source_type=DocumentSourceType.TEXT,
                snippet=text[:1000],
            )
            session.add(
                EvidenceCandidateRecord(
                    project_id=project.id,
                    document_id=document.id,
                    evidence_type="DLS_EVIDENCE",
                    source_class=ProvenanceClass.EXTRACTED,
                    payload_json={"reported_text": text[:1000]},
                    anchor_id=anchor.id,
                    extraction_method="modality-keyword-detector",
                    extractor_version=PDF_PARSER_VERSION,
                    diagnostics_json=[],
                    review_state=EvidenceReviewState.DETECTED,
                )
            )
    session.flush()
    from .structure_candidate_actions import ensure_document_structure_candidates

    ensure_document_structure_candidates(session, identity, project.id, document.id)
    session.commit()
    # Search indexing is durable and asynchronous; the document import never
    # performs embedding generation on the request path.
    from .knowledge.service import KnowledgeService

    KnowledgeService(session, identity).enqueue_reindex(project.id)
    artifact_row = session.get(ScientificArtifactRecord, str(artifact.id))
    rows = session.scalars(
        select(EvidenceCandidateRecord).where(
            EvidenceCandidateRecord.project_id == project.id,
            EvidenceCandidateRecord.document_id == document.id,
        )
    ).all()
    return ScientificDocumentImportOutput(
        document=_document(document, artifact_row),
        candidates=tuple(
            _candidate(row, session.get(DocumentSourceAnchorRecord, row.anchor_id)) for row in rows
        ),
    )


def list_documents(
    session: Session, identity: Identity, project_id: str
) -> ScientificDocumentListOutput:
    project, _ = authorize_project_access(session, identity, project_id)
    rows = session.scalars(
        select(ScientificDocumentRecord)
        .where(ScientificDocumentRecord.project_id == project.id)
        .order_by(ScientificDocumentRecord.created_at.desc())
    ).all()
    documents = []
    for row in rows:
        artifact = session.get(ScientificArtifactRecord, row.raw_artifact_id)
        if artifact:
            documents.append(_document(row, artifact))
    return ScientificDocumentListOutput(documents=tuple(documents))


def get_document(
    session: Session, identity: Identity, project_id: str, document_id: str
) -> ScientificDocumentImportOutput:
    project, _ = authorize_project_access(session, identity, project_id)
    row = session.scalar(
        select(ScientificDocumentRecord).where(
            ScientificDocumentRecord.id == document_id,
            ScientificDocumentRecord.project_id == project.id,
        )
    )
    if row is None:
        raise ScientificReferenceNotFound("Scientific document does not exist.")
    artifact = session.get(ScientificArtifactRecord, row.raw_artifact_id)
    if artifact is None:
        raise ScientificReferenceNotFound("Document artifact does not exist.")
    candidates = session.scalars(
        select(EvidenceCandidateRecord).where(
            EvidenceCandidateRecord.project_id == project.id,
            EvidenceCandidateRecord.document_id == row.id,
        )
    ).all()
    return ScientificDocumentImportOutput(
        document=_document(row, artifact),
        candidates=tuple(
            _candidate(item, session.get(DocumentSourceAnchorRecord, item.anchor_id))
            for item in candidates
        ),
    )


def download_document_source(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    *,
    project_id: str,
    document_id: str,
) -> tuple[str, str, bytes]:
    project, _ = authorize_project_access(session, identity, project_id)
    row = session.scalar(
        select(ScientificDocumentRecord).where(
            ScientificDocumentRecord.id == document_id,
            ScientificDocumentRecord.project_id == project.id,
        )
    )
    if row is None:
        raise ScientificReferenceNotFound("Scientific document does not exist.")
    artifact = session.get(ScientificArtifactRecord, row.raw_artifact_id)
    if artifact is None or artifact.project_id != project.id:
        raise ScientificReferenceNotFound("Document artifact does not exist.")
    payload = object_store.get_bytes(artifact.storage_key, settings.max_upload_bytes)
    if hashlib.sha256(payload).hexdigest() != artifact.sha256:
        raise ArtifactHashMismatch("Document source bytes do not match immutable metadata.")
    suffix = ".pdf" if artifact.media_type == "application/pdf" else ""
    return f"document-{row.id}{suffix}", artifact.media_type, payload


def review_evidence(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    payload: EvidenceReviewInput,
) -> EvidenceReviewOutput:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    candidate = session.scalar(
        select(EvidenceCandidateRecord).where(
            EvidenceCandidateRecord.id == candidate_id,
            EvidenceCandidateRecord.project_id == project.id,
        )
    )
    if candidate is None:
        raise ScientificReferenceNotFound("Evidence candidate does not exist.")
    candidate.review_state = payload.decision
    session.add(
        EvidenceReviewRecord(
            project_id=project.id,
            candidate_id=candidate.id,
            decision=payload.decision,
            normalized_payload_json=payload.normalized_payload,
            reason=payload.reason,
            actor_id=identity.user_id,
        )
    )
    session.commit()
    anchor = (
        session.get(DocumentSourceAnchorRecord, candidate.anchor_id)
        if candidate.anchor_id
        else None
    )
    return EvidenceReviewOutput(
        candidate=_candidate(candidate, anchor),
        source_class=ProvenanceClass(candidate.source_class),
        verification_state="VERIFIED" if payload.decision == "ACCEPTED" else "DISPUTED",
    )


def create_digitized_dataset(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    payload: DigitizedDatasetInput,
) -> ExperimentalDatasetView:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    candidate = session.scalar(
        select(EvidenceCandidateRecord).where(
            EvidenceCandidateRecord.id == candidate_id,
            EvidenceCandidateRecord.project_id == project.id,
        )
    )
    if candidate is None or candidate.anchor_id is None:
        raise ScientificReferenceNotFound("Evidence candidate does not exist.")
    anchor = session.get(DocumentSourceAnchorRecord, candidate.anchor_id)
    if anchor is None:
        raise ScientificReferenceNotFound("Evidence source anchor does not exist.")
    document = session.scalar(
        select(ScientificDocumentRecord).where(
            ScientificDocumentRecord.id == candidate.document_id,
            ScientificDocumentRecord.project_id == project.id,
        )
    )
    if document is None:
        raise ScientificReferenceNotFound("Scientific document does not exist.")
    artifact = session.get(ScientificArtifactRecord, document.raw_artifact_id)
    if artifact is None or artifact.project_id != project.id:
        raise ScientificReferenceNotFound("Document artifact does not exist.")
    values = [{"x": point.x, "y": point.y} for point in payload.points]
    if any(not math.isfinite(value) for row in values for value in row.values()):
        raise ScientificValidationFailed("Digitized dataset contains NaN or Infinity.")
    experiment = ExperimentRecord(
        project_id=project.id,
        name=payload.experiment_name,
        modality=payload.modality.value,
        created_by=identity.user_id,
    )
    session.add(experiment)
    session.flush()
    dataset = ExperimentalDatasetRecord(
        project_id=project.id,
        experiment_id=experiment.id,
        state=DatasetProcessingState.DERIVED.value,
        artifact_id=artifact.id,
        source_class=ProvenanceClass.DIGITIZED.value,
        axes_json=[
            {
                "label": payload.calibration.x_label,
                "unit": _unit(
                    payload.calibration.x_unit,
                    QuantityDimension.OTHER_DECLARED,
                ).model_dump(mode="json"),
                "direction": "ASCENDING",
            },
            {
                "label": payload.calibration.y_label,
                "unit": _unit(
                    payload.calibration.y_unit,
                    QuantityDimension.OTHER_DECLARED,
                ).model_dump(mode="json"),
                "direction": "ASCENDING",
            },
        ],
        values_json=values,
        point_count=len(values),
        processing_json=[
            {
                "method": "manual_graph_digitization",
                "digitizer_version": DIGITIZER_VERSION,
                "approximation": "APPROXIMATE",
                "point_generation_method": "MANUAL_POINT_CAPTURE",
                "source_document_id": document.id,
                "source_document_sha256": document.sha256,
                "evidence_candidate_id": candidate.id,
                "source_anchor": {
                    "page_number": anchor.page_number,
                    "source_type": anchor.source_type,
                    "x": anchor.x,
                    "y": anchor.y,
                    "width": anchor.width,
                    "height": anchor.height,
                    "figure_number": anchor.figure_number,
                },
                "calibration": payload.calibration.model_dump(mode="json"),
                "actor": identity.user_id,
            }
        ],
        created_by=identity.user_id,
    )
    session.add(dataset)
    session.commit()
    return _dataset_view(dataset, experiment, artifact)


def create_xrd_digitized_dataset(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    payload: XrdDigitizedDatasetInput,
) -> ExperimentalDatasetView:
    """Commit a manually calibrated Figure 3 dataset into existing dataset JSON fields."""
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    candidate = session.scalar(
        select(EvidenceCandidateRecord).where(
            EvidenceCandidateRecord.id == candidate_id,
            EvidenceCandidateRecord.project_id == project.id,
        )
    )
    if candidate is None or candidate.anchor_id is None:
        raise ScientificReferenceNotFound("Figure 3 evidence does not exist.")
    anchor = session.scalar(
        select(DocumentSourceAnchorRecord).where(
            DocumentSourceAnchorRecord.id == candidate.anchor_id,
            DocumentSourceAnchorRecord.project_id == project.id,
            DocumentSourceAnchorRecord.document_id == candidate.document_id,
        )
    )
    if (
        candidate.evidence_type != "FIGURE"
        or candidate.source_class != ProvenanceClass.EXTRACTED.value
        or anchor is None
        or anchor.page_number != 6
        or anchor.figure_number != "3"
    ):
        raise ScientificValidationFailed(
            "XRD digitization requires the extracted Figure 3 source on PDF page 6."
        )
    document = session.scalar(
        select(ScientificDocumentRecord).where(
            ScientificDocumentRecord.id == candidate.document_id,
            ScientificDocumentRecord.project_id == project.id,
        )
    )
    artifact = session.get(ScientificArtifactRecord, document.raw_artifact_id) if document else None
    if document is None or artifact is None or artifact.project_id != project.id:
        raise ScientificReferenceNotFound("The source PDF artifact is unavailable.")
    if document.sha256 != payload.source_document_sha256 or artifact.sha256 != document.sha256:
        raise ArtifactHashMismatch()
    if not math.isfinite(payload.source_render_scale):
        raise ScientificValidationFailed("PDF render scale must be finite.")

    region = payload.plot_region
    if (
        region.x + region.width > payload.source_pixel_width
        or region.y + region.height > payload.source_pixel_height
    ):
        raise ScientificValidationFailed("User-defined graph region exceeds the rendered page.")

    def inside_region(point: SourcePixelPoint) -> bool:
        x, y = float(point.x), float(point.y)
        return (
            region.x <= x <= region.x + region.width and region.y <= y <= region.y + region.height
        )

    for calibration in (payload.x_calibration, payload.y_calibration):
        if calibration is None:
            continue
        if not inside_region(calibration.pixel_a) or not inside_region(calibration.pixel_b):
            raise ScientificValidationFailed(
                "Axis calibration ticks must be inside the graph region."
            )
    if payload.x_calibration.label.casefold() not in {"2theta", "2θ", "2 theta"}:
        raise ScientificValidationFailed("Figure 3 X axis must be labeled 2θ.")
    if payload.x_calibration.unit != "degree":
        raise ScientificValidationFailed("Figure 3 2θ axis must use degrees.")
    if payload.y_calibration and payload.y_calibration.label.casefold() not in {
        "intensity",
        "relative intensity",
    }:
        raise ScientificValidationFailed("The calibrated Y axis must be identified as intensity.")

    def axis_value(
        calibration: XrdAxisCalibration,
        pixel: SourcePixelPoint,
        *,
        dimension: str,
    ) -> float:
        pixel_a = getattr(calibration.pixel_a, dimension)
        pixel_b = getattr(calibration.pixel_b, dimension)
        value_a = calibration.value_a
        value_b = calibration.value_b
        if pixel_a == pixel_b:
            raise ScientificValidationFailed("Axis calibration pixel locations must be distinct.")
        value = value_a + (getattr(pixel, dimension) - pixel_a) * (value_b - value_a) / (
            pixel_b - pixel_a
        )
        if not math.isfinite(value):
            raise ScientificValidationFailed("Axis calibration produced a non-finite value.")
        return value

    digitized_points: list[XrdDigitizedPoint] = []
    for index, point in enumerate(payload.points):
        if not inside_region(point.source_pixel):
            raise ScientificValidationFailed(
                "Every digitized point must lie inside the graph region."
            )
        two_theta = axis_value(payload.x_calibration, point.source_pixel, dimension="x")
        if two_theta < 0 or two_theta > 180:
            raise ScientificValidationFailed("Calibrated 2θ values must be between 0° and 180°.")
        intensity = (
            axis_value(payload.y_calibration, point.source_pixel, dimension="y")
            if payload.y_calibration
            else None
        )
        digitized_points.append(
            XrdDigitizedPoint(
                point_order=index,
                source_pixel=point.source_pixel,
                two_theta_degree=two_theta,
                intensity=intensity,
            )
        )

    previous_sessions: list[tuple[int, str]] = []
    existing_datasets = session.scalars(
        select(ExperimentalDatasetRecord).where(
            ExperimentalDatasetRecord.project_id == project.id,
            ExperimentalDatasetRecord.source_class == ProvenanceClass.DIGITIZED.value,
        )
    ).all()
    for existing in existing_datasets:
        for step in existing.processing_json or []:
            previous = step.get("xrd_digitization_session") if isinstance(step, dict) else None
            if isinstance(previous, dict) and previous.get("source_evidence_id") == candidate.id:
                previous_sessions.append((int(previous.get("revision", 0)), existing.id))
    previous_sessions.sort()
    revision = previous_sessions[-1][0] + 1 if previous_sessions else 1
    parent_dataset_id = previous_sessions[-1][1] if previous_sessions else None

    reported_peaks: list[XrdReportedPeak] = []
    reported_records = session.scalars(
        select(EvidenceCandidateRecord).where(
            EvidenceCandidateRecord.project_id == project.id,
            EvidenceCandidateRecord.document_id == document.id,
            EvidenceCandidateRecord.evidence_type == "REPORTED_NUMERIC_VALUE",
            EvidenceCandidateRecord.source_class == ProvenanceClass.EXTRACTED.value,
        )
    ).all()
    for reported in reported_records:
        reported_anchor = (
            session.get(DocumentSourceAnchorRecord, reported.anchor_id)
            if reported.anchor_id
            else None
        )
        value = (
            reported.payload_json.get("reported_value")
            if isinstance(reported.payload_json, dict)
            else None
        )
        quantity = (
            reported.payload_json.get("quantity")
            if isinstance(reported.payload_json, dict)
            else None
        )
        unit = (
            reported.payload_json.get("reported_unit")
            if isinstance(reported.payload_json, dict)
            else None
        )
        if (
            reported_anchor is not None
            and reported_anchor.page_number == 6
            and quantity == "2theta"
            and unit == "degree"
            and isinstance(value, (int, float))
            and math.isfinite(float(value))
        ):
            reported_peaks.append(
                XrdReportedPeak(
                    evidence_id=UUID(reported.id),
                    page_number=reported_anchor.page_number,
                    two_theta_degree=float(value),
                )
            )
    reported_peaks.sort(key=lambda peak: peak.two_theta_degree)

    experiment = ExperimentRecord(
        project_id=project.id,
        name=payload.experiment_name,
        modality=ExperimentModality.XRD.value,
        operator_or_source="MANUAL_DIGITIZATION",
        created_by=identity.user_id,
    )
    session.add(experiment)
    session.flush()
    values = [
        {"2theta_degree": point.two_theta_degree}
        | ({"intensity": point.intensity} if point.intensity is not None else {})
        for point in digitized_points
    ]
    dataset = ExperimentalDatasetRecord(
        project_id=project.id,
        experiment_id=experiment.id,
        state=DatasetProcessingState.DERIVED.value,
        artifact_id=artifact.id,
        source_class=ProvenanceClass.DIGITIZED.value,
        axes_json=[
            {
                "label": "2θ",
                "unit": _unit("degree", QuantityDimension.OTHER_DECLARED).model_dump(mode="json"),
                "direction": "ASCENDING",
            },
            {
                "label": "Intensity" if payload.y_calibration else "Intensity not calibrated",
                "unit": _unit(
                    payload.y_calibration.unit if payload.y_calibration else "unknown",
                    QuantityDimension.INTENSITY
                    if payload.y_calibration
                    else QuantityDimension.OTHER_DECLARED,
                ).model_dump(mode="json"),
                "direction": "ASCENDING",
            },
        ],
        values_json=values,
        point_count=len(values),
        processing_json=[],
        created_by=identity.user_id,
    )
    session.add(dataset)
    session.flush()
    session_id = UUID(new_id())
    created_at = dataset.created_at or datetime.now(UTC)
    hash_payload = {
        "source_document_sha256": document.sha256,
        "source_render_sha256": payload.source_render_sha256,
        "source_render_version": payload.source_render_version,
        "page_number": anchor.page_number,
        "figure_number": anchor.figure_number,
        "plot_region": region.model_dump(mode="json"),
        "x_calibration": payload.x_calibration.model_dump(mode="json"),
        "y_calibration": payload.y_calibration.model_dump(mode="json")
        if payload.y_calibration
        else None,
        "y_unit_status": payload.y_unit_status,
        "point_mode": payload.point_mode,
        "points": [point.model_dump(mode="json") for point in digitized_points],
        "reported_peaks": [peak.model_dump(mode="json") for peak in reported_peaks],
    }
    dataset_hash = hashlib.sha256(
        json.dumps(hash_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    digitization_session = XrdDigitizationSession(
        session_id=session_id,
        revision=revision,
        source_document_id=UUID(document.id),
        source_artifact_id=UUID(artifact.id),
        source_artifact_sha256=document.sha256,
        source_evidence_id=UUID(candidate.id),
        page_number=anchor.page_number,
        figure_number=anchor.figure_number or "3",
        source_render_sha256=payload.source_render_sha256,
        source_render_version=payload.source_render_version,
        source_render_scale=payload.source_render_scale,
        source_pixel_width=payload.source_pixel_width,
        source_pixel_height=payload.source_pixel_height,
        plot_region=region,
        x_calibration=payload.x_calibration,
        y_calibration=payload.y_calibration,
        y_unit_status=payload.y_unit_status,
        point_mode=payload.point_mode,
        points=tuple(digitized_points),
        reported_peaks=tuple(reported_peaks),
        operator_id=UUID(identity.user_id),
        user_action=(
            "MANUAL_PEAK_PICKING"
            if payload.point_mode == "PEAK_PICKING"
            else "MANUAL_CURVE_POINTING"
        ),
        dataset_sha256=dataset_hash,
        parent_dataset_id=UUID(parent_dataset_id) if parent_dataset_id else None,
        created_at=created_at,
    )
    dataset.processing_json = [
        {
            "method": "manual_graph_digitization",
            "digitizer_version": "figure3-xrd-manual-1",
            "authority": ProvenanceClass.DIGITIZED.value,
            "approximation": "APPROXIMATE",
            "source_evidence_review_state": candidate.review_state,
            "xrd_digitization_session": digitization_session.model_dump(mode="json"),
        }
    ]
    session.commit()
    session.refresh(dataset)
    from .knowledge.service import KnowledgeService

    KnowledgeService(session, identity).enqueue_reindex(project.id)
    return _dataset_view(dataset, experiment, artifact)


def create_dls_digitized_dataset(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    payload: GraphDigitizedDatasetInput,
) -> ExperimentalDatasetView:
    """Commit a source-linked Figure 4 particle-size distribution."""
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    candidate = session.scalar(
        select(EvidenceCandidateRecord).where(
            EvidenceCandidateRecord.id == candidate_id,
            EvidenceCandidateRecord.project_id == project.id,
        )
    )
    anchor = (
        session.get(DocumentSourceAnchorRecord, candidate.anchor_id)
        if candidate and candidate.anchor_id
        else None
    )
    if (
        candidate is None
        or candidate.evidence_type != "FIGURE"
        or candidate.source_class != ProvenanceClass.EXTRACTED.value
        or anchor is None
        or anchor.page_number != 7
        or anchor.figure_number != "4"
    ):
        raise ScientificValidationFailed(
            "DLS digitization requires the extracted Figure 4 source on PDF page 7."
        )
    document = session.scalar(
        select(ScientificDocumentRecord).where(
            ScientificDocumentRecord.id == candidate.document_id,
            ScientificDocumentRecord.project_id == project.id,
        )
    )
    artifact = session.get(ScientificArtifactRecord, document.raw_artifact_id) if document else None
    if document is None or artifact is None or artifact.project_id != project.id:
        raise ScientificReferenceNotFound("The source PDF artifact is unavailable.")
    if document.sha256 != payload.source_document_sha256 or artifact.sha256 != document.sha256:
        raise ArtifactHashMismatch()
    if not math.isfinite(payload.source_render_scale):
        raise ScientificValidationFailed("PDF render scale must be finite.")
    region = payload.plot_region
    if (
        region.x + region.width > payload.source_pixel_width
        or region.y + region.height > payload.source_pixel_height
    ):
        raise ScientificValidationFailed("User-defined graph region exceeds the rendered page.")
    if (
        payload.x_calibration.label.casefold() != "diameter"
        or payload.x_calibration.unit != "nm"
        or payload.x_calibration.scale != "log"
    ):
        raise ScientificValidationFailed(
            "Figure 4 X axis must preserve Diameter (nm) on its logarithmic scale."
        )
    if (
        payload.y_calibration.label.casefold() != "q"
        or payload.y_calibration.unit not in {"%", "pct"}
        or payload.y_calibration.scale != "linear"
    ):
        raise ScientificValidationFailed(
            "Figure 4 Y axis must preserve the source-defined q (%) scale."
        )

    def inside(point: SourcePixelPoint) -> bool:
        return (
            region.x <= point.x <= region.x + region.width
            and region.y <= point.y <= region.y + region.height
        )

    def mapped(calibration: GraphAxisCalibration, point: SourcePixelPoint, dimension: str) -> float:
        pixel_a = getattr(calibration.pixel_a, dimension)
        pixel_b = getattr(calibration.pixel_b, dimension)
        if pixel_a == pixel_b:
            raise ScientificValidationFailed(
                "Axis calibration tick pixels must differ along the calibrated axis."
            )
        fraction = (getattr(point, dimension) - pixel_a) / (pixel_b - pixel_a)
        if calibration.scale == "log":
            value = 10 ** (
                math.log10(calibration.value_a)
                + fraction * (math.log10(calibration.value_b) - math.log10(calibration.value_a))
            )
        else:
            value = calibration.value_a + fraction * (calibration.value_b - calibration.value_a)
        if not math.isfinite(value):
            raise ScientificValidationFailed("Axis calibration produced a non-finite value.")
        return value

    for calibration in (payload.x_calibration, payload.y_calibration):
        if not inside(calibration.pixel_a) or not inside(calibration.pixel_b):
            raise ScientificValidationFailed(
                "Axis calibration ticks must be inside the graph region."
            )
    points: list[GraphDigitizedPoint] = []
    for index, point in enumerate(payload.points):
        if not inside(point.source_pixel):
            raise ScientificValidationFailed(
                "Every digitized point must lie inside the graph region."
            )
        x_value = mapped(payload.x_calibration, point.source_pixel, "x")
        y_value = mapped(payload.y_calibration, point.source_pixel, "y")
        if x_value <= 0 or not 0 <= y_value <= 100:
            raise ScientificValidationFailed(
                "Diameter must be positive and q must be between 0 and 100%."
            )
        points.append(
            GraphDigitizedPoint(
                point_order=index, source_pixel=point.source_pixel, x_value=x_value, y_value=y_value
            )
        )

    prior: list[tuple[int, str]] = []
    for existing in session.scalars(
        select(ExperimentalDatasetRecord).where(
            ExperimentalDatasetRecord.project_id == project.id,
            ExperimentalDatasetRecord.source_class == ProvenanceClass.DIGITIZED.value,
        )
    ).all():
        for step in existing.processing_json or []:
            previous = step.get("graph_digitization_session") if isinstance(step, dict) else None
            if isinstance(previous, dict) and previous.get("source_evidence_id") == candidate.id:
                prior.append((int(previous.get("revision", 0)), existing.id))
    prior.sort()
    revision = prior[-1][0] + 1 if prior else 1
    parent_id = prior[-1][1] if prior else None
    experiment = ExperimentRecord(
        project_id=project.id,
        name=payload.experiment_name,
        modality=ExperimentModality.DLS.value,
        operator_or_source="MANUAL_DIGITIZATION",
        created_by=identity.user_id,
    )
    session.add(experiment)
    session.flush()
    values = [{"diameter_nm": point.x_value, "q_percent": point.y_value} for point in points]
    dataset = ExperimentalDatasetRecord(
        project_id=project.id,
        experiment_id=experiment.id,
        state=DatasetProcessingState.DERIVED.value,
        artifact_id=artifact.id,
        source_class=ProvenanceClass.DIGITIZED.value,
        axes_json=[
            {
                "label": "Diameter",
                "unit": _unit("nm", QuantityDimension.LENGTH).model_dump(mode="json"),
                "direction": "ASCENDING",
            },
            {
                "label": "q",
                "unit": _unit("%", QuantityDimension.DIMENSIONLESS).model_dump(mode="json"),
                "direction": "ASCENDING",
            },
        ],
        values_json=values,
        point_count=len(values),
        processing_json=[],
        created_by=identity.user_id,
    )
    session.add(dataset)
    session.flush()
    session_id = UUID(new_id())
    created_at = dataset.created_at or datetime.now(UTC)
    hash_payload = {
        "document_sha256": document.sha256,
        "render_sha256": payload.source_render_sha256,
        "page": anchor.page_number,
        "figure": anchor.figure_number,
        "region": region.model_dump(mode="json"),
        "x": payload.x_calibration.model_dump(mode="json"),
        "y": payload.y_calibration.model_dump(mode="json"),
        "points": [point.model_dump(mode="json") for point in points],
        "mode": payload.point_mode,
    }
    dataset_hash = hashlib.sha256(
        json.dumps(hash_payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    graph_session = GraphDigitizationSession(
        session_id=session_id,
        revision=revision,
        source_document_id=UUID(document.id),
        source_artifact_id=UUID(artifact.id),
        source_artifact_sha256=document.sha256,
        source_evidence_id=UUID(candidate.id),
        page_number=anchor.page_number,
        figure_number=anchor.figure_number,
        source_render_sha256=payload.source_render_sha256,
        source_render_version=payload.source_render_version,
        source_render_scale=payload.source_render_scale,
        source_pixel_width=payload.source_pixel_width,
        source_pixel_height=payload.source_pixel_height,
        plot_region=region,
        x_calibration=payload.x_calibration,
        y_calibration=payload.y_calibration,
        point_mode=payload.point_mode,
        points=tuple(points),
        operator_id=UUID(identity.user_id),
        dataset_sha256=dataset_hash,
        parent_dataset_id=UUID(parent_id) if parent_id else None,
        created_at=created_at,
    )
    dataset.processing_json = [
        {
            "method": "manual_graph_digitization",
            "digitizer_version": "generic-graph-manual-1",
            "authority": ProvenanceClass.DIGITIZED.value,
            "approximation": "APPROXIMATE",
            "source_evidence_review_state": candidate.review_state,
            "graph_digitization_session": graph_session.model_dump(mode="json"),
        }
    ]
    session.commit()
    session.refresh(dataset)
    from .knowledge.service import KnowledgeService

    KnowledgeService(session, identity).enqueue_reindex(project.id)
    return _dataset_view(dataset, experiment, artifact)


def _unit(code: str, dimension: QuantityDimension) -> UnitReference:
    return UnitReference(
        standard=UnitStandard.UCUM, code=code.replace("%", "pct"), dimension=dimension
    )


def import_experimental_dataset(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    *,
    project_id: str,
    original_name: str | None,
    media_type: str | None,
    stream: BinaryIO,
    payload: ExperimentalImportInput,
) -> ExperimentalDatasetView:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    stored = register_raw_file(
        session,
        identity,
        object_store,
        project.id,
        original_name,
        media_type,
        stream,
        settings.max_upload_bytes,
        settings=settings,
    )
    artifact = register_scientific_artifact(
        session,
        identity,
        ScientificArtifactRegistration(
            project_id=UUID(project.id),
            stored_file_id=UUID(stored.id),
            kind=ScientificArtifactKind.SPECTRUM_DATA,
            format_identifier="CSV",
        ),
    )
    stored_record = session.get(StoredFile, stored.id)
    if stored_record is None:
        raise ScientificReferenceNotFound("Uploaded source file does not exist.")
    data = object_store.get_bytes(stored_record.object_key, settings.max_upload_bytes).decode(
        "utf-8", errors="strict"
    )
    reader = csv.DictReader(io.StringIO(data), delimiter=payload.delimiter)
    if (
        not reader.fieldnames
        or payload.x_column not in reader.fieldnames
        or any(column not in reader.fieldnames for column in payload.y_columns)
    ):
        raise ScientificValidationFailed("CSV columns do not match the import declaration.")
    values: list[dict[str, float]] = []
    for row in reader:
        try:
            parsed = {
                payload.x_column: float(row[payload.x_column]),
                **{column: float(row[column]) for column in payload.y_columns},
            }
        except (TypeError, ValueError) as error:
            raise ScientificValidationFailed(
                "CSV contains non-numeric or invalid values."
            ) from error
        if any(not math.isfinite(value) for value in parsed.values()):
            raise ScientificValidationFailed("CSV contains NaN or Infinity.")
        values.append(parsed)
        if len(values) > settings.experimental_max_points:
            raise ScientificValidationFailed(
                "Experimental dataset exceeds the configured point bound."
            )
    if not values:
        raise ScientificValidationFailed("Experimental dataset is empty.")
    experiment = ExperimentRecord(
        project_id=project.id,
        name=payload.experiment_name,
        modality=payload.modality.value,
        created_by=identity.user_id,
    )
    session.add(experiment)
    session.flush()
    axes = [
        {
            "label": payload.x_label,
            "unit": _unit(payload.x_unit, QuantityDimension.OTHER_DECLARED).model_dump(mode="json"),
            "direction": "ASCENDING",
        }
    ]
    y_labels = [item.strip() for item in re.split(r"[,|;]", payload.y_label) if item.strip()]
    axes.extend(
        {
            "label": y_labels[index] if index < len(y_labels) else column,
            "unit": _unit(payload.y_unit, QuantityDimension.INTENSITY).model_dump(mode="json"),
            "direction": "ASCENDING",
        }
        for index, column in enumerate(payload.y_columns)
    )
    dataset = ExperimentalDatasetRecord(
        project_id=project.id,
        experiment_id=experiment.id,
        state=DatasetProcessingState.RAW.value,
        artifact_id=str(artifact.id),
        source_class=ProvenanceClass.EXPERIMENTAL.value,
        axes_json=axes,
        values_json=values,
        point_count=len(values),
        processing_json=[],
        created_by=identity.user_id,
    )
    session.add(dataset)
    session.commit()
    return _dataset_view(dataset, experiment, artifact)


def _dataset_view(
    dataset: ExperimentalDatasetRecord,
    experiment: ExperimentRecord,
    artifact: ScientificArtifactRecord | object,
) -> ExperimentalDatasetView:
    digitization_payload = next(
        (
            step.get("xrd_digitization_session")
            for step in dataset.processing_json or []
            if isinstance(step, dict) and isinstance(step.get("xrd_digitization_session"), dict)
        ),
        None,
    )
    graph_payload = next(
        (
            step.get("graph_digitization_session")
            for step in dataset.processing_json or []
            if isinstance(step, dict) and isinstance(step.get("graph_digitization_session"), dict)
        ),
        None,
    )
    return ExperimentalDatasetView(
        id=UUID(dataset.id),
        project_id=UUID(dataset.project_id),
        experiment_id=UUID(dataset.experiment_id),
        modality=ExperimentModality(experiment.modality),
        name=experiment.name,
        state=dataset.state,
        source_class=ProvenanceClass(dataset.source_class),
        artifact=ArtifactReference(
            project_id=UUID(dataset.project_id),
            artifact_id=UUID(dataset.artifact_id),
            sha256=artifact.sha256,
        ),
        axes=tuple(dataset.axes_json),
        values=tuple(dataset.values_json),
        point_count=dataset.point_count,
        created_at=dataset.created_at,
        digitization_session=(
            XrdDigitizationSession.model_validate(digitization_payload)
            if digitization_payload is not None
            else GraphDigitizationSession.model_validate(graph_payload)
            if graph_payload is not None
            else None
        ),
    )


def list_experimental_datasets(
    session: Session, identity: Identity, project_id: str
) -> ExperimentalDatasetListOutput:
    project, _ = authorize_project_access(session, identity, project_id)
    datasets = session.scalars(
        select(ExperimentalDatasetRecord)
        .where(
            ExperimentalDatasetRecord.project_id == project.id,
            # Spectrum datasets (spectrum_json set) are served by the experimental-spectra API.
            ExperimentalDatasetRecord.spectrum_json.is_(None),
        )
        .order_by(ExperimentalDatasetRecord.created_at.desc())
    ).all()
    views = []
    for dataset in datasets:
        experiment = session.get(ExperimentRecord, dataset.experiment_id)
        artifact = session.get(ScientificArtifactRecord, dataset.artifact_id)
        if experiment and artifact:
            views.append(_dataset_view(dataset, experiment, artifact))
    return ExperimentalDatasetListOutput(datasets=tuple(views))


def route_scientific_import(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    *,
    project_id: str,
    original_name: str | None,
    media_type: str | None,
    data: bytes,
    file_format: str | None = None,
) -> dict[str, object]:
    """Route one upload using content signals before any format-specific parser."""
    extension = (original_name or "").rsplit(".", 1)[-1].upper()
    text = data[:32_768].decode("utf-8", errors="ignore")
    if data.startswith(b"%PDF-"):
        return {
            "family": "DOCUMENT",
            "format": "PDF",
            "result": import_scientific_document(
                session,
                identity,
                object_store,
                settings,
                project_id=project_id,
                original_name=original_name,
                media_type=media_type or "application/pdf",
                stream=io.BytesIO(data),
            ).model_dump(mode="json"),
        }
    if extension in {"PDF"}:
        raise ScientificValidationFailed(
            "File extension indicates PDF but the PDF magic header is missing."
        )
    if (
        extension in {"SDF", "MOL", "XYZ", "CIF"}
        or "_cell_length_a" in text
        or re.match(r"^\s*\d+\s*$", text)
    ):
        detected = (
            extension
            if extension in {"SDF", "MOL", "XYZ", "CIF"}
            else ("CIF" if "_cell_length_a" in text else "XYZ")
        )
        stored = register_raw_file(
            session,
            identity,
            object_store,
            project_id,
            original_name,
            media_type,
            io.BytesIO(data),
            settings.max_upload_bytes,
            settings=settings,
        )
        artifact = register_scientific_artifact(
            session,
            identity,
            ScientificArtifactRegistration(
                project_id=UUID(project_id),
                stored_file_id=UUID(stored.id),
                kind=ScientificArtifactKind.STRUCTURE_FILE,
                format_identifier=detected,
            ),
        )
        result = import_structure(
            session,
            identity,
            object_store,
            StructureImportInput(
                project_id=UUID(project_id),
                source_artifact=_artifact_ref(
                    session.get(ScientificArtifactRecord, str(artifact.id))
                ),
                requested_format=detected,
                idempotency_key=f"router:{new_id()}",
            ),
        )
        return {"family": "STRUCTURE", "format": detected, "result": result.model_dump(mode="json")}
    if (
        extension in {"CSV", "TSV", "XY", "DAT", "XYE"} or "," in text.splitlines()[0]
        if text.splitlines()
        else False
    ):
        delimiter = "\t" if extension == "TSV" else ","
        header = next((line for line in text.splitlines() if line.strip()), "")
        columns = [column.strip() for column in header.split(delimiter)]
        if len(columns) < 2:
            raise ScientificValidationFailed(
                "Scientific series requires at least two declared columns."
            )
        result = import_experimental_dataset(
            session,
            identity,
            object_store,
            settings,
            project_id=project_id,
            original_name=original_name,
            media_type=media_type or "text/csv",
            stream=io.BytesIO(data),
            payload=ExperimentalImportInput(
                modality=ExperimentModality.XRD,
                x_column=columns[0],
                y_columns=(columns[1],),
                x_label=columns[0],
                x_unit="unitless",
                y_label=columns[1],
                y_unit="unitless",
                experiment_name=original_name or "Imported series",
                delimiter=delimiter,
            ),
        )
        return {
            "family": "EXPERIMENTAL_DATA",
            "format": extension or "CSV",
            "result": result.model_dump(mode="json"),
        }
    raise ScientificValidationFailed(
        "The uploaded scientific file format is ambiguous or unsupported."
    )
