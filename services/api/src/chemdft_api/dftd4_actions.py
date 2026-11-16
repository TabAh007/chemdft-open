"""D4 submission and completion using existing calculations, compute leases and publisher."""

from __future__ import annotations

import json
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select, update

from .actions import authorize_project_access
from .contracts.dftd4 import (
    DispersionCorrectionSpecification,
    NativeDispersionCorrectedEnergyResult,
)
from .contracts.provenance import ProducerKind, ProvenanceClass, ProvenanceDetail, VerificationState
from .contracts.results import AuthoritativeResultSubmission
from .contracts.scientific import EngineReference
from .dftd4_source import load_source, require
from .models import new_id, utc_now
from .scientific.engines.dftd4 import (
    ADAPTER_VERSION,
    MAX_DIRECTORY,
    MAX_WALL,
    MEMORY_BYTES,
    PARAMETERS,
    TABLE_SHA256,
    VERSION,
    digest,
    encode,
    environment_identity,
    parse_evidence,
    variant_identity,
)
from .scientific_models import (
    CalculationAttemptRecord,
    CalculationInputRecord,
    CalculationRecord,
    ComputeEstimateRecord,
    ComputeJobRecord,
    ComputeLeaseRecord,
    ComputeReservationRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
)

WORKLOAD = {"workload_type": "chemdft.dftd4.correction.v1", "workload_version": "1.0.0"}
RETRYABLE_FAILURES = {"ENGINE_CRASHED", "EXECUTION_TIMEOUT", "ENGINE_UNAVAILABLE", "OUTPUT_MISSING"}


