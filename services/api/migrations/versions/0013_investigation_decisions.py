"""Persist structured investigation decisions and worker state."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_investigation_decisions"
down_revision: str | None = "0012_investigation_observation_unique"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "investigations",
        sa.Column("state_version", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("investigations", sa.Column("user_input_json", sa.JSON(), nullable=True))
    op.add_column(
        "investigations", sa.Column("last_action_fingerprint", sa.String(64), nullable=True)
    )
    op.add_column(
        "investigations",
        sa.Column("repeated_action_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "investigation_decisions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "investigation_id",
            sa.String(36),
            sa.ForeignKey("investigations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("cycle_fingerprint", sa.String(64), nullable=False),
        sa.Column("decision_json", sa.JSON(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("investigation_id", "cycle_fingerprint"),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index(
        "ix_investigation_decisions_project_id", "investigation_decisions", ["project_id"]
    )
    op.create_index(
        "ix_investigation_decisions_investigation_id",
        "investigation_decisions",
        ["investigation_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_investigation_decisions_investigation_id", table_name="investigation_decisions"
    )
    op.drop_index("ix_investigation_decisions_project_id", table_name="investigation_decisions")
    op.drop_table("investigation_decisions")
    op.drop_column("investigations", "repeated_action_count")
    op.drop_column("investigations", "last_action_fingerprint")
    op.drop_column("investigations", "user_input_json")
    op.drop_column("investigations", "state_version")
