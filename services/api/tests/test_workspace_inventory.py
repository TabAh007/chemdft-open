from io import BytesIO

from chemdft_api.ai.context_builder import AIContextBuilder
from chemdft_api.ai_models import AIContextSnapshotRecord
from chemdft_api.context import Identity
from chemdft_api.models import Membership, Organization, User
from chemdft_api.scientific_models import AuditEventRecord
from pypdf import PdfWriter


def test_project_file_and_history_inventory_are_scoped_and_source_safe(api) -> None:
    client, sessions, _settings = api
    first = client.post("/v1/projects", json={"name": "First", "slug": "workspace-first"}).json()
    second = client.post("/v1/projects", json={"name": "Second", "slug": "workspace-second"}).json()
    upload = client.post(
        f"/v1/projects/{first['id']}/files",
        files={"upload": ("paper.pdf", b"%PDF-1.4\n", "application/pdf")},
    )
    assert upload.status_code == 201

    files = client.get(f"/v1/projects/{first['id']}/files")
    assert files.status_code == 200
    assert [(item["id"], item["original_name"]) for item in files.json()] == [
        (upload.json()["id"], "paper.pdf")
    ]
    assert "object_key" not in files.text
    assert client.get(f"/v1/projects/{second['id']}/files").json() == []
    assert client.get(f"/v1/projects/{first['id']}/workspace/history").json() == []

    foreign_org = "00000000-0000-4000-8000-000000000020"
    foreign_user = "00000000-0000-4000-8000-000000000021"
    with sessions() as session:
        session.add(Organization(id=foreign_org, name="Other organization"))
        session.add(
            User(id=foreign_user, email="workspace-other@example.invalid", display_name="Other")
        )
        session.flush()
        session.add(Membership(organization_id=foreign_org, user_id=foreign_user, role="owner"))
        session.commit()
    headers = {"X-ChemDFT-User-ID": foreign_user, "X-ChemDFT-Organization-ID": foreign_org}
    assert client.get(f"/v1/projects/{first['id']}/files", headers=headers).status_code == 404
    assert (
        client.get(f"/v1/projects/{first['id']}/workspace/history", headers=headers).status_code
        == 404
    )


def test_workspace_history_exposes_meaningful_immutable_events_and_scoped_links(api) -> None:
    client, sessions, _settings = api
    project = client.post(
        "/v1/projects", json={"name": "History", "slug": "workspace-history"}
    ).json()
    version_id = "00000000-0000-4000-8000-000000000101"
    structure_id = "00000000-0000-4000-8000-000000000102"
    with sessions() as session:
        session.add(
            AuditEventRecord(
                event_name="structure.candidate.promoted",
                actor_or_service_id="test",
                organization_id=project["organization_id"],
                project_id=project["id"],
                request_id="00000000-0000-4000-8000-000000000103",
                targets_json=[
                    {
                        "project_id": project["id"],
                        "entity_type": "structure",
                        "entity_id": structure_id,
                    },
                    {
                        "project_id": project["id"],
                        "entity_type": "structure.version",
                        "entity_id": version_id,
                    },
                ],
                outcome="SUCCEEDED",
                safe_metadata_json=[{"private": "not for UI"}],
            )
        )
        session.add(
            AuditEventRecord(
                event_name="tool.invoked",
                actor_or_service_id="test",
                organization_id=project["organization_id"],
                project_id=project["id"],
                request_id="00000000-0000-4000-8000-000000000104",
                targets_json=[],
                outcome="SUCCEEDED",
            )
        )
        session.commit()
    response = client.get(f"/v1/projects/{project['id']}/workspace/history")
    assert response.status_code == 200
    events = response.json()
    assert len(events) == 1
    assert events[0]["label"] == "Structure version committed from candidate"
    assert events[0]["target_kind"] == "structureVersion"
    assert events[0]["target_id"] == version_id
    assert events[0]["source_id"] == structure_id
    assert "private" not in response.text


def test_ai_current_view_keeps_other_project_documents_in_context(api) -> None:
    client, sessions, settings = api
    project = client.post("/v1/projects", json={"name": "Two papers", "slug": "two-papers"}).json()
    document_ids = []
    for title in ("First project paper", "Second project paper"):
        stream = BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=300, height=400)
        writer.add_metadata({"/Title": title})
        writer.write(stream)
        response = client.post(
            f"/v1/projects/{project['id']}/documents/imports",
            files={"upload": (f"{title}.pdf", stream.getvalue(), "application/pdf")},
        )
        assert response.status_code == 201
        document_ids.append(response.json()["document"]["id"])
    with sessions() as session:
        bundle = AIContextBuilder(
            session,
            Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id),
            project["id"],
        ).build_context(selected_document_id=document_ids[0])
        assert bundle.structured_context["document_count"] == 2
        assert all(
            title in bundle.summary_text
            for title in ("First project paper", "Second project paper")
        )
        snapshot = session.get(AIContextSnapshotRecord, bundle.snapshot_id)
        assert snapshot is not None
        assert all(
            {"entity_type": "scientific_document", "entity_id": document_id}
            in snapshot.captured_entity_refs_json
            for document_id in document_ids
        )