def retry_correction(session, identity, store, settings, project_id, calculation_id, command):
    """Explicit recovery; reuse one job/calculation, append execution and attempt history."""
    from datetime import timedelta

    from . import calculation_actions as a
    from .errors import Dftd4Conflict, ProjectAccessDenied, ScientificReferenceNotFound
    from .project_access import ProjectCapability, can
    from .scientific.engines.dftd4 import validate_input
    from .scientific_models import CalculationResultRecord, ScientificArtifactRecord

    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    session.execute(
        update(type(project)).where(type(project).id == project.id).values(name=type(project).name)
    )
    calculation = session.scalar(
        select(CalculationRecord)
        .where(
            CalculationRecord.id == calculation_id,
            CalculationRecord.project_id == project.id,
        )
        .execution_options(populate_existing=True)
    )
    if calculation is None:
        raise ScientificReferenceNotFound("D4 calculation does not exist in this project.")
    inp = session.scalar(
        select(CalculationInputRecord).where(
            CalculationInputRecord.calculation_id == calculation.id,
            CalculationInputRecord.project_id == project.id,
        )
    )
    job = session.scalar(
        select(ComputeJobRecord)
        .where(
            ComputeJobRecord.calculation_id == calculation.id,
            ComputeJobRecord.project_id == project.id,
        )
        .execution_options(populate_existing=True)
    )
    if inp is None or job is None or job.workload_json != WORKLOAD:
        raise Dftd4Conflict("Only a native D4 correction can use this recovery operation.")
    if calculation.state == "SUCCEEDED":
        return a.get_calculation(session, identity, project.id, calculation.id)
    failed = session.scalar(
        select(CalculationAttemptRecord).where(
            CalculationAttemptRecord.id == str(command.failed_attempt_id),
            CalculationAttemptRecord.calculation_id == calculation.id,
            CalculationAttemptRecord.project_id == project.id,
        )
    )
    latest = session.scalar(
        select(CalculationAttemptRecord)
        .where(
            CalculationAttemptRecord.calculation_id == calculation.id,
        )
        .order_by(CalculationAttemptRecord.attempt_number.desc())
        .limit(1)
    )
    if failed is None or latest is None or failed.id != latest.id or failed.state != "FAILED":
        raise Dftd4Conflict(
            "Retry must reference the latest failed attempt.", code="DFTD4_RETRY_STALE"
        )
    if failed.failure_code not in RETRYABLE_FAILURES:
        raise Dftd4Conflict(
            "Scientific validation failures require review, not automatic re-execution.",
            code="DFTD4_RETRY_INELIGIBLE",
        )
    spec = DispersionCorrectionSpecification.model_validate(inp.specification_json)
    source, atoms = load_source(session, store, settings, project.id, spec.source.result_id)
    require(source == spec.source, "retry source binding changed")
    artifact = session.get(ScientificArtifactRecord, inp.normalized_input_artifact_id)
    data = store.get_bytes(artifact.storage_key, settings.scientific_max_output_bytes)
    require(
        digest(data) == artifact.sha256 == calculation.request_hash, "retry input integrity differs"
    )
    document = json.loads(data)
    require(
        document["atoms"] == atoms and document["specification"] == spec.model_dump(mode="json"),
        "retry input/source binding differs",
    )
    # Unavailable runtime (503) is distinct from a runtime that disagrees with the frozen
    # execution environment (409); neither leaks a raw Python exception message.
    if settings.dftd4_executable is None:
        raise Dftd4Conflict(
            "Pinned DFT-D4 4.2.0 is not configured.",
            code="DFTD4_RUNTIME_UNAVAILABLE",
            status_code=503,
        )
    try:
        validate_input(document)
    except (ValueError, TypeError, KeyError) as error:
        raise Dftd4Conflict(
            "The frozen D4 correction input is no longer valid for the supported runtime.",
            code="DFTD4_RUNTIME_CONFLICT",
        ) from error
    try:
        runtime = environment_identity(settings.dftd4_executable)
    except OSError as error:
        raise Dftd4Conflict(
            "The configured native DFT-D4 executable is not available.",
            code="DFTD4_RUNTIME_UNAVAILABLE",
            status_code=503,
        ) from error
    except ValueError as error:
        # environment_identity raises ValueError only with an explicit pin-mismatch message.
        raise Dftd4Conflict(str(error), code="DFTD4_RUNTIME_CONFLICT") from error
    except (TypeError, KeyError) as error:
        raise Dftd4Conflict(
            "The installed DFT-D4 runtime identity could not be verified.",
            code="DFTD4_RUNTIME_CONFLICT",
        ) from error
    if runtime != document["runtime_identity"]:
        raise Dftd4Conflict(
            "Authorized native runtime identity differs from the installed runtime.",
            code="DFTD4_RUNTIME_CONFLICT",
        )
    if calculation.state in {"QUEUED", "RUNNING"} and job.retry_count > 0:
        return a.get_calculation(session, identity, project.id, calculation.id)
    if calculation.state != "FAILED" or job.state != "FAILED":
        raise Dftd4Conflict(
            "Only failed D4 work is eligible; running and canceled work cannot be retried."
        )
    if session.scalar(
        select(CalculationResultRecord.id).where(
            CalculationResultRecord.calculation_id == calculation.id,
        )
    ) or a._has_active_lease(session, job.id):
        raise Dftd4Conflict("Existing result or active execution prevents recovery.")
    old_reservation = session.get(ComputeReservationRecord, job.reservation_id)
    if old_reservation is None or old_reservation.state != "RELEASED":
        raise Dftd4Conflict("Previous compute reservation must be reconciled before recovery.")
    estimate = session.get(ComputeEstimateRecord, job.estimate_id)
    values = {c.name: getattr(estimate, c.name) for c in ComputeEstimateRecord.__table__.columns}
    values.update(id=new_id(), created_at=utc_now(), valid_until=utc_now() + timedelta(minutes=5))
    renewed = ComputeEstimateRecord(**values)
    session.add(renewed)
    session.flush()
    reservation = ComputeReservationRecord(
        project_id=project.id,
        estimate_id=renewed.id,
        authorized_max_json=old_reservation.authorized_max_json,
        state="RESERVED",
        created_at=utc_now(),
        actual_cost_json=None,
        reconciled_at=None,
    )
    session.add(reservation)
    session.flush()
    # The global lifecycle remains terminal. This guarded D4-only recovery is explicit.
    changed = session.execute(
        update(CalculationRecord)
        .where(
            CalculationRecord.id == calculation.id,
            CalculationRecord.state == "FAILED",
        )
        .values(state="QUEUED", updated_at=utc_now())
        .execution_options(synchronize_session=False)
    ).rowcount
    if changed != 1:
        raise Dftd4Conflict("Calculation changed during retry authorization.")
    job.state, job.updated_at = "READY", utc_now()
    job.retry_count += 1
    job.estimate_id, job.reservation_id = renewed.id, reservation.id
    a._audit(
        session,
        identity,
        project.id,
        "calculation.dftd4.retry.authorized",
        calculation.id,
        metadata=[
            {"key": "failed_attempt_id", "value": failed.id},
            {"key": "old_reservation_id", "value": old_reservation.id},
            {"key": "new_reservation_id", "value": reservation.id},
        ],
    )
    session.commit()
    session.refresh(calculation)
    return a.get_calculation(session, identity, project.id, calculation.id)


