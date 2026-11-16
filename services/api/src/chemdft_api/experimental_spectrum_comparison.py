"""Calculated/imported <-> experimental spectrum comparison.

Discrete calculated (or externally imported) data are never merged with sampled experimental data:
  * IR/Raman: experimental PEAKS are matched to calculated MODES by position, as CANDIDATE matches inside a stated tolerance
    (gated optimal assignment). Unscaled, or one user-entered factor persisted with the comparison. Never "assigned".
  * UV/Vis: candidate matching of band positions plus a quantitative oscillator-strength comparison over a linear cm^-1 axis,
    only when the experimental ordinate is an absolute cross section or molar absorptivity.
A comparison is persisted as a deterministic comparison transform with provenance and lineage; it never writes a calculation or
imported result, and it changes neither input.
"""
# ruff: noqa: E501  (long human-readable diagnostics and separators)

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .config import Settings
from .context import Identity
from .contracts.experimental_spectra import (
    COMPARISON_SCHEMA,
    BandComparison,
    BandExperimental,
    BandLimitSensitivity,
    CalculatedSourceKind,
    CalculatedSourceListOutput,
    CalculatedSourceView,
    ComparisonDiagnostic,
    ComparisonMetrics,
    ComparisonPair,
    ComparisonScalingView,
    ExcludedCount,
    SensitivityRow,
    SimilarityView,
    SpectrumComparisonInput,
    SpectrumComparisonListOutput,
    SpectrumComparisonView,
    SpectrumDatasetKind,
    SpectrumTechnique,
    Supplied,
    UnmatchedCalculated,
    UnmatchedExperimental,
    body_sha256,
)
from .contracts.provenance import ProducerKind, ProvenanceClass, ProvenanceDetail, VerificationState
from .errors import (
    ExperimentalSpectrumConflict,
    ExperimentalSpectrumInvalid,
    ProjectAccessDenied,
    ScientificReferenceNotFound,
)
from .experimental_spectrum_actions import (
    PRODUCER_ID,
    _get_spectrum_row,
    audit,
    flatten,
    parent_arrays_for_worker,
    worker_refusal,
)
from .experimental_spectrum_runner import SpectraRunner, run_spectra_worker
from .models import new_id
from .project_access import ProjectCapability, can
from .scientific_models import (
    CalculationResultRecord,
    ExperimentalDatasetRecord,
    ExternalImportJobRecord,
    ExternalImportRecord,
    ImportedResultRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    SpectrumComparisonRecord,
    StructureRecord,
    StructureVersionRecord,
)
from .storage import ObjectStore

VIBRATIONAL_RESULT = "chemdft.vibrational-analysis"
TDDFT_RESULT = "chemdft.tddft"
IMPORTED_VIBRATIONS = "chemdft.imported.vibrations"
IMPORTED_EXCITATIONS = "chemdft.imported.excitations"
COMPARISON_PRODUCER_ID = "chemdft.experimental-spectrum.comparison"


# ------------------------------------------------------------------------------------------------ calculated sources
def _structure_name(
    session: Session, structure_version_id: str | None, project_id: str
) -> tuple[str | None, str | None]:
    version = (
        session.get(StructureVersionRecord, structure_version_id) if structure_version_id else None
    )
    if version is None or version.project_id != project_id:
        return None, None
    structure = session.get(StructureRecord, version.structure_id)
    return version.structure_id, structure.name if structure else None


def _quantity(entry: dict[str, Any] | None) -> float | None:
    return float(entry["value"]) if entry else None


