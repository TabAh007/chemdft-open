from __future__ import annotations

import hashlib
import io
import json
import math
import time
from datetime import UTC
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

import numpy as np
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .compute_gateway import LocalComputeProvider
from .config import Settings
from .context import Identity
from .contracts.base import ArtifactReference
from .contracts.results import MolecularOrbitalAnalysis
from .contracts.volumetric import (
    VolumetricFieldManifest,
    VolumetricFieldOutput,
    VolumetricFieldRequest,
)
from .errors import (
    ComputeUnavailable,
    ProjectAccessDenied,
    ScientificReferenceNotFound,
    ScientificValidationFailed,
)
from .models import new_id, utc_now
from .project_access import ProjectCapability, can
from .scientific.engines.electronic_fields import (
    FIELD_GENERATOR_VERSION,
    STANDARD_SPACING_ANGSTROM,
    density_integral,
    derive_density_matrix,
    matrix_hash,
    standard_grid,
    surface_statistics,
)
from .scientific.engines.orbitals import deterministic_npz, validate_molecular_orbital_result_hash
from .scientific_models import (
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from .storage import ObjectStore

FIELD_NAMESPACE = "chemdft.volumetric-field"
FIELD_UNITS = {
    "MO_AMPLITUDE": "a0^-3/2",
    "ELECTRON_DENSITY": "e/a0^3",
    "ELECTROSTATIC_POTENTIAL": "a.u.",
}


def field_metadata(artifact: ScientificArtifactRecord) -> dict[str, Any]:
    return next(
        (x["values"] for x in artifact.extensions_json if x.get("namespace") == FIELD_NAMESPACE), {}
    )


def load_orbital_source(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    project_id: str,
    calculation_id: str,
) -> tuple[
    Any, CalculationResultRecord, MolecularOrbitalAnalysis, dict[str, Any], dict[str, np.ndarray]
]:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    calculation = session.get(CalculationRecord, calculation_id)
    result = session.scalar(
        select(CalculationResultRecord).where(
            CalculationResultRecord.project_id == project.id,
            CalculationResultRecord.calculation_id == calculation_id,
        )
    )
    if (
        calculation is None
        or calculation.project_id != project.id
        or calculation.state != "SUCCEEDED"
        or result is None
        or result.result_type != "chemdft.molecular-orbitals"
        or result.authority != "AUTHORITATIVE"
        or result.source_class != "CALCULATED"
        or result.validation_state != "VALIDATED"
    ):
        raise ScientificReferenceNotFound(
            "A validated successful engine-backed SCF orbital result is required."
        )
    payload = MolecularOrbitalAnalysis.model_validate(result.payload_json)
    validate_molecular_orbital_result_hash(payload)
    version = session.get(StructureVersionRecord, str(payload.input_structure_version_id))
    source = session.get(CalculationInputRecord, result.calculation_input_id)
    if (
        version is None
        or version.project_id != project.id
        or source is None
        or source.project_id != project.id
        or source.calculation_id != calculation_id
        or source.structure_version_id != version.id
    ):
        raise ScientificReferenceNotFound(
            "Immutable SCF input StructureVersion is missing or stale."
        )
    coefficient = session.get(
        ScientificArtifactRecord, str(payload.coefficient_artifact.artifact_id)
    )
    normalized = session.get(ScientificArtifactRecord, source.normalized_input_artifact_id)
    if (
        coefficient is None
        or normalized is None
        or coefficient.project_id != project.id
        or normalized.project_id != project.id
        or coefficient.kind != "MO_COEFFICIENTS"
        or coefficient.sha256 != payload.coefficient_artifact.sha256
        or coefficient.source_relation_type != "calculation.record"
        or coefficient.source_relation_id != calculation_id
        or normalized.sha256 != payload.calculation_input_hash
    ):
        raise ScientificReferenceNotFound(
            "Validated immutable SCF coefficient/input artifact is missing."
        )

    def checked_bytes(a: ScientificArtifactRecord) -> bytes:
        data = object_store.get_bytes(a.storage_key, settings.scientific_max_output_bytes)
        if hashlib.sha256(data).hexdigest() != a.sha256:
            raise ValueError("SCF source artifact hash mismatch")
        return data

    document = json.loads(checked_bytes(normalized))
    if document["structure_version_id"] != str(payload.input_structure_version_id):
        raise ValueError("Normalized SCF input refers to a different StructureVersion")
    with np.load(io.BytesIO(checked_bytes(coefficient)), allow_pickle=False) as archive:
        arrays = {key: archive[key].copy() for key in archive.files}
    for key in ("method", "basis", "charge", "multiplicity"):
        if document[key] != getattr(payload, key) or arrays[key][0] != document[key]:
            raise ValueError("SCF coefficient specification differs from validated result")
    if arrays["pyscf_version"][0] != payload.engine_version or not np.array_equal(
        arrays["input_coordinates_angstrom"], [a["xyz_angstrom"] for a in document["atoms"]]
    ):
        raise ValueError("SCF coefficient geometry or producer differs from validated input")
    for channel in dict.fromkeys(o.spin_channel for o in payload.orbitals):
        table = sorted(
            (o for o in payload.orbitals if o.spin_channel == channel), key=lambda o: o.index
        )
        if (
            arrays[f"coefficients_{channel}"].shape != (payload.basis_function_count, len(table))
            or not np.array_equal(arrays[f"occupations_{channel}"], [o.occupation for o in table])
            or not np.array_equal(
                arrays[f"energies_hartree_{channel}"], [o.energy_hartree for o in table]
            )
        ):
            raise ValueError("Coefficient metadata differs from immutable orbital result")
    return project, result, payload, document, arrays


def get_or_generate_volumetric_field(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    project_id: str,
    calculation_id: str,
    request: VolumetricFieldRequest,
) -> VolumetricFieldOutput:
    try:
        return _generate(
            session, identity, object_store, settings, project_id, calculation_id, request
        )
    except (ValueError, KeyError, OSError) as error:
        raise ScientificValidationFailed(str(error)) from error


def _generate(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    project_id: str,
    calculation_id: str,
    request: VolumetricFieldRequest,
) -> VolumetricFieldOutput:
    project, result, payload, document, arrays = load_orbital_source(
        session, identity, object_store, settings, project_id, calculation_id
    )
    if request.field_kind == "MO_AMPLITUDE" and not any(
        o.index == request.orbital_index and o.spin_channel == request.spin_channel
        for o in payload.orbitals
    ):
        raise ScientificReferenceNotFound("Selected orbital or spin channel does not exist.")
    channels = [
        {
            "spin_channel": name,
            "coefficients": arrays[f"coefficients_{name}"].tolist(),
            "occupations": arrays[f"occupations_{name}"].tolist(),
        }
        for name in dict.fromkeys(o.spin_channel for o in payload.orbitals)
    ]
    matrix = derive_density_matrix(channels, payload.basis_function_count, payload.electron_count)
    origin, dimensions = standard_grid(document["atoms"])
    specification = {
        **request.model_dump(mode="json"),
        "result_sha256": payload.result_sha256,
        "origin_angstrom": origin,
        "dimensions": dimensions,
        "spacing_angstrom": STANDARD_SPACING_ANGSTROM,
        "margin_angstrom": 3.0,
        "coordinate_unit": "angstrom",
        "axis_order": ["x", "y", "z"],
        "coordinate_frame": "INPUT_STRUCTURE_VERSION_CARTESIAN",
        "field_quantity": request.field_kind,
        "field_unit": FIELD_UNITS[request.field_kind],
        "generator": "pyscf.scf-fields",
        "generator_version": FIELD_GENERATOR_VERSION,
        "grid_profile_version": "2.0.0",
        "point_cap": 250000,
        "density_matrix_sha256": matrix_hash(matrix),
        "singularity_treatment": (
            "Deterministic lattice offset excludes exact nuclei; singular samples are rejected."
        ),
    }
    spec_hash = hashlib.sha256(_json_bytes(specification)).hexdigest()
    artifact_id = str(uuid5(NAMESPACE_URL, f"chemdft:field:{project.id}:{spec_hash}"))
    cached = session.get(ScientificArtifactRecord, artifact_id)
    if cached is not None:
        return read_field_output(object_store, settings, cached)
    density = None
    if request.field_kind == "ELECTROSTATIC_POTENTIAL":
        density = _generate(
            session,
            identity,
            object_store,
            settings,
            project_id,
            calculation_id,
            VolumetricFieldRequest(field_kind="ELECTRON_DENSITY"),
        )
    started = time.perf_counter()
    execution = LocalComputeProvider(settings).execute(
        calculation_id=f"{calculation_id}:field:{spec_hash}",
        normalized_input=_json_bytes(
            {
                **document,
                "task": "VOLUMETRIC_FIELD",
                "field_kind": request.field_kind,
                "grid": {
                    "origin_angstrom": origin,
                    "dimensions": dimensions,
                    "spacing_angstrom": STANDARD_SPACING_ANGSTROM,
                },
                "orbital_index": request.orbital_index,
                "spin_channel": request.spin_channel,
                "orbital_channels": channels,
                "density_matrix_sha256": matrix_hash(matrix),
            }
        ),
        engine="pyscf",
    )
    output = execution.result_document
    if (
        execution.timed_out
        or execution.exit_code != 0
        or not output
        or output.get("schema") != "chemdft.worker.volumetric-field"
        or output.get("engine_version") != payload.engine_version
        or output.get("field_kind") != request.field_kind
        or output.get("generator_version") != FIELD_GENERATOR_VERSION
        or output.get("dimensions") != dimensions
        or output.get("origin_angstrom") != origin
        or output.get("spacing_angstrom") != STANDARD_SPACING_ANGSTROM
        or output.get("density_matrix_sha256") != matrix_hash(matrix)
    ):
        raise ComputeUnavailable(
            "PySCF field generation failed; successful SCF/MO results remain available."
        )
    field = np.asarray(output["field_values"], dtype="<f4")
    if field.ndim != 1 or field.size != math.prod(dimensions) or not np.isfinite(field).all():
        raise ValueError("Malformed or non-finite PySCF field values")
    if not math.isclose(
        output["density_matrix_electron_count"], payload.electron_count, abs_tol=1e-6
    ):
        raise ValueError("Density matrix electron-count validation failed")
    field = field.reshape(dimensions)
    field_bytes = field.tobytes(order="C")
    grid_hash = hashlib.sha256(bytes.fromhex(spec_hash) + field_bytes).hexdigest()
    metadata = {
        **specification,
        "provenance_record_id": str(uuid5(NAMESPACE_URL, f"{artifact_id}:provenance")),
        "calculation_id": calculation_id,
        "calculation_result_id": result.id,
        "input_structure_version_id": str(payload.input_structure_version_id),
        "calculation_input_hash": payload.calculation_input_hash,
        "coefficient_artifact_sha256": payload.coefficient_artifact_sha256,
        "density_matrix_electron_count": output["density_matrix_electron_count"],
        "electron_count": payload.electron_count,
        "method": payload.method,
        "basis": payload.basis,
        "producer_version": payload.engine_version,
        "field_min": float(field.min()),
        "field_max": float(field.max()),
        "field_sha256": hashlib.sha256(field_bytes).hexdigest(),
        "grid_sha256": grid_hash,
        "grid_specification_hash": spec_hash,
        "field_minimum_position_angstrom": (
            np.asarray(origin)
            + np.asarray(np.unravel_index(field.argmin(), field.shape)) * STANDARD_SPACING_ANGSTROM
        ).tolist(),
        "field_maximum_position_angstrom": (
            np.asarray(origin)
            + np.asarray(np.unravel_index(field.argmax(), field.shape)) * STANDARD_SPACING_ANGSTROM
        ).tolist(),
    }
    if request.field_kind == "ELECTRON_DENSITY":
        if float(field.min()) < -1e-8:
            raise ValueError("Electron density is negative beyond numerical tolerance")
        integral = density_integral(field, STANDARD_SPACING_ANGSTROM)
        if not math.isclose(integral, output["density_integral_electrons"], abs_tol=1e-7):
            raise ValueError("Density integral diagnostic is inconsistent with field")
        metadata.update(
            density_integral_electrons=integral,
            density_integral_relative_error=abs(integral - payload.electron_count)
            / payload.electron_count,
            density_integral_note=(
                "Trapezoidal integral over finite Cartesian field; "
                "5% QA tolerance for clipping/core discretization. "
                "SCF electron count remains authoritative."
            ),
        )
    if density is not None:
        stats = surface_statistics(
            np.asarray(density.field_values).reshape(dimensions),
            field,
            origin,
            STANDARD_SPACING_ANGSTROM,
        )
        metadata.update(
            potential_method=(
                "Nuclear Z/r minus electronic Coulomb integral; "
                "PySCF df.incore.aux_e2 / fakemol_for_charges."
            ),
            surface_statistics={**stats, "density_grid_sha256": density.manifest.grid_sha256},
        )
    data = deterministic_npz(
        {
            "field_values": field,
            "density_matrix": matrix,
            "manifest_json": np.asarray([_json_bytes(metadata).decode()]),
        }
    )
    stored = object_store.put_raw(
        project.id, io.BytesIO(data), settings.scientific_max_output_bytes
    )
    created_at = utc_now()
    artifact = ScientificArtifactRecord(
        id=artifact_id,
        project_id=project.id,
        kind="VOLUMETRIC_GRID",
        media_type="application/vnd.chemdft.numpy-npz",
        format_identifier="chemdft.volumetric-field.npz",
        format_version="2.0.0",
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        storage_key=stored.key,
        created_by=identity.user_id,
        source_relation_type="calculation.result",
        source_relation_id=result.id,
        created_at=created_at,
        extensions_json=[
            {
                "namespace": FIELD_NAMESPACE,
                "schema_version": "1.0.0",
                "values": {**metadata, "generation_seconds": time.perf_counter() - started},
            }
        ],
    )
    session.add(artifact)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        existing = session.get(ScientificArtifactRecord, artifact_id)
        if existing is None:
            raise
        return read_field_output(object_store, settings, existing)
    provenance = ProvenanceRecordRow(
        id=metadata["provenance_record_id"],
        project_id=project.id,
        subject_type="scientific.artifact",
        subject_id=artifact_id,
        source_class="CALCULATED",
        detail="DETERMINISTIC_TRANSFORM",
        verification_state="UNVERIFIED",
        producer_kind="SOFTWARE",
        producer_identifier="pyscf",
        producer_software_version=payload.engine_version,
        source_artifact_id=str(payload.coefficient_artifact.artifact_id),
        operation="electronic.field.generate",
        operation_version=FIELD_GENERATOR_VERSION,
        parameters_json=[
            {
                "namespace": FIELD_NAMESPACE,
                "schema_version": "1.0.0",
                "values": [
                    {"key": "specification_hash", "value": spec_hash},
                    {"key": "density_matrix_hash", "value": matrix_hash(matrix)},
                ],
            }
        ],
        approximate=False,
        correlation_id=new_id(),
    )
    session.add(provenance)
    session.flush()
    for position, (kind, entity_id, digest) in enumerate(
        [
            ("ENTITY", result.id, payload.result_sha256),
            ("ENTITY", str(payload.input_structure_version_id), payload.input_structure_hash),
            (
                "ARTIFACT",
                str(payload.coefficient_artifact.artifact_id),
                payload.coefficient_artifact_sha256,
            ),
            *(
                [
                    (
                        "ARTIFACT",
                        str(density.manifest.artifact.artifact_id),
                        density.manifest.artifact.sha256,
                    )
                ]
                if density
                else []
            ),
        ]
    ):
        session.add(
            ProvenanceInputRow(
                provenance_record_id=provenance.id,
                project_id=project.id,
                position=position,
                input_type=kind,
                input_id=entity_id,
                input_sha256=digest,
            )
        )
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = session.get(ScientificArtifactRecord, artifact_id)
        if existing is None:
            raise
        return read_field_output(object_store, settings, existing)
    return read_field_output(object_store, settings, artifact)


def _json_bytes(values: Any) -> bytes:
    return json.dumps(values, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def read_field_output(
    object_store: ObjectStore, settings: Settings, artifact: ScientificArtifactRecord
) -> VolumetricFieldOutput:
    metadata = field_metadata(artifact)
    if (
        artifact.kind != "VOLUMETRIC_GRID"
        or artifact.format_identifier != "chemdft.volumetric-field.npz"
        or artifact.source_relation_type != "calculation.result"
        or artifact.source_relation_id != metadata.get("calculation_result_id")
    ):
        raise ValueError("Field artifact lacks successful SCF provenance")
    data = object_store.get_bytes(artifact.storage_key, settings.scientific_max_output_bytes)
    if hashlib.sha256(data).hexdigest() != artifact.sha256:
        raise ValueError("Field artifact hash mismatch")
    with np.load(io.BytesIO(data), allow_pickle=False) as archive:
        field = np.asarray(archive["field_values"], dtype="<f4")
        stored_metadata = json.loads(str(archive["manifest_json"][0]))
        matrix = archive["density_matrix"]
    if (
        stored_metadata != {k: v for k, v in metadata.items() if k != "generation_seconds"}
        or matrix_hash(matrix) != metadata["density_matrix_sha256"]
    ):
        raise ValueError("Field manifest or density-matrix integrity mismatch")
    if field.shape != tuple(metadata["dimensions"]) or not np.isfinite(field).all():
        raise ValueError("Field dimensions or values are invalid")
    raw = field.tobytes(order="C")
    if (
        hashlib.sha256(raw).hexdigest() != metadata["field_sha256"]
        or hashlib.sha256(bytes.fromhex(metadata["grid_specification_hash"]) + raw).hexdigest()
        != metadata["grid_sha256"]
    ):
        raise ValueError("Field hash mismatch")
    keys = VolumetricFieldManifest.model_fields
    values = {k: v for k, v in metadata.items() if k in keys}
    values.update(
        artifact=ArtifactReference(
            project_id=UUID(artifact.project_id),
            artifact_id=UUID(artifact.id),
            sha256=artifact.sha256,
        ),
        voxel_vectors_angstrom=[
            [STANDARD_SPACING_ANGSTROM if i == j else 0.0 for j in range(3)] for i in range(3)
        ],
        grid_generator_version=metadata["generator_version"],
        molecular_margin_angstrom=metadata["margin_angstrom"],
        artifact_size_bytes=artifact.size_bytes,
        created_at=artifact.created_at.replace(tzinfo=UTC),
    )
    return VolumetricFieldOutput(
        manifest=VolumetricFieldManifest.model_validate(values),
        field_values=tuple(float(v) for v in field.reshape(-1)),
    )
