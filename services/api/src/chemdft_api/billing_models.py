"""Internal billing and usage accounting records.

Stripe (or another provider) is an input to these records, never the source of
truth for entitlements or scientific usage. Usage rows are append-only; a
correction is represented by a new adjustment row.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .models import new_id, utc_now


class BillingAccountRecord(Base):
    __tablename__ = "billing_accounts"
    __table_args__ = (UniqueConstraint("organization_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    stripe_customer_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    billing_status: Mapped[str] = mapped_column(String(32), default="NOT_CONFIGURED")
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


class BillingSubscriptionRecord(Base):
    __tablename__ = "billing_subscriptions"
    __table_args__ = (
        UniqueConstraint("provider", "provider_subscription_id"),
        UniqueConstraint("id", "billing_account_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    billing_account_id: Mapped[str] = mapped_column(
        ForeignKey("billing_accounts.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(40), default="stripe")
    provider_subscription_id: Mapped[str] = mapped_column(String(200))
    plan_key: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(32))
    current_period_start: Mapped[datetime]
    current_period_end: Mapped[datetime]
    cancel_at_period_end: Mapped[bool] = mapped_column(default=False)
    trial_end: Mapped[datetime | None] = mapped_column(nullable=True)
    provider_event_created_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_synced_at: Mapped[datetime] = mapped_column(default=utc_now)


class BillingAllowancePeriodRecord(Base):
    __tablename__ = "billing_allowance_periods"
    __table_args__ = (
        UniqueConstraint("billing_account_id", "period_start", "period_end"),
        UniqueConstraint("id", "billing_account_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    billing_account_id: Mapped[str] = mapped_column(
        ForeignKey("billing_accounts.id", ondelete="CASCADE"), index=True
    )
    period_start: Mapped[datetime]
    period_end: Mapped[datetime]
    ai_granted_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    ai_consumed_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    ai_reserved_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    compute_granted_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    compute_consumed_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    compute_reserved_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    ai_overage_policy: Mapped[str] = mapped_column(String(32), default="DENY")
    compute_overage_policy: Mapped[str] = mapped_column(String(32), default="DENY")
    ai_overage_cap_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    compute_overage_cap_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


class AIUsageLedgerEntryRecord(Base):
    __tablename__ = "ai_usage_ledger_entries"
    __table_args__ = (
        UniqueConstraint("billing_account_id", "idempotency_key"),
        UniqueConstraint("id", "billing_account_id"),
        CheckConstraint("usage_status IN ('REPORTED', 'UNKNOWN', 'LEGACY_UNSPECIFIED')",
                        name="ai_usage_ledger_entries_usage_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    billing_account_id: Mapped[str] = mapped_column(
        ForeignKey("billing_accounts.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[str | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    model_invocation_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(120))
    mode: Mapped[str] = mapped_column(String(16))
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cached_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    usage_status: Mapped[str] = mapped_column(
        String(24), default="LEGACY_UNSPECIFIED", server_default="LEGACY_UNSPECIFIED"
    )
    provider_cost_minor_units: Mapped[int | None] = mapped_column(Integer, nullable=True)
    billable_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    period_start: Mapped[datetime]
    period_end: Mapped[datetime]
    idempotency_key: Mapped[str] = mapped_column(String(240))
    entry_kind: Mapped[str] = mapped_column(String(24), default="USAGE")
    adjustment_of_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="POSTED")
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class ComputeUsageLedgerEntryRecord(Base):
    __tablename__ = "compute_usage_ledger_entries"
    __table_args__ = (
        UniqueConstraint("billing_account_id", "idempotency_key"),
        UniqueConstraint("id", "billing_account_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    billing_account_id: Mapped[str] = mapped_column(
        ForeignKey("billing_accounts.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[str | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    compute_job_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    compute_execution_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(40))
    engine: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reserved_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    actual_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    billable_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    period_start: Mapped[datetime]
    period_end: Mapped[datetime]
    idempotency_key: Mapped[str] = mapped_column(String(240))
    entry_kind: Mapped[str] = mapped_column(String(24), default="USAGE")
    adjustment_of_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="POSTED")
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class BillingInvoiceRecord(Base):
    __tablename__ = "billing_invoices"
    __table_args__ = (
        UniqueConstraint("provider", "provider_invoice_id"),
        UniqueConstraint("id", "billing_account_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    billing_account_id: Mapped[str] = mapped_column(
        ForeignKey("billing_accounts.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(40), default="stripe")
    provider_invoice_id: Mapped[str] = mapped_column(String(200))
    period_start: Mapped[datetime]
    period_end: Mapped[datetime]
    status: Mapped[str] = mapped_column(String(32))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    subtotal_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    tax_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    total_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    amount_paid_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    hosted_invoice_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    provider_created_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_synced_at: Mapped[datetime] = mapped_column(default=utc_now)


class BillingWebhookEventRecord(Base):
    __tablename__ = "billing_webhook_events"
    __table_args__ = (UniqueConstraint("provider", "event_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    provider: Mapped[str] = mapped_column(String(40))
    event_id: Mapped[str] = mapped_column(String(240))
    event_type: Mapped[str] = mapped_column(String(160))
    event_created_at: Mapped[datetime | None] = mapped_column(nullable=True)
    payload_sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), default="RECEIVED")
    diagnostic: Mapped[str | None] = mapped_column(Text, nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class BillingReconciliationRecord(Base):
    __tablename__ = "billing_reconciliations"
    __table_args__ = (UniqueConstraint("billing_account_id", "period_start", "period_end"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    billing_account_id: Mapped[str] = mapped_column(
        ForeignKey("billing_accounts.id", ondelete="CASCADE"), index=True
    )
    period_start: Mapped[datetime]
    period_end: Mapped[datetime]
    ai_usage_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    compute_usage_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    invoice_total_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    discrepancy_minor_units: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="PENDING")
    diagnostic: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


class BYOKCredentialRecord(Base):
    __tablename__ = "byok_credentials"
    __table_args__ = (
        UniqueConstraint(
            "billing_account_id", "user_id", "provider", name="uq_byok_account_user_provider"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    billing_account_id: Mapped[str] = mapped_column(
        ForeignKey("billing_accounts.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    validated_at: Mapped[datetime | None] = mapped_column(nullable=True)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)
    secret_reference: Mapped[str | None] = mapped_column(String(500), nullable=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), default="CONFIGURED")
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)


class BillingRateLimitWindowRecord(Base):
    __tablename__ = "billing_rate_limit_windows"
    __table_args__ = (UniqueConstraint("billing_account_id", "limit_key", "window_start"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    billing_account_id: Mapped[str] = mapped_column(
        ForeignKey("billing_accounts.id", ondelete="CASCADE"), index=True
    )
    limit_key: Mapped[str] = mapped_column(String(80))
    window_start: Mapped[datetime]
    count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
