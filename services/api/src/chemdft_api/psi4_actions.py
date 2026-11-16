"""Finish native Psi4 ENERGY using existing attempts, provenance and atomic publication."""

from __future__ import annotations

import json
from uuid import UUID, uuid4

from sqlalchemy import update

from .contracts.catalog import ComputeFailureCode, ComputeJobState
from .contracts.provenance import ProducerKind, ProvenanceClass, ProvenanceDetail, VerificationState
from .contracts.results import AuthoritativeResultSubmission
from .contracts.scientific import CalculationFailureCode, CalculationLifecycle, EngineReference
from .models import new_id, utc_now
from .scientific.engines.psi4 import MAX_FILE, encode, parse_evidence
from .scientific.engines.shutdown import shutdown_signal
from .scientific_models import (
    CalculationAttemptRecord,
    ComputeJobRecord,
    ComputeLeaseRecord,
    ProvenanceRecordRow,
)
from .trusted_producers import ProducerType, issue_trusted_producer_context


def fail_psi4_energy(
    session,
    identity,
    settings,
    calculation,
    job,
    compute_execution,
    raw_artifacts,
    attempt_number,
    started_at,
    error,
    *,
    canceled=False,
    timed_out=False,
    worker_id="local.psi4.worker",
    failure_code=None,
):
    from . import calculation_actions as actions

    state = CalculationLifecycle.CANCELED if canceled else CalculationLifecycle.FAILED
    if calculation.state != state:
        actions._transition(calculation, state)
    attempt = CalculationAttemptRecord(
        project_id=calculation.project_id,
        calculation_id=calculation.id,
        attempt_number=attempt_number,
        state=state,
        worker_id=worker_id,
        started_at=started_at,
        finished_at=utc_now(),
        engine_identity_json=None,
        failure_code=failure_code or (CalculationFailureCode.CANCELED
        if canceled
        else CalculationFailureCode.EXECUTION_TIMEOUT
        if timed_out
        else CalculationFailureCode.RESULT_VALIDATION_FAILED),
        diagnostic=str(error)[:1000],
        raw_artifacts_json=[r.model_dump(mode="json") for r in raw_artifacts],
    )
    session.add(attempt)
    session.flush()
    actions._finish_compute_failure(
        session,
        job,
        compute_execution,
        attempt.id,
        ComputeFailureCode.PROVIDER_TIMEOUT if timed_out else ComputeFailureCode.SUBMISSION_FAILED,
        str(error)[:1000],
    )
    compute_execution.raw_artifacts_json = [r.model_dump(mode="json") for r in raw_artifacts]
    if canceled:
        job.state = ComputeJobState.CANCELED
        compute_execution.state = "CANCELED"
    session.commit()
    return actions.get_calculation(session, identity, calculation.project_id, calculation.id)


