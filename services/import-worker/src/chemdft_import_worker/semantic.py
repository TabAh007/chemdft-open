"""Scientific validation of what cclib returned, against the log's own raw facts.

Nothing here trusts cclib: charge/multiplicity, atom count, energy, frequencies and mode counts are cross-checked with text read
directly from the log (see logscan.raw_facts), and structural invariants (finite coordinates, 3N-6 / 3N-5, signed frequencies, Eckart
frame consistency, thermochemistry plausibility) are enforced independently.
"""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import math

import numpy as np

from . import units
from .findings import Finding
from .logscan import RawFacts

LINEAR_STRICT = 1e-3  # SVD singular-value ratio below which a geometry is collinear
LINEAR_LOOSE = 1e-2  # above which it is definitely not collinear; in between either count is accepted with a warning
ECKART_WARN = 1e-3
ECKART_REJECT = 0.2  # printed-precision noise reaches ~0.03; a genuine frame mismatch is order 1
ENERGY_RECOVERY_TOLERANCE_HARTREE = 1e-8
THERMO_MAX_ABS_CORRECTION_HARTREE = 5.0  # |H - E0| beyond this means the parser returned a correction instead of a total (cclib 1.8.1 Q-Chem trap)


def has(data, name: str) -> bool:
    return hasattr(data, name) and getattr(data, name) is not None


def optdone_flag(data) -> bool | None:
    if not has(data, "optdone"):
        return None
    flag = data.optdone
    if isinstance(flag, (bool, np.bool_)):
        return bool(flag)
    try:
        arr = np.asarray(flag)
        return bool(arr.ravel()[-1]) if arr.size else False
    except Exception:
        return None


def collinearity_ratio(coords: np.ndarray) -> float:
    if len(coords) <= 2:
        return 0.0
    centered = coords - coords[0]
    singular = np.linalg.svd(centered, compute_uv=False)
    return float(singular[1] / singular[0]) if singular[0] > 0 else 0.0


def standard_masses(atomnos) -> np.ndarray:
    from periodictable import elements

    return np.array([elements[int(z)].mass for z in atomnos], dtype=float)


def frame_masses(data, natom: int, findings: list[Finding]) -> np.ndarray:
    """cclib `atommasses` is concatenated across Gaussian internal job steps or absent: never trust its length."""
    std = standard_masses(data.atomnos)
    if has(data, "atommasses"):
        am = np.asarray(data.atommasses, dtype=float)
        if len(am) == natom:
            return am
        if len(am) and len(am) % natom == 0:
            findings.append(Finding("ATOMMASSES_CONCATENATED_BY_CCLIB", "info", f"cclib returned {len(am)} atom masses for {natom} atoms (internal job steps); the last {natom} were used."))
            return am[-natom:]
        findings.append(Finding("ATOMMASSES_INCONSISTENT_LENGTH", "warning", f"cclib returned {len(am)} atom masses for {natom} atoms; standard masses were used for the frame check."))
        return std
    findings.append(Finding("ATOMMASSES_ABSENT", "info", "cclib returned no atom masses; standard atomic masses were used for the displacement frame check."))
    return std


def check_structure(data, raw: RawFacts) -> tuple[list[Finding], dict]:
    f: list[Finding] = []
    info: dict = {}
    if not (has(data, "atomnos") and has(data, "atomcoords")):
        return [Finding("STRUCTURE_UNAVAILABLE", "reject", "No atomic numbers or coordinates were parsed.")], info
    z = np.asarray(data.atomnos)
    coords = np.asarray(data.atomcoords, dtype=float)
    if coords.ndim != 3 or coords.shape[0] < 1 or coords.shape[2] != 3 or coords.shape[1] != len(z):
        return [Finding("GEOMETRY_INVALID", "reject", f"Unexpected coordinate array shape {coords.shape} for {len(z)} atoms.")], info
    if not np.isfinite(coords).all() or any(int(v) < 1 or int(v) > 118 for v in z):
        f.append(Finding("GEOMETRY_INVALID", "reject", "Non-finite coordinates or invalid atomic numbers."))
    info["natom"] = len(z)
    if raw.natom is None:
        f.append(Finding("ATOM_COUNT_NOT_CROSS_CHECKED", "warning", "The atom count could not be read from the log to cross-check the parser."))
    elif raw.natom != len(z):
        f.append(Finding("ATOM_COUNT_MISMATCH", "reject", f"cclib parsed {len(z)} atoms but the log states {raw.natom}."))
    if not (has(data, "charge") and has(data, "mult")):
        f.append(Finding("CHARGE_MULTIPLICITY_UNKNOWN", "reject", "Charge or multiplicity could not be established."))
    else:
        info["charge"], info["multiplicity"] = int(data.charge), int(data.mult)
        if info["multiplicity"] < 1:
            f.append(Finding("CHARGE_MULTIPLICITY_UNKNOWN", "reject", "Multiplicity must be >= 1."))
        if raw.charge is None or raw.multiplicity is None:
            f.append(Finding("CHARGE_MULTIPLICITY_NOT_CROSS_CHECKED", "warning", "Charge and multiplicity could not be read from the log to cross-check the parser."))
        elif (raw.charge, raw.multiplicity) != (info["charge"], info["multiplicity"]):
            f.append(Finding("CHARGE_MULTIPLICITY_MISMATCH", "reject", f"cclib reports charge/multiplicity {(info['charge'], info['multiplicity'])} but the log echoes {(raw.charge, raw.multiplicity)}."))
    return f, info


