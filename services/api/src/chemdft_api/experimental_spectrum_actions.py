"""Experimental spectra: upload -> preview (no authoritative write) -> hash-bound confirmation -> immutable RAW dataset.

Authority model (never weakened):
  * The uploaded file is an immutable `RAW_UPLOAD` artifact (SHA-256, never rewritten).
  * A preview is a hash-bound `NORMALIZED_RESULT` artifact. Creating one writes NO experiment, NO dataset and NO spectrum.
  * Confirmation must quote the exact stored preview hash. The source file is re-hashed and the worker is re-run on it with the
    stored choices; the result must reproduce that hash and the arrays bytes. Only then does the VALIDATED_IMPORT_PIPELINE
    producer publish one RAW `experimental_datasets` row (`source_class = EXPERIMENTAL`).
  * A RAW dataset is never edited. Processing creates new datasets (see `experimental_spectrum_processing`).
  * Unit evidence is part of the preview: EXPLICIT_UNIT (written in the file) or USER_CONFIRMED. Hints never authorise a commit.
"""
# ruff: noqa: E501  (long human-readable diagnostics and separators)

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from array import array
from io import BytesIO
from pathlib import Path
from typing import Any, BinaryIO
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .actions import authorize_project_access, register_raw_file
from .config import Settings
from .context import Identity
from .contracts.artifacts import ScientificArtifactKind, ScientificArtifactRegistration
from .contracts.experimental_spectra import (
    MAX_DISPLAY_POINTS,
    PEAKS_SCHEMA,
    TRANSFORM_SCHEMA,
    ArtifactRef,
    AssociationState,
    AuxHash,
    ParameterValue,
    PeakSetView,
    SpectrumArraysView,
    SpectrumAssociationInput,
    SpectrumAssociationView,
    SpectrumAuthority,
    SpectrumAxisView,
    SpectrumChoices,
    SpectrumConfirmInput,
    SpectrumDatasetKind,
    SpectrumDatasetListOutput,
    SpectrumDatasetView,
    SpectrumPeak,
    SpectrumPreviewBody,
    SpectrumPreviewDocument,
    SpectrumPreviewStatus,
    SpectrumPreviewSummary,
    SpectrumPreviewView,
    SpectrumProcessingStepView,
    SpectrumSourceView,
    SpectrumTechnique,
    SpectrumUploadListOutput,
    SpectrumUploadSource,
    SpectrumUploadView,
    SpectrumWarning,
    Supplied,
    TransformRecordView,
    VersionIO,
    body_sha256,
    canonical_json,
)
from .contracts.provenance import ProducerKind, ProvenanceClass, ProvenanceDetail, VerificationState
from .contracts.scientific import (
    AxisDefinition,
    DatasetProcessingState,
    ExperimentModality,
    QuantityDimension,
    UnitReference,
    UnitStandard,
)
from .errors import (
    CrossProjectReference,
    ExperimentalSpectrumConflict,
    ExperimentalSpectrumInvalid,
    ExperimentalSpectrumPreviewMismatch,
    ExperimentalSpectrumSourceChanged,
    ProjectAccessDenied,
    ScientificReferenceNotFound,
    ScientificValidationFailed,
    TrustedProducerRequired,
    UploadTooLarge,
)
from .experimental_spectrum_runner import (
    PARSER_VERSION,
    WORKER_VERSION,
    RunnerOutcome,
    SpectraRunner,
    rejected_preview_body,
    run_spectra_worker,
)
from .external_import_runner import sanitize_filename
from .models import new_id
from .project_access import ProjectCapability, can
from .scientific_actions import register_scientific_artifact
from .scientific_models import (
    AuditEventRecord,
    ExperimentalDatasetRecord,
    ExperimentRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    SpectrumAssociationRecord,
    SpectrumConfirmationRecord,
    SpectrumOperationRecord,
    SpectrumPreviewRecord,
    SpectrumUploadRecord,
    StructureRecord,
)
from .storage import ObjectStore
from .trusted_producers import (
    ProducerType,
    TrustedProducerContext,
    is_issued_trusted_producer,
    issue_trusted_producer_context,
)

PRODUCER_ID = "chemdft.experimental-spectrum.pipeline"
TRANSFORM_PRODUCER_ID = "chemdft.experimental-spectrum.transforms"
SOURCE_FORMAT = "chemdft.experimental-spectrum.source.text"
PREVIEW_MEDIA_TYPE = "application/vnd.chemdft.experimental-spectrum-preview+json"
PREVIEW_FORMAT = "chemdft.experimental-spectrum.preview"
ARRAYS_MEDIA_TYPE = "application/vnd.chemdft.spectrum-arrays+octet-stream"
ARRAYS_FORMAT = "chemdft.spectrum.arrays.f64le"
PEAKS_MEDIA_TYPE = "application/vnd.chemdft.spectrum-peaks+json"
PEAKS_FORMAT = "chemdft.spectrum.peaks"
MODALITY_BY_TECHNIQUE = {
    SpectrumTechnique.IR: ExperimentModality.FTIR,
    SpectrumTechnique.RAMAN: ExperimentModality.RAMAN,
    SpectrumTechnique.UVVIS: ExperimentModality.UV_VIS,
}
TECHNIQUE_BY_MODALITY = {v.value: k for k, v in MODALITY_BY_TECHNIQUE.items()}
_X_LABELS = {"WAVENUMBER": "Wavenumber", "WAVELENGTH": "Wavelength", "ENERGY": "Photon energy"}
_Y_LABELS = {
    "ABSORBANCE": "Absorbance",
    "TRANSMITTANCE": "Transmittance",
    "INTENSITY": "Intensity",
    "CROSS_SECTION": "Absorption cross section",
    "MOLAR_ABSORPTIVITY": "Molar absorptivity",
}
_DIMENSIONS = {
    "cm^-1": QuantityDimension.OTHER_DECLARED,
    "um": QuantityDimension.LENGTH,
    "nm": QuantityDimension.LENGTH,
    "eV": QuantityDimension.ENERGY,
    "absorbance": QuantityDimension.DIMENSIONLESS,
    "percent": QuantityDimension.DIMENSIONLESS,
    "fraction": QuantityDimension.DIMENSIONLESS,
    "relative": QuantityDimension.DIMENSIONLESS,
    "counts": QuantityDimension.INTENSITY,
    "arbitrary": QuantityDimension.INTENSITY,
    "cm^2/molecule": QuantityDimension.OTHER_DECLARED,
    "L/(mol*cm)": QuantityDimension.OTHER_DECLARED,
}


