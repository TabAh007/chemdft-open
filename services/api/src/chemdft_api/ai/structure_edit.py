"""Structure edit validation, deterministic diff, and proposal logic (Release 0.0.60, Part 1).

Pure Python validation and diff algorithms for AI-proposed structure edits.
Supports add_atom, remove_atom, move_atom, replace_element.
Validates element symbols, finite coordinates, 0-based indices, atom count limits,
fractional periodic wrap, and minimum interatomic distances with minimum image convention.
Never silently fixes distances; warns visibly.
Leaves parent versions immutable.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..actions import authorize_project_access
from ..context import Identity
from ..contracts.provenance import (
    ProducerKind,
    ProvenanceClass,
    ProvenanceDetail,
    VerificationState,
)
from ..contracts.scientific import (
    StructureKind,
    StructureVersionOrigin,
)
from ..contracts.structure_tools import (
    AddedAtomDiff,
    MovedAtomDiff,
    RemovedAtomDiff,
    ReplacedElementDiff,
    StructureEditDiffView,
    StructureEditOperation,
    StructureEditProposeInput,
    StructureEditProposeOutput,
)
from ..errors import (
    ProjectAccessDenied,
    ScientificReferenceNotFound,
)
from ..models import new_id
from ..project_access import ProjectCapability, can
from ..scientific.structures import (
    CanonicalStructureCandidate,
    StructureSourceFormat,
    atomic_number_for_symbol,
    canonical_document,
)
from ..scientific_actions import (
    MAX_STRUCTURE_PARSE_BYTES,
    _artifact_reference,
    _audit_structure_event,
    _persist_canonical_artifact,
)
from ..scientific_models import (
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureRecord,
    StructureVersionRecord,
)
from ..storage import ObjectStore

# Standard covalent radii in Angstroms (Cordero et al. 2008 / Alvarez 2008)
COVALENT_RADII: dict[str, float] = {
    "H": 0.31, "He": 0.28, "Li": 1.28, "Be": 0.96, "B": 0.84, "C": 0.76,
    "N": 0.71, "O": 0.66, "F": 0.57, "Ne": 0.58, "Na": 1.66, "Mg": 1.41,
    "Al": 1.21, "Si": 1.11, "P": 1.07, "S": 1.05, "Cl": 1.02, "Ar": 1.06,
    "K": 2.03, "Ca": 1.76, "Sc": 1.70, "Ti": 1.60, "V": 1.53, "Cr": 1.39,
    "Mn": 1.39, "Fe": 1.32, "Co": 1.26, "Ni": 1.24, "Cu": 1.32, "Zn": 1.22,
    "Ga": 1.22, "Ge": 1.20, "As": 1.19, "Se": 1.20, "Br": 1.20, "Kr": 1.16,
    "Rb": 2.20, "Sr": 1.95, "Y": 1.90, "Zr": 1.75, "Nb": 1.64, "Mo": 1.54,
    "Tc": 1.47, "Ru": 1.46, "Rh": 1.42, "Pd": 1.39, "Ag": 1.45, "Cd": 1.44,
    "In": 1.42, "Sn": 1.39, "Sb": 1.39, "Te": 1.38, "I": 1.39, "Xe": 1.40,
    "Cs": 2.44, "Ba": 2.15, "La": 2.07, "Ce": 2.04, "Pr": 2.03, "Nd": 2.01,
    "Pm": 1.99, "Sm": 1.98, "Eu": 1.98, "Gd": 1.96, "Tb": 1.94, "Dy": 1.92,
    "Ho": 1.92, "Er": 1.89, "Tm": 1.90, "Yb": 1.87, "Lu": 1.87, "Hf": 1.75,
    "Ta": 1.70, "W": 1.62, "Re": 1.51, "Os": 1.44, "Ir": 1.41, "Pt": 1.36,
    "Au": 1.36, "Hg": 1.32, "Tl": 1.45, "Pb": 1.46, "Bi": 1.48, "Po": 1.40,
    "At": 1.50, "Rn": 1.50, "Fr": 2.60, "Ra": 2.21, "Ac": 2.15, "Th": 2.06,
    "Pa": 2.00, "U": 1.96, "Np": 1.90, "Pu": 1.87, "Am": 1.80, "Cm": 1.69,
}

VALID_ELEMENTS: set[str] = set(COVALENT_RADII.keys()) | {
    "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs",
    "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og"
}

# Threshold fraction of covalent radius sum (r_a + r_b) * 0.65 used in repo
COVALENT_DISTANCE_THRESHOLD_FRACTION = 0.65
ABSOLUTE_MIN_DISTANCE_ANGSTROM = 0.35
MAX_STRUCTURE_ATOM_CAP = 500


class StructureEditValidationError(ValueError):
    """Raised when an edit proposal fails validation."""


@dataclass(frozen=True)
class AddAtomOp:
    element: str
    coordinates: tuple[float, float, float]
    op_type: str = "add_atom"


@dataclass(frozen=True)
class RemoveAtomOp:
    index: int
    op_type: str = "remove_atom"


@dataclass(frozen=True)
class MoveAtomOp:
    index: int
    coordinates: tuple[float, float, float]
    op_type: str = "move_atom"


@dataclass(frozen=True)
class ReplaceElementOp:
    index: int
    element: str
    op_type: str = "replace_element"


StructureEditOp = AddAtomOp | RemoveAtomOp | MoveAtomOp | ReplaceElementOp


@dataclass
class StructureEditDiff:
    parent_version_id: str
    formula_before: str
    formula_after: str
    atom_count_before: int
    atom_count_after: int
    atoms_added: list[dict[str, Any]] = field(default_factory=list)
    atoms_removed: list[dict[str, Any]] = field(default_factory=list)
    atoms_moved: list[dict[str, Any]] = field(default_factory=list)
    elements_replaced: list[dict[str, Any]] = field(default_factory=list)
    min_distance_before: float | None = None
    min_distance_after: float | None = None
    distance_warnings: list[str] = field(default_factory=list)


def _compute_hill_formula(atoms: list[dict[str, Any]]) -> str:
    """Deterministic Hill formula calculation."""
    counts: dict[str, int] = {}
    for atom in atoms:
        el = atom.get("element", "")
        if el:
            counts[el] = counts.get(el, 0) + 1
    order = (["C"] if "C" in counts else []) + (["H"] if "H" in counts else []) + sorted(
        k for k in counts if k not in {"C", "H"}
    )
    return "".join(f"{k}{counts[k] if counts[k] > 1 else ''}" for k in order) or "Empty"


def _lattice_matrix_from_cell(cell: dict[str, Any]) -> list[list[float]] | None:
    """Build lattice row-matrix M from periodic cell parameters or vectors."""
    vectors = cell.get("vectors") or cell.get("lattice_vectors")
    if isinstance(vectors, (list, tuple)) and len(vectors) == 3:
        try:
            return [[float(x) for x in row] for row in vectors]
        except (ValueError, TypeError):
            pass

    a = cell.get("a")
    b = cell.get("b")
    c = cell.get("c")
    alpha = cell.get("alpha", 90.0)
    beta = cell.get("beta", 90.0)
    gamma = cell.get("gamma", 90.0)
    if any(p is None for p in (a, b, c)):
        return None

    try:
        a_f, b_f, c_f = float(a), float(b), float(c)
        al_r = math.radians(float(alpha))
        be_r = math.radians(float(beta))
        ga_r = math.radians(float(gamma))
    except (ValueError, TypeError):
        return None

    cos_ga = math.cos(ga_r)
    sin_ga = math.sin(ga_r)
    cos_be = math.cos(be_r)
    cos_al = math.cos(al_r)

    ax = a_f
    ay = 0.0
    az = 0.0

    bx = b_f * cos_ga
    by = b_f * sin_ga
    bz = 0.0

    cx = c_f * cos_be
    cy = c_f * (cos_al - cos_be * cos_ga) / sin_ga if sin_ga > 1e-8 else 0.0
    cz_sq = c_f * c_f - cx * cx - cy * cy
    cz = math.sqrt(max(0.0, cz_sq))

    return [
        [ax, ay, az],
        [bx, by, bz],
        [cx, cy, cz],
    ]


def compute_minimum_distances_and_warnings(
    atoms: list[dict[str, Any]],
    periodic_cell: dict[str, Any] | None,
    coordinate_system: str,
) -> tuple[float | None, list[str]]:
    """Compute minimum interatomic distance and generate covalent-radius threshold warnings."""
    if len(atoms) < 2:
        return None, []

    is_periodic = periodic_cell is not None
    lattice_mat = _lattice_matrix_from_cell(periodic_cell) if is_periodic else None
    coord_sys_str = (coordinate_system or "CARTESIAN").upper()

    parsed_atoms: list[tuple[str, tuple[float, float, float]]] = []
    for atom in atoms:
        el = atom.get("element", "X")
        coords = atom.get("coordinates") or (
            atom.get("x", 0.0),
            atom.get("y", 0.0),
            atom.get("z", 0.0),
        )
        parsed_atoms.append((el, (float(coords[0]), float(coords[1]), float(coords[2]))))

    min_overall_dist = float("inf")
    warnings: list[str] = []

    n = len(parsed_atoms)
    # Check pairwise distances
    for i in range(n):
        el_i, pos_i = parsed_atoms[i]
        r_i = COVALENT_RADII.get(el_i, 1.20)
        for j in range(i + 1, n):
            el_j, pos_j = parsed_atoms[j]
            r_j = COVALENT_RADII.get(el_j, 1.20)
            threshold = (r_i + r_j) * COVALENT_DISTANCE_THRESHOLD_FRACTION

            if is_periodic and lattice_mat and coord_sys_str == "FRACTIONAL":
                # Periodic fractional minimum image
                df = (
                    pos_j[0] - pos_i[0] - round(pos_j[0] - pos_i[0]),
                    pos_j[1] - pos_i[1] - round(pos_j[1] - pos_i[1]),
                    pos_j[2] - pos_i[2] - round(pos_j[2] - pos_i[2]),
                )
                pair_min = float("inf")
                for sx in (-1, 0, 1):
                    for sy in (-1, 0, 1):
                        for sz in (-1, 0, 1):
                            vx = (
                                (df[0] + sx) * lattice_mat[0][0]
                                + (df[1] + sy) * lattice_mat[1][0]
                                + (df[2] + sz) * lattice_mat[2][0]
                            )
                            vy = (
                                (df[0] + sx) * lattice_mat[0][1]
                                + (df[1] + sy) * lattice_mat[1][1]
                                + (df[2] + sz) * lattice_mat[2][1]
                            )
                            vz = (
                                (df[0] + sx) * lattice_mat[0][2]
                                + (df[1] + sy) * lattice_mat[1][2]
                                + (df[2] + sz) * lattice_mat[2][2]
                            )
                            d = math.sqrt(vx * vx + vy * vy + vz * vz)
                            if d < pair_min:
                                pair_min = d
            else:
                # Cartesian distance
                dx = pos_j[0] - pos_i[0]
                dy = pos_j[1] - pos_i[1]
                dz = pos_j[2] - pos_i[2]
                pair_min = math.sqrt(dx * dx + dy * dy + dz * dz)

            if pair_min < min_overall_dist:
                min_overall_dist = pair_min

            if pair_min < threshold or pair_min < ABSOLUTE_MIN_DISTANCE_ANGSTROM:
                warnings.append(
                    f"Warning: minimum distance between atom {i} ({el_i}) and atom {j} ({el_j}) "
                    f"is {pair_min:.3f} Å, which is below the threshold of {threshold:.3f} Å "
                    f"(0.65 * covalent radii sum)."
                )

    final_min = min_overall_dist if min_overall_dist < float("inf") else None
    return final_min, warnings


def apply_structure_edits(
    *,
    parent_version_id: str,
    atoms: list[dict[str, Any]],
    periodic_cell: dict[str, Any] | None,
    coordinate_system: str,
    operations: list[StructureEditOp],
) -> tuple[list[dict[str, Any]], StructureEditDiff]:
    """Validate and apply a sequence of structure edits to atoms, returning new atoms and diff.

    Leaves input atoms unchanged.
    """
    if not operations:
        raise StructureEditValidationError("No operations provided in structure edit proposal.")

    current_atoms: list[dict[str, Any]] = [dict(a) for a in atoms]
    formula_before = _compute_hill_formula(current_atoms)
    atom_count_before = len(current_atoms)
    min_dist_before, _ = compute_minimum_distances_and_warnings(
        current_atoms, periodic_cell, coordinate_system
    )

    is_fractional = (coordinate_system or "CARTESIAN").upper() == "FRACTIONAL"
    is_periodic = periodic_cell is not None

    diff = StructureEditDiff(
        parent_version_id=parent_version_id,
        formula_before=formula_before,
        formula_after="",
        atom_count_before=atom_count_before,
        atom_count_after=0,
        min_distance_before=min_dist_before,
    )

    for op in operations:
        if isinstance(op, AddAtomOp):
            if op.element not in VALID_ELEMENTS:
                raise StructureEditValidationError(f"Invalid element symbol '{op.element}'.")
            if not all(math.isfinite(c) for c in op.coordinates):
                raise StructureEditValidationError("Atom coordinates must be finite real numbers.")
            if len(current_atoms) >= MAX_STRUCTURE_ATOM_CAP:
                raise StructureEditValidationError(
                    f"Atom count cannot exceed maximum cap of {MAX_STRUCTURE_ATOM_CAP} atoms."
                )

            # Wrap fractional coordinates if periodic
            final_coords = list(op.coordinates)
            if is_periodic and is_fractional:
                final_coords = [c % 1.0 for c in final_coords]

            new_atom = {
                "element": op.element,
                "coordinates": tuple(final_coords),
            }
            current_atoms.append(new_atom)
            diff.atoms_added.append({
                "index": len(current_atoms) - 1,
                "element": op.element,
                "coordinates": tuple(final_coords),
            })

        elif isinstance(op, RemoveAtomOp):
            if not (0 <= op.index < len(current_atoms)):
                raise StructureEditValidationError(
                    f"Atom index {op.index} out of range [0, {len(current_atoms)})."
                )
            if len(current_atoms) <= 1:
                raise StructureEditValidationError(
                    "Cannot remove atom: structure must retain at least one atom."
                )
            removed = current_atoms.pop(op.index)
            diff.atoms_removed.append({
                "index": op.index,
                "element": removed.get("element", "X"),
                "coordinates": removed.get("coordinates"),
            })

        elif isinstance(op, MoveAtomOp):
            if not (0 <= op.index < len(current_atoms)):
                raise StructureEditValidationError(
                    f"Atom index {op.index} out of range [0, {len(current_atoms)})."
                )
            if not all(math.isfinite(c) for c in op.coordinates):
                raise StructureEditValidationError("Atom coordinates must be finite real numbers.")

            final_coords = list(op.coordinates)
            if is_periodic and is_fractional:
                final_coords = [c % 1.0 for c in final_coords]

            old_atom = current_atoms[op.index]
            old_coords = old_atom.get("coordinates")
            current_atoms[op.index] = {
                **old_atom,
                "coordinates": tuple(final_coords),
            }
            diff.atoms_moved.append({
                "index": op.index,
                "element": old_atom.get("element", "X"),
                "old_coordinates": old_coords,
                "new_coordinates": tuple(final_coords),
            })

        elif isinstance(op, ReplaceElementOp):
            if not (0 <= op.index < len(current_atoms)):
                raise StructureEditValidationError(
                    f"Atom index {op.index} out of range [0, {len(current_atoms)})."
                )
            if op.element not in VALID_ELEMENTS:
                raise StructureEditValidationError(f"Invalid element symbol '{op.element}'.")

            old_atom = current_atoms[op.index]
            old_el = old_atom.get("element", "X")
            current_atoms[op.index] = {
                **old_atom,
                "element": op.element,
            }
            diff.elements_replaced.append({
                "index": op.index,
                "old_element": old_el,
                "new_element": op.element,
            })
        else:
            raise StructureEditValidationError(f"Unknown operation type: {type(op)}")

    diff.formula_after = _compute_hill_formula(current_atoms)
    diff.atom_count_after = len(current_atoms)
    min_dist_after, warnings = compute_minimum_distances_and_warnings(
        current_atoms, periodic_cell, coordinate_system
    )
    diff.min_distance_after = min_dist_after
    diff.distance_warnings = warnings

    return current_atoms, diff


def parse_operations_from_dict(
    operations: tuple[StructureEditOperation, ...] | list[dict[str, Any]] | list[Any],
) -> list[StructureEditOp]:
    """Parse StructureEditOperation models or dicts into typed StructureEditOp dataclasses."""
    parsed: list[StructureEditOp] = []
    for op in operations:
        if isinstance(op, (AddAtomOp, RemoveAtomOp, MoveAtomOp, ReplaceElementOp)):
            parsed.append(op)
            continue

        if isinstance(op, StructureEditOperation):
            op_dict = op.model_dump(mode="python")
        elif isinstance(op, dict):
            op_dict = op
        else:
            raise StructureEditValidationError(f"Invalid operation type: {type(op)}")

        op_type = op_dict.get("op_type")
        if op_type == "add_atom":
            el = op_dict.get("element")
            if not el or not isinstance(el, str):
                raise StructureEditValidationError(
                    "add_atom operation requires element symbol string."
                )
            coords = op_dict.get("coordinates")
            if not coords or not isinstance(coords, (list, tuple)) or len(coords) != 3:
                raise StructureEditValidationError(
                    "add_atom operation requires 3D coordinates (x, y, z)."
                )
            parsed.append(
                AddAtomOp(
                    element=el,
                    coordinates=(float(coords[0]), float(coords[1]), float(coords[2])),
                )
            )
        elif op_type == "remove_atom":
            idx = op_dict.get("index")
            if idx is None or not isinstance(idx, int):
                raise StructureEditValidationError(
                    "remove_atom operation requires integer atom index."
                )
            parsed.append(RemoveAtomOp(index=idx))
        elif op_type == "move_atom":
            idx = op_dict.get("index")
            if idx is None or not isinstance(idx, int):
                raise StructureEditValidationError(
                    "move_atom operation requires integer atom index."
                )
            coords = op_dict.get("coordinates")
            if not coords or not isinstance(coords, (list, tuple)) or len(coords) != 3:
                raise StructureEditValidationError(
                    "move_atom operation requires 3D coordinates (x, y, z)."
                )
            parsed.append(
                MoveAtomOp(
                    index=idx,
                    coordinates=(float(coords[0]), float(coords[1]), float(coords[2])),
                )
            )
        elif op_type == "replace_element":
            idx = op_dict.get("index")
            if idx is None or not isinstance(idx, int):
                raise StructureEditValidationError(
                    "replace_element operation requires integer atom index."
                )
            el = op_dict.get("element")
            if not el or not isinstance(el, str):
                raise StructureEditValidationError(
                    "replace_element operation requires element symbol string."
                )
            parsed.append(ReplaceElementOp(index=idx, element=el))
        else:
            raise StructureEditValidationError(f"Unknown operation op_type: '{op_type}'.")
    return parsed


def build_diff_view_from_dataclass(diff: StructureEditDiff) -> StructureEditDiffView:
    """Convert StructureEditDiff dataclass to StructureEditDiffView contract model."""
    atoms_added = tuple(
        AddedAtomDiff(
            index=a["index"],
            element=a["element"],
            coordinates=tuple(a["coordinates"]),
        )
        for a in diff.atoms_added
    )
    atoms_removed = tuple(
        RemovedAtomDiff(
            index=r["index"],
            element=r["element"],
            coordinates=tuple(r["coordinates"]) if r.get("coordinates") else None,
        )
        for r in diff.atoms_removed
    )
    atoms_moved = tuple(
        MovedAtomDiff(
            index=m["index"],
            element=m["element"],
            old_coordinates=tuple(m["old_coordinates"]) if m.get("old_coordinates") else None,
            new_coordinates=tuple(m["new_coordinates"]),
        )
        for m in diff.atoms_moved
    )
    elements_replaced = tuple(
        ReplacedElementDiff(
            index=e["index"],
            old_element=e["old_element"],
            new_element=e["new_element"],
        )
        for e in diff.elements_replaced
    )
    return StructureEditDiffView(
        parent_version_id=UUID(diff.parent_version_id),
        formula_before=diff.formula_before,
        formula_after=diff.formula_after,
        atom_count_before=diff.atom_count_before,
        atom_count_after=diff.atom_count_after,
        atoms_added=atoms_added,
        atoms_removed=atoms_removed,
        atoms_moved=atoms_moved,
        elements_replaced=elements_replaced,
        min_distance_before=diff.min_distance_before,
        min_distance_after=diff.min_distance_after,
        distance_warnings=tuple(diff.distance_warnings),
    )


def apply_structure_edit_version(
    session: Session,
    object_store: ObjectStore,
    identity: Identity,
    payload: StructureEditProposeInput,
    approval_references: frozenset[UUID] | None = None,
) -> StructureEditProposeOutput:
    """Validate structure edits, compute diff, and create exactly ONE new version if approved.

    - Leaves parent version completely immutable.
    - If approval_references is empty/None: returns dry-run proposal view with diff
      (status="PROPOSED").
    - If approval_references is provided (approved by researcher): creates new
      StructureVersionRecord with origin=StructureVersionOrigin.AI_PROPOSED, authority
      unverified, links approval record in provenance, and returns status="APPLIED".
    - Reject creates nothing (handled outside this tool by approval state machine).
    """
    parent = session.get(StructureVersionRecord, str(payload.structure_version_id))
    if parent is None:
        raise ScientificReferenceNotFound("Structure version does not exist.")

    structure = session.get(StructureRecord, parent.structure_id)
    if structure is None:
        raise ScientificReferenceNotFound("Structure does not exist.")

    project, member = authorize_project_access(session, identity, parent.project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()

    # Extract atoms from parent representation
    coords_dict = (parent.representation_json or {}).get("coordinates") or {}
    raw_atoms = coords_dict.get("atoms") or []
    parent_atoms: list[dict[str, Any]] = []
    for a in raw_atoms:
        if isinstance(a, dict):
            coords = a.get("coordinates") or (a.get("x", 0.0), a.get("y", 0.0), a.get("z", 0.0))
            parent_atoms.append({
                "element": a.get("element", "X"),
                "coordinates": (float(coords[0]), float(coords[1]), float(coords[2])),
            })

    ops = parse_operations_from_dict(payload.operations)
    periodic_cell = parent.periodic_cell_json
    coord_system = parent.coordinate_system or "CARTESIAN"

    new_atoms, diff_dataclass = apply_structure_edits(
        parent_version_id=str(parent.id),
        atoms=parent_atoms,
        periodic_cell=periodic_cell,
        coordinate_system=coord_system,
        operations=ops,
    )
    diff_view = build_diff_view_from_dataclass(diff_dataclass)

    # Dry-run proposal if not approved yet
    if not approval_references:
        return StructureEditProposeOutput(
            schema_version="1.0.0",
            proposal_id=None,
            structure_id=UUID(structure.id),
            parent_version_id=UUID(parent.id),
            diff=diff_view,
            operations=payload.operations,
            status="PROPOSED",
            created_version_id=None,
        )

    # Approved execution: persist canonical artifact and create new structure version
    approval_id = str(next(iter(approval_references)))
    parent_canonical = session.get(ScientificArtifactRecord, parent.canonical_artifact_id)
    if parent_canonical is None:
        raise ScientificReferenceNotFound("Parent canonical artifact is missing.")

    parent_document = json.loads(
        object_store.get_bytes(parent_canonical.storage_key, MAX_STRUCTURE_PARSE_BYTES)
    )

    converted_atoms = []
    for i, a in enumerate(new_atoms):
        c_tuple = a.get("coordinates") or (a.get("x", 0.0), a.get("y", 0.0), a.get("z", 0.0))
        converted_atoms.append(
            {
                "element": a["element"],
                "atomic_number": atomic_number_for_symbol(a["element"]),
                "x": float(c_tuple[0]),
                "y": float(c_tuple[1]),
                "z": float(c_tuple[2]),
                "index": i,
            }
        )

    new_coordinates = {
        **coords_dict,
        "structure_version_id": "00000000-0000-4000-8000-000000000000",
        "source": None,
        "atoms": converted_atoms,
        "bonds": [],
    }

    is_periodic = structure.kind == StructureKind.PERIODIC
    candidate = CanonicalStructureCandidate(
        name=structure.name,
        kind=structure.kind,
        coordinates=new_coordinates,
        overall_charge=parent.overall_charge,
        multiplicity=parent.multiplicity,
        source_format=StructureSourceFormat(
            parent_document.get("source", {}).get("format", "CIF" if is_periodic else "XYZ")
        ),
        parser_name="chemdft.ai.structure_edit",
        parser_version="1.0.0",
        adapter_name="chemdft.structure_edit_propose",
        adapter_version="1.0.0",
        periodic_cell=parent.periodic_cell_json,
        diagnostics=(),
    )

    canonical_doc = canonical_document(candidate)
    canonical_record = _persist_canonical_artifact(
        session,
        identity,
        object_store,
        project_id=project.id,
        document=canonical_doc,
        source_artifact_id=parent.source_artifact_id,
    )

    latest_revision = (
        session.scalar(
            select(func.max(StructureVersionRecord.revision)).where(
                StructureVersionRecord.structure_id == structure.id
            )
        )
        or 0
    )
    version_id = new_id()

    provenance = ProvenanceRecordRow(
        id=new_id(),
        project_id=project.id,
        correlation_id=new_id(),
        subject_type="structure.version",
        subject_id=version_id,
        source_class=ProvenanceClass.AI_HYPOTHESIS,
        detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SOFTWARE,
        producer_identifier="chemdft.ai_scientist",
        producer_software_version="0.0.60",
        source_artifact_id=parent.source_artifact_id,
        operation="chemdft.structure.edit.propose",
        operation_version="1.0.0",
        parameters_json=[
            {"key": "parent_version_id", "value": str(parent.id)},
            {"key": "approval_id", "value": approval_id},
            {"key": "electronic_state_authority", "value": "UNVERIFIED"},
        ],
    )
    session.add(provenance)

    source_ref = (
        _artifact_reference(session.get(ScientificArtifactRecord, parent.source_artifact_id))
        if parent.source_artifact_id
        else None
    )

    rep_parent = parent.representation_json or {}
    cif_ref = rep_parent.get("cif_source_reference")
    src_ref = rep_parent.get("source_reference")
    representation_json = {
        **({"source_artifact": source_ref.model_dump(mode="json")} if source_ref else {}),
        "canonical_artifact": _artifact_reference(canonical_record).model_dump(mode="json"),
        "coordinates": new_coordinates,
        **({"cif_source_reference": cif_ref} if cif_ref is not None else {}),
        **({"source_reference": src_ref} if src_ref is not None else {}),
    }

    version_record = StructureVersionRecord(
        id=version_id,
        project_id=project.id,
        structure_id=structure.id,
        revision=latest_revision + 1,
        origin=StructureVersionOrigin.AI_PROPOSED,
        parent_version_id=parent.id,
        canonical_artifact_id=canonical_record.id,
        source_artifact_id=parent.source_artifact_id,
        coordinate_system=parent.coordinate_system,
        coordinate_unit=parent.coordinate_unit,
        atom_count=len(converted_atoms),
        bond_count=0,
        overall_charge=parent.overall_charge,
        multiplicity=parent.multiplicity,
        representation_json=representation_json,
        periodic_cell_json=parent.periodic_cell_json,
        diagnostics_json=[],
        provenance_record_id=provenance.id,
        idempotency_key=f"ai_proposed_edit:{version_id}",
        created_by=identity.user_id,
    )
    session.add(version_record)

    _audit_structure_event(
        session,
        identity,
        project_id=project.id,
        event_name="structure.version.created",
        structure_id=structure.id,
        version_id=version_record.id,
        artifacts=[_artifact_reference(canonical_record)],
    )

    session.commit()
    session.refresh(version_record)

    return StructureEditProposeOutput(
        schema_version="1.0.0",
        proposal_id=None,
        structure_id=UUID(structure.id),
        parent_version_id=UUID(parent.id),
        diff=diff_view,
        operations=payload.operations,
        status="APPLIED",
        created_version_id=UUID(version_record.id),
    )
