"""Scientific exports built only from persisted, validated evidence.

Nothing here runs an engine, fills a gap, smooths data or synthesizes peaks, frames or grids.
If the evidence a format needs is not stored, the format is reported unavailable with the exact
reason instead of being approximated.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .calculation_actions import get_calculation
from .config import Settings
from .context import Identity
from .contracts.analysis import (
    CalculationExportCatalog,
    ExportFormatOption,
    ExportVariant,
)
from .contracts.catalog import CalculationDetail
from .contracts.result_state import EffectiveResultState
from .download_response import safe_filename
from .errors import (
    ExportBlocked,
    ExportLimitExceeded,
    ScientificReferenceNotFound,
    ScientificValidationFailed,
)
from .result_read_actions import result_lineage_export
from .scientific_models import (
    CalculationRecord,
    CalculationResultRecord,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from .storage import ObjectStore
from .volumetric_field_actions import field_metadata, read_field_output

RESULT_EXPORT_SCHEMA = "chemdft.result-export.v2"

#: CODATA 2018 Bohr radius in angstrom. Used only to express an already-computed Cartesian grid in
#: the bohr units the Gaussian CUBE format requires; every length in a file shares this one factor.
BOHR_IN_ANGSTROM = 0.529177210903

FORMAT_META: dict[str, tuple[str, str, str]] = {
    "result-json": ("Result (JSON)", "application/json", "json"),
    "trajectory-xyz": ("Optimization trajectory (XYZ)", "chemical/x-xyz", "xyz"),
    "spectrum-csv": ("Spectrum data (CSV)", "text/csv; charset=utf-8", "csv"),
    "cube": ("Field grid (Gaussian CUBE)", "chemical/x-cube", "cube"),
    "report": ("Scientific report", "text/html; charset=utf-8", "html"),
    "reproducibility-bundle": ("Evidence archive (ZIP)", "application/zip", "zip"),
}

SPECTRUM_KINDS = {
    "ir": ("Infrared stick data", "chemdft.vibrational-analysis"),
    "raman": ("Raman stick data", "chemdft.vibrational-analysis"),
    "uvvis": ("UV-Vis excited-state data", "chemdft.tddft"),
}

FIELD_LABEL = {
    "MO_AMPLITUDE": "Molecular orbital amplitude",
    "ELECTRON_DENSITY": "Electron density",
    "ELECTROSTATIC_POTENTIAL": "Electrostatic potential",
}


@dataclass(frozen=True)
class ExportPayload:
    filename: str
    media_type: str
    content: bytes
    effective: EffectiveResultState | bool | None  # False: no result involved


def _evidence_use(effective: EffectiveResultState | None) -> str:
    if effective is None:
        return "UNKNOWN"
    return "CURRENT" if effective.eligible_for_derivation else "HISTORICAL_ONLY"


_STANDING_TOKEN = re.compile(r"^[A-Z][A-Z_]{0,31}$")


def _token(value: object) -> str:
    """Enum-like value for a header or comment; anything else is UNKNOWN (fail closed)."""
    text = str(getattr(value, "value", value))
    return text if _STANDING_TOKEN.fullmatch(text) else "UNKNOWN"


def evidence_standing_marker(effective: EffectiveResultState | None) -> str:
    """Read-time standing as `KEY=TOKEN` pairs for a file's comment lines.

    Uses the backend's own evidence-use values (CURRENT | HISTORICAL_ONLY | UNKNOWN). A missing
    effective state is UNKNOWN everywhere: no current authority or verification is ever implied.
    """
    if effective is None:
        return "EVIDENCE_USE=UNKNOWN AUTHORITY=UNKNOWN LINEAGE=UNKNOWN VERIFICATION=UNKNOWN"
    return (
        f"EVIDENCE_USE={_token(_evidence_use(effective))} "
        f"AUTHORITY={_token(effective.authority)} "
        f"LINEAGE={_token(effective.source_lineage_validity)} "
        f"VERIFICATION={_token(effective.verification_state)}"
    )


def _one_line(value: object) -> str:
    return " ".join(str(value).split())


def _calculation(session: Session, project_id: str, calculation_id: str) -> CalculationRecord:
    calc = session.get(CalculationRecord, calculation_id)
    if calc is None or calc.project_id != project_id:
        # Same answer for "missing" and "someone else's": an id must not confirm existence.
        raise ScientificReferenceNotFound("Calculation does not exist.")
    return calc


def _result_record(session: Session, project_id: str, calculation_id: str):
    return session.scalar(
        select(CalculationResultRecord).where(
            CalculationResultRecord.project_id == project_id,
            CalculationResultRecord.calculation_id == calculation_id,
        )
    )


def _stored_fields(
    session: Session, project_id: str, result_id: str
) -> list[ScientificArtifactRecord]:
    return list(
        session.scalars(
            select(ScientificArtifactRecord)
            .where(
                ScientificArtifactRecord.project_id == project_id,
                ScientificArtifactRecord.kind == "VOLUMETRIC_GRID",
                ScientificArtifactRecord.format_identifier == "chemdft.volumetric-field.npz",
                ScientificArtifactRecord.source_relation_id == result_id,
            )
            .order_by(ScientificArtifactRecord.created_at, ScientificArtifactRecord.id)
        )
    )


def _field_variant(artifact: ScientificArtifactRecord) -> ExportVariant | None:
    meta = field_metadata(artifact)
    quantity = meta.get("field_quantity")
    unit = meta.get("field_unit")
    if quantity not in FIELD_LABEL or not unit or not meta.get("dimensions"):
        return None
    label = FIELD_LABEL[quantity]
    if quantity == "MO_AMPLITUDE":
        spin = meta.get("spin_channel")
        label += f" — orbital {int(meta.get('orbital_index', 0)) + 1}" + (
            "" if spin == "restricted" else f" ({spin})"
        )
    dims = "x".join(str(int(n)) for n in meta["dimensions"])
    return ExportVariant(key=artifact.id, label=f"{label} [{unit}]", detail=f"{dims} grid")


def _spectrum_availability(
    result: CalculationResultRecord | None,
) -> tuple[list[ExportVariant], str | None]:
    if result is None:
        return [], "No published result exists for this calculation."
    payload = result.payload_json or {}
    variants: list[ExportVariant] = []
    if result.result_type == "chemdft.vibrational-analysis":
        modes = payload.get("modes") or []
        if any(m.get("ir_intensity") for m in modes):
            variants.append(
                ExportVariant(
                    key="ir",
                    label=SPECTRUM_KINDS["ir"][0],
                    detail=f"{len(modes)} normal modes, km/mol",
                )
            )
        if any(m.get("raman_activity") for m in modes):
            variants.append(
                ExportVariant(
                    key="raman",
                    label=SPECTRUM_KINDS["raman"][0],
                    detail=f"{len(modes)} normal modes, Å⁴/amu",
                )
            )
        if not variants:
            return [], "This frequency result stores no IR intensities or Raman activities."
    elif result.result_type == "chemdft.tddft":
        n = len(payload.get("excited_states") or [])
        if n:
            variants.append(
                ExportVariant(
                    key="uvvis",
                    label=SPECTRUM_KINDS["uvvis"][0],
                    detail=f"{n} singlet excited states",
                )
            )
    else:
        return [], "Only frequency (IR/Raman) and TDDFT (UV-Vis) results carry spectral data."
    return variants, None if variants else "This result stores no spectral data."


def export_catalog(
    session: Session,
    identity: Identity,
    project_id: str,
    calculation_id: str,
    object_store: ObjectStore | None = None,
    settings: Settings | None = None,
) -> CalculationExportCatalog:
    project, _member = authorize_project_access(session, identity, project_id)
    calc = _calculation(session, project.id, calculation_id)
    result = _result_record(session, project.id, calc.id)
    effective = None
    if result is not None:
        from .effective_result_state import effective_result_state

        effective = effective_result_state(session, result)
    detail = get_calculation(session, identity, project.id, calc.id)

    options: list[ExportFormatOption] = []

    def add(fmt: str, available: bool, reason: str | None = None, variants=()):
        label, media, ext = FORMAT_META[fmt]
        options.append(
            ExportFormatOption(
                format=fmt,
                label=label,
                available=available,
                media_type=media,
                file_extension=ext,
                unsupported_reason=None if available else reason,
                variants=tuple(variants),
            )
        )

    add(
        "result-json",
        result is not None,
        "No published result exists yet; one is published only after the engine output "
        "is validated.",
    )

    trajectory = detail.optimization_trajectory
    if trajectory is None or not trajectory.steps:
        add(
            "trajectory-xyz",
            False,
            "This calculation recorded no optimization frames. "
            "ChemDFT never invents missing frames.",
        )
    else:
        add("trajectory-xyz", True)

    variants, reason = _spectrum_availability(result)
    add("spectrum-csv", bool(variants), reason, variants)

    cube_variants: list[ExportVariant] = []
    cube_reason = None
    if result is None:
        cube_reason = "No published result exists for this calculation."
    elif result.result_type != "chemdft.molecular-orbitals":
        cube_reason = "Only SCF orbital results own density, potential and orbital grids."
    else:
        cube_variants = [
            v for a in _stored_fields(session, project.id, result.id) if (v := _field_variant(a))
        ]
        if not cube_variants:
            legacy = session.scalar(
                select(func.count(ScientificArtifactRecord.id)).where(
                    ScientificArtifactRecord.project_id == project.id,
                    ScientificArtifactRecord.kind == "VOLUMETRIC_GRID",
                    ScientificArtifactRecord.format_identifier != "chemdft.volumetric-field.npz",
                    ScientificArtifactRecord.source_relation_id == result.id,
                )
            )
            cube_reason = (
                "No electron-density, potential or orbital grid has been generated for this "
                "result. Open the field in the orbital viewer to generate one; "
                "export never computes a grid."
                + (
                    " Older orbital grids lack an explicit field unit and are not exported."
                    if legacy
                    else ""
                )
            )
    add("cube", bool(cube_variants), cube_reason, cube_variants)

    add(
        "report",
        result is not None,
        "No published result exists yet; a report is built only from a validated result.",
        (
            ExportVariant(key="html", label="HTML (with charts)", detail="Self-contained page"),
            ExportVariant(key="markdown", label="Markdown", detail="Tables, no charts"),
            ExportVariant(key="json", label="JSON", detail="Machine-readable report model"),
        ),
    )
    bundle_variants: tuple[ExportVariant, ...] = ()
    bundle_reason: str | None = None
    if object_store is not None and settings is not None:
        from .reproducibility_bundle import assess_variant

        try:
            bundle_variants = (
                assess_variant(session, identity, object_store, settings, project.id, calc.id),
            )
        except (ExportLimitExceeded, ExportBlocked):
            # The download would refuse to build this archive; do not offer it.
            bundle_reason = (
                "A stored record exceeds the evidence-archive bounds or failed its content check; "
                "no archive can be produced."
            )
    add("reproducibility-bundle", bundle_reason is None, bundle_reason, bundle_variants)

    return CalculationExportCatalog(
        project_id=project.id,  # type: ignore[arg-type]
        calculation_id=calc.id,  # type: ignore[arg-type]
        result_id=result.id if result else None,  # type: ignore[arg-type]
        evidence_use=_evidence_use(effective) if result else "NO_RESULT",  # type: ignore[arg-type]
        formats=tuple(options),
    )


# --------------------------------------------------------------------------------------------
# Builders
# --------------------------------------------------------------------------------------------


def _json_bytes(document: dict[str, Any]) -> bytes:
    return (json.dumps(document, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode()


def _result_json(
    session: Session, identity: Identity, detail: CalculationDetail, project_id: str
) -> ExportPayload:
    from .calculation_summary import summarize_result

    result = detail.result
    if result is None:
        raise ScientificValidationFailed(
            "Export format 'result-json' is unsupported: no published result exists for "
            "this calculation."
        )
    record = session.get(CalculationResultRecord, str(result.id))
    summary = summarize_result(session, record)  # type: ignore[arg-type]
    effective = result.effective_state
    lineage = result_lineage_export(session, identity, project_id, str(result.id))
    current = bool(effective and effective.eligible_for_derivation)
    verification = effective.verification_state if effective else "UNKNOWN"
    stored_payload = record.payload_json  # exactly what was persisted, not a re-validated copy
    payload_hash = hashlib.sha256(
        json.dumps(stored_payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    document = {
        "schema": RESULT_EXPORT_SCHEMA,
        "exported_at": datetime.now(UTC).isoformat(),
        "project_id": project_id,
        "calculation": {
            "id": str(detail.calculation.id),
            "state": str(detail.calculation.state),
            "input_hash": detail.calculation_input_hash,
        },
        "specification": detail.specification.model_dump(mode="json"),
        "summary": summary.model_dump(mode="json", exclude={"effective_state"}),
        "scientific_state": {
            "evidence_use": _evidence_use(effective),
            "historical_evidence": not current,
            "effective": effective.model_dump(mode="json") if effective else None,
            "independent_verification": {
                "state": verification,
                "statement": (
                    "Not independently verified. Agreement with another calculation, "
                    "engine or method is not independent verification."
                    if verification == "UNVERIFIED"
                    else f"Recorded verification state: {verification}."
                ),
            },
            "note": None
            if current
            else (
                effective.reason
                if effective
                else "Effective scientific state was unavailable; no current standing is claimed."
            ),
        },
        "result": {
            **result.model_dump(mode="json", exclude={"payload"}),
            "payload": stored_payload,
            "payload_sha256": payload_hash,
        },
        "provenance": {
            "record_id": str(result.provenance_record_id),
            "raw_artifacts": [
                a.model_dump(mode="json") if hasattr(a, "model_dump") else a
                for a in (result.raw_artifacts or [])
            ],
            "lineage": lineage,
        },
    }
    return ExportPayload(
        filename=f"result-{str(result.id)[:8]}-{summary.task.lower()}.json",
        media_type="application/json",
        content=_json_bytes(document),
        effective=effective,
    )


def _header(lines: list[tuple[str, object]]) -> str:
    return "".join(f"# {key}: {_one_line(value)}\n" for key, value in lines)


def _context_header(
    detail: CalculationDetail, summary, effective, project_id: str
) -> list[tuple[str, object]]:
    state = effective
    return [
        ("generator", "ChemDFT scientific export"),
        ("exported_at", datetime.now(UTC).isoformat()),
        ("project_id", project_id),
        ("calculation_id", detail.calculation.id),
        ("result_id", summary.result_id),
        ("engine", f"{summary.engine or 'unknown'} {summary.engine_version or ''}".strip()),
        ("method", summary.method or "unknown"),
        ("basis", summary.basis or "not applicable"),
        ("charge", summary.charge),
        ("multiplicity", summary.multiplicity),
        ("structure_version_id", summary.structure.structure_version_id),
        ("evidence_use_at_export", _evidence_use(state)),
        ("effective_authority", state.authority if state else "UNKNOWN"),
        ("source_lineage", state.source_lineage_validity if state else "UNKNOWN"),
        ("independent_verification", state.verification_state if state else "UNKNOWN"),
    ]


def _spectrum_csv(
    session: Session, detail: CalculationDetail, project_id: str, variant: str | None
) -> ExportPayload:
    from .calculation_summary import summarize_result

    result = detail.result
    if result is None:
        raise ScientificValidationFailed(
            "Export format 'spectrum-csv' is unsupported: no published result."
        )
    record = session.get(CalculationResultRecord, str(result.id))
    summary = summarize_result(session, record)  # type: ignore[arg-type]
    available = {v.key for v in _spectrum_availability(record)[0]}
    if variant not in available:
        raise ScientificValidationFailed(
            f"Spectrum kind {variant!r} is not available for this result "
            f"(available: {', '.join(sorted(available)) or 'none'})."
        )
    payload = record.payload_json
    buffer = io.StringIO()
    meta = _context_header(detail, summary, result.effective_state, project_id)
    writer = csv.writer(buffer, lineterminator="\n")
    if variant in {"ir", "raman"}:
        modes = payload["modes"]
        meta += [
            ("data_kind", "stick (one row per normal mode); no broadening, no peak picking"),
            ("frequency_unit", payload.get("frequency_unit", "cm^-1")),
            ("hessian_type", payload.get("hessian_type")),
        ]
        if variant == "ir":
            meta.append(("intensity_unit", payload.get("intensity_unit") or "km/mol"))
            meta.append(("dipole_derivative_method", payload.get("dipole_derivative_method")))
            column, field, unit_expected = (
                "ir_intensity_km_per_mol",
                "ir_intensity",
                payload.get("intensity_unit"),
            )
        else:
            meta.append(("raman_activity_unit", payload.get("raman_activity_unit")))
            meta.append(("raman_method", payload.get("raman_method")))
            meta.append(("depolarization_ratio", "dimensionless"))
            column, field, unit_expected = (
                "raman_activity_angstrom4_per_amu",
                "raman_activity",
                payload.get("raman_activity_unit"),
            )
        buffer.write(_header(meta))
        header = ["mode_index", "frequency_cm-1", column, "imaginary"] + (
            ["depolarization_ratio"] if variant == "raman" else []
        )
        writer.writerow(header)
        for mode in modes:
            quantity = mode.get(field)
            value = ""
            if quantity:
                code = (quantity.get("unit") or {}).get("code")
                if (
                    unit_expected
                    and code
                    and code.lower().replace("å", "angstrom") != unit_expected.lower()
                ):
                    raise ScientificValidationFailed(
                        f"Stored {field} unit {code!r} differs from the declared "
                        f"{unit_expected!r}; export refused."
                    )
                value = repr(float(quantity["value"]))
            row = [
                mode["index"],
                repr(float(mode["frequency_cm1"])),
                value,
                str(bool(mode["imaginary"])).lower(),
            ]
            if variant == "raman":
                ratio = mode.get("depolarization_ratio")
                row.append("" if ratio is None else repr(float(ratio)))
            writer.writerow(row)
    else:
        states = payload["excited_states"]
        meta += [
            ("data_kind", "stick (one row per excited state); no broadening, no peak picking"),
            ("response_method", payload.get("response_method")),
            ("spin_channel", payload.get("spin_channel")),
            ("oscillator_strength_gauge", payload.get("oscillator_strength_gauge")),
            ("requested_roots", payload.get("requested_roots")),
            ("converged_roots", payload.get("converged_roots")),
            ("ground_state_energy_Eh", payload.get("ground_state_energy_hartree")),
        ]
        buffer.write(_header(meta))
        writer.writerow(
            [
                "state",
                "energy_Eh",
                "energy_eV",
                "wavelength_nm",
                "oscillator_strength",
                "transition_dipole_x_au",
                "transition_dipole_y_au",
                "transition_dipole_z_au",
            ]
        )
        for s in states:
            writer.writerow(
                [
                    s["state_label"],
                    repr(float(s["energy_hartree"])),
                    repr(float(s["energy_ev"])),
                    repr(float(s["wavelength_nm"])),
                    repr(float(s["oscillator_strength"])),
                    *(repr(float(c)) for c in s["transition_dipole"]),
                ]
            )
    return ExportPayload(
        filename=f"spectrum-{variant}-{str(result.id)[:8]}.csv",
        media_type="text/csv; charset=utf-8",
        content=buffer.getvalue().encode(),
        effective=result.effective_state,
    )


def _trajectory_xyz(session: Session, detail: CalculationDetail) -> ExportPayload:
    trajectory = detail.optimization_trajectory
    if trajectory is None or not trajectory.steps:
        raise ScientificValidationFailed(
            "Export format 'trajectory-xyz' is unsupported: no optimization frames were recorded."
        )
    elements = [atom.element for atom in trajectory.atom_identities]
    effective = detail.result.effective_state if detail.result else False
    evidence = _evidence_use(effective) if detail.result else "NO_RESULT"  # type: ignore[arg-type]
    out = io.StringIO()
    for step in trajectory.steps:
        coords = step.coordinates_angstrom
        if len(coords) != len(elements):
            raise ScientificValidationFailed(
                "Stored trajectory frame does not match the atom ordering; export refused."
            )
        out.write(f"{len(elements)}\n")
        out.write(
            f"frame={step.index} energy_Eh={step.energy_hartree!r} "
            f"gradient_norm_Eh_per_bohr={step.gradient_norm_hartree_per_bohr!r} "
            f"kind={step.evaluation_kind} trajectory_state={trajectory.state} "
            f"calculation={trajectory.calculation_id} "
            f"input_structure_version={trajectory.input_structure_version_id} "
            f"evidence_use={evidence} length_unit=angstrom\n"
        )
        for element, (x, y, z) in zip(elements, coords, strict=True):
            out.write(f"{element:<2} {x:.10f} {y:.10f} {z:.10f}\n")
    return ExportPayload(
        filename=f"trajectory-{str(trajectory.calculation_id)[:8]}.xyz",
        media_type="chemical/x-xyz",
        content=out.getvalue().encode(),
        effective=effective,
    )


def render_cube(
    *,
    atoms: list[tuple[int, tuple[float, float, float]]],
    origin_angstrom,
    spacing_angstrom: float,
    dimensions,
    values,
    comments: tuple[str, str],
) -> str:
    """Gaussian CUBE: lengths in bohr, x slowest / z fastest, six values per line,
    new line at the end of each z-row."""
    nx, ny, nz = (int(n) for n in dimensions)
    if len(values) != nx * ny * nz:
        raise ScientificValidationFailed("Field value count does not match grid dimensions.")
    if not all(math.isfinite(v) for v in values):
        raise ScientificValidationFailed("Field contains non-finite values; export refused.")
    scale = 1.0 / BOHR_IN_ANGSTROM
    out = io.StringIO()
    out.write(_one_line(comments[0]) + "\n")
    out.write(_one_line(comments[1]) + "\n")
    out.write(f"{len(atoms):5d}" + "".join(f"{c * scale:14.8f}" for c in origin_angstrom) + "\n")
    step = spacing_angstrom * scale
    out.write(f"{nx:5d}{step:14.8f}{0.0:14.8f}{0.0:14.8f}\n")
    out.write(f"{ny:5d}{0.0:14.8f}{step:14.8f}{0.0:14.8f}\n")
    out.write(f"{nz:5d}{0.0:14.8f}{0.0:14.8f}{step:14.8f}\n")
    for z_number, (x, y, zc) in atoms:
        out.write(
            f"{z_number:5d}{float(z_number):14.8f}"
            f"{x * scale:14.8f}{y * scale:14.8f}{zc * scale:14.8f}\n"
        )
    index = 0
    for _ix in range(nx):
        for _iy in range(ny):
            for start in range(0, nz, 6):
                row = values[index + start : index + min(start + 6, nz)]
                # 9 significant digits round-trips the stored float32 values exactly.
                out.write("".join(f"{v:16.8E}" for v in row) + "\n")
            index += nz
    return out.getvalue()


def _cube(
    session: Session,
    object_store: ObjectStore,
    settings: Settings,
    detail: CalculationDetail,
    project_id: str,
    variant: str | None,
) -> ExportPayload:
    result = detail.result
    if result is None or result.result_type != "chemdft.molecular-orbitals":
        raise ScientificValidationFailed(
            "Export format 'cube' is unsupported: only SCF orbital results own volumetric grids."
        )
    if not variant:
        raise ScientificValidationFailed("Export format 'cube' requires a stored field (variant).")
    artifact = session.get(ScientificArtifactRecord, variant)
    if (
        artifact is None
        or artifact.project_id != project_id
        or artifact.kind != "VOLUMETRIC_GRID"
        or artifact.format_identifier != "chemdft.volumetric-field.npz"
        or artifact.source_relation_id != str(result.id)
    ):
        # The grid must belong to this exact result in this project; anything else is "not found".
        raise ScientificReferenceNotFound("Field grid does not exist for this calculation.")
    try:
        output = read_field_output(object_store, settings, artifact)
    except (ValueError, KeyError, OSError) as error:
        raise ScientificValidationFailed(
            f"Stored field failed integrity validation: {error}"
        ) from error
    manifest = output.manifest
    version = session.get(StructureVersionRecord, str(manifest.input_structure_version_id))
    if version is None or version.project_id != project_id:
        raise ScientificValidationFailed(
            "Field structure version is unavailable; CUBE needs atom positions."
        )
    from .calculation_summary import version_atoms

    atoms = [
        (int(a["atomic_number"]), (float(a["x"]), float(a["y"]), float(a["z"])))
        for a in version_atoms(version)
    ]
    if (
        not atoms
        or (version.representation_json.get("coordinates") or {}).get("unit") != "angstrom"
    ):
        raise ScientificValidationFailed(
            "Structure atoms or length unit are unavailable; CUBE export refused."
        )
    unit_label = {"a0^-3/2": "bohr^-3/2", "e/a0^3": "e/bohr^3", "a.u.": "a.u. (Eh/e)"}[
        manifest.field_unit
    ]
    identity_line = f"{manifest.field_quantity}"
    if manifest.field_quantity == "MO_AMPLITUDE":
        identity_line += (
            f" orbital_index_0based={manifest.orbital_index} spin={manifest.spin_channel}"
        )
    comments = (
        f"ChemDFT CUBE export | {evidence_standing_marker(result.effective_state)} | "
        f"{identity_line} | unit {unit_label} | "
        f"lengths in bohr (1 bohr = {BOHR_IN_ANGSTROM} A)",
        f"{manifest.method}/{manifest.basis} {manifest.producer} {manifest.producer_version} | "
        f"calculation {manifest.calculation_id} result {manifest.calculation_result_id} | "
        f"grid_sha256 {manifest.grid_sha256[:16]}",
    )
    text = render_cube(
        atoms=atoms,
        origin_angstrom=manifest.origin_angstrom,
        spacing_angstrom=manifest.spacing_angstrom,
        dimensions=manifest.dimensions,
        values=output.field_values,
        comments=comments,
    )
    return ExportPayload(
        filename=f"{manifest.field_quantity.lower().replace('_', '-')}-{str(result.id)[:8]}"
        f"{'' if manifest.orbital_index is None else f'-mo{manifest.orbital_index + 1}'}.cube",
        media_type="chemical/x-cube",
        content=text.encode(),
        effective=result.effective_state,
    )


def _report(
    session: Session,
    identity: Identity,
    detail: CalculationDetail,
    project_id: str,
    variant: str | None,
) -> ExportPayload:
    from .scientific_report import build_report_document, render_report

    if detail.result is None:
        raise ScientificValidationFailed(
            "Export format 'report' is unsupported: no published result exists for this "
            "calculation."
        )
    document = build_report_document(session, identity, project_id, [str(detail.result.id)])
    content, media_type, extension = render_report(document, variant or "html")
    return ExportPayload(
        filename=f"report-{str(detail.result.id)[:8]}.{extension}",
        media_type=media_type,
        content=content,
        effective=detail.result.effective_state,
    )


def build_export(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    project_id: str,
    calculation_id: str,
    export_format: str,
    variant: str | None,
) -> ExportPayload:
    project, _member = authorize_project_access(session, identity, project_id)
    _calculation(session, project.id, calculation_id)
    if export_format not in FORMAT_META:
        raise ScientificValidationFailed(
            f"Export format {export_format!r} is unsupported. "
            f"Supported formats: {', '.join(FORMAT_META)}."
        )
    if export_format == "reproducibility-bundle":
        # Built only from allowlisted projections; deliberately NOT through `get_calculation`,
        # whose model validation both fails on malformed stored records and quotes stored values.
        from .reproducibility_bundle import build_bundle

        payload = build_bundle(
            session, identity, object_store, settings, project.id, calculation_id
        )
        return ExportPayload(
            filename=payload.filename, media_type=payload.media_type,
            content=payload.content, effective=payload.effective,
        )
    detail = get_calculation(session, identity, project.id, calculation_id)
    payload: ExportPayload
    if export_format == "result-json":
        payload = _result_json(session, identity, detail, project.id)
    elif export_format == "trajectory-xyz":
        payload = _trajectory_xyz(session, detail)
    elif export_format == "spectrum-csv":
        payload = _spectrum_csv(session, detail, project.id, variant)
    elif export_format == "report":
        payload = _report(session, identity, detail, project.id, variant)
    else:
        payload = _cube(session, object_store, settings, detail, project.id, variant)
    return ExportPayload(
        filename=safe_filename(payload.filename),
        media_type=payload.media_type,
        content=payload.content,
        effective=payload.effective,
    )
