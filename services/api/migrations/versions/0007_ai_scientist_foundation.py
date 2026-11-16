"""Add Phase 8 AI Scientist foundation records."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_ai_scientist_foundation"
down_revision: str | None = "0006_phase7_evidence_ingestion"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _id_project(table: str) -> list[sa.Column]:
    return [
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "ai_conversations",
        *_id_project("ai_conversations"),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_ai_conversations_project_id", "ai_conversations", ["project_id"])

    op.create_table(
        "ai_context_snapshots",
        *_id_project("ai_context_snapshots"),
        sa.Column("schema_version", sa.String(32), nullable=False),
        sa.Column("captured_entity_refs_json", sa.JSON(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_ai_context_snapshots_project_id", "ai_context_snapshots", ["project_id"])

    op.create_table(
        "ai_runs",
        *_id_project("ai_runs"),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("ai_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("current_step", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_steps", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("waiting_calculation_id", sa.String(36), nullable=True),
        sa.Column("context_snapshot_id", sa.String(36), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_ai_runs_project_id", "ai_runs", ["project_id"])
    op.create_index("ix_ai_runs_conversation_id", "ai_runs", ["conversation_id"])

    op.create_table(
        "ai_messages",
        *_id_project("ai_messages"),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("ai_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "run_id", sa.String(36), sa.ForeignKey("ai_runs.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("citations_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_ai_messages_project_id", "ai_messages", ["project_id"])
    op.create_index("ix_ai_messages_conversation_id", "ai_messages", ["conversation_id"])
    op.create_index("ix_ai_messages_run_id", "ai_messages", ["run_id"])

    op.create_table(
        "ai_run_steps",
        *_id_project("ai_run_steps"),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("ai_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_number", sa.Integer(), nullable=False),
        sa.Column("step_type", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("tool_name", sa.String(120), nullable=True),
        sa.Column("tool_version", sa.String(32), nullable=True),
        sa.Column("tool_input_json", sa.JSON(), nullable=True),
        sa.Column("tool_output_json", sa.JSON(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_ai_run_steps_project_id", "ai_run_steps", ["project_id"])
    op.create_index("ix_ai_run_steps_run_id", "ai_run_steps", ["run_id"])

    op.create_table(
        "ai_approvals",
        *_id_project("ai_approvals"),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("ai_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_id", sa.String(36), nullable=True),
        sa.Column("tool_name", sa.String(120), nullable=False),
        sa.Column("tool_version", sa.String(32), nullable=False),
        sa.Column("normalized_arguments_json", sa.JSON(), nullable=False),
        sa.Column("action_fingerprint", sa.String(64), nullable=False),
        sa.Column("scientific_summary", sa.Text(), nullable=False),
        sa.Column("estimated_compute_json", sa.JSON(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("decided_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_ai_approvals_project_id", "ai_approvals", ["project_id"])
    op.create_index("ix_ai_approvals_run_id", "ai_approvals", ["run_id"])
    op.create_index("ix_ai_approvals_action_fingerprint", "ai_approvals", ["action_fingerprint"])

    op.create_table(
        "ai_model_invocations",
        *_id_project("ai_model_invocations"),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("ai_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("prompt_version", sa.String(64), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_ai_model_invocations_project_id", "ai_model_invocations", ["project_id"])
    op.create_index("ix_ai_model_invocations_run_id", "ai_model_invocations", ["run_id"])


def downgrade() -> None:
    op.drop_table("ai_model_invocations")
    op.drop_table("ai_approvals")
    op.drop_table("ai_run_steps")
    op.drop_table("ai_messages")
    op.drop_table("ai_runs")
    op.drop_table("ai_context_snapshots")
    op.drop_table("ai_conversations")
