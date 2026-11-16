"""Published template security and truthful structure-only copy, using real source files."""

import hashlib

import pytest
from chemdft_api.actions import authorize_project_access
from chemdft_api.context import Identity, ServiceIdentity
from chemdft_api.errors import ProjectAccessDenied, ScientificValidationFailed
from chemdft_api.example_models import ExampleTemplate, ProjectExampleOrigin
from chemdft_api.examples.catalog import catalogue
from chemdft_api.examples.seed import SEED_USER, SYSTEM_ORG, seed_examples
from chemdft_api.examples.service import _assert_structure_only, content_hash, copy_example
from chemdft_api.models import Project, ProjectKind, ProjectMember
from chemdft_api.navigator.facts import Capabilities
from chemdft_api.project_access import ProjectCapability, can
from chemdft_api.scientific_models import (
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from chemdft_api.storage import LocalObjectStore
from sqlalchemy import func, select


@pytest.fixture
def examples(multiuser, monkeypatch):
    from chemdft_api.examples import service

    monkeypatch.setattr(
        service,
        "observe",
        lambda _settings: Capabilities(frozenset({"ENERGY", "GEOMETRY_OPTIMIZATION"}), True),
    )
    with multiuser.sessions() as session:
        seed_examples(session, LocalObjectStore(multiuser.settings.object_root), publish=True)
    return multiuser


def test_model_publication_and_idempotent_build(multiuser):
    store = LocalObjectStore(multiuser.settings.object_root)
    with multiuser.sessions() as session:
        seed_examples(session, store)
        first = session.scalars(select(ExampleTemplate)).all()
        assert len(first) == 3 and all(t.sealed and not t.published for t in first)
        hashes = {t.project_id: t.content_sha256 for t in first}
        seed_examples(session, store, publish=True)
        assert hashes == {t.project_id: content_hash(session, t.project_id) for t in first}
        assert session.scalar(select(func.count()).select_from(Project)) == 3
        assert session.scalar(select(func.count()).select_from(ProjectMember)) == 0
        assert session.scalar(select(func.count()).select_from(StructureVersionRecord)) == 3
        assert session.get(Project, first[0].project_id).kind == ProjectKind.EXAMPLE_TEMPLATE
    assert len(multiuser.client.get("/v1/examples").json()) == 3


def test_public_reads_are_explicit_slug_scoped_and_ai_independent(examples, monkeypatch):
    from chemdft_api.ai.service import AIScientistService

    monkeypatch.setattr(
        AIScientistService, "__init__", lambda *a, **k: pytest.fail("Example invoked AI")
    )
    env = examples
    client = env.client
    index = client.get("/v1/examples")
    assert index.status_code == 200
    for spec in catalogue():
        slug = spec["slug"]
        data = client.get(f"/v1/examples/{slug}").json()
        assert data["example"]["sealed"] and data["example"]["atom_count"] == spec["atom_count"]
        assert data["structure"]["version"]["created_by"] == SEED_USER
        assert data["example"]["available_result_types"] == []
        assert data["navigator"]["facts_summary"]["sealed"]
        assert not data["navigator"]["facts_summary"]["can_write"]
        assert client.get(f"/v1/projects/{spec['template_project_id']}").status_code == 401
        assert client.get(f"/v1/examples/{spec['template_project_id']}").status_code == 404
        source = client.get(f"/v1/examples/{slug}/source")
        assert (
            source.status_code == 200
            and hashlib.sha256(source.content).hexdigest() == spec["source_sha256"]
        )
        assert source.headers["x-content-type-options"] == "nosniff"
        assert client.post(f"/v1/examples/{slug}/copy").status_code == 401
        assert client.post(f"/v1/examples/{slug}").status_code == 405
    private = env.actor("alice").create_project("private")
    assert client.get(f"/v1/projects/{private['id']}").status_code == 401
    assert client.get("/v1/examples/private").status_code == 404
    with env.sessions() as session:
        session.get(ExampleTemplate, catalogue()[0]["template_project_id"]).published = False
        session.commit()
    assert client.get("/v1/examples/cr2o3-eskolaite").status_code == 404
    assert env.actor("alice").post("/v1/examples/cr2o3-eskolaite/copy").status_code == 404


def test_crystal_navigator_has_real_views_and_no_periodic_compute(examples):
    state = examples.client.get("/v1/examples/cr2o3-eskolaite/navigator").json()
    assert {"structure.crystal", "structure.unit_cell", "provenance.available"} <= {
        h["state_id"] for h in state["have"]
    }
    assert {"structure.inspect", "structure.inspect_unit_cell", "structure.build_supercell"} <= {
        a["action_id"] for a in state["next"]
    }
    assert not any(a["category"] == "calculation" for a in state["next"])
    assert any(
        "periodic_compute_unsupported" in {r["code"] for r in a["reasons"]}
        for a in state["blocked"]
    )
    assert "notice.source_identity_unestablished" in state["notices"]
    assert (
        examples.client.get("/v1/examples/cr2o3-eskolaite/navigator?goal=unknown").status_code
        == 422
    )


@pytest.mark.parametrize("slug", ["cr2o3-eskolaite", "benzene", "caffeine"])
def test_copy_creates_normal_owned_tenant_project_preserving_provenance(examples, slug):
    env = examples
    actor = env.actor("alice")
    actor.get("/v1/me")
    source = env.client.get(f"/v1/examples/{slug}").json()
    pid = source["example"]["template_project_id"]
    with env.sessions() as session:
        original_hash = content_hash(session, pid)
        source_version = session.get(StructureVersionRecord, source["structure"]["version"]["id"])
        original_creator = source_version.created_by
        provenance = session.get(ProvenanceRecordRow, source_version.provenance_record_id)
        producer = (
            provenance.producer_identifier,
            provenance.created_at,
            provenance.parameters_json,
        )
    copied = actor.post(f"/v1/examples/{slug}/copy")
    assert copied.status_code == 201, copied.text
    output = copied.json()
    new_id = output["project_id"]
    assert new_id != pid and output["kind"] == "NORMAL" and output["copied_result_count"] == 0
    assert output["organization_id"] == actor.organization_id
    assert actor.get(f"/v1/projects/{new_id}").json()["role"] == "owner"
    assert env.actor("bob").get(f"/v1/projects/{new_id}").status_code == 404
    with env.sessions() as session:
        project = session.get(Project, new_id)
        assert project.kind == ProjectKind.NORMAL
        assert project.created_by == actor.user_id
        origin = session.get(ProjectExampleOrigin, new_id)
        assert origin.template_project_id == pid and origin.example_slug == slug
        assert origin.copied_by == actor.user_id and origin.template_content_sha256 == original_hash
        version = session.scalar(
            select(StructureVersionRecord).where(StructureVersionRecord.project_id == new_id)
        )
        assert version.created_by == original_creator and version.created_by != actor.user_id
        assert (
            version.representation_json["coordinates"]
            == source_version.representation_json["coordinates"]
        )
        cloned = session.get(ProvenanceRecordRow, version.provenance_record_id)
        assert (cloned.producer_identifier, cloned.created_at, cloned.parameters_json) == producer
        assert (
            cloned.source_class == provenance.source_class
            and cloned.verification_state == provenance.verification_state
        )
        assert (
            cloned.source_artifact_id == origin.record_mapping_json[provenance.source_artifact_id]
        )
        for a in session.scalars(
            select(ScientificArtifactRecord).where(ScientificArtifactRecord.project_id == new_id)
        ):
            assert a.created_by == original_creator
            assert (
                hashlib.sha256(
                    LocalObjectStore(env.settings.object_root).get_bytes(a.storage_key, 1024 * 1024)
                ).hexdigest()
                == a.sha256
            )
        assert content_hash(session, pid) == original_hash
    assert actor.post(f"/v1/examples/{slug}/copy").json()["project_id"] != new_id
    # Canonical child IDs cannot be substituted into the copy's private routes.
    s = source["structure"]
    assert (
        actor.get(
            f"/v1/projects/{new_id}/structures/{s['structure']['id']}/versions/{s['version']['id']}"
        ).status_code
        == 404
    )
    uploaded = actor.post(
        f"/v1/projects/{new_id}/files",
        files={"upload": ("note.txt", b"new user evidence", "text/plain")},
    )
    assert uploaded.status_code == 201, uploaded.text


def test_cannot_copy_into_another_org_or_as_a_service(examples):
    env = examples
    alice = env.actor("alice")
    bob = env.actor("bob")
    alice.get("/v1/me")
    bob.get("/v1/me")
    with env.sessions() as session:
        with pytest.raises(ProjectAccessDenied):
            copy_example(
                session,
                Identity(alice.user_id, bob.organization_id),
                "benzene",
                LocalObjectStore(env.settings.object_root),
            )
        with pytest.raises(ProjectAccessDenied):
            copy_example(
                session,
                ServiceIdentity(SEED_USER, SYSTEM_ORG, service="compute-worker"),
                "benzene",
                LocalObjectStore(env.settings.object_root),
            )
    response = alice.post(
        "/v1/examples/benzene/copy", headers={"X-Organization-ID": bob.organization_id}
    )
    assert (
        response.status_code == 201 and response.json()["organization_id"] == alice.organization_id
    )


@pytest.mark.parametrize("role", ["owner", "editor", "viewer"])
def test_canonical_access_never_confers_write_or_manage(examples, role):
    env = examples
    with env.sessions() as session:
        session.add(
            ProjectMember(
                project_id=catalogue()[0]["template_project_id"], user_id=SEED_USER, role=role
            )
        )
        session.commit()
        _, access = authorize_project_access(
            session, Identity(SEED_USER, SYSTEM_ORG), catalogue()[0]["template_project_id"]
        )
        assert can(access, ProjectCapability.READ)
        assert not can(access, ProjectCapability.WRITE) and not can(
            access, ProjectCapability.MANAGE
        )
        with pytest.raises(ProjectAccessDenied):
            authorize_project_access(
                session,
                ServiceIdentity(
                    SEED_USER,
                    SYSTEM_ORG,
                    service="compute-worker",
                    work_project_id=catalogue()[0]["template_project_id"],
                ),
                catalogue()[0]["template_project_id"],
            )


def test_project_metadata_and_copy_lineage_are_immutable(examples):
    env = examples
    actor = env.actor("alice")
    result = actor.post("/v1/examples/benzene/copy").json()
    with env.sessions() as session:
        project = session.get(Project, catalogue()[0]["template_project_id"])
        project.name = "changed"
        with pytest.raises(ValueError, match="sealed"):
            session.commit()
        session.rollback()
        project = session.get(Project, catalogue()[0]["template_project_id"])
        project.kind = ProjectKind.NORMAL
        with pytest.raises(ValueError, match="sealed"):
            session.commit()
        session.rollback()
        origin = session.get(ProjectExampleOrigin, result["project_id"])
        origin.example_slug = "forged"
        with pytest.raises(ValueError, match="append-only"):
            session.commit()
        session.rollback()
        template = session.get(ExampleTemplate, catalogue()[0]["template_project_id"])
        template.sealed = False
        with pytest.raises(ValueError, match="sealed"):
            session.commit()


def test_unknown_result_copy_refuses_without_rewriting_producers(examples):
    from chemdft_api.scientific_models import CalculationRecord

    env = examples
    # A future calculation-bearing template is outside this deliberately closed copy graph.
    with env.sessions() as session:
        session.add(
            CalculationRecord(
                project_id=catalogue()[0]["template_project_id"],
                created_by=SEED_USER,
                state="SUCCEEDED",
            )
        )
        session.commit()
        with pytest.raises(ScientificValidationFailed, match="structure-only"):
            _assert_structure_only(session, catalogue()[0]["template_project_id"])
        before = session.scalar(select(func.count()).select_from(Project))
    response = env.actor("alice").post("/v1/examples/cr2o3-eskolaite/copy")
    assert response.status_code == 422
    with env.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Project)) == before


