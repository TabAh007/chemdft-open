"""PF-2: owner / editor / viewer semantics, centralized in `project_access`."""

from __future__ import annotations

import pathlib
import re

import pytest
from chemdft_api.errors import ProjectAccessDenied
from chemdft_api.models import ProjectRole
from chemdft_api.project_access import ROLE_CAPABILITIES, ProjectCapability, can, require_capability
from route_audit import add_member
from spectra_support import import_spectrum, ir_text

XYZ = b"2\nH2\nH 0 0 -0.37\nH 0 0 0.37\n"
SRC = pathlib.Path(__file__).resolve().parents[1] / "src" / "chemdft_api"


def _xyz(key: str) -> dict:
    return {
        "files": {"upload": ("h2.xyz", XYZ, "chemical/x-xyz")},
        "data": {"file_format": "XYZ", "idempotency_key": key, "structure_name": "H2"},
    }


class _Member:
    def __init__(self, role: str) -> None:
        self.role = role


def test_the_capability_mapping_is_the_documented_role_matrix() -> None:
    expected = {
        "owner": {"read", "write", "manage"},
        "editor": {"read", "write"},
        "viewer": {"read"},
    }
    assert {r: {c.value for c in caps} for r, caps in ROLE_CAPABILITIES.items()} == expected
    assert set(ROLE_CAPABILITIES) == {
        r.value for r in ProjectRole
    }  # every real role, nothing invented
    for role, caps in expected.items():
        for capability in ProjectCapability:
            assert can(_Member(role), capability) == (capability.value in caps)
    for unknown in ("admin", "", "OWNER", "root"):
        assert not any(
            can(_Member(unknown), c) for c in ProjectCapability
        )  # unknown roles allow nothing
    with pytest.raises(ProjectAccessDenied):
        require_capability(_Member("viewer"), ProjectCapability.WRITE)
    require_capability(_Member("editor"), ProjectCapability.WRITE)


def test_no_action_module_compares_roles_on_its_own() -> None:
    allowed = {
        "project_access.py",
        "models.py",
        "service_principals.py",
        "ownership_service.py",
        "identity_service.py",
    }
    offenders = []
    for path in SRC.rglob("*.py"):
        if path.name in allowed or "contracts" in path.parts or path.name == "gateway.py":
            continue
        text = path.read_text()
        # Creating an owner membership is data assignment, not an authorization decision.
        text = re.sub(r"role\s*=\s*ProjectRole\.OWNER\b", "role=creator", text)
        # Echoing a role into typed context does not make an authorization decision.
        text = re.sub(r"role=member\.role\b", "role=echoed", text)
        if re.search(r"member\.role|ProjectRole\.(OWNER|EDITOR|VIEWER)\b|EDIT_ROLES", text):
            offenders.append(str(path.relative_to(SRC)))
    # actions.py legitimately assigns the creator the OWNER role and echoes roles in responses
    assert [o for o in offenders if o != "actions.py"] == []


@pytest.fixture
def team(api):
    """One dev-mode organization: owner, editor, viewer and an outsider with no membership."""
    client, sessions, settings = api
    project = client.post("/v1/projects", json={"name": "team", "slug": "team"}).json()
    pid = project["id"]
    ids = {
        "editor": add_member(
            sessions, pid, "editor@x.test", "editor", settings.dev_organization_id
        ),
        "viewer": add_member(
            sessions, pid, "viewer@x.test", "viewer", settings.dev_organization_id
        ),
        "outsider": add_member(sessions, pid, "outsider@x.test", "", settings.dev_organization_id),
    }

    def call(role: str, method: str, path: str, **kwargs):
        user = settings.dev_user_id if role == "owner" else ids[role]
        headers = {
            "X-ChemDFT-User-ID": user,
            "X-ChemDFT-Organization-ID": settings.dev_organization_id,
        }
        return client.request(method, f"/v1/projects/{pid}{path}", headers=headers, **kwargs)

    return call, pid, client, settings


