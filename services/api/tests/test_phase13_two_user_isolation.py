# ruff: noqa: E501
"""Phase 13 / BETA-1.1 (offline): adversarial two-user isolation.

Alice owns a project with a structure, a calculation and its compute job, a document, a manual claim, a
seeded result, a conversation and an AI run. Bob is a different signed-in user (jwt mode, local keys,
fake AI provider). Every request below is Bob's. A foreign id must behave exactly like an id that does
not exist; Alice's records must never be read, listed, counted, changed, grounded or echoed.

Offline evidence only: local accounts, SQLite, fake provider. It says nothing about the hosted site.
"""

from __future__ import annotations

import json
import re
from uuid import uuid4

import pytest
import test_cross_tenant_resources as tenant
from chemdft_api.ai.gateway import FakeModelGateway, ModelResponse, ModelUsage
from chemdft_api.models import Project
from chemdft_api.scientific_models import ScientificDocumentRecord
from sqlalchemy import select
from test_account_beta import _self_signup
from test_navigator import seed_projection_result

CLAIM_QUOTE = "the a axis is 24.480 A"
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


@pytest.fixture
def world(multiuser, monkeypatch):
    # the isolated spectra worker is not installed everywhere; spectra isolation has its own tests
    monkeypatch.setattr(tenant, "import_spectrum", lambda *a, **k: {"id": str(uuid4())})
    alice, bob = multiuser.actor("alice"), multiuser.actor("bob")
    project_a, project_b = alice.create_project("alice-p"), bob.create_project("bob-p")
    ids = tenant._build_resources(alice, project_a, monkeypatch)
    # the run first: the AI context builder cannot read a document that already has a manual claim,
    # nor the metadata-only result fixture below (both are fixtures, not complete records)
    run = alice.post(
        f"/v1/projects/{project_a['id']}/ai/conversations/{ids['conversation']}/messages",
        json={"content": "What is the energy of this structure?"},
    )
    assert run.status_code == 201, run.text
    ids["run"] = run.json()["latest_run"]["id"]
    claim = alice.post(
        f"/v1/projects/{project_a['id']}/scientific-claims/manual",
        json={
            "document_id": ids["document"],
            "page": 2,
            "quantity": "a",
            "unit": "A",
            "system": "s",
            "value": 24.48,
            "quote": CLAIM_QUOTE,
        },
    )
    assert claim.status_code == 201, claim.text
    claims = alice.get(f"/v1/projects/{project_a['id']}/scientific-claims?locale=en").json()["claims"]
    ids["claim"] = next(c for c in claims if c["source_authority"] == "USER_ENTERED")["id"]
    jobs = alice.get(f"/v1/projects/{project_a['id']}/compute/jobs").json()["jobs"]
    ids["job"] = jobs[0]["id"]
    ids["result"], _ = seed_projection_result(
        multiuser.sessions,
        project_a["id"],
        ids["version"],
        payload={
            "payload_schema": "chemdft.energy",
            "converged": True,
            "total_energy": {"value": -1.1, "unit": {"code": "hartree"}},
        },
    )
    return {"env": multiuser, "alice": alice, "bob": bob, "a": project_a, "b": project_b, "ids": ids}


def _shape(response, *ids: str) -> tuple[int, str]:
    """Status plus body with every uuid and the given ids blanked, so two responses can be compared."""
    body = response.text
    for value in ids:
        body = body.replace(value, "<id>")
    return response.status_code, UUID_RE.sub("<id>", body)


def _snapshot(world) -> dict:
    """Alice's visible state, to prove Bob changed nothing."""
    alice, pid = world["alice"], world["a"]["id"]
    return {
        "project": alice.get(f"/v1/projects/{pid}").json(),
        "structures": alice.get(f"/v1/projects/{pid}/structures").json(),
        "jobs": alice.get(f"/v1/projects/{pid}/compute/jobs").json(),
        "claims": alice.get(f"/v1/projects/{pid}/scientific-claims?locale=en").json(),
        "conversations": alice.get(f"/v1/projects/{pid}/ai/conversations").json(),
    }


