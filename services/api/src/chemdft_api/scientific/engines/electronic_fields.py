# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Saved SCF arrays -> deterministic real-space fields. No SCF iteration occurs here."""

from __future__ import annotations

import hashlib
import math
from typing import Any

import numpy as np

BOHR_PER_ANGSTROM = 1.8897261254578281
FIELD_GENERATOR_VERSION = "2.0.0"
STANDARD_SPACING_ANGSTROM = 0.12
FIELD_POINT_LIMIT = 250_000
DEFAULT_DENSITY_ISOVALUE = 0.001
TETRAHEDRA = ((0, 5, 1, 6), (0, 1, 2, 6), (0, 2, 3, 6), (0, 3, 7, 6), (0, 7, 4, 6), (0, 4, 5, 6))
CORNERS = np.asarray(
    ((0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1))
)


def derive_density_matrix(
    channels: list[dict[str, Any]], basis_count: int, electron_count: int
) -> np.ndarray:
    names = [c.get("spin_channel") for c in channels]
    if names not in (["restricted"], ["alpha", "beta"]):
        raise ValueError("Density requires restricted or alpha/beta SCF channels")
    matrix = np.zeros((basis_count, basis_count), dtype=np.float64)
    occupations_sum = 0.0
    for channel in channels:
        coeff = np.asarray(channel["coefficients"], dtype=np.float64)
        occ = np.asarray(channel["occupations"], dtype=np.float64)
        maximum = 2 if channel["spin_channel"] == "restricted" else 1
        if (
            coeff.ndim != 2
            or coeff.shape[0] != basis_count
            or occ.shape != (coeff.shape[1],)
            or not np.isfinite(coeff).all()
            or not np.isfinite(occ).all()
            or np.any(occ < 0)
            or np.any(occ > maximum)
        ):
            raise ValueError("Malformed SCF coefficients or occupations for density matrix")
        matrix += (coeff * occ) @ coeff.T
        occupations_sum += float(occ.sum())
    if not math.isclose(occupations_sum, electron_count, abs_tol=1e-8):
        raise ValueError("SCF occupations disagree with electron count")
    if not np.isfinite(matrix).all() or not np.allclose(matrix, matrix.T, atol=1e-12):
        raise ValueError("Density matrix is non-finite or asymmetric")
    if np.linalg.eigvalsh(matrix).min() < -1e-8:
        raise ValueError("Density matrix is not positive semidefinite")
    return matrix


def matrix_hash(matrix: np.ndarray) -> str:
    return hashlib.sha256(np.asarray(matrix, dtype="<f8").tobytes(order="C")).hexdigest()


def standard_grid(atoms: list[dict[str, Any]]) -> tuple[list[float], list[int]]:
    xyz = np.asarray([a["xyz_angstrom"] for a in atoms], dtype=np.float64)
    if xyz.ndim != 2 or xyz.shape[1] != 3 or not np.isfinite(xyz).all():
        raise ValueError("Field geometry is malformed")
    spacing = STANDARD_SPACING_ANGSTROM
    base = np.floor((xyz.min(axis=0) - 3.0) / spacing) * spacing
    # Same deterministic lattice for all field kinds, chosen to exclude nuclear singularities.
    for offset in (0.5, 0.25, 0.375, 0.625, 0.125):
        origin = base + spacing * offset
        relative = (xyz - origin) / spacing
        if not np.any(np.all(np.abs(relative - np.round(relative)) < 1e-8, axis=1)):
            break
    else:
        raise ValueError("No safe deterministic grid origin avoids nuclear singularities")
    dims = np.ceil((xyz.max(axis=0) + 3.0 - origin) / spacing).astype(int) + 1
    if np.any(dims > 160) or math.prod(int(v) for v in dims) > FIELD_POINT_LIMIT:
        raise ValueError(
            "STANDARD grid exceeds the explicit 250000-point cap; "
            "resolution is not reduced automatically"
        )
    return origin.tolist(), dims.tolist()


