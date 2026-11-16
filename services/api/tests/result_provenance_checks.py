"""Persistent identity checks shared by native publication regressions."""

from chemdft_api.scientific_models import (
    CalculationAttemptRecord,
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ComputeExecutionRecord,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
)
from sqlalchemy import select


def assert_published_result_binding(sessions, result_id, structure_version_id):
    with sessions() as session:
        result = session.get(CalculationResultRecord, str(result_id))
        assert result is not None
        provenance = session.get(ProvenanceRecordRow, result.provenance_record_id)
        assert provenance is not None
        assert provenance.subject_type == "calculation.result"
        assert provenance.subject_id == result.id
        assert session.get(CalculationResultRecord, provenance.subject_id).id == result.id
        calculation = session.get(CalculationRecord, result.calculation_id)
        calculation_input = session.get(CalculationInputRecord, result.calculation_input_id)
        assert calculation_input.calculation_id == calculation.id
        assert calculation_input.structure_version_id == str(structure_version_id)
        assert {
            result.project_id,
            provenance.project_id,
            calculation.project_id,
            calculation_input.project_id,
        } == {result.project_id}
        assert calculation.state == "SUCCEEDED"
        execution = session.scalar(
            select(ComputeExecutionRecord)
            .where(ComputeExecutionRecord.calculation_id == result.calculation_id)
            .order_by(ComputeExecutionRecord.started_at.desc())
        )
        assert execution is not None and execution.project_id == result.project_id
        attempt = session.get(CalculationAttemptRecord, execution.calculation_attempt_id)
        assert attempt is not None and attempt.calculation_id == calculation.id
        assert attempt.project_id == result.project_id and attempt.state == "SUCCEEDED"
        assert result.producer_attestation_id == (
            f"execution:{execution.id}:attempt:{attempt.attempt_number}"
        )
        artifacts = [*result.raw_artifacts_json, {"artifact_id": provenance.source_artifact_id}]
        for ref in artifacts:
            artifact = session.get(ScientificArtifactRecord, ref["artifact_id"])
            assert artifact is not None and artifact.project_id == result.project_id
            if "sha256" in ref:
                assert artifact.sha256 == ref["sha256"]
        expected_source = (
            result.payload_json["trajectory_artifact"]["artifact_id"]
            if result.result_type == "chemdft.optimization"
            else calculation_input.normalized_input_artifact_id
        )
        assert provenance.source_artifact_id == expected_source