# ------------------------------------------------------------------------------------------------ helpers
def _stream_to_file(stream: BinaryIO, path: Path, max_bytes: int) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("xb") as target:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            if size > max_bytes:
                raise UploadTooLarge("The file exceeds the experimental spectrum size limit.")
            digest.update(chunk)
            target.write(chunk)
    return digest.hexdigest(), size


def put_artifact(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    *,
    project_id: str,
    data: bytes,
    kind: ScientificArtifactKind,
    media_type: str,
    format_identifier: str,
    source_relation_id: str | None,
) -> ScientificArtifactRecord:
    stored = object_store.put_raw(project_id, BytesIO(data), len(data) + 1)
    record = ScientificArtifactRecord(
        project_id=project_id,
        kind=kind,
        media_type=media_type,
        format_identifier=format_identifier,
        format_version="1.0.0",
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        storage_key=stored.key,
        created_by=identity.user_id,
        source_relation_type="scientific.artifact" if source_relation_id else None,
        source_relation_id=source_relation_id,
        compression=None,
        schema_version="1.0.0",
        extensions_json=[],
    )
    session.add(record)
    session.flush()
    return record


def read_artifact(session: Session, object_store: ObjectStore, settings: Settings, artifact_id: str | None, project_id: str, *, expected_sha256: str | None = None) -> tuple[ScientificArtifactRecord, bytes]:
    artifact = session.get(ScientificArtifactRecord, artifact_id) if artifact_id else None
    if artifact is None or artifact.project_id != project_id:
        raise ExperimentalSpectrumSourceChanged("A stored artifact is missing.")
    data = object_store.get_bytes(artifact.storage_key, max(settings.max_spectrum_bytes, 64 * 1024 * 1024))
    if hashlib.sha256(data).hexdigest() != artifact.sha256 or (expected_sha256 is not None and artifact.sha256 != expected_sha256):
        raise ExperimentalSpectrumSourceChanged()
    return artifact, data


def artifact_ref(record: ScientificArtifactRecord) -> dict[str, str]:
    return {"project_id": record.project_id, "artifact_id": record.id, "sha256": record.sha256}


def audit(
    session: Session,
    identity: Identity,
    *,
    project_id: str,
    event_name: str,
    entity_type: str,
    entity_id: str,
    artifacts: list[dict[str, str]],
    metadata: list[dict[str, str]] | None = None,
) -> None:
    session.add(
        AuditEventRecord(
            event_name=event_name,
            actor_or_service_id=identity.user_id,
            organization_id=identity.organization_id,
            project_id=project_id,
            request_id=new_id(),
            targets_json=[{"project_id": project_id, "entity_type": entity_type, "entity_id": entity_id}],
            outcome="SUCCEEDED",
            artifact_references_json=artifacts,
            safe_metadata_json=metadata or [],
        )
    )


def flatten(mapping: dict[str, Any], prefix: str = "") -> list[ParameterValue]:
    """Typed key/value view of a worker's parameter dictionary (nested keys are dotted; lists are comma-joined)."""
    rows: list[ParameterValue] = []
    for key in sorted(mapping):
        value = mapping[key]
        name = f"{prefix}{key}"
        if isinstance(value, dict):
            rows.extend(flatten(value, f"{name}."))
        elif isinstance(value, list | tuple):
            rows.append(ParameterValue(key=name, value=",".join(str(v) for v in value)))
        elif value is None or isinstance(value, str | bool | int | float):
            rows.append(ParameterValue(key=name, value=value))
        else:
            rows.append(ParameterValue(key=name, value=str(value)))
    return rows


def axis_definition(label: str, unit: str, direction: str) -> dict[str, Any]:
    return AxisDefinition(
        label=label,
        unit=UnitReference(standard=UnitStandard.UCUM, code=unit, dimension=_DIMENSIONS[unit]),
        direction=direction,  # type: ignore[arg-type]
    ).model_dump(mode="json")


def axes_for(technique: str, x_unit: str, x_quantity: str | None, y_quantity: str, y_unit: str, representation: str, direction: str) -> list[dict[str, Any]]:
    x_label = "Raman shift" if technique == "RAMAN" and x_quantity == "WAVENUMBER" else _X_LABELS.get(x_quantity or "", "Axis")
    y_label = _Y_LABELS.get(y_quantity, "Signal")
    return [
        axis_definition(x_label, x_unit, direction),
        axis_definition(("Normalized " + y_label.lower()) if representation == "RELATIVE" else y_label, y_unit, "ASCENDING"),
    ]


def decode_floats(data: bytes, count: int) -> array:
    values = array("d")
    values.frombytes(data[: count * 8])
    if sys.byteorder == "big":  # arrays are stored little-endian
        values.byteswap()
    return values


# ------------------------------------------------------------------------------------------------ preview documents
def _validated_preview(body: dict, preview_sha256: str, source_sha256: str, size: int, technique: str) -> tuple[dict, str]:
    """Re-validate a worker preview. Anything that does not match becomes a REJECTED preview, never a stored scientific record."""
    try:
        SpectrumPreviewBody.model_validate(body)
        if body_sha256(body) != preview_sha256:
            raise ValueError("the preview hash does not match its body")
        if body["source"]["sha256"] != source_sha256 or body["source"]["size_bytes"] != size:
            raise ValueError("the worker described a different source file")
        if body["technique"] != technique:
            raise ValueError("the worker described a different technique")
        return body, preview_sha256
    except (ValueError, KeyError, TypeError) as error:
        rejected = rejected_preview_body(technique, source_sha256, size, "WORKER_OUTPUT_INVALID", f"The worker preview failed validation: {str(error)[:300]}")
        return rejected, body_sha256(rejected)


def run_resolve(settings: Settings, runner: SpectraRunner | None, source_path: Path, technique: str, choices: dict[str, Any], source_sha256: str, size: int) -> tuple[dict, str, bytes | None]:
    """Run the worker's `resolve`. Returns (preview body, preview hash, arrays bytes or None). Worker failure -> REJECTED preview."""
    run = runner or run_spectra_worker
    outcome: RunnerOutcome = run("resolve", {"technique": technique, "choices": choices}, settings, source_path=source_path, want_arrays=True)
    if outcome.failure or outcome.document is None:
        code = {"timeout": "PARSE_TIMEOUT", "memory": "PARSE_RESOURCE_LIMIT", "cpu": "PARSE_RESOURCE_LIMIT", "crash": "PARSER_CRASHED"}.get(outcome.failure or "", "WORKER_OUTPUT_INVALID")
        body = rejected_preview_body(technique, source_sha256, size, code, outcome.detail or "The spectra worker failed.")
        return body, body_sha256(body), None
    document = outcome.document
    body, sha = _validated_preview(document.get("preview", {}), document.get("preview_sha256", ""), source_sha256, size, technique)
    arrays = outcome.arrays if body["status"] != "REJECTED" and sha == document.get("preview_sha256") else None
    if arrays is not None and hashlib.sha256(arrays).hexdigest() != (body["arrays"] or {}).get("artifact_sha256"):
        rejected = rejected_preview_body(technique, source_sha256, size, "WORKER_OUTPUT_INVALID", "The worker arrays do not match the hash in its preview.")
        return rejected, body_sha256(rejected), None
    return body, sha, arrays