def _calculation_sources(
    session: Session, project_id: str, technique: SpectrumTechnique
) -> list[tuple[CalculatedSourceView, dict[str, Any]]]:
    wanted = TDDFT_RESULT if technique is SpectrumTechnique.UVVIS else VIBRATIONAL_RESULT
    rows = session.scalars(
        select(CalculationResultRecord)
        .where(
            CalculationResultRecord.project_id == project_id,
            CalculationResultRecord.result_type == wanted,
            CalculationResultRecord.validation_state == "VALIDATED",
        )
        .order_by(CalculationResultRecord.created_at.desc())
    ).all()
    out: list[tuple[CalculatedSourceView, dict[str, Any]]] = []
    for row in rows:
        payload = row.payload_json
        version_id = payload.get("input_structure_version_id")
        structure_id, structure_name = _structure_name(session, version_id, project_id)
        if technique is SpectrumTechnique.UVVIS:
            items = payload.get(
                "excited_states", []
            )  # the ChemDFT TDDFT payload (imported excitations use "states")
            has_intensities = True
        else:
            items = payload.get("modes", [])
            key = "ir_intensity" if technique is SpectrumTechnique.IR else "raman_activity"
            has_intensities = bool(items) and all(m.get(key) for m in items)
        if technique is SpectrumTechnique.RAMAN and not has_intensities:
            continue  # a Raman comparison needs activities; positions alone are available through the IR path
        label = f"{structure_name or 'structure'} · {payload.get('method', '?')}/{payload.get('basis', '?')} · {'excited states' if technique is SpectrumTechnique.UVVIS else 'vibrational modes'}"
        view = CalculatedSourceView(
            kind=CalculatedSourceKind.CALCULATION_RESULT,
            id=UUID(row.id),
            technique=technique,
            label=label,
            structure_id=UUID(structure_id) if structure_id else None,
            structure_name=structure_name,
            method=payload.get("method"),
            basis=payload.get("basis"),
            engine=payload.get("engine"),
            phase="GAS",
            item_count=len(items),
            has_intensities=has_intensities,
            structure_version_id=UUID(version_id) if version_id else None,
            calculation_id=UUID(row.calculation_id),
        )
        out.append((view, payload))
    return out


def _imported_sources(
    session: Session, project_id: str, technique: SpectrumTechnique
) -> list[tuple[CalculatedSourceView, dict[str, Any]]]:
    wanted = IMPORTED_EXCITATIONS if technique is SpectrumTechnique.UVVIS else IMPORTED_VIBRATIONS
    rows = session.scalars(
        select(ImportedResultRecord)
        .where(
            ImportedResultRecord.project_id == project_id,
            ImportedResultRecord.result_type == wanted,
        )
        .order_by(ImportedResultRecord.created_at.desc())
    ).all()
    out: list[tuple[CalculatedSourceView, dict[str, Any]]] = []
    for row in rows:
        payload = row.payload_json
        job = session.get(ExternalImportJobRecord, row.import_job_id)
        record = session.get(ExternalImportRecord, row.import_id)
        structure = session.get(StructureRecord, job.structure_id) if job else None
        if technique is SpectrumTechnique.UVVIS:
            items = payload.get("states", [])
            has_intensities = any(s.get("oscillator_strength") is not None for s in items)
        else:
            items = payload.get("modes", [])
            key = (
                "ir_intensity_km_mol"
                if technique is SpectrumTechnique.IR
                else "raman_activity_a4_amu"
            )
            has_intensities = bool(items) and all(m.get(key) is not None for m in items)
        if technique is SpectrumTechnique.RAMAN and not has_intensities:
            continue
        program = record.program_label if record else "external program"
        label = f"{structure.name if structure else 'structure'} · imported from {program} · {'excited states' if technique is SpectrumTechnique.UVVIS else 'vibrational modes'}"
        view = CalculatedSourceView(
            kind=CalculatedSourceKind.IMPORTED_RESULT,
            id=UUID(row.id),
            technique=technique,
            label=label,
            structure_id=UUID(job.structure_id) if job else None,
            structure_name=structure.name if structure else None,
            method=record.method_value if record else None,
            basis=record.basis_value if record else None,
            engine=record.engine if record else None,
            phase="UNKNOWN",
            item_count=len(items),
            has_intensities=has_intensities,
            structure_version_id=UUID(job.structure_version_id) if job else None,
            calculation_id=None,
        )
        out.append((view, payload))
    return out