def check_spin(data, raw: RawFacts, info: dict) -> list[Finding]:
    f: list[Finding] = []
    if not has(data, "moenergies") or "multiplicity" not in info:
        return f
    channels = len(data.moenergies)
    info["spin_channels"] = channels
    mult = info["multiplicity"]
    if mult > 1 and channels != 2:
        if raw.reference == "restricted-open-shell":
            f.append(Finding("OPEN_SHELL_SINGLE_ORBITAL_CHANNEL", "warning", "Restricted open-shell reference: a single orbital set is reported; occupations are not derived."))
        else:
            f.append(Finding("SPIN_CHANNELS_LOST", "reject", f"Multiplicity {mult} but {channels} orbital spin channel(s) were parsed."))
    elif mult == 1 and channels == 2:
        f.append(Finding("UNRESTRICTED_SINGLET", "info", "Singlet calculated with an unrestricted reference (two spin channels)."))
    return f


def check_energy(data, raw: RawFacts, info: dict) -> list[Finding]:
    f: list[Finding] = []
    if has(data, "mpenergies") or has(data, "ccenergies"):
        return [Finding("CORRELATED_METHOD_NOT_SUPPORTED_V1", "reject", "Perturbation/coupled-cluster energies are present; External Import V1 supports HF/DFT jobs only.")]
    if not has(data, "scfenergies") or len(data.scfenergies) == 0:
        return [Finding("NO_SCF_ENERGY", "reject", "No SCF/DFT energy was parsed.")]
    energy = float(np.asarray(data.scfenergies)[-1])
    if not math.isfinite(energy):
        return [Finding("NO_SCF_ENERGY", "reject", "The SCF/DFT energy is not finite.")]
    recovered = units.eV_to_hartree(energy)
    info["scf_energy_raw_ev"] = energy
    info["scf_energy_hartree"] = recovered
    if raw.scf_energy_hartree is not None:
        info["energy_recovery_error_hartree"] = recovered - raw.scf_energy_hartree
        if abs(recovered - raw.scf_energy_hartree) > ENERGY_RECOVERY_TOLERANCE_HARTREE:
            f.append(Finding("ENERGY_MISMATCH", "reject", f"Recovered {recovered!r} Eh does not match the value printed in the log ({raw.scf_energy_hartree!r} Eh)."))
    else:
        f.append(Finding("ENERGY_NOT_CROSS_CHECKED", "warning", "The log's own SCF energy could not be located to cross-check the parsed value."))
    return f


