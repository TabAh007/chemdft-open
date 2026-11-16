"""AI Scientist durable execution state: fencing epoch, event log and action receipts.

Additive only: three nullable/defaulted columns on ai_runs and two new tables. No scientific record
is touched. Downgrade refuses while any event or receipt exists so no execution history is
discarded silently.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027_ai_execution_state"
down_revision: str | None = "0026_saved_comparisons"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("ai_runs") as batch:
        batch.add_column(
            sa.Column("fencing_epoch", sa.Integer(), nullable=False, server_default="1")
        )
        batch.add_column(
            sa.Column("state_version", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(
            sa.Column("last_event_sequence", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(sa.Column("budget_json", sa.JSON(), nullable=True))

    op.create_table(
        "ai_run_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "run_id", sa.String(36), sa.ForeignKey("ai_runs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("epoch", sa.Integer(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("run_id", "sequence"),
    )
    op.create_index("ix_ai_run_events_project_id", "ai_run_events", ["project_id"])
    op.create_index("ix_ai_run_events_run_id", "ai_run_events", ["run_id"])

    op.create_table(
        "ai_run_actions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "run_id", sa.String(36), sa.ForeignKey("ai_runs.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column("action_key", sa.String(80), nullable=False),
        sa.Column("tool_name", sa.String(120), nullable=False),
        sa.Column("arguments_sha256", sa.String(64), nullable=False),
        sa.Column("epoch", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("effect_entity_id", sa.String(36), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("project_id", "action_key"),
    )
    op.create_index("ix_ai_run_actions_project_id", "ai_run_actions", ["project_id"])
    op.create_index("ix_ai_run_actions_run_id", "ai_run_actions", ["run_id"])


def downgrade() -> None:
    bind = op.get_bind()
    for table in ("ai_run_events", "ai_run_actions"):
        if bind.execute(sa.text(f"SELECT COUNT(*) FROM {table}")).scalar():
            raise RuntimeError(
                f"{table} holds execution history; a reviewed migration is required before "
                "downgrade. Nothing is discarded."
            )
    op.drop_index("ix_ai_run_actions_run_id", table_name="ai_run_actions")
    op.drop_index("ix_ai_run_actions_project_id", table_name="ai_run_actions")
    op.drop_table("ai_run_actions")
    op.drop_index("ix_ai_run_events_run_id", table_name="ai_run_events")
    op.drop_index("ix_ai_run_events_project_id", table_name="ai_run_events")
    op.drop_table("ai_run_events")
    with op.batch_alter_table("ai_runs") as batch:
        batch.drop_column("budget_json")
        batch.drop_column("last_event_sequence")
        batch.drop_column("state_version")
        batch.drop_column("fencing_epoch")
