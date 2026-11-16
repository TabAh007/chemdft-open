from uuid import UUID, uuid4

from chemdft_api.context import Identity
from chemdft_api.contracts.knowledge import KnowledgeSearchInput
from chemdft_api.knowledge_models import (
    KnowledgeChunkRecord,
    KnowledgeIndexJobRecord,
    KnowledgeItemRecord,
)
from chemdft_api.knowledge_worker import claim_next_job, process_claimed_job
from chemdft_api.tool_registry.catalog import build_application_tool_registry
from chemdft_api.tool_registry.registry import ToolInvocationContext
from sqlalchemy import func, select


def _drain_worker(sessions, settings, worker_id="test-worker"):
    identity = Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id)
    with sessions() as session:
        while True:
            claimed = claim_next_job(session, worker_id)
            if claimed is None:
                return
            process_claimed_job(session, identity, claimed[0], claimed[2])


def test_knowledge_search_is_project_scoped_and_offline(api) -> None:
    client, sessions, _settings = api
    project_a = client.post("/v1/projects", json={"name": "Chromium", "slug": "chromium"}).json()
    project_b = client.post("/v1/projects", json={"name": "Nickel", "slug": "nickel"}).json()

    # Explicit project memories are a safe, deterministic source for the index.
    for project, content in (
        (project_a, "Cr2O3 lattice parameters a = 4.958 angstrom and DOI 10.17223/24135542/33/9"),
        (project_b, "Nickel catalyst lattice parameters a = 3.52 angstrom"),
    ):
        response = client.post(
            f"/v1/projects/{project['id']}/memory",
            json={"memory_type": "PROJECT_NOTE", "content": content},
        )
        assert response.status_code == 201, response.text

    _drain_worker(sessions, _settings)

    response = client.post(
        f"/v1/projects/{project_a['id']}/knowledge/search",
        json={"query": "10.17223/24135542/33/9", "limit": 10},
    )
    assert response.status_code == 200, response.text
    results = response.json()["results"]
    assert len(results) == 1
    assert (
        "chromium" not in results[0]["content"].lower() or "cr2o3" in results[0]["content"].lower()
    )
    assert "embedding" not in response.text
    assert "vector" not in response.text
    isolated = client.post(
        f"/v1/projects/{project_a['id']}/knowledge/search",
        json={"query": "Nickel catalyst", "limit": 10},
    )
    assert isolated.status_code == 200
    assert all("nickel" not in item["content"].lower() for item in isolated.json()["results"])

    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(KnowledgeItemRecord)) == 2
        assert session.scalar(select(func.count()).select_from(KnowledgeChunkRecord)) == 2


def test_knowledge_reindex_is_idempotent_and_status_truthful(api) -> None:
    client, sessions, _settings = api
    project = client.post("/v1/projects", json={"name": "Memory", "slug": "memory"}).json()
    assert (
        client.post(
            f"/v1/projects/{project['id']}/memory",
            json={"memory_type": "USER_CONFIRMED_FACT", "content": "HF/STO-3G was used."},
        ).status_code
        == 201
    )
    _drain_worker(sessions, _settings)
    first = client.post(f"/v1/projects/{project['id']}/knowledge/reindex")
    second = client.post(f"/v1/projects/{project['id']}/knowledge/reindex")
    assert first.status_code == 200
    assert first.json()["status"] in {"PENDING", "READY"}
    _drain_worker(sessions, _settings)
    status = client.get(f"/v1/projects/{project['id']}/knowledge/status")
    assert status.json()["status"] == "READY"
    assert second.json()["status"] in {"PENDING", "READY"}
    assert status.json()["chunk_count"] == 1
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(KnowledgeChunkRecord)) == 1


def test_new_generation_reuses_unchanged_embeddings_without_indexing_stale_chunks(api) -> None:
    client, sessions, settings = api
    project = client.post("/v1/projects", json={"name": "Generation", "slug": "generation"}).json()
    for content in ("XRD peak positions are reported.", "The lattice parameters are reported."):
        response = client.post(
            f"/v1/projects/{project['id']}/memory",
            json={"memory_type": "USER_CONFIRMED_FACT", "content": content},
        )
        assert response.status_code == 201, response.text
        _drain_worker(sessions, settings)

    status = client.get(f"/v1/projects/{project['id']}/knowledge/status").json()
    assert status["status"] == "READY"
    assert status["chunk_count"] == 2
    search = client.post(
        f"/v1/projects/{project['id']}/knowledge/search",
        json={"query": "XRD peak positions", "limit": 10},
    ).json()
    assert any("XRD peak positions" in result["content"] for result in search["results"])
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(KnowledgeItemRecord)) == 2
        assert session.scalar(select(func.count()).select_from(KnowledgeChunkRecord)) == 2


