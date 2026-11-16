from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..actions import authorize_project_access
from ..ai_models import AIContextSnapshotRecord
from ..calculation_actions import get_calculation
from ..config import Settings
from ..context import Identity
from ..contracts.results import (
    MolecularOrbitalAnalysis,
    TddftResult,
    VibrationalAnalysis,
)
from ..experimental_spectrum_actions import list_spectrum_datasets
from ..experimental_spectrum_comparison import list_spectrum_comparisons
from ..knowledge_models import ProjectMemoryRecord
from ..models import new_id
from ..phase7_actions import get_document, list_documents, list_experimental_datasets
from ..scientific_actions import list_structures
from ..scientific_claim_actions import get_project_scientific_claims
from ..scientific_comparison_actions import build_scientific_comparison
from ..scientific_models import (
    AuditEventRecord,
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    CandidateRepresentationRecord,
    CandidateRepresentationReviewRecord,
    DocumentSourceAnchorRecord,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureCandidateRecord,
    StructureVersionRecord,
)
from ..storage import ObjectStore
from ..volumetric_field_actions import read_field_output
from .spectrum_context import dataset_record, referenced_entities, spectrum_lines


@dataclass(frozen=True, slots=True)
class ProjectContextBundle:
    snapshot_id: str
    summary_text: str
    structured_context: dict[str, object]


@dataclass(frozen=True, slots=True)
class ProjectContext:
    """Deterministic, read-only graph of authoritative project records."""

    project: Mapping[str, object]
    structures: tuple[Mapping[str, object], ...]
    candidates: tuple[Mapping[str, object], ...]
    calculations: tuple[Mapping[str, object], ...]
    documents: tuple[Mapping[str, object], ...]
    datasets: tuple[Mapping[str, object], ...]
    claims: tuple[Mapping[str, object], ...]
    claim_relations: tuple[Mapping[str, object], ...]
    notes: tuple[Mapping[str, object], ...]
    provenance: tuple[Mapping[str, object], ...]
    history: tuple[Mapping[str, object], ...]
    current_view: Mapping[str, object]
    comparison_rows: tuple[Mapping[str, object], ...] = ()


def _freeze(value: Any) -> Any:
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    if isinstance(value, tuple):
        return tuple(_freeze(item) for item in value)
    return value


def _format_tddft_summary_line(analysis: Mapping[str, Any]) -> str:
    res_id = str(analysis.get("result_id", "unknown"))
    struct_ver = str(analysis.get("input_structure_version_id") or "none")
    states = analysis.get("excited_states") or []
    method = str(analysis.get("method", "B3LYP"))
    basis = str(analysis.get("basis", "def2-SVPD"))
    lead = (
        f"  TDDFT UV/Vis result {res_id} for StructureVersion {struct_ver}: "
        f"{len(states)} singlet states calculated with {method}/{basis}"
    )
    dom_idx = analysis.get("dominant_state_index")
    if dom_idx is not None and isinstance(dom_idx, int) and 0 <= dom_idx < len(states):
        dom = states[dom_idx]
        if isinstance(dom, Mapping):
            lbl = dom.get("state_label") or f"S{dom_idx + 1}"
            ev = dom.get("energy_ev")
            nm = dom.get("wavelength_nm")
            f = dom.get("oscillator_strength")
            if ev is not None and nm is not None and f is not None:
                return (
                    f"{lead}; strongest transition {lbl} at {float(ev):.4f} eV "
                    f"({float(nm):.2f} nm), f = {float(f):.4f}."
                )


def _format_vibrational_summary_line(analysis: Mapping[str, Any]) -> str:
    res_id = str(analysis.get("result_id", "unknown"))
    struct_ver = str(analysis.get("input_structure_version_id") or "none")
    modes = analysis.get("modes") or []
    method = str(analysis.get("method", "B3LYP"))
    basis = str(analysis.get("basis", "def2-SVP"))
    engine = str(analysis.get("engine", "PySCF"))
    has_raman = bool(
        analysis.get("raman_method")
        or any(isinstance(m, Mapping) and m.get("raman_activity") is not None for m in modes)
    )
    mode_strs: list[str] = []
    for m in modes:
        if isinstance(m, Mapping):
            idx = int(m.get("index", 0)) + 1
            freq = float(m.get("frequency_cm1", 0.0))
            details: list[str] = []
            ir = m.get("ir_intensity")
            ir_val = ir.get("value") if isinstance(ir, Mapping) else ir
            if ir_val is not None:
                details.append(f"IR: {float(ir_val):.2f} km/mol")
            raman = m.get("raman_activity")
            raman_val = raman.get("value") if isinstance(raman, Mapping) else raman
            if raman_val is not None:
                depol = m.get("depolarization_ratio")
                depol_str = f", ρ={float(depol):.4f}" if depol is not None else ""
                details.append(f"Raman: {float(raman_val):.4f} Å⁴/amu{depol_str}")
            if details:
                mode_strs.append(f"Mode {idx}: {freq:.1f} cm⁻¹ ({', '.join(details)})")
            else:
                mode_strs.append(f"Mode {idx}: {freq:.1f} cm⁻¹")
    spec_kind = "vibrational/IR/Raman" if has_raman else "vibrational/IR"
    lead = (
        f"  Validated {spec_kind} result {res_id} for StructureVersion {struct_ver}: "
        f"{len(modes)} modes calculated with {method}/{basis} via {engine}"
    )
    if mode_strs:
        lead += f"; modes={mode_strs}"
    imag_indices = [m.get("index") for m in modes if isinstance(m, Mapping) and m.get("imaginary")]
    if imag_indices:
        lead += f"; imaginary mode indices={imag_indices}"
    return lead


