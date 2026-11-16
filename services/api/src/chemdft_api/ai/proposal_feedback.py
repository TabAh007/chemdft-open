"""Structured, value-free feedback when a calculation proposal is refused.

The repair loop returns a refused proposal to the model, and a proposal that cannot be repaired is
shown to the researcher as the real blocker. Both need more than "Tool arguments failed schema
validation." This module turns every kind of refusal into a stable code, a server-authored summary
and a short list of issues that name the field and the problem:

* field paths are sanitized (identifier-shaped names only), and nothing the model typed is echoed
  back except the researcher's own words for a request conflict;
* allowed values come from the server's own capability and enum tables, never from the proposal;
* summaries keep the exact wording earlier clients already see in the ``error`` key, so this adds
  information without changing any existing text.

It decides nothing: validators still decide whether a proposal is accepted. It never changes a
requirement the researcher stated, and it tells the model not to substitute one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from ..contracts.tools import ToolErrorCode
from ..errors import ApplicationError, EngineUnavailable, UnsupportedCalculation
from ..scientific.engines.registry import (
    CAPABILITIES,
    PYSCF_MAX_ATOMIC_NUMBER,
    SCIENTIFIC_BASIS_CATALOG,
    SCIENTIFIC_METHOD_CATALOG,
)
from ..tool_registry.registry import ToolInvocationError
from .providers import AIFoundationError
from .request_match import MISMATCH, RequestMatchReport

MAX_ISSUES = 8
_FIELD_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,39}$")
_QUOTED = re.compile(r"'[^']*'|\"[^\"]*\"")

ARGUMENT_SCHEMA = "ARGUMENT_SCHEMA"
STRUCTURE_VERSION = "STRUCTURE_VERSION"
PROFILE_SCOPE = "PROFILE_SCOPE"
REQUEST_MISMATCH = "REQUEST_MISMATCH"
ENGINE_CAPABILITY = "ENGINE_CAPABILITY"
ENGINE_UNAVAILABLE = "ENGINE_UNAVAILABLE"
ELECTRONIC_STATE = "ELECTRONIC_STATE"
NAVIGATOR = "NAVIGATOR"
NOT_PERMITTED = "NOT_PERMITTED"
UNEXPECTED = "UNEXPECTED"

_FIELD_OF = {
    "task": "specification.task_type",
    "engine": "specification.engine_preference.engine",
    "method": "specification.method.identifier",
    "basis": "specification.basis.identifier",
    "charge": "specification.charge",
    "multiplicity": "specification.multiplicity",
    "dispersion": "specification.dispersion",
    "solvation": "specification.solvation",
    "constraints": "specification.constraints",
}
_PROBLEM_MESSAGE = {
    "REQUIRED": "This field is required.",
    "NOT_ALLOWED": "This field is not part of the schema; remove it.",
    "INVALID_CHOICE": "This value is not one of the allowed choices.",
    "WRONG_TYPE": "This field has the wrong type.",
    "TOO_SHORT": "This field is too short or empty.",
    "TOO_LONG": "This field is too long.",
    "OUT_OF_RANGE": "This number is outside the allowed range.",
    "INVALID_VALUE": "This value is not valid.",
    "INVALID": "This field failed validation.",
}


@dataclass(frozen=True, slots=True)
class Issue:
    code: str
    field: str | None
    message: str
    requested: str | int | None = None
    proposed: str | int | bool | None = None
    allowed: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {"code": self.code, "field": self.field, "message": self.message}
        if self.requested is not None:
            data["requested"] = self.requested
        if self.proposed is not None:
            data["proposed"] = self.proposed
        if self.allowed:
            data["allowed"] = list(self.allowed)
        return data


@dataclass(frozen=True, slots=True)
class Refusal:
    code: str
    summary: str
    issues: tuple[Issue, ...]
    next_step: str

    def model_payload(self) -> dict[str, Any]:
        """What the model sees. ``error`` keeps the long-standing summary text."""
        return {
            "error": self.summary,
            "code": self.code,
            "issues": [issue.as_dict() for issue in self.issues],
            "next_step": self.next_step,
        }

    def stored(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "summary": self.summary,
            "issues": [issue.as_dict() for issue in self.issues],
            "next_step": self.next_step,
        }

    def blocker_text(self, attempts: int) -> str:
        """The researcher-facing blocker; bounded in length and free of internal detail."""
        lines = [
            f"The AI Scientist could not produce a proposal that passes ChemDFT's checks "
            f"({attempts} attempt{'s' if attempts != 1 else ''}). Nothing was submitted or "
            f"computed.",
            f"Last blocker: {self.summary}",
        ]
        lines.extend(f"- {issue.message}" for issue in self.issues[:4])
        return "\n".join(lines)[:1200]


class ProposalRefused(AIFoundationError):
    """A refusal that already carries its structured explanation."""

    def __init__(self, refusal: Refusal, status_code: int = 422) -> None:
        self.refusal = refusal
        super().__init__(refusal.code, refusal.summary, status_code)


def safe_detail(detail: str | None, limit: int = 240) -> str:
    """Server prose with any quoted (possibly model-supplied) fragment masked."""
    return _QUOTED.sub("'…'", detail or "")[:limit]


def _path(location: tuple[object, ...]) -> str:
    parts = []
    for part in location:
        if isinstance(part, int):
            parts.append(f"[{part}]")
        elif isinstance(part, str) and _FIELD_NAME.match(part):
            parts.append(part)
        else:
            parts.append("?")
    return ".".join(parts).replace(".[", "[")


def _problem(kind: str) -> str:
    if kind == "missing":
        return "REQUIRED"
    if kind == "extra_forbidden":
        return "NOT_ALLOWED"
    if kind in {"literal_error", "enum"}:
        return "INVALID_CHOICE"
    if kind.endswith("_type") or kind.endswith("_parsing"):
        return "WRONG_TYPE"
    if "too_short" in kind or kind == "string_too_short":
        return "TOO_SHORT"
    if "too_long" in kind:
        return "TOO_LONG"
    if kind.startswith(("greater_than", "less_than", "int_", "float_")):
        return "OUT_OF_RANGE"
    if kind in {"value_error", "assertion_error"}:
        return "INVALID_VALUE"
    return "INVALID"


def schema_issues(error: ValidationError) -> tuple[Issue, ...]:
    """Field paths and problem classes only: never the supplied value."""
    issues: list[Issue] = []
    seen: set[tuple[str, str]] = set()
    for item in error.errors(include_url=False, include_input=False):
        field = _path(tuple(item.get("loc", ())))
        problem = _problem(str(item.get("type", "")))
        if (field, problem) in seen:
            continue
        seen.add((field, problem))
        allowed: tuple[str, ...] = ()
        expected = (item.get("ctx") or {}).get("expected")
        if problem == "INVALID_CHOICE" and isinstance(expected, str):
            allowed = tuple(re.findall(r"'([^']{1,60})'", expected))[:12]
        issues.append(Issue(problem, field or None, _PROBLEM_MESSAGE[problem], allowed=allowed))
        if len(issues) >= MAX_ISSUES:
            break
    return tuple(issues)


def profile_issues(selected_version_id: str | None, arguments: dict[str, Any]) -> tuple[Issue, ...]:
    """Which part of the PySCF ENERGY planning scope the proposal leaves."""
    spec = arguments.get("specification") or {}
    issues: list[Issue] = []
    task = spec.get("task_type")
    if task != "ENERGY":
        issues.append(
            Issue(
                PROFILE_SCOPE,
                "specification.task_type",
                "This planning scope permits ENERGY (single-point) proposals only.",
                proposed=str(task) if isinstance(task, str) and _FIELD_NAME.match(task) else None,
                allowed=("ENERGY",),
            )
        )
    engine = (spec.get("engine_preference") or {}).get("engine")
    if engine != "pyscf":
        issues.append(
            Issue(
                PROFILE_SCOPE,
                "specification.engine_preference.engine",
                "This planning scope permits the PySCF engine only.",
                proposed=str(engine)
                if isinstance(engine, str) and _FIELD_NAME.match(engine)
                else None,
                allowed=("pyscf",),
            )
        )
    version = (arguments.get("structure_version") or {}).get("entity_id")
    if selected_version_id and str(version) != str(selected_version_id):
        issues.append(
            Issue(
                STRUCTURE_VERSION,
                "structure_version.entity_id",
                "Use the selected structure version given in ProductContext "
                "(selection.selected_structure_version_id).",
                allowed=(str(selected_version_id),),
            )
        )
    return tuple(issues)


def capability_issues(
    arguments: dict[str, Any], atomic_numbers: tuple[int, ...] = ()
) -> tuple[Issue, ...]:
    """Explain a capability refusal from the server's own tables (advisory; validators decide)."""
    spec = arguments.get("specification") or {}
    engine = ((spec.get("engine_preference") or {}).get("engine") or "").lower()
    capability = CAPABILITIES.get(engine)
    if capability is None:
        return (
            Issue(
                ENGINE_CAPABILITY,
                "specification.engine_preference.engine",
                "This engine is not available.",
                allowed=tuple(sorted(name for name in CAPABILITIES if name != "qe")),
            ),
        )
    issues: list[Issue] = []
    task = spec.get("task_type")
    if task not in {t.value for t in capability.tasks}:
        issues.append(
            Issue(
                ENGINE_CAPABILITY,
                "specification.task_type",
                f"{engine} does not support this calculation type here.",
                allowed=tuple(sorted(t.value for t in capability.tasks)),
            )
        )
    method = ((spec.get("method") or {}).get("identifier") or "").lower()
    if method not in capability.methods:
        issues.append(
            Issue(
                ENGINE_CAPABILITY,
                "specification.method.identifier",
                f"{engine} does not support this method.",
                allowed=tuple(sorted(capability.methods)),
            )
        )
    basis = ((spec.get("basis") or {}).get("identifier") or "").lower()
    if capability.basis_sets:
        if not basis:
            issues.append(
                Issue(
                    ENGINE_CAPABILITY,
                    "specification.basis",
                    f"{engine} needs an explicit basis set.",
                    allowed=tuple(sorted(capability.basis_sets)),
                )
            )
        elif basis not in capability.basis_sets:
            issues.append(
                Issue(
                    ENGINE_CAPABILITY,
                    "specification.basis.identifier",
                    f"{engine} does not support this basis set.",
                    allowed=tuple(sorted(capability.basis_sets)),
                )
            )
        elif atomic_numbers and basis in PYSCF_MAX_ATOMIC_NUMBER:
            limit = PYSCF_MAX_ATOMIC_NUMBER[basis]
            if max(atomic_numbers) > limit:
                issues.append(
                    Issue(
                        ENGINE_CAPABILITY,
                        "specification.basis.identifier",
                        f"This basis set covers elements up to atomic number {limit} only; the "
                        "selected structure has heavier atoms.",
                        allowed=tuple(
                            sorted(
                                b
                                for b, z in PYSCF_MAX_ATOMIC_NUMBER.items()
                                if z >= max(atomic_numbers)
                            )
                        ),
                    )
                )
    for feature in ("dispersion", "solvation", "constraints"):
        if spec.get(feature):
            issues.append(
                Issue(
                    ENGINE_CAPABILITY,
                    f"specification.{feature}",
                    f"{feature.capitalize()} is not enabled for this engine and cannot be "
                    "silently ignored; remove it.",
                )
            )
    return tuple(issues[:MAX_ISSUES])


