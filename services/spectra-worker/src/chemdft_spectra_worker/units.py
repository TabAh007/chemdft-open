"""Units, conversions and the unit-evidence policy for experimental spectra.

Two rules matter more than the arithmetic:

1. Unit *evidence* is explicit. A unit suggested by a value range, a file name or a typical convention is a HINT: the UI
   may offer it, but it can never authorise persistence. Only `EXPLICIT_UNIT` (written in the file) and `USER_CONFIRMED`
   (a person confirmed it in the import preview) allow a raw dataset to be committed.
2. Changing an axis is a DERIVED comparison transform, never an edit of the raw data. Absorbance, molar absorptivity and
   cross-section are intensive point values (relabel the axis only). Densities (area-normalised calculated curves,
   emission) change by |d lambda / d nu| under a non-linear axis change. Integrals and centroids (oscillator strength)
   must be taken over a LINEAR energy-like axis (cm^-1 or eV), never over nm.
"""
# ruff: noqa: E501, RUF001  (long evidence strings, scientific symbols and human-readable diagnostics)

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from enum import StrEnum

import numpy as np

# CODATA 2018 (exact SI defining constants where applicable).
PLANCK_J_S = 6.62607015e-34
LIGHT_M_S = 299792458.0
ELEMENTARY_CHARGE_C = 1.602176634e-19
AVOGADRO = 6.02214076e23
ELECTRON_MASS_KG = 9.1093837015e-31
VACUUM_PERMITTIVITY = 8.8541878128e-12
EV_NM_PRODUCT = PLANCK_J_S * LIGHT_M_S / ELEMENTARY_CHARGE_C * 1e9
EV_PER_INVERSE_CM = PLANCK_J_S * LIGHT_M_S * 100.0 / ELEMENTARY_CHARGE_C

TECHNIQUES = ("IR", "RAMAN", "UVVIS")

# V1 raw axis units per technique. Everything else is rejected, not guessed.
ALLOWED_X_UNITS: dict[str, tuple[str, ...]] = {
    "IR": ("cm^-1", "um"),
    "RAMAN": ("cm^-1",),
    "UVVIS": ("nm", "eV", "cm^-1"),
}
ALLOWED_Y: dict[str, dict[str, tuple[str, ...]]] = {
    "IR": {"ABSORBANCE": ("absorbance",), "TRANSMITTANCE": ("percent", "fraction")},
    "RAMAN": {"INTENSITY": ("counts", "arbitrary")},
    "UVVIS": {
        "ABSORBANCE": ("absorbance",),
        "TRANSMITTANCE": ("percent", "fraction"),
        "CROSS_SECTION": ("cm^2/molecule",),
        "MOLAR_ABSORPTIVITY": ("L/(mol*cm)",),
    },
}
X_QUANTITY_FOR_UNIT = {"cm^-1": "WAVENUMBER", "um": "WAVELENGTH", "nm": "WAVELENGTH", "eV": "ENERGY"}


class EvidenceLevel(StrEnum):
    EXPLICIT_UNIT = "EXPLICIT_UNIT"
    QUANTITY_NAME = "QUANTITY_NAME"
    HINT_ONLY = "HINT_ONLY"
    USER_CONFIRMED = "USER_CONFIRMED"
    NONE = "NONE"

    @property
    def accepted(self) -> bool:
        return self in (EvidenceLevel.EXPLICIT_UNIT, EvidenceLevel.USER_CONFIRMED)


@dataclass(frozen=True)
class UnitGuess:
    quantity: str | None
    unit: str | None
    level: EvidenceLevel
    evidence: str


