from __future__ import annotations

import hashlib
import json
import re
import secrets
from datetime import UTC, datetime, timedelta
from io import BytesIO
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .billing_service import BillingService
from .compute_gateway import (
    LOCAL_PROVIDER,
    WORKLOAD_CREST_SEARCH,
    WORKLOAD_PSI4_ENERGY,
    WORKLOAD_PYSCF_ENERGY,
    WORKLOAD_PYSCF_PERIODIC_ENERGY,
    WORKLOAD_QE_PERIODIC_ENERGY,
    WORKLOAD_PYSCF_FREQUENCY,
    WORKLOAD_PYSCF_OPTIMIZATION,
    WORKLOAD_PYSCF_ORBITAL,
    WORKLOAD_PYSCF_TDDFT,
    WORKLOAD_PYSCF_THERMOCHEMISTRY,
    WORKLOAD_XTB_ENERGY,
    WORKLOAD_XTB_OPTIMIZATION,
    ComputeProviderUnavailable,
    LocalComputeProvider,
    choose_provider,
    default_requirement,
    estimate_for_requirement,
    issue_execution_authorization,
    lease_token_hash,
    requirement_hash,
)
from .aws_compute import (
    AWS_PROVIDER,
    HARDWARE_CLASS as AWS_HARDWARE_CLASS,
    AwsEc2ComputeProvider,
    aws_crest_refusal,
    aws_frequency_refusal,
    aws_orbital_refusal,
    aws_periodic_refusal,
    aws_tddft_refusal,
    aws_optimization_refusal,
    aws_runtime_limit_seconds,
    aws_supports_specification,
    session_is_authorized,
)
from .config import Settings
from .context import Identity, ServiceIdentity
from .contracts.base import ArtifactReference
from .contracts.catalog import (
    CalculationDetail,
    CalculationSubmitInput,
    ComputeEstimate,
    ComputeExecutionView,
    ComputeFailureCode,
    ComputeJobListOutput,
    ComputeJobState,
    ComputeJobView,
    ComputeReservationView,
    EngineCapabilityView,
    JobSpecificationSummary,
    JobStructureSummary,
    OptimizationTrajectory,
    ProviderMeteringView,
    WorkloadReference,
)
from .calculation_summary import hill_formula, version_atoms
from .contracts.provenance import ProducerKind, ProvenanceClass, ProvenanceDetail, VerificationState
from .contracts.results import (
    AuthoritativeResultSubmission,
    EnergyResult,
    MolecularOrbitalAnalysis,
    OptimizationResult,
    PeriodicEnergyResult,
    TddftResult,
    VibrationalAnalysis,
    vibrational_payload_hash,
)
from .contracts.scientific import (
    Calculation,
    CalculationAttempt,
    CalculationFailureCode,
    CalculationLifecycle,
    CalculationTaskType,
    EngineReference,
    QuantityDimension,
    ScientificQuantity,
    UnitReference,
    UnitStandard,
)
from .errors import (
    CalculationConflict,
    ComputeJobNotFound,
    ComputeUnavailable,
    CrossProjectReference,
    EngineUnavailable,
    ScientificReferenceNotFound,
    ScientificValidationFailed,
    UploadTooLarge,
)
from .models import new_id, utc_now
from .project_access import ProjectCapability, can
from .scientific.electronic_state import electronic_state_authority
from .scientific.engines.lifecycle import require_transition
from .scientific.engines.normalization import (
    normalized_calculation_input,
    validate_structure_electronic_state,
)
from .scientific.engines.registry import (
    GEOMETRIC_VERSION,
    capability_views,
    configured_path,
    validate_capability,
)
from .scientific.engines.thermochemistry import (
    ThermochemistryGateFailed,
    build_thermochemistry_payload,
    evaluate_thermochemistry_gates,
    thermochemistry_input_fields,
)
from .scientific_actions import accept_authoritative_result
from .scientific_models import (
    AuditEventRecord,
    CalculationAttemptRecord,
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ComputeEstimateRecord,
    ComputeExecutionRecord,
    ComputeJobRecord,
    ComputeLeaseRecord,
    ComputeReservationRecord,
    OptimizationTrajectoryRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureRecord,
    StructureVersionRecord,
)
from .service_principals import service_identity_for_work
from .storage import ObjectStore
from .trusted_producers import ProducerType, issue_trusted_producer_context

ADAPTER_VERSION = "1.0.0"
PARSER_VERSION = "1.0.0"
ENERGY_VALIDATOR_VERSION = "1.0.0"


def list_engine_capabilities(settings: Settings) -> tuple[EngineCapabilityView, ...]:
    return capability_views(settings)


def submit_calculation(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    project_id: str,
    command: CalculationSubmitInput,
) -> CalculationDetail:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        from .errors import ProjectAccessDenied

        raise ProjectAccessDenied()
    from .usage_limits import enforce_compute_job_limit

    enforce_compute_job_limit(session, settings, identity.user_id)
    from .account_policy import enforce_compute

    enforce_compute(session, settings, identity.user_id)
    if command.structure_version.project_id != UUID(project.id):
        raise CrossProjectReference()
    if command.structure_version.entity_type != "structure.version":
        raise ScientificReferenceNotFound("Calculation requires a StructureVersion.")
    if command.specification.task_type is CalculationTaskType.CONFORMER_SEARCH:
        # Serialize same-project CREST idempotency before checking/allocating rows.
        session.execute(
            update(type(project))
            .where(type(project).id == project.id)
            .values(name=type(project).name)
        )
    request_hash = _command_hash(command)
    existing = session.scalar(
        select(CalculationRecord).where(
            CalculationRecord.project_id == project.id,
            CalculationRecord.idempotency_key == command.idempotency_key,
        )
    )
    if existing is not None:
        if existing.request_hash != request_hash:
            raise CalculationConflict()
        return get_calculation(session, identity, project_id, existing.id)

    version = session.get(StructureVersionRecord, str(command.structure_version.entity_id))
    if version is None or version.project_id != project.id:
        raise ScientificReferenceNotFound("Structure version does not exist.")
    from .geometry_eligibility import require_calculation_geometry

    require_calculation_geometry(session, object_store, version)
    state_binding = electronic_state_authority(session, object_store, version)
    xyz_declaration = state_binding["authority"] == "CALCULATION_USER_DECLARED"
    validate_structure_electronic_state(
        version, command.specification, xyz_calculation_declaration=xyz_declaration
    )
    validate_capability(command.specification, settings)
    thermochemistry_evidence = None
    if command.specification.task_type is CalculationTaskType.THERMOCHEMISTRY:
        # Every scientific validity gate runs before anything is queued; nothing electronic-
        # structure related is ever scheduled for thermochemistry.
        thermochemistry_evidence = evaluate_thermochemistry_gates(
            session,
            object_store,
            project_id=project.id,
            options=command.specification.thermochemistry,
            max_artifact_bytes=settings.scientific_max_output_bytes,
        )
        if thermochemistry_evidence.version.id != version.id:
            raise ThermochemistryGateFailed(
                "THERMO_STRUCTURE_MISMATCH",
                "The request must reference the optimized StructureVersion used by the "
                "source frequency calculation.",
            )
    try:
        provider = choose_provider(settings, command.provider_preference)
    except ComputeProviderUnavailable as error:
        raise ComputeUnavailable(str(error)) from error
    if provider == AWS_PROVIDER and not aws_supports_specification(command.specification):
        # Only PySCF energy, optimization, frequency, thermochemistry, orbitals and TDDFT, and xTB
        # energy, run on AWS.
        # An explicit cloud request for anything else is refused; AUTO stays on local.
        if command.provider_preference == "CLOUD":
            raise ComputeUnavailable(
                "AWS execution currently supports PySCF single-point energy, geometry "
                "optimization, frequency analysis, thermochemistry, molecular orbitals and TDDFT, "
                "xTB (GFN2) single-point energy and geometry optimization, and CREST conformer "
                "search only."
            )
        if not settings.compute_local_enabled:
            raise ComputeUnavailable(
                "AWS execution currently supports PySCF single-point energy, geometry "
                "optimization, frequency analysis, thermochemistry, molecular orbitals and TDDFT, "
                "xTB (GFN2) single-point energy and geometry optimization, and CREST conformer "
                "search only, and local "
                "compute is disabled on this deployment."
            )
        provider = LOCAL_PROVIDER
    if provider not in (LOCAL_PROVIDER, AWS_PROVIDER):
        raise ComputeUnavailable("Cloud compute is not configured for this ChemDFT environment.")
    if provider == AWS_PROVIDER and settings.aws_on_demand_enabled:
        # Bounded queue: a stopped on-demand worker never accumulates unlimited waiting jobs.
        from .aws_worker_lifecycle import waiting_aws_jobs

        if (
            waiting_aws_jobs(session, settings.aws_job_max_wait_seconds)
            >= settings.aws_max_queued_jobs
        ):
            raise ComputeUnavailable(
                "The AWS worker queue is full. Try again after a waiting calculation finishes."
            )
    requirement = default_requirement(settings, provider)
    if command.specification.task_type is CalculationTaskType.CONFORMER_SEARCH:
        requirement = requirement.model_copy(
            update={
                "cpu_count": 2,
                "runtime_limit_seconds": min(
                    command.specification.conformer_search.timeout_seconds,
                    settings.crest_timeout_seconds,
                ),
                "temporary_storage_bytes": settings.crest_max_scratch_bytes,
            }
        )
    if command.specification.engine_preference.engine == "psi4":
        from .scientific.engines.psi4 import MAX_DIRECTORY, MAX_WALL, MEMORY_BYTES

        requirement = requirement.model_copy(
            update={
                "cpu_count": 1,
                "memory_bytes": MEMORY_BYTES,
                "runtime_limit_seconds": min(
                    MAX_WALL, settings.scientific_execution_timeout_seconds
                ),
                "temporary_storage_bytes": min(
                    MAX_DIRECTORY, settings.compute_local_temporary_storage_bytes
                ),
            }
        )
    if provider == AWS_PROVIDER and command.specification.task_type in {
        CalculationTaskType.ENERGY,
        CalculationTaskType.PERIODIC_ENERGY,
        CalculationTaskType.GEOMETRY_OPTIMIZATION,
        CalculationTaskType.FREQUENCY,
        CalculationTaskType.TDDFT,
        CalculationTaskType.CONFORMER_SEARCH,
    }:
        requirement = requirement.model_copy(
            update={
                "runtime_limit_seconds": aws_runtime_limit_seconds(
                    settings,
                    command.specification.task_type,
                    command.specification.engine_preference.engine,
                )
            }
        )
    if provider == AWS_PROVIDER and command.specification.task_type is (
        CalculationTaskType.CONFORMER_SEARCH
    ):
        # The hosted container is capped at 1 CPU / 4 GiB / 512 MiB tmpfs (host-workflow.sh), not
        # the 2 threads CREST is invoked with; the requirement states what the container has.
        requirement = requirement.model_copy(
            update={"cpu_count": 1, "temporary_storage_bytes": 256 * 1024 * 1024}
        )
    estimate = estimate_for_requirement(
        estimate_id=UUID(new_id()),
        project_id=UUID(project.id),
        requirement=requirement,
        provider=provider,
    )

    calculation_id = new_id()
    calculation_input_id = new_id()
    job_id = new_id()
    reservation_id = new_id()
    document, normalized_bytes, normalized_hash = normalized_calculation_input(
        version, command.specification, max_atoms=settings.scientific_max_atoms,
        xyz_calculation_declaration=xyz_declaration,
        crest_executable_sha256=(
            settings.aws_crest_binary_sha256 if provider == AWS_PROVIDER else None
        ),
    )
    if (
        provider == AWS_PROVIDER
        and command.specification.task_type is CalculationTaskType.GEOMETRY_OPTIMIZATION
    ):
        refusal = aws_optimization_refusal(
            settings, command.specification.multiplicity, len(document["atoms"]),
            command.specification.engine_preference.engine,
        )
        if refusal:
            raise ComputeUnavailable(f"AWS_OPTIMIZATION_REFUSED: {refusal}")
    if (
        provider == AWS_PROVIDER
        and command.specification.task_type is CalculationTaskType.FREQUENCY
    ):
        refusal = aws_frequency_refusal(
            settings,
            command.specification.multiplicity,
            len(document["atoms"]),
            raman=command.specification.raman is not None,
        )
        if refusal:
            raise ComputeUnavailable(f"AWS_FREQUENCY_REFUSED: {refusal}")
    if (
        provider == AWS_PROVIDER
        and command.specification.task_type is CalculationTaskType.ORBITAL
    ):
        refusal = aws_orbital_refusal(
            settings, command.specification.multiplicity, len(document["atoms"])
        )
        if refusal:
            raise ComputeUnavailable(f"AWS_ORBITAL_REFUSED: {refusal}")
    if (
        provider == AWS_PROVIDER
        and command.specification.task_type is CalculationTaskType.TDDFT
    ):
        tddft_options = command.specification.tddft
        refusal = aws_tddft_refusal(
            settings,
            command.specification.multiplicity,
            len(document["atoms"]),
            getattr(tddft_options, "nstates", None),
        )
        if refusal:
            raise ComputeUnavailable(f"AWS_TDDFT_REFUSED: {refusal}")
    if (
        provider == AWS_PROVIDER
        and command.specification.task_type is CalculationTaskType.CONFORMER_SEARCH
    ):
        refusal = aws_crest_refusal(settings, document)
        if refusal:
            raise ComputeUnavailable(f"AWS_CREST_REFUSED: {refusal}")
    if (
        command.specification.task_type is CalculationTaskType.PERIODIC_ENERGY
        and command.specification.engine_preference.engine == "qe"
    ):
        from .scientific.qe_periodic.qe_registry import qe_creation_refusal

        qe_refusal = qe_creation_refusal(settings, command.specification, document["atoms"])
        if qe_refusal:
            raise ComputeUnavailable(f"QE_PERIODIC_REFUSED: {qe_refusal}")
    elif (
        provider == AWS_PROVIDER
        and command.specification.task_type is CalculationTaskType.PERIODIC_ENERGY
    ):
        refusal = aws_periodic_refusal(
            settings,
            len(document["atoms"]),
            command.specification.periodic.k_mesh if command.specification.periodic else (1, 1, 1),
        )
        if refusal:
            raise ComputeUnavailable(f"AWS_PERIODIC_REFUSED: {refusal}")
    if (
        command.specification.task_type is CalculationTaskType.PERIODIC_ENERGY
        and command.specification.engine_preference.engine == "qe"
    ):
        from .scientific.qe_periodic.qe_registry import validate_qe_periodic_elements

        validate_qe_periodic_elements([atom["element"] for atom in document["atoms"]])
    elif command.specification.task_type is CalculationTaskType.PERIODIC_ENERGY:
        from .scientific.engines.registry import validate_pyscf_periodic_elements

        validate_pyscf_periodic_elements([atom["atomic_number"] for atom in document["atoms"]])
    elif command.specification.engine_preference.engine == "pyscf" and command.specification.basis:
        from .scientific.engines.registry import validate_pyscf_elements

        validate_pyscf_elements(
            command.specification.basis.identifier,
            [atom["atomic_number"] for atom in document["atoms"]],
        )
    if command.specification.task_type in {
        CalculationTaskType.GEOMETRY_OPTIMIZATION,
        CalculationTaskType.CONFORMER_SEARCH,
        CalculationTaskType.FREQUENCY,
        CalculationTaskType.ORBITAL,
        CalculationTaskType.TDDFT,
        CalculationTaskType.THERMOCHEMISTRY,
        CalculationTaskType.PERIODIC_ENERGY,
    }:
        structure_artifact = session.get(ScientificArtifactRecord, version.canonical_artifact_id)
        if structure_artifact is None:
            raise ScientificReferenceNotFound("Immutable source structure artifact is missing.")
        document["input_structure_hash"] = structure_artifact.sha256
        document["specification_hash"] = hashlib.sha256(
            json.dumps(
                command.specification.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
            ).encode()
        ).hexdigest()
        engine_version = next(
            item.version
            for item in capability_views(settings)
            if item.engine == command.specification.engine_preference.engine
        )
        if not engine_version:
            raise ComputeUnavailable("Pinned PySCF worker version could not be established.")
        document["engine_version"] = engine_version
        document["engine"] = command.specification.engine_preference.engine
        if document["engine"] == "xtb" and provider != AWS_PROVIDER:
            # On AWS the binary lives in the pinned image, not on this host; the validator then
            # checks the hash recorded in the native invocation instead of a local file.
            document["engine_executable_sha256"] = hashlib.sha256(
                configured_path(settings.xtb_executable).read_bytes()
            ).hexdigest()
        if command.specification.task_type is CalculationTaskType.GEOMETRY_OPTIMIZATION:
            optimizer = command.specification.optimization.optimizer
            document["optimizer_version"] = (
                engine_version if optimizer == "xtb-ancopt" else GEOMETRIC_VERSION
            )
            engine_identity = (
                f"{document['engine']}:{engine_version}:{optimizer}:{document['optimizer_version']}"
            )
        elif command.specification.task_type is CalculationTaskType.CONFORMER_SEARCH:
            engine_identity = f"crest:{engine_version}:embedded-tblite-0.3.0-fork:gfn2"
        elif command.specification.task_type is CalculationTaskType.ORBITAL:
            document["orbital_adapter_version"] = "1.0.0"
            engine_identity = f"pyscf:{engine_version}:molecular-orbitals:1.0.0"
        elif command.specification.task_type is CalculationTaskType.TDDFT:
            document["tddft_adapter_version"] = "1.0.0"
            engine_identity = f"pyscf:{engine_version}:tddft:1.0.0"
        elif command.specification.task_type is CalculationTaskType.PERIODIC_ENERGY:
            document["periodic_adapter_version"] = "1.0.0"
            engine_identity = f"{document['engine']}:{engine_version}:periodic-energy:1.0.0"
        elif command.specification.task_type is CalculationTaskType.THERMOCHEMISTRY:
            document["thermochemistry"] = thermochemistry_input_fields(
                thermochemistry_evidence, command.specification.thermochemistry
            )
            engine_identity = f"pyscf:{engine_version}:thermo:1.0.0"
        else:
            engine_identity = f"pyscf:{engine_version}:analytic-hessian:1.0.0"
        document["engine_identity_hash"] = hashlib.sha256(engine_identity.encode()).hexdigest()
        document["parser_version"] = PARSER_VERSION
        document["validator_version"] = "1.0.0"
        normalized_bytes = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
        normalized_hash = hashlib.sha256(normalized_bytes).hexdigest()
    if command.specification.engine_preference.engine == "psi4":
        structure_artifact = session.get(ScientificArtifactRecord, version.canonical_artifact_id)
        if structure_artifact is None:
            raise ScientificReferenceNotFound("Psi4 immutable source structure artifact missing.")
        document["input_structure_hash"] = structure_artifact.sha256
        document["specification_hash"] = hashlib.sha256(
            json.dumps(
                command.specification.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
            ).encode()
        ).hexdigest()
        normalized_bytes = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
        normalized_hash = hashlib.sha256(normalized_bytes).hexdigest()
    calculation = CalculationRecord(
        id=calculation_id,
        project_id=project.id,
        state=CalculationLifecycle.DRAFT,
        idempotency_key=command.idempotency_key,
        request_hash=request_hash,
        created_by=identity.user_id,
    )
    session.add(calculation)
    session.flush()
    input_artifact = _store_artifact(
        session,
        identity,
        object_store,
        project_id=project.id,
        kind="CALCULATION_INPUT",
        media_type="application/vnd.chemdft.calculation-input+json",
        format_identifier="chemdft.calculation_input",
        format_version="1.0.0",
        payload=normalized_bytes,
        source_type="structure.version",
        source_id=version.id,
        max_bytes=settings.scientific_max_output_bytes,
    )
    if input_artifact.sha256 != normalized_hash:
        raise RuntimeError("Object store changed normalized input bytes")
    calculation_input = CalculationInputRecord(
        id=calculation_input_id,
        project_id=project.id,
        calculation_id=calculation.id,
        structure_version_id=version.id,
        conformer_id=None,
        specification_json=command.specification.model_dump(mode="json"),
        normalized_input_artifact_id=input_artifact.id,
    )
    session.add(calculation_input)
    estimate_record = ComputeEstimateRecord(
        id=str(estimate.id),
        project_id=project.id,
        requirement_hash=estimate.requirement_hash,
        provider=estimate.provider,
        provider_summary=estimate.provider_summary,
        runtime_low_seconds=estimate.runtime_low_seconds,
        runtime_high_seconds=estimate.runtime_high_seconds,
        cost_low_json=estimate.cost_low.model_dump(mode="json") if estimate.cost_low else None,
        cost_high_json=estimate.cost_high.model_dump(mode="json") if estimate.cost_high else None,
        confidence=estimate.confidence,
        assumptions_json=list(estimate.assumptions),
        valid_until=estimate.valid_until,
        created_at=estimate.created_at,
    )
    session.add(estimate_record)
    reservation = ComputeReservationRecord(
        id=reservation_id,
        project_id=project.id,
        estimate_id=estimate_record.id,
        authorized_max_json=(
            estimate.cost_high.model_dump(mode="json")
            if estimate.cost_high
            else {"currency": "USD", "minor_units": 0}
        ),
        actual_cost_json=None,
        state="RESERVED",
        created_at=utc_now(),
        reconciled_at=None,
    )
    session.add(reservation)
    session.flush()
    session.add(
        ComputeJobRecord(
            id=job_id,
            project_id=project.id,
            calculation_id=calculation.id,
            calculation_input_id=calculation_input.id,
            workload_json=(
                WORKLOAD_PSI4_ENERGY
                if command.specification.engine_preference.engine == "psi4"
                else WORKLOAD_CREST_SEARCH
                if command.specification.task_type is CalculationTaskType.CONFORMER_SEARCH
                else WORKLOAD_XTB_OPTIMIZATION
                if command.specification.engine_preference.engine == "xtb"
                and command.specification.task_type is CalculationTaskType.GEOMETRY_OPTIMIZATION
                else WORKLOAD_XTB_ENERGY
                if command.specification.engine_preference.engine == "xtb"
                else WORKLOAD_QE_PERIODIC_ENERGY
                if command.specification.engine_preference.engine == "qe"
                else WORKLOAD_PYSCF_PERIODIC_ENERGY
                if command.specification.task_type is CalculationTaskType.PERIODIC_ENERGY
                else WORKLOAD_PYSCF_OPTIMIZATION
                if command.specification.task_type is CalculationTaskType.GEOMETRY_OPTIMIZATION
                else WORKLOAD_PYSCF_FREQUENCY
                if command.specification.task_type is CalculationTaskType.FREQUENCY
                else WORKLOAD_PYSCF_ORBITAL
                if command.specification.task_type is CalculationTaskType.ORBITAL
                else WORKLOAD_PYSCF_TDDFT
                if command.specification.task_type is CalculationTaskType.TDDFT
                else WORKLOAD_PYSCF_THERMOCHEMISTRY
                if command.specification.task_type is CalculationTaskType.THERMOCHEMISTRY
                else WORKLOAD_PYSCF_ENERGY
            ).model_dump(mode="json"),
            requirement_json=requirement.model_dump(mode="json"),
            requirement_hash=requirement_hash(requirement),
            state=ComputeJobState.READY,
            provider=provider,
            priority=requirement.priority,
            idempotency_key=f"compute-job:{calculation.id}:{command.idempotency_key}",
            estimate_id=estimate_record.id,
            reservation_id=reservation.id,
            submitted_by=identity.user_id,
            retry_count=0,
        )
    )
    if command.specification.task_type is CalculationTaskType.GEOMETRY_OPTIMIZATION:
        session.add(
            OptimizationTrajectoryRecord(
                project_id=project.id,
                calculation_id=calculation.id,
                input_structure_version_id=version.id,
                atom_identities_json=version.representation_json["coordinates"]["atoms"],
                steps_json=[],
                state="QUEUED",
                artifact_id=None,
                artifact_sha256=None,
                final_structure_version_id=None,
                engine_json=None,
                input_hash=normalized_hash,
            )
        )
    for state in (
        CalculationLifecycle.VALIDATED,
        CalculationLifecycle.AUTHORIZED,
        CalculationLifecycle.QUEUED,
    ):
        _transition(calculation, state)
    _audit(
        session, identity, project.id, "calculation.created", calculation.id,
        metadata=[{"key": f"electronic_state.{key}", "value": str(value)}
                  for key, value in {
            **state_binding,
            "charge": command.specification.charge,
            "multiplicity": command.specification.multiplicity,
            "declared_by": identity.user_id,
            "normalized_input_sha256": normalized_hash,
        }.items()],
    )
    _audit(session, identity, project.id, "compute.job.created", calculation.id)
    session.commit()
    return get_calculation(session, identity, project_id, calculation.id)


