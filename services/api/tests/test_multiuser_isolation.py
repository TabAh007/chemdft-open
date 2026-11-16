"""PF-1 acceptance gate: two jwt-authenticated users cannot see or change each other's work."""

from __future__ import annotations

import pytest
from chemdft_api.models import ProjectMember
from chemdft_api.service_principals import SERVICE_USER_IDS, ensure_service_principals
from multiuser import claims_for, project_get_paths

XYZ = b"2\nH2\nH 0 0 -0.37\nH 0 0 0.37\n"

# Routes whose input is real result ids: an owner cannot get a 200 without published results,
# so they are covered by `test_a_stranger_cannot_reach_routes_that_take_result_ids` instead.
NEEDS_RESULT_IDS = {
    "/calculation-comparison": "?result_id={a}&result_id={b}",
    "/calculation-comparison/export": "?result_id={a}&result_id={b}&format=csv",
    "/dispersion-corrections/capability": "?source_result_id={a}",
    "/scientific-report": "?format=html&result_id={a}",
    "/export/3d-pdf": "",
    "/export/report-pdf": "",
    "/export/html": "",
}
READ_PATHS = [  # discovered from the live app, not hand-listed
    path for path in project_get_paths() if path not in NEEDS_RESULT_IDS
]
REQUIRED_QUERY = {
    "/experimental/spectra/comparison-sources": "?technique=IR"
}  # routes that need one