def _store_preview(session: Session, identity: Identity, object_store: ObjectStore, upload: SpectrumUploadRecord, body: dict, preview_sha256: str, choices: dict[str, Any]) -> SpectrumPreviewRecord:
    existing = session.scalar(select(SpectrumPreviewRecord).where(SpectrumPreviewRecord.upload_id == upload.id, SpectrumPreviewRecord.preview_sha256 == preview_sha256))
    if existing is not None:
        return existing
    artifact = put_artifact(
        session,
        identity,
        object_store,
        project_id=upload.project_id,
        data=canonical_json({"body": body, "preview_sha256": preview_sha256}),
        kind=ScientificArtifactKind.NORMALIZED_RESULT,
        media_type=PREVIEW_MEDIA_TYPE,
        format_identifier=PREVIEW_FORMAT,
        source_relation_id=upload.raw_artifact_id,
    )
    record = SpectrumPreviewRecord(
        project_id=upload.project_id,
        upload_id=upload.id,
        preview_sha256=preview_sha256,
        status=body["status"],
        preview_artifact_id=artifact.id,
        choices_json=choices,
        worker_version=body["worker_version"],
        parser_version=body["parser"]["version"],
        created_by=identity.user_id,
    )
    session.add(record)
    session.flush()
    audit(
        session,
        identity,
        project_id=upload.project_id,
        event_name="experimental_spectrum.previewed",
        entity_type="experimental.spectrum.upload",
        entity_id=upload.id,
        artifacts=[artifact_ref(artifact)],
        metadata=[{"key": "status", "value": body["status"]}, {"key": "preview_sha256", "value": preview_sha256}],
    )
    return record


def _load_preview(session: Session, object_store: ObjectStore, settings: Settings, record: SpectrumPreviewRecord) -> SpectrumPreviewDocument:
    artifact, data = read_artifact(session, object_store, settings, record.preview_artifact_id, record.project_id)
    document = SpectrumPreviewDocument.model_validate(json.loads(data))
    if body_sha256(json.loads(data)["body"]) != document.preview_sha256 or document.preview_sha256 != record.preview_sha256:
        raise ExperimentalSpectrumPreviewMismatch("The stored preview does not match its recorded hash.")
    del artifact
    return document


def _preview_view(record: SpectrumPreviewRecord, document: SpectrumPreviewDocument) -> SpectrumPreviewView:
    return SpectrumPreviewView(
        id=UUID(record.id),
        upload_id=UUID(record.upload_id),
        project_id=UUID(record.project_id),
        preview_sha256=record.preview_sha256,
        status=document.body.status,
        body=document.body,
        created_at=record.created_at,
        created_by=UUID(record.created_by),
    )


def _confirmation_for(session: Session, upload_id: str) -> SpectrumConfirmationRecord | None:
    return session.scalar(select(SpectrumConfirmationRecord).where(SpectrumConfirmationRecord.upload_id == upload_id))


def _get_upload(session: Session, project_id: str, upload_id: str) -> SpectrumUploadRecord:
    record = session.get(SpectrumUploadRecord, upload_id)
    if record is None or record.project_id != project_id:
        raise ScientificReferenceNotFound("Experimental spectrum upload does not exist in this project.")
    return record


def _upload_view(session: Session, object_store: ObjectStore, settings: Settings, upload: SpectrumUploadRecord) -> SpectrumUploadView:
    previews = session.scalars(select(SpectrumPreviewRecord).where(SpectrumPreviewRecord.upload_id == upload.id).order_by(SpectrumPreviewRecord.created_at, SpectrumPreviewRecord.id)).all()
    latest = previews[-1]
    document = _load_preview(session, object_store, settings, latest)
    confirmation = _confirmation_for(session, upload.id)
    state = "IMPORTED" if confirmation else ("REJECTED" if latest.status == "REJECTED" else "PREVIEW")
    return SpectrumUploadView(
        id=UUID(upload.id),
        project_id=UUID(upload.project_id),
        technique=SpectrumTechnique(upload.technique),
        state=state,
        source=SpectrumUploadSource(
            sha256=upload.source_sha256,
            size_bytes=upload.source_size_bytes,
            original_name=upload.source_filename,
            uploaded_at=upload.created_at,
            raw_artifact_id=UUID(upload.raw_artifact_id) if upload.raw_artifact_id else None,
        ),
        previews=tuple(SpectrumPreviewSummary(id=UUID(p.id), preview_sha256=p.preview_sha256, status=SpectrumPreviewStatus(p.status), needs=_needs(session, object_store, settings, p, latest, document), created_at=p.created_at) for p in previews),
        latest_preview=_preview_view(latest, document),
        dataset_id=UUID(confirmation.dataset_id) if confirmation else None,
        created_at=upload.created_at,
        created_by=UUID(upload.created_by),
    )


def _needs(session: Session, object_store: ObjectStore, settings: Settings, record: SpectrumPreviewRecord, latest: SpectrumPreviewRecord, latest_document: SpectrumPreviewDocument) -> tuple[Any, ...]:
    document = latest_document if record.id == latest.id else _load_preview(session, object_store, settings, record)
    return document.body.needs


