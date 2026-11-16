"""Add bounded, project-scoped scientific investigations."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_investigations"
down_revision: str | None = "0009_phase9_production_index"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _id_project() -> list[sa.Column]:
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
        "investigations",
        *_id_project(),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("objective", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("policy_json", sa.JSON(), nullable=False),
        sa.Column("budget_json", sa.JSON(), nullable=False),
        sa.Column("stop_conditions_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_investigations_project_id", "investigations", ["project_id"])
    op.create_index("ix_investigations_status", "investigations", ["status"])
    op.create_table(
        "investigation_hypotheses",
        *_id_project(),
        sa.Column(
            "investigation_id",
            sa.String(36),
            sa.ForeignKey("investigations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("statement", sa.Text(), nullable=False),
        sa.Column("source_class", sa.String(24), nullable=False),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("support_refs_json", sa.JSON(), nullable=False),
        sa.Column("contradiction_refs_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index(
        "ix_investigation_hypotheses_project_id", "investigation_hypotheses", ["project_id"]
    )
    op.create_index(
        "ix_investigation_hypotheses_investigation_id",
        "investigation_hypotheses",
        ["investigation_id"],
    )
    op.create_table(
        "investigation_plans",
        *_id_project(),
        sa.Column(
            "investigation_id",
            sa.String(36),
            sa.ForeignKey("investigations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_investigation_plans_project_id", "investigation_plans", ["project_id"])
    op.create_index(
        "ix_investigation_plans_investigation_id", "investigation_plans", ["investigation_id"]
    )
    op.create_table(
        "investigation_steps",
        *_id_project(),
        sa.Column(
            "plan_id",
            sa.String(36),
            sa.ForeignKey("investigation_plans.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_number", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(160), nullable=False),
        sa.Column("intent", sa.Text(), nullable=False),
        sa.Column("dependencies_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("approval_class", sa.String(32), nullable=False),
        sa.Column("estimated_cost_json", sa.JSON(), nullable=False),
        sa.Column("result_ref_json", sa.JSON()),
        sa.Column("failure_json", sa.JSON()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("plan_id", "step_number"),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_investigation_steps_project_id", "investigation_steps", ["project_id"])
    op.create_index("ix_investigation_steps_plan_id", "investigation_steps", ["plan_id"])
    op.create_table(
        "investigation_observations",
        *_id_project(),
        sa.Column(
            "investigation_id",
            sa.String(36),
            sa.ForeignKey("investigations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "step_id", sa.String(36), sa.ForeignKey("investigation_steps.id", ondelete="SET NULL")
        ),
        sa.Column("source_entity_type", sa.String(64), nullable=False),
        sa.Column("source_entity_id", sa.String(36), nullable=False),
        sa.Column("source_class", sa.String(32), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("citations_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index(
        "ix_investigation_observations_project_id", "investigation_observations", ["project_id"]
    )
    op.create_index(
        "ix_investigation_observations_investigation_id",
        "investigation_observations",
        ["investigation_id"],
    )
    op.create_index(
        "ix_investigation_observations_source_entity_id",
        "investigation_observations",
        ["source_entity_id"],
    )
    op.create_table(
        "investigation_assessments",
        *_id_project(),
        sa.Column(
            "investigation_id",
            sa.String(36),
            sa.ForeignKey("investigations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "hypothesis_id",
            sa.String(36),
            sa.ForeignKey("investigation_hypotheses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("outcome", sa.String(24), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("observation_ids_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index(
        "ix_investigation_assessments_project_id", "investigation_assessments", ["project_id"]
    )
    op.create_index(
        "ix_investigation_assessments_investigation_id",
        "investigation_assessments",
        ["investigation_id"],
    )


def downgrade() -> None:
    for table in (
        "investigation_assessments",
        "investigation_observations",
        "investigation_steps",
        "investigation_plans",
        "investigation_hypotheses",
        "investigations",
    ):
        op.drop_table(table)
