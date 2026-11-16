"""External Computational Import: upload -> preview (no scientific writes) -> hash-bound confirmation -> transactional import.

Authority model (never weakened):
  * The raw uploaded output is an immutable `CALCULATION_OUTPUT` artifact (SHA-256, never rewritten).
  * A preview is a hash-bound `NORMALIZED_RESULT` artifact. Creating it writes NO structure and NO result.
  * Confirmation must quote the exact stored preview hash; the source file is re-hashed first. If either changed: rejected.
  * Imported results live in their own table (`imported_results`) with `source_class = IMPORTED`, `authority = IMPORTED` and
    producer `VALIDATED_IMPORT_PIPELINE`. They are never `CalculationResult`s and never marked CALCULATED/AUTHORITATIVE.
"""
# ruff: noqa: E501  (long human-readable diagnostics and separators)

from __future__ import annotations

import hashlib
import json
import tempfile
from io import BytesIO
from pathlib import Path
from typing import BinaryIO
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .actions import authorize_project_access, register_raw_file
from .config import Settings
from .context import Identity
from .contracts.artifacts import ScientificArtifactKind, ScientificArtifactRegistration
from .contracts.external_import import (
    IMPORTED_RESULT_TYPES,
    ExternalImportConfirmation,
    ExternalImportConfirmInput,
    ExternalImportDetail,
    ExternalImportJobView,
    ExternalImportListOutput,
    ExternalImportSourceView,
    ExternalImportSummaryView,
    ExternalImportView,
    ImportedResultView,
    ImportedStructurePayload,
    ImportPreviewReport,
    ImportPreviewView,
    ImportResultEntry,
    ImportResultSummary,
    body_sha256,
    canonical_json,
)
from .contracts.provenance import (
    ProducerKind,
    ProvenanceClass,
    ProvenanceDetail,
    VerificationState,
)
from .contracts.results import ResultAuthority, ResultValidationState
from .contracts.scientific import (
    CoordinateSystem,
    CoordinateUnit,
    DiagnosticSeverity,
    StructureDiagnosticCode,
    StructureKind,
    StructureVersionOrigin,
)
from .errors import (
    CrossProjectReference,
    ExternalImportConflict,
    ExternalImportPreviewMismatch,
    ExternalImportSourceChanged,
    ProjectAccessDenied,
    ScientificReferenceNotFound,
    ScientificValidationFailed,
    TrustedProducerRequired,
    UploadTooLarge,
)
from .external_import_runner import (
    IMPORTER_VERSION,
    ImportRunner,
    rejected_report,
    run_import_worker,
    sanitize_filename,
)
from .models import new_id
from .project_access import ProjectCapability, can
from .scientific.structures import (
    CanonicalStructureCandidate,
    StructureSourceFormat,
    canonical_document,
    diagnostic,
)
from .scientific_actions import (
    _audit_structure_event,
    _persist_canonical_artifact,
    register_scientific_artifact,
)
from .scientific_models import (
    AuditEventRecord,
    ExternalImportConfirmationRecord,
    ExternalImportJobRecord,
    ExternalImportRecord,
    ImportedResultRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureRecord,
    StructureVersionRecord,
)
from .storage import ObjectStore
from .trusted_producers import (
    ProducerType,
    TrustedProducerContext,
    is_issued_trusted_producer,
    issue_trusted_producer_context,
)

SOURCE_MEDIA_CLASS = "text/plain; chemdft=external-output"
PRODUCER_ID = "chemdft.external-import.pipeline"
PREVIEW_MEDIA_TYPE = "application/vnd.chemdft.external-import-preview+json"
PREVIEW_FORMAT = "chemdft.external-import.preview"


# ------------------------------------------------------------------------------------------------ helpers
def _stream_to_file(stream: BinaryIO, path: Path, max_bytes: int) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("xb") as target:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            if size > max_bytes:
                raise UploadTooLarge("The file exceeds the external-import size limit.")
            digest.update(chunk)
            target.write(chunk)
    return digest.hexdigest(), size


