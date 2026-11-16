"""Persistence-derived source bindings and effective dependency status for D4."""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import select

from .contracts.dftd4 import Dftd4SourceBinding
from .contracts.results import EnergyResult
from .contracts.scientific import CalculationSpecification
from .errors import ScientificValidationFailed
from .scientific.engines.normalization import normalized_calculation_input
from .scientific.engines.psi4 import digest, encode, parse_evidence, validate_specification
from .scientific_models import (
    CalculationInputRecord,
    CalculationResultRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureVersionRecord,
)


def require(ok, message):
    if not ok:
        raise ScientificValidationFailed("D4 source rejected: " + message)


def source_status(session, source):
    from .effective_result_state import effective_result_state
    if source is None:
        return "INVALIDATED"
    return effective_result_state(session, source).source_lineage_validity


def load_source(session, store, settings, project_id, result_id):
    source = session.get(CalculationResultRecord, str(result_id))
    require(
        source is not None and source.project_id == project_id,
        "missing or unrelated project result",
    )
    require(
        source_status(session, source) == "ACTIVE", "source retracted, superseded or invalidated"
    )
    require(
        source.result_type == "chemdft.energy"
        and source.source_class == "CALCULATED"
        and source.trusted_producer_id == "local.psi4.worker"
        and source.trusted_producer_type == "SCIENTIFIC_WORKER",
        "requires an uncorrected trusted Psi4 energy",
    )
    inp = session.get(CalculationInputRecord, source.calculation_input_id)
    provenance = session.get(ProvenanceRecordRow, source.provenance_record_id)
    require(
        inp is not None
        and inp.project_id == project_id
        and inp.calculation_id == source.calculation_id
        and provenance.project_id == project_id
        and provenance.subject_id == source.id
        and provenance.subject_type == "calculation.result"
        and provenance.source_class == "CALCULATED"
        and provenance.producer_identifier == "local.psi4.worker",
        "input/provenance association differs",
    )
    try:
        spec = CalculationSpecification.model_validate(inp.specification_json)
        validate_specification(spec)
        require(
            spec.task_type == "ENERGY"
            and spec.engine_preference.engine == "psi4"
            and spec.method.identifier in ("b3lyp", "pbe")
            and spec.basis.identifier == "def2-svp"
            and spec.dispersion is None
            and spec.charge == 0
            and spec.multiplicity == 1,
            "outside Psi4 uncorrected B3LYP/PBE def2-SVP neutral-singlet scope",
        )
        energy = EnergyResult.model_validate(source.payload_json)
        require(
            energy.total_energy.unit.code == "Eh"
            and energy.total_energy.unit.dimension == "ENERGY"
            and energy.converged
            and energy.method == spec.method.identifier
            and energy.basis == "def2-svp"
            and source.producer_software_json["name"] == "psi4"
            and source.producer_software_json["version"] == "1.11",
            "energy/engine/functional differs",
        )
        version = session.get(StructureVersionRecord, inp.structure_version_id)
        require(
            version is not None
            and version.project_id == project_id
            and version.periodic_cell_json is None,
            "missing molecular structure version",
        )

        def read(artifact_id, sha=None):
            record = session.get(ScientificArtifactRecord, str(artifact_id))
            require(
                record is not None and record.project_id == project_id, "missing source artifact"
            )
            data = store.get_bytes(record.storage_key, settings.scientific_max_output_bytes)
            require(
                digest(data) == record.sha256
                and len(data) == record.size_bytes
                and (sha is None or sha == record.sha256),
                "source artifact integrity differs",
            )
            return record, data

        canonical, canonical_bytes = read(version.canonical_artifact_id)
        input_artifact, data = read(inp.normalized_input_artifact_id)
        require(
            provenance.source_artifact_id == input_artifact.id,
            "provenance normalized input differs",
        )
        document = json.loads(data)
        rebuilt, _, _ = normalized_calculation_input(
            version, spec, max_atoms=min(128, settings.scientific_max_atoms)
        )
        rebuilt["input_structure_hash"] = canonical.sha256
        rebuilt["specification_hash"] = digest(encode(spec.model_dump(mode="json")))
        require(
            data == encode(rebuilt) and document == rebuilt,
            "immutable source specification/geometry differs",
        )
        # Canonical coordinates and stored version must describe the same accepted molecule.
        canonical_document = json.loads(canonical_bytes)
        require(
            canonical_document["coordinates"] == version.representation_json["coordinates"],
            "canonical artifact/version coordinates differ",
        )
        require(
            all(a["element"] in ("H", "C", "O") for a in document["atoms"]), "unsupported atoms"
        )
        raw, evidence = {}, []
        for ref in source.raw_artifacts_json:
            record, content = read(ref["artifact_id"], ref["sha256"])
            evidence.append(
                {"id": record.id, "sha256": record.sha256, "format": record.format_identifier}
            )
            if record.format_identifier.startswith("psi4.native."):
                require(
                    record.source_relation_id == source.calculation_id
                    and record.source_relation_type == "calculation.record",
                    "native evidence owner differs",
                )
                key = record.format_identifier.removeprefix("psi4.native.")
                require(key not in raw, "duplicate source evidence")
                raw[key] = content
        parsed = parse_evidence(raw, document)
        require(
            parsed["total_energy_hartree"] == energy.total_energy.value,
            "source energy contradicts native evidence",
        )
        require(
            json.loads(raw["invocation.json"])["calculation_id"] == source.calculation_id,
            "source native calculation differs",
        )
        edges = [
            {"type": e.input_type, "id": e.input_id, "sha256": e.input_sha256}
            for e in session.scalars(
                select(ProvenanceInputRow)
                .where(ProvenanceInputRow.provenance_record_id == provenance.id)
                .order_by(ProvenanceInputRow.position)
            )
        ]
        prov_hash = digest(
            encode(
                {
                    "subject": provenance.subject_id,
                    "source": provenance.source_artifact_id,
                    "operation": provenance.operation,
                    "version": provenance.operation_version,
                    "producer": provenance.producer_identifier,
                    "parameters": provenance.parameters_json,
                    "inputs": edges,
                }
            )
        )
        binding = Dftd4SourceBinding(
            project_id=UUID(project_id),
            result_id=UUID(source.id),
            calculation_id=UUID(source.calculation_id),
            calculation_input_id=UUID(inp.id),
            structure_version_id=UUID(version.id),
            canonical_artifact_id=UUID(canonical.id),
            canonical_sha256=canonical.sha256,
            normalized_input_sha256=input_artifact.sha256,
            specification_sha256=rebuilt["specification_hash"],
            result_payload_sha256=digest(encode(source.payload_json)),
            provenance_id=UUID(provenance.id),
            provenance_sha256=prov_hash,
            engine_identity_sha256=digest(encode(source.producer_software_json)),
            native_evidence_sha256=digest(encode(evidence)),
            geometry_sha256=digest(encode(document["atoms"])),
            functional=spec.method.identifier,
            source_verification_state=source.verification_state,
            source_energy_hartree=energy.total_energy.value,
        )
        return binding, document["atoms"]
    except ScientificValidationFailed:
        raise
    except (ValueError, KeyError, TypeError, OSError) as error:
        raise ScientificValidationFailed("D4 source evidence invalid: " + str(error)) from error
