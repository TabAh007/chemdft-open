# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from ...contracts.scientific import CalculationSpecification, CoordinateSystem, CoordinateUnit
from ...errors import StructureElectronicStateMismatch, UnsupportedCalculation
from ...scientific_models import StructureVersionRecord
from ..structures import atomic_number_for_symbol

BOHR_PER_ANGSTROM = 1.8897261254578281


def validate_structure_electronic_state(
    version: StructureVersionRecord, specification: CalculationSpecification,
    *, xyz_calculation_declaration: bool = False,
) -> None:
    """Bind the request to stored authority; never infer spin from electron parity."""
    if xyz_calculation_declaration:
        # Only the provenance resolver can establish this narrow imported-XYZ exception.
        if not {"charge", "multiplicity"} <= specification.model_fields_set:
            raise StructureElectronicStateMismatch(
                "CALCULATION_ELECTRONIC_STATE_REQUIRED",
                "XYZ without authoritative state requires explicit calculation charge and spin.",
            )
        validate_electronic_state_composition(
            version.representation_json["coordinates"]["atoms"],
            specification.charge, specification.multiplicity,
        )
        return
    if type(version.overall_charge) is not int or type(version.multiplicity) is not int:
        raise StructureElectronicStateMismatch(
            "STRUCTURE_ELECTRONIC_STATE_UNAVAILABLE",
            "The accepted structure must store authoritative charge and multiplicity.",
        )
    if specification.charge != version.overall_charge:
        raise StructureElectronicStateMismatch(
            "CALCULATION_CHARGE_MISMATCH",
            f"Requested charge {specification.charge} must match accepted StructureVersion "
            f"charge {version.overall_charge}.",
        )
    if specification.multiplicity != version.multiplicity:
        raise StructureElectronicStateMismatch(
            "CALCULATION_MULTIPLICITY_MISMATCH",
            f"Requested multiplicity {specification.multiplicity} must match accepted "
            f"StructureVersion multiplicity {version.multiplicity}.",
        )
    validate_electronic_state_composition(
        version.representation_json["coordinates"]["atoms"],
        specification.charge, specification.multiplicity,
    )


def validate_electronic_state_composition(
    atoms: list[dict[str, Any]], charge: int, multiplicity: int
) -> None:
    if type(charge) is not int or type(multiplicity) is not int or multiplicity < 1:
        raise StructureElectronicStateMismatch(
            "ELECTRONIC_STATE_INVALID",
            "Total charge must be an integer and multiplicity a positive integer.",
        )
    electrons = sum(int(atom["atomic_number"]) for atom in atoms) - charge
    spin = multiplicity - 1
    if electrons <= 0 or spin > electrons or (electrons - spin) % 2:
        raise StructureElectronicStateMismatch(
            "ELECTRONIC_STATE_PARITY_INVALID",
            "Electron count and multiplicity have an impossible parity relationship; "
            "parity compatibility alone does not establish chemical correctness.",
        )


