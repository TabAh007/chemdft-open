"""Provider-neutral imported payloads (chemdft.imported.*), built from validated cclib data.

None of these are ChemDFT engine results. Every payload states its source program, keeps the raw parsed values and units next to the
canonical ones, and says explicitly what was NOT reported or NOT recomputed. Units go through units.py only.
"""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np

from . import NORMALIZATION_VERSION, units
from .findings import Finding
from .logscan import DeclaredJob, RawFacts
from .semantic import has, optdone_flag

SPIN_WORDS = {"singlet": 1, "doublet": 2, "triplet": 3, "quartet": 4, "quintet": 5, "sextet": 6}
MAX_FRAMES = 1000
MAX_TRANSITIONS_PER_STATE = 12


def _f(x) -> float:
    return float(x)


def _fl(arr) -> list[float]:
    return [float(v) for v in np.asarray(arr, dtype=float).ravel()]


def _rows(arr) -> list[list[float]]:
    return [[float(v) for v in row] for row in np.asarray(arr, dtype=float)]


@dataclass
class Context:
    program: str  # "Gaussian" | "ORCA"
    program_label: str  # e.g. "Gaussian 16 Rev C.01"
    facts: RawFacts
    declared: DeclaredJob
    convergence: dict
    info: dict  # semantic.check_* info
    locators: dict
    method_label: str
    findings: list[Finding] = field(default_factory=list)


@dataclass
class Built:
    results: list[dict] = field(default_factory=list)
    items: list[dict] = field(default_factory=list)


def _header(kind: str, ctx: Context, attributes: list[str]) -> dict:
    return {
        "payload_schema": f"chemdft.imported.{kind}",
        "payload_schema_version": "1.0.0",
        "source_class": "IMPORTED",
        "source": {"program": ctx.program, "program_label": ctx.program_label},
        "normalization_version": NORMALIZATION_VERSION,
        "source_attributes": attributes,
    }


def _locs(ctx: Context, attributes: list[str]) -> dict:
    return {a: ctx.locators[a] for a in attributes if a in ctx.locators}


def _atoms(data, frame_index: int = -1) -> list[dict]:
    from periodictable import elements

    coords = np.asarray(data.atomcoords, dtype=float)[frame_index]
    return [
        {"index": i, "element": elements[int(z)].symbol, "atomic_number": int(z), "x": float(c[0]), "y": float(c[1]), "z": float(c[2])}
        for i, (z, c) in enumerate(zip(data.atomnos, coords, strict=True))
    ]


def build_structure(data, ctx: Context) -> tuple[dict, list[str]]:
    frames = int(np.asarray(data.atomcoords).shape[0])
    optimized = ctx.declared.opt and ctx.convergence["optimization"]["status"] == "CONVERGED"
    role = "final-optimized" if optimized else ("single-geometry" if frames == 1 else "final-frame")
    attrs = ["atomnos", "atomcoords", "charge", "mult"]
    payload = _header("structure", ctx, attrs) | {
        "atoms": _atoms(data),
        "coordinate_unit": "angstrom",
        "charge": int(data.charge),
        "multiplicity": int(data.mult),
        "geometry_role": role,
        "frame": {"orientation": ctx.facts.orientation, "frame_index": frames - 1, "frame_count": frames},
        "optimized": bool(optimized),
        "bonds": "not reported (connectivity is never imported; bonds shown in 3D are inferred display aids)",
    }
    return payload, attrs


def build_energy(data, ctx: Context) -> tuple[dict, list[str]]:
    raw_ev = float(np.asarray(data.scfenergies)[-1])
    attrs = ["scfenergies"]
    payload = _header("energy", ctx, attrs) | {
        "energy_kind": "final SCF/DFT total energy as reported (any empirical dispersion term the program adds is included)",
        "scf_energy": units.scalar(raw_ev, "eV", units.eV_to_hartree(raw_ev), "Eh", "cclib.eV->Eh/1"),
        "scf_energy_count": len(data.scfenergies),
        "reference": ctx.facts.reference,
        "method": ctx.method_label,
        "includes_dispersion_correction": ("reported separately by cclib; already included in this total" if has(data, "dispersionenergies") else None),
        "solvent_model": ctx.facts.solvent_model,
        "excited_state_energies": "not part of this value",
    }
    return payload, attrs


