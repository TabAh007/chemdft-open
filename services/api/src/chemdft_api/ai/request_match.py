"""Deterministic check of a calculation proposal against what the researcher explicitly asked for.

A model may be helpful in the wrong way: asked for HF/STO-3G it can propose HF/6-31G, and asked for
PBE0 it can quietly propose PBE. Server validators judge whether a proposal is *possible*; this
module judges whether it is *what was requested*. It reads only the researcher's own message,
uses only vocabulary the server already owns (the engine capability tables plus a list of
well-known names it cannot run), and never guesses:

* a parameter the message does not name is NOT_SPECIFIED (the model chose it; the approval screen
  says so);
* a parameter named with several different values is AMBIGUOUS and is not enforced (the researcher
  decides at approval);
* a parameter named once is enforced: the proposal must agree, or it is a MISMATCH;
* a value the server cannot run (a method or basis outside the capability tables) is still a
  constraint: the proposal cannot agree with it, so the conflict is reported instead of a different
  configuration being substituted.

Nothing here weakens a validator, calls a model or reads anything but the message and the proposal.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from ..scientific.engines.registry import (
    CAPABILITIES,
    SCIENTIFIC_BASIS_CATALOG,
    SCIENTIFIC_METHOD_CATALOG,
)

MATCH = "MATCH"
MISMATCH = "MISMATCH"
NOT_SPECIFIED = "NOT_SPECIFIED"
AMBIGUOUS = "AMBIGUOUS"

# Enforced scientific parameters, in the order they are reported.
PARAMETERS = ("task", "engine", "method", "basis", "charge", "multiplicity")
# Extra constraints reported only when the researcher asks for them: the proposal must then carry
# the feature, and the engine adapter (which cannot silently ignore it) decides whether it can run.
FEATURES = ("dispersion", "solvation", "constraints")

_METHOD_ALIASES = {
    "hartree-fock": "hf",
    "hartree fock": "hf",
    "gfn2-xtb": "gfn2",
    "gfn2 xtb": "gfn2",
}
# Well-known methods this server cannot run. They are still *named* requests: a proposal that
# swaps in a different method must be reported as a conflict, not accepted.
_UNSUPPORTED_METHODS = frozenset(
    {
        "pbe0", "b97-d", "wb97x-d", "wb97x", "wb97m-v", "m06", "m06-2x", "m06-l", "tpss", "blyp",
        "bp86", "b3pw91", "bhlyp", "b2plyp", "revpbe", "ccsd", "ccsd(t)", "mp3", "mp4", "cisd",
        "casscf", "caspt2", "lda", "svwn",
    }
)  # fmt: skip
_ENGINE_NAMES = frozenset(CAPABILITIES)
_UNSUPPORTED_ENGINES = frozenset(
    {
        "orca", "gaussian", "g16", "g09", "gamess", "nwchem", "qchem", "q-chem", "turbomole",
        "cp2k", "molpro", "dalton", "vasp", "abinit",
    }
)  # fmt: skip

_WORD_L, _WORD_R = r"(?<![A-Za-z0-9_])", r"(?![A-Za-z0-9_])"


def _alternation(names) -> str:
    return "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True))


_METHOD_RE = re.compile(
    _WORD_L
    + "("
    + _alternation({*SCIENTIFIC_METHOD_CATALOG, *_METHOD_ALIASES, *_UNSUPPORTED_METHODS})
    + ")"
    + _WORD_R,
    re.IGNORECASE,
)
_ENGINE_RE = re.compile(
    _WORD_L
    + "("
    + _alternation(_ENGINE_NAMES | _UNSUPPORTED_ENGINES)
    + ")"
    + _WORD_R
    + r"(?!\s+(?:basis|function|orbital|type|broadening|smearing))",
    re.IGNORECASE,
)
_BASIS_RE = re.compile(
    _WORD_L
    + r"("
    + "|".join(
        (
            r"sto-\d+g",
            r"\d-\d{2,3}\+{0,2}g(?:\*{1,2}|\([a-z,]+\))?",
            r"def2-[a-z0-9+]+",
            r"(?:aug-|jun-|may-)?cc-p(?:c|wc)?v[dtq56]z",
            r"lanl2dz",
        )
    )
    + r")"
    + _WORD_R,
    re.IGNORECASE,
)

_TASK_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (task, re.compile(pattern, re.IGNORECASE))
    for task, pattern in (
        (
            "ENERGY",
            r"\bsingle[- ]point\b|\b(?:total|ground[- ]state|electronic|scf)\s+energy\b"
            r"|\b(?:calculate|compute|evaluate|determine|obtain|plan|propose|run)\b[^.?!\n]{0,60}\benergy\b",
        ),
        (
            "GEOMETRY_OPTIMIZATION",
            r"\b(?:geometry|structure|molecular)\s+optimi[sz]ation\b"
            r"|\boptimi[sz]e\s+(?:the\s+|its\s+|this\s+)?(?:geometry|structure|molecule)\b"
            r"|\bgeom(?:etry)?[- ]?opt\b",
        ),
        (
            "FREQUENCY",
            r"\bfrequenc(?:y|ies)\b|\bvibrational\b|\bharmonic\b|\bhessian\b|\bir\s+spectr\w+|\braman\b",
        ),
        ("TDDFT", r"\btd-?dft\b|\buv[- /]?vis\b|\bexcited[- ]states?\b|\bexcitation energ"),
        ("ORBITAL", r"\b(?:molecular\s+)?orbitals?\b"),
        ("THERMOCHEMISTRY", r"\bthermochemi\w*\b|\bgibbs\b|\benthalpy\b|\bentropy\b"),
        ("CONFORMER_SEARCH", r"\bconformers?\b|\bconformational\s+search\b"),
    )
)
_MULTIPLICITY_WORDS = {
    "singlet": 1, "doublet": 2, "triplet": 3, "quartet": 4, "quintet": 5, "sextet": 6,
}  # fmt: skip
_CHARGE_RE = re.compile(
    r"\bcharge\b\s*(?:of|is|=|:)?\s*([+\-\u2212\u2013]?\d+)\b"
    r"|(?<![\w.])([+\-\u2212\u2013]\d+)\s+(?:charge|cation|anion)\b",
    re.IGNORECASE,
)
_MULTIPLICITY_RE = re.compile(
    r"\b(?:spin\s+)?multiplicity\b\s*(?:of|is|=|:)?\s*(\d+)\b"
    r"|\b(singlet|doublet|triplet|quartet|quintet|sextet)\b",
    re.IGNORECASE,
)
_NEUTRAL_RE = re.compile(r"\bneutral\b", re.IGNORECASE)
_CLOSED_SHELL_RE = re.compile(r"\bclosed[- ]shell\b", re.IGNORECASE)
_FEATURE_PATTERNS = {
    "dispersion": re.compile(
        r"\bdispersion\b|(?<=[A-Za-z0-9)])-d[34](?:bj|zero)?\b|\bd3\(?bj\)?\b", re.IGNORECASE
    ),
    "solvation": re.compile(
        r"\b(?:pcm|cpcm|cosmo|smd|ddcosmo|iefpcm)\b|\bimplicit\s+solvent\b|\bsolvent\s+model\b"
        r"|\bsolvation\b",
        re.IGNORECASE,
    ),
    "constraints": re.compile(
        r"\bconstrain(?:ed|t|ts)?\b|\bfrozen\b|\bfreez(?:e|ing)\b", re.IGNORECASE
    ),
}
_NEGATION_RE = re.compile(
    r"\b(?:not|never|no|without|except|avoid|instead\s+of|rather\s+than|don'?t\s+use)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class Requested:
    parameter: str
    value: str | int
    supported: bool  # False: named by the researcher but outside what this server can run
    mention: str  # the researcher's own words (short)


@dataclass(frozen=True, slots=True)
class RequestReading:
    constraints: tuple[Requested, ...] = ()
    ambiguous: tuple[str, ...] = ()
    excluded: tuple[tuple[str, str], ...] = ()  # (parameter, value) the researcher ruled out
    features: tuple[Requested, ...] = ()

    def constraint(self, parameter: str) -> Requested | None:
        return next((c for c in self.constraints if c.parameter == parameter), None)


@dataclass(frozen=True, slots=True)
class MatchItem:
    parameter: str
    outcome: str
    requested: str | int | None
    proposed: str | int | bool | None
    requested_available: bool | None = None  # False: the server cannot run what was named
    mention: str | None = None
    excluded: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "parameter": self.parameter,
            "outcome": self.outcome,
            "requested": self.requested,
            "proposed": self.proposed,
            "requested_available": self.requested_available,
            "mention": self.mention,
            "excluded": self.excluded,
        }


@dataclass(frozen=True, slots=True)
class RequestMatchReport:
    items: tuple[MatchItem, ...]

    @property
    def conflicts(self) -> tuple[MatchItem, ...]:
        return tuple(item for item in self.items if item.outcome == MISMATCH)

    @property
    def ok(self) -> bool:
        return not self.conflicts

    def as_dicts(self) -> list[dict[str, Any]]:
        return [item.as_dict() for item in self.items]


def _negated(text: str, start: int) -> bool:
    window = text[max(0, start - 24) : start]
    for delimiter in ".,;:!?\n":  # a negation does not reach across a clause boundary
        window = window.rsplit(delimiter, 1)[-1]
    return _NEGATION_RE.search(window) is not None


def _normalize(parameter: str, token: str) -> str:
    value = re.sub(r"\s+", " ", token.strip().lower())
    if parameter == "method":
        return _METHOD_ALIASES.get(value, value)
    return value


def _supported(parameter: str, value: str) -> bool:
    if parameter == "method":
        return value in SCIENTIFIC_METHOD_CATALOG
    if parameter == "basis":
        return value in SCIENTIFIC_BASIS_CATALOG
    if parameter == "engine":
        return value in _ENGINE_NAMES
    return True


def _mentions(
    text: str, parameter: str, pattern: re.Pattern[str]
) -> tuple[list[tuple[str, str]], list[str]]:
    """(positive mentions as (value, words), values the researcher ruled out)."""
    positive: list[tuple[str, str]] = []
    excluded: list[str] = []
    for found in pattern.finditer(text):
        value = _normalize(parameter, found.group(1) if found.groups() else found.group(0))
        if _negated(text, found.start()):
            excluded.append(value)
        else:
            positive.append((value, found.group(0)))
    return positive, excluded


def _reduce(parameter: str, positive: list[tuple[str, str]]) -> tuple[Requested | None, bool]:
    """(constraint, ambiguous): exactly one distinct value is a constraint; several are not."""
    values = dict.fromkeys(value for value, _ in positive)
    if not values:
        return None, False
    if len(values) > 1:
        return None, True
    value = next(iter(values))
    mention = next(raw for v, raw in positive if v == value)
    return Requested(parameter, value, _supported(parameter, value), mention[:40]), False


def read_request(text: str) -> RequestReading:
    """What the researcher's message explicitly asks for. Unknown wording yields no constraint."""
    text = text or ""
    constraints: list[Requested] = []
    ambiguous: list[str] = []
    excluded: list[tuple[str, str]] = []

    for parameter, pattern in (
        ("method", _METHOD_RE),
        ("basis", _BASIS_RE),
        ("engine", _ENGINE_RE),
    ):
        positive, negated = _mentions(text, parameter, pattern)
        constraint, unclear = _reduce(parameter, positive)
        if constraint is not None:
            constraints.append(constraint)
        if unclear:
            ambiguous.append(parameter)
        excluded.extend((parameter, value) for value in dict.fromkeys(negated))

    tasks = dict.fromkeys(task for task, pattern in _TASK_PATTERNS if pattern.search(text))
    if len(tasks) == 1:
        task = next(iter(tasks))
        mention = next(
            m.group(0)
            for t, pattern in _TASK_PATTERNS
            if t == task
            for m in [pattern.search(text)]
            if m
        )
        constraints.append(Requested("task", task, True, mention[:40]))
    elif len(tasks) > 1:
        ambiguous.append("task")

    charges: dict[int, str] = {}
    for found in _CHARGE_RE.finditer(text):
        raw = found.group(1) or found.group(2)
        charges.setdefault(int(raw.replace("\u2212", "-").replace("\u2013", "-")), found.group(0))
    if _NEUTRAL_RE.search(text):
        charges.setdefault(0, _NEUTRAL_RE.search(text).group(0))
    if len(charges) == 1:
        value, mention = next(iter(charges.items()))
        constraints.append(Requested("charge", value, True, mention[:40]))
    elif len(charges) > 1:
        ambiguous.append("charge")

    spins: dict[int, str] = {}
    for found in _MULTIPLICITY_RE.finditer(text):
        value = (
            int(found.group(1)) if found.group(1) else _MULTIPLICITY_WORDS[found.group(2).lower()]
        )
        spins.setdefault(value, found.group(0))
    if _CLOSED_SHELL_RE.search(text):
        spins.setdefault(1, _CLOSED_SHELL_RE.search(text).group(0))
    if len(spins) == 1:
        value, mention = next(iter(spins.items()))
        constraints.append(Requested("multiplicity", value, True, mention[:40]))
    elif len(spins) > 1:
        ambiguous.append("multiplicity")

    features = tuple(
        Requested(name, "requested", True, found.group(0)[:40])
        for name, pattern in _FEATURE_PATTERNS.items()
        for found in [pattern.search(text)]
        if found is not None
    )
    return RequestReading(tuple(constraints), tuple(ambiguous), tuple(excluded), features)


