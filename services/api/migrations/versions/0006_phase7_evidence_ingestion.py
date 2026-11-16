"""Add Phase 7 document, evidence, and experimental dataset records."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_phase7_evidence_ingestion"
down_revision: str | None = "0005_compute_gateway_foundation"
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
        "scientific_documents",
        *_id_project("scientific_documents"),
        sa.Column("raw_artifact_id", sa.String(36), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("media_type", sa.String(160), nullable=False),
        sa.Column("title", sa.String(500)),
        sa.Column("doi", sa.String(240)),
        sa.Column("authors_json", sa.JSON(), nullable=False),
        sa.Column("journal", sa.String(240)),
        sa.Column("publication_year", sa.Integer()),
        sa.Column("language", sa.String(32)),
        sa.Column("page_count", sa.Integer(), nullable=False),
        sa.Column("document_type", sa.String(64), nullable=False),
        sa.Column("parser_identifier", sa.String(160), nullable=False),
        sa.Column("parser_version", sa.String(64), nullable=False),
        sa.Column("text_json", sa.JSON(), nullable=False),
        sa.Column("diagnostics_json", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("project_id", "raw_artifact_id"),
    )
    op.create_index("ix_scientific_documents_project_id", "scientific_documents", ["project_id"])
    op.create_index("ix_scientific_documents_sha256", "scientific_documents", ["sha256"])
    op.create_table(
        "document_source_anchors",
        *_id_project("document_source_anchors"),
        sa.Column("document_id", sa.String(36), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(24), nullable=False),
        sa.Column("x", sa.Float()),
        sa.Column("y", sa.Float()),
        sa.Column("width", sa.Float()),
        sa.Column("height", sa.Float()),
        sa.Column("caption", sa.String(1000)),
        sa.Column("figure_number", sa.String(80)),
        sa.Column("table_number", sa.String(80)),
        sa.Column("snippet", sa.String(4000)),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index(
        "ix_document_source_anchors_project_id", "document_source_anchors", ["project_id"]
    )
    op.create_index(
        "ix_document_source_anchors_document_id", "document_source_anchors", ["document_id"]
    )
    op.create_table(
        "evidence_candidates",
        *_id_project("evidence_candidates"),
        sa.Column("document_id", sa.String(36), nullable=False),
        sa.Column("evidence_type", sa.String(80), nullable=False),
        sa.Column("source_class", sa.String(32), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("anchor_id", sa.String(36)),
        sa.Column("extraction_method", sa.String(160), nullable=False),
        sa.Column("extractor_version", sa.String(64), nullable=False),
        sa.Column("diagnostics_json", sa.JSON(), nullable=False),
        sa.Column("review_state", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_evidence_candidates_project_id", "evidence_candidates", ["project_id"])
    op.create_index("ix_evidence_candidates_document_id", "evidence_candidates", ["document_id"])
    op.create_table(
        "evidence_reviews",
        *_id_project("evidence_reviews"),
        sa.Column("candidate_id", sa.String(36), nullable=False),
        sa.Column("decision", sa.String(24), nullable=False),
        sa.Column("normalized_payload_json", sa.JSON()),
        sa.Column("reason", sa.String(500)),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("candidate_id", "project_id"),
    )
    op.create_index("ix_evidence_reviews_project_id", "evidence_reviews", ["project_id"])
    op.create_index("ix_evidence_reviews_candidate_id", "evidence_reviews", ["candidate_id"])
    op.create_table(
        "experiments",
        *_id_project("experiments"),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("modality", sa.String(24), nullable=False),
        sa.Column("sample_id", sa.String(36)),
        sa.Column("instrument_reference", sa.String(256)),
        sa.Column("conditions_json", sa.JSON(), nullable=False),
        sa.Column("operator_or_source", sa.String(256)),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_experiments_project_id", "experiments", ["project_id"])
    op.create_index("ix_experiments_modality", "experiments", ["modality"])
    op.create_table(
        "experimental_datasets",
        *_id_project("experimental_datasets"),
        sa.Column("experiment_id", sa.String(36), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("artifact_id", sa.String(36), nullable=False),
        sa.Column("source_class", sa.String(32), nullable=False),
        sa.Column("axes_json", sa.JSON(), nullable=False),
        sa.Column("values_json", sa.JSON(), nullable=False),
        sa.Column("point_count", sa.Integer(), nullable=False),
        sa.Column("processing_json", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_experimental_datasets_project_id", "experimental_datasets", ["project_id"])
    op.create_index(
        "ix_experimental_datasets_experiment_id", "experimental_datasets", ["experiment_id"]
    )


def downgrade() -> None:
    op.drop_table("experimental_datasets")
    op.drop_table("experiments")
    op.drop_table("evidence_reviews")
    op.drop_table("evidence_candidates")
    op.drop_table("document_source_anchors")
    op.drop_table("scientific_documents")