# ------------------------------------------------------------------------------------------------ upload -> preview
def create_spectrum_upload(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    *,
    project_id: str,
    technique: SpectrumTechnique,
    original_name: str | None,
    stream: BinaryIO,
    idempotency_key: str,
    runner: SpectraRunner | None = None,
) -> SpectrumUploadView:
    """Safe ingestion + parse + validation + preview. Writes NO experiment, NO dataset, NO spectrum."""
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    existing = session.scalar(select(SpectrumUploadRecord).where(SpectrumUploadRecord.project_id == project.id, SpectrumUploadRecord.idempotency_key == idempotency_key))
    if existing is not None:
        return _upload_view(session, object_store, settings, existing)
    display_name = sanitize_filename(original_name)
    with tempfile.TemporaryDirectory(prefix="chemdft-spectrum-upload-") as tmp:
        source_path = Path(tmp) / "upload"
        sha256, size = _stream_to_file(stream, source_path, settings.max_spectrum_bytes)
        body, preview_sha256, _arrays = run_resolve(settings, runner, source_path, technique.value, {}, sha256, size)
        # The raw bytes are kept (immutably) only when they passed the worker's byte-level checks: hostile or binary data is never stored.
        raw_artifact: ScientificArtifactRecord | None = None
        if body["source"]["encoding"] is not None:
            with source_path.open("rb") as handle:
                stored_file = register_raw_file(session=session, identity=identity, object_store=object_store, project_id=project.id, original_name=display_name, media_type="text/plain", stream=handle, max_upload_bytes=settings.max_spectrum_bytes)
            artifact = register_scientific_artifact(session, identity, ScientificArtifactRegistration(project_id=UUID(project.id), stored_file_id=stored_file.id, kind=ScientificArtifactKind.RAW_UPLOAD, format_identifier=SOURCE_FORMAT, format_version=None))
            raw_artifact = session.get(ScientificArtifactRecord, str(artifact.id))
            if raw_artifact is None or raw_artifact.sha256 != sha256:
                raise ScientificValidationFailed("The stored source file does not match the uploaded bytes.")
        upload = SpectrumUploadRecord(
            project_id=project.id,
            idempotency_key=idempotency_key,
            technique=technique.value,
            raw_artifact_id=raw_artifact.id if raw_artifact else None,
            source_filename=display_name,
            source_sha256=sha256,
            source_size_bytes=size,
            created_by=identity.user_id,
        )
        session.add(upload)
        session.flush()
        _store_preview(session, identity, object_store, upload, body, preview_sha256, {})
        audit(session, identity, project_id=project.id, event_name="experimental_spectrum.uploaded", entity_type="experimental.spectrum.upload", entity_id=upload.id, artifacts=[artifact_ref(raw_artifact)] if raw_artifact else [], metadata=[{"key": "source_sha256", "value": sha256}, {"key": "technique", "value": technique.value}])
        session.commit()
        session.refresh(upload)
    return _upload_view(session, object_store, settings, upload)


def resolve_spectrum_upload(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    *,
    project_id: str,
    upload_id: str,
    choices: SpectrumChoices,
    runner: SpectraRunner | None = None,
) -> SpectrumUploadView:
    """Re-run the deterministic worker on the stored raw bytes with the user's choices. Writes a new preview, nothing authoritative."""
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    upload = _get_upload(session, project.id, upload_id)
    if _confirmation_for(session, upload.id) is not None:
        raise ExperimentalSpectrumConflict("This upload was already imported; its preview can no longer change.")
    if upload.raw_artifact_id is None:
        raise ExperimentalSpectrumConflict("This upload was rejected before storage and cannot be previewed again.")
    _, data = read_artifact(session, object_store, settings, upload.raw_artifact_id, project.id, expected_sha256=upload.source_sha256)
    choice_dict = choices.model_dump(mode="json", exclude_none=True)
    with tempfile.TemporaryDirectory(prefix="chemdft-spectrum-resolve-") as tmp:
        source_path = Path(tmp) / "source"
        source_path.write_bytes(data)
        body, preview_sha256, _ = run_resolve(settings, runner, source_path, upload.technique, choice_dict, upload.source_sha256, upload.source_size_bytes)
    _store_preview(session, identity, object_store, upload, body, preview_sha256, choice_dict)
    session.commit()
    return _upload_view(session, object_store, settings, upload)


def list_spectrum_uploads(session: Session, identity: Identity, object_store: ObjectStore, settings: Settings, project_id: str) -> SpectrumUploadListOutput:
    project, _ = authorize_project_access(session, identity, project_id)
    rows = session.scalars(select(SpectrumUploadRecord).where(SpectrumUploadRecord.project_id == project.id).order_by(SpectrumUploadRecord.created_at.desc())).all()
    return SpectrumUploadListOutput(uploads=tuple(_upload_view(session, object_store, settings, row) for row in rows))


def get_spectrum_upload(session: Session, identity: Identity, object_store: ObjectStore, settings: Settings, project_id: str, upload_id: str) -> SpectrumUploadView:
    project, _ = authorize_project_access(session, identity, project_id)
    return _upload_view(session, object_store, settings, _get_upload(session, project.id, upload_id))


# ------------------------------------------------------------------------------------------------ firewall for spectrum datasets
def accept_spectrum_dataset(producer: TrustedProducerContext, *, project_id: str, kind: SpectrumDatasetKind) -> None:
    """Only an issued trusted producer may publish a spectrum dataset: the import pipeline for RAW, the deterministic-transform
    producer for derived versions. Neither can ever write a calculation result."""
    if not is_issued_trusted_producer(producer):
        raise TrustedProducerRequired()
    expected = ProducerType.VALIDATED_IMPORT_PIPELINE if kind is SpectrumDatasetKind.RAW else ProducerType.VALIDATED_DETERMINISTIC_TRANSFORM
    if producer.producer_type is not expected:
        raise TrustedProducerRequired(f"{kind.value} spectrum datasets require the {expected.value} producer.")
    if str(producer.project_id) != project_id:
        raise CrossProjectReference("Spectrum producer capability is scoped to another project.")


def _import_parameters(upload: SpectrumUploadRecord, preview: SpectrumPreviewRecord, body: dict) -> list[dict[str, Any]]:
    x, y = body["x"], body["y"]
    return [
        {"key": "technique", "value": upload.technique},
        {"key": "source_sha256", "value": upload.source_sha256},
        {"key": "source_filename", "value": upload.source_filename},
        {"key": "preview_sha256", "value": preview.preview_sha256},
        {"key": "parser", "value": body["parser"]["name"]},
        {"key": "parser_version", "value": body["parser"]["version"]},
        {"key": "worker_version", "value": body["worker_version"]},
        {"key": "x_unit", "value": x["unit"]},
        {"key": "x_unit_evidence", "value": x["unit_evidence"]},
        {"key": "y_quantity", "value": y["quantity"]},
        {"key": "y_unit", "value": y["unit"]},
        {"key": "y_unit_evidence", "value": y["unit_evidence"]},
        {"key": "original_axis_direction", "value": x["direction_in_file"]},
        {"key": "point_count", "value": str(body["point_count"])},
        {"key": "arrays_sha256", "value": body["arrays"]["artifact_sha256"]},
    ]


