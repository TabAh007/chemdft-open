"""Explicit, versioned unit conversions (NORMALIZATION_VERSION).

cclib converts program output into its own units using its OWN constants (CODATA-2010 era). To recover the number the program
printed we must invert with the SAME constants. ChemDFT's contract constant (27.211386245988) is deliberately NOT used here: it would
change the user's reported number by 4.4e-8 relative. Values in canonical units are therefore "exactly what the logfile printed".

Observed traps (spike): cclib's documentation says dipole `moments` are a.u. but they are Debye for all engines checked -> dipoles are
NOT imported in V1. Displacement normalisation is engine specific -> direction only.
"""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import math

# cclib.parser.utils.convertor constants (verified against the installed pinned commit by tests)
CCLIB_HARTREE_TO_EV = 27.21138505
CCLIB_EV_TO_WAVENUMBER = 8065.54429
CCLIB_WAVENUMBER_TO_HARTREE = 219474.6313708
ATM_TO_PA = 101325.0  # exact by definition

CONVERSIONS: dict[str, dict[str, str]] = {
    "cclib.eV->Eh/1": {"from": "eV", "to": "Eh", "formula": "x / 27.21138505", "note": "inverts cclib's hartree->eV constant so the printed Hartree value is recovered exactly"},
    "cclib.cm-1->Eh/1": {"from": "cm^-1", "to": "Eh", "formula": "x / 219474.6313708", "note": "cclib's wavenumber->hartree constant"},
    "cclib.cm-1->eV/1": {"from": "cm^-1", "to": "eV", "formula": "x / 8065.54429", "note": "cclib's wavenumber->eV constant"},
    "cm-1->nm/1": {"from": "cm^-1", "to": "nm", "formula": "1e7 / x", "note": "exact reciprocal"},
    "atm->Pa/1": {"from": "atm", "to": "Pa", "formula": "x * 101325", "note": "exact by definition"},
    "identity": {"from": "same", "to": "same", "formula": "x", "note": "cclib already reports the canonical unit"},
}


def eV_to_hartree(value_ev: float) -> float:
    return float(value_ev) / CCLIB_HARTREE_TO_EV


def wavenumber_to_hartree(value_cm1: float) -> float:
    return float(value_cm1) / CCLIB_WAVENUMBER_TO_HARTREE


def wavenumber_to_ev(value_cm1: float) -> float:
    return float(value_cm1) / CCLIB_EV_TO_WAVENUMBER


def wavenumber_to_nm(value_cm1: float) -> float:
    if value_cm1 <= 0:
        raise ValueError("excitation energy must be positive")
    return 1.0e7 / float(value_cm1)


def atm_to_pa(value_atm: float) -> float:
    return float(value_atm) * ATM_TO_PA


def finite(value: float) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def scalar(raw_value: float, raw_unit: str, canonical_value: float, canonical_unit: str, conversion: str) -> dict:
    """A quantity that keeps the raw parsed value and its unit next to the canonical value."""
    return {"value": float(canonical_value), "unit": canonical_unit, "raw_value": float(raw_value), "raw_unit": raw_unit, "conversion": conversion}
