"""Append-only experimental spectrum processing: every transform creates a NEW dataset; nothing is ever edited.

  * The user triggers each operation explicitly (baseline, smoothing, normalisation, resampling, crop, T->A, peak detection).
  * The deterministic worker returns a record (library + version, parameters in physical x units, internal values, input/output
    hashes, warnings). The API re-hashes every returned array against that record before anything is stored.
  * The new dataset is `EXPERIMENTAL` with provenance `DETERMINISTIC_TRANSFORM` (producer VALIDATED_DETERMINISTIC_TRANSFORM) and
    lineage to its parent dataset. Peak sets are `DERIVED_NOT_RAW`.
  * An idempotency key makes a repeated request return the dataset it already created.
"""
# ruff: noqa: E501  (long human-readable diagnostics and separators)

from __future__ import annotations

import hashlib
import struct
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .config import Settings
from .context import Identity
from .contracts.artifacts import ScientificArtifactKind
from .contracts.experimental_spectra import (
    PEAKS_SCHEMA,
    TRANSFORM_SCHEMA,
    SpectrumAuthority,
    SpectrumDatasetKind,
    SpectrumDatasetView,
    SpectrumPeakInput,
    SpectrumTransformInput,
    body_sha256,
    canonical_json,
)
from .contracts.provenance import ProducerKind, ProvenanceClass, ProvenanceDetail, VerificationState
from .contracts.scientific import DatasetProcessingState
from .errors import (
    ExperimentalSpectrumConflict,
    ExperimentalSpectrumInvalid,
    ExperimentalSpectrumSourceChanged,
    ProjectAccessDenied,
)
from .experimental_spectrum_actions import (
    ARRAYS_FORMAT,
    ARRAYS_MEDIA_TYPE,
    PEAKS_FORMAT,
    PEAKS_MEDIA_TYPE,
    TRANSFORM_PRODUCER_ID,
    accept_spectrum_dataset,
    artifact_ref,
    audit,
    axes_for,
    dataset_view,
    find_operation,
    parent_arrays_for_worker,
    peak_set_view,
    put_artifact,
    transform_view,
    worker_refusal,
)
from .experimental_spectrum_runner import RunnerOutcome, SpectraRunner, run_spectra_worker
from .models import new_id
from .project_access import ProjectCapability, can
from .scientific_models import (
    ExperimentalDatasetRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    SpectrumOperationRecord,
)
from .storage import ObjectStore
from .trusted_producers import ProducerType, issue_trusted_producer_context

BASELINE_OPS = {"baseline.arpls", "baseline.snip", "baseline.imodpoly", "baseline.offset"}


def _parent_request(parent: ExperimentalDatasetRecord) -> dict[str, Any]:
    spec = parent.spectrum_json or {}
    return {
        "point_count": parent.point_count,
        "x_unit": spec["x"]["unit"],
        "y_quantity": spec["y"]["quantity"],
        "y_unit": spec["y"]["unit"],
        "representation": spec["representation"],
        "input_has_y_error": bool(spec.get("y_error")),
    }


def _require_parent(session: Session, project_id: str, dataset_id: str) -> ExperimentalDatasetRecord:
    from .experimental_spectrum_actions import _get_spectrum_row

    parent = _get_spectrum_row(session, project_id, dataset_id)
    if parent.spectrum_json["kind"] == SpectrumDatasetKind.PEAKS.value:  # type: ignore[index]
        raise ExperimentalSpectrumConflict("A peak set is not a spectrum and cannot be processed further.")
    return parent


def _checked_document(outcome: RunnerOutcome, parent: ExperimentalDatasetRecord) -> tuple[dict[str, Any], str]:
    if outcome.failure or outcome.document is None or "error" in outcome.document:
        raise worker_refusal(outcome)
    record, sha = outcome.document["record"], outcome.document["record_sha256"]
    if body_sha256(record) != sha:
        raise ExperimentalSpectrumInvalid("WORKER_OUTPUT_INVALID: the record hash does not match its body")
    spec = parent.spectrum_json or {}
    if record["input"]["artifact_sha256"] != spec["arrays"]["xy_sha256"] or record["input"]["point_count"] != parent.point_count:
        raise ExperimentalSpectrumInvalid("WORKER_OUTPUT_INVALID: the worker processed different input than the stored parent")
    return record, sha


