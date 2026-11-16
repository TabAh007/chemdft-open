from __future__ import annotations

from types import SimpleNamespace

from chemdft_api.ai.structure_inspection import (
    calculation_inspection_answer,
    current_view_inspection_answer,
    is_calculation_inspection_request,
    is_current_view_request,
    is_next_steps_request,
    next_steps_answer,
)


def _make_water_context(view_label: str = "Water V1"):
    version = {
        "id": "de89ad41-298b-43ee-9eea-c796f6347391",
        "revision": 1,
        "origin": "IMPORTED",
        "atom_count": 3,
        "bond_count": 0,
        "source_class": "USER_SUPPLIED",
        "source_format": "XYZ",
        "verification_state": "NOT_REVIEWED",
        "coordinate_origin": "IMPORTED",
        "coordinate_input_format": "XYZ",
    }
    structure = {
        "id": "b8de172f-886e-401a-8f71-e6a6f359f2ac",
        "name": "Water",
        "versions": (version,),
    }
    calc = {
        "result_id": "0746b1d9-eadb-4028-95dc-8bf8c87a5990",
        "input_structure_version_id": "de89ad41-298b-43ee-9eea-c796f6347391",
        "method": "hf",
        "basis": "sto-3g",
        "engine": "pyscf",
        "engine_version": "2.14.0",
        "converged": True,
        "total_energy_hartree": -74.96292823099459,
        "molecular_orbital_count": 7,
        "electron_count": 10,
        "frontier_by_spin": [
            {
                "homo_index": 4,
                "homo_energy_hartree": -0.39124467126783147,
                "homo_energy_ev": -10.6463,
                "lumo_index": 5,
                "lumo_energy_hartree": 0.6056739894771199,
                "lumo_energy_ev": 16.4812,
                "gap_ev": 27.1275,
            }
        ],
    }
    view = {
        "label": view_label,
        "selected_structure_id": "b8de172f-886e-401a-8f71-e6a6f359f2ac",
        "selected_structure_version_id": "de89ad41-298b-43ee-9eea-c796f6347391",
    }
    graph = SimpleNamespace(
        structures=(structure,),
        calculations=(calc,),
        current_view=view,
    )
    return {"project_context": graph}


def test_question_intent_detection():
    assert is_current_view_request("What am I looking at?")
    assert is_current_view_request("what are we looking at")
    assert is_current_view_request("What is on the screen?")
    assert is_current_view_request("What is this?")
    assert is_current_view_request("Explain current view")
    assert not is_current_view_request("What does Figure 2 in the paper report?")

    assert is_next_steps_request("What can I do next?")
    assert is_next_steps_request("what should i do next")
    assert is_next_steps_request("What are my options?")
    assert is_next_steps_request("recommend next step")
    assert not is_next_steps_request("Extract the table from paper")

    assert is_calculation_inspection_request("What calculations have I run?")
    assert is_calculation_inspection_request("What is the HOMO?")
    assert is_calculation_inspection_request("What is the LUMO?")
    assert is_calculation_inspection_request("What is the total energy?")


def test_current_view_inspection_for_structure():
    context = _make_water_context("Water V1")
    answer = current_view_inspection_answer(context, "What am I looking at?")
    assert answer.status == "SUPPORTED"
    assert answer.content.startswith(
        "You're looking at a 3D model of water (H₂O), made of one oxygen atom and "
        "two hydrogen atoms. [P1]"
    )
    assert "The O-H connections shown are inferred for visualization" in answer.content
    assert "Connectivity: 3 atoms; 0 authoritative bonds." in answer.content
    assert "XYZ" in answer.content
    assert (
        "Visual bonds and display representations are deterministic renderer derivatives"
        in answer.content
    )
    assert "Related calculation" in answer.content
    assert "HF/STO-3G" in answer.content
    assert len(answer.citations) >= 1
    assert answer.citations[0]["citation_id"] == "P1"
    assert answer.citations[0]["entity_id"] == "de89ad41-298b-43ee-9eea-c796f6347391"


def test_current_view_inspection_for_electronic_density():
    context = _make_water_context(
        "Water V1 → Electronic structure · RHF/STO-3G → Electron density"
    )
    answer = current_view_inspection_answer(context, "What am I looking at?")
    assert answer.status == "SUPPORTED"
    assert "You're looking at the electron-density surface of the water molecule" in answer.content
    assert "Authoritative result: Converged total energy is" in answer.content
    assert "-74.9629" in answer.content
    assert "HOMO = orbital 5" in answer.content
    assert "LUMO = orbital 6" in answer.content
    assert "valence electron distribution" in answer.content
    assert answer.citations[0]["citation_id"] == "P1"
    assert answer.citations[0]["entity_id"] == "0746b1d9-eadb-4028-95dc-8bf8c87a5990"


def test_current_view_inspection_for_homo():
    context = _make_water_context("Water V1 → Electronic structure · RHF/STO-3G → HOMO")
    answer = current_view_inspection_answer(context, "What am I looking at?")
    assert answer.status == "SUPPORTED"
    assert (
        "You're looking at the HOMO (highest occupied molecular orbital, orbital 5) "
        "of the water molecule" in answer.content
    )
    assert "positive and negative orbital wave function phase" in answer.content
    assert "(orbital phase sign, not electric charge)" in answer.content
    assert answer.citations[0]["citation_id"] == "P1"


def test_current_view_inspection_for_lumo():
    context = _make_water_context("Water V1 → Electronic structure · RHF/STO-3G → LUMO")
    answer = current_view_inspection_answer(context, "What am I looking at?")
    assert answer.status == "SUPPORTED"
    assert (
        "You're looking at the LUMO (lowest unoccupied molecular orbital, orbital 6) "
        "of the water molecule" in answer.content
    )
    assert "HOMO-LUMO gap is 27.13 eV" in answer.content
    assert answer.citations[0]["citation_id"] == "P1"


def test_current_view_inspection_for_esp():
    context = _make_water_context(
        "Water V1 → Electronic structure · RHF/STO-3G → Electrostatic potential"
    )
    answer = current_view_inspection_answer(context, "What am I looking at?")
    assert answer.status == "SUPPORTED"
    assert (
        "You're looking at electrostatic potential (ESP) mapped onto the molecular "
        "surface of the water molecule" in answer.content
    )
    assert "red = electron-rich/negative, blue = electron-poor/positive potential" in answer.content
    assert answer.citations[0]["citation_id"] == "P1"


def test_next_steps_projection():
    context = _make_water_context("Water V1")
    answer = next_steps_answer(context, "What can I do next?")
    assert answer.status == "SUPPORTED"
    assert "Explore electronic structure" in answer.content
    assert "View electron density" in answer.content
    assert "View electrostatic potential" in answer.content
    assert "Prepare geometry optimization" in answer.content
    assert "Measure molecule" in answer.content
    assert "Predict UV/Vis spectrum" in answer.content
    assert any(c["citation_id"] == "P1" for c in answer.citations)


def test_calculation_inspection_answer():
    context = _make_water_context("Water V1")
    answer = calculation_inspection_answer(context, "What calculations have I run?")
    assert answer.status == "SUPPORTED"
    assert "HF/STO-3G" in answer.content
    assert "-74.9629" in answer.content
    assert "HOMO (Orbital 5)" in answer.content
    assert "LUMO (Orbital 6)" in answer.content
    assert "27.13 eV" in answer.content
    assert answer.citations[0]["citation_id"] == "P1"
    assert answer.citations[0]["entity_id"] == "0746b1d9-eadb-4028-95dc-8bf8c87a5990"