class AIContextBuilder:
    def __init__(
        self,
        session: Session,
        identity: Identity,
        project_id: str,
        *,
        object_store: ObjectStore | None = None,
        settings: Settings | None = None,
    ) -> None:
        self._session = session
        self._identity = identity
        self._project_id = project_id
        self._object_store = object_store
        self._settings = settings

    def build_context(
        self,
        *,
        selected_structure_id: str | None = None,
        selected_structure_version_id: str | None = None,
        selected_document_id: str | None = None,
        selected_result_id: str | None = None,
        current_view: str | None = None,
    ) -> ProjectContextBundle:
        project, _ = authorize_project_access(self._session, self._identity, self._project_id)
        captured_refs: list[dict[str, object]] = [
            {"entity_type": "project", "entity_id": project.id}
        ]

        # 1. Structures
        structures = list_structures(self._session, self._identity, project.id)
        current_structure = next(
            (item for item in structures if str(item.id) == selected_structure_id), None
        )
        if current_structure is None:
            selected_structure_id = None
            selected_structure_version_id = None

        structure_summaries = []
        version_rows = self._session.scalars(
            select(StructureVersionRecord)
            .where(StructureVersionRecord.project_id == project.id)
            .order_by(StructureVersionRecord.structure_id, StructureVersionRecord.revision)
        ).all()
        if selected_structure_version_id and not any(
            str(v.id) == selected_structure_version_id for v in version_rows
        ):
            selected_structure_version_id = None
        provenance_rows = self._session.scalars(
            select(ProvenanceRecordRow)
            .where(ProvenanceRecordRow.project_id == project.id)
            .order_by(ProvenanceRecordRow.created_at)
        ).all()
        history_rows = self._session.scalars(
            select(AuditEventRecord)
            .where(
                AuditEventRecord.project_id == project.id, AuditEventRecord.outcome == "SUCCEEDED"
            )
            .order_by(AuditEventRecord.occurred_at.desc())
            .limit(100)
        ).all()
        provenance_by_id = {row.id: row for row in provenance_rows}
        versions_by_structure: dict[str, list[StructureVersionRecord]] = {}
        for version in version_rows:
            versions_by_structure.setdefault(version.structure_id, []).append(version)
        structure_records: list[dict[str, object]] = []
        for s in structures:
            captured_refs.append({"entity_type": "structure", "entity_id": str(s.id)})
            captured_refs.append(
                {"entity_type": "structure.version", "entity_id": str(s.latest_version_id)}
            )
            structure_summaries.append(
                f"- Structure '{s.name}' (ID: {s.id}, Kind: {s.kind}, "
                f"Latest Version V{s.latest_revision} ID: {s.latest_version_id}, "
                f"Atoms: {s.atom_count}, Bonds: {s.bond_count})"
            )
            versions = versions_by_structure.get(str(s.id), [])
            structure_records.append(
                {
                    "id": str(s.id),
                    "name": s.name,
                    "kind": str(s.kind),
                    "latest_version_id": str(s.latest_version_id),
                    "versions": [
                        {
                            "id": row.id,
                            "revision": row.revision,
                            "origin": row.origin,
                            "parent_version_id": row.parent_version_id,
                            "atom_count": row.atom_count,
                            "bond_count": row.bond_count,
                            "provenance_id": row.provenance_record_id,
                            "source_class": provenance_by_id.get(
                                row.provenance_record_id
                            ).source_class
                            if provenance_by_id.get(row.provenance_record_id)
                            else None,
                            "verification_state": provenance_by_id.get(
                                row.provenance_record_id
                            ).verification_state
                            if provenance_by_id.get(row.provenance_record_id)
                            else None,
                            "coordinate_origin": next(
                                (
                                    item.get("value")
                                    for item in provenance_by_id[
                                        row.provenance_record_id
                                    ].parameters_json
                                    if isinstance(item, dict)
                                    and item.get("key") == "coordinate_origin"
                                ),
                                None,
                            )
                            if row.provenance_record_id in provenance_by_id
                            else None,
                            "coordinate_input_format": next(
                                (
                                    item.get("value")
                                    for item in provenance_by_id[
                                        row.provenance_record_id
                                    ].parameters_json
                                    if isinstance(item, dict)
                                    and item.get("key") == "coordinate_input_format"
                                ),
                                None,
                            )
                            if row.provenance_record_id in provenance_by_id
                            else None,
                            "source_format": next(
                                (
                                    item.get("value")
                                    for item in provenance_by_id[
                                        row.provenance_record_id
                                    ].parameters_json
                                    if isinstance(item, dict) and item.get("key") == "format"
                                ),
                                None,
                            )
                            if row.provenance_record_id in provenance_by_id
                            else None,
                            "has_periodic_cell": bool(row.periodic_cell_json),
                        }
                        for row in versions
                    ],
                }
            )

        # 2. Calculations & Results
        calc_rows = self._session.scalars(
            select(CalculationRecord)
            .where(CalculationRecord.project_id == project.id)
            .order_by(CalculationRecord.created_at.desc())
            .limit(10)
        ).all()
        if selected_result_id:
            selected_calculation = self._session.scalar(
                select(CalculationRecord)
                .join(
                    CalculationResultRecord,
                    CalculationResultRecord.calculation_id == CalculationRecord.id,
                )
                .where(
                    CalculationRecord.project_id == project.id,
                    CalculationResultRecord.project_id == project.id,
                    CalculationResultRecord.id == selected_result_id,
                )
            )
            if selected_calculation:
                calc_rows = [
                    selected_calculation,
                    *(row for row in calc_rows if row.id != selected_calculation.id),
                ][:10]
        calculation_inputs = (
            self._session.scalars(
                select(CalculationInputRecord).where(
                    CalculationInputRecord.project_id == project.id,
                    CalculationInputRecord.calculation_id.in_([row.id for row in calc_rows]),
                )
            ).all()
            if calc_rows
            else []
        )
        calculation_input_by_id = {row.calculation_id: row for row in calculation_inputs}
        calculation_summaries = []
        calculation_records: list[dict[str, object]] = []
        for cr in calc_rows:
            captured_refs.append({"entity_type": "calculation", "entity_id": cr.id})
            detail = get_calculation(self._session, self._identity, project.id, cr.id)
            calc_spec = detail.specification
            method = getattr(getattr(calc_spec, "method", None), "identifier", "Unknown")
            basis = calc_spec.basis.identifier if calc_spec.basis is not None else None
            status = cr.state
            level = f"{method}/{basis}" if basis is not None else method
            summary_line = f"- Calculation {cr.id}: {level} [{status}]"
            if detail.result:
                status = detail.result.effective_state
                summary_line += (
                    " (Published via Firewall)"
                    if status.eligible_for_derivation
                    else f" (Historical inactive evidence: {status.source_lineage_validity})"
                )
                captured_refs.append(
                    {
                        "entity_type": "calculation.result",
                        "entity_id": str(detail.result.id),
                    }
                )
            calculation_summaries.append(summary_line)
            trajectory = detail.optimization_trajectory
            vibrational_facts = None
            orbital_facts = None
            tddft_facts = None
            if detail.result and isinstance(detail.result.payload, TddftResult):
                analysis = detail.result.payload
                tddft_facts = {
                    "result_id": str(detail.result.id),
                    "input_structure_id": str(analysis.input_structure_id),
                    "input_structure_version_id": str(analysis.input_structure_version_id),
                    "calculation_input_hash": analysis.calculation_input_hash,
                    "method": analysis.method,
                    "basis": analysis.basis,
                    "engine": analysis.engine,
                    "engine_version": analysis.engine_version,
                    "converged": analysis.converged,
                    "charge": analysis.charge,
                    "multiplicity": analysis.multiplicity,
                    "reference_method": analysis.reference_method,
                    "ground_state_energy_hartree": analysis.ground_state_energy_hartree,
                    "scf_iterations": analysis.scf_iterations,
                    "homo_index": analysis.homo_index,
                    "lumo_index": analysis.lumo_index,
                    "homo_energy_hartree": analysis.homo_energy_hartree,
                    "lumo_energy_hartree": analysis.lumo_energy_hartree,
                    "homo_lumo_gap_hartree": analysis.homo_lumo_gap_hartree,
                    "homo_lumo_gap_ev": analysis.homo_lumo_gap_ev,
                    "homo_lumo_gap_label": analysis.homo_lumo_gap_label,
                    "homo_lumo_gap_note": analysis.homo_lumo_gap_note,
                    "requested_roots": analysis.requested_roots,
                    "converged_roots": analysis.converged_roots,
                    "max_oscillator_strength": analysis.max_oscillator_strength,
                    "dominant_state_index": analysis.dominant_state_index,
                    "oscillator_strength_gauge": analysis.oscillator_strength_gauge,
                    "nocc": analysis.nocc,
                    "nvir": analysis.nvir,
                    "result_sha256": analysis.result_sha256,
                    "excited_states": [
                        state.model_dump(mode="json") for state in analysis.excited_states
                    ],
                }
            if detail.result and isinstance(detail.result.payload, VibrationalAnalysis):
                analysis = detail.result.payload
                vibrational_facts = {
                    "result_id": str(detail.result.id),
                    "input_structure_id": str(
                        getattr(
                            analysis,
                            "input_structure_id",
                            getattr(detail.calculation, "structure_id", "") or "",
                        )
                    ),
                    "input_structure_version_id": str(analysis.input_structure_version_id),
                    "method": analysis.method,
                    "basis": analysis.basis,
                    "engine": analysis.engine,
                    "engine_version": analysis.engine_version,
                    "charge": analysis.charge,
                    "multiplicity": analysis.multiplicity,
                    "mode_count": len(analysis.modes),
                    "result_sha256": analysis.result_sha256,
                    "dipole_derivative_method": getattr(analysis, "dipole_derivative_method", None),
                    "finite_difference_step_bohr": getattr(
                        analysis, "finite_difference_step_bohr", None
                    ),
                    "intensity_unit": getattr(analysis, "intensity_unit", None),
                    "modes": [
                        {
                            "index": mode.index,
                            "frequency_cm1": mode.frequency_cm1,
                            "imaginary": mode.imaginary,
                            "reduced_mass_amu": mode.reduced_mass_amu,
                            "ir_intensity": mode.ir_intensity.model_dump(mode="json")
                            if mode.ir_intensity
                            else None,
                            "raman_activity": mode.raman_activity.model_dump(mode="json")
                            if mode.raman_activity
                            else None,
                        }
                        for mode in analysis.modes
                    ],
                }
            if detail.result and isinstance(detail.result.payload, MolecularOrbitalAnalysis):
                analysis = detail.result.payload
                grid_artifacts = self._session.scalars(
                    select(ScientificArtifactRecord).where(
                        ScientificArtifactRecord.project_id == project.id,
                        ScientificArtifactRecord.kind == "ORBITAL_GRID",
                        ScientificArtifactRecord.source_relation_type == "calculation.result",
                        ScientificArtifactRecord.source_relation_id == str(detail.result.id),
                    )
                ).all()
                validated_fields = []
                if self._object_store is not None and self._settings is not None:
                    for artifact in self._session.scalars(
                        select(ScientificArtifactRecord)
                        .where(
                            ScientificArtifactRecord.project_id == project.id,
                            ScientificArtifactRecord.kind == "VOLUMETRIC_GRID",
                            ScientificArtifactRecord.source_relation_id == str(detail.result.id),
                        )
                        .order_by(ScientificArtifactRecord.id)
                    ):
                        try:
                            manifest = read_field_output(
                                self._object_store, self._settings, artifact
                            ).manifest
                            if manifest.result_sha256 != analysis.result_sha256:
                                continue
                            validated_fields.append(manifest.model_dump(mode="json"))
                        except (ValueError, KeyError, OSError):
                            # Corrupt/unavailable artifacts are never supplied as field evidence.
                            continue
                orbital_facts = {
                    "electronic_fields": validated_fields,
                    "result_id": str(detail.result.id),
                    "input_structure_version_id": str(analysis.input_structure_version_id),
                    "calculation_input_hash": analysis.calculation_input_hash,
                    "method": analysis.method,
                    "basis": analysis.basis,
                    "engine": analysis.engine,
                    "engine_version": analysis.engine_version,
                    "converged": analysis.converged,
                    "charge": analysis.charge,
                    "multiplicity": analysis.multiplicity,
                    "total_energy_hartree": analysis.total_energy_hartree,
                    "scf_iterations": analysis.scf_iterations,
                    "electron_count": analysis.electron_count,
                    "alpha_electron_count": analysis.alpha_electron_count,
                    "beta_electron_count": analysis.beta_electron_count,
                    "basis_function_count": analysis.basis_function_count,
                    "molecular_orbital_count": analysis.molecular_orbital_count,
                    "orbitals": [orbital.model_dump(mode="json") for orbital in analysis.orbitals],
                    "frontier_by_spin": [
                        frontier.model_dump(mode="json") for frontier in analysis.frontier_by_spin
                    ],
                    "gap_label": analysis.orbital_gap_label,
                    "gap_note": analysis.orbital_gap_note,
                    "coefficient_artifact": analysis.coefficient_artifact.model_dump(mode="json"),
                    "result_sha256": analysis.result_sha256,
                    "grids": [
                        extension.get("values", {})
                        for artifact in grid_artifacts
                        for extension in artifact.extensions_json
                        if extension.get("namespace") == "chemdft.molecular-orbital-grid"
                    ],
                }
            calculation_records.append(
                {
                    "id": cr.id,
                    "state": cr.state,
                    "lifecycle_state": cr.state,
                    "task": getattr(calc_spec.task_type, "value", str(calc_spec.task_type)),
                    "method": method,
                    "basis": basis,
                    "structure_version_id": calculation_input_by_id[cr.id].structure_version_id
                    if cr.id in calculation_input_by_id
                    else None,
                    "result": detail.result.model_dump(mode="json") if detail.result else None,
                    "vibrational_analysis": vibrational_facts,
                    "molecular_orbitals": orbital_facts,
                    "tddft": tddft_facts,
                    "trajectory": (
                        {
                            "id": str(trajectory.id),
                            "state": trajectory.state,
                            "step_count": len(trajectory.steps),
                            "recorded_evaluations": len(trajectory.steps),
                            "optimization_iterations": getattr(
                                detail.result.payload, "optimization_iterations", None
                            )
                            if detail.result
                            else None,
                            "final_single_point_evaluations": sum(
                                step.evaluation_kind == "FINAL_SINGLE_POINT"
                                for step in trajectory.steps
                            ),
                            "input_structure_version_id": str(
                                trajectory.input_structure_version_id
                            ),
                            "final_structure_version_id": str(trajectory.final_structure_version_id)
                            if trajectory.final_structure_version_id
                            else None,
                        }
                        if trajectory
                        else None
                    ),
                }
            )

        # 3. Scientific Documents & Extracted Evidence
        docs_output = list_documents(self._session, self._identity, project.id)
        current_document = next(
            (item for item in docs_output.documents if str(item.id) == selected_document_id), None
        )
        if current_document is None:
            selected_document_id = None
        doc_summaries = []
        structure_figure_candidate_count = 0
        ordered_documents = sorted(
            docs_output.documents,
            key=lambda document: str(document.id) != selected_document_id,
        )
        for d in ordered_documents:
            captured_refs.append({"entity_type": "scientific_document", "entity_id": str(d.id)})
            doc_summaries.append(
                f"- Document '{d.title}' (ID: {d.id}, Year: {d.publication_year or 'N/A'}, "
                f"DOI: {d.doi or 'N/A'}, Pages: {d.page_count})"
            )
            doc_detail = get_document(self._session, self._identity, project.id, str(d.id))
            structure_figure_candidate_count += sum(
                1
                for candidate in doc_detail.candidates
                if candidate.evidence_type == "STRUCTURE_FIGURE_CANDIDATE"
            )
            for c in doc_detail.candidates:
                captured_refs.append({"entity_type": "evidence_candidate", "entity_id": str(c.id)})

        # 4. Experimental Datasets
        datasets_output = list_experimental_datasets(self._session, self._identity, project.id)
        spectra = list(list_spectrum_datasets(self._session, self._identity, project.id).datasets)
        spectrum_comparisons = list(
            list_spectrum_comparisons(self._session, self._identity, project.id).comparisons
        )
        captured_refs.extend(referenced_entities(spectra))
        claims_output = get_project_scientific_claims(self._session, self._identity, project.id)
        comparison_output = build_scientific_comparison(claims_output)
        claim_records = [claim.model_dump(mode="json") for claim in claims_output.claims]
        comparison_records = [row.model_dump(mode="json") for row in comparison_output.rows]
        claim_summaries = [
            f"- {claim.subject}: {claim.predicate} = {claim.value}"
            + (f" {claim.unit}" if claim.unit else "")
            + f" [{claim.source_authority}; {claim.review_state}; "
            + f"source {claim.source_record_type} {claim.source_record_id}]"
            for claim in claims_output.claims
        ]
        comparison_summaries = [
            f"- {row.relation}: {row.topic}; "
            + " ↔ ".join(
                f"{claim.predicate} {claim.value}"
                + (f" {claim.unit}" if claim.unit else "")
                + f" [{claim.source_authority}; record {claim.source_record_type} "
                + f"{claim.source_record_id}]"
                for claim in (*row.source_claims, *row.project_claims)
            )
            + (
                f"; delta {row.delta} {row.delta_unit or ''} (source minus ChemDFT)"
                if row.delta is not None
                else ""
            )
            + (f"; {row.unresolved_reason}" if row.unresolved_reason else "")
            for row in comparison_output.rows
        ]
        dataset_summaries = []
        for ds in datasets_output.datasets:
            captured_refs.append({"entity_type": "experimental_dataset", "entity_id": str(ds.id)})
            session_data = ds.digitization_session
            if session_data is not None:
                if hasattr(session_data, "reported_peaks"):
                    for peak in session_data.reported_peaks:
                        captured_refs.append(
                            {
                                "entity_type": "evidence_candidate",
                                "entity_id": str(peak.evidence_id),
                            }
                        )
                    actual_points = "; ".join(
                        f"{point.two_theta_degree:.4f}° 2θ"
                        + (
                            f", intensity {point.intensity:.5g}"
                            if point.intensity is not None
                            else ", intensity absent"
                        )
                        for point in session_data.points
                    )
                    reported = (
                        "; ".join(
                            f"{peak.two_theta_degree:.3f}° 2θ [E {peak.evidence_id}]"
                            for peak in session_data.reported_peaks
                        )
                        or "none stored"
                    )
                    dataset_summaries.append(
                        f"- Dataset '{ds.name}' [P {ds.id}] is a DIGITIZED XRD dataset "
                        f"reconstructed manually from Figure {session_data.figure_number}, "
                        f"page {session_data.page_number}; "
                        f"it is not instrument data or experimental raw data. Stored points: "
                        f"{actual_points}. Separately EXTRACTED reported textual peaks: {reported}."
                    )
                else:
                    actual_points = "; ".join(
                        f"{point.x_value:.5g} nm diameter, q {point.y_value:.5g}%"
                        for point in session_data.points
                    )
                    dataset_summaries.append(
                        f"- Dataset '{ds.name}' [P {ds.id}] is a DIGITIZED distribution "
                        f"reconstructed manually from Figure {session_data.figure_number}, "
                        f"page {session_data.page_number}; X is source-labeled Diameter (nm), "
                        "logarithmic X is Diameter (nm); Y is source-labeled q (%). "
                        "It is not raw instrument data. "
                        "Stored points: "
                        f"{actual_points}. Extracted prose and table claims remain separate; a "
                        "hydrodynamic radius must not be equated with diameter without "
                        "explicit reconciliation."
                    )
            else:
                dataset_summaries.append(
                    f"- Dataset '{ds.name}' (ID: {ds.id}, Modality: {ds.modality}, "
                    f"Source: {ds.source_class}, State: {ds.state}, Points: {ds.point_count})"
                )

        candidates = self._session.scalars(
            select(StructureCandidateRecord)
            .where(StructureCandidateRecord.project_id == project.id)
            .order_by(StructureCandidateRecord.created_at)
        ).all()
        representation_rows = self._session.scalars(
            select(CandidateRepresentationRecord)
            .where(CandidateRepresentationRecord.project_id == project.id)
            .order_by(CandidateRepresentationRecord.revision)
        ).all()
        reps_by_candidate: dict[str, list[CandidateRepresentationRecord]] = {}
        for rep in representation_rows:
            reps_by_candidate.setdefault(rep.candidate_id, []).append(rep)
        representation_reviews = self._session.scalars(
            select(CandidateRepresentationReviewRecord)
            .where(CandidateRepresentationReviewRecord.project_id == project.id)
            .order_by(
                CandidateRepresentationReviewRecord.created_at,
                CandidateRepresentationReviewRecord.id,
            )
        ).all()
        latest_review_by_representation = {
            row.representation_id: row for row in representation_reviews
        }
        source_anchor_ids = [row.source_anchor_id for row in candidates if row.source_anchor_id]
        source_anchors = (
            self._session.scalars(
                select(DocumentSourceAnchorRecord).where(
                    DocumentSourceAnchorRecord.id.in_(source_anchor_ids)
                )
            ).all()
            if source_anchor_ids
            else []
        )
        anchors_by_id = {anchor.id: anchor for anchor in source_anchors}
        candidate_records = [
            {
                "id": row.id,
                "state": row.candidate_state,
                "source_type": row.source_type,
                "source_document_id": row.source_document_id,
                "source_evidence_id": row.source_evidence_id,
                "source_figure_number": (
                    anchors_by_id[row.source_anchor_id].figure_number
                    if row.source_anchor_id in anchors_by_id
                    else None
                ),
                "promoted_structure_version_id": row.promoted_structure_version_id,
                "promoted_structure_origin": (
                    next(
                        (
                            version.origin
                            for version in version_rows
                            if version.id == row.promoted_structure_version_id
                        ),
                        None,
                    )
                    if row.promoted_structure_version_id
                    else None
                ),
                "promoted_structure_verification": (
                    next(
                        (
                            provenance_by_id[version.provenance_record_id].verification_state
                            for version in version_rows
                            if version.id == row.promoted_structure_version_id
                            and version.provenance_record_id in provenance_by_id
                        ),
                        None,
                    )
                    if row.promoted_structure_version_id
                    else None
                ),
                "representations": [
                    {
                        "id": rep.id,
                        "revision": rep.revision,
                        "type": rep.representation_type,
                        "origin": rep.representation_origin,
                        "validation_state": rep.validation_state,
                        "review_state": (
                            latest_review_by_representation[rep.id].decision
                            if rep.id in latest_review_by_representation
                            else "NOT_REVIEWED"
                        ),
                        "review_checklist": (
                            latest_review_by_representation[rep.id].checklist_json
                            if rep.id in latest_review_by_representation
                            else None
                        ),
                        "coordinate_origin": (rep.coordinate_provenance_json or {}).get("origin"),
                        "coordinate_unit": (rep.coordinate_provenance_json or {}).get(
                            "coordinate_unit"
                        ),
                        "coordinate_file_sha256": (rep.coordinate_provenance_json or {}).get(
                            "original_file_sha256"
                        ),
                        "coordinate_source_evidence_id": (rep.coordinate_provenance_json or {}).get(
                            "source_evidence_id"
                        ),
                        "cell_provenance": rep.cell_provenance_json,
                        # Candidate representations do not have an independent
                        # lifecycle state. Their authority is inherited from
                        # the candidate and review records are stored separately.
                        "authority": "CANDIDATE",
                    }
                    for rep in reps_by_candidate.get(row.id, [])
                ],
            }
            for row in candidates
        ]

        # Confirmed project memory is contextual only and is labeled separately
        # from scientific evidence/results.
        memory_rows = self._session.scalars(
            select(ProjectMemoryRecord)
            .where(ProjectMemoryRecord.project_id == project.id)
            .order_by(ProjectMemoryRecord.created_at.desc())
            .limit(20)
        ).all()
        memory_summaries = []
        note_records: list[dict[str, object]] = []
        for memory in memory_rows:
            captured_refs.append({"entity_type": "project_memory", "entity_id": str(memory.id)})
            memory_summaries.append(f"- [{memory.memory_type}] {memory.content}")
            if memory.memory_type in {"PROJECT_NOTE", "CONFIRMED_NOTE"}:
                note_records.append(
                    {
                        "id": memory.id,
                        "content": memory.content,
                        "confirmation_state": memory.confirmation_state,
                        "created_at": memory.created_at.isoformat(),
                    }
                )

        visualization_availability = (
            [
                "A committed StructureVersion with validated atomic coordinates is required "
                "for 3D visualization and calculation.",
                "No committed StructureVersion exists in this project; validated atomic "
                "coordinates are unavailable.",
            ]
            if not structures
            else [
                "Committed structures exist; use their selected immutable versions for "
                "scientific visualization."
            ]
        )
        if structure_figure_candidate_count:
            visualization_availability.append(
                f"{structure_figure_candidate_count} extracted structure-figure candidate(s) "
                "include reported/hypothetical paper evidence. Figure 2 does not provide "
                "full atomic coordinates. Any coordinate-bearing representation or "
                "RECONSTRUCTED StructureVersion originates from user input, not from "
                "coordinates extracted or inferred from the figure. Do not describe it "
                "as experimental."
            )

        # Build human-readable structured context summary
        current_structure_id = current_structure.id if current_structure else "none"
        current_document_id = current_document.id if current_document else "none"
        default_overview = f"{project.name} → Overview"
        view_lead = current_view.split(" → ")[0].strip() if current_view else ""
        view_structure_name = view_lead.split(" · ")[0].split(" V")[0].strip() if view_lead else ""
        v_name_cf = view_structure_name.casefold()
        is_structure_view = bool(
            structures
            and (
                (
                    v_name_cf
                    and any(
                        v_name_cf == s.name.casefold()
                        or v_name_cf in s.name.casefold()
                        or s.name.casefold() in v_name_cf
                        for s in structures
                    )
                )
                or (
                    current_structure is not None
                    and (
                        v_name_cf == current_structure.name.casefold()
                        or v_name_cf in current_structure.name.casefold()
                    )
                )
                or view_lead.startswith(
                    (
                        "Structure ·",
                        "UV/Vis spectrum",
                        "Optimization trajectory",
                        "Electronic structure",
                        "IR spectrum",
                        "IR",
                        "Infrared",
                        "Vibrational analysis",
                        "Vibrational",
                    )
                )
            )
        )
        is_project_view = (
            current_view.startswith(project.name)
            or view_lead in {"Project overview", "Project home"}
            if current_view
            else False
        )
        is_foreign = bool(
            current_view
            and (
                (
                    not structures
                    and (
                        "Structure ·" in current_view
                        or " V" in current_view
                        or "UV/Vis" in current_view
                        or "IR" in current_view
                        or "Vibrational" in current_view
                    )
                )
                or (not is_project_view and not is_structure_view)
            )
        )
        if current_view and not is_foreign:
            view_label = current_view
        else:
            view_label = (
                f"Structure · {current_structure.name}" if current_structure else default_overview
            )
        view_label = view_label[:500]
        candidate_lines = [
            f"- Candidate {candidate['id']} · {candidate['state']}; "
            f"document {candidate['source_document_id']}; representations: "
            + (
                ", ".join(
                    f"R{rep['revision']} {rep['type']} {rep['validation_state']} · "
                    f"review {rep['review_state']} · CANDIDATE ONLY"
                    + (
                        f" · coordinates {rep['coordinate_origin']} in {rep['coordinate_unit']}"
                        if rep.get("coordinate_origin")
                        else ""
                    )
                    for rep in candidate["representations"]
                )
                or "none"
            )
            + (
                f"; promoted StructureVersion {candidate['promoted_structure_version_id']} · "
                f"{candidate['promoted_structure_origin']} · "
                f"{candidate['promoted_structure_verification']}"
                if candidate.get("promoted_structure_version_id")
                else ""
            )
            + (
                "; coordinate-bearing candidate remains UNVERIFIED until promoted"
                if any(rep.get("coordinate_origin") for rep in candidate["representations"])
                and not candidate.get("promoted_structure_version_id")
                else ""
            )
            for candidate in candidate_records
        ] or ["No structure candidates."]
        note_lines = [
            f"- Note {note['id']} · {note['confirmation_state']}: {note['content']}"
            for note in note_records
        ] or ["No project notes."]
        provenance_lines = [
            f"- {row.subject_type} {row.subject_id} · {row.source_class} · "
            f"{row.verification_state} · {row.operation}"
            for row in provenance_rows
        ] or ["No provenance records."]
        history_lines = [
            f"- {row.event_name} · {row.occurred_at.isoformat()} · targets={row.targets_json}"
            for row in history_rows[:30]
        ] or ["No project history events."]
        lines = [
            "PROJECT GRAPH CONTEXT (saved project records; not retrieval output):",
            f"Project: {project.name} (ID: {project.id})",
            "CURRENT VIEW (navigation only; selection does not confer scientific authority):",
            f"{view_label}; structure {current_structure_id}; document {current_document_id}",
            "",
            f"Structures ({len(structure_summaries)}):",
            *(structure_summaries or ["No structures imported yet."]),
            *[
                f"  StructureVersion V{version['revision']} {version['origin']}; "
                f"parent={version['parent_version_id'] or 'none'}; "
                f"authority={version['source_class'] or 'not recorded'}; "
                f"verification={version['verification_state'] or 'not recorded'}; "
                f"coordinate_origin={version['coordinate_origin'] or 'not recorded'}; "
                f"periodic_cell={'defined' if version['has_periodic_cell'] else 'not defined'} "
                f"(record {version['id']})"
                for structure in structure_records
                for version in structure["versions"]
            ],
            "",
            f"Calculations ({len(calculation_summaries)}):",
            *(calculation_summaries or ["No calculations run yet."]),
            *[
                f"  Trajectory {calculation['trajectory']['id']}: "
                f"{calculation['trajectory']['state']}; "
                f"{calculation['trajectory']['step_count']} persisted evaluations; "
                "native optimizer iterations="
                f"{calculation['trajectory']['optimization_iterations']}; "
                "final single-point evaluations="
                f"{calculation['trajectory']['final_single_point_evaluations']}; "
                f"input StructureVersion="
                f"{calculation['trajectory']['input_structure_version_id']}; "
                f"final StructureVersion="
                f"{calculation['trajectory']['final_structure_version_id'] or 'none'}"
                for calculation in calculation_records
                if calculation.get("trajectory")
            ],
            *[
                _format_vibrational_summary_line(analysis)
                for calculation in calculation_records
                if (analysis := calculation.get("vibrational_analysis"))
            ],
            *[
                _format_tddft_summary_line(analysis)
                for calculation in calculation_records
                if (analysis := calculation.get("tddft"))
            ],
            "",
            f"Scientific Documents ({len(doc_summaries)}):",
            *(doc_summaries or ["No scientific documents uploaded yet."]),
            "",
            f"Experimental Datasets ({len(dataset_summaries)}):",
            *(dataset_summaries or ["No experimental datasets imported yet."]),
            "",
            *spectrum_lines(spectra, spectrum_comparisons),
            "",
            f"Projected Scientific Claims ({len(claim_summaries)}):",
            *(claim_summaries or ["No claims projected from existing records."]),
            "Claims are read-only projections of cited records. AI summaries may describe or "
            "compare them, but cannot create authoritative claims or change source authority.",
            f"Deterministic Scientific Comparison ({len(comparison_summaries)} rows):",
            *(comparison_summaries or ["No comparison rows are available."]),
            "Preserve these relation states as projected. Do not infer a comparison or numeric "
            "delta where no deterministic relation is recorded.",
            f"Structure candidates ({len(candidate_records)}):",
            *candidate_lines,
            f"Project notes ({len(note_records)}):",
            *note_lines,
            f"Saved provenance records ({len(provenance_rows)}):",
            *provenance_lines,
            f"Successful project history events ({len(history_rows)} captured):",
            *history_lines,
            "",
            "3D Visualization Availability:",
            *visualization_availability,
            "",
            f"Confirmed Project Memory ({len(memory_summaries)}):",
            *(memory_summaries or ["No confirmed project memory saved yet."]),
            "DOCUMENT / RETRIEVED EVIDENCE: supplied separately by knowledge.search; "
            "absence of passages does not erase the project graph above.",
        ]

        summary_text = "\n".join(lines)

        snapshot = AIContextSnapshotRecord(
            id=new_id(),
            project_id=project.id,
            schema_version="1.0.0",
            captured_entity_refs_json=captured_refs,
            summary=summary_text[:50000],
        )
        self._session.add(snapshot)
        self._session.flush()

        structured = {
            "project_id": project.id,
            "project_name": project.name,
            "structure_count": len(structures),
            "calculation_count": len(calc_rows),
            "document_count": len(docs_output.documents),
            "dataset_count": len(datasets_output.datasets) + len(spectra),
            "scientific_claim_count": len(claim_records),
            "structure_figure_candidate_count": structure_figure_candidate_count,
            "structure_visualization_available": bool(structures),
            "project_context": ProjectContext(
                project=_freeze({"id": project.id, "name": project.name}),
                structures=tuple(_freeze(row) for row in structure_records),
                candidates=tuple(_freeze(row) for row in candidate_records),
                calculations=tuple(_freeze(row) for row in calculation_records),
                documents=tuple(
                    _freeze(
                        {
                            "id": str(d.id),
                            "title": d.title,
                            "doi": d.doi,
                            "publication_year": d.publication_year,
                            "page_count": d.page_count,
                        }
                    )
                    for d in docs_output.documents
                ),
                datasets=tuple(
                    _freeze(
                        {
                            "id": str(ds.id),
                            "name": ds.name,
                            "modality": str(ds.modality),
                            "state": ds.state,
                            "point_count": ds.point_count,
                            "source_class": str(ds.source_class),
                            "axes": [axis.model_dump(mode="json") for axis in ds.axes],
                            "values": list(ds.values),
                            "digitization_session": (
                                ds.digitization_session.model_dump(mode="json")
                                if ds.digitization_session is not None
                                else None
                            ),
                        }
                    )
                    for ds in datasets_output.datasets
                )
                + tuple(_freeze(dataset_record(item)) for item in spectra),
                claims=tuple(_freeze(row) for row in claim_records),
                claim_relations=tuple(
                    _freeze(relation.model_dump(mode="json"))
                    for relation in claims_output.relations
                ),
                comparison_rows=tuple(_freeze(row) for row in comparison_records),
                notes=tuple(_freeze(row) for row in note_records),
                provenance=tuple(
                    _freeze(
                        {
                            "id": row.id,
                            "subject_type": row.subject_type,
                            "subject_id": row.subject_id,
                            "source_class": row.source_class,
                            "verification_state": row.verification_state,
                            "operation": row.operation,
                            "created_at": row.created_at.isoformat(),
                        }
                    )
                    for row in provenance_rows
                ),
                history=tuple(
                    _freeze(
                        {
                            "id": row.id,
                            "event": row.event_name,
                            "occurred_at": row.occurred_at.isoformat(),
                            "targets": [
                                target
                                for target in row.targets_json
                                if isinstance(target, dict)
                                and target.get("project_id") == project.id
                            ],
                        }
                    )
                    for row in history_rows
                ),
                current_view=_freeze(
                    {
                        "label": view_label,
                        "selected_structure_id": selected_structure_id,
                        "selected_structure_version_id": selected_structure_version_id,
                        "selected_document_id": selected_document_id,
                    }
                ),
            ),
        }

        return ProjectContextBundle(
            snapshot_id=snapshot.id,
            summary_text=summary_text,
            structured_context=structured,
        )
