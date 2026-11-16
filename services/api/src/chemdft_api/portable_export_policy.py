# ruff: noqa: E501  (reviewed vocabularies and policy text)
"""Default-deny content policy for portable (leaves-the-platform) exports.

TRUST BOUNDARY
  Everything read from the database or object store is UNTRUSTED for portable export: stored JSON
  (payloads, specifications, producer/engine records, environment records, provenance parameters),
  artifact bytes, artifact format identifiers, structure/project/user names and any text a user or
  an engine could influence. Nothing is exported because a scanner returned "clean".

  Only values that pass an explicit, reviewed rule below reach an archive:
    * numbers (finite, bounded), booleans and None;
    * UUIDs and SHA-256 digests, re-emitted in canonical form after parsing;
    * strings that are members of a closed reviewed vocabulary (registries, enum members, literal
      constants of the contract models, unit codes, element symbols) or that match a key-scoped
      strict pattern (versions, timestamps built from datetime objects);
    * dictionary keys that are fields of the reviewed contract models (or of an explicit per-document
      allowlist). Unknown keys are dropped and only COUNTED, never named.
  Everything else is dropped and recorded only as (category, trusted-path) counts. Paths are built
  exclusively from approved keys, so omission records cannot carry stored data.

  Pattern scanning for credentials remains as a last-line tripwire in `reproducibility_bundle`
  (it can only BLOCK an export), never as the decision that something is safe.

KNOWN RESIDUAL: a string that is itself a member of a closed vocabulary or matches a strict version
pattern is exported by design; those sets are small, code-defined and reviewed here.
"""

from __future__ import annotations

import enum
import math
import re
import typing
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

from .scientific.engines.registry import CAPABILITIES

# ---------------------------------------------------------------------------------------------
# Limits (enforced while projecting, before any serialization)
# ---------------------------------------------------------------------------------------------
MAX_DEPTH = 12
MAX_LIST = 20_000
MAX_NODES = 400_000
MAX_INT = 2**53

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
#: 1.2, 2.14.0, 3.0.2+pf8c-ewinfix-a1 — digits and dots, optional short local suffix.
VERSION_RE = re.compile(r"^\d{1,4}(\.\d{1,4}){1,3}(\+[a-z0-9]{1,8}(-[a-z0-9]{1,8}){0,3})?$")
PLATFORM_RE = re.compile(r"^[A-Za-z]{3,12}(-[A-Za-z0-9_.]{1,16}){2,6}$")

ELEMENTS = frozenset(
    ["H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og"]
)
#: Reviewed unit codes. A quantity whose unit is not listed is withheld whole (never unit-less).
UNIT_CODES = frozenset(
    {"Eh", "eV", "cm^-1", "km/mol", "Angstrom^4/amu", "angstrom", "bohr", "Eh/bohr", "Eh/bohr^2",
     "K", "Pa", "1", "e/a0^3", "a.u.", "a0^-3/2"}
)
SPIN_CHANNELS = frozenset({"restricted", "alpha", "beta"})
ARCHITECTURES = frozenset({"arm64", "x86_64", "aarch64", "amd64"})
ENVIRONMENT_LIBRARIES = frozenset(
    {"numpy", "scipy", "pyscf", "geometric", "rdkit", "cclib", "tblite", "dftd4", "psi4", "xtb",
     "python", "qcelemental", "qcengine"}
)
#: Engines that run as pinned native executables: their environment is sufficient only with a
#: recorded build identity. Python-hosted engines need a runtime and library versions instead.
NATIVE_ENGINES = frozenset({"psi4", "xtb", "crest", "dftd4"})
PYTHON_ENGINES = frozenset({"pyscf"})
THREAD_SETTINGS = frozenset(
    {"OMP_NUM_THREADS", "OMP_THREAD_LIMIT", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS",
     "MKL_NUM_THREADS"}
)
RESULT_TYPES = frozenset(
    {
        "chemdft.energy", "chemdft.optimization", "chemdft.vibrational-analysis",
        "chemdft.molecular-orbitals", "chemdft.tddft", "chemdft.thermochemistry",
        "chemdft.dispersion-corrected-energy", "chemdft.conformer-ensemble",
    }
)
#: Closed set of artifact kinds that may be NAMED in a withheld-artifact record; anything else is UNKNOWN.
ARTIFACT_KINDS = frozenset(
    {
        "CALCULATION_INPUT", "ENGINE_LOG", "RAW_OUTPUT", "OPTIMIZATION_TRAJECTORY", "VOLUMETRIC_GRID",
        "ENVIRONMENT_MANIFEST", "STRUCTURE", "CONFORMER_ENSEMBLE", "NATIVE_ARTIFACT",
    }
)
COORDINATE_UNITS = frozenset({"angstrom", "bohr"})
STRUCTURE_ORIGINS = frozenset(
    {"IMPORTED", "OPTIMIZED", "DRAWN", "RECONSTRUCTED", "IMPORTED_CALCULATION", "EDITED", "GENERATED"}
)
#: Fixed namespaces for system-assigned identifiers. Anything outside them is not exported.
PRODUCER_RE = re.compile(r"^(local\.[a-z0-9]{2,12}\.worker|chemdft\.[a-z0-9]{2,24}(\.[a-z0-9-]{2,24}){0,3})$")
OPERATION_RE = re.compile(r"^chemdft\.[a-z0-9]{2,24}(\.[a-z0-9-]{2,24}){0,3}$")
SUBJECT_RE = re.compile(r"^[a-z]{3,16}\.[a-z]{3,16}$")
INPUT_TYPE_RE = SUBJECT_RE

