"""Persist genuine engine geometry evaluations as durable trajectory progress."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018_optimization_trajectories"
down_revision: str | None = "0017_evidence_answers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "optimization_trajectories",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("calculation_id", sa.String(36), nullable=False),
        sa.Column("input_structure_version_id", sa.String(36), nullable=False),
        sa.Column("atom_identities_json", sa.JSON(), nullable=False),
        sa.Column("steps_json", sa.JSON(), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("artifact_id", sa.String(36)),
        sa.Column("artifact_sha256", sa.String(64)),
        sa.Column("final_structure_version_id", sa.String(36)),
        sa.Column("engine_json", sa.JSON()),
        sa.Column("input_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["calculation_id", "project_id"],
            ["calculations.id", "calculations.project_id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("calculation_id"),
    )
    op.create_index(
        "ix_optimization_trajectories_project_id", "optimization_trajectories", ["project_id"]
    )
    op.create_index(
        "ix_optimization_trajectories_calculation_id",
        "optimization_trajectories",
        ["calculation_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_optimization_trajectories_calculation_id", table_name="optimization_trajectories"
    )
    op.drop_index("ix_optimization_trajectories_project_id", table_name="optimization_trajectories")
    op.drop_table("optimization_trajectories")
