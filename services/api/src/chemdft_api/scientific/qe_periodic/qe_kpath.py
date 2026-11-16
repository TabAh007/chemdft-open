# Proprietary to ChemDFT. All rights reserved.
"""High-symmetry k-path for band-structure runs, in the reciprocal basis of the CALCULATION cell.

The path comes from pymatgen's HighSymmKpath (Setyawan-Curtarolo convention), which pymatgen already provides for the
crystal-symmetry work in ChemDFT. Those k-points refer to the standard primitive cell, so the code finds the integer
transformation between the input cell and that standard cell and verifies it with a structure match before using it.
If no verified transformation exists the path falls back to zone-boundary (time-reversal-invariant) points of the input
cell's own reciprocal basis and says so; it never guesses silently."""

from __future__ import annotations

import itertools
import re
import warnings
from collections.abc import Sequence

import numpy

MAX_POINTS = 100
DEFAULT_POINTS_PER_SEGMENT = 12


_SUBSCRIPTS = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")


def _gamma_label(label: str) -> str:
    text = label.replace("\\Gamma", "Γ").replace("$", "")
    if text.upper() == "GAMMA":
        return "Γ"
    return re.sub(r"_(\d+)", lambda m: m.group(1).translate(_SUBSCRIPTS), text)


def _points_per_interval(intervals: int, segments: int, cap: int) -> int:
    if intervals <= 0:
        return 1
    return max(2, min(DEFAULT_POINTS_PER_SEGMENT, (cap - segments) // intervals))


def _assemble(segments: Sequence[Sequence[tuple[str, Sequence[float]]]], cap: int) -> dict:
    intervals = sum(len(s) - 1 for s in segments)
    n = _points_per_interval(intervals, len(segments), cap)
    labels: list[str] = []
    points: list[list[float]] = []
    weights: list[int] = []
    for segment in segments:
        for p_index, (label, point) in enumerate(segment):
            labels.append(label)
            points.append([float(x) for x in point])
            last_of_segment = p_index == len(segment) - 1
            if last_of_segment:
                weights.append(1)  # a break (or the end of the path): the next point is reached in one step
            else:
                weights.append(n)
    # crystal_b: the very last point carries weight 1 by definition
    weights[-1] = 1
    return {"labels": labels, "points": points, "weights": weights, "segments": len(segments)}


def _transformation(structure, standard) -> numpy.ndarray | None:
    """Integer matrix M (standard cell vectors = M x input cell vectors) verified by a structure match, or None."""
    from pymatgen.analysis.structure_matcher import StructureMatcher
    from pymatgen.core import Structure

    g_input = structure.lattice.matrix @ structure.lattice.matrix.T
    g_std = standard.lattice.matrix @ standard.lattice.matrix.T
    all_matrices = numpy.array(list(itertools.product((-1, 0, 1), repeat=9)), dtype=float).reshape(-1, 3, 3)
    unimodular = all_matrices[numpy.abs(numpy.round(numpy.linalg.det(all_matrices))) == 1]
    transformed = unimodular @ g_input @ numpy.transpose(unimodular, (0, 2, 1))
    close = numpy.all(numpy.abs(transformed - g_std) < 5e-3, axis=(1, 2))
    candidates = [(float(numpy.abs(m).sum()), m) for m in unimodular[close]]
    candidates.sort(key=lambda item: item[0])
    matcher = StructureMatcher(primitive_cell=False, scale=False, attempt_supercell=False, ltol=0.02, stol=0.05, angle_tol=1.0)
    for _score, matrix in candidates[:48]:
        new_lattice = matrix @ structure.lattice.matrix
        try:
            moved = Structure(new_lattice, structure.species, structure.frac_coords @ numpy.linalg.inv(matrix), to_unit_cell=True)
        except Exception:  # a bad candidate is skipped, not fatal
            continue
        if matcher.fit(moved, standard):
            return matrix
    return None


def band_path_for(lattice: Sequence[Sequence[float]], species: Sequence[str], fractional: Sequence[Sequence[float]], cap: int = MAX_POINTS) -> dict:
    """-> {labels, points, weights, source}: crystal_b k-points in the reciprocal basis of ``lattice``."""
    from pymatgen.core import Structure
    from pymatgen.symmetry.analyzer import SpacegroupAnalyzer
    from pymatgen.symmetry.bandstructure import HighSymmKpath

    structure = Structure(numpy.array(lattice, dtype=float), list(species), [list(f) for f in fractional])
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            kpath = HighSymmKpath(structure, path_type="setyawan_curtarolo", symprec=0.01, angle_tolerance=5, atol=1e-5)
        standard = SpacegroupAnalyzer(structure, symprec=0.01, angle_tolerance=5).get_primitive_standard_structure()
        matrix = _transformation(structure, standard)
        if matrix is None:
            raise ValueError("no verified transformation to the standard primitive cell")
        inverse_transpose = numpy.linalg.inv(matrix).T
        kpoints = {name: numpy.array(value) @ inverse_transpose for name, value in kpath.kpath["kpoints"].items()}
        segments = [
            [(_gamma_label(name), kpoints[name]) for name in segment] for segment in kpath.kpath["path"]
        ]
        assembled = _assemble(segments, cap)
        assembled["source"] = (
            "High-symmetry path of the Setyawan-Curtarolo convention from pymatgen, "
            "transformed to this cell and verified by a structure match."
        )
        return assembled
    except Exception as error:  # fall back to a clearly labelled generic path
        fallback = [
            [("Γ", (0.0, 0.0, 0.0)), ("B1", (0.5, 0.0, 0.0)), ("B12", (0.5, 0.5, 0.0)), ("Γ", (0.0, 0.0, 0.0)), ("B123", (0.5, 0.5, 0.5))]
        ]
        assembled = _assemble(fallback, cap)
        assembled["source"] = (
            "Generic path through zone-boundary (time-reversal-invariant) points of this cell's own reciprocal basis, "
            f"not a conventional high-symmetry path ({type(error).__name__}: {error})."
        )
        return assembled


def total_points(weights: Sequence[int]) -> int:
    return sum(int(w) for w in weights[:-1]) + 1 if weights else 0