def mismatch_refusal(
    report: RequestMatchReport,
    engine: str | None,
    scope: dict[str, frozenset[str]] | None = None,
) -> Refusal:
    """The proposal differs from what the researcher explicitly asked for."""
    scope = scope or {}
    capability = CAPABILITIES.get((engine or "pyscf").lower())
    issues: list[Issue] = []
    unavailable = False
    for item in report.conflicts[:MAX_ISSUES]:
        field = _FIELD_OF.get(item.parameter)
        if item.parameter in {"dispersion", "solvation", "constraints"}:
            unavailable = True
            issues.append(
                Issue(
                    REQUEST_MISMATCH,
                    field,
                    f"The researcher asked for {item.parameter}; the proposal has none, and this "
                    "scope cannot run it.",
                    requested=item.mention,
                )
            )
            continue
        allowed: tuple[str, ...] = ()
        if item.excluded:
            message = f"The researcher ruled out this {item.parameter}; do not use it."
        elif item.requested_available is False:
            unavailable = True
            message = (
                f"The researcher asked for {item.requested}, which this server cannot run here. "
                f"Do not substitute another {item.parameter}."
            )
            if item.parameter in scope:  # what this run's planning scope permits
                allowed = tuple(sorted(scope[item.parameter]))
            elif capability is not None:
                allowed = tuple(
                    sorted(
                        {
                            "method": capability.methods,
                            "basis": capability.basis_sets,
                            "engine": frozenset(name for name in CAPABILITIES if name != "qe"),
                            "task": frozenset(t.value for t in capability.tasks),
                        }.get(item.parameter, frozenset())
                    )
                )
        else:
            uses = f"uses {item.proposed}" if item.proposed is not None else "does not set one"
            message = (
                f"The researcher asked for {item.requested} ({item.parameter}); the proposal "
                f"{uses}. Use the requested value."
            )
        issues.append(
            Issue(
                REQUEST_MISMATCH,
                field,
                message,
                requested=item.requested,
                proposed=item.proposed,
                allowed=allowed,
            )
        )
    next_step = (
        "The researcher's request cannot be met as stated. Do not call calculation.submit with a "
        "different value: tell the researcher in plain text what cannot be run and what is "
        "available."
        if unavailable
        else "Correct only the listed fields so the proposal matches the researcher's request, "
        "then call calculation.submit again."
    )
    return Refusal(
        REQUEST_MISMATCH,
        "The proposal does not match what the researcher asked for.",
        tuple(issues),
        next_step,
    )


