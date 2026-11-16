"""PF-6 references the PF-4 catalogue; existing project APIs remain the authority."""

import json
from pathlib import Path

import pytest
from chemdft_api.ai.gateway import FakeModelGateway, HttpOpenAIModelGateway
from chemdft_api.ai.service import AIScientistService
from chemdft_api.models import Project, ProjectKind
from chemdft_api.navigator.catalog import CATALOG, GOALS


def test_welcome_manifest_references_real_catalogue():
    root = Path(__file__).resolve().parents[3]
    paths = json.loads((root / "apps/web/src/lib/onboarding-paths.json").read_text())["paths"]
    assert [p["id"] for p in paths] == [
        "molecule",
        "calculation",
        "experimental",
        "compare",
        "examples",
        "unsure",
    ]
    actions = {action.id for action in CATALOG}
    goals = set(GOALS)
    for path in paths:
        assert set(path["actions"]) <= actions
        assert path["goal"] is None or path["goal"] in goals


def test_onboarding_existing_normal_creation_and_guidance_without_ai(multiuser, monkeypatch):
    monkeypatch.setattr(
        AIScientistService, "__init__", lambda *a, **k: pytest.fail("PF-6 called AI")
    )
    for gateway in [FakeModelGateway, HttpOpenAIModelGateway]:
        monkeypatch.setattr(
            gateway, "__init__", lambda *a, **k: pytest.fail("PF-6 constructed an AI provider")
        )
    alice, bob = multiuser.actor("onboard-alice"), multiuser.actor("onboard-bob")
    other = bob.create_project("private")
    assert alice.get("/v1/projects").json() == []
    project = alice.create_project("confirmed-onboarding")
    with multiuser.sessions() as session:
        stored = session.get(Project, project["id"])
        assert stored.kind == ProjectKind.NORMAL
        assert str(stored.organization_id) == alice.organization_id
    assert project["role"] == "owner"
    assert project["organization_id"] == alice.organization_id
    for goal in ["energy", "ir", "compare", "crystal", "thermochemistry"]:
        state = alice.get(f"/v1/projects/{project['id']}/navigator?goal={goal}")
        assert state.status_code == 200
        assert state.json()["have"] == []
        assert state.json()["facts_summary"]["running_jobs"] == 0
    assert alice.get(f"/v1/projects/{other['id']}/navigator?goal=compare").status_code == 404
    assert multiuser.client.get(f"/v1/projects/{project['id']}/navigator").status_code == 401
    # No browser-provided organization can move the destination away from trusted identity.
    spoof = alice.post(
        "/v1/projects",
        json={"name": "spoof", "slug": "spoof", "organization_id": bob.organization_id},
    )
    assert spoof.status_code == 422
    assert len(alice.get("/v1/projects").json()) == 1
    duplicate = alice.post(
        "/v1/projects", json={"name": "confirmed-onboarding", "slug": project["slug"]}
    )
    assert duplicate.status_code == 409
    assert len(alice.get("/v1/projects").json()) == 1
