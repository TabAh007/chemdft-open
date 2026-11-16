from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

import uvicorn
from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, TypeAdapter, ValidationError
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse

from . import account_models as _account_models  # noqa: F401
from . import billing_models as _billing_models  # noqa: F401
from . import example_models as _example_models  # noqa: F401
from . import investigation_models as _investigation_models  # noqa: F401
from . import knowledge_models as _knowledge_models  # noqa: F401
from . import orcid_models as _orcid_models  # noqa: F401
from . import scientific_models as _scientific_models  # noqa: F401
from .account_routes import router as account_router
from .actions import create_project as create_project_action
from .actions import get_project as get_project_action
from .actions import list_project_files as list_project_files_action
from .actions import list_projects as list_projects_action
from .actions import register_raw_file
from .actions import rename_project as rename_project_action
from .ai.service import AIScientistService
from .auth import ensure_dev_identity, require_identity, validate_auth_configuration
from .billing_service import BillingService
from .calculation_actions import (
    cancel_calculation as cancel_calculation_action,
)
from .calculation_actions import (
    download_calculation_artifact as download_calculation_artifact_action,
)
from .calculation_actions import (
    get_calculation as get_calculation_action,
)
from .calculation_actions import (
    list_compute_jobs as list_compute_jobs_action,
)
from .calculation_actions import (
    list_engine_capabilities,
)
from .calculation_actions import (
    submit_calculation as submit_calculation_action,
)
from .calculation_comparison import (
    compare_results,
    comparison_csv,
    comparison_json,
    list_comparison_candidates,
)
from .candidate_representation_actions import (
    create_candidate_representation,
    generate_candidate_representation_conformer,
    get_candidate_representation,
    import_candidate_coordinates,
    list_candidate_representations,
    paste_candidate_coordinates,
    reject_candidate_representation,
    review_candidate_representation,
    validate_candidate_graph,
)
from .composition import get_object_store
from .config import Settings, get_settings
from .context import Identity, ServiceIdentity
from .contracts.ai import (
    AIConversationDetail,
    AIConversationListOutput,
    AIRunEventsOutput,
    AIRunView,
    ApprovalDecisionInput,
    CreateConversationInput,
    DrawInput,
    DrawResponse,
    PostMessageInput,
)
from .contracts.ai_foundation import (
    AIPreferencesInput,
    AISettingsView,
    ProductContext,
    ProductSelection,
)
from .contracts.ai_performance import AIModelPerformanceView
from .contracts.analysis import (
    CalculationComparisonOutput,
    CalculationExportCatalog,
    ComparisonCandidateListOutput,
    JobDiagnostics,
    JobLogOutput,
)
from .contracts.artifacts import ScientificArtifactKind, ScientificArtifactRegistration
from .contracts.base import ArtifactReference
from .contracts.billing import (
    BillingSnapshot,
    BYOKCredentialInput,
    BYOKRevocationInput,
    CheckoutSessionView,
    CreateCheckoutInput,
    ReconciliationView,
)
from .contracts.catalog import (
    CalculationDetail,
    CalculationSubmitInput,
    ComputeJobListOutput,
    EngineCapabilityView,
    StructureImportInput,
    StructureImportOutput,
    StructureSourceReferenceUpdateInput,
    StructureSummary,
    StructureVersionCreateInput,
    StructureVersionCreateOutput,
    StructureVersionDetail,
)
from .contracts.dftd4 import Dftd4Capability, Dftd4RetryInput, Dftd4SubmitInput
from .contracts.experimental_spectra import (
    CalculatedSourceListOutput,
    SpectrumArraysView,
    SpectrumAssociationInput,
    SpectrumAssociationView,
    SpectrumComparisonInput,
    SpectrumComparisonListOutput,
    SpectrumComparisonView,
    SpectrumConfirmInput,
    SpectrumDatasetListOutput,
    SpectrumDatasetView,
    SpectrumPeakInput,
    SpectrumResolveInput,
    SpectrumTechnique,
    SpectrumTransformInput,
    SpectrumUploadListOutput,
    SpectrumUploadView,
)
from .contracts.external_import import (
    ExternalImportConfirmInput,
    ExternalImportDetail,
    ExternalImportListOutput,
    ExternalImportView,
    ImportedResultView,
)
from .contracts.geometry import (
    GeometryCandidateAcceptInput,
    GeometryCandidateAcceptOutput,
    GeometryCandidateListOutput,
    GeometryCandidateView,
    GeometryEligibility,
    MolecularDrawingGenerateInput,
)
from .contracts.investigations import (
    CreateAssessmentInput,
    CreateHypothesisInput,
    CreateInvestigationInput,
    CreateObservationInput,
    CreatePlanInput,
    InvestigationListOutput,
    InvestigationUserInput,
    InvestigationView,
)
from .contracts.knowledge import (
    KnowledgeIndexStatus,
    KnowledgeItemView,
    KnowledgeSearchInput,
    KnowledgeSearchOutput,
    ProjectMemoryCreateInput,
    ProjectMemoryListOutput,
    ProjectMemoryView,
)
from .contracts.navigator import GoalId, NavigatorState
from .contracts.phase7 import (
    DigitizedDatasetInput,
    EvidenceReviewInput,
    EvidenceReviewOutput,
    ExperimentalDatasetListOutput,
    ExperimentalDatasetView,
    ExperimentalImportInput,
    GraphDigitizedDatasetInput,
    ScientificDocumentImportOutput,
    ScientificDocumentListOutput,
    XrdDigitizedDatasetInput,
)
from .contracts.results import (
    CalculationResult,
    MolecularOrbitalGridOutput,
    MolecularOrbitalGridRequest,
)
from .contracts.scientific import CoordinateUnit
from .contracts.scientific_claims import (
    ProjectScientificClaimsOutput,
    ProjectScientificComparisonOutput,
)
from .contracts.structure_candidates import (
    CandidateCoordinateOrigin,
    CandidateCoordinatePasteInput,
    CandidateRecognitionInput,
    CandidateRepresentationCreateInput,
    CandidateRepresentationCreateOutput,
    CandidateRepresentationDetail,
    CandidateRepresentationListOutput,
    CandidateRepresentationRejectInput,
    CandidateRepresentationReviewInput,
    CandidateRepresentationReviewOutput,
    ConformerGenerationInput,
    MolecularGraphValidateInput,
    MolecularGraphValidateOutput,
    StructureCandidate,
    StructureCandidateListOutput,
    StructureCandidatePromotionInput,
    StructureCandidatePromotionOutput,
    StructureCandidateRejectInput,
    StructureCandidateReviewInput,
    StructureCandidateReviewOutput,
)
from .contracts.volumetric import VolumetricFieldOutput, VolumetricFieldRequest
from .contracts.workflows import (
    PublishedResultsPage,
    QueueStatus,
    ResearchOverview,
    ReusePlan,
    SavedComparisonCreate,
    SavedComparisonListOutput,
    SavedComparisonOpenOutput,
    SavedComparisonSummary,
)
from .database import Base, SessionLocal, engine, get_session
from .direct_upload import (
    TicketError,
    UploadTicketRequest,
    UploadTicketResponse,
    cors_headers,
    direct_upload_enabled,
    issue_ticket,
    verify_ticket,
)
from .download_response import attachment_response
from .errors import (
    ApplicationError,
    ArtifactHashMismatch,
    BillingEntitlementDenied,
    BillingNotConfigured,
    BillingPlanNotFound,
    BillingSecretUnavailable,
    BillingWebhookInvalid,
    CandidateStateConflict,
    CrossProjectReference,
    ExperimentalSpectrumConflict,
    ExperimentalSpectrumWorkerUnavailable,
    ExportLimitExceeded,
    ExternalImportConflict,
    ExternalImportWorkerUnavailable,
    FeatureNotActivated,
    InvalidMolecularName,
    ProjectAccessDenied,
    ProjectNotFound,
    ProjectSlugConflict,
    RecognitionEngineUnavailable,
    ScientificReferenceNotFound,
    ScientificValidationFailed,
    StructureElectronicStateMismatch,
    UploadTooLarge,
)
from .examples.routes import router as examples_router
from .experimental_spectrum_actions import (
    confirm_spectrum_upload,
    create_spectrum_upload,
    get_spectrum_arrays,
    get_spectrum_dataset,
    get_spectrum_upload,
    list_spectrum_datasets,
    list_spectrum_uploads,
    resolve_spectrum_upload,
    set_spectrum_association,
)
from .experimental_spectrum_comparison import (
    create_spectrum_comparison,
    get_spectrum_comparison,
    list_calculated_sources,
    list_spectrum_comparisons,
)
from .experimental_spectrum_processing import create_spectrum_peaks, create_spectrum_transform
from .external_import_actions import (
    confirm_external_import,
    create_external_import,
    get_external_import_detail,
    get_imported_result,
    list_external_imports,
)
from .geometry_actions import (
    accept_geometry_candidate,
    generate_drawing_geometry,
    get_geometry_candidate,
    get_source_drawing,
    get_structure_geometry_eligibility,
    list_geometry_candidates,
)
from .identity_service import IdentityDenied, build_me
from .investigation_service import InvestigationService
from .job_diagnostics import get_job_diagnostics, read_job_log
from .knowledge.service import KnowledgeService
from .molecular_orbital_actions import get_or_generate_molecular_orbital_grid
from .navigator.service import get_navigator
from .orcid_routes import router as orcid_router
from .phase7_actions import (
    create_digitized_dataset,
    create_dls_digitized_dataset,
    create_xrd_digitized_dataset,
    download_document_source,
    import_experimental_dataset,
    import_scientific_document,
    list_experimental_datasets,
    review_evidence,
    route_scientific_import,
)
from .phase7_actions import (
    get_document as get_document_action,
)
from .phase7_actions import (
    list_documents as list_documents_action,
)
from .schemas import (
    FileRead,
    HealthRead,
    MeRead,
    ProjectCreate,
    ProjectRead,
    ProjectRename,
    WorkspaceHistoryRead,
)
from .scientific.molecular_geometry import GeometryValidationFailed
from .scientific_actions import (
    create_structure_version as create_structure_version_action,
)
from .scientific_actions import (
    create_structure_version_from_source,
    get_structure_version_detail,
    list_structure_versions,
    register_scientific_artifact,
    update_structure_version_source_reference,
)
from .scientific_actions import (
    export_structure_version as export_structure_version_action,
)
from .scientific_actions import (
    import_structure as import_structure_action,
)
from .scientific_actions import (
    list_structures as list_structures_action,
)
from .scientific_claim_actions import add_manual_paper_claim, get_project_scientific_claims
from .scientific_comparison_actions import get_project_scientific_comparison
from .scientific_export import build_export, export_catalog
from .service_principals import (
    SERVICE_BILLING_WEBHOOK,
    ensure_service_principals,
    service_identity,
)
from .storage import ObjectStore
from .structure_candidate_actions import (
    extract_document_figure_candidates,
    get_candidate_figure_image,
    get_structure_candidate,
    list_structure_candidates,
    promote_structure_candidate,
    recognize_candidate_figure,
    reject_structure_candidate,
    review_structure_candidate,
)
from .volumetric_field_actions import get_or_generate_volumetric_field
from .workspace_actions import list_workspace_history


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    validate_auth_configuration(settings)
    if settings.auto_create_schema:
        Base.metadata.create_all(engine)
        if settings.dev_identity_enabled:
            with SessionLocal() as session:
                ensure_dev_identity(session, settings)
    yield


