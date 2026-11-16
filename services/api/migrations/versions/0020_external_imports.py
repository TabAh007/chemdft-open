"""External computational imports.

Immutable source/preview records, confirmations, jobs and provider-neutral imported results.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020_external_imports"
down_revision: str | None = "0019_human_reviewed_reconstruction"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _project_fk() -> sa.Column:
    return sa.Column(
        "project_id",
        sa.String(36),
        sa.ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "external_imports",
        sa.Column("id", sa.String(36), primary_key=True),
        _project_fk(),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("raw_artifact_id", sa.String(36)),
        sa.Column("preview_artifact_id", sa.String(36)),
        sa.Column("source_filename", sa.String(160), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("source_size_bytes", sa.Integer(), nullable=False),
        sa.Column("media_class", sa.String(64), nullable=False),
        sa.Column("engine", sa.String(24)),
        sa.Column("program_label", sa.String(80)),
        sa.Column("job_type", sa.String(80)),
        sa.Column("method_value", sa.String(200)),
        sa.Column("basis_value", sa.String(200)),
        sa.Column("preview_sha256", sa.String(64), nullable=False),
        sa.Column("importer_version", sa.String(64), nullable=False),
        sa.Column("normalization_version", sa.String(64), nullable=False),
        sa.Column("parser_commit", sa.String(40), nullable=False),
        sa.Column("parse_timestamp", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("schema_version", sa.String(32), nullable=False, server_default="1.0.0"),
        sa.ForeignKeyConstraint(
            ["raw_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["preview_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("project_id", "idempotency_key"),
    )
    op.create_index("ix_external_imports_project_id", "external_imports", ["project_id"])
    op.create_index("ix_external_imports_state", "external_imports", ["state"])
    op.create_index("ix_external_imports_source_sha256", "external_imports", ["source_sha256"])
    op.create_index("ix_external_imports_preview_sha256", "external_imports", ["preview_sha256"])

    op.create_table(
        "external_import_confirmations",
        sa.Column("id", sa.String(36), primary_key=True),
        _project_fk(),
        sa.Column("import_id", sa.String(36), nullable=False),
        sa.Column("preview_sha256", sa.String(64), nullable=False),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("confirmed_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["import_id", "project_id"], ["external_imports.id", "external_imports.project_id"]
        ),
        sa.UniqueConstraint("import_id"),
        sa.UniqueConstraint("project_id", "idempotency_key"),
    )
    op.create_index(
        "ix_external_import_confirmations_project_id",
        "external_import_confirmations",
        ["project_id"],
    )

    op.create_table(
        "external_import_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        _project_fk(),
        sa.Column("import_id", sa.String(36), nullable=False),
        sa.Column("job_index", sa.Integer(), nullable=False),
        sa.Column("line_start", sa.Integer(), nullable=False),
        sa.Column("line_end", sa.Integer(), nullable=False),
        sa.Column("source_job_type", sa.String(80), nullable=False),
        sa.Column("method_json", sa.JSON(), nullable=False),
        sa.Column("basis_json", sa.JSON(), nullable=False),
        sa.Column("charge", sa.Integer(), nullable=False),
        sa.Column("multiplicity", sa.Integer(), nullable=False),
        sa.Column("termination_json", sa.JSON(), nullable=False),
        sa.Column("convergence_json", sa.JSON(), nullable=False),
        sa.Column("structure_id", sa.String(36), nullable=False),
        sa.Column("structure_version_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["import_id", "project_id"], ["external_imports.id", "external_imports.project_id"]
        ),
        sa.ForeignKeyConstraint(
            ["structure_version_id", "project_id"],
            ["structure_versions.id", "structure_versions.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("import_id", "job_index"),
    )
    op.create_index("ix_external_import_jobs_project_id", "external_import_jobs", ["project_id"])
    op.create_index("ix_external_import_jobs_import_id", "external_import_jobs", ["import_id"])

    op.create_table(
        "imported_results",
        sa.Column("id", sa.String(36), primary_key=True),
        _project_fk(),
        sa.Column("import_id", sa.String(36), nullable=False),
        sa.Column("import_job_id", sa.String(36), nullable=False),
        sa.Column("result_type", sa.String(160), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("payload_sha256", sa.String(64), nullable=False),
        sa.Column("source_class", sa.String(24), nullable=False),
        sa.Column("authority", sa.String(24), nullable=False),
        sa.Column("verification_state", sa.String(24), nullable=False),
        sa.Column("validation_state", sa.String(24), nullable=False),
        sa.Column("producer_type", sa.String(64), nullable=False),
        sa.Column("producer_id", sa.String(160), nullable=False),
        sa.Column("producer_attestation_id", sa.String(160), nullable=False),
        sa.Column("provenance_record_id", sa.String(36), nullable=False),
        sa.Column("source_attributes_json", sa.JSON(), nullable=False),
        sa.Column("source_locators_json", sa.JSON(), nullable=False),
        sa.Column("normalization_version", sa.String(64), nullable=False),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("schema_version", sa.String(32), nullable=False, server_default="1.0.0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["import_id", "project_id"], ["external_imports.id", "external_imports.project_id"]
        ),
        sa.ForeignKeyConstraint(
            ["import_job_id", "project_id"],
            ["external_import_jobs.id", "external_import_jobs.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["provenance_record_id", "project_id"],
            ["provenance_records.id", "provenance_records.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("project_id", "idempotency_key"),
    )
    op.create_index("ix_imported_results_project_id", "imported_results", ["project_id"])
    op.create_index("ix_imported_results_import_id", "imported_results", ["import_id"])
    op.create_index("ix_imported_results_import_job_id", "imported_results", ["import_job_id"])
    op.create_index("ix_imported_results_result_type", "imported_results", ["result_type"])


def downgrade() -> None:
    for name in (
        "imported_results",
        "external_import_jobs",
        "external_import_confirmations",
        "external_imports",
    ):
        op.drop_table(name)
