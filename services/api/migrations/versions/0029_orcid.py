"""ORCID iD links, one-time authorization states and audit events (ADR-044).

New tables only; nothing existing is altered. Downgrade drops them (links are re-creatable by the
researcher through ORCID; no scientific data lives here).
"""

import sqlalchemy as sa
from alembic import op

revision = "0029_orcid"
down_revision = "0028_ai_usage_status"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "orcid_links",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("orcid_id", sa.String(19), nullable=False),
        sa.Column("environment", sa.String(12), nullable=False),
        sa.Column("verified_at", sa.DateTime(), nullable=False),
        sa.Column("display_name", sa.String(160), nullable=True),
        sa.UniqueConstraint("orcid_id", "environment"),
    )
    op.create_table(
        "orcid_auth_states",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("state_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("purpose", sa.String(12), nullable=False),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column("binding_hash", sa.String(64), nullable=True),
        sa.Column("source_hash", sa.String(64), nullable=True),
        sa.Column("code_verifier", sa.String(128), nullable=False),
        sa.Column("nonce", sa.String(64), nullable=False),
        sa.Column("keep_name", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_orcid_auth_states_source_hash", "orcid_auth_states", ["source_hash"])
    op.create_index("ix_orcid_auth_states_created_at", "orcid_auth_states", ["created_at"])
    op.create_table(
        "orcid_audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("event", sa.String(40), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=True),
        sa.Column("outcome", sa.String(12), nullable=False),
        sa.Column("reason", sa.String(60), nullable=True),
    )
    op.create_index("ix_orcid_audit_events_occurred_at", "orcid_audit_events", ["occurred_at"])
    op.create_index("ix_orcid_audit_events_user_id", "orcid_audit_events", ["user_id"])


def downgrade():
    op.drop_table("orcid_audit_events")
    op.drop_table("orcid_auth_states")
    op.drop_table("orcid_links")
