"""Tests for Method Advisor Rules and Citations (Release 0.0.60, Part 4)."""

from __future__ import annotations

from chemdft_api.ai.method_advice import advise_calculation_method


def test_cr2o3_triggers_dft_plus_u_and_magnetic_advice() -> None:
    advice = advise_calculation_method(
        is_periodic=True,
        elements=["Cr", "O"],
    )

    assert advice.recommended_engine == "quantum_espresso"
    assert advice.recommended_method == "PBE+U"
    assert "DFT+U" in advice.rationale
    assert "magnetic" in advice.rationale
    assert "Suggestion, not a result." in advice.caveat
    assert "docs/TECHNOLOGY_REGISTRY.md" in advice.citation


def test_silicon_and_nacl_trigger_standard_pbe() -> None:
    # Silicon crystal
    si_advice = advise_calculation_method(is_periodic=True, elements=["Si"])
    assert si_advice.recommended_engine == "quantum_espresso"
    assert si_advice.recommended_method == "PBE"
    assert "Non-transition metal" in si_advice.rationale

    # NaCl crystal
    nacl_advice = advise_calculation_method(is_periodic=True, elements=["Na", "Cl"])
    assert nacl_advice.recommended_engine == "quantum_espresso"
    assert nacl_advice.recommended_method == "PBE"


def test_water_molecule_triggers_b3lyp_and_notes_hf_educational() -> None:
    water_advice = advise_calculation_method(is_periodic=False, elements=["H", "O"])
    assert water_advice.recommended_engine == "pyscf"
    assert water_advice.recommended_method == "B3LYP"
    assert water_advice.recommended_basis_or_ecp == "def2-SVP"
    assert "Hartree-Fock (HF) with STO-3G is suitable for fast educational checks only" in water_advice.rationale


def test_unsupported_element_reported_honestly() -> None:
    advice = advise_calculation_method(is_periodic=True, elements=["Og", "O"])
    assert advice.recommended_engine == "none"
    assert "Og" in advice.unsupported_elements
    assert "unsupported by the standard automated computational libraries" in advice.rationale
