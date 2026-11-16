from __future__ import annotations

import hashlib
import io
import json
import math
from typing import Any
from uuid import UUID

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .compute_gateway import LocalComputeProvider
from .config import Settings
from .context import Identity
from .contracts.base import ArtifactReference
from .contracts.results import (
    MolecularOrbitalAnalysis,
    MolecularOrbitalGridManifest,
    MolecularOrbitalGridOutput,
    MolecularOrbitalGridRequest,
)
from .errors import ComputeUnavailable, ProjectAccessDenied, ScientificReferenceNotFound
from .models import utc_now
from .project_access import ProjectCapability, can
from .scientific.engines.orbitals import deterministic_npz
from .scientific_models import (
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from .storage import ObjectStore

GRID_SPACING_ANGSTROM = 0.35
GRID_MARGIN_ANGSTROM = 3.0
GRID_GENERATOR_VERSION = "1.0.0"
GRID_MANIFEST_NAMESPACE = "chemdft.molecular-orbital-grid"
GRID_POINT_LIMIT = 100_000


def get_or_generate_molecular_orbital_grid(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    project_id: str,
    calculation_id: str,
    request: MolecularOrbitalGridRequest,
) -> MolecularOrbitalGridOutput:
    if request.grid_profile == "STANDARD":
        from .contracts.volumetric import VolumetricFieldRequest
        from .volumetric_field_actions import get_or_generate_volumetric_field

        output = get_or_generate_volumetric_field(
            session,
            identity,
            object_store,
            settings,
            project_id,
            calculation_id,
            VolumetricFieldRequest(
                field_kind="MO_AMPLITUDE",
                orbital_index=request.orbital_index,
                spin_channel=request.spin_channel,
            ),
        )
        values = output.manifest.model_dump(mode="json")
        values = {k: v for k, v in values.items() if k in MolecularOrbitalGridManifest.model_fields}
        return MolecularOrbitalGridOutput(
            manifest=MolecularOrbitalGridManifest.model_validate(values),
            field_values=output.field_values,
        )
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    calculation = session.get(CalculationRecord, calculation_id)
    if calculation is None or calculation.project_id != project.id:
        raise ScientificReferenceNotFound("Calculation does not exist.")
    result = session.scalar(
        select(CalculationResultRecord).where(
            CalculationResultRecord.project_id == project.id,
            CalculationResultRecord.calculation_id == calculation.id,
        )
    )
    if (
        calculation.state != "SUCCEEDED"
        or result is None
        or result.result_type != "chemdft.molecular-orbitals"
        or result.authority != "AUTHORITATIVE"
        or result.source_class != "CALCULATED"
        or result.validation_state != "VALIDATED"
    ):
        raise ScientificReferenceNotFound("A validated successful orbital result is required.")
    payload = MolecularOrbitalAnalysis.model_validate(result.payload_json)
    selected = next(
        (
            orbital
            for orbital in payload.orbitals
            if orbital.spin_channel == request.spin_channel
            and orbital.index == request.orbital_index
        ),
        None,
    )
    if selected is None:
        raise ScientificReferenceNotFound("Selected orbital or spin channel does not exist.")
    calculation_input = session.scalar(
        select(CalculationInputRecord).where(
            CalculationInputRecord.calculation_id == calculation.id,
            CalculationInputRecord.project_id == project.id,
        )
    )
    version = session.get(StructureVersionRecord, payload.input_structure_version_id.hex)
    if version is None:
        version = session.get(StructureVersionRecord, str(payload.input_structure_version_id))
    if calculation_input is None or version is None or version.project_id != project.id:
        raise ScientificReferenceNotFound("Immutable orbital input geometry is missing.")
    coefficient = session.get(
        ScientificArtifactRecord, str(payload.coefficient_artifact.artifact_id)
    )
    if (
        coefficient is None
        or coefficient.project_id != project.id
        or coefficient.kind != "MO_COEFFICIENTS"
        or coefficient.sha256 != payload.coefficient_artifact.sha256
        or coefficient.source_relation_id != calculation.id
    ):
        raise ScientificReferenceNotFound("Validated orbital coefficient artifact is missing.")
    input_record = session.get(
        ScientificArtifactRecord, calculation_input.normalized_input_artifact_id
    )
    if input_record is None or input_record.project_id != project.id:
        raise ScientificReferenceNotFound("Immutable normalized calculation input is missing.")
    input_bytes = object_store.get_bytes(
        input_record.storage_key, settings.scientific_max_output_bytes
    )
    if hashlib.sha256(input_bytes).hexdigest() != input_record.sha256:
        raise ValueError("Normalized calculation input artifact hash mismatch")
    input_document = json.loads(input_bytes)
    coefficient_bytes = object_store.get_bytes(
        coefficient.storage_key, settings.scientific_max_output_bytes
    )
    if hashlib.sha256(coefficient_bytes).hexdigest() != coefficient.sha256:
        raise ValueError("Molecular-orbital coefficient artifact hash mismatch")
    with np.load(io.BytesIO(coefficient_bytes), allow_pickle=False) as archive:
        array_name = f"coefficients_{request.spin_channel}"
        if array_name not in archive.files:
            raise ScientificReferenceNotFound("Selected spin-channel coefficients are missing.")
        coefficients = np.asarray(archive[array_name], dtype=np.float64)
    if (
        coefficients.ndim != 2
        or request.orbital_index >= coefficients.shape[1]
        or not np.isfinite(coefficients).all()
    ):
        raise ValueError("Stored coefficient artifact is malformed")

    origin, dimensions = _grid_bounds(input_document["atoms"])
    specification = {
        "result_sha256": payload.result_sha256,
        "orbital_index": request.orbital_index,
        "spin_channel": request.spin_channel,
        "origin_angstrom": origin,
        "dimensions": dimensions,
        "spacing_angstrom": GRID_SPACING_ANGSTROM,
        "margin_angstrom": GRID_MARGIN_ANGSTROM,
        "coordinate_unit": "angstrom",
        "field_quantity": "MO_AMPLITUDE",
        "field_unit": "a0^-3/2",
        "generator": "pyscf.eval_gto",
        "generator_version": GRID_GENERATOR_VERSION,
        "axis_order": ["x", "y", "z"],
    }
    specification_hash = hashlib.sha256(
        json.dumps(specification, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    cached = session.scalars(
        select(ScientificArtifactRecord).where(
            ScientificArtifactRecord.project_id == project.id,
            ScientificArtifactRecord.kind == "ORBITAL_GRID",
            ScientificArtifactRecord.source_relation_type == "calculation.result",
            ScientificArtifactRecord.source_relation_id == result.id,
        )
    ).all()
    cached_artifact = next(
        (
            artifact
            for artifact in cached
            if _manifest_extension(artifact).get("grid_specification_hash") == specification_hash
        ),
        None,
    )
    if cached_artifact is not None:
        return _read_grid_output(object_store, settings, cached_artifact)

    grid_request = {
        **input_document,
        "task": "MO_GRID",
        "grid": {
            "origin_angstrom": origin,
            "dimensions": dimensions,
            "spacing_angstrom": GRID_SPACING_ANGSTROM,
        },
        "orbital_index": request.orbital_index,
        "spin_channel": request.spin_channel,
        "mo_coefficients": coefficients.tolist(),
    }
    execution = LocalComputeProvider(settings).execute(
        calculation_id=f"{calculation.id}:mo:{request.spin_channel}:{request.orbital_index}",
        normalized_input=json.dumps(
            grid_request, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode(),
        engine="pyscf",
    )
    worker_result = execution.result_document
    if (
        execution.timed_out
        or execution.exit_code != 0
        or not worker_result
        or worker_result.get("schema") != "chemdft.worker.molecular-orbital-grid"
        or worker_result.get("engine_version") != payload.engine_version
        or worker_result.get("orbital_index") != request.orbital_index
        or worker_result.get("spin_channel") != request.spin_channel
        or worker_result.get("dimensions") != dimensions
    ):
        raise ComputeUnavailable("PySCF failed to generate the requested orbital grid.")
    field = np.asarray(worker_result.get("field_values"), dtype="<f4")
    if field.size != math.prod(dimensions) or not np.isfinite(field).all():
        raise ValueError("PySCF returned a malformed or non-finite orbital grid")
    if field.size > GRID_POINT_LIMIT:
        raise ValueError("Generated orbital grid exceeds the configured point limit")
    field_bytes = field.tobytes(order="C")
    field_sha256 = hashlib.sha256(field_bytes).hexdigest()
    grid_sha256 = hashlib.sha256(bytes.fromhex(specification_hash) + field_bytes).hexdigest()
    manifest_document = {
        **specification,
        "calculation_id": str(calculation.id),
        "calculation_result_id": result.id,
        "field_sha256": field_sha256,
        "grid_sha256": grid_sha256,
        "field_min": float(field.min()),
        "field_max": float(field.max()),
    }
    artifact_bytes = deterministic_npz(
        {
            "field_values": field.reshape(dimensions),
            "manifest_json": np.asarray(
                [json.dumps(manifest_document, sort_keys=True, separators=(",", ":"))]
            ),
        }
    )
    stored = object_store.put_raw(
        project.id, io.BytesIO(artifact_bytes), settings.scientific_max_output_bytes
    )
    artifact = ScientificArtifactRecord(
        project_id=project.id,
        kind="ORBITAL_GRID",
        media_type="application/vnd.chemdft.numpy-npz",
        format_identifier="chemdft.mo-grid.npz",
        format_version="1.0.0",
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        storage_key=stored.key,
        created_by=identity.user_id,
        source_relation_type="calculation.result",
        source_relation_id=result.id,
        compression=None,
        extensions_json=[
            {
                "namespace": GRID_MANIFEST_NAMESPACE,
                "schema_version": "1.0.0",
                "values": {**manifest_document, "grid_specification_hash": specification_hash},
            }
        ],
        created_at=utc_now(),
    )
    session.add(artifact)
    session.commit()
    session.refresh(artifact)
    return _read_grid_output(object_store, settings, artifact)


def _grid_bounds(atoms: list[dict[str, Any]]) -> tuple[list[float], list[int]]:
    positions = np.asarray([atom["xyz_angstrom"] for atom in atoms], dtype=np.float64)
    if positions.ndim != 2 or positions.shape[1] != 3 or not np.isfinite(positions).all():
        raise ValueError("Validated molecular coordinates are malformed")
    minimum = positions.min(axis=0) - GRID_MARGIN_ANGSTROM
    maximum = positions.max(axis=0) + GRID_MARGIN_ANGSTROM
    dimensions = np.ceil((maximum - minimum) / GRID_SPACING_ANGSTROM).astype(int) + 1
    if np.any(dimensions > 96) or math.prod(int(value) for value in dimensions) > GRID_POINT_LIMIT:
        raise ValueError("Molecule exceeds the deterministic MO grid bounds")
    return minimum.tolist(), [int(value) for value in dimensions]


def _manifest_extension(artifact: ScientificArtifactRecord) -> dict[str, Any]:
    for extension in artifact.extensions_json:
        if extension.get("namespace") == GRID_MANIFEST_NAMESPACE:
            values = extension.get("values")
            return values if isinstance(values, dict) else {}
    return {}


def _read_grid_output(
    object_store: ObjectStore, settings: Settings, artifact: ScientificArtifactRecord
) -> MolecularOrbitalGridOutput:
    metadata = _manifest_extension(artifact)
    if not metadata:
        raise ValueError("Orbital-grid manifest is missing")
    payload = object_store.get_bytes(artifact.storage_key, settings.scientific_max_output_bytes)
    if hashlib.sha256(payload).hexdigest() != artifact.sha256:
        raise ValueError("Orbital-grid artifact hash mismatch")
    try:
        with np.load(io.BytesIO(payload), allow_pickle=False) as archive:
            field = np.asarray(archive["field_values"], dtype="<f4")
            stored_manifest = json.loads(str(archive["manifest_json"][0]))
    except (KeyError, ValueError, OSError) as error:
        raise ValueError("Orbital-grid artifact is malformed") from error
    dimensions = tuple(int(value) for value in metadata["dimensions"])
    if field.shape != dimensions or not np.isfinite(field).all():
        raise ValueError("Orbital-grid dimensions or values are invalid")
    field_bytes = field.tobytes(order="C")
    field_sha256 = hashlib.sha256(field_bytes).hexdigest()
    grid_specification_hash = metadata["grid_specification_hash"]
    grid_sha256 = hashlib.sha256(bytes.fromhex(grid_specification_hash) + field_bytes).hexdigest()
    if (
        field_sha256 != metadata["field_sha256"]
        or grid_sha256 != metadata["grid_sha256"]
        or stored_manifest.get("grid_sha256") != grid_sha256
        or float(field.min()) != metadata["field_min"]
        or float(field.max()) != metadata["field_max"]
    ):
        raise ValueError("Orbital-grid field integrity validation failed")
    manifest_values = {
        "artifact": ArtifactReference(
            project_id=UUID(artifact.project_id),
            artifact_id=UUID(artifact.id),
            sha256=artifact.sha256,
        ).model_dump(mode="json"),
        "calculation_id": metadata["calculation_id"],
        "calculation_result_id": metadata["calculation_result_id"],
        "result_sha256": metadata["result_sha256"],
        "orbital_index": metadata["orbital_index"],
        "spin_channel": metadata["spin_channel"],
        "dimensions": metadata["dimensions"],
        "origin_angstrom": metadata["origin_angstrom"],
        "voxel_vectors_angstrom": [
            [metadata["spacing_angstrom"], 0.0, 0.0],
            [0.0, metadata["spacing_angstrom"], 0.0],
            [0.0, 0.0, metadata["spacing_angstrom"]],
        ],
        "field_min": metadata["field_min"],
        "field_max": metadata["field_max"],
        "field_sha256": field_sha256,
        "grid_sha256": grid_sha256,
        "grid_specification_hash": grid_specification_hash,
        "grid_generator_version": metadata["generator_version"],
        "spacing_angstrom": metadata["spacing_angstrom"],
        "molecular_margin_angstrom": metadata["margin_angstrom"],
    }
    return MolecularOrbitalGridOutput(
        manifest=MolecularOrbitalGridManifest.model_validate(manifest_values),
        field_values=tuple(float(value) for value in field.reshape(-1)),
    )
