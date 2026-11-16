from __future__ import annotations

from types import SimpleNamespace

import pytest
from chemdft_api.ai.structure_inspection import (
    current_view_inspection_answer,
    is_tddft_request,
    next_steps_answer,
    tddft_inspection_answer,
)


@pytest.fixture
def mock_tddft_context():
    states = [
        {
            "index": 0,
            "state_label": "S1",
            "energy_hartree": 0.2624,
            "energy_ev": 7.14,
            "wavelength_nm": 173.6,
            "oscillator_strength": 0.0123,
            "converged": True,
            "transition_dipole": [0.0, 0.0, 0.21],
            "dominant_transitions": [
                {
                    "occupied_orbital_index": 4,
                    "virtual_orbital_index": 5,
                    "occupied_label": "HOMO",
                    "virtual_label": "LUMO",
                    "amplitude_x": 0.68,
                    "amplitude_y": -0.05,
                    "magnitude": 0.68,
                }
            ],
        },
        {
            "index": 1,
            "state_label": "S2",
            "energy_hartree": 0.3344,
            "energy_ev": 9.10,
            "wavelength_nm": 136.2,
            "oscillator_strength": 0.0654,
            "converged": True,
            "transition_dipole": [0.0, 0.52, 0.0],
            "dominant_transitions": [
                {
                    "occupied_orbital_index": 3,
                    "virtual_orbital_index": 5,
                    "occupied_label": "HOMO-1",
                    "virtual_label": "LUMO",
                    "amplitude_x": 0.70,
                    "amplitude_y": -0.03,
                    "magnitude": 0.70,
                }
            ],
        },
    ]

    calc_record = {
        "id": "calc-tddft-1",
        "state": "SUCCEEDED",
        "result": {
            "id": "res-tddft-1",
            "payload": {
                "payload_schema": "chemdft.tddft",
                "producer": "chemdft.pyscf",
                "producer_version": "2.14.0",
                "xc_functional": "B3LYP",
                "basis": "def2-SVPD",
                "reference_method": "RKS",
                "scf_energy_hartree": -76.40892,
                "dominant_state_index": 1,
                "excited_states": states,
            },
        },
        "tddft": {
            "result_id": "res-tddft-1",
            "method": "B3LYP",
            "basis": "def2-SVPD",
            "engine": "pyscf",
            "engine_version": "2.14.0",
            "reference_method": "RKS",
            "scf_energy_hartree": -76.40892,
            "state_count": 2,
            "dominant_state_index": 1,
            "excited_states": states,
        },
    }

    hf_record = {
        "id": "calc-hf-1",
        "state": "SUCCEEDED",
        "result_id": "res-hf-1",
        "molecular_orbitals": {
            "result_id": "res-hf-1",
            "method": "HF",
            "basis": "STO-3G",
            "engine": "pyscf",
            "engine_version": "2.14.0",
            "total_energy_hartree": -74.9629,
            "frontier_by_spin": [
                {
                    "homo_index": 4,
                    "homo_energy_ev": -10.6463,
                    "lumo_index": 5,
                    "lumo_energy_ev": 16.4812,
                    "gap_ev": 27.1275,
                }
            ],
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
        calculations=(calc_record, hf_record),
        current_view={"label": "Water V1 → UV/Vis spectrum"},
    )
    return {"project_context": graph}


def test_is_tddft_request():
    assert is_tddft_request("What does this spectrum mean?")
    assert is_tddft_request("What is the strongest calculated transition?")
    assert is_tddft_request("What wavelength is S1?")
    assert is_tddft_request("What does oscillator strength mean?")
    assert is_tddft_request("Which orbitals contribute to this state?")
    assert is_tddft_request("Is this a HOMO to LUMO transition?")
    assert is_tddft_request("Why isn't the HOMO-LUMO gap the same as the first excitation?")
    assert not is_tddft_request("What does Figure 2 in the paper show?")


def test_tddft_what_am_i_looking_at_beginner_first(mock_tddft_context):
    answer = tddft_inspection_answer(mock_tddft_context, "What am I looking at?")
    assert answer.status == "SUPPORTED"
    # Mandatory Section 25 rule: Begin conceptually
    assert answer.content.startswith(
        "You're looking at ChemDFT's calculated electronic absorption spectrum for water. [P1]"
    )
    # Explain sticks, taller sticks, and smooth curve
    assert "Discrete sticks" in answer.content
    assert "Taller sticks" in answer.content
    assert "Continuous curve" in answer.content
    # Disclaimer rule
    assert "Response amplitudes are not transition probabilities." in answer.content
    assert answer.citations[0]["citation_type"] == "CALCULATION"
    assert answer.citations[0]["citation_id"] == "P1"


def test_current_view_delegates_to_tddft_on_spectra_view(mock_tddft_context):
    answer = current_view_inspection_answer(mock_tddft_context, "What am I looking at?")
    assert answer.status == "SUPPORTED"
    assert answer.content.startswith(
        "You're looking at ChemDFT's calculated electronic absorption spectrum for water. [P1]"
    )


def test_tddft_strongest_calculated_transition(mock_tddft_context):
    answer = tddft_inspection_answer(
        mock_tddft_context, "What is the strongest calculated transition?"
    )
    assert answer.status == "SUPPORTED"
    # In mock, S2 has f = 0.0654 which is higher than S1 (0.0123)
    assert "S2" in answer.content
    assert "0.0654" in answer.content
    assert "9.10 eV" in answer.content
    assert "136.2 nm" in answer.content
    assert "Response amplitudes are not transition probabilities." in answer.content


def test_tddft_s1_wavelength(mock_tddft_context):
    answer = tddft_inspection_answer(mock_tddft_context, "What wavelength is S1?")
    assert answer.status == "SUPPORTED"
    assert "173.6 nm" in answer.content
    assert "7.14 eV" in answer.content
    assert "0.0123" in answer.content
    assert "Response amplitudes are not transition probabilities." in answer.content


def test_tddft_oscillator_strength_meaning(mock_tddft_context):
    answer = tddft_inspection_answer(mock_tddft_context, "What does oscillator strength mean?")
    assert answer.status == "SUPPORTED"
    assert "dimensionless" in answer.content
    assert "length-gauge" in answer.content
    assert "bright" in answer.content
    assert "dark" in answer.content
    assert "Response amplitudes are not transition probabilities." in answer.content


def test_tddft_orbital_contributions(mock_tddft_context):
    answer = tddft_inspection_answer(mock_tddft_context, "Which orbitals contribute to this state?")
    assert answer.status == "SUPPORTED"
    assert "MO 5" in answer.content
    assert "MO 6" in answer.content
    assert "X = 0.6800" in answer.content
    assert "Response amplitudes are not transition probabilities." in answer.content


def test_tddft_homo_to_lumo_transition(mock_tddft_context):
    answer = tddft_inspection_answer(mock_tddft_context, "Is this a HOMO to LUMO transition?")
    assert answer.status == "SUPPORTED"
    assert "MO 5 (HOMO)" in answer.content
    assert "MO 6 (LUMO)" in answer.content
    assert "collective multi-orbital" in answer.content


def test_homo_lumo_gap_vs_tddft_excitation_distinction(mock_tddft_context):
    """Section 21 anti-regression test:
    HOMO-LUMO gap is an orbital-energy difference, NOT the same as the S1 TDDFT excitation.
    """
    answer = tddft_inspection_answer(
        mock_tddft_context, "Why isn't the HOMO-LUMO gap the same as the first excitation?"
    )
    assert answer.status == "SUPPORTED"
    assert "27.13 eV" in answer.content  # HOMO-LUMO gap
    assert "7.14 eV" in answer.content  # S1 excitation
    assert "Orbital-Energy Difference" in answer.content
    assert "Calculated Electronic Excitation" in answer.content
    assert "Never substitute the HOMO-LUMO gap for an optical excitation energy" in answer.content

    # Strict anti-regression checks:
    lower_content = answer.content.lower()
    assert "homo-lumo gap is the uv/vis excitation energy" not in lower_content
    assert "homo-lumo gap is the optical excitation energy" not in lower_content
    assert "homo-lumo gap is the excitation energy" not in lower_content


def test_homo_lumo_gap_derived_from_tddft_when_no_electronic_calc(mock_tddft_context):
    from types import SimpleNamespace

    graph = mock_tddft_context["project_context"]
    tddft_only_calc = graph.calculations[0]
    tddft_data = dict(tddft_only_calc["tddft"])
    tddft_data["homo_lumo_gap_ev"] = 8.8122
    calc_record = dict(tddft_only_calc, tddft=tddft_data)
    isolated_graph = SimpleNamespace(
        structures=graph.structures,
        calculations=(calc_record,),
        current_view=graph.current_view,
    )
    context = {"project_context": isolated_graph}
    answer = tddft_inspection_answer(
        context, "Why isn't the HOMO-LUMO gap the same as the first excitation?"
    )
    assert answer.status == "SUPPORTED"
    assert "8.81 eV" in answer.content
    assert "[P1]" in answer.content
    assert "7.14 eV" in answer.content



def test_tddft_next_steps(mock_tddft_context):
    answer = next_steps_answer(mock_tddft_context, "What can I do next?")
    assert answer.status == "SUPPORTED"
    assert "Inspect UV/Vis absorption spectrum" in answer.content
    assert "Analyze excited state orbital transitions" in answer.content
    assert "Adjust Gaussian broadening" in answer.content
    assert "not yet available" not in answer.content


def test_tddft_frozen_mappingproxy_handling():
    """Anti-regression test for Bug 1: MappingProxyType contexts must be extracted correctly."""
    from types import MappingProxyType

    from chemdft_api.ai.context_builder import _freeze

    states = [
        {
            "index": 0,
            "state_label": "S1",
            "energy_hartree": 0.2624,
            "energy_ev": 7.14,
            "wavelength_nm": 173.6,
            "oscillator_strength": 0.0531,
            "converged": True,
            "dominant_transitions": [
                {
                    "occupied_mo_index": 4,
                    "virtual_mo_index": 5,
                    "occupied_label": "MO 5",
                    "virtual_label": "MO 6",
                    "x": -0.7062,
                    "y": 0.0092,
                    "magnitude": 0.7062,
                }
            ],
        }
    ]
    calc_dict = {
        "id": "calc-tddft-frozen",
        "tddft": {
            "result_id": "res-tddft-frozen",
            "method": "B3LYP",
            "basis": "def2-SVPD",
            "engine": "pyscf",
            "engine_version": "2.14.0",
            "reference_method": "RKS",
            "dominant_state_index": 0,
            "state_count": 1,
            "excited_states": states,
        },
    }
    frozen_calc = _freeze(calc_dict)
    assert isinstance(frozen_calc["tddft"], MappingProxyType)

    graph = SimpleNamespace(
        structures=({"id": "s1", "name": "Water"},),
        calculations=(frozen_calc,),
        current_view={"label": "Water V1 → UV/Vis spectrum"},
    )
    answer = tddft_inspection_answer(
        {"project_context": graph}, "What is the strongest calculated transition?"
    )
    assert answer.status == "SUPPORTED"
    assert "S1" in answer.content
    assert "0.0531" in answer.content


def test_tddft_actual_schema_field_names_and_none_energy():
    """Anti-regression: actual transition fields (Bug 3) and None energy (Bug 4)."""
    states = [
        {
            "index": 0,
            "state_label": "S1",
            "energy_hartree": 0.2722,
            "energy_ev": 7.41,
            "wavelength_nm": 167.4,
            "oscillator_strength": 0.0531,
            "converged": True,
            "dominant_transitions": [
                {
                    "occupied_mo_index": 4,
                    "virtual_mo_index": 5,
                    "occupied_label": "MO 5",
                    "virtual_label": "MO 6",
                    "x": -0.7062,
                    "y": 0.0092,
                    "magnitude": 0.7062,
                }
            ],
        }
    ]
    calc_record = {
        "id": "calc-tddft-schema",
        "tddft": {
            "result_id": "res-tddft-schema",
            "method": "B3LYP",
            "basis": "def2-SVPD",
            "dominant_state_index": 0,
            "state_count": 1,
            "excited_states": states,
        },
    }
    hf_record = {
        "id": "calc-hf-none-energy",
        "result_id": "res-hf-none",
        "molecular_orbitals": {
            "result_id": "res-hf-none",
            "method": "HF",
            "basis": "STO-3G",
            "total_energy_hartree": None,  # Bug 4 test: None should not crash formatter
            "frontier_by_spin": [
                {
                    "homo_index": 4,
                    "homo_energy_ev": -10.6,
                    "lumo_index": 5,
                    "lumo_energy_ev": 16.5,
                    "gap_ev": 27.1,
                }
            ],
        },
    }
    graph = SimpleNamespace(
        structures=({"id": "s1", "name": "Water"},),
        calculations=(calc_record, hf_record),
        current_view={"label": "Water V1 → UV/Vis spectrum"},
    )
    context = {"project_context": graph}

    # Test Bug 3: transitions formatted with occupied_mo_index / x / y
    ans_trans = tddft_inspection_answer(context, "Which orbitals contribute to this state?")
    assert ans_trans.status == "SUPPORTED"
    assert "MO 5 (HOMO) → MO 6 (LUMO)" in ans_trans.content
    assert "X = -0.7062" in ans_trans.content
    assert "Y = 0.0092" in ans_trans.content

    # Test Bug 4: electronic view with total_energy=None must not raise TypeError
    graph.current_view = {"label": "Water V1 → Electronic structure · RHF/STO-3G → HOMO"}
    ans_view = current_view_inspection_answer(context, "What am I looking at?")
    assert ans_view.status == "SUPPORTED"
    assert "Authoritative result calculated by" in ans_view.content


def test_tddft_context_summary_line_formatting():
    """Anti-regression test for Phase 2: deterministic TDDFT summary line in context snapshot."""
    from chemdft_api.ai.context_builder import _format_tddft_summary_line

    analysis = {
        "result_id": "35e0b59d-ab9c-47fe-8b1b-f7449d9fbe78",
        "input_structure_version_id": "de89ad41-298b-43ee-9eea-c796f6347391",
        "method": "B3LYP",
        "basis": "def2-SVPD",
        "dominant_state_index": 2,
        "excited_states": [
            {
                "state_label": "S1",
                "energy_ev": 7.4062,
                "wavelength_nm": 167.40,
                "oscillator_strength": 0.0531,
            },
            {
                "state_label": "S2",
                "energy_ev": 9.1895,
                "wavelength_nm": 134.92,
                "oscillator_strength": 0.0000,
            },
            {
                "state_label": "S3",
                "energy_ev": 9.5163,
                "wavelength_nm": 130.29,
                "oscillator_strength": 0.0977,
            },
        ],
    }
    line = _format_tddft_summary_line(analysis)
    assert "TDDFT UV/Vis result 35e0b59d-ab9c-47fe-8b1b-f7449d9fbe78" in line
    assert "3 singlet states calculated with B3LYP/def2-SVPD" in line
    assert "strongest transition S3 at 9.5163 eV (130.29 nm), f = 0.0977." in line


def test_phase3_ai_scientist_grounded_questions(mock_tddft_context):
    from chemdft_api.ai.structure_inspection import (
        current_view_inspection_answer,
        next_steps_answer,
        tddft_inspection_answer,
    )

    # 1. "What am I looking at?"
    ans1 = current_view_inspection_answer(mock_tddft_context, "What am I looking at?")
    assert ans1.status == "SUPPORTED"
    assert "ChemDFT's calculated electronic absorption spectrum for water" in ans1.content
    assert "[P1]" in ans1.content

    # 2. "What does this result mean?"
    ans2 = tddft_inspection_answer(mock_tddft_context, "What does this result mean?")
    assert ans2.status == "SUPPORTED"
    assert "UV/Vis absorption spectrum represents ChemDFT's calculated optical" in ans2.content

    # 3. "Which transition is strongest?"
    ans3 = tddft_inspection_answer(mock_tddft_context, "Which transition is strongest?")
    assert ans3.status == "SUPPORTED"
    assert "The strongest calculated transition in this spectrum is **S2**" in ans3.content
    assert "f = 0.0654" in ans3.content

    # 4. "What orbitals contribute to this transition?"
    ans4 = tddft_inspection_answer(
        mock_tddft_context, "What orbitals contribute to this transition?"
    )
    assert ans4.status == "SUPPORTED"
    assert "For state S₁ (7.14 eV / 173.6 nm)" in ans4.content
    assert "MO 5 (HOMO) → MO 6 (LUMO)" in ans4.content

    # 4b. "What orbitals contribute to S2?"
    ans4b = tddft_inspection_answer(mock_tddft_context, "What orbitals contribute to S2?")
    assert ans4b.status == "SUPPORTED"
    assert "For state S2 (9.10 eV / 136.2 nm)" in ans4b.content
    assert "MO 4 → MO 6" in ans4b.content

    # 4c. "What orbitals contribute to the strongest transition?"
    ans4c = tddft_inspection_answer(
        mock_tddft_context, "What orbitals contribute to the strongest transition?"
    )
    assert ans4c.status == "SUPPORTED"
    assert "The strongest calculated transition in this spectrum is **S2**" in ans4c.content

    # 5. "What can I do next?"
    ans5 = next_steps_answer(mock_tddft_context)
    assert ans5.status == "SUPPORTED"
    assert "Inspect UV/Vis absorption spectrum" in ans5.content