def submit_correction(session, identity, store, settings, project_id, command):
    from . import calculation_actions as a
    from .compute_gateway import default_requirement, estimate_for_requirement, requirement_hash
    from .errors import Dftd4Conflict, ProjectAccessDenied
    from .project_access import ProjectCapability, can

    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    # A no-op write serializes before reads on SQLite and acquires a row lock on PostgreSQL.
    # The deterministic primary key independently enforces source/variant uniqueness.
    session.execute(
        update(type(project)).where(type(project).id == project.id).values(name=type(project).name)
    )
    source, atoms = load_source(session, store, settings, project.id, command.source_result_id)
    parameters = PARAMETERS[source.functional]
    variant = variant_identity(source.functional, parameters)
    calculation_id = str(uuid5(NAMESPACE_URL, f"chemdft.dftd4.v1:{source.result_id}:{variant}"))
    keyed = session.scalar(
        select(CalculationRecord).where(
            CalculationRecord.project_id == project.id,
            CalculationRecord.idempotency_key == command.idempotency_key,
        )
    )
    if keyed is not None and keyed.id != calculation_id:
        raise Dftd4Conflict(
            "Idempotency key belongs to another scientific variant/request.",
            code="DFTD4_VARIANT_CONFLICT",
        )
    existing = session.get(CalculationRecord, calculation_id)
    if existing is not None:
        inp = session.scalar(
            select(CalculationInputRecord).where(
                CalculationInputRecord.calculation_id == existing.id
            )
        )
        spec = DispersionCorrectionSpecification.model_validate(inp.specification_json)
        require(
            spec.source == source
            and spec.variant_sha256 == variant
            and existing.project_id == project.id,
            "retry changed immutable source/variant binding",
        )
        from .scientific_models import ScientificArtifactRecord

        artifact = session.get(ScientificArtifactRecord, inp.normalized_input_artifact_id)
        data = store.get_bytes(artifact.storage_key, settings.scientific_max_output_bytes)
        document = json.loads(data)
        # Historical replay uses frozen input bytes, never mutable installed runtime pins.
        # Execution/retry separately requires exact equality with the authorized environment.
        require(
            spec.variant_sha256 == variant_identity(spec.source.functional, spec.parameters),
            "stored scientific variant identity differs",
        )
        require(
            existing.request_hash == artifact.sha256 == digest(data)
            and document["specification"] == spec.model_dump(mode="json")
            and document["atoms"] == atoms,
            "retry changed immutable correction input",
        )
        return a.get_calculation(session, identity, project.id, existing.id)
    if settings.dftd4_executable is None:
        raise Dftd4Conflict(
            "Pinned DFT-D4 4.2.0 is not configured.",
            code="DFTD4_RUNTIME_UNAVAILABLE",
            status_code=503,
        )
    try:
        runtime = environment_identity(settings.dftd4_executable)
    except (ValueError, TypeError, KeyError, OSError) as error:
        raise Dftd4Conflict(
            str(error), code="DFTD4_RUNTIME_UNAVAILABLE", status_code=503
        ) from error
    spec = DispersionCorrectionSpecification(
        task_type="ENERGY",
        method={
            "identifier": source.functional,
            "display_name": source.functional.upper(),
            "registry": "chemdft.method",
        },
        basis={"identifier": "def2-svp", "display_name": "def2-SVP", "registry": "chemdft.basis"},
        dispersion={
            "identifier": "d4",
            "display_name": "D4 BJ/EEQ/ATM",
            "registry": "chemdft.dispersion",
        },
        charge=0,
        multiplicity=1,
        engine_preference={"engine": "dftd4", "allowed_version": VERSION},
        source=source,
        variant_sha256=variant,
        parameters=parameters,
        parameter_table_sha256=TABLE_SHA256,
    )
    document = {
        "schema": "chemdft.dftd4.input.v1",
        "engine": "dftd4",
        "specification": spec.model_dump(mode="json"),
        "atoms": atoms,
        "structure_version_id": str(source.structure_version_id),
        "runtime_identity": runtime,
    }
    from .scientific.engines.dftd4 import validate_input

    try:
        validate_input(document)
    except (ValueError, TypeError, KeyError) as error:
        raise Dftd4Conflict(
            str(error), code="DFTD4_RUNTIME_UNAVAILABLE", status_code=503
        ) from error
    data = encode(document)
    calculation = CalculationRecord(
        id=calculation_id,
        project_id=project.id,
        state="DRAFT",
        idempotency_key=command.idempotency_key,
        request_hash=digest(data),
        created_by=identity.user_id,
    )
    session.add(calculation)
    session.flush()
    artifact = a._store_artifact(
        session,
        identity,
        store,
        project_id=project.id,
        kind="CALCULATION_INPUT",
        media_type="application/vnd.chemdft.calculation-input+json",
        format_identifier="chemdft.dftd4.input",
        format_version="1.0.0",
        payload=data,
        source_type="structure.version",
        source_id=str(source.structure_version_id),
        max_bytes=settings.scientific_max_output_bytes,
    )
    inp = CalculationInputRecord(
        project_id=project.id,
        calculation_id=calculation.id,
        structure_version_id=str(source.structure_version_id),
        conformer_id=None,
        specification_json=spec.model_dump(mode="json"),
        normalized_input_artifact_id=artifact.id,
    )
    session.add(inp)
    requirement = default_requirement(settings, "local").model_copy(
        update={
            "cpu_count": 1,
            "memory_bytes": MEMORY_BYTES,
            "runtime_limit_seconds": min(MAX_WALL, settings.scientific_execution_timeout_seconds),
            "temporary_storage_bytes": min(
                MAX_DIRECTORY, settings.compute_local_temporary_storage_bytes
            ),
        }
    )
    estimate = estimate_for_requirement(
        estimate_id=UUID(new_id()),
        project_id=UUID(project.id),
        requirement=requirement,
        provider="local",
    )
    estimate_record = ComputeEstimateRecord(
        id=str(estimate.id),
        project_id=project.id,
        requirement_hash=estimate.requirement_hash,
        provider=estimate.provider,
        provider_summary=estimate.provider_summary,
        runtime_low_seconds=estimate.runtime_low_seconds,
        runtime_high_seconds=estimate.runtime_high_seconds,
        cost_low_json=estimate.cost_low.model_dump(mode="json"),
        cost_high_json=estimate.cost_high.model_dump(mode="json"),
        confidence=estimate.confidence,
        assumptions_json=list(estimate.assumptions),
        valid_until=estimate.valid_until,
        created_at=estimate.created_at,
    )
    session.add(estimate_record)
    reservation = ComputeReservationRecord(
        project_id=project.id,
        estimate_id=estimate_record.id,
        authorized_max_json=estimate.cost_high.model_dump(mode="json"),
        actual_cost_json=None,
        state="RESERVED",
        created_at=utc_now(),
        reconciled_at=None,
    )
    session.add(reservation)
    session.flush()
    session.add(
        ComputeJobRecord(
            project_id=project.id,
            calculation_id=calculation.id,
            calculation_input_id=inp.id,
            workload_json=WORKLOAD,
            requirement_json=requirement.model_dump(mode="json"),
            requirement_hash=requirement_hash(requirement),
            state="READY",
            provider="local",
            priority=requirement.priority,
            idempotency_key=f"dftd4-job:{calculation.id}",
            estimate_id=estimate_record.id,
            reservation_id=reservation.id,
            submitted_by=identity.user_id,
            retry_count=0,
        )
    )
    for state in ("VALIDATED", "AUTHORIZED", "QUEUED"):
        a._transition(calculation, state)
    a._audit(
        session,
        identity,
        project.id,
        "calculation.created",
        calculation.id,
        metadata=[
            {"key": "dftd4.source_result_id", "value": str(source.result_id)},
            {"key": "dftd4.variant_sha256", "value": variant},
        ],
    )
    session.commit()
    return a.get_calculation(session, identity, project.id, calculation.id)


