# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Tolerance-aware rotational symmetry number for molecular thermochemistry.

Standalone module: depends only on numpy and the standard library so it can be imported both by
the API process (gate/firewall re-verification) and by the isolated PySCF worker script.

The rotational symmetry number sigma is the order of the rotational subgroup (proper rotations,
including the identity) of the molecule. PySCF derives it from a point-group lookup whose
tolerance (about 1e-5 bohr) misclassifies numerically optimized geometries, silently reducing
sigma (for water 2 -> 1, a 0.41 kcal/mol error in G). This implementation instead enumerates
proper rotations directly: for two reference atoms every admissible image pair defines a
candidate rotation (least-squares / Kabsch), and a rotation is a symmetry operation when every
atom maps onto a distinct atom of the same element within ``tolerance_angstrom``. The distinct
induced atom permutations are counted.

Reliability is checked, not assumed: the result must be identical at tolerance/2, tolerance and
2*tolerance, otherwise ``SymmetryAmbiguous`` is raised instead of guessing (never a silent
sigma = 1).
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass

import numpy as np

ALGORITHM = "chemdft.proper-rotation-permutation-count"
ALGORITHM_VERSION = "1.0.0"
DEFAULT_TOLERANCE_ANGSTROM = 0.02
MAX_ATOMS = 120


class SymmetryUndetermined(ValueError):
    """Symmetry number cannot be established (unsupported size or degenerate input)."""


class SymmetryAmbiguous(SymmetryUndetermined):
    """The geometry is symmetric only at some tolerances; sigma is not reliable."""


@dataclass(frozen=True, slots=True)
class SymmetryNumberResult:
    sigma: int
    geometry_class: str  # "atom" | "linear" | "nonlinear"
    algorithm: str
    algorithm_version: str
    tolerance_angstrom: float
    method: str
    stability_checked_tolerances_angstrom: tuple[float, float, float]


