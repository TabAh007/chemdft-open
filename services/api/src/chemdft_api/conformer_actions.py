"""Atomic CREST ensemble publication through the existing result/object architecture."""

from __future__ import annotations

import json
from uuid import UUID, uuid4, uuid5

from .contracts.catalog import ComputeFailureCode, ComputeJobState
from .contracts.conformers import ConformerEnsembleManifest, ConformerEnsembleResult
from .contracts.provenance import ProducerKind, ProvenanceClass, ProvenanceDetail, VerificationState
from .contracts.results import AuthoritativeResultSubmission
from .contracts.scientific import CalculationFailureCode, CalculationLifecycle, EngineReference
from .models import new_id, utc_now
from .scientific.engines.crest import encode, limitations_for, parse_evidence
from .scientific.engines.shutdown import shutdown_signal
from .scientific_models import (
    CalculationAttemptRecord,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
)
from .trusted_producers import ProducerType, issue_trusted_producer_context


def build_manifest(
    parsed,
    document,
    *,
    project_id,
    calculation_id,
    input_id,
    execution_id,
    attempt_number,
    created_at,
    native_refs,
):
    source = next(a["artifact"] for a in native_refs if a["name"] == "crest_conformers.xyz")
    members = []
    for rank, (record, relative) in enumerate(
        zip(parsed["members"], parsed["relative_kcal_mol"], strict=True), 1
    ):
        atoms = [
            {
                "index": a["index"],
                "element": a["element"],
                "atomic_number": a["atomic_number"],
                "x": xyz[0],
                "y": xyz[1],
                "z": xyz[2],
            }
            for a, xyz in zip(document["atoms"], record["coordinates_angstrom"], strict=True)
        ]
        members.append(
            {
                "conformer": {
                    "id": str(uuid5(UUID(execution_id), f"crest:{rank}:{record['record_sha256']}")),
                    "project_id": project_id,
                    "structure_version_id": document["structure_version_id"],
                    "rank": rank,
                    "relative_energy": {
                        "value": relative,
                        "unit": {"standard": "UCUM", "code": "kcal/mol", "dimension": "ENERGY"},
                        "precision": {"decimal_places": 3},
                    },
                    "generation_method": "chemdft.crest.imtd-gc",
                    "coordinates": {
                        "structure_version_id": document["structure_version_id"],
                        "coordinate_system": "CARTESIAN",
                        "unit": "angstrom",
                        "source": source,
                        "atoms": atoms,
                    },
                    "created_at": created_at,
                },
                "native_rank": rank,
                "application_rank": rank,
                "native_electronic_energy": {
                    "value": record["energy_hartree"],
                    "unit": {"standard": "QCSCHEMA", "code": "Eh", "dimension": "ENERGY"},
                    "precision": {"decimal_places": 8},
                },
                "native_record_sha256": record["record_sha256"],
            }
        )
    return ConformerEnsembleManifest.model_validate(
        {
            "project_id": project_id,
            "calculation_id": calculation_id,
            "calculation_input_id": input_id,
            "execution_id": execution_id,
            "attempt_number": attempt_number,
            "input_structure_version_id": document["structure_version_id"],
            "input_structure_sha256": document["input_structure_hash"],
            "calculation_input_sha256": __import__("hashlib").sha256(encode(document)).hexdigest(),
            "executable_sha256": document["engine_executable_sha256"],
            "charge": document["charge"],
            "native_optimized_count": parsed["optimized_count"],
            "native_duplicate_count": parsed["duplicate_count"],
            "native_rotamer_count": parsed["rotamer_count"],
            "restart_count": parsed["restart_count"],
            "intermediate_minima": parsed["intermediate_minima"],
            "members": members,
            "native_artifacts": native_refs,
            "limitations": limitations_for(document["engine_executable_sha256"]),
        }
    )


