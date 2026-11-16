"""Add native pgvector storage and durable knowledge indexing jobs."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_phase9_production_index"
down_revision: str | None = "0008_phase9_knowledge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    if is_postgres:
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
        from pgvector.sqlalchemy import VECTOR

        vector_type = VECTOR(64)
    else:
        vector_type = sa.JSON()

    op.add_column(
        "knowledge_embeddings",
        sa.Column("embedding_vector", vector_type, nullable=True),
    )
    op.add_column(
        "knowledge_embeddings",
        sa.Column("content_hash", sa.String(64), nullable=True),
    )
    op.add_column(
        "knowledge_embeddings",
        sa.Column("generation", sa.String(64), nullable=True),
    )
    op.create_index(
        "ix_knowledge_embeddings_content_hash",
        "knowledge_embeddings",
        ["content_hash"],
    )
    op.create_index(
        "ix_knowledge_embeddings_generation",
        "knowledge_embeddings",
        ["generation"],
    )
    op.execute(
        "UPDATE knowledge_embeddings SET content_hash = "
        "(SELECT content_hash FROM knowledge_chunks "
        "WHERE knowledge_chunks.id = knowledge_embeddings.chunk_id) "
        "WHERE content_hash IS NULL"
    )
    op.add_column(
        "knowledge_index_states",
        sa.Column("active_generation", sa.String(64), nullable=True),
    )

    op.create_table(
        "knowledge_index_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_type", sa.String(40), nullable=False),
        sa.Column("source_entity_id", sa.String(36), nullable=False),
        sa.Column("source_revision", sa.String(128), nullable=False),
        sa.Column("index_version", sa.String(64), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(240), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("lease_id", sa.String(36)),
        sa.Column("lease_owner", sa.String(160)),
        sa.Column("issued_at", sa.DateTime()),
        sa.Column("expires_at", sa.DateTime()),
        sa.Column("heartbeat_at", sa.DateTime()),
        sa.Column("last_error_code", sa.String(64)),
        sa.Column("diagnostic", sa.String(1000)),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id", "project_id"),
        sa.UniqueConstraint("idempotency_key"),
        sa.UniqueConstraint("project_id", "source_revision", "index_version"),
    )
    op.create_index("ix_knowledge_index_jobs_project_id", "knowledge_index_jobs", ["project_id"])
    op.create_index(
        "ix_knowledge_index_jobs_source_entity_id",
        "knowledge_index_jobs",
        ["source_entity_id"],
    )
    op.create_index(
        "ix_knowledge_index_jobs_source_revision",
        "knowledge_index_jobs",
        ["source_revision"],
    )
    op.create_index(
        "ix_knowledge_index_jobs_index_version",
        "knowledge_index_jobs",
        ["index_version"],
    )
    op.create_index("ix_knowledge_index_jobs_state", "knowledge_index_jobs", ["state"])
    op.create_index(
        "ix_knowledge_index_jobs_idempotency_key",
        "knowledge_index_jobs",
        ["idempotency_key"],
    )
    op.create_index("ix_knowledge_index_jobs_lease_id", "knowledge_index_jobs", ["lease_id"])

    op.create_table(
        "knowledge_index_attempts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "job_id",
            sa.String(36),
            sa.ForeignKey("knowledge_index_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("worker_id", sa.String(160), nullable=False),
        sa.Column("lease_id", sa.String(36), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime()),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("error_code", sa.String(64)),
        sa.Column("diagnostic", sa.String(1000)),
        sa.UniqueConstraint("job_id", "attempt_number"),
    )
    op.create_index("ix_knowledge_index_attempts_job_id", "knowledge_index_attempts", ["job_id"])


def downgrade() -> None:
    op.drop_table("knowledge_index_attempts")
    op.drop_table("knowledge_index_jobs")
    op.drop_column("knowledge_index_states", "active_generation")
    op.drop_index("ix_knowledge_embeddings_content_hash", table_name="knowledge_embeddings")
    op.drop_index("ix_knowledge_embeddings_generation", table_name="knowledge_embeddings")
    op.drop_column("knowledge_embeddings", "generation")
    op.drop_column("knowledge_embeddings", "content_hash")
    op.drop_column("knowledge_embeddings", "embedding_vector")
