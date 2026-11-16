"""0.0.18: compared_result_ids / selected_claim_id / selected_job_id ground the AI context."""

from __future__ import annotations

import json
from uuid import uuid4

from chemdft_api.contracts.ai_foundation import ProductContext, ProductSelection
from chemdft_api.scientific_models import ScientificDocumentRecord
from sqlalchemy import select
from test_ai_foundation import context
from test_ai_scientist import _create_project, _import_h2
from test_compute_gateway import _queued_energy_job
from test_navigator import seed_projection_result
from test_release_0017_additive import _seed_text


def _result(client, sessions, name):
    project = _create_project(client)
    version = _import_h2(client, project["id"])
    result_id, _calc = seed_projection_result(
        sessions,
        project["id"],
        version["version"]["id"],
        payload={
            "payload_schema": "chemdft.energy",
            "converged": True,
            "total_energy": {"value": -1.1, "unit": {"code": "hartree"}},
        },
    )
    return project["id"], result_id



def test_absent_ids_leave_the_context_as_before(api):
    client, _, _ = api
    project = _create_project(client)
    data = context(client, project["id"])
    # Absent, not empty: the payload is exactly the previous release's.
    assert not {"grounding_facts", "grounding_notes", "grounding_policy"} & set(data)
    assert "compared_result_ids" not in data["selection"]
    assert "selected_claim_id" not in data["selection"]


def test_compared_results_are_grounded_from_stored_values(api):
    client, sessions, _ = api
    project, result_id = _result(client, sessions, "a")
    data = context(client, project, {"compared_result_ids": [result_id]})
    fact = data["grounding_facts"][0]
    assert fact["kind"] == "compared_result" and fact["entity_id"] == result_id
    assert fact["evidence_class"] == "CALCULATED"
    assert fact["facts"]["total_energy"] == -1.1 and fact["facts"]["energy_unit"] == "hartree"
    assert data["selection"]["compared_result_ids"] == [result_id]
    assert "never invent" in data["grounding_policy"].lower()


def test_ids_from_another_project_are_not_grounded_and_not_leaked(api, monkeypatch):
    client, sessions, _ = api
    _project_a, foreign_result = _result(client, sessions, "a")
    project_b = _create_project(client)["id"]
    _, detail = _queued_energy_job(client, monkeypatch, "foreign-job")
    foreign_job = detail["compute_job"]["id"]
    random_claim = str(uuid4())
    data = context(
        client,
        project_b,
        {
            "compared_result_ids": [foreign_result],
            "selected_job_id": foreign_job,
            "selected_claim_id": random_claim,
        },
    )
    assert data["grounding_facts"] == []
    assert data["grounding_notes"] == ["A selected item was not found in this project and is not used."]
    assert not {"compared_result_ids", "selected_job_id", "selected_claim_id"} & set(
        data["selection"]
    )
    dumped = json.dumps(data)
    assert foreign_result not in dumped and foreign_job not in dumped
    # A missing id and a foreign id are indistinguishable.
    missing = context(client, project_b, {"selected_job_id": str(uuid4())})
    assert missing["grounding_notes"] == data["grounding_notes"]


def test_job_facts_are_a_safe_summary(api, monkeypatch):
    client, _, _ = api
    project, detail = _queued_energy_job(client, monkeypatch, "job-facts")
    job_id = detail["compute_job"]["id"]
    data = context(client, project["id"], {"selected_job_id": job_id})
    fact = data["grounding_facts"][0]
    assert fact["kind"] == "job" and fact["entity_id"] == job_id
    assert fact["facts"]["status"] in {"PENDING", "READY"}
    assert fact["facts"]["method"] == "hf" and fact["facts"]["basis"] == "sto-3g"
    assert "not a scientific result" in fact["verification_note"]
    text = json.dumps(fact).lower()
    for forbidden in ("log", "secret", "token", "diagnostic", "stderr"):
        assert forbidden not in text.replace("kind", "")


def test_claim_facts_come_from_the_stored_claim(api):
    client, sessions, _ = api
    _seed_text(api, "Nothing numeric here.")
    with sessions() as session:
        document = session.scalars(select(ScientificDocumentRecord)).first()
        document_id, project_id = document.id, document.project_id
    created = client.post(
        f"/v1/projects/{project_id}/scientific-claims/manual",
        json={
            "document_id": document_id, "page": 2, "quantity": "a", "unit": "A", "system": "s",
            "value": 24.48, "quote": "the a axis is 24.480 A",
        },
    )
    assert created.status_code == 201, created.text
    claims = client.get(f"/v1/projects/{project_id}/scientific-claims?locale=en").json()["claims"]
    claim = next(c for c in claims if c["source_authority"] == "USER_ENTERED")
    data = context(client, project_id, {"selected_claim_id": claim["id"]})
    fact = data["grounding_facts"][0]
    assert fact["kind"] == "claim" and fact["entity_id"] == claim["id"]
    assert fact["evidence_class"] == "USER_ENTERED"
    assert fact["verification_note"] == "Not independently verified"
    assert fact["facts"]["value"] == 24.48 and fact["facts"]["unit"] == "A"
    assert fact["facts"]["original_value_text"] == "24.480"
    # A claim id from this project is not grounded in another project of the same user.
    other = _create_project(client)["id"]
    ignored = context(client, other, {"selected_claim_id": claim["id"]})
    assert ignored["grounding_facts"] == [] and claim["id"] not in json.dumps(ignored)


def test_non_member_gets_404_and_old_payloads_still_parse(api):
    client, _, _ = api
    assert (
        client.post(f"/v1/projects/{uuid4()}/ai/context", json={"selected_job_id": str(uuid4())})
        .status_code == 404
    )
    assert ProductSelection.model_validate({"current_view": "x"}).compared_result_ids is None
    project = _create_project(client)
    data = context(client, project["id"])
    assert ProductContext.model_validate(data).grounding_facts == ()
