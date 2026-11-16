import io
from pathlib import Path

import pytest
from chemdft_reconstruction.contracts import ReconstructionStatus
from chemdft_reconstruction.decimer_adapter import DecimerReconstructor, _validate_model_cache
from PIL import Image


def _image_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (24, 24), "white").save(output, format="PNG")
    return output.getvalue()


def test_adapter_records_parse_failure_without_repairing_or_inventing_confidence():
    adapter = DecimerReconstructor(
        predictor=lambda _image: "C1(", model_version="2.8.0", model_id="DECIMER-V2"
    )
    result = adapter.reconstruct(_image_bytes(), {"image_id": "bad-smiles"})

    assert result.status is ReconstructionStatus.PARSE_FAILED
    assert result.smiles == "C1("
    assert result.confidence is None
    assert any("RDKit" in item for item in result.diagnostics)


def test_adapter_marks_valid_prediction_as_review_required_and_non_authoritative():
    adapter = DecimerReconstructor(
        predictor=lambda _image: "CCO", model_version="2.8.0", model_id="DECIMER-V2"
    )
    result = adapter.reconstruct(_image_bytes(), {"image_id": "ethanol"})

    assert result.status is ReconstructionStatus.MANUAL_REVIEW_REQUIRED
    assert result.representation_type == "SMILES"
    assert result.smiles == "CCO"
    assert result.authority == "NON_AUTHORITATIVE_CANDIDATE_ONLY"
    assert result.confidence is None


def test_multifragment_prediction_is_ambiguous_not_silently_reduced():
    adapter = DecimerReconstructor(
        predictor=lambda _image: "CCO.O", model_version="2.8.0", model_id="DECIMER-V2"
    )
    result = adapter.reconstruct(_image_bytes(), {"image_id": "two-fragments"})

    assert result.status is ReconstructionStatus.AMBIGUOUS
    assert result.fragment_count == 2
    assert result.smiles == "CCO.O"
    assert result.representation_type == "SMILES"
    assert result.parse_state == "PARSED"


def test_invalid_image_abstains_before_calling_predictor():
    calls = 0

    def predictor(_image):
        nonlocal calls
        calls += 1
        return "CCO"

    adapter = DecimerReconstructor(predictor=predictor, model_version="2.8.0")
    result = adapter.reconstruct(b"not an image", {"image_id": "bad-image"})

    assert result.status is ReconstructionStatus.UNSUPPORTED
    assert calls == 0


def test_adapter_is_repeatable_for_deterministic_inference_output():
    adapter = DecimerReconstructor(
        predictor=lambda _image: "CCO", model_version="2.8.0", model_id="DECIMER-V2"
    )
    first = adapter.reconstruct(_image_bytes(), {"image_id": "ethanol"})
    second = adapter.reconstruct(_image_bytes(), {"image_id": "ethanol"})

    assert (first.status, first.smiles, first.formula, first.formal_charge) == (
        second.status,
        second.smiles,
        second.formula,
        second.formal_charge,
    )


def test_missing_model_cache_fails_closed_before_decimer_import(tmp_path: Path):
    with pytest.raises(RuntimeError, match="Offline model missing"):
        _validate_model_cache(tmp_path)


def test_out_of_domain_chemistry_is_not_emitted_as_candidate_representation():
    adapter = DecimerReconstructor(
        predictor=lambda _image: "CCO", model_version="2.8.0", model_id="DECIMER-V2"
    )
    result = adapter.reconstruct(
        _image_bytes(), {"image_id": "crystal", "category": "crystal_diagram"}
    )

    assert result.status is ReconstructionStatus.UNSUPPORTED
    assert result.parse_state == "PARSED"
    assert result.representation_type is None
    assert result.smiles == "CCO"  # retained only for offline evaluation metrics
