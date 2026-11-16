"""Experimental spectra (IR/FTIR, Raman, UV/Vis).

Additive only: two nullable columns on `experimental_datasets` (parent dataset ids and the spectrum contract) and six new tables
for uploads, hash-bound previews, confirmations, associations, derived-operation idempotency and persisted comparisons.
Existing rows (including frozen digitized XRD/DLS datasets) are untouched: both new columns are NULL for them.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021_experimental_spectra"
down_revision: str | None = "0020_external_imports"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _project_fk() -> sa.Column:
    return sa.Column(
        "project_id",
        sa.String(36),
        sa.ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )


def _created() -> list[sa.Column]:
    return [
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.add_column("experimental_datasets", sa.Column("input_dataset_ids_json", sa.JSON(), nullable=True))
    op.add_column("experimental_datasets", sa.Column("spectrum_json", sa.JSON(), nullable=True))

    op.create_table(
        "experimental_spectrum_uploads",
        sa.Column("id", sa.String(36), primary_key=True),
        _project_fk(),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("technique", sa.String(8), nullable=False),
        sa.Column("raw_artifact_id", sa.String(36)),
        sa.Column("source_filename", sa.String(160), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("source_size_bytes", sa.Integer(), nullable=False),
        *_created(),
        sa.ForeignKeyConstraint(
            ["raw_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("project_id", "idempotency_key"),
    )
    op.create_index("ix_experimental_spectrum_uploads_project_id", "experimental_spectrum_uploads", ["project_id"])
    op.create_index("ix_experimental_spectrum_uploads_technique", "experimental_spectrum_uploads", ["technique"])
    op.create_index("ix_experimental_spectrum_uploads_source_sha256", "experimental_spectrum_uploads", ["source_sha256"])

    op.create_table(
        "experimental_spectrum_previews",
        sa.Column("id", sa.String(36), primary_key=True),
        _project_fk(),
        sa.Column("upload_id", sa.String(36), nullable=False),
        sa.Column("preview_sha256", sa.String(64), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("preview_artifact_id", sa.String(36), nullable=False),
        sa.Column("choices_json", sa.JSON(), nullable=False),
        sa.Column("worker_version", sa.String(64), nullable=False),
        sa.Column("parser_version", sa.String(32), nullable=False),
        *_created(),
        sa.ForeignKeyConstraint(
            ["upload_id", "project_id"],
            ["experimental_spectrum_uploads.id", "experimental_spectrum_uploads.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["preview_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("upload_id", "preview_sha256"),
    )
    op.create_index("ix_experimental_spectrum_previews_project_id", "experimental_spectrum_previews", ["project_id"])
    op.create_index("ix_experimental_spectrum_previews_upload_id", "experimental_spectrum_previews", ["upload_id"])
    op.create_index("ix_experimental_spectrum_previews_preview_sha256", "experimental_spectrum_previews", ["preview_sha256"])

    op.create_table(
        "experimental_spectrum_confirmations",
        sa.Column("id", sa.String(36), primary_key=True),
        _project_fk(),
        sa.Column("upload_id", sa.String(36), nullable=False),
        sa.Column("preview_id", sa.String(36), nullable=False),
        sa.Column("preview_sha256", sa.String(64), nullable=False),
        sa.Column("dataset_id", sa.String(36), nullable=False),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("confirmed_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["upload_id", "project_id"],
            ["experimental_spectrum_uploads.id", "experimental_spectrum_uploads.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["preview_id", "project_id"],
            ["experimental_spectrum_previews.id", "experimental_spectrum_previews.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "project_id"],
            ["experimental_datasets.id", "experimental_datasets.project_id"],
        ),
        sa.UniqueConstraint("upload_id"),
        sa.UniqueConstraint("preview_id"),
        sa.UniqueConstraint("project_id", "idempotency_key"),
    )
    op.create_index("ix_experimental_spectrum_confirmations_project_id", "experimental_spectrum_confirmations", ["project_id"])
    op.create_index("ix_experimental_spectrum_confirmations_dataset_id", "experimental_spectrum_confirmations", ["dataset_id"])

    op.create_table(
        "experimental_spectrum_associations",
        sa.Column("id", sa.String(36), primary_key=True),
        _project_fk(),
        sa.Column("dataset_id", sa.String(36), nullable=False),
        sa.Column("state", sa.String(32), nullable=False),
        sa.Column("structure_id", sa.String(36)),
        sa.Column("sample_label", sa.String(160)),
        sa.Column("note", sa.String(1000)),
        *_created(),
        sa.ForeignKeyConstraint(
            ["dataset_id", "project_id"],
            ["experimental_datasets.id", "experimental_datasets.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_experimental_spectrum_associations_project_id", "experimental_spectrum_associations", ["project_id"])
    op.create_index("ix_experimental_spectrum_associations_dataset_id", "experimental_spectrum_associations", ["dataset_id"])
    op.create_index("ix_experimental_spectrum_associations_structure_id", "experimental_spectrum_associations", ["structure_id"])

    op.create_table(
        "experimental_spectrum_operations",
        sa.Column("id", sa.String(36), primary_key=True),
        _project_fk(),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("request_sha256", sa.String(64), nullable=False),
        sa.Column("parent_dataset_id", sa.String(36), nullable=False),
        sa.Column("dataset_id", sa.String(36), nullable=False),
        sa.Column("op", sa.String(60), nullable=False),
        sa.Column("record_sha256", sa.String(64), nullable=False),
        *_created(),
        sa.ForeignKeyConstraint(
            ["parent_dataset_id", "project_id"],
            ["experimental_datasets.id", "experimental_datasets.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "project_id"],
            ["experimental_datasets.id", "experimental_datasets.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("project_id", "idempotency_key"),
    )
    op.create_index("ix_experimental_spectrum_operations_project_id", "experimental_spectrum_operations", ["project_id"])
    op.create_index("ix_experimental_spectrum_operations_parent_dataset_id", "experimental_spectrum_operations", ["parent_dataset_id"])
    op.create_index("ix_experimental_spectrum_operations_dataset_id", "experimental_spectrum_operations", ["dataset_id"])

    op.create_table(
        "experimental_spectrum_comparisons",
        sa.Column("id", sa.String(36), primary_key=True),
        _project_fk(),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("request_sha256", sa.String(64), nullable=False),
        sa.Column("technique", sa.String(8), nullable=False),
        sa.Column("experimental_dataset_id", sa.String(36), nullable=False),
        sa.Column("peak_set_dataset_id", sa.String(36), nullable=False),
        sa.Column("source_kind", sa.String(24), nullable=False),
        sa.Column("source_id", sa.String(36), nullable=False),
        sa.Column("params_json", sa.JSON(), nullable=False),
        sa.Column("record_json", sa.JSON(), nullable=False),
        sa.Column("record_sha256", sa.String(64), nullable=False),
        sa.Column("worker_version", sa.String(64), nullable=False),
        sa.Column("provenance_record_id", sa.String(36), nullable=False),
        *_created(),
        sa.ForeignKeyConstraint(
            ["experimental_dataset_id", "project_id"],
            ["experimental_datasets.id", "experimental_datasets.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["peak_set_dataset_id", "project_id"],
            ["experimental_datasets.id", "experimental_datasets.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["provenance_record_id", "project_id"],
            ["provenance_records.id", "provenance_records.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("project_id", "idempotency_key"),
    )
    op.create_index("ix_experimental_spectrum_comparisons_project_id", "experimental_spectrum_comparisons", ["project_id"])
    op.create_index("ix_experimental_spectrum_comparisons_technique", "experimental_spectrum_comparisons", ["technique"])
    op.create_index("ix_experimental_spectrum_comparisons_experimental_dataset_id", "experimental_spectrum_comparisons", ["experimental_dataset_id"])
    op.create_index("ix_experimental_spectrum_comparisons_source_id", "experimental_spectrum_comparisons", ["source_id"])


def downgrade() -> None:
    for name in (
        "experimental_spectrum_comparisons",
        "experimental_spectrum_operations",
        "experimental_spectrum_associations",
        "experimental_spectrum_confirmations",
        "experimental_spectrum_previews",
        "experimental_spectrum_uploads",
    ):
        op.drop_table(name)
    with op.batch_alter_table("experimental_datasets") as batch:
        batch.drop_column("spectrum_json")
        batch.drop_column("input_dataset_ids_json")