def _tool_error_refusal(error: ToolInvocationError, selected_version_id: str | None) -> Refusal:
    detail = safe_detail(error.detail)
    code = error.code
    version_hint = (str(selected_version_id),) if selected_version_id else ()
    if code is ToolErrorCode.NOT_FOUND or "structure_version is required" in detail:
        return Refusal(
            STRUCTURE_VERSION,
            "The target structure version is missing or does not exist in this project.",
            (
                Issue(
                    STRUCTURE_VERSION,
                    "structure_version.entity_id",
                    "Use the selected structure version given in ProductContext "
                    "(selection.selected_structure_version_id).",
                    allowed=version_hint,
                ),
            ),
            "Correct structure_version and call calculation.submit again.",
        )
    if "electronic state" in detail.lower():
        required = "Explicit charge and multiplicity" in detail
        return Refusal(
            ELECTRONIC_STATE,
            detail,
            (
                Issue(
                    ELECTRONIC_STATE,
                    "specification.charge",
                    "The structure's electronic state "
                    + (
                        "is not recorded; state the charge and multiplicity explicitly."
                        if required
                        else "disagrees with the proposed charge or multiplicity."
                    ),
                ),
            ),
            "Correct charge and multiplicity to the structure's electronic state, or explain the "
            "conflict to the researcher.",
        )
    if "navigator" in detail.lower():
        return Refusal(
            NAVIGATOR,
            detail,
            (
                Issue(
                    NAVIGATOR,
                    None,
                    "The workflow's next-step catalogue does not permit this action.",
                ),
            ),
            "Explain the blocker to the researcher; do not retry the same action.",
        )
    if code is ToolErrorCode.FORBIDDEN:
        return Refusal(
            NOT_PERMITTED,
            detail or "This action is not permitted.",
            (Issue(NOT_PERMITTED, None, "This action is outside what is permitted here."),),
            "Do not retry; explain to the researcher.",
        )
    if code is ToolErrorCode.CAPABILITY_UNAVAILABLE:
        return Refusal(
            ENGINE_CAPABILITY,
            detail or "This calculation is outside the engine's supported capability set.",
            (Issue(ENGINE_CAPABILITY, None, detail or "Capability unavailable."),),
            "Do not substitute another calculation; explain what is available.",
        )
    return Refusal(
        ARGUMENT_SCHEMA if code is ToolErrorCode.VALIDATION_ERROR else UNEXPECTED,
        detail or "Tool arguments failed validation.",
        (Issue(ARGUMENT_SCHEMA, None, detail or "Tool arguments failed validation."),),
        "Correct the proposal and call calculation.submit again.",
    )


