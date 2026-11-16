"""Periodic calculation proposal logic and settings resolution (Release 0.0.60, Part 2).

Resolves periodic calculation settings strictly from the three allowed sources:
  (a) The user's explicit message / settings
  (b) The project's most recent SUCCEEDED periodic calculation (with provenance citation:
      "copied from calculation <id>")
  (c) Documented engine defaults in the repository
Refuses to invent Hubbard U values, k-meshes, cutoffs, or magnetic ordering.
Refuses when no SUCCEEDED calculation exists and no settings were provided.
Refuses for molecular structures (which must use molecular energy proposal).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


class PeriodicProposalRefusalError(ValueError):
    """Raised when a periodic proposal cannot be formulated without inventing values."""


@dataclass(frozen=True)
class PeriodicCalculationSettings:
    engine: str
    task_type: str
    functional: str | None = None
    basis_or_ecp: str | None = None
    k_mesh: tuple[int, int, int] | None = None
    ecutwfc_ry: float | None = None
    ecutrho_ry: float | None = None
    hubbard_u: dict[str, float] | None = None
    magnetic_ordering: str | None = None
    spin_polarized: bool = False
    source: str = "user_input"
    source_calculation_id: str | None = None
    provenance_note: str = ""


# Documented repository baseline defaults for periodic calculations
DOCUMENTED_PERIODIC_DEFAULTS: dict[str, Any] = {
    "engine": "quantum_espresso",
    "task_type": "energy",
    "functional": "PBE",
    "basis_or_ecp": "SSSP_PBE_PRECISION",
}


def resolve_periodic_proposal_settings(
    *,
    is_periodic_structure: bool,
    user_input_settings: dict[str, Any] | None,
    previous_calculations: list[dict[str, Any]] | None,
) -> PeriodicCalculationSettings:
    """Resolve periodic calculation settings from allowed sources or raise refusal.

    Allowed sources:
      1. user_input_settings: explicitly specified parameters in user prompt
      2. most recent SUCCEEDED periodic calculation in previous_calculations
      3. DOCUMENTED_PERIODIC_DEFAULTS (engine, task_type, default PBE functional)

    NEVER invents Hubbard U, k-mesh, cutoffs, or magnetic ordering.
    """
    if not is_periodic_structure:
        raise PeriodicProposalRefusalError(
            "Periodic calculation proposals are only available for periodic crystal structures. "
            "For molecular structures, use the Prepare calculation button in the AI box."
        )

    user_settings = user_input_settings or {}

    # Find the most recent SUCCEEDED periodic calculation in the project
    last_succeeded: dict[str, Any] | None = None
    if previous_calculations:
        for calc in previous_calculations:
            state = (calc.get("state") or calc.get("status") or "").upper()
            is_calc_periodic = calc.get("is_periodic", False) or bool(calc.get("periodic"))
            if state == "SUCCEEDED" and is_calc_periodic:
                last_succeeded = calc
                break

    # If user provided no settings and there is no succeeded periodic calculation: refuse
    if not user_settings and last_succeeded is None:
        raise PeriodicProposalRefusalError(
            "No previous succeeded periodic calculation was found to copy settings from, "
            "and no calculation settings were specified in your request. "
            "Please state your desired functional, k-mesh, or cutoffs, or configure "
            "the calculation directly in the Calculation panel."
        )

    if last_succeeded is not None and not user_settings:
        # Copy from last succeeded periodic calculation
        calc_id = last_succeeded.get("id", "unknown")
        spec = last_succeeded.get("specification") or {}
        periodic_opts = spec.get("periodic") or {}

        engine = str(last_succeeded.get("engine") or spec.get("engine") or "quantum_espresso")
        task_type = str(spec.get("task_type") or "energy")
        method = spec.get("method") or {}
        if isinstance(method, dict):
            functional = method.get("display_name")
        else:
            functional = str(method) if method else None

        basis = spec.get("basis") or {}
        if isinstance(basis, dict):
            basis_name = basis.get("display_name")
        else:
            basis_name = str(basis) if basis else None

        k_mesh = periodic_opts.get("k_mesh")
        if isinstance(k_mesh, list) and len(k_mesh) == 3:
            k_mesh = (int(k_mesh[0]), int(k_mesh[1]), int(k_mesh[2]))

        hubbard_u = periodic_opts.get("hubbard_u")
        ecutwfc = periodic_opts.get("ecutwfc_ry")
        ecutrho = periodic_opts.get("ecutrho_ry")
        mag = periodic_opts.get("magnetic_ordering")
        spin = bool(periodic_opts.get("spin_polarized", False))

        provenance = f"copied from calculation {calc_id}"

        return PeriodicCalculationSettings(
            engine=engine,
            task_type=task_type,
            functional=functional,
            basis_or_ecp=basis_name,
            k_mesh=k_mesh,
            ecutwfc_ry=float(ecutwfc) if ecutwfc is not None else None,
            ecutrho_ry=float(ecutrho) if ecutrho is not None else None,
            hubbard_u=dict(hubbard_u) if hubbard_u else None,
            magnetic_ordering=str(mag) if mag else None,
            spin_polarized=spin,
            source="copied_from_calculation",
            source_calculation_id=calc_id,
            provenance_note=provenance,
        )

    # User provided settings (merged with documented defaults, but NO invented parameters)
    engine = user_settings.get("engine") or DOCUMENTED_PERIODIC_DEFAULTS["engine"]
    task_type = user_settings.get("task_type") or DOCUMENTED_PERIODIC_DEFAULTS["task_type"]
    functional = (
        user_settings.get("functional")
        or user_settings.get("method")
        or DOCUMENTED_PERIODIC_DEFAULTS["functional"]
    )
    basis = (
        user_settings.get("basis")
        or user_settings.get("basis_or_ecp")
        or DOCUMENTED_PERIODIC_DEFAULTS["basis_or_ecp"]
    )

    # ONLY include k-mesh, cutoffs, +U, magnetic ordering if explicitly provided by user
    k_mesh_raw = user_settings.get("k_mesh")
    k_mesh = None
    if isinstance(k_mesh_raw, (list, tuple)) and len(k_mesh_raw) == 3:
        k_mesh = (int(k_mesh_raw[0]), int(k_mesh_raw[1]), int(k_mesh_raw[2]))

    hubbard_u = user_settings.get("hubbard_u")
    ecutwfc = user_settings.get("ecutwfc_ry") or user_settings.get("ecutwfc")
    ecutrho = user_settings.get("ecutrho_ry") or user_settings.get("ecutrho")
    mag = user_settings.get("magnetic_ordering")
    spin = bool(user_settings.get("spin_polarized", False))

    return PeriodicCalculationSettings(
        engine=str(engine),
        task_type=str(task_type),
        functional=str(functional) if functional else None,
        basis_or_ecp=str(basis) if basis else None,
        k_mesh=k_mesh,
        ecutwfc_ry=float(ecutwfc) if ecutwfc is not None else None,
        ecutrho_ry=float(ecutrho) if ecutrho is not None else None,
        hubbard_u=dict(hubbard_u) if isinstance(hubbard_u, dict) else None,
        magnetic_ordering=str(mag) if mag else None,
        spin_polarized=spin,
        source="user_input",
        source_calculation_id=None,
        provenance_note="specified by researcher in chat",
    )


# ---------------------------------------------------------------------------------------------
# Periodic proposal tool (0.0.60 live fix 3). The AI Scientist cannot plan periodic settings (the
# `periodic` field is hidden from the published calculation.submit schema), so in the periodic
# profile the model is shown this small schema instead and the SERVER fills in the specification
# by copying the stored one of the project's most recent SUCCEEDED periodic calculation. Nothing
# is invented: no Hubbard U, k-mesh, magnetic order or engine is ever chosen by the model.
# ---------------------------------------------------------------------------------------------
PERIODIC_PROPOSAL_TOOL_DESCRIPTION = (
    "Propose a periodic crystal calculation for the researcher's approval. Give only the "
    "structure version and an idempotency key. The server copies every setting (engine, method, "
    "k-mesh, +U, magnetic order) from the project's most recent SUCCEEDED periodic calculation; "
    "you cannot choose or change them. Nothing runs until the researcher approves."
)
PERIODIC_PROPOSAL_TOOL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["structure_version", "idempotency_key"],
    "properties": {
        "structure_version": {
            "type": "object",
            "additionalProperties": False,
            "required": ["project_id", "entity_type", "entity_id"],
            "properties": {
                "project_id": {"type": "string"},
                "entity_type": {"const": "structure.version"},
                "entity_id": {"type": "string"},
            },
        },
        "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 200},
    },
}


def last_succeeded_periodic_specification(session: Any, project_id: str) -> tuple[str, dict]:
    """(calculation id, stored specification) of the newest SUCCEEDED periodic calculation."""
    from sqlalchemy import select

    from ..scientific_models import CalculationInputRecord, CalculationRecord

    rows = session.execute(
        select(CalculationRecord.id, CalculationInputRecord.specification_json)
        .join(CalculationInputRecord, CalculationInputRecord.calculation_id == CalculationRecord.id)
        .where(CalculationRecord.project_id == project_id, CalculationRecord.state == "SUCCEEDED")
        .order_by(CalculationRecord.created_at.desc())
    ).all()
    for calc_id, spec in rows:
        if (
            isinstance(spec, dict)
            and spec.get("task_type") == "PERIODIC_ENERGY"
            and spec.get("periodic")
        ):
            return str(calc_id), dict(spec)
    raise PeriodicProposalRefusalError(
        "This project has no SUCCEEDED periodic calculation to copy settings from, and the AI "
        "Scientist may not invent them. Configure the first periodic run in the Calculation panel."
    )


def expand_periodic_proposal_arguments(
    args: dict[str, Any], *, session: Any, project_id: str
) -> tuple[dict[str, Any], str]:
    """Turn the model's small proposal into full calculation.submit arguments + the source id."""
    if "specification" in args:
        raise PeriodicProposalRefusalError(
            "Do not send a specification: the server copies it from the last succeeded periodic "
            "calculation. Send only structure_version and idempotency_key."
        )
    calc_id, spec = last_succeeded_periodic_specification(session, project_id)
    return (
        {
            "structure_version": args.get("structure_version"),
            "specification": spec,
            "provider_preference": "AUTO",
            "idempotency_key": args.get("idempotency_key"),
        },
        calc_id,
    )