_X_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"cm\s*\^?\s*[-−–]\s*1|cm⁻¹|1\s*/\s*cm|\bwavenumbers?\s*\(?\s*cm", re.I), "cm^-1"),
    (re.compile(r"\bnm\b|nanomet", re.I), "nm"),
    (re.compile(r"[µμ]m\b|\bum\b|micron|micromet", re.I), "um"),
    (re.compile(r"\beV\b|electron\s*volt", re.I), "eV"),
]
_X_QUANTITY: list[tuple[re.Pattern[str], str, str | None]] = [
    (re.compile(r"raman\s*shift", re.I), "RAMAN_SHIFT", "cm^-1"),
    (re.compile(r"wave\s*-?\s*numbers?", re.I), "WAVENUMBER", "cm^-1"),
    (re.compile(r"wave\s*-?\s*length", re.I), "WAVELENGTH", "nm"),
    (re.compile(r"\benergy\b", re.I), "ENERGY", None),
]
_Y_PATTERNS: list[tuple[re.Pattern[str], str, str | None, str]] = [
    (re.compile(r"%\s*T\b|\bT\s*\(?\s*%|percent\s*transmittance|transmittance\s*\(?\s*%", re.I), "TRANSMITTANCE", "percent", "unit"),
    (re.compile(r"cross[\s-]*sect|σ|\bsigma\b|cm\s*\^?\s*2\s*/?\s*molec", re.I), "CROSS_SECTION", "cm^2/molecule", "unit"),
    (re.compile(r"molar\s*(absorptivity|extinction)|ε|epsilon|[LM]\s*\^?\s*-?1?\s*mol\s*\^?\s*[-−]\s*1\s*cm|M\s*\^?\s*[-−]\s*1\s*cm", re.I), "MOLAR_ABSORPTIVITY", "L/(mol*cm)", "unit"),
    (re.compile(r"\babsorbance\b|\babs\b|\bOD\b|absorption\s*units|\bAU\b", re.I), "ABSORBANCE", "absorbance", "unit"),
    (re.compile(r"transmittance|\btrans(mission)?\b", re.I), "TRANSMITTANCE", None, "quantity"),
    (re.compile(r"\bcounts?\b|\bcts\b|\bcps\b", re.I), "INTENSITY", "counts", "unit"),
    (re.compile(r"a\.?\s*u\.?|arb(itrary)?|intensity", re.I), "INTENSITY", "arbitrary", "unit"),
]


def guess_x_unit(label: str | None) -> UnitGuess:
    if not label:
        return UnitGuess(None, None, EvidenceLevel.NONE, "no axis label in the file")
    for pattern, unit in _X_PATTERNS:
        if pattern.search(label):
            quantity = next((q for p, q, _u in _X_QUANTITY if p.search(label)), None)
            return UnitGuess(quantity, unit, EvidenceLevel.EXPLICIT_UNIT, f'unit written in the file label "{label.strip()}"')
    for pattern, quantity, implied in _X_QUANTITY:
        if pattern.search(label):
            suffix = f"; {implied} is conventional, not written" if implied else ""
            return UnitGuess(quantity, implied, EvidenceLevel.QUANTITY_NAME, f'label "{label.strip()}" names the quantity but not the unit{suffix}')
    return UnitGuess(None, None, EvidenceLevel.NONE, f'label "{label.strip()}" does not identify an axis unit')


def guess_y_unit(label: str | None) -> UnitGuess:
    if not label:
        return UnitGuess(None, None, EvidenceLevel.NONE, "no signal label in the file")
    for pattern, quantity, unit, kind in _Y_PATTERNS:
        if pattern.search(label):
            if kind == "unit" and unit is not None:
                return UnitGuess(quantity, unit, EvidenceLevel.EXPLICIT_UNIT, f'quantity/unit written in the file label "{label.strip()}"')
            return UnitGuess(quantity, unit, EvidenceLevel.QUANTITY_NAME, f'label "{label.strip()}" names {quantity.lower()} but not its scale (percent or fraction)')
    return UnitGuess(None, None, EvidenceLevel.NONE, f'label "{label.strip()}" does not identify a signal quantity')


