"""Persist reconstruction provenance and reviewer checklist state."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_human_reviewed_reconstruction"
down_revision: str | None = "0018_optimization_trajectories"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "candidate_representations",
        sa.Column("coordinate_provenance_json", sa.JSON(), nullable=True),
    )
    op.add_column(
        "candidate_representations",
        sa.Column("cell_provenance_json", sa.JSON(), nullable=True),
    )
    op.add_column(
        "candidate_representation_reviews",
        sa.Column("checklist_json", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("candidate_representation_reviews", "checklist_json")
    op.drop_column("candidate_representations", "cell_provenance_json")
    op.drop_column("candidate_representations", "coordinate_provenance_json")
