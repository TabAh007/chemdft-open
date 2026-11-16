"""Electronic-state authority for immutable XYZ imports, without historical rewrites."""

from __future__ import annotations

import hashlib
import json

from sqlalchemy.orm import Session

from ..errors import StructureElectronicStateMismatch
from ..scientific_models import (
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from ..storage import ObjectStore
from .adapters.molecular.rdkit_adapter import _decode_text, _split_xyz_frames, parse_xyz

MAX_BYTES = 10 * 1024 * 1024


def electronic_state_authority(
    session: Session, store: ObjectStore, version: StructureVersionRecord
) -> dict[str, object]:
    """Only verified, original unannotated XYZ imports may use calculation declarations."""
    binding: dict[str, object] = {
        "authority": "STRUCTURE_VERSION",
        "structure_version_id": version.id,
    }
    source = session.get(ScientificArtifactRecord, version.source_artifact_id)
    if (
        version.origin != "IMPORTED"
        or version.representation_json.get("geometry_acceptance")
        or source is None
        or source.format_identifier.upper() != "XYZ"
    ):
        return binding

    def reject() -> None:
        raise StructureElectronicStateMismatch(
            "XYZ_ELECTRONIC_STATE_PROVENANCE_INVALID",
            "XYZ electronic-state authority cannot be established from bound import provenance.",
        )

    provenance = session.get(ProvenanceRecordRow, version.provenance_record_id)
    canonical = session.get(ScientificArtifactRecord, version.canonical_artifact_id)
    if (
        provenance is None
        or canonical is None
        or {source.project_id, canonical.project_id, provenance.project_id} != {version.project_id}
        or provenance.subject_type != "structure.version"
        or provenance.subject_id != version.id
        or provenance.operation != "chemdft.structure.import"
        or provenance.producer_kind != "USER"
        or provenance.source_artifact_id != source.id
        or canonical.source_relation_type != "scientific.artifact"
        or canonical.source_relation_id != source.id
    ):
        reject()

    def checked(artifact: ScientificArtifactRecord) -> bytes:
        try:
            data = store.get_bytes(artifact.storage_key, MAX_BYTES)
        except OSError:
            reject()
        if hashlib.sha256(data).hexdigest() != artifact.sha256:
            reject()
        ref_name = "source_artifact" if artifact.id == source.id else "canonical_artifact"
        ref = version.representation_json.get(ref_name, {})
        if (
            ref.get("project_id") != version.project_id
            or ref.get("artifact_id") != artifact.id
            or ref.get("sha256") != artifact.sha256
        ):
            reject()
        return data

    try:
        source_bytes = checked(source)
        document = json.loads(checked(canonical))
        parameters = {p["key"]: p["value"] for p in provenance.parameters_json}
        if (
            parameters.get("format") != "XYZ"
            or document["source"]["format"] != "XYZ"
            or document["kind"] != "MOLECULE"
            or version.periodic_cell_json is not None
            or document["coordinates"] != version.representation_json["coordinates"]
            or document["overall_charge"] != version.overall_charge
            or document["multiplicity"] != version.multiplicity
        ):
            reject()
        index = parameters.get("selection_index")
        if index is not None and (type(index) is not int or index < 0):
            reject()
        indices = (
            [index]
            if index is not None
            else range(len(_split_xyz_frames(_decode_text(source_bytes))))
        )
        matches = []
        for selected in indices:
            candidate = parse_xyz(source_bytes, selection_index=selected)
            if list(candidate.atoms) == document["coordinates"]["atoms"]:
                matches.append(candidate)
        if not matches:
            reject()
        states = {(c.electronic_state_declared, c.overall_charge, c.multiplicity) for c in matches}
        if len(states) != 1:
            reject()
        declared, charge, multiplicity = states.pop()
        marker = parameters.get("electronic_state_authority")
        if declared:
            if (
                marker != "USER_DECLARED_XYZ"
                or parameters.get("declared_charge") != charge
                or parameters.get("declared_multiplicity") != multiplicity
                or (version.overall_charge, version.multiplicity) != (charge, multiplicity)
            ):
                reject()
            authority = "USER_DECLARED_XYZ"
        else:
            if marker not in {None, "UNSPECIFIED_XYZ"} or (
                version.overall_charge,
                version.multiplicity,
            ) != (0, 1):
                reject()
            authority = "CALCULATION_USER_DECLARED"
    except StructureElectronicStateMismatch:
        raise
    except (ValueError, TypeError, KeyError, IndexError):
        reject()
    binding.update(
        authority=authority,
        source_artifact_id=source.id,
        source_sha256=source.sha256,
        structure_provenance_id=provenance.id,
    )
    return binding
