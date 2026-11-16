"""Deterministic, fenced continuation of human-approved native calculations.

The existing compute worker calls this after publication and on idle recovery polls. There is no
second queue, solver, model call, or new persistence schema. Every scientific number in the final
message is copied from a checked, currently usable result field, with its source path recorded.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC

from pydantic import ValidationError
from sqlalchemy import func, select

from ..actions import authorize_project_access
from ..ai_models import (
    AIApprovalRecord,
    AIMessageRecord,
    AIRunEventRecord,
    AIRunRecord,
    AIRunStepRecord,
)
from ..calculation_actions import (
    _command_hash,
    _require_pyscf_log_energy,
    _validate_energy_candidate,
    get_calculation,
)
from ..context import Identity, ServiceIdentity
from ..contracts.catalog import CalculationSubmitInput
from ..contracts.results import EnergyResult
from ..contracts.scientific import CalculationSpecification
from ..effective_result_state import require_current_result
from ..errors import ApplicationError, ProjectAccessDenied, ScientificReferenceNotFound
from ..models import Project, new_id, utc_now
from ..project_access import ProjectCapability, require_capability
from ..scientific.engines.normalization import normalized_calculation_input
from ..scientific_models import (
    CalculationAttemptRecord,
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ComputeExecutionRecord,
    ComputeJobRecord,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from .events import AIRunEventManager
from .execution import AIRunExecutionManager, StaleWorkerFencedError

TERMINAL_CALCULATIONS = ("SUCCEEDED", "FAILED", "CANCELED")
MAX_TRANSIENT_GROUNDING_ATTEMPTS = 3
# The compute worker polls every ~2 s; without pacing three polls would exhaust the budget during
# a few seconds of storage unavailability. One attempt is consumed per cooldown window.
TRANSIENT_RETRY_COOLDOWN_SECONDS = 30


class ResultGroundingError(ValueError):
    """An input/publication binding cannot justify a scientific claim."""


class TransientGroundingError(Exception):
    """A transient infrastructure or storage failure occurred while retrieving evidence."""


def _fingerprint(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def approved_calculation(session, run, calculation_id):
    """Bind the durable calculation to this run's consumed, exact human approval."""
    calculation = session.scalar(
        select(CalculationRecord)
        .where(
            CalculationRecord.id == calculation_id, CalculationRecord.project_id == run.project_id
        )
        .execution_options(populate_existing=True)
    )
    if calculation is None:
        raise ResultGroundingError("Approved calculation is missing from this project.")
    approval = session.scalar(
        select(AIApprovalRecord)
        .where(
            AIApprovalRecord.project_id == run.project_id,
            AIApprovalRecord.run_id == run.id,
            AIApprovalRecord.tool_name == "calculation.submit",
            AIApprovalRecord.status == "APPROVED",
            AIApprovalRecord.consumed_at.is_not(None),
        )
        .order_by(AIApprovalRecord.created_at.desc())
    )
    if approval is None:
        raise ResultGroundingError("No consumed human calculation approval belongs to this run.")
    command = CalculationSubmitInput.model_validate(approval.normalized_arguments_json)
    normalized = command.model_dump(mode="json")
    if (
        approval.action_fingerprint != _fingerprint(normalized)
        or approval.decided_by != run.actor_id
        or approval.actor_id not in (None, run.actor_id)
        or approval.organization_id
        not in (None, session.get(Project, run.project_id).organization_id)
        or calculation.created_by != run.actor_id
        or command.idempotency_key != f"ai-approval:{approval.id}"
        or calculation.idempotency_key != command.idempotency_key
        or calculation.request_hash != _command_hash(command)
        or str(command.structure_version.project_id) != run.project_id
    ):
        raise ResultGroundingError("Calculation does not match this run's approved action.")
    input_row = session.scalar(
        select(CalculationInputRecord).where(
            CalculationInputRecord.calculation_id == calculation.id,
            CalculationInputRecord.project_id == run.project_id,
        )
    )
    if (
        input_row is None
        or input_row.structure_version_id != str(command.structure_version.entity_id)
        or CalculationSpecification.model_validate(input_row.specification_json).model_dump(
            mode="json"
        )
        != normalized["specification"]
    ):
        raise ResultGroundingError("Immutable calculation input differs from human approval.")
    version = session.scalar(
        select(StructureVersionRecord).where(
            StructureVersionRecord.id == input_row.structure_version_id,
            StructureVersionRecord.project_id == run.project_id,
        )
    )
    if version is None or (
        version.overall_charge != command.specification.charge
        or version.multiplicity != command.specification.multiplicity
    ):
        raise ResultGroundingError("Authoritative structure/electronic state is unavailable.")
    return calculation, input_row, command


