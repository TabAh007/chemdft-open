"""Saved comparisons: durable selections that are revalidated every time they are opened.

What is stored is a name and an ordered list of project result ids plus a *snapshot* of each
source's identity and standing at save time. The snapshot exists only to tell the researcher what
changed; it is never served as current evidence. Opening recomputes authorization, source identity
(payload hash, provenance record, input) and effective scientific state from the live records.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .calculation_comparison import compare_results
from .calculation_summary import summarize_result
from .context import Identity
from .contracts.analysis import ResultSummary
from .contracts.workflows import (
    SavedComparisonCreate,
    SavedComparisonListOutput,
    SavedComparisonOpenOutput,
    SavedComparisonSnapshot,
    SavedComparisonSource,
    SavedComparisonSummary,
    SourceRevalidation,
)
from .errors import (
    FeatureNotActivated,
    ProjectAccessDenied,
    ScientificReferenceNotFound,
    ScientificValidationFailed,
)
from .project_access import ProjectCapability, can
from .scientific_models import CalculationResultRecord, SavedComparisonRecord

SCHEMA_VERSION = 1

NOTICE = (
    "Saved comparisons store a selection, not a conclusion. Authorization, source identity and "
    "scientific state were re-evaluated when this comparison was opened; the snapshot shows what "
    "was true when it was saved and is historical context only."
)


def table_available(session: Session) -> bool:
    return inspect(session.get_bind()).has_table(SavedComparisonRecord.__tablename__)


def _require_table(session: Session) -> None:
    if not table_available(session):
        raise FeatureNotActivated(
            "Saved comparisons need database migration 0026_saved_comparisons, which has not been "
            "applied to this database."
        )


def payload_sha256(record: CalculationResultRecord) -> str:
    """Same canonical form the derived-result binding uses, so identity checks agree."""
    return hashlib.sha256(
        json.dumps(record.payload_json, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _source(record: CalculationResultRecord, summary: ResultSummary) -> SavedComparisonSource:
    state = summary.effective_state
    assert state is not None  # summarize_result always evaluates it
    return SavedComparisonSource(
        result_id=UUID(record.id),
        calculation_id=UUID(record.calculation_id),
        result_payload_sha256=payload_sha256(record),
        provenance_record_id=UUID(record.provenance_record_id),
        structure_version_id=summary.structure.structure_version_id,
        stored_authority=state.stored_authority,
        stored_validation_state=state.stored_validation_state,
        stored_verification_state=state.stored_verification_state,
        source_lineage_validity=state.source_lineage_validity,
        evidence_use=summary.evidence_use,
    )


def _summary(row: SavedComparisonRecord) -> SavedComparisonSummary:
    return SavedComparisonSummary(
        id=UUID(row.id),
        project_id=UUID(row.project_id),
        name=row.name,
        note=row.note,
        result_ids=tuple(UUID(i) for i in row.result_ids_json),
        created_by=UUID(row.created_by),
        created_at=row.created_at,
        archived=row.archived_at is not None,
        schema_version=row.schema_version,
    )


def list_saved_comparisons(
    session: Session, identity: Identity, project_id: str, *, include_archived: bool = False
) -> SavedComparisonListOutput:
    project, _member = authorize_project_access(session, identity, project_id)
    if not table_available(session):
        return SavedComparisonListOutput(project_id=UUID(project.id), availability="NOT_ACTIVATED")
    query = select(SavedComparisonRecord).where(SavedComparisonRecord.project_id == project.id)
    if not include_archived:
        query = query.where(SavedComparisonRecord.archived_at.is_(None))
    rows = session.scalars(
        query.order_by(SavedComparisonRecord.created_at.desc(), SavedComparisonRecord.id)
    ).all()
    return SavedComparisonListOutput(
        project_id=UUID(project.id),
        availability="ACTIVE",
        comparisons=tuple(_summary(r) for r in rows),
    )


def create_saved_comparison(
    session: Session, identity: Identity, project_id: str, command: SavedComparisonCreate
) -> SavedComparisonSummary:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    _require_table(session)
    ids = [str(i) for i in command.result_ids]
    if len(set(ids)) != len(ids):
        raise ScientificValidationFailed("A comparison cannot select the same result twice.")
    # Running the live comparison proves every id is a result of this project and comparable in
    # kind; a cross-project or unknown id fails exactly like a missing one.
    comparison = compare_results(session, identity, project.id, ids)
    records = {
        r.id: r
        for r in session.scalars(
            select(CalculationResultRecord).where(
                CalculationResultRecord.project_id == project.id,
                CalculationResultRecord.id.in_(ids),
            )
        )
    }
    summaries = {str(s.result_id): s for s in comparison.results}
    snapshot = SavedComparisonSnapshot(
        saved_at=datetime.now(UTC),
        overall=comparison.overall,
        sources=tuple(_source(records[i], summaries[i]) for i in ids),
    )
    row = SavedComparisonRecord(
        project_id=project.id,
        name=command.name,
        note=command.note,
        result_ids_json=ids,
        snapshot_json=snapshot.model_dump(mode="json"),
        schema_version=SCHEMA_VERSION,
        created_by=identity.user_id,
    )
    session.add(row)
    session.commit()
    return _summary(row)


def _row(session: Session, project_id: str, saved_id: str) -> SavedComparisonRecord:
    try:
        UUID(saved_id)
    except ValueError as error:
        raise ScientificReferenceNotFound("Saved comparison does not exist.") from error
    row = session.scalar(
        select(SavedComparisonRecord).where(
            SavedComparisonRecord.id == saved_id, SavedComparisonRecord.project_id == project_id
        )
    )
    if row is None:
        # Identical for "missing" and "belongs to another project".
        raise ScientificReferenceNotFound("Saved comparison does not exist.")
    return row


def _revalidate_source(
    session: Session, project_id: str, saved: SavedComparisonSource
) -> SourceRevalidation:
    record = session.scalar(
        select(CalculationResultRecord).where(
            CalculationResultRecord.id == str(saved.result_id),
            CalculationResultRecord.project_id == project_id,
        )
    )
    if record is None:
        return SourceRevalidation(
            result_id=saved.result_id,
            status="MISSING",
            detail="This result no longer exists in the project; the saved snapshot is historical.",
            saved=saved,
        )
    summary = summarize_result(session, record)
    state = summary.effective_state
    changed_identity = [
        label
        for label, now, then in (
            ("result payload", payload_sha256(record), saved.result_payload_sha256),
            ("provenance record", record.provenance_record_id, str(saved.provenance_record_id)),
            ("calculation", record.calculation_id, str(saved.calculation_id)),
        )
        if now != then
    ]
    if changed_identity:
        status, detail = (
            "SOURCE_CHANGED",
            f"The stored {', '.join(changed_identity)} differs from what was saved.",
        )
    elif state is not None and (
        state.stored_authority,
        state.stored_validation_state,
        state.stored_verification_state,
        state.source_lineage_validity,
        summary.evidence_use,
    ) != (
        saved.stored_authority,
        saved.stored_validation_state,
        saved.stored_verification_state,
        saved.source_lineage_validity,
        saved.evidence_use,
    ):
        status, detail = (
            "STATE_CHANGED",
            f"Scientific standing changed since saving: now {summary.evidence_use} "
            f"(lineage {state.source_lineage_validity}).",
        )
    else:
        status, detail = "UNCHANGED", f"Same source identity and standing ({summary.evidence_use})."
    return SourceRevalidation(
        result_id=saved.result_id,
        status=status,  # type: ignore[arg-type]
        detail=detail,
        saved=saved,
        current_effective_state=state,
        current_evidence_use=summary.evidence_use,
    )


def open_saved_comparison(
    session: Session, identity: Identity, project_id: str, saved_id: str
) -> SavedComparisonOpenOutput:
    project, _member = authorize_project_access(session, identity, project_id)
    _require_table(session)
    row = _row(session, project.id, saved_id)
    snapshot = SavedComparisonSnapshot.model_validate(row.snapshot_json)
    revalidation = tuple(_revalidate_source(session, project.id, s) for s in snapshot.sources)
    missing = any(r.status == "MISSING" for r in revalidation)
    comparison = (
        None if missing else compare_results(session, identity, project.id, row.result_ids_json)
    )
    if missing:
        status = "UNAVAILABLE"
    elif all(r.status == "UNCHANGED" for r in revalidation):
        status = "CURRENT"
    else:
        status = "CHANGED"
    return SavedComparisonOpenOutput(
        saved=_summary(row),
        snapshot=snapshot,
        revalidated_at=datetime.now(UTC),
        status=status,  # type: ignore[arg-type]
        revalidation=revalidation,
        comparison=comparison,
        notice=NOTICE,
    )


def archive_saved_comparison(
    session: Session, identity: Identity, project_id: str, saved_id: str
) -> SavedComparisonSummary:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    _require_table(session)
    row = _row(session, project.id, saved_id)
    if row.archived_at is None:
        row.archived_at = datetime.now(UTC)
        session.commit()
    return _summary(row)
