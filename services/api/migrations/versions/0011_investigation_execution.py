"""Add durable investigation execution and approval links."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_investigation_execution"
down_revision: str | None = "0010_investigations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("investigations", sa.Column("lease_owner", sa.String(160), nullable=True))
    op.add_column("investigations", sa.Column("lease_expires_at", sa.DateTime(), nullable=True))
    op.add_column("investigations", sa.Column("started_at", sa.DateTime(), nullable=True))
    op.add_column("investigations", sa.Column("limit_reason", sa.String(64), nullable=True))
    op.add_column("ai_runs", sa.Column("investigation_id", sa.String(36), nullable=True))
    op.create_index("ix_ai_runs_investigation_id", "ai_runs", ["investigation_id"])
    op.add_column("ai_approvals", sa.Column("investigation_id", sa.String(36), nullable=True))
    op.add_column("ai_approvals", sa.Column("plan_revision", sa.Integer(), nullable=True))
    op.create_index("ix_ai_approvals_investigation_id", "ai_approvals", ["investigation_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_approvals_investigation_id", table_name="ai_approvals")
    op.drop_column("ai_approvals", "plan_revision")
    op.drop_column("ai_approvals", "investigation_id")
    op.drop_index("ix_ai_runs_investigation_id", table_name="ai_runs")
    op.drop_column("ai_runs", "investigation_id")
    op.drop_column("investigations", "limit_reason")
    op.drop_column("investigations", "started_at")
    op.drop_column("investigations", "lease_expires_at")
    op.drop_column("investigations", "lease_owner")
