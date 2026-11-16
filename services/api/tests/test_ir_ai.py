from __future__ import annotations

from types import SimpleNamespace

import pytest
from chemdft_api.ai.structure_inspection import (
    ir_inspection_answer,
    is_ir_request,
)


@pytest.fixture
def mock_ir_context():
    modes = [
        {
            "index": 0,
            "frequency_cm1": 1638.68,
            "imaginary": False,
            "displacement_vectors": [
                [0.0, 0.0, -0.066],
                [0.0, 0.435, 0.526],
                [0.0, -0.435, 0.526],
            ],
            "reduced_mass_amu": 1.082,
            "ir_intensity": {"value": 55.49, "unit": {"code": "km/mol"}},
            "raman_activity": None,
        },
        {
            "index": 1,
            "frequency_cm1": 3791.34,
            "imaginary": False,
            "displacement_vectors": [
                [0.0, 0.0, 0.052],
                [0.0, 0.584, -0.413],
                [0.0, -0.584, -0.413],
            ],
            "reduced_mass_amu": 1.046,
            "ir_intensity": {"value": 4.94, "unit": {"code": "km/mol"}},
            "raman_activity": None,
        },
        {
            "index": 2,
            "frequency_cm1": 3886.57,
            "imaginary": False,
            "displacement_vectors": [
                [0.0, -0.067, 0.0],
                [0.0, 0.531, 0.457],
                [0.0, 0.531, -0.457],
            ],
            "reduced_mass_amu": 1.081,
            "ir_intensity": {"value": 26.91, "unit": {"code": "km/mol"}},
            "raman_activity": None,
        },
    ]
    calc_record = {
        "id": "calc-1",
        "state": "SUCCEEDED",
        "result_id": "res-vib-1",
        "vibrational_analysis": {
            "result_id": "res-vib-1",
            "method": "B3LYP",
            "basis": "def2-SVP",
            "engine": "pyscf",
            "engine_version": "2.14.0",
            "hessian_type": "analytic",
            "dipole_derivative_method": "central_finite_difference",
            "finite_difference_step_bohr": 0.0100,
            "intensity_unit": "km/mol",
            "mode_count": len(modes),
            "modes": modes,
        },
    }
    structure = {
        "id": "s1",
        "name": "Water",
        "versions": [
            {"id": "v1", "revision": 1, "source_class": "USER_SUPPLIED", "origin": "IMPORTED"}
        ],
    }
    graph = SimpleNamespace(
        structures=(structure,),
        calculations=(calc_record,),
        current_view={"label": "Water V1 → IR → Mode 1 · 1638.7 cm⁻¹"},
    )
    return {"project_context": graph}


def test_is_ir_request_detection():
    assert is_ir_request("Which vibration is strongest?")
    assert is_ir_request("What atoms are moving in this mode?")
    assert is_ir_request("Why is this mode IR active?")
    assert is_ir_request("What does 55 km/mol mean?")
    assert is_ir_request("Why isn't the calculated frequency exactly the experimental frequency?")
    assert is_ir_request("What is the difference between this IR spectrum and UV/Vis?")
    assert not is_ir_request("What are the excitation energies for UV/Vis?")


def test_ir_ai_answers_strongest_vibration(mock_ir_context):
    ans = ir_inspection_answer(mock_ir_context, "Which vibration is strongest?")
    assert ans.status == "SUPPORTED"
    assert "Mode 1" in ans.content
    assert "1638.7" in ans.content
    assert "55.49" in ans.content
    assert ans.citations[0]["entity_id"] == "res-vib-1"


def test_ir_ai_answers_atoms_moving(mock_ir_context):
    ans = ir_inspection_answer(mock_ir_context, "What atoms are moving?")
    assert ans.status == "SUPPORTED"
    assert "Mode 1" in ans.content
    assert "H" in ans.content or "hydrogen" in ans.content.lower()


def test_ir_ai_answers_why_ir_active(mock_ir_context):
    ans = ir_inspection_answer(mock_ir_context, "Why is this mode IR active?")
    assert ans.status == "SUPPORTED"
    assert "dipole" in ans.content.lower()
    assert "55.49" in ans.content


def test_ir_ai_answers_unit_meaning(mock_ir_context):
    ans = ir_inspection_answer(mock_ir_context, "What does 55 km/mol mean?")
    assert ans.status == "SUPPORTED"
    assert "km/mol" in ans.content
    assert "integrated molar" in ans.content.lower()


def test_ir_ai_answers_frequency_discrepancy(mock_ir_context):
    question = "Why isn't the calculated frequency exactly the experimental frequency?"
    ans = ir_inspection_answer(mock_ir_context, question)
    assert ans.status == "SUPPORTED"
    assert "harmonic" in ans.content.lower()
    assert "anharmonic" in ans.content.lower() or "scaling" in ans.content.lower()


def test_ir_ai_answers_ir_vs_uvvis_difference(mock_ir_context):
    question = "What is the difference between this IR spectrum and UV/Vis?"
    ans = ir_inspection_answer(mock_ir_context, question)
    assert ans.status == "SUPPORTED"
    assert "nuclear" in ans.content.lower() or "vibration" in ans.content.lower()
    assert "electronic" in ans.content.lower() or "tddft" in ans.content.lower()


def test_ir_ai_answers_what_am_i_looking_at(mock_ir_context):
    ans = ir_inspection_answer(mock_ir_context, "What am I looking at?")
    assert ans.status == "SUPPORTED"
    assert "IR spectrum" in ans.content or "vibrational" in ans.content.lower()
    assert "1638.7" in ans.content
    assert "Mode 1" in ans.content


def test_regression_vibration_strongest_not_tddft(mock_ir_context):
    """Regression test: 'Which vibration is strongest?' must NOT route to TDDFT."""
    from chemdft_api.ai.structure_inspection import (
        is_tddft_request,
    )

    q = "Which vibration is strongest?"
    assert not is_tddft_request(q)
    assert is_ir_request(q)

    ans = ir_inspection_answer(mock_ir_context, q)
    assert ans.status == "SUPPORTED"
    assert "Mode 1" in ans.content
    assert "1638.7 cm⁻¹" in ans.content
    assert "55.49 km/mol" in ans.content
    assert ans.citations[0]["citation_id"] == "P1"
    assert ans.citations[0]["entity_id"] == "res-vib-1"

    # Must NOT contain TDDFT artifacts
    forbidden = ["s3", "oscillator strength", "9.52 ev", "130.3 nm", "singlet"]
    content_lower = ans.content.lower()
    for term in forbidden:
        assert term not in content_lower, f"Forbidden TDDFT term '{term}' leaked into IR answer"

