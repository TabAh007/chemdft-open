"""Prevent duplicate observations for one investigation step."""

from collections.abc import Sequence

from alembic import op

revision: str = "0012_investigation_observation_unique"
down_revision: str | None = "0011_investigation_execution"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "uq_investigation_observations_investigation_step",
        "investigation_observations",
        ["investigation_id", "step_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_investigation_observations_investigation_step",
        "investigation_observations",
    )
