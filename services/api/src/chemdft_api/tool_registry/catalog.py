from collections.abc import Callable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..actions import create_project, get_project, list_projects
from ..calculation_actions import cancel_calculation, get_calculation, submit_calculation
from ..candidate_representation_actions import (
    list_candidate_representations,
    validate_candidate_graph,
)
from ..compute_gateway import LOCAL_PROVIDER, default_requirement, estimate_for_requirement
from ..config import Settings
from ..contracts.ai import (
    CalculationCancelInput,
    ComputeEstimateInput,
    ComputeEstimateOutput,
    DatasetGetInput,
    DocumentEvidenceListInput,
    DocumentEvidenceListOutput,
    DocumentGetInput,
    DocumentListInput,
    ExperimentListInput,
    StructureGetInput,
    StructureListInput,
    StructureListOutput,
    StructureVersionGetInput,
)
from ..contracts.catalog import (
    CalculationDetail,
    CalculationGetInput,
    CalculationSubmitInput,
    ProjectCreateInput,
    ProjectGetInput,
    ProjectListInput,
    ProjectListOutput,
    ProjectSummary,
    StructureSummary,
    StructureVersionCreateInput,
    StructureVersionCreateOutput,
    StructureVersionDetail,
)
from ..contracts.investigations import InvestigationGetInput, InvestigationView
from ..contracts.knowledge import KnowledgeSearchInput, KnowledgeSearchOutput
from ..contracts.phase7 import (
    ExperimentalDatasetListOutput,
    ExperimentalDatasetView,
    ScientificDocumentImportOutput,
    ScientificDocumentListOutput,
)
from ..contracts.structure_candidates import (
    CandidateRepresentationListInput,
    CandidateRepresentationListOutput,
    CandidateRepresentationType,
    DocumentFiguresExtractInput,
    DocumentFiguresExtractOutput,
    MolecularGraphValidateInput,
    MolecularGraphValidateOutput,
    StructureCandidate,
    StructureCandidateGetInput,
    StructureCandidateListInput,
    StructureCandidateListOutput,
    StructureCandidateRecognizeInput,
    StructureCandidateRecognizeOutput,
    StructureCandidateRequestReviewInput,
    StructureCandidateRequestReviewOutput,
    StructureCandidateState,
    StructureCandidateValidateGraphInput,
)
from ..contracts.structure_tools import (
    StructureEditProposeInput,
    StructureEditProposeOutput,
)
from ..contracts.tools import (
    ApprovalPolicy,
    AuthoritativeFieldPolicy,
    IdempotencyBehavior,
    PermissionClass,
    SemanticVersion,
    SideEffectClass,
    ToolAvailability,
    ToolDefinition,
    ToolErrorCode,
)
from ..errors import RecognitionEngineUnavailable, ScientificReferenceNotFound
from ..investigation_service import InvestigationService
from ..knowledge.service import KnowledgeService
from ..models import new_id
from ..phase7_actions import (
    _candidate,
    _dataset_view,
    get_document,
    list_documents,
    list_experimental_datasets,
)
from ..schemas import ProjectCreate
from ..scientific.molecular_recognition.engine import DECIMER_ENGINE_NAMES, DEVELOPMENT_ENGINE_NAMES
from ..scientific_actions import (
    create_structure_version,
    get_structure_version_detail,
    list_structures,
)
from ..scientific_models import (
    CandidateRepresentationRecord,
    DocumentSourceAnchorRecord,
    EvidenceCandidateRecord,
    ExperimentalDatasetRecord,
    ExperimentRecord,
    ScientificArtifactRecord,
    StructureCandidateRecord,
)
from ..storage import ObjectStore
from ..structure_candidate_actions import (
    extract_document_figure_candidates,
    get_structure_candidate,
    list_structure_candidates,
    recognize_candidate_figure_once,
)
from .audit import SqlAlchemyToolAuditSink
from .registry import RegisteredTool, ToolInvocationContext, ToolInvocationError, ToolRegistry


