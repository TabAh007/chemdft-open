"""Pure, deterministic measurement of structure coordinates and unit cell.

Computed ONLY from durable, committed structure version records.
Never invokes an external engine, never fabricates values, never calls an LLM.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Any

# Maximum number of lines for the computed section
MAX_SECTION_LINES = 40
# Structures above this threshold receive summary statistics only
LARGE_STRUCTURE_ATOM_THRESHOLD = 200


def _det3x3(m: list[list[float]] | tuple[tuple[float, float, float], ...]) -> float:
    """Determinant of a 3x3 matrix."""
    return (
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    )


def _inv3x3(
    m: list[list[float]] | tuple[tuple[float, float, float], ...],
) -> list[list[float]] | None:
    """Inverse of a 3x3 matrix. Returns None if singular."""
    det = _det3x3(m)
    if abs(det) < 1e-12:
        return None
    inv_det = 1.0 / det
    return [
        [
            (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * inv_det,
            (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * inv_det,
            (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * inv_det,
        ],
        [
            (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * inv_det,
            (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * inv_det,
            (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * inv_det,
        ],
        [
            (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * inv_det,
            (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * inv_det,
            (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * inv_det,
        ],
    ]


def _mat_vec_mul(
    m: list[list[float]] | tuple[tuple[float, float, float], ...],
    v: tuple[float, float, float],
) -> tuple[float, float, float]:
    """Row-vector times matrix: v * M (where rows of M are lattice vectors)."""
    return (
        v[0] * m[0][0] + v[1] * m[1][0] + v[2] * m[2][0],
        v[0] * m[0][1] + v[1] * m[1][1] + v[2] * m[2][1],
        v[0] * m[0][2] + v[1] * m[1][2] + v[2] * m[2][2],
    )


def _hill_formula_from_counts(counts: dict[str, int]) -> str:
    """Generate Hill formula string from element counts."""
    order = (
        (["C"] if "C" in counts else [])
        + (["H"] if "H" in counts else [])
        + sorted(k for k in counts if k not in {"C", "H"})
    )
    return "".join(f"{k}{counts[k] if counts[k] > 1 else ''}" for k in order)


def _reduced_formula_from_counts(counts: dict[str, int]) -> str:
    """Generate reduced empirical formula string from element counts."""
    if not counts:
        return ""
    common_gcd = 0
    for cnt in counts.values():
        common_gcd = math.gcd(common_gcd, cnt)
    if common_gcd <= 1:
        return _hill_formula_from_counts(counts)
    reduced_counts = {el: cnt // common_gcd for el, cnt in counts.items()}
    return _hill_formula_from_counts(reduced_counts)


def compute_structure_measurements(
    *,
    version_label: str = "V1",
    origin: str | None = None,
    authority: str | None = None,
    coordinate_system: str | None = None,
    coordinate_unit: str | None = None,
    coordinates: dict[str, Any] | None = None,
    periodic_cell: dict[str, Any] | None = None,
    space_group: str | None = None,
) -> str:
    """Compute deterministic structural measurements from stored coordinates and cell.

    Returns a formatted plain-text block under MAX_SECTION_LINES lines.
    """
    header = (
        f"[Computed by ChemDFT from the stored coordinates of {version_label} "
        "(not an engine result, not AI-written)]"
    )
    footer = "[END COMPUTED STRUCTURE MEASUREMENTS]"

    lines: list[str] = [header]

    if not coordinates or not isinstance(coordinates.get("atoms"), list):
        lines.append("Coordinates: not stored")
        if periodic_cell:
            a = periodic_cell.get("a")
            b = periodic_cell.get("b")
            c = periodic_cell.get("c")
            alpha = periodic_cell.get("alpha")
            beta = periodic_cell.get("beta")
            gamma = periodic_cell.get("gamma")
            unit = periodic_cell.get("unit") or "angstrom"
            u_sym = "Å" if str(unit).lower() == "angstrom" else str(unit)
            lines.append(
                f"Cell parameters: a = {a} {u_sym}, b = {b} {u_sym}, c = {c} {u_sym}, "
                f"α = {alpha}°, β = {beta}°, γ = {gamma}°"  # noqa: RUF001
            )
        else:
            lines.append("Cell: not stored")
        lines.append(footer)
        return "\n".join(lines)

    raw_atoms = coordinates["atoms"]
    atom_count = len(raw_atoms)

    # Element counts and formula
    element_counts: dict[str, int] = Counter()
    atom_list: list[tuple[str, tuple[float, float, float]]] = []
    for atom in raw_atoms:
        if isinstance(atom, dict):
            el = str(atom.get("element") or "X")
            x = float(atom.get("x", 0.0))
            y = float(atom.get("y", 0.0))
            z = float(atom.get("z", 0.0))
            element_counts[el] += 1
            atom_list.append((el, (x, y, z)))

    # Periodic cell check
    is_periodic = periodic_cell is not None

    hill_formula = _hill_formula_from_counts(element_counts)
    reduced_formula = _reduced_formula_from_counts(element_counts)
    if is_periodic and reduced_formula and reduced_formula != hill_formula:
        formula_str = f"{reduced_formula} (unit cell formula {hill_formula})"
    else:
        formula_str = hill_formula

    comp_parts = [f"{el}: {cnt}" for el, cnt in sorted(element_counts.items())]
    lines.append(f"Formula: {formula_str} ({', '.join(comp_parts)}; {atom_count} atoms total)")

    coord_sys_str = (
        str(coordinate_system or coordinates.get("coordinate_system") or "CARTESIAN").upper()
    )
    coord_unit_str = (
        str(coordinate_unit or coordinates.get("unit") or "ANGSTROM").upper()
    )
    unit_sym = "Å" if coord_unit_str == "ANGSTROM" else coord_unit_str.lower()
    provenance_parts = [f"Coordinate type: {coord_sys_str}", f"Source units: {coord_unit_str}"]
    if origin:
        provenance_parts.append(f"Origin: {origin}")
    if authority:
        provenance_parts.append(f"Authority: {authority}")
    lines.append(", ".join(provenance_parts))

    if space_group:
        lines.append(f"Space group: {space_group}")

    # Periodic cell parsing
    lattice_mat: list[list[float]] | None = None
    inv_lattice_mat: list[list[float]] | None = None
    cell_vol: float | None = None

    if is_periodic and isinstance(periodic_cell, dict):
        a = float(periodic_cell.get("a", 0.0))
        b = float(periodic_cell.get("b", 0.0))
        c = float(periodic_cell.get("c", 0.0))
        alpha = float(periodic_cell.get("alpha", 90.0))
        beta = float(periodic_cell.get("beta", 90.0))
        gamma = float(periodic_cell.get("gamma", 90.0))
        cell_unit = str(periodic_cell.get("unit", "angstrom")).lower()
        cell_u_sym = "Å" if cell_unit == "angstrom" else cell_unit

        raw_vecs = periodic_cell.get("lattice_vectors")
        if raw_vecs and len(raw_vecs) == 3:
            lattice_mat = [
                [float(raw_vecs[i][j]) for j in range(3)] for i in range(3)
            ]
            cell_vol = abs(_det3x3(lattice_mat))
            inv_lattice_mat = _inv3x3(lattice_mat)
        else:
            # Analytical volume from parameters
            ca = math.cos(math.radians(alpha))
            cb = math.cos(math.radians(beta))
            cg = math.cos(math.radians(gamma))
            val = 1.0 - ca * ca - cb * cb - cg * cg + 2.0 * ca * cb * cg
            cell_vol = a * b * c * math.sqrt(max(0.0, val))

        vol_str = f", volume = {cell_vol:.2f} {cell_u_sym}³" if cell_vol is not None else ""
        lines.append(
            f"Cell: a = {a:.3f} {cell_u_sym}, b = {b:.3f} {cell_u_sym}, c = {c:.3f} {cell_u_sym}, "
            f"α = {alpha:.2f}°, β = {beta:.2f}°, γ = {gamma:.2f}°{vol_str}"  # noqa: RUF001
        )
    else:
        lines.append("Periodic cell: none (molecular / non-periodic)")

    if atom_count == 0:
        lines.append(footer)
        return "\n".join(lines)

    # Convert coordinates to both fractional and Cartesian representations where appropriate
    cart_atoms: list[tuple[str, tuple[float, float, float]]] = []
    frac_atoms: list[tuple[str, tuple[float, float, float]]] = []

    if is_periodic and lattice_mat:
        if coord_sys_str == "FRACTIONAL":
            for el, f in atom_list:
                frac_atoms.append((el, f))
                # Cartesian = f * M
                c_pos = (
                    f[0] * lattice_mat[0][0] + f[1] * lattice_mat[1][0] + f[2] * lattice_mat[2][0],
                    f[0] * lattice_mat[0][1] + f[1] * lattice_mat[1][1] + f[2] * lattice_mat[2][1],
                    f[0] * lattice_mat[0][2] + f[1] * lattice_mat[1][2] + f[2] * lattice_mat[2][2],
                )
                cart_atoms.append((el, c_pos))
        else:
            for el, c_pos in atom_list:
                cart_atoms.append((el, c_pos))
                if inv_lattice_mat:
                    # f = c_pos * M^-1
                    f = _mat_vec_mul(inv_lattice_mat, c_pos)
                    frac_atoms.append((el, f))
    else:
        cart_atoms = atom_list

    # Compute interatomic distances with periodic minimum-image handling
    def all_images_distances(i: int, j: int) -> list[float]:
        """All periodic image distances between atom i and atom j within unit shifts."""
        if is_periodic and lattice_mat and frac_atoms:
            f_i = frac_atoms[i][1]
            f_j = frac_atoms[j][1]
            df = (
                f_j[0] - f_i[0] - round(f_j[0] - f_i[0]),
                f_j[1] - f_i[1] - round(f_j[1] - f_i[1]),
                f_j[2] - f_i[2] - round(f_j[2] - f_i[2]),
            )
            dists = []
            for sx in (-1, 0, 1):
                for sy in (-1, 0, 1):
                    for sz in (-1, 0, 1):
                        if i == j and sx == 0 and sy == 0 and sz == 0:
                            continue
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
                        if d > 1e-4:
                            dists.append(d)
            return dists
        else:
            if i == j:
                return []
            ci = cart_atoms[i][1]
            cj = cart_atoms[j][1]
            dx = cj[0] - ci[0]
            dy = cj[1] - ci[1]
            dz = cj[2] - ci[2]
            d = math.sqrt(dx * dx + dy * dy + dz * dz)
            return [d] if d > 1e-4 else []

    def min_distance(i: int, j: int) -> float:
        dists = all_images_distances(i, j)
        return min(dists) if dists else float("inf")

    # For >200 atoms, sample subset to ensure fast pure computation
    max_eval_atoms = min(atom_count, 150)
    distinct_elements = sorted(element_counts.keys())

    # Map element -> atom indices (up to max_eval_atoms)
    el_indices: dict[str, list[int]] = defaultdict(list)
    for idx in range(max_eval_atoms):
        el = atom_list[idx][0]
        el_indices[el].append(idx)

    # Nearest-neighbour distance per element pair
    pair_min_distances: dict[tuple[str, str], float] = {}
    pair_typical_distances: dict[tuple[str, str], float] = {}
    pair_all_min_per_atom: dict[tuple[str, str], list[float]] = defaultdict(list)
    coordination_cutoffs: dict[tuple[str, str], float] = {}

    for e1 in distinct_elements:
        indices1 = el_indices[e1]
        for e2 in distinct_elements:
            if e1 > e2:
                continue
            indices2 = el_indices[e2]
            pair_key = (e1, e2)

            nearest_for_atoms: list[float] = []
            for i in indices1:
                min_for_i = float("inf")
                for j in indices2:
                    d = min_distance(i, j)
                    if d < min_for_i:
                        min_for_i = d
                if min_for_i < float("inf"):
                    nearest_for_atoms.append(min_for_i)

            if nearest_for_atoms:
                min_d = min(nearest_for_atoms)
                typical_d = sum(nearest_for_atoms) / len(nearest_for_atoms)
                pair_min_distances[pair_key] = min_d
                pair_typical_distances[pair_key] = typical_d
                pair_all_min_per_atom[pair_key] = nearest_for_atoms
                cutoff = round(min_d * 1.18, 2)
                coordination_cutoffs[pair_key] = cutoff

    pbc_note = " (with periodic minimum-image convention)" if is_periodic else ""
    lines.append(f"Nearest-neighbour distances{pbc_note}:")

    for (e1, e2), min_d in sorted(pair_min_distances.items()):
        typ_d = pair_typical_distances[(e1, e2)]
        all_d = pair_all_min_per_atom[(e1, e2)]
        max_d = max(all_d)
        if abs(max_d - min_d) > 0.01:
            range_str = f" (range {min_d:.3f}-{max_d:.3f} {unit_sym})"
        else:
            range_str = ""
        lines.append(
            f"- {e1} to {e2}: min {min_d:.3f} {unit_sym}, "
            f"typical {typ_d:.3f} {unit_sym}{range_str}"
        )

    # Coordination counts within the stated cutoff
    lines.append("Coordination counts within stated cutoffs:")
    for e1 in distinct_elements:
        indices1 = el_indices[e1]
        for e2 in distinct_elements:
            pair_key = (min(e1, e2), max(e1, e2))
            cutoff = coordination_cutoffs.get(pair_key)
            if cutoff is None:
                continue

            indices2 = el_indices[e2]
            counts_per_atom: list[int] = []
            for i in indices1:
                c_count = 0
                for j in indices2:
                    for d in all_images_distances(i, j):
                        if d <= cutoff:
                            c_count += 1
                counts_per_atom.append(c_count)

            if counts_per_atom:
                min_c = min(counts_per_atom)
                max_c = max(counts_per_atom)
                if min_c == max_c:
                    lines.append(
                        f"- Each {e1} coordinated by {min_c} {e2} (cutoff {cutoff:.2f} {unit_sym})"
                    )
                else:
                    avg_c = sum(counts_per_atom) / len(counts_per_atom)
                    lines.append(
                        f"- {e1} coordinated by {min_c}-{max_c} {e2} "
                        f"(typical {avg_c:.1f}, cutoff {cutoff:.2f} {unit_sym})"
                    )

    if atom_count > LARGE_STRUCTURE_ATOM_THRESHOLD:
        lines.append(
            f"Note: Structure contains {atom_count} atoms (> {LARGE_STRUCTURE_ATOM_THRESHOLD}); "
            "metrics summarized above."
        )

    lines.append(footer)

    # Enforce size cap
    if len(lines) > MAX_SECTION_LINES:
        lines = [
            *lines[: MAX_SECTION_LINES - 2],
            "... [metrics truncated to fit limit]",
            footer,
        ]

    return "\n".join(lines)
