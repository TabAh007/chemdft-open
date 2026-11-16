"""Deterministic AI grounding for Thermochemistry (explanation only).

Answers are formatted from the active authoritative ``chemdft.thermochemistry`` record; nothing is
computed or invented here. Kept in its own module so structure_inspection stays focused.
"""

# ruff: noqa: E501, RUF001

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .evidence_answer import EvidenceAnswer


def is_thermochemistry_request(question: str) -> bool:
    text = question.casefold()
    phrases = (
        "thermochem",
        "zero-point",
        "zero point",
        "zpe",
        "enthalpy",
        "gibbs",
        "free energy",
        "entropy",
        "heat capacity",
        "thermal correction",
        "symmetry number",
        "partition function",
        "standard state",
        "ideal gas",
        "rigid rotor",
    )
    return any(phrase in text for phrase in phrases) and not any(
        term in text for term in ("figure", "paper", "submit", "promote")
    )


def _thermochemistry_records(calcs: Any) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for c in calcs:
        res = c.get("result")
        payload = (res or {}).get("payload") if isinstance(res, Mapping) else None
        if (
            isinstance(payload, Mapping)
            and payload.get("payload_schema") == "chemdft.thermochemistry"
        ):
            records.append({"result_id": str((res or {}).get("id")), "payload": payload})
    return records


def _select_thermochemistry_record(
    records: list[dict[str, object]], view_label: str
) -> dict[str, object] | None:
    import re

    if not records:
        return None
    match = re.search(r"([\d.]+)\s*k\s*·\s*([\d.]+)\s*atm", view_label)
    if match:
        temperature, pressure_atm = float(match.group(1)), float(match.group(2))
        for record in records:
            conditions = record["payload"]["conditions"]  # type: ignore[index]
            if (
                abs(conditions["temperature_k"] - temperature) < 1e-6
                and abs(conditions["pressure_atm"] - pressure_atm) < 1e-6
            ):
                return record
    for record in records:
        conditions = record["payload"]["conditions"]  # type: ignore[index]
        if (
            abs(conditions["temperature_k"] - 298.15) < 1e-9
            and abs(conditions["pressure_pa"] - 101325.0) < 1e-6
        ):
            return record
    return records[0]