#: Paths whose value is a REQUIRED scientific identifier: a non-vocabulary string there is a
#: scientific loss (it cannot be replaced by a guess), unlike labels and other free text.
REQUIRED_IDENTIFIER_PATHS = frozenset(
    {
        "payload.method", "payload.basis", "payload.functional", "payload.payload_schema",
        "payload.task_type", "specification.task_type", "specification.method.identifier",
        "specification.basis.identifier", "specification.dispersion.identifier",
        "specification.engine_preference.engine", "normalized.task", "normalized.method",
        "normalized.basis", "normalized.engine",
    }
)

#: Caller-supplied request fields whose dropped values change what was computed.
LOSS_PATH_PREFIXES = (
    "specification.constraints", "specification.property_requests", "specification.engine_extensions",
)
SCIENTIFIC_LOSS = ("UNAPPROVED_FIELD", "UNREVIEWED_IDENTIFIER", "NON_FINITE", "OVERSIZED")


class ExportLimitError(Exception):
    """Raised (never partially applied) when an input exceeds a projection bound."""


# ---------------------------------------------------------------------------------------------
# Approved keys and closed vocabulary, derived from the reviewed contract models
# ---------------------------------------------------------------------------------------------


def _collect(annotation: Any, keys: set[str], literals: set[str], seen: set[type]) -> None:
    origin = typing.get_origin(annotation)
    if origin is Literal:
        literals.update(a for a in typing.get_args(annotation) if isinstance(a, str))
        return
    for argument in typing.get_args(annotation):
        _collect(argument, keys, literals, seen)
    if isinstance(annotation, type):
        if issubclass(annotation, BaseModel) and annotation not in seen:
            seen.add(annotation)
            for name, info in annotation.model_fields.items():
                keys.add(name)
                _collect(info.annotation, keys, literals, seen)
        elif issubclass(annotation, enum.Enum):
            literals.update(m.value for m in annotation if isinstance(m.value, str))


def derive(*models: type[BaseModel]) -> tuple[frozenset[str], frozenset[str]]:
    keys: set[str] = set()
    literals: set[str] = set()
    seen: set[type] = set()
    for model in models:
        _collect(model, keys, literals, seen)
    return frozenset(keys), frozenset(literals)


def _registries() -> frozenset[str]:
    values: set[str] = {"chemdft.method", "chemdft.basis"}
    for capability in CAPABILITIES.values():
        values.add(capability.engine)
        values.update(capability.methods)
        values.update(capability.basis_sets)
        values.update(t.value for t in capability.tasks)
    values.add("dftd4")
    return frozenset(values)


