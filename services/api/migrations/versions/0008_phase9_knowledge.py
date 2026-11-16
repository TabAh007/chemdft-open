"""Add Phase 9 project knowledge and memory index records."""

# Alembic's compact table declarations are intentionally kept close to the SQL shape.

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_phase9_knowledge"
down_revision: str | None = "0007_ai_scientist_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _id_project() -> list[sa.Column]:
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
        "knowledge_items",
        *_id_project(),
        sa.Column("source_type", sa.String(40), nullable=False),
        sa.Column("source_entity_id", sa.String(36), nullable=False),
        sa.Column("source_revision", sa.String(80)),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("document_id", sa.String(36)),
        sa.Column("page_number", sa.Integer()),
        sa.Column("anchor_id", sa.String(36)),
        sa.Column("evidence_id", sa.String(36)),
        sa.Column("source_class", sa.String(32)),
        sa.Column("verification_state", sa.String(32)),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("normalized_content", sa.Text(), nullable=False),
        sa.Column("chunker_version", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint(
            "project_id", "source_type", "source_entity_id", "source_revision", "content_hash"
        ),
    )
    op.create_index("ix_knowledge_items_project_id", "knowledge_items", ["project_id"])
    op.create_index("ix_knowledge_items_content_hash", "knowledge_items", ["content_hash"])
    op.create_table(
        "knowledge_chunks",
        *_id_project(),
        sa.Column("knowledge_item_id", sa.String(36), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_knowledge_chunks_project_id", "knowledge_chunks", ["project_id"])
    op.create_index(
        "ix_knowledge_chunks_knowledge_item_id", "knowledge_chunks", ["knowledge_item_id"]
    )
    op.create_table(
        "knowledge_embeddings",
        *_id_project(),
        sa.Column("chunk_id", sa.String(36), nullable=False),
        sa.Column("index_version", sa.String(64), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("embedding_model", sa.String(160), nullable=False),
        sa.Column("dimension", sa.Integer(), nullable=False),
        sa.Column("normalized", sa.Boolean(), nullable=False),
        sa.Column("embedding_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("chunk_id", "index_version", "embedding_model"),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_knowledge_embeddings_project_id", "knowledge_embeddings", ["project_id"])
    op.create_table(
        "knowledge_index_states",
        *_id_project(),
        sa.Column("scope_type", sa.String(40), nullable=False),
        sa.Column("scope_id", sa.String(36), nullable=False),
        sa.Column("index_version", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("diagnostic", sa.String(1000)),
        sa.Column("chunk_count", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("project_id", "scope_type", "scope_id", "index_version"),
    )
    op.create_index(
        "ix_knowledge_index_states_project_id", "knowledge_index_states", ["project_id"]
    )
    op.create_table(
        "project_memories",
        *_id_project(),
        sa.Column("memory_type", sa.String(32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("confirmation_state", sa.String(24), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("source_conversation_id", sa.String(36)),
        sa.Column("source_links_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
    )
    op.create_index("ix_project_memories_project_id", "project_memories", ["project_id"])


def downgrade() -> None:
    op.drop_table("project_memories")
    op.drop_table("knowledge_index_states")
    op.drop_table("knowledge_embeddings")
    op.drop_table("knowledge_chunks")
    op.drop_table("knowledge_items")
