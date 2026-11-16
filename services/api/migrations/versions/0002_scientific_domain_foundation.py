"""Create Phase 2 scientific artifacts, lineage, results, and audit records."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_scientific_domain_foundation"
down_revision: str | None = "0001_application_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scientific_artifacts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("media_type", sa.String(160), nullable=False),
        sa.Column("format_identifier", sa.String(120), nullable=False),
        sa.Column("format_version", sa.String(64), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("storage_key", sa.String(500), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("source_relation_type", sa.String(120), nullable=True),
        sa.Column("source_relation_id", sa.String(36), nullable=True),
        sa.Column("compression", sa.String(32), nullable=True),
        sa.Column("schema_version", sa.String(32), nullable=False),
        sa.Column("extensions_json", sa.JSON(), nullable=False),
        sa.CheckConstraint("length(sha256) = 64", name="ck_scientific_artifact_sha256"),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("project_id", "storage_key"),
    )
    op.create_index("ix_scientific_artifacts_project_id", "scientific_artifacts", ["project_id"])
    op.create_index("ix_scientific_artifacts_sha256", "scientific_artifacts", ["sha256"])

    op.create_table(
        "provenance_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("subject_type", sa.String(120), nullable=False),
        sa.Column("subject_id", sa.String(36), nullable=False),
        sa.Column("source_class", sa.String(32), nullable=False),
        sa.Column("detail", sa.String(48), nullable=False),
        sa.Column("verification_state", sa.String(32), nullable=False),
        sa.Column("producer_kind", sa.String(24), nullable=False),
        sa.Column("producer_identifier", sa.String(160), nullable=False),
        sa.Column("producer_software_version", sa.String(64), nullable=True),
        sa.Column("source_artifact_id", sa.String(36), nullable=True),
        sa.Column("operation", sa.String(160), nullable=False),
        sa.Column("operation_version", sa.String(64), nullable=False),
        sa.Column("parameters_json", sa.JSON(), nullable=False),
        sa.Column("approximate", sa.Boolean(), nullable=False),
        sa.Column("supersedes_id", sa.String(36), nullable=True),
        sa.Column("correlation_id", sa.String(36), nullable=False),
        sa.Column("schema_version", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["source_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["supersedes_id", "project_id"],
            ["provenance_records.id", "provenance_records.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_provenance_records_project_id", "provenance_records", ["project_id"])
    op.create_index("ix_provenance_records_subject_id", "provenance_records", ["subject_id"])
    op.create_index(
        "ix_provenance_records_correlation_id", "provenance_records", ["correlation_id"]
    )

    op.create_table(
        "provenance_inputs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("provenance_record_id", sa.String(36), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("input_type", sa.String(24), nullable=False),
        sa.Column("input_id", sa.String(36), nullable=False),
        sa.Column("input_sha256", sa.String(64), nullable=True),
        sa.ForeignKeyConstraint(
            ["provenance_record_id", "project_id"],
            ["provenance_records.id", "provenance_records.project_id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("provenance_record_id", "position"),
    )
    op.create_index(
        "ix_provenance_inputs_provenance_record_id",
        "provenance_inputs",
        ["provenance_record_id"],
    )

    op.create_table(
        "calculations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_calculations_project_id", "calculations", ["project_id"])
    op.create_index("ix_calculations_state", "calculations", ["state"])

    op.create_table(
        "calculation_inputs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("calculation_id", sa.String(36), nullable=False, unique=True),
        sa.Column("structure_version_id", sa.String(36), nullable=False),
        sa.Column("conformer_id", sa.String(36), nullable=True),
        sa.Column("specification_json", sa.JSON(), nullable=False),
        sa.Column("normalized_input_artifact_id", sa.String(36), nullable=False),
        sa.Column("schema_version", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["calculation_id", "project_id"],
            ["calculations.id", "calculations.project_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["normalized_input_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_calculation_inputs_project_id", "calculation_inputs", ["project_id"])
    op.create_index(
        "ix_calculation_inputs_structure_version_id",
        "calculation_inputs",
        ["structure_version_id"],
    )

    op.create_table(
        "calculation_results",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("calculation_id", sa.String(36), nullable=False),
        sa.Column("calculation_input_id", sa.String(36), nullable=False),
        sa.Column("result_type", sa.String(160), nullable=False),
        sa.Column("authority", sa.String(24), nullable=False),
        sa.Column("source_class", sa.String(24), nullable=False),
        sa.Column("verification_state", sa.String(24), nullable=False),
        sa.Column("validation_state", sa.String(24), nullable=False),
        sa.Column("trusted_producer_id", sa.String(160), nullable=False),
        sa.Column("trusted_producer_type", sa.String(64), nullable=False),
        sa.Column("producer_attestation_id", sa.String(160), nullable=False),
        sa.Column("producer_software_json", sa.JSON(), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("provenance_record_id", sa.String(36), nullable=False),
        sa.Column("raw_artifacts_json", sa.JSON(), nullable=False),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("correlation_id", sa.String(36), nullable=False),
        sa.Column("schema_version", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["calculation_id", "project_id"], ["calculations.id", "calculations.project_id"]
        ),
        sa.ForeignKeyConstraint(
            ["calculation_input_id", "project_id"],
            ["calculation_inputs.id", "calculation_inputs.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["provenance_record_id", "project_id"],
            ["provenance_records.id", "provenance_records.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("project_id", "idempotency_key"),
    )
    op.create_index("ix_calculation_results_project_id", "calculation_results", ["project_id"])
    op.create_index(
        "ix_calculation_results_calculation_id", "calculation_results", ["calculation_id"]
    )
    op.create_index("ix_calculation_results_request_id", "calculation_results", ["request_id"])
    op.create_index(
        "ix_calculation_results_correlation_id", "calculation_results", ["correlation_id"]
    )

    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("event_name", sa.String(160), nullable=False),
        sa.Column("actor_or_service_id", sa.String(160), nullable=False),
        sa.Column(
            "organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False
        ),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("tool_name", sa.String(160), nullable=True),
        sa.Column("tool_version", sa.String(32), nullable=True),
        sa.Column("targets_json", sa.JSON(), nullable=False),
        sa.Column("outcome", sa.String(24), nullable=False),
        sa.Column("error_category", sa.String(80), nullable=True),
        sa.Column("approval_reference", sa.String(36), nullable=True),
        sa.Column("artifact_references_json", sa.JSON(), nullable=False),
        sa.Column("safe_metadata_json", sa.JSON(), nullable=False),
        sa.Column("schema_version", sa.String(32), nullable=False),
    )
    for column in ("event_name", "organization_id", "project_id", "request_id"):
        op.create_index(f"ix_audit_events_{column}", "audit_events", [column])

    op.create_table(
        "tool_invocations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column(
            "organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False
        ),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("tool_name", sa.String(160), nullable=False),
        sa.Column("tool_version", sa.String(32), nullable=False),
        sa.Column("transport", sa.String(24), nullable=False),
        sa.Column("input_fingerprint", sa.String(64), nullable=False),
        sa.Column("outcome", sa.String(24), nullable=False),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("result_reference", sa.String(500), nullable=True),
        sa.Column("invoked_at", sa.DateTime(), nullable=False),
    )
    for column in ("request_id", "organization_id", "project_id", "actor_id", "tool_name"):
        op.create_index(f"ix_tool_invocations_{column}", "tool_invocations", [column])


def downgrade() -> None:
    op.drop_table("tool_invocations")
    op.drop_table("audit_events")
    op.drop_table("calculation_results")
    op.drop_table("calculation_inputs")
    op.drop_table("calculations")
    op.drop_table("provenance_inputs")
    op.drop_table("provenance_records")
    op.drop_table("scientific_artifacts")
