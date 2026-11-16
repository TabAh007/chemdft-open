import json
from pathlib import Path

import pytest
from chemdft_api.contracts.qcschema import QCSchemaCompatibilityError, to_qcschema_atomic_input
from chemdft_api.contracts.scientific import (
    CalculationSpecification,
    CoordinateUnit,
    StructureVersion,
)

FIXTURES = Path(__file__).parent / "fixtures"


def test_supported_atomic_input_matches_qcschema_v2_golden() -> None:
    specification = CalculationSpecification.model_validate_json(
        (FIXTURES / "contracts/calculation-specification.json").read_text()
    )
    structure_version = StructureVersion.model_validate_json(
        (FIXTURES / "contracts/structure-version.json").read_text()
    )
    assert structure_version.coordinates is not None

    value = to_qcschema_atomic_input(specification, structure_version.coordinates)

    expected = json.loads((FIXTURES / "qcschema/atomic-input-v2-minimal.json").read_text())
    assert value.model_dump(mode="json") == expected
    assert value.schema_name == "qcschema_atomic_input"
    assert value.schema_version == 2
    assert value.molecule.schema_version == 3
    assert len(value.molecule.geometry) == len(value.molecule.symbols) * 3


def test_qcschema_adapter_requires_explicit_bohr_coordinates() -> None:
    specification = CalculationSpecification.model_validate_json(
        (FIXTURES / "contracts/calculation-specification.json").read_text()
    )
    structure_version = StructureVersion.model_validate_json(
        (FIXTURES / "contracts/structure-version.json").read_text()
    )
    assert structure_version.coordinates is not None
    angstrom = structure_version.coordinates.model_copy(update={"unit": CoordinateUnit.ANGSTROM})

    with pytest.raises(QCSchemaCompatibilityError, match="provide bohr"):
        to_qcschema_atomic_input(specification, angstrom)
