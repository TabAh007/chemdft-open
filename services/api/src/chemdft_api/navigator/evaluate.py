"""Pure advisory evaluation. Submission still performs all authoritative scientific gates."""

import math

from ..contracts.navigator import (
    GoalId,
    NavigatorAction,
    NavigatorContext,
    NavigatorFactsSummary,
    NavigatorGoal,
    NavigatorHave,
    NavigatorReason,
    NavigatorState,
    NavigatorTarget,
    ReasonCode,
)
from ..scientific.engines.thermochemistry import STATIONARITY_RMS_CRITERION_HARTREE_PER_BOHR
from .catalog import CATALOG, GOALS, RULE_FACTS, Definition
from .facts import Capabilities, ProjectFacts, ResultFacts


def evaluate(
    facts: ProjectFacts, capabilities: Capabilities, *, can_write: bool, goal: GoalId | None = None,
    sealed: bool = False,
) -> NavigatorState:
    structure = facts.structure
    results = tuple(
        r for r in facts.results if structure and r.version_id == structure.id and r.converged
    )
    optimization = next(
        (
            o
            for o in facts.optimizations
            if structure and o.final_version_id == structure.id and o.converged
        ),
        None,
    )
    optimization_result = next(
        (
            r
            for r in facts.results
            if optimization
            and r.calculation_id == optimization.calculation_id
            and r.final_version_id == structure.id
            and r.final_hash == structure.canonical_hash
            and r.task == "GEOMETRY_OPTIMIZATION"
            and r.converged
        ),
        None,
    )
    optimized = bool(
        structure and structure.origin == "OPTIMIZED" and optimization and optimization_result
    )
    frequency = next(
        (r for r in results if r.schema == "chemdft.vibrational-analysis" and r.hessian), None
    )
    orbital = next((r for r in results if r.orbitals), None)
    thermo = next(
        (
            r
            for r in results
            if r.schema == "chemdft.thermochemistry" and r.temperature and r.pressure
        ),
        None,
    )
    computed: dict[str, ResultFacts] = {}
    for r in results:
        if r.ir:
            computed.setdefault("IR", r)
        if r.raman:
            computed.setdefault("RAMAN", r)
        if r.schema == "chemdft.tddft":
            computed.setdefault("UVVIS", r)
    spectra = facts.spectra
    associated = tuple(
        s for s in spectra if structure and s.associated_structure_id == structure.structure_id
    )
    pair = next(
        (
            (s, computed[s.technique])
            for s in sorted(associated, key=lambda s: not s.peak_set)
            if s.technique in computed
        ),
        None,
    )
    compared = bool(pair and (pair[0].id, pair[1].id, pair[0].technique) in facts.comparisons)
    active_jobs = tuple(
        j for j in facts.jobs if j.state in {"QUEUED", "RUNNING", "VALIDATED", "SUBMITTED"}
    )
    failed_jobs = tuple(j for j in facts.jobs if j.state == "FAILED")

    def thermo_reasons() -> list[ReasonCode]:
        codes: list[ReasonCode] = []
        if not optimized:
            codes.append("optimization_required")
        if not frequency:
            codes.append("frequency_required")
        else:
            if frequency.imaginary or not frequency.modes_valid:
                codes.append("imaginary_frequencies")
            if structure and (
                frequency.version_id != structure.id
                or frequency.input_hash != structure.canonical_hash
            ):
                codes.append("frequency_geometry_mismatch")
            if structure and (
                frequency.charge != structure.charge
                or frequency.multiplicity != structure.multiplicity
            ):
                codes.append("frequency_geometry_mismatch")
            if frequency.multiplicity != 1:
                codes.append("closed_shell_required")
            if optimization_result and (
                frequency.method.lower(),
                frequency.basis.lower(),
                frequency.engine.lower(),
            ) != (
                optimization_result.method.lower(),
                optimization_result.basis.lower(),
                optimization_result.engine.lower(),
            ):
                codes.append("matching_level_required")
        if (
            not optimization
            or optimization.gradient_rms is None
            or not math.isfinite(optimization.gradient_rms)
            or optimization.gradient_rms < 0
            or optimization.gradient_rms > STATIONARITY_RMS_CRITERION_HARTREE_PER_BOHR
        ):
            codes.append("stationarity_unproven")
        return codes

    valid_frequency = bool(frequency and not thermo_reasons())
    have: list[NavigatorHave] = []

    def confirmed(state_id: str, detail: str | None = None) -> None:
        have.append(NavigatorHave(state_id=state_id, label_key=f"have.{state_id}", detail=detail))

    if structure:
        confirmed(
            "structure.crystal" if structure.kind == "PERIODIC" else "structure.molecule",
            structure.name,
        )
        if structure.composition:
            confirmed("structure.composition", structure.composition)
        if structure.charge is not None and structure.multiplicity is not None:
            confirmed(
                "structure.charge_multiplicity", f"{structure.charge} / {structure.multiplicity}"
            )
        if structure.lattice:
            confirmed("structure.unit_cell")
        if structure.provenance:
            confirmed("provenance.available")
        if structure.conformers:
            confirmed("conformers.available", str(structure.conformers))
    if optimized:
        confirmed("geometry.optimized")
    energy = next(
        (r for r in results if r.energy),
        optimization_result if optimization_result and optimization_result.energy else None,
    )
    if energy:
        confirmed("energy.calculated", f"{energy.method} / {energy.basis} · {energy.engine}")
    if orbital:
        confirmed("orbitals.available", f"{orbital.method} / {orbital.basis} · {orbital.engine}")
        if orbital.frontier:
            confirmed("frontier.available")
    for technique in computed:
        confirmed(f"spectra.{'uv_vis' if technique == 'UVVIS' else technique.lower()}.calculated")
    if frequency and frequency.hessian:
        confirmed("hessian.available")
    if valid_frequency:
        confirmed("frequency.valid")
    if optimization and optimization.gradient_rms is not None:
        confirmed("gradient.available")
    for technique in sorted({s.technique for s in spectra}):
        confirmed(f"experimental.{technique.lower()}")
    if any(s.processed for s in spectra):
        confirmed("experimental.processed")
    if any(s.peak_set for s in spectra):
        confirmed("experimental.peaks.available")
    if compared:
        confirmed("comparison.available")
    if thermo:
        confirmed("thermochemistry.available", f"{thermo.temperature:g} K / {thermo.pressure:g} Pa")
    for field in facts.grid_types:
        confirmed(f"field.{field}")
    if facts.documents:
        confirmed("document.imported", str(facts.documents))
    if facts.imported_results:
        confirmed("external_result.imported", str(facts.imported_results))
    if facts.candidates:
        confirmed("candidate.review_required", str(facts.candidates))
    if active_jobs:
        confirmed("job.in_progress", str(len(active_jobs)))
    if failed_jobs:
        confirmed("job.failed", str(len(failed_jobs)))
    completed = {h.state_id for h in have}

    def reasons(d: Definition) -> list[ReasonCode]:
        codes: list[ReasonCode] = []
        if d.rule not in {"any", "jobs", "experimental", "comparison"} and not structure:
            codes.append("structure_missing")
        if d.rule in {"molecule", "compute", "optimized_compute", "thermo"} and structure:
            if structure.kind == "PERIODIC":
                codes.append("periodic_compute_unsupported" if d.task else "molecule_required")
            elif structure.dimensionality != 3:
                codes.append("coordinates_3d_required")
            if structure.charge is None:
                codes.append("charge_required")
            if not structure.multiplicity or structure.multiplicity < 1:
                codes.append("multiplicity_required")
        if d.rule == "crystal":
            if structure and structure.kind != "PERIODIC":
                codes.append("crystal_required")
            elif structure and not structure.lattice:
                codes.append("lattice_required")
        if d.rule == "optimized_compute" and not optimized:
            codes.append("optimization_required")
        if d.rule == "thermo":
            codes.extend(thermo_reasons())
        if (
            d.task in {"FREQUENCY", "TDDFT", "THERMOCHEMISTRY"}
            and structure
            and structure.kind != "PERIODIC"
            and structure.multiplicity != 1
        ):
            codes.append("closed_shell_required")
        if d.task:
            if d.task not in capabilities.tasks:
                codes.append("worker_unavailable")
            if d.task == "GEOMETRY_OPTIMIZATION" and not capabilities.optimizer:
                codes.append("optimizer_unavailable")
            if any(
                j.task == d.task and structure and j.version_id == structure.id for j in active_jobs
            ):
                codes.append("job_in_progress")
            if not facts.history_complete:
                codes.append("history_limit_reached")
        if d.rule in {"orbitals", "frontier", "coefficients"} and (
            not orbital
            or (d.rule == "frontier" and not orbital.frontier)
            or (d.rule == "coefficients" and not orbital.coefficients)
        ):
            codes.append("orbitals_required")
        if d.rule == "coefficients" and "ORBITAL" not in capabilities.tasks:
            codes.append("worker_unavailable")
        if d.rule == "computed" and not computed:
            codes.append("computed_spectrum_required")
        if d.rule in {"experimental", "comparison"} and not spectra:
            codes.append("experimental_spectrum_required")
        if d.rule == "comparison":
            if not computed:
                codes.append("computed_spectrum_required")
            if spectra and not associated:
                codes.append("spectrum_association_required")
            elif associated and computed and not pair:
                codes.append("matching_spectrum_type_required")
            if pair and not pair[0].peak_set:
                codes.append("experimental_peaks_required")
            if not facts.history_complete:
                codes.append("history_limit_reached")
        if d.rule == "thermo_result" and not thermo:
            codes.append("thermochemistry_required")
        if d.rule == "provenance" and not (structure and structure.provenance):
            codes.append("provenance_required")
        if d.rule == "jobs" and not facts.jobs:
            codes.append("job_required")
        if d.write and not can_write:
            codes.append("template_sealed" if sealed else "editor_required")
        return list(dict.fromkeys(codes))

    def target(d: Definition) -> NavigatorTarget:
        if d.launch == "jobs":
            return NavigatorTarget(route="jobs", launch="jobs")
        selection_kind = None
        selection_id = source_id = None
        if structure and d.rule != "any":
            selection_kind, selection_id, source_id = (
                "structureVersion",
                structure.id,
                structure.structure_id,
            )
        chosen_result = (
            orbital
            if d.rule in {"orbitals", "frontier", "coefficients"}
            else thermo
            if d.rule == "thermo_result"
            else next(iter(computed.values()), None)
            if d.rule == "computed"
            else None
        )
        if chosen_result:
            selection_kind, selection_id, source_id = (
                "calculationResult",
                chosen_result.id,
                chosen_result.calculation_id,
            )
        if d.rule == "experimental" or d.rule == "comparison":
            spectrum = pair[0] if d.rule == "comparison" and pair else spectra[0]
            selection_kind, selection_id, source_id = "experimentalSpectrum", spectrum.id, None
        return NavigatorTarget(
            launch=d.launch,
            selection_kind=selection_kind,
            selection_id=selection_id,
            source_id=source_id,
        )

    next_actions: list[NavigatorAction] = []
    blocked: list[NavigatorAction] = []
    for d in sorted(
        CATALOG,
        key=lambda d: (
            90 + d.priority
            if structure and d.rule == "any" and d.id != "spectra.upload_experimental"
            else 60
            if d.id == "jobs.review" and not active_jobs and not failed_jobs
            else d.priority,
            d.id,
        ),
    ):
        if goal and goal not in d.goals:
            continue
        if d.completed_by in completed:
            continue
        # Imports remain discoverable under goals, but do not crowd existing scientific follow-ons.
        if (
            not goal
            and structure
            and d.rule == "any"
            and d.id not in {"spectra.upload_experimental"}
        ):
            continue
        codes = reasons(d)
        action = NavigatorAction(
            action_id=d.id,
            category=d.category,
            title_key=f"action.{d.id}.title",
            description_key=f"action.{d.id}.description",
            required_capability="write" if d.write else "read",
            minimum_role_key="role.editor" if d.write else "role.viewer",
            required_facts=RULE_FACTS[d.rule],
            conflicting_facts=("job.in_progress",) if d.task else (),
            resulting_fact=d.result,
            goal_ids=d.goals,
            target=None if codes else target(d),
            reasons=tuple(NavigatorReason(code=c, message_key=f"reason.{c}") for c in codes),
        )
        (blocked if codes else next_actions).append(action)
    # A short primary queue; the goal selector exposes every catalogue workflow deterministically.
    next_actions = next_actions[:6]
    goal_results = {
        "optimize": "geometry.optimized",
        "energy": "energy.calculated",
        "ir": "spectra.ir.calculated",
        "raman": "spectra.raman.calculated",
        "uv_vis": "spectra.uv_vis.calculated",
        "orbitals": "orbitals.available",
        "thermochemistry": "thermochemistry.available",
        "compare": "comparison.available",
        "crystal": "structure.unit_cell",
    }
    notices = ["notice.advisory"]
    if structure and structure.kind == "PERIODIC":
        notices.extend(
            (
                "notice.periodic_visualization_only",
                "notice.source_identity_unestablished",
                "notice.coordination_not_supported",
            )
        )
    if not facts.history_complete:
        notices.append("reason.history_limit_reached")
    return NavigatorState(
        project_id=facts.project_id,
        goal=goal,
        have=tuple(have),
        next=tuple(next_actions),
        blocked=tuple(blocked),
        goals=tuple(
            NavigatorGoal(goal_id=g, title_key=f"goal.{g}", satisfied=goal_results[g] in completed)
            for g in GOALS
        ),
        facts_summary=NavigatorFactsSummary(
            sealed=sealed,
            structure_version_id=structure.id if structure else None,
            structure_id=structure.structure_id if structure else None,
            structure_name=structure.name if structure else None,
            structure_type=("crystal" if structure.kind == "PERIODIC" else "molecule")
            if structure
            else None,
            atom_count=structure.atom_count if structure else 0,
            coordinate_dimensionality=structure.dimensionality if structure else None,
            charge=structure.charge if structure else None,
            multiplicity=structure.multiplicity if structure else None,
            optimized=optimized,
            valid_frequency=valid_frequency,
            computed_spectrum_types=tuple(sorted(computed)),
            experimental_spectrum_types=tuple(sorted({s.technique for s in spectra})),
            running_jobs=len(active_jobs),
            failed_jobs=len(failed_jobs),
            can_write=can_write,
            history_complete=facts.history_complete,
        ),
        notices=tuple(notices),
        context=NavigatorContext(
            goal=goal,
            have_ids=tuple(h.state_id for h in have),
            next_ids=tuple(a.action_id for a in next_actions),
            blocked={a.action_id: tuple(r.code for r in a.reasons) for a in blocked},
        ),
    )
