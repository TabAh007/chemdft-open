from __future__ import annotations

from typing import Protocol

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from ..knowledge_models import (
    KnowledgeChunkRecord,
    KnowledgeEmbeddingRecord,
    KnowledgeItemRecord,
)


class KnowledgeVectorIndex(Protocol):
    """Storage-neutral semantic candidate search boundary."""

    def candidates(
        self,
        session: Session,
        *,
        project_id: str,
        index_version: str,
        embedding_model: str,
        query_vector: tuple[float, ...],
        limit: int,
        generation: str | None = None,
    ) -> list[
        tuple[KnowledgeItemRecord, KnowledgeChunkRecord, KnowledgeEmbeddingRecord, float]
    ]: ...


def _base_query(
    project_id: str,
    index_version: str,
    embedding_model: str,
    generation: str | None,
) -> Select:
    # Every adapter begins with the tenant predicate. It is never applied after
    # a global nearest-neighbour query has been evaluated.
    statement = (
        select(KnowledgeItemRecord, KnowledgeChunkRecord, KnowledgeEmbeddingRecord)
        .join(
            KnowledgeChunkRecord,
            KnowledgeChunkRecord.knowledge_item_id == KnowledgeItemRecord.id,
        )
        .join(
            KnowledgeEmbeddingRecord,
            KnowledgeEmbeddingRecord.chunk_id == KnowledgeChunkRecord.id,
        )
        .where(
            KnowledgeItemRecord.project_id == project_id,
            KnowledgeChunkRecord.project_id == project_id,
            KnowledgeEmbeddingRecord.project_id == project_id,
            KnowledgeEmbeddingRecord.index_version == index_version,
            KnowledgeEmbeddingRecord.embedding_model == embedding_model,
        )
    )
    if generation is not None:
        statement = statement.where(KnowledgeEmbeddingRecord.generation == generation)
    return statement


class SQLiteVectorIndex:
    """Portable exact scan used by tests and local development."""

    def candidates(self, session: Session, *, project_id: str, index_version: str,
                   embedding_model: str, query_vector: tuple[float, ...], limit: int,
                   generation: str | None = None):
        from .embeddings import cosine_similarity

        rows = session.execute(
            _base_query(project_id, index_version, embedding_model, generation)
        ).all()
        ranked = [
            (
                item,
                chunk,
                embedding,
                cosine_similarity(tuple(embedding.embedding_json), query_vector),
            )
            for item, chunk, embedding in rows
        ]
        ranked.sort(key=lambda row: (-row[3], row[0].id))
        return ranked[:limit]


class PostgresPgvectorIndex:
    """Exact cosine-distance pgvector search for the production adapter.

    The SQL uses pgvector's `<=>` cosine distance operator. An approximate
    index is intentionally deferred until production corpus sizing justifies
    HNSW/IVFFlat tuning; tenant filtering remains in this DB predicate.
    """

    def candidates(self, session: Session, *, project_id: str, index_version: str,
                   embedding_model: str, query_vector: tuple[float, ...], limit: int,
                   generation: str | None = None):
        distance = KnowledgeEmbeddingRecord.embedding_vector.cosine_distance(list(query_vector))
        rows = session.execute(
            _base_query(project_id, index_version, embedding_model, generation)
            .add_columns(distance)
            .where(KnowledgeEmbeddingRecord.embedding_vector.is_not(None))
            .order_by(distance)
            .limit(limit)
        ).all()
        return [(item, chunk, embedding, max(0.0, 1.0 - float(distance_value)))
                for item, chunk, embedding, distance_value in rows]


def vector_index_for_session(session: Session) -> KnowledgeVectorIndex:
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        return PostgresPgvectorIndex()
    return SQLiteVectorIndex()
