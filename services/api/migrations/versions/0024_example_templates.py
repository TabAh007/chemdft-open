"""PF-5 explicit sealed publication and product copy lineage; no scientific data changes."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_example_templates"
down_revision: str | None = "0023_legacy_ownership"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "example_templates",
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), primary_key=True),
        sa.Column("slug", sa.String(96), nullable=False, unique=True),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("structure_version_id", sa.String(36), nullable=False),
        sa.Column("manifest_sha256", sa.String(64), nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("sealed", sa.Boolean(), nullable=False),
        sa.Column("published", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(
            ["structure_version_id", "project_id"],
            ["structure_versions.id", "structure_versions.project_id"],
        ),
    )
    op.create_table(
        "project_example_origins",
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), primary_key=True),
        sa.Column(
            "template_project_id",
            sa.String(36),
            sa.ForeignKey("example_templates.project_id"),
            nullable=False,
        ),
        sa.Column("template_version", sa.String(32), nullable=False),
        sa.Column("example_slug", sa.String(96), nullable=False),
        sa.Column("template_content_sha256", sa.String(64), nullable=False),
        sa.Column("copied_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("copied_at", sa.DateTime(), nullable=False),
        sa.Column("record_mapping_json", sa.JSON(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("project_example_origins")
    op.drop_table("example_templates")
