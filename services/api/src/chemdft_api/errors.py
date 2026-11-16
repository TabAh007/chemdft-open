class ApplicationError(Exception):
    default_detail = "Application action failed."

    def __init__(self, detail: str | None = None) -> None:
        self.detail = detail or self.default_detail
        super().__init__(self.detail)


class ProjectNotFound(ApplicationError):
    default_detail = "Project not found."


class ProjectAccessDenied(ApplicationError):
    default_detail = "Project edit access required."


class ProjectSlugConflict(ApplicationError):
    default_detail = "Project slug already exists in this organization."


class UploadTooLarge(ApplicationError):
    default_detail = "File exceeds the configured upload limit."


class ScientificValidationFailed(ApplicationError):
    default_detail = "Scientific contract validation failed."


class TrustedProducerRequired(ScientificValidationFailed):
    default_detail = "An issued trusted producer context is required."


class ScientificReferenceNotFound(ScientificValidationFailed):
    default_detail = "A required scientific reference does not exist."


class StructureCandidateNotFound(ScientificReferenceNotFound):
    default_detail = "Structure candidate does not exist in this project."


class CandidateCoordinatesRequired(ScientificValidationFailed):
    default_detail = "COORDINATES_REQUIRED"


class CandidateStateConflict(ScientificValidationFailed):
    default_detail = "CANDIDATE_STATE_CONFLICT"


class CrossProjectReference(ScientificValidationFailed):
    default_detail = "Scientific references cannot cross project boundaries."


class InvalidLifecycleTransition(ScientificValidationFailed):
    default_detail = "The scientific lifecycle does not permit this operation."


class ArtifactHashMismatch(ScientificValidationFailed):
    default_detail = "Artifact hash does not match its immutable metadata."


class SchemaVersionUnsupported(ScientificValidationFailed):
    default_detail = "Scientific schema version is unsupported."


class EngineUnavailable(ScientificValidationFailed):
    default_detail = "Requested engine is unavailable in the current execution environment."


class UnsupportedCalculation(ScientificValidationFailed):
    default_detail = "Requested calculation is outside the engine's supported capability set."


class StructureElectronicStateMismatch(UnsupportedCalculation):
    """The requested electronic state disagrees with its immutable structure."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


class InvalidMolecularName(ScientificValidationFailed):
    code = "MOLECULAR_NAME_CONTROL_CHARACTER"
    default_detail = "Molecular names must not contain control characters or line separators."


class CalculationConflict(ScientificValidationFailed):
    default_detail = "Idempotency key was already used for a different calculation request."


class Dftd4Conflict(ScientificValidationFailed):
    code = "DFTD4_STATE_CONFLICT"

    def __init__(self, detail, *, code="DFTD4_STATE_CONFLICT", status_code=409):
        self.code = code
        self.status_code = status_code
        super().__init__(detail)


class CalculationExecutionFailed(ScientificValidationFailed):
    default_detail = "Scientific engine execution failed."


class ComputeUnavailable(ScientificValidationFailed):
    default_detail = "Requested compute provider is unavailable."


class ComputeJobNotFound(ScientificReferenceNotFound):
    default_detail = "Compute job does not exist."


class ExternalImportConflict(ScientificValidationFailed):
    """The request conflicts with the stored state of an external import (HTTP 409)."""

    default_detail = "The external import state does not permit this operation."


class ExternalImportPreviewMismatch(ExternalImportConflict):
    default_detail = "The confirmation does not reference the exact stored preview hash."


class ExternalImportSourceChanged(ExternalImportConflict):
    default_detail = "The stored source file no longer matches its immutable SHA-256."


class ExternalImportWorkerUnavailable(ApplicationError):
    default_detail = "The isolated import worker is not installed in this environment."


class RecognitionEngineUnavailable(ApplicationError):
    default_detail = "The molecular recognition engine is not available."


class ExperimentalSpectrumConflict(ScientificValidationFailed):
    """The request conflicts with the stored state of an experimental spectrum (HTTP 409)."""

    default_detail = "The experimental spectrum state does not permit this operation."


class ExperimentalSpectrumPreviewMismatch(ExperimentalSpectrumConflict):
    default_detail = "The confirmation does not reference the exact stored preview hash."


class ExperimentalSpectrumSourceChanged(ExperimentalSpectrumConflict):
    default_detail = "The stored source file or arrays no longer match their immutable SHA-256."


class ExperimentalSpectrumInvalid(ScientificValidationFailed):
    """A deterministic worker refused the request (bad parameters, units, ...): HTTP 422."""

    default_detail = "The experimental spectrum request is not valid."


class ExperimentalSpectrumWorkerUnavailable(ApplicationError):
    default_detail = (
        "The isolated experimental spectra worker is not installed in this environment."
    )


class BillingNotConfigured(ApplicationError):
    default_detail = "Billing is not configured for this environment."


class BillingEntitlementDenied(ApplicationError):
    default_detail = "The current billing entitlement does not permit this operation."


class BillingWebhookInvalid(ApplicationError):
    default_detail = "The billing webhook could not be verified."


class BillingPlanNotFound(ApplicationError):
    default_detail = "The requested billing plan is not configured."


class BillingSecretUnavailable(ApplicationError):
    default_detail = (
        "A production secret provider is required before BYOK credentials can be stored."
    )


class FeatureNotActivated(ApplicationError):
    """The code is present but its database migration has not been applied (HTTP 503)."""

    default_detail = "This feature needs a database migration that has not been applied."


class ExportLimitExceeded(ApplicationError):
    """A portable export would exceed a whole-archive resource bound (HTTP 413)."""

    default_detail = "The export exceeds a configured size or count limit."


class ExportBlocked(ScientificValidationFailed):
    """A portable export was refused by the content policy (HTTP 422). The reason is never data."""

    default_detail = "The export was blocked by the portable-content policy."


class UsageLimitReached(ApplicationError):
    """A per-user daily usage limit for the private beta was reached (HTTP 429)."""

    default_detail = "The daily usage limit was reached."


class AccountPolicyError(ApplicationError):
    """A self-service account limit or gate refused the request (ADR-045); `code` is stable."""

    status_code = 429
    code = "ACCOUNT_POLICY"

    def __init__(self, code: str, detail: str, *, status_code: int = 429) -> None:
        super().__init__(detail)
        self.code = code
        self.status_code = status_code