def make_payload(spec, correction):
    def quantity(value):
        return {
            "value": value,
            "unit": {"standard": "QCSCHEMA", "code": "Eh", "dimension": "ENERGY"},
        }

    return NativeDispersionCorrectedEnergyResult(
        source=spec.source,
        variant_sha256=spec.variant_sha256,
        parameters=spec.parameters,
        parameter_table_sha256=TABLE_SHA256,
        functional=spec.source.functional,
        uncorrected_dft_energy=quantity(spec.source.source_energy_hartree),
        d4_correction_energy=quantity(correction),
        corrected_total_energy=quantity(spec.source.source_energy_hartree + correction),
    )


def finish_correction(
    session,
    identity,
    store,
    settings,
    calculation,
    inp,
    input_artifact,
    job,
    compute_execution,
    execution,
    raw_artifacts,
    attempt_number,
    started_at,
    canceled,
):
    from . import calculation_actions as a
    from .psi4_actions import fail_psi4_energy
    from .scientific.engines.shutdown import shutdown_signal
    from .trusted_producers import ProducerType, issue_trusted_producer_context

    diagnostics = tuple(raw_artifacts)
    session.commit()  # diagnostics retained even when publication rolls back
    failure_code = "RESULT_VALIDATION_FAILED"
    try:
        require(not canceled and shutdown_signal() is None, "execution canceled or shutdown")
        if execution.failure_code:
            failure_code = execution.failure_code
            raise ValueError(execution.stderr.decode(errors="replace"))
        if execution.timed_out:
            failure_code = "EXECUTION_TIMEOUT"
            raise ValueError("D4 native wall timeout")
        if execution.exit_code is None or execution.exit_code < 0:
            failure_code = (
                "ENGINE_CRASHED" if execution.exit_code is not None else "ENGINE_UNAVAILABLE"
            )
            raise ValueError("D4 execution interrupted before a native result")
        require(
            execution.exit_code == 0, "D4 native rejected execution; scientific review required"
        )
        document = json.loads(
            store.get_bytes(input_artifact.storage_key, settings.scientific_max_output_bytes)
        )
        parsed = parse_evidence(execution.native_artifacts, document)
        require(
            not execution.timed_out
            and execution.exit_code == 0
            and execution.result_document == parsed,
            "worker candidate differs from native evidence",
        )
        spec = DispersionCorrectionSpecification.model_validate(inp.specification_json)
        env_ref = a._artifact_reference(
            a._store_artifact(
                session,
                identity,
                store,
                project_id=calculation.project_id,
                kind="ENVIRONMENT_MANIFEST",
                media_type="application/json",
                format_identifier="chemdft.environment_manifest",
                format_version="1.0.0",
                payload=encode(parsed["environment"]),
                source_type="calculation.record",
                source_id=calculation.id,
                max_bytes=settings.scientific_max_output_bytes,
            )
        )
        raw_artifacts.append(env_ref)
        engine = EngineReference(
            name="dftd4",
            version=VERSION,
            adapter_version=ADAPTER_VERSION,
            environment_artifact=env_ref,
            capabilities=("chemdft.dispersion-corrected-energy",),
            execution_backend="local.subprocess",
            environment_digest=env_ref.sha256,
            hardware_class="arm64",
        )
        provenance = ProvenanceRecordRow(
            project_id=calculation.project_id,
            subject_type="calculation.result",
            subject_id=new_id(),
            source_class=ProvenanceClass.CALCULATED,
            detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
            verification_state=VerificationState.UNVERIFIED,
            producer_kind=ProducerKind.SERVICE,
            producer_identifier="local.dftd4.worker",
            producer_software_version=VERSION,
            source_artifact_id=input_artifact.id,
            operation="chemdft.dispersion-correction",
            operation_version="1.0.0",
            parameters_json=[
                {"name": "source_result_id", "value": str(spec.source.result_id)},
                {"name": "variant_sha256", "value": spec.variant_sha256},
            ],
            approximate=False,
            supersedes_id=None,
            correlation_id=new_id(),
        )
        session.add(provenance)
        session.flush()
        session.add(
            ProvenanceInputRow(
                project_id=calculation.project_id,
                provenance_record_id=provenance.id,
                position=0,
                input_type="calculation.result",
                input_id=str(spec.source.result_id),
                input_sha256=spec.source.result_payload_sha256,
            )
        )
        attempt = CalculationAttemptRecord(
            project_id=calculation.project_id,
            calculation_id=calculation.id,
            attempt_number=attempt_number,
            state="SUCCEEDED",
            worker_id="local.dftd4.worker",
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
        a._transition(calculation, "SUCCEEDED")
        producer = issue_trusted_producer_context(
            producer_id="local.dftd4.worker",
            producer_type=ProducerType.SCIENTIFIC_WORKER,
            project_id=UUID(calculation.project_id),
            attestation_id=f"execution:{compute_execution.id}:attempt:{attempt_number}",
        )
        submission = AuthoritativeResultSubmission(
            result_type="chemdft.dispersion-corrected-energy",
            project_id=UUID(calculation.project_id),
            calculation_id=UUID(calculation.id),
            calculation_input_id=UUID(inp.id),
            producer_software=engine,
            payload=make_payload(spec, parsed["correction_energy_hartree"]),
            provenance_record_id=UUID(provenance.id),
            raw_artifacts=tuple(raw_artifacts),
            idempotency_key=f"dftd4-result:{calculation.id}",
            request_id=UUID(new_id()),
            correlation_id=UUID(provenance.correlation_id),
        )
        a.accept_authoritative_result(
            session, producer, submission, object_store=store, settings=settings, commit=False
        )
        require(shutdown_signal() is None, "shutdown before commit")
        # Serialize the final job state with cancellation and recheck the lease clock.
        require(
            session.execute(
                update(ComputeJobRecord)
                .where(ComputeJobRecord.id == job.id, ComputeJobRecord.state == "RUNNING")
                .values(state="RUNNING")
                .execution_options(synchronize_session=False)
            ).rowcount
            == 1,
            "job canceled before commit",
        )
        require(
            session.execute(
                update(ComputeLeaseRecord)
                .where(
                    ComputeLeaseRecord.execution_id == compute_execution.id,
                    ComputeLeaseRecord.owner == "local.dftd4.worker",
                    ComputeLeaseRecord.state == "ACTIVE",
                    ComputeLeaseRecord.expires_at > utc_now(),
                    ComputeLeaseRecord.heartbeat_deadline_at > utc_now(),
                )
                .values(expires_at=ComputeLeaseRecord.expires_at)
                .execution_options(synchronize_session=False)
            ).rowcount
            == 1,
            "lease expired before commit",
        )
        job.state, job.updated_at = "SUCCEEDED", utc_now()
        compute_execution.state, compute_execution.finished_at = "FINISHED", utc_now()
        compute_execution.environment_json = parsed["environment"]
        compute_execution.raw_artifacts_json = [r.model_dump(mode="json") for r in raw_artifacts]
        compute_execution.actual_cost_json = {"currency": "USD", "minor_units": 0}
        a._release_reservation(session, job.reservation_id, compute_execution.actual_cost_json)
        a._finish_active_leases(session, compute_execution.id)
        from .billing_service import BillingService

        BillingService(session, identity, settings).record_compute_usage(
            project_id=job.project_id,
            compute_job_id=job.id,
            compute_execution_id=compute_execution.id,
            provider="local",
            engine="dftd4",
            reserved_minor_units=0,
            actual_minor_units=0,
            billable_minor_units=0,
            idempotency_key=f"compute-execution:{compute_execution.id}",
        )
        session.commit()
    except Exception as error:
        session.rollback()
        for record in (calculation, job, compute_execution):
            session.refresh(record)
        # Reuse failure reconciliation, with the D4 worker identity passed explicitly.
        return fail_psi4_energy(
            session,
            identity,
            settings,
            calculation,
            job,
            compute_execution,
            diagnostics,
            attempt_number,
            started_at,
            error,
            canceled=canceled or job.state in {"CANCELED", "CANCEL_REQUESTED"},
            timed_out=execution.timed_out,
            worker_id="local.dftd4.worker",
            failure_code="OUTPUT_MISSING" if isinstance(error, OSError) else failure_code,
        )
    return a.get_calculation(session, identity, calculation.project_id, calculation.id)


def retain_late_diagnostics(
    session, identity, store, settings, calculation, execution_record, execution
):
    from . import calculation_actions as a

    refs = []
    for name, content in execution.native_artifacts.items():
        if len(content) > settings.scientific_max_output_bytes:
            continue
        refs.append(
            a._artifact_reference(
                a._store_artifact(
                    session,
                    identity,
                    store,
                    project_id=calculation.project_id,
                    kind="CALCULATION_OUTPUT",
                    media_type="application/octet-stream",
                    format_identifier="dftd4.diagnostic." + name,
                    format_version="1.0.0",
                    payload=content,
                    source_type="calculation.record",
                    source_id=calculation.id,
                    max_bytes=settings.scientific_max_output_bytes,
                )
            ).model_dump(mode="json")
        )
    execution_record.raw_artifacts_json = refs
    session.commit()
