# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from .ai import (
    AIApprovalView,
    AICitation,
    AIConversationDetail,
    AIConversationListOutput,
    AIConversationSummary,
    AIMessageView,
    AIRunEventsOutput,
    AIRunEventView,
    AIRunStepView,
    AIRunView,
    ApprovalDecisionInput,
    CreateConversationInput,
    DrawInput,
    DrawResponse,
    PostMessageInput,
    ResearcherGateView,
)
from .ai_foundation import (
    AIExamplesOutput,
    AIPreferencesInput,
    AISettingsView,
    AIToolPolicy,
    ProductContext,
    ProductSelection,
)
from .ai_performance import AIModelPerformanceView
from .ai_planning import (
    EnergyPlanningContext,
    PeriodicEnergyPlanningContext,
    StructureEditPlanningContext,
)
from .analysis import (
    CalculationComparisonOutput,
    CalculationExportCatalog,
    CalculationPairComparison,
    ComparisonCandidateListOutput,
    JobDiagnostics,
    JobLogOutput,
    ResultSummary,
)
from .artifacts import ScientificArtifact, ScientificArtifactRegistration
from .audit import AuditEvent
from .base import ArtifactReference, ContractModel, EntityReference
from .billing import (
    AIUsageSummary,
    AllowancePeriodView,
    BillingSnapshot,
    BYOKCredentialInput,
    BYOKRevocationInput,
    BYOKStatusView,
    CheckoutSessionView,
    ComputeUsageSummary,
    CreateCheckoutInput,
    EntitlementSnapshot,
    InvoiceView,
    Money,
    ReconciliationView,
)
from .catalog import (
    CalculationDetail,
    CalculationGetInput,
    CalculationSubmitInput,
    ComputeEstimate,
    ComputeExecutionView,
    ComputeJobListOutput,
    ComputeJobView,
    ComputeRequirement,
    ComputeReservationView,
    EngineCapabilityView,
    ExecutionRequest,
    ExperimentDatasetImportInput,
    JobSpecificationSummary,
    OptimizationTrajectory,
    ProjectCreateInput,
    ProjectGetInput,
    ProjectListInput,
    ProjectListOutput,
    ProjectSummary,
    ResultCompareInput,
    StructureEditCoordinateSet,
    StructureImportInput,
    StructureImportOutput,
    StructureSummary,
    StructureVersionCreateInput,
    StructureVersionCreateOutput,
    StructureVersionDetail,
    StructureVersionProvenance,
    VisualizationSceneGetInput,
)
from .conformers import ConformerEnsembleManifest, ConformerEnsembleMember, ConformerEnsembleResult
from .dftd4 import Dftd4Capability, Dftd4RetryInput, Dftd4SubmitInput
from .examples import ExampleCopyOutput, ExampleDetail, ExampleSummary
from .experimental_spectra import (
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
    SpectrumPreviewBody,
    SpectrumResolveInput,
    SpectrumTransformInput,
    SpectrumUploadListOutput,
    SpectrumUploadView,
)
from .external_import import (
    ExternalImportConfirmInput,
    ExternalImportDetail,
    ExternalImportListOutput,
    ExternalImportView,
    ImportedResultView,
    ImportPreviewReport,
)
from .geometry import (
    GeometryCandidateAcceptInput,
    GeometryCandidateAcceptOutput,
    GeometryCandidateListOutput,
    GeometryCandidateView,
    GeometryEligibility,
    MolecularDrawingGenerateInput,
)
from .investigations import (
    CreateAssessmentInput,
    CreateHypothesisInput,
    CreateInvestigationInput,
    CreateObservationInput,
    CreatePlanInput,
    InvestigationAssessmentView,
    InvestigationGetInput,
    InvestigationHypothesisView,
    InvestigationListOutput,
    InvestigationObservationView,
    InvestigationPlanView,
    InvestigationPolicy,
    InvestigationStepView,
    InvestigationView,
)
from .knowledge import (
    KnowledgeIndexStatus,
    KnowledgeItemView,
    KnowledgeRetrievalResult,
    KnowledgeSearchFilters,
    KnowledgeSearchInput,
    KnowledgeSearchOutput,
    ProjectMemoryCreateInput,
    ProjectMemoryListOutput,
    ProjectMemoryView,
)
from .molecule_tools import (
    MoleculeAlternative,
    MoleculeDraftCreateInput,
    MoleculeDraftCreateOutput,
    MoleculeResolveInput,
    MoleculeResolveOutput,
)
from .navigator import NavigatorState
from .phase7 import (
    DigitizedDatasetInput,
    DigitizerCalibration,
    DigitizerPoint,
    EvidenceCandidate,
    EvidenceReviewInput,
    EvidenceReviewOutput,
    ExperimentalDatasetListOutput,
    ExperimentalDatasetView,
    ExperimentalImportInput,
    GraphAxisCalibration,
    GraphDigitizationSession,
    GraphDigitizedDatasetInput,
    GraphDigitizedPoint,
    GraphDigitizedPointInput,
    ScientificDocument,
    ScientificDocumentImportOutput,
    ScientificDocumentListOutput,
    SourceAnchor,
    SourcePixelPoint,
    SourcePixelRegion,
    XrdAxisCalibration,
    XrdDigitizationSession,
    XrdDigitizedDatasetInput,
    XrdDigitizedPoint,
    XrdDigitizedPointInput,
    XrdReportedPeak,
)
from .provenance import (
    Citation,
    Evidence,
    Hypothesis,
    KnowledgeSource,
    ProvenanceRecord,
    UserCorrection,
    VerificationRecord,
)
from .qcschema import QCSchemaAtomicInputV2
from .results import (
    AuthoritativeResultSubmission,
    CalculationResult,
    DominantTransition,
    EnergyResult,
    ExcitedState,
    MolecularOrbital,
    MolecularOrbitalAnalysis,
    MolecularOrbitalGridManifest,
    MolecularOrbitalGridOutput,
    MolecularOrbitalGridRequest,
    OptimizationResult,
    OrbitalFrontier,
    PeriodicEnergyResult,
    TddftResult,
    ThermochemistryResult,
    VibrationalAnalysis,
)
from .scientific import (
    Calculation,
    CalculationAttempt,
    CalculationInput,
    CalculationSpecification,
    Conformer,
    ConformerSearchOptions,
    EnginePreference,
    EngineReference,
    Experiment,
    ExperimentalDataset,
    ExperimentalSeries,
    HessianOptions,
    OptimizationOptions,
    PeriodicOptions,
    Sample,
    Spectrum,
    Structure,
    StructureVersion,
    TddftOptions,
    ThermochemistryOptions,
)
from .scientific_claims import (
    ProjectScientificClaimsOutput,
    ProjectScientificComparisonOutput,
    ScientificClaim,
    ScientificClaimRelation,
    ScientificComparisonRow,
    ScientificComparisonSummary,
)
from .structure_candidates import (
    CandidateCellParameters,
    CandidateCoordinatePasteInput,
    CandidateCoordinateRepresentation,
    CandidateCoordinates,
    CandidateRepresentationCreateInput,
    CandidateRepresentationCreateOutput,
    CandidateRepresentationDetail,
    CandidateRepresentationListInput,
    CandidateRepresentationListOutput,
    CandidateRepresentationRejectInput,
    CandidateRepresentationReviewInput,
    CandidateRepresentationReviewOutput,
    CandidateRepresentationView,
    ConformerGenerationInput,
    DocumentFiguresExtractOutput,
    MolecularGraphValidateInput,
    MolecularGraphValidateOutput,
    StructureCandidate,
    StructureCandidateGetInput,
    StructureCandidateListInput,
    StructureCandidateListOutput,
    StructureCandidatePromotionOutput,
    StructureCandidateRecognizeOutput,
    StructureCandidateRejectInput,
    StructureCandidateRequestReviewOutput,
    StructureCandidateReviewInput,
    StructureCandidateReviewOutput,
)
from .structure_tools import (
    StructureEditDiffView,
    StructureEditOperation,
    StructureEditProposeInput,
    StructureEditProposeOutput,
)
from .tools import ToolDefinition, ToolInvocationRecord
from .volumetric import (
    SurfacePotentialStatistics,
    VolumetricFieldManifest,
    VolumetricFieldOutput,
    VolumetricFieldRequest,
)
from .workflows import (
    PublishedResultsPage,
    QueueStatus,
    ResearchOverview,
    ReusePlan,
    SavedComparisonListOutput,
    SavedComparisonOpenOutput,
    SavedComparisonSummary,
)


