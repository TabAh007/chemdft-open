# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import hashlib
import io
import json
import math
import zipfile
from typing import Any

import numpy as np

from ...contracts.results import MolecularOrbitalAnalysis

EV_PER_HARTREE = 27.211386245988
ORBITAL_ADAPTER_VERSION = "1.0.0"


def validate_orbital_candidate(
    candidate: dict[str, Any], input_document: dict[str, Any]
) -> tuple[dict[str, Any], bytes]:
    if (
        candidate.get("schema") != "chemdft.worker.molecular-orbitals"
        or candidate.get("schema_version") != "1.0.0"
        or candidate.get("task") != "ORBITAL"
        or candidate.get("engine") != "pyscf"
        or not candidate.get("engine_version")
        or candidate.get("adapter_version") != ORBITAL_ADAPTER_VERSION
        or candidate.get("converged") is not True
        or candidate.get("finite") is not True
    ):
        raise ValueError("PySCF worker output is not a converged molecular-orbital result")
    for key in ("method", "basis", "charge", "multiplicity"):
        if candidate.get(key) != input_document.get(key):
            raise ValueError(f"PySCF molecular-orbital {key} differs from validated input")
    electrons = sum(atom["atomic_number"] for atom in input_document["atoms"]) - int(
        input_document["charge"]
    )
    spin = int(input_document["multiplicity"]) - 1
    alpha_expected, beta_expected = (electrons + spin) // 2, (electrons - spin) // 2
    if (
        candidate.get("electron_count") != electrons
        or candidate.get("alpha_electron_count") != alpha_expected
        or candidate.get("beta_electron_count") != beta_expected
    ):
        raise ValueError("PySCF molecular-orbital electron counts disagree with input geometry")
    channels = candidate.get("orbital_channels")
    expected_names = ["restricted"] if spin == 0 else ["alpha", "beta"]
    if (
        not isinstance(channels, list)
        or [entry.get("spin_channel") for entry in channels] != expected_names
    ):
        raise ValueError("PySCF molecular-orbital spin channels are malformed")
    basis_count = candidate.get("basis_function_count")
    if not isinstance(basis_count, int) or basis_count < 1:
        raise ValueError("PySCF returned an invalid basis-function count")
    clean_channels = []
    table: list[dict[str, Any]] = []
    arrays: dict[str, np.ndarray] = {
        "schema_version": np.asarray(["1.0.0"]),
        "pyscf_version": np.asarray([str(candidate["engine_version"])]),
        "method": np.asarray([str(candidate["method"])]),
        "basis": np.asarray([str(candidate["basis"])]),
        "charge": np.asarray([int(candidate["charge"])], dtype=np.int32),
        "multiplicity": np.asarray([int(candidate["multiplicity"])], dtype=np.int32),
        "input_atom_elements": np.asarray([atom["element"] for atom in input_document["atoms"]]),
        "input_coordinates_angstrom": np.asarray(
            [atom["xyz_angstrom"] for atom in input_document["atoms"]], dtype=np.float64
        ),
    }
    for channel in channels:
        name = channel["spin_channel"]
        coefficients = np.asarray(channel.get("coefficients"), dtype=np.float64)
        energies = np.asarray(channel.get("energies_hartree"), dtype=np.float64)
        occupations = np.asarray(channel.get("occupations"), dtype=np.float64)
        if (
            coefficients.ndim != 2
            or coefficients.shape[0] != basis_count
            or energies.ndim != 1
            or occupations.shape != energies.shape
            or coefficients.shape[1] != energies.size
            or energies.size == 0
            or not np.isfinite(coefficients).all()
            or not np.isfinite(energies).all()
            or not np.isfinite(occupations).all()
        ):
            raise ValueError("PySCF molecular-orbital coefficients or metadata are malformed")
        max_occupation = 2.0 if name == "restricted" else 1.0
        if np.any(occupations < 0) or np.any(occupations > max_occupation):
            raise ValueError("Molecular-orbital occupations exceed the spin-channel capacity")
        expected_occupations = (
            alpha_expected + beta_expected
            if name == "restricted"
            else (alpha_expected if name == "alpha" else beta_expected)
        )
        if not math.isclose(float(occupations.sum()), expected_occupations, abs_tol=1e-8):
            raise ValueError("Molecular-orbital occupations do not match electron count")
        occupied = np.flatnonzero(occupations > 1e-8)
        virtual = np.flatnonzero(occupations <= 1e-8)
        if occupied.size == 0 or virtual.size == 0:
            raise ValueError("Molecular-orbital result has no occupied or virtual frontier")
        homo_index = int(occupied.max())
        lumo_candidates = virtual[virtual > homo_index]
        if lumo_candidates.size == 0:
            raise ValueError("Molecular-orbital result has no unoccupied orbital after HOMO")
        lumo_index = int(lumo_candidates.min())
        homo_energy = float(energies[homo_index])
        lumo_energy = float(energies[lumo_index])
        gap = lumo_energy - homo_energy
        if not math.isfinite(gap) or gap <= 0:
            raise ValueError("Calculated HOMO-LUMO orbital-energy gap must be positive")
        for index, (energy, occupation) in enumerate(zip(energies, occupations, strict=True)):
            table.append(
                {
                    "index": index,
                    "spin_channel": name,
                    "occupation": float(occupation),
                    "energy_hartree": float(energy),
                    "energy_ev": float(energy * EV_PER_HARTREE),
                }
            )
        clean_channels.append(
            {
                "spin_channel": name,
                "homo_index": homo_index,
                "homo_energy_hartree": homo_energy,
                "homo_energy_ev": homo_energy * EV_PER_HARTREE,
                "lumo_index": lumo_index,
                "lumo_energy_hartree": lumo_energy,
                "lumo_energy_ev": lumo_energy * EV_PER_HARTREE,
                "gap_hartree": gap,
                "gap_ev": gap * EV_PER_HARTREE,
            }
        )
        arrays[f"coefficients_{name}"] = coefficients
        arrays[f"energies_hartree_{name}"] = energies
        arrays[f"occupations_{name}"] = occupations
        arrays[f"spin_channel_{name}"] = np.asarray([name])
    if len(table) != int(candidate.get("molecular_orbital_count", -1)):
        raise ValueError("Molecular-orbital count differs from returned arrays")
    coefficient_artifact = deterministic_npz(arrays)
    return {
        "total_energy_hartree": float(candidate["total_energy_hartree"]),
        "electron_count": electrons,
        "alpha_electron_count": alpha_expected,
        "beta_electron_count": beta_expected,
        "basis_function_count": basis_count,
        "molecular_orbital_count": len(table),
        "orbitals": table,
        "frontier_by_spin": clean_channels,
        "coefficient_artifact_sha256": hashlib.sha256(coefficient_artifact).hexdigest(),
    }, coefficient_artifact


def deterministic_npz(arrays: dict[str, np.ndarray]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(
        buffer, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        for name in sorted(arrays):
            array_buffer = io.BytesIO()
            np.lib.format.write_array(array_buffer, np.asarray(arrays[name]), allow_pickle=False)
            info = zipfile.ZipInfo(f"{name}.npy", date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(
                info, array_buffer.getvalue(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9
            )
    return buffer.getvalue()


def molecular_orbital_result_hash(values: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(values, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def validate_molecular_orbital_result_hash(result: MolecularOrbitalAnalysis) -> None:
    values = result.model_dump(mode="json", exclude={"result_sha256"})
    if molecular_orbital_result_hash(values) != result.result_sha256:
        raise ValueError("Molecular-orbital result hash mismatch")
