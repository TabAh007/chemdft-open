# ruff: noqa: RUF001
"""Deterministic AI grounding for thermochemistry (explanation only, from the active record)."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from chemdft_api.ai.structure_inspection import (
    current_view_inspection_answer,
    is_thermochemistry_request,
    thermochemistry_inspection_answer,
)

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "apps/web/tests/fixtures/thermochemistry-water-b3lyp-def2svp-298k.json"
)
PAYLOAD = json.loads(FIXTURE.read_text())


def _context(label: str, payloads: list[dict] | None = None) -> dict:
    calculations = [
        {"id": f"c{i}", "result": {"id": f"r{i}", "payload": payload}}
        for i, payload in enumerate(payloads if payloads is not None else [PAYLOAD])
    ]
    graph = SimpleNamespace(calculations=tuple(calculations), current_view={"label": label})
    return {"project_context": graph}


VIEW = "Water V2 → Thermochemistry · 298.15 K · 1 atm · B3LYP / def2-svp"


def test_requests_are_recognised_without_hijacking_other_topics() -> None:
    assert is_thermochemistry_request("What is the zero-point energy?")
    assert is_thermochemistry_request("what is the gibbs free energy")
    assert is_thermochemistry_request("What is the entropy?")
    assert not is_thermochemistry_request("Which Raman band is most intense?")
    assert not is_thermochemistry_request("what is the strongest IR band")
    assert not is_thermochemistry_request("submit this figure")


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("What is the Gibbs free energy?", ["-76.354754", "2.235 kcal/mol", "G = H − T·S"]),
        ("What is the enthalpy?", ["-76.333311", "15.691 kcal/mol", "U + k_B·T"]),
        (
            "What is zero-point energy?",
            ["13.319 kcal/mol", "55.73", "does not change with temperature"],
        ),
        ("What is the entropy?", ["188.830 J/mol/K", "translational", "not E0 or the frequencies"]),
        ("What is the heat capacity?", ["Cv = 25.135", "Cp = 33.449"]),
        ("What is the symmetry number?", ["σ = 2", "chemdft-proper-rotation-count"]),
        ("What am I looking at?", ["ideal-gas RRHO", "298.15 K · 1 atm", "never reruns DFT"]),
    ],
)
def test_answers_come_from_the_authoritative_record(question: str, expected: list[str]) -> None:
    answer = thermochemistry_inspection_answer(_context(VIEW), question)
    assert answer.status == "SUPPORTED"
    for fragment in expected:
        assert fragment in answer.content, (fragment, answer.content)
    assert answer.citations and answer.citations[0]["source_record_id"] == "r0"
    assert "no SCF or Hessian was rerun" in answer.citations[0]["reference_text"]


def test_current_view_routes_to_thermochemistry_and_selects_matching_conditions() -> None:
    hot = json.loads(json.dumps(PAYLOAD))
    hot["conditions"].update(temperature_k=350.0, pressure_pa=101325.0, pressure_atm=1.0)
    context = _context(
        "Water V2 → Thermochemistry · 350 K · 1 atm · B3LYP / def2-svp", [PAYLOAD, hot]
    )
    answer = current_view_inspection_answer(context, "What am I looking at?")
    assert "350 K · 1 atm" in answer.content
    default = current_view_inspection_answer(
        _context(VIEW, [hot, PAYLOAD]), "What am I looking at?"
    )
    assert "298.15 K · 1 atm" in default.content


def test_low_frequency_warning_is_quoted_from_the_record_not_invented() -> None:
    soft = json.loads(json.dumps(PAYLOAD))
    soft["diagnostics"]["warnings"] = [
        "1 real mode(s) below 100 cm^-1 (60.0 cm^-1): pure-RRHO entropy may be unreliable."
    ]
    answer = thermochemistry_inspection_answer(_context(VIEW, [soft]), "What is the entropy?")
    assert "Diagnostics" in answer.content and "60.0 cm^-1" in answer.content
    clean = thermochemistry_inspection_answer(_context(VIEW), "What is the entropy?")
    assert "Diagnostics" not in clean.content


def test_missing_record_gets_a_requirements_message_not_invented_values() -> None:
    answer = thermochemistry_inspection_answer(_context(VIEW, []), "What is the Gibbs free energy?")
    assert "No authoritative thermochemistry result" in answer.content
    assert answer.citations == []
    assert "no DFT or Hessian is rerun" in answer.content


def test_thermochemistry_payload_is_never_mistaken_for_a_vibrational_result() -> None:
    """Its `frequencies_cm1` field must not feed the IR/Raman extractors (regression)."""
    from chemdft_api.ai.structure_inspection import (
        _extract_raman_calc,
        _extract_vibrational_calc,
    )

    calcs = (
        {"id": "t", "result": {"id": "rt", "payload": PAYLOAD}},
        {
            "id": "v",
            "result": {
                "id": "rv",
                "payload": {
                    "payload_schema": "chemdft.vibrational-analysis",
                    "modes": [
                        {"index": 0, "frequency_cm1": 1600.0, "ir_intensity": {"value": 5.0}}
                    ],
                },
            },
        },
    )
    found = _extract_vibrational_calc(calcs)
    assert found is not None and found["result_id"] == "rv" and len(found["modes"]) == 1
    assert _extract_vibrational_calc(calcs[:1]) is None
    assert _extract_raman_calc(calcs[:1]) is None