def finish_conformer_search(
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

    document = json.loads(
        object_store.get_bytes(input_artifact.storage_key, settings.scientific_max_output_bytes)
    )
    error = None
    try:
        if shutdown_signal() is not None:
            raise ValueError(f"CREST worker shutdown signal {shutdown_signal()}")
        if canceled:
            raise ValueError("CREST search canceled before publication")
        if execution.timed_out:
            raise ValueError("CREST native wall timeout")
        if execution.exit_code != 0 or execution.result_document is None:
            raise ValueError("Incomplete or failed CREST native search")
        parsed = parse_evidence(execution.native_artifacts, document)
        if execution.result_document.get("ensemble") != parsed:
            raise ValueError("Worker ensemble contradicts native evidence")
        native_refs = []
        for ref in raw_artifacts:
            record = session.get(ScientificArtifactRecord, str(ref.artifact_id))
            if record.format_identifier.startswith("crest.native."):
                native_refs.append(
                    {
                        "name": record.format_identifier.removeprefix("crest.native."),
                        "artifact": ref.model_dump(mode="json"),
                    }
                )
        manifest = build_manifest(
            parsed,
            document,
            project_id=calculation.project_id,
            calculation_id=calculation.id,
            input_id=calculation_input.id,
            execution_id=compute_execution.id,
            attempt_number=attempt_number,
            created_at=started_at,
            native_refs=native_refs,
        )
    except (ValueError, TypeError, KeyError) as exc:
        error = str(exc)
    if error:
        state = CalculationLifecycle.CANCELED if canceled else CalculationLifecycle.FAILED
        actions._transition(calculation, state)
        attempt = CalculationAttemptRecord(
            project_id=calculation.project_id,
            calculation_id=calculation.id,
            attempt_number=attempt_number,
            state=state,
            worker_id="local.crest.worker",
            started_at=started_at,
            finished_at=utc_now(),
            engine_identity_json=None,
            failure_code=CalculationFailureCode.CANCELED
            if canceled
            else CalculationFailureCode.EXECUTION_TIMEOUT
            if execution.timed_out
            else CalculationFailureCode.ENGINE_CRASHED
            if execution.exit_code != 0 or shutdown_signal() is not None
            else CalculationFailureCode.RESULT_VALIDATION_FAILED,
            diagnostic=error,
            raw_artifacts_json=[a.model_dump(mode="json") for a in raw_artifacts],
        )
        session.add(attempt)
        session.flush()
        actions._finish_compute_failure(
            session,
            job,
            compute_execution,
            attempt.id,
            ComputeFailureCode.PROVIDER_TIMEOUT
            if execution.timed_out
            else ComputeFailureCode.WORKER_LOST
            if shutdown_signal() is not None
            else ComputeFailureCode.SUBMISSION_FAILED,
            error,
        )
        compute_execution.raw_artifacts_json = [a.model_dump(mode="json") for a in raw_artifacts]
        if canceled:
            job.state = ComputeJobState.CANCELED
            compute_execution.state = "CANCELED"
        session.commit()
        return actions.get_calculation(session, identity, calculation.project_id, calculation.id)
    # Durable diagnostics precede the atomic authoritative-publication transaction.
    session.commit()
    diagnostic_refs = tuple(raw_artifacts)
    manifest_record = actions._store_artifact(
        session,
        identity,
        object_store,
        project_id=calculation.project_id,
        kind="NORMALIZED_RESULT",
        media_type="application/json",
        format_identifier="chemdft.conformer-ensemble-manifest",
        format_version="1.0.0",
        payload=encode(manifest.model_dump(mode="json")),
        source_type="calculation.record",
        source_id=calculation.id,
        max_bytes=settings.crest_max_output_bytes,
    )
    manifest_ref = actions._artifact_reference(manifest_record)
    raw_artifacts.append(manifest_ref)
    environment = execution.result_document["environment"]
    env_record = actions._store_artifact(
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
        max_bytes=settings.crest_max_output_bytes,
    )
    env_ref = actions._artifact_reference(env_record)
    raw_artifacts.append(env_ref)
    engine = EngineReference.model_validate(
        {
            **actions._identity_json(execution.result_document, env_ref),
            "capabilities": ["chemdft.conformer-search"],
        }
    )
    provenance = ProvenanceRecordRow(
        project_id=calculation.project_id,
        subject_type="calculation.result",
        subject_id=new_id(),
        source_class=ProvenanceClass.CALCULATED,
        detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SERVICE,
        producer_identifier="local.crest.worker",
        producer_software_version=engine.version,
        source_artifact_id=input_artifact.id,
        operation="chemdft.calculation.conformer-search",
        operation_version="1.0.0",
        parameters_json=[
            {"name": "execution_id", "value": compute_execution.id},
            {"name": "ensemble_manifest_sha256", "value": manifest_record.sha256},
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
        worker_id="local.crest.worker",
        engine_identity_json=engine.model_dump(mode="json"),
        started_at=started_at,
        finished_at=utc_now(),
        failure_code=None,
        diagnostic=None,
        raw_artifacts_json=[a.model_dump(mode="json") for a in raw_artifacts],
    )
    session.add(attempt)
    session.flush()
    compute_execution.calculation_attempt_id = attempt.id
    actions._transition(calculation, CalculationLifecycle.SUCCEEDED)
    producer = issue_trusted_producer_context(
        producer_id="local.crest.worker",
        producer_type=ProducerType.SCIENTIFIC_WORKER,
        project_id=UUID(calculation.project_id),
        attestation_id=f"execution:{compute_execution.id}:attempt:{attempt_number}",
    )
    submission = AuthoritativeResultSubmission(
        result_type="chemdft.conformer-ensemble",
        project_id=UUID(calculation.project_id),
        calculation_id=UUID(calculation.id),
        calculation_input_id=UUID(calculation_input.id),
        producer_software=engine,
        payload=ConformerEnsembleResult(
            manifest=manifest,
            manifest_artifact=manifest_ref,
            artifacts=tuple(a.artifact for a in manifest.native_artifacts),
        ),
        provenance_record_id=UUID(provenance.id),
        raw_artifacts=tuple(raw_artifacts),
        idempotency_key=f"result:{calculation.id}:conformer-ensemble",
        request_id=uuid4(),
        correlation_id=UUID(provenance.correlation_id),
    )
    # Firewall reparses persisted object bytes while the current lease is still active.
    from .errors import ScientificValidationFailed

    try:
        if shutdown_signal() is not None:
            raise ScientificValidationFailed("CREST worker shutdown before publication")
        actions.accept_authoritative_result(
            session,
            producer,
            submission,
            object_store=object_store,
            settings=settings,
            commit=False,
        )
        if shutdown_signal() is not None:
            raise ScientificValidationFailed("CREST worker shutdown before publication commit")
    except ScientificValidationFailed as error:
        # Firewall rolled back all authoritative rows; retain the pre-publication diagnostics.
        session.rollback()
        session.refresh(calculation)
        session.refresh(job)
        session.refresh(compute_execution)
        actions._transition(calculation, CalculationLifecycle.FAILED)
        failure = CalculationAttemptRecord(
            project_id=calculation.project_id,
            calculation_id=calculation.id,
            attempt_number=attempt_number,
            state=CalculationLifecycle.FAILED,
            worker_id="local.crest.worker",
            engine_identity_json=None,
            started_at=started_at,
            finished_at=utc_now(),
            failure_code=CalculationFailureCode.ENGINE_CRASHED
            if shutdown_signal() is not None
            else CalculationFailureCode.RESULT_VALIDATION_FAILED,
            diagnostic=str(error)[:1000],
            raw_artifacts_json=[a.model_dump(mode="json") for a in diagnostic_refs],
        )
        session.add(failure)
        session.flush()
        actions._finish_compute_failure(
            session,
            job,
            compute_execution,
            failure.id,
            ComputeFailureCode.WORKER_LOST
            if shutdown_signal() is not None
            else ComputeFailureCode.SUBMISSION_FAILED,
            str(error)[:1000],
        )
        compute_execution.raw_artifacts_json = [a.model_dump(mode="json") for a in diagnostic_refs]
        session.commit()
        return actions.get_calculation(session, identity, calculation.project_id, calculation.id)
    job.state = ComputeJobState.SUCCEEDED
    job.updated_at = utc_now()
    compute_execution.state = "FINISHED"
    compute_execution.finished_at = utc_now()
    compute_execution.environment_json = environment
    compute_execution.raw_artifacts_json = [a.model_dump(mode="json") for a in raw_artifacts]
    compute_execution.metering_json = {
        "runtime_ms": int((utc_now() - started_at).total_seconds() * 1000),
        "provider_cost_status": "UNKNOWN",
    }
    compute_execution.actual_cost_json = {"currency": "USD", "minor_units": 0}
    actions._release_reservation(session, job.reservation_id, compute_execution.actual_cost_json)
    actions._finish_active_leases(session, compute_execution.id)
    from .billing_service import BillingService

    BillingService(session, identity, settings).record_compute_usage(
        project_id=job.project_id,
        compute_job_id=job.id,
        compute_execution_id=compute_execution.id,
        provider=compute_execution.provider,
        engine="crest",
        reserved_minor_units=0,
        actual_minor_units=0,
        billable_minor_units=0,
        idempotency_key=f"compute-execution:{compute_execution.id}",
    )
    session.commit()
    return actions.get_calculation(session, identity, calculation.project_id, calculation.id)


def retain_late_diagnostics(
    session, identity, object_store, settings, calculation, compute_execution, execution
):
    """Preserve stale native bytes on their old execution; never authorize them."""
    refs = _bounded_diagnostic_refs(
        session, identity, object_store, settings, calculation, execution
    )
    session.refresh(compute_execution)
    compute_execution.raw_artifacts_json = refs
    session.commit()


def _bounded_diagnostic_refs(session, identity, object_store, settings, calculation, execution):
    """An omitted oversized diagnostic never qualifies as complete scientific evidence."""
    from . import calculation_actions as actions
    from .errors import UploadTooLarge

    refs = []
    retained = 0
    for name, data in execution.native_artifacts.items():
        if (
            len(data) > settings.crest_max_output_bytes
            or retained + len(data) > settings.crest_max_retained_bytes
            or len(refs) >= 120
        ):
            continue
        try:
            record = actions._store_artifact(
                session,
                identity,
                object_store,
                project_id=calculation.project_id,
                kind="CALCULATION_OUTPUT",
                media_type="application/octet-stream",
                format_identifier=f"crest.diagnostic.{name}",
                format_version="1.0.0",
                payload=data,
                source_type="calculation.record",
                source_id=calculation.id,
                max_bytes=settings.crest_max_output_bytes,
            )
        except UploadTooLarge:
            continue
        retained += len(data)
        refs.append(actions._artifact_reference(record).model_dump(mode="json"))
    return refs


def fail_artifact_publication(
    session, identity, object_store, settings, calculation, job, compute_execution,
    execution, started_at,
):
    """Roll back incomplete publication and atomically settle an artifact-size failure."""
    from . import calculation_actions as actions

    session.rollback()
    for record in (calculation, job, compute_execution):
        session.refresh(record)
    if compute_execution.state != "RUNNING":
        return actions.get_calculation(session, identity, calculation.project_id, calculation.id)
    diagnostic = "CREST artifact exceeds the configured publication size limit."
    refs = _bounded_diagnostic_refs(
        session, identity, object_store, settings, calculation, execution
    )
    canceled = job.state == ComputeJobState.CANCEL_REQUESTED
    state = CalculationLifecycle.CANCELED if canceled else CalculationLifecycle.FAILED
    actions._transition(calculation, state)
    attempt = CalculationAttemptRecord(
        project_id=calculation.project_id,
        calculation_id=calculation.id,
        attempt_number=actions._next_attempt_number(session, calculation.id),
        state=state,
        worker_id="local.crest.worker",
        engine_identity_json=None,
        started_at=started_at,
        finished_at=utc_now(),
        failure_code=CalculationFailureCode.CANCELED
        if canceled else CalculationFailureCode.RESOURCE_LIMIT_EXCEEDED,
        diagnostic=diagnostic,
        raw_artifacts_json=refs,
    )
    session.add(attempt)
    session.flush()
    actions._finish_compute_failure(
        session, job, compute_execution, attempt.id,
        ComputeFailureCode.ARTIFACT_TRANSFER_FAILED, diagnostic,
    )
    compute_execution.raw_artifacts_json = refs
    if canceled:
        job.state = ComputeJobState.CANCELED
        compute_execution.state = "CANCELED"
    session.commit()
    return actions.get_calculation(session, identity, calculation.project_id, calculation.id)