def process_next_compute_job(
    session, identity, object_store, settings, *, worker_id="local.pyscf.worker"
):
    import fcntl

    from .scientific.engines.shutdown import crest_shutdown_scope

    eligible = (
        select(ComputeJobRecord)
        .where(ComputeJobRecord.state.in_([ComputeJobState.READY, ComputeJobState.PENDING]))
        .order_by(ComputeJobRecord.priority.desc(), ComputeJobRecord.created_at.asc())
    )
    if not settings.compute_local_enabled:
        eligible = eligible.where(ComputeJobRecord.provider != LOCAL_PROVIDER)
    if settings.aws_on_demand_enabled:
        # A stale approved AWS job (waited past the limit) is never claimed; it must be resubmitted.
        from .aws_worker_lifecycle import stale_cutoff

        eligible = eligible.where(
            (ComputeJobRecord.provider != AWS_PROVIDER)
            | (ComputeJobRecord.created_at >= stale_cutoff(settings))
        )
    if not session_is_authorized(settings):
        # AWS jobs are only claimed while an owner-approved, unexpired AWS session is open.
        # Otherwise they stay queued; the worker never starts EC2 and never falls back silently.
        eligible = eligible.where(ComputeJobRecord.provider != AWS_PROVIDER)
    elif not session_is_authorized(settings, task="GEOMETRY_OPTIMIZATION"):
        # The optimization limit is longer: with too little session time left, those jobs wait
        # (ENERGY jobs may still run) instead of being claimed and failing as AWS_SESSION_EXPIRING.
        eligible = eligible.where(
            (ComputeJobRecord.provider != AWS_PROVIDER)
            | (ComputeJobRecord.workload_json["workload_type"].as_string()
               != "chemdft.pyscf.optimization.v1")
        )
    if session_is_authorized(settings) and not session_is_authorized(
        settings, task="CONFORMER_SEARCH"
    ):
        eligible = eligible.where(
            (ComputeJobRecord.provider != AWS_PROVIDER)
            | (ComputeJobRecord.workload_json["workload_type"].as_string()
               != "chemdft.crest.conformer-search.v1")
        )
    if session_is_authorized(settings) and not session_is_authorized(settings, task="FREQUENCY"):
        eligible = eligible.where(
            (ComputeJobRecord.provider != AWS_PROVIDER)
            | (ComputeJobRecord.workload_json["workload_type"].as_string()
               != "chemdft.pyscf.frequency.v1")
        )
    if session_is_authorized(settings) and not session_is_authorized(
        settings, task="PERIODIC_ENERGY"
    ):
        # Release 0.0.45: periodic jobs (QE and PySCF) have the longest limit; with too little
        # session time left they wait for the next session (not AWS_SESSION_EXPIRING).
        eligible = eligible.where(
            (ComputeJobRecord.provider != AWS_PROVIDER)
            | ComputeJobRecord.workload_json["workload_type"].as_string().not_in(
                ["chemdft.qe.periodic-energy.v1", "chemdft.pyscf.periodic-energy.v1"]
            )
        )
    candidate = session.scalar(eligible.limit(1))
    if candidate is None:
        return None
    if candidate.workload_json.get("workload_type") != "chemdft.crest.conformer-search.v1":
        return _process_next_compute_job(
            session, identity, object_store, settings, job_id=candidate.id, worker_id=worker_id
        )
    lock_file = open_crest_lock(settings)
    with lock_file as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            session.rollback()
            # A busy CREST slot must not starve another engine's eligible work.
            candidate = session.scalar(
                eligible.where(
                    ComputeJobRecord.workload_json["workload_type"].as_string()
                    != "chemdft.crest.conformer-search.v1"
                ).limit(1)
            )
            if candidate is None:
                return None
            return _process_next_compute_job(
                session, identity, object_store, settings, job_id=candidate.id, worker_id=worker_id
            )
        # Signals request shutdown; this scope exits only after native cleanup and
        # terminal persistence. The lock remains held throughout both operations.
        with crest_shutdown_scope():
            return _process_next_compute_job(
                session,
                identity,
                object_store,
                settings,
                job_id=candidate.id,
                worker_id="local.crest.worker",
                crest_lock_held=True,
            )


class CrestLockUnavailable(RuntimeError):
    """The CREST claim lock file cannot be created or opened (bad path or read-only directory)."""


def open_crest_lock(settings: Settings):
    lock_path = configured_path(settings.effective_crest_lock_path())
    try:
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        return lock_path.open("a+b")
    except OSError as error:
        # Never leave a queued CREST job waiting silently: name the path and the cause.
        raise CrestLockUnavailable(
            f"The CREST claim lock cannot be opened at {lock_path} "
            f"({error.__class__.__name__}: {error}). Set CHEMDFT_CREST_LOCK_PATH to a "
            "writable path; queued CREST jobs are not being claimed."
        ) from error


def _process_next_compute_job(
    session,
    identity,
    object_store,
    settings,
    *,
    job_id,
    worker_id="local.pyscf.worker",
    crest_lock_held=False,
):
    job = session.get(ComputeJobRecord, job_id)
    if job is not None and job.workload_json.get("workload_type") in {
        "chemdft.psi4.energy.v1",
        "chemdft.dftd4.correction.v1",
    }:
        from .scientific.engines.shutdown import crest_shutdown_scope

        with crest_shutdown_scope():
            return _process_next_compute_job_inner(
                session,
                identity,
                object_store,
                settings,
                job_id=job_id,
                worker_id="local.dftd4.worker"
                if job.workload_json.get("workload_type") == "chemdft.dftd4.correction.v1"
                else "local.psi4.worker",
                crest_lock_held=crest_lock_held,
            )
    return _process_next_compute_job_inner(
        session,
        identity,
        object_store,
        settings,
        job_id=job_id,
        worker_id=worker_id,
        crest_lock_held=crest_lock_held,
    )


def _process_next_compute_job_inner(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    *,
    job_id: str,
    worker_id: str = "local.pyscf.worker",
    crest_lock_held: bool = False,
) -> CalculationDetail | None:
    job = session.get(ComputeJobRecord, job_id)
    if job is None or job.state not in (ComputeJobState.READY, ComputeJobState.PENDING):
        return None
    calculation = session.get(CalculationRecord, job.calculation_id)
    calculation_input = session.get(CalculationInputRecord, job.calculation_input_id)
    if isinstance(identity, ServiceIdentity):
        # Bind the worker to the job it claimed: its access is that job's project, nothing else.
        identity = service_identity_for_work(session, identity.service, job.id)
    if calculation is None or calculation_input is None:
        job.state = ComputeJobState.FAILED
        job.updated_at = utc_now()
        session.commit()
        return None
    input_artifact = session.get(
        ScientificArtifactRecord, calculation_input.normalized_input_artifact_id
    )
    if input_artifact is None:
        job.state = ComputeJobState.FAILED
        job.updated_at = utc_now()
        session.commit()
        return None

    now = utc_now()
    crest_run = calculation_input.specification_json.get("task_type") == "CONFORMER_SEARCH"
    if crest_run and not crest_lock_held:
        raise RuntimeError("CREST execution requires the owned native resource lock")
    if crest_run != (
        job.workload_json.get("workload_type") == "chemdft.crest.conformer-search.v1"
    ):
        raise RuntimeError("Selected job workload and scientific task disagree")
    if crest_run:
        from .scientific.engines.shutdown import shutdown_signal

        if shutdown_signal() is not None:
            return None
    run_ttl = (
        min(
            calculation_input.specification_json["conformer_search"]["timeout_seconds"],
            settings.crest_timeout_seconds,
        )
        + 60
        if crest_run
        else _hosted_run_ttl_seconds(settings, job, calculation_input.specification_json)
    )
    claimed = session.execute(
        update(ComputeJobRecord)
        .where(
            ComputeJobRecord.id == job.id,
            ComputeJobRecord.state.in_([ComputeJobState.READY, ComputeJobState.PENDING]),
        )
        .values(state=ComputeJobState.RUNNING)
    ).rowcount
    if not claimed:
        session.rollback()
        return None
    execution_id = new_id()
    lease_token = secrets.token_urlsafe(32)
    authorization = issue_execution_authorization(
        job_id=job.id,
        execution_id=execution_id,
        input_hash=input_artifact.sha256,
        ttl_seconds=run_ttl,
    )
    execution = ComputeExecutionRecord(
        id=execution_id,
        project_id=job.project_id,
        job_id=job.id,
        calculation_id=job.calculation_id,
        calculation_attempt_id=None,
        provider=job.provider,
        provider_execution_ref=None,
        state="RUNNING",
        worker_id=worker_id,
        lease_owner=worker_id,
        authorization_hash=authorization.token_hash,
        authorization_expires_at=authorization.expires_at,
        started_at=now,
        heartbeat_at=now,
        finished_at=None,
        environment_json=None,
        hardware_class=(
            "local.cpu"
            if job.provider == LOCAL_PROVIDER
            else AWS_HARDWARE_CLASS
            if job.provider == AWS_PROVIDER
            else None
        ),
        metering_json=None,
        actual_cost_json=None,
        raw_artifacts_json=[],
        failure_code=None,
        diagnostic=None,
    )
    session.add(execution)
    session.add(
        ComputeLeaseRecord(
            project_id=job.project_id,
            job_id=job.id,
            execution_id=execution.id,
            owner=worker_id,
            lease_token_hash=lease_token_hash(lease_token),
            issued_at=now,
            expires_at=now + timedelta(seconds=run_ttl),
            heartbeat_deadline_at=now + timedelta(seconds=settings.compute_heartbeat_seconds),
            heartbeat_at=now,
            state="ACTIVE",
        )
    )
    job.state = ComputeJobState.RUNNING
    job.updated_at = now
    trajectory = session.scalar(
        select(OptimizationTrajectoryRecord).where(
            OptimizationTrajectoryRecord.calculation_id == calculation.id
        )
    )
    if trajectory is not None:
        trajectory.state = "RUNNING"
    if calculation.state != CalculationLifecycle.RUNNING:
        _transition(calculation, CalculationLifecycle.RUNNING)
    _audit(session, identity, job.project_id, "compute.lease.issued", calculation.id)
    session.commit()
    return _execute_calculation(
        session,
        identity,
        object_store,
        settings,
        calculation,
        calculation_input,
        input_artifact,
        job,
        execution,
        lease_token,
    )


