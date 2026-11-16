from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from chemdft_api.contracts.base import ArtifactReference
from chemdft_api.contracts.provenance import ProvenanceClass, VerificationState
from chemdft_api.contracts.results import (
    AuthoritativeResultSubmission,
    EnergyResult,
    OptimizationResult,
)
from chemdft_api.contracts.scientific import (
    EngineReference,
    QuantityDimension,
    ScientificQuantity,
    UnitReference,
    UnitStandard,
)
from chemdft_api.errors import (
    ArtifactHashMismatch,
    CrossProjectReference,
    InvalidLifecycleTransition,
    SchemaVersionUnsupported,
    ScientificReferenceNotFound,
    ScientificValidationFailed,
    TrustedProducerRequired,
)
from chemdft_api.scientific_actions import accept_authoritative_result
from chemdft_api.scientific_models import (
    AuditEventRecord,
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
)
from chemdft_api.trusted_producers import (
    ProducerType,
    TrustedProducerContext,
    issue_trusted_producer_context,
)
from sqlalchemy import func, select

HASH = "a" * 64


def _firewall_fixture(api, *, task: str = "ENERGY", producer_id: str = "synthetic.worker"):
    client, sessions, settings = api
    project = client.post(
        "/v1/projects", json={"name": "Firewall fixture", "slug": f"firewall-{uuid4().hex[:8]}"}
    ).json()
    project_id = project["id"]
    artifact_id = str(uuid4())
    calculation_id = str(uuid4())
    calculation_input_id = str(uuid4())
    provenance_id = str(uuid4())
    with sessions() as session:
        session.add(
            ScientificArtifactRecord(
                id=artifact_id,
                project_id=project_id,
                kind="CALCULATION_OUTPUT",
                media_type="application/octet-stream",
                format_identifier="synthetic",
                size_bytes=0,
                sha256=HASH,
                storage_key=f"projects/{project_id}/synthetic/{artifact_id}",
                created_by=settings.dev_user_id,
                extensions_json=[],
            )
        )
        session.add(
            CalculationRecord(
                id=calculation_id,
                project_id=project_id,
                state="SUCCEEDED",
                created_by=settings.dev_user_id,
            )
        )
        session.flush()
        session.add(
            CalculationInputRecord(
                id=calculation_input_id,
                project_id=project_id,
                calculation_id=calculation_id,
                structure_version_id=str(uuid4()),
                specification_json={
                    "task_type": task,
                    "method": {"identifier": "hf"},
                    "basis": {"identifier": "sto-3g"},
                },
                normalized_input_artifact_id=artifact_id,
                schema_version="1.0.0",
            )
        )
        session.add(
            ProvenanceRecordRow(
                id=provenance_id,
                project_id=project_id,
                subject_type="calculation.result",
                subject_id=str(uuid4()),
                source_class="CALCULATED",
                detail="DETERMINISTIC_TRANSFORM",
                verification_state="UNVERIFIED",
                producer_kind="SERVICE",
                producer_identifier=producer_id,
                producer_software_version="0.0-test",
                source_artifact_id=artifact_id,
                operation="synthetic.calculation",
                operation_version="0.0-test",
                parameters_json=[],
                approximate=False,
                correlation_id=str(uuid4()),
                schema_version="1.0.0",
            )
        )
        session.commit()

    reference = ArtifactReference(
        project_id=UUID(project_id), artifact_id=UUID(artifact_id), sha256=HASH
    )
    submission = AuthoritativeResultSubmission(
        result_type="chemdft.energy",
        project_id=UUID(project_id),
        calculation_id=UUID(calculation_id),
        calculation_input_id=UUID(calculation_input_id),
        producer_software=EngineReference(
            name="synthetic-engine",
            version="0.0-test",
            adapter_version="0.0-test",
            execution_backend="test.subprocess",
        ),
        payload=EnergyResult(
            total_energy=ScientificQuantity(
                value=-1.0,
                unit=UnitReference(
                    standard=UnitStandard.QCSCHEMA,
                    code="Eh",
                    dimension=QuantityDimension.ENERGY,
                ),
            ),
            method="hf",
            basis="sto-3g",
            parser_version="test",
            validator_version="test",
        ),
        provenance_record_id=UUID(provenance_id),
        raw_artifacts=(reference,),
        idempotency_key=f"fixture-{uuid4()}",
        request_id=uuid4(),
        correlation_id=uuid4(),
    )
    producer = issue_trusted_producer_context(
        producer_id=producer_id,
        producer_type=ProducerType.SCIENTIFIC_WORKER,
        project_id=UUID(project_id),
        attestation_id="synthetic-attestation",
    )
    return sessions, submission, producer


