# Proprietary to ChemDFT. All rights reserved.
"""Hosted-class limits, refusals and the rough time/memory estimate for Quantum ESPRESSO periodic jobs.

Everything is scaled from the single set of measurements the owner ran on the hosted class (2 vCPU = 1 core x 2 threads,
8 GB; alpha-Cr2O3, 10 atoms, 92 electrons, SSSP 45/540 Ry, QE 7.6). The estimate is a rough planning figure, never a
promise: it is labelled as such everywhere it is shown."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

REFERENCE_ATOMS = 10
REFERENCE_ECUTWFC_RY = 45.0
# Calibrated 2026-11-12 on ChemDFT's own worker runs (hosted class, 10 atoms, alpha-Cr2O3 AFM PBE+U): Gamma 57 s, 3x3x3 102 s,
# relaxation at 2x2x2 417 s, 3x3x3 + DOS 6x6x6 + 49-point bands 622 s (whole jobs). The k-count used here is the UPPER BOUND
# (full mesh halved), because the real irreducible count is only known after pw.x starts (it was 1, 4, 6 and 32 in the measured
# runs), so the per-k costs below are per BOUND k-point, not per irreducible k-point. Total = base + per_k x bound + 5 s Lowdin:
# 1 k -> 57 s, 14 k (3x3x3) -> 102 s. Before this calibration the estimator was 2.4x too high for the two larger cases.
SCF_BASE_S = 48.5
SCF_PER_K_S = 3.46
RELAX_SCF_FACTOR = (
    0.8  # restarted SCF cycles after the first are cheaper: 546 s for 7 cycles at 2x2x2 (4 k)
)
RELAX_REFERENCE_CYCLES = 7
NSCF_PER_K_S = 211.0 / 108.0  # 211 s measured for 6x6x6 (32 irreducible k), per bound k-point (108)
BANDS_PER_K_S = 327.0 / 49.0
# The DOS (nscf) and bands stages of the 622 s whole-job run took 0.7 of what the earlier stage timings above predict
# (515 s measured for both stages together against 748 s), so both stages are multiplied by this one factor.
POST_SCF_STAGE_FACTOR = 0.7
BANDS_X_PER_SPIN_S = 98.0
DOS_TOOLS_S = 14.0  # dos.x 4 s + projwfc.x 10 s
PROJWFC_LOWDIN_S = 5.0
# Memory (MB, 10 atoms): pw.x about 340, projwfc.x 270, dos.x 500, bands.x 1100 for 49 k-points.
PW_MEMORY_MB = 350.0
DOS_X_MEMORY_MB = 500.0
BANDS_X_MEMORY_MB = 1100.0
BANDS_X_REFERENCE_K = 49
# QE's symmetry detection works best for standard cell orientations; the estimate uses an upper bound for the number of
# irreducible k-points (full mesh halved by time reversal) because the real count is only known after pw.x starts.
ESTIMATE_LABEL = "Rough estimate scaled from one measured 10-atom run on this machine class; the real time can differ a lot."


@dataclass(frozen=True)
class QeLimits:
    max_atoms: int = 20
    max_scf_k: int = 4
    max_dos_k: int = 6
    max_band_points: int = 100
    relax_max_steps: int = 30
    timeout_scf_s: int = 1800
    timeout_relax_s: int = 3600
    timeout_nscf_dos_s: int = 1800
    timeout_bands_s: int = 1800
    timeout_total_s: int = 3600
    max_memory_mb: int = 6000
    max_scratch_bytes: int = 6 * 1024**3
    vcpus: int = 2


ALLOWED_SCF_MESHES = ((1, 1, 1), (2, 2, 2), (3, 3, 3), (4, 4, 4))


def irreducible_upper_bound(mesh: Sequence[int]) -> int:
    n = int(mesh[0]) * int(mesh[1]) * int(mesh[2])
    return max(1, math.ceil(n / 2))


def _scale(atoms: int, ecutwfc_ry: float) -> float:
    return (atoms / REFERENCE_ATOMS) ** 3 * (ecutwfc_ry / REFERENCE_ECUTWFC_RY) ** 1.5


def estimate_seconds(
    *,
    atoms: int,
    ecutwfc_ry: float,
    scf_mesh: Sequence[int],
    nspin: int,
    relax: bool,
    dos: bool,
    dos_mesh: Sequence[int],
    bands: bool,
    band_points: int,
) -> dict[str, float]:
    scale = _scale(atoms, ecutwfc_ry)
    spin_factor = 1.0 if nspin == 2 else 0.5
    k_scf = irreducible_upper_bound(scf_mesh)
    scf = (SCF_BASE_S + SCF_PER_K_S * k_scf) * scale * spin_factor
    stages: dict[str, float] = {"scf": scf if not relax else 0.0}
    stages["projwfc_lowdin"] = PROJWFC_LOWDIN_S * scale
    if relax:
        stages["relax"] = scf * RELAX_SCF_FACTOR * RELAX_REFERENCE_CYCLES
    if dos:
        stages["nscf_dos"] = (
            (NSCF_PER_K_S * irreducible_upper_bound(dos_mesh) + DOS_TOOLS_S)
            * scale
            * spin_factor
            * POST_SCF_STAGE_FACTOR
        )
    if bands:
        spins = 2 if nspin == 2 else 1
        stages["bands"] = (
            (BANDS_PER_K_S * band_points + BANDS_X_PER_SPIN_S * spins)
            * scale
            * spin_factor
            * POST_SCF_STAGE_FACTOR
        )
    stages["total"] = sum(v for k, v in stages.items() if k != "total")
    return {k: round(v, 1) for k, v in stages.items()}


def estimate_memory_mb(
    *, atoms: int, ecutwfc_ry: float, band_points: int, bands: bool, dos: bool
) -> float:
    ratio = atoms / REFERENCE_ATOMS
    cut = (ecutwfc_ry / REFERENCE_ECUTWFC_RY) ** 1.5
    peak = PW_MEMORY_MB * ratio**2 * cut
    if dos:
        peak = max(peak, DOS_X_MEMORY_MB * ratio**2)
    if bands:
        peak = max(
            peak, BANDS_X_MEMORY_MB * ratio**2 * cut * (max(band_points, 1) / BANDS_X_REFERENCE_K)
        )
    return round(peak, 1)


def human_duration(seconds: float) -> str:
    if seconds < 90:
        return f"about {round(seconds)} s"
    if seconds < 5400:
        return f"about {round(seconds / 60)} min"
    return f"about {seconds / 3600:.1f} h"


def refusal(
    limits: QeLimits,
    *,
    atoms: int,
    ecutwfc_ry: float,
    scf_mesh: Sequence[int],
    relax: bool,
    relax_max_steps: int,
    dos: bool,
    dos_mesh: Sequence[int],
    bands: bool,
    band_points: int,
    nspin: int = 2,
) -> str | None:
    """Plain-language reason a hosted Quantum ESPRESSO job must be refused before it is submitted, else None."""
    if atoms > limits.max_atoms:
        return (
            f"Hosted Quantum ESPRESSO periodic DFT is limited to {limits.max_atoms} atoms in the cell; "
            f"this structure has {atoms}."
        )
    mesh = tuple(int(x) for x in scf_mesh)
    if mesh not in ALLOWED_SCF_MESHES or max(mesh) > limits.max_scf_k:
        return "The SCF k-point mesh for Quantum ESPRESSO must be Gamma, 2x2x2, 3x3x3 or 4x4x4."
    if dos:
        dm = tuple(int(x) for x in dos_mesh)
        if len(dm) != 3 or min(dm) < 1 or max(dm) > limits.max_dos_k:
            return f"The DOS k-point mesh is limited to {limits.max_dos_k}x{limits.max_dos_k}x{limits.max_dos_k}."
    if bands and not 2 <= band_points <= limits.max_band_points:
        return f"The band path is limited to {limits.max_band_points} k-points in total."
    if relax and not 1 <= relax_max_steps <= limits.relax_max_steps:
        return f"Relaxation is limited to {limits.relax_max_steps} ionic steps."
    memory = estimate_memory_mb(
        atoms=atoms, ecutwfc_ry=ecutwfc_ry, band_points=band_points, bands=bands, dos=dos
    )
    if memory > limits.max_memory_mb:
        return (
            f"Estimated memory {memory / 1000:.1f} GB exceeds the hosted limit of {limits.max_memory_mb / 1000:.1f} GB; "
            "use fewer atoms, fewer band k-points or fewer stages."
        )
    est = estimate_seconds(
        atoms=atoms,
        ecutwfc_ry=ecutwfc_ry,
        scf_mesh=mesh,
        nspin=nspin,
        relax=relax,
        dos=dos,
        dos_mesh=dos_mesh,
        bands=bands,
        band_points=band_points,
    )["total"]
    if est > limits.timeout_total_s:
        return (
            f"The rough time estimate ({human_duration(est)}) is above the whole-job cap of "
            f"{human_duration(limits.timeout_total_s)}; reduce the k-mesh, the stages or the cell size."
        )
    return None
