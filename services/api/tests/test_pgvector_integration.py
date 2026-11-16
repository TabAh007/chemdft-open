"""Gated production-path pgvector contract test.

Run with CHEMDFT_RUN_POSTGRES_VECTOR_INTEGRATION=1 and a PostgreSQL URL.
Normal CI remains SQLite/offline.
"""

from __future__ import annotations

import os

import pytest
from chemdft_api.database import Base
from chemdft_api.knowledge.embeddings import DeterministicFakeEmbeddingGateway
from chemdft_api.knowledge.vector_index import PostgresPgvectorIndex
from chemdft_api.knowledge_models import (
    KnowledgeChunkRecord,
    KnowledgeEmbeddingRecord,
    KnowledgeItemRecord,
)
from chemdft_api.models import Organization, Project, User, new_id
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import Session


@pytest.mark.skipif(
    os.environ.get("CHEMDFT_RUN_POSTGRES_VECTOR_INTEGRATION") != "1"
    or not os.environ.get("CHEMDFT_DATABASE_URL"),
    reason="set CHEMDFT_RUN_POSTGRES_VECTOR_INTEGRATION=1 and CHEMDFT_DATABASE_URL",
)
def test_pgvector_is_project_scoped_before_nearest_neighbor() -> None:
    engine = create_engine(os.environ["CHEMDFT_DATABASE_URL"])
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
    Base.metadata.create_all(engine)
    gateway = DeterministicFakeEmbeddingGateway()
    project_a, project_b = new_id(), new_id()
    org_id, user_id = new_id(), new_id()
    item_ids: list[str] = []
    with Session(engine) as session:
        session.add_all(
            [
                Organization(id=org_id, name="Phase 9 integration"),
                User(id=user_id, email=f"{user_id}@example.test", display_name="Integration"),
                Project(
                    id=project_a,
                    organization_id=org_id,
                    name="Chromium",
                    slug=project_a[:8],
                    created_by=user_id,
                ),
                Project(
                    id=project_b,
                    organization_id=org_id,
                    name="Nickel",
                    slug=project_b[:8],
                    created_by=user_id,
                ),
            ]
        )
        session.flush()
        for project_id, content in ((project_a, "chromium lattice"), (project_b, "nickel lattice")):
            item_id, chunk_id = new_id(), new_id()
            item_ids.append(item_id)
            vector = gateway.embed_query(content)
            session.add(
                KnowledgeItemRecord(
                    id=item_id,
                    project_id=project_id,
                    source_type="PROJECT_ACTIVITY",
                    source_entity_id=project_id,
                    source_revision="integration",
                    content_hash=vector.vector and "a" * 64,
                    content=content,
                    normalized_content=content,
                )
            )
            session.add(
                KnowledgeChunkRecord(
                    id=chunk_id,
                    project_id=project_id,
                    knowledge_item_id=item_id,
                    content=content,
                    content_hash="b" * 64,
                    metadata_json={},
                )
            )
            session.add(
                KnowledgeEmbeddingRecord(
                    id=new_id(), project_id=project_id, chunk_id=chunk_id,
                    index_version="knowledge-v1", provider=vector.provider,
                    embedding_model=vector.model, dimension=vector.dimension,
                    normalized=True, embedding_json=list(vector.vector),
                    embedding_vector=list(vector.vector), content_hash="b" * 64,
                    generation="integration",
                )
            )
        session.commit()
        query = gateway.embed_query("chromium lattice")
        rows = PostgresPgvectorIndex().candidates(
            session, project_id=project_a, index_version="knowledge-v1",
            embedding_model=gateway.model, query_vector=query.vector, limit=10,
            generation="integration",
        )
        assert rows and all(row[0].project_id == project_a for row in rows)
        assert rows[0][0].content == "chromium lattice"
        assert "embedding" not in str(rows[0][0].__dict__)
        session.execute(delete(KnowledgeEmbeddingRecord).where(KnowledgeEmbeddingRecord.chunk_id.in_(
            session.query(KnowledgeChunkRecord.id).filter(KnowledgeChunkRecord.knowledge_item_id.in_(item_ids))
        )))
        session.execute(delete(KnowledgeChunkRecord).where(KnowledgeChunkRecord.knowledge_item_id.in_(item_ids)))
        session.execute(delete(KnowledgeItemRecord).where(KnowledgeItemRecord.id.in_(item_ids)))
        session.execute(delete(Project).where(Project.id.in_([project_a, project_b])))
        session.execute(delete(User).where(User.id == user_id))
        session.execute(delete(Organization).where(Organization.id == org_id))
        session.commit()
