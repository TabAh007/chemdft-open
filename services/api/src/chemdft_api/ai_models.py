from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
    inspect,
)
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .models import new_id, utc_now


class AIConversationRecord(Base):
    __tablename__ = "ai_conversations"
    __table_args__ = (UniqueConstraint("id", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


class AIContextSnapshotRecord(Base):
    __tablename__ = "ai_context_snapshots"
    __table_args__ = (UniqueConstraint("id", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    schema_version: Mapped[str] = mapped_column(String(32))
    captured_entity_refs_json: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    summary: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class AIRunRecord(Base):
    __tablename__ = "ai_runs"
    __table_args__ = (UniqueConstraint("id", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("ai_conversations.id", ondelete="CASCADE"), index=True
    )
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(32))
    current_step: Mapped[int] = mapped_column(Integer, default=0)
    max_steps: Mapped[int] = mapped_column(Integer, default=10)
    waiting_calculation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    context_snapshot_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    investigation_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Execution state (0027). All transitions are compare-and-set UPDATEs on these columns.
    fencing_epoch: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    state_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_event_sequence: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    budget_json: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


class AIRunEventRecord(Base):
    """Append-only, per-run monotonic activity log (0027)."""

    __tablename__ = "ai_run_events"
    __table_args__ = (UniqueConstraint("run_id", "sequence"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    run_id: Mapped[str] = mapped_column(ForeignKey("ai_runs.id", ondelete="CASCADE"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(64))
    summary: Mapped[str] = mapped_column(Text)
    payload_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    epoch: Mapped[int | None] = mapped_column(Integer, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(default=utc_now)


class AIActionReceiptRecord(Base):
    """Server-owned action identity: unique per (project, action_key), written with the effect."""

    __tablename__ = "ai_run_actions"
    __table_args__ = (UniqueConstraint("project_id", "action_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    run_id: Mapped[str | None] = mapped_column(
        ForeignKey("ai_runs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    action_key: Mapped[str] = mapped_column(String(80))
    tool_name: Mapped[str] = mapped_column(String(120))
    arguments_sha256: Mapped[str] = mapped_column(String(64))
    epoch: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # INTENT -> COMPLETED | FAILED (retryable) | ABANDONED (run stopped)
    status: Mapped[str] = mapped_column(String(16))
    result_json: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    effect_entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class AIMessageRecord(Base):
    __tablename__ = "ai_messages"
    __table_args__ = (UniqueConstraint("id", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("ai_conversations.id", ondelete="CASCADE"), index=True
    )
    run_id: Mapped[str | None] = mapped_column(
        ForeignKey("ai_runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    role: Mapped[str] = mapped_column(String(32))
    content: Mapped[str] = mapped_column(Text)
    citations_json: Mapped[list[dict[str, object]]] = mapped_column(JSON, default=list)
    evidence_refs_json: Mapped[list[dict[str, object]]] = mapped_column(JSON, default=list)
    evidence_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    evidence_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class AIRunStepRecord(Base):
    __tablename__ = "ai_run_steps"
    __table_args__ = (UniqueConstraint("id", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    run_id: Mapped[str] = mapped_column(ForeignKey("ai_runs.id", ondelete="CASCADE"), index=True)
    step_number: Mapped[int] = mapped_column(Integer)
    step_type: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32))
    tool_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    tool_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    tool_input_json: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    tool_output_json: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)


class AIApprovalRecord(Base):
    __tablename__ = "ai_approvals"
    __table_args__ = (UniqueConstraint("id", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    run_id: Mapped[str] = mapped_column(ForeignKey("ai_runs.id", ondelete="CASCADE"), index=True)
    step_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    investigation_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    plan_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tool_name: Mapped[str] = mapped_column(String(120))
    tool_version: Mapped[str] = mapped_column(String(32))
    normalized_arguments_json: Mapped[dict[str, object]] = mapped_column(JSON)
    action_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    scientific_summary: Mapped[str] = mapped_column(Text)
    estimated_compute_json: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32))
    consumed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    organization_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(nullable=True)
    expires_at: Mapped[datetime] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class AIModelInvocationRecord(Base):
    __tablename__ = "ai_model_invocations"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        CheckConstraint("usage_status IN ('REPORTED', 'UNKNOWN', 'LEGACY_UNSPECIFIED')",
                        name="ai_model_invocations_usage_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    run_id: Mapped[str] = mapped_column(ForeignKey("ai_runs.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(120))
    prompt_version: Mapped[str] = mapped_column(String(64))
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    usage_status: Mapped[str] = mapped_column(
        String(24), default="LEGACY_UNSPECIFIED", server_default="LEGACY_UNSPECIFIED"
    )
    reservation_json: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    accounting_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    latency_ms: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class AIPreferenceRecord(Base):
    """Small human preference, never a scientific project setting or credential store."""

    __tablename__ = "ai_user_preferences"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    mode: Mapped[str] = mapped_column(String(16))
    provider: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(120))
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


def _immutable_approval_parameters(_mapper, _connection, target):
    state = inspect(target)
    fields = (
        "project_id",
        "run_id",
        "actor_id",
        "organization_id",
        "tool_name",
        "tool_version",
        "normalized_arguments_json",
        "action_fingerprint",
        "expires_at",
        "scientific_summary",
        "reason",
        "estimated_compute_json",
    )
    if any(state.attrs[field].history.has_changes() for field in fields):
        raise ValueError("Validated approval parameters are immutable; propose a new approval.")


event.listen(AIApprovalRecord, "before_update", _immutable_approval_parameters)
