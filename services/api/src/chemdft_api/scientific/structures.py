from __future__ import annotations

import hashlib
import json
import math
import unicodedata
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from rdkit import Chem

from chemdft_api.contracts.scientific import (
    CoordinateSystem,
    DiagnosticSeverity,
    StructureDiagnostic,
    StructureDiagnosticCode,
    StructureKind,
)
from chemdft_api.errors import InvalidMolecularName, ScientificValidationFailed

CANONICAL_STRUCTURE_MEDIA_TYPE = "application/vnd.chemdft.structure+json"
CANONICAL_STRUCTURE_FORMAT = "chemdft.structure.canonical"
CANONICAL_STRUCTURE_SCHEMA_VERSION = "1.0.0"


class StructureSourceFormat(StrEnum):
    SDF = "SDF"
    XYZ = "XYZ"
    CIF = "CIF"
    MOL = "MOL"
    EXTERNAL_CALCULATION_OUTPUT = "EXTERNAL_CALCULATION_OUTPUT"


@dataclass(frozen=True, slots=True)
class CanonicalStructureCandidate:
    name: str
    kind: StructureKind
    coordinates: dict[str, Any]
    overall_charge: int
    multiplicity: int
    source_format: StructureSourceFormat
    parser_name: str
    parser_version: str
    adapter_name: str
    adapter_version: str
    periodic_cell: dict[str, Any] | None = None
    diagnostics: tuple[StructureDiagnostic, ...] = ()
    electronic_state_declared: bool = False
    source_reference: dict[str, Any] | None = None

    @property
    def atoms(self) -> tuple[dict[str, Any], ...]:
        return tuple(self.coordinates["atoms"])

    @property
    def bonds(self) -> tuple[dict[str, Any], ...]:
        return tuple(self.coordinates.get("bonds", ()))


_PERIODIC_TABLE = Chem.GetPeriodicTable()


def atomic_number_for_symbol(symbol: str) -> int:
    try:
        number = int(_PERIODIC_TABLE.GetAtomicNumber(symbol))
    except RuntimeError as error:
        raise ScientificValidationFailed(f"Unknown element symbol: {symbol}") from error
    if number < 1 or number > 118:
        raise ScientificValidationFailed(f"Unknown element symbol: {symbol}")
    canonical = _PERIODIC_TABLE.GetElementSymbol(number)
    if canonical != symbol:
        raise ScientificValidationFailed(f"Element symbol must be canonical: {symbol}")
    return number


def validate_structure_name(name: str) -> None:
    if any(unicodedata.category(char) in {"Cc", "Zl", "Zp"} for char in name):
        raise InvalidMolecularName()


def validate_canonical_candidate(candidate: CanonicalStructureCandidate) -> None:
    validate_structure_name(candidate.name)
    atoms = candidate.atoms
    if not atoms:
        raise ScientificValidationFailed("Structure requires at least one atom or site.")
    if len(atoms) > 10_000:
        raise ScientificValidationFailed("Structure exceeds the Phase 3 atom/site limit.")
    if len(candidate.bonds) > 40_000:
        raise ScientificValidationFailed("Structure exceeds the Phase 3 bond limit.")

    for expected_index, atom in enumerate(atoms):
        if atom.get("index") != expected_index:
            raise ScientificValidationFailed("Atom indices must match serialized ordering.")
        element = atom.get("element")
        atomic_number = atom.get("atomic_number")
        if atomic_number_for_symbol(element) != atomic_number:
            raise ScientificValidationFailed("Atom element and atomic number disagree.")
        for axis in ("x", "y", "z"):
            value = atom.get(axis)
            if not isinstance(value, int | float) or not math.isfinite(float(value)):
                raise ScientificValidationFailed("Coordinates must be finite numeric values.")
        occupancy = atom.get("occupancy")
        if occupancy is not None and not (0 < float(occupancy) <= 1):
            raise ScientificValidationFailed("Occupancy must be > 0 and <= 1.")

    seen_bonds: set[tuple[int, int]] = set()
    atom_count = len(atoms)
    for bond in candidate.bonds:
        a = int(bond["atom_index_a"])
        b = int(bond["atom_index_b"])
        if a == b or a < 0 or b < 0 or a >= atom_count or b >= atom_count:
            raise ScientificValidationFailed("Bond references invalid atom indices.")
        key = tuple(sorted((a, b)))
        if key in seen_bonds:
            raise ScientificValidationFailed("Duplicate bonds are not permitted.")
        seen_bonds.add(key)
        order = bond.get("order")
        if order is not None and (not math.isfinite(float(order)) or not (0 < float(order) <= 4)):
            raise ScientificValidationFailed("Bond order is unsupported.")

    if candidate.kind is StructureKind.PERIODIC:
        if candidate.periodic_cell is None:
            raise ScientificValidationFailed("Periodic structures require a periodic cell.")
        if candidate.coordinates["coordinate_system"] != CoordinateSystem.FRACTIONAL:
            raise ScientificValidationFailed("Periodic coordinates must be fractional.")
    elif candidate.periodic_cell is not None:
        raise ScientificValidationFailed("Non-periodic structures cannot include a periodic cell.")

    if candidate.multiplicity < 1:
        raise ScientificValidationFailed("Multiplicity must be at least 1.")


def canonical_document(candidate: CanonicalStructureCandidate) -> dict[str, Any]:
    validate_canonical_candidate(candidate)
    document = {
        "schema_version": CANONICAL_STRUCTURE_SCHEMA_VERSION,
        "kind": candidate.kind,
        "name": candidate.name,
        "coordinates": candidate.coordinates,
        "periodic_cell": candidate.periodic_cell,
        "overall_charge": candidate.overall_charge,
        "multiplicity": candidate.multiplicity,
        "diagnostics": [diagnostic.model_dump(mode="json") for diagnostic in candidate.diagnostics],
        "source": {
            "format": candidate.source_format,
            "parser": candidate.parser_name,
            "parser_version": candidate.parser_version,
            "adapter": candidate.adapter_name,
            "adapter_version": candidate.adapter_version,
        },
    }
    return document


def canonical_bytes(document: dict[str, Any]) -> bytes:
    return (
        json.dumps(document, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"
    ).encode("utf-8")


def canonical_sha256(document: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_bytes(document)).hexdigest()


def diagnostic(
    severity: DiagnosticSeverity,
    code: StructureDiagnosticCode,
    message: str,
    atom_index: int | None = None,
) -> StructureDiagnostic:
    return StructureDiagnostic(
        severity=severity,
        code=code,
        message=message,
        atom_index=atom_index,
    )
