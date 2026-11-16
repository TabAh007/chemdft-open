"""Authorized, uncached result reads and historical lineage export."""

from sqlalchemy import select

from .actions import authorize_project_access
from .errors import ScientificReferenceNotFound
from .scientific_actions import _result_from_record
from .scientific_models import CalculationResultRecord, ProvenanceInputRow, ProvenanceRecordRow


def get_result(session, identity, project_id, result_id):
    project, _ = authorize_project_access(session, identity, project_id)
    row = session.scalar(
        select(CalculationResultRecord).where(
            CalculationResultRecord.project_id == project.id,
            CalculationResultRecord.id == result_id,
        )
    )
    if row is None:
        raise ScientificReferenceNotFound("Result does not exist in this project.")
    return _result_from_record(row)


def list_results(session, identity, project_id):
    project, _ = authorize_project_access(session, identity, project_id)
    return [
        _result_from_record(row)
        for row in session.scalars(
            select(CalculationResultRecord)
            .where(
                CalculationResultRecord.project_id == project.id,
            )
            .order_by(CalculationResultRecord.created_at, CalculationResultRecord.id)
        )
    ]


def result_lineage_export(session, identity, project_id, result_id):
    result = get_result(session, identity, project_id, result_id)
    pending, seen, results, provenance = [str(result.id)], set(), [], []
    while pending and len(seen) < 32:
        current_id = pending.pop(0)
        if current_id in seen:
            continue
        seen.add(current_id)
        current = get_result(session, identity, project_id, current_id)
        results.append(current.model_dump(mode="json"))
        rows = session.scalars(
            select(ProvenanceRecordRow).where(
                ProvenanceRecordRow.project_id == project_id,
                (ProvenanceRecordRow.id == str(current.provenance_record_id))
                | (ProvenanceRecordRow.supersedes_id == str(current.provenance_record_id)),
            )
        ).all()
        for row in rows:
            item = {c.name: getattr(row, c.name) for c in ProvenanceRecordRow.__table__.columns}
            item["created_at"] = row.created_at.isoformat()
            edges = session.scalars(
                select(ProvenanceInputRow)
                .where(
                    ProvenanceInputRow.project_id == project_id,
                    ProvenanceInputRow.provenance_record_id == row.id,
                )
                .order_by(ProvenanceInputRow.position)
            ).all()
            item["inputs"] = [
                {"type": e.input_type, "id": e.input_id, "sha256": e.input_sha256} for e in edges
            ]
            provenance.append(item)
            for edge in edges:
                if edge.input_type == "calculation.result" and session.scalar(
                    select(CalculationResultRecord.id).where(
                        CalculationResultRecord.id == edge.input_id,
                        CalculationResultRecord.project_id == project_id,
                    )
                ):
                    pending.append(edge.input_id)
    return {
        "schema": "chemdft.result-lineage-export.v1",
        "historical_evidence": True,
        "result": result.model_dump(mode="json"),
        "lineage_results": results,
        "provenance_records": provenance,
        "truncated": bool(pending),
    }
