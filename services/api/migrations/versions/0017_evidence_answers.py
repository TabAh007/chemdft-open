"""Persist evidence answer references and sufficiency with AI messages."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_evidence_answers"
down_revision: str | None = "0016_candidate_representation_revisions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ai_messages", sa.Column("evidence_refs_json", sa.JSON(), nullable=True))
    op.add_column("ai_messages", sa.Column("evidence_status", sa.String(32), nullable=True))
    op.add_column("ai_messages", sa.Column("evidence_note", sa.Text(), nullable=True))
    op.execute("UPDATE ai_messages SET evidence_refs_json = '[]' WHERE evidence_refs_json IS NULL")


def downgrade() -> None:
    op.drop_column("ai_messages", "evidence_note")
    op.drop_column("ai_messages", "evidence_status")
    op.drop_column("ai_messages", "evidence_refs_json")