def _artifact_bytes(session, store, project_id, artifact_id, expected_sha=None):
    row = session.scalar(
        select(ScientificArtifactRecord).where(
            ScientificArtifactRecord.id == str(artifact_id),
            ScientificArtifactRecord.project_id == project_id,
        )
    )
    if row is None or (expected_sha and row.sha256 != expected_sha):
        raise ResultGroundingError("Scientific artifact identity is missing or mismatched.")
    if not row.storage_key.startswith(f"projects/{project_id}/"):
        raise ResultGroundingError("Scientific artifact storage is outside the project.")
    # Bound read-time grounding independently of a corrupt artifact's reported size.
    if row.size_bytes > 5 * 1024 * 1024:
        raise ResultGroundingError("Scientific artifact exceeds the grounding read bound.")
    try:
        data = store.get_bytes(row.storage_key, max_bytes=5 * 1024 * 1024)
    except (FileNotFoundError, NotADirectoryError, IsADirectoryError) as error:
        # A registered object that does not exist is lost evidence, not a retryable I/O blip.
        raise ResultGroundingError(f"Scientific artifact object is missing: {error}") from error
    except (OSError, TimeoutError, ConnectionError) as error:
        raise TransientGroundingError(
            f"Transient storage error reading artifact {artifact_id} ({row.storage_key}): {error}"
        ) from error
    except Exception as error:
        raise ResultGroundingError(f"Artifact read failed: {error}") from error
    if len(data) != row.size_bytes or hashlib.sha256(data).hexdigest() != row.sha256:
        raise ResultGroundingError("Scientific artifact contents failed their persisted hash.")
    return row, data


