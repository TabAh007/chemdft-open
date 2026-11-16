"""Evaluation-only high-precision exact/scientific query routing."""

from __future__ import annotations

import re


DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", re.IGNORECASE)
CAS_RE = re.compile(r"\b\d{2,7}-\d{2}-\d\b")
NUMERIC_UNIT_RE = re.compile(
    r"(?<!\w)\d+(?:[.,]\d+)?\s*(?:°\s*C|°C|K|nm|Å|angstroms?|cm(?:\^-?1|⁻¹|-1)|"
    r"eV|meV|D\b|g/L|mAh/g|kJ/mol|degrees?|2\s*theta|2theta|%)(?!\w)",
    re.IGNORECASE,
)
BASIS_RE = re.compile(r"\b(?:6-31G(?:\(d\)|\*\*)?|def2-(?:SVP|TZVP|TZVPP)|cc-pV(?:D|T|Q)Z)\b", re.I)
METHOD_RE = re.compile(r"\b(?:B3LYP|PBE0?|SCAN|M06-2X|MP2|MMFF94|CAM-B3LYP)\b", re.I)
FORMULAS = frozenset(
    {"C2H6O", "LiFePO4", "CO2", "BaTiO3", "PLA", "TiO2", "Ni/Al2O3", "P3HT", "C8H10N4O2", "Cr2O3"}
)


def classify_exact_query(query: str) -> str | None:
    """Return a deterministic route label only for identifiers/tokens with exact intent."""
    if DOI_RE.search(query):
        return "doi"
    if CAS_RE.search(query):
        return "cas"
    normalized = query.casefold()
    formula_match = next(
        (
            token
            for token in FORMULAS
            if re.search(rf"(?<![\w]){re.escape(token.casefold())}(?![\w])", normalized)
        ),
        None,
    )
    if formula_match:
        explicit_formula_intent = re.search(
            r"\b(?:formula|chemical formula|molecular formula|формула|состав)\b", normalized
        )
        question_intent = re.search(
            r"\b(?:what|which|how|mean|diameter|frequency|band|temperature|при|какой|какова|"
            r"какое|насколько|частота|размер|температура|полосу)\b",
            normalized,
        )
        short_identifier_query = len(re.findall(r"[\w]+", normalized)) <= 4 and not question_intent
        if (
            normalized.strip() == formula_match.casefold()
            or explicit_formula_intent
            or short_identifier_query
        ):
            return "formula"
    if BASIS_RE.search(query):
        return "basis_set"
    if METHOD_RE.search(query):
        return "method"
    if NUMERIC_UNIT_RE.search(query):
        return "numeric_unit"
    # An unqualified decimal is not enough. In diffraction/numeric contexts, an exact
    # peak token is useful, but only when its intent word and decimal are both present.
    if re.search(r"\b(?:peak|peaks|2theta|2\s*theta)\b", normalized) and re.search(
        r"(?<!\w)\d+\.\d+(?!\w)", normalized
    ):
        return "reported_peak"
    return None


def guardrail_score(route: str | None, lexical: float, hybrid: float) -> float:
    """The guardrail changes candidate ordering only after a high-precision route."""
    return lexical if route is not None else hybrid
