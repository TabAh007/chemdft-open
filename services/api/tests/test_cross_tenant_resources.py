# ruff: noqa: E501  (long literals and messages in test data)
"""PF-2: a resource id is only valid under the project it belongs to.

Authorization to project A must never be enough to reach a resource of project B, whether B belongs to
the same person (cross-parent substitution) or to someone else (cross-tenant). Resources are created
through the real API; each is then requested under the wrong project.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from chemdft_api.contracts.base import EntityReference
from spectra_support import import_spectrum, ir_text
from test_compute_gateway import _energy_spec
from test_phase7_ingestion import _pdf

XYZ = b"2\nH2\nH 0 0 -0.37\nH 0 0 0.37\n"


def _build_resources(actor, project: dict, monkeypatch) -> dict:
    """One resource of each kind the API can create without external fixtures, owned by `project`."""
    monkeypatch.setattr(
        "chemdft_api.calculation_actions.validate_capability", lambda _spec, _settings: None
    )
    pid = project["id"]
    imported = actor.post(
        f"/v1/projects/{pid}/structures/imports",
        files={"upload": ("h2.xyz", XYZ, "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": f"xyz-{pid[:8]}", "structure_name": "H2"},
    )
    assert imported.status_code == 201, imported.text
    structure, version = imported.json()["structure"]["id"], imported.json()["version"]["id"]
    calculation = actor.post(
        f"/v1/projects/{pid}/calculations",
        json={
            "structure_version": EntityReference(
                project_id=UUID(pid), entity_type="structure.version", entity_id=UUID(version)
            ).model_dump(mode="json"),
            "specification": _energy_spec(),
            "idempotency_key": f"calc-{pid[:8]}",
        },
    )
    assert calculation.status_code == 201, calculation.text
    document = actor.post(
        f"/v1/projects/{pid}/documents/imports",
        files={"upload": ("paper.pdf", _pdf(), "application/pdf")},
    )
    assert document.status_code == 201, document.text
    investigation = actor.post(
        f"/v1/projects/{pid}/investigations", json={"title": "inv", "objective": "o"}
    )
    assert investigation.status_code == 201, investigation.text
    conversation = actor.post(f"/v1/projects/{pid}/ai/conversations", json={"title": "chat"})
    assert conversation.status_code == 201, conversation.text
    dataset = import_spectrum(
        actor,
        pid,
        ir_text(),
        key=f"s-{pid[:8]}",
        choices={"x_unit": "cm^-1", "y_quantity": "ABSORBANCE", "y_unit": "absorbance"},
    )
    return {
        "structure": structure,
        "version": version,
        "calculation": calculation.json()["calculation"]["id"],
        "document": document.json()["document"]["id"],
        "investigation": investigation.json()["id"],
        "conversation": conversation.json()["conversation"]["id"],
        "dataset": dataset["id"],
    }


# (method, path template, request kwargs). `{x}` is the foreign resource's id.
SUBSTITUTIONS = [
    ("GET", "/structures/{structure}/versions", {}),
    ("GET", "/structures/{structure}/versions/{version}", {}),
    ("GET", "/structures/{structure}/versions/{version}/export?file_format=XYZ", {"params": {"file_format": "XYZ"}}),
    ("GET", "/calculations/{calculation}", {}),
    ("POST", "/calculations/{calculation}/cancel", {}),
    ("GET", "/documents/{document}", {}),
    ("GET", "/documents/{document}/source", {}),
    ("GET", "/experimental/spectra/datasets/{dataset}", {}),
    ("GET", "/experimental/spectra/datasets/{dataset}/arrays", {}),
    (
        "PUT",
        "/experimental/spectra/datasets/{dataset}/association",
        {"json": {"state": "UNASSIGNED"}},
    ),
    (
        "POST",
        "/experimental/spectra/datasets/{dataset}/transforms",
        {
            "json": {
                "op": "baseline.offset",
                "parameters": {"percentile": 0},
                "idempotency_key": "transform-key-1",
            }
        },
    ),
    (
        "POST",
        "/experimental/spectra/datasets/{dataset}/peaks",
        {"json": {"parameters": {"prominence_sigma": 10.0}, "idempotency_key": "peaks-key-0001"}},
    ),
    ("GET", "/investigations/{investigation}", {}),
    ("POST", "/investigations/{investigation}/start", {}),
    ("POST", "/investigations/{investigation}/pause", {}),
    ("GET", "/ai/conversations/{conversation}", {}),
    (
        "POST",
        "/ai/conversations/{conversation}/messages",
        {"json": {"content": "hello"}},
    ),
]


def _path(project_id: str, template: str, ids: dict) -> str:
    return f"/v1/projects/{project_id}" + template.format(**ids)


@pytest.fixture
def world(multiuser, monkeypatch):
    alice, bob = multiuser.actor("alice"), multiuser.actor("bob")
    a1, a2 = alice.create_project("alice-one"), alice.create_project("alice-two")
    b1 = bob.create_project("bob-one")
    return {
        "env": multiuser,
        "alice": alice,
        "bob": bob,
        "a1": a1,
        "a2": a2,
        "b1": b1,
        "a2_resources": _build_resources(alice, a2, monkeypatch),
        "b_resources": _build_resources(bob, b1, monkeypatch),
    }


@pytest.mark.parametrize(
    ("method", "template", "kwargs"), SUBSTITUTIONS, ids=[f"{m} {t}" for m, t, _ in SUBSTITUTIONS]
)
def test_a_resource_is_only_reachable_under_its_own_project(
    world, method, template, kwargs
) -> None:
    alice, bob = world["alice"], world["bob"]
    # positive control: the path is valid and works under the resource's own project
    if method == "GET":
        assert (
            bob.request("GET", _path(world["b1"]["id"], template, world["b_resources"]), **kwargs).status_code
            == 200
        ), template
        assert (
            alice.request(
                "GET", _path(world["a2"]["id"], template, world["a2_resources"]), **kwargs
            ).status_code
            == 200
        )
    # cross-parent: Alice may use project A1, but project A2's resource ids do not belong to it
    cross_parent = alice.request(
        method, _path(world["a1"]["id"], template, world["a2_resources"]), **kwargs
    )
    assert cross_parent.status_code == 404, (
        template,
        cross_parent.status_code,
        cross_parent.text[:160],
    )
    # cross-tenant: Bob's resource ids under Alice's project
    cross_tenant = alice.request(
        method, _path(world["a1"]["id"], template, world["b_resources"]), **kwargs
    )
    assert cross_tenant.status_code == 404, (template, cross_tenant.status_code)
    # project-id substitution: Alice naming Bob's project (with Bob's real ids) learns nothing
    foreign_project = alice.request(
        method, _path(world["b1"]["id"], template, world["b_resources"]), **kwargs
    )
    assert foreign_project.status_code == 404, (template, foreign_project.status_code)
    # and the reverse direction
    assert (
        bob.request(
            method, _path(world["a2"]["id"], template, world["a2_resources"]), **kwargs
        ).status_code
        == 404
    )


def test_lists_and_search_never_leak_another_projects_records(world) -> None:
    alice, bob = world["alice"], world["bob"]
    ids = list(world["b_resources"].values())
    for path in (
        "/structures",
        "/documents",
        "/investigations",
        "/ai/conversations",
        "/experimental/spectra/datasets",
        "/compute/jobs",
        "/experimental/datasets",
        "/structure-candidates",
        "/memory",
        "/files",
        "/workspace/history",
    ):
        for project in (world["a1"], world["a2"]):
            body = alice.get(f"/v1/projects/{project['id']}{path}").text
            assert not any(foreign in body for foreign in ids), (path, project["name"])
    # project A1 is empty: A2's records do not appear in it, and vice versa
    assert alice.get(f"/v1/projects/{world['a1']['id']}/structures").json() == []
    assert (
        alice.get(f"/v1/projects/{world['a1']['id']}/experimental/spectra/datasets").json()[
            "datasets"
        ]
        == []
    )
    assert [p["id"] for p in alice.get("/v1/projects").json()] == [
        world["a2"]["id"],
        world["a1"]["id"],
    ] or {p["id"] for p in alice.get("/v1/projects").json()} == {
        world["a1"]["id"],
        world["a2"]["id"],
    }
    assert [p["id"] for p in bob.get("/v1/projects").json()] == [world["b1"]["id"]]
    # knowledge search is scoped to the named project and the caller
    for query in ({"query": "H2 acetone chromium"}, {"query": "paper"}):
        own = alice.post(f"/v1/projects/{world['a1']['id']}/knowledge/search", json=query)
        assert own.status_code == 200 and not any(foreign in own.text for foreign in ids)
        assert (
            alice.post(f"/v1/projects/{world['b1']['id']}/knowledge/search", json=query).status_code
            == 404
        )


def test_downloads_are_project_scoped(world) -> None:
    alice, bob = world["alice"], world["bob"]
    document, structure, version = (
        world["b_resources"][k] for k in ("document", "structure", "version")
    )
    assert bob.get(
        f"/v1/projects/{world['b1']['id']}/documents/{document}/source"
    ).content.startswith(b"%PDF")
    for project in (world["a1"], world["b1"]):
        assert (
            alice.get(f"/v1/projects/{project['id']}/documents/{document}/source").status_code
            == 404
        )
        assert (
            alice.get(
                f"/v1/projects/{project['id']}/structures/{structure}/versions/{version}/export?file_format=XYZ"
            ).status_code
            == 404
        )
    arrays = f"/experimental/spectra/datasets/{world['b_resources']['dataset']}/arrays"
    assert bob.get(f"/v1/projects/{world['b1']['id']}{arrays}").status_code == 200
    assert alice.get(f"/v1/projects/{world['a1']['id']}{arrays}").status_code == 404


def test_organization_identifiers_from_the_browser_are_ignored(world) -> None:
    alice, bob = world["alice"], world["bob"]
    spoofs = [
        {
            "headers": {
                "X-ChemDFT-Organization-ID": bob.organization_id,
                "X-ChemDFT-User-ID": bob.user_id,
            }
        },
        {"params": {"organization_id": bob.organization_id, "org": bob.organization_id}},
        {
            "headers": {"X-Organization": bob.organization_id},
            "params": {"organizationId": bob.organization_id},
        },
    ]
    for spoof in spoofs:
        me = alice.get("/v1/me", **spoof).json()
        assert me["id"] == alice.user_id and me["organization"]["id"] == alice.organization_id
        listed = {p["id"] for p in alice.get("/v1/projects", **spoof).json()}
        assert {world["a1"]["id"], world["a2"]["id"]} <= listed
        assert world["b1"]["id"] not in listed
        assert alice.get(f"/v1/projects/{world['b1']['id']}", **spoof).status_code == 404
        created = alice.post(
            "/v1/projects",
            json={"name": "spoof", "slug": f"spoof-{len(spoof)}-{id(spoof)}"},
            **spoof,
        )
        assert (
            created.status_code == 201
            and created.json()["organization_id"] == alice.organization_id
        )
    # personal organizations are independent and not enumerable through any endpoint
    assert alice.organization_id != bob.organization_id
    billing_a, billing_b = alice.get("/v1/billing").json(), bob.get("/v1/billing").json()
    assert billing_a["billing_account_id"] != billing_b["billing_account_id"]
    for text in (
        alice.get("/v1/me").text,
        alice.get("/v1/billing").text,
        alice.get("/v1/projects").text,
    ):
        assert bob.organization_id not in text and bob.user_id not in text