def _kabsch_rotation(source: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Proper rotation R minimising |R @ source_i - target_i| over the given vectors."""
    covariance = source.T @ target
    u, _s, vt = np.linalg.svd(covariance)
    d = np.sign(np.linalg.det(vt.T @ u.T))
    correction = np.diag([1.0, 1.0, d if d != 0 else 1.0])
    return vt.T @ correction @ u.T


def _permutation(rotated: np.ndarray, reference: np.ndarray, elements: np.ndarray, tol: float):
    permutation = []
    for i in range(len(rotated)):
        distances = np.linalg.norm(reference - rotated[i], axis=1)
        distances = np.where(elements == elements[i], distances, np.inf)
        j = int(np.argmin(distances))
        if distances[j] > tol:
            return None
        permutation.append(j)
    if len(set(permutation)) != len(permutation):
        return None
    return tuple(permutation)


def _linear_sigma(x: np.ndarray, elements: np.ndarray, tol: float) -> int:
    inverted = _permutation(-x, x, elements, tol)
    return 2 if inverted is not None else 1


def _classify(x: np.ndarray, elements: np.ndarray, tol: float) -> tuple[int, str]:
    n = len(x)
    if n == 1:
        return 1, "atom"
    norms = np.linalg.norm(x, axis=1)
    # Collinearity: every atom lies within `tol` of one line through the centroid.
    axis = x[int(np.argmax(norms))]
    axis = axis / np.linalg.norm(axis)
    perpendicular = x - np.outer(x @ axis, axis)
    if float(np.max(np.linalg.norm(perpendicular, axis=1))) <= tol:
        return _linear_sigma(x, elements, tol), "linear"

    # Two reference atoms whose centroid vectors are not collinear and that have few
    # same-element, same-radius images (fewer candidate rotations).
    off_center = [i for i in range(n) if norms[i] > tol]

    def candidate_count(i: int) -> int:
        return int(np.sum((elements == elements[i]) & (np.abs(norms - norms[i]) <= tol)))

    off_center.sort(key=lambda i: (candidate_count(i), -norms[i]))
    a = off_center[0]
    b = None
    for i in off_center[1:]:
        cross = np.linalg.norm(np.cross(x[a], x[i]))
        if cross > tol * max(norms[a], norms[i]) * 2.0:
            b = i
            break
    if b is None:
        raise SymmetryUndetermined("Could not choose non-collinear reference atoms.")

    images_a = [
        j for j in range(n) if elements[j] == elements[a] and abs(norms[j] - norms[a]) <= tol
    ]
    images_b = [
        k for k in range(n) if elements[k] == elements[b] and abs(norms[k] - norms[b]) <= tol
    ]
    dot_ab = float(x[a] @ x[b])
    permutations = set()
    for j, k in itertools.product(images_a, images_b):
        if j == k:
            continue
        if abs(float(x[j] @ x[k]) - dot_ab) > 2.0 * tol * max(norms[a], norms[b], 1.0):
            continue
        # Orthonormal frames from (a, b) and (j, k); rotation maps frame -> frame.
        frame_s = _frame(x[a], x[b])
        frame_t = _frame(x[j], x[k])
        if frame_s is None or frame_t is None:
            continue
        rotation = frame_t.T @ frame_s  # proper by construction (right-handed frames)
        coarse = _permutation(x @ rotation.T, x, elements, 3.0 * tol)
        if coarse is None:
            continue
        # Refine with every atom pair so the two reference atoms do not amplify noise.
        rotation = _kabsch_rotation(x, x[list(coarse)])
        permutation = _permutation(x @ rotation.T, x, elements, tol)
        if permutation is not None:
            permutations.add(permutation)
    identity = tuple(range(n))
    permutations.add(identity)
    return len(permutations), "nonlinear"


def _frame(v1: np.ndarray, v2: np.ndarray) -> np.ndarray | None:
    e1 = v1 / np.linalg.norm(v1)
    w = v2 - (v2 @ e1) * e1
    norm = np.linalg.norm(w)
    if norm < 1e-9:
        return None
    e2 = w / norm
    e3 = np.cross(e1, e2)
    return np.vstack([e1, e2, e3])


def rotational_symmetry_number(
    elements: list[str] | tuple[str, ...],
    coordinates_angstrom: list[list[float]] | tuple[tuple[float, float, float], ...] | np.ndarray,
    *,
    tolerance_angstrom: float = DEFAULT_TOLERANCE_ANGSTROM,
) -> SymmetryNumberResult:
    """Return sigma for the molecule; raise ``SymmetryUndetermined`` rather than guess."""
    if not (1e-4 <= tolerance_angstrom <= 0.1):
        raise SymmetryUndetermined("Symmetry tolerance must lie between 1e-4 and 0.1 angstrom.")
    x = np.asarray(coordinates_angstrom, dtype=float)
    if x.ndim != 2 or x.shape[1] != 3 or len(x) != len(elements) or len(x) == 0:
        raise SymmetryUndetermined("Symmetry detection requires one Cartesian triple per atom.")
    if not np.isfinite(x).all():
        raise SymmetryUndetermined("Symmetry detection requires finite coordinates.")
    if len(x) > MAX_ATOMS:
        raise SymmetryUndetermined(
            f"Symmetry detection supports at most {MAX_ATOMS} atoms; provide a recorded override."
        )
    labels = {symbol: index for index, symbol in enumerate(sorted(set(elements)))}
    element_ids = np.array([labels[symbol] for symbol in elements])
    x = x - x.mean(axis=0)

    scales = (tolerance_angstrom / 2.0, tolerance_angstrom, tolerance_angstrom * 2.0)
    outcomes = [_classify(x, element_ids, scale) for scale in scales]
    if len({outcome for outcome in outcomes}) != 1:
        raise SymmetryAmbiguous(
            "Rotational symmetry number is not stable across tolerances "
            f"{scales} angstrom: {outcomes}. Provide a recorded symmetry-number override."
        )
    sigma, geometry_class = outcomes[1]
    if sigma < 1:
        raise SymmetryUndetermined("Invalid symmetry number.")
    return SymmetryNumberResult(
        sigma=sigma,
        geometry_class=geometry_class,
        algorithm=ALGORITHM,
        algorithm_version=ALGORITHM_VERSION,
        tolerance_angstrom=tolerance_angstrom,
        method="proper-rotation-count",
        stability_checked_tolerances_angstrom=scales,
    )