def confirm_spectrum_upload(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    *,
    project_id: str,
    upload_id: str,
    payload: SpectrumConfirmInput,
    runner: SpectraRunner | None = None,
) -> SpectrumDatasetView:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    upload = _get_upload(session, project.id, upload_id)
    existing = _confirmation_for(session, upload.id)
    if existing is not None:
        if existing.idempotency_key == payload.idempotency_key and existing.preview_sha256 == payload.preview_sha256:
            return get_spectrum_dataset(session, identity, object_store, settings, project_id, existing.dataset_id)
        raise ExperimentalSpectrumConflict("This upload was already imported.")
    preview = session.scalar(select(SpectrumPreviewRecord).where(SpectrumPreviewRecord.upload_id == upload.id, SpectrumPreviewRecord.preview_sha256 == payload.preview_sha256))
    if preview is None:
        raise ExperimentalSpectrumPreviewMismatch()
    if preview.status != "READY":
        raise ExperimentalSpectrumConflict("Only a READY preview (every unit confirmed) can be imported.")
    if upload.raw_artifact_id is None:
        raise ExperimentalSpectrumSourceChanged("The immutable source artifact is missing.")
    # 1) the source file must still be exactly what was previewed
    raw_artifact, data = read_artifact(session, object_store, settings, upload.raw_artifact_id, project.id, expected_sha256=upload.source_sha256)
    # 2) the stored preview must still hash to exactly what the user confirmed
    document = _load_preview(session, object_store, settings, preview)
    if document.preview_sha256 != payload.preview_sha256 or document.body.source.sha256 != upload.source_sha256 or document.body.status is not SpectrumPreviewStatus.READY:
        raise ExperimentalSpectrumPreviewMismatch()
    # 3) the deterministic worker must reproduce that exact preview and arrays from the stored bytes
    with tempfile.TemporaryDirectory(prefix="chemdft-spectrum-confirm-") as tmp:
        source_path = Path(tmp) / "source"
        source_path.write_bytes(data)
        body, reproduced_sha, arrays = run_resolve(settings, runner, source_path, upload.technique, preview.choices_json, upload.source_sha256, upload.source_size_bytes)
    if reproduced_sha != payload.preview_sha256 or arrays is None:
        raise ExperimentalSpectrumPreviewMismatch("The worker no longer reproduces the confirmed preview from the stored source.")
    if hashlib.sha256(arrays).hexdigest() != body["arrays"]["artifact_sha256"]:
        raise ExperimentalSpectrumSourceChanged("The reproduced arrays do not match the preview.")
    technique = SpectrumTechnique(upload.technique)
    producer = issue_trusted_producer_context(
        producer_id=PRODUCER_ID,
        producer_type=ProducerType.VALIDATED_IMPORT_PIPELINE,
        project_id=UUID(project.id),
        attestation_id=f"experimental-spectrum:{upload.id}:preview:{preview.preview_sha256}",
    )
    accept_spectrum_dataset(producer, project_id=project.id, kind=SpectrumDatasetKind.RAW)
    association = payload.association
    if association is not None and association.structure_id is not None:
        _require_structure(session, project.id, str(association.structure_id))
    n = body["point_count"]
    stem = upload.source_filename.rsplit(".", 1)[0] if "." in upload.source_filename else upload.source_filename
    name = (body.get("display_name") or stem)[:160]
    try:
        experiment = ExperimentRecord(
            project_id=project.id,
            name=name,
            modality=MODALITY_BY_TECHNIQUE[technique].value,
            sample_id=None,
            instrument_reference=(body["instrument"]["value"] if body["instrument"]["status"] != "NOT_SUPPLIED" else None),
            conditions_json=[],
            operator_or_source=f"file:{upload.source_filename}"[:256],
            created_by=identity.user_id,
        )
        session.add(experiment)
        session.flush()
        arrays_artifact = put_artifact(session, identity, object_store, project_id=project.id, data=arrays, kind=ScientificArtifactKind.SPECTRUM_DATA, media_type=ARRAYS_MEDIA_TYPE, format_identifier=ARRAYS_FORMAT, source_relation_id=raw_artifact.id)
        preview_artifact = session.get(ScientificArtifactRecord, preview.preview_artifact_id)
        if preview_artifact is None:
            raise ExperimentalSpectrumSourceChanged("The stored preview artifact is missing.")
        dataset_id = new_id()
        provenance = ProvenanceRecordRow(
            project_id=project.id,
            subject_type="experimental.dataset",
            subject_id=dataset_id,
            source_class=ProvenanceClass.EXPERIMENTAL,
            detail=ProvenanceDetail.DIRECT_ACQUISITION,
            verification_state=VerificationState.UNVERIFIED,
            producer_kind=ProducerKind.SOFTWARE,
            producer_identifier=PRODUCER_ID,
            producer_software_version=body["worker_version"],
            source_artifact_id=raw_artifact.id,
            operation="chemdft.experimental-spectrum.import",
            operation_version="1.0.0",
            parameters_json=_import_parameters(upload, preview, body),
            approximate=False,
            supersedes_id=None,
            correlation_id=upload.id,
        )
        session.add(provenance)
        session.flush()
        session.add_all(
            [
                ProvenanceInputRow(provenance_record_id=provenance.id, project_id=project.id, position=0, input_type="ARTIFACT", input_id=raw_artifact.id, input_sha256=raw_artifact.sha256),
                ProvenanceInputRow(provenance_record_id=provenance.id, project_id=project.id, position=1, input_type="ARTIFACT", input_id=preview_artifact.id, input_sha256=preview_artifact.sha256),
            ]
        )
        x, y = body["x"], body["y"]
        spectrum_json: dict[str, Any] = {
            "contract": "chemdft.experimental-spectrum.dataset",
            "contract_version": "1.0.0",
            "kind": SpectrumDatasetKind.RAW.value,
            "technique": technique.value,
            "authority": SpectrumAuthority.RAW_MEASUREMENT.value,
            "name": name,
            "root_dataset_id": dataset_id,
            "parent_dataset_id": None,
            "x_order": x["direction_in_file"],
            "x": {k: x[k] for k in ("unit", "quantity", "unit_evidence", "unit_evidence_text", "label_in_file", "min", "max")},
            "y": {k: y[k] for k in ("quantity", "unit", "unit_evidence", "unit_evidence_text", "label_in_file", "min", "max")},
            "y_error": body["y_error"],
            "representation": "ABSOLUTE",
            "arrays": {"artifact_sha256": arrays_artifact.sha256, "xy_sha256": hashlib.sha256(arrays[: n * 16]).hexdigest(), "point_count": n, "layout": body["arrays"]["layout"], "x_sha256": body["arrays"]["x_sha256"], "y_sha256": body["arrays"]["y_sha256"], "y_error_sha256": body["arrays"]["y_error_sha256"]},
            "baseline_artifact_id": None,
            "source": {
                "sha256": upload.source_sha256,
                "size_bytes": upload.source_size_bytes,
                "original_name": upload.source_filename,
                **{k: body["source"][k] for k in ("encoding", "newline", "delimiter", "decimal", "orientation")},
                "raw_artifact_id": raw_artifact.id,
                "preview_artifact_id": preview_artifact.id,
                "preview_sha256": preview.preview_sha256,
            },
            "parser": body["parser"],
            "worker_version": body["worker_version"],
            "acquisition": body["acquisition"],
            "instrument": body["instrument"],
            "sample": body["sample"],
            "metadata_verbatim": body["metadata_verbatim"],
            "provenance_record_id": provenance.id,
        }
        dataset = ExperimentalDatasetRecord(
            id=dataset_id,
            project_id=project.id,
            experiment_id=experiment.id,
            state=DatasetProcessingState.RAW.value,
            artifact_id=arrays_artifact.id,
            source_class=ProvenanceClass.EXPERIMENTAL.value,
            axes_json=axes_for(technique.value, x["unit"], x["quantity"], y["quantity"], y["unit"], "ABSOLUTE", x["direction_in_file"]),
            values_json=[],
            point_count=n,
            processing_json=[],
            input_dataset_ids_json=[],
            spectrum_json=spectrum_json,
            created_by=identity.user_id,
        )
        session.add(dataset)
        session.flush()
        session.add(SpectrumConfirmationRecord(project_id=project.id, upload_id=upload.id, preview_id=preview.id, preview_sha256=preview.preview_sha256, dataset_id=dataset.id, idempotency_key=payload.idempotency_key, confirmed_by=identity.user_id))
        if association is not None and association.state is not AssociationState.UNASSIGNED:
            _add_association(session, identity, project.id, dataset.id, association)
        audit(session, identity, project_id=project.id, event_name="experimental_spectrum.imported", entity_type="experimental.dataset", entity_id=dataset.id, artifacts=[artifact_ref(raw_artifact), artifact_ref(preview_artifact), artifact_ref(arrays_artifact)], metadata=[{"key": "preview_sha256", "value": preview.preview_sha256}, {"key": "technique", "value": technique.value}])
        session.commit()
    except Exception:
        session.rollback()
        raise
    return get_spectrum_dataset(session, identity, object_store, settings, project_id, dataset_id)


