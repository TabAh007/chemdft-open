# ruff: noqa: E501
"""Self-service account profile and account audit events (ADR-045). Additive; no secrets, no tokens."""

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .models import new_id, utc_now


class AccountProfile(Base):
    """Marks an account that signed up by itself and carries its beta limits state.

    Accounts WITHOUT a row (the owner and invited researchers that existed before open signup) are never
    subject to the self-service quotas. `signup_source` is set once, at first provisioning.
    """

    __tablename__ = "account_profiles"
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    signup_source: Mapped[str] = mapped_column(String(16))  # "SELF_SIGNUP"
    email_verified_at: Mapped[datetime | None] = mapped_column(nullable=True)
    terms_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    terms_accepted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    # Per-account override of the AI-for-new-users flag; NULL follows the global flag.
    ai_enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class AccountAuditEvent(Base):
    """Quota refusals, signup provisioning, export and deletion. No email, name or free text."""

    __tablename__ = "account_audit_events"
    __table_args__ = (Index("ix_account_audit_events_user_time", "user_id", "occurred_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    occurred_at: Mapped[datetime] = mapped_column(default=utc_now)
    event: Mapped[str] = mapped_column(String(40))
    # A pseudonymous id kept after deletion; deliberately NOT a foreign key.
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    outcome: Mapped[str] = mapped_column(String(12))
    reason: Mapped[str | None] = mapped_column(String(60), nullable=True)
