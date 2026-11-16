"""0.0.18: optional paging and filters on GET /v1/projects/{id}/compute/jobs."""

from __future__ import annotations

from uuid import UUID

from chemdft_api.contracts.catalog import ComputeJobListOutput, EntityReference
from chemdft_api.scientific_models import ComputeJobRecord
from test_compute_gateway import _energy_spec, _import_h2


def _seed(client, sessions, monkeypatch, states):
    monkeypatch.setattr(
        "chemdft_api.calculation_actions.validate_capability", lambda _s, _t: None
    )
    project = client.post("/v1/projects", json={"name": "paging", "slug": "paging"}).json()
    version = _import_h2(client, project["id"])
    ids = []
    for index, _state in enumerate(states):
        spec = _energy_spec()
        basis = ["sto-3g", "6-31g", "def2-svp", "def2-svpd", "sto-3g"][index]
        spec["basis"] = {"identifier": basis, "display_name": basis, "registry": "chemdft.basis"}
        if index == 4:
            spec["method"] = {"identifier": "pbe", "display_name": "PBE", "registry": "chemdft.method"}
        detail = client.post(
            f"/v1/projects/{project['id']}/calculations",
            json={
                "structure_version": EntityReference(
                    project_id=UUID(project["id"]),
                    entity_type="structure.version",
                    entity_id=UUID(version["id"]),
                ).model_dump(mode="json"),
                "specification": spec,
                "idempotency_key": f"paging-{index}",
            },
        )
        assert detail.status_code in (200, 201), detail.text
        ids.append(detail.json()["compute_job"]["id"])
    with sessions() as session:
        for job_id, state in zip(ids, states, strict=True):
            job = session.get(ComputeJobRecord, job_id)
            job.state = state
        session.commit()
    return project["id"], ids


def _list(client, project, **params):
    response = client.get(f"/v1/projects/{project}/compute/jobs", params=params)
    assert response.status_code == 200, response.text
    return response.json()


STATES = ["SUCCEEDED", "FAILED", "RUNNING", "CANCELED", "SUCCEEDED"]


def test_defaults_reproduce_the_previous_response(api, monkeypatch):
    client, sessions, _ = api
    project, ids = _seed(client, sessions, monkeypatch, STATES)
    body = _list(client, project)
    assert {job["id"] for job in body["jobs"]} == set(ids)
    assert body["total"] == len(ids) and body["next_offset"] is None
    # same order as a call with explicit "all" and no paging
    assert [j["id"] for j in body["jobs"]] == [
        j["id"] for j in _list(client, project, phase="all", offset=0)["jobs"]
    ]
    # old clients: payload without the new fields still parses
    legacy = {"jobs": body["jobs"]}
    assert ComputeJobListOutput.model_validate(legacy).total is None


def test_filters_by_phase_and_provider_and_text(api, monkeypatch):
    client, sessions, _ = api
    project, ids = _seed(client, sessions, monkeypatch, STATES)
    for phase, expected in [("succeeded", 2), ("failed", 1), ("active", 1), ("canceled", 1)]:
        body = _list(client, project, phase=phase)
        assert body["total"] == expected == len(body["jobs"]), phase
    assert _list(client, project, provider="aws")["total"] == 0
    assert _list(client, project, provider="local")["total"] == len(ids)
    assert _list(client, project, q=ids[2][:8].upper())["total"] == 1
    assert _list(client, project, q="no-such-thing")["jobs"] == []
    assert client.get(f"/v1/projects/{project}/compute/jobs?phase=bogus").status_code == 422


def test_paging_boundaries(api, monkeypatch):
    client, sessions, _ = api
    project, ids = _seed(client, sessions, monkeypatch, STATES)
    everything = [j["id"] for j in _list(client, project)["jobs"]]
    first = _list(client, project, limit=2)
    assert [j["id"] for j in first["jobs"]] == everything[:2]
    assert first["total"] == 5 and first["next_offset"] == 2
    last = _list(client, project, limit=2, offset=4)
    assert [j["id"] for j in last["jobs"]] == everything[4:] and last["next_offset"] is None
    exact = _list(client, project, limit=5)
    assert len(exact["jobs"]) == 5 and exact["next_offset"] is None
    assert _list(client, project, limit=2, offset=99)["jobs"] == []
    assert client.get(f"/v1/projects/{project}/compute/jobs?limit=0").status_code == 422


def test_non_member_still_gets_404(api, monkeypatch):
    client, sessions, _ = api
    project, _ids = _seed(client, sessions, monkeypatch, ["SUCCEEDED"])
    assert client.get(f"/v1/projects/{UUID(int=5)}/compute/jobs?limit=1").status_code == 404
