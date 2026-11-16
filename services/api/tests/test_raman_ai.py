from __future__ import annotations

from types import SimpleNamespace

import pytest
from chemdft_api.ai.structure_inspection import (
    current_view_inspection_answer,
    ir_inspection_answer,
    is_ir_request,
    is_raman_request,
    is_tddft_request,
    raman_inspection_answer,
)


@pytest.fixture
def mock_raman_context():
    modes = [
        {
            "index": 0,
            "frequency_cm1": 1595.70,
            "imaginary": False,
            "displacement_vectors": [
                [0.0, 0.0, -0.066],
                [0.0, 0.435, 0.526],
                [0.0, -0.435, 0.526],
            ],
            "reduced_mass_amu": 1.0826,
            "ir_intensity": {"value": 59.03, "unit": {"code": "km/mol"}},
            "raman_activity": {"value": 6.3840, "unit": {"code": "Angstrom^4/amu"}},
            "depolarization_ratio": 0.5248,
        },
        {
            "index": 1,
            "frequency_cm1": 3913.62,
            "imaginary": False,
            "displacement_vectors": [
                [0.0, 0.0, 0.052],
                [0.0, 0.584, -0.413],
                [0.0, -0.584, -0.413],
            ],
            "reduced_mass_amu": 1.0455,
            "ir_intensity": {"value": 1.42, "unit": {"code": "km/mol"}},
            "raman_activity": {"value": 74.4214, "unit": {"code": "Angstrom^4/amu"}},
            "depolarization_ratio": 0.1669,
        },
        {
            "index": 2,
            "frequency_cm1": 4020.20,
            "imaginary": False,
            "displacement_vectors": [
                [0.0, -0.067, 0.0],
                [0.0, 0.531, 0.457],
                [0.0, 0.531, -0.457],
            ],
            "reduced_mass_amu": 1.0821,
            "ir_intensity": {"value": 24.18, "unit": {"code": "km/mol"}},
            "raman_activity": {"value": 34.7163, "unit": {"code": "Angstrom^4/amu"}},
            "depolarization_ratio": 0.7500,
        },
    ]
    calc_record = {
        "id": "calc-raman-1",
        "state": "SUCCEEDED",
        "result_id": "res-raman-1",
        "vibrational_analysis": {
            "result_id": "res-raman-1",
            "method": "B3LYP",
            "basis": "def2-SVP",
            "engine": "pyscf",
            "engine_version": "2.14.0",
            "hessian_type": "analytic",
            "mode_count": len(modes),
            "modes": modes,
            "raman_method": "placzek_static",
            "polarizability_method": "finite_electric_field",
            "electric_field_step_au": 0.0010,
            "polarizability_derivative_step_angstrom_amu_half": 0.0100,
            "polarizability_unit": "Angstrom^3",
            "raman_activity_unit": "Angstrom^4/amu",
            "polarizability_tensor_symmetrization": True,
            "polarizability_antisymmetry_tolerance": 0.0001,
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
        current_view={"label": "Water V1 → Raman → Mode 2 · 3913.6 cm⁻¹"},
    )
    return {"project_context": graph}


def test_is_raman_request_detection():
    assert is_raman_request("Which Raman mode is strongest?")
    assert is_raman_request("What does Raman activity mean?")
    assert is_raman_request("Why is Mode 2 stronger in Raman?")
    assert is_raman_request("Why is this vibration Raman active?")
    assert is_raman_request("What is polarizability?")
    assert is_raman_request("What is the depolarization ratio?")
    assert is_raman_request("What does changing the laser wavelength do?")
    assert is_raman_request("Does changing laser wavelength rerun the quantum calculation?")
    assert not is_raman_request("What are the excitation energies for UV/Vis?")


def test_raman_ai_answers_strongest_mode(mock_raman_context):
    ans = raman_inspection_answer(mock_raman_context, "Which Raman mode is strongest?")
    assert ans.status == "SUPPORTED"
    assert "Mode 2" in ans.content
    assert "3913.62" in ans.content
    assert "74.4214" in ans.content
    assert "0.1669" in ans.content
    assert ans.citations[0]["entity_id"] == "res-raman-1"


def test_raman_ai_answers_raman_activity_meaning(mock_raman_context):
    ans = raman_inspection_answer(mock_raman_context, "What does Raman activity mean?")
    assert ans.status == "SUPPORTED"
    assert "Placzek" in ans.content or "S_k" in ans.content
    assert "45" in ans.content
    assert "7" in ans.content
    assert "Å⁴/amu" in ans.content or "Angstrom^4/amu" in ans.content or "polarizability" in ans.content.lower()


def test_raman_ai_answers_why_mode2_stronger(mock_raman_context):
    ans = raman_inspection_answer(mock_raman_context, "Why is Mode 2 stronger in Raman?")
    assert ans.status == "SUPPORTED"
    assert "Mode 2" in ans.content
    assert "symmetric" in ans.content.lower()
    assert "polarizability" in ans.content.lower()


def test_raman_ai_answers_why_raman_active(mock_raman_context):
    ans = raman_inspection_answer(mock_raman_context, "Why is this vibration Raman active?")
    assert ans.status == "SUPPORTED"
    assert "polarizability" in ans.content.lower()


def test_raman_ai_answers_what_is_polarizability(mock_raman_context):
    ans = raman_inspection_answer(mock_raman_context, "What is polarizability?")
    assert ans.status == "SUPPORTED"
    assert "electric field" in ans.content.lower()
    assert "tensor" in ans.content.lower()


def test_raman_ai_answers_depolarization_ratio(mock_raman_context):
    ans = raman_inspection_answer(mock_raman_context, "What is the depolarization ratio?")
    assert ans.status == "SUPPORTED"
    assert "0.75" in ans.content
    assert "polarized" in ans.content.lower()


def test_raman_ai_answers_mode1_strong_ir_weak_raman(mock_raman_context):
    ans = raman_inspection_answer(mock_raman_context, "Why is Mode 1 strong in IR but weak in Raman?")
    assert ans.status == "SUPPORTED"
    assert "Mode 1" in ans.content
    assert "dipole" in ans.content.lower()
    assert "polarizability" in ans.content.lower()


def test_raman_ai_answers_ir_vs_raman_difference(mock_raman_context):
    ans = raman_inspection_answer(mock_raman_context, "What is the difference between IR and Raman?")
    assert ans.status == "SUPPORTED"
    assert "absorption" in ans.content.lower()
    assert "scattering" in ans.content.lower()


def test_raman_ai_answers_changing_laser_wavelength(mock_raman_context):
    ans = raman_inspection_answer(mock_raman_context, "What does changing the laser wavelength do?")
    assert ans.status == "SUPPORTED"
    assert "relative" in ans.content.lower()
    assert "Stokes" in ans.content or "laser" in ans.content.lower()


def test_raman_ai_answers_rerun_calculation_is_no(mock_raman_context):
    ans = raman_inspection_answer(
        mock_raman_context, "Does changing laser wavelength rerun the quantum calculation?"
    )
    assert ans.status == "SUPPORTED"
    assert "No" in ans.content
    assert "DFT" in ans.content or "quantum" in ans.content.lower()


def test_raman_ai_answers_what_am_i_looking_at(mock_raman_context):
    ans = raman_inspection_answer(mock_raman_context, "What am I looking at?")
    assert ans.status == "SUPPORTED"
    assert "Raman" in ans.content
    assert "Mode 2" in ans.content
    assert "3913.62" in ans.content


def test_ai_routing_ambiguous_question_precedence(mock_raman_context):
    """When Raman view is active, 'Which mode is strongest?' must answer Raman Mode 2, not IR Mode 1."""
    ans = current_view_inspection_answer(mock_raman_context, "Which mode is strongest?")
    assert ans.status == "SUPPORTED"
    assert "Mode 2" in ans.content
    assert "3913.62" in ans.content
    assert "74.4214" in ans.content
    assert "km/mol" not in ans.content  # Must NOT be IR intensity
