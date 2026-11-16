"""One normalized, read-only description of a published result for export and comparison.

Quantities are lifted from the stored payload exactly as published; only the energy unit label is
checked. No value is recomputed, rounded, or inferred. Anything not present is simply absent.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .contracts.analysis import ResultSummary, StoredConditions, StructureIdentity, SummaryQuantity
from .effective_result_state import effective_result_state
from .scientific_models import (
    CalculationInputRecord,
    CalculationResultRecord,
    StructureVersionRecord,
)

TOTAL_ENERGY = "total_electronic_energy"
D4_TOTAL = "dispersion_corrected_total_energy"

# Result types whose payload carries a quantity we know how to read. Everything else is excluded
# from comparison rather than guessed at.
_TASK_BY_TYPE = {
    "chemdft.energy": "ENERGY",
    "chemdft.periodic-energy": "PERIODIC_ENERGY",
    "chemdft.optimization": "GEOMETRY_OPTIMIZATION",
    "chemdft.vibrational-analysis": "FREQUENCY",
    "chemdft.molecular-orbitals": "ORBITAL",
    "chemdft.tddft": "TDDFT",
    "chemdft.thermochemistry": "THERMOCHEMISTRY",
    "chemdft.dispersion-corrected-energy": "ENERGY",
    "chemdft.conformer-ensemble": "CONFORMER_SEARCH",
}


def hill_formula(elements: list[str]) -> str:
    counts: dict[str, int] = {}
    for element in elements:
        counts[element] = counts.get(element, 0) + 1
    if not counts:
        return ""
    order = (
        ["C", "H", *sorted(e for e in counts if e not in {"C", "H"})]
        if "C" in counts
        else sorted(counts)
    )
    return "".join(f"{e}{counts[e] if counts[e] > 1 else ''}" for e in order if e in counts)


def version_atoms(version: StructureVersionRecord) -> list[dict[str, Any]]:
    coordinates = (version.representation_json or {}).get("coordinates") or {}
    atoms = coordinates.get("atoms")
    return list(atoms) if isinstance(atoms, list) else []


def structure_identity(
    session: Session, version_id: str | None, project_id: str, role: str
) -> StructureIdentity:
    if not version_id:
        return StructureIdentity(geometry_role=role)  # type: ignore[arg-type]
    version = session.scalar(
        select(StructureVersionRecord).where(
            StructureVersionRecord.id == version_id,
            StructureVersionRecord.project_id == project_id,
        )
    )
    if version is None:
        return StructureIdentity(geometry_role=role)  # type: ignore[arg-type]
    elements = [str(atom["element"]) for atom in version_atoms(version) if "element" in atom]
    return StructureIdentity(
        structure_version_id=version.id,  # type: ignore[arg-type]
        geometry_role=role,  # type: ignore[arg-type]
        formula_hill=hill_formula(elements) or None,
        atom_count=len(elements),
        element_sequence=tuple(elements),
    )


def _eh(quantity: Any) -> float | None:
    """Return a Hartree value only when the stored quantity is explicitly Hartree."""
    if not isinstance(quantity, dict):
        return None
    unit = quantity.get("unit") or {}
    value = quantity.get("value")
    if unit.get("code") != "Eh" or not isinstance(value, (int, float)):
        return None
    return float(value)


def _q(
    out: list[SummaryQuantity], key: str, label: str, value: Any, unit: str, kind: str | None = None
) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return
    out.append(
        SummaryQuantity(key=key, label=label, value=float(value), unit=unit, kind=kind or key)
    )


def extract_quantities(result_type: str, payload: dict[str, Any]) -> list[SummaryQuantity]:
    out: list[SummaryQuantity] = []
    if result_type == "chemdft.energy":
        value = _eh(payload.get("total_energy"))
        if value is not None:
            _q(out, "total_energy", "Total electronic energy", value, "Eh", TOTAL_ENERGY)
    elif result_type == "chemdft.periodic-energy":
        value = _eh(payload.get("total_energy"))
        if value is not None:
            _q(out, "total_energy", "Total periodic energy", value, "Eh", TOTAL_ENERGY)
        gap = payload.get("band_gap")
        if isinstance(gap, dict) and gap.get("value") is not None:
            _q(out, "band_gap", "Kohn-Sham band gap", float(gap["value"]), "eV", "band_gap")
        tot_mag = payload.get("total_magnetization")
        if tot_mag is not None:
            _q(out, "total_magnetization", "Total magnetization", float(tot_mag), "muB", "magnetic_moment")
    elif result_type == "chemdft.optimization":
        value = _eh(payload.get("final_energy"))
        if value is not None:
            _q(out, "final_energy", "Final energy (optimized geometry)", value, "Eh", TOTAL_ENERGY)
    elif result_type == "chemdft.molecular-orbitals":
        _q(
            out,
            "total_energy",
            "Total SCF energy",
            payload.get("total_energy_hartree"),
            "Eh",
            TOTAL_ENERGY,
        )
        for frontier in payload.get("frontier_by_spin") or []:
            spin = frontier.get("spin_channel", "restricted")
            suffix = "" if spin == "restricted" else f" ({spin})"
            _q(
                out,
                f"homo_energy:{spin}",
                f"HOMO orbital energy{suffix}",
                frontier.get("homo_energy_hartree"),
                "Eh",
                f"homo_energy:{spin}",
            )
            _q(
                out,
                f"lumo_energy:{spin}",
                f"LUMO orbital energy{suffix}",
                frontier.get("lumo_energy_hartree"),
                "Eh",
                f"lumo_energy:{spin}",
            )
            _q(
                out,
                f"homo_lumo_gap:{spin}",
                f"HOMO-LUMO orbital-energy gap{suffix}",
                frontier.get("gap_hartree"),
                "Eh",
                f"homo_lumo_gap:{spin}",
            )
    elif result_type == "chemdft.tddft":
        _q(
            out,
            "total_energy",
            "Ground-state SCF energy",
            payload.get("ground_state_energy_hartree"),
            "Eh",
            TOTAL_ENERGY,
        )
        states = payload.get("excited_states") or []
        if states:
            first = states[0]
            _q(
                out,
                "first_excitation_energy",
                f"Lowest excitation energy ({first.get('state_label', 'S1')})",
                first.get("energy_ev"),
                "eV",
                "first_excitation_energy",
            )
            _q(
                out,
                "first_excitation_oscillator_strength",
                "Lowest-state oscillator strength",
                first.get("oscillator_strength"),
                "1",
                "first_excitation_oscillator_strength",
            )
    elif result_type == "chemdft.thermochemistry":
        thermo = payload.get("thermodynamics") or {}
        _q(
            out,
            "total_energy",
            "Electronic energy at the frequency geometry",
            thermo.get("electronic_energy_hartree"),
            "Eh",
            TOTAL_ENERGY,
        )
        _q(
            out,
            "zero_point_energy",
            "Zero-point energy",
            thermo.get("zpe_hartree"),
            "Eh",
            "zero_point_energy",
        )
        _q(out, "enthalpy", "Enthalpy", thermo.get("enthalpy_hartree"), "Eh", "enthalpy")
        _q(
            out,
            "gibbs_free_energy",
            "Gibbs free energy",
            thermo.get("gibbs_free_energy_hartree"),
            "Eh",
            "gibbs_free_energy",
        )
    elif result_type == "chemdft.vibrational-analysis":
        modes = payload.get("modes") or []
        real = [m["frequency_cm1"] for m in modes if not m.get("imaginary")]
        if real:
            _q(
                out,
                "lowest_real_frequency",
                "Lowest real vibrational frequency",
                min(real),
                "cm^-1",
                "lowest_real_frequency",
            )
        _q(
            out,
            "imaginary_mode_count",
            "Imaginary modes",
            sum(1 for m in modes if m.get("imaginary")),
            "1",
            "imaginary_mode_count",
        )
    elif result_type == "chemdft.dispersion-corrected-energy":
        value = _eh(payload.get("corrected_total_energy"))
        if value is not None:
            _q(
                out,
                "corrected_total_energy",
                "DFT-D4 corrected total energy",
                value,
                "Eh",
                D4_TOTAL,
            )
        correction = _eh(payload.get("d4_correction_energy"))
        if correction is not None:
            _q(
                out,
                "d4_correction_energy",
                "D4 dispersion correction",
                correction,
                "Eh",
                "d4_correction_energy",
            )
    elif result_type == "chemdft.conformer-ensemble":
        members = ((payload.get("manifest") or {}).get("members")) or []
        energies = [_eh(m.get("native_electronic_energy")) for m in members]
        energies = [e for e in energies if e is not None]
        if energies:
            _q(
                out,
                "lowest_conformer_energy",
                "Lowest native conformer energy",
                min(energies),
                "Eh",
                "conformer_lowest_native_energy",
            )
    return out


def _display(reference: dict[str, Any] | None) -> str | None:
    if not isinstance(reference, dict):
        return None
    return str(reference.get("identifier") or reference.get("display_name") or "") or None


def stored_conditions(result_type: str, payload: dict[str, Any]) -> StoredConditions | None:
    """Temperature and pressure of a thermochemistry result, only when both are recorded as numbers."""
    if result_type != "chemdft.thermochemistry":
        return None
    conditions = payload.get("conditions") or {}
    temperature, pressure = conditions.get("temperature_k"), conditions.get("pressure_pa")
    numeric = (int, float)
    if (
        isinstance(temperature, numeric)
        and not isinstance(temperature, bool)
        and isinstance(pressure, numeric)
        and not isinstance(pressure, bool)
    ):
        return StoredConditions(temperature_k=float(temperature), pressure_pa=float(pressure))
    return None


def summarize_result(session: Session, record: CalculationResultRecord) -> ResultSummary:
    calc_input = session.scalar(
        select(CalculationInputRecord).where(
            CalculationInputRecord.id == record.calculation_input_id,
            CalculationInputRecord.project_id == record.project_id,
        )
    )
    spec: dict[str, Any] = (calc_input.specification_json if calc_input else None) or {}
    payload: dict[str, Any] = record.payload_json or {}
    producer = record.producer_software_json or {}

    method = payload.get("method") if isinstance(payload.get("method"), str) else None
    basis = payload.get("basis") if isinstance(payload.get("basis"), str) else None
    dispersion = _display(spec.get("dispersion"))
    if record.result_type == "chemdft.dispersion-corrected-energy":
        method = payload.get("functional") or method
        basis = (payload.get("source") or {}).get("basis") or basis
        dispersion = "D4 (BJ damping, EEQ charges, approximate ATM)"
    if method is None:
        method = _display(spec.get("method"))
    if basis is None:
        basis = _display(spec.get("basis"))
    if record.result_type == "chemdft.conformer-ensemble":
        method = ((payload.get("manifest") or {}).get("method")) or method
    solvation = spec.get("solvation")
    solvation_text = (
        f"{solvation.get('model')}/{solvation.get('solvent')}"
        if isinstance(solvation, dict)
        else None
    )

    # An optimization energy belongs to the optimized geometry, not the input geometry.
    if record.result_type == "chemdft.optimization" and payload.get("final_structure_version_id"):
        structure = structure_identity(
            session,
            str(payload["final_structure_version_id"]),
            record.project_id,
            "OPTIMIZED_FINAL",
        )
    else:
        version_id = (
            str((payload.get("source") or {}).get("structure_version_id"))
            if record.result_type == "chemdft.dispersion-corrected-energy"
            and (payload.get("source") or {}).get("structure_version_id")
            else (calc_input.structure_version_id if calc_input else None)
        )
        structure = structure_identity(session, version_id, record.project_id, "INPUT")

    state = effective_result_state(session, record)
    return ResultSummary(
        result_id=record.id,  # type: ignore[arg-type]
        calculation_id=record.calculation_id,  # type: ignore[arg-type]
        result_type=record.result_type,
        task=_TASK_BY_TYPE.get(record.result_type, str(spec.get("task_type") or "UNKNOWN")),
        engine=producer.get("name"),
        engine_version=producer.get("version"),
        method=method,
        basis=basis,
        dispersion=dispersion,
        solvation=solvation_text,
        charge=spec.get("charge") if isinstance(spec.get("charge"), int) else None,
        multiplicity=spec.get("multiplicity")
        if isinstance(spec.get("multiplicity"), int)
        else None,
        structure=structure,
        quantities=tuple(extract_quantities(record.result_type, payload)),
        conditions=stored_conditions(record.result_type, payload),
        created_at=record.created_at,
        effective_state=state,
        evidence_use="CURRENT" if state.eligible_for_derivation else "HISTORICAL_ONLY",
    )
