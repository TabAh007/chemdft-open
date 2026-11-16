# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator

from .base import ContractModel, JsonScalar
from .scientific import CalculationSpecification, CalculationTaskType, CoordinateSet, CoordinateUnit


class QCSchemaProvenanceV2(ContractModel):
    creator: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    version: Annotated[str, StringConstraints(max_length=64)] = ""
    routine: Annotated[str, StringConstraints(max_length=160)] = ""


class QCSchemaMoleculeV3(ContractModel):
    schema_name: Literal["qcschema_molecule"] = "qcschema_molecule"
    schema_version: Literal[3] = 3
    validated: Literal[False] = False
    symbols: tuple[str, ...] = Field(min_length=1, max_length=10_000)
    geometry: tuple[float, ...] = Field(min_length=3, max_length=30_000)
    molecular_charge: float
    molecular_multiplicity: int = Field(ge=1)
    connectivity: tuple[tuple[int, int, float], ...] | None = None

    @model_validator(mode="after")
    def matching_geometry_shape(self) -> QCSchemaMoleculeV3:
        if len(self.geometry) != len(self.symbols) * 3:
            raise ValueError("QCSchema geometry must be a flat 3N array")
        return self


class QCSchemaModelV2(ContractModel):
    method: str
    basis: str | None = None


class QCSchemaKeywordV2(ContractModel):
    key: Annotated[str, StringConstraints(pattern=r"^[A-Za-z][A-Za-z0-9_.-]{0,63}$")]
    value: JsonScalar


class QCSchemaAtomicSpecificationV2(ContractModel):
    schema_name: Literal["qcschema_atomic_specification"] = "qcschema_atomic_specification"
    driver: Literal["energy", "gradient", "hessian", "properties"]
    model: QCSchemaModelV2
    program: str = ""
    keywords: tuple[QCSchemaKeywordV2, ...] = Field(default=(), max_length=128)


class QCSchemaAtomicInputV2(ContractModel):
    schema_name: Literal["qcschema_atomic_input"] = "qcschema_atomic_input"
    schema_version: Literal[2] = 2
    molecule: QCSchemaMoleculeV3
    specification: QCSchemaAtomicSpecificationV2
    provenance: QCSchemaProvenanceV2


class QCSchemaCompatibilityError(ValueError):
    pass


def to_qcschema_atomic_input(
    specification: CalculationSpecification,
    coordinates: CoordinateSet,
) -> QCSchemaAtomicInputV2:
    """Map the supported atomic subset without importing an execution engine."""
    drivers = {
        CalculationTaskType.ENERGY: "energy",
        CalculationTaskType.FREQUENCY: "hessian",
    }
    driver = drivers.get(specification.task_type)
    if driver is None:
        raise QCSchemaCompatibilityError(
            f"{specification.task_type.value} is not an atomic QCSchema driver"
        )
    if coordinates.coordinate_system.value != "CARTESIAN":
        raise QCSchemaCompatibilityError("QCSchema atomic geometry requires Cartesian coordinates")
    if coordinates.unit is not CoordinateUnit.BOHR:
        raise QCSchemaCompatibilityError(
            "Coordinate conversion is intentionally outside the Phase 2 adapter; provide bohr"
        )

    return QCSchemaAtomicInputV2(
        molecule=QCSchemaMoleculeV3(
            symbols=tuple(atom.element for atom in coordinates.atoms),
            geometry=tuple(
                value for atom in coordinates.atoms for value in (atom.x, atom.y, atom.z)
            ),
            molecular_charge=float(specification.charge),
            molecular_multiplicity=specification.multiplicity,
            connectivity=(
                tuple(
                    (bond.atom_index_a, bond.atom_index_b, bond.order)
                    for bond in coordinates.bonds
                    if bond.order is not None
                )
                or None
            ),
        ),
        specification=QCSchemaAtomicSpecificationV2(
            driver=driver,
            model=QCSchemaModelV2(
                method=specification.method.identifier,
                basis=specification.basis.identifier if specification.basis else None,
            ),
        ),
        provenance=QCSchemaProvenanceV2(
            creator="ChemDFT",
            version="1.0.0",
            routine="chemdft.qcschema.v2.adapter",
        ),
    )