def build_optimization(data, ctx: Context) -> tuple[dict, list[str]] | None:
    if not (ctx.declared.opt and ctx.convergence["optimization"]["status"] == "CONVERGED"):
        return None
    coords = np.asarray(data.atomcoords, dtype=float)
    attrs = ["atomcoords", "scfenergies"] + [a for a in ("geovalues", "geotargets", "optdone", "optstatus", "grads") if has(data, a)]
    energies = [units.eV_to_hartree(float(e)) for e in np.asarray(data.scfenergies, dtype=float)] if has(data, "scfenergies") else []
    include_frames = coords.shape[0] <= MAX_FRAMES
    payload = _header("optimization", ctx, attrs) | {
        "converged": True,
        "convergence_evidence": ctx.convergence["optimization"]["evidence"],
        "cclib_optdone": optdone_flag(data),
        "frame_count": int(coords.shape[0]),
        "final_frame_index": int(coords.shape[0] - 1),
        "frames_angstrom": [_rows(frame) for frame in coords] if include_frames else None,
        "frames_omitted_reason": None if include_frames else f"trajectory has {coords.shape[0]} frames (> {MAX_FRAMES})",
        "scf_energies_hartree": energies,
        "scf_energy_unit_note": "converted from eV with cclib.eV->Eh/1; the energy array may be longer than the frame array when a frequency step follows",
        "final_criteria_values": _fl(np.asarray(data.geovalues)[-1]) if has(data, "geovalues") and len(data.geovalues) else None,
        "criteria_targets": _fl(data.geotargets) if has(data, "geotargets") else None,
        "criteria_names": "not exposed by the parser",
        "final_structure": "see the structure result of the same job (geometry_role = final-optimized)",
    }
    return payload, attrs


def build_orbitals(data, ctx: Context) -> tuple[dict, list[str]] | None:
    if not has(data, "moenergies") or not len(data.moenergies):
        return None
    channels_in = [np.asarray(c, dtype=float) for c in data.moenergies]
    two = len(channels_in) == 2
    labels = ["alpha", "beta"] if two else ["restricted"] if len(channels_in) == 1 else [f"channel-{i}" for i in range(len(channels_in))]
    homos = [int(h) for h in np.asarray(data.homos).ravel()] if has(data, "homos") else []
    mosyms = data.mosyms if has(data, "mosyms") else None
    attrs = ["moenergies"] + [a for a in ("homos", "mosyms") if has(data, a)]
    mult = int(data.mult)
    derive = len(homos) == len(channels_in) and not (len(channels_in) == 1 and mult > 1)
    channels = []
    for i, (label, energies) in enumerate(zip(labels, channels_in, strict=True)):
        homo = homos[i] if derive else None
        occ = None
        if homo is not None:
            full = 2.0 if label == "restricted" else 1.0
            occ = [full if j <= homo else 0.0 for j in range(len(energies))]
        sym = [str(s) for s in mosyms[i]] if mosyms is not None and i < len(mosyms) and len(mosyms[i]) == len(energies) else None
        channels.append(
            {
                "label": label,
                "orbital_count": len(energies),
                "homo_index": homo,
                "energies_hartree": [units.eV_to_hartree(float(e)) for e in energies],
                "raw_energies_ev": [float(e) for e in energies],
                "occupations": occ,
                "symmetries": sym,
            }
        )
    payload = _header("orbital-table", ctx, attrs) | {
        "spin_channels": channels,
        "raw_unit": "eV",
        "conversion": "cclib.eV->Eh/1",
        "occupation_basis": "derived from the parser's HOMO index (not printed occupations)" if derive else "not derived",
        "orbital_coefficients": "not imported (no validated reconstruction path in V1; MO isosurfaces are unavailable)",
    }
    return payload, attrs


def _optional_array(data, name: str, n: int) -> list[float | None]:
    if has(data, name):
        arr = np.asarray(getattr(data, name), dtype=float).ravel()
        if len(arr) == n and np.isfinite(arr).all():
            return [float(v) for v in arr]
    return [None] * n