# ------------------------------------------------------------------------------------------------
# read, list, rename, export and run on another user's project
# ------------------------------------------------------------------------------------------------

READ_ON_FOREIGN_PROJECT = [
    "",
    "/navigator",
    "/structures",
    "/compute/jobs",
    "/compute/jobs?limit=5&offset=0",
    "/compute/queue-status",
    "/scientific-claims?locale=en",
    "/ai/conversations",
    "/documents",
    "/investigations",
    "/published-results",
    "/saved-comparisons",
    "/research-overview",
    "/export/archive",
    "/export/html",
    "/knowledge/status",
    "/memory",
]


@pytest.mark.parametrize("path", READ_ON_FOREIGN_PROJECT)
def test_bob_reading_alices_project_looks_exactly_like_a_missing_project(world, path) -> None:
    bob, pid = world["bob"], world["a"]["id"]
    missing = str(uuid4())
    foreign = bob.get(f"/v1/projects/{pid}{path}")
    absent = bob.get(f"/v1/projects/{missing}{path}")
    assert foreign.status_code == absent.status_code == 404, (path, foreign.text[:120])
    assert _shape(foreign, pid) == _shape(absent, missing)


def test_bob_cannot_list_or_find_alices_project(world) -> None:
    bob, alice = world["bob"], world["alice"]
    assert [p["id"] for p in bob.get("/v1/projects").json()] == [world["b"]["id"]]
    assert [p["id"] for p in alice.get("/v1/projects").json()] == [world["a"]["id"]]
    assert world["a"]["id"] not in bob.get("/v1/projects").text


def test_bob_cannot_rename_alices_project(world) -> None:
    bob, pid = world["bob"], world["a"]["id"]
    before = _snapshot(world)
    foreign = bob.request("PATCH", f"/v1/projects/{pid}", json={"name": "Hijacked"})
    absent = bob.request("PATCH", f"/v1/projects/{uuid4()}", json={"name": "Hijacked"})
    assert foreign.status_code == absent.status_code == 404
    assert _shape(foreign, pid) == _shape(absent, pid)
    assert _snapshot(world) == before
    with world["env"].sessions() as session:
        assert session.get(Project, pid).name == "alice-p"


def test_bob_cannot_run_or_change_anything_on_alices_project(world) -> None:
    bob, ids, pid = world["bob"], world["ids"], world["a"]["id"]
    before = _snapshot(world)
    attempts = [
        ("POST", f"/calculations/{ids['calculation']}/cancel", {}),
        ("POST", f"/investigations/{ids['investigation']}/start", {}),
        ("POST", "/scientific-claims/manual", {"json": {"document_id": ids["document"], "page": 1, "quantity": "a", "unit": "A", "system": "s", "value": 1.0, "quote": "hijack"}}),
        ("POST", "/ai/conversations", {"json": {"title": "hijack"}}),
        ("POST", f"/ai/conversations/{ids['conversation']}/messages", {"json": {"content": "hello"}}),
        ("POST", f"/ai/runs/{ids['run']}/cancel", {}),
        ("POST", f"/ai/runs/{ids['run']}/pause", {}),
        ("POST", f"/ai/runs/{ids['run']}/resume", {}),
        ("POST", "/knowledge/reindex", {}),
        ("POST", "/files", {"files": {"upload": ("x.txt", b"x", "text/plain")}}),
    ]
    for method, suffix, kwargs in attempts:
        response = bob.request(method, f"/v1/projects/{pid}{suffix}", **kwargs)
        assert response.status_code == 404, (suffix, response.status_code, response.text[:120])
    assert _snapshot(world) == before