def range_hint_x(x: np.ndarray, technique: str) -> UnitGuess:
    """A SUGGESTION from the value range. Never accepted without confirmation (HINT_ONLY)."""
    lo, hi = float(np.nanmin(x)), float(np.nanmax(x))
    if technique in ("IR", "RAMAN") and lo >= -50 and hi <= 6000:
        return UnitGuess("WAVENUMBER", "cm^-1", EvidenceLevel.HINT_ONLY, f"range {lo:g}-{hi:g} is typical of cm^-1 for {technique}")
    if technique == "UVVIS" and lo >= 100 and hi <= 3500:
        return UnitGuess("WAVELENGTH", "nm", EvidenceLevel.HINT_ONLY, f"range {lo:g}-{hi:g} is typical of nm for UV/Vis")
    return UnitGuess(None, None, EvidenceLevel.NONE, f"range {lo:g}-{hi:g} does not match a conventional {technique} axis")


def unit_allowed(technique: str, x_unit: str | None) -> bool:
    return x_unit in ALLOWED_X_UNITS.get(technique, ())


def y_allowed(technique: str, quantity: str | None, unit: str | None) -> bool:
    return unit in ALLOWED_Y.get(technique, {}).get(quantity or "", ())


# ---------------------------------------------------------------- axis conversions (DERIVED; never applied to raw data)
def to_wavenumber_cm1(x: np.ndarray, unit: str) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    if unit == "cm^-1":
        return x.copy()
    if unit == "nm":
        return 1e7 / x
    if unit == "um":
        return 1e4 / x
    if unit == "eV":
        return x / EV_PER_INVERSE_CM
    raise ValueError(f"cannot convert {unit} to cm^-1")


def to_ev(x: np.ndarray, unit: str) -> np.ndarray:
    return to_wavenumber_cm1(x, unit) * EV_PER_INVERSE_CM


def to_nm(x: np.ndarray, unit: str) -> np.ndarray:
    return 1e7 / to_wavenumber_cm1(x, unit)


def convert_axis(x: np.ndarray, from_unit: str, to_unit: str) -> np.ndarray:
    if to_unit == "cm^-1":
        return to_wavenumber_cm1(x, from_unit)
    if to_unit == "eV":
        return to_ev(x, from_unit)
    if to_unit == "nm":
        return to_nm(x, from_unit)
    raise ValueError(f"unsupported target axis unit {to_unit}")


def density_to_wavenumber(x_nm: np.ndarray, y_per_nm: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Intensity DENSITY per nm -> per cm^-1: y(nu) = y(lambda) * lambda^2 / 1e7. Never for absorbance, epsilon or cross sections."""
    x_nm = np.asarray(x_nm, dtype=float)
    return 1e7 / x_nm, np.asarray(y_per_nm, dtype=float) * (x_nm**2) / 1e7


# ---------------------------------------------------------------- intensity relations used by the UV/Vis comparison
SIGMA_TO_EPSILON = AVOGADRO / (1000.0 * math.log(10.0))  # (L mol^-1 cm^-1) per (cm^2 molecule^-1)
# SI: integral(sigma d nu) = e^2 f / (4 eps0 m_e c); with d nu = c d nu_tilde: f = (4 eps0 m_e c^2 / e^2) * integral(sigma d nu_tilde).
_F_PREFACTOR_SI = 4.0 * VACUUM_PERMITTIVITY * ELECTRON_MASS_KG * LIGHT_M_S**2 / ELEMENTARY_CHARGE_C**2
F_PER_CM2_CM1 = _F_PREFACTOR_SI * 1e-4 * 1e2  # cm^2 -> m^2 and cm^-1 -> m^-1; about 1.1296e12


def cross_section_to_epsilon(sigma_cm2: np.ndarray) -> np.ndarray:
    return np.asarray(sigma_cm2, dtype=float) * SIGMA_TO_EPSILON


def epsilon_to_cross_section(epsilon: np.ndarray) -> np.ndarray:
    return np.asarray(epsilon, dtype=float) / SIGMA_TO_EPSILON


def band_oscillator_strength(nu_cm1: np.ndarray, sigma_cm2: np.ndarray) -> float:
    """f = F_PER_CM2_CM1 * integral(sigma d nu_tilde), trapezoid on the native (possibly non-uniform) cm^-1 grid."""
    order = np.argsort(nu_cm1)
    return float(F_PER_CM2_CM1 * np.trapezoid(np.asarray(sigma_cm2, float)[order], np.asarray(nu_cm1, float)[order]))