def normalized_calculation_input(
    version: StructureVersionRecord,
    specification: CalculationSpecification,
    *,
    max_atoms: int,
    xyz_calculation_declaration: bool = False,
    crest_executable_sha256: str | None = None,
) -> tuple[dict[str, Any], bytes, str]:
    validate_structure_electronic_state(
        version, specification, xyz_calculation_declaration=xyz_calculation_declaration
    )
    if version.periodic_cell_json is not None:
        if specification.task_type.value != "PERIODIC_ENERGY":
            raise UnsupportedCalculation("Phase 5 PySCF energy supports molecular structures only.")
    elif specification.task_type.value == "PERIODIC_ENERGY":
        raise UnsupportedCalculation("Periodic calculations require a periodic crystal structure.")
    coordinates = version.representation_json["coordinates"]
    is_periodic = specification.task_type.value == "PERIODIC_ENERGY"
    if is_periodic:
        if coordinates["coordinate_system"] != CoordinateSystem.FRACTIONAL:
            raise UnsupportedCalculation(
                "Periodic calculation input requires fractional coordinates."
            )
    elif coordinates["coordinate_system"] != CoordinateSystem.CARTESIAN:
        raise UnsupportedCalculation("Molecular calculation input requires Cartesian coordinates.")
    atoms = coordinates["atoms"]
    if not atoms or len(atoms) > max_atoms:
        raise UnsupportedCalculation("Atom count is outside the configured execution bound.")
    unit = CoordinateUnit(coordinates["unit"]) if not is_periodic else CoordinateUnit.ANGSTROM
    lattice_vectors = None
    if is_periodic and version.periodic_cell_json:
        lattice_vectors = version.periodic_cell_json.get("lattice_vectors")
    normalized_atoms = []
    for expected_index, atom in enumerate(atoms):
        if atom["index"] != expected_index:
            raise UnsupportedCalculation("Calculation atom ordering must be contiguous and stable.")
        if is_periodic and lattice_vectors is not None:
            frac = [float(atom[axis]) for axis in ("x", "y", "z")]
            if not all(math.isfinite(value) for value in frac):
                raise UnsupportedCalculation("Calculation coordinates must be finite.")
            xyz = [
                frac[0] * lattice_vectors[0][i]
                + frac[1] * lattice_vectors[1][i]
                + frac[2] * lattice_vectors[2][i]
                for i in range(3)
            ]
        else:
            xyz = [float(atom[axis]) for axis in ("x", "y", "z")]
            if not all(math.isfinite(value) for value in xyz):
                raise UnsupportedCalculation("Calculation coordinates must be finite.")
        if atomic_number_for_symbol(atom["element"]) != int(atom["atomic_number"]):
            raise UnsupportedCalculation("Calculation atom identity is invalid.")
        if unit is CoordinateUnit.BOHR and not is_periodic:
            xyz = [value / BOHR_PER_ANGSTROM for value in xyz]
        atom_entry = {
            "index": expected_index,
            "atomic_number": int(atom["atomic_number"]),
            "element": atom["element"],
            "xyz_angstrom": xyz,
        }
        if is_periodic:
            atom_entry["fractional"] = [float(atom[axis]) for axis in ("x", "y", "z")]
        normalized_atoms.append(atom_entry)
    _validate_electron_count(normalized_atoms, specification.charge, specification.multiplicity)
    if specification.task_type.value == "GEOMETRY_OPTIMIZATION":
        from .xtb_optimization import validate_optimization_geometry

        try:
            validate_optimization_geometry(normalized_atoms)
        except ValueError as error:
            raise UnsupportedCalculation(str(error)) from error
    if specification.task_type.value == "FREQUENCY" and specification.multiplicity != 1:
        raise UnsupportedCalculation(
            "The analytic PySCF frequency path currently supports closed-shell singlets only."
        )
    if specification.task_type.value == "ORBITAL":
        if specification.optimization is not None or specification.hessian is not None:
            raise UnsupportedCalculation(
                "Molecular-orbital requests cannot include optimization or Hessian options."
            )
        if specification.property_requests or specification.engine_extensions:
            raise UnsupportedCalculation("Unsupported molecular-orbital properties or extensions.")
    if specification.task_type.value == "TDDFT":
        if specification.multiplicity != 1:
            raise UnsupportedCalculation(
                "The TDDFT excited-state path currently supports closed-shell singlets only."
            )
        if specification.optimization is not None or specification.hessian is not None:
            raise UnsupportedCalculation(
                "TDDFT excited-state requests cannot include optimization or Hessian options."
            )
        if specification.property_requests or specification.engine_extensions:
            raise UnsupportedCalculation("Unsupported TDDFT properties or extensions.")
    if specification.task_type.value == "THERMOCHEMISTRY":
        if specification.multiplicity != 1:
            raise UnsupportedCalculation(
                "Thermochemistry V1 supports closed-shell singlets only."
            )
        if (
            specification.optimization is not None
            or specification.hessian is not None
            or specification.tddft is not None
            or specification.raman is not None
            or specification.thermochemistry is None
        ):
            raise UnsupportedCalculation(
                "Thermochemistry requests carry only thermochemistry options."
            )
    document = {
        "schema": "chemdft.calculation_input",
        "schema_version": "1.0.0",
        "structure_version_id": version.id,
        "atom_ordering": "AS_LISTED",
        "coordinate_unit": "angstrom",
        "atoms": normalized_atoms,
        "charge": specification.charge,
        "multiplicity": specification.multiplicity,
        "task": specification.task_type.value,
        "method": specification.method.identifier.lower(),
        "basis": specification.basis.identifier.lower() if specification.basis else None,
        "dispersion": None,
        "solvation": None,
        "constraints": [],
        "scf": specification.scf.model_dump(mode="json") if specification.scf else None,
        "optimization": specification.optimization.model_dump(mode="json")
        if specification.optimization
        else None,
        "hessian": specification.hessian.model_dump(mode="json") if specification.hessian else None,
        "tddft": specification.tddft.model_dump(mode="json") if specification.tddft else None,
        "raman": specification.raman.model_dump(mode="json") if specification.raman else None,
        "thermochemistry": specification.thermochemistry.model_dump(mode="json")
        if specification.thermochemistry
        else None,
        "property_requests": list(specification.property_requests),
    }
    if is_periodic:
        document["periodic"] = (
            specification.periodic.model_dump(mode="json")
            if specification.periodic
            else None
        )
        document["periodic_cell"] = version.periodic_cell_json
        if (
            specification.engine_preference.engine == "qe"
            and specification.periodic is not None
            and specification.periodic.bands
            and lattice_vectors is not None
        ):
            # Server-generated k-path in this cell's reciprocal basis (never user supplied).
            from ..qe_periodic.qe_kpath import band_path_for

            document["periodic"]["band_path"] = band_path_for(
                lattice_vectors,
                [atom["element"] for atom in normalized_atoms],
                [atom["fractional"] for atom in normalized_atoms],
            )
    if specification.task_type.value == "CONFORMER_SEARCH":
        from .crest import BINARY_SHA256, CALCULATOR, VERSION, validate_input

        document.update(
            engine="crest",
            engine_version=VERSION,
            engine_executable_sha256=crest_executable_sha256 or BINARY_SHA256,
            calculator=CALCULATOR,
            conformer_search=specification.conformer_search.model_dump(mode="json"),
        )
        try:
            validate_input(document)
        except (ValueError, TypeError, KeyError) as error:
            raise UnsupportedCalculation(str(error)) from error
    if specification.engine_preference.engine == "psi4":
        from .psi4 import enrich_input

        try:
            enrich_input(document, coordinates)
        except (ValueError, KeyError, TypeError) as error:
            raise UnsupportedCalculation(str(error)) from error
    payload = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
    return document, payload, hashlib.sha256(payload).hexdigest()


def _validate_electron_count(atoms: list[dict[str, Any]], charge: int, multiplicity: int) -> None:
    electrons = sum(int(atom["atomic_number"]) for atom in atoms) - charge
    spin = multiplicity - 1
    if electrons <= 0 or spin > electrons or (electrons - spin) % 2:
        raise UnsupportedCalculation(
            "Electron count and multiplicity have an impossible parity relationship."
        )
