"""D4 validation called only inside the existing authoritative publisher transaction."""

from __future__ import annotations

import json
from datetime import UTC
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select, update

from .contracts.dftd4 import DispersionCorrectionSpecification
from .dftd4_actions import WORKLOAD, make_payload
from .dftd4_source import load_source, require
from .models import utc_now
from .scientific.engines.dftd4 import (
    ADAPTER_VERSION,
    MAX_FILE,
    MEMORY_BYTES,
    VERSION,
    digest,
    encode,
    environment_identity,
    parse_evidence,
)
from .scientific_models import (
    CalculationAttemptRecord,
    ComputeExecutionRecord,
    ComputeJobRecord,
    ComputeLeaseRecord,
    ComputeReservationRecord,
    ProvenanceInputRow,
    ScientificArtifactRecord,
)


def validate_dftd4_publication(
    session, producer, submission, calculation, inp, provenance, input_artifact, store, settings
):
    require(
        store is not None and settings is not None, "Firewall requires persisted native evidence"
    )
    require(
        submission.result_type == "chemdft.dispersion-corrected-energy"
        and producer.producer_id == "local.dftd4.worker"
        and producer.producer_type == "SCIENTIFIC_WORKER",
        "trusted D4 producer identity differs",
    )
    engine = submission.producer_software
    require(
        engine.name == "dftd4"
        and engine.version == VERSION
        and engine.adapter_version == ADAPTER_VERSION
        and engine.execution_backend == "local.subprocess"
        and engine.capabilities == ("chemdft.dispersion-corrected-energy",),
        "D4 software identity differs",
    )
    require(
        provenance.producer_identifier == producer.producer_id
        and provenance.source_artifact_id == input_artifact.id
        and provenance.operation == "chemdft.dispersion-correction",
        "D4 provenance differs",
    )
    spec = DispersionCorrectionSpecification.model_validate(inp.specification_json)
    source, atoms = load_source(
        session, store, settings, calculation.project_id, spec.source.result_id
    )
    require(
        source == spec.source and inp.structure_version_id == str(source.structure_version_id),
        "immutable source binding differs",
    )
    require(
        calculation.id
        == str(uuid5(NAMESPACE_URL, f"chemdft.dftd4.v1:{source.result_id}:{spec.variant_sha256}")),
        "source/variant unique identity differs",
    )
    data = store.get_bytes(input_artifact.storage_key, settings.scientific_max_output_bytes)
    runtime = environment_identity(settings.dftd4_executable)
    document = {
        "schema": "chemdft.dftd4.input.v1",
        "engine": "dftd4",
        "specification": spec.model_dump(mode="json"),
        "atoms": atoms,
        "structure_version_id": str(source.structure_version_id),
        "runtime_identity": runtime,
    }
    require(
        data == encode(document)
        and digest(data) == input_artifact.sha256
        and len(data) == input_artifact.size_bytes
        and calculation.request_hash == digest(data),
        "normalized D4 input differs",
    )
    raw, environments, candidates = {}, [], []
    require(len(submission.raw_artifacts) <= 24, "too many D4 artifacts")
    for ref in submission.raw_artifacts:
        record = session.get(ScientificArtifactRecord, str(ref.artifact_id))
        require(
            record is not None
            and record.project_id == calculation.project_id
            and ref.sha256 == record.sha256,
            "D4 artifact owner/hash differs",
        )
        content = store.get_bytes(
            record.storage_key, min(MAX_FILE, settings.scientific_max_output_bytes)
        )
        require(
            digest(content) == record.sha256 and len(content) == record.size_bytes,
            "D4 artifact bytes differ",
        )
        if record.id != input_artifact.id:
            require(
                record.source_relation_type == "calculation.record"
                and record.source_relation_id == calculation.id,
                "D4 native artifact association differs",
            )
        if record.format_identifier.startswith("dftd4.native."):
            name = record.format_identifier.removeprefix("dftd4.native.")
            require(name not in raw, "duplicate D4 native artifact")
            raw[name] = content
        elif record.format_identifier == "chemdft.environment_manifest":
            environments.append((ref, content))
        elif record.format_identifier == "chemdft.worker.energy":
            candidates.append(json.loads(content))
    parsed = parse_evidence(raw, document)
    require(
        len(environments) == 1
        and engine.environment_artifact == environments[0][0]
        and engine.environment_digest == digest(environments[0][1])
        and json.loads(environments[0][1]) == parsed["environment"] == runtime,
        "D4 environment evidence differs",
    )
    require(
        candidates == [parsed]
        and submission.payload == make_payload(spec, parsed["correction_energy_hartree"]),
        "D4 payload/candidate contradicts native evidence",
    )
    inv = json.loads(raw["invocation.json"])
    require(inv["calculation_id"] == calculation.id, "D4 native calculation differs")
    execution = session.get(ComputeExecutionRecord, inv["execution_id"])
    require(
        execution is not None
        and execution.project_id == calculation.project_id
        and execution.calculation_id == calculation.id
        and execution.state == "RUNNING"
        and execution.worker_id == execution.lease_owner == "local.dftd4.worker"
        and execution.authorization_hash
        and execution.authorization_expires_at.replace(tzinfo=UTC) > utc_now(),
        "D4 execution unauthorized/expired",
    )
    job = session.get(ComputeJobRecord, execution.job_id)
    require(
        job is not None
        and job.project_id == calculation.project_id
        and job.calculation_id == calculation.id
        and job.calculation_input_id == inp.id
        and job.workload_json == WORKLOAD
        and job.state == "RUNNING",
        "D4 job canceled/mismatched",
    )
    attempt = session.get(CalculationAttemptRecord, execution.calculation_attempt_id)
    require(
        attempt is not None
        and attempt.project_id == calculation.project_id
        and attempt.calculation_id == calculation.id
        and attempt.state == "SUCCEEDED"
        and attempt.attempt_number == inv["attempt_number"]
        and attempt.worker_id == "local.dftd4.worker"
        and attempt.engine_identity_json == engine.model_dump(mode="json")
        and attempt.raw_artifacts_json
        == [r.model_dump(mode="json") for r in submission.raw_artifacts]
        and producer.attestation_id == f"execution:{execution.id}:attempt:{attempt.attempt_number}",
        "D4 attempt/attestation differs",
    )
    require(
        not session.scalar(
            select(ComputeExecutionRecord.id).where(
                ComputeExecutionRecord.job_id == job.id,
                ComputeExecutionRecord.id != execution.id,
                ComputeExecutionRecord.started_at >= execution.started_at,
            )
        ),
        "D4 superseded execution",
    )
    from .compute_gateway import requirement_hash
    from .contracts.catalog import ComputeRequirement

    requirement = ComputeRequirement.model_validate(job.requirement_json)
    require(
        requirement_hash(requirement) == job.requirement_hash
        and requirement.cpu_count == 1
        and requirement.memory_bytes == MEMORY_BYTES
        and requirement.runtime_limit_seconds == inv["wall_seconds"]
        and requirement.temporary_storage_bytes == inv["directory_limit_bytes"],
        "D4 resource authorization differs",
    )
    reservation = session.get(ComputeReservationRecord, job.reservation_id)
    require(
        reservation is not None
        and reservation.project_id == calculation.project_id
        and reservation.state == "RESERVED",
        "D4 reservation not live",
    )
    edges = session.scalars(
        select(ProvenanceInputRow).where(ProvenanceInputRow.provenance_record_id == provenance.id)
    ).all()
    require(
        len(edges) == 1
        and edges[0].project_id == calculation.project_id
        and edges[0].input_type == "calculation.result"
        and edges[0].input_id == str(source.result_id)
        and edges[0].input_sha256 == source.result_payload_sha256,
        "D4 source provenance edge differs",
    )
    require(
        session.execute(
            update(ComputeLeaseRecord)
            .where(
                ComputeLeaseRecord.execution_id == execution.id,
                ComputeLeaseRecord.project_id == calculation.project_id,
                ComputeLeaseRecord.job_id == job.id,
                ComputeLeaseRecord.owner == execution.lease_owner,
                ComputeLeaseRecord.state == "ACTIVE",
                ComputeLeaseRecord.expires_at > utc_now(),
                ComputeLeaseRecord.heartbeat_deadline_at > utc_now(),
            )
            .values(expires_at=ComputeLeaseRecord.expires_at)
            .execution_options(synchronize_session=False)
        ).rowcount
        == 1,
        "D4 lease expired",
    )