@dataclass
class Omissions:
    """Counts of what was not exported, keyed by (category, trusted path). Never holds stored data."""

    counts: Counter[tuple[str, str]] = field(default_factory=Counter)

    def add(self, category: str, path: str, n: int = 1) -> None:
        self.counts[(category, path)] += n

    def merge(self, other: Omissions, prefix: str) -> None:
        for (category, path), n in other.counts.items():
            self.counts[(category, f"{prefix}{path}")] += n

    def scientific_loss(self, *, strict_text: bool = False) -> bool:
        """Whether something a scientist needs was withheld.

        `strict_text`: for request documents (specification, engine input) every dropped string is
        treated as scientific (a solvent or reference name is a parameter); only display names are
        cosmetic. For result payloads free text (labels, comments) is not scientific.
        """
        return any(
            c in SCIENTIFIC_LOSS
            or p.startswith(LOSS_PATH_PREFIXES)
            or (strict_text and c == "FREE_TEXT" and not p.endswith(".display_name"))
            for c, p in self.counts
        )

    def as_list(self) -> list[dict[str, Any]]:
        return [
            {"category": c, "path": p, "count": n} for (c, p), n in sorted(self.counts.items())
        ]


class Projector:
    """Projects untrusted JSON-like data through an approved-key + vocabulary allowlist."""

    def __init__(self, keys: frozenset[str], vocabulary: frozenset[str]) -> None:
        self.keys = keys
        self.vocabulary = vocabulary | _registries() | UNIT_CODES | ELEMENTS | SPIN_CHANNELS

    def project(self, value: Any, path: str, omissions: Omissions) -> Any:
        # The projector instance is shared across requests (thread pool): per-call state is local.
        return self._walk(value, path, "", 0, omissions, [0])

    # -- leaves -----------------------------------------------------------------------------
    def _string(self, text: str, key: str, path: str, omissions: Omissions) -> str | None:
        if len(text) <= 120:
            if text in self.vocabulary:
                return text
            if UUID_RE.fullmatch(text) and (key == "id" or key.endswith("_id") or key.endswith("_ids")):
                return text
            if SHA256_RE.fullmatch(text) and (
                key.endswith(("sha256", "hash", "digest")) or key == "sha256"
            ):
                return text
            if (key == "version" or key.endswith("_version")) and VERSION_RE.fullmatch(text):
                return text
        required = path in REQUIRED_IDENTIFIER_PATHS or path.endswith((".unit.code", ".unit.standard"))
        omissions.add("UNREVIEWED_IDENTIFIER" if required else "FREE_TEXT", path)
        return None

    def _walk(
        self, value: Any, path: str, key: str, depth: int, omissions: Omissions, nodes: list[int]
    ) -> Any:
        nodes[0] += 1
        if nodes[0] > MAX_NODES or depth > MAX_DEPTH:
            raise ExportLimitError("projection node or depth bound exceeded")
        if value is None or isinstance(value, bool):
            return value
        if isinstance(value, int):
            if abs(value) > MAX_INT:
                omissions.add("OVERSIZED", path)
                return None
            return value
        if isinstance(value, float):
            if not math.isfinite(value):
                omissions.add("NON_FINITE", path)
                return None
            return value
        if isinstance(value, str):
            return self._string(value, key, path, omissions)
        if isinstance(value, (list, tuple)):
            if len(value) > MAX_LIST:
                omissions.add("OVERSIZED", path)
                return None
            return [self._walk(v, f"{path}[]", key, depth + 1, omissions, nodes) for v in value]
        if isinstance(value, dict):
            clean: dict[str, Any] = {}
            dropped = 0
            for k, v in value.items():
                if not isinstance(k, str) or k not in self.keys:
                    dropped += 1
                    continue
                clean[k] = self._walk(v, f"{path}.{k}", k, depth + 1, omissions, nodes)
            if dropped:
                omissions.add("UNAPPROVED_FIELD", path, dropped)
            return self._quantity_guard(clean, path, omissions)
        omissions.add("FREE_TEXT", path)  # unexpected type (bytes, set, object): never serialized
        return None

    @staticmethod
    def _quantity_guard(clean: dict[str, Any], path: str, omissions: Omissions) -> Any:
        """A numeric quantity is exported only together with a reviewed unit, never unit-less."""
        unit = clean.get("unit")
        if "value" in clean and isinstance(unit, dict) and unit.get("code") is None:
            omissions.add("UNREVIEWED_IDENTIFIER", f"{path}.unit")
            return None
        return clean