def thermochemistry_inspection_answer(
    context: dict[str, object], question: str = ""
) -> EvidenceAnswer:
    graph = context.get("project_context")
    calcs = getattr(graph, "calculations", ())
    view = getattr(graph, "current_view", {})
    view_label = str(view.get("label") or "").casefold()
    q = question.casefold().strip().rstrip("?.!")
    record = _select_thermochemistry_record(_thermochemistry_records(calcs), view_label)
    if record is None:
        return EvidenceAnswer(
            content=(
                "No authoritative thermochemistry result has been recorded for this project yet. "
                "Thermochemistry needs a ChemDFT-optimized geometry, a frequency calculation on it "
                "with no imaginary modes, and its stored electronic energy; no DFT or Hessian is "
                "rerun when it is calculated (Guided → Analysis → Thermochemistry)."
            ),
            status="SUPPORTED",
            note="Verified from project calculation records.",
            citations=[],
        )
    result_id = str(record["result_id"])
    p: Mapping[str, Any] = record["payload"]  # type: ignore[assignment]
    cond, thermo, corr = p["conditions"], p["thermodynamics"], p["corrections"]
    consts, comps, symmetry = p["constants"], p["components"], p["symmetry"]
    kj = consts["hartree_j"] * consts["avogadro_per_mol"] / 1000.0
    kcal = kj / consts.get("thermochemical_calorie_j", 4.184)
    j_per_k = consts["hartree_j"] * consts["avogadro_per_mol"]
    conditions = f"{cond['temperature_k']:g} K · {cond['pressure_atm']:g} atm"
    level = f"{str(p['method']).upper()}/{p['basis']}"

    def energy(value: float) -> str:
        return f"{value * kcal:.3f} kcal/mol ({value * kj:.2f} kJ/mol; {value:.6f} Eh)"

    citations: list[dict[str, object]] = [
        {
            "citation_type": "CALCULATION",
            "citation_id": "P1",
            "entity_id": result_id,
            "source_record_type": "calculation_result",
            "source_record_id": result_id,
            "label": f"Thermochemistry · {conditions} · {level}",
            "reference_text": (
                f"Authoritative ideal-gas rigid-rotor harmonic-oscillator thermochemistry [P1] from "
                f"{p['engine']} {p['engine_version']} ({p['thermo_api']}) at {conditions}, computed from "
                f"the persisted optimized geometry, harmonic frequencies and E0 (frequency result "
                f"{str(p['frequency_result_id'])[:8]}); no SCF or Hessian was rerun."
            ),
        }
    ]
    assumptions = (
        "ideal gas, rigid rotor, harmonic oscillator (pure RRHO), gas phase, "
        f"rotational symmetry number σ = {symmetry['rotational_symmetry_number']}"
    )
    warnings = list((p["diagnostics"] or {}).get("warnings") or [])
    suffix = f"\n\n**Diagnostics:** {' '.join(warnings)}" if warnings else ""

    def reply(body: str, note: str) -> EvidenceAnswer:
        return EvidenceAnswer(
            content=body + suffix, status="SUPPORTED", note=note, citations=citations
        )

    note = "Verified from the authoritative thermochemistry record."
    if "gibbs" in q or "free energy" in q:
        return reply(
            f"At {conditions} ({level}), the **Gibbs free energy** is **{thermo['gibbs_free_energy_hartree']:.6f} Eh** "
            f"[P1]. Relative to E0, the **thermal correction to G** is **{energy(corr['thermal_correction_gibbs_hartree'])}** "
            f"(includes ZPE). Totals include the electronic energy E0 = {thermo['electronic_energy_hartree']:.6f} Eh; "
            f"G = H − T·S. Model: {assumptions}.",
            note,
        )
    if "enthalpy" in q:
        return reply(
            f"At {conditions} ({level}), the **enthalpy** is **{thermo['enthalpy_hartree']:.6f} Eh** [P1]; the "
            f"**thermal correction to H** is **{energy(corr['thermal_correction_enthalpy_hartree'])}** "
            f"(relative to E0, includes ZPE). H = U + k_B·T for an ideal gas. Model: {assumptions}.",
            note,
        )
    if "zero-point" in q or "zero point" in q or "zpe" in q:
        return reply(
            f"The **zero-point energy** is **{energy(thermo['zpe_hartree'])}** [P1] — the sum ½hν over the "
            f"{len(p['frequencies_cm1'])} harmonic frequencies. It depends only on the frequencies, so it does not "
            f"change with temperature or pressure.",
            note,
        )
    if "entropy" in q:
        parts = ", ".join(
            f"{name} {comps[name]['entropy_hartree_per_k'] * j_per_k:.3f}"
            for name in ("translational", "rotational", "vibrational", "electronic")
        )
        return reply(
            f"At {conditions} the **entropy** is **{thermo['entropy_hartree_per_k'] * j_per_k:.3f} J/mol/K** [P1] "
            f"(translational, rotational, vibrational, electronic in J/mol/K: {parts}). Pressure changes only the "
            f"translational term (and therefore S and G), not E0 or the frequencies.",
            note,
        )
    if "heat capacity" in q or " cp" in f" {q}" or " cv" in f" {q}":
        return reply(
            f"At {conditions} the **heat capacity** is **Cv = {thermo['cv_hartree_per_k'] * j_per_k:.3f} J/mol/K** and "
            f"**Cp = {thermo['cp_hartree_per_k'] * j_per_k:.3f} J/mol/K** [P1] (Cp − Cv = R for an ideal gas).",
            note,
        )
    if "symmetry" in q:
        return reply(
            f"The rotational **symmetry number is σ = {symmetry['rotational_symmetry_number']}** [P1] "
            f"(source: {symmetry['source']}, tolerance {symmetry['tolerance_angstrom']} Å, "
            f"algorithm {symmetry['algorithm']} {symmetry['algorithm_version']}). It lowers the rotational entropy "
            f"by R·ln σ.",
            note,
        )
    return reply(
        f"You're looking at **ideal-gas RRHO thermochemistry** of the optimized structure at **{conditions}** "
        f"({level}, PySCF {p['engine_version']}) [P1]: E0 = {thermo['electronic_energy_hartree']:.6f} Eh; "
        f"ZPE = {energy(thermo['zpe_hartree'])}; thermal corrections to U/H/G = "
        f"{corr['thermal_correction_internal_energy_hartree'] * kcal:.3f} / "
        f"{corr['thermal_correction_enthalpy_hartree'] * kcal:.3f} / "
        f"{corr['thermal_correction_gibbs_hartree'] * kcal:.3f} kcal/mol (relative to E0, including ZPE); "
        f"S = {thermo['entropy_hartree_per_k'] * j_per_k:.3f} J/mol/K; "
        f"Cv/Cp = {thermo['cv_hartree_per_k'] * j_per_k:.3f}/{thermo['cp_hartree_per_k'] * j_per_k:.3f} J/mol/K. "
        f"Model: {assumptions}. Changing temperature or pressure re-evaluates the stored model; it never reruns DFT.",
        note,
    )
