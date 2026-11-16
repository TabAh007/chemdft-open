"""Add Phase 6 compute gateway persistence."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_compute_gateway_foundation"
down_revision: str | None = "0004_scientific_engine_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "compute_estimates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("requirement_hash", sa.String(64), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("provider_summary", sa.String(160), nullable=False),
        sa.Column("runtime_low_seconds", sa.Integer(), nullable=True),
        sa.Column("runtime_high_seconds", sa.Integer(), nullable=True),
        sa.Column("cost_low_json", sa.JSON(), nullable=True),
        sa.Column("cost_high_json", sa.JSON(), nullable=True),
        sa.Column("confidence", sa.String(16), nullable=False),
        sa.Column("assumptions_json", sa.JSON(), nullable=False),
        sa.Column("valid_until", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_compute_estimates_project_id", "compute_estimates", ["project_id"])
    op.create_index(
        "ix_compute_estimates_requirement_hash", "compute_estimates", ["requirement_hash"]
    )
    op.create_index("ix_compute_estimates_provider", "compute_estimates", ["provider"])

    op.create_table(
        "compute_reservations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("estimate_id", sa.String(36), nullable=False),
        sa.Column("authorized_max_json", sa.JSON(), nullable=False),
        sa.Column("actual_cost_json", sa.JSON(), nullable=True),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("reconciled_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["estimate_id", "project_id"],
            ["compute_estimates.id", "compute_estimates.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_compute_reservations_project_id", "compute_reservations", ["project_id"])
    op.create_index("ix_compute_reservations_estimate_id", "compute_reservations", ["estimate_id"])
    op.create_index("ix_compute_reservations_state", "compute_reservations", ["state"])

    op.create_table(
        "compute_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("calculation_id", sa.String(36), nullable=False),
        sa.Column("calculation_input_id", sa.String(36), nullable=False),
        sa.Column("workload_json", sa.JSON(), nullable=False),
        sa.Column("requirement_json", sa.JSON(), nullable=False),
        sa.Column("requirement_hash", sa.String(64), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("estimate_id", sa.String(36), nullable=False),
        sa.Column("reservation_id", sa.String(36), nullable=False),
        sa.Column("submitted_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("retry_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["calculation_id", "project_id"],
            ["calculations.id", "calculations.project_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["calculation_input_id", "project_id"],
            ["calculation_inputs.id", "calculation_inputs.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["estimate_id", "project_id"],
            ["compute_estimates.id", "compute_estimates.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["reservation_id", "project_id"],
            ["compute_reservations.id", "compute_reservations.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("calculation_id"),
        sa.UniqueConstraint("idempotency_key"),
    )
    op.create_index("ix_compute_jobs_project_id", "compute_jobs", ["project_id"])
    op.create_index("ix_compute_jobs_calculation_id", "compute_jobs", ["calculation_id"])
    op.create_index(
        "ix_compute_jobs_calculation_input_id", "compute_jobs", ["calculation_input_id"]
    )
    op.create_index("ix_compute_jobs_requirement_hash", "compute_jobs", ["requirement_hash"])
    op.create_index("ix_compute_jobs_state", "compute_jobs", ["state"])
    op.create_index("ix_compute_jobs_provider", "compute_jobs", ["provider"])
    op.create_index("ix_compute_jobs_idempotency_key", "compute_jobs", ["idempotency_key"])

    op.create_table(
        "compute_executions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("job_id", sa.String(36), nullable=False),
        sa.Column("calculation_id", sa.String(36), nullable=False),
        sa.Column("calculation_attempt_id", sa.String(36), nullable=True),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("provider_execution_ref", sa.String(500), nullable=True),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("worker_id", sa.String(160), nullable=True),
        sa.Column("lease_owner", sa.String(160), nullable=True),
        sa.Column("authorization_hash", sa.String(64), nullable=False),
        sa.Column("authorization_expires_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("environment_json", sa.JSON(), nullable=True),
        sa.Column("hardware_class", sa.String(160), nullable=True),
        sa.Column("metering_json", sa.JSON(), nullable=True),
        sa.Column("actual_cost_json", sa.JSON(), nullable=True),
        sa.Column("raw_artifacts_json", sa.JSON(), nullable=False),
        sa.Column("failure_code", sa.String(64), nullable=True),
        sa.Column("diagnostic", sa.String(1000), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["job_id", "project_id"],
            ["compute_jobs.id", "compute_jobs.project_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["calculation_id", "project_id"],
            ["calculations.id", "calculations.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("provider", "provider_execution_ref"),
    )
    op.create_index("ix_compute_executions_project_id", "compute_executions", ["project_id"])
    op.create_index("ix_compute_executions_job_id", "compute_executions", ["job_id"])
    op.create_index(
        "ix_compute_executions_calculation_id", "compute_executions", ["calculation_id"]
    )
    op.create_index(
        "ix_compute_executions_calculation_attempt_id",
        "compute_executions",
        ["calculation_attempt_id"],
    )
    op.create_index("ix_compute_executions_provider", "compute_executions", ["provider"])
    op.create_index("ix_compute_executions_state", "compute_executions", ["state"])
    op.create_index(
        "ix_compute_executions_authorization_hash",
        "compute_executions",
        ["authorization_hash"],
    )

    op.create_table(
        "compute_leases",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("job_id", sa.String(36), nullable=False),
        sa.Column("execution_id", sa.String(36), nullable=False),
        sa.Column("owner", sa.String(160), nullable=False),
        sa.Column("lease_token_hash", sa.String(64), nullable=False),
        sa.Column("issued_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("heartbeat_deadline_at", sa.DateTime(), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(), nullable=True),
        sa.Column("state", sa.String(24), nullable=False),
        sa.ForeignKeyConstraint(
            ["job_id", "project_id"],
            ["compute_jobs.id", "compute_jobs.project_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["execution_id", "project_id"],
            ["compute_executions.id", "compute_executions.project_id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("lease_token_hash"),
    )
    op.create_index("ix_compute_leases_project_id", "compute_leases", ["project_id"])
    op.create_index("ix_compute_leases_job_id", "compute_leases", ["job_id"])
    op.create_index("ix_compute_leases_execution_id", "compute_leases", ["execution_id"])
    op.create_index("ix_compute_leases_owner", "compute_leases", ["owner"])
    op.create_index("ix_compute_leases_lease_token_hash", "compute_leases", ["lease_token_hash"])
    op.create_index("ix_compute_leases_expires_at", "compute_leases", ["expires_at"])
    op.create_index(
        "ix_compute_leases_heartbeat_deadline_at", "compute_leases", ["heartbeat_deadline_at"]
    )
    op.create_index("ix_compute_leases_state", "compute_leases", ["state"])


def downgrade() -> None:
    op.drop_table("compute_leases")
    op.drop_table("compute_executions")
    op.drop_table("compute_jobs")
    op.drop_table("compute_reservations")
    op.drop_table("compute_estimates")
