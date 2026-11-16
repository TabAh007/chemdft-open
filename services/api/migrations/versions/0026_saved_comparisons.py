"""RW-3 saved comparisons: named result selections with a labelled historical snapshot.

Additive only: one new table, no change to any scientific record. Downgrade drops the table and is
refused while any saved comparison exists, so no user selection is discarded silently.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026_saved_comparisons"
down_revision: str | None = "0025_ai_product_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "saved_comparisons",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("result_ids_json", sa.JSON(), nullable=False),
        sa.Column("snapshot_json", sa.JSON(), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_saved_comparisons_project_id", "saved_comparisons", ["project_id"])


def downgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT COUNT(*) FROM saved_comparisons")).scalar():
        raise RuntimeError(
            "Saved comparisons exist; a reviewed migration is required before downgrade. "
            "No saved selection is discarded."
        )
    op.drop_index("ix_saved_comparisons_project_id", table_name="saved_comparisons")
    op.drop_table("saved_comparisons")
