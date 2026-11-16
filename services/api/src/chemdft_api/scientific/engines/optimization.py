# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Validate engine emitted geometry evaluations before durable publication."""

from __future__ import annotations

import json
import math
from typing import Any

from ...contracts.catalog import OptimizationStep


def validate_step(
    candidate: dict[str, Any],
    atoms: list[dict[str, Any]],
    expected_index: int,
    engine: str = "pyscf",
) -> dict[str, Any]:
    step = OptimizationStep.model_validate(candidate)
    if step.index != expected_index or (
        engine == "pyscf" and step.engine_cycle != expected_index + 1
    ):
        raise ValueError("Optimizer evaluation order is invalid.")
    if engine == "pyscf" and (
        step.gradient_rms_hartree_per_bohr is None
        or step.timestamp is None
        or step.evaluation_kind != "OPTIMIZER"
    ):
        raise ValueError("PySCF evaluations require original gradient and timestamp evidence.")
    if len(step.coordinates_angstrom) != len(atoms):
        raise ValueError("Optimizer changed the atom count.")
    values = [
        step.energy_hartree,
        step.gradient_norm_hartree_per_bohr,
        *(value for row in step.coordinates_angstrom for value in row),
    ]
    if step.gradient_rms_hartree_per_bohr is not None:
        values.append(step.gradient_rms_hartree_per_bohr)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("Optimizer emitted non-finite coordinates, energy, or gradient.")
    if (
        step.gradient_rms_hartree_per_bohr is not None
        and step.gradient_rms_hartree_per_bohr > step.gradient_norm_hartree_per_bohr + 1e-12
    ):
        raise ValueError("Optimizer gradient metrics disagree.")
    return step.model_dump(mode="json")


def validate_result(
    candidate: dict[str, Any],
    atoms: list[dict[str, Any]],
    observed_steps: list[dict[str, Any]],
    specification: dict[str, Any],
    authorized_input: dict[str, Any],
    native_artifacts: dict[str, bytes] | None = None,
) -> list[dict[str, Any]]:
    if (
        candidate.get("schema") != "chemdft.worker.optimization"
        or candidate.get("task") != "GEOMETRY_OPTIMIZATION"
    ):
        raise ValueError("Worker result is not an optimization trajectory.")
    engine = specification.get("engine_preference", {}).get("engine", "pyscf")
    if engine == "xtb":
        from .xtb_optimization import parse_evidence

        raw = native_artifacts or {}
        native_execution = json.loads(raw.get("execution.json", b"{}"))
        reparsed = parse_evidence(raw, authorized_input, native_execution.get("exit_code"))
        if reparsed != candidate:
            raise ValueError("Worker result differs from reparsed native evidence.")
    elif candidate.get("engine") != "pyscf" or candidate.get("optimizer") != "geometric":
        raise ValueError("Worker result lacks supported engine provenance.")
    if (
        not candidate.get("engine_version")
        or not candidate.get("optimizer_version")
        or not isinstance(candidate.get("environment"), dict)
    ):
        raise ValueError("Worker result lacks engine environment provenance.")
    if candidate["engine_version"] != authorized_input.get("engine_version") or candidate[
        "optimizer_version"
    ] != authorized_input.get("optimizer_version"):
        raise ValueError("Engine versions differ from the authorized scientific input.")
    if candidate.get("method") != specification["method"]["identifier"].lower() or candidate.get(
        "basis"
    ) != (specification["basis"]["identifier"].lower() if specification.get("basis") else None):
        raise ValueError("Worker result differs from immutable specification.")
    if (
        candidate.get("charge") != specification["charge"]
        or candidate.get("multiplicity") != specification["multiplicity"]
    ):
        raise ValueError("Worker charge or multiplicity differs from immutable specification.")
    raw_steps = candidate.get("steps")
    if not isinstance(raw_steps, list) or not raw_steps:
        raise ValueError("Optimizer emitted no geometry evaluations.")
    steps = [validate_step(item, atoms, index, engine) for index, item in enumerate(raw_steps)]
    if steps != observed_steps:
        raise ValueError("Final trajectory differs from durably observed engine evaluations.")
    if (
        candidate.get("converged") is True
        and candidate.get("final_coordinates_angstrom") != steps[-1]["coordinates_angstrom"]
    ):
        raise ValueError("Final coordinates do not exactly trace to the last engine evaluation.")
    return steps
