from __future__ import annotations

from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import VECTOR
from sqlalchemy import JSON, Float, ForeignKey, String, Text, TypeDecorator, UniqueConstraint, cast
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .models import new_id, utc_now

NATIVE_VECTOR_DIMENSION = 64


class NativeEmbeddingType(TypeDecorator[list[float]]):
    """pgvector on PostgreSQL, JSON on SQLite/test databases."""

    impl = JSON
    cache_ok = True

    class comparator_factory(TypeDecorator.Comparator):  # type: ignore[misc,valid-type]
        def cosine_distance(self, other: list[float]):
            # The distance is a float: without return_type the expression would inherit this vector
            # type and pgvector would try to parse the number as a vector when rows are loaded.
            return self.expr.op("<=>", return_type=Float)(
                cast(other, VECTOR(NATIVE_VECTOR_DIMENSION))
            )

    def load_dialect_impl(self, dialect):  # type: ignore[no-untyped-def]
        if dialect.name == "postgresql":
            return dialect.type_descriptor(VECTOR(NATIVE_VECTOR_DIMENSION))
        return dialect.type_descriptor(JSON())


class KnowledgeItemRecord(Base):
    """Stable identity for an indexable project source."""

    __tablename__ = "knowledge_items"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint(
            "project_id", "source_type", "source_entity_id", "source_revision", "content_hash"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    source_type: Mapped[str] = mapped_column(String(40), index=True)
    source_entity_id: Mapped[str] = mapped_column(String(36), index=True)
    source_revision: Mapped[str | None] = mapped_column(String(80))
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    document_id: Mapped[str | None] = mapped_column(String(36), index=True)
    page_number: Mapped[int | None]
    anchor_id: Mapped[str | None] = mapped_column(String(36), index=True)
    evidence_id: Mapped[str | None] = mapped_column(String(36), index=True)
    source_class: Mapped[str | None] = mapped_column(String(32))
    verification_state: Mapped[str | None] = mapped_column(String(32))
    content: Mapped[str] = mapped_column(Text())
    normalized_content: Mapped[str] = mapped_column(Text())
    chunker_version: Mapped[str] = mapped_column(String(32), default="deterministic-scientific-v1")
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class KnowledgeChunkRecord(Base):
    """A bounded retrieval chunk. It is never an authoritative science record."""

    __tablename__ = "knowledge_chunks"
    __table_args__ = (UniqueConstraint("id", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    knowledge_item_id: Mapped[str] = mapped_column(String(36), index=True)
    ordinal: Mapped[int] = mapped_column(default=0)
    content: Mapped[str] = mapped_column(Text())
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class KnowledgeEmbeddingRecord(Base):
    __tablename__ = "knowledge_embeddings"
    __table_args__ = (
        UniqueConstraint("chunk_id", "index_version", "embedding_model"),
        UniqueConstraint("id", "project_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    chunk_id: Mapped[str] = mapped_column(String(36), index=True)
    index_version: Mapped[str] = mapped_column(String(64), index=True)
    provider: Mapped[str] = mapped_column(String(64))
    embedding_model: Mapped[str] = mapped_column(String(160))
    dimension: Mapped[int]
    normalized: Mapped[bool] = mapped_column(default=True)
    embedding_json: Mapped[list[float]] = mapped_column(JSON, default=list)
    embedding_vector: Mapped[list[float] | None] = mapped_column(NativeEmbeddingType())
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    generation: Mapped[str | None] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class KnowledgeIndexStateRecord(Base):
    __tablename__ = "knowledge_index_states"
    __table_args__ = (UniqueConstraint("project_id", "scope_type", "scope_id", "index_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    scope_type: Mapped[str] = mapped_column(String(40), default="PROJECT")
    scope_id: Mapped[str] = mapped_column(String(36), index=True)
    index_version: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="PENDING")
    diagnostic: Mapped[str | None] = mapped_column(String(1000))
    chunk_count: Mapped[int] = mapped_column(default=0)
    active_generation: Mapped[str | None] = mapped_column(String(64), index=True)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


class KnowledgeIndexJobRecord(Base):
    """Durable asynchronous index generation request and lease."""

    __tablename__ = "knowledge_index_jobs"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("idempotency_key"),
        UniqueConstraint("project_id", "source_revision", "index_version"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    source_type: Mapped[str] = mapped_column(String(40), default="PROJECT")
    source_entity_id: Mapped[str] = mapped_column(String(36), index=True)
    source_revision: Mapped[str] = mapped_column(String(128), index=True)
    index_version: Mapped[str] = mapped_column(String(64), index=True)
    state: Mapped[str] = mapped_column(String(24), index=True, default="PENDING")
    priority: Mapped[int] = mapped_column(default=0)
    idempotency_key: Mapped[str] = mapped_column(String(240), index=True)
    attempt_count: Mapped[int] = mapped_column(default=0)
    max_attempts: Mapped[int] = mapped_column(default=3)
    lease_id: Mapped[str | None] = mapped_column(String(36), index=True)
    lease_owner: Mapped[str | None] = mapped_column(String(160))
    issued_at: Mapped[datetime | None]
    expires_at: Mapped[datetime | None]
    heartbeat_at: Mapped[datetime | None]
    last_error_code: Mapped[str | None] = mapped_column(String(64))
    diagnostic: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


class KnowledgeIndexAttemptRecord(Base):
    __tablename__ = "knowledge_index_attempts"
    __table_args__ = (UniqueConstraint("job_id", "attempt_number"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    job_id: Mapped[str] = mapped_column(
        ForeignKey("knowledge_index_jobs.id", ondelete="CASCADE"), index=True
    )
    attempt_number: Mapped[int]
    worker_id: Mapped[str] = mapped_column(String(160))
    lease_id: Mapped[str] = mapped_column(String(36))
    started_at: Mapped[datetime] = mapped_column(default=utc_now)
    heartbeat_at: Mapped[datetime] = mapped_column(default=utc_now)
    finished_at: Mapped[datetime | None]
    state: Mapped[str] = mapped_column(String(24), default="RUNNING")
    error_code: Mapped[str | None] = mapped_column(String(64))
    diagnostic: Mapped[str | None] = mapped_column(String(1000))


class ProjectMemoryRecord(Base):
    __tablename__ = "project_memories"
    __table_args__ = (UniqueConstraint("id", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    memory_type: Mapped[str] = mapped_column(String(32))
    content: Mapped[str] = mapped_column(Text())
    confirmation_state: Mapped[str] = mapped_column(String(24), default="CONFIRMED")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    source_conversation_id: Mapped[str | None] = mapped_column(String(36))
    source_links_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
