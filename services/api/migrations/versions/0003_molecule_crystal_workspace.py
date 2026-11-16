"""Add Phase 3 molecule and crystal workspace persistence."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_molecule_crystal_workspace"
down_revision: str | None = "0002_scientific_domain_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "structures",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_structures_project_id", "structures", ["project_id"])
    op.create_index("ix_structures_kind", "structures", ["kind"])

    op.create_table(
        "structure_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("structure_id", sa.String(36), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("origin", sa.String(32), nullable=False),
        sa.Column("parent_version_id", sa.String(36), nullable=True),
        sa.Column("canonical_artifact_id", sa.String(36), nullable=False),
        sa.Column("source_artifact_id", sa.String(36), nullable=False),
        sa.Column("coordinate_system", sa.String(24), nullable=False),
        sa.Column("coordinate_unit", sa.String(24), nullable=False),
        sa.Column("atom_count", sa.Integer(), nullable=False),
        sa.Column("bond_count", sa.Integer(), nullable=False),
        sa.Column("overall_charge", sa.Integer(), nullable=False),
        sa.Column("multiplicity", sa.Integer(), nullable=False),
        sa.Column("representation_json", sa.JSON(), nullable=False),
        sa.Column("periodic_cell_json", sa.JSON(), nullable=True),
        sa.Column("diagnostics_json", sa.JSON(), nullable=False),
        sa.Column("provenance_record_id", sa.String(36), nullable=False),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("schema_version", sa.String(32), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("revision >= 1", name="ck_structure_versions_revision_positive"),
        sa.CheckConstraint("multiplicity >= 1", name="ck_structure_versions_multiplicity"),
        sa.ForeignKeyConstraint(
            ["structure_id", "project_id"],
            ["structures.id", "structures.project_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["parent_version_id", "project_id"],
            ["structure_versions.id", "structure_versions.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["canonical_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["source_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
        sa.ForeignKeyConstraint(
            ["provenance_record_id", "project_id"],
            ["provenance_records.id", "provenance_records.project_id"],
        ),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("structure_id", "revision"),
        sa.UniqueConstraint("project_id", "idempotency_key"),
    )
    for column in ("project_id", "structure_id"):
        op.create_index(f"ix_structure_versions_{column}", "structure_versions", [column])


def downgrade() -> None:
    op.drop_table("structure_versions")
    op.drop_table("structures")