# ------------------------------------------------------------------------------------------------ associations
def _require_structure(session: Session, project_id: str, structure_id: str) -> StructureRecord:
    structure = session.get(StructureRecord, structure_id)
    if structure is None or structure.project_id != project_id:
        raise ScientificReferenceNotFound("Structure does not exist in this project.")
    return structure


def _add_association(session: Session, identity: Identity, project_id: str, dataset_id: str, association: SpectrumAssociationInput) -> SpectrumAssociationRecord:
    record = SpectrumAssociationRecord(
        project_id=project_id,
        dataset_id=dataset_id,
        state=association.state.value,
        structure_id=str(association.structure_id) if association.structure_id else None,
        sample_label=association.sample_label,
        note=association.note,
        created_by=identity.user_id,
    )
    session.add(record)
    session.flush()
    return record


def current_association(session: Session, dataset: ExperimentalDatasetRecord) -> SpectrumAssociationView:
    """The newest association of the dataset, else the nearest ancestor's, else UNASSIGNED."""
    cursor: ExperimentalDatasetRecord | None = dataset
    seen: set[str] = set()
    while cursor is not None and cursor.id not in seen:
        seen.add(cursor.id)
        row = session.scalar(select(SpectrumAssociationRecord).where(SpectrumAssociationRecord.dataset_id == cursor.id).order_by(SpectrumAssociationRecord.created_at.desc(), SpectrumAssociationRecord.id.desc()))
        if row is not None:
            structure = session.get(StructureRecord, row.structure_id) if row.structure_id else None
            return SpectrumAssociationView(
                id=UUID(row.id),
                dataset_id=UUID(dataset.id),
                state=AssociationState(row.state),
                structure_id=UUID(row.structure_id) if row.structure_id else None,
                structure_name=structure.name if structure else None,
                sample_label=row.sample_label,
                note=row.note,
                created_at=row.created_at,
                created_by=UUID(row.created_by),
            )
        parent_id = (cursor.spectrum_json or {}).get("parent_dataset_id")
        cursor = session.get(ExperimentalDatasetRecord, parent_id) if parent_id else None
    return SpectrumAssociationView(id=None, dataset_id=UUID(dataset.id), state=AssociationState.UNASSIGNED, structure_id=None, structure_name=None, sample_label=None, note=None, created_at=None, created_by=None)


def set_spectrum_association(session: Session, identity: Identity, *, project_id: str, dataset_id: str, payload: SpectrumAssociationInput) -> SpectrumAssociationView:
    """Append a new association record. History is kept; the newest row is current. Spectra need not belong to one molecule."""
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    dataset = _get_spectrum_row(session, project.id, dataset_id)
    if payload.structure_id is not None:
        _require_structure(session, project.id, str(payload.structure_id))
    _add_association(session, identity, project.id, dataset.id, payload)
    audit(session, identity, project_id=project.id, event_name="experimental_spectrum.associated", entity_type="experimental.dataset", entity_id=dataset.id, artifacts=[], metadata=[{"key": "state", "value": payload.state.value}])
    session.commit()
    session.refresh(dataset)
    return current_association(session, dataset)


# ------------------------------------------------------------------------------------------------ dataset views
def _get_spectrum_row(session: Session, project_id: str, dataset_id: str) -> ExperimentalDatasetRecord:
    row = session.get(ExperimentalDatasetRecord, dataset_id)
    if row is None or row.project_id != project_id or row.spectrum_json is None:
        raise ScientificReferenceNotFound("Experimental spectrum dataset does not exist in this project.")
    return row


def _supplied(value: dict[str, Any] | None) -> Supplied | None:
    return Supplied.model_validate(value) if value else None


