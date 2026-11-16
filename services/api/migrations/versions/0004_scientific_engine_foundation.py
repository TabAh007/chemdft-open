"""Add Phase 5 calculation execution and attempt persistence."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_scientific_engine_foundation"
down_revision: str | None = "0003_molecule_crystal_workspace"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("calculations", sa.Column("idempotency_key", sa.String(200), nullable=True))
    op.add_column("calculations", sa.Column("request_hash", sa.String(64), nullable=True))
    op.create_index(
        "uq_calculations_project_idempotency",
        "calculations",
        ["project_id", "idempotency_key"],
        unique=True,
    )
    op.create_table(
        "calculation_attempts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("calculation_id", sa.String(36), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("worker_id", sa.String(160), nullable=False),
        sa.Column("engine_identity_json", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("failure_code", sa.String(64), nullable=True),
        sa.Column("diagnostic", sa.String(1000), nullable=True),
        sa.Column("raw_artifacts_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["calculation_id", "project_id"],
            ["calculations.id", "calculations.project_id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("calculation_id", "attempt_number"),
    )
    op.create_index("ix_calculation_attempts_project_id", "calculation_attempts", ["project_id"])
    op.create_index(
        "ix_calculation_attempts_calculation_id", "calculation_attempts", ["calculation_id"]
    )
    op.create_index("ix_calculation_attempts_state", "calculation_attempts", ["state"])


def downgrade() -> None:
    op.drop_table("calculation_attempts")
    op.drop_index("uq_calculations_project_idempotency", table_name="calculations")
    op.drop_column("calculations", "request_hash")
    op.drop_column("calculations", "idempotency_key")