class ContractBundle(ContractModel):
    dftd4_retry_input: Dftd4RetryInput
    dftd4_submit_input: Dftd4SubmitInput
    dftd4_capability: Dftd4Capability
    molecular_drawing_generate_input: MolecularDrawingGenerateInput
    geometry_candidate_view: GeometryCandidateView
    geometry_candidate_accept_input: GeometryCandidateAcceptInput
    geometry_candidate_accept_output: GeometryCandidateAcceptOutput
    geometry_candidate_list_output: GeometryCandidateListOutput
    geometry_eligibility: GeometryEligibility
    ai_examples_output: AIExamplesOutput
    product_context: ProductContext
    energy_planning_context: EnergyPlanningContext
    product_selection: ProductSelection
    ai_settings_view: AISettingsView
    ai_preferences_input: AIPreferencesInput
    ai_tool_policy: AIToolPolicy
    example_summary: ExampleSummary
    example_detail: ExampleDetail
    example_copy_output: ExampleCopyOutput
    navigator_state: NavigatorState
    """Generation root; not a wire payload."""

    entity_reference: EntityReference
    artifact_reference: ArtifactReference
    sample: Sample
    structure: Structure
    structure_version: StructureVersion
    conformer: Conformer
    conformer_search_options: ConformerSearchOptions
    conformer_ensemble_member: ConformerEnsembleMember
    conformer_ensemble_manifest: ConformerEnsembleManifest
    conformer_ensemble_result: ConformerEnsembleResult
    experiment: Experiment
    experimental_dataset: ExperimentalDataset
    spectrum: Spectrum
    experimental_series: ExperimentalSeries
    calculation: Calculation
    calculation_attempt: CalculationAttempt
    calculation_specification: CalculationSpecification
    engine_preference: EnginePreference
    engine_execution_identity: EngineReference
    calculation_input: CalculationInput
    calculation_result: CalculationResult
    energy_result: EnergyResult
    optimization_result: OptimizationResult
    vibrational_analysis: VibrationalAnalysis
    molecular_orbital: MolecularOrbital
    molecular_orbital_analysis: MolecularOrbitalAnalysis
    molecular_orbital_grid_manifest: MolecularOrbitalGridManifest
    molecular_orbital_grid_output: MolecularOrbitalGridOutput
    molecular_orbital_grid_request: MolecularOrbitalGridRequest
    volumetric_field_request: VolumetricFieldRequest
    volumetric_field_manifest: VolumetricFieldManifest
    volumetric_field_output: VolumetricFieldOutput
    surface_potential_statistics: SurfacePotentialStatistics
    orbital_frontier: OrbitalFrontier
    optimization_trajectory: OptimizationTrajectory
    optimization_options: OptimizationOptions
    hessian_options: HessianOptions
    tddft_options: TddftOptions
    tddft_result: TddftResult
    thermochemistry_options: ThermochemistryOptions
    thermochemistry_result: ThermochemistryResult
    periodic_options: PeriodicOptions
    periodic_energy_result: PeriodicEnergyResult
    external_import_view: ExternalImportView
    external_import_detail: ExternalImportDetail
    external_import_list_output: ExternalImportListOutput
    external_import_confirm_input: ExternalImportConfirmInput
    imported_result_view: ImportedResultView
    spectrum_upload_view: SpectrumUploadView
    spectrum_upload_list_output: SpectrumUploadListOutput
    spectrum_preview_body: SpectrumPreviewBody
    spectrum_resolve_input: SpectrumResolveInput
    spectrum_confirm_input: SpectrumConfirmInput
    spectrum_dataset_view: SpectrumDatasetView
    spectrum_dataset_list_output: SpectrumDatasetListOutput
    spectrum_arrays_view: SpectrumArraysView
    spectrum_transform_input: SpectrumTransformInput
    spectrum_peak_input: SpectrumPeakInput
    spectrum_association_input: SpectrumAssociationInput
    spectrum_association_view: SpectrumAssociationView
    spectrum_comparison_input: SpectrumComparisonInput
    spectrum_comparison_view: SpectrumComparisonView
    spectrum_comparison_list_output: SpectrumComparisonListOutput
    calculated_source_list_output: CalculatedSourceListOutput
    import_preview_report: ImportPreviewReport
    excited_state: ExcitedState
    dominant_transition: DominantTransition
    authoritative_result_submission: AuthoritativeResultSubmission
    scientific_artifact: ScientificArtifact
    scientific_artifact_registration: ScientificArtifactRegistration
    provenance_record: ProvenanceRecord
    evidence: Evidence
    hypothesis: Hypothesis
    user_correction: UserCorrection
    citation: Citation
    knowledge_source: KnowledgeSource
    verification_record: VerificationRecord
    audit_event: AuditEvent
    tool_definition: ToolDefinition
    tool_invocation_record: ToolInvocationRecord
    structure_version_create_input: StructureVersionCreateInput
    structure_version_create_output: StructureVersionCreateOutput
    structure_edit_coordinate_set: StructureEditCoordinateSet
    structure_import_input: StructureImportInput
    structure_import_output: StructureImportOutput
    structure_summary: StructureSummary
    structure_version_detail: StructureVersionDetail
    structure_version_provenance: StructureVersionProvenance
    calculation_submit_input: CalculationSubmitInput
    calculation_get_input: CalculationGetInput
    calculation_detail: CalculationDetail
    compute_requirement: ComputeRequirement
    compute_estimate: ComputeEstimate
    compute_reservation_view: ComputeReservationView
    execution_request: ExecutionRequest
    compute_execution_view: ComputeExecutionView
    compute_job_view: ComputeJobView
    compute_job_list_output: ComputeJobListOutput
    engine_capability_view: EngineCapabilityView
    result_compare_input: ResultCompareInput
    experiment_dataset_import_input: ExperimentDatasetImportInput
    visualization_scene_get_input: VisualizationSceneGetInput
    qcschema_atomic_input_v2: QCSchemaAtomicInputV2
    project_list_input: ProjectListInput
    project_get_input: ProjectGetInput
    project_create_input: ProjectCreateInput
    project_summary: ProjectSummary
    project_list_output: ProjectListOutput
    scientific_document: ScientificDocument
    scientific_document_import_output: ScientificDocumentImportOutput
    scientific_document_list_output: ScientificDocumentListOutput
    source_anchor: SourceAnchor
    evidence_candidate: EvidenceCandidate
    evidence_review_input: EvidenceReviewInput
    evidence_review_output: EvidenceReviewOutput
    digitizer_point: DigitizerPoint
    digitizer_calibration: DigitizerCalibration
    digitized_dataset_input: DigitizedDatasetInput
    source_pixel_point: SourcePixelPoint
    source_pixel_region: SourcePixelRegion
    xrd_axis_calibration: XrdAxisCalibration
    xrd_digitized_point_input: XrdDigitizedPointInput
    xrd_digitized_point: XrdDigitizedPoint
    xrd_reported_peak: XrdReportedPeak
    graph_axis_calibration: GraphAxisCalibration
    graph_digitization_session: GraphDigitizationSession
    graph_digitized_dataset_input: GraphDigitizedDatasetInput
    graph_digitized_point: GraphDigitizedPoint
    graph_digitized_point_input: GraphDigitizedPointInput
    xrd_digitization_session: XrdDigitizationSession
    xrd_digitized_dataset_input: XrdDigitizedDatasetInput
    experimental_import_input: ExperimentalImportInput
    experimental_dataset_view: ExperimentalDatasetView
    experimental_dataset_list_output: ExperimentalDatasetListOutput
    structure_candidate: StructureCandidate
    candidate_coordinates: CandidateCoordinates
    candidate_coordinate_representation: CandidateCoordinateRepresentation
    candidate_cell_parameters: CandidateCellParameters
    candidate_coordinate_paste_input: CandidateCoordinatePasteInput
    candidate_representation_view: CandidateRepresentationView
    structure_candidate_list_input: StructureCandidateListInput
    structure_candidate_get_input: StructureCandidateGetInput
    structure_candidate_list_output: StructureCandidateListOutput
    structure_candidate_review_input: StructureCandidateReviewInput
    structure_candidate_reject_input: StructureCandidateRejectInput
    structure_candidate_review_output: StructureCandidateReviewOutput
    structure_candidate_promotion_output: StructureCandidatePromotionOutput
    candidate_representation: CandidateRepresentationDetail
    candidate_representation_create_input: CandidateRepresentationCreateInput
    candidate_representation_create_output: CandidateRepresentationCreateOutput
    candidate_representation_list_input: CandidateRepresentationListInput
    candidate_representation_list_output: CandidateRepresentationListOutput
    candidate_representation_review_input: CandidateRepresentationReviewInput
    candidate_representation_reject_input: CandidateRepresentationRejectInput
    candidate_representation_review_output: CandidateRepresentationReviewOutput
    molecular_graph_validate_input: MolecularGraphValidateInput
    molecular_graph_validate_output: MolecularGraphValidateOutput
    document_figures_extract_output: DocumentFiguresExtractOutput
    structure_candidate_recognize_output: StructureCandidateRecognizeOutput
    structure_candidate_request_review_output: StructureCandidateRequestReviewOutput
    conformer_generation_input: ConformerGenerationInput
    ai_citation: AICitation
    ai_message_view: AIMessageView
    ai_approval_view: AIApprovalView
    ai_run_step_view: AIRunStepView
    researcher_gate_view: ResearcherGateView
    ai_run_view: AIRunView
    ai_run_event_view: AIRunEventView
    ai_run_events_output: AIRunEventsOutput
    ai_conversation_summary: AIConversationSummary
    ai_conversation_detail: AIConversationDetail
    ai_conversation_list_output: AIConversationListOutput
    create_conversation_input: CreateConversationInput
    post_message_input: PostMessageInput
    draw_input: DrawInput
    draw_response: DrawResponse
    approval_decision_input: ApprovalDecisionInput
    knowledge_search_filters: KnowledgeSearchFilters
    knowledge_search_input: KnowledgeSearchInput
    knowledge_retrieval_result: KnowledgeRetrievalResult
    knowledge_search_output: KnowledgeSearchOutput
    knowledge_index_status: KnowledgeIndexStatus
    knowledge_item_view: KnowledgeItemView
    project_memory_create_input: ProjectMemoryCreateInput
    project_memory_view: ProjectMemoryView
    project_memory_list_output: ProjectMemoryListOutput
    investigation_policy: InvestigationPolicy
    create_investigation_input: CreateInvestigationInput
    create_hypothesis_input: CreateHypothesisInput
    create_plan_input: CreatePlanInput
    create_observation_input: CreateObservationInput
    create_assessment_input: CreateAssessmentInput
    investigation_hypothesis_view: InvestigationHypothesisView
    investigation_step_view: InvestigationStepView
    investigation_plan_view: InvestigationPlanView
    investigation_observation_view: InvestigationObservationView
    investigation_assessment_view: InvestigationAssessmentView
    investigation_view: InvestigationView
    investigation_list_output: InvestigationListOutput
    investigation_get_input: InvestigationGetInput
    money: Money
    entitlement_snapshot: EntitlementSnapshot
    allowance_period_view: AllowancePeriodView
    ai_usage_summary: AIUsageSummary
    compute_usage_summary: ComputeUsageSummary
    byok_status_view: BYOKStatusView
    invoice_view: InvoiceView
    reconciliation_view: ReconciliationView
    billing_snapshot: BillingSnapshot
    create_checkout_input: CreateCheckoutInput
    checkout_session_view: CheckoutSessionView
    byok_credential_input: BYOKCredentialInput
    byok_revocation_input: BYOKRevocationInput
    scientific_claim: ScientificClaim
    scientific_claim_relation: ScientificClaimRelation
    project_scientific_claims_output: ProjectScientificClaimsOutput
    scientific_comparison_row: ScientificComparisonRow
    scientific_comparison_summary: ScientificComparisonSummary
    project_scientific_comparison_output: ProjectScientificComparisonOutput
    calculation_export_catalog: CalculationExportCatalog
    result_summary: ResultSummary
    calculation_comparison_output: CalculationComparisonOutput
    calculation_pair_comparison: CalculationPairComparison
    comparison_candidate_list_output: ComparisonCandidateListOutput
    job_diagnostics: JobDiagnostics
    job_specification_summary: JobSpecificationSummary
    job_log_output: JobLogOutput
    research_overview: ResearchOverview
    published_results_page: PublishedResultsPage
    saved_comparison_summary: SavedComparisonSummary
    saved_comparison_list_output: SavedComparisonListOutput
    saved_comparison_open_output: SavedComparisonOpenOutput
    reuse_plan: ReusePlan
    queue_status: QueueStatus
    molecule_alternative: MoleculeAlternative
    molecule_resolve_input: MoleculeResolveInput
    molecule_resolve_output: MoleculeResolveOutput
    molecule_draft_create_input: MoleculeDraftCreateInput
    molecule_draft_create_output: MoleculeDraftCreateOutput
    ai_model_performance_view: AIModelPerformanceView
    structure_edit_operation: StructureEditOperation
    structure_edit_diff_view: StructureEditDiffView
    structure_edit_propose_input: StructureEditProposeInput
    structure_edit_propose_output: StructureEditProposeOutput
    periodic_energy_planning_context: PeriodicEnergyPlanningContext
    structure_edit_planning_context: StructureEditPlanningContext