def build_vibrations(data, ctx: Context) -> tuple[dict, list[str]] | None:
    if not has(data, "vibfreqs") or not has(data, "vibdisps"):
        return None
    freqs = np.asarray(data.vibfreqs, dtype=float)
    disp = np.asarray(data.vibdisps, dtype=float)
    n = len(freqs)
    ir = _optional_array(data, "vibirs", n)
    raman = _optional_array(data, "vibramans", n)
    mass = _optional_array(data, "vibrmasses", n)
    has_ir = all(v is not None for v in ir)
    has_raman = all(v is not None for v in raman)
    attrs = ["vibfreqs", "vibdisps"] + [a for a in ("vibirs", "vibramans", "vibrmasses") if has(data, a)]
    norms = [float(np.sqrt((d**2).sum())) for d in disp]
    modes = []
    for i in range(n):
        modes.append(
            {
                "index": i,
                "frequency_cm1": float(freqs[i]),
                "imaginary": bool(freqs[i] < 0),
                "ir_intensity_km_mol": ir[i],
                "raman_activity_a4_amu": raman[i],
                "reduced_mass_amu": mass[i],
                "displacement": _rows(disp[i]),
                "displacement_euclidean_norm": norms[i],
            }
        )
    payload = _header("vibrations", ctx, attrs) | {
        "mode_count": n,
        "expected_mode_count": ctx.info.get("expected_modes"),
        "linear": bool(ctx.info.get("linear")),
        "imaginary_mode_count": int((freqs < 0).sum()),
        "modes": modes,
        "has_ir_intensities": has_ir,
        "has_raman_activities": has_raman,
        "depolarization_ratios": "not reported by the source parser; never synthesized",
        "frequency_unit": "cm^-1",
        "ir_intensity_unit": "km/mol",
        "raman_activity_unit": "angstrom^4/amu",
        "frequency_sign": "preserved exactly as reported (negative = imaginary)",
        "displacement_convention": {
            "statement": "Cartesian displacement vectors as reported by the program via the parser. Normalisation is engine specific; only the direction is meaningful.",
            "euclidean_norm_min": min(norms),
            "euclidean_norm_max": max(norms),
            "frame": ctx.facts.orientation,
            "eckart_rotation_worst_relative": ctx.info.get("eckart_rotation_worst_relative"),
        },
        "equilibrium_geometry": {"coordinate_unit": "angstrom", "atoms": _atoms(data)},
        "zero_modes": "translation/rotation modes are not part of the imported modes (3N-6, or 3N-5 for linear molecules)",
        "ordering": "as reported by the program",
    }
    if not has_ir:
        payload["ir_intensity_note"] = "IR intensities were not reported in this file"
    if not has_raman:
        payload["raman_activity_note"] = "Raman activities were not reported in this file"
    return payload, attrs


def _spin_and_symmetry(label: str | None) -> tuple[str, int | None, str | None]:
    if not label:
        return "unknown", None, None
    m = re.match(r"(?i)^\s*(singlet|doublet|triplet|quartet|quintet|sextet)\b[-\s]*(.*)$", str(label))
    if not m:
        return "unknown", None, str(label).strip() or None
    word = m.group(1).lower()
    sym = m.group(2).strip() or None
    return word, SPIN_WORDS[word], sym