def _execute_calculation(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    calculation: CalculationRecord,
    calculation_input: CalculationInputRecord,
    input_artifact: ScientificArtifactRecord,
    job: ComputeJobRecord,
    compute_execution: ComputeExecutionRecord,
    lease_token: str,
) -> CalculationDetail:
    started_at = utc_now()
    if job.provider not in (LOCAL_PROVIDER, AWS_PROVIDER):
        raise ComputeUnavailable("Only the local and AWS providers are executable here.")
    trajectory = session.scalar(
        select(OptimizationTrajectoryRecord).where(
            OptimizationTrajectoryRecord.calculation_id == calculation.id
        )
    )
    observed_error: str | None = None
    canceled = False

    def lock_live_lease() -> bool:
        # Serialize progress/final publication with lease recovery. A former attempt
        # cannot append to the current trajectory or publish after losing its lease.
        return bool(
            session.execute(
                update(ComputeLeaseRecord)
                .where(
                    ComputeLeaseRecord.execution_id == compute_execution.id,
                    ComputeLeaseRecord.lease_token_hash == lease_token_hash(lease_token),
                    ComputeLeaseRecord.state == "ACTIVE",
                    ComputeLeaseRecord.expires_at > utc_now(),
                    ComputeLeaseRecord.heartbeat_deadline_at > utc_now(),
                )
                .values(expires_at=ComputeLeaseRecord.expires_at)
            ).rowcount
        )

    def on_step(candidate: dict) -> bool:
        nonlocal observed_error, canceled
        if trajectory is None:
            return True
        if not lock_live_lease():
            session.rollback()
            return False
        session.refresh(job)
        if job.state not in {ComputeJobState.RUNNING, ComputeJobState.CANCEL_REQUESTED}:
            session.rollback()
            return False
        from .scientific.engines.optimization import validate_step

        try:
            step = validate_step(
                candidate,
                trajectory.atom_identities_json,
                len(trajectory.steps_json),
                calculation_input.specification_json["engine_preference"]["engine"],
            )
        except (ValueError, TypeError) as error:
            observed_error = str(error)
            return False
        trajectory.steps_json = [*trajectory.steps_json, step]
        trajectory.updated_at = utc_now()
        compute_execution.heartbeat_at = utc_now()
        session.commit()
        session.refresh(job)
        canceled = job.state in {ComputeJobState.CANCEL_REQUESTED, ComputeJobState.CANCELED}
        return not canceled

    execution_id = compute_execution.id
    lease_owner = compute_execution.lease_owner or compute_execution.worker_id or ""

    def on_tick() -> bool | None:
        nonlocal canceled
        # Heartbeats preserve ownership while the subprocess blocks this worker.
        # Trusted native paths stop when ownership cannot be confirmed.
        try:
            alive = heartbeat_compute_execution(
                session,
                execution_id=execution_id,
                owner=lease_owner,
                lease_token=lease_token,
                settings=settings,
            )
            if (
                calculation_input.specification_json.get("task_type") == "CONFORMER_SEARCH"
                or calculation_input.specification_json.get("engine_preference", {}).get("engine")
                in {"psi4", "dftd4"}
            ) and not alive:
                return False
        except Exception:
            session.rollback()
            if (
                calculation_input.specification_json.get("task_type") == "CONFORMER_SEARCH"
                or calculation_input.specification_json.get("engine_preference", {}).get("engine")
                in {"psi4", "dftd4"}
            ):
                return False
        session.refresh(job)
        canceled = job.state in {ComputeJobState.CANCEL_REQUESTED, ComputeJobState.CANCELED}
        return False if canceled else None

    spec_json = calculation_input.specification_json or {}
    spec_engine = (spec_json.get("engine_preference") or {}).get("engine")
    spec_allowed_version = (spec_json.get("engine_preference") or {}).get("allowed_version")
    workload_ref = (
        WorkloadReference.model_validate(job.workload_json) if job.workload_json else None
    )

    psi4_attempt = (
        _next_attempt_number(session, calculation.id) if spec_engine in {"psi4", "dftd4"} else None
    )
    try:
        authorized_bytes = object_store.get_bytes(
            input_artifact.storage_key, settings.scientific_max_output_bytes
        )
        if (
            hashlib.sha256(authorized_bytes).hexdigest() != input_artifact.sha256
        ):
            raise ValueError("Immutable calculation input hash changed before execution")
        executor = (
            AwsEc2ComputeProvider(settings)
            if job.provider == AWS_PROVIDER
            else LocalComputeProvider(settings)
        )
        execution = executor.execute(
            calculation_id=calculation.id,
            normalized_input=authorized_bytes,
            engine=spec_engine,
            workload=workload_ref,
            allowed_version=spec_allowed_version,
            on_step=on_step if trajectory is not None else None,
            on_tick=on_tick,
            **(
                {"execution_id": compute_execution.id, "attempt_number": psi4_attempt}
                if spec_engine in {"psi4", "dftd4"}
                else {}
            ),
        )
    except Exception as error:
        from .scientific.engines.interfaces import ExecutionResult

        execution = ExecutionResult(
            None, False, b"", str(error).encode(), b"", None,
            failure_code=(
                "ENGINE_UNAVAILABLE" if isinstance(error, (OSError, EngineUnavailable))
                else "RESULT_VALIDATION_FAILED"
            ),
        )
    if execution.provider_ref:
        compute_execution.provider_execution_ref = execution.provider_ref
    session.refresh(job)
    active_lease = lock_live_lease()
    session.refresh(job)
    if not active_lease or job.state not in {
        ComputeJobState.RUNNING,
        ComputeJobState.CANCEL_REQUESTED,
    }:
        session.rollback()
        if spec_engine in {"crest", "psi4", "dftd4"}:
            if spec_engine in {"psi4", "dftd4"}:
                from .psi4_actions import retain_late_diagnostics
                if spec_engine == "dftd4":
                    from .dftd4_actions import retain_late_diagnostics

                try:
                    retain_late_diagnostics(
                        session, identity, object_store, settings,
                        calculation, compute_execution, execution,
                    )
                except Exception:
                    session.rollback()
            else:
                from .conformer_actions import retain_late_diagnostics

                retain_late_diagnostics(
                    session, identity, object_store, settings,
                    calculation, compute_execution, execution,
                )
        recover_expired_compute_leases(session)
        return get_calculation(session, identity, calculation.project_id, calculation.id)
    canceled = canceled or job.state == ComputeJobState.CANCEL_REQUESTED
    if job.state == ComputeJobState.CANCELED:
        # The cancel was finalized while this execution was still running (its lease had lapsed), so
        # the calculation is already CANCELED: discard the worker output and publish nothing.
        session.refresh(calculation)
        return get_calculation(session, identity, calculation.project_id, calculation.id)
    compute_execution.heartbeat_at = utc_now()
    worker_result = execution.result_document
    engine = str(
        (calculation_input.specification_json.get("engine_preference") or {}).get("engine")
        or (worker_result.get("engine") if worker_result else "pyscf")
    )
    failure_code: CalculationFailureCode | None = None
    diagnostic: str | None = None
    if execution.failure_code == "ENGINE_UNAVAILABLE":
        failure_code = CalculationFailureCode.ENGINE_UNAVAILABLE
        diagnostic = (
            f"{engine.upper()} engine unavailable: "
            f"{execution.stderr.decode(errors='replace')[:800]}"
        )
    elif execution.failure_code == "RESULT_VALIDATION_FAILED":
        failure_code = CalculationFailureCode.RESULT_VALIDATION_FAILED
        diagnostic = execution.stderr.decode(errors="replace")[:1000]
    elif execution.timed_out:
        failure_code = CalculationFailureCode.EXECUTION_TIMEOUT
        diagnostic = "Calculation exceeded the server-enforced timeout."
    elif execution.exit_code != 0:
        if worker_result and worker_result.get("converged") is False:
            failure_code = CalculationFailureCode.NONCONVERGED
            diagnostic = f"{engine.upper()} did not satisfy SCF convergence criteria."
        else:
            failure_code = CalculationFailureCode.ENGINE_CRASHED
            diagnostic = f"{engine.upper()} worker exited without a publishable result."

    try:
        raw_artifacts = [
            _artifact_reference(input_artifact),
            _artifact_reference(
                _store_artifact(
                    session,
                    identity,
                    object_store,
                    project_id=calculation.project_id,
                    kind="ENGINE_LOG",
                    media_type="text/plain",
                    format_identifier=f"{engine}.log",
                    format_version=None,
                    payload=execution.engine_log
                    + b"\nSTDOUT\n"
                    + execution.stdout
                    + b"\nSTDERR\n"
                    + execution.stderr,
                    source_type="calculation.record",
                    source_id=calculation.id,
                    max_bytes=settings.scientific_max_output_bytes,
                )
            ),
        ]
        if worker_result is not None:
            raw_artifacts.append(
                _artifact_reference(
                    _store_artifact(
                        session,
                        identity,
                        object_store,
                        project_id=calculation.project_id,
                        kind="NORMALIZED_RESULT",
                        media_type="application/json",
                        format_identifier="chemdft.worker.conformer-ensemble"
                        if engine == "crest"
                        else "chemdft.worker.optimization"
                        if trajectory
                        else "chemdft.worker.vibrational-analysis"
                        if calculation_input.specification_json.get("task_type") == "FREQUENCY"
                        else "chemdft.worker.thermochemistry"
                        if calculation_input.specification_json.get("task_type")
                        == "THERMOCHEMISTRY"
                        else "chemdft.worker.molecular-orbitals"
                        if calculation_input.specification_json.get("task_type") == "ORBITAL"
                        else "chemdft.worker.energy",
                        format_version="1.0.0",
                        payload=json.dumps(
                            worker_result, sort_keys=True, separators=(",", ":")
                        ).encode(),
                        source_type="calculation.record",
                        source_id=calculation.id,
                        max_bytes=settings.scientific_max_output_bytes,
                    )
                )
            )

        if trajectory is not None:
            raw_artifacts.append(
                _artifact_reference(
                    _store_artifact(
                        session,
                        identity,
                        object_store,
                        project_id=calculation.project_id,
                        kind="CALCULATION_OUTPUT",
                        media_type="application/json",
                        format_identifier="chemdft.worker.execution",
                        format_version="1.0.0",
                        payload=json.dumps(
                            {
                                "calculation_id": calculation.id,
                                "execution_id": compute_execution.id,
                                "normalized_input_sha256": input_artifact.sha256,
                                "worker_exit_code": execution.exit_code,
                                "timed_out": execution.timed_out,
                            },
                            sort_keys=True,
                        ).encode(),
                        source_type="calculation.record",
                        source_id=calculation.id,
                        max_bytes=settings.scientific_max_output_bytes,
                    )
                )
            )
        for name, data in execution.native_artifacts.items():
            raw_artifacts.append(
                _artifact_reference(
                    _store_artifact(
                        session,
                        identity,
                        object_store,
                        project_id=calculation.project_id,
                        kind="CALCULATION_OUTPUT",
                        media_type="application/octet-stream",
                        format_identifier=f"{engine}.native.{name}",
                        format_version="3.0.2+pf8c-ewinfix-a1"
                        if engine == "crest"
                        else "4.2.0"
                        if engine == "dftd4"
                        else "1.11"
                        if engine == "psi4"
                        else "6.7.1",
                        payload=data,
                        source_type="calculation.record",
                        source_id=calculation.id,
                        max_bytes=settings.crest_max_output_bytes
                        if engine == "crest"
                        else settings.scientific_max_output_bytes,
                    )
                )
            )
        attempt_number = psi4_attempt or _next_attempt_number(session, calculation.id)
        if engine in {"psi4", "dftd4"}:
            from .psi4_actions import finish_psi4_energy
            if engine == "dftd4":
                from .dftd4_actions import finish_correction as finish_psi4_energy

            return finish_psi4_energy(
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
            )
        if engine == "crest":
            from .conformer_actions import finish_conformer_search

            return finish_conformer_search(
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
            )
    except Exception as error:
        if engine in {"psi4", "dftd4"}:
            session.rollback()
            for record in (calculation, job, compute_execution):
                session.refresh(record)
            from .psi4_actions import fail_psi4_energy

            return fail_psi4_energy(
                session,
                identity,
                settings,
                calculation,
                job,
                compute_execution,
                [],
                psi4_attempt,
                started_at,
                error,
                canceled=canceled,
                timed_out=execution.timed_out,
                worker_id="local.dftd4.worker" if engine == "dftd4" else "local.psi4.worker",
                failure_code=("OUTPUT_MISSING" if isinstance(error, OSError)
                              else "RESULT_VALIDATION_FAILED") if engine == "dftd4" else None,
            )
        if engine != "crest" or not isinstance(error, UploadTooLarge):
            raise
        from .conformer_actions import fail_artifact_publication

        return fail_artifact_publication(
            session,
            identity,
            object_store,
            settings,
            calculation,
            job,
            compute_execution,
            execution,
            started_at,
        )
    if trajectory is not None:
        return _finish_optimization(
            session,
            identity,
            object_store,
            settings,
            calculation,
            calculation_input,
            input_artifact,
            job,
            compute_execution,
            trajectory,
            execution,
            worker_result,
            raw_artifacts,
            attempt_number,
            started_at,
            observed_error,
            canceled,
        )
    if calculation_input.specification_json.get("task_type") == "FREQUENCY":
        return _finish_frequency(
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
            worker_result,
            raw_artifacts,
            attempt_number,
            started_at,
        )
    if calculation_input.specification_json.get("task_type") == "THERMOCHEMISTRY":
        return _finish_thermochemistry(
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
            worker_result,
            raw_artifacts,
            attempt_number,
            started_at,
        )
    if calculation_input.specification_json.get("task_type") == "ORBITAL":
        return _finish_orbitals(
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
            worker_result,
            raw_artifacts,
            attempt_number,
            started_at,
        )
    if calculation_input.specification_json.get("task_type") == "TDDFT":
        return _finish_tddft(
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
            worker_result,
            raw_artifacts,
            attempt_number,
            started_at,
        )
    if calculation_input.specification_json.get("task_type") == "PERIODIC_ENERGY":
        return _finish_periodic_energy(
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
            worker_result,
            raw_artifacts,
            attempt_number,
            started_at,
        )
    if failure_code is not None or worker_result is None:
        # A user cancel is recorded as CANCELED, never as an engine failure (F-025).
        user_canceled = canceled and "AWS_JOB_CANCELED" in execution.stderr.decode(errors="replace")
        if user_canceled:
            failure_code = CalculationFailureCode.CANCELED
            diagnostic = "Canceled by the researcher."
        end_state = CalculationLifecycle.CANCELED if user_canceled else CalculationLifecycle.FAILED
        _transition(calculation, end_state)
        attempt = CalculationAttemptRecord(
            project_id=calculation.project_id,
            calculation_id=calculation.id,
            attempt_number=attempt_number,
            state=end_state,
            worker_id=f"local.{engine}",
            engine_identity_json=None,
            started_at=started_at,
            finished_at=utc_now(),
            failure_code=(failure_code or CalculationFailureCode.OUTPUT_MISSING),
            diagnostic=diagnostic or "Expected worker result was missing.",
            raw_artifacts_json=[ref.model_dump(mode="json") for ref in raw_artifacts],
        )
        session.add(attempt)
        session.flush()
        _finish_compute_failure(
            session,
            job,
            compute_execution,
            attempt.id,
            ComputeFailureCode.PROVIDER_TIMEOUT
            if execution.timed_out
            else ComputeFailureCode.SUBMISSION_FAILED,
            diagnostic or "Expected worker result was missing.",
        )
        if user_canceled:
            job.state = ComputeJobState.CANCELED
            compute_execution.state = "CANCELED"
        _audit(session, identity, calculation.project_id, "calculation.failed", calculation.id)
        session.commit()
        return get_calculation(session, identity, calculation.project_id, calculation.id)

    try:
        energy = _validate_energy_candidate(worker_result)
        if engine == "pyscf":
            _require_pyscf_log_energy(worker_result, execution.engine_log)
    except ValueError as error:
        return _fail_energy_validation(
            session, identity, calculation, job, compute_execution, raw_artifacts,
            engine, attempt_number, started_at, error,
        )

    environment_artifact = _artifact_reference(
        _store_artifact(
            session,
            identity,
            object_store,
            project_id=calculation.project_id,
            kind="ENVIRONMENT_MANIFEST",
            media_type="application/json",
            format_identifier="chemdft.environment_manifest",
            format_version="1.0.0",
            payload=json.dumps(
                worker_result["environment"], sort_keys=True, separators=(",", ":")
            ).encode(),
            source_type="calculation.record",
            source_id=calculation.id,
            max_bytes=settings.scientific_max_output_bytes,
        )
    )
    identity_model = EngineReference.model_validate(
        _identity_json(worker_result, environment_artifact)
    )
    session.commit()  # diagnostics and evidence stay retained even if publication is rejected
    _transition(calculation, CalculationLifecycle.SUCCEEDED)
    provenance = ProvenanceRecordRow(
        project_id=calculation.project_id,
        subject_type="calculation.result",
        subject_id=new_id(),
        source_class=ProvenanceClass.CALCULATED,
        detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SERVICE,
        producer_identifier=f"local.{engine}.worker",
        producer_software_version=str(worker_result["engine_version"]),
        source_artifact_id=input_artifact.id,
        operation="chemdft.calculation.energy",
        operation_version=ADAPTER_VERSION,
        parameters_json=[],
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
        worker_id=f"local.{engine}",
        engine_identity_json=identity_model.model_dump(mode="json"),
        started_at=started_at,
        finished_at=utc_now(),
        failure_code=None,
        diagnostic=None,
        raw_artifacts_json=[
            ref.model_dump(mode="json") for ref in (*raw_artifacts, environment_artifact)
        ],
    )
    session.add(attempt)
    session.flush()
    compute_execution.calculation_attempt_id = attempt.id
    compute_execution.state = "FINISHED"
    compute_execution.finished_at = utc_now()
    compute_execution.environment_json = worker_result["environment"]
    compute_execution.metering_json = {
        "runtime_ms": int((compute_execution.finished_at - started_at).total_seconds() * 1000),
        "cpu_ms": None,
        "gpu_ms": None,
        "provider_cost": None,
        "provider_cost_status": "UNKNOWN",
    }
    compute_execution.actual_cost_json = {"currency": "USD", "minor_units": 0}
    compute_execution.raw_artifacts_json = [
        ref.model_dump(mode="json") for ref in (*raw_artifacts, environment_artifact)
    ]
    job.state = ComputeJobState.SUCCEEDED
    job.updated_at = utc_now()
    _release_reservation(session, job.reservation_id, compute_execution.actual_cost_json)
    _finish_active_leases(session, compute_execution.id)
    producer = issue_trusted_producer_context(
        producer_id=f"local.{engine}.worker",
        producer_type=ProducerType.SCIENTIFIC_WORKER,
        project_id=UUID(calculation.project_id),
        attestation_id=f"execution:{compute_execution.id}:attempt:{attempt_number}",
    )
    try:
        accept_authoritative_result(
            session,
            producer,
            AuthoritativeResultSubmission(
                result_type="chemdft.energy",
                project_id=UUID(calculation.project_id),
                calculation_id=UUID(calculation.id),
                calculation_input_id=UUID(calculation_input.id),
                producer_software=identity_model,
                payload=energy,
                provenance_record_id=UUID(provenance.id),
                raw_artifacts=tuple((*raw_artifacts, environment_artifact)),
                idempotency_key=f"result:{calculation.id}:energy",
                request_id=uuid4(),
                correlation_id=UUID(provenance.correlation_id),
            ),
            commit=False,
        )
        # Billing commits the open transaction, so it runs only after the result was accepted:
        # the SUCCEEDED state, provenance, result and usage entry become durable together.
        BillingService(session, identity, settings).record_compute_usage(
            project_id=job.project_id,
            compute_job_id=job.id,
            compute_execution_id=compute_execution.id,
            provider=compute_execution.provider,
            engine=str((job.workload_json or {}).get("engine", engine)),
            reserved_minor_units=int((job.requirement_json or {}).get("reserved_minor_units", 0)),
            actual_minor_units=0,
            billable_minor_units=0,
            idempotency_key=f"compute-execution:{compute_execution.id}",
        )
        session.commit()
    except ScientificValidationFailed as error:
        # The publisher rolled back the SUCCEEDED state, provenance and billing together with the
        # rejected result: no authoritative result exists, so the calculation ends FAILED.
        session.rollback()
        for record in (calculation, job, compute_execution):
            session.refresh(record)
        return _fail_energy_validation(
            session, identity, calculation, job, compute_execution, raw_artifacts,
            engine, attempt_number, started_at, error,
        )
    return get_calculation(session, identity, calculation.project_id, calculation.id)


def _optimization_trajectory_view(record: OptimizationTrajectoryRecord) -> OptimizationTrajectory:
    return OptimizationTrajectory(
        id=UUID(record.id),
        calculation_id=UUID(record.calculation_id),
        input_structure_version_id=UUID(record.input_structure_version_id),
        atom_identities=record.atom_identities_json,
        steps=record.steps_json,
        state=record.state,
        artifact_sha256=record.artifact_sha256,
        final_structure_version_id=UUID(record.final_structure_version_id)
        if record.final_structure_version_id
        else None,
        engine=record.engine_json,
        input_hash=record.input_hash,
    )