# ---------------------------------------------------------------------------------------------
# Reviewed projectors
# ---------------------------------------------------------------------------------------------


def _build() -> dict[str, Projector]:
    from .contracts.conformers import ConformerEnsembleResult
    from .contracts.dftd4 import (
        DispersionCorrectedEnergyResult,
        NativeDispersionCorrectedEnergyResult,
    )
    from .contracts.results import (
        EnergyResult,
        MolecularOrbitalAnalysis,
        OptimizationResult,
        TddftResult,
        ThermochemistryResult,
        VibrationalAnalysis,
    )
    from .contracts.scientific import CalculationSpecification, EngineReference

    payload_keys, payload_literals = derive(
        EnergyResult, OptimizationResult, VibrationalAnalysis, MolecularOrbitalAnalysis, TddftResult,
        ThermochemistryResult, DispersionCorrectedEnergyResult, NativeDispersionCorrectedEnergyResult,
        ConformerEnsembleResult,
    )
    spec_keys, spec_literals = derive(CalculationSpecification)
    engine_keys, _ = derive(EngineReference)
    # Free-form fields of the models are approved as KEYS (so numbers beside them survive) but
    # their string values still need vocabulary membership, so text never passes.
    payload = Projector(payload_keys, payload_literals | RESULT_TYPES)
    specification = Projector(spec_keys, spec_literals)
    engine = Projector(frozenset({"name", "version", "adapter_version"}), frozenset())
    normalized = Projector(
        frozenset(
            {
                "schema", "schema_version", "structure_version_id", "atom_ordering", "coordinate_unit",
                "atoms", "index", "atomic_number", "element", "xyz_angstrom", "charge", "multiplicity",
                "task", "method", "basis", "dispersion", "solvation", "scf", "optimization", "hessian",
                "tddft", "raman", "thermochemistry", "engine", "engine_version", "optimizer_version",
                "input_structure_hash", "specification_hash", "engine_identity_hash",
                "engine_executable_sha256", "parser_version", "validator_version",
                "orbital_adapter_version", "tddft_adapter_version",
                # thermochemistry input fields (thermochemistry_input_fields): ids, hashes, numbers
                "source_frequency_result_id", "frequency_result_sha256", "frequency_calculation_id",
                "optimization_result_id", "optimization_result_sha256", "optimization_calculation_id",
                "energy_artifact_id", "energy_artifact_sha256", "electronic_energy_hartree",
                "frequencies_cm1", "geometry_hash", "temperature_k", "pressure_pa", "thermo_model",
                "imaginary_mode_policy", "low_frequency_warning_cm1", "symmetry_number_override",
                "stationarity", "gradient_rms_hartree_per_bohr", "gradient_norm_hartree_per_bohr",
                "criterion_rms_hartree_per_bohr", "trajectory_step_index",
            }
            | spec_keys
        ),
        spec_literals | {"chemdft.calculation_input", "AS_LISTED", "angstrom", "ideal-gas-rrho", "reject"},
    )
    del engine_keys
    return {"payload": payload, "specification": specification, "engine": engine, "normalized": normalized}


_PROJECTORS: dict[str, Projector] | None = None


def projector(name: str) -> Projector:
    global _PROJECTORS
    if _PROJECTORS is None:
        _PROJECTORS = _build()
    return _PROJECTORS[name]


def safe_uuid(value: Any) -> str | None:
    try:
        return str(UUID(str(value))) if isinstance(value, (str, UUID)) else None
    except ValueError:
        return None


def safe_sha256(value: Any) -> str | None:
    return value if isinstance(value, str) and SHA256_RE.fullmatch(value) else None


def safe_version(value: Any) -> str | None:
    return value if isinstance(value, str) and VERSION_RE.fullmatch(value) else None


def safe_int(value: Any, low: int, high: int) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and low <= value <= high else None


def safe_number(value: Any) -> float | int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) and abs(value) < 1e300 else None