def _definition(
    *,
    name: str,
    description: str,
    input_schema: str,
    output_schema: str,
    permission: PermissionClass,
    side_effect: SideEffectClass,
    availability: ToolAvailability,
    capability: str,
    idempotency: IdempotencyBehavior,
    authoritative_policy: AuthoritativeFieldPolicy = AuthoritativeFieldPolicy.NONE,
) -> ToolDefinition:
    return ToolDefinition(
        name=name,
        version=SemanticVersion(major=1, minor=0, patch=0),
        description=description,
        input_schema_ref=input_schema,
        output_schema_ref=output_schema,
        permission_class=permission,
        required_capabilities=(capability,),
        cost_class=(
            "scientific.expensive" if permission is PermissionClass.EXPENSIVE else "platform.low"
        ),
        risk_class=(
            "destructive"
            if permission is PermissionClass.DESTRUCTIVE_EXTERNAL
            else ("controlled" if permission is PermissionClass.EXPENSIVE else "standard")
        ),
        approval_policy=(
            ApprovalPolicy.POLICY_DEPENDENT
            if permission is PermissionClass.EXPENSIVE
            else ApprovalPolicy.NONE
        ),
        side_effect=side_effect,
        reversible=side_effect
        in {
            SideEffectClass.PURE,
            SideEffectClass.READ_ONLY,
            SideEffectClass.MUTATING_REVERSIBLE,
        },
        idempotency=idempotency,
        provenance_obligations=(),
        authoritative_field_policy=authoritative_policy,
        availability=availability,
        tags=(name.split(".", 1)[0] + ".tool",),
        error_codes=(
            ToolErrorCode.VALIDATION_ERROR,
            ToolErrorCode.NOT_FOUND,
            ToolErrorCode.FORBIDDEN,
            ToolErrorCode.CONFLICT,
            ToolErrorCode.INTERNAL_ERROR,
        ),
    )


def _project_summary(value: object) -> ProjectSummary:
    return ProjectSummary.model_validate(value, from_attributes=True)


