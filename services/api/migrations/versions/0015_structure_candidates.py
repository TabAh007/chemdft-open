"""Add non-authoritative structure candidates and append-only representations."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_structure_candidates"
down_revision: str | None = "0014_billing_economics"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "structure_candidates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_type", sa.String(48), nullable=False),
        sa.Column("source_evidence_id", sa.String(36), nullable=False),
        sa.Column("source_document_id", sa.String(36), nullable=False),
        sa.Column("source_anchor_id", sa.String(36), nullable=True),
        sa.Column("candidate_state", sa.String(24), nullable=False),
        sa.Column("provenance_class", sa.String(32), nullable=False),
        sa.Column("method", sa.String(160), nullable=False),
        sa.Column("method_version", sa.String(64), nullable=False),
        sa.Column("approximation", sa.String(80), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("reviewed_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("promoted_structure_version_id", sa.String(36), nullable=True),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("project_id", "source_evidence_id", "source_type"),
        sa.ForeignKeyConstraint(
            ["source_evidence_id", "project_id"],
            ["evidence_candidates.id", "evidence_candidates.project_id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["source_document_id", "project_id"],
            ["scientific_documents.id", "scientific_documents.project_id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["source_anchor_id", "project_id"],
            ["document_source_anchors.id", "document_source_anchors.project_id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["promoted_structure_version_id", "project_id"],
            ["structure_versions.id", "structure_versions.project_id"],
        ),
    )
    op.create_index("ix_structure_candidates_project_id", "structure_candidates", ["project_id"])
    op.create_index(
        "ix_structure_candidates_source_evidence_id",
        "structure_candidates",
        ["source_evidence_id"],
    )
    op.create_index(
        "ix_structure_candidates_source_document_id",
        "structure_candidates",
        ["source_document_id"],
    )
    op.create_index(
        "ix_structure_candidates_candidate_state",
        "structure_candidates",
        ["candidate_state"],
    )
    op.create_table(
        "candidate_representations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("candidate_id", sa.String(36), nullable=False),
        sa.Column("representation_type", sa.String(32), nullable=False),
        sa.Column("provenance_class", sa.String(32), nullable=False),
        sa.Column("method", sa.String(160), nullable=False),
        sa.Column("method_version", sa.String(64), nullable=False),
        sa.Column("approximation", sa.String(80), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
        sa.ForeignKeyConstraint(
            ["candidate_id", "project_id"],
            ["structure_candidates.id", "structure_candidates.project_id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_candidate_representations_project_id", "candidate_representations", ["project_id"]
    )
    op.create_index(
        "ix_candidate_representations_candidate_id", "candidate_representations", ["candidate_id"]
    )
    op.create_table(
        "structure_candidate_reviews",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("candidate_id", sa.String(36), nullable=False),
        sa.Column("decision", sa.String(24), nullable=False),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
        sa.ForeignKeyConstraint(
            ["candidate_id", "project_id"],
            ["structure_candidates.id", "structure_candidates.project_id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_structure_candidate_reviews_project_id",
        "structure_candidate_reviews",
        ["project_id"],
    )
    op.create_index(
        "ix_structure_candidate_reviews_candidate_id",
        "structure_candidate_reviews",
        ["candidate_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_structure_candidate_reviews_candidate_id", table_name="structure_candidate_reviews"
    )
    op.drop_index(
        "ix_structure_candidate_reviews_project_id", table_name="structure_candidate_reviews"
    )
    op.drop_table("structure_candidate_reviews")
    op.drop_index(
        "ix_candidate_representations_candidate_id", table_name="candidate_representations"
    )
    op.drop_index("ix_candidate_representations_project_id", table_name="candidate_representations")
    op.drop_table("candidate_representations")
    op.drop_index("ix_structure_candidates_candidate_state", table_name="structure_candidates")
    op.drop_index("ix_structure_candidates_source_document_id", table_name="structure_candidates")
    op.drop_index("ix_structure_candidates_source_evidence_id", table_name="structure_candidates")
    op.drop_index("ix_structure_candidates_project_id", table_name="structure_candidates")
    op.drop_table("structure_candidates")
