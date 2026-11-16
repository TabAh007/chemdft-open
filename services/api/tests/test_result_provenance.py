"""Real SQLite identity tests; SQL corruption deliberately bypasses append-only ORM."""

from uuid import uuid4

import pytest
from chemdft_api.errors import ScientificValidationFailed
from chemdft_api.scientific_actions import accept_authoritative_result
from chemdft_api.scientific_models import (
    AuditEventRecord,
    CalculationResultRecord,
    ProvenanceRecordRow,
)
from chemdft_api.trusted_producers import issue_trusted_producer_context
from sqlalchemy import func, select, update
from test_result_firewall import _firewall_fixture


def test_publisher_binds_subject_and_retry_creates_no_duplicate(api):
    sessions, submission, producer = _firewall_fixture(api)
    with sessions() as session:
        placeholder = session.get(
            ProvenanceRecordRow, str(submission.provenance_record_id)
        ).subject_id
        first = accept_authoritative_result(session, producer, submission)
    with sessions() as session:
        second = accept_authoritative_result(session, producer, submission)
        provenance = session.get(ProvenanceRecordRow, str(first.provenance_record_id))
        assert provenance.subject_type == "calculation.result"
        assert provenance.subject_id == str(first.id) == placeholder
        assert session.get(CalculationResultRecord, provenance.subject_id) is not None
        assert first == second
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 1


@pytest.mark.parametrize("corruption", ["wrong-id", "missing-subject", "wrong-type"])
def test_idempotent_retry_rejects_corrupt_binding_without_repair(api, corruption):
    sessions, submission, producer = _firewall_fixture(api)
    with sessions() as session:
        first = accept_authoritative_result(session, producer, submission)
        provenance = session.get(ProvenanceRecordRow, str(first.provenance_record_id))
        if corruption == "wrong-type":
            session.execute(
                update(ProvenanceRecordRow)
                .where(ProvenanceRecordRow.id == provenance.id)
                .values(subject_type="structure.version")
            )
        elif corruption == "missing-subject":
            session.execute(
                update(ProvenanceRecordRow)
                .where(ProvenanceRecordRow.id == provenance.id)
                .values(subject_id=str(uuid4()))
            )
        else:
            # A real result from another publication is also an invalid subject.
            _, other_submission, other_producer = _firewall_fixture(api)
            other = accept_authoritative_result(session, other_producer, other_submission)
            session.execute(
                update(ProvenanceRecordRow)
                .where(ProvenanceRecordRow.id == provenance.id)
                .values(subject_id=str(other.id))
            )
        session.commit()
        subject = provenance.subject_id
    with sessions() as session, pytest.raises(ScientificValidationFailed):
        accept_authoritative_result(session, producer, submission)
    with sessions() as session:
        assert (
            session.get(ProvenanceRecordRow, str(first.provenance_record_id)).subject_id == subject
        )


@pytest.mark.parametrize(
    "field", ["calculation_id", "calculation_input_id", "provenance_record_id"]
)
def test_same_key_cannot_return_an_unrelated_publication(api, field):
    sessions, submission, producer = _firewall_fixture(api)
    with sessions() as session:
        accept_authoritative_result(session, producer, submission)
    with sessions() as session, pytest.raises(ScientificValidationFailed):
        accept_authoritative_result(
            session, producer, submission.model_copy(update={field: uuid4()})
        )


def test_same_key_requires_original_attested_producer(api):
    sessions, submission, producer = _firewall_fixture(api)
    with sessions() as session:
        accept_authoritative_result(session, producer, submission)
    replacement = issue_trusted_producer_context(
        producer_id=producer.producer_id,
        producer_type=producer.producer_type,
        project_id=producer.project_id,
        attestation_id="different-attempt",
    )
    with sessions() as session, pytest.raises(ScientificValidationFailed):
        accept_authoritative_result(session, replacement, submission)


def test_bound_provenance_cannot_be_replayed_under_a_new_key(api):
    sessions, submission, producer = _firewall_fixture(api)
    with sessions() as session:
        first = accept_authoritative_result(session, producer, submission)
    with sessions() as session, pytest.raises(ScientificValidationFailed):
        accept_authoritative_result(
            session, producer, submission.model_copy(update={"idempotency_key": str(uuid4())})
        )
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 1
        assert session.get(ProvenanceRecordRow, str(first.provenance_record_id)).subject_id == str(
            first.id
        )


def test_new_provenance_cannot_claim_an_existing_result(api):
    sessions, original, producer = _firewall_fixture(api)
    _, candidate, candidate_producer = _firewall_fixture(api)
    with sessions() as session:
        result = accept_authoritative_result(session, producer, original)
        session.execute(
            update(ProvenanceRecordRow)
            .where(ProvenanceRecordRow.id == str(candidate.provenance_record_id))
            .values(subject_id=str(result.id))
        )
        session.commit()
    with sessions() as session, pytest.raises(ScientificValidationFailed):
        accept_authoritative_result(session, candidate_producer, candidate)


@pytest.mark.parametrize("values", [
    {"subject_type": "calculation.record"}, {"subject_id": "invalid-result-id"},
])
def test_invalid_subject_is_rejected_before_binding(api, values):
    sessions, submission, producer = _firewall_fixture(api)
    with sessions() as session:
        session.execute(
            update(ProvenanceRecordRow)
            .where(ProvenanceRecordRow.id == str(submission.provenance_record_id))
            .values(**values)
        )
        session.commit()
    with sessions() as session, pytest.raises(ScientificValidationFailed):
        accept_authoritative_result(session, producer, submission)
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0


def test_commit_false_binding_and_success_audit_rollback_together(api):
    sessions, submission, producer = _firewall_fixture(api)
    with sessions() as session:
        provenance = session.get(ProvenanceRecordRow, str(submission.provenance_record_id))
        placeholder = provenance.subject_id
        result = accept_authoritative_result(session, producer, submission, commit=False)
        assert provenance.subject_id == str(result.id)
        session.rollback()
    with sessions() as session:
        assert session.get(CalculationResultRecord, str(result.id)) is None
        assert (
            session.get(ProvenanceRecordRow, str(submission.provenance_record_id)).subject_id
            == placeholder
        )
        assert (
            session.scalar(
                select(func.count())
                .select_from(AuditEventRecord)
                .where(AuditEventRecord.event_name == "scientific_result.accepted")
            )
            == 0
        )
