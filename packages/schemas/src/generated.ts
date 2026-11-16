// SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
// SPDX-License-Identifier: Apache-2.0
/* Generated from ChemDFT Pydantic contracts. Do not edit. */

export type ActionFingerprint = string;
export type CreatedAt = string;
export type CreatesOrChanges = string;
/**
 * @maxItems 16
 */
export type Assumptions =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
export type Confidence = "LOW" | "MEDIUM" | "HIGH";
export type Currency = string;
export type MinorUnits = number;
export type CreatedAt1 = string;
export type Id = string;
export type ProjectId = string;
export type Provider = "local" | "modal" | "aws";
export type ProviderSummary = string;
export type RequirementHash = string;
export type RuntimeHighSeconds = number | null;
export type RuntimeLowSeconds = number | null;
export type ValidUntil = string;
export type ExpiresAt = string;
export type Id1 = string;
export type ProjectId1 = string | null;
export type Eligibility = ("STANDARD" | "DEVELOPMENT" | "NONE") | null;
export type Model = string;
export type Provider1 = string;
export type RepairAttempts = number;
export type ChatTemplateKwargs = {
  [k: string]: boolean;
} | null;
export type Source = "MODEL_CARD_PROFILE" | "SERVER_DEFAULT";
export type Temperature = number;
export type TopP = number | null;
export type Reason = string;
/**
 * @maxItems 9
 */
export type RequestMatch =
  | []
  | [RequestMatchItem]
  | [RequestMatchItem, RequestMatchItem]
  | [RequestMatchItem, RequestMatchItem, RequestMatchItem]
  | [RequestMatchItem, RequestMatchItem, RequestMatchItem, RequestMatchItem]
  | [RequestMatchItem, RequestMatchItem, RequestMatchItem, RequestMatchItem, RequestMatchItem]
  | [RequestMatchItem, RequestMatchItem, RequestMatchItem, RequestMatchItem, RequestMatchItem, RequestMatchItem]
  | [
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
    ]
  | [
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
    ]
  | [
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
      RequestMatchItem,
    ];
export type Excluded = boolean;
export type Mention = string | null;
export type Outcome = "MATCH" | "MISMATCH" | "NOT_SPECIFIED" | "AMBIGUOUS";
export type Parameter = string;
export type Proposed = string | number | boolean | null;
export type Requested = string | number | null;
export type RequestedAvailable = boolean | null;
export type RunId = string;
export type SchemaVersion = "1.0.0";
export type ScientificSummary = string;
export type Status = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
export type ToolName = string;
export type ToolVersion = string;
export type CitationId = string | null;
export type CitationType = "DOCUMENT" | "CALCULATION" | "STRUCTURE" | "DATASET" | "PROJECT_RECORD";
export type EntityId = string;
export type KnowledgeChunkId = string | null;
export type Label = string;
export type PageNumber = number | null;
export type ReferenceText = string;
export type SchemaVersion1 = "1.0.0";
export type SourceAnchorId = string | null;
export type SourceRecordType = string | null;
export type CreatedAt2 = string;
export type Id2 = string;
export type ProjectId2 = string;
export type SchemaVersion2 = "1.0.0";
export type Title = string | null;
export type UpdatedAt = string;
export type AiModel = string | null;
export type AiProvider = string | null;
export type Attempts = number;
export type Code = string;
/**
 * @maxItems 8
 */
export type Issues =
  | []
  | [BlockerIssue]
  | [BlockerIssue, BlockerIssue]
  | [BlockerIssue, BlockerIssue, BlockerIssue]
  | [BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue]
  | [BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue]
  | [BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue]
  | [BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue]
  | [BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue, BlockerIssue];
/**
 * @maxItems 8
 */
export type Allowed =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string];
export type Code1 = string;
export type Field = string | null;
export type Message = string;
export type Proposed1 = string | number | boolean | null;
export type Requested1 = string | number | null;
export type NextStep = string;
export type Summary = string;
export type Budget = {
  [k: string]: unknown;
} | null;
export type ConversationId = string;
export type CreatedAt3 = string;
export type CurrentStep = number;
export type ErrorCode = string | null;
export type ErrorDetail = string | null;
export type Id3 = string;
export type MaxSteps = number;
export type CandidateId = string;
export type ExpectedRepresentationId = string;
export type RequestedAt = string;
export type ReviewReason = string;
export type SchemaVersion3 = "1.0.0";
export type SourceDocumentId = string | null;
export type Status1 = "WAITING";
export type StepId = string;
export type ProjectId3 = string;
export type SchemaVersion4 = "1.0.0";
export type Status2 =
  | "CREATED"
  | "PLANNING"
  | "WAITING_FOR_APPROVAL"
  | "EXECUTING"
  | "WAITING_FOR_CALCULATION"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED"
  | "PAUSED";
export type CreatedAt4 = string;
export type ErrorCode1 = string | null;
export type ErrorDetail1 = string | null;
export type FinishedAt = string | null;
export type Id4 = string;
export type SchemaVersion5 = "1.0.0";
export type Status3 = string;
export type StepNumber = number;
export type StepType = string;
export type Summary1 = string | null;
export type ToolName1 = string | null;
export type ToolVersion1 = string | null;
/**
 * @maxItems 100
 */
export type Steps = AIRunStepView[];
export type UpdatedAt1 = string;
export type WaitingCalculationId = string | null;
/**
 * @maxItems 100
 */
export type Citations = AICitation[];
export type Content = string;
export type ConversationId1 = string;
export type CreatedAt5 = string;
export type Available = boolean;
export type CitationId1 = string;
export type DocumentId = string | null;
export type KnowledgeChunkId1 = string;
export type KnowledgeItemId = string;
export type PageNumber1 = number | null;
export type ParagraphOrdinal = number | null;
export type Passage = string;
export type SchemaVersion6 = "1.0.0";
export type SectionPath = string | null;
export type SourceAnchorId1 = string | null;
export type SourceClass = string | null;
export type SourceTitle = string;
export type SourceType = string;
export type VerificationState = string | null;
/**
 * @maxItems 25
 */
export type Evidence = AIEvidenceView[];
export type EvidenceNote = string | null;
export type EvidenceStatus = ("SUPPORTED" | "PARTIAL" | "INSUFFICIENT_EVIDENCE") | null;
export type Id5 = string;
export type Role = "user" | "assistant" | "system";
export type RunId1 = string | null;
export type SchemaVersion7 = "1.0.0";
/**
 * @maxItems 10000
 */
export type Messages = AIMessageView[];
export type SchemaVersion8 = "1.0.0";
/**
 * @maxItems 1000
 */
export type Conversations = AIConversationSummary[];
export type SchemaVersion9 = "1.0.0";
export type Scope = string;
/**
 * @maxItems 3
 */
export type Slugs = [] | [string] | [string, string] | [string, string, string];
/**
 * @maxItems 12
 */
export type Caveats =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string];
/**
 * @maxItems 16
 */
export type MetricDefinitions =
  | []
  | [MetricDefinition]
  | [MetricDefinition, MetricDefinition]
  | [MetricDefinition, MetricDefinition, MetricDefinition]
  | [MetricDefinition, MetricDefinition, MetricDefinition, MetricDefinition]
  | [MetricDefinition, MetricDefinition, MetricDefinition, MetricDefinition, MetricDefinition]
  | [MetricDefinition, MetricDefinition, MetricDefinition, MetricDefinition, MetricDefinition, MetricDefinition]
  | [
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
    ]
  | [
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
    ]
  | [
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
    ]
  | [
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
    ]
  | [
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
    ]
  | [
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
    ]
  | [
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
    ]
  | [
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
    ]
  | [
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
    ]
  | [
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
      MetricDefinition,
    ];
export type Definition = string;
export type Denominator = string;
export type MeasuredIn = string;
export type Metric = string;
export type MissingData = string;
export type ModelName = string;
export type ModelProvider = string;
export type AcceptedFirstAttempt = number;
export type RejectedByValidation = number;
export type RepairsBeforeApproval = number;
export type UnrepairedRuns = number;
export type ValidatedForApproval = number;
export type ValidityRate = number | null;
export type MaxMs = number | null;
export type MedianMs = number | null;
export type Observations = number;
export type P95Ms = number | null;
export type Dispatched = number;
export type InFlight = number;
export type NotDispatched = number;
export type ProviderError = number;
export type Succeeded = number;
export type Timeout = number;
export type UnclassifiedFailure = number;
export type Canceled = number;
export type Failed = number;
export type Other = number;
export type Runs = number;
export type Succeeded1 = number;
export type Synthetic = boolean;
export type InputTokens = number | null;
export type OutputTokens = number | null;
export type RequestsReported = number;
export type RequestsUnknown = number;
export type ConformanceRate = number | null;
export type Emitted = number;
export type OutsideRunScope = number;
export type RejectedByValidation1 = number;
/**
 * @maxItems 32
 */
export type Rows = ModelPerformanceRow[];
export type Scope1 = "CURRENT_USER_OWN_RUNS";
export type InvocationsConsidered = number;
export type RunsConsidered = number;
export type Truncated = boolean;
export type UnattributedRuns = number;
export type Mode = "NONE" | "MANAGED" | "BYOK";
export type Model1 = string;
export type Provider2 = "openai" | "openrouter" | "huggingface" | "nvidia" | "moonshot" | "fake";
export type EventType = string;
export type OccurredAt = string;
export type ProjectId4 = string;
export type RunId2 = string;
export type SchemaVersion10 = "1.0.0";
export type Sequence = number;
export type Summary2 = string;
/**
 * @maxItems 1000
 */
export type Events = AIRunEventView[];
export type SchemaVersion11 = "1.0.0";
export type AllowanceStatus = "NOT_APPLICABLE" | "AVAILABLE" | "EXCEEDED" | "DISABLED";
export type Available1 = boolean;
export type ByokEnabled = boolean;
export type ErrorCode2 = string | null;
export type LocalTestOnly = boolean;
export type ManagedEnabled = boolean;
export type Mode1 = "NONE" | "MANAGED" | "BYOK";
export type Model2 = string;
export type Provider3 = "openai" | "openrouter" | "huggingface" | "nvidia" | "moonshot" | "fake";
export type SecretStorageAvailable = boolean;
/**
 * @maxItems 3
 */
export type Credentials =
  [] | [BYOKStatusView] | [BYOKStatusView, BYOKStatusView] | [BYOKStatusView, BYOKStatusView, BYOKStatusView];
export type CreatedAt6 = string | null;
export type Fingerprint = string | null;
export type Provider4 = string;
export type Status4 = "NOT_CONFIGURED" | "CONFIGURED" | "REVOKED";
export type UpdatedAt2 = string | null;
export type Validated = boolean;
/**
 * @maxItems 12
 */
export type ConfigurationRequirements =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string];
export type Configured = boolean;
/**
 * @maxItems 4
 */
export type DevelopmentEvidence =
  [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
export type DisplayName = string;
/**
 * @maxItems 12
 */
export type DocumentedCapabilities =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string];
export type Eligibility1 = "STANDARD" | "DEVELOPMENT" | "NONE";
export type Endpoint = string;
export type EndpointAvailability = "AVAILABLE" | "DEPRECATED" | "UNKNOWN";
/**
 * @maxItems 12
 */
export type Limitations =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string];
export type ModelIdentifier = string;
/**
 * @maxItems 8
 */
export type PlanningProfiles =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string];
export type ProposalWorkflowVerified = boolean;
export type Provider5 = string;
export type PublishedContext = string;
export type ReviewedOn = string;
export type Selectable = boolean;
/**
 * @maxItems 6
 */
export type SourceUrls =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string];
export type Status5 = "DOCUMENTED" | "CONFIGURED" | "LIVE-VERIFIED" | "UNAVAILABLE" | "UNSUPPORTED";
export type ToolCompatibilityVerified = boolean;
export type UnselectableReason = string | null;
export type VerificationScope = string;
/**
 * @maxItems 32
 */
export type ModelCapabilities = AIModelCapability[];
/**
 * @maxItems 4
 */
export type Providers =
  | []
  | [AIProviderOption]
  | [AIProviderOption, AIProviderOption]
  | [AIProviderOption, AIProviderOption, AIProviderOption]
  | [AIProviderOption, AIProviderOption, AIProviderOption, AIProviderOption];
export type LocalTestOnly1 = boolean;
/**
 * @maxItems 3
 */
export type Models = [] | [string] | [string, string] | [string, string, string];
export type Provider6 = "openai" | "openrouter" | "huggingface" | "nvidia" | "moonshot" | "fake";
export type ApprovalRequired = boolean;
export type AuditCategory = string;
export type AuthoritativeOutput = boolean;
export type Category = "READ" | "NAVIGATION" | "MUTATION" | "SCIENTIFIC_EXECUTION";
export type Description = string;
export type Deterministic = boolean;
export type InputSchemaRef = string;
export type Mutates = boolean;
export type OutputSchemaRef = string;
export type ProjectScope = "CURRENT_PROJECT" | "PUBLIC_CATALOGUE";
export type RequiredCapabilities = string[];
export type RequiredProjectRole = "READ" | "WRITE";
export type ScientificCompute = boolean;
export type ToolId = string;
export type Currency1 = string;
export type MinorUnits1 = number;
export type ByokEntries = number;
export type CachedTokens = number | null;
export type InputTokens1 = number | null;
export type LegacyEntries = number;
export type ManagedEntries = number;
export type OutputTokens1 = number | null;
export type PendingEntries = number;
export type ProviderCostComplete = boolean;
export type ReportedCachedTokens = number;
export type ReportedEntries = number;
export type ReportedInputTokens = number;
export type ReportedOutputTokens = number;
export type UnknownEntries = number;
export type UsageComplete = boolean;
export type AiOveragePolicy = "DENY" | "ALLOW_METERED_OVERAGE";
export type ComputeOveragePolicy = "DENY" | "ALLOW_METERED_OVERAGE";
export type Id6 = string;
export type PeriodEnd = string;
export type PeriodStart = string;
export type Decision = "APPROVE" | "REJECT";
export type DecisionNotes = string | null;
export type ArtifactId = string;
export type ProjectId5 = string;
export type Sha256 = string;
export type ActorOrServiceId = string;
export type ApprovalReference = string | null;
/**
 * @maxItems 128
 */
export type Artifacts = ArtifactReference[];
export type ErrorCategory = string | null;
export type EventName = string;
export type Id7 = string;
export type OccurredAt1 = string;
export type OrganizationId = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AuditOutcome".
 */
export type AuditOutcome = "SUCCEEDED" | "REJECTED" | "FAILED";
export type ProjectId6 = string | null;
export type RequestId = string;
export type Key = string;
export type Value = string;
/**
 * @maxItems 32
 */
export type SafeMetadata = SafeAuditField[];
export type SchemaVersion12 = "1.0.0";
export type EntityId1 = string;
export type EntityType = string;
export type ProjectId7 = string;
/**
 * @maxItems 128
 */
export type Targets = EntityReference[];
export type ToolName2 = string | null;
export type ToolVersion2 = string | null;
export type CalculationId = string;
export type CalculationInputId = string;
export type CorrelationId = string;
export type IdempotencyKey = string;
export type Payload1 =
  | ScientificResultPayload
  | EnergyResult
  | DispersionCorrectedEnergyResult
  | NativeDispersionCorrectedEnergyResult
  | OptimizationResult
  | ConformerEnsembleResult
  | VibrationalAnalysis
  | MolecularOrbitalAnalysis
  | TddftResult
  | ThermochemistryResult
  | PeriodicEnergyResult;
/**
 * @maxItems 256
 */
export type Artifacts1 = ArtifactReference[];
export type PayloadSchema = string;
export type PayloadSchemaVersion = string;
export type Name = string;
export type ApproximationState = "EXACT_AS_REPORTED" | "APPROXIMATE" | "ESTIMATED";
export type DecimalPlaces = number | null;
export type SignificantFigures = number | null;
export type Code2 = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "QuantityDimension".
 */
export type QuantityDimension =
  | "DIMENSIONLESS"
  | "LENGTH"
  | "ENERGY"
  | "FREQUENCY"
  | "TEMPERATURE"
  | "PRESSURE"
  | "TIME"
  | "MASS"
  | "AMOUNT"
  | "INTENSITY"
  | "OTHER_DECLARED";
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "UnitStandard".
 */
export type UnitStandard = "UCUM" | "QCSCHEMA";
export type Uncertainty = number | null;
export type Value1 = number;
/**
 * @maxItems 512
 */
export type Quantities = NamedScientificQuantity[];
export type Basis = string | null;
export type Converged = true;
export type Method = string;
export type ParserVersion = string;
export type PayloadSchema1 = "chemdft.energy";
export type PayloadSchemaVersion1 = "1.0.0";
export type ScfIterations = number | null;
export type TaskType = "ENERGY";
export type ValidatorVersion = string;
export type AngstromToBohr = 1.8897261254578281;
export type ChargeModel = "eeq";
export type CoordinateUnit = "angstrom";
export type Damping = "rational-bj";
export type Functional = "b3lyp" | "pbe";
export type ParameterTableSha256 = string;
export type A1 = number;
export type A2 = number;
export type A2Unit = "bohr";
export type Alp = number;
export type Ga = number;
export type Gc = number;
export type S6 = number;
export type S8 = number;
export type S9 = number;
export type Wf = number;
export type ParserVersion1 = "1.0.0";
export type PayloadSchema2 = "chemdft.dispersion-corrected-energy";
export type PayloadSchemaVersion2 = "1.0.0";
export type Basis1 = "def2-svp";
export type CalculationId1 = string;
export type CalculationInputId1 = string;
export type CanonicalArtifactId = string;
export type CanonicalSha256 = string;
export type Charge = 0;
export type EngineIdentitySha256 = string;
export type Functional1 = "b3lyp" | "pbe";
export type GeometrySha256 = string;
export type Multiplicity = 1;
export type NativeEvidenceSha256 = string;
export type NormalizedInputSha256 = string;
export type ProjectId8 = string;
export type ProvenanceId = string;
export type ProvenanceSha256 = string;
export type ResultId = string;
export type ResultPayloadSha256 = string;
export type SourceEnergyHartree = number;
export type SourceVerificationState = string;
export type SpecificationSha256 = string;
export type StructureVersionId = string;
export type ThreeBodyModel = "approx-atm";
export type ValidatorVersion1 = "1.0.0";
export type Variant = "d4.bj-eeq-atm";
export type VariantSha256 = string;
export type ChargeModel1 = "eeq";
export type CoordinateUnit1 = "angstrom";
export type Damping1 = "rational-bj";
export type Functional2 = "b3lyp" | "pbe";
export type NativeAngstromToBohr = 1.8897261246204404;
export type NativeConversionDefinition = "mctc-lib.0.5.2.aatoau";
export type ParameterTableSha2561 = string;
export type ParserVersion2 = "1.0.0";
export type PayloadSchema3 = "chemdft.dispersion-corrected-energy";
export type PayloadSchemaVersion3 = "1.1.0";
export type ThreeBodyModel1 = "approx-atm";
export type ValidatorVersion2 = "1.0.0";
export type Variant1 = "d4.bj-eeq-atm";
export type VariantSha2561 = string;
export type Basis2 = string | null;
export type Converged1 = true;
export type FinalStructureHash = string;
export type FinalStructureVersionId = string;
export type Method1 = string;
export type OptimizationIterations = number | null;
export type ParserVersion3 = string;
export type PayloadSchema4 = "chemdft.optimization";
export type PayloadSchemaVersion4 = "1.0.0";
export type StepCount = number;
export type TaskType1 = "GEOMETRY_OPTIMIZATION";
export type TrajectorySha256 = string;
export type ValidatorVersion3 = string;
/**
 * @minItems 1
 * @maxItems 128
 */
export type Artifacts2 = [ArtifactReference, ...ArtifactReference[]];
export type AttemptNumber = number;
export type CalculationId2 = string;
export type CalculationInputId2 = string;
export type CalculationInputSha256 = string;
export type Calculator = "embedded-tblite-0.3.0-fork";
export type Charge1 = number;
export type CoordinateUnit2 = "angstrom";
export type EffectiveEwinKcalMol = 6;
export type EnergyUnit = "Eh";
export type Engine = "crest";
export type EngineVersion = "3.0.2+pf8c-ewinfix-a1";
export type ExecutableSha256 = string;
export type ExecutionId = string;
export type InputStructureSha256 = string;
export type InputStructureVersionId = string;
export type ComparableToFinal = boolean;
export type EnergyHartree = number;
export type Protocol = "CRUDE" | "TIGHT" | "VTIGHT" | "UNCLASSIFIED";
export type StdoutLine = number;
/**
 * @maxItems 10000
 */
export type IntermediateMinima = ConformerIntermediateMinimum[];
/**
 * @minItems 1
 * @maxItems 32
 */
export type Limitations1 = [string, ...string[]];
/**
 * @minItems 1
 * @maxItems 1000
 */
export type Members = [ConformerEnsembleMember, ...ConformerEnsembleMember[]];
export type ApplicationRank = number;
export type AtomOrdering = "AS_LISTED";
/**
 * @minItems 1
 * @maxItems 10000
 */
export type Atoms = [Atom, ...Atom[]];
export type AtomicNumber = number;
export type Element = string;
export type FormalCharge = number | null;
export type Index = number;
export type Isotope = number | null;
export type Label1 = string | null;
export type Occupancy = number | null;
export type X = number;
export type Y = number;
export type Z = number;
export type AtomIndexA = number;
export type AtomIndexB = number;
export type Order = number | null;
/**
 * @maxItems 40000
 */
export type Bonds = Bond[];
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CoordinateSystem".
 */
export type CoordinateSystem = "CARTESIAN" | "FRACTIONAL";
export type Dimensionality = 3;
export type Source1 = EntityReference | ArtifactReference;
export type StructureVersionId1 = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CoordinateUnit".
 */
export type CoordinateUnit3 = "angstrom" | "bohr";
export type CreatedAt7 = string;
export type GenerationMethod = string;
export type Id8 = string;
export type ProjectId9 = string;
export type Rank = number | null;
export type SchemaVersion13 = "1.0.0";
export type StructureVersionId2 = string;
/**
 * Validated native VTIGHT gradient convergence, not a local-minimum proof.
 */
export type GeometryConvergence = "NATIVE_GRADIENT_CONVERGED";
/**
 * No qualifying frequency/Hessian evidence is supplied by this CREST search.
 */
export type MinimumStatus = "UNVERIFIED";
export type NativeRank = number;
export type NativeRecordSha256 = string;
export type Method2 = "gfn2";
export type Multiplicity1 = 1;
/**
 * @minItems 1
 * @maxItems 128
 */
export type NativeArtifacts = [ConformerNativeArtifact, ...ConformerNativeArtifact[]];
export type Name1 = string;
export type NativeDuplicateCount = number;
export type NativeOptimizedCount = number;
export type NativeRotamerCount = number;
export type PayloadSchema5 = "chemdft.conformer-ensemble-manifest";
export type ProjectId10 = string;
export type RelativeEnergyUnit = "kcal/mol";
export type RequestedEwinKcalMol = 6;
export type RestartCount = number;
export type SchemaVersion14 = "1.0.0";
export type SearchCompleted = true;
export type PayloadSchema6 = "chemdft.conformer-ensemble";
export type PayloadSchemaVersion5 = "1.0.0";
export type TaskType2 = "CONFORMER_SEARCH";
export type AdapterVersion = string;
/**
 * @minItems 1
 */
export type AtomIdentities = [string, ...string[]];
export type Basis3 = string;
export type CalculationId3 = string;
export type CalculationSpecificationHash = string;
export type Charge2 = number;
export type CoordinateUnit4 = "angstrom";
export type DipoleDerivativeMethod = "central_finite_difference" | null;
export type ElectricFieldStepAu = number | null;
export type Engine1 = string;
export type EngineVersion1 = string;
/**
 * @minItems 1
 */
export type EquilibriumCoordinatesAngstrom = [[unknown, unknown, unknown], ...[unknown, unknown, unknown][]];
export type EquilibriumCoordinatesHash = string;
export type ExpectedVibrationalModeCount = number;
export type FiniteDifferenceStepBohr = number | null;
export type FrequencyUnit = "cm^-1";
export type HessianSha256 = string;
export type HessianType = "analytic";
export type HessianUnit = "Eh/bohr^2";
export type InputStructureHash = string;
export type InputStructureVersionId1 = string;
export type IntensityUnit = "km/mol" | null;
export type Method3 = string;
export type ModeOrdering = "ascending_eigenvalue";
/**
 * @minItems 1
 */
export type Modes = [VibrationalMode, ...VibrationalMode[]];
export type DepolarizationRatio = number | null;
export type DisplacementVectors = [unknown, unknown, unknown][];
export type FrequencyCm1 = number;
export type Imaginary = boolean;
export type Index1 = number;
export type ReducedMassAmu = number | null;
export type Multiplicity2 = number;
export type ParserVersion4 = string;
export type PayloadSchema7 = "chemdft.vibrational-analysis";
export type PayloadSchemaVersion6 = "1.0.0";
export type PolarizabilityAntisymmetryTolerance = number | null;
export type PolarizabilityDerivativeMethod = "central_normal_coordinate_difference" | null;
export type PolarizabilityDerivativeStepAngstromAmuHalf = number | null;
export type PolarizabilityMethod = "finite_electric_field" | null;
export type PolarizabilityTensorSymmetrization = boolean | null;
export type PolarizabilityUnit = "angstrom^3" | null;
export type RamanActivityUnit = ("angstrom^4/amu" | "Angstrom^4/amu") | null;
export type RamanMethod = "placzek_static" | null;
export type RamanSha256 = string | null;
export type ResultSha256 = string;
export type SchemaVersion15 = "1.0.0";
export type TaskType3 = "FREQUENCY";
export type VectorConvention = "pyscf_thermo_norm_mode";
export type VectorUnit = "amu^-1/2";
export type AdapterVersion1 = string;
export type AlphaElectronCount = number;
export type Basis4 = string;
export type BasisFunctionCount = number;
export type BetaElectronCount = number;
export type CalculationId4 = string;
export type CalculationInputHash = string;
export type Charge3 = number;
export type CoefficientArtifactSha256 = string;
export type CoefficientFormat = "chemdft.mo-coefficients.npz";
export type Converged2 = true;
export type ConvertedEnergyUnit = "eV";
export type ElectronCount = number;
export type EnergyUnit1 = "Eh";
export type Engine2 = "pyscf";
export type EngineVersion2 = string;
/**
 * @minItems 1
 * @maxItems 2
 */
export type FrontierBySpin = [OrbitalFrontier] | [OrbitalFrontier, OrbitalFrontier];
export type GapEv = number;
export type GapHartree = number;
export type HomoEnergyEv = number;
export type HomoEnergyHartree = number;
export type HomoIndex = number;
export type LumoEnergyEv = number;
export type LumoEnergyHartree = number;
export type LumoIndex = number;
export type SpinChannel = "restricted" | "alpha" | "beta";
export type InputStructureHash1 = string;
export type InputStructureId = string;
export type InputStructureVersionId2 = string;
export type Method4 = string;
export type MolecularOrbitalCount = number;
export type Multiplicity3 = number;
export type OrbitalGapLabel = "HOMO-LUMO orbital-energy gap";
export type OrbitalGapNote = "Orbital-energy difference; not an excited-state calculation.";
/**
 * @minItems 1
 * @maxItems 10000
 */
export type Orbitals = [MolecularOrbital, ...MolecularOrbital[]];
export type EnergyEv = number;
export type EnergyHartree1 = number;
export type Index2 = number;
export type Occupation = number;
export type SpinChannel1 = "restricted" | "alpha" | "beta";
export type PayloadSchema8 = "chemdft.molecular-orbitals";
export type PayloadSchemaVersion7 = "1.0.0";
export type Producer = string;
export type ResultSha2561 = string;
export type ScfIterations1 = number | null;
export type SchemaVersion16 = "1.0.0";
export type TaskType4 = "ORBITAL";
export type TotalEnergyHartree = number;
export type AdapterVersion2 = string;
export type AmplitudesArtifactSha256 = string;
export type AmplitudesFormat = "chemdft.tddft-amplitudes.npz";
export type Basis5 = string;
export type CalculationId5 = string;
export type CalculationInputHash1 = string;
export type Charge4 = number;
export type Converged3 = true;
export type ConvergedRoots = number;
export type ConvertedEnergyUnit1 = "eV";
export type DominantStateIndex = number;
export type EnergyUnit2 = "Eh";
export type Engine3 = "pyscf";
export type EngineVersion3 = string;
/**
 * @minItems 1
 * @maxItems 128
 */
export type ExcitedStates = [ExcitedState, ...ExcitedState[]];
export type Converged4 = boolean;
export type Magnitude = number;
export type OccupiedLabel = string;
export type OccupiedMoIndex = number;
export type VirtualLabel = string;
export type VirtualMoIndex = number;
export type X1 = number;
export type Y1 = number;
/**
 * @maxItems 32
 */
export type DominantTransitions = DominantTransition[];
export type EnergyEv1 = number;
export type EnergyHartree2 = number;
export type Index3 = number;
export type OscillatorStrength = number;
export type OscillatorStrengthGauge = "length";
export type StateLabel = string;
/**
 * @minItems 3
 * @maxItems 3
 */
export type TransitionDipole = [unknown, unknown, unknown];
export type WavelengthNm = number;
export type GroundStateEnergyHartree = number;
export type HomoEnergyHartree1 = number;
export type HomoIndex1 = number;
export type HomoLumoGapEv = number;
export type HomoLumoGapHartree = number;
export type HomoLumoGapLabel = "HOMO-LUMO orbital-energy gap";
export type HomoLumoGapNote = "Orbital-energy difference; not an excited-state calculation.";
export type InputStructureHash2 = string;
export type InputStructureId1 = string;
export type InputStructureVersionId3 = string;
export type LumoEnergyHartree1 = number;
export type LumoIndex1 = number;
export type MaxOscillatorStrength = number;
export type Method5 = string;
export type Multiplicity4 = number;
export type Nocc = number;
export type Nvir = number;
export type OscillatorStrengthGauge1 = "length";
export type PayloadSchema9 = "chemdft.tddft";
export type PayloadSchemaVersion8 = "1.0.0";
export type Producer1 = string;
export type ReferenceMethod = "RKS";
export type RequestedRoots = number;
export type ResponseMethod = "TDDFT";
export type ResultSha2562 = string;
export type ScfIterations2 = number | null;
export type SchemaVersion17 = "1.0.0";
export type SpinChannel2 = "singlet";
export type TaskType5 = "TDDFT";
export type WavelengthUnit = "nm";
export type AdapterVersion3 = string;
export type Basis6 = string;
export type CalculationId6 = string;
export type CalculationInputHash2 = string;
export type CpHartreePerK = number;
export type CvHartreePerK = number;
export type EnergyHartree3 = number;
export type EnthalpyHartree = number;
export type EntropyHartreePerK = number;
export type GibbsHartree = number;
/**
 * @minItems 1
 * @maxItems 16
 */
export type Assumptions1 =
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
export type GasModel = "ideal-gas";
export type PressureAtm = number;
export type PressurePa = number;
export type ReferencePressurePa = number;
export type StandardState = "ideal-gas-at-specified-pressure";
export type TemperatureK = number;
export type ThermoModel = "ideal-gas-rrho";
export type AtomicMassKg = number;
export type AvogadroPerMol = number;
export type BohrM = number;
export type BoltzmannJPerK = number;
export type HartreeJ = number;
export type PlanckJS = number;
export type Source2 = string;
export type SpeedOfLightMPerS = number;
export type ThermochemicalCalorieJ = number;
export type IncludesZpe = true;
export type Reference = "electronic_energy_hartree";
export type ThermalCorrectionEnthalpyHartree = number;
export type ThermalCorrectionGibbsHartree = number;
export type ThermalCorrectionInternalEnergyHartree = number;
export type ImaginaryModeCount = 0;
export type ImaginaryModePolicy = "reject";
export type LowFrequencyEntropyHartreePerK = number;
export type LowFrequencyMinusTsHartree = number;
export type LowFrequencyModeIndices = number[];
export type LowFrequencyPolicy = "warn-below-threshold-pure-rrho-no-correction";
export type LowFrequencyThresholdCm1 = number;
export type LowestRealFrequencyCm1 = number;
export type CriterionRmsHartreePerBohr = number;
export type GradientNormHartreePerBohr = number;
export type GradientRmsHartreePerBohr = number;
export type Passed = true;
export type Source3 = "optimization-trajectory-final-step";
export type TrajectoryStepIndex = number;
/**
 * @maxItems 16
 */
export type Warnings =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
export type EnergyArtifactSha256 = string;
export type EnergySourceField = "total_energy_hartree";
export type EnergyUnit3 = "Eh";
export type Engine4 = "pyscf";
export type EngineVersion4 = string;
export type EntropyUnit = "Eh/K";
/**
 * @minItems 1
 */
export type FrequenciesCm1 = [number, ...number[]];
export type FrequencyCalculationId = string;
export type FrequencyResultId = string;
export type FrequencyResultSha256 = string;
export type GeometryHash = string;
export type InputStructureHash3 = string;
export type InputStructureId2 = string;
export type InputStructureVersionId4 = string;
export type Method6 = string;
/**
 * @minItems 2
 */
export type AtomIdentities1 = [string, string, ...string[]];
export type Charge5 = number;
/**
 * @minItems 2
 */
export type EquilibriumCoordinatesAngstrom1 = [
  [unknown, unknown, unknown],
  [unknown, unknown, unknown],
  ...[unknown, unknown, unknown][],
];
export type MassConvention = "pyscf-isotope-average";
export type Multiplicity5 = number;
/**
 * @minItems 3
 * @maxItems 3
 */
export type RotationalConstantsGhz = [unknown, unknown, unknown];
export type RotorType = "LINEAR" | "NONLINEAR";
export type TotalMassAmu = number;
export type OptimizationCalculationId = string;
export type OptimizationResultId = string;
export type OptimizationResultSha256 = string;
export type ParserVersion5 = string;
export type PayloadSchema10 = "chemdft.thermochemistry";
export type PayloadSchemaVersion9 = "1.0.0";
export type Producer2 = string;
export type ResultSha2563 = string;
export type SchemaVersion18 = "1.0.0";
export type Algorithm = string;
export type AlgorithmVersion = string;
export type Method7 = string;
export type OverrideReason = string | null;
export type PyscfCrossCheckAgrees = boolean | null;
export type PyscfPointGroupSigma = number | null;
export type RotationalSymmetryNumber = number;
export type Source4 = "chemdft-proper-rotation-count" | "user-override";
export type StabilityTolerancesAngstrom = number[];
export type ToleranceAngstrom = number;
export type TaskType6 = "THERMOCHEMISTRY";
export type ThermoApi = "pyscf.hessian.thermo.thermo";
export type CpHartreePerK1 = number;
export type CvHartreePerK1 = number;
export type E0PlusZpeHartree = number;
export type ElectronicEnergyHartree = number;
export type EnthalpyHartree1 = number;
export type EntropyHartreePerK1 = number;
export type GibbsFreeEnergyHartree = number;
export type InternalEnergyHartree = number;
export type ZpeHartree = number;
export type ValidatorVersion4 = string;
/**
 * @minItems 1
 */
export type VibrationalModes = [ThermochemistryModeContribution, ...ThermochemistryModeContribution[]];
export type CvHartreePerK2 = number;
export type EntropyHartreePerK2 = number;
export type FrequencyCm11 = number;
export type Index4 = number;
export type LowFrequency = boolean;
export type ThermalEnergyHartree = number;
export type VibrationalTemperatureK = number;
export type ZpeHartree1 = number;
export type AbsoluteMagnetization = number | null;
export type Bands = {
  [k: string]: unknown;
} | null;
export type Converged5 = true;
export type Dos = {
  [k: string]: unknown;
} | null;
export type Engine5 = "pyscf" | "qe";
export type FermiEnergyEv = number | null;
export type IrreducibleKPoints = number | null;
/**
 * @minItems 3
 * @maxItems 3
 */
export type KMesh = [unknown, unknown, unknown];
export type LocalMomentKind = "mulliken-type" | "lowdin-projected";
export type MagneticOrder = "none" | "ferromagnetic" | "antiferromagnetic";
export type ParserVersion6 = string;
export type PayloadSchema11 = "chemdft.periodic-energy";
export type PayloadSchemaVersion10 = "1.0.0";
export type PseudopotentialLibrary = string | null;
export type Relaxation = {
  [k: string]: unknown;
} | null;
export type RuntimeSeconds = number | null;
export type ScfIterations3 = number | null;
export type TaskType7 = "PERIODIC_ENERGY";
export type TotalMagnetization = number | null;
export type UsedDefaultU = boolean;
export type ValidatorVersion5 = string;
export type AdapterVersion4 = string;
/**
 * @maxItems 128
 */
export type Capabilities = string[];
export type EnvironmentDigest = string | null;
export type ExecutionBackend = string;
export type HardwareClass = string | null;
/**
 * @maxItems 16
 */
export type LibraryVersions =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type Namespace = string;
export type SchemaVersion19 = string;
export type Key1 = string;
export type Value2 = string | number | boolean | null;
/**
 * @maxItems 64
 */
export type Values = ExtensionValue[];
export type Name2 = string;
export type Version = string;
export type ProjectId11 = string;
export type ProvenanceRecordId = string;
/**
 * @minItems 1
 * @maxItems 256
 */
export type RawArtifacts = [ArtifactReference, ...ArtifactReference[]];
export type RequestId1 = string;
export type ResultType = string;
export type SchemaVersion20 = "1.0.0";
export type BillingAccountId = string;
export type Byok = BYOKStatusView[];
export type Entries = number;
export type Currency2 = string;
export type CurrentPeriodEnd = string | null;
export type CurrentPeriodStart = string | null;
export type AiOveragePolicy1 = "DENY" | "ALLOW_METERED_OVERAGE";
export type ByokAi = boolean;
export type Compute = boolean;
export type ComputeOveragePolicy1 = "DENY" | "ALLOW_METERED_OVERAGE";
export type Investigations = boolean;
export type ManagedAi = boolean;
export type MaxConcurrentAi = number;
export type MaxConcurrentCompute = number;
export type PlanKey = string;
export type HostedInvoiceUrl = string | null;
export type Id9 = string;
export type PeriodEnd1 = string;
export type PeriodStart1 = string;
export type Provider7 = string;
export type ProviderInvoiceId = string;
export type Status6 = string;
export type Invoices = InvoiceView[];
export type OrganizationId1 = string;
export type Id10 = string;
export type PeriodEnd2 = string;
export type PeriodStart2 = string;
export type Status7 = "MATCHED" | "PENDING" | "DISCREPANCY" | "RESOLVED";
export type SchemaVersion21 = "1.0.0";
export type Status8 = "NOT_CONFIGURED" | "ACTIVE" | "PAST_DUE" | "GRACE" | "SUSPENDED" | "CANCELED";
export type SubscriptionPlan = string | null;
export type SubscriptionStatus = string | null;
export type Provider8 = string;
export type Secret = string;
export type Provider9 = string;
export type Basis7 = string | null;
export type CalculationId7 = string | null;
export type Engine6 = string | null;
export type HasIntensities = boolean;
export type Id11 = string;
export type ItemCount = number;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculatedSourceKind".
 */
export type CalculatedSourceKind = "CALCULATION_RESULT" | "IMPORTED_RESULT";
export type Label2 = string;
export type Method8 = string | null;
export type Phase = "GAS" | "UNKNOWN";
export type StructureId = string | null;
export type StructureName = string | null;
export type StructureVersionId3 = string | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumTechnique".
 */
export type SpectrumTechnique = "IR" | "RAMAN" | "UVVIS";
/**
 * @maxItems 2000
 */
export type Sources = CalculatedSourceView[];
export type CreatedAt8 = string;
export type CreatedBy = string;
export type Id12 = string;
export type InputId = string;
export type ProjectId12 = string;
export type SchemaVersion22 = "1.0.0";
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculationLifecycle".
 */
export type CalculationLifecycle =
  "DRAFT" | "VALIDATED" | "AUTHORIZED" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
export type UpdatedAt3 = string;
export type AttemptNumber1 = number;
export type CalculationId8 = string;
export type Diagnostic = string | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculationFailureCode".
 */
export type CalculationFailureCode =
  | "ENGINE_UNAVAILABLE"
  | "ENGINE_VERSION_UNSUPPORTED"
  | "UNSUPPORTED_TASK"
  | "UNSUPPORTED_METHOD"
  | "UNSUPPORTED_BASIS"
  | "INVALID_CHARGE_MULTIPLICITY"
  | "INVALID_COORDINATES"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "EXECUTION_TIMEOUT"
  | "ENGINE_CRASHED"
  | "NONCONVERGED"
  | "OUTPUT_MISSING"
  | "PARSE_FAILED"
  | "RESULT_VALIDATION_FAILED"
  | "FIREWALL_REJECTED"
  | "CANCELED";
export type FinishedAt1 = string | null;
export type Id13 = string;
export type ProjectId13 = string;
/**
 * @maxItems 256
 */
export type RawArtifacts1 = ArtifactReference[];
export type SchemaVersion23 = "1.0.0";
export type StartedAt = string | null;
export type WorkerId = string;
export type AgreementIsNotVerification = true;
export type DeltaConvention = "other minus reference";
export type Notice = string;
export type Overall = "DIRECTLY_COMPARABLE" | "COMPARABLE_WITH_LIMITATIONS" | "NOT_SCIENTIFICALLY_COMPARABLE";
export type Blockers = string[];
export type Assumptions2 = string[];
export type Delta = number | null;
export type DeltaKcalPerMol = number | null;
export type DeltaKjPerMol = number | null;
export type Label3 = string;
export type OtherValue = number;
export type QuantityKind = string;
export type ReferenceValue = number;
export type Unit = string;
export type Deltas = ComparisonDelta[];
export type EvidenceStanding = "CURRENT" | "HISTORICAL_CONTEXT";
export type Note = string | null;
export type Relation =
  "IDENTICAL_STRUCTURE_VERSION" | "SAME_ATOM_ORDER_DIFFERENT_COORDINATES" | "NOT_ATOM_ALIGNED" | "UNAVAILABLE";
export type RmsdAngstrom = number | null;
export type Label4 = "DIRECTLY_COMPARABLE" | "COMPARABLE_WITH_LIMITATIONS" | "NOT_SCIENTIFICALLY_COMPARABLE";
export type Limitations2 = string[];
export type OtherResultId = string;
export type ReferenceResultId = string;
export type Detail = string;
export type Outcome1 = "PASS" | "LIMITATION" | "FAIL";
export type RuleId = string;
export type Rules = ComparisonRuleOutcome[];
export type Pairs = CalculationPairComparison[];
export type ProjectId14 = string;
export type ReferenceResultId1 = string;
export type Basis8 = string | null;
export type CalculationId9 = string;
export type Charge6 = number | null;
export type PressurePa1 = number;
export type TemperatureK1 = number;
export type CreatedAt9 = string;
export type Dispersion = string | null;
export type Authority = string;
export type EligibleForDerivation = boolean;
export type InactiveResultIds = string[];
export type Reason1 = string | null;
export type SourceLineageValidity = "ACTIVE" | "RETRACTED" | "SUPERSEDED" | "DISPUTED" | "INVALIDATED";
export type StoredAuthority = string;
export type StoredValidationState = string;
export type StoredVerificationState = string;
export type ValidationState = string;
export type VerificationState1 = string;
export type Engine7 = string | null;
export type EngineVersion5 = string | null;
export type EvidenceUse = "CURRENT" | "HISTORICAL_ONLY" | "UNKNOWN" | "NO_RESULT";
export type Method9 = string | null;
export type Multiplicity6 = number | null;
export type Key2 = string;
export type Kind = string;
export type Label5 = string;
export type Unit1 = string;
export type Value3 = number;
export type Quantities1 = SummaryQuantity[];
export type ResultId1 = string;
export type ResultType1 = string;
export type Solvation = string | null;
export type AtomCount = number | null;
export type ElementSequence = string[];
export type FormulaHill = string | null;
export type GeometryRole = "INPUT" | "OPTIMIZED_FINAL";
export type StructureVersionId4 = string | null;
export type Task = string;
export type Results = ResultSummary[];
export type SchemaId = "chemdft.calculation-comparison.v1";
export type CalculationInputHash3 = string;
export type CalculationAttemptId = string | null;
export type CalculationId10 = string;
export type Diagnostic1 = string | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComputeFailureCode".
 */
export type ComputeFailureCode =
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REJECTED"
  | "LEASE_EXPIRED"
  | "WORKER_LOST"
  | "SUBMISSION_FAILED"
  | "ARTIFACT_TRANSFER_FAILED"
  | "PROVIDER_TIMEOUT"
  | "BUDGET_DENIED"
  | "RESERVATION_FAILED"
  | "CANCEL_FAILED"
  | "METERING_UNAVAILABLE";
export type FinishedAt2 = string | null;
export type HardwareClass1 = string | null;
export type HeartbeatAt = string | null;
export type Id14 = string;
export type JobId = string;
export type LeaseOwner = string | null;
export type CpuMs = number | null;
export type GpuMs = number | null;
export type ProviderCostStatus = "UNKNOWN" | "AVAILABLE";
export type RuntimeMs = number | null;
export type ProjectId15 = string;
export type Provider10 = "local" | "modal" | "aws";
export type StartedAt1 = string | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComputeExecutionState".
 */
export type ComputeExecutionState =
  "CREATED" | "SUBMITTED" | "STARTING" | "RUNNING" | "FINISHED" | "LOST" | "FAILED" | "CANCELED";
export type WorkerId1 = string | null;
export type AttemptCount = number;
export type CalculationId11 = string;
export type CalculationInputId3 = string;
export type CreatedAt10 = string;
export type Id15 = string;
export type Priority = number;
export type ProjectId16 = string;
export type Provider11 = "local" | "modal" | "aws";
export type AcceleratorCount = number;
export type AcceleratorKind = "NONE" | "NVIDIA_CUDA";
export type CpuCount = number;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "IsolationClass".
 */
export type IsolationClass = "LOCAL_DEVELOPMENT" | "MANAGED_CONTAINER";
export type MemoryBytes = number;
export type MinimumGpuVramBytes = number | null;
export type Network = "NONE" | "CONTROLLED";
export type Priority1 = number;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ReproducibilityClass".
 */
export type ReproducibilityClass = "LOCAL_PINNED_ENVIRONMENT" | "PINNED_CONTAINER_IMAGE";
export type RuntimeLimitSeconds = number;
export type TemporaryStorageBytes = number;
export type RequirementHash1 = string;
export type CreatedAt11 = string;
export type EstimateId = string;
export type Id16 = string;
export type ProjectId17 = string;
export type ReconciledAt = string | null;
export type State = "RESERVED" | "RELEASED" | "DENIED";
export type Basis9 = string | null;
export type Charge7 = number | null;
export type Method10 = string | null;
export type Multiplicity7 = number | null;
export type TaskType8 = string | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComputeJobState".
 */
export type ComputeJobState =
  "PENDING" | "READY" | "LEASED" | "RUNNING" | "CANCEL_REQUESTED" | "SUCCEEDED" | "FAILED" | "CANCELED";
export type AtomCount1 = number | null;
export type FormulaHill1 = string | null;
export type StructureId1 = string | null;
export type StructureName1 = string | null;
export type StructureRevision = number | null;
export type StructureVersionId5 = string | null;
export type SubmittedBy = string;
export type UpdatedAt4 = string;
export type WorkerStatus = string | null;
export type WorkloadType =
  | "chemdft.pyscf.energy.v1"
  | "chemdft.pyscf.optimization.v1"
  | "chemdft.pyscf.frequency.v1"
  | "chemdft.pyscf.orbital.v1"
  | "chemdft.pyscf.tddft.v1"
  | "chemdft.pyscf.thermochemistry.v1"
  | "chemdft.pyscf.periodic-energy.v1"
  | "chemdft.qe.periodic-energy.v1"
  | "chemdft.xtb.energy.v1"
  | "chemdft.xtb.optimization.v1"
  | "chemdft.crest.conformer-search.v1"
  | "chemdft.psi4.energy.v1"
  | "chemdft.dftd4.correction.v1";
export type WorkloadVersion = string;
export type ArtifactSha256 = string | null;
export type AtomIdentities2 = Atom[];
export type CalculationId12 = string;
export type FinalStructureVersionId1 = string | null;
export type Id17 = string;
export type InputHash = string;
export type InputStructureVersionId5 = string;
export type State1 = "QUEUED" | "RUNNING" | "CONVERGED" | "NOT_CONVERGED" | "FAILED" | "CANCELED";
export type Converged6 = boolean | null;
/**
 * @minItems 1
 */
export type CoordinatesAngstrom = [[unknown, unknown, unknown], ...[unknown, unknown, unknown][]];
export type EnergyHartree4 = number;
export type EngineCycle = number | null;
export type EvaluationKind = "OPTIMIZER" | "FINAL_SINGLE_POINT";
export type GradientNormHartreePerBohr1 = number;
export type GradientRmsHartreePerBohr1 = number | null;
export type Index5 = number;
export type SourceFile = ("xtbopt.xyz" | "xtbopt.log") | null;
export type SourceFrameIndex = number | null;
export type SourceSha256 = string | null;
export type Timestamp = string | null;
export type Steps1 = OptimizationStep[];
export type ResultAuthority = "CANDIDATE" | "AUTHORITATIVE" | "VERIFICATION" | "IMPORTED";
export type CalculationId13 = string;
export type CalculationInputId4 = string;
export type CreatedAt12 = string;
export type Id18 = string;
export type Payload2 =
  | ScientificResultPayload
  | EnergyResult
  | DispersionCorrectedEnergyResult
  | NativeDispersionCorrectedEnergyResult
  | OptimizationResult
  | ConformerEnsembleResult
  | VibrationalAnalysis
  | MolecularOrbitalAnalysis
  | TddftResult
  | ThermochemistryResult
  | PeriodicEnergyResult;
export type ProducerAttestationId = string;
export type ProjectId18 = string;
export type ProvenanceRecordId1 = string;
export type RawArtifacts2 = ArtifactReference[];
export type ResultType2 = string;
export type SchemaVersion24 = "1.0.0";
export type SourceClass1 = "CALCULATED";
export type TrustedProducerId = string;
export type TrustedProducerType = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ResultValidationState".
 */
export type ResultValidationState = "PENDING" | "VALIDATED" | "REJECTED" | "DISPUTED" | "SUPERSEDED";
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "VerificationState".
 */
export type VerificationState2 = "UNVERIFIED" | "VERIFIED" | "DISPUTED" | "SUPERSEDED" | "RETRACTED";
export type Specification = CalculationSpecification | DispersionCorrectionSpecification;
export type DisplayName1 = string;
export type Identifier = string;
export type Registry = string;
export type RegistryVersion = string | null;
export type Charge8 = number;
export type EnergyThresholdKcalMol = 0.05;
export type EnergyWindowKcalMol = 6;
export type OptimizationLevel = "vtight";
export type RmsdThresholdAngstrom = 0.125;
export type RotationalConstantThreshold = 0.01;
export type Threads = 2;
export type TimeoutSeconds = number;
export type Workflow = "imtd-gc";
/**
 * @minItems 1
 * @maxItems 8
 */
export type AtomIndices =
  | [number]
  | [number, number]
  | [number, number, number]
  | [number, number, number, number]
  | [number, number, number, number, number]
  | [number, number, number, number, number, number]
  | [number, number, number, number, number, number, number]
  | [number, number, number, number, number, number, number, number];
export type Kind1 = string;
/**
 * @maxItems 256
 */
export type Constraints = CalculationConstraint[];
export type DisplayName2 = string;
export type Identifier1 = string;
export type Registry1 = string;
export type RegistryVersion1 = string | null;
/**
 * @maxItems 8
 */
export type EngineExtensions =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type AllowedVersion = string | null;
export type Engine8 = string;
export type ExecutionPreference = string | null;
export type RequestedCapability = string | null;
export type CoordinateUnit5 = "angstrom";
export type ExcludeTranslationRotation = true;
export type FrequencyUnit1 = "cm^-1";
export type HessianUnit1 = "Eh/bohr^2";
export type Strategy = "ANALYTIC";
export type Multiplicity8 = number;
export type ConvergenceDmax = number | null;
export type ConvergenceDrms = number | null;
export type ConvergenceEnergy = number | null;
export type ConvergenceGmax = number | null;
export type ConvergenceGrms = number | null;
export type CoordinateUnit6 = "angstrom";
export type DisplacementUnit = "angstrom";
export type EnergyUnit4 = "Eh";
export type GradientUnit = "Eh/bohr";
export type MaxSteps1 = number;
export type Optimizer = "geometric" | "xtb-ancopt";
export type XtbLevel = "normal" | null;
/**
 * @maxItems 128
 */
export type PropertyRequests = string[];
export type AntisymmetryTolerance = number;
export type ElectricFieldStepAu1 = number;
export type Method11 = "placzek_static";
export type PolarizabilityDerivativeStepAngstromAmuHalf1 = number;
export type PolarizabilityMethod1 = "finite_electric_field";
export type SymmetrizePolarizability = boolean;
export type ConvergenceThreshold = number | null;
export type MaxIterations = number | null;
export type Reference1 = string | null;
export type SchemaVersion25 = "1.0.0";
export type Model3 = string;
export type Solvent = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculationTaskType".
 */
export type CalculationTaskType =
  | "ENERGY"
  | "PERIODIC_ENERGY"
  | "GEOMETRY_OPTIMIZATION"
  | "FREQUENCY"
  | "NMR"
  | "ORBITAL"
  | "ESP"
  | "TDDFT"
  | "CONFORMER_EVALUATION"
  | "CONFORMER_SEARCH"
  | "THERMOCHEMISTRY";
export type ConvTol = number | null;
export type Gauge = "length";
export type Nstates = number;
export type Spin = "singlet";
export type ImaginaryModePolicy1 = "reject";
export type LowFrequencyWarningCm1 = 100;
export type PressurePa2 = number;
export type SourceFrequencyResultId = string;
export type SymmetryNumberOverride = number | null;
export type SymmetryOverrideReason = string | null;
export type TemperatureK2 = number;
export type ThermoModel1 = "ideal-gas-rrho";
export type Charge9 = number;
/**
 * @maxItems 256
 */
export type Constraints1 = CalculationConstraint[];
export type CorrectionSchema = "chemdft.dftd4.specification.v1";
/**
 * @maxItems 8
 */
export type EngineExtensions1 =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type Multiplicity9 = number;
export type ParameterTableSha2562 = string;
/**
 * @maxItems 128
 */
export type PropertyRequests1 = string[];
export type SchemaVersion26 = "1.0.0";
export type Variant2 = "d4.bj-eeq-atm";
export type VariantSha2562 = string;
export type CalculationId14 = string;
export type EvidenceUse1 = "CURRENT" | "HISTORICAL_ONLY" | "UNKNOWN" | "NO_RESULT";
export type Available2 = boolean;
export type FileExtension = string;
export type Format = "result-json" | "trajectory-xyz" | "spectrum-csv" | "cube" | "report" | "reproducibility-bundle";
export type Label6 = string;
export type MediaType = string;
export type UnsupportedReason = string | null;
export type Detail1 = string | null;
export type Key3 = string;
export type Label7 = string;
export type Variants = ExportVariant[];
export type Formats = ExportFormatOption[];
export type ProjectId19 = string;
export type ResultId2 = string | null;
export type SchemaId1 = "chemdft.export-catalog.v1";
export type CalculationId15 = string;
export type CreatedAt13 = string;
export type Id19 = string;
export type ProjectId20 = string;
export type SchemaVersion27 = "1.0.0";
export type IdempotencyKey1 = string;
export type ProviderPreference = "AUTO" | "LOCAL" | "CLOUD";
export type A = number;
export type Alpha = number;
export type B = number;
export type Beta = number;
export type C = number;
export type Gamma = number;
export type CoordinateUnit7 = "angstrom" | "bohr";
export type CellSource = ("USER_ENTERED" | "PAPER_EVIDENCE") | null;
export type CellSourceEvidenceId = string | null;
export type CoordinateText = string;
export type Name3 = string;
export type ParentRepresentationId = string | null;
export type AtomOrdering1 = "AS_LISTED";
/**
 * @minItems 1
 * @maxItems 2000
 */
export type Atoms1 = [Atom, ...Atom[]];
/**
 * @maxItems 8000
 */
export type Bonds1 = Bond[];
export type Dimensionality1 = 3;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureKind".
 */
export type StructureKind = "MOLECULE" | "ION" | "RADICAL" | "COMPLEX" | "PERIODIC";
export type Multiplicity10 = number;
export type Name4 = string;
export type OverallCharge = number;
export type A3 = number;
export type Alpha1 = number;
export type B1 = number;
export type Beta1 = number;
export type C1 = number;
export type Gamma1 = number;
/**
 * @minItems 3
 * @maxItems 3
 */
export type LatticeVectors = [unknown, unknown, unknown];
/**
 * @minItems 3
 * @maxItems 3
 */
export type PeriodicDimensions = [unknown, unknown, unknown];
export type CoordinateUnit8 = "angstrom" | "bohr";
export type Approximation = string;
export type CandidateId1 = string;
export type CellProvenance = {
  [k: string]: unknown;
} | null;
export type ContentSha256 = string | null;
export type CoordinateProvenance = {
  [k: string]: unknown;
} | null;
export type CoordinatesAvailable = boolean;
export type CreatedAt14 = string;
export type CreatedBy1 = string;
export type DifferencesFromParent = MolecularGraphDifference[] | null;
export type Category1 = string;
export type CorrectedValue = string | null;
export type Description1 = string;
export type OriginalValue = string | null;
export type Id20 = string;
export type Method12 = string;
export type MethodVersion = string;
export type MolBlock = string | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProvenanceClass".
 */
export type ProvenanceClass =
  "EXPERIMENTAL" | "CALCULATED" | "EXTRACTED" | "DIGITIZED" | "USER_SUPPLIED" | "AI_HYPOTHESIS" | "IMPORTED";
export type RecognitionProposal = {
  [k: string]: unknown;
} | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateRepresentationOrigin".
 */
export type CandidateRepresentationOrigin =
  | "SOURCE_REFERENCE"
  | "USER_DRAFT"
  | "TEXT_RECONSTRUCTION"
  | "IMAGE_RECONSTRUCTION"
  | "AI_HYPOTHESIS"
  | "DERIVED_PREVIEW";
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateRepresentationType".
 */
export type CandidateRepresentationType =
  "IMAGE_REFERENCE" | "SMILES" | "MOL" | "MOL_BLOCK" | "COORDINATES" | "CARTESIAN_COORDINATES" | "CRYSTAL_COORDINATES";
export type CellCheckedIfUsed = boolean;
export type ChargesReviewed = boolean | null;
export type CoordinateSourceDeclared = boolean;
export type DifferencesAcknowledged = boolean;
export type InspectedSource = boolean;
export type StereochemistryReviewed = boolean | null;
export type UnderstandsMissingPaperCoordinates = boolean;
export type UnitsChecked = boolean;
export type ValidationWarningsReviewed = boolean;
export type CandidateRepresentationReviewState = "NOT_REVIEWED" | "REVIEWED" | "REJECTED";
export type Revision = number;
export type Smiles = string | null;
export type SourceRepresentationId = string | null;
/**
 * @maxItems 50
 */
export type ValidationDiagnostics = string[];
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateRepresentationValidationState".
 */
export type CandidateRepresentationValidationState = "NOT_APPLICABLE" | "INVALID" | "PARSEABLE" | "PREVIEWABLE";
export type CellSourceEvidenceId1 = string | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateCoordinateOrigin".
 */
export type CandidateCoordinateOrigin =
  | "USER_IMPORTED_FILE"
  | "USER_PASTED"
  | "USER_CREATED"
  | "USER_EDITED"
  | "EXTERNAL_DATABASE_IMPORT"
  | "GENERATED_CONFORMER";
export type MolBlock1 = string | null;
export type ParentRepresentationId1 = string | null;
export type RepresentationType = "SMILES" | "MOL" | "MOL_BLOCK" | "CARTESIAN_COORDINATES" | "CRYSTAL_COORDINATES";
export type Smiles1 = string | null;
export type CandidateId2 = string;
export type CandidateId3 = string;
export type Approximation1 = string;
export type CellProvenance1 = {
  [k: string]: unknown;
} | null;
export type ContentSha2561 = string | null;
export type CoordinateProvenance1 = {
  [k: string]: unknown;
} | null;
export type CoordinatesAvailable1 = boolean;
export type CreatedAt15 = string;
export type CreatedBy2 = string;
export type Id21 = string;
export type Method13 = string;
export type MethodVersion1 = string;
export type CandidateRepresentationReviewState1 = "NOT_REVIEWED" | "REVIEWED" | "REJECTED";
export type Revision1 = number;
export type SourceRepresentationId1 = string | null;
/**
 * @maxItems 50
 */
export type ValidationDiagnostics1 = string[];
/**
 * @maxItems 256
 */
export type Representations = CandidateRepresentationView[];
export type SchemaVersion28 = "1.0.0";
export type Reason2 = string | null;
export type Notes = string | null;
export type CheckoutUrl = string;
export type PlanKey1 = string;
export type Provider12 = string;
export type SessionReference = string;
export type TestMode = boolean;
export type CreatedAt16 = string;
export type Id22 = string;
export type KnowledgeSourceId = string;
export type ExcerptHash = string | null;
export type Figure = string | null;
export type Page = number | null;
export type Section = string | null;
export type Table = string | null;
export type ProjectId21 = string;
export type SchemaVersion29 = "1.0.0";
export type Candidates = ComparisonCandidate[];
export type ProjectId22 = string;
/**
 * @maxItems 10000
 */
export type Jobs = ComputeJobView[];
export type NextOffset = number | null;
export type Total = number | null;
export type Multiplicity11 = number;
export type Name5 = string | null;
export type HypothesisId = string;
/**
 * @minItems 1
 * @maxItems 100
 */
export type ObservationIds = [string, ...string[]];
export type Outcome2 = "OPEN" | "SUPPORTED" | "NOT_SUPPORTED" | "INCONCLUSIVE";
export type Rationale = string;
export type SchemaVersion30 = "1.0.0";
export type PlanKey2 = string;
export type Title1 = string | null;
export type SchemaVersion31 = "1.0.0";
export type SourceClass2 = "AI_HYPOTHESIS" | "USER";
export type Statement = string;
export type Objective = string;
/**
 * @maxItems 32
 */
export type AllowedToolClasses = string[];
export type ApprovalRequiredForExpensive = boolean;
export type MaxAiCalls = number;
export type MaxAiInputTokens = number;
export type MaxAiOutputTokens = number;
export type MaxCalculations = number;
export type MaxComputeMinorUnits = number;
export type MaxElapsedSeconds = number;
export type MaxSteps2 = number;
export type SchemaVersion32 = "1.0.0";
export type Title2 = string;
/**
 * @maxItems 32
 */
export type Citations1 = {
  [k: string]: unknown;
}[];
export type SchemaVersion33 = "1.0.0";
export type SourceClass3 = "CALCULATED" | "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED";
export type SourceEntityId = string;
export type SourceEntityType =
  "CALCULATION_RESULT" | "EXPERIMENTAL_DATASET" | "EVIDENCE_CANDIDATE" | "DIGITIZED_DATASET";
export type StepId1 = string | null;
export type Summary3 = string;
export type SchemaVersion34 = "1.0.0";
/**
 * @minItems 1
 * @maxItems 50
 */
export type Steps2 = [CreatePlanStepInput, ...CreatePlanStepInput[]];
export type Action = string;
export type ApprovalClass = "NONE" | "USER_REQUIRED" | "EXPENSIVE";
export type Dependencies = string[];
export type Intent = string;
export type SchemaVersion35 = "1.0.0";
export type Available3 = boolean;
export type Diagnostic2 = string | null;
export type Engine9 = "dftd4";
export type Variant3 = "d4.bj-eeq-atm";
export type Version1 = "4.2.0";
export type FailedAttemptId = string;
export type IdempotencyKey2 = string;
export type SourceResultId = string;
export type Variant4 = "d4.bj-eeq-atm";
export type Caption = string | null;
export type DocumentId1 = string;
export type FigureNumber = string | null;
export type Height = number | null;
export type PageNumber2 = number;
export type Snippet = string | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DocumentSourceType".
 */
export type DocumentSourceType = "TEXT" | "TABLE" | "FIGURE" | "REGION";
export type TableNumber = string | null;
export type Width = number | null;
export type X2 = number | null;
export type Y2 = number | null;
export type Page1 = number;
export type XLabel = string;
export type X3 = number;
export type Y3 = number;
export type XScale = "linear" | "log";
export type XUnit = string;
export type XValueA = number;
export type XValueB = number;
export type YLabel = string;
export type YScale = "linear" | "log";
export type YUnit = string;
export type YValueA = number;
export type YValueB = number;
export type ExperimentName = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExperimentModality".
 */
export type ExperimentModality = "FTIR" | "RAMAN" | "NMR" | "HRMS" | "XRD" | "UV_VIS" | "TG_DTA" | "DLS" | "OTHER";
/**
 * @minItems 1
 * @maxItems 200000
 */
export type Points = [DigitizerPoint, ...DigitizerPoint[]];
export type Approximation2 = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureCandidateState".
 */
export type StructureCandidateState = "DETECTED" | "REVIEWED" | "REJECTED" | "PROMOTED";
export type CoordinatesAvailable2 = boolean;
export type CreatedAt17 = string;
export type CreatedBy3 = string;
export type Id23 = string;
export type Method14 = string;
export type MethodVersion2 = string;
export type ProjectId23 = string;
export type PromotedStructureVersionId = string | null;
/**
 * @maxItems 32
 */
export type RepresentationTypes = CandidateRepresentationType[];
/**
 * @maxItems 32
 */
export type Representations1 = CandidateRepresentationView[];
export type ReviewedAt = string | null;
export type ReviewedBy = string | null;
export type SchemaVersion36 = "1.0.0";
export type SourceAnchorId2 = string | null;
export type SourceDocumentId1 = string;
export type SourceEvidenceId = string;
export type SourcePage = number | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureCandidateSourceType".
 */
export type StructureCandidateSourceType =
  | "REPORTED_FIGURE"
  | "IMAGE_RECONSTRUCTION"
  | "TEXT_RECONSTRUCTION"
  | "USER_DRAFT"
  | "IMPORTED_COORDINATES_PENDING_REVIEW";
/**
 * @maxItems 10000
 */
export type Candidates1 = StructureCandidate[];
export type DocumentId2 = string;
export type SchemaVersion37 = "1.0.0";
export type Content1 = string;
/**
 * @maxItems 6
 */
export type History =
  | []
  | [DrawHistoryTurn]
  | [DrawHistoryTurn, DrawHistoryTurn]
  | [DrawHistoryTurn, DrawHistoryTurn, DrawHistoryTurn]
  | [DrawHistoryTurn, DrawHistoryTurn, DrawHistoryTurn, DrawHistoryTurn]
  | [DrawHistoryTurn, DrawHistoryTurn, DrawHistoryTurn, DrawHistoryTurn, DrawHistoryTurn]
  | [DrawHistoryTurn, DrawHistoryTurn, DrawHistoryTurn, DrawHistoryTurn, DrawHistoryTurn, DrawHistoryTurn];
export type Content2 = string;
export type Role1 = "user" | "assistant";
export type Molfile = string | null;
export type PreviousMolfile = string | null;
export type SchemaVersion38 = "1.0.0";
/**
 * @maxItems 4
 */
export type Options =
  | []
  | [DrawClarifyOption]
  | [DrawClarifyOption, DrawClarifyOption]
  | [DrawClarifyOption, DrawClarifyOption, DrawClarifyOption]
  | [DrawClarifyOption, DrawClarifyOption, DrawClarifyOption, DrawClarifyOption];
export type Label8 = string;
export type Message1 = string;
export type Question = string;
export type Error = string | null;
export type ErrorCode3 = string | null;
export type AtomCount2 = number;
export type Formula = string;
export type Molfile1 = string;
export type Smiles2 = string;
export type Info = string[];
export type InputTokens2 = number | null;
export type Label9 = "AI-drafted · schematic";
export type Model4 = string | null;
export type OutputTokens2 = number | null;
export type Label10 = string;
export type Note1 = string;
export type Smiles3 = string;
export type Proposals = DrawProposal[];
export type Formula1 = string;
export type Name6 = string;
export type Note2 = string;
export type Repaired = boolean;
export type Reply = string;
export type RunId3 = string | null;
export type SchemaVersion39 = "1.0.0";
export type Status9 = "OK" | "PARTIAL" | "NEEDS_ATTENTION" | "REJECTED" | "CLARIFY" | "REFUSED" | "NO_CHANGE" | "ERROR";
export type AtomCount3 = number;
export type Description2 = string;
export type Error1 = string | null;
export type Formula2 = string | null;
export type Index6 = number;
export type Molfile2 = string | null;
export type NewAtomNumbers = number[];
export type Ok = boolean;
export type Smiles4 = string | null;
export type Suggestion = string | null;
/**
 * @maxItems 100
 */
export type Steps3 = DrawStepView[];
export type Warnings1 = string[];
/**
 * @maxItems 32
 */
export type AllowedTools = AIToolPolicy[];
export type CanWrite = boolean;
export type ContextVersion = "1.1.0";
export type Authority1 = "STRUCTURE_VERSION" | "USER_DECLARED_XYZ" | "CALCULATION_USER_DECLARED";
export type SourceArtifactId = string | null;
export type SourceSha2561 = string | null;
export type StructureProvenanceId = string | null;
export type StructureVersionId6 = string;
export type ExampleSlug = string | null;
export type ExecutionRequiresResearcherApproval = true;
export type GeneratedAt = string;
/**
 * @maxItems 16
 */
export type GroundingFacts =
  | []
  | [GroundingFact]
  | [GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ];
export type EntityId2 = string;
export type EvidenceClass = string;
export type Kind2 = "claim" | "job" | "compared_result";
export type Label11 = string;
export type VerificationNote = string | null;
/**
 * @maxItems 8
 */
export type GroundingNotes =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string];
export type GroundingPolicy = string | null;
export type HumanId = string;
export type InterpretationSourceClass = "AI_HYPOTHESIS";
export type ActionId =
  | "structure.draw"
  | "structure.import"
  | "structure.inspect"
  | "structure.edit"
  | "structure.inspect_unit_cell"
  | "structure.build_supercell"
  | "calculation.single_point"
  | "calculation.optimize"
  | "calculation.orbitals"
  | "spectra.predict_ir"
  | "spectra.predict_raman"
  | "spectra.predict_uv_vis"
  | "spectra.upload_experimental"
  | "spectra.inspect_experimental"
  | "spectra.process_experimental"
  | "spectra.compare"
  | "spectra.inspect_computed"
  | "electronic.inspect_orbitals"
  | "electronic.inspect_homo_lumo"
  | "electronic.inspect_density"
  | "electronic.inspect_esp"
  | "thermochemistry.calculate"
  | "thermochemistry.inspect"
  | "evidence.import_document"
  | "evidence.import_calculation"
  | "evidence.inspect_provenance"
  | "jobs.review";
/**
 * @maxItems 16
 */
export type Reasons =
  | []
  | [
      | "structure_missing"
      | "coordinates_3d_required"
      | "charge_required"
      | "multiplicity_required"
      | "molecule_required"
      | "lattice_required"
      | "crystal_required"
      | "periodic_compute_unsupported"
      | "optimization_required"
      | "worker_unavailable"
      | "optimizer_unavailable"
      | "job_in_progress"
      | "editor_required"
      | "template_sealed"
      | "frequency_required"
      | "imaginary_frequencies"
      | "stationarity_unproven"
      | "frequency_geometry_mismatch"
      | "closed_shell_required"
      | "matching_level_required"
      | "orbitals_required"
      | "computed_spectrum_required"
      | "experimental_spectrum_required"
      | "spectrum_association_required"
      | "experimental_peaks_required"
      | "matching_spectrum_type_required"
      | "thermochemistry_required"
      | "provenance_required"
      | "job_required"
      | "history_limit_reached",
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ]
  | [
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
      (
        | "structure_missing"
        | "coordinates_3d_required"
        | "charge_required"
        | "multiplicity_required"
        | "molecule_required"
        | "lattice_required"
        | "crystal_required"
        | "periodic_compute_unsupported"
        | "optimization_required"
        | "worker_unavailable"
        | "optimizer_unavailable"
        | "job_in_progress"
        | "editor_required"
        | "template_sealed"
        | "frequency_required"
        | "imaginary_frequencies"
        | "stationarity_unproven"
        | "frequency_geometry_mismatch"
        | "closed_shell_required"
        | "matching_level_required"
        | "orbitals_required"
        | "computed_spectrum_required"
        | "experimental_spectrum_required"
        | "spectrum_association_required"
        | "experimental_peaks_required"
        | "matching_spectrum_type_required"
        | "thermochemistry_required"
        | "provenance_required"
        | "job_required"
        | "history_limit_reached"
      ),
    ];
/**
 * @maxItems 32
 */
export type Blocked = ProductBlocked[];
export type Goal =
  ("optimize" | "energy" | "ir" | "raman" | "uv_vis" | "orbitals" | "thermochemistry" | "compare" | "crystal") | null;
/**
 * @maxItems 64
 */
export type Have = string[];
/**
 * @maxItems 32
 */
export type Next = (
  | "structure.draw"
  | "structure.import"
  | "structure.inspect"
  | "structure.edit"
  | "structure.inspect_unit_cell"
  | "structure.build_supercell"
  | "calculation.single_point"
  | "calculation.optimize"
  | "calculation.orbitals"
  | "spectra.predict_ir"
  | "spectra.predict_raman"
  | "spectra.predict_uv_vis"
  | "spectra.upload_experimental"
  | "spectra.inspect_experimental"
  | "spectra.process_experimental"
  | "spectra.compare"
  | "spectra.inspect_computed"
  | "electronic.inspect_orbitals"
  | "electronic.inspect_homo_lumo"
  | "electronic.inspect_density"
  | "electronic.inspect_esp"
  | "thermochemistry.calculate"
  | "thermochemistry.inspect"
  | "evidence.import_document"
  | "evidence.import_calculation"
  | "evidence.inspect_provenance"
  | "jobs.review"
)[];
/**
 * @maxItems 16
 */
export type Notices =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
export type OrganizationId2 = string;
export type PlanningProfile = "PYSCF_ENERGY_PROPOSAL";
export type ProjectId24 = string;
export type ProjectKind = "NORMAL" | "LEGACY_LOCAL" | "ACCEPTANCE_FROZEN" | "EXAMPLE_TEMPLATE";
export type ProjectName = string;
export type PublishedExample = boolean;
/**
 * @maxItems 8
 */
export type Resources =
  | []
  | [ProductResource]
  | [ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource, ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource, ProductResource, ProductResource, ProductResource]
  | [
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
    ]
  | [
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
    ];
export type ArtifactId1 = string | null;
export type AuthoritativeCalculation = boolean;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ResultAuthority".
 */
export type ResultAuthority1 = "CANDIDATE" | "AUTHORITATIVE" | "VERIFICATION" | "IMPORTED";
export type CalculationId16 = string | null;
export type EntityId3 = string;
export type EntityType1 =
  "structure.version" | "calculation.result" | "imported.result" | "document" | "experimental.dataset";
export type Label12 = string;
export type ProvenanceId1 = string | null;
export type ReferenceStructure = boolean;
export type Sha2561 = string | null;
export type StructureVersionId7 = string | null;
export type Role2 = string;
export type AtomIndex = number | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureDiagnosticCode".
 */
export type StructureDiagnosticCode =
  | "UNKNOWN_ELEMENT"
  | "ATOMIC_NUMBER_MISMATCH"
  | "INVALID_BOND_INDEX"
  | "DUPLICATE_BOND"
  | "SANITIZATION_FAILED"
  | "UNUSUAL_VALENCE"
  | "MISSING_CONNECTIVITY"
  | "PARTIAL_OCCUPANCY"
  | "DISORDERED_SITE"
  | "UNSUPPORTED_FEATURE"
  | "PARSER_WARNING";
export type Message2 = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DiagnosticSeverity".
 */
export type DiagnosticSeverity = "ERROR" | "WARNING" | "INFO";
/**
 * @maxItems 128
 */
export type Diagnostics = StructureDiagnostic[];
export type ElectronicStateAuthority = ("STRUCTURE_VERSION" | "USER_DECLARED_XYZ" | "CALCULATION_USER_DECLARED") | null;
export type ActorId = string | null;
export type Adapter = string | null;
export type AdapterVersion5 = string | null;
export type CalculationId17 = string | null;
export type CandidateRepresentationId = string | null;
export type CandidateSha256 = string | null;
export type CoordinateFileSha256 = string | null;
export type CoordinateInputFormat = string | null;
export type CoordinateOrigin = string | null;
export type CoordinateUnit9 = string | null;
export type CreatedAt18 = string | null;
export type Detail2 = string | null;
export type FinalStepIndex = number | null;
export type GenerationMethod1 = string | null;
export type GeometryCandidateId = string | null;
export type GeometryClass = string | null;
export type Operation = string | null;
export type OperationVersion = string | null;
export type Origin = string;
export type Parser = string | null;
export type ParserVersion7 = string | null;
export type SourceClass4 = string | null;
export type SourceReference = string | null;
export type TrajectoryId = string | null;
export type VerificationState3 = string | null;
export type CreatedAt19 = string;
export type CreatedBy4 = string;
export type Id24 = string;
export type Name7 = string;
export type ProjectId25 = string;
/**
 * @maxItems 256
 */
export type SampleIds = string[];
export type SchemaVersion40 = "1.0.0";
export type CreatedAt20 = string;
export type CreatedBy5 = string;
/**
 * @maxItems 128
 */
export type Diagnostics1 = StructureDiagnostic[];
export type Id25 = string;
export type Multiplicity12 = number;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureVersionOrigin".
 */
export type StructureVersionOrigin =
  | "IMPORTED"
  | "MANUALLY_EDITED"
  | "GENERATED"
  | "OPTIMIZED"
  | "DERIVED"
  | "AI_PROPOSED"
  | "RECONSTRUCTED"
  | "IMPORTED_CALCULATION";
export type OverallCharge1 = number;
export type ParentVersionId = string | null;
export type ProjectId26 = string;
/**
 * @minItems 1
 * @maxItems 32
 */
export type RepresentationArtifacts = [ArtifactReference, ...ArtifactReference[]];
export type Revision2 = number;
export type SchemaVersion41 = "1.0.0";
export type StructureId2 = string;
export type Sealed = boolean;
export type ComparedResultIds =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string]
  | null;
export type CurrentView = string | null;
export type Goal1 =
  ("optimize" | "energy" | "ir" | "raman" | "uv_vis" | "orbitals" | "thermochemistry" | "compare" | "crystal") | null;
export type SelectedClaimId = string | null;
export type SelectedDocumentId = string | null;
export type SelectedJobId = string | null;
export type SelectedResultId = string | null;
export type SelectedSpectrumId = string | null;
export type SelectedStructureId = string | null;
export type SelectedStructureVersionId = string | null;
export type ViewHint = string | null;
export type ViewHintIsUntrusted = true;
export type Availability = "AVAILABLE" | "UNAVAILABLE" | "MISCONFIGURED";
export type Diagnostic3 = string | null;
export type Engine10 = string;
export type SupportedBasisSets = string[];
export type Basis10 = string;
export type Method15 = string;
/**
 * @maxItems 128
 */
export type SupportedMethodBasisPairs = EngineMethodBasisPair[];
export type SupportedMethods = string[];
export type SupportedOptimizationLevels = string[];
export type SupportedOptimizers = string[];
export type SupportedTasks = string[];
export type Version2 = string | null;
export type CitationId2 = string | null;
export type CreatedAt21 = string;
export type CreatedBy6 = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "EvidenceDirection".
 */
export type EvidenceDirection = "SUPPORTING" | "CONTRADICTING" | "NEUTRAL_RELATED";
export type Id26 = string;
export type ProjectId27 = string;
export type SchemaVersion42 = "1.0.0";
export type CreatedAt22 = string;
/**
 * @maxItems 32
 */
export type Diagnostics2 = {
  [k: string]: string;
}[];
export type DocumentId3 = string;
export type EvidenceType = string;
export type ExtractionMethod = string;
export type ExtractorVersion = string;
export type Id27 = string;
export type ProjectId28 = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "EvidenceReviewState".
 */
export type EvidenceReviewState = "DETECTED" | "ACCEPTED" | "REJECTED" | "SUPERSEDED";
export type SchemaVersion43 = "1.0.0";
export type SourceClass5 = "EXTRACTED" | "DIGITIZED" | "AI_HYPOTHESIS";
export type Decision1 = "ACCEPTED" | "REJECTED";
export type NormalizedPayload = {
  [k: string]: unknown;
} | null;
export type Reason3 = string | null;
export type VerificationState4 = "UNVERIFIED" | "VERIFIED" | "DISPUTED";
export type CopiedAt = string;
export type CopiedResultCount = 0;
export type ExampleSlug1 = string;
export type Kind3 = "NORMAL";
export type OrganizationId3 = string;
export type ProjectId29 = string;
export type TemplateProjectId = string;
export type TemplateVersion = string;
export type AtomCount4 = number;
export type AvailableResultTypes = string[];
export type Citation1 = string;
export type CitationUrl = string;
export type DataClass = "REFERENCE_STRUCTURE";
export type Description3 = string;
export type Formula3 = string;
export type LicenceUrl = string;
export type PublicationState = "PUBLISHED";
export type RelatedContext = string | null;
export type ReuseBasis = string;
export type ReviewDate = string;
export type Sealed1 = true;
export type Slug = string;
export type Source5 = string;
export type SourceIdentifier = string;
export type SourceSha2562 = string;
export type SourceUrl = string;
export type SpaceGroup = string | null;
export type TemplateProjectId1 = string;
export type TemplateVersion1 = string;
export type Title3 = string;
export type Type = "molecule" | "crystal";
export type ActionId1 =
  | "structure.draw"
  | "structure.import"
  | "structure.inspect"
  | "structure.edit"
  | "structure.inspect_unit_cell"
  | "structure.build_supercell"
  | "calculation.single_point"
  | "calculation.optimize"
  | "calculation.orbitals"
  | "spectra.predict_ir"
  | "spectra.predict_raman"
  | "spectra.predict_uv_vis"
  | "spectra.upload_experimental"
  | "spectra.inspect_experimental"
  | "spectra.process_experimental"
  | "spectra.compare"
  | "spectra.inspect_computed"
  | "electronic.inspect_orbitals"
  | "electronic.inspect_homo_lumo"
  | "electronic.inspect_density"
  | "electronic.inspect_esp"
  | "thermochemistry.calculate"
  | "thermochemistry.inspect"
  | "evidence.import_document"
  | "evidence.import_calculation"
  | "evidence.inspect_provenance"
  | "jobs.review";
export type Category2 = string;
export type ConflictingFacts = string[];
export type DescriptionKey = string;
export type GoalIds = (
  "optimize" | "energy" | "ir" | "raman" | "uv_vis" | "orbitals" | "thermochemistry" | "compare" | "crystal"
)[];
export type MinimumRoleKey = string;
export type Code3 =
  | "structure_missing"
  | "coordinates_3d_required"
  | "charge_required"
  | "multiplicity_required"
  | "molecule_required"
  | "lattice_required"
  | "crystal_required"
  | "periodic_compute_unsupported"
  | "optimization_required"
  | "worker_unavailable"
  | "optimizer_unavailable"
  | "job_in_progress"
  | "editor_required"
  | "template_sealed"
  | "frequency_required"
  | "imaginary_frequencies"
  | "stationarity_unproven"
  | "frequency_geometry_mismatch"
  | "closed_shell_required"
  | "matching_level_required"
  | "orbitals_required"
  | "computed_spectrum_required"
  | "experimental_spectrum_required"
  | "spectrum_association_required"
  | "experimental_peaks_required"
  | "matching_spectrum_type_required"
  | "thermochemistry_required"
  | "provenance_required"
  | "job_required"
  | "history_limit_reached";
export type MessageKey = string;
export type Reasons1 = NavigatorReason[];
export type RequiredCapability = "read" | "write";
export type RequiredFacts = string[];
export type ResultingFact = string;
export type Launch =
  | "draw"
  | "structure_import"
  | "inspect"
  | "edit"
  | "cell"
  | "supercell"
  | "energy"
  | "optimization"
  | "orbitals"
  | "ir"
  | "raman"
  | "uvvis"
  | "spectrum_import"
  | "experimental"
  | "compare"
  | "spectra"
  | "mo"
  | "density"
  | "esp"
  | "thermochemistry"
  | "document_import"
  | "calculation_import"
  | "provenance"
  | "jobs";
export type Route = "workspace" | "jobs";
export type SelectionId = string | null;
export type SelectionKind = ("structureVersion" | "calculationResult" | "experimentalSpectrum") | null;
export type SourceId = string | null;
export type TitleKey = string;
export type Blocked1 = NavigatorAction[];
export type Goal2 =
  ("optimize" | "energy" | "ir" | "raman" | "uv_vis" | "orbitals" | "thermochemistry" | "compare" | "crystal") | null;
export type HaveIds = string[];
export type NextIds = (
  | "structure.draw"
  | "structure.import"
  | "structure.inspect"
  | "structure.edit"
  | "structure.inspect_unit_cell"
  | "structure.build_supercell"
  | "calculation.single_point"
  | "calculation.optimize"
  | "calculation.orbitals"
  | "spectra.predict_ir"
  | "spectra.predict_raman"
  | "spectra.predict_uv_vis"
  | "spectra.upload_experimental"
  | "spectra.inspect_experimental"
  | "spectra.process_experimental"
  | "spectra.compare"
  | "spectra.inspect_computed"
  | "electronic.inspect_orbitals"
  | "electronic.inspect_homo_lumo"
  | "electronic.inspect_density"
  | "electronic.inspect_esp"
  | "thermochemistry.calculate"
  | "thermochemistry.inspect"
  | "evidence.import_document"
  | "evidence.import_calculation"
  | "evidence.inspect_provenance"
  | "jobs.review"
)[];
export type AtomCount5 = number;
export type CanWrite1 = boolean;
export type Charge10 = number | null;
export type ComputedSpectrumTypes = string[];
export type CoordinateDimensionality = number | null;
export type ExperimentalSpectrumTypes = string[];
export type FailedJobs = number;
export type HistoryComplete = boolean;
export type Multiplicity13 = number | null;
export type Optimized = boolean;
export type RunningJobs = number;
export type Sealed2 = boolean;
export type StructureId3 = string | null;
export type StructureName2 = string | null;
export type StructureType = ("molecule" | "crystal") | null;
export type StructureVersionId8 = string | null;
export type ValidFrequency = boolean;
export type Goal3 =
  ("optimize" | "energy" | "ir" | "raman" | "uv_vis" | "orbitals" | "thermochemistry" | "compare" | "crystal") | null;
export type GoalId =
  "optimize" | "energy" | "ir" | "raman" | "uv_vis" | "orbitals" | "thermochemistry" | "compare" | "crystal";
export type Satisfied = boolean;
export type TitleKey1 = string;
export type Goals = NavigatorGoal[];
export type Detail3 = string | null;
export type LabelKey = string;
export type StateId = string;
export type Have1 = NavigatorHave[];
export type Next1 = NavigatorAction[];
export type Notices1 = string[];
export type ProjectId30 = string;
export type Version3 = 1;
export type CalculationId18 = string;
export type CalculationInputId5 = string;
export type CorrelationId1 = string;
export type IdempotencyKey3 = string;
export type RequirementHash2 = string;
export type ReservationId = string;
export type AcquiredAt = string | null;
export type Name8 = string;
export type Value4 = ScientificQuantity | string;
/**
 * @maxItems 128
 */
export type Conditions = AcquisitionCondition[];
export type CreatedAt23 = string;
export type CreatedBy7 = string;
export type Extension =
  | (
      | FtirExtension
      | NmrExtension
      | HrmsExtension
      | XrdExtension
      | UvVisExtension
      | TgDtaExtension
      | DlsExtension
      | OtherExperimentExtension
    )
  | null;
export type Modality = "FTIR";
export type SchemaVersion44 = string;
/**
 * @maxItems 8
 */
export type Settings =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type Modality1 = "NMR";
/**
 * @maxItems 32
 */
export type Nuclei = string[];
export type SchemaVersion45 = string;
/**
 * @maxItems 8
 */
export type Settings1 =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type IonizationMode = string | null;
export type Modality2 = "HRMS";
export type SchemaVersion46 = string;
/**
 * @maxItems 8
 */
export type Settings2 =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type Modality3 = "XRD";
export type RadiationSource = string | null;
export type SchemaVersion47 = string;
/**
 * @maxItems 8
 */
export type Settings3 =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type Modality4 = "UV_VIS";
export type SchemaVersion48 = string;
/**
 * @maxItems 8
 */
export type Settings4 =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type Modality5 = "TG_DTA";
export type SchemaVersion49 = string;
/**
 * @maxItems 8
 */
export type Settings5 =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type Modality6 = "DLS";
export type SchemaVersion50 = string;
/**
 * @maxItems 8
 */
export type Settings6 =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type Modality7 = "OTHER";
export type ModalityIdentifier = string;
export type SchemaVersion51 = string;
/**
 * @maxItems 8
 */
export type Settings7 =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type Id28 = string;
export type InstrumentReference = string | null;
export type Name9 = string;
export type OperatorOrSource = string | null;
export type ProjectId31 = string;
export type SampleId = string;
export type SchemaVersion52 = "1.0.0";
export type IdempotencyKey4 = string | null;
export type CreatedAt24 = string;
export type ExperimentId = string;
export type Id29 = string;
/**
 * @maxItems 256
 */
export type InputDatasetIds = string[];
export type ActorId1 = string;
export type Algorithm1 = string;
export type AlgorithmVersion1 = string;
/**
 * @maxItems 8
 */
export type Parameters =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type PerformedAt = string;
/**
 * @maxItems 64
 */
export type Processing = ProcessingStep[];
export type ProjectId32 = string;
export type SchemaVersion53 = "1.0.0";
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DatasetProcessingState".
 */
export type DatasetProcessingState = "RAW" | "NORMALIZED" | "DERIVED";
export type Direction = "ASCENDING" | "DESCENDING";
export type Label13 = string;
export type Axes = AxisDefinition[];
export type CreatedAt25 = string;
export type DigitizationSession = XrdDigitizationSession | GraphDigitizationSession | null;
export type CreatedAt26 = string;
export type DatasetSha256 = string;
export type FigureNumber1 = string;
export type OperatorId = string;
export type PageNumber3 = number;
export type ParentDatasetId = string | null;
export type Height1 = number;
export type Width1 = number;
export type X4 = number;
export type Y4 = number;
export type PointMode = "PEAK_PICKING" | "CURVE_POINTS";
/**
 * @minItems 1
 * @maxItems 200000
 */
export type Points1 = [XrdDigitizedPoint, ...XrdDigitizedPoint[]];
export type Intensity = number | null;
export type PointOrder = number;
export type X5 = number;
export type Y5 = number;
export type TwoThetaDegree = number;
export type EvidenceId = string;
export type PageNumber4 = number;
export type SourceClass6 = "EXTRACTED";
export type TwoThetaDegree1 = number;
export type Unit2 = "degree";
/**
 * @maxItems 1000
 */
export type ReportedPeaks = XrdReportedPeak[];
export type Revision3 = number;
export type SchemaVersion54 = "1.0.0";
export type SessionId = string;
export type SourceArtifactId1 = string;
export type SourceArtifactSha256 = string;
export type SourceDocumentId2 = string;
export type SourceEvidenceId1 = string;
export type SourcePixelHeight = number;
export type SourcePixelWidth = number;
export type SourceRenderScale = number;
export type SourceRenderSha256 = string;
export type SourceRenderVersion = string;
export type State2 = "COMMITTED";
export type UserAction = "MANUAL_PEAK_PICKING" | "MANUAL_CURVE_POINTING";
export type Label14 = string;
export type Scale = "linear";
export type Unit3 = string;
export type ValueA = number;
export type ValueB = number;
export type YUnitStatus = "UNKNOWN" | "ARBITRARY" | "SOURCE_DEFINED";
export type CreatedAt27 = string;
export type DatasetSha2561 = string;
export type FigureNumber2 = string;
export type OperatorId1 = string;
export type PageNumber5 = number;
export type ParentDatasetId1 = string | null;
export type PointMode1 = "CURVE_POINTS" | "HISTOGRAM_POINTS";
/**
 * @minItems 1
 * @maxItems 200000
 */
export type Points2 = [GraphDigitizedPoint, ...GraphDigitizedPoint[]];
export type PointOrder1 = number;
export type XValue = number;
export type YValue = number;
export type Revision4 = number;
export type SchemaVersion55 = "1.0.0";
export type SessionId1 = string;
export type SourceArtifactId2 = string;
export type SourceArtifactSha2561 = string;
export type SourceDocumentId3 = string;
export type SourceEvidenceId2 = string;
export type SourcePixelHeight1 = number;
export type SourcePixelWidth1 = number;
export type SourceRenderScale1 = number;
export type SourceRenderSha2561 = string;
export type SourceRenderVersion1 = string;
export type State3 = "COMMITTED";
export type Label15 = string;
export type Scale1 = "linear" | "log";
export type Unit4 = string;
export type ValueA1 = number;
export type ValueB1 = number;
export type ExperimentId1 = string;
export type Id30 = string;
export type Name10 = string;
export type PointCount = number;
export type ProjectId33 = string;
/**
 * @maxItems 200000
 */
export type Values1 = {
  [k: string]: number;
}[];
/**
 * @maxItems 10000
 */
export type Datasets = ExperimentalDatasetView[];
export type Delimiter = string;
export type ExperimentName1 = string;
export type HasHeader = boolean;
export type XColumn = string;
export type XLabel1 = string;
export type XUnit1 = string;
/**
 * @minItems 1
 * @maxItems 8
 */
export type YColumns =
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string];
export type YLabel1 = string;
export type YUnit1 = string;
/**
 * @minItems 2
 * @maxItems 8
 */
export type Axes1 =
  | [AxisDefinition, AxisDefinition]
  | [AxisDefinition, AxisDefinition, AxisDefinition]
  | [AxisDefinition, AxisDefinition, AxisDefinition, AxisDefinition]
  | [AxisDefinition, AxisDefinition, AxisDefinition, AxisDefinition, AxisDefinition]
  | [AxisDefinition, AxisDefinition, AxisDefinition, AxisDefinition, AxisDefinition, AxisDefinition]
  | [AxisDefinition, AxisDefinition, AxisDefinition, AxisDefinition, AxisDefinition, AxisDefinition, AxisDefinition]
  | [
      AxisDefinition,
      AxisDefinition,
      AxisDefinition,
      AxisDefinition,
      AxisDefinition,
      AxisDefinition,
      AxisDefinition,
      AxisDefinition,
    ];
export type DatasetId = string;
export type Extension1 = TgDtaExtension | DlsExtension | null;
export type Id31 = string;
export type Modality8 = "TG_DTA" | "DLS";
export type PointCount1 = number;
export type ProjectId34 = string;
export type SchemaVersion56 = "1.0.0";
export type IdempotencyKey5 = string;
export type PreviewSha256 = string;
export type ConfirmedAt = string;
export type ConfirmedBy = string;
export type PreviewSha2561 = string;
export type CreatedAt28 = string;
export type CreatedBy8 = string;
export type Id32 = string;
export type ImporterVersion = string;
export type ParseTimestamp = string;
export type ErrorLogs = string[];
export type NetworkOrArchiveAttempts = number;
export type SuccessFlag = boolean | string;
export type Code4 = string;
export type Line = number | null;
export type Message3 = string;
export type Severity = "reject" | "warning" | "info";
export type Diagnostics3 = ImportDiagnostic[];
export type ImporterVersion1 = string;
export type Detail4 = string;
export type Id33 = string;
export type ResultType3 = string | null;
export type State4 = "DETECTED" | "UNAVAILABLE" | "WARNING" | "REJECTED";
export type Title4 = string;
export type Items = ImportItem[];
export type Evidence2 = string[];
export type Status10 = "ESTABLISHED" | "REPORTED" | "UNKNOWN";
export type Value5 = string;
export type Charge11 = number | null;
export type Evidence3 = string;
export type Requested2 = boolean;
export type Status11 = "CONVERGED" | "NOT_CONVERGED" | "NOT_REQUESTED";
export type Evidence4 = string;
export type Status12 = "CONVERGED" | "NOT_CONVERGED" | "UNKNOWN";
export type Index7 = number;
export type InternalSteps = number;
export type JobCount = number;
export type JobType = string;
export type JobTypeEvidence = string[];
/**
 * @minItems 2
 * @maxItems 2
 */
export type LineRange = [unknown, unknown];
export type Multiplicity14 = number | null;
export type NAtoms = number | null;
export type Orientation = string;
export type Reference2 = "restricted" | "unrestricted" | "restricted-open-shell" | "unknown";
export type SolventModel = string | null;
export type Evidence5 = string;
export type Status13 = "COMPLETED" | "INCOMPLETE" | "ERROR_TERMINATION";
export type Index8 = number;
export type InternalSteps1 = number;
export type JobType1 = string;
/**
 * @minItems 2
 * @maxItems 2
 */
export type LineRange1 = [unknown, unknown];
export type Jobs1 = ImportJobBrief[];
export type NormalizationVersion = string;
export type Commit = string;
export type Name11 = "cclib";
export type Version4 = string;
export type WheelSha256 = string;
export type Engine11 = ("Gaussian" | "ORCA") | null;
export type Label16 = string | null;
export type Version5 = string | null;
export type ResultType4 = string;
export type SourceAttributes = string[];
export type Results1 = ImportResultSummary[];
export type Semantic = {
  [k: string]: number | boolean | string;
} | null;
export type Encoding = string | null;
export type LineCount = number | null;
export type ReplacedBytes = number | null;
export type Sha2562 = string;
export type SizeBytes = number;
export type Status14 = "READY" | "REJECTED";
export type PreviewArtifactId = string | null;
export type PreviewSha2562 = string;
export type ProjectId35 = string;
export type Immutable = true;
export type MediaClass = "text/plain; chemdft=external-output";
export type OriginalName = string;
export type RawArtifactId = string | null;
export type Sha2563 = string;
export type SizeBytes1 = number;
export type UploadedAt = string;
export type State5 = "PREVIEW_READY" | "REJECTED" | "IMPORTED";
export type Charge12 = number;
export type CreatedAt29 = string;
export type Id34 = string;
export type ImportId = string;
export type JobIndex = number;
/**
 * @minItems 2
 * @maxItems 2
 */
export type LineRange2 = [unknown, unknown];
export type Multiplicity15 = number;
export type SourceJobType = string;
export type StructureId4 = string;
export type StructureVersionId9 = string;
export type Jobs2 = ExternalImportJobView[];
export type Authority2 = "IMPORTED";
export type CreatedAt30 = string;
export type Id35 = string;
export type ImportId1 = string;
export type ImportJobId = string;
export type NormalizationVersion1 = string;
export type Payload3 =
  | ImportedStructurePayload
  | ImportedEnergyPayload
  | ImportedOptimizationPayload
  | ImportedOrbitalTablePayload
  | ImportedVibrationsPayload
  | ImportedExcitationsPayload
  | ImportedThermochemistryPayload;
/**
 * @minItems 1
 * @maxItems 10000
 */
export type Atoms2 = [ImportedAtom, ...ImportedAtom[]];
export type AtomicNumber1 = number;
export type Element1 = string;
export type Index9 = number;
export type X6 = number;
export type Y6 = number;
export type Z1 = number;
export type Bonds2 = string;
export type Charge13 = number;
export type CoordinateUnit10 = "angstrom";
export type FrameCount = number;
export type FrameIndex = number;
export type Orientation1 = string;
export type GeometryRole1 = "final-optimized" | "single-geometry" | "final-frame";
export type Multiplicity16 = number;
export type NormalizationVersion2 = string;
export type Optimized1 = boolean;
export type PayloadSchema12 = "chemdft.imported.structure";
export type PayloadSchemaVersion11 = "1.0.0";
export type Program = "Gaussian" | "ORCA";
export type ProgramLabel = string;
/**
 * @minItems 1
 * @maxItems 40
 */
export type SourceAttributes1 = [string, ...string[]];
export type SourceClass7 = "IMPORTED";
export type EnergyKind = string;
export type ExcitedStateEnergies = string;
export type IncludesDispersionCorrection = string | null;
export type Method16 = string;
export type NormalizationVersion3 = string;
export type PayloadSchema13 = "chemdft.imported.energy";
export type PayloadSchemaVersion12 = "1.0.0";
export type Reference3 = "restricted" | "unrestricted" | "restricted-open-shell" | "unknown";
export type Conversion =
  "cclib.eV->Eh/1" | "cclib.cm-1->Eh/1" | "cclib.cm-1->eV/1" | "cm-1->nm/1" | "atm->Pa/1" | "identity";
export type RawUnit = "eV" | "Eh" | "Eh/K";
export type RawValue = number;
export type Unit5 = "Eh" | "Eh/K";
export type Value6 = number;
export type ScfEnergyCount = number;
export type SolventModel1 = string | null;
/**
 * @minItems 1
 * @maxItems 40
 */
export type SourceAttributes2 = [string, ...string[]];
export type SourceClass8 = "IMPORTED";
export type CclibOptdone = boolean | null;
export type Converged7 = true;
export type ConvergenceEvidence = string;
export type CriteriaNames = string;
export type CriteriaTargets = number[] | null;
export type FinalCriteriaValues = number[] | null;
export type FinalFrameIndex = number;
export type FinalStructure = string;
export type FrameCount1 = number;
export type FramesAngstrom = [unknown, unknown, unknown][][] | null;
export type FramesOmittedReason = string | null;
export type NormalizationVersion4 = string;
export type PayloadSchema14 = "chemdft.imported.optimization";
export type PayloadSchemaVersion13 = "1.0.0";
export type ScfEnergiesHartree = number[];
export type ScfEnergyUnitNote = string;
/**
 * @minItems 1
 * @maxItems 40
 */
export type SourceAttributes3 = [string, ...string[]];
export type SourceClass9 = "IMPORTED";
export type Conversion1 = "cclib.eV->Eh/1";
export type NormalizationVersion5 = string;
export type OccupationBasis = string;
export type OrbitalCoefficients = string;
export type PayloadSchema15 = "chemdft.imported.orbital-table";
export type PayloadSchemaVersion14 = "1.0.0";
export type RawUnit1 = "eV";
/**
 * @minItems 1
 * @maxItems 40
 */
export type SourceAttributes4 = [string, ...string[]];
export type SourceClass10 = "IMPORTED";
/**
 * @minItems 1
 * @maxItems 2
 */
export type SpinChannels = [ImportedOrbitalChannel] | [ImportedOrbitalChannel, ImportedOrbitalChannel];
export type EnergiesHartree = number[];
export type HomoIndex2 = number | null;
export type Label17 = string;
export type Occupations = number[] | null;
export type OrbitalCount = number;
export type RawEnergiesEv = number[];
export type Symmetries = string[] | null;
export type DepolarizationRatios = string;
export type EckartRotationWorstRelative = number | null;
export type EuclideanNormMax = number;
export type EuclideanNormMin = number;
export type Frame = string;
export type Statement1 = string;
/**
 * @minItems 1
 */
export type Atoms3 = [ImportedAtom, ...ImportedAtom[]];
export type CoordinateUnit11 = "angstrom";
export type ExpectedModeCount = number | null;
export type FrequencySign = string;
export type FrequencyUnit2 = "cm^-1";
export type HasIrIntensities = boolean;
export type HasRamanActivities = boolean;
export type ImaginaryModeCount1 = number;
export type IrIntensityNote = string | null;
export type IrIntensityUnit = "km/mol";
export type Linear = boolean;
export type ModeCount = number;
/**
 * @minItems 1
 */
export type Modes1 = [ImportedMode, ...ImportedMode[]];
/**
 * @minItems 1
 */
export type Displacement = [[unknown, unknown, unknown], ...[unknown, unknown, unknown][]];
export type DisplacementEuclideanNorm = number;
export type FrequencyCm12 = number;
export type Imaginary1 = boolean;
export type Index10 = number;
export type IrIntensityKmMol = number | null;
export type RamanActivityA4Amu = number | null;
export type ReducedMassAmu1 = number | null;
export type NormalizationVersion6 = string;
export type Ordering = string;
export type PayloadSchema16 = "chemdft.imported.vibrations";
export type PayloadSchemaVersion15 = "1.0.0";
export type RamanActivityNote = string | null;
export type RamanActivityUnit1 = "angstrom^4/amu";
/**
 * @minItems 1
 * @maxItems 40
 */
export type SourceAttributes5 = [string, ...string[]];
export type SourceClass11 = "IMPORTED";
export type ZeroModes = string;
export type Ev = "cclib.cm-1->eV/1";
export type Hartree = "cclib.cm-1->Eh/1";
export type Wavelength = "cm-1->nm/1";
export type EnergyPrecisionNote = string;
export type Method17 = string;
export type NormalizationVersion7 = string;
export type Ordering1 = string;
export type OscillatorStrengthGauge2 = string;
export type PayloadSchema17 = "chemdft.imported.excitations";
export type PayloadSchemaVersion16 = "1.0.0";
/**
 * @minItems 1
 * @maxItems 40
 */
export type SourceAttributes6 = [string, ...string[]];
export type SourceClass12 = "IMPORTED";
export type SpinSemantics = string;
export type StateCount = number;
/**
 * @minItems 1
 * @maxItems 2000
 */
export type States = [ImportedExcitedState, ...ImportedExcitedState[]];
export type EnergyCm1Raw = number;
export type EnergyEv2 = number;
export type EnergyHartree5 = number;
export type Index11 = number;
export type OscillatorStrength1 = number | null;
export type SourceLabel = string | null;
export type SourceStateNumber = number;
export type SpinLabel = "singlet" | "doublet" | "triplet" | "quartet" | "quintet" | "sextet" | "unknown";
export type SpinMultiplicity = number | null;
export type Symmetry = string | null;
export type Coefficient = number;
export type FromOrbital = number;
export type FromSpin = number;
export type ToOrbital = number;
export type ToSpin = number;
/**
 * @maxItems 64
 */
export type Transitions = ImportedTransition[];
export type TransitionsTruncated = boolean;
export type WavelengthNm1 = number;
export type TransitionAmplitudesNote = string;
export type TransitionDipoles = string;
export type ComponentBreakdown = string;
export type ElectronicEnergyHartree1 = number | null;
export type EnthalpyAndGibbsIncludeElectronicEnergy = true;
export type Model5 = string;
export type NormalizationVersion8 = string;
export type PayloadSchema18 = "chemdft.imported.thermochemistry";
export type PayloadSchemaVersion17 = "1.0.0";
export type GMinusE0Hartree = number | null;
export type HMinusE0Hartree = number | null;
export type PressureAtm1 = number | null;
export type PressurePa3 = number | null;
export type RecomputedByChemdft = false;
export type ReportedBy = string;
/**
 * @minItems 1
 * @maxItems 40
 */
export type SourceAttributes7 = [string, ...string[]];
export type SourceClass13 = "IMPORTED";
export type TemperatureK3 = number;
export type TemperaturePressurePreview = string;
export type PayloadSha256 = string;
export type ProducerId = string;
export type ProducerType = "VALIDATED_IMPORT_PIPELINE";
export type ProjectId36 = string;
export type ProvenanceRecordId2 = string;
export type ResultType5 =
  | "chemdft.imported.structure"
  | "chemdft.imported.energy"
  | "chemdft.imported.optimization"
  | "chemdft.imported.orbital-table"
  | "chemdft.imported.vibrations"
  | "chemdft.imported.excitations"
  | "chemdft.imported.thermochemistry";
export type SourceAttributes8 = string[];
export type SourceClass14 = "IMPORTED";
export type LineEnd = number;
export type LineStart = number;
export type ValidationState1 = "VALIDATED";
export type VerificationState5 = "UNVERIFIED";
export type Results2 = ImportedResultView[];
export type Basis11 = string | null;
export type ConfirmedAt1 = string | null;
export type CreatedAt31 = string;
export type Engine12 = string | null;
export type Id36 = string;
export type JobType2 = string | null;
export type Method18 = string | null;
export type PreviewSha2563 = string;
export type ProgramLabel1 = string | null;
export type ProjectId37 = string;
export type SourceFilename = string;
export type SourceSha2563 = string;
export type State6 = "PREVIEW_READY" | "REJECTED" | "IMPORTED";
export type StructureId5 = string | null;
export type Imports = ExternalImportSummaryView[];
export type CandidateSha2561 = string;
export type InspectedGeometry = true;
export type UnderstandsNotOptimized = true;
export type Code5 = string;
export type Detail5 = string;
export type Eligible = boolean;
export type StructureVersionId10 = string;
export type CandidateId4 = string;
export type AcceptedStructureVersionId = string | null;
export type CalculationEligible = false;
export type Id37 = string;
export type GeneratedAtomIndex = number;
export type HydrogenParentSourceIndex = number | null;
export type SourceAtomIndex = number | null;
export type AtomMapping = GeometryAtomMapping[];
export type CanonicalSmiles = string;
export type ExplicitHydrogenCount = number;
export type Formula4 = string;
export type GenerationMethod2 = "rdkit.etkdg3.preview-conformer";
export type GeometryClass1 = "GENERATED_CONFORMER_NOT_OPTIMIZED";
export type SchemaVersion57 = "1.0.0";
export type SourceAtomCount = number;
export type SourceGraphSha256 = string;
export type ProjectId38 = string;
export type State7 = "PENDING_ACCEPTANCE" | "ACCEPTED";
/**
 * @maxItems 256
 */
export type Candidates2 = GeometryCandidateView[];
export type ExperimentName2 = string;
export type PointMode2 = "CURVE_POINTS" | "HISTOGRAM_POINTS";
/**
 * @minItems 1
 * @maxItems 200000
 */
export type Points3 = [GraphDigitizedPointInput, ...GraphDigitizedPointInput[]];
export type SchemaVersion58 = "1.0.0";
export type SourceDocumentSha256 = string;
export type SourcePixelHeight2 = number;
export type SourcePixelWidth2 = number;
export type SourceRenderScale2 = number;
export type SourceRenderSha2562 = string;
export type SourceRenderVersion2 = string;
export type Identifier2 = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProducerKind".
 */
export type ProducerKind = "USER" | "SERVICE" | "SOFTWARE" | "MODEL";
export type SoftwareVersion = string | null;
export type Authority3 = "CANDIDATE";
export type CreatedAt32 = string;
/**
 * @maxItems 256
 */
export type EvidenceIds = string[];
export type Id38 = string;
/**
 * @maxItems 256
 */
export type LinkedEntities = EntityReference[];
export type ProjectId39 = string;
export type SchemaVersion59 = "1.0.0";
export type Statement2 = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "HypothesisStatus".
 */
export type HypothesisStatus = "PROPOSED" | "ACCEPTED_AS_WORKING" | "REJECTED" | "SUPERSEDED";
export type SupersedesId = string | null;
export type Diagnostics4 = ImportDiagnostic[];
export type ImporterVersion2 = string;
export type Items1 = ImportItem[];
export type Jobs3 = ImportJobBrief[];
export type NormalizationVersion9 = string;
export type Payload4 =
  | ImportedStructurePayload
  | ImportedEnergyPayload
  | ImportedOptimizationPayload
  | ImportedOrbitalTablePayload
  | ImportedVibrationsPayload
  | ImportedExcitationsPayload
  | ImportedThermochemistryPayload;
export type ResultType6 =
  | "chemdft.imported.structure"
  | "chemdft.imported.energy"
  | "chemdft.imported.optimization"
  | "chemdft.imported.orbital-table"
  | "chemdft.imported.vibrations"
  | "chemdft.imported.excitations"
  | "chemdft.imported.thermochemistry";
export type SourceAttributes9 = string[];
export type Results3 = ImportResultEntry[];
export type Semantic1 = {
  [k: string]: number | boolean | string;
} | null;
export type Status15 = "READY" | "REJECTED";
export type PreviewSha2564 = string;
export type Schema = "chemdft.external-import.preview";
export type SchemaVersion60 = "1.0.0";
export type CreatedAt33 = string;
export type Current = boolean;
export type HypothesisId1 = string;
export type Id39 = string;
export type ObservationIds1 = string[];
export type Outcome3 = "OPEN" | "SUPPORTED" | "NOT_SUPPORTED" | "INCONCLUSIVE";
export type Rationale1 = string;
export type InvestigationId = string;
export type SchemaVersion61 = "1.0.0";
export type ContradictionRefs = {
  [k: string]: unknown;
}[];
export type CreatedAt34 = string;
export type HistoricalStatus = ("OPEN" | "SUPPORTED" | "NOT_SUPPORTED" | "INCONCLUSIVE") | null;
export type Id40 = string;
export type SourceClass15 = "AI_HYPOTHESIS" | "USER";
export type Statement3 = string;
export type Status16 = "OPEN" | "SUPPORTED" | "NOT_SUPPORTED" | "INCONCLUSIVE";
export type SupportRefs = {
  [k: string]: unknown;
}[];
export type Assessments = InvestigationAssessmentView[];
export type CreatedAt35 = string;
export type CurrentEvidenceValid = boolean;
export type Hypotheses = InvestigationHypothesisView[];
export type Id41 = string;
export type InactiveObservationIds = string[];
export type LimitReason = string | null;
export type Objective1 = string;
export type Citations2 = {
  [k: string]: unknown;
}[];
export type CreatedAt36 = string;
export type Current1 = boolean;
export type Id42 = string;
export type SourceClass16 = string;
export type SourceEntityId1 = string;
export type SourceEntityType1 = string;
export type Summary4 = string;
export type Observations1 = InvestigationObservationView[];
export type PendingApprovalId = string | null;
export type CreatedAt37 = string;
export type Id43 = string;
export type Revision5 = number;
export type Status17 = string;
export type Action1 = string;
export type ApprovalClass1 = string;
export type Dependencies1 = string[];
export type Failure = {
  [k: string]: unknown;
} | null;
export type Id44 = string;
export type Intent1 = string;
export type ResultRef = {
  [k: string]: unknown;
} | null;
export type Status18 = string;
export type StepNumber1 = number;
export type Steps4 = InvestigationStepView[];
export type Plans = InvestigationPlanView[];
export type ProjectId40 = string;
export type SchemaVersion62 = "1.0.0";
export type StartedAt2 = string | null;
export type Status19 =
  | "DRAFT"
  | "PLANNED"
  | "WAITING_FOR_APPROVAL"
  | "ACTIVE"
  | "WAITING_FOR_RESULT"
  | "WAITING_FOR_USER"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED";
export type StopConditions = {
  [k: string]: unknown;
}[];
export type StoredStatus =
  | (
      | "DRAFT"
      | "PLANNED"
      | "WAITING_FOR_APPROVAL"
      | "ACTIVE"
      | "WAITING_FOR_RESULT"
      | "WAITING_FOR_USER"
      | "PAUSED"
      | "COMPLETED"
      | "FAILED"
      | "CANCELED"
    )
  | null;
export type Title5 = string;
export type UpdatedAt5 = string;
export type UserInput = {
  [k: string]: unknown;
} | null;
export type Investigations1 = InvestigationView[];
export type ExpiresAt1 = string;
export type HeartbeatAt1 = string | null;
export type HeartbeatDeadlineAt = string;
export type IssuedAt = string;
export type Owner = string;
export type State8 = string;
export type ArtifactId2 = string;
export type FormatIdentifier = string;
export type Kind4 = string;
export type LogReadable = boolean;
export type MediaType1 = string;
export type Sha2564 = string;
export type SizeBytes2 = number;
export type Artifacts3 = DiagnosticArtifact[];
export type AttemptId = string;
export type AttemptNumber2 = number;
export type Diagnostic4 = string | null;
export type EngineName = string | null;
export type EngineVersion6 = string | null;
export type FailureCode = string | null;
export type FinishedAt3 = string | null;
export type StartedAt3 = string | null;
export type State9 = string;
export type WorkerId2 = string;
export type Attempts1 = DiagnosticAttempt[];
export type CalculationId19 = string;
export type AttemptId1 = string | null;
export type CreatedAt38 = string | null;
export type Diagnostic5 = string | null;
export type ExecutionId1 = string;
export type FailureCode1 = string | null;
export type FinishedAt4 = string | null;
export type HeartbeatAt2 = string | null;
export type Provider13 = string;
export type StartedAt4 = string | null;
export type State10 = string;
export type WorkerId3 = string | null;
export type Executions = DiagnosticExecution[];
export type HeartbeatAgeSeconds = number | null;
export type HeartbeatStaleAfterSeconds = number;
export type HeartbeatStatus = "FRESH" | "STALE" | "NOT_APPLICABLE" | "NOT_REPORTED";
export type JobId1 = string;
export type JobState = string;
export type LogsAvailable = boolean;
export type ProgressNote = string;
export type ProgressReported = false;
export type ProjectId41 = string;
export type SchemaId2 = "chemdft.job-diagnostics.v1";
export type ServerTime = string;
export type ArtifactId3 = string;
export type AttemptId2 = string | null;
export type Kind5 = string;
export type MediaType2 = string;
export type ReturnedBytes = number;
export type Sha2565 = string;
export type SizeBytes3 = number;
export type Text = string;
export type Truncated1 = boolean;
export type ChunkCount = number;
export type Diagnostic6 = string | null;
export type IndexVersion = string;
export type ProjectId42 = string;
export type SchemaVersion63 = "1.0.0";
export type Status20 = "PENDING" | "INDEXING" | "READY" | "FAILED" | "STALE";
export type UpdatedAt6 = string;
export type ChunkerVersion = string;
export type Content3 = string;
export type ContentHash = string;
export type CreatedAt39 = string;
export type DocumentId4 = string | null;
export type EvidenceId1 = string | null;
export type Id45 = string;
export type PageNumber6 = number | null;
export type ProjectId43 = string;
export type SchemaVersion64 = "1.0.0";
export type SourceAnchorId3 = string | null;
export type SourceClass17 = string | null;
export type SourceEntityId2 = string;
export type SourceRevision = string | null;
export type SourceType1 = string;
export type VerificationState6 = string | null;
export type CitationType1 = "DOCUMENT" | "EVIDENCE" | "CALCULATION" | "DATASET" | "STRUCTURE" | "PROJECT_NOTE";
export type CombinedScore = number;
export type Content4 = string;
export type DocumentId5 = string | null;
export type IndexVersion1 = string;
export type KnowledgeChunkId2 = string;
export type KnowledgeItemId1 = string;
export type LexicalScore = number;
export type PageNumber7 = number | null;
export type SchemaVersion65 = "1.0.0";
export type SemanticScore = number;
export type SourceAnchorId4 = string | null;
export type SourceClass18 = string | null;
export type SourceEntityId3 = string;
export type SourceRevision1 = string | null;
export type SourceType2 = string;
export type VerificationState7 = string | null;
export type CalculationId20 = string | null;
export type DocumentId6 = string | null;
export type Doi = string | null;
/**
 * @maxItems 10
 */
export type SourceClasses =
  | []
  | ["EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS"]
  | [
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
    ]
  | [
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
    ]
  | [
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
    ]
  | [
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
    ]
  | [
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
    ]
  | [
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
    ]
  | [
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
    ]
  | [
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
    ]
  | [
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
      "EXPERIMENTAL" | "EXTRACTED" | "DIGITIZED" | "CALCULATED" | "AI_HYPOTHESIS",
    ];
/**
 * @maxItems 20
 */
export type SourceTypes =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
export type StructureId6 = string | null;
export type Year = number | null;
export type Limit = number;
export type Query = string;
export type SchemaVersion66 = "1.0.0";
export type IndexVersion2 = string;
export type Query1 = string;
/**
 * @maxItems 25
 */
export type Results4 = KnowledgeRetrievalResult[];
export type SchemaVersion67 = "1.0.0";
export type CreatedAt40 = string;
export type ExternalIdentifier = string | null;
export type Id46 = string;
export type ProjectId44 = string;
export type SchemaVersion68 = "1.0.0";
export type Title6 = string;
export type ExpectedCharge = number;
export type MolBlock2 = string;
export type Multiplicity17 = number;
export type Name12 = string;
export type Content5 = string;
export type Format1 = "SMILES" | "MOL" | "MOL_BLOCK";
export type ParentRepresentationId2 = string | null;
export type CanGenerate3D = boolean;
export type CanonicalIsomericSmiles = string | null;
/**
 * @maxItems 50
 */
export type DifferencesFromParent1 = MolecularGraphDifference[];
export type DisconnectedFragments = number;
export type BeginAtomIndex = number;
export type BondIndex = number;
export type EndAtomIndex = number;
export type IsAssigned = boolean;
export type Stereo = string;
/**
 * @maxItems 200
 */
export type DoubleBondStereochemistry = DoubleBondStereoInfo[];
export type Elements = string[];
export type FormalCharge1 = number | null;
export type Formula5 = string | null;
/**
 * @maxItems 50
 */
export type FragmentFormulas = string[];
export type HasStereochemistry = boolean;
export type HeavyAtomCount = number | null;
export type IsOrganic = boolean;
export type IsValid = boolean;
export type SchemaVersion69 = "1.0.0";
export type AtomIndex1 = number;
export type Element2 = string;
export type IsAssigned1 = boolean;
export type Stereo1 = string;
/**
 * @maxItems 200
 */
export type Stereocenters = StereocenterInfo[];
/**
 * @maxItems 200
 */
export type UnassignedDoubleBonds = string[];
/**
 * @maxItems 200
 */
export type UnassignedStereocenters = string[];
/**
 * @maxItems 50
 */
export type UnsupportedElements = string[];
/**
 * @maxItems 50
 */
export type ValidationDiagnostics2 = string[];
/**
 * @maxItems 50
 */
export type ValidationWarnings = string[];
export type CalculationId21 = string;
export type CalculationResultId = string;
export type CoordinateFrame = "INPUT_STRUCTURE_VERSION_CARTESIAN";
export type CoordinateUnit12 = "angstrom";
/**
 * @minItems 3
 * @maxItems 3
 */
export type Dimensions = [number, number, number];
export type FieldMax = number;
export type FieldMin = number;
export type FieldQuantity = "MO_AMPLITUDE";
export type FieldSha256 = string;
export type FieldUnit = "a0^-3/2";
export type GridGenerator = "pyscf.eval_gto" | "pyscf.scf-fields";
export type GridGeneratorVersion = string;
export type GridProfile = "LEGACY" | "STANDARD";
export type GridProfileVersion = string;
export type GridSha256 = string;
export type GridSpecificationHash = string;
export type MolecularMarginAngstrom = number;
export type OrbitalIndex = number;
/**
 * @minItems 3
 * @maxItems 3
 */
export type OriginAngstrom = [number, number, number];
export type ResultSha2564 = string;
export type SchemaVersion70 = "1.0.0";
export type SpacingAngstrom = number;
export type SpinChannel3 = "restricted" | "alpha" | "beta";
/**
 * @minItems 3
 * @maxItems 3
 */
export type VoxelVectorsAngstrom = [unknown, unknown, unknown];
/**
 * @minItems 8
 * @maxItems 250000
 */
export type FieldValues = [number, number, number, number, number, number, number, number, ...number[]];
export type GridProfile1 = "LEGACY" | "STANDARD";
export type OrbitalIndex1 = number;
export type SpinChannel4 = "restricted" | "alpha" | "beta";
export type CanonicalIsomericSmiles1 = string;
export type Description4 = string;
export type Formula6 = string;
export type Name13 = string;
export type ActionKey = string;
export type CanonicalIsomericSmiles2 = string;
export type ExpectedCharge1 = number;
export type Multiplicity18 = number;
export type Name14 = string;
export type CandidateArtifactId = string;
export type CandidateId5 = string;
export type CanonicalSmiles1 = string;
export type DrawingArtifactId = string;
export type ExplicitHydrogenCount1 = number;
export type Formula7 = string;
export type GeometryClass2 = "GENERATED_CONFORMER_NOT_OPTIMIZED";
export type Name15 = string;
export type ProjectId45 = string;
export type ProvenanceId2 = string;
export type SchemaVersion71 = "1.0.0";
export type SourceAtomCount1 = number;
export type State11 = "PENDING_ACCEPTANCE" | "ACCEPTED";
export type AllowPubchem = boolean;
export type AllowSmiles = boolean;
export type Name16 = string;
export type Alternatives = MoleculeAlternative[];
export type CanonicalIsomericSmiles3 = string | null;
export type Charge14 = number | null;
export type ClarificationPrompt = string | null;
export type ClarificationRequired = boolean;
export type Diagnostics5 = string[];
export type Formula8 = string | null;
export type HeavyAtomCount1 = number | null;
export type IdentitySource = ("REVIEWED_CATALOGUE" | "EXPLICIT_SMILES" | "PUBCHEM") | null;
export type Multiplicity19 = number | null;
export type Name17 = string;
export type Resolved = boolean;
export type SchemaVersion72 = "1.0.0";
export type SourceHash = string | null;
export type StereoStatus = ("NONE" | "SPECIFIED" | "AMBIGUOUS") | null;
/**
 * @maxItems 32
 */
export type AllowedTools1 = AIToolPolicy[];
export type CanWrite2 = boolean;
export type ContextVersion1 = "1.1.0";
export type ExampleSlug2 = string | null;
export type ExecutionRequiresResearcherApproval1 = true;
export type GeneratedAt1 = string;
/**
 * @maxItems 16
 */
export type GroundingFacts1 =
  | []
  | [GroundingFact]
  | [GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ];
/**
 * @maxItems 8
 */
export type GroundingNotes1 =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string];
export type GroundingPolicy1 = string | null;
export type HumanId1 = string;
export type InterpretationSourceClass1 = "AI_HYPOTHESIS";
export type OrganizationId4 = string;
export type PlanningProfile1 = "PERIODIC_ENERGY_PROPOSAL";
export type ProjectId46 = string;
export type ProjectKind1 = "NORMAL" | "LEGACY_LOCAL" | "ACCEPTANCE_FROZEN" | "EXAMPLE_TEMPLATE";
export type ProjectName1 = string;
export type PublishedExample1 = boolean;
/**
 * @maxItems 8
 */
export type Resources1 =
  | []
  | [ProductResource]
  | [ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource, ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource, ProductResource, ProductResource, ProductResource]
  | [
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
    ]
  | [
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
    ];
export type Role3 = string;
export type Sealed3 = boolean;
export type ViewHint1 = string | null;
export type ViewHintIsUntrusted1 = true;
export type Bands1 = boolean;
export type Dos1 = boolean;
/**
 * @minItems 3
 * @maxItems 3
 */
export type DosKMesh = [unknown, unknown, unknown];
/**
 * @minItems 3
 * @maxItems 3
 */
export type KMesh1 = [unknown, unknown, unknown];
export type MagneticOrder1 = "none" | "ferromagnetic" | "antiferromagnetic";
export type Relax = boolean;
export type RelaxMaxSteps = number;
export type ComparedResultIds1 =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string]
  | null;
export type Content6 = string;
export type CurrentView1 = string | null;
export type Goal4 =
  ("optimize" | "energy" | "ir" | "raman" | "uv_vis" | "orbitals" | "thermochemistry" | "compare" | "crystal") | null;
export type Mode2 = "STANDARD" | "EVIDENCE" | "CHAT";
export type PlanningProfile2 =
  "GENERAL" | "PYSCF_ENERGY_PROPOSAL" | "STRUCTURE_EDIT_PROPOSAL" | "PERIODIC_ENERGY_PROPOSAL";
export type MaxInputTokens = number | null;
export type MaxModelCalls = number | null;
export type MaxOutputTokens = number | null;
export type MaxToolCalls = number | null;
export type SelectedClaimId1 = string | null;
export type SelectedDocumentId1 = string | null;
export type SelectedJobId1 = string | null;
export type SelectedResultId1 = string | null;
export type SelectedSpectrumId1 = string | null;
export type SelectedStructureId1 = string | null;
export type SelectedStructureVersionId1 = string | null;
/**
 * @maxItems 32
 */
export type AllowedTools2 = AIToolPolicy[];
export type CanWrite3 = boolean;
export type ContextVersion2 = "1.0.0";
export type ExampleSlug3 = string | null;
export type GeneratedAt2 = string;
/**
 * @maxItems 16
 */
export type GroundingFacts2 =
  | []
  | [GroundingFact]
  | [GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ];
/**
 * @maxItems 8
 */
export type GroundingNotes2 =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string];
export type GroundingPolicy2 = string | null;
export type HumanId2 = string;
export type InterpretationSourceClass2 = "AI_HYPOTHESIS";
export type OrganizationId5 = string;
export type ProjectId47 = string;
export type ProjectKind2 = "NORMAL" | "LEGACY_LOCAL" | "ACCEPTANCE_FROZEN" | "EXAMPLE_TEMPLATE";
export type ProjectName2 = string;
export type PublishedExample2 = boolean;
/**
 * @maxItems 8
 */
export type Resources2 =
  | []
  | [ProductResource]
  | [ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource, ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource, ProductResource, ProductResource, ProductResource]
  | [
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
    ]
  | [
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
    ];
export type Role4 = string;
export type Sealed4 = boolean;
export type ViewHint2 = string | null;
export type ViewHintIsUntrusted2 = true;
export type Name18 = string;
export type Slug1 = string;
export type ProjectId48 = string;
export type CreatedAt41 = string;
export type Id47 = string;
export type Name19 = string;
export type OrganizationId6 = string;
export type Role5 = string;
export type Slug2 = string;
export type UpdatedAt7 = string;
/**
 * @maxItems 10000
 */
export type Projects = ProjectSummary[];
export type Content7 = string;
export type MemoryType = "PROJECT_NOTE" | "USER_CONFIRMED_FACT" | "WORKFLOW_DECISION";
export type SchemaVersion73 = "1.0.0";
export type SourceConversationId = string | null;
/**
 * @maxItems 20
 */
export type SourceLinks =
  | []
  | [
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ]
  | [
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
      {
        [k: string]: string;
      },
    ];
export type ConfirmationState = "CONFIRMED";
export type Content8 = string;
export type CreatedAt42 = string;
export type CreatedBy9 = string;
export type Id48 = string;
export type MemoryType1 = string;
export type ProjectId49 = string;
export type SchemaVersion74 = "1.0.0";
export type SourceConversationId1 = string | null;
/**
 * @maxItems 1000
 */
export type Memories = ProjectMemoryView[];
export type SchemaVersion75 = "1.0.0";
export type ClaimType = string;
export type CreatedAt43 = string | null;
export type EvidenceId2 = string | null;
export type Figure1 = string | null;
export type Id49 = string;
export type OriginalValueText = string | null;
export type Page2 = number | null;
export type Predicate = string;
export type ProjectId50 = string;
export type ProvenanceHash = string | null;
export type Qualifier = string | null;
export type QuantityKey = string | null;
export type ReviewState = string;
export type SemanticStatus = string;
export type SourceAuthority = string;
export type SourceDocumentId4 = string | null;
export type SourceHref = string | null;
export type SourceLabel1 = string;
export type SourceRecordId = string;
export type SourceRecordType1 = string;
export type Subject = string;
export type Table1 = string | null;
export type Unit6 = string | null;
export type Claims = ScientificClaim[];
export type ProjectId51 = string;
export type DeltaUnit = string | null;
export type LeftClaimId = string;
export type NumericDelta = number | null;
export type Rationale2 = string;
export type Relation1 = string;
export type RightClaimId = string;
export type Relations = ScientificClaimRelation[];
export type ProjectId52 = string;
export type AuthoritySummary = string[];
export type ComparisonRule = string | null;
export type Delta1 = number | null;
export type DeltaUnit1 = string | null;
export type Id50 = string;
export type ProjectClaims = ScientificClaim[];
export type QuantityKey1 = string | null;
export type Relation2 = string;
export type ReviewSummary = string[];
export type Section1 = string;
export type SourceClaims = ScientificClaim[];
export type SourceDocumentId5 = string | null;
export type Topic = string;
export type UnresolvedReason = string | null;
export type Rows1 = ScientificComparisonRow[];
export type CalculatedResults = number;
export type DigitizedDatasets = number;
export type DirectlyComparablePairs = number;
export type NotDirectlyComparable = number;
export type ProjectClaims1 = number;
export type ProjectOnlyClaims = number;
export type ReconstructedStructures = number;
export type SourceClaims1 = number;
export type SourceOnlyClaims = number;
export type Approximate = boolean;
export type CorrelationId2 = string;
export type CreatedAt44 = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProvenanceDetail".
 */
export type ProvenanceDetail =
  | "AI_RECONSTRUCTED"
  | "PARSER_EXTRACTED"
  | "MANUAL_ENTRY"
  | "IMPORTED_ENGINE_RESULT"
  | "DETERMINISTIC_TRANSFORM"
  | "DIRECT_ACQUISITION";
export type Id51 = string;
export type ProvenanceRecordId3 = string | null;
/**
 * @maxItems 256
 */
export type Inputs = ProvenanceInput[];
export type Operation1 = string;
export type OperationVersion1 = string;
/**
 * @maxItems 8
 */
export type Parameters1 =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type ProjectId53 = string;
export type SchemaVersion76 = "1.0.0";
export type SupersedesId1 = string | null;
export type Direction1 = "asc" | "desc";
export type Engines = string[];
export type Tasks = string[];
export type GeneratedAt3 = string;
export type Limit1 = number;
export type NextCursor = string | null;
export type ProjectId54 = string;
export type AtomCount6 = number | null;
export type Basis12 = string | null;
export type CalculationId22 = string;
export type CalculationState = string;
export type Charge15 = number | null;
export type CreatedAt45 = string;
export type Dispersion1 = string | null;
export type Engine13 = string | null;
export type EngineVersion7 = string | null;
export type EvidenceUse2 = "CURRENT" | "HISTORICAL_ONLY" | "UNKNOWN" | "NO_RESULT";
export type Exports = string[];
export type Failure1 = string | null;
export type FormulaHill2 = string | null;
export type JobId2 = string | null;
export type JobState1 = string | null;
export type Method19 = string | null;
export type Multiplicity20 = number | null;
export type Quantities2 = SummaryQuantity[];
export type ResultId3 = string | null;
export type ResultType7 = string | null;
export type SavedComparisonIds = string[];
export type Solvation1 = string | null;
export type StructureId7 = string | null;
export type StructureName3 = string | null;
export type StructureRevision1 = number | null;
export type StructureVersionId11 = string | null;
export type Task1 = string;
export type UpdatedAt8 = string;
export type Visualizations = (
  | "trajectory"
  | "ir-spectrum"
  | "raman-spectrum"
  | "uv-vis-spectrum"
  | "molecular-orbitals"
  | "electron-density"
  | "thermochemistry"
  | "conformers"
)[];
export type Rows2 = OverviewRow[];
export type Availability1 = "ACTIVE" | "NOT_ACTIVATED";
export type Archived = boolean;
export type CreatedAt46 = string;
export type CreatedBy10 = string;
export type Id52 = string;
export type Name20 = string;
export type Note3 = string | null;
export type ProjectId55 = string;
export type ResultIds = string[];
export type SchemaVersion77 = number;
export type Comparisons = SavedComparisonSummary[];
export type ProjectId56 = string;
export type SchemaId3 = "chemdft.published-results.v1";
export type Sort = "updated" | "task" | "engine" | "formula" | "energy";
export type TotalCalculations = number;
export type TotalMatching = number;
export type TotalPublished = number;
export type Canceled1 = number;
export type Failed1 = number;
export type NoResult = number;
export type Pending = number;
export type Connectivity = [unknown, unknown, unknown][] | null;
/**
 * @minItems 3
 * @maxItems 30000
 */
export type Geometry = [number, number, number, ...number[]];
export type MolecularCharge = number;
export type MolecularMultiplicity = number;
export type SchemaName = "qcschema_molecule";
export type SchemaVersion78 = 3;
/**
 * @minItems 1
 * @maxItems 10000
 */
export type Symbols = [string, ...string[]];
export type Validated1 = false;
export type Creator = string;
export type Routine = string;
export type Version6 = string;
export type SchemaName1 = "qcschema_atomic_input";
export type SchemaVersion79 = 2;
export type Driver = "energy" | "gradient" | "hessian" | "properties";
export type Key4 = string;
export type Value8 = string | number | boolean | null;
/**
 * @maxItems 128
 */
export type Keywords = QCSchemaKeywordV2[];
export type Basis13 = string | null;
export type Method20 = string;
export type Program1 = string;
export type SchemaName2 = "qcschema_atomic_specification";
export type CalculationId23 = string;
export type HeartbeatAgeSeconds1 = number | null;
export type HeartbeatAt3 = string | null;
export type HeartbeatStatus1 = "FRESH" | "STALE" | "NOT_REPORTED";
export type JobId3 = string;
export type JobState2 = string;
export type LeaseOwner1 = string | null;
export type StartedAt5 = string | null;
export type WorkerId4 = string | null;
export type Active = ActiveExecution[];
export type CancelRequested = number;
export type Canceled2 = number;
export type Failed2 = number;
export type Leased = number;
export type Queued = number;
export type Running = number;
export type Succeeded2 = number;
export type HeartbeatStaleAfterSeconds1 = number;
export type Notice1 = string;
export type OldestQueuedAt = string | null;
export type ProjectId57 = string;
export type SchemaId4 = "chemdft.queue-status.v1";
export type ServerTime1 = string;
export type WorkerProcessObservable = false;
export type GeneratedAt4 = string;
export type ProjectId58 = string;
export type Rows3 = OverviewRow[];
export type SchemaId5 = "chemdft.research-overview.v1";
export type AtomCount7 = number | null;
export type CalculationCount = number;
export type FormulaHill3 = string | null;
export type Kind6 = string;
export type LatestRevision = number | null;
export type LatestVersionId = string | null;
export type Name21 = string;
export type StructureId8 = string;
export type Structures = OverviewStructure[];
export type TotalCalculations1 = number;
export type Truncated2 = boolean;
export type IdempotencyKey6 = string | null;
export type Basis14 = string | null;
export type CanReuse = boolean;
export type Charge16 = number | null;
export type CheckId = string;
export type Detail6 = string;
export type Outcome4 = "PASS" | "WARNING" | "FAIL";
export type Checks = ReuseCheck[];
export type Engine14 = string | null;
export type EquivalentCalculationIds = string[];
export type Method21 = string | null;
export type Multiplicity21 = number | null;
export type Notice2 = string;
export type ProjectId59 = string;
export type SchemaId6 = "chemdft.reuse-plan.v1";
export type SourceCalculationId = string;
export type SourceState = string;
export type Specification1 = {
  [k: string]: unknown;
} | null;
export type StructureVersionId12 = string | null;
export type Task2 = string | null;
export type CreatedAt47 = string;
export type CreatedBy11 = string;
export type Description5 = string | null;
/**
 * @maxItems 8
 */
export type Extensions =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type Id53 = string;
export type Name22 = string;
export type ParentSampleId = string | null;
export type ProjectId60 = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SampleType".
 */
export type SampleType = "PHYSICAL" | "CONCEPTUAL";
export type SchemaVersion80 = "1.0.0";
export type Notice3 = string;
export type RevalidatedAt = string;
export type CurrentEvidenceUse = ("CURRENT" | "HISTORICAL_ONLY" | "UNKNOWN" | "NO_RESULT") | null;
export type Detail7 = string;
export type ResultId4 = string;
export type CalculationId24 = string;
export type EvidenceUse3 = "CURRENT" | "HISTORICAL_ONLY" | "UNKNOWN" | "NO_RESULT";
export type ProvenanceRecordId4 = string;
export type ResultId5 = string;
export type ResultPayloadSha2561 = string;
export type SourceLineageValidity1 = string;
export type StoredAuthority1 = string;
export type StoredValidationState1 = string;
export type StoredVerificationState1 = string;
export type StructureVersionId13 = string | null;
export type Status21 = "UNCHANGED" | "STATE_CHANGED" | "SOURCE_CHANGED" | "MISSING";
export type Revalidation = SourceRevalidation[];
export type SchemaId7 = "chemdft.saved-comparison-open.v1";
export type Overall1 = ("DIRECTLY_COMPARABLE" | "COMPARABLE_WITH_LIMITATIONS" | "NOT_SCIENTIFICALLY_COMPARABLE") | null;
export type SavedAt = string;
export type SchemaId8 = "chemdft.saved-comparison-snapshot.v1";
export type Sources1 = SavedComparisonSource[];
export type Status22 = "CURRENT" | "CHANGED" | "UNAVAILABLE";
export type Compression = string | null;
export type CreatedAt48 = string;
export type CreatedBy12 = string;
/**
 * @maxItems 8
 */
export type Extensions1 =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type FormatIdentifier1 = string;
export type FormatVersion = string | null;
export type Id54 = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ScientificArtifactKind".
 */
export type ScientificArtifactKind =
  | "RAW_UPLOAD"
  | "STRUCTURE_FILE"
  | "COORDINATES"
  | "SPECTRUM_DATA"
  | "CALCULATION_INPUT"
  | "CALCULATION_OUTPUT"
  | "ENGINE_LOG"
  | "NORMALIZED_RESULT"
  | "ENVIRONMENT_MANIFEST"
  | "CHECKPOINT"
  | "VOLUMETRIC_GRID"
  | "ORBITAL_GRID"
  | "MO_COEFFICIENTS"
  | "EXPORT"
  | "FIGURE"
  | "REPORT";
export type MediaType3 = string;
export type ProjectId61 = string;
export type SchemaVersion81 = "1.0.0";
export type Sha2566 = string;
export type SizeBytes4 = number;
export type Compression1 = string | null;
/**
 * @maxItems 8
 */
export type Extensions2 =
  | []
  | [NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension, NamespacedExtension]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ]
  | [
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
      NamespacedExtension,
    ];
export type FormatIdentifier2 = string;
export type FormatVersion1 = string | null;
export type ProjectId62 = string;
export type SchemaVersion82 = "1.0.0";
export type StoredFileId = string;
/**
 * @maxItems 128
 */
export type Authors = string[];
export type CreatedAt49 = string;
export type CreatedBy13 = string;
/**
 * @maxItems 128
 */
export type Diagnostics6 = {
  [k: string]: string;
}[];
export type DocumentType = string;
export type Doi1 = string | null;
export type Id55 = string;
export type Journal = string | null;
export type Language = string | null;
export type MediaType4 = string;
export type PageCount = number;
export type ParserIdentifier = string;
export type ParserVersion8 = string;
export type ProjectId63 = string;
export type PublicationYear = number | null;
export type SchemaVersion83 = "1.0.0";
export type Sha2567 = string;
export type Title7 = string | null;
/**
 * @maxItems 10000
 */
export type Candidates3 = EvidenceCandidate[];
/**
 * @maxItems 10000
 */
export type Documents = ScientificDocument[];
export type DatasetId1 = string;
export type Extension2 = (FtirExtension | NmrExtension | HrmsExtension | XrdExtension | UvVisExtension) | null;
export type Id56 = string;
export type Modality9 = "FTIR" | "NMR" | "HRMS" | "XRD" | "UV_VIS";
export type PointCount2 = number;
export type ProjectId64 = string;
export type SchemaVersion84 = "1.0.0";
export type ArraysSha256 = string;
export type Baseline = number[] | null;
export type BaselineX = number[] | null;
export type DatasetId2 = string;
export type Decimated = boolean;
export type PointCount3 = number;
export type ReturnedPoints = number;
export type X7 = number[];
export type Y7 = number[];
export type YError = number[] | null;
export type Note4 = string | null;
export type SampleLabel = string | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AssociationState".
 */
export type AssociationState = "UNASSIGNED" | "ASSOCIATED_WITH_STRUCTURE" | "ASSOCIATED_WITH_SAMPLE";
export type StructureId9 = string | null;
export type CreatedAt50 = string | null;
export type CreatedBy14 = string | null;
export type DatasetId3 = string;
export type Id57 = string | null;
export type Note5 = string | null;
export type SampleLabel1 = string | null;
export type StructureId10 = string | null;
export type StructureName4 = string | null;
export type Axis = "cm^-1" | "eV" | "nm";
/**
 * @maxItems 16
 */
export type Bands2 =
  | []
  | [ComparisonBandInput]
  | [ComparisonBandInput, ComparisonBandInput]
  | [ComparisonBandInput, ComparisonBandInput, ComparisonBandInput]
  | [ComparisonBandInput, ComparisonBandInput, ComparisonBandInput, ComparisonBandInput]
  | [ComparisonBandInput, ComparisonBandInput, ComparisonBandInput, ComparisonBandInput, ComparisonBandInput]
  | [
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
    ]
  | [
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
    ]
  | [
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
    ]
  | [
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
    ]
  | [
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
    ]
  | [
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
    ]
  | [
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
    ]
  | [
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
    ]
  | [
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
    ]
  | [
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
    ]
  | [
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
      ComparisonBandInput,
    ];
export type HiNm = number;
export type Label18 = string | null;
export type LoNm = number;
export type Id58 = string;
export type ExperimentalDatasetId = string;
export type IdempotencyKey7 = string;
export type MinOscillatorStrength = number;
export type MinRelativeIntensity = number;
export type PeakSetDatasetId = string;
export type Factor = number | null;
export type Mode3 = "UNSCALED" | "USER_FACTOR";
export type LorentzianFwhmCm1 = number;
export type StepCm1 = number;
/**
 * @minItems 2
 * @maxItems 2
 */
export type WindowCm1 = [unknown, unknown];
export type Tolerance = number;
export type AssignmentStatement = string;
export type Authority4 = "DETERMINISTIC_TRANSFORM";
export type Axis1 = "cm^-1" | "eV" | "nm";
export type CalculatedStatesInBand = number[];
export type CentroidCalculatedEv = number | null;
export type CentroidEv = number | null;
export type F = number;
export type IntegralSigmaDnuCm2PerCm = number;
export type NuHiCm1 = number;
export type NuLoCm1 = number;
export type Points4 = number;
export type FCalculatedSum = number;
export type FRatioCalcOverExp = number | null;
export type HiNm1 = number;
export type IntegrationDomain = string;
export type Label19 = string;
export type EdgesMoved = string;
export type FMax = number;
export type FMin = number;
export type LoNm1 = number;
export type Code6 = string;
export type Message4 = string;
export type Severity1 = "error" | "warning" | "info";
export type Notes1 = ComparisonDiagnostic[];
export type Bands3 = BandComparison[];
export type CreatedAt51 = string;
export type CreatedBy15 = string;
export type Diagnostics7 = ComparisonDiagnostic[];
export type ExperimentalDatasetId1 = string;
export type ExperimentalDatasetName = string;
export type AsWritten = string | null;
export type FileReported = string | null;
export type Line1 = number | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SuppliedStatus".
 */
export type SuppliedStatus = "AS_REPORTED_IN_FILE" | "USER_ENTERED" | "NOT_SUPPLIED";
export type Value9 = string | number | null;
export type Id59 = string;
export type IntensityStatement = string;
export type Kind7 = "VIBRATIONAL_POSITION_MATCH" | "UVVIS_POSITION_AND_BAND_COMPARISON";
export type Method22 = "gated_optimal_assignment";
export type AmbiguousPairs = number;
export type CalculatedConsidered = number;
export type Count = number;
export type Reason4 = string;
export type CalculatedExcluded = ExcludedCount[];
export type CalculatedTotal = number;
export type DeltaDefinition = string;
export type DeltaUnit2 = "cm^-1" | "eV" | "nm";
export type ExperimentalPeaks = number;
export type Mae = number | null;
export type MaeNote = string;
export type MaeUpperBoundByConstruction = number;
export type Matched = number;
export type MatchedFractionOfCalculatedConsidered = number | null;
export type MatchedFractionOfExperimentalPeaks = number | null;
export type MaxAbsDelta = number | null;
export type MedianDelta = number | null;
export type Rmse = number | null;
export type SignedBias = number | null;
export type Mae1 = number | null;
export type Matched1 = number;
export type Rmse1 = number | null;
export type SignedBias1 = number | null;
export type Tolerance1 = number;
export type ToleranceSensitivity = SensitivityRow[];
export type UnmatchedCalculated = number;
export type UnmatchedExperimental = number;
export type CalculatedIndex = number;
export type CalculatedOscillatorStrength = number | null;
export type CalculatedPosition = number;
export type CalculatedPositionSource = number;
export type CandidatesForCalculated = number;
export type CandidatesForExperimental = number;
export type Delta2 = number;
export type ExperimentalPeakIndex = number;
export type ExperimentalPosition = number;
export type MarginToNextExperimentalPeak = number | null;
export type RelativeIntensityCalculated = number | null;
export type RelativeIntensityExperimental = number | null;
export type Status23 = "CANDIDATE_MATCH" | "AMBIGUOUS_CANDIDATE";
export type Tolerance2 = number;
/**
 * @maxItems 5000
 */
export type Pairs1 = ComparisonPair[];
export type PeakSetDatasetId1 = string;
export type ProjectId65 = string;
export type ProvenanceRecordId5 = string;
export type RecordSha256 = string;
export type Factor1 = number | null;
export type Mode4 = "UNSCALED" | "USER_FACTOR";
export type Source6 = string;
export type Authority5 = "DISPLAY_ONLY";
export type Computed = boolean;
export type Cosine = number | null;
export type GridPoints = number | null;
export type Note6 = string | null;
export type PearsonR = number | null;
export type Reason5 = string | null;
export type Key5 = string;
export type Value10 = string | number | boolean | null;
export type Settings8 = ParameterValue[];
export type Tolerance3 = number;
export type CalculatedIndex1 = number;
export type CalculatedOscillatorStrength1 = number | null;
export type CalculatedPosition1 = number;
export type CalculatedPositionSource1 = number;
export type RelativeIntensityCalculated1 = number | null;
export type Status24 = "UNMATCHED_CALCULATED";
/**
 * @maxItems 5000
 */
export type UnmatchedCalculated1 = UnmatchedCalculated2[];
export type ExperimentalPeakIndex1 = number;
export type ExperimentalPosition1 = number;
export type Prominence = number;
export type RelativeIntensityExperimental1 = number | null;
export type Status25 = "UNMATCHED_EXPERIMENTAL";
/**
 * @maxItems 5000
 */
export type UnmatchedExperimental1 = UnmatchedExperimental2[];
export type WorkerVersion = string;
/**
 * @maxItems 2000
 */
export type Comparisons1 = SpectrumComparisonView[];
export type IdempotencyKey8 = string;
export type PreviewSha2565 = string;
export type ArtifactId4 = string;
export type Sha2568 = string;
export type SizeBytes5 = number;
export type ArraysSha2561 = string | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumAuthority".
 */
export type SpectrumAuthority = "RAW_MEASUREMENT" | "DETERMINISTIC_TRANSFORM" | "DERIVED_NOT_RAW";
/**
 * @maxItems 500
 */
export type Children = string[];
export type CreatedAt52 = string;
export type CreatedBy16 = string;
export type ExperimentId2 = string;
export type Id60 = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumDatasetKind".
 */
export type SpectrumDatasetKind = "RAW" | "TRANSFORM" | "PEAKS";
/**
 * @maxItems 64
 */
export type Lineage = string[];
export type Key6 = string;
export type Line2 = number;
export type Value11 = string;
/**
 * @maxItems 100
 */
export type MetadataVerbatim = MetadataLine[];
export type Name23 = string;
export type ParentDatasetId2 = string | null;
export type Algorithm2 = string;
export type Authority6 = "DERIVED_NOT_RAW";
export type Environment = ParameterValue[];
export type ArtifactSha2561 = string;
export type PointCount4 = number;
export type Representation = "ABSOLUTE" | "RELATIVE";
export type XOrder = ("ASCENDING" | "DESCENDING") | null;
export type XSha256 = string;
export type XUnit2 = "cm^-1" | "um" | "nm" | "eV";
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumYQuantity".
 */
export type SpectrumYQuantity = "ABSORBANCE" | "TRANSMITTANCE" | "INTENSITY" | "CROSS_SECTION" | "MOLAR_ABSORPTIVITY";
export type YSha256 = string;
export type YUnit2 =
  "absorbance" | "percent" | "fraction" | "counts" | "arbitrary" | "cm^2/molecule" | "L/(mol*cm)" | "relative";
export type Library = string;
export type LibraryVersion = string;
export type Parameters2 = ParameterValue[];
export type PeakCount = number;
export type FwhmX = number;
export type Index12 = number;
export type LeftBaseX = number;
export type Prominence1 = number;
export type Refined = boolean;
export type RelativeHeight = number;
export type RightBaseX = number;
export type X8 = number;
export type XSample = number;
export type Y8 = number;
export type YSample = number;
/**
 * @maxItems 2000
 */
export type Peaks = SpectrumPeak[];
export type RecordSha2561 = string;
export type Resolved1 = ParameterValue[];
export type Code7 = string;
export type Message5 = string;
export type Warnings2 = SpectrumWarning[];
export type PointCount5 = number;
export type DatasetId4 = string;
export type Library1 = string;
export type LibraryVersion1 = string;
export type Op1 = string;
export type OutputArtifactSha256 = string;
export type PerformedAt1 = string;
export type RecordSha2562 = string;
/**
 * @maxItems 64
 */
export type Processing1 = SpectrumProcessingStepView[];
export type ProjectId66 = string;
export type ProvenanceRecordId6 = string;
export type Representation1 = "ABSOLUTE" | "RELATIVE";
export type Decimal = string | null;
export type Delimiter1 = string | null;
export type Encoding1 = string | null;
export type Newline = string | null;
export type Orientation2 = string | null;
export type OriginalAxisDirection = "ASCENDING" | "DESCENDING";
export type OriginalName1 = string;
export type ParserName = string;
export type ParserVersion9 = string;
export type PreviewSha2566 = string;
export type RawArtifactId1 = string | null;
export type Sha2569 = string;
export type SizeBytes6 = number;
export type WorkerVersion1 = string;
export type Authority7 = "DETERMINISTIC_TRANSFORM";
export type Name24 = string;
export type PointCount6 = number;
export type Sha25610 = string;
export type Aux = AuxHash[];
export type Environment1 = ParameterValue[];
export type InputWasDescending = boolean;
export type Library2 = string;
export type LibraryVersion2 = string;
export type Op2 = string;
export type Parameters3 = ParameterValue[];
export type RecordSha2563 = string;
export type Resolved2 = ParameterValue[];
export type Warnings3 = SpectrumWarning[];
export type LabelInFile = string | null;
export type Quantity = string | null;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "UnitEvidence".
 */
export type UnitEvidence = "EXPLICIT_UNIT" | "USER_CONFIRMED" | "QUANTITY_NAME" | "HINT_ONLY" | "NONE";
export type UnitEvidenceText = string;
export type XMax = number | null;
export type XMin = number | null;
export type XOrder1 = "ASCENDING" | "DESCENDING";
export type YErrorPresent = boolean;
/**
 * @maxItems 5000
 */
export type Datasets1 = SpectrumDatasetView[];
export type IdempotencyKey9 = string;
export type Height2 = number | null;
export type MinDistanceX = number | null;
export type MinWidthX = number | null;
export type Polarity = ("maxima" | "minima") | null;
export type Prominence2 = number | null;
export type ProminenceSigma = number | null;
export type Refine = boolean | null;
export type Threshold = number | null;
export type ArtifactSha2562 = string;
export type Layout = string;
export type XSha2561 = string;
export type YErrorSha256 = string | null;
export type YSha2561 = string;
export type ExcludeInvalidRows = boolean;
/**
 * @maxItems 100
 */
export type ExcludedLines = number[];
export type XIndex = number | null;
export type XUnit3 = ("cm^-1" | "um" | "nm" | "eV") | null;
export type YErrorIndex = number | null;
export type YIndex = number | null;
export type YUnit3 =
  ("absorbance" | "percent" | "fraction" | "counts" | "arbitrary" | "cm^2/molecule" | "L/(mol*cm)" | "relative") | null;
export type Count1 = number;
export type Index13 = number;
export type InvalidCount = number;
export type Label20 = string | null;
export type Max = number | null;
export type Min = number | null;
/**
 * @maxItems 300
 */
export type Columns = SpectrumColumn[];
export type Code8 = string;
export type Line3 = number | null;
export type Message6 = string;
export type Severity2 = "error" | "warning" | "info";
/**
 * @maxItems 400
 */
export type Diagnostics8 = PreviewDiagnostic[];
export type Buckets = number | null;
export type Decimated1 = boolean;
export type SourcePoints = number;
/**
 * @maxItems 8000
 */
export type X9 = number[];
/**
 * @maxItems 8000
 */
export type Y9 = number[];
export type DisplayName3 = string | null;
/**
 * @maxItems 100
 */
export type MetadataVerbatim1 = MetadataLine[];
export type Needs = ("column_roles" | "x_unit" | "y_quantity_and_unit" | "y_transmittance_scale")[];
export type Name25 = "chemdft-spectra-text";
export type Version7 = string;
export type PointCount7 = number;
export type Evidence6 = string;
export type Quantity1 = string | null;
export type Unit7 = string | null;
export type Schema1 = "chemdft.experimental-spectrum.preview";
export type SchemaVersion85 = "1.0.0";
export type Decimal1 = string | null;
export type Delimiter2 = string | null;
export type Encoding2 = string | null;
export type FirstDataLine = number | null;
export type HeaderLineCount = number;
export type LastDataLine = number | null;
export type Newline1 = string | null;
export type Orientation3 = string | null;
export type Sha25611 = string;
export type SizeBytes7 = number;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumPreviewStatus".
 */
export type SpectrumPreviewStatus = "READY" | "NEEDS_CONFIRMATION" | "REJECTED";
export type Technique = string;
export type WorkerVersion2 = string;
export type DirectionInFile = "ASCENDING" | "DESCENDING";
export type LabelInFile1 = string | null;
export type Max1 = number;
export type Min1 = number;
export type Quantity2 = ("WAVENUMBER" | "WAVELENGTH" | "ENERGY" | "RAMAN_SHIFT") | null;
export type Sha25612 = string;
export type Count2 = number;
export type Max2 = number;
export type Median = number;
export type Min2 = number;
export type RelativeVariation = number;
export type Uniform = boolean;
export type Unit8 = ("cm^-1" | "um" | "nm" | "eV") | null;
export type UnitEvidenceText1 = string;
export type LabelInFile2 = string | null;
export type Max3 = number;
export type Min3 = number;
export type Sha25613 = string;
export type Unit9 =
  ("absorbance" | "percent" | "fraction" | "counts" | "arbitrary" | "cm^2/molecule" | "L/(mol*cm)" | "relative") | null;
export type UnitEvidenceText2 = string;
export type Column = number;
export type Sha25614 = string;
export type Unit10 =
  ("absorbance" | "percent" | "fraction" | "counts" | "arbitrary" | "cm^2/molecule" | "L/(mol*cm)" | "relative") | null;
export type DisplayName4 = string | null;
export type ExcludeInvalidRows1 = boolean;
export type Instrument = string | null;
export type Accumulations = number | null;
export type BandwidthNm = number | null;
export type Concentration = string | null;
export type ExcitationWavelengthNm = number | null;
export type IntegrationTimeS = number | null;
export type PathLengthCm = number | null;
export type Phase1 = ("GAS" | "LIQUID" | "SOLUTION" | "SOLID" | "OTHER") | null;
export type Polarization = string | null;
export type ResolutionCm1 = number | null;
export type SamplingMode = ("TRANSMISSION" | "ATR" | "GAS_CELL" | "DRIFTS" | "OTHER") | null;
export type Solvent1 = string | null;
export type Sample1 = string | null;
export type XIndex1 = number | null;
export type XUnit4 = ("cm^-1" | "um" | "nm" | "eV") | null;
export type YErrorIndex1 = number | null;
export type YIndex1 = number | null;
export type YUnit4 =
  ("absorbance" | "percent" | "fraction" | "counts" | "arbitrary" | "cm^2/molecule" | "L/(mol*cm)" | "relative") | null;
export type DisplayName5 = string | null;
export type IdempotencyKey10 = string;
export type Op3 =
  | "baseline.arpls"
  | "baseline.snip"
  | "baseline.imodpoly"
  | "baseline.offset"
  | "smooth.savgol"
  | "normalize.max"
  | "normalize.area"
  | "resample.linear"
  | "crop"
  | "convert.absorbance_from_transmittance";
export type Decreasing = boolean | null;
export type DiffOrder = number | null;
export type HalfWindowX = number | null;
export type MaxIter = number | null;
export type Mode5 = ("interp" | "mirror" | "nearest" | "wrap" | "constant") | null;
export type NumStd = number | null;
export type Percentile = number | null;
export type PolyOrder = number | null;
export type Polyorder = number | null;
export type SmoothHalfWindow = number | null;
export type Step = number | null;
export type StiffnessLengthX = number | null;
export type Target = number | null;
export type Tol = number | null;
export type Value12 = number | null;
export type WindowPoints = number | null;
export type WindowX = number | null;
export type XMax1 = number | null;
export type XMin1 = number | null;
export type XRange = [unknown, unknown] | null;
export type CreatedAt53 = string;
export type CreatedBy17 = string;
export type DatasetId5 = string | null;
export type Id61 = string;
export type CreatedAt54 = string;
export type CreatedBy18 = string;
export type Id62 = string;
export type PreviewSha2567 = string;
export type ProjectId67 = string;
export type UploadId = string;
export type CreatedAt55 = string;
export type Id63 = string;
export type Needs1 = ("column_roles" | "x_unit" | "y_quantity_and_unit" | "y_transmittance_scale")[];
export type PreviewSha2568 = string;
export type Previews = SpectrumPreviewSummary[];
export type ProjectId68 = string;
export type OriginalName2 = string;
export type RawArtifactId2 = string | null;
export type Sha25615 = string;
export type SizeBytes8 = number;
export type UploadedAt1 = string;
export type State12 = "PREVIEW" | "IMPORTED" | "REJECTED";
/**
 * @maxItems 2000
 */
export type Uploads = SpectrumUploadView[];
export type CandidateId6 = string;
export type SchemaVersion86 = "1.0.0";
export type SchemaVersion87 = "1.0.0";
/**
 * @maxItems 10000
 */
export type Candidates4 = StructureCandidate[];
export type SchemaVersion88 = "1.0.0";
export type CanonicalIsomericSmiles4 = string | null;
export type Formula9 = string | null;
export type RepresentationId = string | null;
export type Reused = boolean;
export type SchemaVersion89 = "1.0.0";
export type Status26 = string;
export type Reason6 = string | null;
export type CandidateId7 = string;
export type ExpectedRepresentationId1 = string | null;
export type GateStatus = string;
export type ProjectId69 = string;
export type ReviewReason1 = string;
export type RunId4 = string | null;
export type SchemaVersion90 = "1.0.0";
export type SourceDocumentId6 = string | null;
export type Notes2 = string | null;
export type AtomOrdering2 = "AS_LISTED";
/**
 * @minItems 1
 * @maxItems 10000
 */
export type Atoms4 = [Atom, ...Atom[]];
/**
 * @maxItems 40000
 */
export type Bonds3 = Bond[];
export type Dimensionality2 = 3;
export type AtomCountAfter = number;
export type AtomCountBefore = number;
/**
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates = [unknown, unknown, unknown];
export type Element3 = string;
export type Index14 = number;
export type AtomsAdded = AddedAtomDiff[];
export type Element4 = string;
export type Index15 = number;
/**
 * @minItems 3
 * @maxItems 3
 */
export type NewCoordinates = [unknown, unknown, unknown];
export type OldCoordinates = [unknown, unknown, unknown] | null;
export type AtomsMoved = MovedAtomDiff[];
export type Coordinates1 = [unknown, unknown, unknown] | null;
export type Element5 = string;
export type Index16 = number;
export type AtomsRemoved = RemovedAtomDiff[];
export type DistanceWarnings = string[];
export type Index17 = number;
export type NewElement = string;
export type OldElement = string;
export type ElementsReplaced = ReplacedElementDiff[];
export type FormulaAfter = string;
export type FormulaBefore = string;
export type MinDistanceAfter = number | null;
export type MinDistanceBefore = number | null;
export type ParentVersionId1 = string;
export type Coordinates2 = [unknown, unknown, unknown] | null;
export type Element6 = string | null;
export type Index18 = number | null;
export type OpType = "add_atom" | "remove_atom" | "move_atom" | "replace_element";
/**
 * @maxItems 32
 */
export type AllowedTools3 = AIToolPolicy[];
export type CanWrite4 = boolean;
export type ContextVersion3 = "1.1.0";
export type ExampleSlug4 = string | null;
export type ExecutionRequiresResearcherApproval2 = true;
export type GeneratedAt5 = string;
/**
 * @maxItems 16
 */
export type GroundingFacts3 =
  | []
  | [GroundingFact]
  | [GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact, GroundingFact]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ]
  | [
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
      GroundingFact,
    ];
/**
 * @maxItems 8
 */
export type GroundingNotes3 =
  | []
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string];
export type GroundingPolicy3 = string | null;
export type HumanId3 = string;
export type InterpretationSourceClass3 = "AI_HYPOTHESIS";
export type OrganizationId7 = string;
export type PlanningProfile3 = "STRUCTURE_EDIT_PROPOSAL";
export type ProjectId70 = string;
export type ProjectKind3 = "NORMAL" | "LEGACY_LOCAL" | "ACCEPTANCE_FROZEN" | "EXAMPLE_TEMPLATE";
export type ProjectName3 = string;
export type PublishedExample3 = boolean;
/**
 * @maxItems 8
 */
export type Resources3 =
  | []
  | [ProductResource]
  | [ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource, ProductResource, ProductResource]
  | [ProductResource, ProductResource, ProductResource, ProductResource, ProductResource, ProductResource]
  | [
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
    ]
  | [
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
      ProductResource,
    ];
export type Role6 = string;
export type Sealed5 = boolean;
export type ViewHint3 = string | null;
export type ViewHintIsUntrusted3 = true;
/**
 * @minItems 1
 * @maxItems 100
 */
export type Operations = [StructureEditOperation, ...StructureEditOperation[]];
export type Reason7 = string | null;
export type StructureVersionId14 = string;
export type CreatedVersionId = string | null;
export type Operations1 = StructureEditOperation[];
export type ParentVersionId2 = string;
export type ProposalId = string | null;
export type SchemaVersion91 = "1.0.0";
export type Status27 = "PROPOSED" | "APPLIED";
export type StructureId11 = string;
export type IdempotencyKey11 = string;
export type ProjectId71 = string;
export type RequestedFormat = string;
export type SelectionIndex = number;
export type StructureName5 = string | null;
export type AtomCount8 = number;
export type BondCount = number;
export type CreatedAt56 = string;
export type Id64 = string;
export type LatestRevision1 = number;
export type LatestVersionId1 = string;
export type Name26 = string;
export type ProjectId72 = string;
export type UpdatedAt9 = string;
export type IdempotencyKey12 = string | null;
export type Multiplicity22 = number;
export type Operation2 = string;
export type OverallCharge2 = number;
export type ParentVersionId3 = string;
export type RequestedOrigin = "MANUALLY_EDITED";
export type StructureId12 = string;
export type DensityGridSha256 = string;
export type DensityIsovalue = number;
export type DensityUnit = "e/a0^3";
export type InterpolatorVersion = "trilinear-1.0.0";
export type Maximum = number;
/**
 * @minItems 3
 * @maxItems 3
 */
export type MaximumPositionAngstrom = [unknown, unknown, unknown];
export type Minimum = number;
/**
 * @minItems 3
 * @maxItems 3
 */
export type MinimumPositionAngstrom = [unknown, unknown, unknown];
export type PotentialUnit = "a.u.";
export type RendererVersion = "marching-tetrahedra-2.0.0";
export type TriangleCount = number;
export type VertexCount = number;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ApprovalPolicy".
 */
export type ApprovalPolicy = "NONE" | "POLICY_DEPENDENT" | "EXPLICIT";
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AuthoritativeFieldPolicy".
 */
export type AuthoritativeFieldPolicy = "NONE" | "CANDIDATE_ONLY" | "SERVER_OWNED" | "TRUSTED_PRODUCER_ONLY";
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ToolAvailability".
 */
export type ToolAvailability = "EXECUTABLE" | "FUTURE" | "DISABLED";
export type CostClass = string;
export type Description6 = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ToolErrorCode".
 */
export type ToolErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "APPROVAL_REQUIRED"
  | "BUDGET_EXCEEDED"
  | "CAPABILITY_UNAVAILABLE"
  | "TOOL_VERSION_UNSUPPORTED"
  | "SCIENTIFIC_VALIDATION_FAILED"
  | "DEPENDENCY_UNAVAILABLE"
  | "INTERNAL_ERROR";
/**
 * @maxItems 32
 */
export type ErrorCodes = ToolErrorCode[];
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "IdempotencyBehavior".
 */
export type IdempotencyBehavior = "NATURAL" | "KEY_REQUIRED" | "KEY_OPTIONAL" | "NOT_IDEMPOTENT";
export type InputSchemaRef1 = string;
export type Name27 = string;
export type OutputSchemaRef1 = string;
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "PermissionClass".
 */
export type PermissionClass = "READ" | "LOW_COST_REVERSIBLE" | "EXPENSIVE" | "DESTRUCTIVE_EXTERNAL";
/**
 * @maxItems 32
 */
export type ProvenanceObligations = string[];
/**
 * @maxItems 64
 */
export type RequiredCapabilities1 = string[];
export type Reversible = boolean;
export type RiskClass = string;
export type SchemaVersion92 = "1.0.0";
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SideEffectClass".
 */
export type SideEffectClass =
  "PURE" | "READ_ONLY" | "MUTATING_REVERSIBLE" | "DURABLE_JOB" | "DESTRUCTIVE" | "EXTERNAL_SIDE_EFFECT";
/**
 * @maxItems 32
 */
export type Tags = string[];
export type Major = number;
export type Minor = number;
export type Patch = number;
export type ActorId2 = string;
export type Id65 = string;
export type InputFingerprint = string;
export type InvokedAt = string;
export type OrganizationId8 = string;
export type Outcome5 = "SUCCEEDED" | "REJECTED" | "FAILED";
export type ProjectId73 = string | null;
export type RequestId2 = string;
export type ResultReference = string | null;
export type SchemaVersion93 = "1.0.0";
export type ToolName3 = string;
export type Transport = "REST" | "WEB_UI" | "AI_SCIENTIST" | "WEBMCP" | "MCP" | "INTERNAL";
export type AuthorId = string;
export type Reference4 = EntityReference | ArtifactReference | null;
export type Text1 = string | null;
export type CreatedAt57 = string;
export type Id66 = string;
export type ProjectId74 = string;
export type Reason8 = string;
export type SchemaVersion94 = "1.0.0";
export type VerificationState8 = "UNVERIFIED" | "VERIFIED" | "DISPUTED" | "SUPERSEDED" | "RETRACTED";
export type CreatedAt58 = string;
export type Id67 = string;
export type Method23 = string;
export type Notes3 = string | null;
export type ProjectId75 = string;
export type SchemaVersion95 = "1.0.0";
export type ArtifactSizeBytes = number;
export type Authority8 = "AUTHORITATIVE";
export type Basis15 = string;
export type CalculationId25 = string;
export type CalculationInputHash4 = string;
export type CalculationResultId1 = string;
export type CoefficientArtifactSha2561 = string;
export type CoordinateFrame1 = "INPUT_STRUCTURE_VERSION_CARTESIAN";
export type CoordinateUnit13 = "angstrom";
export type CreatedAt59 = string;
export type DensityIntegralElectrons = number | null;
export type DensityIntegralNote = string | null;
export type DensityIntegralRelativeError = number | null;
export type DensityIntegralTolerance = 0.05;
export type DensityMatrixElectronCount = number;
export type DensityMatrixSha256 = string;
/**
 * @minItems 3
 * @maxItems 3
 */
export type Dimensions1 = [number, number, number];
export type ElectronCount1 = number;
export type FieldMax1 = number;
/**
 * @minItems 3
 * @maxItems 3
 */
export type FieldMaximumPositionAngstrom = [unknown, unknown, unknown];
export type FieldMin1 = number;
/**
 * @minItems 3
 * @maxItems 3
 */
export type FieldMinimumPositionAngstrom = [unknown, unknown, unknown];
export type FieldQuantity1 = "MO_AMPLITUDE" | "ELECTRON_DENSITY" | "ELECTROSTATIC_POTENTIAL";
export type FieldSha2561 = string;
export type FieldUnit1 = "a0^-3/2" | "e/a0^3" | "a.u.";
export type GenerationSeconds = number;
export type GridGenerator1 = "pyscf.scf-fields";
export type GridGeneratorVersion1 = "2.0.0";
export type GridProfile2 = "STANDARD";
export type GridProfileVersion1 = "2.0.0";
export type GridSha2561 = string;
export type GridSpecificationHash1 = string;
export type InputStructureVersionId6 = string;
export type Method24 = string;
export type MolecularMarginAngstrom1 = number;
export type OrbitalIndex2 = number | null;
/**
 * @minItems 3
 * @maxItems 3
 */
export type OriginAngstrom1 = [number, number, number];
export type PotentialMethod = string | null;
export type Producer3 = "pyscf";
export type ProducerVersion = string;
export type ProvenanceRecordId7 = string;
export type ResultSha2565 = string;
export type SchemaVersion96 = "1.0.0";
export type SingularityTreatment = string;
export type SourceClass19 = "CALCULATED";
export type SpacingAngstrom1 = number;
export type SpinChannel5 = ("restricted" | "alpha" | "beta") | null;
export type ValidationState2 = "VALIDATED";
export type VerificationState9 = "UNVERIFIED";
/**
 * @minItems 3
 * @maxItems 3
 */
export type VoxelVectorsAngstrom1 = [unknown, unknown, unknown];
/**
 * @minItems 8
 * @maxItems 250000
 */
export type FieldValues1 = [number, number, number, number, number, number, number, number, ...number[]];
export type FieldKind = "MO_AMPLITUDE" | "ELECTRON_DENSITY" | "ELECTROSTATIC_POTENTIAL";
export type GridProfile3 = "STANDARD";
export type OrbitalIndex3 = number | null;
export type SpinChannel6 = ("restricted" | "alpha" | "beta") | null;
export type ExperimentName3 = string;
export type PointMode3 = "PEAK_PICKING" | "CURVE_POINTS";
/**
 * @minItems 1
 * @maxItems 200000
 */
export type Points5 = [XrdDigitizedPointInput, ...XrdDigitizedPointInput[]];
export type SchemaVersion97 = "1.0.0";
export type SourceDocumentSha2561 = string;
export type SourcePixelHeight3 = number;
export type SourcePixelWidth3 = number;
export type SourceRenderScale3 = number;
export type SourceRenderSha2563 = string;
export type SourceRenderVersion3 = string;
export type YUnitStatus1 = "UNKNOWN" | "ARBITRARY" | "SOURCE_DEFINED";
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AcceleratorKind".
 */
export type AcceleratorKind1 = "NONE" | "NVIDIA_CUDA";
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ApproximationState".
 */
export type ApproximationState1 = "EXACT_AS_REPORTED" | "APPROXIMATE" | "ESTIMATED";
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateRepresentationReviewState".
 */
export type CandidateRepresentationReviewState2 = "NOT_REVIEWED" | "REVIEWED" | "REJECTED";

/**
 * Generated from ChemDFT Pydantic contracts. Do not edit.
 */
export interface ContractBundle {
  ai_approval_view: AIApprovalView;
  ai_citation: AICitation;
  ai_conversation_detail: AIConversationDetail;
  ai_conversation_list_output: AIConversationListOutput;
  ai_conversation_summary: AIConversationSummary;
  ai_examples_output: AIExamplesOutput;
  ai_message_view: AIMessageView;
  ai_model_performance_view: AIModelPerformanceView;
  ai_preferences_input: AIPreferencesInput;
  ai_run_event_view: AIRunEventView;
  ai_run_events_output: AIRunEventsOutput;
  ai_run_step_view: AIRunStepView;
  ai_run_view: AIRunView;
  ai_settings_view: AISettingsView;
  ai_tool_policy: AIToolPolicy;
  ai_usage_summary: AIUsageSummary;
  allowance_period_view: AllowancePeriodView;
  approval_decision_input: ApprovalDecisionInput;
  artifact_reference: ArtifactReference;
  audit_event: AuditEvent;
  authoritative_result_submission: AuthoritativeResultSubmission;
  billing_snapshot: BillingSnapshot;
  byok_credential_input: BYOKCredentialInput;
  byok_revocation_input: BYOKRevocationInput;
  byok_status_view: BYOKStatusView;
  calculated_source_list_output: CalculatedSourceListOutput;
  calculation: Calculation;
  calculation_attempt: CalculationAttempt;
  calculation_comparison_output: CalculationComparisonOutput;
  calculation_detail: CalculationDetail;
  calculation_export_catalog: CalculationExportCatalog;
  calculation_get_input: CalculationGetInput;
  calculation_input: CalculationInput;
  calculation_pair_comparison: CalculationPairComparison;
  calculation_result: CalculationResult;
  calculation_specification: CalculationSpecification;
  calculation_submit_input: CalculationSubmitInput;
  candidate_cell_parameters: CandidateCellParameters;
  candidate_coordinate_paste_input: CandidateCoordinatePasteInput;
  candidate_coordinate_representation: CandidateCoordinateRepresentation;
  candidate_coordinates: CandidateCoordinates;
  candidate_representation: CandidateRepresentationDetail;
  candidate_representation_create_input: CandidateRepresentationCreateInput;
  candidate_representation_create_output: CandidateRepresentationCreateOutput;
  candidate_representation_list_input: CandidateRepresentationListInput;
  candidate_representation_list_output: CandidateRepresentationListOutput;
  candidate_representation_reject_input: CandidateRepresentationRejectInput;
  candidate_representation_review_input: CandidateRepresentationReviewInput;
  candidate_representation_review_output: CandidateRepresentationReviewOutput;
  candidate_representation_view: CandidateRepresentationView;
  checkout_session_view: CheckoutSessionView;
  citation: Citation;
  comparison_candidate_list_output: ComparisonCandidateListOutput;
  compute_estimate: ComputeEstimate;
  compute_execution_view: ComputeExecutionView;
  compute_job_list_output: ComputeJobListOutput;
  compute_job_view: ComputeJobView;
  compute_requirement: ComputeRequirement;
  compute_reservation_view: ComputeReservationView;
  compute_usage_summary: ComputeUsageSummary;
  conformer: Conformer;
  conformer_ensemble_manifest: ConformerEnsembleManifest;
  conformer_ensemble_member: ConformerEnsembleMember;
  conformer_ensemble_result: ConformerEnsembleResult;
  conformer_generation_input: ConformerGenerationInput;
  conformer_search_options: ConformerSearchOptions;
  create_assessment_input: CreateAssessmentInput;
  create_checkout_input: CreateCheckoutInput;
  create_conversation_input: CreateConversationInput;
  create_hypothesis_input: CreateHypothesisInput;
  create_investigation_input: CreateInvestigationInput;
  create_observation_input: CreateObservationInput;
  create_plan_input: CreatePlanInput;
  dftd4_capability: Dftd4Capability;
  dftd4_retry_input: Dftd4RetryInput;
  dftd4_submit_input: Dftd4SubmitInput;
  digitized_dataset_input: DigitizedDatasetInput;
  digitizer_calibration: DigitizerCalibration;
  digitizer_point: DigitizerPoint;
  document_figures_extract_output: DocumentFiguresExtractOutput;
  dominant_transition: DominantTransition;
  draw_input: DrawInput;
  draw_response: DrawResponse;
  energy_planning_context: EnergyPlanningContext;
  energy_result: EnergyResult;
  engine_capability_view: EngineCapabilityView;
  engine_execution_identity: EngineReference;
  engine_preference: EnginePreference;
  entitlement_snapshot: EntitlementSnapshot;
  entity_reference: EntityReference;
  evidence: Evidence1;
  evidence_candidate: EvidenceCandidate;
  evidence_review_input: EvidenceReviewInput;
  evidence_review_output: EvidenceReviewOutput;
  example_copy_output: ExampleCopyOutput;
  example_detail: ExampleDetail;
  example_summary: ExampleSummary;
  excited_state: ExcitedState;
  execution_request: ExecutionRequest;
  experiment: Experiment;
  experiment_dataset_import_input: ExperimentDatasetImportInput;
  experimental_dataset: ExperimentalDataset;
  experimental_dataset_list_output: ExperimentalDatasetListOutput;
  experimental_dataset_view: ExperimentalDatasetView;
  experimental_import_input: ExperimentalImportInput;
  experimental_series: ExperimentalSeries;
  external_import_confirm_input: ExternalImportConfirmInput;
  external_import_detail: ExternalImportDetail;
  external_import_list_output: ExternalImportListOutput;
  external_import_view: ExternalImportView;
  geometry_candidate_accept_input: GeometryCandidateAcceptInput;
  geometry_candidate_accept_output: GeometryCandidateAcceptOutput;
  geometry_candidate_list_output: GeometryCandidateListOutput;
  geometry_candidate_view: GeometryCandidateView;
  geometry_eligibility: GeometryEligibility;
  graph_axis_calibration: GraphAxisCalibration;
  graph_digitization_session: GraphDigitizationSession;
  graph_digitized_dataset_input: GraphDigitizedDatasetInput;
  graph_digitized_point: GraphDigitizedPoint;
  graph_digitized_point_input: GraphDigitizedPointInput;
  hessian_options: HessianOptions;
  hypothesis: Hypothesis;
  import_preview_report: ImportPreviewReport;
  imported_result_view: ImportedResultView;
  investigation_assessment_view: InvestigationAssessmentView;
  investigation_get_input: InvestigationGetInput;
  investigation_hypothesis_view: InvestigationHypothesisView;
  investigation_list_output: InvestigationListOutput;
  investigation_observation_view: InvestigationObservationView;
  investigation_plan_view: InvestigationPlanView;
  investigation_policy: InvestigationPolicy1;
  investigation_step_view: InvestigationStepView;
  investigation_view: InvestigationView;
  invoice_view: InvoiceView;
  job_diagnostics: JobDiagnostics;
  job_log_output: JobLogOutput;
  job_specification_summary: JobSpecificationSummary;
  knowledge_index_status: KnowledgeIndexStatus;
  knowledge_item_view: KnowledgeItemView;
  knowledge_retrieval_result: KnowledgeRetrievalResult;
  knowledge_search_filters: KnowledgeSearchFilters;
  knowledge_search_input: KnowledgeSearchInput;
  knowledge_search_output: KnowledgeSearchOutput;
  knowledge_source: KnowledgeSource;
  molecular_drawing_generate_input: MolecularDrawingGenerateInput;
  molecular_graph_validate_input: MolecularGraphValidateInput;
  molecular_graph_validate_output: MolecularGraphValidateOutput;
  molecular_orbital: MolecularOrbital;
  molecular_orbital_analysis: MolecularOrbitalAnalysis;
  molecular_orbital_grid_manifest: MolecularOrbitalGridManifest;
  molecular_orbital_grid_output: MolecularOrbitalGridOutput;
  molecular_orbital_grid_request: MolecularOrbitalGridRequest;
  molecule_alternative: MoleculeAlternative;
  molecule_draft_create_input: MoleculeDraftCreateInput;
  molecule_draft_create_output: MoleculeDraftCreateOutput;
  molecule_resolve_input: MoleculeResolveInput;
  molecule_resolve_output: MoleculeResolveOutput;
  money: Money;
  navigator_state: NavigatorState;
  optimization_options: OptimizationOptions;
  optimization_result: OptimizationResult;
  optimization_trajectory: OptimizationTrajectory;
  orbital_frontier: OrbitalFrontier;
  periodic_energy_planning_context: PeriodicEnergyPlanningContext;
  periodic_energy_result: PeriodicEnergyResult;
  periodic_options: PeriodicOptions;
  post_message_input: PostMessageInput;
  product_context: ProductContext;
  product_selection: ProductSelection;
  project_create_input: ProjectCreateInput;
  project_get_input: ProjectGetInput;
  project_list_input: ProjectListInput;
  project_list_output: ProjectListOutput;
  project_memory_create_input: ProjectMemoryCreateInput;
  project_memory_list_output: ProjectMemoryListOutput;
  project_memory_view: ProjectMemoryView;
  project_scientific_claims_output: ProjectScientificClaimsOutput;
  project_scientific_comparison_output: ProjectScientificComparisonOutput;
  project_summary: ProjectSummary;
  provenance_record: ProvenanceRecord;
  published_results_page: PublishedResultsPage;
  qcschema_atomic_input_v2: QCSchemaAtomicInputV2;
  queue_status: QueueStatus;
  reconciliation_view: ReconciliationView;
  research_overview: ResearchOverview;
  researcher_gate_view: ResearcherGateView;
  result_compare_input: ResultCompareInput;
  result_summary: ResultSummary;
  reuse_plan: ReusePlan;
  sample: Sample;
  saved_comparison_list_output: SavedComparisonListOutput;
  saved_comparison_open_output: SavedComparisonOpenOutput;
  saved_comparison_summary: SavedComparisonSummary;
  scientific_artifact: ScientificArtifact;
  scientific_artifact_registration: ScientificArtifactRegistration;
  scientific_claim: ScientificClaim;
  scientific_claim_relation: ScientificClaimRelation;
  scientific_comparison_row: ScientificComparisonRow;
  scientific_comparison_summary: ScientificComparisonSummary;
  scientific_document: ScientificDocument;
  scientific_document_import_output: ScientificDocumentImportOutput;
  scientific_document_list_output: ScientificDocumentListOutput;
  source_anchor: SourceAnchor;
  source_pixel_point: SourcePixelPoint;
  source_pixel_region: SourcePixelRegion;
  spectrum: Spectrum;
  spectrum_arrays_view: SpectrumArraysView;
  spectrum_association_input: SpectrumAssociationInput;
  spectrum_association_view: SpectrumAssociationView;
  spectrum_comparison_input: SpectrumComparisonInput;
  spectrum_comparison_list_output: SpectrumComparisonListOutput;
  spectrum_comparison_view: SpectrumComparisonView;
  spectrum_confirm_input: SpectrumConfirmInput;
  spectrum_dataset_list_output: SpectrumDatasetListOutput;
  spectrum_dataset_view: SpectrumDatasetView;
  spectrum_peak_input: SpectrumPeakInput;
  spectrum_preview_body: SpectrumPreviewBody;
  spectrum_resolve_input: SpectrumResolveInput;
  spectrum_transform_input: SpectrumTransformInput;
  spectrum_upload_list_output: SpectrumUploadListOutput;
  spectrum_upload_view: SpectrumUploadView;
  structure: Structure;
  structure_candidate: StructureCandidate;
  structure_candidate_get_input: StructureCandidateGetInput;
  structure_candidate_list_input: StructureCandidateListInput;
  structure_candidate_list_output: StructureCandidateListOutput;
  structure_candidate_promotion_output: StructureCandidatePromotionOutput;
  structure_candidate_recognize_output: StructureCandidateRecognizeOutput;
  structure_candidate_reject_input: StructureCandidateRejectInput;
  structure_candidate_request_review_output: StructureCandidateRequestReviewOutput;
  structure_candidate_review_input: StructureCandidateReviewInput;
  structure_candidate_review_output: StructureCandidateReviewOutput;
  structure_edit_coordinate_set: StructureEditCoordinateSet;
  structure_edit_diff_view: StructureEditDiffView;
  structure_edit_operation: StructureEditOperation;
  structure_edit_planning_context: StructureEditPlanningContext;
  structure_edit_propose_input: StructureEditProposeInput;
  structure_edit_propose_output: StructureEditProposeOutput;
  structure_import_input: StructureImportInput;
  structure_import_output: StructureImportOutput;
  structure_summary: StructureSummary;
  structure_version: StructureVersion;
  structure_version_create_input: StructureVersionCreateInput;
  structure_version_create_output: StructureVersionCreateOutput;
  structure_version_detail: StructureVersionDetail;
  structure_version_provenance: StructureVersionProvenance;
  surface_potential_statistics: SurfacePotentialStatistics;
  tddft_options: TddftOptions;
  tddft_result: TddftResult;
  thermochemistry_options: ThermochemistryOptions;
  thermochemistry_result: ThermochemistryResult;
  tool_definition: ToolDefinition;
  tool_invocation_record: ToolInvocationRecord;
  user_correction: UserCorrection;
  verification_record: VerificationRecord;
  vibrational_analysis: VibrationalAnalysis;
  visualization_scene_get_input: VisualizationSceneGetInput;
  volumetric_field_manifest: VolumetricFieldManifest;
  volumetric_field_output: VolumetricFieldOutput;
  volumetric_field_request: VolumetricFieldRequest;
  xrd_axis_calibration: XrdAxisCalibration;
  xrd_digitization_session: XrdDigitizationSession;
  xrd_digitized_dataset_input: XrdDigitizedDatasetInput;
  xrd_digitized_point: XrdDigitizedPoint;
  xrd_digitized_point_input: XrdDigitizedPointInput;
  xrd_reported_peak: XrdReportedPeak;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIApprovalView".
 */
export interface AIApprovalView {
  action_fingerprint: ActionFingerprint;
  created_at: CreatedAt;
  creates_or_changes?: CreatesOrChanges;
  estimated_compute?: ComputeEstimate | null;
  expires_at: ExpiresAt;
  id: Id1;
  normalized_arguments?: NormalizedArguments;
  project_id?: ProjectId1;
  proposal_provenance?: ProposalProvenance | null;
  reason: Reason;
  request_match?: RequestMatch;
  run_id: RunId;
  schema_version?: SchemaVersion;
  scientific_summary: ScientificSummary;
  status: Status;
  tool_name: ToolName;
  tool_version: ToolVersion;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComputeEstimate".
 */
export interface ComputeEstimate {
  assumptions?: Assumptions;
  confidence: Confidence;
  cost_high?: MoneyAmount | null;
  cost_low?: MoneyAmount | null;
  created_at: CreatedAt1;
  id: Id;
  project_id: ProjectId;
  provider: Provider;
  provider_summary: ProviderSummary;
  requirement_hash: RequirementHash;
  runtime_high_seconds?: RuntimeHighSeconds;
  runtime_low_seconds?: RuntimeLowSeconds;
  valid_until: ValidUntil;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MoneyAmount".
 */
export interface MoneyAmount {
  currency: Currency;
  minor_units: MinorUnits;
}
export interface NormalizedArguments {
  [k: string]: unknown;
}
/**
 * Which model proposed a calculation, how it was selected and how many repairs it needed.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProposalProvenance".
 */
export interface ProposalProvenance {
  eligibility?: Eligibility;
  model: Model;
  provider: Provider1;
  repair_attempts?: RepairAttempts;
  sampling?: ProposalSampling | null;
}
/**
 * The sampling settings the proposing model call actually used (recorded, not requested).
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProposalSampling".
 */
export interface ProposalSampling {
  chat_template_kwargs?: ChatTemplateKwargs;
  source: Source;
  temperature: Temperature;
  top_p?: TopP;
}
/**
 * One scientific parameter: what the researcher asked for against what was proposed.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "RequestMatchItem".
 */
export interface RequestMatchItem {
  excluded?: Excluded;
  mention?: Mention;
  outcome: Outcome;
  parameter: Parameter;
  proposed?: Proposed;
  requested?: Requested;
  requested_available?: RequestedAvailable;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AICitation".
 */
export interface AICitation {
  citation_id?: CitationId;
  citation_type: CitationType;
  entity_id: EntityId;
  knowledge_chunk_id?: KnowledgeChunkId;
  label: Label;
  page_number?: PageNumber;
  reference_text: ReferenceText;
  schema_version?: SchemaVersion1;
  source_anchor_id?: SourceAnchorId;
  source_record_type?: SourceRecordType;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIConversationDetail".
 */
export interface AIConversationDetail {
  conversation: AIConversationSummary;
  latest_run?: AIRunView | null;
  messages?: Messages;
  schema_version?: SchemaVersion8;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIConversationSummary".
 */
export interface AIConversationSummary {
  created_at: CreatedAt2;
  id: Id2;
  project_id: ProjectId2;
  schema_version?: SchemaVersion2;
  title?: Title;
  updated_at: UpdatedAt;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIRunView".
 */
export interface AIRunView {
  ai_model?: AiModel;
  ai_provider?: AiProvider;
  blocker?: ProposalBlocker | null;
  budget?: Budget;
  conversation_id: ConversationId;
  created_at: CreatedAt3;
  current_step: CurrentStep;
  error_code?: ErrorCode;
  error_detail?: ErrorDetail;
  id: Id3;
  max_steps: MaxSteps;
  pending_approval?: AIApprovalView | null;
  pending_researcher_gate?: ResearcherGateView | null;
  project_id: ProjectId3;
  schema_version?: SchemaVersion4;
  status: Status2;
  steps?: Steps;
  updated_at: UpdatedAt1;
  waiting_calculation_id?: WaitingCalculationId;
}
/**
 * Why no valid proposal reached approval: the last refusal, server-authored and value-free.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProposalBlocker".
 */
export interface ProposalBlocker {
  attempts: Attempts;
  code: Code;
  issues?: Issues;
  next_step: NextStep;
  summary: Summary;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "BlockerIssue".
 */
export interface BlockerIssue {
  allowed?: Allowed;
  code: Code1;
  field?: Field;
  message: Message;
  proposed?: Proposed1;
  requested?: Requested1;
}
/**
 * A pending human review the run is suspended on (never completed by the AI).
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ResearcherGateView".
 */
export interface ResearcherGateView {
  candidate_id: CandidateId;
  expected_representation_id: ExpectedRepresentationId;
  requested_at: RequestedAt;
  review_reason: ReviewReason;
  schema_version?: SchemaVersion3;
  source_document_id?: SourceDocumentId;
  status?: Status1;
  step_id: StepId;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIRunStepView".
 */
export interface AIRunStepView {
  created_at: CreatedAt4;
  error_code?: ErrorCode1;
  error_detail?: ErrorDetail1;
  finished_at?: FinishedAt;
  id: Id4;
  schema_version?: SchemaVersion5;
  status: Status3;
  step_number: StepNumber;
  step_type: StepType;
  summary?: Summary1;
  tool_name?: ToolName1;
  tool_version?: ToolVersion1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIMessageView".
 */
export interface AIMessageView {
  citations?: Citations;
  content: Content;
  conversation_id: ConversationId1;
  created_at: CreatedAt5;
  evidence?: Evidence;
  evidence_note?: EvidenceNote;
  evidence_status?: EvidenceStatus;
  id: Id5;
  role: Role;
  run_id?: RunId1;
  schema_version?: SchemaVersion7;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIEvidenceView".
 */
export interface AIEvidenceView {
  available?: Available;
  citation_id: CitationId1;
  document_id?: DocumentId;
  knowledge_chunk_id: KnowledgeChunkId1;
  knowledge_item_id: KnowledgeItemId;
  page_number?: PageNumber1;
  paragraph_ordinal?: ParagraphOrdinal;
  passage: Passage;
  schema_version?: SchemaVersion6;
  section_path?: SectionPath;
  source_anchor_id?: SourceAnchorId1;
  source_class?: SourceClass;
  source_title: SourceTitle;
  source_type: SourceType;
  verification_state?: VerificationState;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIConversationListOutput".
 */
export interface AIConversationListOutput {
  conversations?: Conversations;
  schema_version?: SchemaVersion9;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIExamplesOutput".
 */
export interface AIExamplesOutput {
  scope?: Scope;
  slugs: Slugs;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIModelPerformanceView".
 */
export interface AIModelPerformanceView {
  caveats: Caveats;
  metric_definitions: MetricDefinitions;
  rows: Rows;
  scope?: Scope1;
  window: PerformanceWindow;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MetricDefinition".
 */
export interface MetricDefinition {
  definition: Definition;
  denominator: Denominator;
  measured_in: MeasuredIn;
  metric: Metric;
  missing_data: MissingData;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ModelPerformanceRow".
 */
export interface ModelPerformanceRow {
  model_name: ModelName;
  model_provider: ModelProvider;
  proposals: ProposalSummary;
  request_latency: LatencySummary;
  requests: RequestOutcomes;
  run_outcomes: RunOutcomes;
  synthetic: Synthetic;
  tokens: TokenSummary;
  tool_calls: ToolCallSummary;
}
/**
 * Deterministic validation of calculation proposals. Not scientific correctness.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProposalSummary".
 */
export interface ProposalSummary {
  accepted_first_attempt?: AcceptedFirstAttempt;
  rejected_by_validation: RejectedByValidation;
  rejections_by_reason?: RejectionsByReason;
  repairs_before_approval?: RepairsBeforeApproval;
  unrepaired_runs?: UnrepairedRuns;
  validated_for_approval: ValidatedForApproval;
  validity_rate?: ValidityRate;
}
export interface RejectionsByReason {
  [k: string]: number;
}
/**
 * Successful single-request durations only; None means too few or no observations.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "LatencySummary".
 */
export interface LatencySummary {
  max_ms?: MaxMs;
  median_ms?: MedianMs;
  observations: Observations;
  p95_ms?: P95Ms;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "RequestOutcomes".
 */
export interface RequestOutcomes {
  dispatched: Dispatched;
  in_flight: InFlight;
  not_dispatched: NotDispatched;
  provider_error: ProviderError;
  succeeded: Succeeded;
  timeout: Timeout;
  unclassified_failure: UnclassifiedFailure;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "RunOutcomes".
 */
export interface RunOutcomes {
  canceled: Canceled;
  failed: Failed;
  other: Other;
  runs: Runs;
  succeeded: Succeeded1;
}
/**
 * Provider-reported counts only. Totals are None (UNKNOWN) when nothing was reported.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "TokenSummary".
 */
export interface TokenSummary {
  input_tokens?: InputTokens;
  output_tokens?: OutputTokens;
  requests_reported: RequestsReported;
  requests_unknown: RequestsUnknown;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ToolCallSummary".
 */
export interface ToolCallSummary {
  conformance_rate?: ConformanceRate;
  emitted: Emitted;
  outside_run_scope: OutsideRunScope;
  rejected_by_validation: RejectedByValidation1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "PerformanceWindow".
 */
export interface PerformanceWindow {
  invocations_considered: InvocationsConsidered;
  runs_considered: RunsConsidered;
  truncated: Truncated;
  unattributed_runs: UnattributedRuns;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIPreferencesInput".
 */
export interface AIPreferencesInput {
  mode: Mode;
  model: Model1;
  provider: Provider2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIRunEventView".
 */
export interface AIRunEventView {
  event_type: EventType;
  occurred_at: OccurredAt;
  payload?: Payload;
  project_id: ProjectId4;
  run_id: RunId2;
  schema_version?: SchemaVersion10;
  sequence: Sequence;
  summary: Summary2;
}
export interface Payload {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIRunEventsOutput".
 */
export interface AIRunEventsOutput {
  events?: Events;
  schema_version?: SchemaVersion11;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AISettingsView".
 */
export interface AISettingsView {
  availability: AIAvailability;
  credentials: Credentials;
  model_capabilities?: ModelCapabilities;
  preferences: AIPreferencesInput;
  providers: Providers;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIAvailability".
 */
export interface AIAvailability {
  allowance_status: AllowanceStatus;
  available: Available1;
  byok_enabled: ByokEnabled;
  error_code?: ErrorCode2;
  local_test_only?: LocalTestOnly;
  managed_enabled: ManagedEnabled;
  mode: Mode1;
  model: Model2;
  provider: Provider3;
  secret_storage_available: SecretStorageAvailable;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "BYOKStatusView".
 */
export interface BYOKStatusView {
  created_at?: CreatedAt6;
  fingerprint?: Fingerprint;
  provider: Provider4;
  status: Status4;
  updated_at?: UpdatedAt2;
  validated?: Validated;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIModelCapability".
 */
export interface AIModelCapability {
  configuration_requirements: ConfigurationRequirements;
  configured: Configured;
  development_evidence?: DevelopmentEvidence;
  display_name: DisplayName;
  documented_capabilities: DocumentedCapabilities;
  eligibility?: Eligibility1;
  endpoint: Endpoint;
  endpoint_availability: EndpointAvailability;
  limitations: Limitations;
  model_identifier: ModelIdentifier;
  planning_profiles?: PlanningProfiles;
  proposal_workflow_verified?: ProposalWorkflowVerified;
  provider: Provider5;
  published_context: PublishedContext;
  reviewed_on: ReviewedOn;
  selectable: Selectable;
  source_urls: SourceUrls;
  status: Status5;
  tool_compatibility_verified: ToolCompatibilityVerified;
  unselectable_reason?: UnselectableReason;
  verification_scope: VerificationScope;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIProviderOption".
 */
export interface AIProviderOption {
  local_test_only?: LocalTestOnly1;
  models: Models;
  provider: Provider6;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIToolPolicy".
 */
export interface AIToolPolicy {
  approval_required: ApprovalRequired;
  audit_category: AuditCategory;
  authoritative_output?: AuthoritativeOutput;
  category: Category;
  description: Description;
  deterministic?: Deterministic;
  input_schema_ref: InputSchemaRef;
  mutates: Mutates;
  output_schema_ref: OutputSchemaRef;
  project_scope: ProjectScope;
  required_capabilities: RequiredCapabilities;
  required_project_role: RequiredProjectRole;
  scientific_compute: ScientificCompute;
  tool_id: ToolId;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIUsageSummary".
 */
export interface AIUsageSummary {
  billable: Money;
  byok_entries: ByokEntries;
  cached_tokens: CachedTokens;
  input_tokens: InputTokens1;
  known_provider_cost: Money;
  legacy_entries?: LegacyEntries;
  managed_entries: ManagedEntries;
  output_tokens: OutputTokens1;
  pending_entries?: PendingEntries;
  provider_cost?: Money | null;
  provider_cost_complete?: ProviderCostComplete;
  reported_cached_tokens?: ReportedCachedTokens;
  reported_entries?: ReportedEntries;
  reported_input_tokens?: ReportedInputTokens;
  reported_output_tokens?: ReportedOutputTokens;
  unknown_entries?: UnknownEntries;
  usage_complete?: UsageComplete;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Money".
 */
export interface Money {
  currency: Currency1;
  minor_units: MinorUnits1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AllowancePeriodView".
 */
export interface AllowancePeriodView {
  ai_consumed: Money;
  ai_granted: Money;
  ai_overage_cap: Money;
  ai_overage_policy: AiOveragePolicy;
  ai_remaining: Money;
  ai_reserved: Money;
  compute_consumed: Money;
  compute_granted: Money;
  compute_overage_cap: Money;
  compute_overage_policy: ComputeOveragePolicy;
  compute_remaining: Money;
  compute_reserved: Money;
  id: Id6;
  period_end: PeriodEnd;
  period_start: PeriodStart;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ApprovalDecisionInput".
 */
export interface ApprovalDecisionInput {
  decision: Decision;
  decision_notes?: DecisionNotes;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ArtifactReference".
 */
export interface ArtifactReference {
  artifact_id: ArtifactId;
  project_id: ProjectId5;
  sha256: Sha256;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AuditEvent".
 */
export interface AuditEvent {
  actor_or_service_id: ActorOrServiceId;
  approval_reference?: ApprovalReference;
  artifacts?: Artifacts;
  error_category?: ErrorCategory;
  event_name: EventName;
  id: Id7;
  occurred_at: OccurredAt1;
  organization_id: OrganizationId;
  outcome: AuditOutcome;
  project_id?: ProjectId6;
  request_id: RequestId;
  safe_metadata?: SafeMetadata;
  schema_version?: SchemaVersion12;
  targets?: Targets;
  tool_name?: ToolName2;
  tool_version?: ToolVersion2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SafeAuditField".
 */
export interface SafeAuditField {
  key: Key;
  value: Value;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "EntityReference".
 */
export interface EntityReference {
  entity_id: EntityId1;
  entity_type: EntityType;
  project_id: ProjectId7;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AuthoritativeResultSubmission".
 */
export interface AuthoritativeResultSubmission {
  calculation_id: CalculationId;
  calculation_input_id: CalculationInputId;
  correlation_id: CorrelationId;
  idempotency_key: IdempotencyKey;
  payload: Payload1;
  producer_software: EngineReference;
  project_id: ProjectId11;
  provenance_record_id: ProvenanceRecordId;
  raw_artifacts: RawArtifacts;
  request_id: RequestId1;
  result_type: ResultType;
  schema_version?: SchemaVersion20;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ScientificResultPayload".
 */
export interface ScientificResultPayload {
  artifacts?: Artifacts1;
  payload_schema: PayloadSchema;
  payload_schema_version: PayloadSchemaVersion;
  quantities?: Quantities;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "NamedScientificQuantity".
 */
export interface NamedScientificQuantity {
  name: Name;
  quantity: ScientificQuantity;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ScientificQuantity".
 */
export interface ScientificQuantity {
  approximation?: ApproximationState;
  precision?: Precision | null;
  source_unit?: UnitReference | null;
  uncertainty?: Uncertainty;
  unit: UnitReference;
  value: Value1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Precision".
 */
export interface Precision {
  decimal_places?: DecimalPlaces;
  significant_figures?: SignificantFigures;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "UnitReference".
 */
export interface UnitReference {
  code: Code2;
  dimension: QuantityDimension;
  standard: UnitStandard;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "EnergyResult".
 */
export interface EnergyResult {
  basis?: Basis;
  converged?: Converged;
  method: Method;
  parser_version: ParserVersion;
  payload_schema?: PayloadSchema1;
  payload_schema_version?: PayloadSchemaVersion1;
  scf_iterations?: ScfIterations;
  task_type?: TaskType;
  total_energy: ScientificQuantity;
  validator_version: ValidatorVersion;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DispersionCorrectedEnergyResult".
 */
export interface DispersionCorrectedEnergyResult {
  angstrom_to_bohr?: AngstromToBohr;
  charge_model?: ChargeModel;
  coordinate_unit?: CoordinateUnit;
  corrected_total_energy: ScientificQuantity;
  d4_correction_energy: ScientificQuantity;
  damping?: Damping;
  functional: Functional;
  parameter_table_sha256: ParameterTableSha256;
  parameters: Dftd4Parameters;
  parser_version?: ParserVersion1;
  payload_schema?: PayloadSchema2;
  payload_schema_version?: PayloadSchemaVersion2;
  source: Dftd4SourceBinding;
  three_body_model?: ThreeBodyModel;
  uncorrected_dft_energy: ScientificQuantity;
  validator_version?: ValidatorVersion1;
  variant?: Variant;
  variant_sha256: VariantSha256;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Dftd4Parameters".
 */
export interface Dftd4Parameters {
  a1: A1;
  a2: A2;
  a2_unit?: A2Unit;
  alp: Alp;
  ga?: Ga;
  gc?: Gc;
  s6: S6;
  s8: S8;
  s9: S9;
  wf?: Wf;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Dftd4SourceBinding".
 */
export interface Dftd4SourceBinding {
  basis?: Basis1;
  calculation_id: CalculationId1;
  calculation_input_id: CalculationInputId1;
  canonical_artifact_id: CanonicalArtifactId;
  canonical_sha256: CanonicalSha256;
  charge?: Charge;
  engine_identity_sha256: EngineIdentitySha256;
  functional: Functional1;
  geometry_sha256: GeometrySha256;
  multiplicity?: Multiplicity;
  native_evidence_sha256: NativeEvidenceSha256;
  normalized_input_sha256: NormalizedInputSha256;
  project_id: ProjectId8;
  provenance_id: ProvenanceId;
  provenance_sha256: ProvenanceSha256;
  result_id: ResultId;
  result_payload_sha256: ResultPayloadSha256;
  source_energy_hartree: SourceEnergyHartree;
  source_verification_state: SourceVerificationState;
  specification_sha256: SpecificationSha256;
  structure_version_id: StructureVersionId;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "NativeDispersionCorrectedEnergyResult".
 */
export interface NativeDispersionCorrectedEnergyResult {
  charge_model?: ChargeModel1;
  coordinate_unit?: CoordinateUnit1;
  corrected_total_energy: ScientificQuantity;
  d4_correction_energy: ScientificQuantity;
  damping?: Damping1;
  functional: Functional2;
  native_angstrom_to_bohr?: NativeAngstromToBohr;
  native_conversion_definition?: NativeConversionDefinition;
  parameter_table_sha256: ParameterTableSha2561;
  parameters: Dftd4Parameters;
  parser_version?: ParserVersion2;
  payload_schema?: PayloadSchema3;
  payload_schema_version?: PayloadSchemaVersion3;
  source: Dftd4SourceBinding;
  three_body_model?: ThreeBodyModel1;
  uncorrected_dft_energy: ScientificQuantity;
  validator_version?: ValidatorVersion2;
  variant?: Variant1;
  variant_sha256: VariantSha2561;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "OptimizationResult".
 */
export interface OptimizationResult {
  basis: Basis2;
  converged?: Converged1;
  final_energy: ScientificQuantity;
  final_structure_hash: FinalStructureHash;
  final_structure_version_id: FinalStructureVersionId;
  method: Method1;
  optimization_iterations?: OptimizationIterations;
  parser_version: ParserVersion3;
  payload_schema?: PayloadSchema4;
  payload_schema_version?: PayloadSchemaVersion4;
  step_count: StepCount;
  task_type?: TaskType1;
  trajectory_artifact: ArtifactReference;
  trajectory_sha256: TrajectorySha256;
  validator_version: ValidatorVersion3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ConformerEnsembleResult".
 */
export interface ConformerEnsembleResult {
  artifacts: Artifacts2;
  manifest: ConformerEnsembleManifest;
  manifest_artifact: ArtifactReference;
  payload_schema?: PayloadSchema6;
  payload_schema_version?: PayloadSchemaVersion5;
  task_type?: TaskType2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ConformerEnsembleManifest".
 */
export interface ConformerEnsembleManifest {
  attempt_number: AttemptNumber;
  calculation_id: CalculationId2;
  calculation_input_id: CalculationInputId2;
  calculation_input_sha256: CalculationInputSha256;
  calculator?: Calculator;
  charge: Charge1;
  coordinate_unit?: CoordinateUnit2;
  effective_ewin_kcal_mol?: EffectiveEwinKcalMol;
  energy_unit?: EnergyUnit;
  engine?: Engine;
  engine_version?: EngineVersion;
  executable_sha256: ExecutableSha256;
  execution_id: ExecutionId;
  input_structure_sha256: InputStructureSha256;
  input_structure_version_id: InputStructureVersionId;
  intermediate_minima: IntermediateMinima;
  limitations: Limitations1;
  members: Members;
  method?: Method2;
  multiplicity?: Multiplicity1;
  native_artifacts: NativeArtifacts;
  native_duplicate_count: NativeDuplicateCount;
  native_optimized_count: NativeOptimizedCount;
  native_rotamer_count: NativeRotamerCount;
  payload_schema?: PayloadSchema5;
  project_id: ProjectId10;
  relative_energy_unit?: RelativeEnergyUnit;
  requested_ewin_kcal_mol?: RequestedEwinKcalMol;
  restart_count: RestartCount;
  schema_version?: SchemaVersion14;
  search_completed?: SearchCompleted;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ConformerIntermediateMinimum".
 */
export interface ConformerIntermediateMinimum {
  comparable_to_final: ComparableToFinal;
  energy_hartree: EnergyHartree;
  protocol: Protocol;
  stdout_line: StdoutLine;
}
/**
 * Native CREST member; gradient convergence does not verify a local minimum.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ConformerEnsembleMember".
 */
export interface ConformerEnsembleMember {
  application_rank: ApplicationRank;
  conformer: Conformer;
  geometry_convergence?: GeometryConvergence;
  minimum_status?: MinimumStatus;
  native_electronic_energy: ScientificQuantity1;
  native_rank: NativeRank;
  native_record_sha256: NativeRecordSha256;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Conformer".
 */
export interface Conformer {
  coordinates: CoordinateSet;
  created_at: CreatedAt7;
  generation_method: GenerationMethod;
  id: Id8;
  project_id: ProjectId9;
  rank?: Rank;
  relative_energy?: ScientificQuantity | null;
  schema_version?: SchemaVersion13;
  structure_version_id: StructureVersionId2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CoordinateSet".
 */
export interface CoordinateSet {
  atom_ordering?: AtomOrdering;
  atoms: Atoms;
  bonds?: Bonds;
  coordinate_system: CoordinateSystem;
  dimensionality?: Dimensionality;
  source: Source1;
  structure_version_id: StructureVersionId1;
  unit: CoordinateUnit3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Atom".
 */
export interface Atom {
  atomic_number: AtomicNumber;
  element: Element;
  formal_charge?: FormalCharge;
  index: Index;
  isotope?: Isotope;
  label?: Label1;
  occupancy?: Occupancy;
  x: X;
  y: Y;
  z: Z;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Bond".
 */
export interface Bond {
  atom_index_a: AtomIndexA;
  atom_index_b: AtomIndexB;
  order?: Order;
}
/**
 * Native electronic energy; energy ranking does not establish minimum status.
 */
export interface ScientificQuantity1 {
  approximation?: ApproximationState;
  precision?: Precision | null;
  source_unit?: UnitReference | null;
  uncertainty?: Uncertainty;
  unit: UnitReference;
  value: Value1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ConformerNativeArtifact".
 */
export interface ConformerNativeArtifact {
  artifact: ArtifactReference;
  name: Name1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "VibrationalAnalysis".
 */
export interface VibrationalAnalysis {
  adapter_version: AdapterVersion;
  atom_identities: AtomIdentities;
  basis: Basis3;
  calculation_id: CalculationId3;
  calculation_specification_hash: CalculationSpecificationHash;
  charge: Charge2;
  coordinate_unit: CoordinateUnit4;
  dipole_derivative_method?: DipoleDerivativeMethod;
  electric_field_step_au?: ElectricFieldStepAu;
  engine: Engine1;
  engine_version: EngineVersion1;
  equilibrium_coordinates_angstrom: EquilibriumCoordinatesAngstrom;
  equilibrium_coordinates_hash: EquilibriumCoordinatesHash;
  expected_vibrational_mode_count: ExpectedVibrationalModeCount;
  finite_difference_step_bohr?: FiniteDifferenceStepBohr;
  frequency_unit: FrequencyUnit;
  hessian_artifact: ArtifactReference;
  hessian_sha256: HessianSha256;
  hessian_type?: HessianType;
  hessian_unit: HessianUnit;
  input_structure_hash: InputStructureHash;
  input_structure_version_id: InputStructureVersionId1;
  intensity_unit?: IntensityUnit;
  method: Method3;
  mode_ordering: ModeOrdering;
  modes: Modes;
  multiplicity: Multiplicity2;
  parser_version: ParserVersion4;
  payload_schema: PayloadSchema7;
  payload_schema_version: PayloadSchemaVersion6;
  polarizability_antisymmetry_tolerance?: PolarizabilityAntisymmetryTolerance;
  polarizability_derivative_method?: PolarizabilityDerivativeMethod;
  polarizability_derivative_step_angstrom_amu_half?: PolarizabilityDerivativeStepAngstromAmuHalf;
  polarizability_method?: PolarizabilityMethod;
  polarizability_tensor_symmetrization?: PolarizabilityTensorSymmetrization;
  polarizability_unit?: PolarizabilityUnit;
  raman_activity_unit?: RamanActivityUnit;
  raman_artifact?: ArtifactReference | null;
  raman_method?: RamanMethod;
  raman_sha256?: RamanSha256;
  result_sha256: ResultSha256;
  schema_version: SchemaVersion15;
  task_type: TaskType3;
  vector_convention: VectorConvention;
  vector_unit: VectorUnit;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "VibrationalMode".
 */
export interface VibrationalMode {
  depolarization_ratio?: DepolarizationRatio;
  displacement_vectors: DisplacementVectors;
  frequency_cm1: FrequencyCm1;
  imaginary: Imaginary;
  index: Index1;
  ir_intensity?: ScientificQuantity | null;
  raman_activity?: ScientificQuantity | null;
  reduced_mass_amu?: ReducedMassAmu;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MolecularOrbitalAnalysis".
 */
export interface MolecularOrbitalAnalysis {
  adapter_version: AdapterVersion1;
  alpha_electron_count: AlphaElectronCount;
  basis: Basis4;
  basis_function_count: BasisFunctionCount;
  beta_electron_count: BetaElectronCount;
  calculation_id: CalculationId4;
  calculation_input_hash: CalculationInputHash;
  charge: Charge3;
  coefficient_artifact: ArtifactReference;
  coefficient_artifact_sha256: CoefficientArtifactSha256;
  coefficient_format: CoefficientFormat;
  converged?: Converged2;
  converted_energy_unit?: ConvertedEnergyUnit;
  electron_count: ElectronCount;
  energy_unit?: EnergyUnit1;
  engine: Engine2;
  engine_version: EngineVersion2;
  frontier_by_spin: FrontierBySpin;
  input_structure_hash: InputStructureHash1;
  input_structure_id: InputStructureId;
  input_structure_version_id: InputStructureVersionId2;
  method: Method4;
  molecular_orbital_count: MolecularOrbitalCount;
  multiplicity: Multiplicity3;
  orbital_gap_label?: OrbitalGapLabel;
  orbital_gap_note?: OrbitalGapNote;
  orbitals: Orbitals;
  payload_schema: PayloadSchema8;
  payload_schema_version: PayloadSchemaVersion7;
  producer: Producer;
  result_sha256: ResultSha2561;
  scf_iterations?: ScfIterations1;
  schema_version: SchemaVersion16;
  task_type: TaskType4;
  total_energy_hartree: TotalEnergyHartree;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "OrbitalFrontier".
 */
export interface OrbitalFrontier {
  gap_ev: GapEv;
  gap_hartree: GapHartree;
  homo_energy_ev: HomoEnergyEv;
  homo_energy_hartree: HomoEnergyHartree;
  homo_index: HomoIndex;
  lumo_energy_ev: LumoEnergyEv;
  lumo_energy_hartree: LumoEnergyHartree;
  lumo_index: LumoIndex;
  spin_channel: SpinChannel;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MolecularOrbital".
 */
export interface MolecularOrbital {
  energy_ev: EnergyEv;
  energy_hartree: EnergyHartree1;
  index: Index2;
  occupation: Occupation;
  spin_channel: SpinChannel1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "TddftResult".
 */
export interface TddftResult {
  adapter_version?: AdapterVersion2;
  amplitudes_artifact: ArtifactReference;
  amplitudes_artifact_sha256: AmplitudesArtifactSha256;
  amplitudes_format?: AmplitudesFormat;
  basis: Basis5;
  calculation_id: CalculationId5;
  calculation_input_hash: CalculationInputHash1;
  charge: Charge4;
  converged?: Converged3;
  converged_roots: ConvergedRoots;
  converted_energy_unit?: ConvertedEnergyUnit1;
  dominant_state_index: DominantStateIndex;
  energy_unit?: EnergyUnit2;
  engine?: Engine3;
  engine_version: EngineVersion3;
  excited_states: ExcitedStates;
  ground_state_energy_hartree: GroundStateEnergyHartree;
  homo_energy_hartree: HomoEnergyHartree1;
  homo_index: HomoIndex1;
  homo_lumo_gap_ev: HomoLumoGapEv;
  homo_lumo_gap_hartree: HomoLumoGapHartree;
  homo_lumo_gap_label?: HomoLumoGapLabel;
  homo_lumo_gap_note?: HomoLumoGapNote;
  input_structure_hash: InputStructureHash2;
  input_structure_id: InputStructureId1;
  input_structure_version_id: InputStructureVersionId3;
  lumo_energy_hartree: LumoEnergyHartree1;
  lumo_index: LumoIndex1;
  max_oscillator_strength: MaxOscillatorStrength;
  method: Method5;
  multiplicity: Multiplicity4;
  nocc: Nocc;
  nvir: Nvir;
  oscillator_strength_gauge?: OscillatorStrengthGauge1;
  payload_schema?: PayloadSchema9;
  payload_schema_version?: PayloadSchemaVersion8;
  producer?: Producer1;
  reference_method?: ReferenceMethod;
  requested_roots: RequestedRoots;
  response_method?: ResponseMethod;
  result_sha256: ResultSha2562;
  scf_iterations?: ScfIterations2;
  schema_version?: SchemaVersion17;
  spin_channel?: SpinChannel2;
  task_type?: TaskType5;
  wavelength_unit?: WavelengthUnit;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExcitedState".
 */
export interface ExcitedState {
  converged?: Converged4;
  dominant_transitions?: DominantTransitions;
  energy_ev: EnergyEv1;
  energy_hartree: EnergyHartree2;
  index: Index3;
  oscillator_strength: OscillatorStrength;
  oscillator_strength_gauge?: OscillatorStrengthGauge;
  state_label: StateLabel;
  transition_dipole: TransitionDipole;
  wavelength_nm: WavelengthNm;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DominantTransition".
 */
export interface DominantTransition {
  magnitude: Magnitude;
  occupied_label: OccupiedLabel;
  occupied_mo_index: OccupiedMoIndex;
  virtual_label: VirtualLabel;
  virtual_mo_index: VirtualMoIndex;
  x: X1;
  y: Y1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ThermochemistryResult".
 */
export interface ThermochemistryResult {
  adapter_version?: AdapterVersion3;
  basis: Basis6;
  calculation_id: CalculationId6;
  calculation_input_hash: CalculationInputHash2;
  components: ThermochemistryComponents;
  conditions: ThermochemistryConditions;
  constants: ThermochemistryConstants;
  corrections: ThermochemistryCorrections;
  diagnostics: ThermochemistryDiagnostics;
  energy_artifact: ArtifactReference;
  energy_artifact_sha256: EnergyArtifactSha256;
  energy_source_field?: EnergySourceField;
  energy_unit?: EnergyUnit3;
  engine?: Engine4;
  engine_version: EngineVersion4;
  entropy_unit?: EntropyUnit;
  frequencies_cm1: FrequenciesCm1;
  frequency_calculation_id: FrequencyCalculationId;
  frequency_result_id: FrequencyResultId;
  frequency_result_sha256: FrequencyResultSha256;
  geometry_hash: GeometryHash;
  input_structure_hash: InputStructureHash3;
  input_structure_id: InputStructureId2;
  input_structure_version_id: InputStructureVersionId4;
  method: Method6;
  molecule: ThermochemistryMolecule;
  optimization_calculation_id: OptimizationCalculationId;
  optimization_result_id: OptimizationResultId;
  optimization_result_sha256: OptimizationResultSha256;
  parser_version?: ParserVersion5;
  payload_schema?: PayloadSchema10;
  payload_schema_version?: PayloadSchemaVersion9;
  producer?: Producer2;
  result_sha256: ResultSha2563;
  schema_version?: SchemaVersion18;
  symmetry: ThermochemistrySymmetry;
  task_type?: TaskType6;
  thermo_api?: ThermoApi;
  thermodynamics: ThermochemistryThermodynamics;
  validator_version?: ValidatorVersion4;
  vibrational_modes: VibrationalModes;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ThermochemistryComponents".
 */
export interface ThermochemistryComponents {
  electronic: ThermochemistryContribution;
  rotational: ThermochemistryContribution;
  translational: ThermochemistryContribution;
  vibrational: ThermochemistryContribution;
}
/**
 * Per-term contribution as returned by PySCF (electronic internal energy term is E0).
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ThermochemistryContribution".
 */
export interface ThermochemistryContribution {
  cp_hartree_per_k: CpHartreePerK;
  cv_hartree_per_k: CvHartreePerK;
  energy_hartree: EnergyHartree3;
  enthalpy_hartree: EnthalpyHartree;
  entropy_hartree_per_k: EntropyHartreePerK;
  gibbs_hartree: GibbsHartree;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ThermochemistryConditions".
 */
export interface ThermochemistryConditions {
  assumptions: Assumptions1;
  gas_model?: GasModel;
  pressure_atm: PressureAtm;
  pressure_pa: PressurePa;
  reference_pressure_pa?: ReferencePressurePa;
  standard_state?: StandardState;
  temperature_k: TemperatureK;
  thermo_model?: ThermoModel;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ThermochemistryConstants".
 */
export interface ThermochemistryConstants {
  atomic_mass_kg: AtomicMassKg;
  avogadro_per_mol: AvogadroPerMol;
  bohr_m: BohrM;
  boltzmann_j_per_k: BoltzmannJPerK;
  hartree_j: HartreeJ;
  planck_j_s: PlanckJS;
  source: Source2;
  speed_of_light_m_per_s: SpeedOfLightMPerS;
  thermochemical_calorie_j?: ThermochemicalCalorieJ;
}
/**
 * Corrections relative to E0; each includes the zero-point energy (Gaussian convention).
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ThermochemistryCorrections".
 */
export interface ThermochemistryCorrections {
  includes_zpe?: IncludesZpe;
  reference?: Reference;
  thermal_correction_enthalpy_hartree: ThermalCorrectionEnthalpyHartree;
  thermal_correction_gibbs_hartree: ThermalCorrectionGibbsHartree;
  thermal_correction_internal_energy_hartree: ThermalCorrectionInternalEnergyHartree;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ThermochemistryDiagnostics".
 */
export interface ThermochemistryDiagnostics {
  imaginary_mode_count?: ImaginaryModeCount;
  imaginary_mode_policy?: ImaginaryModePolicy;
  low_frequency_entropy_hartree_per_k: LowFrequencyEntropyHartreePerK;
  low_frequency_minus_ts_hartree: LowFrequencyMinusTsHartree;
  low_frequency_mode_indices?: LowFrequencyModeIndices;
  low_frequency_policy?: LowFrequencyPolicy;
  low_frequency_threshold_cm1: LowFrequencyThresholdCm1;
  lowest_real_frequency_cm1: LowestRealFrequencyCm1;
  stationarity: ThermochemistryStationarity;
  warnings?: Warnings;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ThermochemistryStationarity".
 */
export interface ThermochemistryStationarity {
  criterion_rms_hartree_per_bohr: CriterionRmsHartreePerBohr;
  gradient_norm_hartree_per_bohr: GradientNormHartreePerBohr;
  gradient_rms_hartree_per_bohr: GradientRmsHartreePerBohr;
  passed?: Passed;
  source?: Source3;
  trajectory_step_index: TrajectoryStepIndex;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ThermochemistryMolecule".
 */
export interface ThermochemistryMolecule {
  atom_identities: AtomIdentities1;
  charge: Charge5;
  equilibrium_coordinates_angstrom: EquilibriumCoordinatesAngstrom1;
  mass_convention?: MassConvention;
  multiplicity: Multiplicity5;
  rotational_constants_ghz: RotationalConstantsGhz;
  rotor_type: RotorType;
  total_mass_amu: TotalMassAmu;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ThermochemistrySymmetry".
 */
export interface ThermochemistrySymmetry {
  algorithm: Algorithm;
  algorithm_version: AlgorithmVersion;
  method: Method7;
  override_reason?: OverrideReason;
  pyscf_cross_check_agrees?: PyscfCrossCheckAgrees;
  pyscf_point_group_sigma?: PyscfPointGroupSigma;
  rotational_symmetry_number: RotationalSymmetryNumber;
  source: Source4;
  stability_tolerances_angstrom?: StabilityTolerancesAngstrom;
  tolerance_angstrom: ToleranceAngstrom;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ThermochemistryThermodynamics".
 */
export interface ThermochemistryThermodynamics {
  cp_hartree_per_k: CpHartreePerK1;
  cv_hartree_per_k: CvHartreePerK1;
  e0_plus_zpe_hartree: E0PlusZpeHartree;
  electronic_energy_hartree: ElectronicEnergyHartree;
  enthalpy_hartree: EnthalpyHartree1;
  entropy_hartree_per_k: EntropyHartreePerK1;
  gibbs_free_energy_hartree: GibbsFreeEnergyHartree;
  internal_energy_hartree: InternalEnergyHartree;
  zpe_hartree: ZpeHartree;
}
/**
 * Exact harmonic-oscillator decomposition of the vibrational terms (derived, sum-checked).
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ThermochemistryModeContribution".
 */
export interface ThermochemistryModeContribution {
  cv_hartree_per_k: CvHartreePerK2;
  entropy_hartree_per_k: EntropyHartreePerK2;
  frequency_cm1: FrequencyCm11;
  index: Index4;
  low_frequency: LowFrequency;
  thermal_energy_hartree: ThermalEnergyHartree;
  vibrational_temperature_k: VibrationalTemperatureK;
  zpe_hartree: ZpeHartree1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "PeriodicEnergyResult".
 */
export interface PeriodicEnergyResult {
  absolute_magnetization?: AbsoluteMagnetization;
  band_gap?: ScientificQuantity | null;
  bands?: Bands;
  converged?: Converged5;
  cutoffs_ry?: CutoffsRy;
  dos?: Dos;
  engine?: Engine5;
  fermi_energy_ev?: FermiEnergyEv;
  irreducible_k_points?: IrreducibleKPoints;
  k_mesh?: KMesh;
  local_magnetic_moments?: LocalMagneticMoments;
  local_moment_kind?: LocalMomentKind;
  magnetic_order?: MagneticOrder;
  parser_version: ParserVersion6;
  payload_schema?: PayloadSchema11;
  payload_schema_version?: PayloadSchemaVersion10;
  pseudopotential_files?: PseudopotentialFiles;
  pseudopotential_libraries?: PseudopotentialLibraries;
  pseudopotential_library?: PseudopotentialLibrary;
  relaxation?: Relaxation;
  runtime_seconds?: RuntimeSeconds;
  scf_iterations?: ScfIterations3;
  task_type?: TaskType7;
  total_energy: ScientificQuantity;
  total_magnetization?: TotalMagnetization;
  u_effective_ev?: UEffectiveEv;
  used_default_u?: UsedDefaultU;
  validator_version: ValidatorVersion5;
}
export interface CutoffsRy {
  [k: string]: number;
}
export interface LocalMagneticMoments {
  [k: string]: number;
}
export interface PseudopotentialFiles {
  [k: string]: string;
}
export interface PseudopotentialLibraries {
  [k: string]: string;
}
export interface UEffectiveEv {
  [k: string]: number;
}
/**
 * Server-issued identity of the engine that actually executed an attempt.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "EngineReference".
 */
export interface EngineReference {
  adapter_version: AdapterVersion4;
  capabilities?: Capabilities;
  environment_artifact?: ArtifactReference | null;
  environment_digest?: EnvironmentDigest;
  execution_backend: ExecutionBackend;
  hardware_class?: HardwareClass;
  library_versions?: LibraryVersions;
  name: Name2;
  version: Version;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "NamespacedExtension".
 */
export interface NamespacedExtension {
  namespace: Namespace;
  schema_version: SchemaVersion19;
  values?: Values;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExtensionValue".
 */
export interface ExtensionValue {
  key: Key1;
  value: Value2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "BillingSnapshot".
 */
export interface BillingSnapshot {
  ai_usage: AIUsageSummary;
  allowance: AllowancePeriodView;
  billing_account_id: BillingAccountId;
  byok?: Byok;
  compute_usage: ComputeUsageSummary;
  currency: Currency2;
  current_period_end?: CurrentPeriodEnd;
  current_period_start?: CurrentPeriodStart;
  entitlements: EntitlementSnapshot;
  invoices?: Invoices;
  organization_id: OrganizationId1;
  reconciliation?: ReconciliationView | null;
  schema_version?: SchemaVersion21;
  status: Status8;
  subscription_plan?: SubscriptionPlan;
  subscription_status?: SubscriptionStatus;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComputeUsageSummary".
 */
export interface ComputeUsageSummary {
  actual: Money;
  billable: Money;
  entries: Entries;
  reserved: Money;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "EntitlementSnapshot".
 */
export interface EntitlementSnapshot {
  ai_overage_policy: AiOveragePolicy1;
  byok_ai: ByokAi;
  compute: Compute;
  compute_overage_policy: ComputeOveragePolicy1;
  investigations: Investigations;
  managed_ai: ManagedAi;
  max_concurrent_ai: MaxConcurrentAi;
  max_concurrent_compute: MaxConcurrentCompute;
  plan_key: PlanKey;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "InvoiceView".
 */
export interface InvoiceView {
  amount_paid: Money;
  hosted_invoice_url?: HostedInvoiceUrl;
  id: Id9;
  period_end: PeriodEnd1;
  period_start: PeriodStart1;
  provider: Provider7;
  provider_invoice_id: ProviderInvoiceId;
  status: Status6;
  total: Money;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ReconciliationView".
 */
export interface ReconciliationView {
  ai_usage: Money;
  compute_usage: Money;
  discrepancy: Money;
  id: Id10;
  invoice_total: Money;
  period_end: PeriodEnd2;
  period_start: PeriodStart2;
  status: Status7;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "BYOKCredentialInput".
 */
export interface BYOKCredentialInput {
  provider: Provider8;
  secret: Secret;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "BYOKRevocationInput".
 */
export interface BYOKRevocationInput {
  provider: Provider9;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculatedSourceListOutput".
 */
export interface CalculatedSourceListOutput {
  sources: Sources;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculatedSourceView".
 */
export interface CalculatedSourceView {
  basis: Basis7;
  calculation_id: CalculationId7;
  engine: Engine6;
  has_intensities: HasIntensities;
  id: Id11;
  item_count: ItemCount;
  kind: CalculatedSourceKind;
  label: Label2;
  method: Method8;
  phase: Phase;
  structure_id: StructureId;
  structure_name: StructureName;
  structure_version_id: StructureVersionId3;
  technique: SpectrumTechnique;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Calculation".
 */
export interface Calculation {
  created_at: CreatedAt8;
  created_by: CreatedBy;
  id: Id12;
  input_id: InputId;
  project_id: ProjectId12;
  schema_version?: SchemaVersion22;
  state: CalculationLifecycle;
  updated_at: UpdatedAt3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculationAttempt".
 */
export interface CalculationAttempt {
  attempt_number: AttemptNumber1;
  calculation_id: CalculationId8;
  diagnostic?: Diagnostic;
  engine_identity?: EngineReference | null;
  failure_code?: CalculationFailureCode | null;
  finished_at?: FinishedAt1;
  id: Id13;
  project_id: ProjectId13;
  raw_artifacts?: RawArtifacts1;
  schema_version?: SchemaVersion23;
  started_at?: StartedAt;
  state: CalculationLifecycle;
  worker_id: WorkerId;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculationComparisonOutput".
 */
export interface CalculationComparisonOutput {
  agreement_is_not_verification?: AgreementIsNotVerification;
  conversion_factors: ConversionFactors;
  delta_convention?: DeltaConvention;
  notice: Notice;
  overall: Overall;
  pairs: Pairs;
  project_id: ProjectId14;
  reference_result_id: ReferenceResultId1;
  results: Results;
  schema_id?: SchemaId;
}
export interface ConversionFactors {
  [k: string]: number;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculationPairComparison".
 */
export interface CalculationPairComparison {
  blockers: Blockers;
  deltas: Deltas;
  evidence_standing: EvidenceStanding;
  geometry: GeometryRelation;
  label: Label4;
  limitations: Limitations2;
  other_result_id: OtherResultId;
  reference_result_id: ReferenceResultId;
  rules: Rules;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComparisonDelta".
 */
export interface ComparisonDelta {
  assumptions?: Assumptions2;
  delta?: Delta;
  delta_kcal_per_mol?: DeltaKcalPerMol;
  delta_kj_per_mol?: DeltaKjPerMol;
  label: Label3;
  other_value: OtherValue;
  quantity_kind: QuantityKind;
  reference_value: ReferenceValue;
  unit: Unit;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "GeometryRelation".
 */
export interface GeometryRelation {
  note?: Note;
  relation: Relation;
  rmsd_angstrom?: RmsdAngstrom;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComparisonRuleOutcome".
 */
export interface ComparisonRuleOutcome {
  detail: Detail;
  outcome: Outcome1;
  rule_id: RuleId;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ResultSummary".
 */
export interface ResultSummary {
  basis?: Basis8;
  calculation_id: CalculationId9;
  charge?: Charge6;
  conditions?: StoredConditions | null;
  created_at: CreatedAt9;
  dispersion?: Dispersion;
  effective_state?: EffectiveResultState | null;
  engine?: Engine7;
  engine_version?: EngineVersion5;
  evidence_use: EvidenceUse;
  method?: Method9;
  multiplicity?: Multiplicity6;
  quantities?: Quantities1;
  result_id: ResultId1;
  result_type: ResultType1;
  solvation?: Solvation;
  structure: StructureIdentity;
  task: Task;
}
/**
 * Thermochemical conditions exactly as stored in the result payload (never defaulted or computed).
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StoredConditions".
 */
export interface StoredConditions {
  pressure_pa: PressurePa1;
  temperature_k: TemperatureK1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "EffectiveResultState".
 */
export interface EffectiveResultState {
  authority: Authority;
  eligible_for_derivation: EligibleForDerivation;
  inactive_result_ids?: InactiveResultIds;
  reason?: Reason1;
  source_lineage_validity: SourceLineageValidity;
  stored_authority: StoredAuthority;
  stored_validation_state: StoredValidationState;
  stored_verification_state: StoredVerificationState;
  validation_state: ValidationState;
  verification_state: VerificationState1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SummaryQuantity".
 */
export interface SummaryQuantity {
  key: Key2;
  kind: Kind;
  label: Label5;
  unit: Unit1;
  value: Value3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureIdentity".
 */
export interface StructureIdentity {
  atom_count?: AtomCount;
  element_sequence?: ElementSequence;
  formula_hill?: FormulaHill;
  geometry_role?: GeometryRole;
  structure_version_id?: StructureVersionId4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculationDetail".
 */
export interface CalculationDetail {
  attempt?: CalculationAttempt | null;
  calculation: Calculation;
  calculation_input_hash: CalculationInputHash3;
  compute_execution?: ComputeExecutionView | null;
  compute_job?: ComputeJobView | null;
  optimization_trajectory?: OptimizationTrajectory | null;
  result?: CalculationResult | null;
  specification: Specification;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComputeExecutionView".
 */
export interface ComputeExecutionView {
  calculation_attempt_id?: CalculationAttemptId;
  calculation_id: CalculationId10;
  diagnostic?: Diagnostic1;
  failure_code?: ComputeFailureCode | null;
  finished_at?: FinishedAt2;
  hardware_class?: HardwareClass1;
  heartbeat_at?: HeartbeatAt;
  id: Id14;
  job_id: JobId;
  lease_owner?: LeaseOwner;
  metering?: ProviderMeteringView | null;
  project_id: ProjectId15;
  provider: Provider10;
  started_at?: StartedAt1;
  state: ComputeExecutionState;
  worker_id?: WorkerId1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProviderMeteringView".
 */
export interface ProviderMeteringView {
  cpu_ms?: CpuMs;
  gpu_ms?: GpuMs;
  provider_cost?: MoneyAmount | null;
  provider_cost_status?: ProviderCostStatus;
  runtime_ms?: RuntimeMs;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComputeJobView".
 */
export interface ComputeJobView {
  attempt_count: AttemptCount;
  calculation_id: CalculationId11;
  calculation_input_id: CalculationInputId3;
  created_at: CreatedAt10;
  estimate?: ComputeEstimate | null;
  id: Id15;
  latest_execution?: ComputeExecutionView | null;
  priority: Priority;
  project_id: ProjectId16;
  provider: Provider11;
  requirement: ComputeRequirement;
  requirement_hash: RequirementHash1;
  reservation?: ComputeReservationView | null;
  specification_summary?: JobSpecificationSummary | null;
  state: ComputeJobState;
  structure_summary?: JobStructureSummary | null;
  submitted_by: SubmittedBy;
  updated_at: UpdatedAt4;
  worker_status?: WorkerStatus;
  workload: WorkloadReference;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComputeRequirement".
 */
export interface ComputeRequirement {
  accelerator_count?: AcceleratorCount;
  accelerator_kind?: AcceleratorKind;
  cpu_count: CpuCount;
  isolation_class: IsolationClass;
  memory_bytes: MemoryBytes;
  minimum_gpu_vram_bytes?: MinimumGpuVramBytes;
  network?: Network;
  priority?: Priority1;
  reproducibility_class: ReproducibilityClass;
  runtime_limit_seconds: RuntimeLimitSeconds;
  temporary_storage_bytes?: TemporaryStorageBytes;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComputeReservationView".
 */
export interface ComputeReservationView {
  actual_cost?: MoneyAmount | null;
  authorized_max: MoneyAmount;
  created_at: CreatedAt11;
  estimate_id: EstimateId;
  id: Id16;
  project_id: ProjectId17;
  reconciled_at?: ReconciledAt;
  state: State;
}
/**
 * What the job computes, read from the immutable calculation input (no new claim).
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "JobSpecificationSummary".
 */
export interface JobSpecificationSummary {
  basis?: Basis9;
  charge?: Charge7;
  method?: Method10;
  multiplicity?: Multiplicity7;
  task_type?: TaskType8;
}
/**
 * Which structure version the job computes, read from the immutable calculation input.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "JobStructureSummary".
 */
export interface JobStructureSummary {
  atom_count?: AtomCount1;
  formula_hill?: FormulaHill1;
  structure_id?: StructureId1;
  structure_name?: StructureName1;
  structure_revision?: StructureRevision;
  structure_version_id?: StructureVersionId5;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "WorkloadReference".
 */
export interface WorkloadReference {
  workload_type: WorkloadType;
  workload_version: WorkloadVersion;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "OptimizationTrajectory".
 */
export interface OptimizationTrajectory {
  artifact_sha256?: ArtifactSha256;
  atom_identities: AtomIdentities2;
  calculation_id: CalculationId12;
  engine?: EngineReference | null;
  final_structure_version_id?: FinalStructureVersionId1;
  id: Id17;
  input_hash: InputHash;
  input_structure_version_id: InputStructureVersionId5;
  state: State1;
  steps: Steps1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "OptimizationStep".
 */
export interface OptimizationStep {
  converged?: Converged6;
  coordinates_angstrom: CoordinatesAngstrom;
  energy_hartree: EnergyHartree4;
  engine_cycle?: EngineCycle;
  evaluation_kind?: EvaluationKind;
  gradient_norm_hartree_per_bohr: GradientNormHartreePerBohr1;
  gradient_rms_hartree_per_bohr?: GradientRmsHartreePerBohr1;
  index: Index5;
  source_file?: SourceFile;
  source_frame_index?: SourceFrameIndex;
  source_sha256?: SourceSha256;
  timestamp?: Timestamp;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculationResult".
 */
export interface CalculationResult {
  authority?: ResultAuthority;
  calculation_id: CalculationId13;
  calculation_input_id: CalculationInputId4;
  created_at: CreatedAt12;
  effective_state?: EffectiveResultState | null;
  id: Id18;
  payload: Payload2;
  producer_attestation_id: ProducerAttestationId;
  producer_software: EngineReference;
  project_id: ProjectId18;
  provenance_record_id: ProvenanceRecordId1;
  raw_artifacts: RawArtifacts2;
  result_type: ResultType2;
  schema_version?: SchemaVersion24;
  source_class?: SourceClass1;
  trusted_producer_id: TrustedProducerId;
  trusted_producer_type: TrustedProducerType;
  validation_state: ResultValidationState;
  verification_state: VerificationState2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculationSpecification".
 */
export interface CalculationSpecification {
  basis?: BasisSetReference | null;
  charge: Charge8;
  conformer_search?: ConformerSearchOptions | null;
  constraints?: Constraints;
  dispersion?: ScientificMethodReference | null;
  engine_extensions?: EngineExtensions;
  engine_preference: EnginePreference;
  hessian?: HessianOptions | null;
  method: ScientificMethodReference;
  multiplicity: Multiplicity8;
  optimization?: OptimizationOptions | null;
  property_requests?: PropertyRequests;
  raman?: RamanOptions | null;
  scf?: ScfOptions | null;
  schema_version?: SchemaVersion25;
  solvation?: SolvationModel | null;
  task_type: CalculationTaskType;
  tddft?: TddftOptions | null;
  thermochemistry?: ThermochemistryOptions | null;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "BasisSetReference".
 */
export interface BasisSetReference {
  display_name: DisplayName1;
  identifier: Identifier;
  registry: Registry;
  registry_version?: RegistryVersion;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ConformerSearchOptions".
 */
export interface ConformerSearchOptions {
  energy_threshold_kcal_mol?: EnergyThresholdKcalMol;
  energy_window_kcal_mol?: EnergyWindowKcalMol;
  optimization_level?: OptimizationLevel;
  rmsd_threshold_angstrom?: RmsdThresholdAngstrom;
  rotational_constant_threshold?: RotationalConstantThreshold;
  threads?: Threads;
  timeout_seconds?: TimeoutSeconds;
  workflow?: Workflow;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculationConstraint".
 */
export interface CalculationConstraint {
  atom_indices: AtomIndices;
  kind: Kind1;
  target?: ScientificQuantity | null;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ScientificMethodReference".
 */
export interface ScientificMethodReference {
  display_name: DisplayName2;
  identifier: Identifier1;
  registry: Registry1;
  registry_version?: RegistryVersion1;
}
/**
 * Public scientific preference. It contains no execution attestation or identity.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "EnginePreference".
 */
export interface EnginePreference {
  allowed_version?: AllowedVersion;
  engine: Engine8;
  execution_preference?: ExecutionPreference;
  requested_capability?: RequestedCapability;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "HessianOptions".
 */
export interface HessianOptions {
  coordinate_unit: CoordinateUnit5;
  exclude_translation_rotation: ExcludeTranslationRotation;
  frequency_unit: FrequencyUnit1;
  hessian_unit: HessianUnit1;
  strategy: Strategy;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "OptimizationOptions".
 */
export interface OptimizationOptions {
  convergence_dmax?: ConvergenceDmax;
  convergence_drms?: ConvergenceDrms;
  convergence_energy?: ConvergenceEnergy;
  convergence_gmax?: ConvergenceGmax;
  convergence_grms?: ConvergenceGrms;
  coordinate_unit?: CoordinateUnit6;
  displacement_unit?: DisplacementUnit;
  energy_unit?: EnergyUnit4;
  gradient_unit?: GradientUnit;
  max_steps?: MaxSteps1;
  optimizer?: Optimizer;
  xtb_level?: XtbLevel;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "RamanOptions".
 */
export interface RamanOptions {
  antisymmetry_tolerance?: AntisymmetryTolerance;
  electric_field_step_au?: ElectricFieldStepAu1;
  method?: Method11;
  polarizability_derivative_step_angstrom_amu_half?: PolarizabilityDerivativeStepAngstromAmuHalf1;
  polarizability_method?: PolarizabilityMethod1;
  symmetrize_polarizability?: SymmetrizePolarizability;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ScfOptions".
 */
export interface ScfOptions {
  convergence_threshold?: ConvergenceThreshold;
  max_iterations?: MaxIterations;
  reference?: Reference1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SolvationModel".
 */
export interface SolvationModel {
  model: Model3;
  solvent: Solvent;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "TddftOptions".
 */
export interface TddftOptions {
  conv_tol?: ConvTol;
  gauge?: Gauge;
  nstates?: Nstates;
  spin?: Spin;
}
/**
 * Ideal-gas rigid-rotor harmonic-oscillator thermochemistry from a validated frequency result.
 *
 * No SCF, optimization or Hessian is ever (re)run for this task: it consumes persisted
 * geometry, harmonic frequencies and electronic energy.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ThermochemistryOptions".
 */
export interface ThermochemistryOptions {
  imaginary_mode_policy?: ImaginaryModePolicy1;
  low_frequency_warning_cm1?: LowFrequencyWarningCm1;
  pressure_pa?: PressurePa2;
  source_frequency_result_id: SourceFrequencyResultId;
  symmetry_number_override?: SymmetryNumberOverride;
  symmetry_override_reason?: SymmetryOverrideReason;
  temperature_k?: TemperatureK2;
  thermo_model?: ThermoModel1;
}
/**
 * Separate additive subtype: never used to normalize an ordinary historical input.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DispersionCorrectionSpecification".
 */
export interface DispersionCorrectionSpecification {
  basis?: BasisSetReference | null;
  charge: Charge9;
  conformer_search?: ConformerSearchOptions | null;
  constraints?: Constraints1;
  correction_schema?: CorrectionSchema;
  dispersion?: ScientificMethodReference | null;
  engine_extensions?: EngineExtensions1;
  engine_preference: EnginePreference;
  hessian?: HessianOptions | null;
  method: ScientificMethodReference;
  multiplicity: Multiplicity9;
  optimization?: OptimizationOptions | null;
  parameter_table_sha256: ParameterTableSha2562;
  parameters: Dftd4Parameters;
  property_requests?: PropertyRequests1;
  raman?: RamanOptions | null;
  scf?: ScfOptions | null;
  schema_version?: SchemaVersion26;
  solvation?: SolvationModel | null;
  source: Dftd4SourceBinding;
  task_type: CalculationTaskType;
  tddft?: TddftOptions | null;
  thermochemistry?: ThermochemistryOptions | null;
  variant?: Variant2;
  variant_sha256: VariantSha2562;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculationExportCatalog".
 */
export interface CalculationExportCatalog {
  calculation_id: CalculationId14;
  evidence_use: EvidenceUse1;
  formats: Formats;
  project_id: ProjectId19;
  result_id?: ResultId2;
  schema_id?: SchemaId1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExportFormatOption".
 */
export interface ExportFormatOption {
  available: Available2;
  file_extension: FileExtension;
  format: Format;
  label: Label6;
  media_type: MediaType;
  unsupported_reason?: UnsupportedReason;
  variants?: Variants;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExportVariant".
 */
export interface ExportVariant {
  detail?: Detail1;
  key: Key3;
  label: Label7;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculationGetInput".
 */
export interface CalculationGetInput {
  calculation: EntityReference;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculationInput".
 */
export interface CalculationInput {
  calculation_id: CalculationId15;
  conformer?: EntityReference | null;
  created_at: CreatedAt13;
  id: Id19;
  normalized_input_artifact: ArtifactReference;
  project_id: ProjectId20;
  schema_version?: SchemaVersion27;
  specification: CalculationSpecification;
  structure_version: EntityReference;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculationSubmitInput".
 */
export interface CalculationSubmitInput {
  idempotency_key: IdempotencyKey1;
  provider_preference?: ProviderPreference;
  specification: CalculationSpecification;
  structure_version: EntityReference;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateCellParameters".
 */
export interface CandidateCellParameters {
  a: A;
  alpha: Alpha;
  b: B;
  beta: Beta;
  c: C;
  gamma: Gamma;
  unit?: CoordinateUnit7;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateCoordinatePasteInput".
 */
export interface CandidateCoordinatePasteInput {
  cell?: CandidateCellParameters | null;
  cell_source?: CellSource;
  cell_source_evidence_id?: CellSourceEvidenceId;
  coordinate_system: CoordinateSystem;
  coordinate_text: CoordinateText;
  name: Name3;
  parent_representation_id?: ParentRepresentationId;
  unit: CoordinateUnit3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateCoordinateRepresentation".
 */
export interface CandidateCoordinateRepresentation {
  coordinates: CandidateCoordinates;
  kind: StructureKind;
  multiplicity?: Multiplicity10;
  name: Name4;
  overall_charge?: OverallCharge;
  periodic_cell?: PeriodicCell | null;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateCoordinates".
 */
export interface CandidateCoordinates {
  atom_ordering?: AtomOrdering1;
  atoms: Atoms1;
  bonds?: Bonds1;
  coordinate_system: CoordinateSystem;
  dimensionality?: Dimensionality1;
  unit: CoordinateUnit3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "PeriodicCell".
 */
export interface PeriodicCell {
  a: A3;
  alpha: Alpha1;
  b: B1;
  beta: Beta1;
  c: C1;
  gamma: Gamma1;
  lattice_vectors: LatticeVectors;
  periodic_dimensions?: PeriodicDimensions;
  unit?: CoordinateUnit8;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateRepresentationDetail".
 */
export interface CandidateRepresentationDetail {
  approximation: Approximation;
  candidate_id: CandidateId1;
  cell_provenance?: CellProvenance;
  content_sha256?: ContentSha256;
  coordinate_provenance?: CoordinateProvenance;
  coordinate_representation?: CandidateCoordinateRepresentation | null;
  coordinates_available: CoordinatesAvailable;
  created_at: CreatedAt14;
  created_by: CreatedBy1;
  differences_from_parent?: DifferencesFromParent;
  generation_parameters?: GenerationParameters;
  id: Id20;
  method: Method12;
  method_version: MethodVersion;
  mol_block?: MolBlock;
  provenance_class: ProvenanceClass;
  recognition_proposal?: RecognitionProposal;
  representation_origin: CandidateRepresentationOrigin;
  representation_type: CandidateRepresentationType;
  review_checklist?: CandidateRepresentationReviewChecklist | null;
  review_state?: CandidateRepresentationReviewState;
  revision: Revision;
  smiles?: Smiles;
  source_representation_id?: SourceRepresentationId;
  validation_diagnostics?: ValidationDiagnostics;
  validation_state: CandidateRepresentationValidationState;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MolecularGraphDifference".
 */
export interface MolecularGraphDifference {
  category: Category1;
  corrected_value?: CorrectedValue;
  description: Description1;
  original_value?: OriginalValue;
}
export interface GenerationParameters {
  [k: string]: string | number | boolean;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateRepresentationReviewChecklist".
 */
export interface CandidateRepresentationReviewChecklist {
  cell_checked_if_used?: CellCheckedIfUsed;
  charges_reviewed?: ChargesReviewed;
  coordinate_source_declared?: CoordinateSourceDeclared;
  differences_acknowledged?: DifferencesAcknowledged;
  inspected_source?: InspectedSource;
  stereochemistry_reviewed?: StereochemistryReviewed;
  understands_missing_paper_coordinates?: UnderstandsMissingPaperCoordinates;
  units_checked?: UnitsChecked;
  validation_warnings_reviewed?: ValidationWarningsReviewed;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateRepresentationCreateInput".
 */
export interface CandidateRepresentationCreateInput {
  cell_source_evidence_id?: CellSourceEvidenceId1;
  coordinate_origin?: CandidateCoordinateOrigin | null;
  coordinate_representation?: CandidateCoordinateRepresentation | null;
  mol_block?: MolBlock1;
  parent_representation_id?: ParentRepresentationId1;
  representation_type: RepresentationType;
  smiles?: Smiles1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateRepresentationCreateOutput".
 */
export interface CandidateRepresentationCreateOutput {
  generated_representation?: CandidateRepresentationDetail | null;
  representation: CandidateRepresentationDetail;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateRepresentationListInput".
 */
export interface CandidateRepresentationListInput {
  candidate_id: CandidateId2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateRepresentationListOutput".
 */
export interface CandidateRepresentationListOutput {
  candidate_id: CandidateId3;
  representations?: Representations;
  schema_version?: SchemaVersion28;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateRepresentationView".
 */
export interface CandidateRepresentationView {
  approximation: Approximation1;
  cell_provenance?: CellProvenance1;
  content_sha256?: ContentSha2561;
  coordinate_provenance?: CoordinateProvenance1;
  coordinates_available: CoordinatesAvailable1;
  created_at: CreatedAt15;
  created_by: CreatedBy2;
  generation_parameters?: GenerationParameters1;
  id: Id21;
  method: Method13;
  method_version: MethodVersion1;
  provenance_class: ProvenanceClass;
  representation_origin: CandidateRepresentationOrigin;
  representation_type: CandidateRepresentationType;
  review_checklist?: CandidateRepresentationReviewChecklist | null;
  review_state?: CandidateRepresentationReviewState1;
  revision: Revision1;
  source_representation_id?: SourceRepresentationId1;
  validation_diagnostics?: ValidationDiagnostics1;
  validation_state: CandidateRepresentationValidationState;
}
export interface GenerationParameters1 {
  [k: string]: string | number | boolean;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateRepresentationRejectInput".
 */
export interface CandidateRepresentationRejectInput {
  reason?: Reason2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateRepresentationReviewInput".
 */
export interface CandidateRepresentationReviewInput {
  checklist?: CandidateRepresentationReviewChecklist | null;
  notes?: Notes;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CandidateRepresentationReviewOutput".
 */
export interface CandidateRepresentationReviewOutput {
  representation: CandidateRepresentationDetail;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CheckoutSessionView".
 */
export interface CheckoutSessionView {
  checkout_url: CheckoutUrl;
  plan_key: PlanKey1;
  provider: Provider12;
  session_reference: SessionReference;
  test_mode: TestMode;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Citation".
 */
export interface Citation {
  created_at: CreatedAt16;
  id: Id22;
  knowledge_source_id: KnowledgeSourceId;
  locator: CitationLocation;
  project_id: ProjectId21;
  schema_version?: SchemaVersion29;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CitationLocation".
 */
export interface CitationLocation {
  excerpt_hash?: ExcerptHash;
  figure?: Figure;
  page?: Page;
  section?: Section;
  table?: Table;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComparisonCandidateListOutput".
 */
export interface ComparisonCandidateListOutput {
  candidates: Candidates;
  project_id: ProjectId22;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComparisonCandidate".
 */
export interface ComparisonCandidate {
  summary: ResultSummary;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComputeJobListOutput".
 */
export interface ComputeJobListOutput {
  jobs: Jobs;
  next_offset?: NextOffset;
  total?: Total;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ConformerGenerationInput".
 */
export interface ConformerGenerationInput {
  multiplicity?: Multiplicity11;
  name?: Name5;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CreateAssessmentInput".
 */
export interface CreateAssessmentInput {
  hypothesis_id: HypothesisId;
  observation_ids: ObservationIds;
  outcome: Outcome2;
  rationale: Rationale;
  schema_version?: SchemaVersion30;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CreateCheckoutInput".
 */
export interface CreateCheckoutInput {
  plan_key: PlanKey2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CreateConversationInput".
 */
export interface CreateConversationInput {
  title?: Title1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CreateHypothesisInput".
 */
export interface CreateHypothesisInput {
  schema_version?: SchemaVersion31;
  source_class?: SourceClass2;
  statement: Statement;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CreateInvestigationInput".
 */
export interface CreateInvestigationInput {
  objective: Objective;
  policy?: InvestigationPolicy;
  schema_version?: SchemaVersion32;
  title: Title2;
}
export interface InvestigationPolicy {
  allowed_tool_classes?: AllowedToolClasses;
  approval_required_for_expensive?: ApprovalRequiredForExpensive;
  max_ai_calls?: MaxAiCalls;
  max_ai_input_tokens?: MaxAiInputTokens;
  max_ai_output_tokens?: MaxAiOutputTokens;
  max_calculations?: MaxCalculations;
  max_compute_minor_units?: MaxComputeMinorUnits;
  max_elapsed_seconds?: MaxElapsedSeconds;
  max_steps?: MaxSteps2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CreateObservationInput".
 */
export interface CreateObservationInput {
  citations?: Citations1;
  schema_version?: SchemaVersion33;
  source_class: SourceClass3;
  source_entity_id: SourceEntityId;
  source_entity_type: SourceEntityType;
  step_id?: StepId1;
  summary: Summary3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CreatePlanInput".
 */
export interface CreatePlanInput {
  schema_version?: SchemaVersion34;
  steps: Steps2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CreatePlanStepInput".
 */
export interface CreatePlanStepInput {
  action: Action;
  approval_class?: ApprovalClass;
  dependencies?: Dependencies;
  estimated_cost?: EstimatedCost;
  intent: Intent;
  schema_version?: SchemaVersion35;
  tool_arguments?: ToolArguments;
}
export interface EstimatedCost {
  [k: string]: unknown;
}
export interface ToolArguments {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Dftd4Capability".
 */
export interface Dftd4Capability {
  available: Available3;
  diagnostic?: Diagnostic2;
  engine?: Engine9;
  variant?: Variant3;
  version?: Version1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Dftd4RetryInput".
 */
export interface Dftd4RetryInput {
  failed_attempt_id: FailedAttemptId;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Dftd4SubmitInput".
 */
export interface Dftd4SubmitInput {
  idempotency_key: IdempotencyKey2;
  source_result_id: SourceResultId;
  variant?: Variant4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DigitizedDatasetInput".
 */
export interface DigitizedDatasetInput {
  calibration: DigitizerCalibration;
  experiment_name: ExperimentName;
  modality: ExperimentModality;
  points: Points;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DigitizerCalibration".
 */
export interface DigitizerCalibration {
  figure_region: SourceAnchor;
  page: Page1;
  plot_bounds: PlotBounds;
  x_label: XLabel;
  x_pixel_a: DigitizerPoint;
  x_pixel_b: DigitizerPoint;
  x_scale?: XScale;
  x_unit: XUnit;
  x_value_a: XValueA;
  x_value_b: XValueB;
  y_label: YLabel;
  y_pixel_a: DigitizerPoint;
  y_pixel_b: DigitizerPoint;
  y_scale?: YScale;
  y_unit: YUnit;
  y_value_a: YValueA;
  y_value_b: YValueB;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SourceAnchor".
 */
export interface SourceAnchor {
  caption?: Caption;
  document_id: DocumentId1;
  figure_number?: FigureNumber;
  height?: Height;
  page_number: PageNumber2;
  snippet?: Snippet;
  source_type: DocumentSourceType;
  table_number?: TableNumber;
  width?: Width;
  x?: X2;
  y?: Y2;
}
export interface PlotBounds {
  [k: string]: number;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DigitizerPoint".
 */
export interface DigitizerPoint {
  x: X3;
  y: Y3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DocumentFiguresExtractOutput".
 */
export interface DocumentFiguresExtractOutput {
  candidates?: Candidates1;
  document_id: DocumentId2;
  schema_version?: SchemaVersion37;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureCandidate".
 */
export interface StructureCandidate {
  approximation: Approximation2;
  candidate_state: StructureCandidateState;
  coordinates_available: CoordinatesAvailable2;
  created_at: CreatedAt17;
  created_by: CreatedBy3;
  id: Id23;
  method: Method14;
  method_version: MethodVersion2;
  project_id: ProjectId23;
  promoted_structure_version_id?: PromotedStructureVersionId;
  provenance_class: ProvenanceClass;
  representation_types?: RepresentationTypes;
  representations?: Representations1;
  reviewed_at?: ReviewedAt;
  reviewed_by?: ReviewedBy;
  schema_version?: SchemaVersion36;
  source_anchor?: SourceAnchor | null;
  source_anchor_id?: SourceAnchorId2;
  source_document_id: SourceDocumentId1;
  source_evidence_id: SourceEvidenceId;
  source_page?: SourcePage;
  source_type: StructureCandidateSourceType;
}
/**
 * One DRAW request: the researcher's words plus the current drawing as a molfile.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DrawInput".
 */
export interface DrawInput {
  content: Content1;
  history?: History;
  molfile?: Molfile;
  previous_molfile?: PreviousMolfile;
  schema_version?: SchemaVersion38;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DrawHistoryTurn".
 */
export interface DrawHistoryTurn {
  content: Content2;
  role: Role1;
}
/**
 * Validated result of a DRAW request. Schematic only: never a scientific value.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DrawResponse".
 */
export interface DrawResponse {
  clarify?: DrawClarify | null;
  error?: Error;
  error_code?: ErrorCode3;
  final?: DrawFinal | null;
  info?: Info;
  input_tokens?: InputTokens2;
  label?: Label9;
  model?: Model4;
  output_tokens?: OutputTokens2;
  proposals?: Proposals;
  reference_check?: DrawReferenceCheck | null;
  repaired?: Repaired;
  reply: Reply;
  run_id?: RunId3;
  schema_version?: SchemaVersion39;
  status: Status9;
  steps?: Steps3;
  warnings?: Warnings1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DrawClarify".
 */
export interface DrawClarify {
  options: Options;
  question: Question;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DrawClarifyOption".
 */
export interface DrawClarifyOption {
  label: Label8;
  message: Message1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DrawFinal".
 */
export interface DrawFinal {
  atom_count: AtomCount2;
  formula: Formula;
  molfile: Molfile1;
  smiles: Smiles2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DrawProposal".
 */
export interface DrawProposal {
  label: Label10;
  note: Note1;
  smiles: Smiles3;
}
/**
 * The drawing matched the built-in table of common molecules (partial safeguard).
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DrawReferenceCheck".
 */
export interface DrawReferenceCheck {
  formula: Formula1;
  name: Name6;
  note: Note2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DrawStepView".
 */
export interface DrawStepView {
  atom_count?: AtomCount3;
  description?: Description2;
  error?: Error1;
  formula?: Formula2;
  index: Index6;
  molfile?: Molfile2;
  new_atom_numbers?: NewAtomNumbers;
  ok: Ok;
  op: Op;
  smiles?: Smiles4;
  suggestion?: Suggestion;
}
export interface Op {
  [k: string]: string | number | boolean | number[] | null;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "EnergyPlanningContext".
 */
export interface EnergyPlanningContext {
  ai: AIAvailability;
  allowed_tools: AllowedTools;
  can_write: CanWrite;
  context_version?: ContextVersion;
  electronic_state_authority: PlanningElectronicState;
  example_slug?: ExampleSlug;
  execution_requires_researcher_approval?: ExecutionRequiresResearcherApproval;
  generated_at: GeneratedAt;
  grounding_facts?: GroundingFacts;
  grounding_notes?: GroundingNotes;
  grounding_policy?: GroundingPolicy;
  human_id: HumanId;
  interpretation_source_class?: InterpretationSourceClass;
  navigator: ProductNavigator;
  organization_id: OrganizationId2;
  planning_profile?: PlanningProfile;
  project_id: ProjectId24;
  project_kind: ProjectKind;
  project_name: ProjectName;
  published_example: PublishedExample;
  resources: Resources;
  role: Role2;
  scientific_input: StructureVersionDetail;
  sealed: Sealed;
  selection: ProductSelection;
  view_hint?: ViewHint;
  view_hint_is_untrusted?: ViewHintIsUntrusted;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "PlanningElectronicState".
 */
export interface PlanningElectronicState {
  authority: Authority1;
  source_artifact_id?: SourceArtifactId;
  source_sha256?: SourceSha2561;
  structure_provenance_id?: StructureProvenanceId;
  structure_version_id: StructureVersionId6;
}
/**
 * A stored record the researcher is looking at (claim, job or compared result), 0.0.18.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "GroundingFact".
 */
export interface GroundingFact {
  entity_id: EntityId2;
  evidence_class: EvidenceClass;
  facts?: Facts;
  kind: Kind2;
  label: Label11;
  verification_note?: VerificationNote;
}
export interface Facts {
  [k: string]: string | number | boolean | null;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProductNavigator".
 */
export interface ProductNavigator {
  blocked: Blocked;
  goal: Goal;
  have: Have;
  next: Next;
  notices: Notices;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProductBlocked".
 */
export interface ProductBlocked {
  action_id: ActionId;
  reasons: Reasons;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProductResource".
 */
export interface ProductResource {
  artifact_id?: ArtifactId1;
  authoritative_calculation?: AuthoritativeCalculation;
  authority?: ResultAuthority1 | null;
  calculation_id?: CalculationId16;
  entity_id: EntityId3;
  entity_type: EntityType1;
  label: Label12;
  provenance_id?: ProvenanceId1;
  reference_structure?: ReferenceStructure;
  scalar_summary?: ScalarSummary;
  sha256?: Sha2561;
  source_class: ProvenanceClass;
  structure_version_id?: StructureVersionId7;
  verification_state: VerificationState2;
}
export interface ScalarSummary {
  [k: string]: string | number | boolean | null;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureVersionDetail".
 */
export interface StructureVersionDetail {
  diagnostics?: Diagnostics;
  electronic_state_authority?: ElectronicStateAuthority;
  provenance?: StructureVersionProvenance | null;
  structure: Structure;
  version: StructureVersion;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureDiagnostic".
 */
export interface StructureDiagnostic {
  atom_index?: AtomIndex;
  code: StructureDiagnosticCode;
  message: Message2;
  severity: DiagnosticSeverity;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureVersionProvenance".
 */
export interface StructureVersionProvenance {
  actor_id?: ActorId;
  adapter?: Adapter;
  adapter_version?: AdapterVersion5;
  calculation_id?: CalculationId17;
  candidate_representation_id?: CandidateRepresentationId;
  candidate_sha256?: CandidateSha256;
  coordinate_file_sha256?: CoordinateFileSha256;
  coordinate_input_format?: CoordinateInputFormat;
  coordinate_origin?: CoordinateOrigin;
  coordinate_unit?: CoordinateUnit9;
  created_at?: CreatedAt18;
  detail?: Detail2;
  final_step_index?: FinalStepIndex;
  generation_method?: GenerationMethod1;
  geometry_candidate_id?: GeometryCandidateId;
  geometry_class?: GeometryClass;
  operation?: Operation;
  operation_version?: OperationVersion;
  origin: Origin;
  parser?: Parser;
  parser_version?: ParserVersion7;
  source_artifact?: ArtifactReference | null;
  source_class?: SourceClass4;
  source_reference?: SourceReference;
  trajectory_id?: TrajectoryId;
  verification_state?: VerificationState3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Structure".
 */
export interface Structure {
  created_at: CreatedAt19;
  created_by: CreatedBy4;
  id: Id24;
  kind: StructureKind;
  name: Name7;
  project_id: ProjectId25;
  sample_ids?: SampleIds;
  schema_version?: SchemaVersion40;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureVersion".
 */
export interface StructureVersion {
  coordinates?: CoordinateSet | null;
  created_at: CreatedAt20;
  created_by: CreatedBy5;
  diagnostics?: Diagnostics1;
  id: Id25;
  multiplicity: Multiplicity12;
  origin: StructureVersionOrigin;
  overall_charge: OverallCharge1;
  parent_version_id?: ParentVersionId;
  periodic_cell?: PeriodicCell | null;
  project_id: ProjectId26;
  representation_artifacts: RepresentationArtifacts;
  revision: Revision2;
  schema_version?: SchemaVersion41;
  structure_id: StructureId2;
}
/**
 * IDs are hints; no convergence, role, numeric value, or allowed-tool claim accepted.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProductSelection".
 */
export interface ProductSelection {
  compared_result_ids?: ComparedResultIds;
  current_view?: CurrentView;
  goal?: Goal1;
  selected_claim_id?: SelectedClaimId;
  selected_document_id?: SelectedDocumentId;
  selected_job_id?: SelectedJobId;
  selected_result_id?: SelectedResultId;
  selected_spectrum_id?: SelectedSpectrumId;
  selected_structure_id?: SelectedStructureId;
  selected_structure_version_id?: SelectedStructureVersionId;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "EngineCapabilityView".
 */
export interface EngineCapabilityView {
  availability: Availability;
  diagnostic?: Diagnostic3;
  engine: Engine10;
  max_atomic_number_by_basis?: MaxAtomicNumberByBasis;
  supported_basis_sets: SupportedBasisSets;
  supported_method_basis_pairs?: SupportedMethodBasisPairs;
  supported_methods: SupportedMethods;
  supported_optimization_levels?: SupportedOptimizationLevels;
  supported_optimizers?: SupportedOptimizers;
  supported_tasks: SupportedTasks;
  version?: Version2;
}
export interface MaxAtomicNumberByBasis {
  [k: string]: number;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "EngineMethodBasisPair".
 */
export interface EngineMethodBasisPair {
  basis: Basis10;
  method: Method15;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Evidence".
 */
export interface Evidence1 {
  citation_id?: CitationId2;
  claim_or_hypothesis: EntityReference;
  created_at: CreatedAt21;
  created_by: CreatedBy6;
  direction: EvidenceDirection;
  evidence_source: EntityReference;
  id: Id26;
  project_id: ProjectId27;
  schema_version?: SchemaVersion42;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "EvidenceCandidate".
 */
export interface EvidenceCandidate {
  created_at: CreatedAt22;
  diagnostics?: Diagnostics2;
  document_id: DocumentId3;
  evidence_type: EvidenceType;
  extraction_method: ExtractionMethod;
  extractor_version: ExtractorVersion;
  id: Id27;
  project_id: ProjectId28;
  review_state: EvidenceReviewState;
  schema_version?: SchemaVersion43;
  source_anchor?: SourceAnchor | null;
  source_class: SourceClass5;
  structured_payload: StructuredPayload;
}
export interface StructuredPayload {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "EvidenceReviewInput".
 */
export interface EvidenceReviewInput {
  decision: Decision1;
  normalized_payload?: NormalizedPayload;
  reason?: Reason3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "EvidenceReviewOutput".
 */
export interface EvidenceReviewOutput {
  candidate: EvidenceCandidate;
  source_class: ProvenanceClass;
  verification_state: VerificationState4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExampleCopyOutput".
 */
export interface ExampleCopyOutput {
  copied_at: CopiedAt;
  copied_result_count?: CopiedResultCount;
  example_slug: ExampleSlug1;
  kind?: Kind3;
  organization_id: OrganizationId3;
  project_id: ProjectId29;
  template_project_id: TemplateProjectId;
  template_version: TemplateVersion;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExampleDetail".
 */
export interface ExampleDetail {
  example: ExampleSummary;
  navigator: NavigatorState;
  structure: StructureVersionDetail;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExampleSummary".
 */
export interface ExampleSummary {
  atom_count: AtomCount4;
  available_result_types?: AvailableResultTypes;
  citation: Citation1;
  citation_url: CitationUrl;
  data_class?: DataClass;
  description: Description3;
  formula: Formula3;
  licence_url: LicenceUrl;
  publication_state?: PublicationState;
  related_context: RelatedContext;
  reuse_basis: ReuseBasis;
  review_date: ReviewDate;
  sealed?: Sealed1;
  slug: Slug;
  source: Source5;
  source_identifier: SourceIdentifier;
  source_sha256: SourceSha2562;
  source_url: SourceUrl;
  space_group: SpaceGroup;
  template_project_id: TemplateProjectId1;
  template_version: TemplateVersion1;
  title: Title3;
  type: Type;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "NavigatorState".
 */
export interface NavigatorState {
  blocked: Blocked1;
  context: NavigatorContext;
  facts_summary: NavigatorFactsSummary;
  goal: Goal3;
  goals: Goals;
  have: Have1;
  next: Next1;
  notices?: Notices1;
  project_id: ProjectId30;
  version?: Version3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "NavigatorAction".
 */
export interface NavigatorAction {
  action_id: ActionId1;
  category: Category2;
  conflicting_facts: ConflictingFacts;
  description_key: DescriptionKey;
  goal_ids: GoalIds;
  minimum_role_key: MinimumRoleKey;
  reasons?: Reasons1;
  required_capability: RequiredCapability;
  required_facts: RequiredFacts;
  resulting_fact: ResultingFact;
  target?: NavigatorTarget | null;
  title_key: TitleKey;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "NavigatorReason".
 */
export interface NavigatorReason {
  code: Code3;
  message_key: MessageKey;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "NavigatorTarget".
 */
export interface NavigatorTarget {
  launch: Launch;
  route?: Route;
  selection_id?: SelectionId;
  selection_kind?: SelectionKind;
  source_id?: SourceId;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "NavigatorContext".
 */
export interface NavigatorContext {
  blocked: Blocked2;
  goal: Goal2;
  have_ids: HaveIds;
  next_ids: NextIds;
}
export interface Blocked2 {
  [k: string]: (
    | "structure_missing"
    | "coordinates_3d_required"
    | "charge_required"
    | "multiplicity_required"
    | "molecule_required"
    | "lattice_required"
    | "crystal_required"
    | "periodic_compute_unsupported"
    | "optimization_required"
    | "worker_unavailable"
    | "optimizer_unavailable"
    | "job_in_progress"
    | "editor_required"
    | "template_sealed"
    | "frequency_required"
    | "imaginary_frequencies"
    | "stationarity_unproven"
    | "frequency_geometry_mismatch"
    | "closed_shell_required"
    | "matching_level_required"
    | "orbitals_required"
    | "computed_spectrum_required"
    | "experimental_spectrum_required"
    | "spectrum_association_required"
    | "experimental_peaks_required"
    | "matching_spectrum_type_required"
    | "thermochemistry_required"
    | "provenance_required"
    | "job_required"
    | "history_limit_reached"
  )[];
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "NavigatorFactsSummary".
 */
export interface NavigatorFactsSummary {
  atom_count?: AtomCount5;
  can_write?: CanWrite1;
  charge?: Charge10;
  computed_spectrum_types?: ComputedSpectrumTypes;
  coordinate_dimensionality?: CoordinateDimensionality;
  experimental_spectrum_types?: ExperimentalSpectrumTypes;
  failed_jobs?: FailedJobs;
  history_complete?: HistoryComplete;
  multiplicity?: Multiplicity13;
  optimized?: Optimized;
  running_jobs?: RunningJobs;
  sealed?: Sealed2;
  structure_id?: StructureId3;
  structure_name?: StructureName2;
  structure_type?: StructureType;
  structure_version_id?: StructureVersionId8;
  valid_frequency?: ValidFrequency;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "NavigatorGoal".
 */
export interface NavigatorGoal {
  goal_id: GoalId;
  satisfied: Satisfied;
  title_key: TitleKey1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "NavigatorHave".
 */
export interface NavigatorHave {
  detail?: Detail3;
  label_key: LabelKey;
  state_id: StateId;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExecutionRequest".
 */
export interface ExecutionRequest {
  calculation_id: CalculationId18;
  calculation_input_id: CalculationInputId5;
  correlation_id: CorrelationId1;
  idempotency_key: IdempotencyKey3;
  requirement: ComputeRequirement;
  requirement_hash: RequirementHash2;
  reservation_id: ReservationId;
  workload: WorkloadReference;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Experiment".
 */
export interface Experiment {
  acquired_at?: AcquiredAt;
  conditions?: Conditions;
  created_at: CreatedAt23;
  created_by: CreatedBy7;
  extension?: Extension;
  id: Id28;
  instrument_reference?: InstrumentReference;
  modality: ExperimentModality;
  name: Name9;
  operator_or_source?: OperatorOrSource;
  project_id: ProjectId31;
  sample_id: SampleId;
  schema_version?: SchemaVersion52;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AcquisitionCondition".
 */
export interface AcquisitionCondition {
  name: Name8;
  value: Value4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "FtirExtension".
 */
export interface FtirExtension {
  modality?: Modality;
  schema_version: SchemaVersion44;
  settings?: Settings;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "NmrExtension".
 */
export interface NmrExtension {
  modality?: Modality1;
  nuclei?: Nuclei;
  schema_version: SchemaVersion45;
  settings?: Settings1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "HrmsExtension".
 */
export interface HrmsExtension {
  ionization_mode?: IonizationMode;
  modality?: Modality2;
  schema_version: SchemaVersion46;
  settings?: Settings2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "XrdExtension".
 */
export interface XrdExtension {
  modality?: Modality3;
  radiation_source?: RadiationSource;
  schema_version: SchemaVersion47;
  settings?: Settings3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "UvVisExtension".
 */
export interface UvVisExtension {
  modality?: Modality4;
  schema_version: SchemaVersion48;
  settings?: Settings4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "TgDtaExtension".
 */
export interface TgDtaExtension {
  modality?: Modality5;
  schema_version: SchemaVersion49;
  settings?: Settings5;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DlsExtension".
 */
export interface DlsExtension {
  modality?: Modality6;
  schema_version: SchemaVersion50;
  settings?: Settings6;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "OtherExperimentExtension".
 */
export interface OtherExperimentExtension {
  modality?: Modality7;
  modality_identifier: ModalityIdentifier;
  schema_version: SchemaVersion51;
  settings?: Settings7;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExperimentDatasetImportInput".
 */
export interface ExperimentDatasetImportInput {
  experiment: EntityReference;
  idempotency_key?: IdempotencyKey4;
  raw_artifact: ArtifactReference;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExperimentalDataset".
 */
export interface ExperimentalDataset {
  artifact: ArtifactReference;
  created_at: CreatedAt24;
  experiment_id: ExperimentId;
  id: Id29;
  input_dataset_ids?: InputDatasetIds;
  processing?: Processing;
  project_id: ProjectId32;
  schema_version?: SchemaVersion53;
  state: DatasetProcessingState;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProcessingStep".
 */
export interface ProcessingStep {
  actor_id: ActorId1;
  algorithm: Algorithm1;
  algorithm_version: AlgorithmVersion1;
  parameters?: Parameters;
  performed_at: PerformedAt;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExperimentalDatasetListOutput".
 */
export interface ExperimentalDatasetListOutput {
  datasets: Datasets;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExperimentalDatasetView".
 */
export interface ExperimentalDatasetView {
  artifact: ArtifactReference;
  axes: Axes;
  created_at: CreatedAt25;
  digitization_session?: DigitizationSession;
  experiment_id: ExperimentId1;
  id: Id30;
  modality: ExperimentModality;
  name: Name10;
  point_count: PointCount;
  project_id: ProjectId33;
  source_class: ProvenanceClass;
  state: DatasetProcessingState;
  values: Values1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AxisDefinition".
 */
export interface AxisDefinition {
  direction: Direction;
  label: Label13;
  unit: UnitReference;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "XrdDigitizationSession".
 */
export interface XrdDigitizationSession {
  created_at: CreatedAt26;
  dataset_sha256: DatasetSha256;
  figure_number: FigureNumber1;
  operator_id: OperatorId;
  page_number: PageNumber3;
  parent_dataset_id?: ParentDatasetId;
  plot_region: SourcePixelRegion;
  point_mode: PointMode;
  points: Points1;
  reported_peaks?: ReportedPeaks;
  revision: Revision3;
  schema_version?: SchemaVersion54;
  session_id: SessionId;
  source_artifact_id: SourceArtifactId1;
  source_artifact_sha256: SourceArtifactSha256;
  source_document_id: SourceDocumentId2;
  source_evidence_id: SourceEvidenceId1;
  source_pixel_height: SourcePixelHeight;
  source_pixel_width: SourcePixelWidth;
  source_render_scale: SourceRenderScale;
  source_render_sha256: SourceRenderSha256;
  source_render_version: SourceRenderVersion;
  state?: State2;
  user_action: UserAction;
  x_calibration: XrdAxisCalibration;
  y_calibration?: XrdAxisCalibration | null;
  y_unit_status?: YUnitStatus;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SourcePixelRegion".
 */
export interface SourcePixelRegion {
  height: Height1;
  width: Width1;
  x: X4;
  y: Y4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "XrdDigitizedPoint".
 */
export interface XrdDigitizedPoint {
  intensity?: Intensity;
  point_order: PointOrder;
  source_pixel: SourcePixelPoint;
  two_theta_degree: TwoThetaDegree;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SourcePixelPoint".
 */
export interface SourcePixelPoint {
  x: X5;
  y: Y5;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "XrdReportedPeak".
 */
export interface XrdReportedPeak {
  evidence_id: EvidenceId;
  page_number: PageNumber4;
  source_class?: SourceClass6;
  two_theta_degree: TwoThetaDegree1;
  unit?: Unit2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "XrdAxisCalibration".
 */
export interface XrdAxisCalibration {
  label: Label14;
  pixel_a: SourcePixelPoint;
  pixel_b: SourcePixelPoint;
  scale?: Scale;
  unit: Unit3;
  value_a: ValueA;
  value_b: ValueB;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "GraphDigitizationSession".
 */
export interface GraphDigitizationSession {
  created_at: CreatedAt27;
  dataset_sha256: DatasetSha2561;
  figure_number: FigureNumber2;
  operator_id: OperatorId1;
  page_number: PageNumber5;
  parent_dataset_id?: ParentDatasetId1;
  plot_region: SourcePixelRegion;
  point_mode: PointMode1;
  points: Points2;
  revision: Revision4;
  schema_version?: SchemaVersion55;
  session_id: SessionId1;
  source_artifact_id: SourceArtifactId2;
  source_artifact_sha256: SourceArtifactSha2561;
  source_document_id: SourceDocumentId3;
  source_evidence_id: SourceEvidenceId2;
  source_pixel_height: SourcePixelHeight1;
  source_pixel_width: SourcePixelWidth1;
  source_render_scale: SourceRenderScale1;
  source_render_sha256: SourceRenderSha2561;
  source_render_version: SourceRenderVersion1;
  state?: State3;
  x_calibration: GraphAxisCalibration;
  y_calibration: GraphAxisCalibration;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "GraphDigitizedPoint".
 */
export interface GraphDigitizedPoint {
  point_order: PointOrder1;
  source_pixel: SourcePixelPoint;
  x_value: XValue;
  y_value: YValue;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "GraphAxisCalibration".
 */
export interface GraphAxisCalibration {
  label: Label15;
  pixel_a: SourcePixelPoint;
  pixel_b: SourcePixelPoint;
  scale?: Scale1;
  unit: Unit4;
  value_a: ValueA1;
  value_b: ValueB1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExperimentalImportInput".
 */
export interface ExperimentalImportInput {
  delimiter?: Delimiter;
  experiment_name: ExperimentName1;
  has_header?: HasHeader;
  modality: ExperimentModality;
  x_column: XColumn;
  x_label: XLabel1;
  x_unit: XUnit1;
  y_columns: YColumns;
  y_label: YLabel1;
  y_unit: YUnit1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExperimentalSeries".
 */
export interface ExperimentalSeries {
  axes: Axes1;
  data_artifact: ArtifactReference;
  dataset_id: DatasetId;
  extension?: Extension1;
  id: Id31;
  modality: Modality8;
  point_count: PointCount1;
  project_id: ProjectId34;
  schema_version?: SchemaVersion56;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExternalImportConfirmInput".
 */
export interface ExternalImportConfirmInput {
  idempotency_key: IdempotencyKey5;
  preview_sha256: PreviewSha256;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExternalImportDetail".
 */
export interface ExternalImportDetail {
  import_record: ExternalImportView;
  jobs?: Jobs2;
  results?: Results2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExternalImportView".
 */
export interface ExternalImportView {
  confirmation?: ExternalImportConfirmation | null;
  created_at: CreatedAt28;
  created_by: CreatedBy8;
  id: Id32;
  importer_version: ImporterVersion;
  parse_timestamp: ParseTimestamp;
  preview: ImportPreviewView;
  preview_artifact_id: PreviewArtifactId;
  preview_sha256: PreviewSha2562;
  project_id: ProjectId35;
  source: ExternalImportSourceView;
  state: State5;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExternalImportConfirmation".
 */
export interface ExternalImportConfirmation {
  confirmed_at: ConfirmedAt;
  confirmed_by: ConfirmedBy;
  preview_sha256: PreviewSha2561;
}
/**
 * The preview as shown to the user: everything except the (large) payloads, which are only stored and hash-bound.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportPreviewView".
 */
export interface ImportPreviewView {
  cclib: ImportCclibInfo | null;
  diagnostics?: Diagnostics3;
  importer_version: ImporterVersion1;
  items?: Items;
  job: ImportJobSummary | null;
  jobs?: Jobs1;
  normalization_version: NormalizationVersion;
  parser: ImportParserInfo;
  program: ImportProgramInfo;
  results?: Results1;
  semantic?: Semantic;
  source: ImportSourceInfo;
  status: Status14;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportCclibInfo".
 */
export interface ImportCclibInfo {
  error_logs?: ErrorLogs;
  network_or_archive_attempts: NetworkOrArchiveAttempts;
  success_flag: SuccessFlag;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportDiagnostic".
 */
export interface ImportDiagnostic {
  code: Code4;
  line?: Line;
  message: Message3;
  severity: Severity;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportItem".
 */
export interface ImportItem {
  detail: Detail4;
  id: Id33;
  result_type: ResultType3;
  state: State4;
  title: Title4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportJobSummary".
 */
export interface ImportJobSummary {
  basis: ImportValueWithStatus;
  charge: Charge11;
  convergence: ImportConvergence;
  index: Index7;
  internal_steps: InternalSteps;
  job_count: JobCount;
  job_type: JobType;
  job_type_evidence?: JobTypeEvidence;
  line_range: LineRange;
  method: ImportValueWithStatus;
  multiplicity: Multiplicity14;
  n_atoms: NAtoms;
  orientation: Orientation;
  reference: Reference2;
  solvent_model: SolventModel;
  termination: ImportTermination;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportValueWithStatus".
 */
export interface ImportValueWithStatus {
  evidence?: Evidence2;
  status: Status10;
  value: Value5;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportConvergence".
 */
export interface ImportConvergence {
  optimization: ImportOptimizationConvergence;
  scf: ImportScfConvergence;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportOptimizationConvergence".
 */
export interface ImportOptimizationConvergence {
  evidence: Evidence3;
  requested: Requested2;
  status: Status11;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportScfConvergence".
 */
export interface ImportScfConvergence {
  evidence: Evidence4;
  status: Status12;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportTermination".
 */
export interface ImportTermination {
  evidence: Evidence5;
  status: Status13;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportJobBrief".
 */
export interface ImportJobBrief {
  index: Index8;
  internal_steps: InternalSteps1;
  job_type: JobType1;
  line_range: LineRange1;
  termination: ImportTermination;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportParserInfo".
 */
export interface ImportParserInfo {
  commit: Commit;
  name: Name11;
  version: Version4;
  wheel_sha256: WheelSha256;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportProgramInfo".
 */
export interface ImportProgramInfo {
  engine: Engine11;
  label: Label16;
  version: Version5;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportResultSummary".
 */
export interface ImportResultSummary {
  result_type: ResultType4;
  source_attributes: SourceAttributes;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportSourceInfo".
 */
export interface ImportSourceInfo {
  encoding?: Encoding;
  line_count?: LineCount;
  replaced_bytes?: ReplacedBytes;
  sha256: Sha2562;
  size_bytes: SizeBytes;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExternalImportSourceView".
 */
export interface ExternalImportSourceView {
  immutable?: Immutable;
  media_class: MediaClass;
  original_name: OriginalName;
  raw_artifact_id: RawArtifactId;
  sha256: Sha2563;
  size_bytes: SizeBytes1;
  uploaded_at: UploadedAt;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExternalImportJobView".
 */
export interface ExternalImportJobView {
  basis: ImportValueWithStatus;
  charge: Charge12;
  convergence: ImportConvergence;
  created_at: CreatedAt29;
  id: Id34;
  import_id: ImportId;
  job_index: JobIndex;
  line_range: LineRange2;
  method: ImportValueWithStatus;
  multiplicity: Multiplicity15;
  source_job_type: SourceJobType;
  structure_id: StructureId4;
  structure_version_id: StructureVersionId9;
  termination: ImportTermination;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedResultView".
 */
export interface ImportedResultView {
  authority?: Authority2;
  created_at: CreatedAt30;
  id: Id35;
  import_id: ImportId1;
  import_job_id: ImportJobId;
  normalization_version: NormalizationVersion1;
  payload: Payload3;
  payload_sha256: PayloadSha256;
  producer_id: ProducerId;
  producer_type?: ProducerType;
  project_id: ProjectId36;
  provenance_record_id: ProvenanceRecordId2;
  result_type: ResultType5;
  source_attributes: SourceAttributes8;
  source_class?: SourceClass14;
  source_locators: SourceLocators;
  validation_state?: ValidationState1;
  verification_state?: VerificationState5;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedStructurePayload".
 */
export interface ImportedStructurePayload {
  atoms: Atoms2;
  bonds: Bonds2;
  charge: Charge13;
  coordinate_unit: CoordinateUnit10;
  frame: ImportedFrame;
  geometry_role: GeometryRole1;
  multiplicity: Multiplicity16;
  normalization_version: NormalizationVersion2;
  optimized: Optimized1;
  payload_schema?: PayloadSchema12;
  payload_schema_version?: PayloadSchemaVersion11;
  source: ImportedSource;
  source_attributes: SourceAttributes1;
  source_class?: SourceClass7;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedAtom".
 */
export interface ImportedAtom {
  atomic_number: AtomicNumber1;
  element: Element1;
  index: Index9;
  x: X6;
  y: Y6;
  z: Z1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedFrame".
 */
export interface ImportedFrame {
  frame_count: FrameCount;
  frame_index: FrameIndex;
  orientation: Orientation1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedSource".
 */
export interface ImportedSource {
  program: Program;
  program_label: ProgramLabel;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedEnergyPayload".
 */
export interface ImportedEnergyPayload {
  energy_kind: EnergyKind;
  excited_state_energies: ExcitedStateEnergies;
  includes_dispersion_correction?: IncludesDispersionCorrection;
  method: Method16;
  normalization_version: NormalizationVersion3;
  payload_schema?: PayloadSchema13;
  payload_schema_version?: PayloadSchemaVersion12;
  reference: Reference3;
  scf_energy: ImportedQuantity;
  scf_energy_count: ScfEnergyCount;
  solvent_model?: SolventModel1;
  source: ImportedSource;
  source_attributes: SourceAttributes2;
  source_class?: SourceClass8;
}
/**
 * A value in canonical units that keeps the raw parsed value, its unit and the exact conversion used.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedQuantity".
 */
export interface ImportedQuantity {
  conversion: Conversion;
  raw_unit: RawUnit;
  raw_value: RawValue;
  unit: Unit5;
  value: Value6;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedOptimizationPayload".
 */
export interface ImportedOptimizationPayload {
  cclib_optdone: CclibOptdone;
  converged: Converged7;
  convergence_evidence: ConvergenceEvidence;
  criteria_names: CriteriaNames;
  criteria_targets: CriteriaTargets;
  final_criteria_values: FinalCriteriaValues;
  final_frame_index: FinalFrameIndex;
  final_structure: FinalStructure;
  frame_count: FrameCount1;
  frames_angstrom: FramesAngstrom;
  frames_omitted_reason: FramesOmittedReason;
  normalization_version: NormalizationVersion4;
  payload_schema?: PayloadSchema14;
  payload_schema_version?: PayloadSchemaVersion13;
  scf_energies_hartree: ScfEnergiesHartree;
  scf_energy_unit_note: ScfEnergyUnitNote;
  source: ImportedSource;
  source_attributes: SourceAttributes3;
  source_class?: SourceClass9;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedOrbitalTablePayload".
 */
export interface ImportedOrbitalTablePayload {
  conversion: Conversion1;
  normalization_version: NormalizationVersion5;
  occupation_basis: OccupationBasis;
  orbital_coefficients: OrbitalCoefficients;
  payload_schema?: PayloadSchema15;
  payload_schema_version?: PayloadSchemaVersion14;
  raw_unit: RawUnit1;
  source: ImportedSource;
  source_attributes: SourceAttributes4;
  source_class?: SourceClass10;
  spin_channels: SpinChannels;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedOrbitalChannel".
 */
export interface ImportedOrbitalChannel {
  energies_hartree: EnergiesHartree;
  homo_index?: HomoIndex2;
  label: Label17;
  occupations: Occupations;
  orbital_count: OrbitalCount;
  raw_energies_ev: RawEnergiesEv;
  symmetries: Symmetries;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedVibrationsPayload".
 */
export interface ImportedVibrationsPayload {
  depolarization_ratios: DepolarizationRatios;
  displacement_convention: ImportedDisplacementConvention;
  equilibrium_geometry: ImportedEquilibriumGeometry;
  expected_mode_count?: ExpectedModeCount;
  frequency_sign: FrequencySign;
  frequency_unit: FrequencyUnit2;
  has_ir_intensities: HasIrIntensities;
  has_raman_activities: HasRamanActivities;
  imaginary_mode_count: ImaginaryModeCount1;
  ir_intensity_note?: IrIntensityNote;
  ir_intensity_unit: IrIntensityUnit;
  linear: Linear;
  mode_count: ModeCount;
  modes: Modes1;
  normalization_version: NormalizationVersion6;
  ordering: Ordering;
  payload_schema?: PayloadSchema16;
  payload_schema_version?: PayloadSchemaVersion15;
  raman_activity_note?: RamanActivityNote;
  raman_activity_unit: RamanActivityUnit1;
  source: ImportedSource;
  source_attributes: SourceAttributes5;
  source_class?: SourceClass11;
  zero_modes: ZeroModes;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedDisplacementConvention".
 */
export interface ImportedDisplacementConvention {
  eckart_rotation_worst_relative: EckartRotationWorstRelative;
  euclidean_norm_max: EuclideanNormMax;
  euclidean_norm_min: EuclideanNormMin;
  frame: Frame;
  statement: Statement1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedEquilibriumGeometry".
 */
export interface ImportedEquilibriumGeometry {
  atoms: Atoms3;
  coordinate_unit: CoordinateUnit11;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedMode".
 */
export interface ImportedMode {
  displacement: Displacement;
  displacement_euclidean_norm: DisplacementEuclideanNorm;
  frequency_cm1: FrequencyCm12;
  imaginary: Imaginary1;
  index: Index10;
  ir_intensity_km_mol: IrIntensityKmMol;
  raman_activity_a4_amu: RamanActivityA4Amu;
  reduced_mass_amu: ReducedMassAmu1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedExcitationsPayload".
 */
export interface ImportedExcitationsPayload {
  energy_conversion: ImportedExcitationConversions;
  energy_precision_note: EnergyPrecisionNote;
  method: Method17;
  normalization_version: NormalizationVersion7;
  ordering: Ordering1;
  oscillator_strength_gauge: OscillatorStrengthGauge2;
  payload_schema?: PayloadSchema17;
  payload_schema_version?: PayloadSchemaVersion16;
  source: ImportedSource;
  source_attributes: SourceAttributes6;
  source_class?: SourceClass12;
  spin_semantics: SpinSemantics;
  state_count: StateCount;
  states: States;
  transition_amplitudes_note: TransitionAmplitudesNote;
  transition_dipoles: TransitionDipoles;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedExcitationConversions".
 */
export interface ImportedExcitationConversions {
  ev: Ev;
  hartree: Hartree;
  wavelength: Wavelength;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedExcitedState".
 */
export interface ImportedExcitedState {
  energy_cm1_raw: EnergyCm1Raw;
  energy_ev: EnergyEv2;
  energy_hartree: EnergyHartree5;
  index: Index11;
  oscillator_strength: OscillatorStrength1;
  source_label: SourceLabel;
  source_state_number: SourceStateNumber;
  spin_label: SpinLabel;
  spin_multiplicity?: SpinMultiplicity;
  symmetry: Symmetry;
  transitions?: Transitions;
  transitions_truncated: TransitionsTruncated;
  wavelength_nm: WavelengthNm1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedTransition".
 */
export interface ImportedTransition {
  coefficient: Coefficient;
  from_orbital: FromOrbital;
  from_spin: FromSpin;
  to_orbital: ToOrbital;
  to_spin: ToSpin;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedThermochemistryPayload".
 */
export interface ImportedThermochemistryPayload {
  component_breakdown: ComponentBreakdown;
  electronic_energy_hartree: ElectronicEnergyHartree1;
  enthalpy_and_gibbs_include_electronic_energy: EnthalpyAndGibbsIncludeElectronicEnergy;
  enthalpy_hartree: ImportedQuantity;
  entropy_hartree_per_k: ImportedQuantity;
  gibbs_free_energy_hartree: ImportedQuantity;
  model: Model5;
  normalization_version: NormalizationVersion8;
  payload_schema?: PayloadSchema18;
  payload_schema_version?: PayloadSchemaVersion17;
  plausibility: ImportedThermoPlausibility;
  pressure_atm: PressureAtm1;
  pressure_pa: PressurePa3;
  recomputed_by_chemdft: RecomputedByChemdft;
  reported_by: ReportedBy;
  source: ImportedSource;
  source_attributes: SourceAttributes7;
  source_class?: SourceClass13;
  temperature_k: TemperatureK3;
  temperature_pressure_preview: TemperaturePressurePreview;
  zero_point_energy_hartree: ImportedQuantity;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportedThermoPlausibility".
 */
export interface ImportedThermoPlausibility {
  g_minus_e0_hartree: GMinusE0Hartree;
  h_minus_e0_hartree: HMinusE0Hartree;
}
export interface SourceLocators {
  [k: string]: ImportLocator;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportLocator".
 */
export interface ImportLocator {
  line_end: LineEnd;
  line_start: LineStart;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExternalImportListOutput".
 */
export interface ExternalImportListOutput {
  imports: Imports;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExternalImportSummaryView".
 */
export interface ExternalImportSummaryView {
  basis: Basis11;
  confirmed_at: ConfirmedAt1;
  created_at: CreatedAt31;
  engine: Engine12;
  id: Id36;
  job_type: JobType2;
  method: Method18;
  preview_sha256: PreviewSha2563;
  program_label: ProgramLabel1;
  project_id: ProjectId37;
  source_filename: SourceFilename;
  source_sha256: SourceSha2563;
  state: State6;
  structure_id?: StructureId5;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "GeometryCandidateAcceptInput".
 */
export interface GeometryCandidateAcceptInput {
  candidate_sha256: CandidateSha2561;
  inspected_geometry: InspectedGeometry;
  understands_not_optimized: UnderstandsNotOptimized;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "GeometryCandidateAcceptOutput".
 */
export interface GeometryCandidateAcceptOutput {
  calculation_eligibility: GeometryEligibility;
  candidate_id: CandidateId4;
  structure: Structure;
  version: StructureVersion;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "GeometryEligibility".
 */
export interface GeometryEligibility {
  code: Code5;
  detail: Detail5;
  eligible: Eligible;
  structure_version_id: StructureVersionId10;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "GeometryCandidateListOutput".
 */
export interface GeometryCandidateListOutput {
  candidates?: Candidates2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "GeometryCandidateView".
 */
export interface GeometryCandidateView {
  accepted_structure_version_id?: AcceptedStructureVersionId;
  calculation_eligible?: CalculationEligible;
  candidate_artifact: ArtifactReference;
  id: Id37;
  manifest: GeometryCandidateManifest;
  project_id: ProjectId38;
  state: State7;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "GeometryCandidateManifest".
 */
export interface GeometryCandidateManifest {
  atom_mapping: AtomMapping;
  canonical_smiles: CanonicalSmiles;
  coordinate_representation: CandidateCoordinateRepresentation;
  explicit_hydrogen_count: ExplicitHydrogenCount;
  formula: Formula4;
  generation_method: GenerationMethod2;
  generation_parameters: GenerationParameters2;
  geometry_class?: GeometryClass1;
  parent_structure_version?: EntityReference | null;
  schema_version?: SchemaVersion57;
  source_atom_count: SourceAtomCount;
  source_drawing: ArtifactReference;
  source_graph_sha256: SourceGraphSha256;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "GeometryAtomMapping".
 */
export interface GeometryAtomMapping {
  generated_atom_index: GeneratedAtomIndex;
  hydrogen_parent_source_index?: HydrogenParentSourceIndex;
  source_atom_index?: SourceAtomIndex;
}
export interface GenerationParameters2 {
  [k: string]: string | number | boolean;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "GraphDigitizedDatasetInput".
 */
export interface GraphDigitizedDatasetInput {
  experiment_name: ExperimentName2;
  plot_region: SourcePixelRegion;
  point_mode?: PointMode2;
  points: Points3;
  schema_version?: SchemaVersion58;
  source_document_sha256: SourceDocumentSha256;
  source_pixel_height: SourcePixelHeight2;
  source_pixel_width: SourcePixelWidth2;
  source_render_scale: SourceRenderScale2;
  source_render_sha256: SourceRenderSha2562;
  source_render_version: SourceRenderVersion2;
  x_calibration: GraphAxisCalibration;
  y_calibration: GraphAxisCalibration;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "GraphDigitizedPointInput".
 */
export interface GraphDigitizedPointInput {
  source_pixel: SourcePixelPoint;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Hypothesis".
 */
export interface Hypothesis {
  author: ProducerReference;
  authority?: Authority3;
  created_at: CreatedAt32;
  evidence_ids?: EvidenceIds;
  id: Id38;
  linked_entities?: LinkedEntities;
  project_id: ProjectId39;
  schema_version?: SchemaVersion59;
  statement: Statement2;
  status: HypothesisStatus;
  supersedes_id?: SupersedesId;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProducerReference".
 */
export interface ProducerReference {
  identifier: Identifier2;
  kind: ProducerKind;
  software_version?: SoftwareVersion;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportPreviewReport".
 */
export interface ImportPreviewReport {
  body: ImportPreviewBody;
  preview_sha256: PreviewSha2564;
  schema: Schema;
  schema_version?: SchemaVersion60;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportPreviewBody".
 */
export interface ImportPreviewBody {
  cclib: ImportCclibInfo | null;
  diagnostics?: Diagnostics4;
  importer_version: ImporterVersion2;
  items?: Items1;
  job: ImportJobSummary | null;
  jobs?: Jobs3;
  normalization_version: NormalizationVersion9;
  parser: ImportParserInfo;
  program: ImportProgramInfo;
  results?: Results3;
  semantic?: Semantic1;
  source: ImportSourceInfo;
  status: Status15;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ImportResultEntry".
 */
export interface ImportResultEntry {
  payload: Payload4;
  result_type: ResultType6;
  source_attributes: SourceAttributes9;
  source_locators: SourceLocators1;
}
export interface SourceLocators1 {
  [k: string]: ImportLocator;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "InvestigationAssessmentView".
 */
export interface InvestigationAssessmentView {
  created_at: CreatedAt33;
  current?: Current;
  hypothesis_id: HypothesisId1;
  id: Id39;
  observation_ids: ObservationIds1;
  outcome: Outcome3;
  rationale: Rationale1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "InvestigationGetInput".
 */
export interface InvestigationGetInput {
  investigation_id: InvestigationId;
  schema_version?: SchemaVersion61;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "InvestigationHypothesisView".
 */
export interface InvestigationHypothesisView {
  contradiction_refs?: ContradictionRefs;
  created_at: CreatedAt34;
  historical_status?: HistoricalStatus;
  id: Id40;
  source_class: SourceClass15;
  statement: Statement3;
  status: Status16;
  support_refs?: SupportRefs;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "InvestigationListOutput".
 */
export interface InvestigationListOutput {
  investigations: Investigations1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "InvestigationView".
 */
export interface InvestigationView {
  assessments?: Assessments;
  budget: Budget1;
  created_at: CreatedAt35;
  current_evidence_valid?: CurrentEvidenceValid;
  hypotheses?: Hypotheses;
  id: Id41;
  inactive_observation_ids?: InactiveObservationIds;
  limit_reason?: LimitReason;
  objective: Objective1;
  observations?: Observations1;
  pending_approval?: AIApprovalView | null;
  pending_approval_id?: PendingApprovalId;
  plans?: Plans;
  policy: InvestigationPolicy1;
  project_id: ProjectId40;
  schema_version?: SchemaVersion62;
  started_at?: StartedAt2;
  status: Status19;
  stop_conditions: StopConditions;
  stored_status?: StoredStatus;
  title: Title5;
  updated_at: UpdatedAt5;
  user_input?: UserInput;
}
export interface Budget1 {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "InvestigationObservationView".
 */
export interface InvestigationObservationView {
  citations?: Citations2;
  created_at: CreatedAt36;
  current?: Current1;
  effective_result_state?: EffectiveResultState | null;
  id: Id42;
  source_class: SourceClass16;
  source_entity_id: SourceEntityId1;
  source_entity_type: SourceEntityType1;
  summary: Summary4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "InvestigationPlanView".
 */
export interface InvestigationPlanView {
  created_at: CreatedAt37;
  id: Id43;
  revision: Revision5;
  status: Status17;
  steps?: Steps4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "InvestigationStepView".
 */
export interface InvestigationStepView {
  action: Action1;
  approval_class: ApprovalClass1;
  dependencies?: Dependencies1;
  estimated_cost: EstimatedCost1;
  failure?: Failure;
  id: Id44;
  intent: Intent1;
  result_ref?: ResultRef;
  status: Status18;
  step_number: StepNumber1;
}
export interface EstimatedCost1 {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "InvestigationPolicy".
 */
export interface InvestigationPolicy1 {
  allowed_tool_classes?: AllowedToolClasses;
  approval_required_for_expensive?: ApprovalRequiredForExpensive;
  max_ai_calls?: MaxAiCalls;
  max_ai_input_tokens?: MaxAiInputTokens;
  max_ai_output_tokens?: MaxAiOutputTokens;
  max_calculations?: MaxCalculations;
  max_compute_minor_units?: MaxComputeMinorUnits;
  max_elapsed_seconds?: MaxElapsedSeconds;
  max_steps?: MaxSteps2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "JobDiagnostics".
 */
export interface JobDiagnostics {
  active_lease?: DiagnosticLease | null;
  attempts: Attempts1;
  calculation_id: CalculationId19;
  executions: Executions;
  heartbeat_age_seconds?: HeartbeatAgeSeconds;
  heartbeat_stale_after_seconds: HeartbeatStaleAfterSeconds;
  heartbeat_status: HeartbeatStatus;
  job_id: JobId1;
  job_state: JobState;
  logs_available: LogsAvailable;
  progress_note: ProgressNote;
  progress_reported?: ProgressReported;
  project_id: ProjectId41;
  schema_id?: SchemaId2;
  server_time: ServerTime;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DiagnosticLease".
 */
export interface DiagnosticLease {
  expires_at: ExpiresAt1;
  heartbeat_at?: HeartbeatAt1;
  heartbeat_deadline_at: HeartbeatDeadlineAt;
  issued_at: IssuedAt;
  owner: Owner;
  state: State8;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DiagnosticAttempt".
 */
export interface DiagnosticAttempt {
  artifacts?: Artifacts3;
  attempt_id: AttemptId;
  attempt_number: AttemptNumber2;
  diagnostic?: Diagnostic4;
  engine_name?: EngineName;
  engine_version?: EngineVersion6;
  failure_code?: FailureCode;
  finished_at?: FinishedAt3;
  started_at?: StartedAt3;
  state: State9;
  worker_id: WorkerId2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DiagnosticArtifact".
 */
export interface DiagnosticArtifact {
  artifact_id: ArtifactId2;
  format_identifier: FormatIdentifier;
  kind: Kind4;
  log_readable: LogReadable;
  media_type: MediaType1;
  sha256: Sha2564;
  size_bytes: SizeBytes2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DiagnosticExecution".
 */
export interface DiagnosticExecution {
  attempt_id?: AttemptId1;
  created_at?: CreatedAt38;
  diagnostic?: Diagnostic5;
  execution_id: ExecutionId1;
  failure_code?: FailureCode1;
  finished_at?: FinishedAt4;
  heartbeat_at?: HeartbeatAt2;
  provider: Provider13;
  started_at?: StartedAt4;
  state: State10;
  worker_id?: WorkerId3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "JobLogOutput".
 */
export interface JobLogOutput {
  artifact_id: ArtifactId3;
  attempt_id?: AttemptId2;
  kind: Kind5;
  media_type: MediaType2;
  returned_bytes: ReturnedBytes;
  sha256: Sha2565;
  size_bytes: SizeBytes3;
  text: Text;
  truncated: Truncated1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "KnowledgeIndexStatus".
 */
export interface KnowledgeIndexStatus {
  chunk_count: ChunkCount;
  diagnostic?: Diagnostic6;
  index_version: IndexVersion;
  project_id: ProjectId42;
  schema_version?: SchemaVersion63;
  status: Status20;
  updated_at: UpdatedAt6;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "KnowledgeItemView".
 */
export interface KnowledgeItemView {
  chunker_version: ChunkerVersion;
  content: Content3;
  content_hash: ContentHash;
  created_at: CreatedAt39;
  document_id?: DocumentId4;
  evidence_id?: EvidenceId1;
  id: Id45;
  page_number?: PageNumber6;
  project_id: ProjectId43;
  schema_version?: SchemaVersion64;
  source_anchor_id?: SourceAnchorId3;
  source_class?: SourceClass17;
  source_entity_id: SourceEntityId2;
  source_revision?: SourceRevision;
  source_type: SourceType1;
  verification_state?: VerificationState6;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "KnowledgeRetrievalResult".
 */
export interface KnowledgeRetrievalResult {
  citation_type: CitationType1;
  combined_score: CombinedScore;
  content: Content4;
  document_id?: DocumentId5;
  index_version: IndexVersion1;
  knowledge_chunk_id: KnowledgeChunkId2;
  knowledge_item_id: KnowledgeItemId1;
  lexical_score: LexicalScore;
  page_number?: PageNumber7;
  schema_version?: SchemaVersion65;
  semantic_score: SemanticScore;
  source_anchor_id?: SourceAnchorId4;
  source_class?: SourceClass18;
  source_entity_id: SourceEntityId3;
  source_revision?: SourceRevision1;
  source_type: SourceType2;
  verification_state?: VerificationState7;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "KnowledgeSearchFilters".
 */
export interface KnowledgeSearchFilters {
  calculation_id?: CalculationId20;
  document_id?: DocumentId6;
  doi?: Doi;
  source_classes?: SourceClasses;
  source_types?: SourceTypes;
  structure_id?: StructureId6;
  year?: Year;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "KnowledgeSearchInput".
 */
export interface KnowledgeSearchInput {
  filters?: KnowledgeSearchFilters;
  limit?: Limit;
  query: Query;
  schema_version?: SchemaVersion66;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "KnowledgeSearchOutput".
 */
export interface KnowledgeSearchOutput {
  index_version: IndexVersion2;
  query: Query1;
  results?: Results4;
  schema_version?: SchemaVersion67;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "KnowledgeSource".
 */
export interface KnowledgeSource {
  created_at: CreatedAt40;
  external_identifier?: ExternalIdentifier;
  id: Id46;
  project_id: ProjectId44;
  schema_version?: SchemaVersion68;
  source_artifact?: ArtifactReference | null;
  title: Title6;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MolecularDrawingGenerateInput".
 */
export interface MolecularDrawingGenerateInput {
  expected_charge?: ExpectedCharge;
  mol_block: MolBlock2;
  multiplicity?: Multiplicity17;
  name: Name12;
  parent_structure_version?: EntityReference | null;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MolecularGraphValidateInput".
 */
export interface MolecularGraphValidateInput {
  content: Content5;
  format?: Format1;
  parent_representation_id?: ParentRepresentationId2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MolecularGraphValidateOutput".
 */
export interface MolecularGraphValidateOutput {
  can_generate_3d?: CanGenerate3D;
  canonical_isomeric_smiles?: CanonicalIsomericSmiles;
  differences_from_parent?: DifferencesFromParent1;
  disconnected_fragments?: DisconnectedFragments;
  double_bond_stereochemistry?: DoubleBondStereochemistry;
  elements?: Elements;
  formal_charge?: FormalCharge1;
  formula?: Formula5;
  fragment_formulas?: FragmentFormulas;
  has_stereochemistry?: HasStereochemistry;
  heavy_atom_count?: HeavyAtomCount;
  is_organic?: IsOrganic;
  is_valid: IsValid;
  schema_version?: SchemaVersion69;
  stereocenters?: Stereocenters;
  unassigned_double_bonds?: UnassignedDoubleBonds;
  unassigned_stereocenters?: UnassignedStereocenters;
  unsupported_elements?: UnsupportedElements;
  validation_diagnostics?: ValidationDiagnostics2;
  validation_warnings?: ValidationWarnings;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DoubleBondStereoInfo".
 */
export interface DoubleBondStereoInfo {
  begin_atom_index: BeginAtomIndex;
  bond_index: BondIndex;
  end_atom_index: EndAtomIndex;
  is_assigned: IsAssigned;
  stereo: Stereo;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StereocenterInfo".
 */
export interface StereocenterInfo {
  atom_index: AtomIndex1;
  element: Element2;
  is_assigned: IsAssigned1;
  stereo: Stereo1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MolecularOrbitalGridManifest".
 */
export interface MolecularOrbitalGridManifest {
  artifact: ArtifactReference;
  calculation_id: CalculationId21;
  calculation_result_id: CalculationResultId;
  coordinate_frame?: CoordinateFrame;
  coordinate_unit?: CoordinateUnit12;
  dimensions: Dimensions;
  field_max: FieldMax;
  field_min: FieldMin;
  field_quantity?: FieldQuantity;
  field_sha256: FieldSha256;
  field_unit?: FieldUnit;
  grid_generator?: GridGenerator;
  grid_generator_version: GridGeneratorVersion;
  grid_profile?: GridProfile;
  grid_profile_version?: GridProfileVersion;
  grid_sha256: GridSha256;
  grid_specification_hash: GridSpecificationHash;
  molecular_margin_angstrom: MolecularMarginAngstrom;
  orbital_index: OrbitalIndex;
  origin_angstrom: OriginAngstrom;
  result_sha256: ResultSha2564;
  schema_version?: SchemaVersion70;
  spacing_angstrom: SpacingAngstrom;
  spin_channel: SpinChannel3;
  voxel_vectors_angstrom: VoxelVectorsAngstrom;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MolecularOrbitalGridOutput".
 */
export interface MolecularOrbitalGridOutput {
  field_values: FieldValues;
  manifest: MolecularOrbitalGridManifest;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MolecularOrbitalGridRequest".
 */
export interface MolecularOrbitalGridRequest {
  grid_profile?: GridProfile1;
  orbital_index: OrbitalIndex1;
  spin_channel: SpinChannel4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MoleculeAlternative".
 */
export interface MoleculeAlternative {
  canonical_isomeric_smiles: CanonicalIsomericSmiles1;
  description: Description4;
  formula: Formula6;
  name: Name13;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MoleculeDraftCreateInput".
 */
export interface MoleculeDraftCreateInput {
  action_key: ActionKey;
  canonical_isomeric_smiles: CanonicalIsomericSmiles2;
  expected_charge?: ExpectedCharge1;
  multiplicity?: Multiplicity18;
  name: Name14;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MoleculeDraftCreateOutput".
 */
export interface MoleculeDraftCreateOutput {
  candidate_artifact_id: CandidateArtifactId;
  candidate_id: CandidateId5;
  canonical_smiles: CanonicalSmiles1;
  drawing_artifact_id: DrawingArtifactId;
  explicit_hydrogen_count: ExplicitHydrogenCount1;
  formula: Formula7;
  geometry_class?: GeometryClass2;
  name: Name15;
  project_id: ProjectId45;
  provenance_id: ProvenanceId2;
  schema_version?: SchemaVersion71;
  source_atom_count: SourceAtomCount1;
  state?: State11;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MoleculeResolveInput".
 */
export interface MoleculeResolveInput {
  allow_pubchem?: AllowPubchem;
  allow_smiles?: AllowSmiles;
  name: Name16;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MoleculeResolveOutput".
 */
export interface MoleculeResolveOutput {
  alternatives?: Alternatives;
  canonical_isomeric_smiles?: CanonicalIsomericSmiles3;
  charge?: Charge14;
  clarification_prompt?: ClarificationPrompt;
  clarification_required?: ClarificationRequired;
  diagnostics?: Diagnostics5;
  formula?: Formula8;
  heavy_atom_count?: HeavyAtomCount1;
  identity_source?: IdentitySource;
  multiplicity?: Multiplicity19;
  name: Name17;
  resolved: Resolved;
  schema_version?: SchemaVersion72;
  source_hash?: SourceHash;
  stereo_status?: StereoStatus;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "PeriodicEnergyPlanningContext".
 */
export interface PeriodicEnergyPlanningContext {
  ai: AIAvailability;
  allowed_tools: AllowedTools1;
  can_write: CanWrite2;
  context_version?: ContextVersion1;
  electronic_state_authority: PlanningElectronicState;
  example_slug?: ExampleSlug2;
  execution_requires_researcher_approval?: ExecutionRequiresResearcherApproval1;
  generated_at: GeneratedAt1;
  grounding_facts?: GroundingFacts1;
  grounding_notes?: GroundingNotes1;
  grounding_policy?: GroundingPolicy1;
  human_id: HumanId1;
  interpretation_source_class?: InterpretationSourceClass1;
  navigator: ProductNavigator;
  organization_id: OrganizationId4;
  planning_profile?: PlanningProfile1;
  project_id: ProjectId46;
  project_kind: ProjectKind1;
  project_name: ProjectName1;
  published_example: PublishedExample1;
  resources: Resources1;
  role: Role3;
  scientific_input: StructureVersionDetail;
  sealed: Sealed3;
  selection: ProductSelection;
  view_hint?: ViewHint1;
  view_hint_is_untrusted?: ViewHintIsUntrusted1;
}
/**
 * Periodic (crystal) DFT calculation options for PySCF PBC.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "PeriodicOptions".
 */
export interface PeriodicOptions {
  bands?: Bands1;
  dos?: Dos1;
  dos_k_mesh?: DosKMesh;
  k_mesh?: KMesh1;
  magnetic_order?: MagneticOrder1;
  relax?: Relax;
  relax_max_steps?: RelaxMaxSteps;
  u_effective_ev?: UEffectiveEv1;
}
export interface UEffectiveEv1 {
  [k: string]: number;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "PostMessageInput".
 */
export interface PostMessageInput {
  compared_result_ids?: ComparedResultIds1;
  content: Content6;
  current_view?: CurrentView1;
  goal?: Goal4;
  mode?: Mode2;
  planning_profile?: PlanningProfile2;
  run_limits?: AIRunLimitsInput | null;
  selected_claim_id?: SelectedClaimId1;
  selected_document_id?: SelectedDocumentId1;
  selected_job_id?: SelectedJobId1;
  selected_result_id?: SelectedResultId1;
  selected_spectrum_id?: SelectedSpectrumId1;
  selected_structure_id?: SelectedStructureId1;
  selected_structure_version_id?: SelectedStructureVersionId1;
}
/**
 * Optional lower limits for a new run; never an allocation or quota increase.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AIRunLimitsInput".
 */
export interface AIRunLimitsInput {
  max_input_tokens?: MaxInputTokens;
  max_model_calls?: MaxModelCalls;
  max_output_tokens?: MaxOutputTokens;
  max_tool_calls?: MaxToolCalls;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProductContext".
 */
export interface ProductContext {
  ai: AIAvailability;
  allowed_tools: AllowedTools2;
  can_write: CanWrite3;
  context_version?: ContextVersion2;
  example_slug?: ExampleSlug3;
  generated_at: GeneratedAt2;
  grounding_facts?: GroundingFacts2;
  grounding_notes?: GroundingNotes2;
  grounding_policy?: GroundingPolicy2;
  human_id: HumanId2;
  interpretation_source_class?: InterpretationSourceClass2;
  navigator: ProductNavigator;
  organization_id: OrganizationId5;
  project_id: ProjectId47;
  project_kind: ProjectKind2;
  project_name: ProjectName2;
  published_example: PublishedExample2;
  resources: Resources2;
  role: Role4;
  sealed: Sealed4;
  selection: ProductSelection;
  view_hint?: ViewHint2;
  view_hint_is_untrusted?: ViewHintIsUntrusted2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProjectCreateInput".
 */
export interface ProjectCreateInput {
  name: Name18;
  slug: Slug1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProjectGetInput".
 */
export interface ProjectGetInput {
  project_id: ProjectId48;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProjectListInput".
 */
export interface ProjectListInput {}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProjectListOutput".
 */
export interface ProjectListOutput {
  projects: Projects;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProjectSummary".
 */
export interface ProjectSummary {
  created_at: CreatedAt41;
  id: Id47;
  name: Name19;
  organization_id: OrganizationId6;
  role: Role5;
  slug: Slug2;
  updated_at: UpdatedAt7;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProjectMemoryCreateInput".
 */
export interface ProjectMemoryCreateInput {
  content: Content7;
  memory_type: MemoryType;
  schema_version?: SchemaVersion73;
  source_conversation_id?: SourceConversationId;
  source_links?: SourceLinks;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProjectMemoryListOutput".
 */
export interface ProjectMemoryListOutput {
  memories?: Memories;
  schema_version?: SchemaVersion75;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProjectMemoryView".
 */
export interface ProjectMemoryView {
  confirmation_state: ConfirmationState;
  content: Content8;
  created_at: CreatedAt42;
  created_by: CreatedBy9;
  id: Id48;
  memory_type: MemoryType1;
  project_id: ProjectId49;
  schema_version?: SchemaVersion74;
  source_conversation_id?: SourceConversationId1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProjectScientificClaimsOutput".
 */
export interface ProjectScientificClaimsOutput {
  claims: Claims;
  project_id: ProjectId51;
  relations: Relations;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ScientificClaim".
 */
export interface ScientificClaim {
  claim_type: ClaimType;
  created_at?: CreatedAt43;
  effective_result_state?: EffectiveResultState | null;
  evidence_id?: EvidenceId2;
  figure?: Figure1;
  id: Id49;
  original_value_text?: OriginalValueText;
  page?: Page2;
  predicate: Predicate;
  project_id: ProjectId50;
  provenance_hash?: ProvenanceHash;
  qualifier?: Qualifier;
  quantity_key?: QuantityKey;
  review_state: ReviewState;
  semantic_status?: SemanticStatus;
  source_authority: SourceAuthority;
  source_document_id?: SourceDocumentId4;
  source_href?: SourceHref;
  source_label: SourceLabel1;
  source_record_id: SourceRecordId;
  source_record_type: SourceRecordType1;
  subject: Subject;
  table?: Table1;
  uncertainty?: Uncertainty1;
  unit?: Unit6;
  value?: Value7;
}
export interface Uncertainty1 {
  [k: string]: unknown;
}
export interface Value7 {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ScientificClaimRelation".
 */
export interface ScientificClaimRelation {
  delta_unit?: DeltaUnit;
  left_claim_id: LeftClaimId;
  numeric_delta?: NumericDelta;
  rationale: Rationale2;
  relation: Relation1;
  right_claim_id: RightClaimId;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProjectScientificComparisonOutput".
 */
export interface ProjectScientificComparisonOutput {
  project_id: ProjectId52;
  rows: Rows1;
  summary: ScientificComparisonSummary;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ScientificComparisonRow".
 */
export interface ScientificComparisonRow {
  authority_summary?: AuthoritySummary;
  comparison_rule?: ComparisonRule;
  delta?: Delta1;
  delta_unit?: DeltaUnit1;
  id: Id50;
  project_claims?: ProjectClaims;
  quantity_key?: QuantityKey1;
  relation: Relation2;
  review_summary?: ReviewSummary;
  section: Section1;
  source_claims?: SourceClaims;
  source_document_id?: SourceDocumentId5;
  topic: Topic;
  unresolved_reason?: UnresolvedReason;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ScientificComparisonSummary".
 */
export interface ScientificComparisonSummary {
  calculated_results: CalculatedResults;
  digitized_datasets: DigitizedDatasets;
  directly_comparable_pairs: DirectlyComparablePairs;
  not_directly_comparable: NotDirectlyComparable;
  project_claims: ProjectClaims1;
  project_only_claims: ProjectOnlyClaims;
  reconstructed_structures: ReconstructedStructures;
  source_claims: SourceClaims1;
  source_only_claims: SourceOnlyClaims;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProvenanceRecord".
 */
export interface ProvenanceRecord {
  approximate?: Approximate;
  correlation_id: CorrelationId2;
  created_at: CreatedAt44;
  detail: ProvenanceDetail;
  id: Id51;
  inputs?: Inputs;
  operation: Operation1;
  operation_version: OperationVersion1;
  parameters?: Parameters1;
  producer: ProducerReference;
  project_id: ProjectId53;
  schema_version?: SchemaVersion76;
  source_artifact?: ArtifactReference | null;
  source_class: ProvenanceClass;
  subject: EntityReference;
  supersedes_id?: SupersedesId1;
  verification_state: VerificationState2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ProvenanceInput".
 */
export interface ProvenanceInput {
  artifact?: ArtifactReference | null;
  entity?: EntityReference | null;
  provenance_record_id?: ProvenanceRecordId3;
}
/**
 * One page of the project's published scientific results.
 *
 * Every row is backed by a stored result record (a calculation with two results yields two
 * rows). Counts are exact: `total_published` is every result in the project, `total_matching`
 * every result matching the filters. Ordering is stable (sort value, then result id) and the
 * cursor is keyset-based.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "PublishedResultsPage".
 */
export interface PublishedResultsPage {
  direction: Direction1;
  facets: PublishedResultsFacets;
  generated_at: GeneratedAt3;
  limit: Limit1;
  next_cursor?: NextCursor;
  project_id: ProjectId54;
  rows: Rows2;
  saved_comparisons: SavedComparisonListOutput;
  schema_id?: SchemaId3;
  sort: Sort;
  total_calculations: TotalCalculations;
  total_matching: TotalMatching;
  total_published: TotalPublished;
  without_result: WithoutResultCounts;
}
/**
 * Distinct values across ALL of the project's published results, for building filter menus.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "PublishedResultsFacets".
 */
export interface PublishedResultsFacets {
  engines?: Engines;
  tasks?: Tasks;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "OverviewRow".
 */
export interface OverviewRow {
  atom_count?: AtomCount6;
  basis?: Basis12;
  calculation_id: CalculationId22;
  calculation_state: CalculationState;
  charge?: Charge15;
  conditions?: StoredConditions | null;
  created_at: CreatedAt45;
  dispersion?: Dispersion1;
  effective_state?: EffectiveResultState | null;
  engine?: Engine13;
  engine_version?: EngineVersion7;
  evidence_use: EvidenceUse2;
  exports?: Exports;
  failure?: Failure1;
  formula_hill?: FormulaHill2;
  job_id?: JobId2;
  job_state?: JobState1;
  method?: Method19;
  multiplicity?: Multiplicity20;
  quantities?: Quantities2;
  result_id?: ResultId3;
  result_type?: ResultType7;
  saved_comparison_ids?: SavedComparisonIds;
  solvation?: Solvation1;
  structure_id?: StructureId7;
  structure_name?: StructureName3;
  structure_revision?: StructureRevision1;
  structure_version_id?: StructureVersionId11;
  task: Task1;
  updated_at: UpdatedAt8;
  visualizations?: Visualizations;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SavedComparisonListOutput".
 */
export interface SavedComparisonListOutput {
  availability: Availability1;
  comparisons?: Comparisons;
  project_id: ProjectId56;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SavedComparisonSummary".
 */
export interface SavedComparisonSummary {
  archived?: Archived;
  created_at: CreatedAt46;
  created_by: CreatedBy10;
  id: Id52;
  name: Name20;
  note?: Note3;
  project_id: ProjectId55;
  result_ids: ResultIds;
  schema_version?: SchemaVersion77;
}
/**
 * Calculations with no published result, by what became of them (Jobs owns the detail).
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "WithoutResultCounts".
 */
export interface WithoutResultCounts {
  canceled: Canceled1;
  failed: Failed1;
  no_result: NoResult;
  pending: Pending;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "QCSchemaAtomicInputV2".
 */
export interface QCSchemaAtomicInputV2 {
  molecule: QCSchemaMoleculeV3;
  provenance: QCSchemaProvenanceV2;
  schema_name?: SchemaName1;
  schema_version?: SchemaVersion79;
  specification: QCSchemaAtomicSpecificationV2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "QCSchemaMoleculeV3".
 */
export interface QCSchemaMoleculeV3 {
  connectivity?: Connectivity;
  geometry: Geometry;
  molecular_charge: MolecularCharge;
  molecular_multiplicity: MolecularMultiplicity;
  schema_name?: SchemaName;
  schema_version?: SchemaVersion78;
  symbols: Symbols;
  validated?: Validated1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "QCSchemaProvenanceV2".
 */
export interface QCSchemaProvenanceV2 {
  creator: Creator;
  routine?: Routine;
  version?: Version6;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "QCSchemaAtomicSpecificationV2".
 */
export interface QCSchemaAtomicSpecificationV2 {
  driver: Driver;
  keywords?: Keywords;
  model: QCSchemaModelV2;
  program?: Program1;
  schema_name?: SchemaName2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "QCSchemaKeywordV2".
 */
export interface QCSchemaKeywordV2 {
  key: Key4;
  value: Value8;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "QCSchemaModelV2".
 */
export interface QCSchemaModelV2 {
  basis?: Basis13;
  method: Method20;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "QueueStatus".
 */
export interface QueueStatus {
  active?: Active;
  counts: QueueCounts;
  heartbeat_stale_after_seconds: HeartbeatStaleAfterSeconds1;
  notice: Notice1;
  oldest_queued_at?: OldestQueuedAt;
  project_id: ProjectId57;
  schema_id?: SchemaId4;
  server_time: ServerTime1;
  worker_process_observable?: WorkerProcessObservable;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ActiveExecution".
 */
export interface ActiveExecution {
  calculation_id: CalculationId23;
  heartbeat_age_seconds?: HeartbeatAgeSeconds1;
  heartbeat_at?: HeartbeatAt3;
  heartbeat_status: HeartbeatStatus1;
  job_id: JobId3;
  job_state: JobState2;
  lease_owner?: LeaseOwner1;
  started_at?: StartedAt5;
  worker_id?: WorkerId4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "QueueCounts".
 */
export interface QueueCounts {
  cancel_requested: CancelRequested;
  canceled: Canceled2;
  failed: Failed2;
  leased: Leased;
  queued: Queued;
  running: Running;
  succeeded: Succeeded2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ResearchOverview".
 */
export interface ResearchOverview {
  generated_at: GeneratedAt4;
  project_id: ProjectId58;
  rows: Rows3;
  saved_comparisons: SavedComparisonListOutput;
  schema_id?: SchemaId5;
  structures: Structures;
  total_calculations: TotalCalculations1;
  truncated?: Truncated2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "OverviewStructure".
 */
export interface OverviewStructure {
  atom_count?: AtomCount7;
  calculation_count: CalculationCount;
  formula_hill?: FormulaHill3;
  kind: Kind6;
  latest_revision?: LatestRevision;
  latest_version_id?: LatestVersionId;
  name: Name21;
  structure_id: StructureId8;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ResultCompareInput".
 */
export interface ResultCompareInput {
  idempotency_key?: IdempotencyKey6;
  left: EntityReference;
  right: EntityReference;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ReusePlan".
 */
export interface ReusePlan {
  basis?: Basis14;
  can_reuse: CanReuse;
  charge?: Charge16;
  checks: Checks;
  engine?: Engine14;
  equivalent_calculation_ids?: EquivalentCalculationIds;
  method?: Method21;
  multiplicity?: Multiplicity21;
  notice: Notice2;
  project_id: ProjectId59;
  schema_id?: SchemaId6;
  source_calculation_id: SourceCalculationId;
  source_state: SourceState;
  specification?: Specification1;
  structure_version_id?: StructureVersionId12;
  task?: Task2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ReuseCheck".
 */
export interface ReuseCheck {
  check_id: CheckId;
  detail: Detail6;
  outcome: Outcome4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Sample".
 */
export interface Sample {
  created_at: CreatedAt47;
  created_by: CreatedBy11;
  description?: Description5;
  extensions?: Extensions;
  id: Id53;
  name: Name22;
  parent_sample_id?: ParentSampleId;
  project_id: ProjectId60;
  sample_type: SampleType;
  schema_version?: SchemaVersion80;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SavedComparisonOpenOutput".
 */
export interface SavedComparisonOpenOutput {
  comparison?: CalculationComparisonOutput | null;
  notice: Notice3;
  revalidated_at: RevalidatedAt;
  revalidation: Revalidation;
  saved: SavedComparisonSummary;
  schema_id?: SchemaId7;
  snapshot: SavedComparisonSnapshot;
  status: Status22;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SourceRevalidation".
 */
export interface SourceRevalidation {
  current_effective_state?: EffectiveResultState | null;
  current_evidence_use?: CurrentEvidenceUse;
  detail: Detail7;
  result_id: ResultId4;
  saved: SavedComparisonSource;
  status: Status21;
}
/**
 * Identity and standing of one source result *when the comparison was saved*.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SavedComparisonSource".
 */
export interface SavedComparisonSource {
  calculation_id: CalculationId24;
  evidence_use: EvidenceUse3;
  provenance_record_id: ProvenanceRecordId4;
  result_id: ResultId5;
  result_payload_sha256: ResultPayloadSha2561;
  source_lineage_validity: SourceLineageValidity1;
  stored_authority: StoredAuthority1;
  stored_validation_state: StoredValidationState1;
  stored_verification_state: StoredVerificationState1;
  structure_version_id?: StructureVersionId13;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SavedComparisonSnapshot".
 */
export interface SavedComparisonSnapshot {
  overall?: Overall1;
  saved_at: SavedAt;
  schema_id?: SchemaId8;
  sources: Sources1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ScientificArtifact".
 */
export interface ScientificArtifact {
  compression?: Compression;
  created_at: CreatedAt48;
  created_by: CreatedBy12;
  extensions?: Extensions1;
  format_identifier: FormatIdentifier1;
  format_version?: FormatVersion;
  id: Id54;
  kind: ScientificArtifactKind;
  media_type: MediaType3;
  project_id: ProjectId61;
  schema_version?: SchemaVersion81;
  sha256: Sha2566;
  size_bytes: SizeBytes4;
  source_relation?: EntityReference | null;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ScientificArtifactRegistration".
 */
export interface ScientificArtifactRegistration {
  compression?: Compression1;
  extensions?: Extensions2;
  format_identifier: FormatIdentifier2;
  format_version?: FormatVersion1;
  kind: ScientificArtifactKind;
  project_id: ProjectId62;
  schema_version?: SchemaVersion82;
  source_relation?: EntityReference | null;
  stored_file_id: StoredFileId;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ScientificDocument".
 */
export interface ScientificDocument {
  authors?: Authors;
  created_at: CreatedAt49;
  created_by: CreatedBy13;
  diagnostics?: Diagnostics6;
  document_type: DocumentType;
  doi?: Doi1;
  id: Id55;
  journal?: Journal;
  language?: Language;
  media_type: MediaType4;
  page_count: PageCount;
  parser_identifier: ParserIdentifier;
  parser_version: ParserVersion8;
  project_id: ProjectId63;
  publication_year?: PublicationYear;
  raw_artifact: ArtifactReference;
  schema_version?: SchemaVersion83;
  sha256: Sha2567;
  title?: Title7;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ScientificDocumentImportOutput".
 */
export interface ScientificDocumentImportOutput {
  candidates?: Candidates3;
  document: ScientificDocument;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ScientificDocumentListOutput".
 */
export interface ScientificDocumentListOutput {
  documents: Documents;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Spectrum".
 */
export interface Spectrum {
  data_artifact: ArtifactReference;
  dataset_id: DatasetId1;
  extension?: Extension2;
  id: Id56;
  modality: Modality9;
  point_count: PointCount2;
  processing_state: DatasetProcessingState;
  project_id: ProjectId64;
  schema_version?: SchemaVersion84;
  x_axis: AxisDefinition;
  y_axis: AxisDefinition;
}
/**
 * The stored arrays (optionally min/max-decimated for display). Decimation never changes what is stored.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumArraysView".
 */
export interface SpectrumArraysView {
  arrays_sha256: ArraysSha256;
  baseline: Baseline;
  baseline_x: BaselineX;
  dataset_id: DatasetId2;
  decimated: Decimated;
  point_count: PointCount3;
  returned_points: ReturnedPoints;
  x: X7;
  y: Y7;
  y_error: YError;
}
/**
 * A spectrum need not belong to a single molecule: it can be unassigned, tied to a structure, or tied to a sample label.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumAssociationInput".
 */
export interface SpectrumAssociationInput {
  note?: Note4;
  sample_label?: SampleLabel;
  state: AssociationState;
  structure_id?: StructureId9;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumAssociationView".
 */
export interface SpectrumAssociationView {
  created_at: CreatedAt50;
  created_by: CreatedBy14;
  dataset_id: DatasetId3;
  id: Id57;
  note: Note5;
  sample_label: SampleLabel1;
  state: AssociationState;
  structure_id: StructureId10;
  structure_name: StructureName4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumComparisonInput".
 */
export interface SpectrumComparisonInput {
  axis?: Axis;
  bands?: Bands2;
  calculated: CalculatedSourceRef;
  experimental_dataset_id: ExperimentalDatasetId;
  idempotency_key: IdempotencyKey7;
  min_oscillator_strength?: MinOscillatorStrength;
  min_relative_intensity?: MinRelativeIntensity;
  peak_set_dataset_id: PeakSetDatasetId;
  scaling?: ComparisonScaling;
  similarity?: ComparisonSimilarityInput | null;
  tolerance: Tolerance;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComparisonBandInput".
 */
export interface ComparisonBandInput {
  hi_nm: HiNm;
  label?: Label18;
  lo_nm: LoNm;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CalculatedSourceRef".
 */
export interface CalculatedSourceRef {
  id: Id58;
  kind: CalculatedSourceKind;
}
/**
 * Unscaled, or one user-entered factor persisted as part of the comparison. There is no default and no literature factor.
 */
export interface ComparisonScaling {
  factor?: Factor;
  mode?: Mode3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComparisonSimilarityInput".
 */
export interface ComparisonSimilarityInput {
  lorentzian_fwhm_cm1: LorentzianFwhmCm1;
  step_cm1: StepCm1;
  window_cm1: WindowCm1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumComparisonListOutput".
 */
export interface SpectrumComparisonListOutput {
  comparisons: Comparisons1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumComparisonView".
 */
export interface SpectrumComparisonView {
  assignment_statement: AssignmentStatement;
  authority: Authority4;
  axis: Axis1;
  bands: Bands3;
  calculated: CalculatedSourceView;
  created_at: CreatedAt51;
  created_by: CreatedBy15;
  diagnostics: Diagnostics7;
  experimental_dataset_id: ExperimentalDatasetId1;
  experimental_dataset_name: ExperimentalDatasetName;
  experimental_phase: Supplied;
  id: Id59;
  intensity_statement: IntensityStatement;
  kind: Kind7;
  method: Method22;
  metrics: ComparisonMetrics;
  pairs: Pairs1;
  peak_set_dataset_id: PeakSetDatasetId1;
  project_id: ProjectId65;
  provenance_record_id: ProvenanceRecordId5;
  record_sha256: RecordSha256;
  scaling: ComparisonScalingView;
  similarity: SimilarityView | null;
  technique: SpectrumTechnique;
  tolerance: Tolerance3;
  unmatched_calculated: UnmatchedCalculated1;
  unmatched_experimental: UnmatchedExperimental1;
  worker_version: WorkerVersion;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "BandComparison".
 */
export interface BandComparison {
  calculated_states_in_band: CalculatedStatesInBand;
  centroid_calculated_ev: CentroidCalculatedEv;
  experimental: BandExperimental | null;
  f_calculated_sum: FCalculatedSum;
  f_ratio_calc_over_exp: FRatioCalcOverExp;
  hi_nm: HiNm1;
  integration_domain: IntegrationDomain;
  label: Label19;
  limit_sensitivity: BandLimitSensitivity | null;
  lo_nm: LoNm1;
  notes: Notes1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "BandExperimental".
 */
export interface BandExperimental {
  centroid_ev: CentroidEv;
  f: F;
  integral_sigma_dnu_cm2_per_cm: IntegralSigmaDnuCm2PerCm;
  nu_hi_cm1: NuHiCm1;
  nu_lo_cm1: NuLoCm1;
  points: Points4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "BandLimitSensitivity".
 */
export interface BandLimitSensitivity {
  edges_moved: EdgesMoved;
  f_max: FMax;
  f_min: FMin;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComparisonDiagnostic".
 */
export interface ComparisonDiagnostic {
  code: Code6;
  message: Message4;
  severity: Severity1;
}
/**
 * A metadata value with its origin. NOT_SUPPLIED is a first-class state: nothing is inferred or invented.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "Supplied".
 */
export interface Supplied {
  as_written?: AsWritten;
  file_reported?: FileReported;
  line?: Line1;
  status: SuppliedStatus;
  value?: Value9;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComparisonMetrics".
 */
export interface ComparisonMetrics {
  ambiguous_pairs: AmbiguousPairs;
  calculated_considered: CalculatedConsidered;
  calculated_excluded: CalculatedExcluded;
  calculated_total: CalculatedTotal;
  delta_definition: DeltaDefinition;
  delta_unit: DeltaUnit2;
  experimental_peaks: ExperimentalPeaks;
  mae: Mae;
  mae_note: MaeNote;
  mae_upper_bound_by_construction: MaeUpperBoundByConstruction;
  matched: Matched;
  matched_fraction_of_calculated_considered: MatchedFractionOfCalculatedConsidered;
  matched_fraction_of_experimental_peaks: MatchedFractionOfExperimentalPeaks;
  max_abs_delta: MaxAbsDelta;
  median_delta: MedianDelta;
  rmse: Rmse;
  signed_bias: SignedBias;
  tolerance_sensitivity: ToleranceSensitivity;
  unmatched_calculated: UnmatchedCalculated;
  unmatched_experimental: UnmatchedExperimental;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ExcludedCount".
 */
export interface ExcludedCount {
  count: Count;
  reason: Reason4;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SensitivityRow".
 */
export interface SensitivityRow {
  mae: Mae1;
  matched: Matched1;
  rmse: Rmse1;
  signed_bias: SignedBias1;
  tolerance: Tolerance1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComparisonPair".
 */
export interface ComparisonPair {
  calculated_index: CalculatedIndex;
  calculated_oscillator_strength: CalculatedOscillatorStrength;
  calculated_position: CalculatedPosition;
  calculated_position_source: CalculatedPositionSource;
  candidates_for_calculated: CandidatesForCalculated;
  candidates_for_experimental: CandidatesForExperimental;
  delta: Delta2;
  experimental_peak_index: ExperimentalPeakIndex;
  experimental_position: ExperimentalPosition;
  margin_to_next_experimental_peak: MarginToNextExperimentalPeak;
  relative_intensity_calculated: RelativeIntensityCalculated;
  relative_intensity_experimental: RelativeIntensityExperimental;
  status: Status23;
  tolerance: Tolerance2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComparisonScalingView".
 */
export interface ComparisonScalingView {
  factor: Factor1;
  mode: Mode4;
  source: Source6;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SimilarityView".
 */
export interface SimilarityView {
  authority: Authority5;
  computed: Computed;
  cosine: Cosine;
  grid_points: GridPoints;
  note: Note6;
  pearson_r: PearsonR;
  reason: Reason5;
  settings: Settings8;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ParameterValue".
 */
export interface ParameterValue {
  key: Key5;
  value?: Value10;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "UnmatchedCalculated".
 */
export interface UnmatchedCalculated2 {
  calculated_index: CalculatedIndex1;
  calculated_oscillator_strength: CalculatedOscillatorStrength1;
  calculated_position: CalculatedPosition1;
  calculated_position_source: CalculatedPositionSource1;
  relative_intensity_calculated: RelativeIntensityCalculated1;
  status: Status24;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "UnmatchedExperimental".
 */
export interface UnmatchedExperimental2 {
  experimental_peak_index: ExperimentalPeakIndex1;
  experimental_position: ExperimentalPosition1;
  prominence: Prominence;
  relative_intensity_experimental: RelativeIntensityExperimental1;
  status: Status25;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumConfirmInput".
 */
export interface SpectrumConfirmInput {
  association?: SpectrumAssociationInput | null;
  idempotency_key: IdempotencyKey8;
  preview_sha256: PreviewSha2565;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumDatasetListOutput".
 */
export interface SpectrumDatasetListOutput {
  datasets: Datasets1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumDatasetView".
 */
export interface SpectrumDatasetView {
  acquisition: AcquisitionMetadata | null;
  arrays: ArtifactRef | null;
  arrays_sha256: ArraysSha2561;
  association: SpectrumAssociationView;
  authority: SpectrumAuthority;
  baseline_curve: ArtifactRef | null;
  children: Children;
  created_at: CreatedAt52;
  created_by: CreatedBy16;
  experiment_id: ExperimentId2;
  id: Id60;
  instrument: Supplied | null;
  kind: SpectrumDatasetKind;
  lineage: Lineage;
  metadata_verbatim: MetadataVerbatim;
  modality: ExperimentModality;
  name: Name23;
  parent_dataset_id: ParentDatasetId2;
  peak_set: PeakSetView | null;
  point_count: PointCount5;
  processing: Processing1;
  project_id: ProjectId66;
  provenance_record_id: ProvenanceRecordId6;
  representation: Representation1;
  sample: Supplied | null;
  source: SpectrumSourceView | null;
  source_class: ProvenanceClass;
  state: DatasetProcessingState;
  technique: SpectrumTechnique;
  transform: TransformRecordView | null;
  x: SpectrumAxisView;
  x_max: XMax;
  x_min: XMin;
  x_order: XOrder1;
  y: SpectrumAxisView;
  y_error_present: YErrorPresent;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AcquisitionMetadata".
 */
export interface AcquisitionMetadata {
  accumulations?: Supplied | null;
  bandwidth_nm?: Supplied | null;
  concentration?: Supplied | null;
  excitation_wavelength_nm?: Supplied | null;
  integration_time_s?: Supplied | null;
  path_length_cm?: Supplied | null;
  phase?: Supplied | null;
  polarization?: Supplied | null;
  resolution_cm1?: Supplied | null;
  sampling_mode?: Supplied | null;
  solvent?: Supplied | null;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ArtifactRef".
 */
export interface ArtifactRef {
  artifact_id: ArtifactId4;
  sha256: Sha2568;
  size_bytes: SizeBytes5;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MetadataLine".
 */
export interface MetadataLine {
  key: Key6;
  line: Line2;
  value: Value11;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "PeakSetView".
 */
export interface PeakSetView {
  algorithm: Algorithm2;
  authority: Authority6;
  environment: Environment;
  input: VersionIO;
  library: Library;
  library_version: LibraryVersion;
  parameters: Parameters2;
  peak_count: PeakCount;
  peaks: Peaks;
  record_sha256: RecordSha2561;
  resolved: Resolved1;
  warnings: Warnings2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "VersionIO".
 */
export interface VersionIO {
  artifact_sha256: ArtifactSha2561;
  point_count: PointCount4;
  representation: Representation;
  x_order?: XOrder;
  x_sha256: XSha256;
  x_unit: XUnit2;
  y_quantity: SpectrumYQuantity;
  y_sha256: YSha256;
  y_unit: YUnit2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumPeak".
 */
export interface SpectrumPeak {
  fwhm_x: FwhmX;
  index: Index12;
  left_base_x: LeftBaseX;
  prominence: Prominence1;
  refined: Refined;
  relative_height: RelativeHeight;
  right_base_x: RightBaseX;
  x: X8;
  x_sample: XSample;
  y: Y8;
  y_sample: YSample;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumWarning".
 */
export interface SpectrumWarning {
  code: Code7;
  message: Message5;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumProcessingStepView".
 */
export interface SpectrumProcessingStepView {
  dataset_id: DatasetId4;
  library: Library1;
  library_version: LibraryVersion1;
  op: Op1;
  output_artifact_sha256: OutputArtifactSha256;
  performed_at: PerformedAt1;
  record_sha256: RecordSha2562;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumSourceView".
 */
export interface SpectrumSourceView {
  decimal: Decimal;
  delimiter: Delimiter1;
  encoding: Encoding1;
  newline: Newline;
  orientation: Orientation2;
  original_axis_direction: OriginalAxisDirection;
  original_name: OriginalName1;
  parser_name: ParserName;
  parser_version: ParserVersion9;
  preview_sha256: PreviewSha2566;
  raw_artifact_id: RawArtifactId1;
  sha256: Sha2569;
  size_bytes: SizeBytes6;
  worker_version: WorkerVersion1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "TransformRecordView".
 */
export interface TransformRecordView {
  authority: Authority7;
  aux: Aux;
  environment: Environment1;
  input: VersionIO;
  input_was_descending: InputWasDescending;
  library: Library2;
  library_version: LibraryVersion2;
  op: Op2;
  output: VersionIO;
  parameters: Parameters3;
  record_sha256: RecordSha2563;
  resolved: Resolved2;
  warnings: Warnings3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AuxHash".
 */
export interface AuxHash {
  name: Name24;
  point_count: PointCount6;
  sha256: Sha25610;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumAxisView".
 */
export interface SpectrumAxisView {
  definition: AxisDefinition;
  label_in_file: LabelInFile;
  quantity: Quantity;
  unit_evidence: UnitEvidence;
  unit_evidence_text: UnitEvidenceText;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumPeakInput".
 */
export interface SpectrumPeakInput {
  idempotency_key: IdempotencyKey9;
  parameters: SpectrumPeakParameters;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumPeakParameters".
 */
export interface SpectrumPeakParameters {
  height?: Height2;
  min_distance_x?: MinDistanceX;
  min_width_x?: MinWidthX;
  polarity?: Polarity;
  prominence?: Prominence2;
  prominence_sigma?: ProminenceSigma;
  refine?: Refine;
  threshold?: Threshold;
}
/**
 * The worker's resolved preview, validated field by field. Its canonical hash is what a person confirms.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumPreviewBody".
 */
export interface SpectrumPreviewBody {
  acquisition: AcquisitionMetadata;
  arrays: ArraysBlock | null;
  choice: SpectrumChoiceEcho | null;
  columns: Columns;
  diagnostics: Diagnostics8;
  display: DisplaySeries | null;
  display_name: DisplayName3;
  instrument: Supplied;
  metadata_verbatim: MetadataVerbatim1;
  needs: Needs;
  parser: SpectrumParserInfo;
  point_count: PointCount7;
  proposals: UnitProposals;
  sample: Supplied;
  schema: Schema1;
  schema_version?: SchemaVersion85;
  source: SpectrumSourceInfo;
  status: SpectrumPreviewStatus;
  technique: Technique;
  worker_version: WorkerVersion2;
  x: XAxisPreview | null;
  y: YAxisPreview | null;
  y_error: YErrorPreview | null;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ArraysBlock".
 */
export interface ArraysBlock {
  artifact_sha256: ArtifactSha2562;
  layout: Layout;
  x_sha256: XSha2561;
  y_error_sha256: YErrorSha256;
  y_sha256: YSha2561;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumChoiceEcho".
 */
export interface SpectrumChoiceEcho {
  exclude_invalid_rows: ExcludeInvalidRows;
  excluded_lines?: ExcludedLines;
  x_index?: XIndex;
  x_unit?: XUnit3;
  y_error_index?: YErrorIndex;
  y_index?: YIndex;
  y_quantity?: SpectrumYQuantity | null;
  y_unit?: YUnit3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumColumn".
 */
export interface SpectrumColumn {
  count: Count1;
  index: Index13;
  invalid_count: InvalidCount;
  label?: Label20;
  max?: Max;
  min?: Min;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "PreviewDiagnostic".
 */
export interface PreviewDiagnostic {
  code: Code8;
  line?: Line3;
  message: Message6;
  severity: Severity2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "DisplaySeries".
 */
export interface DisplaySeries {
  buckets?: Buckets;
  decimated: Decimated1;
  source_points: SourcePoints;
  x: X9;
  y: Y9;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumParserInfo".
 */
export interface SpectrumParserInfo {
  name: Name25;
  version: Version7;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "UnitProposals".
 */
export interface UnitProposals {
  x: UnitProposal | null;
  y: UnitProposal | null;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "UnitProposal".
 */
export interface UnitProposal {
  evidence: Evidence6;
  level: UnitEvidence;
  quantity: Quantity1;
  unit: Unit7;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumSourceInfo".
 */
export interface SpectrumSourceInfo {
  decimal?: Decimal1;
  delimiter?: Delimiter2;
  encoding?: Encoding2;
  first_data_line?: FirstDataLine;
  header_line_count: HeaderLineCount;
  last_data_line?: LastDataLine;
  newline?: Newline1;
  orientation?: Orientation3;
  sha256: Sha25611;
  size_bytes: SizeBytes7;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "XAxisPreview".
 */
export interface XAxisPreview {
  direction_in_file: DirectionInFile;
  label_in_file: LabelInFile1;
  max: Max1;
  min: Min1;
  quantity: Quantity2;
  sha256: Sha25612;
  spacing: SpacingStats;
  unit: Unit8;
  unit_evidence: UnitEvidence;
  unit_evidence_text: UnitEvidenceText1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpacingStats".
 */
export interface SpacingStats {
  count: Count2;
  max: Max2;
  median: Median;
  min: Min2;
  relative_variation: RelativeVariation;
  uniform: Uniform;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "YAxisPreview".
 */
export interface YAxisPreview {
  label_in_file: LabelInFile2;
  max: Max3;
  min: Min3;
  quantity: SpectrumYQuantity | null;
  sha256: Sha25613;
  unit: Unit9;
  unit_evidence: UnitEvidence;
  unit_evidence_text: UnitEvidenceText2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "YErrorPreview".
 */
export interface YErrorPreview {
  column: Column;
  sha256: Sha25614;
  unit: Unit10;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumResolveInput".
 */
export interface SpectrumResolveInput {
  choices?: SpectrumChoices;
}
export interface SpectrumChoices {
  display_name?: DisplayName4;
  exclude_invalid_rows?: ExcludeInvalidRows1;
  instrument?: Instrument;
  metadata?: SpectrumUserMetadata | null;
  sample?: Sample1;
  x_index?: XIndex1;
  x_unit?: XUnit4;
  y_error_index?: YErrorIndex1;
  y_index?: YIndex1;
  y_quantity?: SpectrumYQuantity | null;
  y_unit?: YUnit4;
}
/**
 * User-entered acquisition metadata. Anything left empty stays NOT_SUPPLIED; it is never filled from a default.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumUserMetadata".
 */
export interface SpectrumUserMetadata {
  accumulations?: Accumulations;
  bandwidth_nm?: BandwidthNm;
  concentration?: Concentration;
  excitation_wavelength_nm?: ExcitationWavelengthNm;
  integration_time_s?: IntegrationTimeS;
  path_length_cm?: PathLengthCm;
  phase?: Phase1;
  polarization?: Polarization;
  resolution_cm1?: ResolutionCm1;
  sampling_mode?: SamplingMode;
  solvent?: Solvent1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumTransformInput".
 */
export interface SpectrumTransformInput {
  display_name?: DisplayName5;
  idempotency_key: IdempotencyKey10;
  op: Op3;
  parameters?: SpectrumTransformParameters;
}
/**
 * Union of every transform's parameters; the worker enforces which are required and valid for the chosen operation.
 */
export interface SpectrumTransformParameters {
  decreasing?: Decreasing;
  diff_order?: DiffOrder;
  half_window_x?: HalfWindowX;
  max_iter?: MaxIter;
  mode?: Mode5;
  num_std?: NumStd;
  percentile?: Percentile;
  poly_order?: PolyOrder;
  polyorder?: Polyorder;
  smooth_half_window?: SmoothHalfWindow;
  step?: Step;
  stiffness_length_x?: StiffnessLengthX;
  target?: Target;
  tol?: Tol;
  value?: Value12;
  window_points?: WindowPoints;
  window_x?: WindowX;
  x_max?: XMax1;
  x_min?: XMin1;
  x_range?: XRange;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumUploadListOutput".
 */
export interface SpectrumUploadListOutput {
  uploads: Uploads;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumUploadView".
 */
export interface SpectrumUploadView {
  created_at: CreatedAt53;
  created_by: CreatedBy17;
  dataset_id: DatasetId5;
  id: Id61;
  latest_preview: SpectrumPreviewView;
  previews: Previews;
  project_id: ProjectId68;
  source: SpectrumUploadSource;
  state: State12;
  technique: SpectrumTechnique;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumPreviewView".
 */
export interface SpectrumPreviewView {
  body: SpectrumPreviewBody;
  created_at: CreatedAt54;
  created_by: CreatedBy18;
  id: Id62;
  preview_sha256: PreviewSha2567;
  project_id: ProjectId67;
  status: SpectrumPreviewStatus;
  upload_id: UploadId;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumPreviewSummary".
 */
export interface SpectrumPreviewSummary {
  created_at: CreatedAt55;
  id: Id63;
  needs: Needs1;
  preview_sha256: PreviewSha2568;
  status: SpectrumPreviewStatus;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumUploadSource".
 */
export interface SpectrumUploadSource {
  original_name: OriginalName2;
  raw_artifact_id: RawArtifactId2;
  sha256: Sha25615;
  size_bytes: SizeBytes8;
  uploaded_at: UploadedAt1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureCandidateGetInput".
 */
export interface StructureCandidateGetInput {
  candidate_id: CandidateId6;
  schema_version?: SchemaVersion86;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureCandidateListInput".
 */
export interface StructureCandidateListInput {
  schema_version?: SchemaVersion87;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureCandidateListOutput".
 */
export interface StructureCandidateListOutput {
  candidates?: Candidates4;
  schema_version?: SchemaVersion88;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureCandidatePromotionOutput".
 */
export interface StructureCandidatePromotionOutput {
  candidate: StructureCandidate;
  provenance: StructureVersionProvenance;
  structure: Structure;
  version: StructureVersion;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureCandidateRecognizeOutput".
 */
export interface StructureCandidateRecognizeOutput {
  candidate: StructureCandidate;
  canonical_isomeric_smiles?: CanonicalIsomericSmiles4;
  formula?: Formula9;
  proposal?: Proposal;
  representation_id?: RepresentationId;
  reused?: Reused;
  schema_version?: SchemaVersion89;
  status: Status26;
}
export interface Proposal {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureCandidateRejectInput".
 */
export interface StructureCandidateRejectInput {
  reason?: Reason6;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureCandidateRequestReviewOutput".
 */
export interface StructureCandidateRequestReviewOutput {
  candidate_id: CandidateId7;
  expected_representation_id?: ExpectedRepresentationId1;
  gate_status: GateStatus;
  project_id: ProjectId69;
  review_reason: ReviewReason1;
  run_id?: RunId4;
  schema_version?: SchemaVersion90;
  source_document_id?: SourceDocumentId6;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureCandidateReviewInput".
 */
export interface StructureCandidateReviewInput {
  notes?: Notes2;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureCandidateReviewOutput".
 */
export interface StructureCandidateReviewOutput {
  candidate: StructureCandidate;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureEditCoordinateSet".
 */
export interface StructureEditCoordinateSet {
  atom_ordering?: AtomOrdering2;
  atoms: Atoms4;
  bonds?: Bonds3;
  coordinate_system: CoordinateSystem;
  dimensionality?: Dimensionality2;
  unit: CoordinateUnit3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureEditDiffView".
 */
export interface StructureEditDiffView {
  atom_count_after: AtomCountAfter;
  atom_count_before: AtomCountBefore;
  atoms_added?: AtomsAdded;
  atoms_moved?: AtomsMoved;
  atoms_removed?: AtomsRemoved;
  distance_warnings?: DistanceWarnings;
  elements_replaced?: ElementsReplaced;
  formula_after: FormulaAfter;
  formula_before: FormulaBefore;
  min_distance_after?: MinDistanceAfter;
  min_distance_before?: MinDistanceBefore;
  parent_version_id: ParentVersionId1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "AddedAtomDiff".
 */
export interface AddedAtomDiff {
  coordinates: Coordinates;
  element: Element3;
  index: Index14;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "MovedAtomDiff".
 */
export interface MovedAtomDiff {
  element: Element4;
  index: Index15;
  new_coordinates: NewCoordinates;
  old_coordinates?: OldCoordinates;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "RemovedAtomDiff".
 */
export interface RemovedAtomDiff {
  coordinates?: Coordinates1;
  element: Element5;
  index: Index16;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ReplacedElementDiff".
 */
export interface ReplacedElementDiff {
  index: Index17;
  new_element: NewElement;
  old_element: OldElement;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureEditOperation".
 */
export interface StructureEditOperation {
  coordinates?: Coordinates2;
  element?: Element6;
  index?: Index18;
  op_type: OpType;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureEditPlanningContext".
 */
export interface StructureEditPlanningContext {
  ai: AIAvailability;
  allowed_tools: AllowedTools3;
  can_write: CanWrite4;
  context_version?: ContextVersion3;
  example_slug?: ExampleSlug4;
  execution_requires_researcher_approval?: ExecutionRequiresResearcherApproval2;
  generated_at: GeneratedAt5;
  grounding_facts?: GroundingFacts3;
  grounding_notes?: GroundingNotes3;
  grounding_policy?: GroundingPolicy3;
  human_id: HumanId3;
  interpretation_source_class?: InterpretationSourceClass3;
  navigator: ProductNavigator;
  organization_id: OrganizationId7;
  planning_profile?: PlanningProfile3;
  project_id: ProjectId70;
  project_kind: ProjectKind3;
  project_name: ProjectName3;
  published_example: PublishedExample3;
  resources: Resources3;
  role: Role6;
  scientific_input: StructureVersionDetail;
  sealed: Sealed5;
  selection: ProductSelection;
  view_hint?: ViewHint3;
  view_hint_is_untrusted?: ViewHintIsUntrusted3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureEditProposeInput".
 */
export interface StructureEditProposeInput {
  diff?: StructureEditDiffView | null;
  operations: Operations;
  reason?: Reason7;
  structure_version_id: StructureVersionId14;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureEditProposeOutput".
 */
export interface StructureEditProposeOutput {
  created_version_id?: CreatedVersionId;
  diff: StructureEditDiffView;
  operations?: Operations1;
  parent_version_id: ParentVersionId2;
  proposal_id?: ProposalId;
  schema_version?: SchemaVersion91;
  status?: Status27;
  structure_id: StructureId11;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureImportInput".
 */
export interface StructureImportInput {
  idempotency_key: IdempotencyKey11;
  project_id: ProjectId71;
  requested_format: RequestedFormat;
  selection_index?: SelectionIndex;
  source_artifact: ArtifactReference;
  structure_name?: StructureName5;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureImportOutput".
 */
export interface StructureImportOutput {
  structure: Structure;
  version: StructureVersion;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureSummary".
 */
export interface StructureSummary {
  atom_count: AtomCount8;
  bond_count: BondCount;
  created_at: CreatedAt56;
  diagnostic_counts?: DiagnosticCounts;
  id: Id64;
  kind: StructureKind;
  latest_revision: LatestRevision1;
  latest_version_id: LatestVersionId1;
  name: Name26;
  project_id: ProjectId72;
  updated_at: UpdatedAt9;
}
export interface DiagnosticCounts {
  [k: string]: number;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureVersionCreateInput".
 */
export interface StructureVersionCreateInput {
  coordinates: StructureEditCoordinateSet;
  idempotency_key?: IdempotencyKey12;
  multiplicity: Multiplicity22;
  operation?: Operation2;
  overall_charge: OverallCharge2;
  parent_version_id: ParentVersionId3;
  periodic_cell?: PeriodicCell | null;
  representation_artifact: ArtifactReference;
  requested_origin?: RequestedOrigin;
  structure_id: StructureId12;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "StructureVersionCreateOutput".
 */
export interface StructureVersionCreateOutput {
  version: StructureVersion;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SurfacePotentialStatistics".
 */
export interface SurfacePotentialStatistics {
  density_grid_sha256: DensityGridSha256;
  density_isovalue: DensityIsovalue;
  density_unit?: DensityUnit;
  interpolator_version?: InterpolatorVersion;
  maximum: Maximum;
  maximum_position_angstrom: MaximumPositionAngstrom;
  minimum: Minimum;
  minimum_position_angstrom: MinimumPositionAngstrom;
  potential_unit?: PotentialUnit;
  renderer_version?: RendererVersion;
  triangle_count: TriangleCount;
  vertex_count: VertexCount;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ToolDefinition".
 */
export interface ToolDefinition {
  approval_policy: ApprovalPolicy;
  authoritative_field_policy: AuthoritativeFieldPolicy;
  availability: ToolAvailability;
  cost_class: CostClass;
  description: Description6;
  error_codes?: ErrorCodes;
  idempotency: IdempotencyBehavior;
  input_schema_ref: InputSchemaRef1;
  name: Name27;
  output_schema_ref: OutputSchemaRef1;
  permission_class: PermissionClass;
  provenance_obligations?: ProvenanceObligations;
  required_capabilities?: RequiredCapabilities1;
  reversible: Reversible;
  risk_class: RiskClass;
  schema_version?: SchemaVersion92;
  side_effect: SideEffectClass;
  tags?: Tags;
  version: SemanticVersion;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SemanticVersion".
 */
export interface SemanticVersion {
  major: Major;
  minor: Minor;
  patch: Patch;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ToolInvocationRecord".
 */
export interface ToolInvocationRecord {
  actor_id: ActorId2;
  error_code?: ToolErrorCode | null;
  id: Id65;
  input_fingerprint: InputFingerprint;
  invoked_at: InvokedAt;
  organization_id: OrganizationId8;
  outcome: Outcome5;
  project_id?: ProjectId73;
  request_id: RequestId2;
  result_reference?: ResultReference;
  schema_version?: SchemaVersion93;
  tool_name: ToolName3;
  tool_version: SemanticVersion;
  transport: Transport;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "UserCorrection".
 */
export interface UserCorrection {
  author_id: AuthorId;
  corrected_value: CorrectionValue;
  created_at: CreatedAt57;
  id: Id66;
  original: EntityReference;
  project_id: ProjectId74;
  reason: Reason8;
  schema_version?: SchemaVersion94;
  verification_state?: VerificationState8;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "CorrectionValue".
 */
export interface CorrectionValue {
  quantity?: ScientificQuantity | null;
  reference?: Reference4;
  text?: Text1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "VerificationRecord".
 */
export interface VerificationRecord {
  created_at: CreatedAt58;
  id: Id67;
  method: Method23;
  notes?: Notes3;
  project_id: ProjectId75;
  schema_version?: SchemaVersion95;
  state: VerificationState2;
  subject: EntityReference;
  verifier: ProducerReference;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "VisualizationSceneGetInput".
 */
export interface VisualizationSceneGetInput {
  subject: EntityReference;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "VolumetricFieldManifest".
 */
export interface VolumetricFieldManifest {
  artifact: ArtifactReference;
  artifact_size_bytes: ArtifactSizeBytes;
  authority?: Authority8;
  basis: Basis15;
  calculation_id: CalculationId25;
  calculation_input_hash: CalculationInputHash4;
  calculation_result_id: CalculationResultId1;
  coefficient_artifact_sha256: CoefficientArtifactSha2561;
  coordinate_frame?: CoordinateFrame1;
  coordinate_unit?: CoordinateUnit13;
  created_at: CreatedAt59;
  density_integral_electrons?: DensityIntegralElectrons;
  density_integral_note?: DensityIntegralNote;
  density_integral_relative_error?: DensityIntegralRelativeError;
  density_integral_tolerance?: DensityIntegralTolerance;
  density_matrix_electron_count: DensityMatrixElectronCount;
  density_matrix_sha256: DensityMatrixSha256;
  dimensions: Dimensions1;
  electron_count: ElectronCount1;
  field_max: FieldMax1;
  field_maximum_position_angstrom: FieldMaximumPositionAngstrom;
  field_min: FieldMin1;
  field_minimum_position_angstrom: FieldMinimumPositionAngstrom;
  field_quantity: FieldQuantity1;
  field_sha256: FieldSha2561;
  field_unit: FieldUnit1;
  generation_seconds: GenerationSeconds;
  grid_generator?: GridGenerator1;
  grid_generator_version?: GridGeneratorVersion1;
  grid_profile?: GridProfile2;
  grid_profile_version?: GridProfileVersion1;
  grid_sha256: GridSha2561;
  grid_specification_hash: GridSpecificationHash1;
  input_structure_version_id: InputStructureVersionId6;
  method: Method24;
  molecular_margin_angstrom: MolecularMarginAngstrom1;
  orbital_index?: OrbitalIndex2;
  origin_angstrom: OriginAngstrom1;
  potential_method?: PotentialMethod;
  producer?: Producer3;
  producer_version: ProducerVersion;
  provenance_record_id: ProvenanceRecordId7;
  result_sha256: ResultSha2565;
  schema_version?: SchemaVersion96;
  singularity_treatment: SingularityTreatment;
  source_class?: SourceClass19;
  spacing_angstrom: SpacingAngstrom1;
  spin_channel?: SpinChannel5;
  surface_statistics?: SurfacePotentialStatistics | null;
  validation_state?: ValidationState2;
  verification_state?: VerificationState9;
  voxel_vectors_angstrom: VoxelVectorsAngstrom1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "VolumetricFieldOutput".
 */
export interface VolumetricFieldOutput {
  field_values: FieldValues1;
  manifest: VolumetricFieldManifest;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "VolumetricFieldRequest".
 */
export interface VolumetricFieldRequest {
  field_kind: FieldKind;
  grid_profile?: GridProfile3;
  orbital_index?: OrbitalIndex3;
  spin_channel?: SpinChannel6;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "XrdDigitizedDatasetInput".
 */
export interface XrdDigitizedDatasetInput {
  experiment_name: ExperimentName3;
  plot_region: SourcePixelRegion;
  point_mode: PointMode3;
  points: Points5;
  schema_version?: SchemaVersion97;
  source_document_sha256: SourceDocumentSha2561;
  source_pixel_height: SourcePixelHeight3;
  source_pixel_width: SourcePixelWidth3;
  source_render_scale: SourceRenderScale3;
  source_render_sha256: SourceRenderSha2563;
  source_render_version: SourceRenderVersion3;
  x_calibration: XrdAxisCalibration;
  y_calibration?: XrdAxisCalibration | null;
  y_unit_status?: YUnitStatus1;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "XrdDigitizedPointInput".
 */
export interface XrdDigitizedPointInput {
  source_pixel: SourcePixelPoint;
}
/**
 * Unscaled, or one user-entered factor persisted as part of the comparison. There is no default and no literature factor.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "ComparisonScaling".
 */
export interface ComparisonScaling1 {
  factor?: Factor;
  mode?: Mode3;
}
/**
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumChoices".
 */
export interface SpectrumChoices1 {
  display_name?: DisplayName4;
  exclude_invalid_rows?: ExcludeInvalidRows1;
  instrument?: Instrument;
  metadata?: SpectrumUserMetadata | null;
  sample?: Sample1;
  x_index?: XIndex1;
  x_unit?: XUnit4;
  y_error_index?: YErrorIndex1;
  y_index?: YIndex1;
  y_quantity?: SpectrumYQuantity | null;
  y_unit?: YUnit4;
}
/**
 * Union of every transform's parameters; the worker enforces which are required and valid for the chosen operation.
 *
 * This interface was referenced by `ContractBundle`'s JSON-Schema
 * via the `definition` "SpectrumTransformParameters".
 */
export interface SpectrumTransformParameters1 {
  decreasing?: Decreasing;
  diff_order?: DiffOrder;
  half_window_x?: HalfWindowX;
  max_iter?: MaxIter;
  mode?: Mode5;
  num_std?: NumStd;
  percentile?: Percentile;
  poly_order?: PolyOrder;
  polyorder?: Polyorder;
  smooth_half_window?: SmoothHalfWindow;
  step?: Step;
  stiffness_length_x?: StiffnessLengthX;
  target?: Target;
  tol?: Tol;
  value?: Value12;
  window_points?: WindowPoints;
  window_x?: WindowX;
  x_max?: XMax1;
  x_min?: XMin1;
  x_range?: XRange;
}