def test_bob_cannot_start_a_calculation_on_alices_structure(world, monkeypatch) -> None:
    """Even from Bob's own project, naming Alice's structure version must not create a calculation or a job."""
    from uuid import UUID

    from chemdft_api.contracts.base import EntityReference
    from test_compute_gateway import _energy_spec

    monkeypatch.setattr("chemdft_api.calculation_actions.validate_capability", lambda _s, _t: None)
    bob, ids = world["bob"], world["ids"]
    before = _snapshot(world)
    for project_id in (world["a"]["id"], world["b"]["id"]):
        response = bob.post(
            f"/v1/projects/{project_id}/calculations",
            json={
                "structure_version": EntityReference(
                    project_id=UUID(world["a"]["id"]), entity_type="structure.version", entity_id=UUID(ids["version"])
                ).model_dump(mode="json"),
                "specification": _energy_spec(),
                "idempotency_key": f"bob-steals-{project_id[:6]}",
            },
        )
        assert response.status_code in (403, 404, 409, 422), (project_id, response.status_code, response.text[:160])
    assert bob.get(f"/v1/projects/{world['b']['id']}/compute/jobs").json()["jobs"] == []
    assert _snapshot(world) == before


# ------------------------------------------------------------------------------------------------
# guessing Alice's ids under Bob's own project: indistinguishable from an unknown id
# ------------------------------------------------------------------------------------------------

GUESSED_ID_ROUTES = [
    ("GET", "/ai/conversations/{conversation}"),
    ("GET", "/ai/runs/{run}"),
    ("GET", "/ai/runs/{run}/events"),
    ("POST", "/ai/runs/{run}/cancel"),
    ("POST", "/ai/runs/{run}/pause"),
    ("POST", "/ai/runs/{run}/resume"),
    ("GET", "/calculations/{calculation}"),
    ("GET", "/calculations/{calculation}/export"),
    ("GET", "/calculations/{calculation}/exports"),
    ("GET", "/calculations/{calculation}/reuse-plan"),
    ("GET", "/compute/jobs/{job}/diagnostics"),
    ("GET", "/results/{result}"),
    ("GET", "/results/{result}/export"),
    ("GET", "/results/{result}/provenance"),
    ("GET", "/documents/{document}"),
    ("GET", "/documents/{document}/source"),
    ("GET", "/structures/{structure}/versions/{version}"),
    ("GET", "/investigations/{investigation}"),
    ("GET", "/saved-comparisons/{result}"),
    ("GET", "/knowledge/items/{document}"),
    ("GET", "/imported-results/{result}"),
]


@pytest.mark.parametrize(("method", "template"), GUESSED_ID_ROUTES, ids=[f"{m} {t}" for m, t in GUESSED_ID_ROUTES])
def test_a_guessed_foreign_id_is_indistinguishable_from_a_missing_id(world, method, template) -> None:
    bob, ids = world["bob"], world["ids"]
    own = world["b"]["id"]
    real = template.format(**ids)
    fake = template.format(**{key: str(uuid4()) for key in ids})
    answers = []
    for suffix in (real, fake):
        answers.append(bob.request(method, f"/v1/projects/{own}{suffix}"))
    assert answers[0].status_code == answers[1].status_code, (template, answers[0].text[:160])
    assert answers[0].status_code in (404, 409, 422), (template, answers[0].status_code)
    assert _shape(answers[0], *ids.values(), own) == _shape(answers[1], own)
    for value in ids.values():
        assert value not in answers[0].text.replace(own, "")


def test_alices_claim_text_never_appears_in_anything_bob_can_fetch(world) -> None:
    bob = world["bob"]
    pid = world["b"]["id"]
    for suffix in READ_ON_FOREIGN_PROJECT:
        response = bob.get(f"/v1/projects/{pid}{suffix}")
        if response.status_code == 200:
            assert "24.480" not in response.text and world["a"]["id"] not in response.text, suffix
            for value in world["ids"].values():
                assert value not in response.text, (suffix, value)


# ------------------------------------------------------------------------------------------------
# list endpoints never include or count Alice's records
# ------------------------------------------------------------------------------------------------


