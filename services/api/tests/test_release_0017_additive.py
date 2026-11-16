"""0.0.17 additive contract: structure electronic-state authority, project rename, claim token."""

from __future__ import annotations

from uuid import uuid4

from chemdft_api.contracts.catalog import StructureVersionDetail
from chemdft_api.contracts.scientific_claims import ScientificClaim
from chemdft_api.models import Membership, ProjectMember, ProjectRole
from chemdft_api.scientific_claim_actions import original_value_token
from chemdft_api.scientific_models import AuditEventRecord, ScientificDocumentRecord
from sqlalchemy import select
from test_geometry_workflow import accept, drawing, generate
from test_scientific_claim_projection import _seed_text
from test_structure_workspace import _create_project
from test_xyz_electronic_state import imported

# --- 1. electronic_state_authority -------------------------------------------------------


def _detail(client, project, version):
    response = client.get(
        f"/v1/projects/{project}/structures/{version['structure_id']}/versions/{version['id']}"
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_unannotated_xyz_import_reports_calculation_user_declared(api):
    client, _, _ = api
    project, version = imported(api, "ammonium")
    assert _detail(client, project, version)["electronic_state_authority"] == (
        "CALCULATION_USER_DECLARED"
    )


def test_annotated_xyz_reports_user_declared_xyz(api):
    client, _, _ = api
    project, version = imported(api, "ammonium", "charge=1;multiplicity=1")
    assert _detail(client, project, version)["electronic_state_authority"] == "USER_DECLARED_XYZ"


def test_generated_structure_reports_structure_version(api):
    client, _, _ = api
    project = _create_project(client, "Generated authority")["id"]
    candidate = generate(client, project, mol_block=drawing("CCCCCC")).json()
    version = accept(client, project, candidate).json()["version"]
    assert _detail(client, project, version)["electronic_state_authority"] == "STRUCTURE_VERSION"


def test_version_list_carries_authority_too(api):
    client, _, _ = api
    project, version = imported(api, "ammonium")
    rows = client.get(f"/v1/projects/{project}/structures/{version['structure_id']}/versions")
    assert rows.json()[0]["electronic_state_authority"] == "CALCULATION_USER_DECLARED"


def test_old_clients_still_parse_detail_without_the_new_field(api):
    client, _, _ = api
    project, version = imported(api, "ammonium")
    body = _detail(client, project, version)
    body.pop("electronic_state_authority")
    assert StructureVersionDetail.model_validate(body).electronic_state_authority is None


# --- 2. project rename --------------------------------------------------------------------


def test_rename_changes_name_only_and_writes_an_audit_entry(api):
    client, sessions, _ = api
    project = _create_project(client, "Old name")
    response = client.patch(f"/v1/projects/{project['id']}", json={"name": "  New   name "})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "New name" and body["slug"] == project["slug"]
    assert client.get(f"/v1/projects/{project['id']}").json()["name"] == "New name"
    with sessions() as session:
        events = session.scalars(
            select(AuditEventRecord).where(AuditEventRecord.event_name == "project.renamed")
        ).all()
        assert len(events) == 1 and events[0].project_id == project["id"]
        meta = {m["key"]: m["value"] for m in events[0].safe_metadata_json}
        assert meta == {"previous_name": "Old name", "new_name": "New name"}


def test_rename_validates_like_creation(api):
    client, _, _ = api
    project = _create_project(client, "Keep")
    for bad in ({"name": "   "}, {"name": ""}, {"name": "x" * 161}, {"name": "a", "slug": "b"}, {}):
        assert client.patch(f"/v1/projects/{project['id']}", json=bad).status_code == 422
    assert client.get(f"/v1/projects/{project['id']}").json()["name"] == "Keep"


def test_rename_reader_403_and_stranger_404(multiuser):
    alice, bob, carol = (multiuser.actor(n) for n in ("alice", "bob", "carol"))
    project = alice.create_project("rename-me", "Original")
    with multiuser.sessions() as session:
        session.add(Membership(organization_id=alice.organization_id, user_id=bob.user_id,
                               role="member"))
        session.add(
            ProjectMember(project_id=project["id"], user_id=bob.user_id, role=ProjectRole.VIEWER)
        )
        session.commit()
    path = f"/v1/projects/{project['id']}"
    in_org = {"X-Organization": alice.organization_id}
    assert bob.request("PATCH", path, json={"name": "Nope"}, headers=in_org).status_code == 403
    assert carol.request("PATCH", path, json={"name": "Nope"}).status_code == 404
    assert carol.request("PATCH", f"/v1/projects/{uuid4()}", json={"name": "N"}).status_code == 404
    assert alice.get(path).json()["name"] == "Original"
    assert alice.request("PATCH", path, json={"name": "Mine"}).json()["slug"] == "rename-me"


# --- 3. original claim text ---------------------------------------------------------------


def test_original_token_is_exact_unambiguous_and_never_invented():
    assert original_value_token(24.48, "a = 24.480 Å") == "24.480"
    assert original_value_token(24.48, "a = 24.48 and c = 24.480") is None
    assert original_value_token(24.48, "a = 24.5 Å") is None
    assert original_value_token(24.48, None) is None
    assert original_value_token([1, 2], "1 2") is None
    assert original_value_token(True, "1") is None
    assert original_value_token(10.2, "10,2 kcal") == "10,2"
    assert original_value_token(7, "x7 and 17.7") is None


def test_manual_claim_carries_original_token_and_old_clients_parse(api):
    client, sessions, _ = api
    _seed_text(api, "Nothing numeric here.")
    with sessions() as session:
        document = session.scalars(select(ScientificDocumentRecord)).first()
        document_id, project_id = document.id, document.project_id
    base = {"document_id": document_id, "page": 2, "quantity": "a", "unit": "A", "system": "s"}
    for value, quote in ((24.48, "the a axis is 24.480 A"), (3.1, "no number here")):
        response = client.post(
            f"/v1/projects/{project_id}/scientific-claims/manual",
            json={**base, "value": value, "quote": quote},
        )
        assert response.status_code == 201, response.text
    claims = client.get(f"/v1/projects/{project_id}/scientific-claims?locale=en").json()["claims"]
    entered = {c["value"]: c for c in claims if c["source_authority"] == "USER_ENTERED"}
    assert entered[24.48]["original_value_text"] == "24.480"
    assert entered[3.1]["original_value_text"] is None
    legacy = dict(entered[24.48])
    legacy.pop("original_value_text")
    assert ScientificClaim.model_validate(legacy).original_value_text is None