def finish_psi4_energy(
    session,
    identity,
    object_store,
    settings,
    calculation,
    calculation_input,
    input_artifact,
    job,
    compute_execution,
    execution,
    raw_artifacts,
    attempt_number,
    started_at,
    canceled,
):
    from . import calculation_actions as actions

    try:
        if canceled or shutdown_signal() is not None:
            raise ValueError("Psi4 canceled or worker shutdown before publication")
        if execution.timed_out or execution.exit_code != 0 or execution.result_document is None:
            raise ValueError("Psi4 has no complete successful native scientific result")
        document = json.loads(
            object_store.get_bytes(input_artifact.storage_key, settings.scientific_max_output_bytes)
        )
        parsed = parse_evidence(execution.native_artifacts, document)
        if not all(execution.result_document.get(k) == v for k, v in parsed.items()):
            raise ValueError("Psi4 worker candidate contradicts native evidence")
        energy = actions._validate_energy_candidate(execution.result_document)
    except (ValueError, TypeError, KeyError, OSError) as error:
        return fail_psi4_energy(
            session,
            identity,
            settings,
            calculation,
            job,
            compute_execution,
            raw_artifacts,
            attempt_number,
            started_at,
            error,
            canceled=canceled,
            timed_out=execution.timed_out,
        )
    # Persist diagnostics only; success, result, provenance and reconciliation stay atomic.
    session.commit()
    diagnostic_refs = tuple(raw_artifacts)
    try:
        environment = execution.result_document["environment"]
        env_ref = actions._artifact_reference(
            actions._store_artifact(
                session,
                identity,
                object_store,
                project_id=calculation.project_id,
                kind="ENVIRONMENT_MANIFEST",
                media_type="application/json",
                format_identifier="chemdft.environment_manifest",
                format_version="1.0.0",
                payload=encode(environment),
                source_type="calculation.record",
                source_id=calculation.id,
                max_bytes=min(MAX_FILE, settings.scientific_max_output_bytes),
            )
        )
        raw_artifacts.append(env_ref)
        engine = EngineReference.model_validate(
            actions._identity_json(execution.result_document, env_ref)
        )
        provenance = ProvenanceRecordRow(
            project_id=calculation.project_id,
            subject_type="calculation.result",
            subject_id=new_id(),
            source_class=ProvenanceClass.CALCULATED,
            detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
            verification_state=VerificationState.UNVERIFIED,
            producer_kind=ProducerKind.SERVICE,
            producer_identifier="local.psi4.worker",
            producer_software_version=engine.version,
            source_artifact_id=input_artifact.id,
            operation="chemdft.calculation.energy",
            operation_version="1.0.0",
            parameters_json=[
                {"name": "execution_id", "value": compute_execution.id},
                {"name": "native_geometry_sha256", "value": parsed["returned_geometry_sha256"]},
            ],
            approximate=False,
            supersedes_id=None,
            correlation_id=new_id(),
        )
        session.add(provenance)
        attempt = CalculationAttemptRecord(
            project_id=calculation.project_id,
            calculation_id=calculation.id,
            attempt_number=attempt_number,
            state=CalculationLifecycle.SUCCEEDED,
            worker_id="local.psi4.worker",
            started_at=started_at,
            finished_at=utc_now(),
            engine_identity_json=engine.model_dump(mode="json"),
            failure_code=None,
            diagnostic=None,
            raw_artifacts_json=[r.model_dump(mode="json") for r in raw_artifacts],
        )
        session.add(attempt)
        session.flush()
        compute_execution.calculation_attempt_id = attempt.id
        actions._transition(calculation, CalculationLifecycle.SUCCEEDED)
        producer = issue_trusted_producer_context(
            producer_id="local.psi4.worker",
            producer_type=ProducerType.SCIENTIFIC_WORKER,
            project_id=UUID(calculation.project_id),
            attestation_id=f"execution:{compute_execution.id}:attempt:{attempt_number}",
        )
        submission = AuthoritativeResultSubmission(
            result_type="chemdft.energy",
            project_id=UUID(calculation.project_id),
            calculation_id=UUID(calculation.id),
            calculation_input_id=UUID(calculation_input.id),
            producer_software=engine,
            payload=energy,
            provenance_record_id=UUID(provenance.id),
            raw_artifacts=tuple(raw_artifacts),
            idempotency_key=f"result:{calculation.id}:energy",
            request_id=uuid4(),
            correlation_id=UUID(provenance.correlation_id),
        )
        actions.accept_authoritative_result(
            session,
            producer,
            submission,
            object_store=object_store,
            settings=settings,
            commit=False,
        )
        if shutdown_signal() is not None:
            raise ValueError("Psi4 worker shutdown before publication commit")
        session.flush()
        session.refresh(job)
        canceled = canceled or job.state in {
            ComputeJobState.CANCEL_REQUESTED,
            ComputeJobState.CANCELED,
        }
        # Serialize the final transition with cancellation, then recheck the clock.
        # Native validation can consume time after the first lease check.
        live_job = session.execute(
            update(ComputeJobRecord)
            .where(ComputeJobRecord.id == job.id, ComputeJobRecord.state == "RUNNING")
            .values(state="RUNNING")
            .execution_options(synchronize_session=False)
        ).rowcount
        live_lease = session.execute(
            update(ComputeLeaseRecord)
            .where(
                ComputeLeaseRecord.execution_id == compute_execution.id,
                ComputeLeaseRecord.owner == "local.psi4.worker",
                ComputeLeaseRecord.state == "ACTIVE",
                ComputeLeaseRecord.expires_at > utc_now(),
                ComputeLeaseRecord.heartbeat_deadline_at > utc_now(),
            )
            .values(expires_at=ComputeLeaseRecord.expires_at)
            .execution_options(synchronize_session=False)
        ).rowcount
        if canceled or live_job != 1 or live_lease != 1:
            raise ValueError("Psi4 lost authorization before atomic publication")
        job.state = ComputeJobState.SUCCEEDED
        job.updated_at = utc_now()
        compute_execution.state = "FINISHED"
        compute_execution.finished_at = utc_now()
        compute_execution.environment_json = environment
        compute_execution.raw_artifacts_json = [r.model_dump(mode="json") for r in raw_artifacts]
        compute_execution.metering_json = {
            "runtime_ms": int((utc_now() - started_at).total_seconds() * 1000),
            "provider_cost_status": "UNKNOWN",
        }
        compute_execution.actual_cost_json = {"currency": "USD", "minor_units": 0}
        actions._release_reservation(
            session, job.reservation_id, compute_execution.actual_cost_json
        )
        actions._finish_active_leases(session, compute_execution.id)
        from .billing_service import BillingService

        BillingService(session, identity, settings).record_compute_usage(
            project_id=job.project_id,
            compute_job_id=job.id,
            compute_execution_id=compute_execution.id,
            provider=compute_execution.provider,
            engine="psi4",
            reserved_minor_units=0,
            actual_minor_units=0,
            billable_minor_units=0,
            idempotency_key=f"compute-execution:{compute_execution.id}",
        )
        session.commit()
    except Exception as error:
        # A failed native reparse, store, flush or publication rolls back ALL success rows.
        session.rollback()
        for record in (calculation, job, compute_execution):
            session.refresh(record)
        canceled = canceled or job.state in {
            ComputeJobState.CANCEL_REQUESTED,
            ComputeJobState.CANCELED,
        }
        return fail_psi4_energy(
            session,
            identity,
            settings,
            calculation,
            job,
            compute_execution,
            diagnostic_refs,
            attempt_number,
            started_at,
            error,
            canceled=canceled,
            timed_out=execution.timed_out,
        )
    return actions.get_calculation(session, identity, calculation.project_id, calculation.id)


def retain_late_diagnostics(
    session, identity, object_store, settings, calculation, compute_execution, execution
):
    from . import calculation_actions as actions

    refs = []
    for name, data in execution.native_artifacts.items():
        if len(data) > min(MAX_FILE, settings.scientific_max_output_bytes):
            continue
        record = actions._store_artifact(
            session,
            identity,
            object_store,
            project_id=calculation.project_id,
            kind="CALCULATION_OUTPUT",
            media_type="application/octet-stream",
            format_identifier="psi4.diagnostic." + name,
            format_version="1.0.0",
            payload=data,
            source_type="calculation.record",
            source_id=calculation.id,
            max_bytes=min(MAX_FILE, settings.scientific_max_output_bytes),
        )
        refs.append(actions._artifact_reference(record).model_dump(mode="json"))
    compute_execution.raw_artifacts_json = refs
    session.commit()