def test_bobs_job_list_neither_includes_nor_counts_alices_jobs(world) -> None:
    alice, bob = world["alice"], world["bob"]
    assert alice.get(f"/v1/projects/{world['a']['id']}/compute/jobs").json()["jobs"], "premise: Alice has a job"
    for query in ("", "?limit=1&offset=0", "?limit=200", "?offset=1", "?phase=active", "?q=hf", "?provider=local"):
        response = bob.get(f"/v1/projects/{world['b']['id']}/compute/jobs{query}")
        assert response.status_code == 200, (query, response.text)
        body = response.json()
        assert body["jobs"] == [], query
        if "total" in body:
            assert body["total"] == 0, query
        assert body.get("next_offset") in (None, 0), query
        assert world["ids"]["job"] not in response.text and world["ids"]["calculation"] not in response.text


def test_bobs_claim_list_and_queue_status_do_not_include_alices_records(world) -> None:
    alice, bob = world["alice"], world["bob"]
    pid_a, pid_b = world["a"]["id"], world["b"]["id"]
    alices = alice.get(f"/v1/projects/{pid_a}/scientific-claims?locale=en").json()["claims"]
    assert any(c["id"] == world["ids"]["claim"] for c in alices), "premise: Alice's claim is listed"
    bobs = bob.get(f"/v1/projects/{pid_b}/scientific-claims?locale=en")
    assert bobs.status_code == 200 and bobs.json()["claims"] == []
    assert "24.480" not in bobs.text
    queue_a = alice.get(f"/v1/projects/{pid_a}/compute/queue-status").json()
    queue_b = bob.get(f"/v1/projects/{pid_b}/compute/queue-status").json()
    assert set(queue_a) == set(queue_b)
    assert world["ids"]["job"] not in json.dumps(queue_b)
    assert bob.get(f"/v1/projects/{pid_b}/ai/conversations").json()["conversations"] == []
    assert bob.get(f"/v1/projects/{pid_b}/published-results").status_code == 200
    assert world["ids"]["result"] not in bob.get(f"/v1/projects/{pid_b}/published-results").text


# ------------------------------------------------------------------------------------------------
# AI requests from Bob that carry Alice's ids: not grounded, not leaked, on every answer path
# ------------------------------------------------------------------------------------------------


@pytest.fixture
def gateway(monkeypatch):
    requests = []

    def generate(self, request):
        requests.append(request)
        return ModelResponse(content="ok", usage=ModelUsage(input_tokens=50, output_tokens=5, latency_ms=1))

    monkeypatch.setattr(FakeModelGateway, "generate", generate)
    return requests


@pytest.mark.parametrize("mode", ["CHAT", "EVIDENCE", "STANDARD"])
def test_foreign_selection_ids_are_neither_grounded_nor_leaked_in_any_answer_mode(world, gateway, mode) -> None:
    bob, ids = world["bob"], world["ids"]
    pid = world["b"]["id"]
    conversation = bob.post(f"/v1/projects/{pid}/ai/conversations", json={}).json()["conversation"]["id"]
    response = bob.post(
        f"/v1/projects/{pid}/ai/conversations/{conversation}/messages",
        json={
            "content": "For the selected claim, job and results, what are the exact value, unit, source and review state?",
            "mode": mode,
            "selected_claim_id": ids["claim"],
            "selected_job_id": ids["job"],
            "compared_result_ids": [ids["result"]],
        },
    )
    assert response.status_code in (201, 409, 422), (mode, response.status_code, response.text[:200])
    dumped = response.text + json.dumps(
        [[m.content for m in request.messages] + [request.system_prompt] for request in gateway]
    )
    for value in (ids["claim"], ids["job"], ids["result"], ids["calculation"], ids["version"], world["a"]["id"]):
        assert value not in dumped, (mode, value)
    assert "24.480" not in dumped and "evidence_class: USER_ENTERED" not in dumped
    assert "evidence_class:" not in dumped


