import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import pytest
from chemdft_api.contracts.artifacts import ScientificArtifact
from chemdft_api.contracts.base import ArtifactReference, EntityReference
from chemdft_api.contracts.catalog import CalculationSubmitInput
from chemdft_api.contracts.generate import SCHEMA_PATH, rendered_schema
from chemdft_api.contracts.provenance import (
    CorrectionValue,
    ProvenanceInput,
    ProvenanceRecord,
    UserCorrection,
)
from chemdft_api.contracts.results import AuthoritativeResultSubmission, ResultAuthority
from chemdft_api.contracts.scientific import (
    CalculationInput,
    CalculationSpecification,
    Experiment,
    ScientificQuantity,
    StructureVersion,
)
from chemdft_api.contracts.tools import ToolDefinition
from pydantic import TypeAdapter, ValidationError

FIXTURES = Path(__file__).parent / "fixtures/contracts"
PROJECT_ID = UUID("10000000-0000-4000-8000-000000000001")
OTHER_PROJECT_ID = UUID("20000000-0000-4000-8000-000000000001")


@pytest.mark.parametrize(
    ("filename", "model"),
    [
        ("calculation-specification.json", CalculationSpecification),
        ("structure-version.json", StructureVersion),
        ("provenance-record.json", ProvenanceRecord),
        ("tool-definition.json", ToolDefinition),
        ("result-envelope.json", AuthoritativeResultSubmission),
    ],
)
def test_synthetic_golden_contracts_roundtrip(filename, model) -> None:
    value = model.model_validate_json((FIXTURES / filename).read_text())
    assert model.model_validate(value.model_dump(mode="json")) == value


def test_json_schema_generation_is_deterministic_and_current() -> None:
    first = rendered_schema()
    second = rendered_schema()
    assert first == second
    assert SCHEMA_PATH.read_text() == first


def test_contract_versions_authority_units_and_hashes_are_strict() -> None:
    with pytest.raises(ValidationError):
        CalculationSpecification.model_validate(
            {
                **json.loads((FIXTURES / "calculation-specification.json").read_text()),
                "schema_version": "0.9.0",
            }
        )
    with pytest.raises(ValidationError):
        TypeAdapter(ResultAuthority).validate_python("TRUSTED")
    with pytest.raises(ValidationError):
        ScientificQuantity.model_validate({"value": 1.0})
    with pytest.raises(ValidationError):
        ScientificQuantity.model_validate(
            {
                "value": 1.0,
                "unit": {"standard": "FREE_TEXT", "code": "maybe", "dimension": "ENERGY"},
            }
        )
    with pytest.raises(ValidationError):
        ArtifactReference.model_validate(
            {
                "project_id": str(PROJECT_ID),
                "artifact_id": "10000000-0000-4000-8000-000000000004",
                "sha256": "not-a-hash",
            }
        )
    result_submission = json.loads((FIXTURES / "result-envelope.json").read_text())
    result_submission["authority"] = "AUTHORITATIVE"
    result_submission["verification_state"] = "VERIFIED"
    result_submission["trusted_producer_id"] = "model-controlled"
    with pytest.raises(ValidationError):
        AuthoritativeResultSubmission.model_validate(result_submission)

    calculation_submission = {
        "structure_version": {
            "project_id": str(PROJECT_ID),
            "entity_type": "structure.version",
            "entity_id": "10000000-0000-4000-8000-000000000003",
        },
        "specification": json.loads((FIXTURES / "calculation-specification.json").read_text()),
        "normalized_input_artifact": {
            "project_id": str(PROJECT_ID),
            "artifact_id": "10000000-0000-4000-8000-000000000004",
            "sha256": "a" * 64,
        },
    }
    with pytest.raises(ValidationError):
        CalculationSubmitInput.model_validate(calculation_submission)


def test_structure_versions_are_immutable() -> None:
    version = StructureVersion.model_validate_json(
        (FIXTURES / "structure-version.json").read_text()
    )
    with pytest.raises(ValidationError):
        version.revision = 2


