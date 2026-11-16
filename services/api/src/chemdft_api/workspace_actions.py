"""Read-only, project-scoped inventory for the scientific workspace."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .context import Identity
from .schemas import WorkspaceHistoryRead
from .scientific_models import AuditEventRecord

_EVENTS: dict[str, tuple[str, str | None, str | None]] = {
    "structure.imported": ("Structure imported", "structure.version", "structureVersion"),
    "structure.version.created": (
        "Structure version created",
        "structure.version",
        "structureVersion",
    ),
    "structure.candidate.promoted": (
        "Structure version committed from candidate",
        "structure.version",
        "structureVersion",
    ),
    "structure_candidate.reviewed": (
        "Structure candidate reviewed",
        "structure.candidate",
        "structureCandidate",
    ),
    "structure_candidate.rejected": (
        "Structure candidate rejected",
        "structure.candidate",
        "structureCandidate",
    ),
    "structure_candidate.promoted": (
        "Structure candidate promoted",
        "structure.candidate",
        "structureCandidate",
    ),
    "calculation.created": ("Calculation submitted", "calculation.record", "calculation"),
    "calculation.failed": ("Calculation failed", "calculation.record", "calculation"),
    "scientific_result.accepted": (
        "Scientific result published",
        "calculation.result",
        "calculationResult",
    ),
}


def list_workspace_history(
    session: Session, identity: Identity, project_id: str
) -> list[WorkspaceHistoryRead]:
    project, _member = authorize_project_access(session, identity, project_id)
    rows = session.scalars(
        select(AuditEventRecord)
        .where(
            AuditEventRecord.project_id == project.id,
            AuditEventRecord.event_name.in_(_EVENTS),
            AuditEventRecord.outcome == "SUCCEEDED",
        )
        .order_by(AuditEventRecord.occurred_at.desc(), AuditEventRecord.id.desc())
        .limit(200)
    ).all()
    events: list[WorkspaceHistoryRead] = []
    for row in rows:
        label, target_type, target_kind = _EVENTS[row.event_name]
        targets = [
            target
            for target in row.targets_json
            if isinstance(target, dict) and target.get("project_id") == project.id
        ]
        target = next(
            (item for item in targets if item.get("entity_type") == target_type), None
        )
        source = next(
            (
                item
                for item in targets
                if item.get("entity_type") in {"structure", "calculation.record"}
            ),
            None,
        )
        events.append(
            WorkspaceHistoryRead(
                id=row.id,
                project_id=project.id,
                event_name=row.event_name,
                label=label,
                occurred_at=row.occurred_at,
                outcome=row.outcome,
                target_kind=target_kind if target else None,
                target_id=str(target["entity_id"]) if target else None,
                source_id=str(source["entity_id"]) if source else None,
            )
        )
    return events
