"""Per-user daily limits for the private beta (0 = unlimited; counts the last 24 hours)."""

from __future__ import annotations


def _project_with_h2(client):
    project = client.post("/v1/projects", json={"name": "Limits", "slug": "limits"}).json()
    imported = client.post(
        f"/v1/projects/{project['id']}/structures/imports",
        files={"upload": ("h2.xyz", b"2\nH2\nH 0 0 -0.37\nH 0 0 0.37\n", "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": "limits-import-1", "structure_name": "H2"},
    )
    assert imported.status_code == 201, imported.text
    return project, imported.json()["version"]


def _calculation(client, project, version, key):
    return client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"], "entity_type": "structure.version",
                "entity_id": version["id"],
            },
            "specification": {
                "task_type": "ENERGY",
                "method": {"identifier": "hf", "display_name": "HF", "registry": "chemdft.method"},
                "basis": {"identifier": "sto-3g", "display_name": "STO-3G", "registry": "chemdft.basis"},
                "charge": 0, "multiplicity": 1,
                "engine_preference": {"engine": "pyscf", "allowed_version": "2.14.0"},
            },
            "idempotency_key": key,
        },
    )  # fmt: skip


def test_daily_compute_limit_is_enforced_per_user_and_reports_429(api):
    client, _sessions, settings = api
    project, version = _project_with_h2(client)
    settings.beta_max_compute_jobs_per_user_day = 2
    assert _calculation(client, project, version, "limits-calc-0001").status_code == 201
    assert _calculation(client, project, version, "limits-calc-0002").status_code == 201
    third = _calculation(client, project, version, "limits-calc-0003")
    assert third.status_code == 429 and "Daily calculation limit" in third.text


def test_zero_means_unlimited(api):
    client, _sessions, settings = api
    project, version = _project_with_h2(client)
    assert settings.beta_max_compute_jobs_per_user_day == 0
    for index in range(4):
        assert _calculation(client, project, version, f"limits-free-{index:04d}").status_code == 201


def test_daily_ai_limit_is_enforced(api):
    client, sessions, settings = api
    project = client.post("/v1/projects", json={"name": "AI limits", "slug": "ai-limits"}).json()
    conversation = client.post(f"/v1/projects/{project['id']}/ai/conversations", json={}).json()[
        "conversation"
    ]["id"]
    settings.beta_max_ai_runs_per_user_day = 1
    url = f"/v1/projects/{project['id']}/ai/conversations/{conversation}/messages"
    assert client.post(url, json={"content": "Explain this."}).status_code == 201
    blocked = client.post(url, json={"content": "And this?"})
    assert blocked.status_code == 429 and "Daily AI limit" in blocked.text