def grounded_result(session, store, run, calculation, input_row, command):
    """Read existing Firewall publication and verify native execution/provenance bindings."""
    row = session.scalar(
        select(CalculationResultRecord).where(
            CalculationResultRecord.calculation_id == calculation.id,
            CalculationResultRecord.project_id == run.project_id,
        )
    )
    if row is None:
        raise ResultGroundingError("RESULT NOT AVAILABLE: no persisted engine result.")
    require_current_result(session, row)
    provenance = session.scalar(
        select(ProvenanceRecordRow).where(
            ProvenanceRecordRow.id == row.provenance_record_id,
            ProvenanceRecordRow.project_id == run.project_id,
        )
    )
    execution = session.scalar(
        select(ComputeExecutionRecord)
        .where(
            ComputeExecutionRecord.calculation_id == calculation.id,
            ComputeExecutionRecord.project_id == run.project_id,
            ComputeExecutionRecord.state == "FINISHED",
        )
        .order_by(ComputeExecutionRecord.finished_at.desc())
    )
    attempt = (
        session.get(CalculationAttemptRecord, execution.calculation_attempt_id)
        if execution
        else None
    )
    if (
        calculation.state != "SUCCEEDED"
        or row.calculation_input_id != input_row.id
        or row.source_class != "CALCULATED"
        or provenance is None
        or provenance.subject_type != "calculation.result"
        or provenance.subject_id != row.id
        or provenance.source_class != "CALCULATED"
        or provenance.producer_identifier != row.trusted_producer_id
        or execution is None
        or attempt is None
        or attempt.project_id != run.project_id
        or attempt.calculation_id != calculation.id
        or attempt.state != "SUCCEEDED"
        or row.producer_attestation_id
        != (f"execution:{execution.id}:attempt:{attempt.attempt_number}")
        or row.producer_software_json != attempt.engine_identity_json
    ):
        raise ResultGroundingError("Native result execution/provenance binding is invalid.")
    spec = command.specification
    engine = row.producer_software_json
    if (
        engine.get("name") != spec.engine_preference.engine
        or not engine.get("version")
        or (
            spec.engine_preference.allowed_version
            and engine["version"] != spec.engine_preference.allowed_version
        )
        or provenance.producer_software_version != engine["version"]
    ):
        raise ResultGroundingError("Published engine identity differs from the approved engine.")
    normalized_artifact, normalized_bytes = _artifact_bytes(
        session, store, run.project_id, input_row.normalized_input_artifact_id
    )
    normalized = json.loads(normalized_bytes)
    if normalized.get("structure_version_id") != input_row.structure_version_id:
        raise ResultGroundingError("Normalized input points to a different structure version.")
    if (
        normalized.get("charge") != spec.charge
        or normalized.get("multiplicity") != spec.multiplicity
    ):
        raise ResultGroundingError("Normalized input electronic state differs from approval.")
    if (
        normalized.get("task") != spec.task_type.value
        or normalized.get("method") != spec.method.identifier.lower()
        or normalized.get("basis") != (spec.basis.identifier.lower() if spec.basis else None)
    ):
        raise ResultGroundingError("Normalized input task/method/basis differs from approval.")
    version = session.get(StructureVersionRecord, input_row.structure_version_id)
    canonical, _, _ = normalized_calculation_input(
        version, spec, max_atoms=len(version.representation_json["coordinates"]["atoms"])
    )
    if any(
        normalized.get(key) != canonical.get(key)
        for key in ("atoms", "atom_ordering", "coordinate_unit", "scf", "property_requests")
    ):
        raise ResultGroundingError(
            "Normalized geometry/parameters differ from authoritative input."
        )
    if {json.dumps(ref, sort_keys=True) for ref in row.raw_artifacts_json} != {
        json.dumps(ref, sort_keys=True) for ref in attempt.raw_artifacts_json
    } or provenance.operation_version != engine.get("adapter_version"):
        raise ResultGroundingError("Result artifacts/engine version differ from native attempt.")
    if not row.raw_artifacts_json:
        raise ResultGroundingError("No raw native engine evidence was preserved.")
    native_candidate, native_log = None, None
    for ref in row.raw_artifacts_json:
        if str(ref.get("project_id")) != run.project_id:
            raise ResultGroundingError("Raw result evidence belongs to another project.")
        artifact, data = _artifact_bytes(
            session, store, run.project_id, ref["artifact_id"], ref["sha256"]
        )
        if (
            artifact.kind == "NORMALIZED_RESULT"
            and artifact.format_identifier == "chemdft.worker.energy"
        ):
            native_candidate = json.loads(data)
        elif artifact.kind == "ENGINE_LOG":
            native_log = data
    _artifact_bytes(session, store, run.project_id, provenance.source_artifact_id)
    proof = {
        "calculation_id": calculation.id,
        "calculation_input_id": input_row.id,
        "structure_version_id": input_row.structure_version_id,
        "project_id": run.project_id,
        "result_id": row.id,
        "result_type": row.result_type,
        "provenance_record_id": provenance.id,
        "producer_attestation_id": row.producer_attestation_id,
        "engine": engine,
        "specification": spec.model_dump(mode="json"),
        "input_sha256": normalized_artifact.sha256,
        "result_payload_sha256": _fingerprint(row.payload_json),
        "raw_artifacts": row.raw_artifacts_json,
        "claims": [],
        "verification_state": row.verification_state,
        "validation_state": row.validation_state,
    }
    description = (
        f"Calculation {calculation.id} completed: {spec.task_type.value}; "
        f"engine {engine['name']} {engine['version']}; method {spec.method.identifier}; "
        f"basis {spec.basis.identifier if spec.basis else 'not applicable'}; "
        f"structure version {input_row.structure_version_id}; charge {spec.charge}; "
        f"multiplicity {spec.multiplicity}. Result {row.id}; provenance {provenance.id}. "
    )
    if row.result_type == "chemdft.energy":
        payload = EnergyResult.model_validate(row.payload_json)
        if native_candidate is None or native_log is None:
            raise ResultGroundingError("Retained native energy candidate/log is missing.")
        if (
            _validate_energy_candidate(native_candidate).model_dump(mode="json")
            != payload.model_dump(mode="json")
            or native_candidate.get("engine") != engine["name"]
            or native_candidate.get("engine_version") != engine["version"]
            or native_candidate.get("charge") != spec.charge
            or native_candidate.get("multiplicity") != spec.multiplicity
        ):
            raise ResultGroundingError("Published energy differs from retained native output.")
        if engine["name"] == "pyscf":
            _require_pyscf_log_energy(native_candidate, native_log)
        if (
            spec.task_type.value != "ENERGY"
            or payload.total_energy.unit.code != "Eh"
            or payload.method != spec.method.identifier.lower()
            or payload.basis != (spec.basis.identifier.lower() if spec.basis else None)
            or provenance.source_artifact_id != input_row.normalized_input_artifact_id
        ):
            raise ResultGroundingError(
                "Energy units/method/basis/task do not match immutable input."
            )
        quantity = payload.total_energy.model_dump(mode="json")
        proof["claims"] = [{"field": "payload.total_energy", "quantity": quantity}]
        proof["converged"] = payload.converged
        description += (
            f"Authoritative energy: {payload.total_energy.value} {payload.total_energy.unit.code}. "
            "SCF converged: true (persisted result field). "
        )
    else:
        # Other accepted result schemas remain retrievable, but never get an invented energy,
        # geometry or other task-specific numerical summary from this completion path.
        description += "Task-specific numerical summary: INSUFFICIENT SCIENTIFIC EVIDENCE. "
    description += (
        "Published through the Scientific Result Firewall; raw engine artifacts are retained. "
        f"Independent verification state: {row.verification_state}. "
        "No absent orbital, frequency, thermochemical or optimized-geometry values are inferred."
    )
    return proof, description


