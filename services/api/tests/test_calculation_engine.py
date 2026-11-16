from __future__ import annotations

import json
import math
from uuid import uuid4

import pytest
from chemdft_api.calculation_actions import _validate_energy_candidate
from chemdft_api.contracts.base import EntityReference
from chemdft_api.contracts.catalog import CalculationSubmitInput
from chemdft_api.contracts.scientific import (
    BasisSetReference,
    CalculationLifecycle,
    CalculationSpecification,
    CalculationTaskType,
    EnginePreference,
    ScientificMethodReference,
)
from chemdft_api.errors import InvalidLifecycleTransition, UnsupportedCalculation
from chemdft_api.scientific.engines.lifecycle import ALLOWED_TRANSITIONS, require_transition
from chemdft_api.scientific.engines.normalization import normalized_calculation_input
from chemdft_api.scientific_models import StructureVersionRecord
from pydantic import ValidationError


def _specification(*, charge: int = 0, multiplicity: int = 1) -> CalculationSpecification:
    return CalculationSpecification(
        task_type=CalculationTaskType.ENERGY,
        method=ScientificMethodReference(
            identifier="hf", display_name="Hartree-Fock", registry="chemdft.method"
        ),
        basis=BasisSetReference(
            identifier="sto-3g", display_name="STO-3G", registry="chemdft.basis"
        ),
        charge=charge,
        multiplicity=multiplicity,
        engine_preference=EnginePreference(engine="pyscf"),
    )


def _h2_version() -> StructureVersionRecord:
    return StructureVersionRecord(
        id=str(uuid4()),
        project_id=str(uuid4()),
        structure_id=str(uuid4()),
        revision=1,
        origin="IMPORTED",
        canonical_artifact_id=str(uuid4()),
        source_artifact_id=str(uuid4()),
        coordinate_system="CARTESIAN",
        coordinate_unit="angstrom",
        atom_count=2,
        bond_count=1,
        overall_charge=0,
        multiplicity=1,
        representation_json={
            "coordinates": {
                "coordinate_system": "CARTESIAN",
                "unit": "angstrom",
                "atoms": [
                    {"index": 0, "atomic_number": 1, "element": "H", "x": 0, "y": 0, "z": -0.37},
                    {"index": 1, "atomic_number": 1, "element": "H", "x": 0, "y": 0, "z": 0.37},
                ],
            }
        },
        diagnostics_json=[],
        provenance_record_id=str(uuid4()),
        idempotency_key="test-h2-input",
        created_by=str(uuid4()),
    )


def test_lifecycle_allows_only_explicit_forward_transitions() -> None:
    for source, allowed in ALLOWED_TRANSITIONS.items():
        for target in CalculationLifecycle:
            if target in allowed:
                require_transition(source, target)
            else:
                with pytest.raises(InvalidLifecycleTransition):
                    require_transition(source, target)


def test_normalized_input_is_stable_and_preserves_atom_order() -> None:
    document, payload, digest = normalized_calculation_input(
        _h2_version(), _specification(), max_atoms=10
    )
    assert [atom["index"] for atom in document["atoms"]] == [0, 1]
    assert document["atoms"][1]["xyz_angstrom"] == [0.0, 0.0, 0.37]
    assert len(digest) == 64
    assert json.loads(payload)["structure_version_id"] == document["structure_version_id"]


def test_impossible_charge_multiplicity_is_rejected() -> None:
    version = _h2_version()
    version.multiplicity = 2
    with pytest.raises(UnsupportedCalculation, match="parity"):
        normalized_calculation_input(version, _specification(multiplicity=2), max_atoms=10)


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_energy_validator_rejects_non_finite_values(value: float) -> None:
    with pytest.raises((ValueError, ValidationError)):
        _validate_energy_candidate(
            {
                "schema": "chemdft.worker.energy",
                "task": "ENERGY",
                "converged": True,
                "finite": True,
                "total_energy_hartree": value,
                "method": "hf",
                "basis": "sto-3g",
                "scf_iterations": 2,
            }
        )


def test_nonconverged_candidate_is_rejected() -> None:
    with pytest.raises(ValueError, match="Nonconverged"):
        _validate_energy_candidate(
            {
                "schema": "chemdft.worker.energy",
                "task": "ENERGY",
                "converged": False,
                "finite": True,
                "total_energy_hartree": -1.0,
                "method": "hf",
                "basis": "sto-3g",
            }
        )


def test_public_submit_cannot_forge_lifecycle_or_execution_identity() -> None:
    project_id = uuid4()
    payload = {
        "structure_version": {
            "project_id": str(project_id),
            "entity_type": "structure.version",
            "entity_id": str(uuid4()),
        },
        "specification": _specification().model_dump(mode="json"),
        "idempotency_key": "public-request-1",
        "state": "SUCCEEDED",
        "engine_identity": {"name": "PySCF", "version": "9.9.9"},
    }
    with pytest.raises(ValidationError):
        CalculationSubmitInput.model_validate(payload)

    valid = CalculationSubmitInput(
        structure_version=EntityReference.model_validate(payload["structure_version"]),
        specification=_specification(),
        idempotency_key="public-request-1",
    )
    assert not hasattr(valid, "state")
    assert not hasattr(valid, "engine_identity")