app = FastAPI(
    title="ChemDFT API",
    version="0.2.0",
    description=(
        "ChemDFT application, scientific contracts, deterministic local execution, provenance, "
        "authority, and Tool Registry foundation."
    ),
    lifespan=lifespan,
)
app.include_router(examples_router)
app.include_router(orcid_router)
app.include_router(account_router)


def _validate_form_fields(model: type, fields: dict[str, tuple[str, object]]) -> None:
    """Check multipart form values against a contract's field types, raising the standard 422.

    FastAPI validates declared form parameters itself, but a contract may constrain them further;
    doing it up front keeps a bad value from reaching code that has already stored an upload.
    """
    errors: list[dict] = []
    for contract_field, (form_name, value) in fields.items():
        field = model.model_fields[contract_field]  # type: ignore[attr-defined]
        # pydantic keeps constraints (min_length, ge, ...) in `metadata`, apart from the annotation
        constrained = bool(field.metadata)
        annotation = (
            Annotated[(field.annotation, *field.metadata)] if constrained else field.annotation
        )
        try:
            TypeAdapter(annotation).validate_python(value)
        except ValidationError as error:
            errors.extend({**item, "loc": ("body", form_name)} for item in error.errors())
    if errors:
        raise RequestValidationError(errors)


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(
    _request: Request, error: RequestValidationError
) -> JSONResponse:
    """Return stable validation details without echoing non-JSON input values."""
    details = [
        {key: value for key, value in item.items() if key not in {"input", "ctx"}}
        for item in error.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": details})


@app.get("/health", response_model=HealthRead, tags=["system"])
def health() -> HealthRead:
    return HealthRead(
        status="ok", service="chemdft-api", scientific_execution="capability-detected"
    )


@app.get("/v1/billing", response_model=BillingSnapshot, tags=["billing"])
def get_billing_snapshot(
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> BillingSnapshot:
    try:
        return BillingService(session, identity, settings).snapshot(read_only=True)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post("/v1/billing/checkout", response_model=CheckoutSessionView, tags=["billing"])
def create_billing_checkout(
    payload: CreateCheckoutInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CheckoutSessionView:
    try:
        return BillingService(session, identity, settings).create_checkout(payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post("/v1/billing/byok", response_model=object, tags=["billing"])
def configure_billing_byok(
    payload: BYOKCredentialInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> object:
    try:
        return BillingService(session, identity, settings).configure_byok(payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post("/v1/billing/byok/revoke", status_code=status.HTTP_204_NO_CONTENT, tags=["billing"])
def revoke_billing_byok(
    payload: BYOKRevocationInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    try:
        BillingService(session, identity, settings).revoke_byok(payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post("/v1/billing/reconcile", response_model=ReconciliationView, tags=["billing"])
def reconcile_billing(
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReconciliationView:
    try:
        return BillingService(session, identity, settings).reconcile()
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post("/v1/billing/webhooks/stripe", tags=["billing"])
async def stripe_billing_webhook(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    try:
        ensure_service_principals(session)
        identity = service_identity(SERVICE_BILLING_WEBHOOK)
        status_value = BillingService(session, identity, settings).process_webhook(
            await request.body(), request.headers.get("stripe-signature")
        )
        return {"status": status_value}
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/calculations/capabilities",
    response_model=list[EngineCapabilityView],
    tags=["calculations"],
)
def get_calculation_capabilities(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[EngineCapabilityView]:
    try:
        get_project_action(session, identity, project_id)
        return list(list_engine_capabilities(settings))
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/knowledge/search",
    response_model=KnowledgeSearchOutput,
    tags=["knowledge"],
)
def search_project_knowledge(
    project_id: str,
    payload: KnowledgeSearchInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> KnowledgeSearchOutput:
    try:
        return KnowledgeService(session, identity).search(project_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/knowledge/status",
    response_model=KnowledgeIndexStatus,
    tags=["knowledge"],
)
def get_project_knowledge_status(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> KnowledgeIndexStatus:
    try:
        return KnowledgeService(session, identity).status(project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/knowledge/reindex",
    response_model=KnowledgeIndexStatus,
    tags=["knowledge"],
)
def reindex_project_knowledge(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> KnowledgeIndexStatus:
    try:
        return KnowledgeService(session, identity).enqueue_reindex(project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/knowledge/items/{item_id}",
    response_model=KnowledgeItemView,
    tags=["knowledge"],
)
def get_project_knowledge_item(
    project_id: str,
    item_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> KnowledgeItemView:
    try:
        return KnowledgeService(session, identity).get_item(project_id, item_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/memory",
    response_model=ProjectMemoryView,
    status_code=status.HTTP_201_CREATED,
    tags=["knowledge"],
)
def create_project_memory(
    project_id: str,
    payload: ProjectMemoryCreateInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> ProjectMemoryView:
    try:
        return KnowledgeService(session, identity).create_memory(project_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/memory",
    response_model=ProjectMemoryListOutput,
    tags=["knowledge"],
)
def list_project_memory(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> ProjectMemoryListOutput:
    try:
        return KnowledgeService(session, identity).list_memories(project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/calculations",
    response_model=CalculationDetail,
    status_code=status.HTTP_201_CREATED,
    tags=["calculations"],
)
def submit_project_calculation(
    project_id: str,
    payload: CalculationSubmitInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> CalculationDetail:
    try:
        return submit_calculation_action(
            session, identity, object_store, settings, project_id, payload
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/calculations/{calculation_id}/orbitals/grid",
    response_model=MolecularOrbitalGridOutput,
    tags=["calculations"],
)
def get_project_molecular_orbital_grid(
    project_id: str,
    calculation_id: str,
    payload: MolecularOrbitalGridRequest,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> MolecularOrbitalGridOutput:
    try:
        return get_or_generate_molecular_orbital_grid(
            session,
            identity,
            object_store,
            settings,
            project_id,
            calculation_id,
            payload,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/calculations/{calculation_id}/fields/grid",
    response_model=VolumetricFieldOutput,
    tags=["calculations"],
)
def get_project_volumetric_field(
    project_id: str,
    calculation_id: str,
    payload: VolumetricFieldRequest,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> VolumetricFieldOutput:
    try:
        return get_or_generate_volumetric_field(
            session, identity, object_store, settings, project_id, calculation_id, payload
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/calculations/{calculation_id}",
    response_model=CalculationDetail,
    tags=["calculations"],
)
def get_project_calculation(
    project_id: str,
    calculation_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> CalculationDetail:
    try:
        return get_calculation_action(session, identity, project_id, calculation_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/calculations/{calculation_id}/cancel",
    response_model=CalculationDetail,
    tags=["calculations"],
)
def cancel_project_calculation(
    project_id: str,
    calculation_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> CalculationDetail:
    try:
        return cancel_calculation_action(session, identity, project_id, calculation_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/compute/jobs",
    response_model=ComputeJobListOutput,
    tags=["compute"],
)
def list_project_compute_jobs(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    limit: Annotated[int | None, Query(ge=1, le=10_000)] = None,
    offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
    phase: Annotated[Literal["all", "active", "succeeded", "failed", "canceled"], Query()] = "all",
    provider: Annotated[Literal["local", "modal", "aws"] | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
) -> ComputeJobListOutput:
    try:
        return list_compute_jobs_action(
            session, identity, project_id,
            limit=limit, offset=offset, phase=phase, provider=provider, q=q,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/calculations/{calculation_id}/artifacts/{artifact_id}",
    tags=["calculations"],
)
def download_project_calculation_artifact(
    project_id: str,
    calculation_id: str,
    artifact_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> Response:
    try:
        filename, media_type, payload = download_calculation_artifact_action(
            session,
            identity,
            object_store,
            settings,
            project_id,
            calculation_id,
            artifact_id,
        )
        detail = get_calculation_action(session, identity, project_id, calculation_id)
        return attachment_response(
            filename,
            media_type,
            payload,
            effective=detail.result.effective_state if detail.result else False,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


def application_error_to_http(error: ApplicationError) -> HTTPException:
    from .ai.providers import AIFoundationError
    from .errors import Dftd4Conflict

    if isinstance(error, Dftd4Conflict):
        return HTTPException(
            status_code=error.status_code, detail={"code": error.code, "message": error.detail}
        )

    if isinstance(error, AIFoundationError):
        return HTTPException(
            status_code=error.status_code, detail={"code": error.code, "message": error.detail}
        )
    from .ai.execution import RunControlInvalidStateError, StaleWorkerFencedError

    if isinstance(error, (RunControlInvalidStateError, StaleWorkerFencedError)):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": error.code, "message": error.detail},
        )
    if isinstance(error, ProjectNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error.detail)
    if isinstance(error, ProjectAccessDenied):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=error.detail)
    if isinstance(error, ProjectSlugConflict):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=error.detail)
    if isinstance(
        error, (CandidateStateConflict, ExternalImportConflict, ExperimentalSpectrumConflict)
    ):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=error.detail)
    if isinstance(error, ExportLimitExceeded):
        return HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=error.detail
        )
    from .errors import AccountPolicyError, UsageLimitReached

    if isinstance(error, AccountPolicyError):
        return HTTPException(
            status_code=error.status_code, detail={"code": error.code, "message": error.detail}
        )
    if isinstance(error, UsageLimitReached):
        return HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=error.detail)
    if isinstance(error, FeatureNotActivated):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=error.detail)
    if isinstance(
        error,
        (
            ExternalImportWorkerUnavailable,
            ExperimentalSpectrumWorkerUnavailable,
            RecognitionEngineUnavailable,
        ),
    ):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=error.detail)
    if isinstance(error, UploadTooLarge):
        return HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=error.detail,
        )
    if isinstance(error, ScientificReferenceNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error.detail)
    if isinstance(error, (CrossProjectReference, ArtifactHashMismatch)):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=error.detail)
    if isinstance(error, BillingEntitlementDenied):
        return HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=error.detail)
    if isinstance(error, (BillingNotConfigured, BillingSecretUnavailable)):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=error.detail)
    if isinstance(error, BillingWebhookInvalid):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error.detail)
    if isinstance(error, BillingPlanNotFound):
        return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=error.detail)
    if isinstance(error, ScientificValidationFailed):
        if isinstance(error, (InvalidMolecularName, StructureElectronicStateMismatch)) or (
            isinstance(error, GeometryValidationFailed)
            and error.code.startswith("GEOMETRY_STEREOCHEMISTRY_")
        ):
            return HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": error.code, "message": getattr(error, "message", error.detail)},
            )
        return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=error.detail)
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error.detail)


@app.get("/v1/me", response_model=MeRead, tags=["identity"])
def read_me(
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> MeRead:
    try:
        return build_me(session, identity, settings.auth_mode)
    except IdentityDenied as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=error.code) from error


@app.get("/v1/projects", response_model=list[ProjectRead], tags=["projects"])
def list_projects(
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> list[ProjectRead]:
    return list_projects_action(session, identity)


@app.post(
    "/v1/projects",
    response_model=ProjectRead,
    status_code=status.HTTP_201_CREATED,
    tags=["projects"],
)
def create_project(
    payload: ProjectCreate,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ProjectRead:
    try:
        from .account_policy import enforce_project_create

        enforce_project_create(session, settings, identity.user_id)
        return create_project_action(session, identity, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get("/v1/projects/{project_id}", response_model=ProjectRead, tags=["projects"])
def get_project(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> ProjectRead:
    try:
        return get_project_action(session, identity, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.patch("/v1/projects/{project_id}", response_model=ProjectRead, tags=["projects"])
def rename_project(
    project_id: str,
    payload: ProjectRename,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> ProjectRead:
    try:
        return rename_project_action(session, identity, project_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get("/v1/projects/{project_id}/navigator", response_model=NavigatorState, tags=["navigator"])
def project_navigator(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    goal: GoalId | None = None,
    structure_version_id: str | None = None,
) -> NavigatorState:
    try:
        return get_navigator(
            session,
            identity,
            project_id,
            settings,
            goal=goal,
            structure_version_id=structure_version_id,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/files",
    response_model=list[FileRead],
    tags=["files"],
)
def list_project_files(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> list[FileRead]:
    try:
        return list_project_files_action(session, identity, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/workspace/history",
    response_model=list[WorkspaceHistoryRead],
    tags=["workspace"],
)
def get_project_workspace_history(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> list[WorkspaceHistoryRead]:
    try:
        return list_workspace_history(session, identity, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/files",
    response_model=FileRead,
    status_code=status.HTTP_201_CREATED,
    tags=["files"],
)
def upload_raw_file(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    upload: Annotated[UploadFile, File(description="Unmodified source bytes")],
) -> FileRead:
    try:
        return register_raw_file(
            session=session,
            identity=identity,
            object_store=object_store,
            project_id=project_id,
            original_name=upload.filename,
            media_type=upload.content_type,
            stream=upload.file,
            max_upload_bytes=settings.max_upload_bytes,
            settings=settings,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/structures",
    response_model=list[StructureSummary],
    tags=["structures"],
)
def list_project_structures(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> list[StructureSummary]:
    try:
        return list(list_structures_action(session, identity, project_id))
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/geometry-candidates",
    response_model=GeometryCandidateView,
    status_code=status.HTTP_201_CREATED,
    tags=["geometry"],
)
def generate_project_drawing_geometry(
    project_id: str,
    command: MolecularDrawingGenerateInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> GeometryCandidateView:
    try:
        return generate_drawing_geometry(session, identity, object_store, project_id, command)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/geometry-candidates",
    response_model=GeometryCandidateListOutput,
    tags=["geometry"],
)
def list_project_geometry_candidates(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> GeometryCandidateListOutput:
    try:
        return list_geometry_candidates(session, identity, object_store, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/geometry-candidates/{candidate_id}",
    response_model=GeometryCandidateView,
    tags=["geometry"],
)
def read_project_geometry_candidate(
    project_id: str,
    candidate_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> GeometryCandidateView:
    try:
        return get_geometry_candidate(session, identity, object_store, project_id, candidate_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get("/v1/projects/{project_id}/geometry-candidates/{candidate_id}/drawing", tags=["geometry"])
def download_project_geometry_drawing(
    project_id: str,
    candidate_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> Response:
    try:
        return Response(
            get_source_drawing(session, identity, object_store, project_id, candidate_id),
            media_type="chemical/x-mdl-molfile",
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/geometry-candidates/{candidate_id}/accept",
    response_model=GeometryCandidateAcceptOutput,
    status_code=status.HTTP_201_CREATED,
    tags=["geometry"],
)
def accept_project_geometry_candidate(
    project_id: str,
    candidate_id: str,
    command: GeometryCandidateAcceptInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> GeometryCandidateAcceptOutput:
    try:
        return accept_geometry_candidate(
            session, identity, object_store, project_id, candidate_id, command
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/structures/{structure_id}/versions/{version_id}/calculation-eligibility",
    response_model=GeometryEligibility,
    tags=["geometry"],
)
def read_project_geometry_eligibility(
    project_id: str,
    structure_id: str,
    version_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> GeometryEligibility:
    try:
        return get_structure_geometry_eligibility(
            session, identity, object_store, project_id, structure_id, version_id
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/structures/{structure_id}/versions/{version_id}",
    response_model=StructureVersionDetail,
    tags=["structures"],
)
def get_project_structure_version(
    project_id: str,
    structure_id: str,
    version_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> StructureVersionDetail:
    try:
        return get_structure_version_detail(
            session,
            identity,
            project_id,
            structure_id,
            version_id,
            object_store,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.put(
    "/v1/projects/{project_id}/structures/{structure_id}/versions/{version_id}/source-reference",
    response_model=StructureVersionDetail,
    tags=["structures"],
)
def update_project_structure_source_reference(
    project_id: str,
    structure_id: str,
    version_id: str,
    payload: StructureSourceReferenceUpdateInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> StructureVersionDetail:
    try:
        return update_structure_version_source_reference(
            session,
            identity,
            project_id,
            structure_id,
            version_id,
            payload.source_reference,
            object_store,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/structures/{structure_id}/versions",
    response_model=list[StructureVersionDetail],
    tags=["structures"],
)
def list_project_structure_versions(
    project_id: str,
    structure_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> list[StructureVersionDetail]:
    try:
        return list(
            list_structure_versions(session, identity, project_id, structure_id, object_store)
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/structures/imports",
    response_model=StructureImportOutput,
    status_code=status.HTTP_201_CREATED,
    tags=["structures"],
)
def import_project_structure_upload(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    upload: Annotated[UploadFile, File(description="SDF, XYZ, or CIF source bytes")],
    file_format: Annotated[str, Form(description="SDF, XYZ, or CIF")],
    idempotency_key: Annotated[str, Form(min_length=8, max_length=200)],
    structure_name: Annotated[str | None, Form(max_length=160)] = None,
    selection_index: Annotated[int, Form(ge=0)] = 0,
) -> StructureImportOutput:
    # Validate form values before anything is stored: an invalid value is a 422 and keeps nothing.
    _validate_form_fields(
        StructureImportInput,
        {
            "requested_format": ("file_format", file_format),
            "structure_name": ("structure_name", structure_name),
            "idempotency_key": ("idempotency_key", idempotency_key),
        },
    )
    try:
        stored = register_raw_file(
            session=session,
            identity=identity,
            object_store=object_store,
            project_id=project_id,
            original_name=upload.filename,
            media_type=upload.content_type,
            stream=upload.file,
            max_upload_bytes=settings.max_upload_bytes,
            settings=settings,
        )
        artifact = register_scientific_artifact(
            session,
            identity,
            ScientificArtifactRegistration(
                project_id=stored.project_id,
                stored_file_id=stored.id,
                kind=ScientificArtifactKind.STRUCTURE_FILE,
                format_identifier=file_format.strip().upper(),
            ),
        )
        return import_structure_action(
            session,
            identity,
            object_store,
            StructureImportInput(
                project_id=stored.project_id,
                source_artifact=ArtifactReference(
                    project_id=artifact.project_id,
                    artifact_id=artifact.id,
                    sha256=artifact.sha256,
                ),
                requested_format=file_format,
                structure_name=structure_name,
                selection_index=selection_index,
                idempotency_key=idempotency_key,
            ),
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/structures/versions",
    response_model=StructureVersionCreateOutput,
    status_code=status.HTTP_201_CREATED,
    tags=["structures"],
)
def create_project_structure_version(
    project_id: str,
    payload: StructureVersionCreateInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> StructureVersionCreateOutput:
    try:
        if str(payload.representation_artifact.project_id) != project_id:
            raise CrossProjectReference()
        return create_structure_version_action(session, identity, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/calculations/{calculation_id}/relaxed-structure-version",
    response_model=StructureVersionCreateOutput,
    status_code=status.HTTP_201_CREATED,
    tags=["structures"],
)
def create_project_relaxed_structure_version(
    project_id: str,
    calculation_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> StructureVersionCreateOutput:
    """Release 0.0.45: save QE relaxed positions as a new structure version (idempotent)."""
    from .relaxed_structure_actions import create_relaxed_structure_version

    try:
        return create_relaxed_structure_version(
            session, identity, object_store, project_id=project_id, calculation_id=calculation_id
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/structures/{structure_id}/versions/imports",
    response_model=StructureVersionCreateOutput,
    status_code=status.HTTP_201_CREATED,
    tags=["structures"],
)
def create_project_structure_version_from_upload(
    project_id: str,
    structure_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    upload: Annotated[UploadFile, File(description="MOL output from the editor adapter")],
    file_format: Annotated[str, Form(description="MOL")],
    parent_version_id: Annotated[str, Form(min_length=36, max_length=36)],
    idempotency_key: Annotated[str, Form(min_length=8, max_length=200)],
) -> StructureVersionCreateOutput:
    try:
        stored = register_raw_file(
            session=session,
            identity=identity,
            object_store=object_store,
            project_id=project_id,
            original_name=upload.filename,
            media_type=upload.content_type,
            stream=upload.file,
            max_upload_bytes=settings.max_upload_bytes,
            settings=settings,
        )
        artifact = register_scientific_artifact(
            session,
            identity,
            ScientificArtifactRegistration(
                project_id=stored.project_id,
                stored_file_id=stored.id,
                kind=ScientificArtifactKind.STRUCTURE_FILE,
                format_identifier=file_format.strip().upper(),
            ),
        )
        return create_structure_version_from_source(
            session,
            identity,
            object_store,
            project_id=project_id,
            structure_id=structure_id,
            parent_version_id=parent_version_id,
            source_artifact=ArtifactReference(
                project_id=artifact.project_id,
                artifact_id=artifact.id,
                sha256=artifact.sha256,
            ),
            requested_format=file_format,
            idempotency_key=idempotency_key,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/structures/{structure_id}/versions/{version_id}/export",
    tags=["structures"],
)
def export_project_structure_version(
    project_id: str,
    structure_id: str,
    version_id: str,
    file_format: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    try:
        filename, media_type, payload = export_structure_version_action(
            session,
            identity,
            project_id,
            structure_id,
            version_id,
            file_format,
        )
        return attachment_response(filename, media_type, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/structure-candidates",
    response_model=StructureCandidateListOutput,
    tags=["structure candidates"],
)
def list_project_structure_candidates(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> StructureCandidateListOutput:
    try:
        return list_structure_candidates(session, identity, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/documents/{document_id}/figures/extract",
    response_model=StructureCandidateListOutput,
    tags=["structure candidates"],
)
def extract_project_document_figures(
    project_id: str,
    document_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> StructureCandidateListOutput:
    try:
        candidates = extract_document_figure_candidates(
            session, identity, project_id, document_id, object_store, settings
        )
        return StructureCandidateListOutput(candidates=candidates)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}/recognize",
    tags=["structure candidates"],
)
def recognize_project_candidate_figure(
    project_id: str,
    candidate_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    settings: Annotated[Settings, Depends(get_settings)],
    payload: CandidateRecognitionInput | None = None,
) -> dict[str, Any]:
    try:
        engine = payload.engine if payload else None
        hint = payload.category_hint if payload else None
        candidate, proposal = recognize_candidate_figure(
            session, identity, project_id, candidate_id, object_store, settings, engine, hint
        )
        return {
            "candidate": candidate.model_dump(mode="json"),
            "proposal": proposal.to_dict(),
        }
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}/figure",
    tags=["structure candidates"],
)
def get_project_candidate_figure(
    project_id: str,
    candidate_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> Response:
    try:
        image_bytes, media_type = get_candidate_figure_image(
            session, identity, project_id, candidate_id, object_store
        )
        return Response(content=image_bytes, media_type=media_type)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}",
    response_model=StructureCandidate,
    tags=["structure candidates"],
)
def get_project_structure_candidate(
    project_id: str,
    candidate_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> StructureCandidate:
    try:
        return get_structure_candidate(session, identity, project_id, candidate_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}/review",
    response_model=StructureCandidateReviewOutput,
    tags=["structure candidates"],
)
def review_project_structure_candidate(
    project_id: str,
    candidate_id: str,
    payload: StructureCandidateReviewInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> StructureCandidateReviewOutput:
    try:
        return review_structure_candidate(
            session, identity, project_id, candidate_id, payload.notes
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}/reject",
    response_model=StructureCandidateReviewOutput,
    tags=["structure candidates"],
)
def reject_project_structure_candidate(
    project_id: str,
    candidate_id: str,
    payload: StructureCandidateRejectInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> StructureCandidateReviewOutput:
    try:
        return reject_structure_candidate(
            session, identity, project_id, candidate_id, payload.reason
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}/representations",
    response_model=CandidateRepresentationListOutput,
    tags=["structure candidates"],
)
def list_project_candidate_representations(
    project_id: str,
    candidate_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> CandidateRepresentationListOutput:
    try:
        return list_candidate_representations(session, identity, project_id, candidate_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}/representations/{representation_id}",
    response_model=CandidateRepresentationDetail,
    tags=["structure candidates"],
)
def get_project_candidate_representation(
    project_id: str,
    candidate_id: str,
    representation_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> CandidateRepresentationDetail:
    try:
        return get_candidate_representation(
            session, identity, project_id, candidate_id, representation_id
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}/representations",
    response_model=CandidateRepresentationCreateOutput,
    tags=["structure candidates"],
)
def create_project_candidate_representation(
    project_id: str,
    candidate_id: str,
    payload: CandidateRepresentationCreateInput,
    response: Response,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> CandidateRepresentationCreateOutput:
    try:
        output, created = create_candidate_representation(
            session, identity, project_id, candidate_id, payload
        )
        response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return output
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}/representations/paste",
    response_model=CandidateRepresentationCreateOutput,
    tags=["structure candidates"],
)
def paste_project_candidate_coordinates(
    project_id: str,
    candidate_id: str,
    payload: CandidateCoordinatePasteInput,
    response: Response,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> CandidateRepresentationCreateOutput:
    try:
        output, created = paste_candidate_coordinates(
            session, identity, project_id, candidate_id, payload
        )
        response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return output
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}/representations/imports",
    response_model=CandidateRepresentationCreateOutput,
    tags=["structure candidates"],
)
async def import_project_candidate_coordinates(
    project_id: str,
    candidate_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    upload: Annotated[UploadFile, File(description="XYZ, MOL, SDF, or CIF coordinate file")],
    file_format: Annotated[str, Form(description="XYZ, MOL, SDF, or CIF")],
    coordinate_unit: Annotated[str, Form(description="angstrom or bohr")],
    coordinate_origin: Annotated[
        str, Form(description="USER_IMPORTED_FILE, USER_CREATED, or USER_EDITED")
    ],
    response: Response,
    name: Annotated[str | None, Form(max_length=160)] = None,
    parent_representation_id: Annotated[str | None, Form(max_length=36)] = None,
) -> CandidateRepresentationCreateOutput:
    try:
        data = await upload.read(settings.max_upload_bytes + 1)
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(status_code=413, detail="Coordinate file exceeds the upload limit.")
        output, created = import_candidate_coordinates(
            session,
            identity,
            project_id,
            candidate_id,
            data=data,
            file_format=file_format,
            coordinate_unit=CoordinateUnit(coordinate_unit),
            name=name,
            parent_representation_id=parent_representation_id,
            coordinate_origin=CandidateCoordinateOrigin(coordinate_origin),
        )
        response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return output
    except ApplicationError as error:
        raise application_error_to_http(error) from error
    except ValueError as error:
        raise HTTPException(
            status_code=422, detail="Unsupported coordinate unit or origin."
        ) from error


@app.post(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}/representations/{representation_id}/review",
    response_model=CandidateRepresentationReviewOutput,
    tags=["structure candidates"],
)
def review_project_candidate_representation(
    project_id: str,
    candidate_id: str,
    representation_id: str,
    payload: CandidateRepresentationReviewInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> CandidateRepresentationReviewOutput:
    try:
        return review_candidate_representation(
            session,
            identity,
            project_id,
            candidate_id,
            representation_id,
            payload.notes,
            payload.checklist,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}/representations/{representation_id}/reject",
    response_model=CandidateRepresentationReviewOutput,
    tags=["structure candidates"],
)
def reject_project_candidate_representation(
    project_id: str,
    candidate_id: str,
    representation_id: str,
    payload: CandidateRepresentationRejectInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> CandidateRepresentationReviewOutput:
    try:
        return reject_candidate_representation(
            session,
            identity,
            project_id,
            candidate_id,
            representation_id,
            payload.reason,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}/validate-graph",
    response_model=MolecularGraphValidateOutput,
    tags=["structure candidates"],
)
def validate_project_candidate_graph(
    project_id: str,
    candidate_id: str,
    payload: MolecularGraphValidateInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> MolecularGraphValidateOutput:
    try:
        return validate_candidate_graph(
            session, identity, project_id, candidate_id, payload
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}/representations/{representation_id}/generate-conformer",
    response_model=CandidateRepresentationCreateOutput,
    status_code=status.HTTP_201_CREATED,
    tags=["structure candidates"],
)
def generate_project_candidate_representation_conformer(
    project_id: str,
    candidate_id: str,
    representation_id: str,
    payload: ConformerGenerationInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> CandidateRepresentationCreateOutput:
    try:
        return generate_candidate_representation_conformer(
            session, identity, project_id, candidate_id, representation_id, payload
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/structure-candidates/{candidate_id}/promote",
    response_model=StructureCandidatePromotionOutput,
    status_code=status.HTTP_201_CREATED,
    tags=["structure candidates"],
)
def promote_project_structure_candidate(
    project_id: str,
    candidate_id: str,
    payload: StructureCandidatePromotionInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> StructureCandidatePromotionOutput:
    try:
        return promote_structure_candidate(
            session,
            identity,
            object_store,
            project_id,
            candidate_id,
            str(payload.representation_id) if payload.representation_id else None,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/documents/imports",
    response_model=ScientificDocumentImportOutput,
    status_code=status.HTTP_201_CREATED,
    tags=["documents"],
)
def import_project_document_upload(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    upload: Annotated[UploadFile, File(description="Scientific PDF source bytes")],
) -> ScientificDocumentImportOutput:
    try:
        return import_scientific_document(
            session,
            identity,
            object_store,
            settings,
            project_id=project_id,
            original_name=upload.filename,
            media_type=upload.content_type,
            stream=upload.file,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/documents/upload-tickets",
    response_model=UploadTicketResponse,
    tags=["documents"],
)
def create_document_upload_ticket(
    project_id: str,
    payload: UploadTicketRequest,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UploadTicketResponse:
    """A short-lived ticket for sending one large PDF straight to the API (see direct_upload.py)."""
    from .actions import authorize_project_access
    from .project_access import ProjectCapability, can

    try:
        project, member = authorize_project_access(session, identity, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error
    if not can(member, ProjectCapability.WRITE):
        raise HTTPException(status_code=403, detail="project_write_required")
    if not direct_upload_enabled(settings):
        raise HTTPException(status_code=503, detail="direct_upload_unavailable")
    from .account_policy import enforce_upload, upload_limit_bytes

    try:
        enforce_upload(session, settings, identity.user_id, payload.size_bytes)
    except ApplicationError as error:
        raise application_error_to_http(error) from error
    ticket_limit = min(
        settings.max_upload_bytes, upload_limit_bytes(session, settings, identity.user_id)
    )
    if payload.size_bytes > ticket_limit:
        raise HTTPException(status_code=413, detail="file_too_large")
    token, expires_at = issue_ticket(
        settings,
        user_id=identity.user_id,
        organization_id=identity.organization_id,
        project_id=project.id,
        max_bytes=ticket_limit,
    )
    base = (settings.direct_upload_public_url or "").rstrip("/")
    return UploadTicketResponse(
        ticket=token,
        upload_url=f"{base}/v1/direct-uploads/documents",
        expires_at=expires_at,
        max_bytes=ticket_limit,
    )


@app.options("/v1/direct-uploads/documents", include_in_schema=False)
def direct_document_upload_preflight(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> Response:
    headers = cors_headers(settings, request.headers.get("origin"))
    return Response(status_code=204 if headers else 403, headers=headers)


@app.post(
    "/v1/direct-uploads/documents",
    response_model=ScientificDocumentImportOutput,
    status_code=status.HTTP_201_CREATED,
    tags=["documents"],
)
def import_document_direct_upload(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    upload: Annotated[UploadFile, File(description="Scientific PDF source bytes")],
    ticket_header: Annotated[str | None, Header(alias="X-ChemDFT-Upload-Ticket")] = None,
) -> Any:
    """Import a PDF sent with an upload ticket, not a login token; membership is re-checked."""
    headers = cors_headers(settings, request.headers.get("origin"))
    if request.headers.get("origin") and not headers:
        return JSONResponse({"detail": "origin_not_allowed"}, status_code=403)

    def fail(code: str, status_code: int) -> JSONResponse:
        return JSONResponse({"detail": code}, status_code=status_code, headers=headers)

    try:
        ticket = verify_ticket(settings, ticket_header)
    except TicketError as error:
        return fail(error.code, 503 if error.code == "direct_upload_unavailable" else 401)
    try:
        output = import_scientific_document(
            session,
            Identity(user_id=ticket.user_id, organization_id=ticket.organization_id),
            object_store,
            settings.model_copy(
                update={"max_upload_bytes": min(ticket.max_bytes, settings.max_upload_bytes)}
            ),
            project_id=ticket.project_id,
            original_name=upload.filename,
            media_type=upload.content_type,
            stream=upload.file,
        )
    except ApplicationError as error:
        http_error = application_error_to_http(error)
        return fail(
            http_error.detail if isinstance(http_error.detail, str) else "import_failed",
            http_error.status_code,
        )
    return JSONResponse(
        output.model_dump(mode="json"), status_code=status.HTTP_201_CREATED, headers=headers
    )


@app.get(
    "/v1/projects/{project_id}/documents",
    response_model=ScientificDocumentListOutput,
    tags=["documents"],
)
def list_project_documents(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> ScientificDocumentListOutput:
    try:
        return list_documents_action(session, identity, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/scientific-claims",
    response_model=ProjectScientificClaimsOutput,
    tags=["scientific claims"],
)
def list_project_scientific_claims(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    locale: str = "en",
) -> ProjectScientificClaimsOutput:
    try:
        return get_project_scientific_claims(session, identity, project_id, locale)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


class ManualPaperClaimInput(BaseModel):
    document_id: str
    page: int = Field(ge=1, le=10_000)
    quantity: str = Field(min_length=1, max_length=120)
    value: float
    unit: str = Field(max_length=40)
    quote: str = Field(min_length=3, max_length=500)
    system: str = Field(min_length=1, max_length=200)
    quantity_key: str | None = Field(default=None, max_length=120)


@app.post(
    "/v1/projects/{project_id}/scientific-claims/manual",
    status_code=201,
    tags=["scientific claims"],
)
def add_manual_scientific_claim(
    project_id: str,
    command: ManualPaperClaimInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, str]:
    try:
        return add_manual_paper_claim(session, identity, project_id, **command.model_dump())
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/scientific-comparison",
    response_model=ProjectScientificComparisonOutput,
    tags=["scientific comparison"],
)
def read_project_scientific_comparison(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    locale: str = "en",
) -> ProjectScientificComparisonOutput:
    try:
        return get_project_scientific_comparison(session, identity, project_id, locale)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/documents/{document_id}",
    response_model=ScientificDocumentImportOutput,
    tags=["documents"],
)
def get_project_document(
    project_id: str,
    document_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> ScientificDocumentImportOutput:
    try:
        return get_document_action(session, identity, project_id, document_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/documents/{document_id}/source",
    tags=["documents"],
)
def download_project_document_source(
    project_id: str,
    document_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> Response:
    try:
        filename, media_type, payload = download_document_source(
            session,
            identity,
            object_store,
            settings,
            project_id=project_id,
            document_id=document_id,
        )
        safe_filename = filename.replace('"', "").replace("\\", "")
        return Response(
            content=payload,
            media_type=media_type,
            headers={
                "Content-Disposition": f'inline; filename="{safe_filename}"',
                "X-Content-Type-Options": "nosniff",
            },
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/evidence/{candidate_id}/review",
    response_model=EvidenceReviewOutput,
    tags=["evidence"],
)
def review_project_evidence(
    project_id: str,
    candidate_id: str,
    payload: EvidenceReviewInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> EvidenceReviewOutput:
    try:
        return review_evidence(session, identity, project_id, candidate_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/evidence/{candidate_id}/digitized-datasets",
    response_model=ExperimentalDatasetView,
    status_code=status.HTTP_201_CREATED,
    tags=["evidence"],
)
def create_project_digitized_dataset(
    project_id: str,
    candidate_id: str,
    payload: DigitizedDatasetInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> ExperimentalDatasetView:
    try:
        return create_digitized_dataset(session, identity, project_id, candidate_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/evidence/{candidate_id}/xrd-digitizations",
    response_model=ExperimentalDatasetView,
    status_code=status.HTTP_201_CREATED,
    tags=["evidence", "experimental-data"],
)
def create_project_xrd_digitization(
    project_id: str,
    candidate_id: str,
    payload: XrdDigitizedDatasetInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> ExperimentalDatasetView:
    try:
        return create_xrd_digitized_dataset(session, identity, project_id, candidate_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/evidence/{candidate_id}/graph-digitizations",
    response_model=ExperimentalDatasetView,
    status_code=status.HTTP_201_CREATED,
    tags=["evidence", "experimental-data"],
)
def create_project_graph_digitization(
    project_id: str,
    candidate_id: str,
    payload: GraphDigitizedDatasetInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> ExperimentalDatasetView:
    try:
        return create_dls_digitized_dataset(session, identity, project_id, candidate_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/experimental/imports",
    response_model=ExperimentalDatasetView,
    status_code=status.HTTP_201_CREATED,
    tags=["experimental-data"],
)
def import_project_experimental_upload(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    upload: Annotated[UploadFile, File(description="CSV, TSV, XY, or JCAMP source bytes")],
    modality: Annotated[str, Form()],
    x_column: Annotated[str, Form()],
    y_columns: Annotated[str, Form(description="Comma-separated columns")],
    x_label: Annotated[str, Form()],
    x_unit: Annotated[str, Form()],
    y_label: Annotated[str, Form()],
    y_unit: Annotated[str, Form()],
    experiment_name: Annotated[str, Form()],
    delimiter: Annotated[str, Form()] = ",",
) -> ExperimentalDatasetView:
    try:
        payload = ExperimentalImportInput(
            modality=modality,
            x_column=x_column,
            y_columns=tuple(item.strip() for item in y_columns.split(",") if item.strip()),
            x_label=x_label,
            x_unit=x_unit,
            y_label=y_label,
            y_unit=y_unit,
            experiment_name=experiment_name,
            delimiter=delimiter,
        )
    except ValidationError as error:
        # Form fields are validated here, not by FastAPI: report them like any invalid body.
        raise RequestValidationError(
            [{**item, "loc": ("body", *item["loc"])} for item in error.errors()]
        ) from error
    try:
        return import_experimental_dataset(
            session,
            identity,
            object_store,
            settings,
            project_id=project_id,
            original_name=upload.filename,
            media_type=upload.content_type,
            stream=upload.file,
            payload=payload,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/experimental/datasets",
    response_model=ExperimentalDatasetListOutput,
    tags=["experimental-data"],
)
def list_project_experimental_datasets(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> ExperimentalDatasetListOutput:
    try:
        return list_experimental_datasets(session, identity, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/imports",
    response_model=dict[str, object],
    status_code=status.HTTP_201_CREATED,
    tags=["imports"],
)
def route_project_import(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    upload: Annotated[UploadFile, File(description="Scientific source file")],
    file_format: Annotated[str | None, Form()] = None,
) -> dict[str, object]:
    try:
        data = upload.file.read()
        return route_scientific_import(
            session,
            identity,
            object_store,
            settings,
            project_id=project_id,
            original_name=upload.filename,
            media_type=upload.content_type,
            data=data,
            file_format=file_format,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


# PF-7 preferences are private human product state; browser hints are never authority.


@app.get("/v1/ai/settings", response_model=AISettingsView, tags=["ai-scientist"])
def read_ai_settings(
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AISettingsView:
    from .ai.providers import AIProviderService

    try:
        return AIProviderService(session, identity, settings).view()
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.put("/v1/ai/settings", response_model=AISettingsView, tags=["ai-scientist"])
def save_ai_settings(
    payload: AIPreferencesInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AISettingsView:
    from .ai.providers import AIProviderService

    try:
        return AIProviderService(session, identity, settings).save_preferences(payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/ai/model-performance", response_model=AIModelPerformanceView, tags=["ai-scientist"]
)
def read_ai_model_performance(
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> AIModelPerformanceView:
    from .ai.model_performance import model_performance

    if isinstance(identity, ServiceIdentity):
        raise application_error_to_http(
            ProjectAccessDenied("AI telemetry requires a human identity.")
        )
    return model_performance(session, identity)


@app.post(
    "/v1/projects/{project_id}/ai/context", response_model=ProductContext, tags=["ai-scientist"]
)
def read_product_context(
    project_id: str,
    payload: ProductSelection,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> ProductContext:
    from .ai.context_tools import add_context_tools
    from .ai.product_context import ProductContextBuilder
    from .tool_registry.catalog import build_application_tool_registry

    try:
        registry = build_application_tool_registry(session, object_store, settings)
        add_context_tools(registry, session, settings)
        return ProductContextBuilder(session, identity, settings, registry).build(
            project_id, payload
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/ai/conversations",
    response_model=AIConversationDetail,
    status_code=status.HTTP_201_CREATED,
    tags=["ai-scientist"],
)
def create_ai_conversation(
    project_id: str,
    payload: CreateConversationInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> AIConversationDetail:
    try:
        service = AIScientistService(session, identity, object_store, settings)
        return service.create_conversation(project_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/ai/conversations",
    response_model=AIConversationListOutput,
    tags=["ai-scientist"],
)
def list_ai_conversations(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> AIConversationListOutput:
    try:
        service = AIScientistService(session, identity, object_store, settings)
        return service.list_conversations(project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/ai/conversations/{conversation_id}",
    response_model=AIConversationDetail,
    tags=["ai-scientist"],
)
def get_ai_conversation(
    project_id: str,
    conversation_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> AIConversationDetail:
    try:
        service = AIScientistService(session, identity, object_store, settings)
        return service.get_conversation(project_id, conversation_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/ai/conversations/{conversation_id}/messages",
    response_model=AIConversationDetail,
    status_code=status.HTTP_201_CREATED,
    tags=["ai-scientist"],
)
def post_ai_message(
    project_id: str,
    conversation_id: str,
    payload: PostMessageInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> AIConversationDetail:
    try:
        service = AIScientistService(session, identity, object_store, settings)
        return service.post_message(project_id, conversation_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/ai/conversations/{conversation_id}/draw",
    response_model=DrawResponse,
    tags=["ai-scientist"],
)
def post_ai_draw(
    project_id: str,
    conversation_id: str,
    payload: DrawInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> DrawResponse:
    try:
        service = AIScientistService(session, identity, object_store, settings)
        return service.draw(project_id, conversation_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/investigations",
    response_model=InvestigationView,
    status_code=status.HTTP_201_CREATED,
    tags=["investigations"],
)
def create_investigation(
    project_id: str,
    payload: CreateInvestigationInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> InvestigationView:
    try:
        return InvestigationService(session, identity).create(project_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/investigations",
    response_model=InvestigationListOutput,
    tags=["investigations"],
)
def list_investigations(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> InvestigationListOutput:
    try:
        return InvestigationService(session, identity).list(project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/investigations/{investigation_id}",
    response_model=InvestigationView,
    tags=["investigations"],
)
def get_investigation(
    project_id: str,
    investigation_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> InvestigationView:
    try:
        return InvestigationService(session, identity).get(project_id, investigation_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/investigations/{investigation_id}/hypotheses",
    response_model=InvestigationView,
    tags=["investigations"],
)
def add_investigation_hypothesis(
    project_id: str,
    investigation_id: str,
    payload: CreateHypothesisInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> InvestigationView:
    try:
        return InvestigationService(session, identity).add_hypothesis(
            project_id, investigation_id, payload
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/investigations/{investigation_id}/plans",
    response_model=InvestigationView,
    tags=["investigations"],
)
def add_investigation_plan(
    project_id: str,
    investigation_id: str,
    payload: CreatePlanInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> InvestigationView:
    try:
        return InvestigationService(session, identity).add_plan(
            project_id, investigation_id, payload
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/investigations/{investigation_id}/observations",
    response_model=InvestigationView,
    tags=["investigations"],
)
def add_investigation_observation(
    project_id: str,
    investigation_id: str,
    payload: CreateObservationInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> InvestigationView:
    try:
        return InvestigationService(session, identity).add_observation(
            project_id, investigation_id, payload
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/investigations/{investigation_id}/assessments",
    response_model=InvestigationView,
    tags=["investigations"],
)
def assess_investigation(
    project_id: str,
    investigation_id: str,
    payload: CreateAssessmentInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> InvestigationView:
    try:
        return InvestigationService(session, identity).assess(project_id, investigation_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/investigations/{investigation_id}/start",
    response_model=InvestigationView,
    tags=["investigations"],
)
def start_investigation(
    project_id: str,
    investigation_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> InvestigationView:
    try:
        return InvestigationService(session, identity, object_store, settings).start(
            project_id, investigation_id
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/investigations/{investigation_id}/resume",
    response_model=InvestigationView,
    tags=["investigations"],
)
def resume_investigation(
    project_id: str,
    investigation_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> InvestigationView:
    try:
        return InvestigationService(session, identity, object_store, settings).resume(
            project_id, investigation_id
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/investigations/{investigation_id}/approvals/{approval_id}/decision",
    response_model=InvestigationView,
    tags=["investigations"],
)
def decide_investigation_approval(
    project_id: str,
    investigation_id: str,
    approval_id: str,
    payload: ApprovalDecisionInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> InvestigationView:
    try:
        return InvestigationService(session, identity, object_store, settings).decide_approval(
            project_id, investigation_id, approval_id, payload.decision
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/investigations/{investigation_id}/user-input",
    response_model=InvestigationView,
    tags=["investigations"],
)
def answer_investigation_user_input(
    project_id: str,
    investigation_id: str,
    payload: InvestigationUserInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> InvestigationView:
    try:
        return InvestigationService(session, identity).answer_user(
            project_id, investigation_id, payload
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/investigations/{investigation_id}/{target}",
    response_model=InvestigationView,
    tags=["investigations"],
)
def transition_investigation(
    project_id: str,
    investigation_id: str,
    target: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> InvestigationView:
    if target not in {"pause", "resume", "cancel"}:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Unknown investigation control."
        )
    desired = {"pause": "PAUSED", "resume": "ACTIVE", "cancel": "CANCELED"}[target]
    try:
        return InvestigationService(session, identity).transition(
            project_id, investigation_id, desired
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/ai/runs/{run_id}",
    response_model=AIRunView,
    tags=["ai-scientist"],
)
def get_ai_run(
    project_id: str,
    run_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> AIRunView:
    try:
        service = AIScientistService(session, identity, object_store, settings)
        return service.get_run(project_id, run_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/ai/runs/{run_id}/resume",
    response_model=AIRunView,
    tags=["ai-scientist"],
)
def resume_ai_run(
    project_id: str,
    run_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> AIRunView:
    try:
        service = AIScientistService(session, identity, object_store, settings)
        return service.resume_run(project_id, run_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/ai/runs/{run_id}/cancel",
    response_model=AIRunView,
    tags=["ai-scientist"],
)
def cancel_ai_run(
    project_id: str,
    run_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> AIRunView:
    try:
        service = AIScientistService(session, identity, object_store, settings)
        return service.cancel_run(project_id, run_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/ai/runs/{run_id}/pause",
    response_model=AIRunView,
    tags=["ai-scientist"],
)
def pause_ai_run(
    project_id: str,
    run_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> AIRunView:
    try:
        service = AIScientistService(session, identity, object_store, settings)
        return service.pause_run(project_id, run_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/ai/runs/{run_id}/events",
    response_model=AIRunEventsOutput,
    tags=["ai-scientist"],
)
def get_ai_run_events(
    project_id: str,
    run_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    after_sequence: Annotated[int, Query(ge=0)] = 0,
) -> AIRunEventsOutput:
    try:
        service = AIScientistService(session, identity, object_store, settings)
        return service.get_run_events(project_id, run_id, after_sequence=after_sequence)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/ai/approvals/{approval_id}/decision",
    response_model=AIRunView,
    tags=["ai-scientist"],
)
def decide_ai_approval(
    project_id: str,
    approval_id: str,
    payload: ApprovalDecisionInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> AIRunView:
    try:
        service = AIScientistService(session, identity, object_store, settings)
        return service.decide_approval(project_id, approval_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/external-imports",
    response_model=ExternalImportView,
    status_code=status.HTTP_201_CREATED,
    tags=["external-imports"],
)
def upload_external_import(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    upload: Annotated[UploadFile, File(description="Plain-text Gaussian or ORCA output")],
    idempotency_key: Annotated[str, Form(min_length=8, max_length=200)],
) -> ExternalImportView:
    """Safe ingestion, isolated parse, validation; returns a hash-bound PREVIEW only."""
    try:
        return create_external_import(
            session,
            identity,
            object_store,
            settings,
            project_id=project_id,
            original_name=upload.filename,
            stream=upload.file,
            idempotency_key=idempotency_key,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/external-imports",
    response_model=ExternalImportListOutput,
    tags=["external-imports"],
)
def list_project_external_imports(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> ExternalImportListOutput:
    try:
        return list_external_imports(session, identity, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/external-imports/{import_id}",
    response_model=ExternalImportDetail,
    tags=["external-imports"],
)
def get_project_external_import(
    project_id: str,
    import_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> ExternalImportDetail:
    try:
        return get_external_import_detail(
            session, identity, object_store, settings, project_id, import_id
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/external-imports/{import_id}/confirm",
    response_model=ExternalImportDetail,
    tags=["external-imports"],
)
def confirm_project_external_import(
    project_id: str,
    import_id: str,
    payload: ExternalImportConfirmInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> ExternalImportDetail:
    """Transactional import; needs the exact stored preview hash and an unchanged source."""
    try:
        return confirm_external_import(
            session,
            identity,
            object_store,
            settings,
            project_id=project_id,
            import_id=import_id,
            payload=payload,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/imported-results/{result_id}",
    response_model=ImportedResultView,
    tags=["external-imports"],
)
def get_project_imported_result(
    project_id: str,
    result_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> ImportedResultView:
    try:
        return get_imported_result(session, identity, project_id, result_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


def run() -> None:
    uvicorn.run("chemdft_api.main:app", host="127.0.0.1", port=8000, reload=False)


# ------------------------------------------------------------------------- experimental spectra
SPECTRA = "/v1/projects/{project_id}/experimental/spectra"


@app.post(
    f"{SPECTRA}/uploads",
    response_model=SpectrumUploadView,
    status_code=status.HTTP_201_CREATED,
    tags=["experimental-spectra"],
)
def upload_experimental_spectrum(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    upload: Annotated[
        UploadFile, File(description="Plain-text spectrum (CSV, TSV, TXT, whitespace)")
    ],
    technique: Annotated[SpectrumTechnique, Form()],
    idempotency_key: Annotated[str, Form(min_length=8, max_length=200)],
) -> SpectrumUploadView:
    """Safe ingestion, isolated parse, validation; a hash-bound PREVIEW only (no dataset)."""
    try:
        return create_spectrum_upload(
            session,
            identity,
            object_store,
            settings,
            project_id=project_id,
            technique=technique,
            original_name=upload.filename,
            stream=upload.file,
            idempotency_key=idempotency_key,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    f"{SPECTRA}/uploads", response_model=SpectrumUploadListOutput, tags=["experimental-spectra"]
)
def list_experimental_spectrum_uploads(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> SpectrumUploadListOutput:
    try:
        return list_spectrum_uploads(session, identity, object_store, settings, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    f"{SPECTRA}/uploads/{{upload_id}}",
    response_model=SpectrumUploadView,
    tags=["experimental-spectra"],
)
def get_experimental_spectrum_upload(
    project_id: str,
    upload_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> SpectrumUploadView:
    try:
        return get_spectrum_upload(session, identity, object_store, settings, project_id, upload_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    f"{SPECTRA}/uploads/{{upload_id}}/resolve",
    response_model=SpectrumUploadView,
    tags=["experimental-spectra"],
)
def resolve_experimental_spectrum_upload(
    project_id: str,
    upload_id: str,
    payload: SpectrumResolveInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> SpectrumUploadView:
    """Re-run the deterministic parser on the stored bytes with your choices: a new preview."""
    try:
        return resolve_spectrum_upload(
            session,
            identity,
            object_store,
            settings,
            project_id=project_id,
            upload_id=upload_id,
            choices=payload.choices,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    f"{SPECTRA}/uploads/{{upload_id}}/confirm",
    response_model=SpectrumDatasetView,
    status_code=status.HTTP_201_CREATED,
    tags=["experimental-spectra"],
)
def confirm_experimental_spectrum_upload(
    project_id: str,
    upload_id: str,
    payload: SpectrumConfirmInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> SpectrumDatasetView:
    """Transactional import of ONE immutable RAW dataset; needs the exact preview hash."""
    try:
        return confirm_spectrum_upload(
            session,
            identity,
            object_store,
            settings,
            project_id=project_id,
            upload_id=upload_id,
            payload=payload,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    f"{SPECTRA}/datasets", response_model=SpectrumDatasetListOutput, tags=["experimental-spectra"]
)
def list_experimental_spectrum_datasets(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> SpectrumDatasetListOutput:
    try:
        return list_spectrum_datasets(session, identity, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    f"{SPECTRA}/datasets/{{dataset_id}}",
    response_model=SpectrumDatasetView,
    tags=["experimental-spectra"],
)
def get_experimental_spectrum_dataset(
    project_id: str,
    dataset_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> SpectrumDatasetView:
    try:
        return get_spectrum_dataset(
            session, identity, object_store, settings, project_id, dataset_id
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    f"{SPECTRA}/datasets/{{dataset_id}}/arrays",
    response_model=SpectrumArraysView,
    tags=["experimental-spectra"],
)
def get_experimental_spectrum_arrays(
    project_id: str,
    dataset_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    max_points: Annotated[int | None, Query(ge=4, le=200_000)] = None,
) -> SpectrumArraysView:
    try:
        return get_spectrum_arrays(
            session, identity, object_store, settings, project_id, dataset_id, max_points
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    f"{SPECTRA}/datasets/{{dataset_id}}/transforms",
    response_model=SpectrumDatasetView,
    status_code=status.HTTP_201_CREATED,
    tags=["experimental-spectra"],
)
def create_experimental_spectrum_transform(
    project_id: str,
    dataset_id: str,
    payload: SpectrumTransformInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> SpectrumDatasetView:
    """User-triggered transform: a NEW derived dataset with a full record; parent unchanged."""
    try:
        return create_spectrum_transform(
            session,
            identity,
            object_store,
            settings,
            project_id=project_id,
            dataset_id=dataset_id,
            payload=payload,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    f"{SPECTRA}/datasets/{{dataset_id}}/peaks",
    response_model=SpectrumDatasetView,
    status_code=status.HTTP_201_CREATED,
    tags=["experimental-spectra"],
)
def create_experimental_spectrum_peaks(
    project_id: str,
    dataset_id: str,
    payload: SpectrumPeakInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> SpectrumDatasetView:
    """Deterministic peak detection; the peak set is DERIVED_NOT_RAW and keeps its parameters."""
    try:
        return create_spectrum_peaks(
            session,
            identity,
            object_store,
            settings,
            project_id=project_id,
            dataset_id=dataset_id,
            payload=payload,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.put(
    f"{SPECTRA}/datasets/{{dataset_id}}/association",
    response_model=SpectrumAssociationView,
    tags=["experimental-spectra"],
)
def set_experimental_spectrum_association(
    project_id: str,
    dataset_id: str,
    payload: SpectrumAssociationInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> SpectrumAssociationView:
    try:
        return set_spectrum_association(
            session, identity, project_id=project_id, dataset_id=dataset_id, payload=payload
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    f"{SPECTRA}/comparison-sources",
    response_model=CalculatedSourceListOutput,
    tags=["experimental-spectra"],
)
def list_experimental_spectrum_comparison_sources(
    project_id: str,
    technique: Annotated[SpectrumTechnique, Query()],
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> CalculatedSourceListOutput:
    try:
        return list_calculated_sources(session, identity, project_id, technique)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    f"{SPECTRA}/comparisons",
    response_model=SpectrumComparisonView,
    status_code=status.HTTP_201_CREATED,
    tags=["experimental-spectra"],
)
def create_experimental_spectrum_comparison(
    project_id: str,
    payload: SpectrumComparisonInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> SpectrumComparisonView:
    """Candidate matching of experimental peaks to calculated modes; never an assignment."""
    try:
        return create_spectrum_comparison(
            session, identity, object_store, settings, project_id=project_id, payload=payload
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    f"{SPECTRA}/comparisons",
    response_model=SpectrumComparisonListOutput,
    tags=["experimental-spectra"],
)
def list_experimental_spectrum_comparisons(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    experimental_dataset_id: Annotated[str | None, Query()] = None,
) -> SpectrumComparisonListOutput:
    try:
        return list_spectrum_comparisons(session, identity, project_id, experimental_dataset_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    f"{SPECTRA}/comparisons/{{comparison_id}}",
    response_model=SpectrumComparisonView,
    tags=["experimental-spectra"],
)
def get_experimental_spectrum_comparison(
    project_id: str,
    comparison_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> SpectrumComparisonView:
    try:
        return get_spectrum_comparison(session, identity, project_id, comparison_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/dispersion-corrections",
    response_model=CalculationDetail,
    status_code=status.HTTP_201_CREATED,
    tags=["calculations"],
)
def submit_dispersion_correction(
    project_id: str,
    payload: Dftd4SubmitInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> CalculationDetail:
    from .dftd4_actions import submit_correction

    try:
        return submit_correction(session, identity, object_store, settings, project_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/dispersion-corrections/capability",
    response_model=Dftd4Capability,
    tags=["calculations"],
)
def dispersion_correction_capability(
    project_id: str,
    source_result_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> Dftd4Capability:
    from .actions import authorize_project_access
    from .dftd4_source import load_source
    from .scientific.engines.dftd4 import environment_identity

    try:
        authorize_project_access(session, identity, project_id)
        load_source(session, object_store, settings, project_id, source_result_id)
        if settings.dftd4_executable is None:
            return Dftd4Capability(
                available=False, diagnostic="Pinned DFT-D4 4.2.0 is not configured."
            )
        environment_identity(settings.dftd4_executable)
        return Dftd4Capability(available=True)
    except ApplicationError as error:
        raise application_error_to_http(error) from error
    except (ValueError, TypeError, KeyError, OSError) as error:
        return Dftd4Capability(available=False, diagnostic=str(error))


@app.post(
    "/v1/projects/{project_id}/dispersion-corrections/{calculation_id}/retry",
    response_model=CalculationDetail,
    tags=["calculations"],
)
def retry_dispersion_correction(
    project_id: str,
    calculation_id: str,
    payload: Dftd4RetryInput,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> CalculationDetail:
    from .dftd4_actions import retry_correction

    try:
        return retry_correction(
            session, identity, object_store, settings, project_id, calculation_id, payload
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/results/{result_id}",
    response_model=CalculationResult,
    tags=["calculations"],
)
def read_scientific_result(
    project_id: str,
    result_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
):
    from .result_read_actions import get_result

    try:
        return get_result(session, identity, project_id, result_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/results",
    response_model=list[CalculationResult],
    tags=["calculations"],
)
def list_scientific_results(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
):
    from .result_read_actions import list_results

    try:
        return list_results(session, identity, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get("/v1/projects/{project_id}/results/{result_id}/export", tags=["calculations"])
@app.get("/v1/projects/{project_id}/results/{result_id}/provenance", tags=["calculations"])
def export_scientific_result(
    project_id: str,
    result_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
):
    from .result_read_actions import result_lineage_export
    from .scientific.engines.psi4 import encode

    try:
        document = result_lineage_export(session, identity, project_id, result_id)
        return attachment_response(
            f"result-{result_id}-historical-lineage.json",
            "application/json",
            encode(document),
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


# ---- RW-2: analysis exports, calculation comparison and job diagnostics -----------------------


@app.get(
    "/v1/projects/{project_id}/calculations/{calculation_id}/exports",
    response_model=CalculationExportCatalog,
    tags=["exports"],
)
def get_calculation_export_catalog(
    project_id: str,
    calculation_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> CalculationExportCatalog:
    try:
        return export_catalog(session, identity, project_id, calculation_id, object_store, settings)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get("/v1/projects/{project_id}/calculations/{calculation_id}/export", tags=["exports"])
def export_calculation_data(
    project_id: str,
    calculation_id: str,
    export_format: Annotated[str, Query(alias="format", min_length=1, max_length=40)],
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
    variant: Annotated[str | None, Query(max_length=96)] = None,
) -> Response:
    try:
        export = build_export(
            session,
            identity,
            object_store,
            settings,
            project_id,
            calculation_id,
            export_format,
            variant,
        )
        return attachment_response(
            export.filename,
            export.media_type,
            export.content,
            effective=export.effective,
            extra_headers=(
                {"X-ChemDFT-Evidence-Use": "NO_RESULT"} if export.effective is False else None
            ),
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/calculation-comparison/candidates",
    response_model=ComparisonCandidateListOutput,
    tags=["calculation comparison"],
)
def list_project_comparison_candidates(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> ComparisonCandidateListOutput:
    try:
        return list_comparison_candidates(session, identity, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/calculation-comparison",
    response_model=CalculationComparisonOutput,
    tags=["calculation comparison"],
)
def read_project_calculation_comparison(
    project_id: str,
    result_id: Annotated[list[str], Query(max_length=8)],
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> CalculationComparisonOutput:
    try:
        return compare_results(session, identity, project_id, result_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get("/v1/projects/{project_id}/calculation-comparison/export", tags=["calculation comparison"])
def export_project_calculation_comparison(
    project_id: str,
    result_id: Annotated[list[str], Query(max_length=8)],
    export_format: Annotated[Literal["csv", "json"], Query(alias="format")],
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    try:
        output = compare_results(session, identity, project_id, result_id)
        if export_format == "csv":
            return attachment_response(
                "calculation-comparison.csv", "text/csv; charset=utf-8", comparison_csv(output)
            )
        return attachment_response(
            "calculation-comparison.json", "application/json", comparison_json(output)
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/compute/jobs/{job_id}/diagnostics",
    response_model=JobDiagnostics,
    tags=["compute"],
)
def get_project_job_diagnostics(
    project_id: str,
    job_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> JobDiagnostics:
    try:
        return get_job_diagnostics(session, identity, settings, project_id, job_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/compute/jobs/{job_id}/logs/{artifact_id}",
    response_model=JobLogOutput,
    tags=["compute"],
)
def read_project_job_log(
    project_id: str,
    job_id: str,
    artifact_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> JobLogOutput:
    try:
        return read_job_log(
            session, identity, object_store, settings, project_id, job_id, artifact_id
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


# ---- RW-3: researcher workflows (results overview, saved comparisons, reports, reuse, queue) --


@app.get(
    "/v1/projects/{project_id}/published-results",
    response_model=PublishedResultsPage,
    tags=["research workflows"],
)
def read_project_published_results(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    task: Annotated[str | None, Query(max_length=64)] = None,
    engine: Annotated[str | None, Query(max_length=64)] = None,
    standing: Annotated[Literal["current", "historical"] | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    sort: Annotated[Literal["updated", "task", "engine", "formula", "energy"], Query()] = "updated",
    direction: Annotated[Literal["asc", "desc"], Query()] = "desc",
    result_id: Annotated[list[str] | None, Query(max_length=16)] = None,
) -> PublishedResultsPage:
    from .published_results import get_published_results_page

    try:
        return get_published_results_page(
            session, identity, project_id, limit=limit, cursor=cursor, task=task, engine=engine,
            standing=standing, text=q, sort=sort, direction=direction, result_ids=result_id,
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/research-overview",
    response_model=ResearchOverview,
    tags=["research workflows"],
)
def read_project_research_overview(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> ResearchOverview:
    from .research_overview import get_research_overview

    try:
        return get_research_overview(session, identity, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/saved-comparisons",
    response_model=SavedComparisonListOutput,
    tags=["research workflows"],
)
def list_project_saved_comparisons(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> SavedComparisonListOutput:
    from .saved_comparisons import list_saved_comparisons

    try:
        return list_saved_comparisons(session, identity, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/saved-comparisons",
    response_model=SavedComparisonSummary,
    status_code=status.HTTP_201_CREATED,
    tags=["research workflows"],
)
def create_project_saved_comparison(
    project_id: str,
    payload: SavedComparisonCreate,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> SavedComparisonSummary:
    from .saved_comparisons import create_saved_comparison

    try:
        return create_saved_comparison(session, identity, project_id, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/saved-comparisons/{saved_comparison_id}",
    response_model=SavedComparisonOpenOutput,
    tags=["research workflows"],
)
def open_project_saved_comparison(
    project_id: str,
    saved_comparison_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> SavedComparisonOpenOutput:
    from .saved_comparisons import open_saved_comparison

    try:
        return open_saved_comparison(session, identity, project_id, saved_comparison_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.post(
    "/v1/projects/{project_id}/saved-comparisons/{saved_comparison_id}/archive",
    response_model=SavedComparisonSummary,
    tags=["research workflows"],
)
def archive_project_saved_comparison(
    project_id: str,
    saved_comparison_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> SavedComparisonSummary:
    from .saved_comparisons import archive_saved_comparison

    try:
        return archive_saved_comparison(session, identity, project_id, saved_comparison_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get("/v1/projects/{project_id}/scientific-report", tags=["research workflows"])
def export_project_scientific_report(
    project_id: str,
    report_format: Annotated[Literal["html", "markdown", "json"], Query(alias="format")],
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    result_id: Annotated[list[str] | None, Query(max_length=8)] = None,
    saved_comparison_id: Annotated[str | None, Query(max_length=64)] = None,
) -> Response:
    from .scientific_report import build_report_document, render_report

    try:
        if bool(result_id) == bool(saved_comparison_id):
            raise ScientificValidationFailed(
                "Select result ids or one saved comparison, not both and not neither."
            )
        document = build_report_document(
            session,
            identity,
            project_id,
            list(result_id or []),
            saved_comparison_id=saved_comparison_id,
        )
        content, media_type, extension = render_report(document, report_format)
        return attachment_response(
            f"chemdft-report-{document['generated_at'][:10]}.{extension}",
            media_type,
            content,
            # Conservative for a mix: CURRENT only when every included result is current.
            extra_headers={"X-ChemDFT-Evidence-Use": document["evidence_use"]},
        )
    except ApplicationError as error:
        raise application_error_to_http(error) from error


# ---- Project-level exports (Release 0.0.13: 3D PDF, Report PDF, HTML, Archive) -----------------


@app.get("/v1/export/capabilities", tags=["project exports"])
def get_export_capabilities() -> dict[str, Any]:
    """Returns the availability and status of server export engines."""
    from .pdf_export import check_3d_pdf_capability

    available_3d, reason_3d = check_3d_pdf_capability()
    return {
        "export_3d_pdf_available": available_3d,
        "export_3d_pdf_reason": (
            f"Requires Asymptote server toolchain and Adobe Acrobat on client ({reason_3d})."
            if not available_3d
            else "Available (Adobe Acrobat required on client for 3D interaction)."
        ),
        "export_report_pdf_available": True,
        "export_html_available": True,
        "export_archive_available": True,
    }


@app.get("/v1/projects/{project_id}/export/3d-pdf", tags=["project exports"])
def export_project_3d_pdf_endpoint(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    structure_version_id: Annotated[str | None, Query(max_length=64)] = None,
) -> Response:
    from .pdf_export import check_3d_pdf_capability
    from .project_export import authorize_project_access, export_project_3d_pdf

    try:
        authorize_project_access(session, identity, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error

    available_3d, reason_3d = check_3d_pdf_capability()
    if not available_3d:
        raise HTTPException(
            status_code=501,
            detail={
                "error": "3d_pdf_not_available",
                "message": (
                    "3D PDF export is currently IN TESTING and not available on this server."
                ),
                "reason": reason_3d,
            },
        )

    try:
        filename, media_type, payload = export_project_3d_pdf(
            session, identity, project_id, structure_version_id
        )
        return attachment_response(filename, media_type, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get("/v1/projects/{project_id}/export/report-pdf", tags=["project exports"])
def export_project_report_pdf_endpoint(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    structure_version_id: Annotated[str | None, Query(max_length=64)] = None,
) -> Response:
    from .project_export import export_project_report_pdf

    try:
        filename, media_type, payload = export_project_report_pdf(
            session, identity, project_id, structure_version_id
        )
        return attachment_response(filename, media_type, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get("/v1/projects/{project_id}/export/html", tags=["project exports"])
def export_project_html_endpoint(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    structure_version_id: Annotated[str | None, Query(max_length=64)] = None,
) -> Response:
    from .project_export import export_project_interactive_html

    try:
        filename, media_type, payload = export_project_interactive_html(
            session, identity, project_id, structure_version_id
        )
        return attachment_response(filename, media_type, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get("/v1/projects/{project_id}/export/archive", tags=["project exports"])
def export_project_archive_endpoint(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    from .project_export import export_project_archive_zip

    try:
        filename, media_type, payload = export_project_archive_zip(session, identity, project_id)
        return attachment_response(filename, media_type, payload)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/calculations/{calculation_id}/reuse-plan",
    response_model=ReusePlan,
    tags=["research workflows"],
)
def read_calculation_reuse_plan(
    project_id: str,
    calculation_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> ReusePlan:
    from .calculation_reuse import get_reuse_plan

    try:
        return get_reuse_plan(session, identity, object_store, settings, project_id, calculation_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.get(
    "/v1/projects/{project_id}/compute/queue-status",
    response_model=QueueStatus,
    tags=["compute"],
)
def read_project_queue_status(
    project_id: str,
    identity: Annotated[Identity, Depends(require_identity)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> QueueStatus:
    from .compute_queue import get_queue_status

    try:
        return get_queue_status(session, identity, settings, project_id)
    except ApplicationError as error:
        raise application_error_to_http(error) from error


@app.middleware("http")
async def scientific_state_cache_policy(request, call_next):
    """Project reads embed read-time scientific state (effective authority, lineage, evidence use).

    A cached copy could therefore present a result as authoritative after its source was
    retracted or superseded. Every safe-method project response is `no-store` unless the route
    already chose its own policy. The path is deliberately not allow-listed: claims, comparisons,
    investigations, exports, Navigator and AI context all derive from the same state, and a missed
    path would be a stale-authority bug. Writes are never cached and need no header.
    """
    response = await call_next(request)
    if request.method in {"GET", "HEAD"} and request.url.path.startswith("/v1/projects/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response