def proposal_summary(arguments: dict[str, Any]) -> dict[str, Any]:
    """The comparable facts of a normalized calculation.submit argument object."""
    spec = arguments.get("specification") or {}
    basis = spec.get("basis") or {}
    return {
        "task": spec.get("task_type"),
        "engine": ((spec.get("engine_preference") or {}).get("engine") or "").lower() or None,
        "method": ((spec.get("method") or {}).get("identifier") or "").lower() or None,
        "basis": (basis.get("identifier") or "").lower() or None,
        "charge": spec.get("charge"),
        "multiplicity": spec.get("multiplicity"),
        "dispersion": spec.get("dispersion") is not None,
        "solvation": spec.get("solvation") is not None,
        "constraints": bool(spec.get("constraints")),
    }


def compare_with_proposal(
    reading: RequestReading,
    arguments: dict[str, Any],
    scope: dict[str, frozenset[str]] | None = None,
) -> RequestMatchReport:
    """Compare a proposal with the request. ``scope`` restricts what this run may do.

    A planning scope (for example PySCF ENERGY only) can make a value the server knows unavailable
    to *this* run: a request outside it is a conflict to report, never to substitute.
    """
    proposed = proposal_summary(arguments)
    scope = {
        name: frozenset(str(v).lower() for v in values) for name, values in (scope or {}).items()
    }
    excluded = {(parameter, value) for parameter, value in reading.excluded}
    items: list[MatchItem] = []
    for parameter in PARAMETERS:
        constraint = reading.constraint(parameter)
        value = proposed.get(parameter)
        ruled_out = (parameter, str(value).lower() if value is not None else None) in excluded
        if constraint is not None:
            agrees = (
                str(constraint.value).lower() == str(value).lower()
                if isinstance(constraint.value, str)
                else constraint.value == value
            )
            items.append(
                MatchItem(
                    parameter,
                    MATCH if agrees and not ruled_out else MISMATCH,
                    constraint.value,
                    value,
                    requested_available=constraint.supported
                    and (
                        parameter not in scope or str(constraint.value).lower() in scope[parameter]
                    ),
                    mention=constraint.mention,
                    excluded=ruled_out,
                )
            )
        elif ruled_out:
            items.append(MatchItem(parameter, MISMATCH, None, value, excluded=True))
        elif parameter in reading.ambiguous:
            items.append(MatchItem(parameter, AMBIGUOUS, None, value))
        else:
            items.append(MatchItem(parameter, NOT_SPECIFIED, None, value))
    for feature in reading.features:
        present = bool(proposed.get(feature.parameter))
        items.append(
            MatchItem(
                feature.parameter,
                MATCH if present else MISMATCH,
                "requested",
                present,
                requested_available=None,
                mention=feature.mention,
            )
        )
    return RequestMatchReport(tuple(items))


def match_request(
    text: str, arguments: dict[str, Any], scope: dict[str, frozenset[str]] | None = None
) -> RequestMatchReport:
    return compare_with_proposal(read_request(text), arguments, scope)
