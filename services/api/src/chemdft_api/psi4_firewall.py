"""Psi4-specific authoritative validation inside the existing Result Firewall transaction."""

from __future__ import annotations

import json
from datetime import UTC

from sqlalchemy import select, update

from .contracts.scientific import CalculationSpecification
from .errors import ScientificValidationFailed
from .models import utc_now
from .scientific.engines.normalization import normalized_calculation_input
from .scientific.engines.psi4 import (
    ADAPTER_VERSION,
    MAX_FILE,
    MAX_RETAINED,
    MEMORY_BYTES,
    VERSION,
    digest,
    encode,
    environment_identity,
    parse_evidence,
    validate_specification,
)
from .scientific.engines.registry import configured_path
from .scientific_models import (
    CalculationAttemptRecord,
    ComputeExecutionRecord,
    ComputeJobRecord,
    ComputeLeaseRecord,
    ComputeReservationRecord,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from .trusted_producers import ProducerType


def validate_psi4_publication(
    session,
    producer,
    submission,
    calculation,
    calculation_input,
    provenance,
    input_artifact,
    object_store,
    settings,
):
    def require(ok, message):
        if not ok:
            raise ScientificValidationFailed(message)

    require(
        object_store is not None and settings is not None,
        "Psi4 Firewall requires persisted native evidence",
    )
    session.flush()
    project = calculation.project_id
    require(
        producer.producer_id == "local.psi4.worker"
        and producer.producer_type == ProducerType.SCIENTIFIC_WORKER,
        "Psi4 trusted producer identity differs",
    )
    require(
        submission.producer_software.name == "psi4"
        and submission.producer_software.version == VERSION
        and submission.producer_software.adapter_version == ADAPTER_VERSION
        and submission.producer_software.execution_backend == "local.subprocess"
        and submission.producer_software.capabilities == ("chemdft.energy",)
        and submission.producer_software.environment_artifact is not None,
        "Psi4 software identity differs",
    )
    spec = CalculationSpecification.model_validate(calculation_input.specification_json)
    try:
        validate_specification(spec)
    except ValueError as error:
        raise ScientificValidationFailed(str(error)) from error
    require(
        spec.engine_preference.engine == "psi4"
        and provenance.producer_identifier == producer.producer_id
        and provenance.source_artifact_id == input_artifact.id,
        "Psi4 input/provenance identity differs",
    )
    limit = min(MAX_FILE, settings.scientific_max_output_bytes)

    def read(ref, expected_format=None):
        record = session.get(ScientificArtifactRecord, str(ref.artifact_id))
        require(
            record is not None
            and record.project_id == project
            and record.sha256 == ref.sha256
            and record.source_relation_type == "calculation.record"
            and record.source_relation_id == calculation.id,
            "Psi4 artifact owner/hash/association differs",
        )
        require(
            expected_format is None or record.format_identifier == expected_format,
            "Psi4 artifact type differs",
        )
        data = object_store.get_bytes(record.storage_key, limit)
        require(
            len(data) == record.size_bytes and digest(data) == record.sha256,
            "Persisted Psi4 artifact bytes/hash differ",
        )
        return record, data

    try:
        require(len(submission.raw_artifacts) <= 32, "Too many Psi4 artifacts")
        raw = {}
        for ref in submission.raw_artifacts:
            record = session.get(ScientificArtifactRecord, str(ref.artifact_id))
            if record is not None and record.format_identifier.startswith("psi4.native."):
                name = record.format_identifier.removeprefix("psi4.native.")
                require(name not in raw, "Duplicate Psi4 native artifact")
                _, raw[name] = read(ref)
        require(
            sum(map(len, raw.values())) <= MAX_RETAINED,
            "Psi4 aggregate native evidence exceeds limit",
        )
        input_bytes = object_store.get_bytes(input_artifact.storage_key, limit)
        require(
            digest(input_bytes) == input_artifact.sha256
            and len(input_bytes) == input_artifact.size_bytes,
            "Psi4 immutable normalized input hash differs",
        )
        document = json.loads(input_bytes)
        version = session.get(StructureVersionRecord, calculation_input.structure_version_id)
        require(
            version is not None and version.project_id == project,
            "Psi4 original StructureVersion missing",
        )
        canonical = session.get(ScientificArtifactRecord, version.canonical_artifact_id)
        require(
            canonical is not None
            and canonical.project_id == project
            and canonical.sha256 == document["input_structure_hash"],
            "Psi4 source structure hash differs",
        )
        require(
            digest(object_store.get_bytes(canonical.storage_key, limit)) == canonical.sha256,
            "Psi4 original structure artifact bytes differ",
        )
        rebuilt, _, _ = normalized_calculation_input(
            version, spec, max_atoms=settings.scientific_max_atoms
        )
        for key in ["input_structure_hash", "specification_hash"]:
            rebuilt[key] = (
                canonical.sha256
                if key == "input_structure_hash"
                else digest(encode(spec.model_dump(mode="json")))
            )
        require(
            document == rebuilt and input_bytes == encode(rebuilt),
            "Psi4 immutable structure/settings association differs",
        )
        parsed = parse_evidence(raw, document)
        inv = json.loads(raw["invocation.json"])
        require(inv["calculation_id"] == calculation.id, "Psi4 native calculation identity differs")
        execution = session.get(ComputeExecutionRecord, inv["execution_id"])
        require(
            execution is not None
            and execution.project_id == project
            and execution.calculation_id == calculation.id
            and execution.state == "RUNNING"
            and execution.worker_id == execution.lease_owner == "local.psi4.worker",
            "Psi4 authorized execution identity differs",
        )
        job = session.get(ComputeJobRecord, execution.job_id)
        require(
            job is not None
            and job.project_id == project
            and job.calculation_id == calculation.id
            and job.calculation_input_id == calculation_input.id
            and job.state == "RUNNING"
            and job.workload_json
            == {"workload_type": "chemdft.psi4.energy.v1", "workload_version": "1.0.0"},
            "Psi4 job authorization differs or is canceled",
        )
        require(
            execution.authorization_hash
            and execution.authorization_expires_at.replace(tzinfo=UTC) > utc_now(),
            "Psi4 execution authorization expired",
        )
        attempt = session.get(CalculationAttemptRecord, execution.calculation_attempt_id)
        require(
            attempt is not None
            and attempt.project_id == project
            and attempt.calculation_id == calculation.id
            and attempt.state == "SUCCEEDED"
            and attempt.attempt_number == inv["attempt_number"]
            and attempt.worker_id == "local.psi4.worker"
            and attempt.engine_identity_json == submission.producer_software.model_dump(mode="json")
            and attempt.raw_artifacts_json
            == [r.model_dump(mode="json") for r in submission.raw_artifacts],
            "Psi4 native execution/attempt/engine/evidence association differs",
        )
        require(
            producer.attestation_id == f"execution:{execution.id}:attempt:{attempt.attempt_number}",
            "Psi4 trusted execution attestation differs",
        )
        require(
            not session.scalar(
                select(ComputeExecutionRecord.id).where(
                    ComputeExecutionRecord.job_id == job.id,
                    ComputeExecutionRecord.id != execution.id,
                    ComputeExecutionRecord.started_at >= execution.started_at,
                )
            ),
            "Psi4 execution has been superseded",
        )
        reservation = session.get(ComputeReservationRecord, job.reservation_id)
        require(
            reservation is not None
            and reservation.project_id == project
            and reservation.state == "RESERVED",
            "Psi4 resource reservation is not owned/live",
        )
        from .compute_gateway import requirement_hash
        from .contracts.catalog import ComputeRequirement

        require(
            requirement_hash(ComputeRequirement.model_validate(job.requirement_json))
            == job.requirement_hash,
            "Psi4 authorized resource requirement hash differs",
        )
        require(
            job.requirement_json["cpu_count"] == 1
            and job.requirement_json["memory_bytes"] == MEMORY_BYTES
            and job.requirement_json["runtime_limit_seconds"] == inv["wall_seconds"]
            and job.requirement_json["temporary_storage_bytes"] == inv["directory_limit_bytes"],
            "Psi4 resource requirement differs from native execution",
        )
        lease = session.scalar(
            select(ComputeLeaseRecord).where(
                ComputeLeaseRecord.execution_id == execution.id,
                ComputeLeaseRecord.state == "ACTIVE",
            )
        )
        require(
            lease is not None
            and lease.project_id == project
            and lease.job_id == job.id
            and lease.owner == execution.lease_owner,
            "Psi4 live lease ownership differs",
        )
        require(
            submission.producer_software.environment_artifact in submission.raw_artifacts,
            "Psi4 attempt lacks its environment artifact",
        )
        _, env_bytes = read(
            submission.producer_software.environment_artifact, "chemdft.environment_manifest"
        )
        actual_identity = environment_identity(configured_path(settings.psi4_executable))
        require(
            json.loads(env_bytes) == inv["runtime_identity"] == actual_identity,
            "Psi4 native/persisted/installed environment identity differs",
        )
        require(
            submission.producer_software.environment_digest == digest(env_bytes),
            "Psi4 environment digest differs",
        )
        require(
            submission.payload.total_energy.value == parsed["total_energy_hartree"]
            and submission.payload.scf_iterations == parsed["scf_iterations"],
            "Psi4 proposed energy contradicts authoritative native evidence",
        )
        candidates = []
        for ref in submission.raw_artifacts:
            record = session.get(ScientificArtifactRecord, str(ref.artifact_id))
            if record is not None and record.format_identifier == "chemdft.worker.energy":
                _, data = read(ref)
                candidates.append(json.loads(data))
        require(
            len(candidates) == 1 and all(candidates[0].get(k) == v for k, v in parsed.items()),
            "Psi4 normalized result contradicts native geometry/energy evidence",
        )
        require(
            session.execute(
                update(ComputeLeaseRecord)
                .where(
                    ComputeLeaseRecord.id == lease.id,
                    ComputeLeaseRecord.state == "ACTIVE",
                    ComputeLeaseRecord.expires_at > utc_now(),
                    ComputeLeaseRecord.heartbeat_deadline_at > utc_now(),
                )
                .values(expires_at=ComputeLeaseRecord.expires_at)
                .execution_options(synchronize_session=False)
            ).rowcount
            == 1,
            "Psi4 lease expired before publication",
        )
    except ScientificValidationFailed:
        raise
    except (ValueError, OSError, KeyError, TypeError, IndexError) as error:
        raise ScientificValidationFailed(
            "Psi4 native publication rejected: " + str(error)
        ) from error