def classify_refusal(
    error: BaseException,
    *,
    arguments: dict[str, Any] | None = None,
    selected_version_id: str | None = None,
    atomic_numbers: tuple[int, ...] = (),
    generic_detail: str = "Tool arguments failed validation.",
    default_detail: str | None = None,
) -> Refusal:
    """The structured refusal for any error raised while validating a calculation proposal."""
    arguments = arguments or {}
    if isinstance(error, ProposalRefused):
        return error.refusal
    if isinstance(error, ValidationError):
        return Refusal(
            ARGUMENT_SCHEMA,
            "Tool arguments failed schema validation.",
            schema_issues(error),
            "Correct the listed fields and call calculation.submit again.",
        )
    if isinstance(error, ToolInvocationError):
        return _tool_error_refusal(error, selected_version_id)
    if isinstance(error, AIFoundationError):
        if error.code == "PLANNING_PROFILE_MISMATCH":
            return Refusal(
                PROFILE_SCOPE,
                error.detail,
                profile_issues(selected_version_id, arguments)
                or (Issue(PROFILE_SCOPE, None, error.detail),),
                "Correct the listed fields and call calculation.submit again.",
            )
        return Refusal(
            UNEXPECTED,
            error.detail,
            (Issue(UNEXPECTED, None, error.detail),),
            "Do not retry the same proposal; explain the problem to the researcher.",
        )
    if isinstance(error, EngineUnavailable):
        summary = default_detail or "The requested engine is unavailable in this environment."
        return Refusal(
            ENGINE_UNAVAILABLE,
            summary,
            (Issue(ENGINE_UNAVAILABLE, "specification.engine_preference.engine", summary),),
            "Do not retry with the same engine; explain that it is unavailable.",
        )
    if isinstance(error, UnsupportedCalculation):
        summary = (
            default_detail
            or "Requested calculation is outside the engine's supported capability set."
        )
        issues = capability_issues(arguments, atomic_numbers) or (
            Issue(ENGINE_CAPABILITY, None, summary),
        )
        return Refusal(
            ENGINE_CAPABILITY,
            summary,
            issues,
            "Correct only the listed fields to values the engine supports, unless the researcher "
            "explicitly asked for the unsupported value; then explain the limitation instead of "
            "substituting.",
        )
    if isinstance(error, ApplicationError):
        summary = default_detail or generic_detail
        return Refusal(
            UNEXPECTED,
            summary,
            (Issue(UNEXPECTED, None, summary),),
            "Do not retry the same proposal.",
        )
    return Refusal(
        ARGUMENT_SCHEMA,
        generic_detail,
        (Issue(ARGUMENT_SCHEMA, None, generic_detail),),
        "Correct the proposal and call calculation.submit again.",
    )


def known_allowed_values() -> dict[str, tuple[str, ...]]:
    """Catalogue identifiers the model may use, for tests and the researcher-facing hints."""
    return {
        "method": tuple(sorted(SCIENTIFIC_METHOD_CATALOG)),
        "basis": tuple(sorted(SCIENTIFIC_BASIS_CATALOG)),
    }


def refusal_for_conflicts(
    report: RequestMatchReport,
    engine: str | None,
    scope: dict[str, frozenset[str]] | None = None,
) -> ProposalRefused:
    assert any(item.outcome == MISMATCH for item in report.items)
    return ProposalRefused(mismatch_refusal(report, engine, scope))
