# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import hashlib
import io
import json
import math
from typing import Any

import numpy as np

from ...contracts.results import TddftResult

TDDFT_ADAPTER_VERSION = "1.0.0"
EV_PER_HARTREE = 27.211386245988
HC_EV_NM = 1239.8419843320025


def validate_tddft_candidate(
    candidate: dict[str, Any], input_document: dict[str, Any]
) -> tuple[dict[str, Any], bytes]:
    if (
        candidate.get("schema") != "chemdft.worker.tddft"
        or candidate.get("schema_version") != "1.0.0"
        or candidate.get("task") != "TDDFT"
        or candidate.get("engine") != "pyscf"
        or not candidate.get("engine_version")
        or candidate.get("adapter_version") != TDDFT_ADAPTER_VERSION
        or candidate.get("converged") is not True
        or candidate.get("finite") is not True
    ):
        raise ValueError("PySCF worker output is not a converged TDDFT excited-state result")

    for key in ("method", "basis", "charge", "multiplicity"):
        if candidate.get(key) != input_document.get(key):
            raise ValueError(f"PySCF TDDFT {key} differs from validated input")

    electrons = sum(atom["atomic_number"] for atom in input_document["atoms"]) - int(
        input_document["charge"]
    )
    if electrons <= 0 or electrons % 2 != 0:
        raise ValueError(
            "TDDFT restricted closed-shell reference requires positive even electron count"
        )

    nocc = electrons // 2
    if candidate.get("nocc") != nocc:
        raise ValueError("PySCF worker occupied orbital count does not match input electron count")

    scf_energy = candidate.get("total_scf_energy_hartree")
    if not isinstance(scf_energy, (int, float)) or not math.isfinite(scf_energy):
        raise ValueError("PySCF worker ground-state SCF energy must be finite")

    states = candidate.get("excited_states")
    if not isinstance(states, list) or not states:
        raise ValueError("PySCF worker returned no excited states")

    clean_states: list[dict[str, Any]] = []
    max_oscillator_strength = 0.0
    dominant_state_index = 0

    for expected_index, state in enumerate(states):
        if state.get("index") != expected_index:
            raise ValueError("Excited state indices must be contiguous starting from 0")
        if state.get("converged") is not True:
            raise ValueError(f"Excited state {expected_index + 1} did not converge")

        eh = float(state["energy_hartree"])
        if not math.isfinite(eh) or eh <= 0:
            raise ValueError(
                f"Excited state {expected_index + 1} excitation energy must be finite and positive"
            )

        ev = eh * EV_PER_HARTREE
        nm = HC_EV_NM / ev

        f = float(state["oscillator_strength"])
        if not math.isfinite(f) or f < 0:
            raise ValueError(
                f"Excited state {expected_index + 1} oscillator strength "
                "must be finite and non-negative"
            )

        if f > max_oscillator_strength:
            max_oscillator_strength = f
            dominant_state_index = expected_index

        dip = state.get("transition_dipole")
        if (
            not isinstance(dip, list)
            or len(dip) != 3
            or not all(math.isfinite(float(v)) for v in dip)
        ):
            raise ValueError(
                f"Excited state {expected_index + 1} transition dipole must be 3 finite coordinates"
            )

        raw_dominant = state.get("dominant_transitions", [])
        clean_dominant: list[dict[str, Any]] = []
        for trans in raw_dominant:
            occ_idx = int(trans["occupied_mo_index"])
            vir_idx = int(trans["virtual_mo_index"])
            x_val = float(trans["x"])
            y_val = float(trans["y"])
            mag = float(trans["magnitude"])
            if occ_idx < 0 or occ_idx >= nocc:
                raise ValueError("Dominant transition occupied index is out of bounds")
            if vir_idx < nocc:
                raise ValueError("Dominant transition virtual index must be strictly virtual")
            if not all(math.isfinite(v) for v in (x_val, y_val, mag)):
                raise ValueError("Transition response amplitudes must be finite")
            clean_dominant.append(
                {
                    "occupied_mo_index": occ_idx,
                    "virtual_mo_index": vir_idx,
                    "occupied_label": trans.get("occupied_label") or f"MO {occ_idx + 1}",
                    "virtual_label": trans.get("virtual_label") or f"MO {vir_idx + 1}",
                    "x": x_val,
                    "y": y_val,
                    "magnitude": mag,
                }
            )

        clean_states.append(
            {
                "index": expected_index,
                "state_label": f"S{expected_index + 1}",
                "energy_hartree": eh,
                "energy_ev": ev,
                "wavelength_nm": nm,
                "oscillator_strength": f,
                "oscillator_strength_gauge": "length",
                "transition_dipole": [float(v) for v in dip],
                "converged": True,
                "dominant_transitions": clean_dominant,
            }
        )

    # Serialize full X and Y response amplitudes into NPZ format
    buffer = io.BytesIO()
    amplitudes_data: dict[str, np.ndarray] = {
        "schema_version": np.asarray(["1.0.0"]),
        "engine_version": np.asarray([str(candidate["engine_version"])]),
        "state_count": np.asarray([len(clean_states)]),
    }
    if "xy_amplitudes" in candidate:
        xy = candidate["xy_amplitudes"]
        for idx, entry in enumerate(xy):
            amplitudes_data[f"state_{idx}_x"] = np.asarray(entry["x"], dtype=np.float64)
            amplitudes_data[f"state_{idx}_y"] = np.asarray(entry["y"], dtype=np.float64)
    else:
        # Minimal empty arrays if not passed
        amplitudes_data["state_0_x"] = np.zeros((nocc, 1), dtype=np.float64)
        amplitudes_data["state_0_y"] = np.zeros((nocc, 1), dtype=np.float64)

    np.savez_compressed(buffer, **amplitudes_data)
    amplitudes_bytes = buffer.getvalue()

    nvir = int(candidate.get("nvir") or 1)
    homo_idx = nocc - 1
    lumo_idx = nocc
    homo_eh = float(candidate.get("homo_energy_hartree", -0.3))
    lumo_eh = float(candidate.get("lumo_energy_hartree", 0.1))
    gap_eh = lumo_eh - homo_eh
    gap_ev = gap_eh * EV_PER_HARTREE

    validated_payload = {
        "payload_schema": "chemdft.tddft",
        "payload_schema_version": "1.0.0",
        "task_type": "TDDFT",
        "engine": "pyscf",
        "engine_version": str(candidate["engine_version"]),
        "method": str(candidate["method"]),
        "basis": str(candidate["basis"]),
        "charge": int(candidate["charge"]),
        "multiplicity": int(candidate["multiplicity"]),
        "response_method": "TDDFT",
        "reference_method": "RKS",
        "spin_channel": "singlet",
        "converged": True,
        "ground_state_energy_hartree": float(scf_energy),
        "scf_iterations": candidate.get("scf_iterations"),
        "requested_roots": len(clean_states),
        "converged_roots": len(clean_states),
        "oscillator_strength_gauge": "length",
        "nocc": nocc,
        "nvir": nvir,
        "homo_index": homo_idx,
        "lumo_index": lumo_idx,
        "homo_energy_hartree": homo_eh,
        "lumo_energy_hartree": lumo_eh,
        "homo_lumo_gap_hartree": gap_eh,
        "homo_lumo_gap_ev": gap_ev,
        "homo_lumo_gap_label": "HOMO-LUMO orbital-energy gap",
        "homo_lumo_gap_note": "Orbital-energy difference; not an excited-state calculation.",
        "excited_states": clean_states,
        "dominant_state_index": dominant_state_index,
        "max_oscillator_strength": max_oscillator_strength,
        "energy_unit": "Eh",
        "converted_energy_unit": "eV",
        "wavelength_unit": "nm",
        "producer": "local.pyscf.worker",
        "adapter_version": TDDFT_ADAPTER_VERSION,
        "schema_version": "1.0.0",
    }

    return validated_payload, amplitudes_bytes


def tddft_result_hash(analysis: TddftResult | dict[str, Any]) -> str:
    if isinstance(analysis, TddftResult):
        payload = analysis.model_dump(mode="json", exclude={"result_sha256"})
    else:
        payload = {k: v for k, v in analysis.items() if k != "result_sha256"}
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def validate_tddft_result_hash(result: TddftResult) -> None:
    expected = tddft_result_hash(result)
    if result.result_sha256 != expected:
        raise ValueError("TDDFT result hash does not match canonical payload serialization")