def build_excitations(data, ctx: Context) -> tuple[dict, list[str]] | None:
    if not has(data, "etenergies"):
        return None
    e = np.asarray(data.etenergies, dtype=float)
    n = len(e)
    osc = np.asarray(data.etoscs, dtype=float) if has(data, "etoscs") and len(data.etoscs) == n else None
    syms = list(data.etsyms) if has(data, "etsyms") and len(data.etsyms) == n else [None] * n
    secs = list(data.etsecs) if has(data, "etsecs") and len(data.etsecs) == n else [None] * n
    attrs = ["etenergies"] + [a for a in ("etoscs", "etsyms", "etsecs") if has(data, a)]
    states = []
    for i in range(n):
        spin, mult, sym = _spin_and_symmetry(syms[i])
        transitions = []
        truncated = False
        if secs[i]:
            ranked = sorted(secs[i], key=lambda t: -abs(float(t[2])))
            truncated = len(ranked) > MAX_TRANSITIONS_PER_STATE
            for (frm, to, coeff) in ranked[:MAX_TRANSITIONS_PER_STATE]:
                transitions.append(
                    {"from_orbital": int(frm[0]), "from_spin": int(frm[1]), "to_orbital": int(to[0]), "to_spin": int(to[1]), "coefficient": float(coeff)}
                )
        states.append(
            {
                "index": i,
                "source_state_number": i + 1,
                "spin_label": spin,
                "spin_multiplicity": mult,
                "symmetry": sym,
                "source_label": str(syms[i]) if syms[i] is not None else None,
                "energy_cm1_raw": float(e[i]),
                "energy_hartree": units.wavenumber_to_hartree(float(e[i])),
                "energy_ev": units.wavenumber_to_ev(float(e[i])),
                "wavelength_nm": units.wavenumber_to_nm(float(e[i])),
                "oscillator_strength": float(osc[i]) if osc is not None else None,
                "transitions": transitions,
                "transitions_truncated": truncated,
            }
        )
    meta = (getattr(data, "metadata", None) or {}).get("excited_states_method")
    payload = _header("excitations", ctx, attrs) | {
        "state_count": n,
        "method": str(meta) if meta else "not reported",
        "ordering": "original order as reported by the program (never re-sorted)",
        "states": states,
        "spin_semantics": "spin labels are preserved as reported; triplet and other non-singlet states are not coerced into a singlet spectrum",
        "oscillator_strength_gauge": "not reported by the parser",
        "transition_amplitudes_note": "coefficients are as normalised by the parser and are not ChemDFT TDDFT X/Y amplitudes",
        "energy_precision_note": "limited by the digits the program printed (the parser converts from the printed energy)",
        "energy_conversion": {"hartree": "cclib.cm-1->Eh/1", "ev": "cclib.cm-1->eV/1", "wavelength": "cm-1->nm/1"},
        "transition_dipoles": "not imported",
    }
    return payload, attrs


def build_thermochemistry(data, ctx: Context) -> tuple[dict, list[str]] | None:
    names = ("zpve", "enthalpy", "freeenergy", "entropy", "temperature")
    if not all(has(data, n) for n in names):
        return None
    t = float(data.temperature)
    p = float(data.pressure) if has(data, "pressure") else None
    attrs = list(names) + (["pressure"] if p is not None else [])
    payload = _header("thermochemistry", ctx, attrs) | {
        "reported_by": ctx.program_label,
        "temperature_k": t,
        "pressure_atm": p,
        "pressure_pa": units.atm_to_pa(p) if p is not None else None,
        "zero_point_energy_hartree": units.scalar(float(data.zpve), "Eh", float(data.zpve), "Eh", "identity"),
        "enthalpy_hartree": units.scalar(float(data.enthalpy), "Eh", float(data.enthalpy), "Eh", "identity"),
        "gibbs_free_energy_hartree": units.scalar(float(data.freeenergy), "Eh", float(data.freeenergy), "Eh", "identity"),
        "entropy_hartree_per_k": units.scalar(float(data.entropy), "Eh/K", float(data.entropy), "Eh/K", "identity"),
        "enthalpy_and_gibbs_include_electronic_energy": True,
        "electronic_energy_hartree": ctx.info.get("scf_energy_hartree"),
        "plausibility": {"h_minus_e0_hartree": ctx.info.get("h_minus_e0"), "g_minus_e0_hartree": ctx.info.get("g_minus_e0")},
        "model": "as reported by the source program; its conventions (RRHO details, symmetry numbers, scaling, standard state) are NOT reinterpreted",
        "recomputed_by_chemdft": False,
        "temperature_pressure_preview": "not available for imported thermochemistry",
        "component_breakdown": "not reported by the parser",
    }
    return payload, attrs


