from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID, uuid5

from sqlalchemy import select
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .context import Identity
from .contracts.scientific_claims import (
    ProjectScientificClaimsOutput,
    ScientificClaim,
    ScientificClaimRelation,
)
from .errors import ProjectAccessDenied, ScientificReferenceNotFound
from .phase7_actions import list_experimental_datasets
from .project_access import ProjectCapability, can
from .scientific_actions import list_structures
from .scientific_models import (
    CalculationResultRecord,
    DocumentSourceAnchorRecord,
    EvidenceCandidateRecord,
    ProvenanceRecordRow,
    ScientificDocumentRecord,
    StructureCandidateRecord,
    StructureVersionRecord,
)

_CLAIM_NAMESPACE = UUID("325e7a80-82fc-5d91-bb6f-360fda61237c")


def _claim_id(project_id: str, source_type: str, source_id: str, predicate: str) -> UUID:
    return uuid5(_CLAIM_NAMESPACE, f"{project_id}:{source_type}:{source_id}:{predicate}")


def _payload_hash(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def _cell_parameter_source_passage(
    session: Session,
    *,
    project_id: str,
    document_id: str,
    parameter: str,
    value: float,
    unit: str | None,
) -> tuple[EvidenceCandidateRecord, DocumentSourceAnchorRecord] | None:
    """Find an existing page-text record that states a reported cell parameter."""
    text_records = session.scalars(
        select(EvidenceCandidateRecord).where(
            EvidenceCandidateRecord.project_id == project_id,
            EvidenceCandidateRecord.document_id == document_id,
            EvidenceCandidateRecord.evidence_type == "DOCUMENT_TEXT",
        )
    ).all()
    candidates: list[
        tuple[tuple[int, int, int], EvidenceCandidateRecord, DocumentSourceAnchorRecord]
    ] = []
    for record in text_records:
        anchor = (
            session.scalar(
                select(DocumentSourceAnchorRecord).where(
                    DocumentSourceAnchorRecord.id == record.anchor_id,
                    DocumentSourceAnchorRecord.project_id == project_id,
                    DocumentSourceAnchorRecord.document_id == document_id,
                )
            )
            if record.anchor_id
            else None
        )
        if anchor is None:
            continue
        text = str((record.payload_json or {}).get("text", ""))
        normalized = (
            text.casefold()
            .replace("\u0430", "a")
            .replace("\u0441", "c")
            .replace("\u03b1", "alpha")
            .replace("\u03b2", "beta")
            .replace("\u03b3", "gamma")
        )
        parameter_matches = list(re.finditer(rf"(?<![a-z]){re.escape(parameter)}\s*=", normalized))
        value_matches = [
            match
            for match in re.finditer(r"(?<![\w.])\d+(?:[.,]\d+)?(?![\w.])", normalized)
            if abs(_source_number(match.group()) - value) <= max(1e-8, abs(value) * 1e-8)
        ]
        if not parameter_matches or not value_matches:
            continue
        nearest = min(
            [
                (
                    abs(parameter_match.start() - value_match.start()),
                    parameter_match,
                    value_match,
                )
                for parameter_match in parameter_matches
                for value_match in value_matches
            ],
            key=lambda item: item[0],
        )
        distance, parameter_match, value_match = nearest
        start = max(0, min(parameter_match.start(), value_match.start()) - 180)
        end = min(len(normalized), max(parameter_match.end(), value_match.end()) + 180)
        context = normalized[start:end]
        crystallographic_context = bool(
            re.search(
                r"cell|lattice|crystal|crystall|рентген|ячейк|кристалл|параметр",
                context,
            )
        )
        if not crystallographic_context:
            continue
        unit_context = bool(
            re.search(r"(?:Å|å|angstrom|\u00c5)", context, re.IGNORECASE)
            if unit and unit.casefold() in {"å", "Å", "a", "angstrom"}
            else unit and unit.casefold() in context
        )
        # Favor nearby source text that explicitly identifies the unit and the
        # crystallographic quantity. Stable page/record ordering breaks ties.
        score = (int(unit_context), int(crystallographic_context), -distance)
        candidates.append((score, record, anchor))
    if not candidates:
        return None
    _score, record, anchor = max(
        candidates,
        key=lambda item: (
            item[0],
            -(item[2].page_number),
            item[1].created_at,
            item[1].id,
        ),
    )
    return record, anchor


def _source_number(raw: str) -> float:
    # OCR emits both decimal-comma and thousands-comma tokens in extracted tables.
    if "," in raw and "." in raw:
        return float(raw.replace(",", ""))
    return float(raw.replace(",", "."))


class _RelativeEnergyMatch:
    """Same interface as the parts of a regex match the relative-energy loop reads."""

    def __init__(self, value: str, direction: str, start: int, end: int) -> None:
        self._groups = {"value": value, "direction": direction}
        self._start, self._end = start, end

    def group(self, name: str) -> str:
        return self._groups[name]

    def start(self) -> int:
        return self._start

    def end(self) -> int:
        return self._end


_NUMBER_TOKEN = re.compile(r"(?<![\w.])[-+\u2212]?\d+(?:[.,]\d+)?(?![\w])")


def original_value_token(value: Any, text: str | None) -> str | None:
    """The numeric token in ``text`` equal to ``value``, exactly as written; else None.

    Returns a token only when every match for the number has the same spelling, so a
    quote containing both "24.48" and "24.480" yields None rather than a guess.
    """
    if text is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    spellings: set[str] = set()
    for match in _NUMBER_TOKEN.finditer(text):
        token = match.group(0)
        try:
            number = float(token.replace(",", ".").replace("\u2212", "-"))
        except ValueError:
            continue
        if number == float(value):
            spellings.add(token.lstrip("+"))
    return spellings.pop() if len(spellings) == 1 else None


def _claim(
    *,
    project_id: str,
    source_type: str,
    source_id: str,
    predicate: str,
    claim_type: str,
    subject: str,
    value: Any,
    authority: str,
    review: str,
    label: str,
    quantity_key: str | None = None,
    unit: str | None = None,
    qualifier: str | None = None,
    uncertainty: Any = None,
    document_id: str | None = None,
    evidence_id: str | None = None,
    page: int | None = None,
    figure: str | None = None,
    table: str | None = None,
    provenance_hash: str | None = None,
    semantic_status: str = "EXPLICIT",
    href: str | None = None,
    created_at: Any = None,
    source_text: str | None = None,
) -> ScientificClaim:
    return ScientificClaim(
        id=_claim_id(project_id, source_type, source_id, predicate),
        project_id=UUID(project_id),
        claim_type=claim_type,
        subject=subject,
        predicate=predicate,
        quantity_key=quantity_key,
        value=value,
        unit=unit,
        original_value_text=original_value_token(value, source_text),
        qualifier=qualifier,
        uncertainty=uncertainty,
        source_authority=authority,
        source_record_type=source_type,
        source_record_id=UUID(source_id),
        source_document_id=UUID(document_id) if document_id else None,
        page=page,
        figure=figure,
        table=table,
        evidence_id=UUID(evidence_id) if evidence_id else None,
        provenance_hash=provenance_hash,
        review_state=review,
        semantic_status=semantic_status,
        source_label=label,
        source_href=href,
        created_at=created_at,
    )


def _evidence_claims(session: Session, project_id: str, locale: str) -> list[ScientificClaim]:
    rows = session.scalars(
        select(EvidenceCandidateRecord)
        .where(EvidenceCandidateRecord.project_id == project_id)
        .order_by(EvidenceCandidateRecord.created_at, EvidenceCandidateRecord.id)
    ).all()
    # A specialized structural record carries the intended quantity semantics;
    # prefer it when an extractor also emitted a generic numeric duplicate.
    rows.sort(
        key=lambda row: (
            0 if row.evidence_type.upper() == "REPORTED_CELL_PARAMETER" else 1,
            row.created_at,
            row.id,
        )
    )
    claims: list[ScientificClaim] = []
    seen: set[tuple[str, str, str]] = set()
    for row in rows:
        anchor = (
            session.scalar(
                select(DocumentSourceAnchorRecord).where(
                    DocumentSourceAnchorRecord.id == row.anchor_id,
                    DocumentSourceAnchorRecord.project_id == project_id,
                )
            )
            if row.anchor_id
            else None
        )
        source_document_exists = (
            session.scalar(
                select(ScientificDocumentRecord.id).where(
                    ScientificDocumentRecord.id == row.document_id,
                    ScientificDocumentRecord.project_id == project_id,
                )
            )
            is not None
        )
        source_binding_valid = source_document_exists and (
            row.anchor_id is None or anchor is not None
        )
        payload = row.payload_json or {}
        kind = row.evidence_type.upper()
        parameter = str(payload.get("parameter", "")).lower()
        unit = payload.get("reported_unit")
        value = payload.get("reported_value")
        quantity: str | None = None
        claim_type = "NUMERIC_VALUE"
        predicate = kind.lower().replace("_", " ")
        subject = "Paper"
        if (
            kind in {"REPORTED_CELL_PARAMETER", "REPORTED_NUMERIC_VALUE"}
            and parameter in {"a", "b", "c", "alpha", "beta", "gamma"}
            and isinstance(value, (float, int))
        ):
            quantity = f"crystal.cell.{parameter}"
            claim_type = "STRUCTURAL_PARAMETER"
            subject = "Reported crystal cell"
            predicate = parameter
        elif (
            kind in {"REPORTED_NUMERIC_VALUE", "XRD_REPORTED_PEAK"}
            and str(payload.get("quantity", "")).lower() in {"2theta", "two_theta", "2_theta"}
            and isinstance(value, (int, float))
        ):
            quantity = "xrd.two_theta.peak_position"
            claim_type = "PEAK_POSITION"
            predicate = "2θ peak position"
            unit = unit or "degree"
        elif kind in {"DLS_REPORTED_RANGE", "PARTICLE_SIZE_RANGE"}:
            vmin, vmax = (
                payload.get("minimum", payload.get("min_value")),
                payload.get("maximum", payload.get("max_value")),
            )
            if isinstance(vmin, (float, int)) and isinstance(vmax, (float, int)):
                value = [vmin, vmax]
                unit = unit or payload.get("unit")
                quantity = "dls.particle_size.range"
                claim_type, predicate, subject = (
                    "RANGE",
                    "reported particle-size range",
                    "DLS particles",
                )
        elif kind in {"DLS_REPORTED_VALUE", "DLS_HYDRODYNAMIC_RADIUS", "PARTICLE_SIZE"}:
            value = payload.get("reported_value", payload.get("value", value))
            label = " ".join(
                str(payload.get(key, "")) for key in ("quantity", "parameter", "label")
            ).lower()
            if isinstance(value, (float, int)):
                if "radius" in label or "radius" in str(payload.get("snippet", "")).lower():
                    quantity, predicate = "dls.hydrodynamic_radius", "hydrodynamic radius"
                else:
                    quantity, predicate = "dls.particle_size", "particle size"
                claim_type, subject = "PARTICLE_SIZE", "DLS particles"
                unit = unit or payload.get("unit")
        elif kind == "STRUCTURE_FIGURE_CANDIDATE":
            quantity, claim_type, predicate = None, "STRUCTURE_ASSERTION", "structure depicted"
            value = payload.get("caption") or "Figure indicates a structure"
            subject = "Paper structure figure"
        elif kind == "USER_CLAIM":
            # A paper value the researcher typed in (F-024): USER_ENTERED, never CALCULATED.
            entered_value = payload.get("value")
            if isinstance(entered_value, (int, float)) and not isinstance(entered_value, bool):
                claims.append(
                    _claim(
                        project_id=project_id,
                        source_type="evidence_candidate",
                        source_id=row.id,
                        predicate=str(payload.get("quantity") or "paper value")[:120],
                        claim_type="USER_ENTERED_LITERATURE_VALUE",
                        subject=str(payload.get("system") or "Paper statement")[:200],
                        value=payload["value"],
                        unit=payload.get("unit") or None,
                        source_text=str(payload.get("quote") or ""),
                        quantity_key=payload.get("quantity_key") or "literature.user_entered",
                        qualifier=(
                            "entered by you; paper reports: "
                            f"\u201c{str(payload.get('quote', ''))[:300]}\u201d"
                        ),
                        authority="USER_ENTERED",
                        review=row.review_state,
                        label="Paper claim \u00b7 entered by you",
                        document_id=row.document_id,
                        evidence_id=row.id,
                        page=anchor.page_number if anchor else None,
                        provenance_hash=_payload_hash(payload),
                        semantic_status=(
                            "EXPLICIT" if source_binding_valid else "SOURCE_UNAVAILABLE"
                        ),
                        href=(
                            f"/{locale}/projects/{project_id}/workspace?selection="
                            f"documentEvidence:{row.id}&source={row.document_id}"
                            + (f"&page={anchor.page_number}" if anchor else "")
                        )
                        if source_binding_valid
                        else None,
                        created_at=row.created_at,
                    )
                )
            continue
        elif kind == "DOCUMENT_TEXT":
            text = str(payload.get("text", ""))
            common = {
                "project_id": project_id,
                "source_type": "evidence_candidate",
                "source_id": row.id,
                "authority": row.source_class,
                "review": row.review_state,
                "label": "Paper text · extracted",
                "document_id": row.document_id,
                "evidence_id": row.id,
                "page": anchor.page_number if anchor else None,
                "provenance_hash": _payload_hash(payload),
                "semantic_status": ("EXPLICIT" if source_binding_valid else "SOURCE_UNAVAILABLE"),
                "href": (
                    f"/{locale}/projects/{project_id}/workspace?selection="
                    f"documentEvidence:{row.id}&source={row.document_id}"
                    + (f"&page={anchor.page_number}" if anchor else "")
                )
                if source_binding_valid
                else None,
                "created_at": row.created_at,
            }
            parsed: list[ScientificClaim] = []
            # The CVD labels below are only true for CVD papers (F-021/F-022): an
            # ionic-liquid synthesis that says "70-100 °C" is a reaction temperature,
            # not a deposition temperature.
            is_cvd_text = bool(
                re.search(
                    r"\bCVD\b|vapou?r\s+deposition|deposition\s+temperature|осаждени|\bAr\b.{0,80}?\bH\s*2\b",
                    text,
                    re.IGNORECASE,
                )
            )
            relative_matches = list(
                re.finditer(
                    r"(?P<value>\d+(?:[.,]\d+)?)\s*kcal\s*(?:/\s*mol|mol\s*[-\u2212\u2013]?\s*1)\s+"
                    r"(?P<direction>higher|lower)\s+than",
                    text,
                    re.IGNORECASE,
                )
            )
            # "increased the total energy by 7.7 kcal mol-1 relative to ..." and "destabilization of
            # 35.8 kcal mol-1 relative to ...": the direction is in the words before the number.
            for match in re.finditer(
                r"(?P<lead>[^.]{0,80}?)(?P<value>\d+(?:[.,]\d+)?)\s*kcal\s*"
                r"(?:/\s*mol|mol\s*[-\u2212\u2013]?\s*1)\s+relative\s+to",
                text,
                re.IGNORECASE,
            ):
                lead = match.group("lead").casefold()
                if re.search(r"increas|destabili|penalt|higher|above|raised", lead):
                    direction = "higher"
                elif re.search(r"decreas|stabili|lower|below|reduced", lead):
                    direction = "lower"
                else:
                    continue
                relative_matches.append(
                    _RelativeEnergyMatch(match.group("value"), direction, match.start("value"),
                                         match.end())
                )
            for relative in relative_matches:
                start = max(text.rfind(".", 0, relative.start()) + 1, 0)
                end = text.find(". ", relative.end())
                quote = " ".join(text[start : end + 1 if end != -1 else len(text)].split())[:300]
                number = _source_number(relative.group("value"))
                if relative.group("direction").casefold() == "lower":
                    number = -number
                parsed.append(
                    _claim(
                        **common,
                        predicate="relative energy"
                        if not any(c.predicate == "relative energy" for c in parsed)
                        else f"relative energy {len(parsed) + 1}",
                        claim_type="CALCULATED_PROPERTY_REPORTED",
                        subject="Paper statement",
                        value=number,
                        unit="kcal/mol",
                        quantity_key="literature.relative_energy",
                        qualifier=f"paper reports; quote: \u201c{quote}\u201d",
                    )
                )
            ratio = re.search(
                r"\bAr\b.{0,80}?\bH\s*2\b.{0,50}?\b(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)",
                text,
                re.IGNORECASE,
            )
            if ratio and is_cvd_text:
                parsed.append(
                    _claim(
                        **common,
                        predicate="argon to hydrogen feed ratio",
                        claim_type="COMPOSITION",
                        subject="CVD feed gas",
                        value=f"Ar:H2 {ratio.group(1)}:{ratio.group(2)}",
                        quantity_key="cvd.feed_gas.ratio",
                        qualifier="reported",
                    )
                )
            duration = re.search(
                r"\b(\d+(?:[.,]\d+)?)\s*[-\u2013\u2014]\s*(\d+(?:[.,]\d+)?)\s*(h|hours?)\b",
                text,
                re.IGNORECASE,
            )
            if duration and is_cvd_text:
                parsed.append(
                    _claim(
                        **common,
                        predicate="deposition duration",
                        claim_type="EXPERIMENTAL_CONDITION",
                        subject="CVD process",
                        value=[
                            float(duration.group(1).replace(",", ".")),
                            float(duration.group(2).replace(",", ".")),
                        ],
                        unit="h",
                        quantity_key="cvd.duration",
                        qualifier="reported range",
                    )
                )
            temperature = re.search(
                r"\b(\d+(?:[.,]\d+)?)\s*[-\u2013\u2014]\s*(\d+(?:[.,]\d+)?)\s*(?:°|o)?\s*[C\u0421]\b",
                text,
                re.IGNORECASE,
            )
            if temperature:
                reaction_text = bool(
                    re.search(
                        r"reaction|heat|synthes|mild temperature|ionic liquid", text, re.IGNORECASE
                    )
                )
                parsed.append(
                    _claim(
                        **common,
                        predicate="deposition temperature"
                        if is_cvd_text
                        else "reaction temperature"
                        if reaction_text
                        else "temperature stated in the paper",
                        claim_type="EXPERIMENTAL_CONDITION",
                        subject="CVD process" if is_cvd_text else "Paper statement",
                        value=[
                            _source_number(temperature.group(1)),
                            _source_number(temperature.group(2)),
                        ],
                        unit="°C",
                        quantity_key="cvd.temperature"
                        if is_cvd_text
                        else "literature.temperature",
                        qualifier="reported range",
                    )
                )
            dls_range = re.search(
                r"(?:range|interval|диапазон)[^\d]{0,30}(\d+(?:[.,]\d+)?)\s*[-\u2013\u2014]\s*(\d+(?:[.,]\d+)?)\s*nm",
                text,
                re.IGNORECASE,
            )
            if dls_range and re.search(
                r"dls|dynamic light scattering|hydrodynamic|particle size|дср", text, re.IGNORECASE
            ):
                parsed.append(
                    _claim(
                        **common,
                        predicate="reported particle-size range",
                        claim_type="RANGE",
                        subject="DLS particles",
                        value=[
                            _source_number(dls_range.group(1)),
                            _source_number(dls_range.group(2)),
                        ],
                        unit="nm",
                        quantity_key="dls.particle_size.reported_range",
                    )
                )
            radius = re.search(
                r"(?:hydrodynamic\s+radii?|радиус(?:ы)?\s+гидродинамическ\w*)[^\d]{0,40}(\d+(?:[.,]\d+)?)\s*nm",
                text,
                re.IGNORECASE,
            )
            if radius:
                parsed.append(
                    _claim(
                        **common,
                        predicate="hydrodynamic radius",
                        claim_type="PARTICLE_SIZE",
                        subject="DLS particles",
                        value=float(radius.group(1).replace(",", ".")),
                        unit="nm",
                        quantity_key="dls.hydrodynamic_radius",
                    )
                )
            summary = re.search(
                r"\bMean\b\s+\bMedian\b\s+\bMode\b\s+"
                r"(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)",
                text,
                re.IGNORECASE,
            )
            if summary and re.search(r"dH|diameter|диаметр", text, re.IGNORECASE):
                for name, raw in zip(("mean", "median", "mode"), summary.groups(), strict=True):
                    normalized = _source_number(raw) < 10 and name == "median"
                    claim_common = {
                        **common,
                        "semantic_status": (
                            "SOURCE_UNAVAILABLE"
                            if not source_binding_valid
                            else "SOURCE_TABLE_CONTEXT_NORMALIZED"
                            if normalized
                            else "EXPLICIT"
                        ),
                    }
                    parsed.append(
                        _claim(
                            **claim_common,
                            predicate=f"hydrodynamic diameter {name}",
                            claim_type="DISTRIBUTION_SUMMARY",
                            subject="DLS distribution",
                            value=(
                                _source_number(raw) * 1000
                                if _source_number(raw) < 10 and name == "median"
                                else _source_number(raw)
                            ),
                            unit="nm",
                            quantity_key=f"dls.hydrodynamic_diameter.{name}",
                            qualifier=(
                                "Source table token scaled from OCR context; inspect source text."
                                if _source_number(raw) < 10 and name == "median"
                                else None
                            ),
                            table=anchor.table_number if anchor else None,
                        )
                    )
            thermal = re.search(
                r"(?:from|between|от)[^\d]{0,40}(\d+(?:[.,]\d+)?)\s*°?\s*[C\u0421]?\s*"
                r"(?:to|and|до)\s*(\d+(?:[.,]\d+)?)\s*°?\s*[C\u0421]",
                text,
                re.IGNORECASE,
            )
            if thermal and re.search(r"thermal|tga|dtg|dta|термич", text, re.IGNORECASE):
                parsed.append(
                    _claim(
                        **common,
                        predicate="thermal event temperature range",
                        claim_type="RANGE",
                        subject="Thermal analysis",
                        value=[
                            float(thermal.group(1).replace(",", ".")),
                            float(thermal.group(2).replace(",", ".")),
                        ],
                        unit="°C",
                        quantity_key="thermal.event.temperature_range",
                    )
                )
            if parsed:
                claims.extend(parsed)
            continue
        else:
            continue
        if value is None:
            continue
        key = (predicate, str(value), str(unit))
        if key in seen:
            continue
        seen.add(key)
        claim_evidence_id = row.id
        claim_page = anchor.page_number if anchor else None
        claim_href = (
            (
                f"/{locale}/projects/{project_id}/workspace?selection=documentEvidence:{row.id}&source={row.document_id}"
                + (f"&page={anchor.page_number}" if anchor else "")
            )
            if source_binding_valid
            else None
        )
        claim_semantic_status = "EXPLICIT" if source_binding_valid else "SOURCE_UNAVAILABLE"
        claim_label = f"Evidence · {kind.replace('_', ' ').title()}"
        if quantity and quantity.startswith("crystal.cell.") and isinstance(value, (int, float)):
            source_passage = _cell_parameter_source_passage(
                session,
                project_id=project_id,
                document_id=row.document_id,
                parameter=parameter,
                value=float(value),
                unit=str(unit) if unit else None,
            )
            if source_passage is None:
                claim_semantic_status = "SOURCE_UNAVAILABLE"
                claim_href = None
            else:
                passage_record, passage_anchor = source_passage
                claim_evidence_id = passage_record.id
                claim_page = passage_anchor.page_number
                claim_href = (
                    f"/{locale}/projects/{project_id}/workspace?selection=documentEvidence:{passage_record.id}"
                    f"&source={row.document_id}&page={passage_anchor.page_number}"
                )
                claim_label = "Evidence · Reported Cell Parameter"
        claims.append(
            _claim(
                project_id=project_id,
                source_type="evidence_candidate",
                source_id=row.id,
                predicate=predicate,
                claim_type=claim_type,
                subject=subject,
                value=value,
                unit=str(unit) if unit else None,
                source_text=str(payload.get("snippet") or payload.get("quote") or "")
                or (anchor.snippet if anchor else None),
                quantity_key=quantity,
                authority=row.source_class,
                review=row.review_state,
                label=claim_label,
                document_id=row.document_id,
                evidence_id=claim_evidence_id,
                page=claim_page,
                figure=anchor.figure_number if anchor else None,
                table=anchor.table_number if anchor else None,
                provenance_hash=_payload_hash(payload),
                semantic_status=claim_semantic_status,
                href=claim_href,
                created_at=row.created_at,
            )
        )
    return claims


def _dataset_claims(
    session: Session, identity: Identity, project_id: str, locale: str
) -> list[ScientificClaim]:
    claims: list[ScientificClaim] = []
    for dataset in list_experimental_datasets(session, identity, project_id).datasets:
        # The dataset contract is project scoped and carries the original digitization session/hash.
        href = (
            f"/{locale}/projects/{project_id}/workspace?selection=experimentalDataset:{dataset.id}"
        )
        session_data = dataset.digitization_session
        if dataset.modality.value == "XRD":
            values = [point.two_theta_degree for point in getattr(session_data, "points", ())]
            if not values:
                values = [
                    float(item["two_theta_degree"])
                    for item in dataset.values
                    if "two_theta_degree" in item
                ]
            if values:
                for index, value in enumerate(values, 1):
                    claims.append(
                        _claim(
                            project_id=project_id,
                            source_type="experimental_dataset",
                            source_id=str(dataset.id),
                            predicate=f"2θ digitized peak {index}",
                            claim_type="PEAK_POSITION",
                            subject="Digitized XRD pattern",
                            value=value,
                            unit="degree",
                            quantity_key="xrd.two_theta.peak_position",
                            authority=dataset.source_class.value,
                            review="COMMITTED",
                            label=f"Digitized dataset · {dataset.name}",
                            document_id=str(session_data.source_document_id)
                            if session_data
                            else None,
                            evidence_id=str(session_data.source_evidence_id)
                            if session_data
                            else None,
                            page=session_data.page_number if session_data else None,
                            figure=session_data.figure_number if session_data else None,
                            provenance_hash=session_data.dataset_sha256
                            if session_data
                            else dataset.artifact.sha256,
                            href=href,
                            created_at=dataset.created_at,
                        )
                    )
        elif dataset.modality.value == "DLS":
            diameters = [
                float(item.get("diameter_nm", item.get("x_value")))
                for item in dataset.values
                if item.get("diameter_nm", item.get("x_value")) is not None
            ]
            if diameters:
                peak = max(
                    dataset.values,
                    key=lambda item: float(item.get("q_percent", item.get("y_value", 0)) or 0),
                )
                peak_value = peak.get("diameter_nm", peak.get("x_value"))
                claims.extend(
                    [
                        _claim(
                            project_id=project_id,
                            source_type="experimental_dataset",
                            source_id=str(dataset.id),
                            predicate="digitized size extent",
                            claim_type="RANGE",
                            subject="Digitized DLS distribution",
                            value=[min(diameters), max(diameters)],
                            unit="nm",
                            quantity_key="dls.hydrodynamic_diameter.extent",
                            authority=dataset.source_class.value,
                            review="COMMITTED",
                            label=f"Digitized dataset · {dataset.name}",
                            document_id=str(session_data.source_document_id)
                            if session_data and hasattr(session_data, "source_document_id")
                            else None,
                            evidence_id=str(session_data.source_evidence_id)
                            if session_data and hasattr(session_data, "source_evidence_id")
                            else None,
                            page=session_data.page_number
                            if session_data and hasattr(session_data, "page_number")
                            else None,
                            figure=session_data.figure_number
                            if session_data and hasattr(session_data, "figure_number")
                            else None,
                            provenance_hash=session_data.dataset_sha256
                            if session_data and hasattr(session_data, "dataset_sha256")
                            else dataset.artifact.sha256,
                            href=href,
                            created_at=dataset.created_at,
                        ),
                        _claim(
                            project_id=project_id,
                            source_type="experimental_dataset",
                            source_id=str(dataset.id),
                            predicate="distribution peak",
                            claim_type="DISTRIBUTION_SUMMARY",
                            subject="Digitized DLS distribution",
                            value=peak_value,
                            unit="nm",
                            quantity_key="dls.hydrodynamic_diameter.distribution_peak",
                            authority=dataset.source_class.value,
                            review="COMMITTED",
                            label=f"Digitized dataset · {dataset.name}",
                            document_id=str(session_data.source_document_id)
                            if session_data and hasattr(session_data, "source_document_id")
                            else None,
                            evidence_id=str(session_data.source_evidence_id)
                            if session_data and hasattr(session_data, "source_evidence_id")
                            else None,
                            page=session_data.page_number
                            if session_data and hasattr(session_data, "page_number")
                            else None,
                            figure=session_data.figure_number
                            if session_data and hasattr(session_data, "figure_number")
                            else None,
                            provenance_hash=session_data.dataset_sha256
                            if session_data and hasattr(session_data, "dataset_sha256")
                            else dataset.artifact.sha256,
                            href=href,
                            created_at=dataset.created_at,
                        ),
                    ]
                )
    return claims


def _recorded_difference(left: Any, right: Any) -> float:
    """Source minus ChemDFT, formed from the decimal text of the recorded values.

    Binary subtraction of two recorded decimals leaves noise digits (24.482 - 24.4565
    is 0.025500000000000966 in float arithmetic); the decimal difference is the value
    the two recorded numbers actually differ by. Nothing is rounded: the exact decimal
    difference is converted to the nearest double. Values Decimal cannot subtract (for
    example infinities) fall back to the previous float arithmetic.
    """
    try:
        return float(Decimal(str(left)) - Decimal(str(right)))
    except InvalidOperation:
        return float(left) - float(right)


def _relations(claims: list[ScientificClaim]) -> list[ScientificClaimRelation]:
    relations: list[ScientificClaimRelation] = []
    numeric = [claim for claim in claims if isinstance(claim.value, (float, int))]
    xrd = [
        claim
        for claim in numeric
        if claim.quantity_key == "xrd.two_theta.peak_position" and claim.unit == "degree"
    ]
    source_documents = sorted(
        {claim.source_document_id for claim in xrd if claim.source_document_id is not None},
        key=str,
    )
    for document_id in source_documents:
        extracted = sorted(
            (
                claim
                for claim in xrd
                if claim.source_authority == "EXTRACTED" and claim.source_document_id == document_id
            ),
            key=lambda claim: float(claim.value),
        )
        digitized = sorted(
            (
                claim
                for claim in xrd
                if claim.source_authority == "DIGITIZED" and claim.source_document_id == document_id
            ),
            key=lambda claim: float(claim.value),
        )
        for left, right in zip(extracted, digitized, strict=False):
            relations.append(
                ScientificClaimRelation(
                    left_claim_id=left.id,
                    right_claim_id=right.id,
                    relation="SAME_QUANTITY",
                    rationale=(
                        "Ordered reported and digitized XRD peak positions from the same source "
                        "document share 2θ and degree units."
                    ),
                    numeric_delta=_recorded_difference(left.value, right.value),
                    delta_unit="degree",
                )
            )
    for index, left in enumerate(numeric):
        for right in numeric[index + 1 :]:
            if (
                left.quantity_key == "xrd.two_theta.peak_position"
                and right.quantity_key == "xrd.two_theta.peak_position"
            ):
                continue
            if (
                left.source_authority == right.source_authority
                and left.quantity_key == right.quantity_key
            ):
                continue
            if (
                left.source_authority == right.source_authority
                or left.source_document_id is None
                or left.source_document_id != right.source_document_id
            ):
                continue
            if (
                left.quantity_key
                and left.quantity_key == right.quantity_key
                and left.unit == right.unit
            ):
                delta = _recorded_difference(left.value, right.value)
                relations.append(
                    ScientificClaimRelation(
                        left_claim_id=left.id,
                        right_claim_id=right.id,
                        relation="SAME_QUANTITY",
                        rationale="Semantic quantity and declared unit match.",
                        numeric_delta=delta,
                        delta_unit=left.unit,
                    )
                )
            elif (
                left.quantity_key
                and left.quantity_key == right.quantity_key
                and left.unit != right.unit
            ):
                relations.append(
                    ScientificClaimRelation(
                        left_claim_id=left.id,
                        right_claim_id=right.id,
                        relation="SEMANTICS_DIFFER",
                        rationale=(
                            "The semantic quantity matches, but declared units differ and no "
                            "deterministic conversion is defined."
                        ),
                    )
                )
            elif (
                left.quantity_key
                and right.quantity_key
                and left.quantity_key != right.quantity_key
                and (
                    (
                        left.quantity_key == "dls.hydrodynamic_radius"
                        and right.quantity_key.startswith("dls.hydrodynamic_diameter.")
                    )
                    or (
                        right.quantity_key == "dls.hydrodynamic_radius"
                        and left.quantity_key.startswith("dls.hydrodynamic_diameter.")
                    )
                )
                and left.source_document_id is not None
                and left.source_document_id == right.source_document_id
            ):
                relations.append(
                    ScientificClaimRelation(
                        left_claim_id=left.id,
                        right_claim_id=right.id,
                        relation="NOT_DIRECTLY_COMPARABLE",
                        rationale=(
                            "DLS quantities have different semantics; no conversion is inferred."
                        ),
                    )
                )
    claims_by_id = {claim.id: claim for claim in claims}
    return [relation for relation in relations if all(
        claims_by_id[cid].semantic_status != "INACTIVE_SOURCE"
        for cid in (relation.left_claim_id, relation.right_claim_id)
    )]


def _calculation_claims(session: Session, project_id: str) -> list[ScientificClaim]:
    records = session.scalars(
        select(CalculationResultRecord)
        .where(CalculationResultRecord.project_id == project_id)
        .order_by(CalculationResultRecord.created_at, CalculationResultRecord.id)
    ).all()
    claims: list[ScientificClaim] = []

    def visit(record: CalculationResultRecord, value: Any, path: str) -> None:
        if isinstance(value, dict):
            quantity_value = value.get("value")
            unit_object = value.get("unit")
            if isinstance(quantity_value, (float, int)) and isinstance(unit_object, dict):
                unit_code = unit_object.get("code")
                if isinstance(unit_code, str) and unit_code:
                    claims.append(
                        _claim(
                            project_id=project_id,
                            source_type="calculation_result",
                            source_id=record.id,
                            predicate=path,
                            claim_type="CALCULATION_RESULT",
                            subject=record.result_type,
                            value=quantity_value,
                            unit=unit_code,
                            quantity_key=f"calculation.{record.result_type}.{path}",
                            uncertainty=value.get("uncertainty"),
                            authority=record.source_class,
                            review=record.verification_state,
                            label=f"Calculation result · {record.result_type}",
                            provenance_hash=_payload_hash(record.payload_json),
                            created_at=record.created_at,
                        )
                    )
            for key, child in value.items():
                if isinstance(child, dict):
                    visit(record, child, f"{path}.{key}" if path else key)
                elif isinstance(child, list):
                    for index, item in enumerate(child):
                        if isinstance(item, dict):
                            visit(record, item, f"{path}.{key}[{index}]")

    from .effective_result_state import effective_result_state

    for record in records:
        state = effective_result_state(session, record)
        start = len(claims)
        visit(record, record.payload_json, "")
        for index in range(start, len(claims)):
            claim = claims[index]
            claims[index] = claim.model_copy(
                update={
                    "effective_result_state": state,
                    "semantic_status": "EXPLICIT"
                    if state.eligible_for_derivation
                    else "INACTIVE_SOURCE",
                    "source_label": claim.source_label
                    if state.eligible_for_derivation
                    else state.reason,
                }
            )
    return claims


def get_project_scientific_claims(
    session: Session, identity: Identity, project_id: str, locale: str = "en"
) -> ProjectScientificClaimsOutput:
    project, _member = authorize_project_access(session, identity, project_id)
    claims = _evidence_claims(session, project.id, locale)
    claims.extend(_dataset_claims(session, identity, project.id, locale))
    claims.extend(_calculation_claims(session, project.id))
    # Projected structure records retain their own origin and verification provenance.
    structures = list_structures(session, identity, project.id)
    versions = session.scalars(
        select(StructureVersionRecord)
        .where(StructureVersionRecord.project_id == project.id)
        .order_by(StructureVersionRecord.created_at)
    ).all()
    version_by_id = {row.id: row for row in versions}
    for structure in structures:
        version = version_by_id.get(str(structure.latest_version_id))
        if version is None:
            continue
        prov = session.scalar(
            select(ProvenanceRecordRow).where(
                ProvenanceRecordRow.id == version.provenance_record_id,
                ProvenanceRecordRow.project_id == project.id,
            )
        )
        promoted_candidate = session.scalar(
            select(StructureCandidateRecord).where(
                StructureCandidateRecord.project_id == project.id,
                StructureCandidateRecord.promoted_structure_version_id == version.id,
            )
        )
        source_evidence = (
            session.scalar(
                select(EvidenceCandidateRecord).where(
                    EvidenceCandidateRecord.id == promoted_candidate.source_evidence_id,
                    EvidenceCandidateRecord.project_id == project.id,
                )
            )
            if promoted_candidate
            else None
        )
        source_anchor = (
            session.scalar(
                select(DocumentSourceAnchorRecord).where(
                    DocumentSourceAnchorRecord.id == source_evidence.anchor_id,
                    DocumentSourceAnchorRecord.project_id == project.id,
                )
            )
            if source_evidence and source_evidence.anchor_id
            else None
        )
        claims.append(
            _claim(
                project_id=project.id,
                source_type="structure_version",
                source_id=version.id,
                predicate="structure representation",
                claim_type="STRUCTURE_ASSERTION",
                subject=structure.name,
                value=f"{structure.name} · V{version.revision} ({version.origin})",
                authority=version.origin,
                review=prov.verification_state if prov else "UNVERIFIED",
                label=f"Structure · V{version.revision}",
                document_id=promoted_candidate.source_document_id if promoted_candidate else None,
                evidence_id=source_evidence.id if source_evidence else None,
                page=source_anchor.page_number if source_anchor else None,
                figure=source_anchor.figure_number if source_anchor else None,
                href=(
                    f"/{locale}/projects/{project.id}/workspace?selection="
                    f"structureVersion:{version.id}&source={structure.id}"
                )
                if structure.id and version.id
                else None,
                provenance_hash=_payload_hash(version.representation_json),
                created_at=version.created_at,
            )
        )
    unique_claims: dict[tuple[str, str, str, str, str], ScientificClaim] = {}
    for claim in claims:
        key = (
            str(claim.source_document_id or ""),
            claim.source_authority,
            claim.quantity_key or claim.predicate,
            json.dumps(claim.value, sort_keys=True, default=str),
            claim.unit or "",
        )
        prior = unique_claims.get(key)
        if prior is None or (claim.page or 10**9, str(claim.source_record_id)) < (
            prior.page or 10**9,
            str(prior.source_record_id),
        ):
            unique_claims[key] = claim
    claims = list(unique_claims.values())
    claims.sort(
        key=lambda claim: (
            claim.claim_type,
            claim.subject.casefold(),
            claim.predicate.casefold(),
            str(claim.source_record_id),
        )
    )
    return ProjectScientificClaimsOutput(
        project_id=UUID(project.id), claims=tuple(claims), relations=tuple(_relations(claims))
    )


def add_manual_paper_claim(
    session: Session,
    identity: Identity,
    project_id: str,
    *,
    document_id: str,
    page: int,
    quantity: str,
    value: float,
    unit: str,
    quote: str,
    system: str,
    quantity_key: str | None = None,
) -> dict[str, str]:
    """Store one researcher-typed paper value as USER_ENTERED evidence (a payload row)."""
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    document = session.scalar(
        select(ScientificDocumentRecord).where(
            ScientificDocumentRecord.id == document_id,
            ScientificDocumentRecord.project_id == project.id,
        )
    )
    if document is None:
        raise ScientificReferenceNotFound("The paper is not in this project.")
    anchor = DocumentSourceAnchorRecord(
        project_id=project.id, document_id=document_id, page_number=page, source_type="TEXT",
        x=None, y=None, width=None, height=None, caption=None, figure_number=None,
        table_number=None, snippet=quote[:500],
    )
    session.add(anchor)
    session.flush()
    row = EvidenceCandidateRecord(
        project_id=project.id, document_id=document_id, evidence_type="USER_CLAIM",
        source_class="USER_ENTERED",
        payload_json={
            "quantity": quantity, "value": value, "unit": unit, "quote": quote, "system": system,
            "quantity_key": quantity_key, "entered_by": identity.user_id,
        },
        anchor_id=anchor.id, extraction_method="manual-entry", extractor_version="1",
        diagnostics_json=[], review_state="DETECTED",
    )
    session.add(row)
    session.commit()
    return {"evidence_id": row.id}