def evaluate_field(molecule: Any, document: dict[str, Any]) -> dict[str, Any]:
    from pyscf import __version__, df, gto

    kind = document["field_kind"]
    grid = document["grid"]
    shape = tuple(grid["dimensions"])
    if (
        len(shape) != 3
        or any(not isinstance(n, int) or n < 2 or n > 160 for n in shape)
        or math.prod(shape) > FIELD_POINT_LIMIT
    ):
        raise ValueError("Invalid volumetric field dimensions")
    origin = np.asarray(grid["origin_angstrom"], dtype=float)
    spacing = float(grid["spacing_angstrom"])
    if (
        origin.shape != (3,)
        or not np.isfinite(origin).all()
        or not math.isfinite(spacing)
        or spacing <= 0
    ):
        raise ValueError("Invalid volumetric field frame")
    matrix = derive_density_matrix(
        document["orbital_channels"], molecule.nao_nr(), molecule.nelectron
    )
    if matrix_hash(matrix) != document["density_matrix_sha256"]:
        raise ValueError("Reconstructed density-matrix hash mismatch")
    overlap_count = float(np.einsum("ij,ji->", matrix, molecule.intor_symmetric("int1e_ovlp")))
    if not math.isclose(overlap_count, molecule.nelectron, abs_tol=1e-6):
        raise ValueError("Density-matrix overlap trace disagrees with electron count")
    axes = [origin[i] + np.arange(shape[i]) * spacing for i in range(3)]
    coords = np.stack(np.meshgrid(*axes, indexing="ij"), axis=-1).reshape(-1, 3) * BOHR_PER_ANGSTROM
    field = np.empty(len(coords), dtype=np.float64)
    if kind in ("MO_AMPLITUDE", "ELECTRON_DENSITY"):
        coefficient = None
        if kind == "MO_AMPLITUDE":
            channel = next(
                c
                for c in document["orbital_channels"]
                if c["spin_channel"] == document["spin_channel"]
            )
            coefficient = np.asarray(channel["coefficients"])[:, document["orbital_index"]]
        for start in range(0, len(coords), 4096):
            ao = molecule.eval_gto("GTOval", coords[start : start + 4096])
            field[start : start + 4096] = (
                ao @ coefficient
                if coefficient is not None
                else np.einsum("pi,ij,pj->p", ao, matrix, ao)
            )
    elif kind == "ELECTROSTATIC_POTENTIAL":
        field.fill(0)
        for atom_index in range(molecule.natm):
            distance = np.linalg.norm(coords - molecule.atom_coord(atom_index), axis=1)
            if np.any(distance < 1e-10):
                raise ValueError("ESP grid intersects a nuclear singularity")
            field += molecule.atom_charge(atom_index) / distance
        # Same nuclear-minus-electronic Coulomb convention as pyscf.tools.cubegen.mep.
        for start in range(0, len(coords), 600):
            integrals = df.incore.aux_e2(
                molecule, gto.fakemol_for_charges(coords[start : start + 600])
            )
            field[start : start + 600] -= np.einsum("ijp,ij->p", integrals, matrix)
    else:
        raise ValueError("Unsupported SCF field kind")
    field = field.astype("<f4")
    if not np.isfinite(field).all() or (kind == "ELECTRON_DENSITY" and float(field.min()) < -1e-8):
        raise ValueError("Field contains non-finite or negative density values")
    integral = (
        density_integral(field.reshape(shape), spacing) if kind == "ELECTRON_DENSITY" else None
    )
    return {
        "schema": "chemdft.worker.volumetric-field",
        "engine": "pyscf",
        "engine_version": __version__,
        "generator_version": FIELD_GENERATOR_VERSION,
        "field_kind": kind,
        "dimensions": list(shape),
        "origin_angstrom": origin.tolist(),
        "spacing_angstrom": spacing,
        "density_matrix_sha256": matrix_hash(matrix),
        "density_matrix_electron_count": overlap_count,
        "density_integral_electrons": integral,
        "field_values": field.tolist(),
    }


def density_integral(field: np.ndarray, spacing: float) -> float:
    weights = [np.ones(n) for n in field.shape]
    for w in weights:
        w[[0, -1]] = 0.5
    return float(
        np.einsum("ijk,i,j,k->", field.astype(np.float64), *weights)
        * (spacing * BOHR_PER_ANGSTROM) ** 3
    )


def sample_trilinear(field: np.ndarray, positions: np.ndarray) -> np.ndarray:
    lo = np.floor(positions).astype(int)
    if np.any(lo < 0) or np.any(lo > np.asarray(field.shape) - 1):
        raise ValueError("Surface sampling is outside the ESP grid")
    lo = np.minimum(lo, np.asarray(field.shape) - 2)
    frac = positions - lo
    sampled = np.zeros(len(positions))
    for x in (0, 1):
        for y in (0, 1):
            for z in (0, 1):
                weight = np.prod(np.where(np.asarray([x, y, z]), frac, 1 - frac), axis=1)
                sampled += field[lo[:, 0] + x, lo[:, 1] + y, lo[:, 2] + z] * weight
    return sampled


def surface_statistics(
    density: np.ndarray, potential: np.ndarray, origin: list[float], spacing: float
) -> dict[str, Any]:
    iso = DEFAULT_DENSITY_ISOVALUE
    cube_values = np.stack(
        [
            density[
                dx : density.shape[0] - 1 + dx,
                dy : density.shape[1] - 1 + dy,
                dz : density.shape[2] - 1 + dz,
            ]
            for dx, dy, dz in CORNERS
        ],
        axis=-1,
    )
    active = np.argwhere((cube_values.min(-1) < iso) & (cube_values.max(-1) >= iso))
    vertices = []
    for cell in active:
        values = cube_values[tuple(cell)]
        points = cell + CORNERS
        for tetra in TETRAHEDRA:
            inside = [i for i in tetra if values[i] >= iso]
            outside = [i for i in tetra if values[i] < iso]

            def edge(
                a: int, b: int, points: np.ndarray = points, values: np.ndarray = values
            ) -> np.ndarray:
                return points[a] + (points[b] - points[a]) * (
                    (iso - values[a]) / (values[b] - values[a])
                )

            if len(inside) == 1:
                vertices.extend(edge(inside[0], i) for i in outside)
            elif len(inside) == 3:
                vertices.extend(edge(outside[0], i) for i in inside)
            elif len(inside) == 2:
                a, b = inside
                c, d = outside
                ac, ad, bc, bd = edge(a, c), edge(a, d), edge(b, c), edge(b, d)
                vertices.extend((ac, ad, bd, ac, bd, bc))
    if not vertices:
        raise ValueError("Default density surface has no triangles")
    positions = np.asarray(vertices)
    values = sample_trilinear(potential, positions)
    minimum, maximum = int(values.argmin()), int(values.argmax())
    return {
        "density_isovalue": iso,
        "minimum": float(values[minimum]),
        "maximum": float(values[maximum]),
        "minimum_position_angstrom": (np.asarray(origin) + positions[minimum] * spacing).tolist(),
        "maximum_position_angstrom": (np.asarray(origin) + positions[maximum] * spacing).tolist(),
        "vertex_count": len(vertices),
        "triangle_count": len(vertices) // 3,
    }
