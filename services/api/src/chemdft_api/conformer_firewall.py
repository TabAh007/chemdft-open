"""Server reparse of persisted CREST bytes before atomic authoritative acceptance."""

from __future__ import annotations

import json
from datetime import UTC

from sqlalchemy import select, update

from .conformer_actions import build_manifest
from .contracts.scientific import CalculationSpecification
from .errors import ScientificValidationFailed
from .models import utc_now
from .scientific.engines.crest import (
    CALCULATOR,
    VERSION,
    accepted_binary_digests,
    digest,
    parse_evidence,
)
from .scientific.engines.normalization import normalized_calculation_input
from .scientific_models import (
    CalculationAttemptRecord,
    ComputeExecutionRecord,
    ComputeJobRecord,
    ComputeLeaseRecord,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from .trusted_producers import ProducerType


def validate_crest_publication(
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
    def require(condition, message):
        if not condition:
            raise ScientificValidationFailed(message)

    require(
        object_store is not None and settings is not None,
        "CREST Firewall requires persisted native object access",
    )
    session.flush()
    m = submission.payload.manifest
    project = calculation.project_id
    spec = calculation_input.specification_json
    require(
        submission.result_type == "chemdft.conformer-ensemble"
        and spec.get("task_type") == "CONFORMER_SEARCH"
        and spec.get("engine_preference", {}).get("engine") == "crest",
        "CREST result/task/engine mismatch",
    )
    require(
        producer.producer_id == "local.crest.worker"
        and producer.producer_type == ProducerType.SCIENTIFIC_WORKER,
        "Incorrect CREST trusted producer",
    )
    require(
        provenance.producer_identifier == producer.producer_id
        and provenance.source_artifact_id == input_artifact.id,
        "CREST provenance producer/input mismatch",
    )
    require(
        submission.producer_software.name == "crest"
        and submission.producer_software.version == VERSION
        and submission.producer_software.environment_artifact is not None,
        "Incorrect CREST software identity",
    )
    require(
        str(m.project_id) == project
        and str(m.calculation_id) == calculation.id
        and str(m.calculation_input_id) == calculation_input.id
        and str(m.input_structure_version_id) == calculation_input.structure_version_id
        and m.calculation_input_sha256 == input_artifact.sha256,
        "CREST immutable input/execution linkage mismatch",
    )
    execution = session.get(ComputeExecutionRecord, str(m.execution_id))
    require(
        execution is not None
        and execution.project_id == project
        and execution.calculation_id == calculation.id
        and execution.state == "RUNNING",
        "CREST execution is not the current running attempt",
    )
    job = session.get(ComputeJobRecord, execution.job_id)
    require(
        job is not None
        and job.project_id == project
        and job.calculation_id == calculation.id
        and job.calculation_input_id == calculation_input.id
        and job.state == "RUNNING"
        and job.workload_json.get("workload_type") == "chemdft.crest.conformer-search.v1",
        "CREST job authorization mismatch",
    )
    require(
        execution.authorization_hash
        and execution.authorization_expires_at.replace(tzinfo=UTC) > utc_now(),
        "CREST execution authorization expired",
    )
    attempt = session.get(CalculationAttemptRecord, execution.calculation_attempt_id)
    require(
        attempt is not None
        and attempt.project_id == project
        and attempt.calculation_id == calculation.id
        and attempt.state == "SUCCEEDED"
        and attempt.attempt_number == m.attempt_number
        and attempt.worker_id == "local.crest.worker",
        "CREST attempt identity mismatch",
    )
    require(
        producer.attestation_id == f"execution:{execution.id}:attempt:{attempt.attempt_number}",
        "CREST execution attestation mismatch",
    )
    require(
        attempt.engine_identity_json == submission.producer_software.model_dump(mode="json")
        and attempt.raw_artifacts_json
        == [r.model_dump(mode="json") for r in submission.raw_artifacts],
        "CREST attempt evidence/engine mismatch",
    )
    lease = session.scalar(
        select(ComputeLeaseRecord).where(
            ComputeLeaseRecord.execution_id == execution.id, ComputeLeaseRecord.state == "ACTIVE"
        )
    )
    require(
        lease is not None
        and lease.project_id == project
        and lease.job_id == job.id
        and lease.owner == execution.lease_owner == execution.worker_id == "local.crest.worker",
        "CREST lease ownership mismatch",
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
        "CREST lease expired before publication",
    )

    def read(ref):
        record = session.get(ScientificArtifactRecord, str(ref.artifact_id))
        require(
            record is not None and record.project_id == project and record.sha256 == ref.sha256,
            "CREST artifact record/hash mismatch",
        )
        require(
            record.source_relation_id == calculation.id
            and record.source_relation_type == "calculation.record",
            "CREST artifact belongs to another execution/calculation",
        )
        data = object_store.get_bytes(record.storage_key, settings.crest_max_output_bytes)
        require(
            digest(data) == record.sha256 and len(data) == record.size_bytes,
            "Persisted CREST artifact bytes/hash mismatch",
        )
        return record, data

    try:
        input_bytes = object_store.get_bytes(
            input_artifact.storage_key, settings.scientific_max_output_bytes
        )
        require(
            digest(input_bytes) == input_artifact.sha256,
            "CREST normalized input bytes/hash mismatch",
        )
        document = json.loads(input_bytes)
        version = session.get(StructureVersionRecord, calculation_input.structure_version_id)
        require(
            version is not None and version.project_id == project,
            "CREST input StructureVersion missing",
        )
        canonical = session.get(ScientificArtifactRecord, version.canonical_artifact_id)
        require(
            canonical is not None
            and canonical.project_id == project
            and canonical.sha256 == m.input_structure_sha256 == document["input_structure_hash"],
            "CREST source StructureVersion hash mismatch",
        )
        require(
            digest(object_store.get_bytes(canonical.storage_key, settings.crest_max_output_bytes))
            == canonical.sha256,
            "CREST source StructureVersion bytes/hash mismatch",
        )
        normalized, _, _ = normalized_calculation_input(
            version,
            CalculationSpecification.model_validate(spec),
            max_atoms=50,
            crest_executable_sha256=document.get("engine_executable_sha256"),
        )
        require(
            all(
                document.get(k) == normalized.get(k)
                for k in (
                    "structure_version_id",
                    "atoms",
                    "coordinate_unit",
                    "charge",
                    "multiplicity",
                    "method",
                    "basis",
                    "conformer_search",
                    "engine",
                    "engine_version",
                    "calculator",
                    "engine_executable_sha256",
                )
            ),
            "CREST specification/structure differs from immutable native input",
        )
        require(
            m.executable_sha256
            == document["engine_executable_sha256"]
            in accepted_binary_digests(),
            "CREST executable digest mismatch",
        )
        bound_native = {
            str(ref.artifact_id)
            for ref in submission.raw_artifacts
            if (record := session.get(ScientificArtifactRecord, str(ref.artifact_id))) is not None
            and record.format_identifier.startswith("crest.native.")
        }
        require(
            bound_native == {str(item.artifact.artifact_id) for item in m.native_artifacts},
            "CREST native artifact manifest coverage mismatch",
        )
        raw = {}
        refs = []
        for item in m.native_artifacts:
            require(
                item.artifact in submission.raw_artifacts,
                "CREST native evidence not bound to attempt",
            )
            record, data = read(item.artifact)
            require(
                record.format_identifier == "crest.native." + item.name,
                "CREST native artifact identity mismatch",
            )
            raw[item.name] = data
            refs.append(item.model_dump(mode="json"))
        require(
            set(a.artifact for a in m.native_artifacts) == set(submission.payload.artifacts),
            "CREST payload artifact references mismatch",
        )
        parsed = parse_evidence(raw, document)
        require(
            json.loads(raw["invocation.json"])["calculation_id"] == calculation.id,
            "CREST native invocation calculation mismatch",
        )
        expected = build_manifest(
            parsed,
            document,
            project_id=project,
            calculation_id=calculation.id,
            input_id=calculation_input.id,
            execution_id=execution.id,
            attempt_number=attempt.attempt_number,
            created_at=attempt.started_at.replace(tzinfo=UTC),
            native_refs=refs,
        )
        require(
            expected == m,
            "CREST manifest energies/geometries/ranks/identity contradict native bytes",
        )
        require(
            submission.payload.manifest_artifact in submission.raw_artifacts,
            "CREST ensemble manifest not bound to attempt",
        )
        record, data = read(submission.payload.manifest_artifact)
        require(
            record.format_identifier == "chemdft.conformer-ensemble-manifest"
            and json.loads(data) == m.model_dump(mode="json"),
            "Persisted CREST ensemble manifest mismatch",
        )
        _env_record, env_data = read(submission.producer_software.environment_artifact)
        env = json.loads(env_data)
        require(
            env.get("executable_sha256") == document["engine_executable_sha256"]
            and env.get("calculator") == CALCULATOR
            and env.get("engine_version") == VERSION
            and env.get("engine") == "crest",
            "CREST persisted calculator/environment mismatch",
        )
        require(
            submission.producer_software.environment_digest == digest(env_data),
            "CREST environment digest mismatch",
        )
    except (ValueError, KeyError, TypeError, OSError) as error:
        raise ScientificValidationFailed(str(error)) from error