def _project_tools(session: Session) -> tuple[RegisteredTool, ...]:
    def handle_list(context: ToolInvocationContext, _input: ProjectListInput) -> ProjectListOutput:
        projects = list_projects(session, context.identity)
        return ProjectListOutput(projects=tuple(_project_summary(project) for project in projects))

    def handle_get(context: ToolInvocationContext, payload: ProjectGetInput) -> ProjectSummary:
        return _project_summary(get_project(session, context.identity, str(payload.project_id)))

    def handle_create(
        context: ToolInvocationContext, payload: ProjectCreateInput
    ) -> ProjectSummary:
        created = create_project(
            session,
            context.identity,
            ProjectCreate(name=payload.name, slug=payload.slug),
        )
        return _project_summary(created)

    return (
        RegisteredTool(
            definition=_definition(
                name="project.list",
                description="List projects visible to the authenticated actor.",
                input_schema="chemdft.project-list-input.v1",
                output_schema="chemdft.project-list-output.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="project.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=ProjectListInput,
            output_model=ProjectListOutput,
            handler=handle_list,
        ),
        RegisteredTool(
            definition=_definition(
                name="project.get",
                description="Open one project visible to the authenticated actor.",
                input_schema="chemdft.project-get-input.v1",
                output_schema="chemdft.project-summary.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="project.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=ProjectGetInput,
            output_model=ProjectSummary,
            handler=handle_get,
        ),
        RegisteredTool(
            definition=_definition(
                name="project.create",
                description="Create a project for the authenticated organization and actor.",
                input_schema="chemdft.project-create-input.v1",
                output_schema="chemdft.project-summary.v1",
                permission=PermissionClass.LOW_COST_REVERSIBLE,
                side_effect=SideEffectClass.MUTATING_REVERSIBLE,
                availability=ToolAvailability.EXECUTABLE,
                capability="project.create",
                idempotency=IdempotencyBehavior.NOT_IDEMPOTENT,
            ),
            input_model=ProjectCreateInput,
            output_model=ProjectSummary,
            handler=handle_create,
        ),
    )


def _structure_tools(session: Session) -> tuple[RegisteredTool, ...]:
    def handle_version_create(
        context: ToolInvocationContext,
        payload: StructureVersionCreateInput,
    ) -> StructureVersionCreateOutput:
        return create_structure_version(session, context.identity, payload)

    return (
        RegisteredTool(
            definition=_definition(
                name="structure.version.create",
                description="Create a new immutable manually edited structure version.",
                input_schema="chemdft.structure-version-create-input.v1",
                output_schema="chemdft.structure-version-create-output.v1",
                permission=PermissionClass.LOW_COST_REVERSIBLE,
                side_effect=SideEffectClass.MUTATING_REVERSIBLE,
                availability=ToolAvailability.EXECUTABLE,
                capability="structure.write",
                idempotency=IdempotencyBehavior.KEY_OPTIONAL,
                authoritative_policy=AuthoritativeFieldPolicy.SERVER_OWNED,
            ),
            input_model=StructureVersionCreateInput,
            output_model=StructureVersionCreateOutput,
            handler=handle_version_create,
        ),
    )


def _structure_edit_tools(
    session: Session,
    object_store: ObjectStore | None = None,
) -> tuple[RegisteredTool, ...]:
    def handle_structure_edit_propose(
        context: ToolInvocationContext,
        payload: StructureEditProposeInput,
    ) -> StructureEditProposeOutput:
        from ..ai.structure_edit import apply_structure_edit_version

        if object_store is None:
            raise ScientificReferenceNotFound("Object store is required for structure edits.")
        return apply_structure_edit_version(
            session,
            object_store,
            context.identity,
            payload,
            approval_references=context.approval_references,
        )

    return (
        RegisteredTool(
            definition=_definition(
                name="structure.edit.propose",
                description=(
                    "Propose a sequence of atomic edits on a structure version for approval. "
                    "Creates a new version upon approval; leaves parent version immutable."
                ),
                input_schema="chemdft.structure-edit-propose-input.v1",
                output_schema="chemdft.structure-edit-propose-output.v1",
                permission=PermissionClass.LOW_COST_REVERSIBLE,
                side_effect=SideEffectClass.MUTATING_REVERSIBLE,
                availability=ToolAvailability.EXECUTABLE,
                capability="structure.write",
                idempotency=IdempotencyBehavior.KEY_OPTIONAL,
                authoritative_policy=AuthoritativeFieldPolicy.SERVER_OWNED,
            ),
            input_model=StructureEditProposeInput,
            output_model=StructureEditProposeOutput,
            handler=handle_structure_edit_propose,
        ),
    )


def _future_definitions() -> tuple[ToolDefinition, ...]:
    future: tuple[tuple[str, str, str, str, PermissionClass, SideEffectClass, str], ...] = (
        (
            "calculation.submit",
            "Submit an engine-neutral calculation specification in a future compute phase.",
            "chemdft.calculation-submit-input.v1",
            "chemdft.calculation.v1",
            PermissionClass.EXPENSIVE,
            SideEffectClass.DURABLE_JOB,
            "calculation.submit",
        ),
        (
            "calculation.get",
            "Read a calculation record when calculation actions become available.",
            "chemdft.calculation-get-input.v1",
            "chemdft.calculation.v1",
            PermissionClass.READ,
            SideEffectClass.READ_ONLY,
            "calculation.read",
        ),
        (
            "result.compare",
            "Create a deterministic comparison in a future scientific analysis phase.",
            "chemdft.result-compare-input.v1",
            "chemdft.result-comparison.v1",
            PermissionClass.LOW_COST_REVERSIBLE,
            SideEffectClass.MUTATING_REVERSIBLE,
            "result.compare",
        ),
        (
            "experiment.dataset.import",
            "Import an immutable dataset through a future validated modality pipeline.",
            "chemdft.experiment-dataset-import-input.v1",
            "chemdft.experimental-dataset.v1",
            PermissionClass.LOW_COST_REVERSIBLE,
            SideEffectClass.MUTATING_REVERSIBLE,
            "experiment.write",
        ),
        (
            "visualization.scene.get",
            "Read a future deterministic scientific visualization scene.",
            "chemdft.visualization-scene-get-input.v1",
            "chemdft.scientific-scene.v1",
            PermissionClass.READ,
            SideEffectClass.READ_ONLY,
            "visualization.read",
        ),
    )
    return tuple(
        _definition(
            name=name,
            description=description,
            input_schema=input_schema,
            output_schema=output_schema,
            permission=permission,
            side_effect=side_effect,
            availability=ToolAvailability.FUTURE,
            capability=capability,
            idempotency=(
                IdempotencyBehavior.KEY_REQUIRED
                if side_effect is SideEffectClass.DURABLE_JOB
                else (
                    IdempotencyBehavior.NATURAL
                    if side_effect is SideEffectClass.READ_ONLY
                    else IdempotencyBehavior.KEY_OPTIONAL
                )
            ),
            authoritative_policy=AuthoritativeFieldPolicy.NONE,
        )
        for (
            name,
            description,
            input_schema,
            output_schema,
            permission,
            side_effect,
            capability,
        ) in future
    )


def build_phase_2_registry(
    session: Session,
    audit_sink_factory: Callable[[Session], SqlAlchemyToolAuditSink] = SqlAlchemyToolAuditSink,
) -> ToolRegistry:
    registry = ToolRegistry(audit_sink_factory(session))
    for tool in _project_tools(session):
        registry.register(tool)
    for tool in _structure_tools(session):
        registry.register(tool)
    for definition in _future_definitions():
        registry.declare(definition)
    return registry


def _structure_read_tools(
    session: Session,
    object_store: ObjectStore | None = None,
    settings: Settings | None = None,
) -> tuple[RegisteredTool, ...]:
    def handle_structure_list(
        context: ToolInvocationContext, _payload: StructureListInput
    ) -> StructureListOutput:
        project_id = str(context.project_id)
        structures = list_structures(session, context.identity, project_id)
        return StructureListOutput(structures=tuple(structures))

    def handle_structure_get(
        context: ToolInvocationContext, payload: StructureGetInput
    ) -> StructureSummary:
        project_id = str(context.project_id)
        structures = list_structures(session, context.identity, project_id)
        for s in structures:
            if s.id == payload.structure_id:
                return s
        raise ScientificReferenceNotFound("Structure does not exist.")

    def handle_version_get(
        context: ToolInvocationContext, payload: StructureVersionGetInput
    ) -> StructureVersionDetail:
        project_id = str(context.project_id)
        return get_structure_version_detail(
            session,
            context.identity,
            project_id,
            str(payload.structure_id),
            str(payload.version_id),
        )

    def handle_candidate_list(
        context: ToolInvocationContext, _payload: StructureCandidateListInput
    ) -> StructureCandidateListOutput:
        return list_structure_candidates(session, context.identity, str(context.project_id))

    def handle_candidate_get(
        context: ToolInvocationContext, payload: StructureCandidateGetInput
    ) -> StructureCandidate:
        return get_structure_candidate(
            session,
            context.identity,
            str(context.project_id),
            str(payload.candidate_id),
        )

    def handle_candidate_representation_list(
        context: ToolInvocationContext, payload: CandidateRepresentationListInput
    ) -> CandidateRepresentationListOutput:
        return list_candidate_representations(
            session,
            context.identity,
            str(context.project_id),
            str(payload.candidate_id),
        )

    def handle_candidate_recognize(
        context: ToolInvocationContext, payload: StructureCandidateRecognizeInput
    ) -> StructureCandidateRecognizeOutput:
        pref = (payload.engine_preference or "").lower()
        if pref in DEVELOPMENT_ENGINE_NAMES or (
            pref and pref not in {name.lower() for name in DECIMER_ENGINE_NAMES}
        ):
            raise ToolInvocationError(
                ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
                "Development recognition engine is not permitted in autonomous "
                "scientific workflows; only real DECIMER inference is permitted.",
            )
        if object_store is None or settings is None:
            raise ToolInvocationError(
                ToolErrorCode.INTERNAL_ERROR,
                "ObjectStore or Settings unavailable for molecular diagram recognition.",
            )
        try:
            outcome = recognize_candidate_figure_once(
                session,
                context.identity,
                str(context.project_id),
                str(payload.candidate_id),
                object_store,
                settings,
                category_hint=payload.category_hint,
            )
        except RecognitionEngineUnavailable as error:
            raise ToolInvocationError(
                ToolErrorCode.CAPABILITY_UNAVAILABLE,
                f"Molecular recognition engine is currently busy or unavailable: {error.detail}",
            ) from error
        proposal = outcome.proposal
        return StructureCandidateRecognizeOutput(
            candidate=outcome.candidate,
            status=str(proposal.get("status")),
            canonical_isomeric_smiles=proposal.get("canonical_isomeric_smiles"),
            formula=proposal.get("formula"),
            proposal=proposal,
            representation_id=UUID(outcome.representation_id)
            if outcome.representation_id
            else None,
            reused=outcome.reused,
        )

    def handle_candidate_validate_graph(
        context: ToolInvocationContext, payload: StructureCandidateValidateGraphInput
    ) -> MolecularGraphValidateOutput:
        project_id = str(context.project_id)
        input_val = MolecularGraphValidateInput(
            content=payload.content,
            format=payload.format,
            parent_representation_id=payload.parent_representation_id,
        )
        return validate_candidate_graph(
            session, context.identity, project_id, str(payload.candidate_id), input_val
        )

    def handle_candidate_request_review(
        context: ToolInvocationContext, payload: StructureCandidateRequestReviewInput
    ) -> StructureCandidateRequestReviewOutput:
        project_id = str(context.project_id)
        cand = session.scalar(
            select(StructureCandidateRecord).where(
                StructureCandidateRecord.id == str(payload.candidate_id),
                StructureCandidateRecord.project_id == project_id,
            )
        )
        if cand is None:
            raise ToolInvocationError(ToolErrorCode.NOT_FOUND, "Structure candidate not found.")
        if cand.candidate_state == StructureCandidateState.PROMOTED.value:
            raise ToolInvocationError(
                ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
                "Candidate has already been promoted to an authoritative structure version.",
            )
        if cand.candidate_state == StructureCandidateState.REJECTED.value:
            raise ToolInvocationError(
                ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
                "Candidate was rejected by a researcher; it cannot be put forward for review.",
            )
        reps = select(CandidateRepresentationRecord).where(
            CandidateRepresentationRecord.candidate_id == cand.id,
            CandidateRepresentationRecord.project_id == project_id,
            CandidateRepresentationRecord.representation_type
            != CandidateRepresentationType.IMAGE_REFERENCE.value,
        )
        if payload.expected_representation_id:
            rep = session.scalar(
                reps.where(
                    CandidateRepresentationRecord.id == str(payload.expected_representation_id)
                )
            )
            if rep is None:
                raise ToolInvocationError(
                    ToolErrorCode.NOT_FOUND,
                    "Expected representation not found on candidate (or is only the source image).",
                )
        else:
            # The reviewed object is the chemical graph (SMILES); its 2D drawing and every 3D
            # conformer a researcher derives from it share its lineage.
            rep = session.scalar(
                reps.where(
                    CandidateRepresentationRecord.representation_type
                    == CandidateRepresentationType.SMILES.value
                ).order_by(CandidateRepresentationRecord.revision.desc())
            ) or session.scalar(reps.order_by(CandidateRepresentationRecord.revision.desc()))
            if rep is None:
                raise ToolInvocationError(
                    ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
                    "Candidate has no reconstructed molecular representation to review; "
                    "run recognition first.",
                )
        rep_id = UUID(rep.id)

        return StructureCandidateRequestReviewOutput(
            gate_status="WAITING_FOR_RESEARCHER_REVIEW",
            run_id=None,
            project_id=UUID(project_id),
            candidate_id=UUID(cand.id),
            expected_representation_id=rep_id,
            source_document_id=UUID(cand.source_document_id) if cand.source_document_id else None,
            review_reason=payload.review_reason,
        )

    return (
        RegisteredTool(
            definition=_definition(
                name="structure.list",
                description="List structures in the current project.",
                input_schema="chemdft.structure-list-input.v1",
                output_schema="chemdft.structure-list-output.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="structure.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=StructureListInput,
            output_model=StructureListOutput,
            handler=handle_structure_list,
        ),
        RegisteredTool(
            definition=_definition(
                name="structure.get",
                description="Get summary details for one structure by ID.",
                input_schema="chemdft.structure-get-input.v1",
                output_schema="chemdft.structure-summary.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="structure.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=StructureGetInput,
            output_model=StructureSummary,
            handler=handle_structure_get,
        ),
        RegisteredTool(
            definition=_definition(
                name="structure.version.get",
                description="Get detailed information for a specific structure version.",
                input_schema="chemdft.structure-version-get-input.v1",
                output_schema="chemdft.structure-version-detail.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="structure.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=StructureVersionGetInput,
            output_model=StructureVersionDetail,
            handler=handle_version_get,
        ),
        RegisteredTool(
            definition=_definition(
                name="structure_candidate.list",
                description=(
                    "List non-authoritative structure candidates detected in the current project. "
                    "Candidates are not usable for calculations until explicitly promoted."
                ),
                input_schema="chemdft.structure-candidate-list-input.v1",
                output_schema="chemdft.structure-candidate-list-output.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="structure_candidate.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=StructureCandidateListInput,
            output_model=StructureCandidateListOutput,
            handler=handle_candidate_list,
        ),
        RegisteredTool(
            definition=_definition(
                name="structure_candidate.get",
                description=(
                    "Get source-linked details for one non-authoritative candidate; no coordinates "
                    "are implied unless an explicit representation is present."
                ),
                input_schema="chemdft.structure-candidate-get-input.v1",
                output_schema="chemdft.structure-candidate.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="structure_candidate.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=StructureCandidateGetInput,
            output_model=StructureCandidate,
            handler=handle_candidate_get,
        ),
        RegisteredTool(
            definition=_definition(
                name="structure_candidate.representation.list",
                description=(
                    "List source-linked, non-authoritative representations for a candidate. "
                    "This is read-only and never promotes a representation."
                ),
                input_schema="chemdft.structure-candidate-representation-list-input.v1",
                output_schema="chemdft.structure-candidate-representation-list-output.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="structure_candidate.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=CandidateRepresentationListInput,
            output_model=CandidateRepresentationListOutput,
            handler=handle_candidate_representation_list,
        ),
        RegisteredTool(
            definition=_definition(
                name="structure_candidate.recognize",
                description=(
                    "Execute molecular diagram recognition on an extracted figure candidate "
                    "using real DECIMER only."
                ),
                input_schema="chemdft.structure-candidate-recognize-input.v1",
                output_schema="chemdft.structure-candidate-recognize-output.v1",
                permission=PermissionClass.LOW_COST_REVERSIBLE,
                side_effect=SideEffectClass.MUTATING_REVERSIBLE,
                availability=ToolAvailability.EXECUTABLE,
                capability="structure_candidate.write",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=StructureCandidateRecognizeInput,
            output_model=StructureCandidateRecognizeOutput,
            handler=handle_candidate_recognize,
        ),
        RegisteredTool(
            definition=_definition(
                name="structure_candidate.validate_graph",
                description=(
                    "Validate chemical graph syntax, valency, stereocenters, and differences "
                    "for a candidate."
                ),
                input_schema="chemdft.structure-candidate-validate-graph-input.v1",
                output_schema="chemdft.molecular-graph-validate-output.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="structure_candidate.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=StructureCandidateValidateGraphInput,
            output_model=MolecularGraphValidateOutput,
            handler=handle_candidate_validate_graph,
        ),
        RegisteredTool(
            definition=_definition(
                name="structure_candidate.request_review",
                description=(
                    "Request human researcher review and promotion for a structure candidate "
                    "before calculation planning."
                ),
                input_schema="chemdft.structure-candidate-request-review-input.v1",
                output_schema="chemdft.structure-candidate-request-review-output.v1",
                permission=PermissionClass.LOW_COST_REVERSIBLE,
                side_effect=SideEffectClass.MUTATING_REVERSIBLE,
                availability=ToolAvailability.EXECUTABLE,
                capability="structure_candidate.write",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=StructureCandidateRequestReviewInput,
            output_model=StructureCandidateRequestReviewOutput,
            handler=handle_candidate_request_review,
        ),
    )


def _document_tools(
    session: Session,
    object_store: ObjectStore | None = None,
    settings: Settings | None = None,
) -> tuple[RegisteredTool, ...]:
    def handle_doc_list(
        context: ToolInvocationContext, _payload: DocumentListInput
    ) -> ScientificDocumentListOutput:
        project_id = str(context.project_id)
        return list_documents(session, context.identity, project_id)

    def handle_doc_get(
        context: ToolInvocationContext, payload: DocumentGetInput
    ) -> ScientificDocumentImportOutput:
        project_id = str(context.project_id)
        return get_document(session, context.identity, project_id, str(payload.document_id))

    def handle_evidence_list(
        context: ToolInvocationContext, payload: DocumentEvidenceListInput
    ) -> DocumentEvidenceListOutput:
        project_id = str(context.project_id)
        stmt = select(EvidenceCandidateRecord).where(
            EvidenceCandidateRecord.project_id == project_id
        )
        if payload.document_id:
            stmt = stmt.where(EvidenceCandidateRecord.document_id == str(payload.document_id))
        candidates = session.scalars(stmt).all()
        views = tuple(
            _candidate(item, session.get(DocumentSourceAnchorRecord, item.anchor_id))
            for item in candidates
        )
        return DocumentEvidenceListOutput(evidence=views)

    def handle_figures_extract(
        context: ToolInvocationContext, payload: DocumentFiguresExtractInput
    ) -> DocumentFiguresExtractOutput:
        project_id = str(context.project_id)
        if object_store is None or settings is None:
            raise ToolInvocationError(
                ToolErrorCode.INTERNAL_ERROR,
                "ObjectStore or Settings unavailable for document figure extraction.",
            )
        candidates = extract_document_figure_candidates(
            session, context.identity, project_id, str(payload.document_id), object_store, settings
        )
        return DocumentFiguresExtractOutput(
            document_id=payload.document_id,
            candidates=tuple(candidates),
        )

    return (
        RegisteredTool(
            definition=_definition(
                name="document.list",
                description="List scientific documents uploaded to the project.",
                input_schema="chemdft.document-list-input.v1",
                output_schema="chemdft.scientific-document-list-output.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="document.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=DocumentListInput,
            output_model=ScientificDocumentListOutput,
            handler=handle_doc_list,
        ),
        RegisteredTool(
            definition=_definition(
                name="document.get",
                description="Get full document metadata and extracted evidence candidates.",
                input_schema="chemdft.document-get-input.v1",
                output_schema="chemdft.scientific-document-import-output.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="document.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=DocumentGetInput,
            output_model=ScientificDocumentImportOutput,
            handler=handle_doc_get,
        ),
        RegisteredTool(
            definition=_definition(
                name="document.evidence.list",
                description="List extracted evidence candidates across project documents.",
                input_schema="chemdft.document-evidence-list-input.v1",
                output_schema="chemdft.document-evidence-list-output.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="document.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=DocumentEvidenceListInput,
            output_model=DocumentEvidenceListOutput,
            handler=handle_evidence_list,
        ),
        RegisteredTool(
            definition=_definition(
                name="document.figures.extract",
                description=(
                    "Extract candidate molecular figures from a scientific document and "
                    "register unverified structure candidates."
                ),
                input_schema="chemdft.document-figures-extract-input.v1",
                output_schema="chemdft.document-figures-extract-output.v1",
                permission=PermissionClass.LOW_COST_REVERSIBLE,
                side_effect=SideEffectClass.MUTATING_REVERSIBLE,
                availability=ToolAvailability.EXECUTABLE,
                capability="document.write",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=DocumentFiguresExtractInput,
            output_model=DocumentFiguresExtractOutput,
            handler=handle_figures_extract,
        ),
    )


def _experiment_tools(session: Session) -> tuple[RegisteredTool, ...]:
    def handle_exp_list(
        context: ToolInvocationContext, _payload: ExperimentListInput
    ) -> ExperimentalDatasetListOutput:
        project_id = str(context.project_id)
        return list_experimental_datasets(session, context.identity, project_id)

    def handle_dataset_get(
        context: ToolInvocationContext, payload: DatasetGetInput
    ) -> ExperimentalDatasetView:
        project_id = str(context.project_id)
        row = session.scalar(
            select(ExperimentalDatasetRecord).where(
                ExperimentalDatasetRecord.id == str(payload.dataset_id),
                ExperimentalDatasetRecord.project_id == project_id,
            )
        )
        if row is None:
            raise ScientificReferenceNotFound("Dataset does not exist.")
        experiment = session.get(ExperimentRecord, row.experiment_id)
        artifact = session.get(ScientificArtifactRecord, row.artifact_id)
        if experiment is None or artifact is None:
            raise ScientificReferenceNotFound("Dataset metadata is missing.")
        return _dataset_view(row, experiment, artifact)

    return (
        RegisteredTool(
            definition=_definition(
                name="experiment.list",
                description="List experimental datasets imported into the project.",
                input_schema="chemdft.experiment-list-input.v1",
                output_schema="chemdft.experimental-dataset-list-output.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="experiment.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=ExperimentListInput,
            output_model=ExperimentalDatasetListOutput,
            handler=handle_exp_list,
        ),
        RegisteredTool(
            definition=_definition(
                name="dataset.get",
                description="Get detailed values and metadata for an experimental dataset.",
                input_schema="chemdft.dataset-get-input.v1",
                output_schema="chemdft.experimental-dataset-view.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="experiment.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=DatasetGetInput,
            output_model=ExperimentalDatasetView,
            handler=handle_dataset_get,
        ),
    )


def _calculation_tools(
    session: Session, object_store: ObjectStore, settings: Settings
) -> tuple[RegisteredTool, ...]:
    def handle_calc_get(
        context: ToolInvocationContext, payload: CalculationGetInput
    ) -> CalculationDetail:
        project_id = str(context.project_id)
        return get_calculation(
            session, context.identity, project_id, str(payload.calculation.entity_id)
        )

    def handle_calc_submit(
        context: ToolInvocationContext, payload: CalculationSubmitInput
    ) -> CalculationDetail:
        project_id = str(context.project_id)
        return submit_calculation(
            session, context.identity, object_store, settings, project_id, payload
        )

    def handle_calc_cancel(
        context: ToolInvocationContext, payload: CalculationCancelInput
    ) -> CalculationDetail:
        project_id = str(context.project_id)
        return cancel_calculation(
            session, context.identity, project_id, str(payload.calculation_id)
        )

    def handle_compute_estimate(
        context: ToolInvocationContext, payload: ComputeEstimateInput
    ) -> ComputeEstimateOutput:
        project_id = str(context.project_id)
        provider = LOCAL_PROVIDER
        requirement = default_requirement(settings, provider)
        spec = payload.specification
        estimate = estimate_for_requirement(
            estimate_id=UUID(new_id()),
            project_id=UUID(project_id),
            requirement=requirement,
            provider=provider,
            task=str(spec.get("task", "ENERGY")),
            basis=str(spec.get("basis", "STO-3G")),
        )
        return ComputeEstimateOutput(estimate=estimate)

    return (
        RegisteredTool(
            definition=_definition(
                name="calculation.get",
                description="Read a calculation record, attempt history, and published result.",
                input_schema="chemdft.calculation-get-input.v1",
                output_schema="chemdft.calculation-detail.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="calculation.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=CalculationGetInput,
            output_model=CalculationDetail,
            handler=handle_calc_get,
        ),
        RegisteredTool(
            definition=_definition(
                name="calculation.submit",
                description=(
                    "Submit a quantum chemistry calculation for asynchronous execution. "
                    "Requires approval."
                ),
                input_schema="chemdft.calculation-submit-input.v1",
                output_schema="chemdft.calculation-detail.v1",
                permission=PermissionClass.EXPENSIVE,
                side_effect=SideEffectClass.DURABLE_JOB,
                availability=ToolAvailability.EXECUTABLE,
                capability="calculation.submit",
                idempotency=IdempotencyBehavior.KEY_REQUIRED,
            ),
            input_model=CalculationSubmitInput,
            output_model=CalculationDetail,
            handler=handle_calc_submit,
        ),
        RegisteredTool(
            definition=_definition(
                name="calculation.cancel",
                description="Cancel an active or queued calculation.",
                input_schema="chemdft.calculation-cancel-input.v1",
                output_schema="chemdft.calculation-detail.v1",
                permission=PermissionClass.LOW_COST_REVERSIBLE,
                side_effect=SideEffectClass.MUTATING_REVERSIBLE,
                availability=ToolAvailability.EXECUTABLE,
                capability="calculation.cancel",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=CalculationCancelInput,
            output_model=CalculationDetail,
            handler=handle_calc_cancel,
        ),
        RegisteredTool(
            definition=_definition(
                name="compute.estimate",
                description=(
                    "Estimate compute resource requirements and cost "
                    "for a calculation specification."
                ),
                input_schema="chemdft.compute-estimate-input.v1",
                output_schema="chemdft.compute-estimate-output.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="compute.estimate",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=ComputeEstimateInput,
            output_model=ComputeEstimateOutput,
            handler=handle_compute_estimate,
        ),
    )


def _knowledge_tools(session: Session) -> tuple[RegisteredTool, ...]:
    def handle_search(
        context: ToolInvocationContext, payload: KnowledgeSearchInput
    ) -> KnowledgeSearchOutput:
        return KnowledgeService(session, context.identity).search(str(context.project_id), payload)

    return (
        RegisteredTool(
            definition=_definition(
                name="knowledge.search",
                description=(
                    "Search source-bound project knowledge with lexical and semantic ranking."
                ),
                input_schema="chemdft.knowledge-search-input.v1",
                output_schema="chemdft.knowledge-search-output.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="knowledge.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=KnowledgeSearchInput,
            output_model=KnowledgeSearchOutput,
            handler=handle_search,
        ),
    )


def _investigation_tools(session: Session) -> tuple[RegisteredTool, ...]:
    def handle_get(
        context: ToolInvocationContext, payload: InvestigationGetInput
    ) -> InvestigationView:
        return InvestigationService(session, context.identity).get(
            str(context.project_id), str(payload.investigation_id)
        )

    return (
        RegisteredTool(
            definition=_definition(
                name="investigation.get",
                description="Read a bounded scientific investigation and its committed evidence.",
                input_schema="chemdft.investigation-get-input.v1",
                output_schema="chemdft.investigation-view.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="investigation.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=InvestigationGetInput,
            output_model=InvestigationView,
            handler=handle_get,
        ),
    )


def _molecule_creator_tools(
    session: Session, object_store: ObjectStore
) -> tuple[RegisteredTool, ...]:
    from ..ai.molecule_tools import handle_molecule_draft_create, handle_molecule_resolve
    from ..contracts.molecule_tools import (
        MoleculeDraftCreateInput,
        MoleculeDraftCreateOutput,
        MoleculeResolveInput,
        MoleculeResolveOutput,
    )

    return (
        RegisteredTool(
            definition=_definition(
                name="molecule.resolve",
                description="Resolve chemical name or identifier to canonical SMILES and molecular formula, or detect ambiguity.",
                input_schema="chemdft.molecule-resolve-input.v1",
                output_schema="chemdft.molecule-resolve-output.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="project.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=MoleculeResolveInput,
            output_model=MoleculeResolveOutput,
            handler=lambda context, payload: handle_molecule_resolve(session, context, payload),
        ),
        RegisteredTool(
            definition=_definition(
                name="molecule.draft.create",
                description="Generate 2D depiction and 3D RDKit conformer candidate draft for a resolved molecule graph.",
                input_schema="chemdft.molecule-draft-create-input.v1",
                output_schema="chemdft.molecule-draft-create-output.v1",
                permission=PermissionClass.LOW_COST_REVERSIBLE,
                side_effect=SideEffectClass.MUTATING_REVERSIBLE,
                availability=ToolAvailability.EXECUTABLE,
                capability="project.write",
                idempotency=IdempotencyBehavior.KEY_REQUIRED,
            ),
            input_model=MoleculeDraftCreateInput,
            output_model=MoleculeDraftCreateOutput,
            handler=lambda context, payload: handle_molecule_draft_create(
                session, object_store, context, payload
            ),
        ),
    )


def build_application_tool_registry(
    session: Session,
    object_store: ObjectStore,
    settings: Settings,
    audit_sink_factory: Callable[[Session], SqlAlchemyToolAuditSink] = SqlAlchemyToolAuditSink,
) -> ToolRegistry:
    registry = ToolRegistry(audit_sink_factory(session))
    from ..ai.tool_policy import guard_ai_tool

    registry._ai_guard = lambda context, definition, arguments: guard_ai_tool(
        session, settings, context, definition, arguments
    )
    for tool in _project_tools(session):
        registry.register(tool)
    for tool in _structure_tools(session):
        registry.register(tool)
    for tool in _structure_edit_tools(session, object_store):
        registry.register(tool)
    for tool in _structure_read_tools(session, object_store, settings):
        registry.register(tool)
    for tool in _molecule_creator_tools(session, object_store):
        registry.register(tool)
    for tool in _document_tools(session, object_store, settings):
        registry.register(tool)
    for tool in _experiment_tools(session):
        registry.register(tool)
    for tool in _calculation_tools(session, object_store, settings):
        registry.register(tool)
    for tool in _knowledge_tools(session):
        registry.register(tool)
    for tool in _investigation_tools(session):
        registry.register(tool)
    return registry