def _parameters(record: dict[str, Any], parent: ExperimentalDatasetRecord, sha: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = [
        {"key": "op", "value": record.get("op", "peaks")},
        {"key": "library", "value": record["library"]},
        {"key": "library_version", "value": record["library_version"]},
        {"key": "parent_dataset_id", "value": parent.id},
        {"key": "input_artifact_sha256", "value": record["input"]["artifact_sha256"]},
        {"key": "record_sha256", "value": sha},
        {"key": "authority", "value": record["authority"]},
    ]
    if "output" in record:
        rows.append({"key": "output_artifact_sha256", "value": record["output"]["artifact_sha256"]})
    for name, value in sorted(record["params"].items()):
        rows.append({"key": f"param.{name}", "value": str(value)})
    for name, value in sorted(record["environment"].items()):
        rows.append({"key": f"env.{name}", "value": str(value)})
    return rows


def _publish(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    *,
    project_id: str,
    parent: ExperimentalDatasetRecord,
    kind: SpectrumDatasetKind,
    record: dict[str, Any],
    record_sha256: str,
    arrays: bytes | None,
    aux: bytes | None,
    idempotency_key: str,
    request_sha256: str,
    display_name: str | None,
    op: str,
) -> ExperimentalDatasetRecord:
    producer = issue_trusted_producer_context(
        producer_id=TRANSFORM_PRODUCER_ID,
        producer_type=ProducerType.VALIDATED_DETERMINISTIC_TRANSFORM,
        project_id=UUID(project_id),
        attestation_id=f"experimental-spectrum:{parent.id}:{op}:{record_sha256}",
    )
    accept_spectrum_dataset(producer, project_id=project_id, kind=kind)
    spec = parent.spectrum_json or {}
    technique = spec["technique"]
    parent_artifact = session.get(ScientificArtifactRecord, parent.artifact_id)
    if parent_artifact is None:
        raise ExperimentalSpectrumSourceChanged("The parent arrays artifact is missing.")
    dataset_id = new_id()
    performed_at = datetime.now(UTC)
    if kind is SpectrumDatasetKind.TRANSFORM:
        assert arrays is not None
        out = record["output"]
        arrays_artifact = put_artifact(session, identity, object_store, project_id=project_id, data=arrays, kind=ScientificArtifactKind.SPECTRUM_DATA, media_type=ARRAYS_MEDIA_TYPE, format_identifier=ARRAYS_FORMAT, source_relation_id=parent_artifact.id)
        baseline_artifact = (
            put_artifact(session, identity, object_store, project_id=project_id, data=aux, kind=ScientificArtifactKind.SPECTRUM_DATA, media_type=ARRAYS_MEDIA_TYPE, format_identifier=ARRAYS_FORMAT + ".baseline", source_relation_id=arrays_artifact.id)
            if aux is not None
            else None
        )
        main_artifact = arrays_artifact
        state = DatasetProcessingState.NORMALIZED if op.startswith("normalize.") else DatasetProcessingState.DERIVED
        x_unit, y_quantity, y_unit, representation = out["x_unit"], out["y_quantity"], out["y_unit"], out["representation"]
        point_count = out["point_count"]
        values: list[dict[str, Any]] = []
        x_min, x_max = struct.unpack_from("<d", arrays, 0)[0], struct.unpack_from("<d", arrays, (point_count - 1) * 8)[0]  # derived versions are ascending
        arrays_block: dict[str, Any] = {"artifact_sha256": arrays_artifact.sha256, "xy_sha256": arrays_artifact.sha256, "point_count": point_count, "layout": "float64-le: x, y", "x_sha256": out["x_sha256"], "y_sha256": out["y_sha256"], "y_error_sha256": None}
        extra: dict[str, Any] = {"transform": record, "peaks": None, "baseline_artifact_id": baseline_artifact.id if baseline_artifact else None}
        authority = SpectrumAuthority.DETERMINISTIC_TRANSFORM
    else:
        peaks = record["peaks"]
        main_artifact = put_artifact(session, identity, object_store, project_id=project_id, data=canonical_json({"record": record, "record_sha256": record_sha256}), kind=ScientificArtifactKind.NORMALIZED_RESULT, media_type=PEAKS_MEDIA_TYPE, format_identifier=PEAKS_FORMAT, source_relation_id=parent_artifact.id)
        state = DatasetProcessingState.DERIVED
        x_unit, y_quantity, y_unit, representation = record["input"]["x_unit"], record["input"]["y_quantity"], record["input"]["y_unit"], record["input"]["representation"]
        point_count = record["peak_count"]
        values = [{k: float(v) for k, v in peak.items()} for peak in peaks]
        arrays_block = {}
        extra = {"transform": None, "peaks": record, "baseline_artifact_id": None}
        authority = SpectrumAuthority.DERIVED_NOT_RAW
        x_min, x_max = spec["x"].get("min"), spec["x"].get("max")
    provenance = ProvenanceRecordRow(
        project_id=project_id,
        subject_type="experimental.dataset",
        subject_id=dataset_id,
        source_class=ProvenanceClass.EXPERIMENTAL,
        detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SOFTWARE,
        producer_identifier=TRANSFORM_PRODUCER_ID,
        producer_software_version=record["worker_version"],
        source_artifact_id=parent_artifact.id,
        operation=f"chemdft.experimental-spectrum.{op}",
        operation_version="1.0.0",
        parameters_json=_parameters(record, parent, record_sha256),
        approximate=False,
        supersedes_id=None,
        correlation_id=parent.id,
    )
    session.add(provenance)
    session.flush()
    session.add(ProvenanceInputRow(provenance_record_id=provenance.id, project_id=project_id, position=0, input_type="ENTITY", input_id=parent.id, input_sha256=parent_artifact.sha256))
    name = (display_name or f"{(spec.get('name') or 'spectrum')} · {op}")[:160]
    inherited = {k: spec.get(k) for k in ("acquisition", "instrument", "sample", "metadata_verbatim", "parser", "worker_version")}
    spectrum_json: dict[str, Any] = {
        "contract": "chemdft.experimental-spectrum.dataset",
        "contract_version": "1.0.0",
        "kind": kind.value,
        "technique": technique,
        "authority": authority.value,
        "name": name,
        "root_dataset_id": spec.get("root_dataset_id", parent.id),
        "parent_dataset_id": parent.id,
        "x_order": "ASCENDING",
        "x": {**spec["x"], "unit": x_unit, "min": x_min, "max": x_max},
        "y": {**spec["y"], "quantity": y_quantity, "unit": y_unit},
        "y_error": None,
        "representation": representation,
        "arrays": arrays_block,
        "record_sha256": record_sha256,
        "source": None,
        **inherited,
        **extra,
        "provenance_record_id": provenance.id,
    }
    if kind is SpectrumDatasetKind.TRANSFORM:
        spectrum_json["y"]["unit_evidence_text"] = f"inherited from parent dataset {parent.id}; changed only by the recorded transform {op}"
    step = {"dataset_id": dataset_id, "op": op, "library": record["library"], "library_version": record["library_version"], "record_sha256": record_sha256, "output_artifact_sha256": main_artifact.sha256, "performed_at": performed_at.isoformat()}
    dataset = ExperimentalDatasetRecord(
        id=dataset_id,
        project_id=project_id,
        experiment_id=parent.experiment_id,
        state=state.value,
        artifact_id=main_artifact.id,
        source_class=ProvenanceClass.EXPERIMENTAL.value,
        axes_json=axes_for(technique, x_unit, spec["x"].get("quantity"), y_quantity, y_unit, representation, "ASCENDING"),
        values_json=values,
        point_count=point_count,
        processing_json=[*(parent.processing_json or []), step],
        input_dataset_ids_json=[parent.id],
        spectrum_json=spectrum_json,
        created_by=identity.user_id,
    )
    session.add(dataset)
    session.flush()
    session.add(SpectrumOperationRecord(project_id=project_id, idempotency_key=idempotency_key, request_sha256=request_sha256, parent_dataset_id=parent.id, dataset_id=dataset.id, op=op, record_sha256=record_sha256, created_by=identity.user_id))
    audit(
        session,
        identity,
        project_id=project_id,
        event_name="experimental_spectrum.peaks_detected" if kind is SpectrumDatasetKind.PEAKS else "experimental_spectrum.transformed",
        entity_type="experimental.dataset",
        entity_id=dataset.id,
        artifacts=[artifact_ref(main_artifact)],
        metadata=[{"key": "op", "value": op}, {"key": "parent_dataset_id", "value": parent.id}, {"key": "record_sha256", "value": record_sha256}],
    )
    return dataset


def create_spectrum_transform(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    *,
    project_id: str,
    dataset_id: str,
    payload: SpectrumTransformInput,
    runner: SpectraRunner | None = None,
) -> SpectrumDatasetView:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    parent = _require_parent(session, project.id, dataset_id)
    params = payload.parameters.model_dump(mode="json", exclude_none=True)
    request_sha = body_sha256({"parent": parent.id, "op": payload.op, "params": params})
    existing = find_operation(session, project.id, payload.idempotency_key, request_sha)
    if existing is not None:
        return dataset_view(session, session.get(ExperimentalDatasetRecord, existing.dataset_id))  # type: ignore[arg-type]
    xy = parent_arrays_for_worker(session, object_store, settings, parent)
    run = runner or run_spectra_worker
    outcome = run("transform", {**_parent_request(parent), "op": payload.op, "params": params}, settings, arrays_in=xy, want_arrays=True, want_aux=payload.op in BASELINE_OPS)
    record, sha = _checked_document(outcome, parent)
    arrays = outcome.arrays
    if record["schema"] != TRANSFORM_SCHEMA or record["op"] != payload.op or arrays is None:
        raise ExperimentalSpectrumInvalid("WORKER_OUTPUT_INVALID: the worker returned a different operation")
    out = record["output"]
    if hashlib.sha256(arrays).hexdigest() != out["artifact_sha256"] or len(arrays) != 16 * out["point_count"]:
        raise ExperimentalSpectrumInvalid("WORKER_OUTPUT_INVALID: the returned arrays do not match their recorded hash")
    aux = outcome.aux
    if payload.op in BASELINE_OPS:
        expected = out["aux"].get("baseline")
        if aux is None or expected is None or hashlib.sha256(aux).hexdigest() != expected["sha256"] or len(aux) != 8 * out["point_count"]:
            raise ExperimentalSpectrumInvalid("WORKER_OUTPUT_INVALID: the baseline curve does not match its recorded hash")
    transform_view(record, sha)  # full typed validation of the record before anything is stored
    try:
        dataset = _publish(session, identity, object_store, project_id=project.id, parent=parent, kind=SpectrumDatasetKind.TRANSFORM, record=record, record_sha256=sha, arrays=arrays, aux=aux, idempotency_key=payload.idempotency_key, request_sha256=request_sha, display_name=payload.display_name, op=payload.op)
        session.commit()
    except Exception:
        session.rollback()
        raise
    return dataset_view(session, dataset)


def create_spectrum_peaks(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    *,
    project_id: str,
    dataset_id: str,
    payload: SpectrumPeakInput,
    runner: SpectraRunner | None = None,
) -> SpectrumDatasetView:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    parent = _require_parent(session, project.id, dataset_id)
    params = payload.parameters.model_dump(mode="json", exclude_none=True)
    request_sha = body_sha256({"parent": parent.id, "op": "peaks", "params": params})
    existing = find_operation(session, project.id, payload.idempotency_key, request_sha)
    if existing is not None:
        return dataset_view(session, session.get(ExperimentalDatasetRecord, existing.dataset_id))  # type: ignore[arg-type]
    xy = parent_arrays_for_worker(session, object_store, settings, parent)
    run = runner or run_spectra_worker
    outcome = run("peaks", {**_parent_request(parent), "params": params}, settings, arrays_in=xy)
    record, sha = _checked_document(outcome, parent)
    if record["schema"] != PEAKS_SCHEMA:
        raise ExperimentalSpectrumInvalid("WORKER_OUTPUT_INVALID: the worker returned a different document")
    peak_set_view(record, sha)  # full typed validation of the record before anything is stored
    try:
        dataset = _publish(session, identity, object_store, project_id=project.id, parent=parent, kind=SpectrumDatasetKind.PEAKS, record=record, record_sha256=sha, arrays=None, aux=None, idempotency_key=payload.idempotency_key, request_sha256=request_sha, display_name=None, op="peaks")
        session.commit()
    except Exception:
        session.rollback()
        raise
    return dataset_view(session, dataset)
