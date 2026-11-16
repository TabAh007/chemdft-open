# ruff: noqa: E501  (fixed manifest/README text)
"""Portable evidence archive for one calculation: default-deny, regenerated, bounded.

THE ARCHIVE IS A WHITELIST, NOT A FILTER. It is assembled only from fixed-name members whose
content is regenerated from validated structured records through `portable_export_policy`:

  README.txt                        fixed text
  MANIFEST.json                     validated facts, fixed vocabulary, counts
  SHA256SUMS                        checksums of every other member
  calculation/specification.json    approved-key projection of the stored specification
  inputs/structure-version.json     element symbols + coordinates + charge/multiplicity (regenerated)
  inputs/structure.xyz              the same atoms in XYZ with a FIXED comment line
  inputs/calculation-input-summary.json   approved-key projection of the normalized engine input
  results/result.json               approved-key projection of the stored payload + standing
  results/lineage.json              approved-field provenance records (no parameters)
  environment/execution-N.json      allowlisted platform/library/thread facts

NO artifact bytes are copied: logs, native outputs, original uploads and every other stored object
are WITHHELD by policy and listed only as (artifact id, closed-vocabulary kind, size). Original
bytes are read in-process solely to verify their recorded SHA-256 and are never written out.
No project/structure/user label, artifact format identifier or file name is ever exported, and no
member name is derived from stored data.

Classes (never conflated):
  PROVENANCE_ARCHIVE       what was run and where it came from; at least one category a re-run needs
                           is missing, unverifiable or was withheld (the manifest says which).
  REPRODUCIBILITY_PACKAGE  specification, structure, verified engine input, engine identity, recorded
                           environment and result are all exported without scientific loss. It lets
                           another researcher ATTEMPT the same calculation with the same engine
                           build. Exact reproduction is not claimed or tested.
  EXECUTABLE WORKFLOW      never provided.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import portable_export_policy as policy
from .actions import authorize_project_access
from .calculation_summary import version_atoms
from .config import Settings
from .context import Identity
from .contracts.analysis import ExportVariant
from .contracts.scientific import CalculationLifecycle
from .effective_result_state import effective_result_state
from .errors import ExportBlocked, ExportLimitExceeded, ScientificReferenceNotFound
from .scientific_export import ExportPayload
from .scientific_models import (
    CalculationAttemptRecord,
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ComputeExecutionRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from .storage import ObjectStore

BUNDLE_SCHEMA = "chemdft.reproducibility-bundle.v2"

# Whole-archive limits, enforced as members are produced (before the ZIP exists).
MAX_MEMBERS = 24
MAX_MEMBER_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 24 * 1024 * 1024
MAX_ZIP_BYTES = 16 * 1024 * 1024
MAX_ENVIRONMENTS = 6
MAX_LINEAGE_RECORDS = 64
MAX_WITHHELD_LISTED = 200
_ZIP_TIME = (2020, 1, 1, 0, 0, 0)

#: Final-boundary tripwire. It can only BLOCK an export; it never decides that content is safe.
_SECRET_TEXT = re.compile(
    rb"(sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/=-]{16,}|"
    rb"(?i:api[_-]?key|secret|password|token)\s*[:=]\s*\S{8,}|-----BEGIN [A-Z ]*PRIVATE KEY)"
)
# The ONLY member names that can exist; none is derived from stored data.
_MEMBER_NAME = re.compile(
    r"^(README\.txt|MANIFEST\.json|SHA256SUMS|calculation/specification\.json|"
    r"inputs/structure-version\.json|inputs/structure\.xyz|inputs/calculation-input-summary\.json|"
    r"results/result\.json|results/lineage\.json|environment/execution-[1-9][0-9]?\.json)$"
)

#: Reason codes are a closed vocabulary: never stored data, names or file contents.
REASONS = {
    "RECORD_MISSING": "A required stored record does not exist.",
    "NOT_RECORDED": "The platform did not record this information.",
    "HASH_MISMATCH": "Stored bytes do not match their recorded SHA-256.",
    "UNREADABLE": "The stored object could not be read.",
    "TOO_LARGE": "The stored object exceeds the verification size bound.",
    "NOT_REVIEWED_FOR_EXPORT": "Part of the stored content is not approved for portable export.",
    "INVALID": "The stored record failed validation.",
    "NO_BUILD_IDENTITY": "A native engine ran but no executable or package build digest was recorded.",
    "NO_SOFTWARE_VERSIONS": "The recorded environment lacks the Python runtime and library versions the engine needs.",
}
REQUIRED = ("SPECIFICATION", "STRUCTURE", "ENGINE_INPUT", "ENGINE_IDENTITY", "ENVIRONMENT", "RESULT")

EXECUTABLE_WORKFLOW = {
    "provided": False,
    "reason": (
        "ChemDFT does not generate a runnable script or container. The exported specification, "
        "structure and engine identity are what a researcher needs to attempt the run by hand."
    ),
}
LIMITATIONS = (
    "Raw engine outputs, logs, original uploads and every other stored artifact are withheld by "
    "policy; this archive does not contain them.",
    "Free-text labels, names and comments are not exported.",
    "Structure and input files are regenerated from validated records; their original bytes are "
    "not included. Recorded SHA-256 values refer to the original stored objects.",
    "Values in this archive passed an allowlist; the archive makes no claim that nothing else "
    "sensitive exists in the originating platform.",
    "Exact reproducibility is not claimed or tested.",
)


class Archive:
    """Accumulates members under whole-archive limits; names must match the fixed grammar."""

    def __init__(self) -> None:
        self.members: dict[str, tuple[bytes, str]] = {}
        self.total = 0

    def add(self, name: str, data: bytes, role: str) -> None:
        if not _MEMBER_NAME.fullmatch(name) or name in self.members or ".." in name:
            raise ExportBlocked("Archive member name rejected.")
        if len(self.members) >= MAX_MEMBERS:
            raise ExportLimitExceeded("Archive member count limit exceeded.")
        if len(data) > MAX_MEMBER_BYTES:
            raise ExportLimitExceeded("Archive member size limit exceeded.")
        if self.total + len(data) > MAX_TOTAL_BYTES:
            raise ExportLimitExceeded("Archive total size limit exceeded.")
        self.total += len(data)
        self.members[name] = (data, role)

    def add_json(self, name: str, document: Any, role: str) -> None:
        text = json.dumps(document, indent=2, sort_keys=True, ensure_ascii=True, allow_nan=False)
        self.add(name, (text + "\n").encode("ascii"), role)


@dataclass
class Assessment:
    archive: Archive = field(default_factory=Archive)
    status: dict[str, str] = field(default_factory=dict)  # category -> INCLUDED | reason code
    omissions: policy.Omissions = field(default_factory=policy.Omissions)
    withheld: list[dict[str, Any]] = field(default_factory=list)
    withheld_extra: int = 0
    facts: dict[str, Any] = field(default_factory=dict)

    def mark(self, category: str, reason: str | None) -> None:
        self.status[category] = reason or "INCLUDED"

    @property
    def classification(self) -> str:
        return (
            "REPRODUCIBILITY_PACKAGE"
            if all(self.status.get(c) == "INCLUDED" for c in REQUIRED)
            else "PROVENANCE_ARCHIVE"
        )

    def missing(self) -> list[dict[str, str]]:
        return [
            {"category": c, "reason_code": self.status.get(c, "NOT_RECORDED")}
            for c in REQUIRED
            if self.status.get(c) != "INCLUDED"
        ]


# ---------------------------------------------------------------------------------------------
# Category builders. Each reads UNTRUSTED stored data and emits only projected content.
# ---------------------------------------------------------------------------------------------


def _project(name: str, raw: Any, root: str, out: Assessment) -> Any:
    try:
        return policy.projector(name).project(raw, root, out.omissions)
    except policy.ExportLimitError as error:
        raise ExportLimitExceeded("A stored record exceeds the export bound.") from error


def _verify_object(
    store: ObjectStore, artifact: ScientificArtifactRecord | None, cap: int, *, read: bool
) -> tuple[bytes | None, str | None]:
    """Reads stored bytes only to verify their SHA-256 in-process; returns (bytes, reason)."""
    if artifact is None:
        return None, "RECORD_MISSING"
    if not read:
        return None, None
    if artifact.size_bytes > cap:
        return None, "TOO_LARGE"
    try:
        data = store.get_bytes(artifact.storage_key, cap)
    except (OSError, ValueError):
        return None, "UNREADABLE"
    if hashlib.sha256(data).hexdigest() != artifact.sha256:
        return None, "HASH_MISMATCH"
    return data, None


def _scoped(out: Assessment, prefix: str) -> policy.Omissions:
    return policy.Omissions(
        policy.Counter({k: v for k, v in out.omissions.counts.items() if k[1].startswith(prefix)})
    )


def _specification(out: Assessment, calc_input: CalculationInputRecord | None) -> dict[str, Any] | None:
    if calc_input is None:
        out.mark("SPECIFICATION", "RECORD_MISSING")
        return None
    spec = _project("specification", calc_input.specification_json, "specification", out)
    engine = ((spec or {}).get("engine_preference") or {}).get("engine") if isinstance(spec, dict) else None
    raw_basis = isinstance(calc_input.specification_json, dict) and calc_input.specification_json.get("basis")
    have_basis = isinstance(spec, dict) and isinstance(spec.get("basis"), dict) and spec["basis"].get("identifier")
    complete = (
        isinstance(spec, dict)
        and spec.get("task_type")
        and isinstance((spec.get("method") or {}).get("identifier"), str)
        and isinstance(spec.get("charge"), int)
        and isinstance(spec.get("multiplicity"), int)
        and engine
        and (have_basis or not raw_basis)
    )
    if not complete or _scoped(out, "specification").scientific_loss(strict_text=True):
        out.mark("SPECIFICATION", "NOT_REVIEWED_FOR_EXPORT" if spec else "INVALID")
    else:
        out.mark("SPECIFICATION", None)
    if spec:
        out.archive.add_json(
            "calculation/specification.json",
            {"schema": "chemdft.portable-specification.v1", "specification": spec},
            "approved-key projection of the stored calculation specification",
        )
    out.facts["engine"] = engine
    return spec


def _structure(
    out: Assessment, session: Session, store: ObjectStore, settings: Settings,
    project_id: str, calc_input: CalculationInputRecord | None, *, read: bool,
) -> None:
    version = (
        session.scalar(
            select(StructureVersionRecord).where(
                StructureVersionRecord.id == calc_input.structure_version_id,
                StructureVersionRecord.project_id == project_id,
            )
        )
        if calc_input
        else None
    )
    if version is None:
        out.mark("STRUCTURE", "RECORD_MISSING")
        return
    atoms: list[dict[str, Any]] = []
    valid = True
    for atom in version_atoms(version):
        element = atom.get("element") if isinstance(atom, dict) else None
        coords = [policy.safe_number(atom.get(a)) if isinstance(atom, dict) else None for a in "xyz"]
        if element not in policy.ELEMENTS or any(c is None for c in coords):
            valid = False
            continue
        atoms.append({"element": element, "x": coords[0], "y": coords[1], "z": coords[2]})
    unit = policy.safe_enum(version.coordinate_unit, policy.COORDINATE_UNITS)
    charge = policy.safe_int(version.overall_charge, -64, 64)
    multiplicity = policy.safe_int(version.multiplicity, 1, 65)
    canonical = session.get(ScientificArtifactRecord, version.canonical_artifact_id)
    original_sha = policy.safe_sha256(canonical.sha256) if canonical else None
    _data, reason = _verify_object(store, canonical, settings.scientific_max_output_bytes, read=read)
    if not atoms or not valid or unit is None or charge is None or multiplicity is None:
        out.mark("STRUCTURE", "NOT_REVIEWED_FOR_EXPORT")
        out.omissions.add("UNAPPROVED_FIELD", "structure")
        return
    version_id = policy.safe_uuid(version.id)
    out.archive.add_json(
        "inputs/structure-version.json",
        {
            "schema": "chemdft.portable-structure.v1",
            "structure_version_id": version_id,
            "revision": policy.safe_int(version.revision, 1, 10**6),
            "origin": policy.safe_enum(version.origin, policy.STRUCTURE_ORIGINS),
            "coordinate_unit": unit,
            "overall_charge": charge,
            "multiplicity": multiplicity,
            "atom_count": len(atoms),
            "atoms": atoms,
            "regenerated_from_validated_record": True,
            "original_artifact_sha256": original_sha,
            "original_artifact_verified_in_process": bool(read and reason is None),
            "original_bytes_included": False,
        },
        "regenerated structure (elements, coordinates, charge, multiplicity)",
    )
    if unit == "angstrom":
        lines = [str(len(atoms)), f"ChemDFT structure version {version_id} (regenerated, angstrom)"]
        lines += [f"{a['element']} {a['x']!r} {a['y']!r} {a['z']!r}" for a in atoms]
        out.archive.add("inputs/structure.xyz", ("\n".join(lines) + "\n").encode("ascii"),
                        "regenerated XYZ with a fixed comment line")
    out.mark("STRUCTURE", reason if read else None)
    out.facts["structure_version_id"] = version_id


def _engine_input(
    out: Assessment, session: Session, store: ObjectStore, settings: Settings,
    calc_input: CalculationInputRecord | None, *, read: bool,
) -> None:
    if calc_input is None:
        out.mark("ENGINE_INPUT", "RECORD_MISSING")
        return
    artifact = session.get(ScientificArtifactRecord, calc_input.normalized_input_artifact_id)
    data, reason = _verify_object(store, artifact, settings.scientific_max_output_bytes, read=read)
    if reason:
        out.mark("ENGINE_INPUT", reason)
        return
    if not read:
        out.mark("ENGINE_INPUT", None)
        return
    try:
        document = json.loads(data or b"")
    except ValueError:
        out.mark("ENGINE_INPUT", "INVALID")
        return
    summary = _project("normalized", document, "normalized", out)
    if not isinstance(summary, dict) or _scoped(out, "normalized").scientific_loss(strict_text=True):
        out.mark("ENGINE_INPUT", "NOT_REVIEWED_FOR_EXPORT")
        return
    out.archive.add_json(
        "inputs/calculation-input-summary.json",
        {
            "schema": "chemdft.portable-input-summary.v1",
            "verified_against_recorded_sha256": True,
            "original_artifact_sha256": policy.safe_sha256(artifact.sha256 if artifact else None),
            "original_bytes_included": False,
            "document": summary,
        },
        "approved-key projection of the verified normalized engine input",
    )
    out.mark("ENGINE_INPUT", None)


def _result(
    out: Assessment, session: Session, project_id: str, record: CalculationResultRecord | None
) -> Any:
    if record is None:
        out.mark("RESULT", "RECORD_MISSING")
        out.mark("ENGINE_IDENTITY", "RECORD_MISSING")
        return None
    from .calculation_summary import summarize_result

    try:
        summary_quantities = list(summarize_result(session, record).quantities)
    except Exception:  # malformed stored record: no summary, the projection below decides
        summary_quantities = []
        out.omissions.add("UNAPPROVED_FIELD", "summary")
    state = _safe_state(session, record)
    engine_raw = record.producer_software_json
    engine = _project("engine", engine_raw, "engine", out)
    name = engine.get("name") if isinstance(engine, dict) else None
    version = engine.get("version") if isinstance(engine, dict) else None
    out.mark("ENGINE_IDENTITY", None if name and version else "NOT_REVIEWED_FOR_EXPORT")
    out.facts["engine_identity"] = {"name": name, "version": version}
    payload = _project("payload", record.payload_json, "payload", out)
    result_type = policy.safe_enum(record.result_type, policy.RESULT_TYPES)
    if result_type is None or not isinstance(payload, dict) or _scoped(out, "payload").scientific_loss():
        out.mark("RESULT", "NOT_REVIEWED_FOR_EXPORT")
    else:
        out.mark("RESULT", None)
    quantities = []
    for q in summary_quantities:
        if (
            re.fullmatch(r"[a-z0-9_:]{1,64}", q.key)
            and q.unit in policy.UNIT_CODES
            and policy.safe_number(q.value) is not None
        ):
            quantities.append({"key": q.key, "value": q.value, "unit": q.unit})
    verification = policy.safe_enum(getattr(state, "verification_state", None), frozenset({"UNVERIFIED", "VERIFIED", "DISPUTED", "RETRACTED", "SUPERSEDED"}))
    out.archive.add_json(
        "results/result.json",
        {
            "schema": "chemdft.portable-result.v1",
            "result_id": policy.safe_uuid(record.id),
            "calculation_id": policy.safe_uuid(record.calculation_id),
            "result_type": result_type,
            "created_at": policy.iso(record.created_at),
            "engine": engine,
            "scientific_state_at_generation": {
                "evidence_use": _evidence_use(state),
                "stored_authority": _authority(state, "stored_authority"),
                "effective_authority": _authority(state, "authority"),
                "source_lineage_validity": getattr(state, "source_lineage_validity", None),
                "independent_verification_state": verification,
                "independent_verification_statement": (
                    "Not independently verified. Agreement with another calculation is not independent verification."
                    if verification == "UNVERIFIED" else "See the recorded verification state."
                ),
            },
            "summary_quantities": quantities,
            "payload": payload,
            "stored_payload_sha256": policy_sha256_json(record.payload_json),
            "payload_projection_note": "payload keeps approved fields and numbers exactly; free text is not exported (see omissions in the manifest)",
        },
        "approved-key projection of the stored result with scientific standing at generation time",
    )
    return record


_AUTHORITIES = frozenset({"AUTHORITATIVE", "CANDIDATE", "VERIFICATION", "IMPORTED"})


def _safe_state(session: Session, record: CalculationResultRecord | None) -> Any:
    if record is None:
        return None
    try:
        return effective_result_state(session, record)
    except Exception:  # fail closed: standing becomes UNKNOWN, never CURRENT
        return None


def _evidence_use(state: Any) -> str:
    if state is None:
        return "UNKNOWN"
    return "CURRENT" if state.eligible_for_derivation else "HISTORICAL_ONLY"


def _authority(state: Any, attribute: str) -> str | None:
    value = getattr(state, attribute, None)
    return value if value in _AUTHORITIES else None


def policy_sha256_json(value: Any) -> str | None:
    try:
        return hashlib.sha256(
            json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        ).hexdigest()
    except (TypeError, ValueError):
        return None


def _environment(out: Assessment, session: Session, project_id: str, calc_id: str) -> None:
    executions = session.scalars(
        select(ComputeExecutionRecord)
        .where(
            ComputeExecutionRecord.calculation_id == calc_id,
            ComputeExecutionRecord.project_id == project_id,
        )
        .order_by(ComputeExecutionRecord.created_at, ComputeExecutionRecord.id)
    ).all()
    written = 0
    engine = (out.facts.get("engine_identity") or {}).get("name") or out.facts.get("engine")
    reasons: list[str | None] = []
    for execution in executions:
        if not execution.environment_json or written >= MAX_ENVIRONMENTS:
            continue
        projected = policy.project_environment(execution.environment_json, out.omissions, "environment")
        if projected:
            written += 1
            reasons.append(policy.environment_sufficiency(projected, engine))
            out.archive.add_json(
                f"environment/execution-{written}.json",
                {
                    "schema": "chemdft.portable-environment.v1",
                    "execution_index": written,
                    "recorded_environment": projected,
                },
                "allowlisted recorded execution environment (no paths, no process data)",
            )
    if not written:
        out.mark("ENVIRONMENT", "NOT_RECORDED")
    elif any(r is None for r in reasons):
        out.mark("ENVIRONMENT", None)
    else:
        out.mark("ENVIRONMENT", reasons[0])


def _lineage(out: Assessment, session: Session, project_id: str, record: CalculationResultRecord | None) -> None:
    if record is None:
        return
    rows = session.scalars(
        select(ProvenanceRecordRow)
        .where(
            ProvenanceRecordRow.project_id == project_id,
            (ProvenanceRecordRow.id == record.provenance_record_id)
            | (ProvenanceRecordRow.supersedes_id == record.provenance_record_id),
        )
        .order_by(ProvenanceRecordRow.created_at, ProvenanceRecordRow.id)
        .limit(MAX_LINEAGE_RECORDS)
    ).all()
    records = []
    for row in rows:
        inputs = session.scalars(
            select(ProvenanceInputRow)
            .where(ProvenanceInputRow.project_id == project_id, ProvenanceInputRow.provenance_record_id == row.id)
            .order_by(ProvenanceInputRow.position)
            .limit(MAX_LINEAGE_RECORDS)
        ).all()
        if row.parameters_json:
            out.omissions.add("FREE_TEXT", "lineage.parameters")
        records.append(
            {
                "record_id": policy.safe_uuid(row.id),
                "supersedes_id": policy.safe_uuid(row.supersedes_id),
                "subject_type": row.subject_type if policy.SUBJECT_RE.fullmatch(row.subject_type or "") else None,
                "subject_id": policy.safe_uuid(row.subject_id),
                "source_class": policy.safe_enum(row.source_class, frozenset({"EXPERIMENTAL", "CALCULATED", "EXTRACTED", "DIGITIZED", "USER_SUPPLIED", "AI_HYPOTHESIS", "IMPORTED"})),
                "verification_state": policy.safe_enum(row.verification_state, frozenset({"UNVERIFIED", "VERIFIED", "DISPUTED", "RETRACTED", "SUPERSEDED"})),
                "producer_kind": policy.safe_enum(row.producer_kind, frozenset({"SOFTWARE", "USER", "SERVICE", "AI"})),
                "producer": row.producer_identifier if policy.PRODUCER_RE.fullmatch(row.producer_identifier or "") else None,
                "producer_software_version": policy.safe_version(row.producer_software_version),
                "operation": row.operation if policy.OPERATION_RE.fullmatch(row.operation or "") else None,
                "operation_version": policy.safe_version(row.operation_version),
                "approximate": bool(row.approximate),
                "created_at": policy.iso(row.created_at),
                "inputs": [
                    {
                        "input_type": e.input_type if policy.INPUT_TYPE_RE.fullmatch(e.input_type or "") else None,
                        "input_id": policy.safe_uuid(e.input_id),
                        "input_sha256": policy.safe_sha256(e.input_sha256),
                    }
                    for e in inputs
                ],
            }
        )
    out.archive.add_json(
        "results/lineage.json",
        {"schema": "chemdft.portable-lineage.v1", "records": records, "free_form_parameters_exported": False},
        "approved-field provenance records (parameters and free text are not exported)",
    )


def _withheld(out: Assessment, session: Session, project_id: str, calc_id: str, record: CalculationResultRecord | None) -> None:
    ids: dict[str, None] = {}
    attempts = session.scalars(
        select(CalculationAttemptRecord).where(
            CalculationAttemptRecord.calculation_id == calc_id,
            CalculationAttemptRecord.project_id == project_id,
        )
    ).all()
    for ref in [*(record.raw_artifacts_json if record else []), *(r for a in attempts for r in (a.raw_artifacts_json or []))]:
        clean = policy.safe_uuid(ref.get("artifact_id")) if isinstance(ref, dict) else None
        if clean:
            ids[clean] = None
    for index, artifact_id in enumerate(ids):
        if index >= MAX_WITHHELD_LISTED:
            out.withheld_extra += 1
            continue
        artifact = session.get(ScientificArtifactRecord, artifact_id)
        known = artifact is not None and artifact.project_id == project_id
        out.withheld.append(
            {
                "artifact_id": artifact_id,
                "kind": (policy.safe_enum(artifact.kind, policy.ARTIFACT_KINDS) or "UNKNOWN") if known else "UNRESOLVED",
                "size_bytes": policy.safe_int(artifact.size_bytes, 0, 2**50) if known else None,
                "disposition": "WITHHELD_BY_POLICY",
            }
        )


def _assess(
    session: Session, identity: Identity, store: ObjectStore, settings: Settings,
    project_id: str, calculation_id: str, *, read: bool,
) -> tuple[Assessment, dict[str, Any]]:
    calc = session.get(CalculationRecord, calculation_id)
    if calc is None or calc.project_id != project_id:
        raise ScientificReferenceNotFound("Calculation does not exist.")
    calc_input = session.scalar(
        select(CalculationInputRecord).where(
            CalculationInputRecord.calculation_id == calc.id,
            CalculationInputRecord.project_id == project_id,
        )
    )
    record = session.scalar(
        select(CalculationResultRecord).where(
            CalculationResultRecord.calculation_id == calc.id,
            CalculationResultRecord.project_id == project_id,
        )
    )
    out = Assessment()
    _specification(out, calc_input)
    _structure(out, session, store, settings, project_id, calc_input, read=read)
    _engine_input(out, session, store, settings, calc_input, read=read)
    _result(out, session, project_id, record)
    _environment(out, session, project_id, calc.id)
    _lineage(out, session, project_id, record)
    _withheld(out, session, project_id, calc.id, record)
    return out, {"calc": calc, "record": record, "effective": _safe_state(session, record)}


def assess_variant(
    session: Session, identity: Identity, store: ObjectStore, settings: Settings,
    project_id: str, calculation_id: str,
) -> ExportVariant:
    """The archive's classification, decided exactly as the download decides it.

    RW-3.2: the catalog runs the same assessment as `build_bundle` (``read=True``): stored structure and
    engine-input bytes are read, hash-verified and projected, so an engine input that cannot be exported
    without scientific loss (for example CREST's) downgrades the catalog entry just as it downgrades the
    archive. Previously the catalog skipped that projection and could advertise REPRODUCIBILITY_PACKAGE
    for an archive that is a PROVENANCE_ARCHIVE.
    """
    project, _member = authorize_project_access(session, identity, project_id)
    out, _ = _assess(session, identity, store, settings, project.id, calculation_id, read=True)
    if out.classification == "REPRODUCIBILITY_PACKAGE":
        return ExportVariant(
            key="REPRODUCIBILITY_PACKAGE",
            label="Reproducibility package",
            detail="Specification, structure, engine identity, environment and result are exportable; "
            "stored inputs are verified on download. Raw outputs are withheld. Exact reproduction is "
            "not claimed. No executable workflow.",
        )
    codes = ", ".join(f"{m['category']}: {m['reason_code']}" for m in out.missing())
    return ExportVariant(
        key="PROVENANCE_ARCHIVE",
        label="Provenance archive",
        detail=f"Not sufficient to re-run — {codes}."[:300],
    )


def build_bundle(
    session: Session, identity: Identity, store: ObjectStore, settings: Settings,
    project_id: str, calculation_id: str,
) -> ExportPayload:
    project, _member = authorize_project_access(session, identity, project_id)
    out, context = _assess(session, identity, store, settings, project.id, calculation_id, read=True)
    calc, effective = context["calc"], context["effective"]
    classification = out.classification
    calc_uuid = policy.safe_uuid(calc.id)
    state = policy.safe_enum(str(calc.state), frozenset(m.value for m in CalculationLifecycle))
    readme = (
        f"ChemDFT portable evidence archive for calculation {calc_uuid}\n"
        f"Classification: {classification}\n\n"
        "PROVENANCE_ARCHIVE: documents what was run and where it came from; something a re-run needs is "
        "missing, unverifiable or withheld (see MANIFEST.json 'missing').\n"
        "REPRODUCIBILITY_PACKAGE: the exported specification, structure, verified engine input, engine "
        "identity, recorded environment and result are complete, so the calculation can be ATTEMPTED again "
        "with the same engine build. Exact reproduction is not claimed or tested.\n"
        "EXECUTABLE WORKFLOW: not provided.\n\n"
        "This archive was built from an allowlist. It does NOT contain raw engine outputs, logs, original "
        "uploads, names, labels or free-text comments; those are withheld by policy. Do not treat it as a "
        "complete record of the original run.\n"
        "Verify the files with: shasum -a 256 -c SHA256SUMS\n"
        "Scientific standing in results/result.json was evaluated when this archive was generated.\n"
    )
    out.archive.add("README.txt", readme.encode("ascii"), "reading guide")
    members = out.archive.members
    manifest = {
        "schema": BUNDLE_SCHEMA,
        "generated_at": datetime.now(UTC).isoformat(),
        "project_id": policy.safe_uuid(project.id),
        "calculation_id": calc_uuid,
        "calculation_state": state,
        "classification": classification,
        "exact_reproducibility_claimed": False,
        "executable_workflow": EXECUTABLE_WORKFLOW,
        "required_evidence": {c: out.status.get(c, "NOT_RECORDED") for c in REQUIRED},
        "missing": out.missing(),
        "reason_code_meanings": {r: REASONS[r] for r in sorted({m["reason_code"] for m in out.missing()})},
        "engine": out.facts.get("engine_identity"),
        "omitted_content": out.omissions.as_list(),
        "withheld_artifacts": out.withheld,
        "withheld_artifacts_not_listed": out.withheld_extra,
        "limitations": list(LIMITATIONS),
        "limits": {
            "max_members": MAX_MEMBERS, "max_member_bytes": MAX_MEMBER_BYTES,
            "max_total_bytes": MAX_TOTAL_BYTES, "max_zip_bytes": MAX_ZIP_BYTES,
        },
        "scientific_standing_at_generation": {
            "evidence_use": "NO_RESULT" if context["record"] is None else _evidence_use(effective),
            "source_lineage_validity": effective.source_lineage_validity if effective else None,
        },
        "files": [
            {"path": n, "role": role, "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            for n, (data, role) in sorted(members.items())
        ],
    }
    out.archive.add_json("MANIFEST.json", manifest, "manifest")
    sums = "".join(
        f"{hashlib.sha256(data).hexdigest()}  {name}\n" for name, (data, _r) in sorted(members.items())
    )
    out.archive.add("SHA256SUMS", sums.encode("ascii"), "checksums")

    # Final output boundary: every byte and every name is scanned; a hit BLOCKS the export.
    for name, (data, _role) in members.items():
        if _SECRET_TEXT.search(data) or _SECRET_TEXT.search(name.encode("ascii", "replace")):
            raise ExportBlocked("The archive was blocked by the final content check.")

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(members):
            info = zipfile.ZipInfo(name, date_time=_ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, members[name][0])
    content = buffer.getvalue()
    if len(content) > MAX_ZIP_BYTES:
        raise ExportLimitExceeded("Archive size limit exceeded.")
    label = "reproducibility-package" if classification == "REPRODUCIBILITY_PACKAGE" else "provenance-archive"
    return ExportPayload(
        filename=f"calc-{str(calc_uuid)[:8]}-{label}.zip",
        media_type="application/zip",
        content=content,
        effective=effective if (context["record"] is not None and effective is not None) else (False if context["record"] is None else None),
    )
