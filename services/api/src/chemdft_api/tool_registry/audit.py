from sqlalchemy.orm import Session

from ..scientific_models import AuditEventRecord, ToolInvocationRecordRow
from .registry import ToolAuditRecord


class SqlAlchemyToolAuditSink:
    def __init__(self, session: Session) -> None:
        self._session = session

    def emit(self, record: ToolAuditRecord) -> None:
        self._session.add(
            ToolInvocationRecordRow(
                request_id=str(record.request_id),
                organization_id=record.organization_id,
                project_id=record.project_id,
                actor_id=record.actor_id,
                tool_name=record.tool_name,
                tool_version=record.tool_version,
                transport=record.transport,
                input_fingerprint=record.input_fingerprint,
                outcome=record.outcome,
                error_code=record.error_code.value if record.error_code else None,
                result_reference=record.result_reference,
                invoked_at=record.invoked_at,
            )
        )
        self._session.add(
            AuditEventRecord(
                event_name=("tool.invoked" if record.outcome == "SUCCEEDED" else "tool.rejected"),
                actor_or_service_id=record.actor_id,
                organization_id=record.organization_id,
                project_id=record.project_id,
                request_id=str(record.request_id),
                tool_name=record.tool_name,
                tool_version=record.tool_version,
                targets_json=[],
                outcome=record.outcome,
                error_category=record.error_code.value if record.error_code else None,
                artifact_references_json=[],
                safe_metadata_json=[
                    {"key": key, "value": value}
                    for key, value in {
                        "provider": record.provider,
                        "model": record.model,
                        "approval_id": record.approval_id,
                        "arguments_sha256": record.input_fingerprint,
                    }.items()
                    if value is not None
                ],
            )
        )
        self._session.commit()
