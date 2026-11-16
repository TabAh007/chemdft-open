from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .models import new_id, utc_now


class InvestigationRecord(Base):
    __tablename__ = "investigations"
    __table_args__ = (UniqueConstraint("id", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    objective: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), index=True, default="DRAFT")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    policy_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    budget_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    stop_conditions_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    lease_owner: Mapped[str | None] = mapped_column(String(160), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    limit_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    state_version: Mapped[int] = mapped_column(default=0)
    user_input_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    last_action_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    repeated_action_count: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


class InvestigationHypothesisRecord(Base):
    __tablename__ = "investigation_hypotheses"
    __table_args__ = (UniqueConstraint("id", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    investigation_id: Mapped[str] = mapped_column(
        ForeignKey("investigations.id", ondelete="CASCADE"), index=True
    )
    statement: Mapped[str] = mapped_column(Text)
    source_class: Mapped[str] = mapped_column(String(24))
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="OPEN")
    support_refs_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    contradiction_refs_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class InvestigationPlanRecord(Base):
    __tablename__ = "investigation_plans"
    __table_args__ = (UniqueConstraint("id", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    investigation_id: Mapped[str] = mapped_column(
        ForeignKey("investigations.id", ondelete="CASCADE"), index=True
    )
    revision: Mapped[int] = mapped_column(default=1)
    status: Mapped[str] = mapped_column(String(24), default="DRAFT")
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class InvestigationStepRecord(Base):
    __tablename__ = "investigation_steps"
    __table_args__ = (
        UniqueConstraint("plan_id", "step_number"),
        UniqueConstraint("id", "project_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    plan_id: Mapped[str] = mapped_column(
        ForeignKey("investigation_plans.id", ondelete="CASCADE"), index=True
    )
    step_number: Mapped[int] = mapped_column()
    action: Mapped[str] = mapped_column(String(160))
    intent: Mapped[str] = mapped_column(Text)
    dependencies_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(32), default="PLANNED")
    approval_class: Mapped[str] = mapped_column(String(32), default="NONE")
    estimated_cost_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    result_ref_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    failure_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class InvestigationObservationRecord(Base):
    __tablename__ = "investigation_observations"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("investigation_id", "step_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    investigation_id: Mapped[str] = mapped_column(
        ForeignKey("investigations.id", ondelete="CASCADE"), index=True
    )
    step_id: Mapped[str | None] = mapped_column(
        ForeignKey("investigation_steps.id", ondelete="SET NULL"), nullable=True
    )
    source_entity_type: Mapped[str] = mapped_column(String(64))
    source_entity_id: Mapped[str] = mapped_column(String(36), index=True)
    source_class: Mapped[str] = mapped_column(String(32))
    summary: Mapped[str] = mapped_column(Text)
    citations_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class InvestigationAssessmentRecord(Base):
    __tablename__ = "investigation_assessments"
    __table_args__ = (UniqueConstraint("id", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    investigation_id: Mapped[str] = mapped_column(
        ForeignKey("investigations.id", ondelete="CASCADE"), index=True
    )
    hypothesis_id: Mapped[str] = mapped_column(
        ForeignKey("investigation_hypotheses.id", ondelete="CASCADE")
    )
    outcome: Mapped[str] = mapped_column(String(24))
    rationale: Mapped[str] = mapped_column(Text)
    observation_ids_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class InvestigationDecisionRecord(Base):
    __tablename__ = "investigation_decisions"
    __table_args__ = (
        UniqueConstraint("investigation_id", "cycle_fingerprint"),
        UniqueConstraint("id", "project_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    investigation_id: Mapped[str] = mapped_column(
        ForeignKey("investigations.id", ondelete="CASCADE"), index=True
    )
    cycle_fingerprint: Mapped[str] = mapped_column(String(64))
    decision_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    rationale: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