def list_calculated_sources(
    session: Session, identity: Identity, project_id: str, technique: SpectrumTechnique
) -> CalculatedSourceListOutput:
    project, _ = authorize_project_access(session, identity, project_id)
    sources = [
        view
        for view, _payload in _calculation_sources(session, project.id, technique)
        + _imported_sources(session, project.id, technique)
    ]
    return CalculatedSourceListOutput(sources=tuple(sources))


def _resolve_source(
    session: Session,
    project_id: str,
    technique: SpectrumTechnique,
    kind: CalculatedSourceKind,
    source_id: str,
) -> tuple[CalculatedSourceView, dict[str, Any]]:
    pool = (
        _calculation_sources(session, project_id, technique)
        if kind is CalculatedSourceKind.CALCULATION_RESULT
        else _imported_sources(session, project_id, technique)
    )
    for view, payload in pool:
        if str(view.id) == source_id:
            return view, payload
    raise ScientificReferenceNotFound(
        "The calculated or imported source does not exist in this project, is not validated, or does not apply to this technique."
    )


def _payload_sha256(kind: CalculatedSourceKind, session: Session, source_id: str) -> str:
    if kind is CalculatedSourceKind.IMPORTED_RESULT:
        row = session.get(ImportedResultRecord, source_id)
        return row.payload_sha256 if row else ""
    result = session.get(CalculationResultRecord, source_id)
    return body_sha256(result.payload_json) if result else ""


