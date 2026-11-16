"""RW-2 test support: seed accepted native-engine payloads into a disposable database.

`fixtures/rw2_evidence.json` holds payloads, specifications and an optimization trajectory copied
verbatim from the accepted native PySCF results (PF evidence). Tests seed them next to a structure
imported through the real API; no scientific value is typed in by hand except where a test says so.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from uuid import uuid4

from chemdft_api.models import Project as ProjectRecord
from chemdft_api.models import new_id
from chemdft_api.scientific_models import (
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    OptimizationTrajectoryRecord,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
)

EVIDENCE = json.loads((Path(__file__).parent / "fixtures/rw2_evidence.json").read_text())

WATER_XYZ = b"3\nwater\nO 0.0 0.0 0.0\nH 0.0 0.0 0.9572\nH 0.926627 0.0 -0.239987\n"
WATER_SHIFTED_XYZ = b"3\nwater\nO 0.0 0.0 0.0\nH 0.0 0.0 1.0572\nH 0.926627 0.0 -0.239987\n"
METHANE_XYZ = (
    b"5\nmethane\nC 0 0 0\nH 0.629 0.629 0.629\nH -0.629 -0.629 0.629\n"
    b"H -0.629 0.629 -0.629\nH 0.629 -0.629 -0.629\n"
)


def create_project(client, name="RW-2 analysis"):
    return client.post(
        "/v1/projects", json={"name": name, "slug": f"rw2-{uuid4().hex[:10]}"}
    ).json()["id"]


def import_structure(client, project_id, xyz=WATER_XYZ, name="water") -> str:
    response = client.post(
        f"/v1/projects/{project_id}/structures/imports",
        data={
            "file_format": "XYZ",
            "idempotency_key": f"rw2-{uuid4().hex}",
            "structure_name": name,
        },
        files={"upload": (f"{name}.xyz", xyz, "chemical/x-xyz")},
    )
    assert response.status_code == 201, response.text
    return response.json()["version"]["id"]


def seed_result(
    sessions,
    project_id: str,
    version_id: str,
    key: str,
    *,
    spec: dict | None = None,
    payload: dict | None = None,
    producer: dict | None = None,
    charge: int | None = None,
    multiplicity: int | None = None,
    result_type: str | None = None,
    replace_payload: bool = False,
) -> tuple[str, str]:
    """Insert a calculation and its AUTHORITATIVE/VALIDATED/UNVERIFIED result.

    Returns (calculation_id, result_id).
    """
    source = copy.deepcopy(EVIDENCE[key])
    specification = {**source["specification"], **(spec or {})}
    if charge is not None:
        specification["charge"] = charge
    if multiplicity is not None:
        specification["multiplicity"] = multiplicity
    result_payload = (
        dict(payload or {}) if replace_payload else {**source["payload"], **(payload or {})}
    )
    producer_json = {**source["producer"], **(producer or {})}
    result_id = new_id()
    with sessions() as session:
        USER = session.get(ProjectRecord, project_id).created_by
        calculation = CalculationRecord(project_id=project_id, state="SUCCEEDED", created_by=USER)
        artifact = ScientificArtifactRecord(
            project_id=project_id,
            kind="CALCULATION_INPUT",
            media_type="application/json",
            format_identifier="test.input",
            format_version="1.0.0",
            size_bytes=2,
            sha256="0" * 64,
            storage_key=f"test/{result_id}",
            created_by=USER,
            extensions_json=[],
        )
        session.add_all([calculation, artifact])
        session.flush()
        calc_input = CalculationInputRecord(
            project_id=project_id,
            calculation_id=calculation.id,
            structure_version_id=version_id,
            specification_json=specification,
            normalized_input_artifact_id=artifact.id,
        )
        session.add(calc_input)
        provenance = ProvenanceRecordRow(
            project_id=project_id,
            subject_type="calculation.result",
            subject_id=result_id,
            source_class="CALCULATED",
            detail="DETERMINISTIC_TRANSFORM",
            verification_state="UNVERIFIED",
            producer_kind="SOFTWARE",
            producer_identifier="test",
            producer_software_version="1",
            source_artifact_id=None,
            operation="test",
            operation_version="1",
            parameters_json=[],
            approximate=False,
            supersedes_id=None,
            correlation_id=calculation.id,
        )
        session.add(provenance)
        session.flush()
        session.add(
            CalculationResultRecord(
                id=result_id,
                project_id=project_id,
                calculation_id=calculation.id,
                calculation_input_id=calc_input.id,
                result_type=result_type or source["result_type"],
                authority="AUTHORITATIVE",
                source_class="CALCULATED",
                verification_state="UNVERIFIED",
                validation_state="VALIDATED",
                trusted_producer_id=source["trusted_producer_id"],
                trusted_producer_type=source["trusted_producer_type"],
                producer_attestation_id="test",
                producer_software_json=producer_json,
                payload_json=result_payload,
                provenance_record_id=provenance.id,
                raw_artifacts_json=[],
                idempotency_key=f"seed-{result_id}",
                request_id=new_id(),
                correlation_id=new_id(),
            )
        )
        if source.get("trajectory"):
            trajectory = source["trajectory"]
            session.add(
                OptimizationTrajectoryRecord(
                    project_id=project_id,
                    calculation_id=calculation.id,
                    input_structure_version_id=version_id,
                    atom_identities_json=trajectory["atom_identities"],
                    steps_json=trajectory["steps"],
                    state=trajectory["state"],
                    artifact_id=None,
                    artifact_sha256=None,
                    final_structure_version_id=version_id,
                    engine_json=trajectory["engine"],
                    input_hash=trajectory["input_hash"],
                )
            )
        session.commit()
        return calculation.id, result_id


def supersede(sessions, result_id: str) -> None:
    """Append a successor provenance record: the result becomes SUPERSEDED (kept as history)."""
    with sessions() as session:
        record = session.get(CalculationResultRecord, result_id)
        session.add(
            ProvenanceRecordRow(
                project_id=record.project_id,
                subject_type="calculation.result",
                subject_id=new_id(),
                source_class="CALCULATED",
                detail="DETERMINISTIC_TRANSFORM",
                verification_state="UNVERIFIED",
                producer_kind="SOFTWARE",
                producer_identifier="test",
                producer_software_version="1",
                source_artifact_id=None,
                operation="test",
                operation_version="1",
                parameters_json=[],
                approximate=False,
                supersedes_id=record.provenance_record_id,
                correlation_id=new_id(),
            )
        )
        session.commit()


def dispute(sessions, result_id: str) -> None:
    """Append a DISPUTED successor record (provenance is append-only)."""
    _successor(sessions, result_id, "DISPUTED")


def retract(sessions, result_id: str) -> None:
    """Append a RETRACTED successor record (provenance is append-only)."""
    _successor(sessions, result_id, "RETRACTED")


def _successor(sessions, result_id: str, verification_state: str) -> None:
    with sessions() as session:
        record = session.get(CalculationResultRecord, result_id)
        session.add(
            ProvenanceRecordRow(
                project_id=record.project_id,
                subject_type="calculation.result",
                subject_id=new_id(),
                source_class="CALCULATED",
                detail="DETERMINISTIC_TRANSFORM",
                verification_state=verification_state,
                producer_kind="SOFTWARE",
                producer_identifier="test",
                producer_software_version="1",
                source_artifact_id=None,
                operation="test",
                operation_version="1",
                parameters_json=[],
                approximate=False,
                supersedes_id=record.provenance_record_id,
                correlation_id=new_id(),
            )
        )
        session.commit()


def seed_field_artifact(
    sessions,
    settings,
    project_id: str,
    result_id: str,
    calculation_id: str,
    version_id: str,
    *,
    quantity: str = "ELECTRON_DENSITY",
    dims=(5, 4, 6),
    spacing: float = 0.12,
    origin=(-1.5, -1.25, -1.0),
    orbital_index: int | None = None,
    spin: str | None = None,
):
    """Store a small, well-formed `chemdft.volumetric-field.npz` the way the field generator does.

    The scalar values are an analytic stand-in (this exercises the CUBE *writer*; real PySCF
    fields are
    exported in the evidence-environment verification). Returns (artifact_id, float32 field array).
    """
    import hashlib
    import io
    from datetime import UTC, datetime

    import numpy as np
    from chemdft_api.scientific.engines.orbitals import deterministic_npz
    from chemdft_api.storage import LocalObjectStore

    unit = {
        "ELECTRON_DENSITY": "e/a0^3",
        "ELECTROSTATIC_POTENTIAL": "a.u.",
        "MO_AMPLITUDE": "a0^-3/2",
    }[quantity]
    grid = np.indices(dims).astype("<f8")
    field = (
        np.exp(-0.1 * ((grid[0] - 2) ** 2 + (grid[1] - 1) ** 2 + (grid[2] - 3) ** 2)) * 0.37
    ).astype("<f4")
    if quantity == "MO_AMPLITUDE":
        field = (field * np.where(grid[0] > 2, -1.0, 1.0)).astype("<f4")
    matrix = np.eye(2)
    raw = field.tobytes(order="C")
    spec_hash = hashlib.sha256(f"spec-{quantity}-{orbital_index}".encode()).hexdigest()
    artifact_id = new_id()
    argmin = np.unravel_index(field.argmin(), field.shape)
    argmax = np.unravel_index(field.argmax(), field.shape)
    metadata = {
        "field_kind": quantity,
        "grid_profile": "STANDARD",
        "orbital_index": orbital_index,
        "spin_channel": spin,
        "dimensions": list(dims),
        "origin_angstrom": list(origin),
        "spacing_angstrom": spacing,
        "margin_angstrom": 3.0,
        "coordinate_unit": "angstrom",
        "field_quantity": quantity,
        "field_unit": unit,
        "generator_version": "2.0.0",
        "grid_profile_version": "2.0.0",
        "calculation_id": calculation_id,
        "calculation_result_id": result_id,
        "result_sha256": "a" * 64,
        "input_structure_version_id": version_id,
        "calculation_input_hash": "b" * 64,
        "coefficient_artifact_sha256": "c" * 64,
        "density_matrix_sha256": hashlib.sha256(
            np.asarray(matrix, dtype="<f8").tobytes(order="C")
        ).hexdigest(),
        "density_matrix_electron_count": 10.0,
        "electron_count": 10,
        "method": "b3lyp",
        "basis": "def2-svp",
        "producer_version": "2.14.0",
        "provenance_record_id": new_id(),
        "field_min": float(field.min()),
        "field_max": float(field.max()),
        "field_sha256": hashlib.sha256(raw).hexdigest(),
        "grid_sha256": hashlib.sha256(bytes.fromhex(spec_hash) + raw).hexdigest(),
        "grid_specification_hash": spec_hash,
        "field_minimum_position_angstrom": [
            float(o + i * spacing) for o, i in zip(origin, argmin, strict=True)
        ],
        "field_maximum_position_angstrom": [
            float(o + i * spacing) for o, i in zip(origin, argmax, strict=True)
        ],
        "singularity_treatment": "test",
        "generation_seconds": 0.1,
        "density_integral_electrons": 10.0 if quantity == "ELECTRON_DENSITY" else None,
    }
    data = deterministic_npz(
        {
            "field_values": field,
            "density_matrix": matrix,
            "manifest_json": np.asarray(
                [
                    json.dumps(
                        {k: v for k, v in metadata.items() if k != "generation_seconds"},
                        sort_keys=True,
                        separators=(",", ":"),
                        allow_nan=False,
                    )
                ]
            ),
        }
    )
    stored = LocalObjectStore(settings.object_root).put_raw(
        project_id, io.BytesIO(data), 10_000_000
    )
    with sessions() as session:
        USER = session.get(ProjectRecord, project_id).created_by
        session.add(
            ScientificArtifactRecord(
                id=artifact_id,
                project_id=project_id,
                kind="VOLUMETRIC_GRID",
                media_type="application/vnd.chemdft.numpy-npz",
                format_identifier="chemdft.volumetric-field.npz",
                format_version="2.0.0",
                size_bytes=stored.size_bytes,
                sha256=stored.sha256,
                storage_key=stored.key,
                created_by=USER,
                source_relation_type="calculation.result",
                source_relation_id=result_id,
                created_at=datetime.now(UTC).replace(tzinfo=None),
                extensions_json=[
                    {
                        "namespace": "chemdft.volumetric-field",
                        "schema_version": "1.0.0",
                        "values": metadata,
                    }
                ],
            )
        )
        session.commit()
    return artifact_id, field
