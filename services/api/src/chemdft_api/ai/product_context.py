"""Bounded server ProductContext, separate from legacy deterministic inspection graphs."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, defer

from ..actions import authorize_project_access
from ..config import Settings
from ..context import Identity, ServiceIdentity
from ..contracts.ai_foundation import (
    ProductBlocked,
    ProductContext,
    ProductNavigator,
    ProductResource,
    ProductSelection,
)
from ..contracts.provenance import ProvenanceClass, VerificationState
from ..errors import ProjectAccessDenied
from ..example_models import ExampleTemplate, ProjectExampleOrigin
from ..models import ProjectKind, utc_now
from ..navigator.service import get_navigator
from ..project_access import ProjectCapability, can
from ..scientific_models import (
    CalculationInputRecord,
    CalculationResultRecord,
    ExperimentalDatasetRecord,
    ImportedResultRecord,
    ProvenanceRecordRow,
    ScientificDocumentRecord,
    SpectrumConfirmationRecord,
    StructureRecord,
    StructureVersionRecord,
)
from .id_grounding import GROUNDING_POLICY, IdGrounding
from .providers import AIFoundationError, AIProviderService
from .tool_policy import tool_policies


class ProductContextBuilder:
    def __init__(self, session: Session, identity: Identity, settings: Settings, registry) -> None:
        self.session, self.identity, self.settings, self.registry = (
            session,
            identity,
            settings,
            registry,
        )

    def _selected(self, model, identifier: UUID | str | None, project_id: str):
        if identifier is None:
            return None
        query = select(model).where(model.id == str(identifier), model.project_id == project_id)
        if model is ImportedResultRecord:
            query = query.options(defer(ImportedResultRecord.payload_json))
        if model is ExperimentalDatasetRecord:
            query = query.options(
                defer(ExperimentalDatasetRecord.values_json),
                defer(ExperimentalDatasetRecord.axes_json),
                defer(ExperimentalDatasetRecord.spectrum_json),
            )
        if model is StructureVersionRecord:
            query = query.options(defer(StructureVersionRecord.representation_json))
        row = self.session.scalar(query)
        if row is None:
            raise AIFoundationError(
                "STALE_SELECTION", "The selected resource is unavailable in this project.", 409
            )
        return row

    def build(self, project_id: str, hints: ProductSelection | None = None) -> ProductContext:
        if isinstance(self.identity, ServiceIdentity):
            raise ProjectAccessDenied("ProductContext requires a human project membership.")
        hints = hints or ProductSelection()
        project, member = authorize_project_access(self.session, self.identity, project_id)
        structure = self._selected(StructureRecord, hints.selected_structure_id, project_id)
        version = self._selected(
            StructureVersionRecord, hints.selected_structure_version_id, project_id
        )
        if version and structure and version.structure_id != structure.id:
            raise AIFoundationError(
                "STALE_SELECTION", "The selected version does not belong to the selected structure."
            )
        if structure and version is None:
            version = self.session.scalar(
                select(StructureVersionRecord)
                .where(
                    StructureVersionRecord.project_id == project_id,
                    StructureVersionRecord.structure_id == structure.id,
                )
                .order_by(StructureVersionRecord.revision.desc())
                .limit(1)
            )
        selected_result = None
        if hints.selected_result_id:
            selected_result = self.session.scalar(
                select(CalculationResultRecord)
                .where(
                    CalculationResultRecord.id == str(hints.selected_result_id),
                    CalculationResultRecord.project_id == project_id,
                )
                .options(defer(CalculationResultRecord.payload_json))
            )
            if selected_result is None:
                selected_result = self._selected(
                    ImportedResultRecord, hints.selected_result_id, project_id
                )
        if isinstance(selected_result, CalculationResultRecord):
            inp = self._selected(
                CalculationInputRecord, selected_result.calculation_input_id, project_id
            )
            if version and inp.structure_version_id != version.id:
                raise AIFoundationError(
                    "STALE_SELECTION", "Selected result and structure version do not match."
                )
            version = self._selected(StructureVersionRecord, inp.structure_version_id, project_id)
            if structure and version.structure_id != structure.id:
                raise AIFoundationError(
                    "STALE_SELECTION", "Selected result and structure do not match."
                )
        doc = self._selected(ScientificDocumentRecord, hints.selected_document_id, project_id)
        spectrum = self._selected(ExperimentalDatasetRecord, hints.selected_spectrum_id, project_id)
        state = get_navigator(
            self.session,
            self.identity,
            project_id,
            self.settings,
            goal=hints.goal,
            structure_version_id=version.id if version else None,
        )
        if version is None and state.facts_summary.structure_version_id:
            version = self._selected(
                StructureVersionRecord, state.facts_summary.structure_version_id, project_id
            )
        if version and hints.selected_structure_id is None:
            structure = self._selected(StructureRecord, version.structure_id, project_id)
        if isinstance(selected_result, CalculationResultRecord):
            inp = self._selected(
                CalculationInputRecord, selected_result.calculation_input_id, project_id
            )
            if hints.selected_structure_version_id and inp.structure_version_id != str(
                hints.selected_structure_version_id
            ):
                raise AIFoundationError(
                    "STALE_SELECTION", "Selected result and structure version do not match."
                )
        selection = hints.model_copy(
            update={
                "selected_structure_id": UUID(structure.id) if structure else None,
                "selected_structure_version_id": UUID(version.id) if version else None,
            }
        )
        grounding = IdGrounding(self.session, self.identity)
        grounded, grounding_facts, grounding_notes = grounding.resolve(project_id, hints)
        selection = selection.model_copy(update=grounded)
        resources = []
        template = self.session.get(ExampleTemplate, project_id)
        origin = self.session.get(ProjectExampleOrigin, project_id)
        if version:
            p = self.session.get(ProvenanceRecordRow, version.provenance_record_id)
            resources.append(
                ProductResource(
                    entity_type="structure.version",
                    entity_id=UUID(version.id),
                    source_class=p.source_class if p else ProvenanceClass.USER_SUPPLIED,
                    verification_state=p.verification_state if p else VerificationState.UNVERIFIED,
                    reference_structure=bool(
                        template or (origin and version.id in origin.record_mapping_json.values())
                    ),
                    provenance_id=UUID(p.id) if p else None,
                    artifact_id=UUID(version.source_artifact_id),
                    structure_version_id=UUID(version.id),
                    label=f"Structure v{version.revision}",
                    scalar_summary={
                        "atoms": version.atom_count,
                        "origin": version.origin,
                        "charge": version.overall_charge,
                        "multiplicity": version.multiplicity,
                        "has_unit_cell": bool(version.periodic_cell_json),
                    },
                )
            )
        results = (
            [selected_result]
            if selected_result
            else list(
                self.session.scalars(
                    select(CalculationResultRecord)
                    .where(CalculationResultRecord.project_id == project_id)
                    .order_by(CalculationResultRecord.created_at.desc(), CalculationResultRecord.id)
                    .limit(3)
                    .options(defer(CalculationResultRecord.payload_json))
                ).all()
            )
        )
        for result in results:
            imported = isinstance(result, ImportedResultRecord)
            provenance = self.session.get(ProvenanceRecordRow, result.provenance_record_id)
            from ..effective_result_state import effective_result_state
            effective = None if imported else effective_result_state(self.session, result)
            summary = {
                "validation_state": effective.validation_state
                if effective
                else result.validation_state
            }
            if effective:
                summary["source_lineage_validity"] = effective.source_lineage_validity
                summary["eligible_for_derivation"] = effective.eligible_for_derivation
            if not imported:
                from ..scientific_models import CalculationRecord

                calculation = self.session.get(CalculationRecord, result.calculation_id)
                summary["calculation_state"] = calculation.state
                convergence = self.session.scalar(
                    select(CalculationResultRecord.payload_json["converged"].as_boolean()).where(
                        CalculationResultRecord.id == result.id
                    )
                )
                summary["converged"] = convergence if isinstance(convergence, bool) else None
            # Extract a bounded scalar in SQL; never send mode arrays, grids or coordinates.
            energy = self.session.scalar(
                select(type(result).payload_json["total_energy"]).where(
                    type(result).id == result.id
                )
            )
            if isinstance(energy, dict) and isinstance(energy.get("value"), (float, int)):
                summary["total_energy"] = energy["value"]
                unit = energy.get("unit")
                summary["energy_unit"] = (
                    str(unit.get("code", ""))[:40] if isinstance(unit, dict) else str(unit)[:40]
                )
            inp = (
                self.session.get(CalculationInputRecord, result.calculation_input_id)
                if not imported
                else None
            )
            resources.append(
                ProductResource(
                    entity_type="imported.result" if imported else "calculation.result",
                    entity_id=UUID(result.id),
                    source_class=result.source_class,
                    verification_state=result.verification_state,
                    authority=effective.authority if effective else result.authority,
                    authoritative_calculation=not imported
                    and effective.eligible_for_derivation
                    and result.authority == "AUTHORITATIVE"
                    and result.source_class == "CALCULATED"
                    and result.validation_state == "VALIDATED"
                    and summary.get("calculation_state") == "SUCCEEDED",
                    provenance_id=UUID(result.provenance_record_id),
                    artifact_id=UUID(provenance.source_artifact_id)
                    if provenance and provenance.source_artifact_id
                    else None,
                    sha256=result.payload_sha256 if imported else None,
                    calculation_id=UUID(result.calculation_id) if not imported else None,
                    structure_version_id=UUID(inp.structure_version_id) if inp else None,
                    label=result.result_type[:160],
                    scalar_summary=summary,
                )
            )
        if doc:
            resources.append(
                ProductResource(
                    entity_type="document",
                    entity_id=UUID(doc.id),
                    source_class="EXTRACTED",
                    verification_state="UNVERIFIED",
                    artifact_id=UUID(doc.raw_artifact_id),
                    sha256=doc.sha256,
                    label=(doc.title or "Scientific document")[:160],
                    scalar_summary={"pages": doc.page_count},
                )
            )
        if spectrum:
            confirmed = self.session.scalar(
                select(SpectrumConfirmationRecord.id)
                .where(
                    SpectrumConfirmationRecord.project_id == project_id,
                    SpectrumConfirmationRecord.dataset_id == spectrum.id,
                )
                .limit(1)
            )
            provenance = self.session.scalar(
                select(ProvenanceRecordRow)
                .where(
                    ProvenanceRecordRow.project_id == project_id,
                    ProvenanceRecordRow.subject_id == spectrum.id,
                )
                .order_by(ProvenanceRecordRow.created_at.desc())
                .limit(1)
            )
            resources.append(
                ProductResource(
                    entity_type="experimental.dataset",
                    entity_id=UUID(spectrum.id),
                    source_class=spectrum.source_class,
                    verification_state="VERIFIED" if confirmed else "UNVERIFIED",
                    artifact_id=UUID(spectrum.artifact_id),
                    provenance_id=UUID(provenance.id) if provenance else None,
                    label="Experimental dataset",
                    scalar_summary={"state": spectrum.state, "point_count": spectrum.point_count},
                )
            )
        writable = can(member, ProjectCapability.WRITE)
        product = ProductContext(
            human_id=UUID(self.identity.user_id),
            organization_id=UUID(self.identity.organization_id),
            project_id=UUID(project.id),
            project_name=project.name,
            project_kind=project.kind,
            role=member.role,
            can_write=writable,
            sealed=project.kind == ProjectKind.EXAMPLE_TEMPLATE,
            published_example=bool(template and template.published),
            example_slug=template.slug if template else origin.example_slug if origin else None,
            view_hint=hints.current_view,
            selection=selection,
            navigator=ProductNavigator(
                goal=state.goal,
                have=tuple(h.state_id for h in state.have),
                next=tuple(a.action_id for a in state.next),
                blocked=tuple(
                    ProductBlocked(action_id=a.action_id, reasons=tuple(r.code for r in a.reasons))
                    for a in state.blocked
                ),
                notices=state.notices,
            ),
            resources=tuple(resources),
            ai=AIProviderService(self.session, self.identity, self.settings).availability(),
            allowed_tools=tool_policies(self.registry, can_write=writable),
            grounding_policy=GROUNDING_POLICY if grounding_facts or grounding_notes else None,
            grounding_facts=grounding_facts,
            grounding_notes=grounding_notes,
            generated_at=utc_now(),
        )
        if len(product.model_dump_json().encode()) > 32768:
            raise AIFoundationError(
                "CONTEXT_LIMIT",
                "ProductContext exceeded its safe size limit; use scoped read tools.",
            )
        return product