def safe_enum(value: Any, allowed: frozenset[str]) -> str | None:
    text = getattr(value, "value", value)
    return text if isinstance(text, str) and text in allowed else None


def iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None


def project_environment(raw: Any, omissions: Omissions, path: str) -> dict[str, Any] | None:
    """Reviewed allowlist for recorded execution environments (no paths, no process data)."""
    if not isinstance(raw, dict):
        omissions.add("UNAPPROVED_FIELD", path)
        return None
    out: dict[str, Any] = {}
    python = safe_version(raw.get("python"))
    if python:
        out["python"] = python
    platform = raw.get("platform")
    if isinstance(platform, str) and len(platform) <= 64 and PLATFORM_RE.fullmatch(platform):
        out["platform"] = platform
    architecture = safe_enum(raw.get("architecture"), ARCHITECTURES)
    if architecture:
        out["architecture"] = architecture
    libraries = raw.get("libraries")
    if isinstance(libraries, dict):
        kept = {
            k: v for k, v in libraries.items()
            if isinstance(k, str) and k in ENVIRONMENT_LIBRARIES and safe_version(v)
        }
        if kept:
            out["libraries"] = dict(sorted(kept.items()))
    threads = raw.get("thread_settings")
    if isinstance(threads, dict):
        kept_t = {
            k: str(v) for k, v in threads.items()
            if isinstance(k, str) and k in THREAD_SETTINGS and isinstance(v, str) and re.fullmatch(r"\d{1,3}", v)
        }
        if kept_t:
            out["thread_settings"] = dict(sorted(kept_t.items()))
    build = _native_build(raw)
    if build:
        out["native_build"] = build
    known = {"python", "platform", "architecture", "libraries", "thread_settings", "build", "files",
             "executable_sha256", "package_sha256"}
    unreviewed = sum(1 for k in raw if k not in known)
    if unreviewed:
        omissions.add("UNAPPROVED_FIELD", path, unreviewed)
    inner = len(libraries or {}) - len(out.get("libraries", {})) if isinstance(libraries, dict) else 0
    if inner:
        omissions.add("UNAPPROVED_FIELD", f"{path}.libraries", inner)
    return out or None


def _native_build(raw: dict[str, Any]) -> dict[str, str]:
    """Recorded build identity of a native engine: SHA-256 digests only (never paths or text).

    Sources, as written by the workers: top-level `executable_sha256` / `package_sha256` (Psi4, CREST),
    `build.executable_sha256` / `build.package_archive_sha256` (xTB) and `files["bin/<engine>"]` (D4).
    """
    found: dict[str, str] = {}
    build = raw.get("build") if isinstance(raw.get("build"), dict) else {}
    files = raw.get("files") if isinstance(raw.get("files"), dict) else {}
    executable = raw.get("executable_sha256") or build.get("executable_sha256")
    for key in ("bin/dftd4", "bin/psi4", "bin/xtb", "bin/crest"):
        item = files.get(key)
        executable = executable or (item if isinstance(item, str) else None)
    package = raw.get("package_sha256") or build.get("package_archive_sha256")
    if safe_sha256(executable):
        found["executable_sha256"] = executable
    if safe_sha256(package):
        found["package_sha256"] = package
    return found


def environment_sufficiency(projected: dict[str, Any] | None, engine: str | None) -> str | None:
    """None if the projected environment documents the software that ran; else a closed reason code.

    Architecture, platform and thread settings are hardware/OS facts and never suffice. Native engines
    need a recorded build identity (executable or package digest). Python-hosted engines need the
    Python runtime version and at least one library version. An unknown engine needs either.
    """
    env = projected or {}
    build = bool((env.get("native_build") or {}).get("executable_sha256")
                 or (env.get("native_build") or {}).get("package_sha256"))
    libraries = env.get("libraries") or {}
    runtime = bool(env.get("python") or libraries.get("python"))
    python_stack = runtime and any(k != "python" for k in libraries)
    if engine in NATIVE_ENGINES:
        return None if build else "NO_BUILD_IDENTITY"
    if engine in PYTHON_ENGINES:
        return None if python_stack else "NO_SOFTWARE_VERSIONS"
    return None if (build or python_stack) else "NO_SOFTWARE_VERSIONS"