def _finish_frequency(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    calculation: CalculationRecord,
    calculation_input: CalculationInputRecord,
    input_artifact: ScientificArtifactRecord,
    job: ComputeJobRecord,
    compute_execution: ComputeExecutionRecord,
    execution,
    worker_result: dict | None,
    raw_artifacts: list[ArtifactReference],
    attempt_number: int,
    started_at,
) -> CalculationDetail:
    input_document = json.loads(
        object_store.get_bytes(input_artifact.storage_key, settings.scientific_max_output_bytes)
    )
    session.refresh(job)
    canceled = job.state == ComputeJobState.CANCEL_REQUESTED
    try:
        if canceled:
            raise ValueError("Frequency analysis canceled before authoritative result publication")
        if execution.exit_code != 0 or execution.timed_out or worker_result is None:
            raise ValueError(
                "PySCF frequency worker failed before producing a complete Hessian result"
            )
        from .scientific.engines.vibrational import validate_frequency_candidate

        validated = validate_frequency_candidate(worker_result, input_document)
        hessian_bytes = json.dumps(
            {
                "schema": "chemdft.hessian",
                "schema_version": "1.0.0",
                "calculation_id": calculation.id,
                "input_structure_version_id": calculation_input.structure_version_id,
                "input_sha256": input_artifact.sha256,
                "engine": "pyscf",
                "engine_version": worker_result["engine_version"],
                "unit": "Eh/bohr^2",
                "atom_ordering": "AS_LISTED",
                "hessian": validated["hessian"],
            },
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
        hessian_artifact_record = _store_artifact(
            session,
            identity,
            object_store,
            project_id=calculation.project_id,
            kind="HESSIAN_MATRIX",
            media_type="application/vnd.chemdft.hessian+json",
            format_identifier="chemdft.hessian",
            format_version="1.0.0",
            payload=hessian_bytes,
            source_type="calculation.record",
            source_id=calculation.id,
            max_bytes=settings.scientific_max_output_bytes,
        )
        hessian_reference = _artifact_reference(hessian_artifact_record)
        raw_artifacts.append(hessian_reference)
        structure_version = session.get(
            StructureVersionRecord, calculation_input.structure_version_id
        )
        if structure_version is None or structure_version.project_id != calculation.project_id:
            raise ValueError("Authoritative input StructureVersion is missing")
        structure_artifact = session.get(
            ScientificArtifactRecord, structure_version.canonical_artifact_id
        )
        if structure_artifact is None:
            raise ValueError("Canonical StructureVersion artifact is missing")
        coordinates = validated["coordinates"]
        coordinate_payload = json.dumps(
            coordinates, separators=(",", ":"), allow_nan=False
        ).encode()
        specification_hash = hashlib.sha256(
            json.dumps(
                calculation_input.specification_json, sort_keys=True, separators=(",", ":")
            ).encode()
        ).hexdigest()
        modes = []
        has_ir = (
            "ir_intensities_km_mol" in worker_result
            and worker_result["ir_intensities_km_mol"] is not None
        )
        has_raman = (
            "raman_activities_angstrom4_per_amu" in worker_result
            and worker_result["raman_activities_angstrom4_per_amu"] is not None
        )
        raman_artifact_record = None
        raman_reference = None
        if has_raman:
            raman_payload_data = {
                "schema": "chemdft.raman",
                "schema_version": "1.0.0",
                "calculation_id": calculation.id,
                "input_structure_version_id": calculation_input.structure_version_id,
                "input_sha256": input_artifact.sha256,
                "engine": "pyscf",
                "engine_version": str(worker_result["engine_version"]),
                "method": str(worker_result["method"]),
                "basis": str(worker_result["basis"]),
                "equilibrium_polarizability_angstrom3": worker_result.get(
                    "equilibrium_polarizability_angstrom3"
                ),
                # per-mode polarizability derivative tensors dalpha/dQ (Ang^2/amu^0.5 per mode)
                # Both names are included: canonical audit name and legacy field name.
                "per_mode_dalpha_dq": worker_result.get(
                    "polarizability_derivatives_angstrom2_per_amu_half"
                ),
                "polarizability_derivatives_angstrom2_per_amu_half": worker_result.get(
                    "polarizability_derivatives_angstrom2_per_amu_half"
                ),
                "raman_activities_angstrom4_per_amu": worker_result.get(
                    "raman_activities_angstrom4_per_amu"
                ),
                "depolarization_ratios": worker_result.get("depolarization_ratios"),
                "max_abs_antisymmetry": worker_result.get("max_abs_antisymmetry"),
                "electric_field_step_au": worker_result.get("electric_field_step_au"),
                # Stored under both canonical audit name and legacy field name
                "normal_coordinate_step_angstrom_amu_half": worker_result.get(
                    "polarizability_derivative_step_angstrom_amu_half"
                ),
                "polarizability_derivative_step_angstrom_amu_half": worker_result.get(
                    "polarizability_derivative_step_angstrom_amu_half"
                ),
                "polarizability_unit": "angstrom^3",
                "raman_activity_unit": "angstrom^4/amu",
                # Placzek invariants per mode for full audit traceability
                # alpha_bar' = trace(dalpha/dQ)/3
                # gamma'^2 = 0.5*sum[(dalpha_ii-dalpha_jj)^2] + 3*sum[dalpha_ij^2 (i!=j)]
                "alpha_bar_prime_sq": worker_result.get("alpha_bar_prime_sq"),
                "gamma_prime_sq": worker_result.get("gamma_prime_sq"),
                # Tensor symmetrization settings
                "symmetrize_polarizability": worker_result.get(
                    "polarizability_tensor_symmetrization"
                ),
                "antisymmetry_tolerance": worker_result.get(
                    "polarizability_antisymmetry_tolerance"
                ),
            }

            raman_bytes = json.dumps(
                raman_payload_data,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode()
            raman_artifact_record = _store_artifact(
                session,
                identity,
                object_store,
                project_id=calculation.project_id,
                kind="RAMAN_ANALYSIS",
                media_type="application/vnd.chemdft.raman+json",
                format_identifier="chemdft.raman",
                format_version="1.0.0",
                payload=raman_bytes,
                source_type="calculation.record",
                source_id=calculation.id,
                max_bytes=settings.scientific_max_output_bytes,
            )
            raman_reference = _artifact_reference(raman_artifact_record)
            raw_artifacts.append(raman_reference)

        for index, frequency in enumerate(worker_result["frequencies_cm1"]):
            signed_frequency = float(frequency)
            ir_quantity = None
            if has_ir and index < len(worker_result["ir_intensities_km_mol"]):
                raw_ir = float(worker_result["ir_intensities_km_mol"][index])
                ir_quantity = ScientificQuantity(
                    value=raw_ir,
                    unit=UnitReference(
                        standard=UnitStandard.UCUM,
                        code="km/mol",
                        dimension=QuantityDimension.INTENSITY,
                    ),
                ).model_dump(mode="json")
            raman_quantity = None
            depol_val = None
            if has_raman and index < len(worker_result["raman_activities_angstrom4_per_amu"]):
                raw_raman = float(worker_result["raman_activities_angstrom4_per_amu"][index])
                raman_quantity = ScientificQuantity(
                    value=raw_raman,
                    unit=UnitReference(
                        standard=UnitStandard.UCUM,
                        code="Angstrom^4/amu",
                        dimension=QuantityDimension.OTHER_DECLARED,
                    ),
                ).model_dump(mode="json")
                if (
                    "depolarization_ratios" in worker_result
                    and worker_result["depolarization_ratios"] is not None
                ):
                    depol_val = float(worker_result["depolarization_ratios"][index])
            modes.append(
                {
                    "index": index,
                    "frequency_cm1": signed_frequency,
                    "imaginary": signed_frequency < 0,
                    "displacement_vectors": worker_result["normal_modes_amu_minus_half"][index],
                    "reduced_mass_amu": float(worker_result["reduced_masses_amu"][index]),
                    "ir_intensity": ir_quantity,
                    "raman_activity": raman_quantity,
                    "depolarization_ratio": depol_val,
                }
            )
        analysis_values = {
            "payload_schema": "chemdft.vibrational-analysis",
            "payload_schema_version": "1.0.0",
            "task_type": "FREQUENCY",
            "calculation_id": calculation.id,
            "input_structure_version_id": structure_version.id,
            "input_structure_hash": structure_artifact.sha256,
            "calculation_specification_hash": specification_hash,
            "engine": "pyscf",
            "engine_version": str(worker_result["engine_version"]),
            "method": str(worker_result["method"]),
            "basis": str(worker_result["basis"]),
            "charge": int(worker_result["charge"]),
            "multiplicity": int(worker_result["multiplicity"]),
            "atom_identities": [atom["element"] for atom in input_document["atoms"]],
            "equilibrium_coordinates_angstrom": coordinates,
            "equilibrium_coordinates_hash": hashlib.sha256(coordinate_payload).hexdigest(),
            "hessian_artifact": hessian_reference.model_dump(mode="json"),
            "hessian_sha256": hessian_artifact_record.sha256,
            "hessian_unit": "Eh/bohr^2",
            "hessian_type": "analytic",
            "dipole_derivative_method": (
                worker_result.get("dipole_derivative_method", "central_finite_difference")
                if has_ir
                else None
            ),
            "finite_difference_step_bohr": (
                worker_result.get("finite_difference_step_bohr", 0.0100) if has_ir else None
            ),
            "intensity_unit": "km/mol" if has_ir else None,
            "raman_method": worker_result.get("raman_method"),
            "polarizability_method": worker_result.get("polarizability_method"),
            "electric_field_step_au": worker_result.get("electric_field_step_au"),
            "polarizability_derivative_method": (
                worker_result.get(
                    "polarizability_derivative_method",
                    "central_normal_coordinate_difference",
                )
                if has_raman
                else None
            ),
            "polarizability_derivative_step_angstrom_amu_half": worker_result.get(
                "polarizability_derivative_step_angstrom_amu_half"
            ),
            "polarizability_unit": worker_result.get("polarizability_unit"),
            "raman_activity_unit": worker_result.get("raman_activity_unit"),
            "polarizability_tensor_symmetrization": worker_result.get(
                "polarizability_tensor_symmetrization"
            ),
            "polarizability_antisymmetry_tolerance": worker_result.get(
                "polarizability_antisymmetry_tolerance"
            ),
            "raman_artifact": raman_reference.model_dump(mode="json")
            if raman_reference
            else None,
            "raman_sha256": raman_artifact_record.sha256 if raman_artifact_record else None,
            "modes": modes,
            "expected_vibrational_mode_count": len(modes),
            "mode_ordering": "ascending_eigenvalue",
            "vector_convention": "pyscf_thermo_norm_mode",
            "vector_unit": "amu^-1/2",
            "coordinate_unit": "angstrom",
            "frequency_unit": "cm^-1",
            "parser_version": str(worker_result["parser_version"]),
            "adapter_version": str(worker_result["adapter_version"]),
            "schema_version": "1.0.0",
        }
        analysis_values["result_sha256"] = vibrational_payload_hash(analysis_values)
        payload = VibrationalAnalysis.model_validate(analysis_values)
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        failure_state = CalculationLifecycle.CANCELED if canceled else CalculationLifecycle.FAILED
        _transition(calculation, failure_state)
        attempt = CalculationAttemptRecord(
            project_id=calculation.project_id,
            calculation_id=calculation.id,
            attempt_number=attempt_number,
            state=failure_state,
            worker_id="local.pyscf",
            engine_identity_json=None,
            started_at=started_at,
            finished_at=utc_now(),
            failure_code=CalculationFailureCode.CANCELED
            if canceled
            else CalculationFailureCode.EXECUTION_TIMEOUT
            if execution.timed_out
            else CalculationFailureCode.RESULT_VALIDATION_FAILED,
            diagnostic=str(error)[:1000],
            raw_artifacts_json=[ref.model_dump(mode="json") for ref in raw_artifacts],
        )
        session.add(attempt)
        session.flush()
        _finish_compute_failure(
            session,
            job,
            compute_execution,
            attempt.id,
            ComputeFailureCode.ARTIFACT_TRANSFER_FAILED,
            str(error)[:1000],
        )
        if canceled:
            job.state = ComputeJobState.CANCELED
            compute_execution.state = "CANCELED"
        _audit(session, identity, calculation.project_id, "calculation.failed", calculation.id)
        session.commit()
        return get_calculation(session, identity, calculation.project_id, calculation.id)

    environment_artifact = _artifact_reference(
        _store_artifact(
            session,
            identity,
            object_store,
            project_id=calculation.project_id,
            kind="ENVIRONMENT_MANIFEST",
            media_type="application/json",
            format_identifier="chemdft.environment_manifest",
            format_version="1.0.0",
            payload=json.dumps(
                worker_result["environment"], sort_keys=True, separators=(",", ":")
            ).encode(),
            source_type="calculation.record",
            source_id=calculation.id,
            max_bytes=settings.scientific_max_output_bytes,
        )
    )
    raw_artifacts.append(environment_artifact)
    engine_identity = EngineReference.model_validate(
        _identity_json(worker_result, environment_artifact)
    )
    session.commit()  # evidence stays retained even if publication is rejected
    _transition(calculation, CalculationLifecycle.SUCCEEDED)
    prov_parameters = [
        {"name": "hessian_unit", "value": "Eh/bohr^2"},
        {"name": "frequency_unit", "value": "cm^-1"},
        {"name": "mode_ordering", "value": "ascending_eigenvalue"},
        {"name": "result_sha256", "value": payload.result_sha256},
    ]
    if has_raman:
        prov_parameters.extend([
            {"name": "raman_method", "value": "placzek_static"},
            {"name": "raman_activity_unit", "value": "angstrom^4/amu"},
        ])
    provenance = ProvenanceRecordRow(
        project_id=calculation.project_id,
        subject_type="calculation.result",
        subject_id=new_id(),
        source_class=ProvenanceClass.CALCULATED,
        detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SERVICE,
        producer_identifier="local.pyscf.worker",
        producer_software_version=str(worker_result["engine_version"]),
        source_artifact_id=input_artifact.id,
        operation="chemdft.calculation.vibrational-analysis",
        operation_version="1.0.0",
        parameters_json=prov_parameters,
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
        worker_id="local.pyscf",
        engine_identity_json=engine_identity.model_dump(mode="json"),
        started_at=started_at,
        finished_at=utc_now(),
        failure_code=None,
        diagnostic=None,
        raw_artifacts_json=[ref.model_dump(mode="json") for ref in raw_artifacts],
    )
    session.add(attempt)
    session.flush()
    compute_execution.calculation_attempt_id = attempt.id
    compute_execution.state = "FINISHED"
    compute_execution.finished_at = utc_now()
    compute_execution.environment_json = worker_result["environment"]
    compute_execution.metering_json = {
        "runtime_ms": int((compute_execution.finished_at - started_at).total_seconds() * 1000),
        "provider_cost_status": "UNKNOWN",
    }
    compute_execution.actual_cost_json = {"currency": "USD", "minor_units": 0}
    compute_execution.raw_artifacts_json = [ref.model_dump(mode="json") for ref in raw_artifacts]
    job.state = ComputeJobState.SUCCEEDED
    job.updated_at = utc_now()
    _release_reservation(session, job.reservation_id, compute_execution.actual_cost_json)
    _finish_active_leases(session, compute_execution.id)
    producer = issue_trusted_producer_context(
        producer_id="local.pyscf.worker",
        producer_type=ProducerType.SCIENTIFIC_WORKER,
        project_id=UUID(calculation.project_id),
        attestation_id=f"execution:{compute_execution.id}:attempt:{attempt_number}",
    )
    try:
        accept_authoritative_result(
            session,
            producer,
            AuthoritativeResultSubmission(
                result_type="chemdft.vibrational-analysis",
                project_id=UUID(calculation.project_id),
                calculation_id=UUID(calculation.id),
                calculation_input_id=UUID(calculation_input.id),
                producer_software=engine_identity,
                payload=payload,
                provenance_record_id=UUID(provenance.id),
                raw_artifacts=tuple(raw_artifacts),
                idempotency_key=f"result:{calculation.id}:vibrational-analysis",
                request_id=uuid4(),
                correlation_id=UUID(provenance.correlation_id),
            ),
            commit=False,
        )
        # Billing commits the open transaction, so it runs only after the result was accepted.
        BillingService(session, identity, settings).record_compute_usage(
            project_id=job.project_id,
            compute_job_id=job.id,
            compute_execution_id=compute_execution.id,
            provider=compute_execution.provider,
            engine="pyscf",
            reserved_minor_units=0,
            actual_minor_units=0,
            billable_minor_units=0,
            idempotency_key=f"compute-execution:{compute_execution.id}",
        )
        session.commit()
    except ScientificValidationFailed as error:
        session.rollback()
        for record in (calculation, job, compute_execution):
            session.refresh(record)
        return _fail_energy_validation(
            session, identity, calculation, job, compute_execution, raw_artifacts,
            "pyscf", attempt_number, started_at, error,
        )
    return get_calculation(session, identity, calculation.project_id, calculation.id)


def _finish_thermochemistry(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    calculation: CalculationRecord,
    calculation_input: CalculationInputRecord,
    input_artifact: ScientificArtifactRecord,
    job: ComputeJobRecord,
    compute_execution: ComputeExecutionRecord,
    execution,
    worker_result: dict | None,
    raw_artifacts: list[ArtifactReference],
    attempt_number: int,
    started_at,
) -> CalculationDetail:
    session.refresh(job)
    canceled = job.state == ComputeJobState.CANCEL_REQUESTED
    try:
        if canceled:
            raise ValueError("Thermochemistry canceled before authoritative result publication")
        if execution.exit_code != 0 or execution.timed_out or worker_result is None:
            raise ValueError("PySCF thermochemistry worker failed before producing a result")
        from .contracts.scientific import ThermochemistryOptions

        options = ThermochemistryOptions.model_validate(
            calculation_input.specification_json["thermochemistry"]
        )
        # Re-run every validity gate at publication time against current persisted records.
        evidence = evaluate_thermochemistry_gates(
            session,
            object_store,
            project_id=calculation.project_id,
            options=options,
            max_artifact_bytes=settings.scientific_max_output_bytes,
        )
        energy_reference = _artifact_reference(evidence.energy_artifact)
        payload = build_thermochemistry_payload(
            worker_result,
            evidence,
            calculation_id=calculation.id,
            calculation_input_hash=input_artifact.sha256,
            energy_artifact_reference=energy_reference.model_dump(mode="json"),
        )
    except (ValueError, TypeError, KeyError, OverflowError, ThermochemistryGateFailed) as error:
        failure_state = CalculationLifecycle.CANCELED if canceled else CalculationLifecycle.FAILED
        _transition(calculation, failure_state)
        attempt = CalculationAttemptRecord(
            project_id=calculation.project_id,
            calculation_id=calculation.id,
            attempt_number=attempt_number,
            state=failure_state,
            worker_id="local.pyscf",
            engine_identity_json=None,
            started_at=started_at,
            finished_at=utc_now(),
            failure_code=CalculationFailureCode.CANCELED
            if canceled
            else CalculationFailureCode.EXECUTION_TIMEOUT
            if execution.timed_out
            else CalculationFailureCode.RESULT_VALIDATION_FAILED,
            diagnostic=str(error)[:1000],
            raw_artifacts_json=[ref.model_dump(mode="json") for ref in raw_artifacts],
        )
        session.add(attempt)
        session.flush()
        _finish_compute_failure(
            session,
            job,
            compute_execution,
            attempt.id,
            ComputeFailureCode.ARTIFACT_TRANSFER_FAILED,
            str(error)[:1000],
        )
        if canceled:
            job.state = ComputeJobState.CANCELED
            compute_execution.state = "CANCELED"
        _audit(session, identity, calculation.project_id, "calculation.failed", calculation.id)
        session.commit()
        return get_calculation(session, identity, calculation.project_id, calculation.id)

    environment_artifact = _artifact_reference(
        _store_artifact(
            session,
            identity,
            object_store,
            project_id=calculation.project_id,
            kind="ENVIRONMENT_MANIFEST",
            media_type="application/json",
            format_identifier="chemdft.environment_manifest",
            format_version="1.0.0",
            payload=json.dumps(
                worker_result["environment"], sort_keys=True, separators=(",", ":")
            ).encode(),
            source_type="calculation.record",
            source_id=calculation.id,
            max_bytes=settings.scientific_max_output_bytes,
        )
    )
    raw_artifacts.append(environment_artifact)
    raw_artifacts.append(energy_reference)
    engine_identity = EngineReference.model_validate(
        _identity_json(worker_result, environment_artifact)
    )
    session.commit()  # evidence stays retained even if publication is rejected
    _transition(calculation, CalculationLifecycle.SUCCEEDED)
    provenance = ProvenanceRecordRow(
        project_id=calculation.project_id,
        subject_type="calculation.result",
        subject_id=new_id(),
        source_class=ProvenanceClass.CALCULATED,
        detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SERVICE,
        producer_identifier="local.pyscf.worker",
        producer_software_version=str(worker_result["engine_version"]),
        source_artifact_id=input_artifact.id,
        operation="chemdft.calculation.thermochemistry",
        operation_version="1.0.0",
        parameters_json=[
            {"name": "thermo_model", "value": "ideal-gas-rrho"},
            {"name": "temperature_k", "value": str(payload.conditions.temperature_k)},
            {"name": "pressure_pa", "value": str(payload.conditions.pressure_pa)},
            {"name": "frequency_result_id", "value": str(payload.frequency_result_id)},
            {"name": "symmetry_number", "value": str(payload.symmetry.rotational_symmetry_number)},
            {"name": "result_sha256", "value": payload.result_sha256},
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
        worker_id="local.pyscf",
        engine_identity_json=engine_identity.model_dump(mode="json"),
        started_at=started_at,
        finished_at=utc_now(),
        failure_code=None,
        diagnostic=None,
        raw_artifacts_json=[ref.model_dump(mode="json") for ref in raw_artifacts],
    )
    session.add(attempt)
    session.flush()
    compute_execution.calculation_attempt_id = attempt.id
    compute_execution.state = "FINISHED"
    compute_execution.finished_at = utc_now()
    compute_execution.environment_json = worker_result["environment"]
    compute_execution.metering_json = {
        "runtime_ms": int((compute_execution.finished_at - started_at).total_seconds() * 1000),
        "provider_cost_status": "UNKNOWN",
    }
    compute_execution.actual_cost_json = {"currency": "USD", "minor_units": 0}
    compute_execution.raw_artifacts_json = [ref.model_dump(mode="json") for ref in raw_artifacts]
    job.state = ComputeJobState.SUCCEEDED
    job.updated_at = utc_now()
    _release_reservation(session, job.reservation_id, compute_execution.actual_cost_json)
    _finish_active_leases(session, compute_execution.id)
    producer = issue_trusted_producer_context(
        producer_id="local.pyscf.worker",
        producer_type=ProducerType.SCIENTIFIC_WORKER,
        project_id=UUID(calculation.project_id),
        attestation_id=f"execution:{compute_execution.id}:attempt:{attempt_number}",
    )
    try:
        accept_authoritative_result(
            session,
            producer,
            AuthoritativeResultSubmission(
                result_type="chemdft.thermochemistry",
                project_id=UUID(calculation.project_id),
                calculation_id=UUID(calculation.id),
                calculation_input_id=UUID(calculation_input.id),
                producer_software=engine_identity,
                payload=payload,
                provenance_record_id=UUID(provenance.id),
                raw_artifacts=tuple(raw_artifacts),
                idempotency_key=f"result:{calculation.id}:thermochemistry",
                request_id=uuid4(),
                correlation_id=UUID(provenance.correlation_id),
            ),
            commit=False,
        )
        # Billing commits the open transaction, so it runs only after the result was accepted.
        BillingService(session, identity, settings).record_compute_usage(
            project_id=job.project_id,
            compute_job_id=job.id,
            compute_execution_id=compute_execution.id,
            provider=compute_execution.provider,
            engine="pyscf",
            reserved_minor_units=0,
            actual_minor_units=0,
            billable_minor_units=0,
            idempotency_key=f"compute-execution:{compute_execution.id}",
        )
        session.commit()
    except ScientificValidationFailed as error:
        session.rollback()
        for record in (calculation, job, compute_execution):
            session.refresh(record)
        return _fail_energy_validation(
            session, identity, calculation, job, compute_execution, raw_artifacts,
            "pyscf", attempt_number, started_at, error,
        )
    return get_calculation(session, identity, calculation.project_id, calculation.id)


def _finish_orbitals(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    calculation: CalculationRecord,
    calculation_input: CalculationInputRecord,
    input_artifact: ScientificArtifactRecord,
    job: ComputeJobRecord,
    compute_execution: ComputeExecutionRecord,
    execution,
    worker_result: dict | None,
    raw_artifacts: list[ArtifactReference],
    attempt_number: int,
    started_at,
) -> CalculationDetail:
    from .scientific.engines.orbitals import (
        molecular_orbital_result_hash,
        validate_molecular_orbital_result_hash,
        validate_orbital_candidate,
    )

    input_document = json.loads(
        object_store.get_bytes(input_artifact.storage_key, settings.scientific_max_output_bytes)
    )
    session.refresh(job)
    canceled = job.state == ComputeJobState.CANCEL_REQUESTED
    try:
        if canceled:
            raise ValueError("Molecular-orbital calculation canceled before publication")
        if execution.exit_code != 0 or execution.timed_out or worker_result is None:
            raise ValueError("PySCF orbital worker did not produce a converged result")
        validated, coefficient_bytes = validate_orbital_candidate(worker_result, input_document)
        coefficient_record = _store_artifact(
            session,
            identity,
            object_store,
            project_id=calculation.project_id,
            kind="MO_COEFFICIENTS",
            media_type="application/vnd.chemdft.numpy-npz",
            format_identifier="chemdft.mo-coefficients.npz",
            format_version="1.0.0",
            payload=coefficient_bytes,
            source_type="calculation.record",
            source_id=calculation.id,
            max_bytes=settings.scientific_max_output_bytes,
        )
        coefficient_reference = _artifact_reference(coefficient_record)
        raw_artifacts.append(coefficient_reference)
        structure_version = session.get(
            StructureVersionRecord, calculation_input.structure_version_id
        )
        if structure_version is None or structure_version.project_id != calculation.project_id:
            raise ValueError("Authoritative input StructureVersion is missing")
        structure_artifact = session.get(
            ScientificArtifactRecord, structure_version.canonical_artifact_id
        )
        if structure_artifact is None:
            raise ValueError("Canonical StructureVersion artifact is missing")
        result_values = {
            "payload_schema": "chemdft.molecular-orbitals",
            "payload_schema_version": "1.0.0",
            "task_type": "ORBITAL",
            "calculation_id": calculation.id,
            "input_structure_id": structure_version.structure_id,
            "input_structure_version_id": structure_version.id,
            "input_structure_hash": structure_artifact.sha256,
            "calculation_input_hash": input_artifact.sha256,
            "engine": "pyscf",
            "engine_version": str(worker_result["engine_version"]),
            "method": str(worker_result["method"]),
            "basis": str(worker_result["basis"]),
            "charge": int(worker_result["charge"]),
            "multiplicity": int(worker_result["multiplicity"]),
            "converged": True,
            "total_energy_hartree": validated["total_energy_hartree"],
            "scf_iterations": worker_result.get("scf_iterations"),
            "electron_count": validated["electron_count"],
            "alpha_electron_count": validated["alpha_electron_count"],
            "beta_electron_count": validated["beta_electron_count"],
            "basis_function_count": validated["basis_function_count"],
            "molecular_orbital_count": validated["molecular_orbital_count"],
            "orbitals": validated["orbitals"],
            "frontier_by_spin": validated["frontier_by_spin"],
            "coefficient_artifact": coefficient_reference.model_dump(mode="json"),
            "coefficient_artifact_sha256": coefficient_record.sha256,
            "coefficient_format": "chemdft.mo-coefficients.npz",
            "producer": "local.pyscf.worker",
            "adapter_version": "1.0.0",
            "schema_version": "1.0.0",
        }
        result_values["result_sha256"] = "0" * 64
        payload = MolecularOrbitalAnalysis.model_validate(result_values)
        canonical_values = payload.model_dump(mode="json", exclude={"result_sha256"})
        payload = payload.model_copy(
            update={"result_sha256": molecular_orbital_result_hash(canonical_values)}
        )
        validate_molecular_orbital_result_hash(payload)
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        failure_state = CalculationLifecycle.CANCELED if canceled else CalculationLifecycle.FAILED
        _transition(calculation, failure_state)
        attempt = CalculationAttemptRecord(
            project_id=calculation.project_id,
            calculation_id=calculation.id,
            attempt_number=attempt_number,
            state=failure_state,
            worker_id="local.pyscf",
            engine_identity_json=None,
            started_at=started_at,
            finished_at=utc_now(),
            failure_code=CalculationFailureCode.CANCELED
            if canceled
            else CalculationFailureCode.NONCONVERGED
            if worker_result and worker_result.get("converged") is False
            else CalculationFailureCode.EXECUTION_TIMEOUT
            if execution.timed_out
            else CalculationFailureCode.RESULT_VALIDATION_FAILED,
            diagnostic=str(error)[:1000],
            raw_artifacts_json=[ref.model_dump(mode="json") for ref in raw_artifacts],
        )
        session.add(attempt)
        session.flush()
        _finish_compute_failure(
            session,
            job,
            compute_execution,
            attempt.id,
            ComputeFailureCode.PROVIDER_TIMEOUT
            if execution.timed_out
            else ComputeFailureCode.SUBMISSION_FAILED,
            str(error)[:1000],
        )
        if canceled:
            job.state = ComputeJobState.CANCELED
            compute_execution.state = "CANCELED"
        _audit(session, identity, calculation.project_id, "calculation.failed", calculation.id)
        session.commit()
        return get_calculation(session, identity, calculation.project_id, calculation.id)

    environment_artifact = _artifact_reference(
        _store_artifact(
            session,
            identity,
            object_store,
            project_id=calculation.project_id,
            kind="ENVIRONMENT_MANIFEST",
            media_type="application/json",
            format_identifier="chemdft.environment_manifest",
            format_version="1.0.0",
            payload=json.dumps(
                worker_result["environment"], sort_keys=True, separators=(",", ":")
            ).encode(),
            source_type="calculation.record",
            source_id=calculation.id,
            max_bytes=settings.scientific_max_output_bytes,
        )
    )
    raw_artifacts.append(environment_artifact)
    engine_identity = EngineReference.model_validate(
        _identity_json(worker_result, environment_artifact)
    )
    session.commit()  # evidence stays retained even if publication is rejected
    _transition(calculation, CalculationLifecycle.SUCCEEDED)
    provenance = ProvenanceRecordRow(
        project_id=calculation.project_id,
        subject_type="calculation.result",
        subject_id=new_id(),
        source_class=ProvenanceClass.CALCULATED,
        detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SERVICE,
        producer_identifier="local.pyscf.worker",
        producer_software_version=str(worker_result["engine_version"]),
        source_artifact_id=input_artifact.id,
        operation="chemdft.calculation.molecular-orbitals",
        operation_version="1.0.0",
        parameters_json=[
            {"name": "structure_version_id", "value": calculation_input.structure_version_id},
            {"name": "coefficient_artifact_sha256", "value": coefficient_record.sha256},
            {
                "name": "orbital_energy_gap_semantics",
                "value": "orbital-energy difference; not excitation energy",
            },
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
        worker_id="local.pyscf",
        engine_identity_json=engine_identity.model_dump(mode="json"),
        started_at=started_at,
        finished_at=utc_now(),
        failure_code=None,
        diagnostic=None,
        raw_artifacts_json=[ref.model_dump(mode="json") for ref in raw_artifacts],
    )
    session.add(attempt)
    session.flush()
    compute_execution.calculation_attempt_id = attempt.id
    compute_execution.state = "FINISHED"
    compute_execution.finished_at = utc_now()
    compute_execution.environment_json = worker_result["environment"]
    compute_execution.metering_json = {
        "runtime_ms": int((compute_execution.finished_at - started_at).total_seconds() * 1000),
        "provider_cost_status": "UNKNOWN",
    }
    compute_execution.actual_cost_json = {"currency": "USD", "minor_units": 0}
    compute_execution.raw_artifacts_json = [ref.model_dump(mode="json") for ref in raw_artifacts]
    job.state = ComputeJobState.SUCCEEDED
    job.updated_at = utc_now()
    _release_reservation(session, job.reservation_id, compute_execution.actual_cost_json)
    _finish_active_leases(session, compute_execution.id)
    producer = issue_trusted_producer_context(
        producer_id="local.pyscf.worker",
        producer_type=ProducerType.SCIENTIFIC_WORKER,
        project_id=UUID(calculation.project_id),
        attestation_id=f"execution:{compute_execution.id}:attempt:{attempt_number}",
    )
    try:
        accept_authoritative_result(
            session,
            producer,
            AuthoritativeResultSubmission(
                result_type="chemdft.molecular-orbitals",
                project_id=UUID(calculation.project_id),
                calculation_id=UUID(calculation.id),
                calculation_input_id=UUID(calculation_input.id),
                producer_software=engine_identity,
                payload=payload,
                provenance_record_id=UUID(provenance.id),
                raw_artifacts=tuple(raw_artifacts),
                idempotency_key=f"result:{calculation.id}:molecular-orbitals",
                request_id=uuid4(),
                correlation_id=UUID(provenance.correlation_id),
            ),
            commit=False,
        )
        # Billing commits the open transaction, so it runs only after the result was accepted.
        BillingService(session, identity, settings).record_compute_usage(
            project_id=job.project_id,
            compute_job_id=job.id,
            compute_execution_id=compute_execution.id,
            provider=compute_execution.provider,
            engine="pyscf",
            reserved_minor_units=0,
            actual_minor_units=0,
            billable_minor_units=0,
            idempotency_key=f"compute-execution:{compute_execution.id}",
        )
        session.commit()
    except ScientificValidationFailed as error:
        session.rollback()
        for record in (calculation, job, compute_execution):
            session.refresh(record)
        return _fail_energy_validation(
            session, identity, calculation, job, compute_execution, raw_artifacts,
            "pyscf", attempt_number, started_at, error,
        )
    return get_calculation(session, identity, calculation.project_id, calculation.id)


def _finish_tddft(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    calculation: CalculationRecord,
    calculation_input: CalculationInputRecord,
    input_artifact: ScientificArtifactRecord,
    job: ComputeJobRecord,
    compute_execution: ComputeExecutionRecord,
    execution,
    worker_result: dict | None,
    raw_artifacts: list[ArtifactReference],
    attempt_number: int,
    started_at,
) -> CalculationDetail:
    from .scientific.engines.tddft import (
        tddft_result_hash,
        validate_tddft_candidate,
        validate_tddft_result_hash,
    )

    input_document = json.loads(
        object_store.get_bytes(input_artifact.storage_key, settings.scientific_max_output_bytes)
    )
    session.refresh(job)
    canceled = job.state == ComputeJobState.CANCEL_REQUESTED
    try:
        if canceled:
            raise ValueError("TDDFT calculation canceled before publication")
        if execution.exit_code != 0 or execution.timed_out or worker_result is None:
            raise ValueError(_tddft_unconverged_message(worker_result, input_document))
        validated, amplitudes_bytes = validate_tddft_candidate(worker_result, input_document)
        amplitudes_record = _store_artifact(
            session,
            identity,
            object_store,
            project_id=calculation.project_id,
            kind="TDDFT_AMPLITUDES",
            media_type="application/vnd.chemdft.numpy-npz",
            format_identifier="chemdft.tddft-amplitudes.npz",
            format_version="1.0.0",
            payload=amplitudes_bytes,
            source_type="calculation.record",
            source_id=calculation.id,
            max_bytes=settings.scientific_max_output_bytes,
        )
        amplitudes_reference = _artifact_reference(amplitudes_record)
        raw_artifacts.append(amplitudes_reference)
        structure_version = session.get(
            StructureVersionRecord, calculation_input.structure_version_id
        )
        if structure_version is None or structure_version.project_id != calculation.project_id:
            raise ValueError("Authoritative input StructureVersion is missing")
        structure_artifact = session.get(
            ScientificArtifactRecord, structure_version.canonical_artifact_id
        )
        if structure_artifact is None:
            raise ValueError("Canonical StructureVersion artifact is missing")

        result_values = {
            **validated,
            "calculation_id": calculation.id,
            "input_structure_id": structure_version.structure_id,
            "input_structure_version_id": structure_version.id,
            "input_structure_hash": structure_artifact.sha256,
            "calculation_input_hash": input_artifact.sha256,
            "amplitudes_artifact": amplitudes_reference.model_dump(mode="json"),
            "amplitudes_artifact_sha256": amplitudes_record.sha256,
            "amplitudes_format": "chemdft.tddft-amplitudes.npz",
            "result_sha256": "0" * 64,
        }
        payload = TddftResult.model_validate(result_values)
        canonical_values = payload.model_dump(mode="json", exclude={"result_sha256"})
        payload = payload.model_copy(
            update={"result_sha256": tddft_result_hash(canonical_values)}
        )
        validate_tddft_result_hash(payload)
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        failure_state = CalculationLifecycle.CANCELED if canceled else CalculationLifecycle.FAILED
        _transition(calculation, failure_state)
        attempt = CalculationAttemptRecord(
            project_id=calculation.project_id,
            calculation_id=calculation.id,
            attempt_number=attempt_number,
            state=failure_state,
            worker_id="local.pyscf",
            engine_identity_json=None,
            started_at=started_at,
            finished_at=utc_now(),
            failure_code=CalculationFailureCode.CANCELED
            if canceled
            else CalculationFailureCode.NONCONVERGED
            if worker_result and worker_result.get("converged") is False
            else CalculationFailureCode.EXECUTION_TIMEOUT
            if execution.timed_out
            else CalculationFailureCode.RESULT_VALIDATION_FAILED,
            diagnostic=str(error)[:1000],
            raw_artifacts_json=[ref.model_dump(mode="json") for ref in raw_artifacts],
        )
        session.add(attempt)
        session.flush()
        _finish_compute_failure(
            session,
            job,
            compute_execution,
            attempt.id,
            ComputeFailureCode.PROVIDER_TIMEOUT
            if execution.timed_out
            else ComputeFailureCode.SUBMISSION_FAILED,
            str(error)[:1000],
        )
        # Terminal after one attempt: commit the failure here. Raising before the commit rolled the
        # failure back, left the job RUNNING and let the lease sweep re-queue it (job 07f65abe).
        _audit(session, identity, calculation.project_id, "calculation.failed", calculation.id)
        session.commit()
        return get_calculation(session, identity, calculation.project_id, calculation.id)

    environment_artifact = _artifact_reference(
        _store_artifact(
            session,
            identity,
            object_store,
            project_id=calculation.project_id,
            kind="ENVIRONMENT_MANIFEST",
            media_type="application/json",
            format_identifier="chemdft.environment_manifest",
            format_version="1.0.0",
            payload=json.dumps(
                worker_result["environment"], sort_keys=True, separators=(",", ":")
            ).encode(),
            source_type="calculation.record",
            source_id=calculation.id,
            max_bytes=settings.scientific_max_output_bytes,
        )
    )
    raw_artifacts.append(environment_artifact)
    engine_identity = EngineReference.model_validate(
        _identity_json(worker_result, environment_artifact)
    )
    session.commit()  # evidence stays retained even if publication is rejected
    _transition(calculation, CalculationLifecycle.SUCCEEDED)
    provenance = ProvenanceRecordRow(
        project_id=calculation.project_id,
        subject_type="calculation.result",
        subject_id=new_id(),
        source_class=ProvenanceClass.CALCULATED,
        detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SERVICE,
        producer_identifier="local.pyscf.worker",
        producer_software_version=str(worker_result["engine_version"]),
        source_artifact_id=input_artifact.id,
        operation="chemdft.calculation.tddft",
        operation_version="1.0.0",
        parameters_json=[
            {"name": "method", "value": str(worker_result["method"])},
            {"name": "basis", "value": str(worker_result["basis"])},
            {"name": "charge", "value": int(worker_result["charge"])},
            {"name": "multiplicity", "value": int(worker_result["multiplicity"])},
            {"name": "requested_roots", "value": len(payload.excited_states)},
            {"name": "response_method", "value": "TDDFT"},
            {"name": "reference_method", "value": "RKS"},
            {"name": "oscillator_strength_gauge", "value": "length"},
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
        worker_id="local.pyscf",
        engine_identity_json=engine_identity.model_dump(mode="json"),
        started_at=started_at,
        finished_at=utc_now(),
        failure_code=None,
        diagnostic=None,
        raw_artifacts_json=[ref.model_dump(mode="json") for ref in raw_artifacts],
    )
    session.add(attempt)
    session.flush()
    compute_execution.calculation_attempt_id = attempt.id
    compute_execution.state = "FINISHED"
    compute_execution.finished_at = utc_now()
    compute_execution.environment_json = worker_result["environment"]
    compute_execution.metering_json = {
        "runtime_ms": int((compute_execution.finished_at - started_at).total_seconds() * 1000),
        "provider_cost_status": "UNKNOWN",
    }
    compute_execution.actual_cost_json = {"currency": "USD", "minor_units": 0}
    compute_execution.raw_artifacts_json = [ref.model_dump(mode="json") for ref in raw_artifacts]
    job.state = ComputeJobState.SUCCEEDED
    job.updated_at = utc_now()
    _release_reservation(session, job.reservation_id, compute_execution.actual_cost_json)
    _finish_active_leases(session, compute_execution.id)
    producer = issue_trusted_producer_context(
        producer_id="local.pyscf.worker",
        producer_type=ProducerType.SCIENTIFIC_WORKER,
        project_id=UUID(calculation.project_id),
        attestation_id=f"execution:{compute_execution.id}:attempt:{attempt_number}",
    )
    try:
        accept_authoritative_result(
            session,
            producer,
            AuthoritativeResultSubmission(
                result_type="chemdft.tddft",
                project_id=UUID(calculation.project_id),
                calculation_id=UUID(calculation.id),
                calculation_input_id=UUID(calculation_input.id),
                producer_software=engine_identity,
                payload=payload,
                provenance_record_id=UUID(provenance.id),
                raw_artifacts=tuple(raw_artifacts),
                idempotency_key=f"result:{calculation.id}:tddft",
                request_id=uuid4(),
                correlation_id=UUID(provenance.correlation_id),
            ),
            commit=False,
        )
        # Billing commits the open transaction, so it runs only after the result was accepted.
        BillingService(session, identity, settings).record_compute_usage(
            project_id=job.project_id,
            compute_job_id=job.id,
            compute_execution_id=compute_execution.id,
            provider=compute_execution.provider,
            engine="pyscf",
            reserved_minor_units=0,
            actual_minor_units=0,
            billable_minor_units=0,
            idempotency_key=f"compute-execution:{compute_execution.id}",
        )
        session.commit()
    except ScientificValidationFailed as error:
        session.rollback()
        for record in (calculation, job, compute_execution):
            session.refresh(record)
        return _fail_energy_validation(
            session, identity, calculation, job, compute_execution, raw_artifacts,
            "pyscf", attempt_number, started_at, error,
        )
    return get_calculation(session, identity, calculation.project_id, calculation.id)


def _finish_optimization(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    calculation: CalculationRecord,
    calculation_input: CalculationInputRecord,
    input_artifact: ScientificArtifactRecord,
    job: ComputeJobRecord,
    compute_execution: ComputeExecutionRecord,
    trajectory: OptimizationTrajectoryRecord,
    execution,
    worker_result: dict | None,
    raw_artifacts: list[ArtifactReference],
    attempt_number: int,
    started_at,
    observed_error: str | None,
    canceled: bool,
) -> CalculationDetail:
    from .contracts.scientific import (
        QuantityDimension,
        ScientificQuantity,
        StructureKind,
        StructureVersionOrigin,
        UnitReference,
        UnitStandard,
    )
    from .scientific.engines.optimization import validate_result
    from .scientific.structures import (
        CanonicalStructureCandidate,
        StructureSourceFormat,
        canonical_document,
    )
    from .scientific_actions import _audit_structure_event, _persist_canonical_artifact

    engine = calculation_input.specification_json["engine_preference"]["engine"]
    producer_id = f"local.{engine}.worker"
    error = observed_error
    validated_steps: list[dict] = []
    if worker_result is not None and error is None:
        try:
            validated_steps = validate_result(
                worker_result,
                trajectory.atom_identities_json,
                trajectory.steps_json,
                calculation_input.specification_json,
                json.loads(
                    object_store.get_bytes(
                        input_artifact.storage_key, settings.scientific_max_output_bytes
                    )
                ),
                execution.native_artifacts,
            )
        except (ValueError, TypeError, KeyError) as exc:
            error = str(exc)
    if worker_result is None and error is None:
        error = "Scientific worker exited without a complete optimization result."
    converged = bool(
        worker_result
        and worker_result.get("converged") is True
        and not error
        and execution.exit_code == 0
        and not canceled
        and not execution.timed_out
    )
    if trajectory.steps_json and worker_result is not None and not error:
        trajectory.steps_json = [
            *trajectory.steps_json[:-1],
            {**trajectory.steps_json[-1], "converged": converged},
        ]
    trajectory.state = (
        "CANCELED"
        if canceled
        else "CONVERGED"
        if converged
        else "NOT_CONVERGED"
        if not execution.timed_out
        and worker_result
        and worker_result.get("converged") is False
        and not error
        else "FAILED"
    )
    if trajectory.steps_json:
        artifact_document = {
            "schema": "chemdft.optimization_trajectory",
            "schema_version": "1.0.0",
            "calculation_id": calculation.id,
            "input_structure_version_id": calculation_input.structure_version_id,
            "input_hash": input_artifact.sha256,
            "atom_identities": trajectory.atom_identities_json,
            "coordinate_unit": "angstrom",
            "energy_unit": "Eh",
            "gradient_unit": "Eh/bohr",
            "steps": trajectory.steps_json,
            "state": trajectory.state,
            "engine": {
                key: worker_result[key]
                for key in (
                    "engine",
                    "engine_version",
                    "optimizer",
                    "optimizer_version",
                    "method",
                    "basis",
                )
            }
            if worker_result and not error
            else None,
        }
        trajectory_artifact = _store_artifact(
            session,
            identity,
            object_store,
            project_id=calculation.project_id,
            kind="OPTIMIZATION_TRAJECTORY",
            media_type="application/json",
            format_identifier="chemdft.optimization_trajectory",
            format_version="1.0.0",
            payload=json.dumps(
                artifact_document, sort_keys=True, separators=(",", ":"), allow_nan=False
            ).encode(),
            source_type="calculation.record",
            source_id=calculation.id,
            max_bytes=settings.scientific_max_output_bytes,
        )
        trajectory.artifact_id = trajectory_artifact.id
        trajectory.artifact_sha256 = trajectory_artifact.sha256
        raw_artifacts.append(_artifact_reference(trajectory_artifact))
    else:
        trajectory_artifact = None

    if not converged:
        target = CalculationLifecycle.CANCELED if canceled else CalculationLifecycle.FAILED
        _transition(calculation, target)
        diagnostic = (
            "Optimization canceled."
            if canceled
            else "Optimization exceeded the server-enforced timeout."
            if execution.timed_out
            else error
            or "Optimizer did not satisfy its convergence criteria within the maximum steps."
        )
        attempt = CalculationAttemptRecord(
            project_id=calculation.project_id,
            calculation_id=calculation.id,
            attempt_number=attempt_number,
            state=target,
            worker_id=f"local.{engine}",
            engine_identity_json=None,
            started_at=started_at,
            finished_at=utc_now(),
            failure_code=CalculationFailureCode.CANCELED
            if canceled
            else CalculationFailureCode.EXECUTION_TIMEOUT
            if execution.timed_out
            else CalculationFailureCode.ENGINE_CRASHED
            if execution.exit_code not in (0, 3)
            else CalculationFailureCode.RESULT_VALIDATION_FAILED
            if error
            else CalculationFailureCode.NONCONVERGED,
            diagnostic=diagnostic[:1000],
            raw_artifacts_json=[ref.model_dump(mode="json") for ref in raw_artifacts],
        )
        session.add(attempt)
        session.flush()
        _finish_compute_failure(
            session,
            job,
            compute_execution,
            attempt.id,
            ComputeFailureCode.PROVIDER_TIMEOUT
            if execution.timed_out
            else ComputeFailureCode.ARTIFACT_TRANSFER_FAILED
            if error
            else ComputeFailureCode.SUBMISSION_FAILED,
            diagnostic,
        )
        if canceled:
            job.state = ComputeJobState.CANCELED
            compute_execution.state = "CANCELED"
        _audit(session, identity, calculation.project_id, "calculation.failed", calculation.id)
        session.commit()
        return get_calculation(session, identity, calculation.project_id, calculation.id)

    assert worker_result is not None and trajectory_artifact is not None and validated_steps
    environment_artifact = _artifact_reference(
        _store_artifact(
            session,
            identity,
            object_store,
            project_id=calculation.project_id,
            kind="ENVIRONMENT_MANIFEST",
            media_type="application/json",
            format_identifier="chemdft.environment_manifest",
            format_version="1.0.0",
            payload=json.dumps(
                worker_result["environment"], sort_keys=True, separators=(",", ":")
            ).encode(),
            source_type="calculation.record",
            source_id=calculation.id,
            max_bytes=settings.scientific_max_output_bytes,
        )
    )
    raw_artifacts.append(environment_artifact)
    engine_identity = EngineReference.model_validate(
        _identity_json(worker_result, environment_artifact)
    )
    trajectory.engine_json = engine_identity.model_dump(mode="json")
    # Native evidence (trajectory and environment artifacts) is made durable before anything is
    # proposed for publication, so a Firewall rejection still leaves it on the failed attempt.
    session.commit()
    if not _execution_still_owned(session, job, compute_execution):
        # A newer state (lease recovery, cancellation finalization) owns this calculation: this
        # worker is stale and must neither publish nor overwrite it.
        session.rollback()
        return get_calculation(session, identity, calculation.project_id, calculation.id)
    if job.state != ComputeJobState.RUNNING:
        session.rollback()
        for record in (calculation, job, compute_execution, trajectory):
            session.refresh(record)
        return _fail_optimization_publication(
            session, identity, calculation, job, compute_execution, trajectory, raw_artifacts,
            engine, attempt_number, started_at, "Optimization canceled before publication.",
            canceled=True,
        )

    input_version = session.get(StructureVersionRecord, calculation_input.structure_version_id)
    structure = session.get(StructureRecord, input_version.structure_id) if input_version else None
    if input_version is None or structure is None:
        raise ScientificReferenceNotFound("Optimization source StructureVersion disappeared.")
    final_coordinates = validated_steps[-1]["coordinates_angstrom"]
    coordinate_document = dict(input_version.representation_json["coordinates"])
    coordinate_document["unit"] = "angstrom"
    coordinate_document["coordinate_system"] = "CARTESIAN"
    coordinate_document["atoms"] = [
        {**atom, "x": xyz[0], "y": xyz[1], "z": xyz[2]}
        for atom, xyz in zip(trajectory.atom_identities_json, final_coordinates, strict=True)
    ]
    candidate = CanonicalStructureCandidate(
        name=structure.name,
        kind=StructureKind(structure.kind),
        coordinates=coordinate_document,
        overall_charge=calculation_input.specification_json["charge"],
        multiplicity=calculation_input.specification_json["multiplicity"],
        source_format=StructureSourceFormat.XYZ,
        parser_name="xtb.ancopt" if engine == "xtb" else "pyscf.geometric_solver",
        parser_version=str(worker_result["engine_version"]),
        adapter_name="chemdft.optimization",
        adapter_version=ADAPTER_VERSION,
    )
    canonical = canonical_document(candidate)
    canonical_artifact = _persist_canonical_artifact(
        session,
        identity,
        object_store,
        project_id=calculation.project_id,
        document=canonical,
        source_artifact_id=trajectory_artifact.id,
    )
    version_id = new_id()
    result_provenance = ProvenanceRecordRow(
        project_id=calculation.project_id,
        subject_type="calculation.result",
        subject_id=new_id(),
        source_class=ProvenanceClass.CALCULATED,
        detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SERVICE,
        producer_identifier=producer_id,
        producer_software_version=str(worker_result["engine_version"]),
        source_artifact_id=trajectory_artifact.id,
        operation="chemdft.calculation.optimization",
        operation_version=ADAPTER_VERSION,
        parameters_json=[
            {"key": "calculation_id", "value": calculation.id},
            {"key": "trajectory_id", "value": trajectory.id},
            {
                "key": "method",
                "value": calculation_input.specification_json["method"]["identifier"],
            },
            {
                "key": "basis",
                "value": (
                    calculation_input.specification_json["basis"]["identifier"]
                    if calculation_input.specification_json.get("basis")
                    else "built-in"
                ),
            },
            {"key": "optimizer", "value": worker_result["optimizer"]},
            {"key": "optimizer_version", "value": worker_result["optimizer_version"]},
        ],
        approximate=False,
        supersedes_id=None,
        correlation_id=new_id(),
    )
    version_provenance = ProvenanceRecordRow(
        project_id=calculation.project_id,
        subject_type="structure.version",
        subject_id=version_id,
        source_class=ProvenanceClass.CALCULATED,
        detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SERVICE,
        producer_identifier=producer_id,
        producer_software_version=str(worker_result["engine_version"]),
        source_artifact_id=trajectory_artifact.id,
        operation="chemdft.structure.optimized",
        operation_version=ADAPTER_VERSION,
        parameters_json=[
            {"key": "calculation_id", "value": calculation.id},
            {"key": "trajectory_id", "value": trajectory.id},
            {"key": "final_step_index", "value": str(validated_steps[-1]["index"])},
            {
                "key": "parser",
                "value": "xtb.ancopt" if engine == "xtb" else "pyscf.geometric_solver",
            },
            {"key": "parser_version", "value": str(worker_result["engine_version"])},
            {"key": "adapter", "value": "chemdft.optimization"},
            {"key": "adapter_version", "value": ADAPTER_VERSION},
        ],
        approximate=False,
        supersedes_id=None,
        correlation_id=result_provenance.correlation_id,
    )
    session.add_all([result_provenance, version_provenance])
    session.flush()
    for provenance in (result_provenance, version_provenance):
        session.add_all(
            [
                ProvenanceInputRow(
                    provenance_record_id=provenance.id,
                    project_id=calculation.project_id,
                    position=0,
                    input_type="ENTITY",
                    input_id=input_version.id,
                    input_sha256=session.get(
                        ScientificArtifactRecord, input_version.canonical_artifact_id
                    ).sha256,
                ),
                ProvenanceInputRow(
                    provenance_record_id=provenance.id,
                    project_id=calculation.project_id,
                    position=1,
                    input_type="ENTITY",
                    input_id=calculation.id,
                    input_sha256=input_artifact.sha256,
                ),
                ProvenanceInputRow(
                    provenance_record_id=provenance.id,
                    project_id=calculation.project_id,
                    position=2,
                    input_type="ARTIFACT",
                    input_id=trajectory_artifact.id,
                    input_sha256=trajectory_artifact.sha256,
                ),
            ]
        )
    # An UPDATE takes a row/write lock on PostgreSQL/SQLite before allocating a revision.
    session.execute(
        update(StructureRecord)
        .where(StructureRecord.id == structure.id)
        .values(updated_at=StructureRecord.updated_at)
    )
    revision = (
        session.scalar(
            select(func.max(StructureVersionRecord.revision)).where(
                StructureVersionRecord.structure_id == structure.id
            )
        )
        or 0
    ) + 1
    version = StructureVersionRecord(
        id=version_id,
        project_id=calculation.project_id,
        structure_id=structure.id,
        revision=revision,
        origin=StructureVersionOrigin.OPTIMIZED,
        parent_version_id=input_version.id,
        canonical_artifact_id=canonical_artifact.id,
        source_artifact_id=trajectory_artifact.id,
        coordinate_system="CARTESIAN",
        coordinate_unit="angstrom",
        atom_count=len(final_coordinates),
        bond_count=len(coordinate_document.get("bonds", [])),
        overall_charge=candidate.overall_charge,
        multiplicity=candidate.multiplicity,
        representation_json={
            "source_artifact": _artifact_reference(trajectory_artifact).model_dump(mode="json"),
            "canonical_artifact": _artifact_reference(canonical_artifact).model_dump(mode="json"),
            "coordinates": coordinate_document,
        },
        periodic_cell_json=None,
        diagnostics_json=[],
        provenance_record_id=version_provenance.id,
        idempotency_key=f"optimization:{calculation.id}",
        created_by=identity.user_id,
    )
    session.add(version)
    trajectory.final_structure_version_id = version.id
    attempt = CalculationAttemptRecord(
        project_id=calculation.project_id,
        calculation_id=calculation.id,
        attempt_number=attempt_number,
        state=CalculationLifecycle.SUCCEEDED,
        worker_id=f"local.{engine}",
        engine_identity_json=engine_identity.model_dump(mode="json"),
        started_at=started_at,
        finished_at=utc_now(),
        failure_code=None,
        diagnostic=None,
        raw_artifacts_json=[ref.model_dump(mode="json") for ref in raw_artifacts],
    )
    session.add(attempt)
    session.flush()
    _transition(calculation, CalculationLifecycle.SUCCEEDED)
    job.state = ComputeJobState.SUCCEEDED
    job.updated_at = utc_now()
    compute_execution.calculation_attempt_id = attempt.id
    compute_execution.state = "FINISHED"
    compute_execution.finished_at = utc_now()
    compute_execution.environment_json = worker_result["environment"]
    compute_execution.metering_json = {
        "runtime_ms": int((compute_execution.finished_at - started_at).total_seconds() * 1000),
        "cpu_ms": None,
        "gpu_ms": None,
        "provider_cost": None,
        "provider_cost_status": "UNKNOWN",
    }
    compute_execution.actual_cost_json = {"currency": "USD", "minor_units": 0}
    compute_execution.raw_artifacts_json = [ref.model_dump(mode="json") for ref in raw_artifacts]
    _release_reservation(session, job.reservation_id, compute_execution.actual_cost_json)
    _finish_active_leases(session, compute_execution.id)
    _audit_structure_event(
        session,
        identity,
        project_id=calculation.project_id,
        event_name="structure.version.created",
        structure_id=structure.id,
        version_id=version.id,
        artifacts=[
            _artifact_reference(trajectory_artifact),
            _artifact_reference(canonical_artifact),
        ],
    )
    session.flush()
    producer = issue_trusted_producer_context(
        producer_id=producer_id,
        producer_type=ProducerType.SCIENTIFIC_WORKER,
        project_id=UUID(calculation.project_id),
        attestation_id=f"execution:{compute_execution.id}:attempt:{attempt_number}",
    )
    try:
        accept_authoritative_result(
            session,
            producer,
            AuthoritativeResultSubmission(
                result_type="chemdft.optimization",
                project_id=UUID(calculation.project_id),
                calculation_id=UUID(calculation.id),
                calculation_input_id=UUID(calculation_input.id),
                producer_software=engine_identity,
                payload=OptimizationResult(
                    trajectory_artifact=_artifact_reference(trajectory_artifact),
                    trajectory_sha256=trajectory_artifact.sha256,
                    final_structure_version_id=UUID(version.id),
                    final_structure_hash=canonical_artifact.sha256,
                    final_energy=ScientificQuantity(
                        value=validated_steps[-1]["energy_hartree"],
                        unit=UnitReference(
                            standard=UnitStandard.QCSCHEMA,
                            code="Eh",
                            dimension=QuantityDimension.ENERGY,
                        ),
                    ),
                    step_count=len(validated_steps),
                    method=str(worker_result["method"]),
                    basis=worker_result["basis"],
                    optimization_iterations=worker_result.get("optimization_iterations"),
                    parser_version=PARSER_VERSION,
                    validator_version="1.0.0",
                ),
                provenance_record_id=UUID(result_provenance.id),
                raw_artifacts=tuple(raw_artifacts),
                idempotency_key=f"result:{calculation.id}:optimization",
                request_id=uuid4(),
                correlation_id=UUID(result_provenance.correlation_id),
            ),
        )
    except ScientificValidationFailed as error:
        # The publisher rolled back the proposed SUCCEEDED state, optimized StructureVersion and
        # provenance and committed only its rejection audit: finalize the calculation as FAILED.
        session.rollback()
        for record in (calculation, job, compute_execution, trajectory):
            session.refresh(record)
        return _fail_optimization_publication(
            session, identity, calculation, job, compute_execution, trajectory, raw_artifacts,
            engine, attempt_number, started_at, str(error),
        )
    return get_calculation(session, identity, calculation.project_id, calculation.id)

def _execution_still_owned(
    session: Session, job: ComputeJobRecord, compute_execution: ComputeExecutionRecord
) -> bool:
    """Take the live lease's write lock for this transaction; False when it was lost."""
    held = session.execute(
        update(ComputeLeaseRecord)
        .where(
            ComputeLeaseRecord.execution_id == compute_execution.id,
            ComputeLeaseRecord.state == "ACTIVE",
            ComputeLeaseRecord.expires_at > utc_now(),
            ComputeLeaseRecord.heartbeat_deadline_at > utc_now(),
        )
        .values(expires_at=ComputeLeaseRecord.expires_at)
        .execution_options(synchronize_session=False)
    ).rowcount
    session.refresh(job)
    return bool(held) and job.state in {ComputeJobState.RUNNING, ComputeJobState.CANCEL_REQUESTED}


def _fail_optimization_publication(
    session, identity, calculation, job, compute_execution, trajectory, raw_artifacts,
    engine, attempt_number, started_at, error, *, canceled=False,
) -> CalculationDetail:
    """Terminal bookkeeping for a converged optimization whose publication was not accepted."""
    target = CalculationLifecycle.CANCELED if canceled else CalculationLifecycle.FAILED
    trajectory.state = "CANCELED" if canceled else "FAILED"
    trajectory.final_structure_version_id = None
    if trajectory.steps_json:
        trajectory.steps_json = [
            *trajectory.steps_json[:-1],
            {**trajectory.steps_json[-1], "converged": False},
        ]
    references = [ref.model_dump(mode="json") for ref in raw_artifacts]
    _transition(calculation, target)
    attempt = CalculationAttemptRecord(
        project_id=calculation.project_id,
        calculation_id=calculation.id,
        attempt_number=attempt_number,
        state=target,
        worker_id=f"local.{engine}",
        engine_identity_json=None,
        started_at=started_at,
        finished_at=utc_now(),
        failure_code=CalculationFailureCode.CANCELED
        if canceled
        else CalculationFailureCode.RESULT_VALIDATION_FAILED,
        diagnostic=str(error)[:1000],
        raw_artifacts_json=references,
    )
    session.add(attempt)
    session.flush()
    _finish_compute_failure(
        session,
        job,
        compute_execution,
        attempt.id,
        ComputeFailureCode.SUBMISSION_FAILED
        if canceled
        else ComputeFailureCode.ARTIFACT_TRANSFER_FAILED,
        str(error)[:1000],
    )
    compute_execution.raw_artifacts_json = references
    if canceled:
        job.state = ComputeJobState.CANCELED
        compute_execution.state = "CANCELED"
    _audit(session, identity, calculation.project_id, "calculation.failed", calculation.id)
    session.commit()
    return get_calculation(session, identity, calculation.project_id, calculation.id)


def get_calculation(
    session: Session, identity: Identity, project_id: str, calculation_id: str
) -> CalculationDetail:
    project, _member = authorize_project_access(session, identity, project_id)
    calculation = session.get(CalculationRecord, calculation_id)
    # A calculation of another project is indistinguishable from a missing one: an id must never
    # confirm that a record exists somewhere the caller cannot see.
    if calculation is None or calculation.project_id != project.id:
        raise ScientificReferenceNotFound("Calculation does not exist.")
    calculation_input = session.scalar(
        select(CalculationInputRecord).where(
            CalculationInputRecord.calculation_id == calculation.id
        )
    )
    if calculation_input is None:
        raise ScientificReferenceNotFound("Immutable calculation input is missing.")
    input_artifact = session.get(
        ScientificArtifactRecord, calculation_input.normalized_input_artifact_id
    )
    if input_artifact is None:
        raise ScientificReferenceNotFound("Normalized input artifact is missing.")
    attempt_record = session.scalar(
        select(CalculationAttemptRecord)
        .where(CalculationAttemptRecord.calculation_id == calculation.id)
        .order_by(CalculationAttemptRecord.attempt_number.desc())
        .limit(1)
    )
    result_record = session.scalar(
        select(CalculationResultRecord).where(
            CalculationResultRecord.calculation_id == calculation.id
        )
    )
    from .scientific_actions import _result_from_record

    job_record = session.scalar(
        select(ComputeJobRecord).where(ComputeJobRecord.calculation_id == calculation.id)
    )
    job_view = _compute_job_view(session, job_record) if job_record else None
    trajectory_record = session.scalar(
        select(OptimizationTrajectoryRecord).where(
            OptimizationTrajectoryRecord.calculation_id == calculation.id
        )
    )

    return CalculationDetail(
        calculation=_calculation_model(calculation, calculation_input.id),
        calculation_input_hash=input_artifact.sha256,
        specification=calculation_input.specification_json,
        attempt=_attempt_model(attempt_record) if attempt_record else None,
        result=_result_from_record(result_record) if result_record else None,
        compute_job=job_view,
        compute_execution=job_view.latest_execution if job_view else None,
        optimization_trajectory=_optimization_trajectory_view(trajectory_record)
        if trajectory_record
        else None,
    )


def download_calculation_artifact(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    project_id: str,
    calculation_id: str,
    artifact_id: str,
) -> tuple[str, str, bytes]:
    project, _member = authorize_project_access(session, identity, project_id)
    calculation = session.get(CalculationRecord, calculation_id)
    if calculation is None or calculation.project_id != project.id:
        raise ScientificReferenceNotFound("Calculation does not exist.")
    attempts = session.scalars(
        select(CalculationAttemptRecord).where(
            CalculationAttemptRecord.calculation_id == calculation.id
        )
    )
    allowed_reference = next(
        (
            reference
            for attempt in attempts
            for reference in attempt.raw_artifacts_json
            if str(reference.get("artifact_id")) == artifact_id
        ),
        None,
    )
    if allowed_reference is None:
        raise ScientificReferenceNotFound("Calculation artifact does not exist.")
    artifact = session.get(ScientificArtifactRecord, artifact_id)
    if artifact is None or artifact.project_id != project.id:
        raise ScientificReferenceNotFound("Calculation artifact does not exist.")
    payload = object_store.get_bytes(artifact.storage_key, settings.scientific_max_output_bytes)
    if hashlib.sha256(payload).hexdigest() != artifact.sha256:
        from .errors import ArtifactHashMismatch

        raise ArtifactHashMismatch()
    suffix = ".json" if artifact.media_type == "application/json" else ".log"
    filename = f"calculation-{calculation.id}-{artifact.kind.lower()}{suffix}"
    return filename, artifact.media_type, payload


JOB_PHASE_FILTERS = ("all", "active", "succeeded", "failed", "canceled")
_ACTIVE_JOB_STATES = {"PENDING", "READY", "LEASED", "RUNNING", "CANCEL_REQUESTED"}


def _job_phase_matches(job: ComputeJobView, phase: str) -> bool:
    """Same grouping as the Jobs page (failed includes a lost execution)."""
    state = str(getattr(job.state, "value", job.state))
    execution = job.latest_execution.state if job.latest_execution else None
    execution_state = str(getattr(execution, "value", execution)) if execution else None
    lost = execution_state == "LOST" and state not in {"SUCCEEDED", "CANCELED"}
    if phase == "active":
        return state in _ACTIVE_JOB_STATES or (lost and state != "FAILED")
    if phase == "failed":
        known = _ACTIVE_JOB_STATES | {"SUCCEEDED", "CANCELED"}
        return lost or state == "FAILED" or state not in known
    if phase == "succeeded":
        return state == "SUCCEEDED"
    if phase == "canceled":
        return state == "CANCELED"
    return True


def _job_matches_text(job: ComputeJobView, needle: str) -> bool:
    summary = job.structure_summary
    haystack = " ".join(
        str(part)
        for part in (
            getattr(summary, "structure_name", None),
            getattr(summary, "formula_hill", None),
            job.workload.workload_type,
            job.provider,
            job.id,
            job.calculation_id,
        )
        if part
    ).lower()
    return needle in haystack


def list_compute_jobs(
    session: Session,
    identity: Identity,
    project_id: str,
    *,
    limit: int | None = None,
    offset: int = 0,
    phase: str = "all",
    provider: str | None = None,
    q: str | None = None,
) -> ComputeJobListOutput:
    """Newest first. With no optional argument this is the pre-0.0.18 response (plus `total`)."""
    project, _member = authorize_project_access(session, identity, project_id)
    jobs = session.scalars(
        select(ComputeJobRecord)
        .where(ComputeJobRecord.project_id == project.id)
        .order_by(ComputeJobRecord.created_at.desc(), ComputeJobRecord.id.desc())
    ).all()
    structure_cache: dict[str, JobStructureSummary | None] = {}
    views = [_compute_job_view(session, job, structure_cache) for job in jobs]
    needle = (q or "").strip().lower()
    if phase != "all" or provider or needle:
        views = [
            view
            for view in views
            if _job_phase_matches(view, phase)
            and (not provider or view.provider == provider)
            and (not needle or _job_matches_text(view, needle))
        ]
    total = len(views)
    start = max(0, offset)
    if limit is None:
        page, next_offset = views[start:], None
    else:
        page = views[start : start + limit]
        next_offset = start + limit if start + limit < total else None
    return ComputeJobListOutput(jobs=tuple(page), total=total, next_offset=next_offset)


def cancel_calculation(
    session: Session, identity: Identity, project_id: str, calculation_id: str
) -> CalculationDetail:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        from .errors import ProjectAccessDenied

        raise ProjectAccessDenied()
    calculation = session.get(CalculationRecord, calculation_id)
    if calculation is None or calculation.project_id != project.id:
        raise ScientificReferenceNotFound("Calculation does not exist.")
    job = session.scalar(
        select(ComputeJobRecord).where(ComputeJobRecord.calculation_id == calculation.id)
    )
    if job is None:
        raise ComputeJobNotFound()
    if job.state in {
        ComputeJobState.SUCCEEDED,
        ComputeJobState.FAILED,
        ComputeJobState.CANCELED,
    }:
        return get_calculation(session, identity, project_id, calculation_id)
    now = utc_now()
    if job.workload_json.get("workload_type") in {
        "chemdft.psi4.energy.v1",
        "chemdft.dftd4.correction.v1",
    }:
        # Re-evaluate after any publication row lock clears. A stale cancel request
        # cannot overwrite a terminal native job or its authoritative result.
        changed = session.execute(
            update(ComputeJobRecord)
            .where(
                ComputeJobRecord.id == job.id,
                ComputeJobRecord.state.in_([
                    ComputeJobState.READY, ComputeJobState.PENDING,
                    ComputeJobState.RUNNING, ComputeJobState.CANCEL_REQUESTED,
                ]),
            )
            .values(state=ComputeJobState.CANCEL_REQUESTED, updated_at=now)
            .execution_options(synchronize_session=False)
        ).rowcount
        if not changed:
            session.rollback()
            return get_calculation(session, identity, project_id, calculation_id)
        session.refresh(job)
    else:
        job.state = ComputeJobState.CANCEL_REQUESTED
        job.updated_at = now
    _audit(session, identity, project.id, "compute.cancel.requested", calculation.id)
    # A worker holding a live lease finalizes the cancel itself. When none does (never leased,
    # requeued after a lost lease, or the worker is gone) nobody else will, so finalize here
    # rather than leave the job in CANCEL_REQUESTED.
    _expire_stale_leases(session, now, job_id=job.id)
    if not _has_active_lease(session, job.id):
        _finalize_cancel_without_execution(
            session, job, "Canceled while no worker held a live lease on the job.", now
        )
        _audit(session, identity, project.id, "compute.cancel.finalized", calculation.id)
    session.commit()
    return get_calculation(session, identity, project_id, calculation_id)


def _has_active_lease(session: Session, job_id: str) -> bool:
    session.flush()  # see lease states changed earlier in this unit of work
    return (
        session.scalar(
            select(ComputeLeaseRecord.id)
            .where(ComputeLeaseRecord.job_id == job_id, ComputeLeaseRecord.state == "ACTIVE")
            .limit(1)
        )
        is not None
    )


def _expire_lease(session: Session, lease: ComputeLeaseRecord, now: datetime) -> None:
    """A lease past its heartbeat deadline no longer holds its job: the execution is lost."""
    lease.state = "EXPIRED"
    execution = session.get(ComputeExecutionRecord, lease.execution_id)
    if execution is not None and execution.state == "RUNNING":
        execution.state = "LOST"
        execution.failure_code = ComputeFailureCode.LEASE_EXPIRED
        execution.diagnostic = "Worker heartbeat deadline expired."
        execution.finished_at = now


def _expired_lease_predicate(now: datetime):
    """Preserve heartbeat-based sweeps for existing engines; Psi4 also has a hard expiry.

    CREST retains its existing strict heartbeat/publication checks. Its sweep behavior,
    like PySCF/xTB, must not change just because Psi4 uses a fixed authorization window.
    """
    psi4_jobs = select(ComputeJobRecord.id).where(
        ComputeJobRecord.workload_json["workload_type"].as_string()
        .in_([WORKLOAD_PSI4_ENERGY.workload_type, "chemdft.dftd4.correction.v1"])
    )
    return (ComputeLeaseRecord.heartbeat_deadline_at < now) | (
        (ComputeLeaseRecord.expires_at <= now) & ComputeLeaseRecord.job_id.in_(psi4_jobs)
    )


def _expire_stale_leases(session: Session, now: datetime, *, job_id: str) -> None:
    for lease in session.scalars(
        select(ComputeLeaseRecord).where(
            ComputeLeaseRecord.job_id == job_id,
            ComputeLeaseRecord.state == "ACTIVE",
            _expired_lease_predicate(now),
        )
    ).all():
        _expire_lease(session, lease, now)


def _finalize_cancel_without_execution(
    session: Session, job: ComputeJobRecord, diagnostic: str, now: datetime
) -> None:
    """Finish a requested cancel when no execution is live; nothing is published."""
    calculation = session.get(CalculationRecord, job.calculation_id)
    if calculation is not None and calculation.state in {
        CalculationLifecycle.QUEUED,
        CalculationLifecycle.RUNNING,
    }:
        was_running = calculation.state == CalculationLifecycle.RUNNING
        _transition(calculation, CalculationLifecycle.CANCELED)
        if was_running:
            last_execution = session.scalar(
                select(ComputeExecutionRecord)
                .where(ComputeExecutionRecord.job_id == job.id)
                .order_by(ComputeExecutionRecord.started_at.desc())
                .limit(1)
            )
            session.add(
                CalculationAttemptRecord(
                    project_id=job.project_id,
                    calculation_id=calculation.id,
                    attempt_number=_next_attempt_number(session, calculation.id),
                    state=CalculationLifecycle.CANCELED,
                    worker_id=(last_execution.worker_id if last_execution else None)
                    or "compute.gateway",
                    engine_identity_json=None,
                    started_at=last_execution.started_at if last_execution else None,
                    finished_at=now,
                    failure_code=CalculationFailureCode.CANCELED,
                    diagnostic=diagnostic,
                    raw_artifacts_json=[],
                )
            )
    trajectory = session.scalar(
        select(OptimizationTrajectoryRecord).where(
            OptimizationTrajectoryRecord.calculation_id == job.calculation_id
        )
    )
    if trajectory is not None and trajectory.state not in {"SUCCEEDED", "FAILED", "CANCELED"}:
        trajectory.state = "CANCELED"
    job.state = ComputeJobState.CANCELED
    job.updated_at = now
    _release_reservation(session, job.reservation_id, {"currency": "USD", "minor_units": 0})


def recover_expired_compute_leases(session: Session) -> int:
    from .config import get_settings

    now = utc_now()
    expired = session.scalars(
        select(ComputeLeaseRecord).where(
            ComputeLeaseRecord.state == "ACTIVE",
            _expired_lease_predicate(now),
        )
    ).all()
    recovered = 0
    for lease in expired:
        execution = session.get(ComputeExecutionRecord, lease.execution_id)
        job = session.get(ComputeJobRecord, lease.job_id)
        _expire_lease(session, lease, now)
        if job is not None and job.state == ComputeJobState.CANCEL_REQUESTED:
            continue  # finalized below once no live lease remains
        if job is not None and job.state == ComputeJobState.RUNNING:
            trajectory = session.scalar(
                select(OptimizationTrajectoryRecord).where(
                    OptimizationTrajectoryRecord.calculation_id == job.calculation_id
                )
            )
            executions_so_far = int(
                session.scalar(
                    select(func.count())
                    .select_from(ComputeExecutionRecord)
                    .where(ComputeExecutionRecord.job_id == job.id)
                )
                or 0
            )
            max_attempts = get_settings().aws_max_attempts
            over_cap = job.provider == AWS_PROVIDER and executions_so_far >= max_attempts
            if over_cap or trajectory is not None or job.workload_json.get("workload_type") in {
                "chemdft.crest.conformer-search.v1",
                "chemdft.psi4.energy.v1",
                "chemdft.dftd4.correction.v1",
            }:
                if trajectory is not None:
                    trajectory.state = "FAILED"
                calculation = session.get(CalculationRecord, job.calculation_id)
                if calculation is not None and calculation.state == CalculationLifecycle.RUNNING:
                    _transition(calculation, CalculationLifecycle.FAILED)
                    attempt = CalculationAttemptRecord(
                        project_id=job.project_id,
                        calculation_id=calculation.id,
                        attempt_number=_next_attempt_number(session, calculation.id),
                        state=CalculationLifecycle.FAILED,
                        worker_id=execution.worker_id if execution else "compute.gateway",
                        engine_identity_json=None,
                        started_at=execution.started_at if execution else None,
                        finished_at=now,
                        failure_code=CalculationFailureCode.ENGINE_CRASHED,
                        diagnostic=(
                            f"Scientific worker heartbeat expired before a complete result; "
                            f"not retried after {executions_so_far} attempts (AWS attempt cap)."
                            if over_cap
                            else "Scientific worker heartbeat expired before a complete result."
                        ),
                        raw_artifacts_json=execution.raw_artifacts_json
                        if execution
                        and job.workload_json.get("workload_type")
                        in {
                            "chemdft.crest.conformer-search.v1",
                            "chemdft.psi4.energy.v1",
                            "chemdft.dftd4.correction.v1",
                        }
                        else [],
                    )
                    session.add(attempt)
                job.state = ComputeJobState.FAILED
                _release_reservation(
                    session, job.reservation_id, {"currency": "USD", "minor_units": 0}
                )
            else:
                job.state = ComputeJobState.READY
                recovered += 1
            job.updated_at = now
    session.flush()
    for job in session.scalars(
        select(ComputeJobRecord).where(ComputeJobRecord.state == ComputeJobState.CANCEL_REQUESTED)
    ).all():
        if not _has_active_lease(session, job.id):
            _finalize_cancel_without_execution(
                session,
                job,
                "Canceled by the lease sweep: the job's execution is no longer live.",
                now,
            )
    session.commit()
    return recovered


def heartbeat_compute_execution(
    session: Session,
    *,
    execution_id: str,
    owner: str,
    lease_token: str,
    settings: Settings,
) -> bool:
    token_hash = lease_token_hash(lease_token)
    lease = session.scalar(
        select(ComputeLeaseRecord).where(
            ComputeLeaseRecord.execution_id == execution_id,
            ComputeLeaseRecord.owner == owner,
            ComputeLeaseRecord.lease_token_hash == token_hash,
            ComputeLeaseRecord.state == "ACTIVE",
        )
    )
    if lease is None:
        return False
    now = utc_now()
    execution_input = session.get(ComputeExecutionRecord, execution_id)
    job_input = session.get(ComputeJobRecord, execution_input.job_id) if execution_input else None
    if (
        job_input
        and job_input.workload_json.get("workload_type")
        in {
            "chemdft.crest.conformer-search.v1",
            "chemdft.psi4.energy.v1",
            "chemdft.dftd4.correction.v1",
        }
    ) and (
        lease.expires_at.replace(tzinfo=UTC) <= now
        or lease.heartbeat_deadline_at.replace(tzinfo=UTC) <= now
    ):
        return False
    lease.heartbeat_at = now
    lease.heartbeat_deadline_at = now + timedelta(seconds=settings.compute_heartbeat_seconds)
    execution = session.get(ComputeExecutionRecord, execution_id)
    if execution is not None:
        execution.heartbeat_at = now
    session.commit()
    return True


def _hosted_run_ttl_seconds(settings: Settings, job: ComputeJobRecord, specification: dict) -> int:
    """Lease and execution-authorization lifetime for a non-CREST run.

    Release 0.0.45: hosted AWS jobs (QE, periodic PySCF, ...) run longer than
    ``compute_lease_seconds`` (300 s). Their publication gate (``lock_live_lease``:
    ``expires_at > now``) dropped every result that arrived after 5 minutes, so the execution
    was marked LOST and re-run. A hosted job's lease now lasts its own limit + the AWS overhead
    + 60 s, like CREST's ``timeout + 60``. Heartbeat-based reclaim of a dead worker is
    unchanged (``compute_heartbeat_seconds``).
    ``compute_lease_seconds`` itself is not raised, and local jobs keep it.
    """
    if job.provider != AWS_PROVIDER:
        return settings.compute_lease_seconds
    from .aws_compute import aws_runtime_limit_seconds

    task = specification.get("task_type") or "ENERGY"
    engine = (specification.get("engine_preference") or {}).get("engine")
    limit = aws_runtime_limit_seconds(settings, task, engine)
    return max(settings.compute_lease_seconds, limit + settings.aws_job_overhead_seconds + 60)



def _next_attempt_number(session: Session, calculation_id: str) -> int:
    current = session.scalar(
        select(func.max(CalculationAttemptRecord.attempt_number)).where(
            CalculationAttemptRecord.calculation_id == calculation_id
        )
    )
    return int(current or 0) + 1


def _tddft_unconverged_message(worker_result, input_document) -> str:
    """Plain failure text for a TDDFT run that did not publish; names unconverged roots if known."""
    base = "PySCF TDDFT worker did not produce a converged result"
    if not isinstance(worker_result, dict) or worker_result.get("converged") is not False:
        return base
    states = worker_result.get("excited_states")
    if not isinstance(states, list) or not states:
        return base
    bad = sum(1 for state in states if isinstance(state, dict) and state.get("converged") is False)
    options = input_document.get("tddft") if isinstance(input_document, dict) else None
    requested = options.get("nstates") if isinstance(options, dict) else None
    return (
        f"{base}: the excited-state solver did not converge for {bad} of {len(states)} requested "
        f"states. Nothing was published and the job was not retried. Request fewer states "
        f"(for example 5){'' if requested is None else f'; {requested} were requested'}."
    )


def _finish_compute_failure(
    session: Session,
    job: ComputeJobRecord,
    execution: ComputeExecutionRecord,
    attempt_id: str,
    failure_code: ComputeFailureCode,
    diagnostic: str,
) -> None:
    execution.calculation_attempt_id = attempt_id
    execution.state = "FAILED"
    execution.finished_at = utc_now()
    execution.failure_code = failure_code
    execution.diagnostic = diagnostic
    job.state = ComputeJobState.FAILED
    job.updated_at = utc_now()
    _release_reservation(session, job.reservation_id, {"currency": "USD", "minor_units": 0})
    _finish_active_leases(session, execution.id)


def _release_reservation(
    session: Session, reservation_id: str, actual_cost: dict[str, object]
) -> None:
    reservation = session.get(ComputeReservationRecord, reservation_id)
    if reservation is None:
        return
    reservation.actual_cost_json = actual_cost
    reservation.state = "RELEASED"
    reservation.reconciled_at = utc_now()


def _finish_active_leases(session: Session, execution_id: str) -> None:
    leases = session.scalars(
        select(ComputeLeaseRecord).where(
            ComputeLeaseRecord.execution_id == execution_id,
            ComputeLeaseRecord.state == "ACTIVE",
        )
    ).all()
    for lease in leases:
        lease.state = "RELEASED"
        lease.heartbeat_at = utc_now()


def _fail_energy_validation(
    session, identity, calculation, job, compute_execution, raw_artifacts,
    engine, attempt_number, started_at, error,
) -> CalculationDetail:
    """Terminal FAILED bookkeeping when a worker candidate or its publication is rejected."""
    _transition(calculation, CalculationLifecycle.FAILED)
    attempt = CalculationAttemptRecord(
        project_id=calculation.project_id,
        calculation_id=calculation.id,
        attempt_number=attempt_number,
        state=CalculationLifecycle.FAILED,
        worker_id=f"local.{engine}",
        engine_identity_json=None,
        started_at=started_at,
        finished_at=utc_now(),
        failure_code=CalculationFailureCode.RESULT_VALIDATION_FAILED,
        diagnostic=str(error)[:1000],
        raw_artifacts_json=[ref.model_dump(mode="json") for ref in raw_artifacts],
    )
    session.add(attempt)
    session.flush()
    _finish_compute_failure(
        session,
        job,
        compute_execution,
        attempt.id,
        ComputeFailureCode.ARTIFACT_TRANSFER_FAILED,
        str(error)[:1000],
    )
    session.commit()
    return get_calculation(session, identity, calculation.project_id, calculation.id)


def _require_pyscf_log_energy(candidate: dict[str, object], engine_log: bytes) -> None:
    """The worker's candidate must equal the energy PySCF itself printed (independent evidence)."""
    matches = re.findall(
        r"converged SCF energy = (-?\d+\.\d+(?:[eE][-+]?\d+)?)", engine_log.decode(errors="replace")
    )
    if not matches:
        raise ValueError("PySCF log has no converged SCF energy to confirm the worker candidate.")
    if abs(float(matches[-1]) - float(candidate["total_energy_hartree"])) > 1e-8:
        raise ValueError("PySCF worker candidate energy contradicts the retained native log.")


def _require_qe_log_energy(candidate: dict[str, object], engine_log: bytes) -> None:
    """The candidate must equal the total energy pw.x printed itself (independent evidence)."""
    matches = re.findall(
        r"^!\s+total energy\s+=\s+(-?\d+\.\d+)\s+Ry",
        engine_log.decode(errors="replace"),
        flags=re.M,
    )
    if not matches:
        raise ValueError("Quantum ESPRESSO log has no total energy line to confirm the candidate.")
    if abs(float(matches[-1]) * 0.5 - float(candidate["total_energy_hartree"])) > 1e-7:
        raise ValueError("Quantum ESPRESSO candidate energy contradicts the retained native log.")


def _validate_energy_candidate(candidate: dict[str, object]) -> EnergyResult:
    if candidate.get("task") != "ENERGY" or candidate.get("schema") != "chemdft.worker.energy":
        raise ValueError("Worker result type does not match ENERGY.")
    if candidate.get("converged") is not True or candidate.get("finite") is not True:
        raise ValueError("Nonconverged or non-finite energy cannot become authoritative.")
    return EnergyResult(
        total_energy=ScientificQuantity(
            value=float(candidate["total_energy_hartree"]),
            unit=UnitReference(
                standard=UnitStandard.QCSCHEMA,
                code="Eh",
                dimension=QuantityDimension.ENERGY,
            ),
        ),
        method=str(candidate["method"]),
        basis=str(candidate["basis"]) if candidate.get("basis") is not None else None,
        scf_iterations=(
            int(candidate["scf_iterations"])
            if candidate.get("scf_iterations") is not None
            else None
        ),
        parser_version=PARSER_VERSION,
        validator_version=ENERGY_VALIDATOR_VERSION,
    )


def _validate_periodic_energy_candidate(candidate: dict[str, object]) -> PeriodicEnergyResult:
    if (
        candidate.get("task") != "PERIODIC_ENERGY"
        or candidate.get("schema") != "chemdft.worker.periodic-energy"
    ):
        raise ValueError("Worker result type does not match PERIODIC_ENERGY.")
    if candidate.get("converged") is not True or candidate.get("finite") is not True:
        raise ValueError("Nonconverged or non-finite periodic energy cannot become authoritative.")
    gap_val = candidate.get("band_gap_ev")
    band_gap = None
    if gap_val is not None:
        band_gap = ScientificQuantity(
            value=float(gap_val),
            unit=UnitReference(
                standard=UnitStandard.QCSCHEMA,
                code="eV",
                dimension=QuantityDimension.ENERGY,
            ),
        )
    k_mesh_raw = candidate.get("k_mesh", [1, 1, 1])
    if isinstance(k_mesh_raw, (list, tuple)) and len(k_mesh_raw) == 3:
        k_mesh = (int(k_mesh_raw[0]), int(k_mesh_raw[1]), int(k_mesh_raw[2]))
    else:
        k_mesh = (1, 1, 1)
    moments_raw = candidate.get("local_magnetic_moments") or {}
    moments = {str(k): float(v) for k, v in moments_raw.items()}
    u_eff_raw = candidate.get("u_effective_ev") or {}
    u_eff = {str(k): float(v) for k, v in u_eff_raw.items()}
    qe_fields: dict[str, object] = {}
    if candidate.get("engine") == "qe":
        if candidate.get("relaxation") is not None and not candidate["relaxation"].get("converged"):
            raise ValueError("A relaxation that did not converge cannot be published.")
        qe_fields = {
            "engine": "qe",
            "local_moment_kind": "lowdin-projected",
            "fermi_energy_ev": candidate.get("fermi_energy_ev"),
            "absolute_magnetization": candidate.get("absolute_magnetization"),
            "irreducible_k_points": candidate.get("irreducible_k_points"),
            "pseudopotential_library": str(candidate.get("pseudopotential") or ""),
            "pseudopotential_files": dict(candidate.get("pseudopotential_files") or {}),
            "pseudopotential_libraries": dict(candidate.get("pseudopotential_libraries") or {}),
            "cutoffs_ry": {k: float(v) for k, v in (candidate.get("cutoffs_ry") or {}).items()},
            "used_default_u": bool(candidate.get("used_default_u")),
            "relaxation": candidate.get("relaxation"),
            "dos": candidate.get("dos"),
            "bands": candidate.get("bands"),
        }
    return PeriodicEnergyResult(
        **qe_fields,
        total_energy=ScientificQuantity(
            value=float(candidate["total_energy_hartree"]),
            unit=UnitReference(
                standard=UnitStandard.QCSCHEMA,
                code="Eh",
                dimension=QuantityDimension.ENERGY,
            ),
        ),
        converged=True,
        scf_iterations=(
            int(candidate["scf_iterations"])
            if candidate.get("scf_iterations") is not None
            else None
        ),
        band_gap=band_gap,
        k_mesh=k_mesh,
        magnetic_order=str(candidate.get("magnetic_order", "none")),
        u_effective_ev=u_eff,
        local_magnetic_moments=moments,
        total_magnetization=(
            float(candidate["total_magnetization"])
            if candidate.get("total_magnetization") is not None
            else None
        ),
        runtime_seconds=(
            float(candidate["runtime_seconds"])
            if candidate.get("runtime_seconds") is not None
            else None
        ),
        parser_version=PARSER_VERSION,
        validator_version=ENERGY_VALIDATOR_VERSION,
    )


def _finish_periodic_energy(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    calculation: CalculationRecord,
    calculation_input: CalculationInputRecord,
    input_artifact: ScientificArtifactRecord,
    job: ComputeJobRecord,
    compute_execution: ComputeExecutionRecord,
    execution,
    worker_result: dict | None,
    raw_artifacts: list[ArtifactReference],
    attempt_number: int,
    started_at,
) -> CalculationDetail:
    session.refresh(job)
    engine_name = str((worker_result or {}).get("engine") or "pyscf")
    canceled = job.state == ComputeJobState.CANCEL_REQUESTED
    try:
        if canceled:
            raise ValueError("Periodic calculation canceled before publication")
        if execution.exit_code != 0 or execution.timed_out or worker_result is None:
            reason = str((worker_result or {}).get("failure_reason") or "").strip()
            raise ValueError(
                "Periodic calculation did not complete successfully"
                + (f": {reason}" if reason else "")
            )
        periodic_result = _validate_periodic_energy_candidate(worker_result)
        if engine_name == "qe":
            _require_qe_log_energy(worker_result, execution.engine_log)
        else:
            _require_pyscf_log_energy(worker_result, execution.engine_log)
    except ValueError as error:
        failure_state = CalculationLifecycle.CANCELED if canceled else CalculationLifecycle.FAILED
        _transition(calculation, failure_state)
        attempt = CalculationAttemptRecord(
            project_id=calculation.project_id,
            calculation_id=calculation.id,
            attempt_number=attempt_number,
            state=failure_state,
            worker_id=f"local.{engine_name}",
            engine_identity_json=None,
            started_at=started_at,
            finished_at=utc_now(),
            failure_code=CalculationFailureCode.CANCELED
            if canceled
            else CalculationFailureCode.NONCONVERGED
            if worker_result and worker_result.get("converged") is False
            else CalculationFailureCode.EXECUTION_TIMEOUT
            if execution.timed_out
            else CalculationFailureCode.RESULT_VALIDATION_FAILED,
            diagnostic=str(error)[:1000],
            raw_artifacts_json=[ref.model_dump(mode="json") for ref in raw_artifacts],
        )
        session.add(attempt)
        session.flush()
        _finish_compute_failure(
            session,
            job,
            compute_execution,
            attempt.id,
            ComputeFailureCode.PROVIDER_TIMEOUT
            if execution.timed_out
            else ComputeFailureCode.SUBMISSION_FAILED,
            str(error)[:1000],
        )
        _audit(session, identity, calculation.project_id, "calculation.failed", calculation.id)
        session.commit()
        return get_calculation(session, identity, calculation.project_id, calculation.id)

    environment_artifact = _artifact_reference(
        _store_artifact(
            session,
            identity,
            object_store,
            project_id=calculation.project_id,
            kind="ENVIRONMENT_MANIFEST",
            media_type="application/json",
            format_identifier="chemdft.environment_manifest",
            format_version="1.0.0",
            payload=json.dumps(
                worker_result["environment"], sort_keys=True, separators=(",", ":")
            ).encode(),
            source_type="calculation.record",
            source_id=calculation.id,
            max_bytes=settings.scientific_max_output_bytes,
        )
    )
    raw_artifacts.append(environment_artifact)
    engine_identity = EngineReference.model_validate(
        _identity_json(worker_result, environment_artifact)
    )
    session.commit()
    _transition(calculation, CalculationLifecycle.SUCCEEDED)
    provenance = ProvenanceRecordRow(
        project_id=calculation.project_id,
        subject_type="calculation.result",
        subject_id=new_id(),
        source_class=ProvenanceClass.CALCULATED,
        detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SERVICE,
        producer_identifier=f"local.{engine_name}.worker",
        producer_software_version=str(worker_result["engine_version"]),
        source_artifact_id=input_artifact.id,
        operation="chemdft.calculation.periodic-energy",
        operation_version="1.0.0",
        parameters_json=[
            {"name": "method", "value": str(worker_result["method"])},
            {"name": "basis", "value": str(worker_result["basis"])},
            {"name": "pseudopotential", "value": str(worker_result["pseudopotential"])},
            {"name": "k_mesh", "value": list(periodic_result.k_mesh)},
            {"name": "magnetic_order", "value": periodic_result.magnetic_order},
            *(
                [
                    {
                        "name": "pseudopotential_library",
                        "value": str(periodic_result.pseudopotential_library),
                    },
                    {"name": "stages", "value": [
                        s for s, on in (
                            ("relax", periodic_result.relaxation is not None),
                            ("dos", periodic_result.dos is not None),
                            ("bands", periodic_result.bands is not None),
                        ) if on
                    ]},
                ]
                if engine_name == "qe"
                else []
            ),
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
        worker_id=f"local.{engine_name}",
        engine_identity_json=engine_identity.model_dump(mode="json"),
        started_at=started_at,
        finished_at=utc_now(),
        failure_code=None,
        diagnostic=None,
        raw_artifacts_json=[ref.model_dump(mode="json") for ref in raw_artifacts],
    )
    session.add(attempt)
    session.flush()
    compute_execution.calculation_attempt_id = attempt.id
    compute_execution.state = "FINISHED"
    compute_execution.finished_at = utc_now()
    compute_execution.environment_json = worker_result["environment"]
    compute_execution.metering_json = {
        "runtime_ms": int((compute_execution.finished_at - started_at).total_seconds() * 1000),
        "provider_cost_status": "UNKNOWN",
    }
    compute_execution.actual_cost_json = {"currency": "USD", "minor_units": 0}
    compute_execution.raw_artifacts_json = [ref.model_dump(mode="json") for ref in raw_artifacts]
    job.state = ComputeJobState.SUCCEEDED
    job.updated_at = utc_now()
    _release_reservation(session, job.reservation_id, compute_execution.actual_cost_json)
    _finish_active_leases(session, compute_execution.id)
    producer = issue_trusted_producer_context(
        producer_id=f"local.{engine_name}.worker",
        producer_type=ProducerType.SCIENTIFIC_WORKER,
        project_id=UUID(calculation.project_id),
        attestation_id=f"execution:{compute_execution.id}:attempt:{attempt_number}",
    )
    try:
        accept_authoritative_result(
            session,
            producer,
            AuthoritativeResultSubmission(
                result_type="chemdft.periodic-energy",
                project_id=UUID(calculation.project_id),
                calculation_id=UUID(calculation.id),
                calculation_input_id=UUID(calculation_input.id),
                producer_software=engine_identity,
                payload=periodic_result,
                provenance_record_id=UUID(provenance.id),
                raw_artifacts=tuple(raw_artifacts),
                idempotency_key=f"result:{calculation.id}:periodic-energy",
                request_id=uuid4(),
                correlation_id=UUID(provenance.correlation_id),
            ),
            commit=False,
        )
        BillingService(session, identity, settings).record_compute_usage(
            project_id=job.project_id,
            compute_job_id=job.id,
            compute_execution_id=compute_execution.id,
            provider=compute_execution.provider,
            engine=engine_name,
            reserved_minor_units=0,
            actual_minor_units=0,
            billable_minor_units=0,
            idempotency_key=f"compute-execution:{compute_execution.id}",
        )
        session.commit()
    except ScientificValidationFailed as error:
        session.rollback()
        for record in (calculation, job, compute_execution):
            session.refresh(record)
        return _fail_energy_validation(
            session, identity, calculation, job, compute_execution, raw_artifacts,
            engine_name, attempt_number, started_at, error,
        )
    return get_calculation(session, identity, calculation.project_id, calculation.id)


def _store_artifact(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    *,
    project_id: str,
    kind: str,
    media_type: str,
    format_identifier: str,
    format_version: str | None,
    payload: bytes,
    source_type: str,
    source_id: str,
    max_bytes: int,
) -> ScientificArtifactRecord:
    stored = object_store.put_raw(project_id, BytesIO(payload), max_bytes)
    artifact = ScientificArtifactRecord(
        project_id=project_id,
        kind=kind,
        media_type=media_type,
        format_identifier=format_identifier,
        format_version=format_version,
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        storage_key=stored.key,
        created_by=identity.user_id,
        source_relation_type=source_type,
        source_relation_id=source_id,
        compression=None,
        extensions_json=[],
    )
    session.add(artifact)
    session.flush()
    return artifact


def _artifact_reference(record: ScientificArtifactRecord) -> ArtifactReference:
    return ArtifactReference(
        project_id=UUID(record.project_id), artifact_id=UUID(record.id), sha256=record.sha256
    )


def _identity_json(
    candidate: dict[str, object] | None, environment_artifact: ArtifactReference
) -> dict[str, object]:
    if candidate is None:
        raise ValueError("Engine identity requires worker output")
    environment = candidate["environment"]
    if not isinstance(environment, dict):
        raise ValueError("Worker environment manifest must be an object")
    libraries = environment.get("libraries", {})
    if not isinstance(libraries, dict):
        raise ValueError("Worker library versions must be an object")
    manifest = json.dumps(environment, sort_keys=True, separators=(",", ":")).encode()
    return {
        "name": candidate["engine"],
        "version": candidate["engine_version"],
        "adapter_version": candidate["adapter_version"],
        "environment_artifact": environment_artifact.model_dump(mode="json"),
        "capabilities": [
            "chemdft.optimization"
            if candidate.get("task") == "GEOMETRY_OPTIMIZATION"
            else "chemdft.vibrational-analysis"
            if candidate.get("task") == "FREQUENCY"
            else "chemdft.molecular-orbitals"
            if candidate.get("task") == "ORBITAL"
            else "chemdft.energy"
        ],
        "execution_backend": "local.subprocess",
        "environment_digest": hashlib.sha256(manifest).hexdigest(),
        "hardware_class": environment.get("architecture"),
        "library_versions": [
            {
                "namespace": "chemdft.library-version",
                "schema_version": "1.0.0",
                "values": [
                    {"key": str(name), "value": str(version)}
                    for name, version in sorted(libraries.items())
                ],
            }
        ],
    }


def _transition(record: CalculationRecord, target: CalculationLifecycle) -> None:
    current = CalculationLifecycle(record.state)
    require_transition(current, target)
    record.state = target
    record.updated_at = utc_now()


def _command_hash(command: CalculationSubmitInput) -> str:
    payload = command.model_dump(mode="json", exclude={"idempotency_key"})
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _calculation_model(record: CalculationRecord, input_id: str) -> Calculation:
    return Calculation(
        id=UUID(record.id),
        project_id=UUID(record.project_id),
        input_id=UUID(input_id),
        state=CalculationLifecycle(record.state),
        created_by=UUID(record.created_by),
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _attempt_model(record: CalculationAttemptRecord) -> CalculationAttempt:
    return CalculationAttempt(
        id=UUID(record.id),
        project_id=UUID(record.project_id),
        calculation_id=UUID(record.calculation_id),
        attempt_number=record.attempt_number,
        state=CalculationLifecycle(record.state),
        worker_id=record.worker_id,
        engine_identity=record.engine_identity_json,
        started_at=record.started_at,
        finished_at=record.finished_at,
        failure_code=record.failure_code,
        diagnostic=record.diagnostic,
        raw_artifacts=record.raw_artifacts_json,
    )


def _money_model(value: dict[str, object] | None):
    if value is None:
        return None
    from .contracts.catalog import MoneyAmount

    return MoneyAmount.model_validate(value)


def _estimate_model(record: ComputeEstimateRecord | None) -> ComputeEstimate | None:
    if record is None:
        return None
    return ComputeEstimate(
        id=UUID(record.id),
        project_id=UUID(record.project_id),
        requirement_hash=record.requirement_hash,
        provider=record.provider,
        provider_summary=record.provider_summary,
        runtime_low_seconds=record.runtime_low_seconds,
        runtime_high_seconds=record.runtime_high_seconds,
        cost_low=_money_model(record.cost_low_json),
        cost_high=_money_model(record.cost_high_json),
        confidence=record.confidence,
        assumptions=tuple(record.assumptions_json),
        valid_until=record.valid_until,
        created_at=record.created_at,
    )


def _reservation_model(
    record: ComputeReservationRecord | None,
) -> ComputeReservationView | None:
    if record is None:
        return None
    return ComputeReservationView(
        id=UUID(record.id),
        project_id=UUID(record.project_id),
        estimate_id=UUID(record.estimate_id),
        authorized_max=_money_model(record.authorized_max_json),
        actual_cost=_money_model(record.actual_cost_json),
        state=record.state,
        created_at=record.created_at,
        reconciled_at=record.reconciled_at,
    )


def _execution_model(record: ComputeExecutionRecord | None) -> ComputeExecutionView | None:
    if record is None:
        return None
    metering = None
    if record.metering_json is not None:
        metering = ProviderMeteringView.model_validate(record.metering_json)
    return ComputeExecutionView(
        id=UUID(record.id),
        project_id=UUID(record.project_id),
        job_id=UUID(record.job_id),
        calculation_id=UUID(record.calculation_id),
        calculation_attempt_id=(
            UUID(record.calculation_attempt_id) if record.calculation_attempt_id else None
        ),
        provider=record.provider,
        state=record.state,
        worker_id=record.worker_id,
        lease_owner=record.lease_owner,
        started_at=record.started_at,
        heartbeat_at=record.heartbeat_at,
        finished_at=record.finished_at,
        hardware_class=record.hardware_class,
        metering=metering,
        failure_code=record.failure_code,
        diagnostic=record.diagnostic,
    )


def _worker_status(record: ComputeJobRecord) -> str | None:
    """On-demand AWS only: why a waiting job is not running yet (shared state file)."""
    if record.provider != AWS_PROVIDER or record.state not in (
        ComputeJobState.READY,
        ComputeJobState.PENDING,
    ):
        return None
    from .aws_worker_lifecycle import stale_cutoff, visible_diagnostic
    from .config import get_settings

    settings = get_settings()
    if settings.aws_on_demand_enabled:
        created = record.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
        if created < stale_cutoff(settings):
            return (
                "This calculation waited too long without the AWS worker running and will not "
                "start automatically. Cancel it and submit it again."
            )
    return visible_diagnostic(settings)


def _job_structure_summary(
    session: Session,
    project_id: str,
    structure_version_id: str | None,
    cache: dict[str, JobStructureSummary | None],
) -> JobStructureSummary | None:
    """Input structure identity; project-scoped, one lookup per version per request."""
    if not structure_version_id:
        return None
    if structure_version_id not in cache:
        version = session.get(StructureVersionRecord, structure_version_id)
        if version is None or version.project_id != project_id:
            cache[structure_version_id] = None
        else:
            structure = session.get(StructureRecord, version.structure_id)
            elements = [str(a["element"]) for a in version_atoms(version) if "element" in a]
            cache[structure_version_id] = JobStructureSummary(
                structure_id=UUID(version.structure_id),
                structure_name=structure.name if structure else None,
                structure_version_id=UUID(version.id),
                structure_revision=version.revision,
                formula_hill=hill_formula(elements) or None,
                atom_count=version.atom_count,
            )
    return cache[structure_version_id]


def _compute_job_view(
    session: Session,
    record: ComputeJobRecord,
    structure_cache: dict[str, JobStructureSummary | None] | None = None,
) -> ComputeJobView:
    estimate = session.get(ComputeEstimateRecord, record.estimate_id)
    reservation = session.get(ComputeReservationRecord, record.reservation_id)
    latest_execution = session.scalar(
        select(ComputeExecutionRecord)
        .where(ComputeExecutionRecord.job_id == record.id)
        .order_by(ComputeExecutionRecord.created_at.desc())
        .limit(1)
    )
    attempt_count = session.scalar(
        select(func.count(CalculationAttemptRecord.id)).where(
            CalculationAttemptRecord.calculation_id == record.calculation_id
        )
    )
    calculation_input = session.get(CalculationInputRecord, record.calculation_input_id)
    spec = (calculation_input.specification_json if calculation_input else None) or {}

    def _identifier(reference: object) -> str | None:
        return reference.get("identifier") if isinstance(reference, dict) else None

    return ComputeJobView(
        id=UUID(record.id),
        project_id=UUID(record.project_id),
        calculation_id=UUID(record.calculation_id),
        calculation_input_id=UUID(record.calculation_input_id),
        workload=record.workload_json,
        requirement=record.requirement_json,
        requirement_hash=record.requirement_hash,
        state=record.state,
        provider=record.provider,
        priority=record.priority,
        estimate=_estimate_model(estimate),
        reservation=_reservation_model(reservation),
        latest_execution=_execution_model(latest_execution),
        attempt_count=int(attempt_count or 0),
        specification_summary=JobSpecificationSummary(
            task_type=spec.get("task_type"),
            method=_identifier(spec.get("method")),
            basis=_identifier(spec.get("basis")),
            charge=spec.get("charge") if isinstance(spec.get("charge"), int) else None,
            multiplicity=(
                spec.get("multiplicity") if isinstance(spec.get("multiplicity"), int) else None
            ),
        ) if calculation_input else None,
        structure_summary=_job_structure_summary(
            session,
            record.project_id,
            calculation_input.structure_version_id if calculation_input else None,
            structure_cache if structure_cache is not None else {},
        ),
        worker_status=_worker_status(record),
        submitted_by=UUID(record.submitted_by),
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _audit(
    session: Session, identity: Identity, project_id: str, event: str, calculation_id: str,
    *, metadata: list[dict[str, Any]] | None = None,
) -> None:
    session.add(
        AuditEventRecord(
            event_name=event,
            actor_or_service_id=identity.user_id,
            organization_id=identity.organization_id,
            project_id=project_id,
            request_id=new_id(),
            targets_json=[
                {
                    "project_id": project_id,
                    "entity_type": "calculation.record",
                    "entity_id": calculation_id,
                }
            ],
            outcome="SUCCEEDED",
            artifact_references_json=[],
            safe_metadata_json=metadata or [],
        )
    )
