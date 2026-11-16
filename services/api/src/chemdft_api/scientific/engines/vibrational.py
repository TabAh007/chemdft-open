# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import math


def expected_mode_count(coordinates: list[list[float]]) -> int:
    atom_count = len(coordinates)
    if atom_count < 2:
        raise ValueError("Frequency analysis requires at least two atoms")
    origin = coordinates[0]
    axis = next(
        (
            tuple(point[i] - origin[i] for i in range(3))
            for point in coordinates[1:]
            if math.dist(point, origin) > 1e-8
        ),
        None,
    )
    if axis is None:
        raise ValueError("Frequency analysis requires distinct atomic coordinates")
    axis_norm = math.sqrt(sum(value * value for value in axis))
    linear = True
    for point in coordinates[1:]:
        vector = tuple(point[i] - origin[i] for i in range(3))
        cross = (
            axis[1] * vector[2] - axis[2] * vector[1],
            axis[2] * vector[0] - axis[0] * vector[2],
            axis[0] * vector[1] - axis[1] * vector[0],
        )
        if math.sqrt(sum(value * value for value in cross)) / axis_norm > 1e-6:
            linear = False
            break
    return 3 * atom_count - (5 if linear else 6)


def validate_frequency_candidate(candidate: dict, input_document: dict) -> dict:
    if (
        candidate.get("schema") != "chemdft.worker.vibrational-analysis"
        or candidate.get("task") != "FREQUENCY"
    ):
        raise ValueError("Worker result type does not match FREQUENCY")
    if candidate.get("converged") is not True or candidate.get("finite") is not True:
        raise ValueError("Nonconverged or non-finite Hessian results cannot be published")
    atoms = input_document["atoms"]
    coordinates = [atom["xyz_angstrom"] for atom in atoms]
    expected = expected_mode_count(coordinates)
    count = int(candidate.get("mode_count", -1))
    hessian = candidate.get("hessian_hartree_per_bohr2")
    frequencies = candidate.get("frequencies_cm1")
    modes = candidate.get("normal_modes_amu_minus_half")
    reduced_masses = candidate.get("reduced_masses_amu")
    atom_count = len(atoms)
    if count != expected or not isinstance(frequencies, list) or len(frequencies) != expected:
        raise ValueError("Engine mode dimensionality differs from the molecular degrees of freedom")
    if not isinstance(hessian, list) or len(hessian) != atom_count:
        raise ValueError("Hessian atom dimension is invalid")
    for row in hessian:
        if not isinstance(row, list) or len(row) != atom_count:
            raise ValueError("Hessian atom dimension is invalid")
        for atom_block in row:
            if (
                not isinstance(atom_block, list)
                or len(atom_block) != 3
                or any(not isinstance(axis, list) or len(axis) != 3 for axis in atom_block)
            ):
                raise ValueError("Hessian Cartesian dimensions are invalid")
            if any(not math.isfinite(float(value)) for axis in atom_block for value in axis):
                raise ValueError("Hessian contains a non-finite value")
    # PySCF's analytic Hessian is exactly symmetric for HF but not for DFT: measured on HNO3 at the
    # B3LYP/def2-SVP minimum the asymmetry is 1e-4 to 6e-4 Eh/bohr^2 (largest element 1.05) and does not
    # shrink with a finer grid (docs/implementation/PAPER_TEST_FIXES_0_0_11.md). DFT therefore gets a
    # looser, explicit limit; HF keeps 1e-4. A larger asymmetry is still refused, with the measured value.
    method = str(input_document.get("method", "")).lower()
    symmetry_limit = 1e-4 if method == "hf" else 1e-3
    worst = 0.0
    for i in range(atom_count):
        for j in range(atom_count):
            for a in range(3):
                for b in range(3):
                    worst = max(worst, abs(float(hessian[i][j][a][b]) - float(hessian[j][i][b][a])))
    if worst > symmetry_limit:
        raise ValueError(
            f"Hessian is not symmetric: the largest asymmetry is {worst:.1e} Eh/bohr^2, above the "
            f"{symmetry_limit:.0e} limit for {method.upper() or 'this method'}. The SCF or the "
            "geometry is probably not converged enough for a Hessian."
        )
    if not isinstance(modes, list) or len(modes) != expected:
        raise ValueError("Normal mode count differs from the Hessian result")
    if not isinstance(reduced_masses, list) or len(reduced_masses) != expected:
        raise ValueError("Reduced mass count differs from the Hessian result")
    for frequency, mode, mass in zip(frequencies, modes, reduced_masses, strict=True):
        if (
            not math.isfinite(float(frequency))
            or not math.isfinite(float(mass))
            or float(mass) <= 0
        ):
            raise ValueError("Frequencies and reduced masses must be finite and valid")
        if (
            not isinstance(mode, list)
            or len(mode) != atom_count
            or any(
                not isinstance(vector, list)
                or len(vector) != 3
                or any(not math.isfinite(float(value)) for value in vector)
                for vector in mode
            )
        ):
            raise ValueError("Normal mode vectors have invalid dimensions or values")
    ir_intensities = candidate.get("ir_intensities_km_mol")
    if ir_intensities is not None:
        if not isinstance(ir_intensities, list) or len(ir_intensities) != expected:
            raise ValueError("IR intensity count differs from the Hessian result")
        for intensity in ir_intensities:
            if not math.isfinite(float(intensity)) or float(intensity) < 0:
                raise ValueError("IR intensities must be finite and non-negative")
    raman_activities = candidate.get("raman_activities_angstrom4_per_amu")
    if raman_activities is not None:
        if not isinstance(raman_activities, list) or len(raman_activities) != expected:
            raise ValueError("Raman activity count differs from the Hessian result")
        for activity in raman_activities:
            if not math.isfinite(float(activity)) or float(activity) < 0:
                raise ValueError("Raman activities must be finite and non-negative")
    depolarization_ratios = candidate.get("depolarization_ratios")
    if depolarization_ratios is not None:
        if not isinstance(depolarization_ratios, list) or len(depolarization_ratios) != expected:
            raise ValueError("Depolarization ratio count differs from the Hessian result")
        for ratio in depolarization_ratios:
            if not math.isfinite(float(ratio)) or float(ratio) < -1e-4 or float(ratio) > 0.751:
                raise ValueError(f"Depolarization ratio out of physical range [0, 0.75]: {ratio}")
    max_antisym = candidate.get("max_abs_antisymmetry")
    if max_antisym is not None:
        tol = candidate.get("polarizability_antisymmetry_tolerance", 1e-4)
        if not math.isfinite(float(max_antisym)) or float(max_antisym) > float(tol):
            raise ValueError(
                f"Polarizability tensor antisymmetry residual ({max_antisym}) exceeds tolerance ({tol})"
            )
    if (
        candidate.get("method") != input_document["method"]
        or candidate.get("basis") != input_document["basis"]
    ):
        raise ValueError("Engine method or basis differs from immutable input")
    if (
        candidate.get("charge") != input_document["charge"]
        or candidate.get("multiplicity") != input_document["multiplicity"]
    ):
        raise ValueError("Engine charge or multiplicity differs from immutable input")
    if candidate.get("engine") != "pyscf" or not candidate.get("engine_version"):
        raise ValueError("PySCF engine identity is missing")
    if (
        candidate.get("mode_ordering") != "ascending_eigenvalue"
        or candidate.get("vector_convention") != "pyscf_thermo_norm_mode"
    ):
        raise ValueError("PySCF mode ordering or vector convention is unsupported")
    actual_coordinates = candidate.get("equilibrium_coordinates_angstrom")
    if actual_coordinates != coordinates:
        raise ValueError("Engine equilibrium coordinates differ from authoritative input ordering")
    return {"expected_mode_count": expected, "coordinates": coordinates, "hessian": hessian}