def test_valid_trusted_submission_is_authoritative_and_idempotent(api) -> None:
    sessions, submission, producer = _firewall_fixture(api)
    with sessions() as session:
        first = accept_authoritative_result(session, producer, submission)
        second = accept_authoritative_result(session, producer, submission)
        count = session.scalar(select(func.count()).select_from(CalculationResultRecord))
        accepted_events = session.scalar(
            select(func.count())
            .select_from(AuditEventRecord)
            .where(AuditEventRecord.event_name == "scientific_result.accepted")
        )

    assert first == second
    assert first.authority.value == "AUTHORITATIVE"
    assert first.source_class.value == "CALCULATED"
    assert first.verification_state is VerificationState.UNVERIFIED
    assert first.trusted_producer_type == "SCIENTIFIC_WORKER"
    assert count == 1
    assert accepted_events == 1


def test_untrusted_user_browser_and_forged_ai_contexts_are_rejected(api) -> None:
    sessions, submission, _producer = _firewall_fixture(api)
    with sessions() as session, pytest.raises(TrustedProducerRequired):
        accept_authoritative_result(session, object(), submission)  # type: ignore[arg-type]

    forged = object.__new__(TrustedProducerContext)
    object.__setattr__(forged, "producer_id", "synthetic.ai")
    object.__setattr__(forged, "producer_type", "AI")
    object.__setattr__(forged, "project_id", submission.project_id)
    object.__setattr__(forged, "attestation_id", "model-controlled")
    object.__setattr__(forged, "_issued", True)
    with sessions() as session, pytest.raises(TrustedProducerRequired):
        accept_authoritative_result(session, forged, submission)

    wrong_project = issue_trusted_producer_context(
        producer_id="synthetic.worker",
        producer_type=ProducerType.SCIENTIFIC_WORKER,
        project_id=uuid4(),
        attestation_id="synthetic-attestation",
    )
    with sessions() as session, pytest.raises(CrossProjectReference):
        accept_authoritative_result(session, wrong_project, submission)
    with sessions() as session:
        rejected = session.scalar(
            select(func.count())
            .select_from(AuditEventRecord)
            .where(AuditEventRecord.event_name == "scientific_result.rejected")
        )
    assert rejected == 1


def test_missing_provenance_and_hash_mismatch_are_rejected_and_audited(api) -> None:
    sessions, submission, producer = _firewall_fixture(api)
    missing = submission.model_copy(update={"provenance_record_id": uuid4()})
    with sessions() as session, pytest.raises(ScientificReferenceNotFound):
        accept_authoritative_result(session, producer, missing)

    bad_ref = submission.raw_artifacts[0].model_copy(update={"sha256": "b" * 64})
    bad_hash = submission.model_copy(
        update={
            "raw_artifacts": (bad_ref,),
            "idempotency_key": f"fixture-{uuid4()}",
        }
    )
    with sessions() as session, pytest.raises(ArtifactHashMismatch):
        accept_authoritative_result(session, producer, bad_hash)

    with sessions() as session:
        rejected = session.scalar(
            select(func.count())
            .select_from(AuditEventRecord)
            .where(AuditEventRecord.event_name == "scientific_result.rejected")
        )
    assert rejected == 2


