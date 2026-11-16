# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Additive correction contracts; the historical CalculationSpecification is unchanged."""

from __future__ import annotations

import math
from typing import Annotated, Literal
from uuid import UUID

from pydantic import StringConstraints, model_validator

from .base import ContractModel, Sha256
from .scientific import CalculationSpecification, ScientificQuantity


class Dftd4Parameters(ContractModel):
    s6: float
    s8: float
    s9: float
    a1: float
    a2: float
    alp: float
    ga: float = 3.0
    gc: float = 2.0
    wf: float = 6.0
    # a2 is a length in bohr; remaining coefficients are dimensionless.
    a2_unit: Literal["bohr"] = "bohr"

    @model_validator(mode="after")
    def finite_parameters(self):
        if any(
            not math.isfinite(getattr(self, k))
            for k in ("s6", "s8", "s9", "a1", "a2", "alp", "ga", "gc", "wf")
        ):
            raise ValueError("D4 coefficients must be finite")
        return self


class Dftd4SubmitInput(ContractModel):
    source_result_id: UUID
    variant: Literal["d4.bj-eeq-atm"] = "d4.bj-eeq-atm"
    idempotency_key: Annotated[str, StringConstraints(min_length=8, max_length=200)]


class Dftd4RetryInput(ContractModel):
    # The failed attempt is the retry's durable compare-and-swap token.
    failed_attempt_id: UUID


class Dftd4SourceBinding(ContractModel):
    project_id: UUID
    result_id: UUID
    calculation_id: UUID
    calculation_input_id: UUID
    structure_version_id: UUID
    canonical_artifact_id: UUID
    canonical_sha256: Sha256
    normalized_input_sha256: Sha256
    specification_sha256: Sha256
    result_payload_sha256: Sha256
    provenance_id: UUID
    provenance_sha256: Sha256
    engine_identity_sha256: Sha256
    native_evidence_sha256: Sha256
    geometry_sha256: Sha256
    functional: Literal["b3lyp", "pbe"]
    basis: Literal["def2-svp"] = "def2-svp"
    charge: Literal[0] = 0
    multiplicity: Literal[1] = 1
    source_verification_state: str
    source_energy_hartree: float


class DispersionCorrectionSpecification(CalculationSpecification):
    """Separate additive subtype: never used to normalize an ordinary historical input."""

    correction_schema: Literal["chemdft.dftd4.specification.v1"] = "chemdft.dftd4.specification.v1"
    source: Dftd4SourceBinding
    variant: Literal["d4.bj-eeq-atm"] = "d4.bj-eeq-atm"
    variant_sha256: Sha256
    parameters: Dftd4Parameters
    parameter_table_sha256: Sha256


class DispersionCorrectedEnergyResult(ContractModel):
    payload_schema: Literal["chemdft.dispersion-corrected-energy"] = (
        "chemdft.dispersion-corrected-energy"
    )
    payload_schema_version: Literal["1.0.0"] = "1.0.0"
    source: Dftd4SourceBinding
    variant: Literal["d4.bj-eeq-atm"] = "d4.bj-eeq-atm"
    variant_sha256: Sha256
    parameters: Dftd4Parameters
    parameter_table_sha256: Sha256
    functional: Literal["b3lyp", "pbe"]
    damping: Literal["rational-bj"] = "rational-bj"
    charge_model: Literal["eeq"] = "eeq"
    three_body_model: Literal["approx-atm"] = "approx-atm"
    coordinate_unit: Literal["angstrom"] = "angstrom"
    angstrom_to_bohr: Literal[1.8897261254578281] = 1.8897261254578281
    uncorrected_dft_energy: ScientificQuantity
    d4_correction_energy: ScientificQuantity
    corrected_total_energy: ScientificQuantity
    parser_version: Literal["1.0.0"] = "1.0.0"
    validator_version: Literal["1.0.0"] = "1.0.0"

    @model_validator(mode="after")
    def energy_equation(self):
        quantities = (
            self.uncorrected_dft_energy,
            self.d4_correction_energy,
            self.corrected_total_energy,
        )
        if any(
            q.unit.code != "Eh" or q.unit.dimension != "ENERGY" or not math.isfinite(q.value)
            for q in quantities
        ):
            raise ValueError("Correction energies must be finite Hartree quantities")
        if not math.isclose(
            self.corrected_total_energy.value,
            self.uncorrected_dft_energy.value + self.d4_correction_energy.value,
            rel_tol=0,
            abs_tol=1e-10,
        ):
            raise ValueError("DFT+D4 energy equation differs")
        if (
            self.uncorrected_dft_energy.value != self.source.source_energy_hartree
            or self.functional != self.source.functional
        ):
            raise ValueError("DFT+D4 source energy/functional differs")
        return self


class NativeDispersionCorrectedEnergyResult(ContractModel):
    payload_schema: Literal["chemdft.dispersion-corrected-energy"] = (
        "chemdft.dispersion-corrected-energy"
    )
    payload_schema_version: Literal["1.1.0"] = "1.1.0"
    source: Dftd4SourceBinding
    variant: Literal["d4.bj-eeq-atm"] = "d4.bj-eeq-atm"
    variant_sha256: Sha256
    parameters: Dftd4Parameters
    parameter_table_sha256: Sha256
    functional: Literal["b3lyp", "pbe"]
    damping: Literal["rational-bj"] = "rational-bj"
    charge_model: Literal["eeq"] = "eeq"
    three_body_model: Literal["approx-atm"] = "approx-atm"
    coordinate_unit: Literal["angstrom"] = "angstrom"
    native_angstrom_to_bohr: Literal[1.8897261246204404] = 1.8897261246204404
    native_conversion_definition: Literal["mctc-lib.0.5.2.aatoau"] = "mctc-lib.0.5.2.aatoau"
    uncorrected_dft_energy: ScientificQuantity
    d4_correction_energy: ScientificQuantity
    corrected_total_energy: ScientificQuantity
    parser_version: Literal["1.0.0"] = "1.0.0"
    validator_version: Literal["1.0.0"] = "1.0.0"

    @model_validator(mode="after")
    def energy_equation(self):
        quantities = (
            self.uncorrected_dft_energy,
            self.d4_correction_energy,
            self.corrected_total_energy,
        )
        if any(
            q.unit.code != "Eh" or q.unit.dimension != "ENERGY" or not math.isfinite(q.value)
            for q in quantities
        ):
            raise ValueError("Correction energies must be finite Hartree quantities")
        if not math.isclose(
            self.corrected_total_energy.value,
            self.uncorrected_dft_energy.value + self.d4_correction_energy.value,
            rel_tol=0,
            abs_tol=1e-10,
        ):
            raise ValueError("DFT+D4 energy equation differs")
        if (
            self.uncorrected_dft_energy.value != self.source.source_energy_hartree
            or self.functional != self.source.functional
        ):
            raise ValueError("DFT+D4 source energy/functional differs")
        return self


class Dftd4Capability(ContractModel):
    engine: Literal["dftd4"] = "dftd4"
    version: Literal["4.2.0"] = "4.2.0"
    variant: Literal["d4.bj-eeq-atm"] = "d4.bj-eeq-atm"
    available: bool
    diagnostic: str | None = None
