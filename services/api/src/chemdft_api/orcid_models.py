"""ORCID link, one-time authorization state and audit records (ADR-044). No tokens stored."""

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .models import new_id, utc_now


class OrcidLink(Base):
    """An ORCID iD that ORCID authenticated for a ChemDFT user. One per user, one user per iD."""

    __tablename__ = "orcid_links"
    __table_args__ = (UniqueConstraint("orcid_id", "environment"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    orcid_id: Mapped[str] = mapped_column(String(19))
    environment: Mapped[str] = mapped_column(String(12))
    verified_at: Mapped[datetime] = mapped_column(default=utc_now)
    # Kept only when the researcher agreed on the consent screen and ORCID returned a (public) name.
    display_name: Mapped[str | None] = mapped_column(String(160), nullable=True)


class OrcidAuthState(Base):
    """One pending authorization. Only hashes of the secret values are stored; single use."""

    __tablename__ = "orcid_auth_states"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    state_hash: Mapped[str] = mapped_column(String(64), unique=True)
    purpose: Mapped[str] = mapped_column(String(12))  # "link" | "signin"
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    binding_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    code_verifier: Mapped[str] = mapped_column(String(128))
    nonce: Mapped[str] = mapped_column(String(64))
    keep_name: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=utc_now, index=True)
    expires_at: Mapped[datetime]
    consumed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class OrcidAuditEvent(Base):
    """Audit of ORCID actions (refused sign-ins included; no iD for refusals)."""

    __tablename__ = "orcid_audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    occurred_at: Mapped[datetime] = mapped_column(default=utc_now, index=True)
    event: Mapped[str] = mapped_column(String(40))
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    outcome: Mapped[str] = mapped_column(String(12))
    reason: Mapped[str | None] = mapped_column(String(60), nullable=True)