def test_all_project_write_routes_refuse_sealed_owner(api, monkeypatch):
    from route_audit import prepare, run_audit
    from route_authorization_matrix import PROJECT_ROUTES

    client, sessions, settings = api
    pid = client.post(
        "/v1/projects", json={"name": "template-policy", "slug": "template-policy"}
    ).json()["id"]
    prepare(
        client,
        {
            "X-ChemDFT-User-ID": settings.dev_user_id,
            "X-ChemDFT-Organization-ID": settings.dev_organization_id,
        },
        pid,
    )
    with sessions() as session:
        session.get(Project, pid).kind = ProjectKind.EXAMPLE_TEMPLATE
        session.commit()
    monkeypatch.setattr("route_audit.prepare", lambda *args: None)
    rows = run_audit(client, sessions, settings, pid)
    writes = [row for row in rows if PROJECT_ROUTES[(row.method, row.path)][0] == "WRITE"]
    assert len(writes) == 59
    for row in writes:
        for who in ["owner", "editor", "viewer"]:
            assert row.status[who] not in range(200, 300) and row.status[who] != 500, (
                row.path,
                who,
                row.status,
            )
            assert not any(cap == "write" and allowed for cap, role, allowed in row.consulted[who])


def test_new_calculation_after_copy_uses_destination_identity_and_no_auto_jobs(
    examples, monkeypatch
):
    from chemdft_api.scientific_models import ComputeJobRecord, ComputeReservationRecord
    from test_compute_gateway import _energy_spec

    monkeypatch.setattr("chemdft_api.calculation_actions.validate_capability", lambda *_: None)
    actor = examples.actor("alice")
    copied = actor.post("/v1/examples/benzene/copy").json()
    pid = copied["project_id"]
    with examples.sessions() as session:
        assert session.scalar(select(func.count()).select_from(ComputeJobRecord)) == 0
        version = session.scalar(
            select(StructureVersionRecord).where(StructureVersionRecord.project_id == pid)
        )
        version_id = version.id
    response = actor.post(
        f"/v1/projects/{pid}/calculations",
        json={
            "structure_version": {
                "project_id": pid,
                "entity_type": "structure.version",
                "entity_id": version_id,
            },
            "specification": _energy_spec(),
            "idempotency_key": "explicit-new-calculation",
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["calculation"]["state"] == "QUEUED" and data["result"] is None
    with examples.sessions() as session:
        job = session.get(ComputeJobRecord, data["compute_job"]["id"])
        assert job.project_id == pid and job.submitted_by == actor.user_id
        reservation = session.get(ComputeReservationRecord, job.reservation_id)
        assert reservation.project_id == pid
        assert session.get(Project, reservation.project_id).organization_id == actor.organization_id


def test_corrupt_artifact_refuses_copy_and_rolls_back(examples):
    actor = examples.actor("alice")
    actor.get("/v1/me")
    store = LocalObjectStore(examples.settings.object_root)
    with examples.sessions() as session:
        template = session.scalar(select(ExampleTemplate).where(ExampleTemplate.slug == "benzene"))
        artifact = session.scalar(
            select(ScientificArtifactRecord).where(
                ScientificArtifactRecord.project_id == template.project_id
            )
        )
        before = session.scalar(select(func.count()).select_from(Project))
        # Simulate an external storage failure without changing canonical scientific records.
        from unittest.mock import patch

        with (
            patch.object(store, "get_bytes", return_value=b"corrupt"),
            pytest.raises(ScientificValidationFailed, match="hash mismatch"),
        ):
            copy_example(session, Identity(actor.user_id, actor.organization_id), "benzene", store)
        assert session.scalar(select(func.count()).select_from(Project)) == before
        assert artifact.sha256 != hashlib.sha256(b"corrupt").hexdigest()