def continue_calculation_run(session, identity, project_id, run_id, store, *, trigger="resume"):
    """Exactly one terminal message/event transaction; Stop/Pause or a competing caller wins."""
    project, member = authorize_project_access(session, identity, project_id)
    conditions = [AIRunRecord.id == run_id, AIRunRecord.project_id == project.id]
    if not isinstance(identity, ServiceIdentity):
        require_capability(member, ProjectCapability.WRITE)
        conditions.append(AIRunRecord.actor_id == identity.user_id)
    run = session.scalar(
        select(AIRunRecord).where(*conditions).execution_options(populate_existing=True)
    )
    if run is None:
        raise ScientificReferenceNotFound("Run does not exist.")
    if isinstance(identity, ServiceIdentity):
        # The automatic actor remains the real compute service, bound to this exact job.
        # Separately verify the approving human still has WRITE; never grant a human role to it.
        job = session.get(ComputeJobRecord, identity.work_id)
        if (
            identity.service != "compute-worker"
            or job is None
            or (job.calculation_id != run.waiting_calculation_id or job.project_id != project.id)
        ):
            raise ProjectAccessDenied()
        _, human_member = authorize_project_access(
            session, Identity(run.actor_id, project.organization_id), project.id
        )
        require_capability(human_member, ProjectCapability.WRITE)
    events = AIRunEventManager(session)
    manager = AIRunExecutionManager(session, events)
    fence = manager.read_fence(project.id, run.id)
    if fence.status != "WAITING_FOR_CALCULATION" or not run.waiting_calculation_id:
        return False
    proof = {"calculation_id": run.waiting_calculation_id, "trigger": trigger}
    try:
        calculation, input_row, command = approved_calculation(
            session, run, run.waiting_calculation_id
        )
        if calculation.state not in TERMINAL_CALCULATIONS:
            return False
        if calculation.state == "SUCCEEDED":
            # Also checks the project's canonical job/result response, not a model narrative.
            detail = get_calculation(session, identity, project.id, calculation.id)
            if not detail.compute_job or detail.compute_job.state != "SUCCEEDED":
                raise ResultGroundingError("Result's compute job did not succeed.")
            proof, explanation = grounded_result(
                session, store, run, calculation, input_row, command
            )
            proof["trigger"] = trigger
            proof["completion_actor"] = identity.user_id
            proof["completion_principal_type"] = identity.principal_type
            target, error_code = "SUCCEEDED", None
        else:
            target = calculation.state
            error_code = f"CALCULATION_{target}"
            explanation = f"Calculation {calculation.id} reached {target}. RESULT NOT AVAILABLE."
    except TransientGroundingError as transient_err:
        session.rollback()
        # Serialise attempt accounting per run: the row lock (PostgreSQL) makes competing workers
        # count one at a time, and the fence re-check refuses a run Stop/Resume has since moved.
        locked = session.execute(
            select(AIRunRecord.status, AIRunRecord.fencing_epoch)
            .where(AIRunRecord.id == run.id, AIRunRecord.project_id == project.id)
            .with_for_update()
        ).one_or_none()
        if (
            locked is None
            or locked[0] != "WAITING_FOR_CALCULATION"
            or int(locked[1]) != fence.epoch
        ):
            session.rollback()
            return False
        transient_attempts, last_attempt_at = session.execute(
            select(func.count(AIRunEventRecord.id), func.max(AIRunEventRecord.occurred_at)).where(
                AIRunEventRecord.run_id == run.id,
                AIRunEventRecord.event_type == "calculation.grounding_transient_failure",
            )
        ).one()
        transient_attempts = transient_attempts or 0
        if last_attempt_at is not None:
            if last_attempt_at.tzinfo is None:
                last_attempt_at = last_attempt_at.replace(tzinfo=UTC)
            elapsed = (utc_now() - last_attempt_at).total_seconds()
            if elapsed < TRANSIENT_RETRY_COOLDOWN_SECONDS:
                session.rollback()  # still inside the pacing window; no attempt is consumed
                return False
        attempt_num = transient_attempts + 1
        if attempt_num < MAX_TRANSIENT_GROUNDING_ATTEMPTS:
            summary = (
                f"Transient storage failure during result retrieval "
                f"(attempt {attempt_num}/{MAX_TRANSIENT_GROUNDING_ATTEMPTS}): {transient_err}. "
                "Run remains WAITING_FOR_CALCULATION."
            )
            events.record_event(
                project.id,
                run.id,
                "calculation.grounding_transient_failure",
                summary,
                {
                    "calculation_id": run.waiting_calculation_id,
                    "attempt": attempt_num,
                    "max_attempts": MAX_TRANSIENT_GROUNDING_ATTEMPTS,
                    "error": str(transient_err),
                    "retryable": True,
                },
                epoch=fence.epoch,
            )
            session.commit()
            return False
        events.record_event(
            project.id,
            run.id,
            "calculation.grounding_transient_failure",
            (
                f"Transient storage failure exhausted after {attempt_num} attempts: "
                f"{transient_err}. Transitioning to FAILED."
            ),
            {
                "calculation_id": run.waiting_calculation_id,
                "attempt": attempt_num,
                "max_attempts": MAX_TRANSIENT_GROUNDING_ATTEMPTS,
                "error": str(transient_err),
                "retryable": False,
            },
            epoch=fence.epoch,
        )
        target = "FAILED"
        error_code = "TRANSIENT_GROUNDING_EXHAUSTED"
        explanation = (
            f"RESULT NOT AVAILABLE. Infrastructure retrieval failed after "
            f"{MAX_TRANSIENT_GROUNDING_ATTEMPTS} attempts: {transient_err}"
        )
    except (
        ResultGroundingError,
        ValueError,
        ValidationError,
        ApplicationError,
        KeyError,
        TypeError,
        json.JSONDecodeError,
    ) as error:
        # Current authorization is checked above, outside this result-failure handler.
        target, error_code = "FAILED", "INSUFFICIENT_SCIENTIFIC_EVIDENCE"
        explanation = f"RESULT NOT AVAILABLE. INSUFFICIENT SCIENTIFIC EVIDENCE: {error}"
    citations = []
    if target == "SUCCEEDED":
        citations = [
            {
                "citation_type": "CALCULATION",
                "entity_id": proof["calculation_id"],
                "label": "Completed engine calculation",
                "reference_text": explanation,
                "source_record_type": "calculation",
            },
            {
                "citation_type": "PROJECT_RECORD",
                "entity_id": proof["result_id"],
                "label": "Authoritative engine result",
                "reference_text": "Persisted engine result",
                "source_record_type": "calculation_result",
            },
        ]
    session.add(
        AIMessageRecord(
            project_id=project.id,
            conversation_id=run.conversation_id,
            run_id=run.id,
            role="assistant",
            content=explanation,
            citations_json=citations,
            evidence_status="SUPPORTED" if target == "SUCCEEDED" else "INSUFFICIENT_EVIDENCE",
        )
    )
    completed_at = utc_now()
    session.add(
        AIRunStepRecord(
            project_id=project.id,
            run_id=run.id,
            step_number=run.current_step + 1,
            step_type="CALCULATION_COMPLETION",
            status="SUCCEEDED" if target == "SUCCEEDED" else target,
            tool_name="calculation.get",
            tool_input_json={"calculation_id": run.waiting_calculation_id},
            tool_output_json=proof,
            summary=explanation,
            error_code=error_code,
            created_at=completed_at,
            finished_at=completed_at,
        )
    )
    run.current_step += 1
    try:
        manager.transition(
            project.id,
            run.id,
            fence.epoch,
            target,
            from_states=("WAITING_FOR_CALCULATION",),
            error_code=error_code,
            error_detail=explanation if error_code else None,
            event=(
                "calculation.result_available"
                if target == "SUCCEEDED"
                else f"calculation.{target.lower()}",
                explanation,
                proof,
            ),
        )
    except StaleWorkerFencedError:
        session.rollback()
        return False
    return True