def transform_view(record: dict[str, Any], record_sha256: str) -> TransformRecordView:
    output = {k: v for k, v in record["output"].items() if k != "aux"}
    return TransformRecordView(
        op=record["op"],
        library=record["library"],
        library_version=record["library_version"],
        parameters=tuple(flatten(record["params"])),
        resolved=tuple(flatten(record["resolved"])),
        warnings=tuple(SpectrumWarning(**w) for w in record["warnings"]),
        input=VersionIO(**record["input"]),
        output=VersionIO(**output),
        aux=tuple(AuxHash(name=k, **v) for k, v in sorted(record["output"].get("aux", {}).items())),
        input_was_descending=record["input_was_descending"],
        environment=tuple(flatten(record["environment"])),
        record_sha256=record_sha256,
        authority="DETERMINISTIC_TRANSFORM",
    )


def peak_set_view(record: dict[str, Any], record_sha256: str) -> PeakSetView:
    return PeakSetView(
        algorithm=record["algorithm"],
        library=record["library"],
        library_version=record["library_version"],
        parameters=tuple(flatten(record["params"])),
        resolved=tuple(flatten(record["resolved"])),
        warnings=tuple(SpectrumWarning(**w) for w in record["warnings"]),
        input=VersionIO(**record["input"]),
        peaks=tuple(SpectrumPeak(**{**p, "refined": bool(p["refined"])}) for p in record["peaks"]),
        peak_count=record["peak_count"],
        environment=tuple(flatten(record["environment"])),
        record_sha256=record_sha256,
        authority="DERIVED_NOT_RAW",
    )


def _artifact_ref_view(session: Session, artifact_id: str | None) -> ArtifactRef | None:
    artifact = session.get(ScientificArtifactRecord, artifact_id) if artifact_id else None
    return ArtifactRef(artifact_id=UUID(artifact.id), sha256=artifact.sha256, size_bytes=artifact.size_bytes) if artifact else None


def _lineage(session: Session, row: ExperimentalDatasetRecord) -> tuple[UUID, ...]:
    chain: list[UUID] = []
    cursor = row
    while True:
        parent_id = (cursor.spectrum_json or {}).get("parent_dataset_id")
        parent = session.get(ExperimentalDatasetRecord, parent_id) if parent_id else None
        if parent is None:
            break
        chain.append(UUID(parent.id))
        cursor = parent
    return tuple(reversed(chain))


def _processing_steps(session: Session, row: ExperimentalDatasetRecord) -> tuple[SpectrumProcessingStepView, ...]:
    steps = []
    for entry in row.processing_json or []:
        steps.append(
            SpectrumProcessingStepView(
                dataset_id=UUID(entry["dataset_id"]),
                op=entry["op"],
                library=entry["library"],
                library_version=entry["library_version"],
                record_sha256=entry["record_sha256"],
                output_artifact_sha256=entry["output_artifact_sha256"],
                performed_at=entry["performed_at"],
            )
        )
    return tuple(steps)


def dataset_view(session: Session, row: ExperimentalDatasetRecord, *, children: tuple[UUID, ...] | None = None) -> SpectrumDatasetView:
    spec = row.spectrum_json or {}
    experiment = session.get(ExperimentRecord, row.experiment_id)
    if experiment is None:
        raise ScientificReferenceNotFound("The experiment of this spectrum is missing.")
    kind = SpectrumDatasetKind(spec["kind"])
    technique = SpectrumTechnique(spec["technique"])
    if children is None:
        siblings = session.scalars(select(ExperimentalDatasetRecord).where(ExperimentalDatasetRecord.project_id == row.project_id, ExperimentalDatasetRecord.spectrum_json.is_not(None))).all()
        children = tuple(UUID(s.id) for s in siblings if row.id in (s.input_dataset_ids_json or []))
    x, y = spec["x"], spec["y"]
    axes = [AxisDefinition.model_validate(a) for a in row.axes_json]
    arrays = spec.get("arrays") or {}
    peak_record = spec.get("peaks")
    transform_record = spec.get("transform")
    source = spec.get("source")
    return SpectrumDatasetView(
        id=UUID(row.id),
        project_id=UUID(row.project_id),
        experiment_id=UUID(row.experiment_id),
        modality=ExperimentModality(experiment.modality),
        technique=technique,
        name=spec.get("name") or experiment.name,
        kind=kind,
        state=DatasetProcessingState(row.state),
        source_class=ProvenanceClass(row.source_class),
        authority=SpectrumAuthority(spec["authority"]),
        parent_dataset_id=UUID(spec["parent_dataset_id"]) if spec.get("parent_dataset_id") else None,
        lineage=_lineage(session, row),
        arrays=_artifact_ref_view(session, row.artifact_id) if kind is not SpectrumDatasetKind.PEAKS else None,
        baseline_curve=_artifact_ref_view(session, spec.get("baseline_artifact_id")),
        x=SpectrumAxisView(definition=axes[0], quantity=x.get("quantity"), unit_evidence=x["unit_evidence"], unit_evidence_text=x["unit_evidence_text"], label_in_file=x.get("label_in_file")),
        y=SpectrumAxisView(definition=axes[1], quantity=y.get("quantity"), unit_evidence=y["unit_evidence"], unit_evidence_text=y["unit_evidence_text"], label_in_file=y.get("label_in_file")),
        y_error_present=bool(spec.get("y_error")),
        representation=spec["representation"],
        point_count=row.point_count,
        x_min=x.get("min"),
        x_max=x.get("max"),
        x_order=spec["x_order"],
        arrays_sha256=arrays.get("artifact_sha256"),
        source=(
            SpectrumSourceView(
                sha256=source["sha256"],
                size_bytes=source["size_bytes"],
                original_name=source["original_name"],
                encoding=source.get("encoding"),
                newline=source.get("newline"),
                delimiter=source.get("delimiter"),
                decimal=source.get("decimal"),
                orientation=source.get("orientation"),
                parser_name=spec["parser"]["name"],
                parser_version=spec["parser"]["version"],
                worker_version=spec["worker_version"],
                preview_sha256=source["preview_sha256"],
                original_axis_direction=spec["x_order"],
                raw_artifact_id=UUID(source["raw_artifact_id"]) if source.get("raw_artifact_id") else None,
            )
            if source
            else None
        ),
        acquisition=spec.get("acquisition"),
        instrument=_supplied(spec.get("instrument")),
        sample=_supplied(spec.get("sample")),
        metadata_verbatim=tuple(spec.get("metadata_verbatim") or ()),
        processing=_processing_steps(session, row),
        transform=transform_view(transform_record, spec["record_sha256"]) if transform_record else None,
        peak_set=peak_set_view(peak_record, spec["record_sha256"]) if peak_record else None,
        association=current_association(session, row),
        provenance_record_id=UUID(spec["provenance_record_id"]),
        children=children,
        created_at=row.created_at,
        created_by=UUID(row.created_by),
    )