def _store_json_artifact(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    *,
    project_id: str,
    data: bytes,
    source_relation_id: str | None,
) -> ScientificArtifactRecord:
    stored = object_store.put_raw(project_id, BytesIO(data), len(data) + 1)
    record = ScientificArtifactRecord(
        project_id=project_id,
        kind=ScientificArtifactKind.NORMALIZED_RESULT,
        media_type=PREVIEW_MEDIA_TYPE,
        format_identifier=PREVIEW_FORMAT,
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


def _audit(
    session: Session,
    identity: Identity,
    *,
    project_id: str,
    event_name: str,
    import_id: str,
    artifacts: list[dict],
    metadata: list[dict] | None = None,
) -> None:
    session.add(
        AuditEventRecord(
            event_name=event_name,
            actor_or_service_id=identity.user_id,
            organization_id=identity.organization_id,
            project_id=project_id,
            request_id=new_id(),
            targets_json=[
                {"project_id": project_id, "entity_type": "external.import", "entity_id": import_id}
            ],
            outcome="SUCCEEDED",
            artifact_references_json=artifacts,
            safe_metadata_json=metadata or [],
        )
    )


def _artifact_ref(record: ScientificArtifactRecord) -> dict:
    return {"project_id": record.project_id, "artifact_id": record.id, "sha256": record.sha256}


def _load_report(
    session: Session, object_store: ObjectStore, record: ExternalImportRecord, settings: Settings
) -> tuple[ImportPreviewReport, dict]:
    """Load the stored preview, verifying object-store integrity, the canonical body hash, and the full contract."""
    if record.preview_artifact_id is None:
        raise ExternalImportPreviewMismatch("The stored preview is missing.")
    artifact = session.get(ScientificArtifactRecord, record.preview_artifact_id)
    if artifact is None or artifact.project_id != record.project_id:
        raise ExternalImportPreviewMismatch("The stored preview artifact is missing.")
    data = object_store.get_bytes(artifact.storage_key, settings.max_import_bytes)
    if hashlib.sha256(data).hexdigest() != artifact.sha256:
        raise ExternalImportPreviewMismatch("The stored preview artifact was modified.")
    raw = json.loads(data)
    if (
        body_sha256(raw["body"]) != raw["preview_sha256"]
        or raw["preview_sha256"] != record.preview_sha256
    ):
        raise ExternalImportPreviewMismatch("The stored preview does not match its recorded hash.")
    return ImportPreviewReport.model_validate(raw), raw


def _preview_view(report: ImportPreviewReport) -> ImportPreviewView:
    body = report.body
    return ImportPreviewView(
        importer_version=body.importer_version,
        normalization_version=body.normalization_version,
        parser=body.parser,
        source=body.source,
        status=body.status,
        program=body.program,
        job=body.job,
        jobs=body.jobs,
        items=body.items,
        results=tuple(
            ImportResultSummary(result_type=r.result_type, source_attributes=r.source_attributes)
            for r in body.results
        ),
        diagnostics=body.diagnostics,
        cclib=body.cclib,
        semantic=body.semantic,
    )


def _state(
    record: ExternalImportRecord, confirmation: ExternalImportConfirmationRecord | None
) -> str:
    if confirmation is not None:
        return "IMPORTED"
    return record.state


def _import_view(
    session: Session,
    object_store: ObjectStore,
    settings: Settings,
    record: ExternalImportRecord,
    confirmation: ExternalImportConfirmationRecord | None,
) -> ExternalImportView:
    report, _ = _load_report(session, object_store, record, settings)
    return ExternalImportView(
        id=UUID(record.id),
        project_id=UUID(record.project_id),
        state=_state(record, confirmation),
        source=ExternalImportSourceView(
            sha256=record.source_sha256,
            size_bytes=record.source_size_bytes,
            original_name=record.source_filename,
            media_class=SOURCE_MEDIA_CLASS,
            uploaded_at=record.created_at,
            raw_artifact_id=UUID(record.raw_artifact_id) if record.raw_artifact_id else None,
        ),
        preview_sha256=record.preview_sha256,
        preview_artifact_id=UUID(record.preview_artifact_id)
        if record.preview_artifact_id
        else None,
        importer_version=record.importer_version,
        created_at=record.created_at,
        created_by=UUID(record.created_by),
        parse_timestamp=record.parse_timestamp,
        preview=_preview_view(report),
        confirmation=(
            ExternalImportConfirmation(
                confirmed_at=confirmation.confirmed_at,
                confirmed_by=UUID(confirmation.confirmed_by),
                preview_sha256=confirmation.preview_sha256,
            )
            if confirmation
            else None
        ),
    )


def _confirmation_for(session: Session, import_id: str) -> ExternalImportConfirmationRecord | None:
    return session.scalar(
        select(ExternalImportConfirmationRecord).where(
            ExternalImportConfirmationRecord.import_id == import_id
        )
    )


def _get_record(session: Session, project_id: str, import_id: str) -> ExternalImportRecord:
    record = session.get(ExternalImportRecord, import_id)
    if record is None or record.project_id != project_id:
        raise ScientificReferenceNotFound("External import does not exist in this project.")
    return record


# ------------------------------------------------------------------------------------------------ upload -> preview
def create_external_import(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    *,
    project_id: str,
    original_name: str | None,
    stream: BinaryIO,
    idempotency_key: str,
    runner: ImportRunner | None = None,
) -> ExternalImportView:
    """Safe ingestion + parse + validation + preview. Writes NO structure and NO imported result."""
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    existing = session.scalar(
        select(ExternalImportRecord).where(
            ExternalImportRecord.project_id == project.id,
            ExternalImportRecord.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        return _import_view(
            session, object_store, settings, existing, _confirmation_for(session, existing.id)
        )

    runner = runner or run_import_worker  # resolved at call time so tests can substitute the worker
    display_name = sanitize_filename(original_name)
    with tempfile.TemporaryDirectory(prefix="chemdft-import-upload-") as tmp:
        source_path = Path(tmp) / "upload"
        sha256, size = _stream_to_file(stream, source_path, settings.max_import_bytes)
        outcome = runner(source_path, settings)
        report = outcome.report
        try:
            validated = ImportPreviewReport.model_validate(report)
        except ValueError as error:
            report = rejected_report(
                sha256,
                size,
                "WORKER_OUTPUT_INVALID",
                f"The parser report failed validation: {str(error)[:300]}",
            )
            validated = ImportPreviewReport.model_validate(report)
        if validated.body.source.sha256 != sha256 or validated.body.source.size_bytes != size:
            report = rejected_report(
                sha256,
                size,
                "WORKER_OUTPUT_INVALID",
                "The parser report refers to a different file.",
            )
            validated = ImportPreviewReport.model_validate(report)
        body = validated.body
        # The raw bytes are kept (immutably) only when they passed the byte-level pre-check: hostile or binary data is never stored.
        keep_raw = body.source.encoding is not None
        raw_artifact: ScientificArtifactRecord | None = None
        if keep_raw:
            with source_path.open("rb") as handle:
                stored_file = register_raw_file(
                    session=session,
                    identity=identity,
                    object_store=object_store,
                    project_id=project.id,
                    original_name=display_name,
                    media_type="text/plain",
                    stream=handle,
                    max_upload_bytes=settings.max_import_bytes,
                    settings=settings,
                )
            engine = (body.program.engine or "unknown").lower()
            artifact = register_scientific_artifact(
                session,
                identity,
                ScientificArtifactRegistration(
                    project_id=UUID(project.id),
                    stored_file_id=stored_file.id,
                    kind=ScientificArtifactKind.CALCULATION_OUTPUT,
                    format_identifier=f"external.{engine}.output",
                    format_version=None,
                ),
            )
            raw_artifact = session.get(ScientificArtifactRecord, str(artifact.id))
            if raw_artifact is None or raw_artifact.sha256 != sha256:
                raise ScientificValidationFailed(
                    "The stored source file does not match the uploaded bytes."
                )
        preview_artifact = _store_json_artifact(
            session,
            identity,
            object_store,
            project_id=project.id,
            data=canonical_json(report),
            source_relation_id=raw_artifact.id if raw_artifact else None,
        )
        job = body.job
        record = ExternalImportRecord(
            project_id=project.id,
            idempotency_key=idempotency_key,
            state="PREVIEW_READY" if body.status == "READY" else "REJECTED",
            raw_artifact_id=raw_artifact.id if raw_artifact else None,
            preview_artifact_id=preview_artifact.id,
            source_filename=display_name,
            source_sha256=sha256,
            source_size_bytes=size,
            media_class=SOURCE_MEDIA_CLASS,
            engine=body.program.engine,
            program_label=body.program.label,
            job_type=job.job_type if job else None,
            method_value=job.method.value if job else None,
            basis_value=job.basis.value if job else None,
            preview_sha256=validated.preview_sha256,
            importer_version=body.importer_version,
            normalization_version=body.normalization_version,
            parser_commit=body.parser.commit,
            created_by=identity.user_id,
        )
        session.add(record)
        session.flush()
        _audit(
            session,
            identity,
            project_id=project.id,
            event_name="external_import.previewed",
            import_id=record.id,
            artifacts=[_artifact_ref(preview_artifact)]
            + ([_artifact_ref(raw_artifact)] if raw_artifact else []),
            metadata=[
                {"key": "status", "value": body.status},
                {"key": "preview_sha256", "value": validated.preview_sha256},
            ],
        )
        session.commit()
        session.refresh(record)
    return _import_view(session, object_store, settings, record, None)


# ------------------------------------------------------------------------------------------------ read
def list_external_imports(
    session: Session, identity: Identity, project_id: str
) -> ExternalImportListOutput:
    project, _ = authorize_project_access(session, identity, project_id)
    rows = session.scalars(
        select(ExternalImportRecord)
        .where(ExternalImportRecord.project_id == project.id)
        .order_by(ExternalImportRecord.created_at.desc())
    ).all()
    summaries = []
    for row in rows:
        confirmation = _confirmation_for(session, row.id)
        job = session.scalar(
            select(ExternalImportJobRecord).where(ExternalImportJobRecord.import_id == row.id)
        )
        summaries.append(
            ExternalImportSummaryView(
                id=UUID(row.id),
                project_id=UUID(row.project_id),
                state=_state(row, confirmation),
                source_filename=row.source_filename,
                source_sha256=row.source_sha256,
                engine=row.engine,
                program_label=row.program_label,
                job_type=row.job_type,
                method=row.method_value,
                basis=row.basis_value,
                preview_sha256=row.preview_sha256,
                created_at=row.created_at,
                confirmed_at=confirmation.confirmed_at if confirmation else None,
                structure_id=UUID(job.structure_id) if job else None,
            )
        )
    return ExternalImportListOutput(imports=tuple(summaries))


def _job_view(job: ExternalImportJobRecord) -> ExternalImportJobView:
    return ExternalImportJobView(
        id=UUID(job.id),
        import_id=UUID(job.import_id),
        job_index=job.job_index,
        line_range=(job.line_start, job.line_end),
        source_job_type=job.source_job_type,
        method=job.method_json,
        basis=job.basis_json,
        charge=job.charge,
        multiplicity=job.multiplicity,
        termination=job.termination_json,
        convergence=job.convergence_json,
        structure_id=UUID(job.structure_id),
        structure_version_id=UUID(job.structure_version_id),
        created_at=job.created_at,
    )


def _result_view(row: ImportedResultRecord) -> ImportedResultView:
    return ImportedResultView(
        id=UUID(row.id),
        project_id=UUID(row.project_id),
        import_id=UUID(row.import_id),
        import_job_id=UUID(row.import_job_id),
        result_type=row.result_type,
        payload=row.payload_json,
        payload_sha256=row.payload_sha256,
        producer_id=row.producer_id,
        provenance_record_id=UUID(row.provenance_record_id),
        source_attributes=tuple(row.source_attributes_json),
        source_locators=row.source_locators_json,
        normalization_version=row.normalization_version,
        created_at=row.created_at,
    )


def get_external_import_detail(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    project_id: str,
    import_id: str,
) -> ExternalImportDetail:
    project, _ = authorize_project_access(session, identity, project_id)
    record = _get_record(session, project.id, import_id)
    confirmation = _confirmation_for(session, record.id)
    jobs = session.scalars(
        select(ExternalImportJobRecord)
        .where(ExternalImportJobRecord.import_id == record.id)
        .order_by(ExternalImportJobRecord.job_index)
    ).all()
    results = session.scalars(
        select(ImportedResultRecord)
        .where(ImportedResultRecord.import_id == record.id)
        .order_by(ImportedResultRecord.created_at, ImportedResultRecord.result_type)
    ).all()
    return ExternalImportDetail(
        import_record=_import_view(session, object_store, settings, record, confirmation),
        jobs=tuple(_job_view(j) for j in jobs),
        results=tuple(_result_view(r) for r in results),
    )


def get_imported_result(
    session: Session, identity: Identity, project_id: str, result_id: str
) -> ImportedResultView:
    project, _ = authorize_project_access(session, identity, project_id)
    row = session.get(ImportedResultRecord, result_id)
    if row is None or row.project_id != project.id:
        raise ScientificReferenceNotFound("Imported result does not exist in this project.")
    return _result_view(row)


# ------------------------------------------------------------------------------------------------ firewall for imported results
def accept_imported_result(
    session: Session,
    producer: TrustedProducerContext,
    *,
    project_id: str,
    import_record: ExternalImportRecord,
    job: ExternalImportJobRecord,
    entry: dict,
    raw_artifact: ScientificArtifactRecord,
    preview_artifact: ScientificArtifactRecord,
) -> ImportedResultRecord:
    """Publish one imported result. Only a VALIDATED_IMPORT_PIPELINE producer may; the record can never be AUTHORITATIVE or CALCULATED."""
    if not is_issued_trusted_producer(producer):
        raise TrustedProducerRequired()
    if producer.producer_type is not ProducerType.VALIDATED_IMPORT_PIPELINE:
        raise TrustedProducerRequired(
            "Imported results require the validated import pipeline producer."
        )
    if (
        str(producer.project_id) != project_id
        or import_record.project_id != project_id
        or job.project_id != project_id
    ):
        raise CrossProjectReference("Import producer capability is scoped to another project.")
    if entry["result_type"] not in IMPORTED_RESULT_TYPES:
        raise ScientificValidationFailed("Unknown imported result type.")
    if raw_artifact.project_id != project_id or preview_artifact.project_id != project_id:
        raise CrossProjectReference()
    if raw_artifact.sha256 != import_record.source_sha256:
        raise ExternalImportSourceChanged()
    validated = ImportResultEntry.model_validate(
        entry
    )  # full payload contract, again, at the publication boundary
    payload_dict = entry["payload"]
    payload_hash = hashlib.sha256(canonical_json(payload_dict)).hexdigest()
    provenance = ProvenanceRecordRow(
        project_id=project_id,
        subject_type="imported.result",
        subject_id=new_id(),
        source_class=ProvenanceClass.IMPORTED,
        detail=ProvenanceDetail.IMPORTED_ENGINE_RESULT,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SOFTWARE,
        producer_identifier=PRODUCER_ID,
        producer_software_version=IMPORTER_VERSION,
        source_artifact_id=raw_artifact.id,
        operation=f"chemdft.external-import.{entry['result_type'].rsplit('.', 1)[-1]}",
        operation_version="1.0.0",
        parameters_json=_provenance_parameters(import_record, job, validated),
        approximate=False,
        supersedes_id=None,
        correlation_id=import_record.id,
    )
    session.add(provenance)
    session.flush()
    session.add_all(
        [
            ProvenanceInputRow(
                provenance_record_id=provenance.id,
                project_id=project_id,
                position=0,
                input_type="ARTIFACT",
                input_id=raw_artifact.id,
                input_sha256=raw_artifact.sha256,
            ),
            ProvenanceInputRow(
                provenance_record_id=provenance.id,
                project_id=project_id,
                position=1,
                input_type="ARTIFACT",
                input_id=preview_artifact.id,
                input_sha256=preview_artifact.sha256,
            ),
        ]
    )
    record = ImportedResultRecord(
        id=provenance.subject_id,
        project_id=project_id,
        import_id=import_record.id,
        import_job_id=job.id,
        result_type=entry["result_type"],
        payload_json=payload_dict,
        payload_sha256=payload_hash,
        source_class="IMPORTED",
        authority=ResultAuthority.IMPORTED.value,
        verification_state=VerificationState.UNVERIFIED.value,
        validation_state=ResultValidationState.VALIDATED.value,
        producer_type=producer.producer_type.value,
        producer_id=producer.producer_id,
        producer_attestation_id=producer.attestation_id,
        provenance_record_id=provenance.id,
        source_attributes_json=list(entry["source_attributes"]),
        source_locators_json=entry["source_locators"],
        normalization_version=import_record.normalization_version,
        idempotency_key=f"external-import:{import_record.id}:{entry['result_type']}",
    )
    session.add(record)
    session.flush()
    return record


def _provenance_parameters(
    import_record: ExternalImportRecord, job: ExternalImportJobRecord, entry: ImportResultEntry
) -> list[dict[str, object]]:
    payload = entry.payload
    return [
        {"key": "import_id", "value": import_record.id},
        {"key": "import_job_id", "value": job.id},
        {"key": "result_type", "value": entry.result_type},
        {"key": "source_program", "value": payload.source.program_label},
        {"key": "source_sha256", "value": import_record.source_sha256},
        {"key": "source_filename", "value": import_record.source_filename},
        {"key": "preview_sha256", "value": import_record.preview_sha256},
        {"key": "parser", "value": "cclib"},
        {"key": "parser_commit", "value": import_record.parser_commit},
        {"key": "importer_version", "value": import_record.importer_version},
        {"key": "normalization_version", "value": import_record.normalization_version},
        {"key": "source_attributes", "value": ",".join(entry.source_attributes)},
    ]


# ------------------------------------------------------------------------------------------------ structure from the imported geometry
def _create_imported_structure(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    *,
    project_id: str,
    import_record: ExternalImportRecord,
    raw_artifact: ScientificArtifactRecord,
    preview_artifact: ScientificArtifactRecord,
    structure_payload: ImportedStructurePayload,
    program_label: str,
) -> tuple[StructureRecord, StructureVersionRecord]:
    stem = (
        import_record.source_filename.rsplit(".", 1)[0]
        if "." in import_record.source_filename
        else import_record.source_filename
    )
    name = f"{stem[:90]} · imported from {program_label}"[:160]
    atoms = [
        {
            "index": a.index,
            "atomic_number": a.atomic_number,
            "element": a.element,
            "x": a.x,
            "y": a.y,
            "z": a.z,
            "formal_charge": None,
            "label": None,
            "isotope": None,
            "occupancy": None,
        }
        for a in structure_payload.atoms
    ]
    candidate = CanonicalStructureCandidate(
        name=name,
        kind=StructureKind.MOLECULE,
        coordinates={
            "structure_version_id": "00000000-0000-4000-8000-000000000000",
            "coordinate_system": CoordinateSystem.CARTESIAN,
            "unit": CoordinateUnit.ANGSTROM,
            "dimensionality": 3,
            "atom_ordering": "AS_LISTED",
            "source": None,
            "atoms": atoms,
            "bonds": [],
        },
        overall_charge=structure_payload.charge,
        multiplicity=structure_payload.multiplicity,
        source_format=StructureSourceFormat.EXTERNAL_CALCULATION_OUTPUT,
        parser_name="cclib",
        parser_version=import_record.parser_commit,
        adapter_name="chemdft.external-import",
        adapter_version=IMPORTER_VERSION,
        diagnostics=(
            diagnostic(
                DiagnosticSeverity.WARNING,
                StructureDiagnosticCode.MISSING_CONNECTIVITY,
                "External calculation outputs do not provide authoritative bond connectivity.",
            ),
        ),
    )
    document = canonical_document(candidate)
    canonical_artifact = _persist_canonical_artifact(
        session,
        identity,
        object_store,
        project_id=project_id,
        document=document,
        source_artifact_id=raw_artifact.id,
    )
    structure = StructureRecord(
        project_id=project_id, name=name, kind=candidate.kind, created_by=identity.user_id
    )
    session.add(structure)
    session.flush()
    version_id = new_id()
    provenance = ProvenanceRecordRow(
        project_id=project_id,
        subject_type="structure.version",
        subject_id=version_id,
        source_class=ProvenanceClass.IMPORTED,
        detail=ProvenanceDetail.IMPORTED_ENGINE_RESULT,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SOFTWARE,
        producer_identifier=PRODUCER_ID,
        producer_software_version=IMPORTER_VERSION,
        source_artifact_id=raw_artifact.id,
        operation="chemdft.structure.imported-calculation",
        operation_version="1.0.0",
        parameters_json=[
            {"key": "import_id", "value": import_record.id},
            {"key": "source_program", "value": program_label},
            {"key": "source_sha256", "value": import_record.source_sha256},
            {"key": "preview_sha256", "value": import_record.preview_sha256},
            {"key": "geometry_role", "value": structure_payload.geometry_role},
            {"key": "frame_orientation", "value": structure_payload.frame.orientation},
            {"key": "parser_commit", "value": import_record.parser_commit},
        ],
        approximate=False,
        supersedes_id=None,
        correlation_id=import_record.id,
    )
    session.add(provenance)
    session.flush()
    session.add_all(
        [
            ProvenanceInputRow(
                provenance_record_id=provenance.id,
                project_id=project_id,
                position=0,
                input_type="ARTIFACT",
                input_id=raw_artifact.id,
                input_sha256=raw_artifact.sha256,
            ),
            ProvenanceInputRow(
                provenance_record_id=provenance.id,
                project_id=project_id,
                position=1,
                input_type="ARTIFACT",
                input_id=preview_artifact.id,
                input_sha256=preview_artifact.sha256,
            ),
        ]
    )
    source_ref = _artifact_ref(raw_artifact)
    canonical_ref = _artifact_ref(canonical_artifact)
    version = StructureVersionRecord(
        id=version_id,
        project_id=project_id,
        structure_id=structure.id,
        revision=1,
        origin=StructureVersionOrigin.IMPORTED_CALCULATION.value,
        parent_version_id=None,
        canonical_artifact_id=canonical_artifact.id,
        source_artifact_id=raw_artifact.id,
        coordinate_system="CARTESIAN",
        coordinate_unit="angstrom",
        atom_count=len(atoms),
        bond_count=0,
        overall_charge=candidate.overall_charge,
        multiplicity=candidate.multiplicity,
        representation_json={
            "source_artifact": source_ref,
            "canonical_artifact": canonical_ref,
            "coordinates": candidate.coordinates,
        },
        periodic_cell_json=None,
        diagnostics_json=[d.model_dump(mode="json") for d in candidate.diagnostics],
        provenance_record_id=provenance.id,
        idempotency_key=f"external-import:{import_record.id}:structure",
        created_by=identity.user_id,
    )
    session.add(version)
    session.flush()
    return structure, version


# ------------------------------------------------------------------------------------------------ confirmation
def confirm_external_import(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    *,
    project_id: str,
    import_id: str,
    payload: ExternalImportConfirmInput,
) -> ExternalImportDetail:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    record = _get_record(session, project.id, import_id)
    existing = _confirmation_for(session, record.id)
    if existing is not None:
        if (
            existing.idempotency_key == payload.idempotency_key
            and existing.preview_sha256 == payload.preview_sha256
        ):
            return get_external_import_detail(
                session, identity, object_store, settings, project_id, import_id
            )
        raise ExternalImportConflict("This external import was already confirmed.")
    if record.state != "PREVIEW_READY":
        raise ExternalImportConflict("A rejected preview cannot be imported.")
    if payload.preview_sha256 != record.preview_sha256:
        raise ExternalImportPreviewMismatch()
    raw_artifact = (
        session.get(ScientificArtifactRecord, record.raw_artifact_id)
        if record.raw_artifact_id
        else None
    )
    preview_artifact = (
        session.get(ScientificArtifactRecord, record.preview_artifact_id)
        if record.preview_artifact_id
        else None
    )
    if raw_artifact is None or preview_artifact is None or raw_artifact.project_id != project.id:
        raise ExternalImportSourceChanged("The immutable source artifact is missing.")
    # 1) the source file must still be exactly what was previewed
    data = object_store.get_bytes(raw_artifact.storage_key, settings.max_import_bytes)
    if (
        hashlib.sha256(data).hexdigest() != record.source_sha256
        or raw_artifact.sha256 != record.source_sha256
    ):
        raise ExternalImportSourceChanged()
    # 2) the stored preview must still hash to exactly what the user confirmed
    report, raw_report = _load_report(session, object_store, record, settings)
    if (
        report.preview_sha256 != payload.preview_sha256
        or report.body.source.sha256 != record.source_sha256
    ):
        raise ExternalImportPreviewMismatch()
    if report.body.status != "READY" or report.body.job is None:
        raise ExternalImportConflict("Only a READY preview can be imported.")

    producer = issue_trusted_producer_context(
        producer_id=PRODUCER_ID,
        producer_type=ProducerType.VALIDATED_IMPORT_PIPELINE,
        project_id=UUID(project.id),
        attestation_id=f"external-import:{record.id}:preview:{record.preview_sha256}",
    )
    entries = {e["result_type"]: e for e in raw_report["body"]["results"]}
    structure_entry = ImportResultEntry.model_validate(entries["chemdft.imported.structure"])
    if not isinstance(structure_entry.payload, ImportedStructurePayload):
        raise ScientificValidationFailed("The structure entry does not carry a structure payload.")
    job_summary = report.body.job
    try:
        structure, version = _create_imported_structure(
            session,
            identity,
            object_store,
            project_id=project.id,
            import_record=record,
            raw_artifact=raw_artifact,
            preview_artifact=preview_artifact,
            structure_payload=structure_entry.payload,
            program_label=report.body.program.label or "external program",
        )
        job = ExternalImportJobRecord(
            project_id=project.id,
            import_id=record.id,
            job_index=0,
            line_start=job_summary.line_range[0],
            line_end=job_summary.line_range[1],
            source_job_type=job_summary.job_type,
            method_json=job_summary.method.model_dump(mode="json"),
            basis_json=job_summary.basis.model_dump(mode="json"),
            charge=structure_entry.payload.charge,
            multiplicity=structure_entry.payload.multiplicity,
            termination_json=job_summary.termination.model_dump(mode="json"),
            convergence_json=job_summary.convergence.model_dump(mode="json"),
            structure_id=structure.id,
            structure_version_id=version.id,
        )
        session.add(job)
        session.flush()
        for result_type in IMPORTED_RESULT_TYPES:
            if result_type in entries:
                accept_imported_result(
                    session,
                    producer,
                    project_id=project.id,
                    import_record=record,
                    job=job,
                    entry=entries[result_type],
                    raw_artifact=raw_artifact,
                    preview_artifact=preview_artifact,
                )
        session.add(
            ExternalImportConfirmationRecord(
                project_id=project.id,
                import_id=record.id,
                preview_sha256=record.preview_sha256,
                idempotency_key=payload.idempotency_key,
                confirmed_by=identity.user_id,
            )
        )
        _audit_structure_event(
            session,
            identity,
            project_id=project.id,
            event_name="structure.version.created",
            structure_id=structure.id,
            version_id=version.id,
            artifacts=[],
        )
        _audit(
            session,
            identity,
            project_id=project.id,
            event_name="external_import.confirmed",
            import_id=record.id,
            artifacts=[_artifact_ref(raw_artifact), _artifact_ref(preview_artifact)],
            metadata=[
                {"key": "preview_sha256", "value": record.preview_sha256},
                {"key": "results", "value": str(len(entries))},
            ],
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return get_external_import_detail(
        session, identity, object_store, settings, project_id, import_id
    )