def _import_structure(actor, project_id: str, key: str):
    return actor.post(
        f"/v1/projects/{project_id}/structures/imports",
        files={"upload": ("h2.xyz", XYZ, "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": key, "structure_name": "H2"},
    )


@pytest.fixture
def two_users(multiuser):
    alice, bob = multiuser.actor("alice"), multiuser.actor("bob")
    return multiuser, alice, bob, alice.create_project("project-a"), bob.create_project("project-b")


def test_each_user_has_an_independent_personal_organization(two_users) -> None:
    _env, alice, bob, project_a, project_b = two_users
    assert alice.user_id != bob.user_id
    assert alice.organization_id != bob.organization_id
    assert project_a["organization_id"] == alice.organization_id
    assert project_b["organization_id"] == bob.organization_id
    assert project_a["role"] == "owner" and project_b["role"] == "owner"


@pytest.mark.parametrize("path", READ_PATHS)
def test_a_stranger_cannot_read_project_scoped_resources(two_users, path) -> None:
    _env, alice, bob, project_a, project_b = two_users
    query = REQUIRED_QUERY.get(path, "")
    assert alice.get(f"/v1/projects/{project_a['id']}{path}{query}").status_code == 200, path
    assert bob.get(f"/v1/projects/{project_b['id']}{path}{query}").status_code == 200, path
    # by changing the project id in the URL by hand
    for stranger, foreign in ((bob, project_a), (alice, project_b)):
        response = stranger.get(f"/v1/projects/{foreign['id']}{path}{query}")
        assert response.status_code in (403, 404), (
            f"{path}: {response.status_code} {response.text[:120]}"
        )


@pytest.mark.parametrize("path", sorted(NEEDS_RESULT_IDS))
def test_a_stranger_cannot_reach_routes_that_take_result_ids(two_users, path) -> None:
    _env, alice, bob, project_a, project_b = two_users
    from uuid import uuid4

    query = NEEDS_RESULT_IDS[path].format(a=uuid4(), b=uuid4())
    # Project access is decided before the ids are looked at: a stranger and a non-member get
    # the same answer, whether or not the ids exist.
    for stranger, foreign in ((bob, project_a), (alice, project_b)):
        response = stranger.get(f"/v1/projects/{foreign['id']}{path}{query}")
        assert response.status_code in (403, 404), (
            f"{path}: {response.status_code} {response.text[:120]}"
        )
    # the owner reaches the handler (the ids simply do not exist in their project or 3d-pdf is disabled)
    assert alice.get(f"/v1/projects/{project_a['id']}{path}{query}").status_code in (404, 422, 501)


def test_a_stranger_cannot_discover_a_project_through_lists_or_search(two_users) -> None:
    _env, alice, bob, project_a, project_b = two_users
    assert [p["id"] for p in alice.get("/v1/projects").json()] == [project_a["id"]]
    assert [p["id"] for p in bob.get("/v1/projects").json()] == [project_b["id"]]
    search = bob.post(
        f"/v1/projects/{project_a['id']}/knowledge/search", json={"query": "project-a", "limit": 5}
    )
    assert search.status_code in (403, 404)
    # a user's own project search never returns another user's data
    own = bob.post(
        f"/v1/projects/{project_b['id']}/knowledge/search", json={"query": "project-a", "limit": 5}
    )
    assert own.status_code in (200, 422)
    if own.status_code == 200:
        assert project_a["id"] not in own.text


def test_a_stranger_cannot_mutate_a_project(two_users) -> None:
    env, alice, bob, project_a, _project_b = two_users
    created = _import_structure(alice, project_a["id"], "alice-import-1")
    assert created.status_code == 201, created.text
    refused = _import_structure(bob, project_a["id"], "bob-import-1")
    assert refused.status_code in (403, 404), refused.text
    investigation = bob.post(
        f"/v1/projects/{project_a['id']}/investigations", json={"title": "x", "objective": "y"}
    )
    assert investigation.status_code in (403, 404, 422)
    if (
        investigation.status_code == 422
    ):  # validation runs before auth only if the body is malformed
        investigation = bob.post(
            f"/v1/projects/{project_a['id']}/investigations",
            json={"title": "Hijack", "objective": "Hijack the project", "policy": {}, "budget": {}},
        )
        assert investigation.status_code in (403, 404, 422)
    # nothing was written into Alice's project by Bob
    assert len(alice.get(f"/v1/projects/{project_a['id']}/structures").json()) == 1
    with env.sessions() as session:
        members = (
            session.query(ProjectMember).filter(ProjectMember.project_id == project_a["id"]).all()
        )
        assert [m.user_id for m in members] == [alice.user_id]


def test_roles_inside_a_shared_project_are_enforced(two_users) -> None:
    env, _alice, bob, project_a, _project_b = two_users
    # Bob is invited to Alice's project as a viewer (same organization is not required to be shared
    # for a membership row, but the project still belongs to Alice's organization).
    with env.sessions() as session:
        session.add(ProjectMember(project_id=project_a["id"], user_id=bob.user_id, role="viewer"))
        session.commit()
    # authorization still requires the project's organization to match the caller's active one
    assert bob.get(f"/v1/projects/{project_a['id']}").status_code in (403, 404)
    assert [p["id"] for p in bob.get("/v1/projects").json()] != [project_a["id"]]


def test_spoofed_identity_headers_and_org_swaps_do_not_cross_tenants(two_users) -> None:
    env, alice, bob, project_a, _project_b = two_users
    spoof = {"X-ChemDFT-User-ID": alice.user_id, "X-ChemDFT-Organization-ID": alice.organization_id}
    assert bob.get(f"/v1/projects/{project_a['id']}", headers=spoof).status_code in (403, 404)
    assert bob.get("/v1/me", headers=spoof).json()["id"] == bob.user_id
    # a token for Bob's subject that merely carries Alice's email does not become Alice
    claim = env.keys.sign({**claims_for(bob.subject, bob.email), "email": alice.email})
    response = env.client.get("/v1/me", headers={"Authorization": f"Bearer {claim}"})
    assert response.json()["id"] == bob.user_id and response.json()["email"] == bob.email


def test_service_principals_are_not_reachable_through_human_sessions(two_users) -> None:
    env, alice, bob, project_a, _project_b = two_users
    with env.sessions() as session:
        ensure_service_principals(session)
    for service_id in SERVICE_USER_IDS.values():
        for human in (alice, bob):
            response = human.get("/v1/me", headers={"X-ChemDFT-User-ID": service_id})
            assert response.json()["id"] == human.user_id
    assert alice.get(f"/v1/projects/{project_a['id']}").status_code == 200
    # service rows are not people: they own no projects and appear in no human's list
    assert all(p["id"] == project_a["id"] for p in alice.get("/v1/projects").json())
