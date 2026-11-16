# ruff: noqa: E501
"""PF-2: every API route is classified, and the classification is checked against real behaviour.

`route_authorization_matrix.py` is the durable decision record. This module fails when a route is added
or removed without updating it, and audits every project-scoped route as owner, editor, viewer and
outsider (see `route_audit.py`).
"""

from __future__ import annotations

from chemdft_api.main import app
from route_audit import PREFIX, project_routes, run_audit, static_write_evidence
from route_authorization_matrix import OTHER_ROUTES, PROJECT_ROUTES

# No project route may crash (500) on the audit's requests. Two used to (an invalid experimental-import
# form value, and a malformed CIF); both are now controlled 4xx responses and the allow-list is empty.
KNOWN_UNHANDLED: set[tuple[str, str]] = set()

# Write routes whose viewer denial is proven from source only because no valid request could be built
# cheaply. A route may only be added here with a reason, never to make the audit pass.
SOURCE_EVIDENCE_ONLY: set[tuple[str, str]] = {
    # The audit's synthetic body cannot pass calculation validation (engine capability + structure
    # eligibility), so the viewer denial is proven from the code the route calls (`can(member, WRITE)`).
    ("POST", "/calculations"),
}


def _live_routes() -> set[tuple[str, str]]:
    # FastAPI's deferred included routers are not APIRoute objects in app.routes.
    # OpenAPI resolves them; retain non-schema routes such as docs and health too.
    direct = {
        (method, route.path)
        for route in app.routes
        if hasattr(route, "methods")
        for method in route.methods - {"HEAD", "OPTIONS"}
    }
    schema = {(method.upper(), path) for path, operations in app.openapi()["paths"].items()
              for method in operations if method.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE"}}
    return direct | schema


def test_every_live_route_is_classified_and_the_matrix_has_no_stale_entries() -> None:
    classified = {(m, f"{PREFIX}{s}" if s != "/" else PREFIX) for (m, s) in PROJECT_ROUTES} | set(
        OTHER_ROUTES
    )
    live = _live_routes()
    assert live - classified == set(), (
        f"unclassified routes (add them to the matrix): {sorted(live - classified)}"
    )
    assert classified - live == set(), (
        f"matrix entries for routes that no longer exist: {sorted(classified - live)}"
    )


def test_the_route_inventory_numbers_are_the_documented_ones() -> None:
    live = _live_routes()
    project = {r for r in live if r[1].startswith(PREFIX)}
    methods = {m for m, _ in live}
    assert (len(live), len(project), len(live) - len(project)) == (171, 138, 33)
    assert methods == {"GET", "POST", "PUT", "PATCH"}  # PATCH: project rename only (0.0.17); no DELETE
    reads = sum(1 for cls, _ in PROJECT_ROUTES.values() if cls == "READ")
    writes = sum(1 for cls, _ in PROJECT_ROUTES.values() if cls == "WRITE")
    assert (reads, writes, sum(1 for _, gated in PROJECT_ROUTES.values() if gated)) == (79, 59, 2)
    assert len({v for v in OTHER_ROUTES.values()}) == 6  # PUBLIC, PUBLIC_SIGNED, PUBLIC_TICKET, PUBLIC_STATE, USER, ORG_MEMBER


def test_roles_and_cross_tenant_behaviour_on_every_project_route(api) -> None:
    client, sessions, settings = api
    project = client.post("/v1/projects", json={"name": "audit", "slug": "audit"}).json()
    rows = run_audit(client, sessions, settings, project["id"])
    routes = {(m, p.removeprefix(PREFIX) or "/"): r for m, p, r in project_routes()}
    assert len(rows) == len(PROJECT_ROUTES) == 138

    crashed, unproven, empirical, static_only, read_ok = set(), [], 0, set(), 0
    for row in rows:
        key = (row.method, row.path)
        classification, _gated = PROJECT_ROUTES[key]
        status = row.status
        if 500 in status.values():
            crashed.add(key)
        # an outsider can never learn that the project exists: never a 2xx, never a 403
        assert status["outsider"] not in range(200, 300) and status["outsider"] != 403, (
            key,
            status,
        )
        # owner and editor differ only in MANAGE, which no route needs: they are treated identically
        assert status["owner"] == status["editor"], (key, status)
        if classification == "READ":
            assert all(status[who] not in (401, 403) for who in ("owner", "editor", "viewer")), (
                key,
                status,
            )
            read_ok += 1
            continue
        denied = ("write", "viewer", False) in row.consulted["viewer"] or status["viewer"] == 403
        allowed = ("write", "editor", True) in row.consulted["editor"]
        if denied and (allowed or status["editor"] != 403):
            empirical += 1
        elif static_write_evidence(routes[key]):
            static_only.add(key)  # proven from the code the route calls, not from behaviour
        else:
            unproven.append(key)
    assert crashed == KNOWN_UNHANDLED, crashed
    assert unproven == [], f"write routes with no proof that a viewer is denied: {unproven}"
    assert static_only == SOURCE_EVIDENCE_ONLY, static_only
    assert (read_ok, empirical + len(static_only)) == (79, 59)
    assert empirical == 58  # every other write route is proven by behaviour


def test_unauthenticated_and_non_project_routes_behave_as_classified(api) -> None:
    client, _sessions, _settings = api
    assert client.get("/health").status_code == 200  # PUBLIC
    assert client.get("/openapi.json").status_code == 200
    for method, path in (key for key, value in OTHER_ROUTES.items() if value == "USER"):
        # USER routes need a human identity; in dev mode that is the local developer, and /v1/me says who
        if method == "GET":
            assert client.get(path).status_code == 200, path
    # PUBLIC_SIGNED: no session is involved; authenticity is the provider's signature (see test_billing)
    assert OTHER_ROUTES[("POST", "/v1/billing/webhooks/stripe")] == "PUBLIC_SIGNED"