def _calculated_inputs(
    technique: SpectrumTechnique, kind: CalculatedSourceKind, payload: dict[str, Any]
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Neutral worker inputs from either payload family, plus API-side notes about anything that had to be left out."""
    notes: list[dict[str, str]] = []
    imported = kind is CalculatedSourceKind.IMPORTED_RESULT
    if technique is SpectrumTechnique.UVVIS:
        states = []
        skipped = 0
        for s in payload["states" if imported else "excited_states"]:
            f = s.get("oscillator_strength")
            if f is None:
                skipped += 1
                continue
            states.append(
                {"index": s["index"], "energy_ev": s["energy_ev"], "oscillator_strength": f}
            )
        if skipped:
            notes.append(
                {
                    "code": "STATES_WITHOUT_OSCILLATOR_STRENGTH",
                    "severity": "warning",
                    "message": f"{skipped} imported state(s) report no oscillator strength and were left out; they could change band sums and matching.",
                }
            )
        return {"states": states}, notes
    modes = []
    for m in payload["modes"]:
        if imported:
            intensity = (
                m.get("ir_intensity_km_mol")
                if technique is SpectrumTechnique.IR
                else m.get("raman_activity_a4_amu")
            )
        else:
            intensity = _quantity(
                m.get("ir_intensity")
                if technique is SpectrumTechnique.IR
                else m.get("raman_activity")
            )
        modes.append(
            {
                "index": m["index"],
                "frequency_cm1": m["frequency_cm1"],
                "imaginary": bool(m.get("imaginary")),
                "intensity": intensity,
            }
        )
    basis = "IR_INTENSITY_KM_MOL" if technique is SpectrumTechnique.IR else "RAMAN_ACTIVITY_A4_AMU"
    if any(m["intensity"] is None for m in modes):
        notes.append(
            {
                "code": "SOURCE_WITHOUT_INTENSITIES",
                "severity": "info",
                "message": "the source reports no complete intensities; modes are compared by position only",
            }
        )
    return {"modes": modes, "intensity_basis": basis}, notes


# ------------------------------------------------------------------------------------------------ comparison
def _worker_request(
    payload: SpectrumComparisonInput,
    technique: SpectrumTechnique,
    experimental: dict[str, Any],
    calculated: dict[str, Any],
    calculated_phase: str,
    experimental_phase: str,
) -> dict[str, Any]:
    if technique is SpectrumTechnique.UVVIS:
        if payload.scaling.mode != "UNSCALED":
            raise ExperimentalSpectrumInvalid(
                "SCALING_NOT_OFFERED: no energy scaling is offered for UV/Vis in V1"
            )
        return {
            "technique": "UVVIS",
            "experimental": experimental,
            "calculated": {**calculated, "phase": calculated_phase},
            "axis": payload.axis,
            "matching": {
                "tolerance": payload.tolerance,
                "min_oscillator_strength": payload.min_oscillator_strength,
            },
            "bands": [b.model_dump(mode="json", exclude_none=True) for b in payload.bands],
            "experimental_phase": experimental_phase,
        }
    if payload.axis != "cm^-1":
        raise ExperimentalSpectrumInvalid(
            "AXIS_UNSUPPORTED: IR and Raman comparisons are made in cm^-1"
        )
    request: dict[str, Any] = {
        "technique": technique.value,
        "experimental": experimental,
        "calculated": {**calculated, "phase": calculated_phase},
        "matching": {
            "tolerance_cm1": payload.tolerance,
            "min_relative_intensity": payload.min_relative_intensity,
        },
        "scaling": payload.scaling.model_dump(mode="json", exclude_none=True),
        "experimental_phase": experimental_phase,
    }
    if payload.similarity is not None:
        request["similarity"] = payload.similarity.model_dump(mode="json")
    return request


def create_spectrum_comparison(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    *,
    project_id: str,
    payload: SpectrumComparisonInput,
    runner: SpectraRunner | None = None,
) -> SpectrumComparisonView:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    request_sha = body_sha256(payload.model_dump(mode="json", exclude={"idempotency_key"}))
    existing = session.scalar(
        select(SpectrumComparisonRecord).where(
            SpectrumComparisonRecord.project_id == project.id,
            SpectrumComparisonRecord.idempotency_key == payload.idempotency_key,
        )
    )
    if existing is not None:
        if existing.request_sha256 != request_sha:
            raise ExperimentalSpectrumConflict(
                "This idempotency key was already used for a different comparison."
            )
        return comparison_view(session, existing)
    experimental = _get_spectrum_row(session, project.id, str(payload.experimental_dataset_id))
    peak_set = _get_spectrum_row(session, project.id, str(payload.peak_set_dataset_id))
    spec, peak_spec = experimental.spectrum_json or {}, peak_set.spectrum_json or {}
    if (
        spec["kind"] == SpectrumDatasetKind.PEAKS.value
        or peak_spec["kind"] != SpectrumDatasetKind.PEAKS.value
    ):
        raise ExperimentalSpectrumInvalid(
            "COMPARISON_INPUTS_INVALID: compare a spectrum with a peak set detected on it"
        )
    if peak_spec.get("parent_dataset_id") != experimental.id:
        raise ExperimentalSpectrumInvalid(
            "COMPARISON_INPUTS_INVALID: the peak set was not detected on this spectrum"
        )
    technique = SpectrumTechnique(spec["technique"])
    source_view, source_payload = _resolve_source(
        session, project.id, technique, payload.calculated.kind, str(payload.calculated.id)
    )
    calculated, api_notes = _calculated_inputs(technique, payload.calculated.kind, source_payload)
    acquisition = spec.get("acquisition") or {}
    phase_entry = acquisition.get("phase") or {"status": "NOT_SUPPLIED", "value": None}
    experimental_phase = (
        phase_entry["value"]
        if phase_entry.get("status") != "NOT_SUPPLIED" and phase_entry.get("value")
        else "NOT_SUPPLIED"
    )
    exp_block = {
        "x_unit": spec["x"]["unit"],
        "x_min": spec["x"]["min"],
        "x_max": spec["x"]["max"],
        "peaks": peak_spec["peaks"]["peaks"],
        "y_quantity": spec["y"]["quantity"],
        "y_unit": spec["y"]["unit"],
        "representation": spec["representation"],
        "point_count": experimental.point_count,
    }
    request = _worker_request(
        payload, technique, exp_block, calculated, source_view.phase, experimental_phase
    )
    needs_arrays = bool(request.get("bands")) or bool(request.get("similarity"))
    xy = (
        parent_arrays_for_worker(session, object_store, settings, experimental)
        if needs_arrays
        else None
    )
    run = runner or run_spectra_worker
    outcome = run("compare", request, settings, arrays_in=xy)
    if outcome.failure or outcome.document is None or "error" in outcome.document:
        raise worker_refusal(outcome)
    record, record_sha = outcome.document["record"], outcome.document["record_sha256"]
    if (
        body_sha256(record) != record_sha
        or record.get("schema") != COMPARISON_SCHEMA
        or record.get("technique") != technique.value
    ):
        raise ExperimentalSpectrumInvalid(
            "WORKER_OUTPUT_INVALID: the comparison record does not match its hash"
        )
    params = {
        "request": payload.model_dump(mode="json", exclude={"idempotency_key"}),
        "api_diagnostics": api_notes,
        "source_payload_sha256": _payload_sha256(
            payload.calculated.kind, session, str(payload.calculated.id)
        ),
        "experimental_phase": {
            "status": phase_entry.get("status"),
            "value": phase_entry.get("value"),
            "as_written": phase_entry.get("as_written"),
            "line": phase_entry.get("line"),
            "file_reported": phase_entry.get("file_reported"),
        },
    }
    comparison_id = new_id()
    try:
        provenance = ProvenanceRecordRow(
            project_id=project.id,
            subject_type="experimental.spectrum.comparison",
            subject_id=comparison_id,
            source_class=ProvenanceClass.EXPERIMENTAL,
            detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
            verification_state=VerificationState.UNVERIFIED,
            producer_kind=ProducerKind.SOFTWARE,
            producer_identifier=COMPARISON_PRODUCER_ID,
            producer_software_version=record["worker_version"],
            source_artifact_id=experimental.artifact_id,
            operation=f"chemdft.experimental-spectrum.compare.{technique.value.lower()}",
            operation_version="1.0.0",
            parameters_json=[
                {"key": "technique", "value": technique.value},
                {"key": "method", "value": record["method"]},
                {
                    "key": "tolerance",
                    "value": f"{payload.tolerance:g} {record['tolerance']['unit']}",
                },
                {"key": "scaling_mode", "value": record["scaling"]["mode"]},
                {"key": "scaling_factor", "value": str(record["scaling"]["factor"])},
                {"key": "calculated_source_kind", "value": payload.calculated.kind.value},
                {"key": "calculated_source_id", "value": str(payload.calculated.id)},
                {
                    "key": "calculated_source_payload_sha256",
                    "value": params["source_payload_sha256"],
                },
                {"key": "record_sha256", "value": record_sha},
                {"key": "authority", "value": record["authority"]},
            ],
            approximate=False,
            supersedes_id=None,
            correlation_id=experimental.id,
        )
        session.add(provenance)
        session.flush()
        session.add_all(
            [
                ProvenanceInputRow(
                    provenance_record_id=provenance.id,
                    project_id=project.id,
                    position=0,
                    input_type="ENTITY",
                    input_id=experimental.id,
                    input_sha256=(spec.get("arrays") or {}).get("artifact_sha256"),
                ),
                ProvenanceInputRow(
                    provenance_record_id=provenance.id,
                    project_id=project.id,
                    position=1,
                    input_type="ENTITY",
                    input_id=peak_set.id,
                    input_sha256=peak_spec.get("record_sha256"),
                ),
                ProvenanceInputRow(
                    provenance_record_id=provenance.id,
                    project_id=project.id,
                    position=2,
                    input_type="ENTITY",
                    input_id=str(payload.calculated.id),
                    input_sha256=params["source_payload_sha256"] or None,
                ),
            ]
        )
        comparison = SpectrumComparisonRecord(
            id=comparison_id,
            project_id=project.id,
            idempotency_key=payload.idempotency_key,
            request_sha256=request_sha,
            technique=technique.value,
            experimental_dataset_id=experimental.id,
            peak_set_dataset_id=peak_set.id,
            source_kind=payload.calculated.kind.value,
            source_id=str(payload.calculated.id),
            params_json=params,
            record_json=record,
            record_sha256=record_sha,
            worker_version=record["worker_version"],
            provenance_record_id=provenance.id,
            created_by=identity.user_id,
        )
        session.add(comparison)
        session.flush()
        audit(
            session,
            identity,
            project_id=project.id,
            event_name="experimental_spectrum.compared",
            entity_type="experimental.spectrum.comparison",
            entity_id=comparison.id,
            artifacts=[],
            metadata=[
                {"key": "record_sha256", "value": record_sha},
                {"key": "technique", "value": technique.value},
            ],
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    created = session.get(SpectrumComparisonRecord, comparison_id)
    assert created is not None
    return comparison_view(session, created)


# ------------------------------------------------------------------------------------------------ views
def _diagnostics(items: list[dict[str, Any]]) -> tuple[ComparisonDiagnostic, ...]:
    return tuple(
        ComparisonDiagnostic(**{k: d[k] for k in ("code", "severity", "message")}) for d in items
    )


def _metrics(record: dict[str, Any]) -> ComparisonMetrics:
    m = record["metrics"]
    uv = record["technique"] == "UVVIS"
    excluded = m["calculated_states_excluded" if uv else "calculated_modes_excluded"]
    return ComparisonMetrics(
        calculated_considered=m[
            "calculated_states_considered" if uv else "calculated_modes_considered"
        ],
        calculated_total=m["calculated_states_total" if uv else "calculated_modes_total"],
        calculated_excluded=tuple(
            ExcludedCount(reason=k, count=v) for k, v in sorted(excluded.items())
        ),
        experimental_peaks=m["experimental_peaks"],
        matched=m["matched"],
        ambiguous_pairs=m["ambiguous_pairs"],
        matched_fraction_of_experimental_peaks=m["matched_fraction_of_experimental_peaks"],
        matched_fraction_of_calculated_considered=m[
            "matched_fraction_of_considered_states"
            if uv
            else "matched_fraction_of_considered_modes"
        ],
        unmatched_calculated=m["unmatched_calculated"],
        unmatched_experimental=m["unmatched_experimental"],
        signed_bias=m["signed_bias"],
        mae=m["mae"],
        rmse=m["rmse"],
        max_abs_delta=m["max_abs_delta"],
        median_delta=m["median_delta"],
        delta_unit="cm^-1" if not uv else m["delta_unit"],
        delta_definition=m["delta_definition"],
        mae_upper_bound_by_construction=m[
            "mae_upper_bound_by_construction" if uv else "mae_upper_bound_by_construction_cm1"
        ],
        mae_note=m["mae_note"],
        tolerance_sensitivity=tuple(
            SensitivityRow(
                tolerance=r["tolerance"],
                matched=r["matched"],
                mae=r.get("mae"),
                rmse=r.get("rmse"),
                signed_bias=r.get("signed_bias"),
            )
            for r in m["tolerance_sensitivity"]
        ),
    )


def _pairs(record: dict[str, Any]) -> tuple[ComparisonPair, ...]:
    uv = record["technique"] == "UVVIS"
    rows = []
    for p in record["pairs"]:
        if uv:
            rows.append(
                ComparisonPair(
                    calculated_index=p["calc_state_index"],
                    calculated_position_source=p["calc_energy_ev"],
                    calculated_position=p["calc_position"],
                    calculated_oscillator_strength=p["calc_oscillator_strength"],
                    experimental_peak_index=p["exp_peak_index"],
                    experimental_position=p["exp_position"],
                    delta=p["delta"],
                    tolerance=p["tolerance"],
                    candidates_for_calculated=p["candidates_for_calc_state"],
                    candidates_for_experimental=p["candidates_for_exp_peak"],
                    margin_to_next_experimental_peak=p["margin_to_next_exp_peak"],
                    status=p["status"],
                    relative_intensity_calculated=None,
                    relative_intensity_experimental=None,
                )
            )
        else:
            rows.append(
                ComparisonPair(
                    calculated_index=p["calc_mode_index"],
                    calculated_position_source=p["calc_frequency_cm1"],
                    calculated_position=p["calc_frequency_compared_cm1"],
                    calculated_oscillator_strength=None,
                    experimental_peak_index=p["exp_peak_index"],
                    experimental_position=p["exp_position_cm1"],
                    delta=p["delta_cm1"],
                    tolerance=p["tolerance_cm1"],
                    candidates_for_calculated=p["candidates_for_calc_mode"],
                    candidates_for_experimental=p["candidates_for_exp_peak"],
                    margin_to_next_experimental_peak=p["margin_to_next_exp_peak"],
                    status=p["status"],
                    relative_intensity_calculated=p["relative_intensity_calc"],
                    relative_intensity_experimental=p["relative_intensity_exp"],
                )
            )
    return tuple(rows)


def _unmatched_calculated(record: dict[str, Any]) -> tuple[UnmatchedCalculated, ...]:
    uv = record["technique"] == "UVVIS"
    if uv:
        return tuple(
            UnmatchedCalculated(
                calculated_index=u["calc_state_index"],
                calculated_position_source=u["calc_energy_ev"],
                calculated_position=u["calc_position"],
                calculated_oscillator_strength=u["calc_oscillator_strength"],
                relative_intensity_calculated=None,
                status=u["status"],
            )
            for u in record["unmatched_calculated"]
        )
    return tuple(
        UnmatchedCalculated(
            calculated_index=u["calc_mode_index"],
            calculated_position_source=u["calc_frequency_cm1"],
            calculated_position=u["calc_frequency_compared_cm1"],
            calculated_oscillator_strength=None,
            relative_intensity_calculated=u["relative_intensity_calc"],
            status=u["status"],
        )
        for u in record["unmatched_calculated"]
    )


def _unmatched_experimental(record: dict[str, Any]) -> tuple[UnmatchedExperimental, ...]:
    uv = record["technique"] == "UVVIS"
    return tuple(
        UnmatchedExperimental(
            experimental_peak_index=u["exp_peak_index"],
            experimental_position=u["exp_position"] if uv else u["exp_position_cm1"],
            prominence=u["prominence"],
            relative_intensity_experimental=None if uv else u["relative_intensity_exp"],
            status=u["status"],
        )
        for u in record["unmatched_experimental"]
    )


def _bands(record: dict[str, Any]) -> tuple[BandComparison, ...]:
    out = []
    for b in record.get("bands", []):
        out.append(
            BandComparison(
                label=b["label"],
                lo_nm=b["lo_nm"],
                hi_nm=b["hi_nm"],
                calculated_states_in_band=tuple(b["calculated_states_in_band"]),
                f_calculated_sum=b["f_calculated_sum"],
                centroid_calculated_ev=b["centroid_calculated_ev"],
                experimental=BandExperimental(**b["experimental"]) if b["experimental"] else None,
                f_ratio_calc_over_exp=b["f_ratio_calc_over_exp"],
                integration_domain=b["integration_domain"],
                limit_sensitivity=BandLimitSensitivity(**b["limit_sensitivity"])
                if b["limit_sensitivity"]
                else None,
                notes=_diagnostics(b["notes"]),
            )
        )
    return tuple(out)


def _similarity(record: dict[str, Any]) -> SimilarityView | None:
    s = record.get("similarity")
    if not s:
        return None
    return SimilarityView(
        computed=s["computed"],
        reason=s.get("reason"),
        pearson_r=s.get("pearson_r"),
        cosine=s.get("cosine"),
        grid_points=s.get("grid_points"),
        settings=tuple(flatten(s.get("settings") or {})),
        authority="DISPLAY_ONLY",
        note=s.get("note"),
    )


def comparison_view(session: Session, row: SpectrumComparisonRecord) -> SpectrumComparisonView:
    record = row.record_json
    technique = SpectrumTechnique(row.technique)
    if body_sha256(record) != row.record_sha256:
        raise ExperimentalSpectrumConflict(
            "The stored comparison no longer matches its recorded hash."
        )
    experimental = session.get(ExperimentalDatasetRecord, row.experimental_dataset_id)
    spec = (experimental.spectrum_json or {}) if experimental else {}
    kind = CalculatedSourceKind(row.source_kind)
    source_view, _ = _resolve_source(session, row.project_id, technique, kind, row.source_id)
    api_notes = row.params_json.get("api_diagnostics", [])
    phase = row.params_json["experimental_phase"]
    return SpectrumComparisonView(
        id=UUID(row.id),
        project_id=UUID(row.project_id),
        technique=technique,
        kind=record["kind"],
        experimental_dataset_id=UUID(row.experimental_dataset_id),
        peak_set_dataset_id=UUID(row.peak_set_dataset_id),
        experimental_dataset_name=spec.get("name") or "spectrum",
        calculated=source_view,
        method=record["method"],
        axis=record["axis"],
        tolerance=record["tolerance"]["value"],
        scaling=ComparisonScalingView(
            mode=record["scaling"]["mode"],
            factor=record["scaling"]["factor"],
            source=record["scaling"]["source"],
        ),
        pairs=_pairs(record),
        unmatched_calculated=_unmatched_calculated(record),
        unmatched_experimental=_unmatched_experimental(record),
        metrics=_metrics(record),
        bands=_bands(record),
        diagnostics=_diagnostics([*record["diagnostics"], *api_notes]),
        similarity=_similarity(record),
        experimental_phase=Supplied.model_validate(phase),
        assignment_statement=record["assignment_statement"],
        intensity_statement=record.get(
            "intensity_statement",
            "Intensity agreement is not assessed; UV/Vis intensities are compared only as oscillator strengths of explicit bands.",
        ),
        authority="DETERMINISTIC_TRANSFORM",
        record_sha256=row.record_sha256,
        provenance_record_id=UUID(row.provenance_record_id),
        worker_version=row.worker_version,
        created_at=row.created_at,
        created_by=UUID(row.created_by),
    )


def list_spectrum_comparisons(
    session: Session,
    identity: Identity,
    project_id: str,
    experimental_dataset_id: str | None = None,
) -> SpectrumComparisonListOutput:
    project, _ = authorize_project_access(session, identity, project_id)
    query = (
        select(SpectrumComparisonRecord)
        .where(SpectrumComparisonRecord.project_id == project.id)
        .order_by(SpectrumComparisonRecord.created_at.desc())
    )
    if experimental_dataset_id:
        query = query.where(
            SpectrumComparisonRecord.experimental_dataset_id == experimental_dataset_id
        )
    return SpectrumComparisonListOutput(
        comparisons=tuple(comparison_view(session, r) for r in session.scalars(query).all())
    )


def get_spectrum_comparison(
    session: Session, identity: Identity, project_id: str, comparison_id: str
) -> SpectrumComparisonView:
    project, _ = authorize_project_access(session, identity, project_id)
    row = session.get(SpectrumComparisonRecord, comparison_id)
    if row is None or row.project_id != project.id:
        raise ScientificReferenceNotFound("Spectrum comparison does not exist in this project.")
    return comparison_view(session, row)


__all__ = [
    "PRODUCER_ID",
    "create_spectrum_comparison",
    "get_spectrum_comparison",
    "list_calculated_sources",
    "list_spectrum_comparisons",
]
