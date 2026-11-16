"""Deterministic comparison of two firewall-published energy results."""

import math
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .errors import ScientificReferenceNotFound, ScientificValidationFailed
from .scientific_models import CalculationInputRecord, CalculationResultRecord


def compare_energy_results(
    session: Session, project_id: str, result_a_id: str, result_b_id: str
) -> dict[str, Any]:
    rows = [
        session.scalar(
            select(CalculationResultRecord).where(
                CalculationResultRecord.id == result_id,
                CalculationResultRecord.project_id == project_id,
            )
        )
        for result_id in (result_a_id, result_b_id)
    ]
    if any(row is None for row in rows):
        raise ScientificReferenceNotFound("Both calculation results must belong to this project.")
    from .effective_result_state import require_current_result
    for row in rows:
        require_current_result(session, row)
    first, second = rows
    assert first is not None and second is not None
    inputs = [
        session.scalar(
            select(CalculationInputRecord).where(
                CalculationInputRecord.id == row.calculation_input_id,
                CalculationInputRecord.project_id == project_id,
            )
        )
        for row in (first, second)
    ]
    if any(item is None for item in inputs):
        raise ScientificReferenceNotFound("Calculation specifications must belong to this project.")
    if first.result_type.upper() not in {
        "ENERGY",
        "CHEMDFT.ENERGY",
    } or second.result_type.upper() not in {"ENERGY", "CHEMDFT.ENERGY"}:
        raise ScientificValidationFailed("Energy comparison requires ENERGY results.")

    def value(row: CalculationResultRecord) -> float:
        payload = row.payload_json or {}
        energy = None
        if isinstance(payload, dict):
            energy = payload.get("energy") or payload.get("total_energy")
        raw = energy.get("value") if isinstance(energy, dict) else None
        try:
            result = float(raw)
        except (TypeError, ValueError) as error:
            raise ScientificValidationFailed("Energy result is not numeric.") from error
        if not math.isfinite(result):
            raise ScientificValidationFailed("Energy result must be finite.")
        unit_value = energy.get("unit", "hartree") if isinstance(energy, dict) else "hartree"
        if isinstance(unit_value, dict):
            unit_value = unit_value.get("code") or unit_value.get("standard") or "hartree"
        unit = str(unit_value).lower()
        if unit not in {"hartree", "ha", "eh"}:
            raise ScientificValidationFailed("Energy results must use compatible Hartree units.")
        return result

    a = value(first)
    b = value(second)
    return {
        "result_a_id": first.id,
        "result_b_id": second.id,
        "value_a_hartree": a,
        "value_b_hartree": b,
        "difference_hartree": b - a,
        "result_a_specification": inputs[0].specification_json if inputs[0] else {},
        "result_b_specification": inputs[1].specification_json if inputs[1] else {},
        "result_a_producer": first.producer_software_json,
        "result_b_producer": second.producer_software_json,
    }