def test_reindex_requeues_a_failed_idempotent_job(api) -> None:
    client, sessions, settings = api
    project = client.post("/v1/projects", json={"name": "Retry", "slug": "retry"}).json()
    assert (
        client.post(
            f"/v1/projects/{project['id']}/memory",
            json={
                "memory_type": "USER_CONFIRMED_FACT",
                "content": "Crystalline diffraction evidence.",
            },
        ).status_code
        == 201
    )
    _drain_worker(sessions, settings)
    with sessions() as session:
        job = session.scalar(
            select(KnowledgeIndexJobRecord).where(
                KnowledgeIndexJobRecord.project_id == project["id"]
            )
        )
        assert job is not None
        job.state = "FAILED"
        job.attempt_count = job.max_attempts
        job.last_error_code = "INDEX_FAILED"
        session.commit()

    response = client.post(f"/v1/projects/{project['id']}/knowledge/reindex")
    assert response.status_code == 200
    with sessions() as session:
        retried = session.scalar(
            select(KnowledgeIndexJobRecord).where(
                KnowledgeIndexJobRecord.project_id == project["id"]
            )
        )
        assert retried is not None
        assert retried.state == "PENDING"
        assert retried.attempt_count == 3
        assert retried.last_error_code is None
    _drain_worker(sessions, settings)
    with sessions() as session:
        completed = session.scalar(
            select(KnowledgeIndexJobRecord).where(
                KnowledgeIndexJobRecord.project_id == project["id"]
            )
        )
        assert completed is not None and completed.state == "SUCCEEDED"


def test_knowledge_search_is_available_through_tool_registry(api) -> None:
    client, sessions, settings = api
    project = client.post(
        "/v1/projects", json={"name": "Tool Search", "slug": "tool-search"}
    ).json()
    assert (
        client.post(
            f"/v1/projects/{project['id']}/memory",
            json={"memory_type": "WORKFLOW_DECISION", "content": "Use B3LYP for comparison."},
        ).status_code
        == 201
    )
    _drain_worker(sessions, settings)
    with sessions() as session:
        registry = build_application_tool_registry(session, object_store=None, settings=settings)  # type: ignore[arg-type]
        output = registry.invoke(
            "knowledge.search",
            KnowledgeSearchInput(query="B3LYP").model_dump(mode="json"),
            ToolInvocationContext(
                request_id=UUID(str(uuid4())),
                identity=Identity(
                    user_id=settings.dev_user_id,
                    organization_id=settings.dev_organization_id,
                ),
                project_id=UUID(project["id"]),
                capabilities=frozenset({"knowledge.read"}),
                approval_references=frozenset(),
                transport="test",
            ),
        )
    assert output.results


def test_search_results_carry_text_late_on_a_long_page(api) -> None:
    from test_ai_scientist import _pdf_with_text

    client, sessions, settings = api
    pid = client.post("/v1/projects", json={"name": "late", "slug": "late-text"}).json()["id"]
    text = ("Filler sentence about the measurement setup. " * 70) + (
        "The calculations were implemented in the WIEN2K computational code. "
    )
    assert len(text) > 3000
    imported = client.post(
        f"/v1/projects/{pid}/documents/imports",
        files={"upload": ("late.pdf", _pdf_with_text(text), "application/pdf")},
    )
    assert imported.status_code == 201, imported.text
    client.post(f"/v1/projects/{pid}/knowledge/reindex")
    _drain_worker(sessions, settings)
    response = client.post(
        f"/v1/projects/{pid}/knowledge/search",
        json={"query": "computational code WIEN2K", "limit": 10},
    )
    assert response.status_code == 200, response.text
    contents = [item["content"] for item in response.json()["results"]]
    assert any(len(c) > 2000 and "WIEN2K computational code" in c for c in contents)


def test_reindex_rebuilds_when_the_stored_index_is_from_different_content(api) -> None:
    from chemdft_api.knowledge_models import KnowledgeIndexStateRecord

    client, sessions, settings = api
    pid = client.post("/v1/projects", json={"name": "k", "slug": "stale-gen"}).json()["id"]
    client.post(
        f"/v1/projects/{pid}/memory", json={"memory_type": "PROJECT_NOTE", "content": "note"}
    )
    client.post(f"/v1/projects/{pid}/knowledge/reindex")
    _drain_worker(sessions, settings)
    with sessions() as session:
        job = session.scalars(select(KnowledgeIndexJobRecord)).one()
        assert job.state == "SUCCEEDED"
        state = session.scalars(select(KnowledgeIndexStateRecord)).one()
        state.active_generation = "built-by-an-older-chunker"  # what a chunker change leaves behind
        session.commit()
    client.post(f"/v1/projects/{pid}/knowledge/reindex")
    with sessions() as session:
        assert session.scalars(select(KnowledgeIndexJobRecord)).one().state == "PENDING"
    _drain_worker(sessions, settings)
    with sessions() as session:
        assert session.scalars(select(KnowledgeIndexStateRecord)).one().active_generation != (
            "built-by-an-older-chunker"
        )