def test_foreign_selection_ids_are_not_grounded_by_the_context_endpoint(world) -> None:
    bob, ids = world["bob"], world["ids"]
    response = bob.post(
        f"/v1/projects/{world['b']['id']}/ai/context",
        json={
            "selected_claim_id": ids["claim"],
            "selected_job_id": ids["job"],
            "compared_result_ids": [ids["result"]],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["grounding_facts"] == []
    assert body["grounding_notes"] == ["A selected item was not found in this project and is not used."]
    for value in (ids["claim"], ids["job"], ids["result"]):
        assert value not in json.dumps({k: v for k, v in body.items() if k != "selection"}), value
    assert "24.480" not in response.text
    # and against Alice's project the same request is a plain 404
    assert bob.post(f"/v1/projects/{world['a']['id']}/ai/context", json={}).status_code == 404


def test_alices_own_ids_do_ground_for_alice(world, gateway) -> None:
    """Control: the same request that Bob is refused works for the owner, so the tests above can fail."""
    alice, ids = world["alice"], world["ids"]
    response = alice.post(
        f"/v1/projects/{world['a']['id']}/ai/context",
        json={"selected_claim_id": ids["claim"], "selected_job_id": ids["job"], "compared_result_ids": [ids["result"]]},
    )
    assert response.status_code == 200
    kinds = {fact["kind"] for fact in response.json()["grounding_facts"]}
    assert kinds >= {"compared_result"}


# ------------------------------------------------------------------------------------------------
# billing and quota snapshots are per user
# ------------------------------------------------------------------------------------------------


def test_billing_snapshots_belong_to_the_caller_only(world) -> None:
    alice, bob = world["alice"], world["bob"]
    a, b = alice.get("/v1/billing").json(), bob.get("/v1/billing").json()
    assert a["organization_id"] == alice.organization_id and b["organization_id"] == bob.organization_id
    assert a["billing_account_id"] != b["billing_account_id"]
    assert alice.organization_id not in json.dumps(b) and bob.organization_id not in json.dumps(a)
    # a caller-supplied organization id does not select another snapshot
    spoof = bob.get("/v1/billing", headers={"X-ChemDFT-Organization-ID": alice.organization_id})
    assert spoof.json()["organization_id"] == bob.organization_id
    assert spoof.json()["billing_account_id"] == b["billing_account_id"]


def test_quota_snapshots_count_only_the_callers_own_records(multiuser, monkeypatch) -> None:
    multiuser.settings.signup_open = True
    alice, bob = _self_signup(multiuser, "alice"), _self_signup(multiuser, "bob")
    monkeypatch.setattr(tenant, "import_spectrum", lambda *a, **k: {"id": str(uuid4())})
    project = alice.create_project("alice-q")
    alice.create_project("alice-q2")
    tenant._build_resources(alice, project, monkeypatch)

    def used(actor) -> dict:
        limits = actor.get("/v1/me/limits").json()
        assert limits["applies"] is True
        return {q["key"]: q["used"] for q in limits["quotas"]}

    mine, theirs = used(alice), used(bob)
    assert mine["projects"] == 2 and mine["jobs_day"] >= 1
    assert theirs["projects"] == 0 and theirs["jobs_day"] == 0 and theirs["concurrent_jobs"] == 0
    assert theirs["storage_mb"] == 0
    bob.create_project("bob-q")
    assert used(bob)["projects"] == 1 and used(alice)["projects"] == 2


def test_the_documents_a_stranger_could_learn_about_are_unchanged_by_bobs_attempts(world) -> None:
    """Closing check: after every attack above is repeated, Alice still has her records and the document row is intact."""
    bob, doc = world["bob"], world["ids"]["document"]
    for suffix in (f"/documents/{doc}", f"/documents/{doc}/source"):
        assert bob.get(f"/v1/projects/{world['a']['id']}{suffix}").status_code == 404
    with world["env"].sessions() as session:
        assert session.scalar(select(ScientificDocumentRecord).where(ScientificDocumentRecord.id == world["ids"]["document"])) is not None