def test_invalid_version_cross_project_and_ai_provenance_are_rejected(api) -> None:
    sessions, submission, producer = _firewall_fixture(api)
    unsupported = AuthoritativeResultSubmission.model_construct(
        **{**submission.__dict__, "schema_version": "0.9.0"}
    )
    with sessions() as session, pytest.raises(SchemaVersionUnsupported):
        accept_authoritative_result(session, producer, unsupported)

    foreign_ref = submission.raw_artifacts[0].model_copy(update={"project_id": uuid4()})
    cross_project = submission.model_copy(
        update={
            "raw_artifacts": (foreign_ref,),
            "idempotency_key": f"fixture-{uuid4()}",
        }
    )
    with sessions() as session, pytest.raises(CrossProjectReference):
        accept_authoritative_result(session, producer, cross_project)

    ai_provenance_id = str(uuid4())
    with sessions() as session:
        session.add(
            ProvenanceRecordRow(
                id=ai_provenance_id,
                project_id=str(submission.project_id),
                subject_type="hypothesis.record",
                subject_id=str(uuid4()),
                source_class=ProvenanceClass.AI_HYPOTHESIS,
                detail="AI_RECONSTRUCTED",
                verification_state="UNVERIFIED",
                producer_kind="MODEL",
                producer_identifier="synthetic.model",
                producer_software_version="0.0-test",
                source_artifact_id=str(submission.raw_artifacts[0].artifact_id),
                operation="synthetic.hypothesis",
                operation_version="0.0-test",
                parameters_json=[],
                approximate=True,
                correlation_id=str(uuid4()),
                schema_version="1.0.0",
            )
        )
        session.commit()
    ai_candidate = submission.model_copy(
        update={
            "provenance_record_id": UUID(ai_provenance_id),
            "idempotency_key": f"fixture-{uuid4()}",
        }
    )
    with sessions() as session, pytest.raises(ScientificValidationFailed):
        accept_authoritative_result(session, producer, ai_candidate)
    with sessions() as session:
        rejected = session.scalar(
            select(func.count())
            .select_from(AuditEventRecord)
            .where(AuditEventRecord.event_name == "scientific_result.rejected")
        )
    assert rejected == 3


def test_non_succeeded_calculation_cannot_publish(api) -> None:
    sessions, submission, producer = _firewall_fixture(api)
    with sessions() as session:
        calculation = session.get(CalculationRecord, str(submission.calculation_id))
        assert calculation is not None
        calculation.state = "RUNNING"
        session.commit()
    with sessions() as session, pytest.raises(InvalidLifecycleTransition):
        accept_authoritative_result(session, producer, submission)


def test_optimization_payload_cannot_publish_without_trajectory_and_attested_engine(api) -> None:
    sessions, submission, producer = _firewall_fixture(
        api, task="GEOMETRY_OPTIMIZATION", producer_id="local.pyscf.worker"
    )
    payload = OptimizationResult(
        trajectory_artifact=submission.raw_artifacts[0],
        trajectory_sha256=HASH,
        final_structure_version_id=uuid4(),
        final_structure_hash=HASH,
        final_energy=submission.payload.total_energy,
        step_count=1,
        method="hf",
        basis="sto-3g",
        parser_version="test",
        validator_version="test",
    )
    candidate = submission.model_copy(
        update={
            "result_type": "chemdft.optimization",
            "payload": payload,
            "idempotency_key": f"optimization-fixture-{uuid4()}",
        }
    )
    with sessions() as session, pytest.raises(ScientificValidationFailed):
        accept_authoritative_result(session, producer, candidate)
    attested = candidate.model_copy(
        update={
            "producer_software": EngineReference(
                name="pyscf",
                version="2.14.0",
                adapter_version="1.0.0",
                environment_artifact=submission.raw_artifacts[0],
                execution_backend="local.subprocess",
            ),
            "idempotency_key": f"optimization-attested-{uuid4()}",
        }
    )
    with (
        sessions() as session,
        pytest.raises(ScientificValidationFailed, match="converged validated trajectory"),
    ):
        accept_authoritative_result(session, producer, attested)
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