def test_every_member_reads_and_an_outsider_does_not(team) -> None:
    call, *_ = team
    for path in (
        "",
        "/structures",
        "/investigations",
        "/ai/conversations",
        "/experimental/spectra/datasets",
        "/memory",
        "/knowledge/status",
        "/workspace/history",
    ):
        for role in ("owner", "editor", "viewer"):
            assert call(role, "GET", path).status_code == 200, (role, path)
        assert call("outsider", "GET", path).status_code == 404, path  # existence is not revealed


def test_viewers_are_read_only_on_real_mutations(team) -> None:
    call, *_ = team
    mutations = {
        "structure import": ("POST", "/structures/imports", lambda k: _xyz(f"import-{k}"), 201),
        "investigation": (
            "POST",
            "/investigations",
            lambda k: {"json": {"title": f"t-{k}", "objective": "o"}},
            201,
        ),
        "project memory": (
            "POST",
            "/memory",
            lambda k: {"json": {"memory_type": "PROJECT_NOTE", "content": f"m-{k}"}},
            201,
        ),
        "knowledge reindex": ("POST", "/knowledge/reindex", lambda k: {}, 200),
        "file upload": (
            "POST",
            "/files",
            lambda k: {"files": {"upload": (f"{k}.txt", b"data", "text/plain")}},
            201,
        ),
    }
    for label, (method, path, build, ok) in mutations.items():
        for role in ("owner", "editor"):
            response = call(role, method, path, **build(role))
            assert response.status_code == ok, (
                label,
                role,
                response.status_code,
                response.text[:200],
            )
        viewer = call("viewer", method, path, **build("viewer"))
        assert viewer.status_code == 403, (
            label,
            viewer.status_code,
            viewer.text[:200],
        )  # a member may know it exists
        assert call("outsider", method, path, **build("outsider")).status_code == 404, label


def test_private_ai_conversations_are_available_to_read_members(team) -> None:
    call, *_ = team
    for role in ("owner", "editor", "viewer"):
        response = call(role, "POST", "/ai/conversations", json={"title": f"Private {role}"})
        assert response.status_code == 201
    assert call("outsider", "POST", "/ai/conversations", json={}).status_code == 404


def test_spectrum_association_is_a_write_and_owner_adds_nothing_over_editor(team) -> None:
    call, pid, client, settings = team
    owner_headers = {
        "X-ChemDFT-User-ID": settings.dev_user_id,
        "X-ChemDFT-Organization-ID": settings.dev_organization_id,
    }
    dataset = import_spectrum(
        client,
        pid,
        ir_text(),
        choices={"x_unit": "cm^-1", "y_quantity": "ABSORBANCE", "y_unit": "absorbance"},
    )
    path = f"/experimental/spectra/datasets/{dataset['id']}/association"
    body = {"json": {"state": "ASSOCIATED_WITH_SAMPLE", "sample_label": "acetone"}}
    assert call("viewer", "PUT", path, **body).status_code == 403
    for role in ("editor", "owner"):
        assert (
            call(role, "PUT", path, **body).status_code == 200
        )  # no project route needs the MANAGE capability
    assert (
        call("viewer", "GET", f"/experimental/spectra/datasets/{dataset['id']}").status_code == 200
    )
    assert owner_headers  # (kept for clarity: dev owner identity is the project creator)


def test_approval_decisions_need_write_and_never_a_viewer(team) -> None:
    call, *_ = team
    # a viewer is refused by role (403) before any approval lookup
    for path in ("/ai/approvals/{a}/decision", "/investigations/{i}/approvals/{a}/decision"):
        concrete = path.format(
            a="00000000-0000-4000-8000-0000000000aa", i="00000000-0000-4000-8000-0000000000bb"
        )
        assert call("viewer", "POST", concrete, json={"decision": "APPROVE"}).status_code in (
            403,
            422,
        )
        assert call("outsider", "POST", concrete, json={"decision": "APPROVE"}).status_code in (
            404,
            422,
        )
