"""Add organization billing state and append-only usage ledgers."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_billing_economics"
down_revision: str | None = "0013_investigation_decisions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _id_account(table: str) -> list[sa.Column]:
    return [
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "billing_account_id",
            sa.String(36),
            sa.ForeignKey("billing_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
    ]


def _project_column() -> sa.Column:
    return sa.Column(
        "project_id",
        sa.String(36),
        sa.ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )


def upgrade() -> None:
    op.create_table(
        "billing_accounts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("stripe_customer_id", sa.String(160), nullable=True),
        sa.Column("billing_status", sa.String(32), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("organization_id"),
    )
    op.create_index("ix_billing_accounts_organization_id", "billing_accounts", ["organization_id"])
    op.create_table(
        "billing_subscriptions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "billing_account_id",
            sa.String(36),
            sa.ForeignKey("billing_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("provider_subscription_id", sa.String(200), nullable=False),
        sa.Column("plan_key", sa.String(120), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("current_period_start", sa.DateTime(), nullable=False),
        sa.Column("current_period_end", sa.DateTime(), nullable=False),
        sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False),
        sa.Column("trial_end", sa.DateTime(), nullable=True),
        sa.Column("provider_event_created_at", sa.DateTime(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("provider", "provider_subscription_id"),
        sa.UniqueConstraint("id", "billing_account_id"),
    )
    op.create_index(
        "ix_billing_subscriptions_billing_account_id",
        "billing_subscriptions",
        ["billing_account_id"],
    )
    op.create_table(
        "billing_allowance_periods",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "billing_account_id",
            sa.String(36),
            sa.ForeignKey("billing_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("period_start", sa.DateTime(), nullable=False),
        sa.Column("period_end", sa.DateTime(), nullable=False),
        sa.Column("ai_granted_minor_units", sa.Integer(), nullable=False),
        sa.Column("ai_consumed_minor_units", sa.Integer(), nullable=False),
        sa.Column("ai_reserved_minor_units", sa.Integer(), nullable=False),
        sa.Column("compute_granted_minor_units", sa.Integer(), nullable=False),
        sa.Column("compute_consumed_minor_units", sa.Integer(), nullable=False),
        sa.Column("compute_reserved_minor_units", sa.Integer(), nullable=False),
        sa.Column("ai_overage_policy", sa.String(32), nullable=False),
        sa.Column("compute_overage_policy", sa.String(32), nullable=False),
        sa.Column("ai_overage_cap_minor_units", sa.Integer(), nullable=False),
        sa.Column("compute_overage_cap_minor_units", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("billing_account_id", "period_start", "period_end"),
        sa.UniqueConstraint("id", "billing_account_id"),
    )
    op.create_index(
        "ix_billing_allowance_periods_billing_account_id",
        "billing_allowance_periods",
        ["billing_account_id"],
    )

    for table, extra in (
        (
            "ai_usage_ledger_entries",
            [
                _project_column(),
                sa.Column("model_invocation_id", sa.String(36), nullable=True),
                sa.Column("provider", sa.String(64), nullable=False),
                sa.Column("model", sa.String(120), nullable=False),
                sa.Column("mode", sa.String(16), nullable=False),
                sa.Column("input_tokens", sa.Integer(), nullable=False),
                sa.Column("output_tokens", sa.Integer(), nullable=False),
                sa.Column("cached_tokens", sa.Integer(), nullable=False),
                sa.Column("provider_cost_minor_units", sa.Integer(), nullable=True),
                sa.Column("billable_minor_units", sa.Integer(), nullable=False),
                sa.Column("currency", sa.String(3), nullable=False),
                sa.Column("period_start", sa.DateTime(), nullable=False),
                sa.Column("period_end", sa.DateTime(), nullable=False),
                sa.Column("idempotency_key", sa.String(240), nullable=False),
                sa.Column("entry_kind", sa.String(24), nullable=False),
                sa.Column("adjustment_of_id", sa.String(36), nullable=True),
                sa.Column("status", sa.String(24), nullable=False),
                sa.Column("created_at", sa.DateTime(), nullable=False),
            ],
        ),
        (
            "compute_usage_ledger_entries",
            [
                _project_column(),
                sa.Column("compute_job_id", sa.String(36), nullable=True),
                sa.Column("compute_execution_id", sa.String(36), nullable=True),
                sa.Column("provider", sa.String(40), nullable=False),
                sa.Column("engine", sa.String(120), nullable=True),
                sa.Column("reserved_minor_units", sa.Integer(), nullable=False),
                sa.Column("actual_minor_units", sa.Integer(), nullable=False),
                sa.Column("billable_minor_units", sa.Integer(), nullable=False),
                sa.Column("currency", sa.String(3), nullable=False),
                sa.Column("period_start", sa.DateTime(), nullable=False),
                sa.Column("period_end", sa.DateTime(), nullable=False),
                sa.Column("idempotency_key", sa.String(240), nullable=False),
                sa.Column("entry_kind", sa.String(24), nullable=False),
                sa.Column("adjustment_of_id", sa.String(36), nullable=True),
                sa.Column("status", sa.String(24), nullable=False),
                sa.Column("created_at", sa.DateTime(), nullable=False),
            ],
        ),
    ):
        op.create_table(
            table,
            *_id_account(table),
            *extra,
            sa.UniqueConstraint("billing_account_id", "idempotency_key"),
            sa.UniqueConstraint("id", "billing_account_id"),
        )
        op.create_index(f"ix_{table}_billing_account_id", table, ["billing_account_id"])
        op.create_index(f"ix_{table}_project_id", table, ["project_id"])

    op.create_table(
        "billing_invoices",
        *_id_account("billing_invoices"),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("provider_invoice_id", sa.String(200), nullable=False),
        sa.Column("period_start", sa.DateTime(), nullable=False),
        sa.Column("period_end", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("subtotal_minor_units", sa.Integer(), nullable=False),
        sa.Column("tax_minor_units", sa.Integer(), nullable=False),
        sa.Column("total_minor_units", sa.Integer(), nullable=False),
        sa.Column("amount_paid_minor_units", sa.Integer(), nullable=False),
        sa.Column("hosted_invoice_url", sa.String(1000), nullable=True),
        sa.Column("provider_created_at", sa.DateTime(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("provider", "provider_invoice_id"),
        sa.UniqueConstraint("id", "billing_account_id"),
    )
    op.create_index(
        "ix_billing_invoices_billing_account_id", "billing_invoices", ["billing_account_id"]
    )
    op.create_table(
        "billing_webhook_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("event_id", sa.String(240), nullable=False),
        sa.Column("event_type", sa.String(160), nullable=False),
        sa.Column("event_created_at", sa.DateTime(), nullable=True),
        sa.Column("payload_sha256", sa.String(64), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("diagnostic", sa.Text(), nullable=True),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("provider", "event_id"),
    )
    op.create_index("ix_billing_webhook_events_event_id", "billing_webhook_events", ["event_id"])
    op.create_table(
        "billing_reconciliations",
        *_id_account("billing_reconciliations"),
        sa.Column("period_start", sa.DateTime(), nullable=False),
        sa.Column("period_end", sa.DateTime(), nullable=False),
        sa.Column("ai_usage_minor_units", sa.Integer(), nullable=False),
        sa.Column("compute_usage_minor_units", sa.Integer(), nullable=False),
        sa.Column("invoice_total_minor_units", sa.Integer(), nullable=False),
        sa.Column("discrepancy_minor_units", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("diagnostic", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("billing_account_id", "period_start", "period_end"),
    )
    op.create_index(
        "ix_billing_reconciliations_billing_account_id",
        "billing_reconciliations",
        ["billing_account_id"],
    )
    op.create_table(
        "byok_credentials",
        *_id_account("byok_credentials"),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("secret_reference", sa.String(500), nullable=True),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("billing_account_id", "provider"),
    )
    op.create_index(
        "ix_byok_credentials_billing_account_id", "byok_credentials", ["billing_account_id"]
    )
    op.create_table(
        "billing_rate_limit_windows",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "billing_account_id",
            sa.String(36),
            sa.ForeignKey("billing_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("limit_key", sa.String(80), nullable=False),
        sa.Column("window_start", sa.DateTime(), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("billing_account_id", "limit_key", "window_start"),
    )
    op.create_index(
        "ix_billing_rate_limit_windows_billing_account_id",
        "billing_rate_limit_windows",
        ["billing_account_id"],
    )


def downgrade() -> None:
    for table in (
        "billing_rate_limit_windows",
        "byok_credentials",
        "billing_reconciliations",
        "billing_webhook_events",
        "billing_invoices",
        "compute_usage_ledger_entries",
        "ai_usage_ledger_entries",
        "billing_allowance_periods",
        "billing_subscriptions",
        "billing_accounts",
    ):
        op.drop_table(table)
