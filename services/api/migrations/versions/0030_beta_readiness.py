"""Self-signup account profiles and account audit events (ADR-045).

Strictly additive: two new tables and one index. Nothing existing is altered, dropped or rewritten, and
no rows are inserted. Downgrade drops only these two tables.
"""

import sqlalchemy as sa
from alembic import op

revision = "0030_beta_readiness"
down_revision = "0029_orcid"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "account_profiles",
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("signup_source", sa.String(16), nullable=False),
        sa.Column("email_verified_at", sa.DateTime(), nullable=True),
        sa.Column("terms_version", sa.String(32), nullable=True),
        sa.Column("terms_accepted_at", sa.DateTime(), nullable=True),
        sa.Column("ai_enabled", sa.Boolean(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "account_audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("event", sa.String(40), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=True),
        sa.Column("outcome", sa.String(12), nullable=False),
        sa.Column("reason", sa.String(60), nullable=True),
    )
    op.create_index(
        "ix_account_audit_events_user_time", "account_audit_events", ["user_id", "occurred_at"]
    )


def downgrade():
    op.drop_index("ix_account_audit_events_user_time", table_name="account_audit_events")
    op.drop_table("account_audit_events")
    op.drop_table("account_profiles")