def check_vibrations(data, raw: RawFacts, info: dict, findings_out: list[Finding]) -> list[Finding]:
    f: list[Finding] = []
    if not has(data, "vibfreqs"):
        return f
    freqs = np.asarray(data.vibfreqs, dtype=float)
    natom = info.get("natom", 0)
    if not np.isfinite(freqs).all():
        return [Finding("VIBRATIONAL_DATA_INVALID", "reject", "Non-finite vibrational frequencies.")]
    coords = np.asarray(data.atomcoords[-1], dtype=float)
    ratio = collinearity_ratio(coords)
    lin_strict, lin_loose = ratio < LINEAR_STRICT, ratio < LINEAR_LOOSE
    n = len(freqs)
    nonlinear_count, linear_count = max(0, 3 * natom - 6), max(0, 3 * natom - 5)
    if natom == 1:
        nonlinear_count = linear_count = 0
    info.update(modes=n, collinearity_ratio=ratio, linear=lin_strict, imaginary=int((freqs < 0).sum()))
    if lin_strict:
        expected, ambiguous = linear_count, False
    elif lin_loose:
        expected, ambiguous = (linear_count if n == linear_count else nonlinear_count), True
    else:
        expected, ambiguous = nonlinear_count, False
    info["expected_modes"], info["linear_ambiguous"] = expected, ambiguous
    if n != expected:
        f.append(Finding("VIBRATIONAL_MODE_COUNT_MISMATCH", "reject", f"{n} vibrational modes parsed, expected {expected} ({'3N-5 for a linear molecule' if lin_strict else '3N-6'})."))
    elif ambiguous:
        f.append(Finding("NEAR_LINEAR_GEOMETRY", "warning", "The geometry is nearly but not strictly collinear; the mode count matches one valid convention."))
    printed = np.asarray(raw.printed_frequencies, dtype=float)
    if len(printed):
        same = len(printed) == n and bool(np.allclose(np.sort(printed), np.sort(freqs), atol=1e-3))
        info["frequencies_match_printed_table"] = same
        if not same:
            f.append(Finding("FREQUENCY_MISMATCH", "reject", f"The parsed frequencies ({n}) do not match the log's printed table ({len(printed)})."))
        if int((printed < 0).sum()) != int((freqs < 0).sum()):
            f.append(Finding("IMAGINARY_MODE_MISMATCH", "reject", "Imaginary-mode count differs between the parsed data and the printed table."))
    if int((freqs < 0).sum()):
        f.append(Finding("IMAGINARY_FREQUENCIES_PRESENT", "warning", f"{int((freqs < 0).sum())} imaginary mode(s) are preserved with their sign: {[round(float(x), 2) for x in freqs[freqs < 0]]} cm^-1."))
    if has(data, "vibdisps"):
        disp = np.asarray(data.vibdisps, dtype=float)
        if disp.shape != (n, natom, 3) or not np.isfinite(disp).all():
            f.append(Finding("DISPLACEMENTS_INVALID", "reject", f"Displacement array shape {disp.shape} is not ({n}, {natom}, 3) or contains non-finite values."))
        else:
            masses = frame_masses(data, natom, findings_out)
            centered = coords - (masses[:, None] * coords).sum(0) / masses.sum()
            worst_rot = worst_tr = 0.0
            for d in disp:
                m_norm = math.sqrt(float((masses[:, None] * d**2).sum()))
                scale = m_norm * math.sqrt(float((masses[:, None] * centered**2).sum()))
                if m_norm > 0:
                    worst_tr = max(worst_tr, float(np.linalg.norm((masses[:, None] * d).sum(0))) / (m_norm * math.sqrt(float(masses.sum()))))
                if scale > 0:
                    worst_rot = max(worst_rot, float(np.linalg.norm((masses[:, None] * np.cross(centered, d)).sum(0))) / scale)
            info["eckart_rotation_worst_relative"], info["eckart_translation_worst_relative"] = worst_rot, worst_tr
            if worst_rot > ECKART_REJECT:
                f.append(Finding("DISPLACEMENT_FRAME_MISMATCH", "reject", f"The displacement vectors are not consistent with the stored coordinates (Eckart rotation residual {worst_rot:.3g})."))
            elif worst_rot > ECKART_WARN or worst_tr > 0.01:
                f.append(Finding("DISPLACEMENT_PRECISION_LIMITED", "warning", f"Displacement vectors carry limited printed precision (Eckart residual {worst_rot:.2g}); direction is approximate."))
    return f


def check_excitations(data) -> list[Finding]:
    if not has(data, "etenergies"):
        return []
    e = np.asarray(data.etenergies, dtype=float)
    if len(e) == 0 or not np.isfinite(e).all() or (e <= 0).any():
        return [Finding("EXCITATION_DATA_INVALID", "reject", "Excitation energies are missing, non-finite or non-positive.")]
    f: list[Finding] = []
    for attr in ("etoscs", "etsyms"):
        if has(data, attr) and len(getattr(data, attr)) != len(e):
            f.append(Finding("EXCITATION_DATA_INVALID", "reject", f"{attr} has {len(getattr(data, attr))} entries for {len(e)} excitation energies."))
    return f


def check_thermo(data, info: dict) -> list[Finding]:
    names = ("zpve", "enthalpy", "freeenergy", "entropy", "temperature")
    present = [n for n in names if has(data, n)]
    if not present:
        return []
    if len(present) != len(names):
        return [Finding("THERMOCHEMISTRY_INCOMPLETE", "warning", f"Thermochemistry is partial ({', '.join(present)}); it will not be imported.")]
    f: list[Finding] = []
    values = {n: float(getattr(data, n)) for n in names}
    if not all(math.isfinite(v) for v in values.values()) or values["temperature"] <= 0 or values["entropy"] <= 0 or values["zpve"] <= 0:
        return [Finding("THERMOCHEMISTRY_INVALID", "reject", "Reported thermochemistry contains non-finite or non-physical values.")]
    e0 = info.get("scf_energy_hartree")
    if e0 is not None:
        dh, dg = values["enthalpy"] - e0, values["freeenergy"] - e0
        info["h_minus_e0"], info["g_minus_e0"] = dh, dg
        if not (0 < dh < THERMO_MAX_ABS_CORRECTION_HARTREE) or abs(dg) > THERMO_MAX_ABS_CORRECTION_HARTREE:
            f.append(Finding("THERMOCHEMISTRY_SEMANTICS_SUSPECT", "reject", f"Reported H differs from the electronic energy by {dh:.3f} Eh: the parser likely returned a thermal correction instead of a total (this is a known cclib release trap)."))
    return f
