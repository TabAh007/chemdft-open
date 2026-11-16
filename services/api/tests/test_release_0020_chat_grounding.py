"""0.0.20: the selected claim / job / compared results reach the model in the CHAT answer path."""

from __future__ import annotations

import json
from uuid import uuid4

import pytest
from chemdft_api.ai.chat_facts import CHAT_GROUNDED_NOTE, CHAT_REPLY_NOTE
from chemdft_api.ai.gateway import FakeModelGateway, ModelResponse, ModelUsage
from chemdft_api.scientific_models import ScientificDocumentRecord
from sqlalchemy import select
from test_ai_scientist import _create_project, _import_h2
from test_compute_gateway import _queued_energy_job
from test_navigator import seed_projection_result
from test_release_0017_additive import _seed_text

QUESTION = "For the selected item, what is its exact value, unit, source and review state?"


@pytest.fixture
def gateway(monkeypatch):
    requests = []

    def generate(self, request):
        requests.append(request)
        return ModelResponse(content="ok", usage=ModelUsage(input_tokens=50, output_tokens=5, latency_ms=1))

    monkeypatch.setattr(FakeModelGateway, "generate", generate)
    return requests


def _ask(client, project_id, content, **hints):
    conversation = client.post(f"/v1/projects/{project_id}/ai/conversations", json={}).json()[
        "conversation"
    ]["id"]
    response = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conversation}/messages",
        json={"content": content, "mode": "CHAT", **hints},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _claim(api):
    client = api[0]
    _seed_text(api, "Nothing numeric here.")
    with api[1]() as session:
        document = session.scalars(select(ScientificDocumentRecord)).first()
        document_id, project_id = document.id, document.project_id
    created = client.post(
        f"/v1/projects/{project_id}/scientific-claims/manual",
        json={"document_id": document_id, "page": 2, "quantity": "a", "unit": "A",
              "system": "s", "value": 24.48, "quote": "the a axis is 24.480 A"},
    )
    assert created.status_code == 201, created.text
    claims = client.get(f"/v1/projects/{project_id}/scientific-claims?locale=en").json()["claims"]
    return project_id, next(c for c in claims if c["source_authority"] == "USER_ENTERED")


def test_chat_prompt_contains_the_selected_claim_record(api, gateway):
    project_id, claim = _claim(api)
    body = _ask(api[0], project_id, QUESTION, selected_claim_id=claim["id"])
    request = gateway[-1]
    sent = request.messages[-1].content
    assert "[SELECTED STORED RECORDS" in sent and "[END SELECTED STORED RECORDS]" in sent
    assert "evidence_class: USER_ENTERED" in sent
    assert "verification_note: Not independently verified" in sent
    assert "original_value_text: 24.480" in sent and "unit: A" in sent
    assert "review_state:" in sent and "source_authority: USER_ENTERED" in sent
    assert "say it is not in the stored record" in request.system_prompt.replace("\n  ", " ")
    assert body["messages"][-1]["evidence_note"] == CHAT_GROUNDED_NOTE


def test_chat_prompt_contains_the_selected_job(api, gateway, monkeypatch):
    client = api[0]
    project, detail = _queued_energy_job(client, monkeypatch, "chat-job")
    job_id = detail["compute_job"]["id"]
    _ask(client, project["id"], QUESTION, selected_job_id=job_id)
    sent = gateway[-1].messages[-1].content
    assert f"job {job_id}" in sent
    assert "evidence_class: JOB_RECORD" in sent
    assert "method: hf" in sent and "basis: sto-3g" in sent
    assert "not a scientific result" in sent


def test_chat_prompt_contains_compared_results(api, gateway):
    client, sessions, _ = api
    project = _create_project(client)
    version = _import_h2(client, project["id"])
    result_id, _ = seed_projection_result(
        sessions, project["id"], version["version"]["id"],
        payload={"payload_schema": "chemdft.energy", "converged": True,
                 "total_energy": {"value": -1.1, "unit": {"code": "hartree"}}},
    )
    _ask(client, project["id"], QUESTION, compared_result_ids=[result_id])
    sent = gateway[-1].messages[-1].content
    assert f"compared_result {result_id}" in sent
    assert "total_energy: -1.1" in sent and "energy_unit: hartree" in sent
    assert "evidence_class: CALCULATED" in sent


def test_foreign_ids_are_neither_grounded_nor_leaked(api, gateway, monkeypatch):
    client = api[0]
    _project_a, claim = _claim(api)
    other = _create_project(client)["id"]
    _ask(client, other, QUESTION, selected_claim_id=claim["id"], selected_job_id=str(uuid4()))
    request = gateway[-1]
    dumped = json.dumps([m.content for m in request.messages]) + request.system_prompt
    assert claim["id"] not in dumped and "24.480" not in dumped
    assert "evidence_class:" not in dumped
    assert "not found in this project" in dumped


def test_without_ids_the_chat_prompt_is_unchanged(api, gateway):
    client = api[0]
    project = _create_project(client)
    body = _ask(client, project["id"], "tell me about the project")
    request = gateway[-1]
    assert "SELECTED STORED RECORDS" not in request.messages[-1].content
    assert "SELECTED STORED RECORDS" not in request.system_prompt
    assert body["messages"][-1]["evidence_note"] == CHAT_REPLY_NOTE
