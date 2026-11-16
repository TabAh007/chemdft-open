from uuid import uuid4

import pytest
from chemdft_api.context import Identity
from chemdft_api.contracts.artifacts import (
    ScientificArtifactKind,
    ScientificArtifactRegistration,
)
from chemdft_api.errors import ScientificReferenceNotFound, ScientificValidationFailed
from chemdft_api.models import StoredFile
from chemdft_api.scientific_actions import register_scientific_artifact
from chemdft_api.scientific_models import (
    AuditEventRecord,
    CalculationInputRecord,
    CalculationRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
)
from sqlalchemy.exc import IntegrityError


def test_database_rejects_cross_project_calculation_artifact_reference(api) -> None:
    client, sessions, settings = api
    project_a = client.post(
        "/v1/projects", json={"name": "Tenant A", "slug": f"tenant-a-{uuid4().hex[:8]}"}
    ).json()
    project_b = client.post(
        "/v1/projects", json={"name": "Tenant B", "slug": f"tenant-b-{uuid4().hex[:8]}"}
    ).json()
    artifact_id = str(uuid4())
    calculation_id = str(uuid4())
    with sessions() as session:
        session.add(
            ScientificArtifactRecord(
                id=artifact_id,
                project_id=project_a["id"],
                kind="CALCULATION_INPUT",
                media_type="application/octet-stream",
                format_identifier="synthetic",
                size_bytes=0,
                sha256="a" * 64,
                storage_key=f"projects/{project_a['id']}/synthetic/{artifact_id}",
                created_by=settings.dev_user_id,
                extensions_json=[],
            )
        )
        session.add(
            CalculationRecord(
                id=calculation_id,
                project_id=project_b["id"],
                state="DRAFT",
                created_by=settings.dev_user_id,
            )
        )
        session.flush()
        session.add(
            CalculationInputRecord(
                id=str(uuid4()),
                project_id=project_b["id"],
                calculation_id=calculation_id,
                structure_version_id=str(uuid4()),
                specification_json={"fixture": "synthetic-schema-only"},
                normalized_input_artifact_id=artifact_id,
                schema_version="1.0.0",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_database_rejects_cross_project_provenance_lineage(api) -> None:
    client, sessions, _settings = api
    project_a = client.post(
        "/v1/projects", json={"name": "Lineage A", "slug": f"lineage-a-{uuid4().hex[:8]}"}
    ).json()
    project_b = client.post(
        "/v1/projects", json={"name": "Lineage B", "slug": f"lineage-b-{uuid4().hex[:8]}"}
    ).json()
    provenance_a_id = str(uuid4())
    with sessions() as session:
        session.add(
            ProvenanceRecordRow(
                id=provenance_a_id,
                project_id=project_a["id"],
                subject_type="structure.version",
                subject_id=str(uuid4()),
                source_class="EXTRACTED",
                detail="PARSER_EXTRACTED",
                verification_state="UNVERIFIED",
                producer_kind="SERVICE",
                producer_identifier="synthetic.parser",
                producer_software_version="0.0-test",
                operation="synthetic.parse",
                operation_version="0.0-test",
                parameters_json=[],
                approximate=False,
                correlation_id=str(uuid4()),
                schema_version="1.0.0",
            )
        )
        session.commit()

    with sessions() as session:
        session.add(
            ProvenanceInputRow(
                provenance_record_id=provenance_a_id,
                project_id=project_b["id"],
                position=0,
                input_type="ENTITY",
                input_id=str(uuid4()),
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()

    with sessions() as session:
        session.add(
            ProvenanceRecordRow(
                project_id=project_b["id"],
                subject_type="structure.version",
                subject_id=str(uuid4()),
                source_class="EXTRACTED",
                detail="PARSER_EXTRACTED",
                verification_state="SUPERSEDED",
                producer_kind="SERVICE",
                producer_identifier="synthetic.parser",
                producer_software_version="0.0-test",
                operation="synthetic.parse",
                operation_version="0.0-test",
                parameters_json=[],
                approximate=False,
                supersedes_id=provenance_a_id,
                correlation_id=str(uuid4()),
                schema_version="1.0.0",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_raw_file_registration_creates_one_immutable_scientific_artifact(api) -> None:
    client, sessions, settings = api
    project_a = client.post(
        "/v1/projects", json={"name": "Artifact A", "slug": f"artifact-a-{uuid4().hex[:8]}"}
    ).json()
    project_b = client.post(
        "/v1/projects", json={"name": "Artifact B", "slug": f"artifact-b-{uuid4().hex[:8]}"}
    ).json()
    uploaded = client.post(
        f"/v1/projects/{project_a['id']}/files",
        files={
            "upload": ("synthetic.dat", b"synthetic schema fixture", "application/octet-stream")
        },
    ).json()
    identity = Identity(
        user_id=settings.dev_user_id,
        organization_id=settings.dev_organization_id,
    )
    registration = ScientificArtifactRegistration(
        project_id=project_a["id"],
        stored_file_id=uploaded["id"],
        kind=ScientificArtifactKind.RAW_UPLOAD,
        format_identifier="synthetic",
    )
    with sessions() as session:
        first = register_scientific_artifact(session, identity, registration)
        second = register_scientific_artifact(session, identity, registration)
    assert first == second
    assert first.sha256 == uploaded["sha256"]
    assert not hasattr(first, "storage_key")
    with sessions() as session:
        record = session.get(ScientificArtifactRecord, str(first.id))
        stored_file = session.get(StoredFile, uploaded["id"])
    assert record is not None
    assert stored_file is not None
    assert record.storage_key == stored_file.object_key

    conflicting = registration.model_copy(update={"kind": ScientificArtifactKind.COORDINATES})
    with sessions() as session, pytest.raises(ScientificValidationFailed):
        register_scientific_artifact(session, identity, conflicting)

    foreign_registration = registration.model_copy(update={"project_id": project_b["id"]})
    with sessions() as session, pytest.raises(ScientificReferenceNotFound):
        register_scientific_artifact(session, identity, foreign_registration)


def test_audit_records_are_append_only_at_the_application_model_boundary(api) -> None:
    client, sessions, settings = api
    project = client.post(
        "/v1/projects", json={"name": "Audit fixture", "slug": f"audit-{uuid4().hex[:8]}"}
    ).json()
    with sessions() as session:
        event = AuditEventRecord(
            event_name="artifact.registered",
            actor_or_service_id=settings.dev_user_id,
            organization_id=settings.dev_organization_id,
            project_id=project["id"],
            request_id=str(uuid4()),
            targets_json=[],
            outcome="SUCCEEDED",
            artifact_references_json=[],
            safe_metadata_json=[],
        )
        session.add(event)
        session.commit()
        event.outcome = "FAILED"
        with pytest.raises(ValueError, match="append-only"):
            session.commit()
        session.rollback()