def reconcile_completed_calculations(session, store, *, limit=50):
    """Bounded recovery scan inside the existing worker, using current human authorization.

    A result committed just before a worker restart is found on the next poll. No engine is run
    here, and no model credential is used. Revoked permissions leave the run waiting for an
    authorized researcher; a service principal never gets standing human project privileges.
    """
    _recover_submitted_runs(session, limit=limit)
    waiting = session.execute(
        select(AIRunRecord.id, AIRunRecord.project_id, ComputeJobRecord.id)
        .join(
            ComputeJobRecord,
            (ComputeJobRecord.calculation_id == AIRunRecord.waiting_calculation_id)
            & (ComputeJobRecord.project_id == AIRunRecord.project_id),
        )
        .join(
            CalculationRecord,
            (CalculationRecord.id == AIRunRecord.waiting_calculation_id)
            & (CalculationRecord.project_id == AIRunRecord.project_id),
        )
        .where(
            AIRunRecord.status == "WAITING_FOR_CALCULATION",
            CalculationRecord.state.in_(TERMINAL_CALCULATIONS),
        )
        .order_by(AIRunRecord.updated_at)
        .limit(limit)
    ).all()
    completed = 0
    from ..service_principals import SERVICE_COMPUTE_WORKER, service_identity_for_work

    for run_id, project_id, job_id in waiting:
        try:
            completed += continue_calculation_run(
                session,
                service_identity_for_work(session, SERVICE_COMPUTE_WORKER, job_id),
                project_id,
                run_id,
                store,
                trigger="compute_worker",
            )
        except ApplicationError:
            session.rollback()  # deleted/revoked human access; do not publish output as a service
    return completed


