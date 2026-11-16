"""Add immutable candidate representation revisions and review history."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016_candidate_representation_revisions"
down_revision: str | None = "0015_structure_candidates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("candidate_representations", sa.Column("revision", sa.Integer(), nullable=True))
    op.add_column(
        "candidate_representations", sa.Column("content_sha256", sa.String(64), nullable=True)
    )
    op.add_column(
        "candidate_representations",
        sa.Column("representation_origin", sa.String(32), nullable=True),
    )
    op.add_column(
        "candidate_representations", sa.Column("validation_state", sa.String(24), nullable=True)
    )
    op.add_column(
        "candidate_representations",
        sa.Column("validation_diagnostics_json", sa.JSON(), nullable=True),
    )
    op.add_column(
        "candidate_representations",
        sa.Column("generation_parameters_json", sa.JSON(), nullable=True),
    )
    op.add_column(
        "candidate_representations", sa.Column("coordinate_unit", sa.String(24), nullable=True)
    )
    op.add_column(
        "candidate_representations",
        sa.Column("source_representation_id", sa.String(36), nullable=True),
    )

    op.execute(
        """
        UPDATE candidate_representations AS current_representation
        SET revision = (
            SELECT COUNT(*)
            FROM candidate_representations AS preceding_representation
            WHERE preceding_representation.project_id = current_representation.project_id
              AND preceding_representation.candidate_id = current_representation.candidate_id
              AND (
                preceding_representation.created_at < current_representation.created_at
                OR (
                  preceding_representation.created_at = current_representation.created_at
                  AND preceding_representation.id <= current_representation.id
                )
              )
        ),
        representation_origin = CASE
            WHEN representation_type = 'IMAGE_REFERENCE' THEN 'SOURCE_REFERENCE'
            ELSE 'USER_DRAFT'
        END,
        validation_state = CASE
            WHEN representation_type = 'IMAGE_REFERENCE' THEN 'NOT_APPLICABLE'
            ELSE 'PREVIEWABLE'
        END,
        validation_diagnostics_json = '[]',
        generation_parameters_json = '{}'
        """
    )

    with op.batch_alter_table("candidate_representations") as batch:
        batch.alter_column("revision", existing_type=sa.Integer(), nullable=False)
        batch.alter_column("representation_origin", existing_type=sa.String(32), nullable=False)
        batch.alter_column("validation_state", existing_type=sa.String(24), nullable=False)
        batch.alter_column("validation_diagnostics_json", existing_type=sa.JSON(), nullable=False)
        batch.alter_column("generation_parameters_json", existing_type=sa.JSON(), nullable=False)
        batch.create_foreign_key(
            "fk_candidate_representation_source_same_project",
            "candidate_representations",
            ["source_representation_id", "project_id"],
            ["id", "project_id"],
            ondelete="RESTRICT",
        )
    op.create_index(
        "uq_candidate_representation_revision",
        "candidate_representations",
        ["candidate_id", "project_id", "revision"],
        unique=True,
    )
    op.create_index(
        "ix_candidate_representation_content_sha256",
        "candidate_representations",
        ["content_sha256"],
    )
    op.create_index(
        "ix_candidate_representation_source_representation_id",
        "candidate_representations",
        ["source_representation_id"],
    )
    op.create_table(
        "candidate_representation_reviews",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("candidate_id", sa.String(36), nullable=False),
        sa.Column("representation_id", sa.String(36), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["representation_id", "project_id"],
            ["candidate_representations.id", "candidate_representations.project_id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_candidate_representation_reviews_project_id",
        "candidate_representation_reviews",
        ["project_id"],
    )
    op.create_index(
        "ix_candidate_representation_reviews_candidate_id",
        "candidate_representation_reviews",
        ["candidate_id"],
    )
    op.create_index(
        "ix_candidate_representation_reviews_representation_id",
        "candidate_representation_reviews",
        ["representation_id"],
    )


def downgrade() -> None:
    with op.batch_alter_table("candidate_representations") as batch:
        batch.drop_constraint(
            "fk_candidate_representation_source_same_project", type_="foreignkey"
        )
    op.drop_index(
        "ix_candidate_representation_reviews_representation_id",
        table_name="candidate_representation_reviews",
    )
    op.drop_index(
        "ix_candidate_representation_reviews_candidate_id",
        table_name="candidate_representation_reviews",
    )
    op.drop_index(
        "ix_candidate_representation_reviews_project_id",
        table_name="candidate_representation_reviews",
    )
    op.drop_table("candidate_representation_reviews")
    op.drop_index(
        "ix_candidate_representation_source_representation_id",
        table_name="candidate_representations",
    )
    op.drop_index(
        "ix_candidate_representation_content_sha256",
        table_name="candidate_representations",
    )
    op.drop_index(
        "uq_candidate_representation_revision", table_name="candidate_representations"
    )
    op.drop_column("candidate_representations", "source_representation_id")
    op.drop_column("candidate_representations", "coordinate_unit")
    op.drop_column("candidate_representations", "generation_parameters_json")
    op.drop_column("candidate_representations", "validation_diagnostics_json")
    op.drop_column("candidate_representations", "validation_state")
    op.drop_column("candidate_representations", "representation_origin")
    op.drop_column("candidate_representations", "content_sha256")
    op.drop_column("candidate_representations", "revision")