def test_provenance_lineage_is_typed_scoped_and_not_self_authorizing() -> None:
    with pytest.raises(ValidationError):
        ProvenanceInput(
            entity=EntityReference(
                project_id=PROJECT_ID,
                entity_type="structure.version",
                entity_id=UUID("10000000-0000-4000-8000-000000000003"),
            ),
            artifact=ArtifactReference(
                project_id=PROJECT_ID,
                artifact_id=UUID("10000000-0000-4000-8000-000000000004"),
                sha256="a" * 64,
            ),
        )

    payload = json.loads((FIXTURES / "provenance-record.json").read_text())
    payload["subject"]["project_id"] = str(OTHER_PROJECT_ID)
    with pytest.raises(ValidationError):
        ProvenanceRecord.model_validate(payload)

    payload = json.loads((FIXTURES / "provenance-record.json").read_text())
    payload["source_class"] = "AI_HYPOTHESIS"
    payload["verification_state"] = "VERIFIED"
    with pytest.raises(ValidationError):
        ProvenanceRecord.model_validate(payload)


def test_correction_preserves_the_original_reference() -> None:
    original = EntityReference(
        project_id=PROJECT_ID,
        entity_type="experiment.dataset",
        entity_id=UUID("10000000-0000-4000-8000-000000000011"),
    )
    correction = UserCorrection(
        id=UUID("10000000-0000-4000-8000-000000000012"),
        project_id=PROJECT_ID,
        original=original,
        corrected_value=CorrectionValue(text="Synthetic corrected annotation"),
        author_id=UUID("10000000-0000-4000-8000-000000000005"),
        reason="Synthetic fixture correction",
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    with pytest.raises(ValidationError):
        correction.original = EntityReference(
            project_id=PROJECT_ID,
            entity_type="experiment.dataset",
            entity_id=UUID("10000000-0000-4000-8000-000000000013"),
        )
    assert correction.original == original


def test_calculation_input_rejects_cross_project_references() -> None:
    specification = CalculationSpecification.model_validate_json(
        (FIXTURES / "calculation-specification.json").read_text()
    )
    with pytest.raises(ValidationError):
        CalculationInput(
            id=UUID("10000000-0000-4000-8000-000000000014"),
            project_id=PROJECT_ID,
            calculation_id=UUID("10000000-0000-4000-8000-000000000007"),
            structure_version=EntityReference(
                project_id=OTHER_PROJECT_ID,
                entity_type="structure.version",
                entity_id=UUID("10000000-0000-4000-8000-000000000003"),
            ),
            specification=specification,
            normalized_input_artifact=ArtifactReference(
                project_id=PROJECT_ID,
                artifact_id=UUID("10000000-0000-4000-8000-000000000004"),
                sha256="a" * 64,
            ),
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
        )


def test_extension_metadata_is_bounded_instead_of_recursive() -> None:
    artifact = {
        "id": "10000000-0000-4000-8000-000000000004",
        "project_id": str(PROJECT_ID),
        "kind": "RAW_UPLOAD",
        "media_type": "application/octet-stream",
        "format_identifier": "synthetic",
        "size_bytes": 0,
        "sha256": "a" * 64,
        "created_by": "10000000-0000-4000-8000-000000000005",
        "created_at": "2026-01-01T00:00:00Z",
        "extensions": [
            {
                "namespace": "chemdft.synthetic",
                "schema_version": "1",
                "values": [{"key": f"field-{index}", "value": index} for index in range(65)],
            }
        ],
    }
    with pytest.raises(ValidationError):
        ScientificArtifact.model_validate(artifact)
    with pytest.raises(ValidationError):
        ScientificArtifact.model_validate(
            {
                **artifact,
                "extensions": [],
                "storage_key": "projects/synthetic/raw/object",
            }
        )


def test_experiment_modality_extensions_are_discriminated() -> None:
    with pytest.raises(ValidationError):
        Experiment.model_validate(
            {
                "id": "10000000-0000-4000-8000-000000000020",
                "project_id": str(PROJECT_ID),
                "sample_id": "10000000-0000-4000-8000-000000000021",
                "modality": "FTIR",
                "name": "Synthetic modality fixture",
                "extension": {"modality": "NMR", "schema_version": "1"},
                "created_by": "10000000-0000-4000-8000-000000000005",
                "created_at": "2026-01-01T00:00:00Z",
            }
        )