def assemble(data, ctx: Context) -> Built:
    built = Built()

    def add(kind: str, result: tuple[dict, list[str]] | None) -> bool:
        if result is None:
            return False
        payload, attrs = result
        built.results.append({"result_type": f"chemdft.imported.{kind}", "payload": payload, "source_attributes": attrs, "source_locators": _locs(ctx, attrs)})
        return True

    n_atoms = len(data.atomnos)
    add("structure", build_structure(data, ctx))
    optimized = ctx.declared.opt and ctx.convergence["optimization"]["status"] == "CONVERGED"
    built.items.append({"id": "structure", "state": "DETECTED", "title": f"Structure — {n_atoms} atoms", "detail": ("final optimized geometry" if optimized else "geometry as printed in the log") + f"; frame: {ctx.facts.orientation}", "result_type": "chemdft.imported.structure"})
    add("energy", build_energy(data, ctx))
    built.items.append({"id": "energy", "state": "DETECTED", "title": "Electronic energy", "detail": f"final SCF/DFT energy, {ctx.facts.reference} reference", "result_type": "chemdft.imported.energy"})
    if ctx.declared.opt and add("optimization", build_optimization(data, ctx)):
        built.items.append({"id": "optimization", "state": "DETECTED", "title": "Optimization — converged", "detail": ctx.convergence["optimization"]["evidence"], "result_type": "chemdft.imported.optimization"})
    orbital = build_orbitals(data, ctx)
    if add("orbital-table", orbital):
        built.items.append({"id": "orbitals", "state": "DETECTED", "title": "Orbital energy table", "detail": f"{len(orbital[0]['spin_channels'])} spin channel(s); orbital energies only", "result_type": "chemdft.imported.orbital-table"})
    else:
        built.items.append({"id": "orbitals", "state": "UNAVAILABLE", "title": "Orbital energy table", "detail": "no orbital energies were parsed", "result_type": None})
    vib = build_vibrations(data, ctx)
    if add("vibrations", vib):
        p = vib[0]
        imag = p["imaginary_mode_count"]
        built.items.append(
            {
                "id": "vibrations",
                "state": "DETECTED",
                "title": f"Vibrations — {p['mode_count']} modes ({'linear, 3N-5' if p['linear'] else '3N-6'})",
                "detail": f"{p['mode_count'] - imag} real, {imag} imaginary (sign preserved); displacement vectors available for animation",
                "result_type": "chemdft.imported.vibrations",
            }
        )
        built.items.append(
            {"id": "ir", "state": "DETECTED" if p["has_ir_intensities"] else "UNAVAILABLE", "title": "IR intensities", "detail": "km/mol, as reported" if p["has_ir_intensities"] else "not reported in this file", "result_type": None}
        )
        built.items.append(
            {"id": "raman", "state": "DETECTED" if p["has_raman_activities"] else "UNAVAILABLE", "title": "Raman activities", "detail": "Å⁴/amu, as reported" if p["has_raman_activities"] else "not reported in this file (never inferred from frequencies)", "result_type": None}
        )
    elif ctx.declared.freq:
        built.items.append({"id": "vibrations", "state": "UNAVAILABLE", "title": "Vibrations", "detail": "frequencies or displacement vectors were not parsed", "result_type": None})
    exc = build_excitations(data, ctx)
    if add("excitations", exc):
        spins = sorted({s["spin_label"] for s in exc[0]["states"]})
        built.items.append({"id": "excitations", "state": "DETECTED", "title": f"Electronic excitations — {exc[0]['state_count']} states", "detail": f"spin labels: {', '.join(spins)}; original order preserved", "result_type": "chemdft.imported.excitations"})
    thermo = build_thermochemistry(data, ctx)
    if add("thermochemistry", thermo):
        built.items.append({"id": "thermochemistry", "state": "DETECTED", "title": "Thermochemistry — as reported", "detail": f"reported by {ctx.program_label}; read-only, not recomputed by ChemDFT", "result_type": "chemdft.imported.thermochemistry"})
    elif vib is not None:
        built.items.append({"id": "thermochemistry", "state": "UNAVAILABLE", "title": "Thermochemistry", "detail": "not reported (or incomplete) in this file", "result_type": None})
    built.items.append({"id": "depolarization", "state": "UNAVAILABLE", "title": "Depolarization ratios", "detail": "never reported by the parser; ChemDFT does not synthesize them", "result_type": None})
    built.items.append({"id": "mo-isosurfaces", "state": "UNAVAILABLE", "title": "MO isosurfaces", "detail": "not available in V1 (no validated reconstruction from imported coefficients)", "result_type": None})
    built.items.append({"id": "dipole", "state": "UNAVAILABLE", "title": "Dipole moments", "detail": "not imported in V1 (the parser's documented unit is wrong; engine-specific conversion not validated)", "result_type": None})
    return built