def get_spectrum_dataset(session: Session, identity: Identity, object_store: ObjectStore, settings: Settings, project_id: str, dataset_id: str) -> SpectrumDatasetView:
    del object_store, settings
    project, _ = authorize_project_access(session, identity, project_id)
    return dataset_view(session, _get_spectrum_row(session, project.id, dataset_id))


def list_spectrum_datasets(session: Session, identity: Identity, project_id: str) -> SpectrumDatasetListOutput:
    project, _ = authorize_project_access(session, identity, project_id)
    rows = session.scalars(select(ExperimentalDatasetRecord).where(ExperimentalDatasetRecord.project_id == project.id, ExperimentalDatasetRecord.spectrum_json.is_not(None)).order_by(ExperimentalDatasetRecord.created_at, ExperimentalDatasetRecord.id)).all()
    children: dict[str, list[UUID]] = {}
    for row in rows:
        for parent in row.input_dataset_ids_json or []:
            children.setdefault(parent, []).append(UUID(row.id))
    return SpectrumDatasetListOutput(datasets=tuple(dataset_view(session, row, children=tuple(children.get(row.id, ()))) for row in rows))


# ------------------------------------------------------------------------------------------------ arrays
def _decimate_minmax(x: array, columns: list[array], limit: int) -> tuple[array, list[array]]:
    """Display-only min/max bucket decimation of the first column; the stored arrays are never changed."""
    n = len(x)
    buckets = max(limit // 2, 1)
    keep: list[int] = []
    first = columns[0]
    for b in range(buckets):
        lo, hi = b * n // buckets, (b + 1) * n // buckets
        if hi <= lo:
            continue
        window = first[lo:hi]
        i_min = lo + min(range(len(window)), key=window.__getitem__)
        i_max = lo + max(range(len(window)), key=window.__getitem__)
        keep.extend(sorted({i_min, i_max}))
    keep = sorted(set(keep))
    return array("d", (x[i] for i in keep)), [array("d", (c[i] for i in keep)) for c in columns]


def get_spectrum_arrays(session: Session, identity: Identity, object_store: ObjectStore, settings: Settings, project_id: str, dataset_id: str, max_points: int | None = None) -> SpectrumArraysView:
    project, _ = authorize_project_access(session, identity, project_id)
    row = _get_spectrum_row(session, project.id, dataset_id)
    spec = row.spectrum_json or {}
    if spec["kind"] == SpectrumDatasetKind.PEAKS.value:
        raise ExperimentalSpectrumConflict("A peak set has no sampled arrays; read its peaks instead.")
    expected = spec["arrays"]["artifact_sha256"]
    _, data = read_artifact(session, object_store, settings, row.artifact_id, project.id, expected_sha256=expected)
    n = row.point_count
    x = decode_floats(data, n)
    y = array("d")
    y.frombytes(data[n * 8 : n * 16])
    err = None
    if spec.get("y_error"):
        err = array("d")
        err.frombytes(data[n * 16 : n * 24])
    baseline = None
    if spec.get("baseline_artifact_id"):
        _, aux = read_artifact(session, object_store, settings, spec["baseline_artifact_id"], project.id)
        baseline = array("d")
        baseline.frombytes(aux[: n * 8])
    if sys.byteorder == "big":  # pragma: no cover - arrays are stored little-endian
        for values in (y, err, baseline):
            if values is not None:
                values.byteswap()
    columns = [c for c in (y, err, baseline) if c is not None]
    decimated = False
    if max_points is not None and 4 <= max_points < n:
        x, columns = _decimate_minmax(x, columns, min(max_points, 2 * MAX_DISPLAY_POINTS * 25))
        decimated = True
    y_out = columns[0]
    idx = 1
    err_out = None
    if err is not None:
        err_out = columns[idx]
        idx += 1
    base_out = columns[idx] if baseline is not None else None
    return SpectrumArraysView(
        dataset_id=UUID(row.id),
        x=tuple(x),
        y=tuple(y_out),
        y_error=tuple(err_out) if err_out is not None else None,
        baseline=tuple(base_out) if base_out is not None else None,
        baseline_x=tuple(x) if base_out is not None else None,
        point_count=n,
        returned_points=len(x),
        decimated=decimated,
        arrays_sha256=expected,
    )


# ------------------------------------------------------------------------------------------------ shared by processing/comparison
def parent_arrays_for_worker(session: Session, object_store: ObjectStore, settings: Settings, row: ExperimentalDatasetRecord) -> bytes:
    """x then y of a stored version (verified against its recorded hash). A raw y-uncertainty column is not passed to the worker."""
    spec = row.spectrum_json or {}
    _, data = read_artifact(session, object_store, settings, row.artifact_id, row.project_id, expected_sha256=spec["arrays"]["artifact_sha256"])
    n = row.point_count
    xy = data[: n * 16]
    if hashlib.sha256(xy).hexdigest() != spec["arrays"]["xy_sha256"]:
        raise ExperimentalSpectrumSourceChanged()
    return xy


def find_operation(session: Session, project_id: str, idempotency_key: str, request_sha256: str) -> SpectrumOperationRecord | None:
    existing = session.scalar(select(SpectrumOperationRecord).where(SpectrumOperationRecord.project_id == project_id, SpectrumOperationRecord.idempotency_key == idempotency_key))
    if existing is not None and existing.request_sha256 != request_sha256:
        raise ExperimentalSpectrumConflict("This idempotency key was already used for a different request.")
    return existing


def worker_refusal(outcome: RunnerOutcome) -> ExperimentalSpectrumInvalid:
    if outcome.failure or outcome.document is None:
        return ExperimentalSpectrumInvalid(f"WORKER_{(outcome.failure or 'failed').upper()}: {outcome.detail or 'the worker failed'}")
    error = outcome.document.get("error", {})
    return ExperimentalSpectrumInvalid(f"{error.get('code', 'WORKER_ERROR')}: {error.get('message', 'the worker refused the request')}")


__all__ = [
    "PARSER_VERSION",
    "PEAKS_SCHEMA",
    "TRANSFORM_SCHEMA",
    "WORKER_VERSION",
    "accept_spectrum_dataset",
    "confirm_spectrum_upload",
    "create_spectrum_upload",
    "current_association",
    "dataset_view",
    "get_spectrum_arrays",
    "get_spectrum_dataset",
    "get_spectrum_upload",
    "list_spectrum_datasets",
    "list_spectrum_uploads",
    "resolve_spectrum_upload",
    "set_spectrum_association",
]