def _recover_submitted_runs(session, *, limit):
    """Recover the commit gap between native queue creation and the API's waiting transition.

    No resubmission is needed: approval consumption and job creation commit together. The exact
    idempotency identity finds that already-authorized effect after a process interruption.
    """
    rows = session.execute(
        select(AIRunRecord, CalculationRecord.id)
        .join(AIApprovalRecord, AIApprovalRecord.run_id == AIRunRecord.id)
        .join(
            CalculationRecord,
            (
                (CalculationRecord.idempotency_key == "ai-approval:" + AIApprovalRecord.id)
                & (CalculationRecord.project_id == AIRunRecord.project_id)
            ),
        )
        .where(
            AIRunRecord.status == "EXECUTING",
            AIApprovalRecord.project_id == AIRunRecord.project_id,
            AIApprovalRecord.status == "APPROVED",
            AIApprovalRecord.consumed_at.is_not(None),
            AIApprovalRecord.tool_name == "calculation.submit",
        )
        .order_by(AIRunRecord.updated_at)
        .limit(limit)
    ).all()
    for run, calculation_id in rows:
        try:
            project = session.get(Project, run.project_id)
            _, member = authorize_project_access(
                session, Identity(run.actor_id, project.organization_id), project.id
            )
            require_capability(member, ProjectCapability.WRITE)
            approved_calculation(session, run, calculation_id)
            manager = AIRunExecutionManager(session, AIRunEventManager(session))
            fence = manager.read_fence(project.id, run.id)
            has_step = session.scalar(
                select(AIRunStepRecord.id).where(
                    AIRunStepRecord.run_id == run.id,
                    AIRunStepRecord.step_type == "TOOL_RESULT",
                    AIRunStepRecord.tool_name == "calculation.submit",
                )
            )
            if has_step is None:
                now = utc_now()
                step = AIRunStepRecord(
                    id=new_id(),
                    project_id=project.id,
                    run_id=run.id,
                    step_number=run.current_step + 1,
                    step_type="TOOL_RESULT",
                    status="SUCCEEDED",
                    tool_name="calculation.submit",
                    tool_version="1.0.0",
                    tool_input_json={},
                    tool_output_json={"calculation": {"id": calculation_id}},
                    summary=(
                        f"Calculation submitted successfully (Calculation ID: {calculation_id}). "
                        "Recovered from commit gap."
                    ),
                    created_at=now,
                    finished_at=now,
                )
                session.add(step)
                run.current_step += 1
            manager.transition(
                project.id,
                run.id,
                fence.epoch,
                "WAITING_FOR_CALCULATION",
                from_states=("EXECUTING",),
                waiting_calculation_id=calculation_id,
                event=(
                    "calculation.queued",
                    "Recovered the committed approved calculation.",
                    {"calculation_id": calculation_id, "recovered": True},
                ),
            )
        except (ApplicationError, ResultGroundingError, ValidationError):
            session.rollback()
