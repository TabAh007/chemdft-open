"""The three first real PySCF cases (AI-7): H2, water and ethanol, each Hartree-Fock/STO-3G.

A case names a molecule whose bytes are recorded and hashed, the request a researcher would type
(the same prompts the planning tests and hosted runs use), and what a correct proposal must
contain. Nothing here is a ChemDFT calculation or a result; no energy is stored except the one
earlier accepted PySCF value for the supplied H2, which is a comparison reference only and is
never an input to a calculation (see `compare_to_reference`).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from math import dist

from nvidia_probe.capture_fixture import XYZ as SUPPLIED_H2_XYZ
from nvidia_probe.molecules import (
    PlanningCase,
    case_by_id,
    reference_molecules,
)

ENGINE = "pyscf"
EXPECTED_ENGINE_VERSION = "2.14.0"
METHOD = "hf"
BASIS = "sto-3g"

# The earlier accepted native PySCF 2.14.0 result for exactly this H2 geometry and setting
# (batch-b42-calculation-execution.spec.ts; infra/aws/ec2-pilot/ACCEPTANCE_PLAN.md).
H2_REFERENCE_ENERGY_EH = -1.1167593073964255
H2_REFERENCE_TOLERANCE_EH = 1e-10
H2_SUPPLIED_Z_ANGSTROM = 0.37

WATER_HF_STO3G_PROMPT = (
    "Calculate the Hartree-Fock single-point energy of the selected water molecule with PySCF "
    "using the STO-3G basis. Charge 0, singlet."
)


@dataclass(frozen=True, slots=True)
class ExecutionCase:
    id: str
    label: str
    molecule: str  # "h2" supplied, or a reference molecule id
    filename: str
    format: str  # XYZ | SDF
    media_type: str
    structure_name: str
    prompt: str
    geometry_basis: str
    recorded_sha256: str
    comparable_reference: bool = False

    @property
    def expect(self) -> dict:
        return {
            "task": "ENERGY",
            "engine": ENGINE,
            "method": METHOD,
            "basis": BASIS,
            "charge": 0,
            "multiplicity": 1,
        }

    def data(self) -> bytes:
        """The structure bytes, refused if they differ from the recorded hash."""
        content = _source_bytes(self)
        if hashlib.sha256(content).hexdigest() != self.recorded_sha256:
            raise ValueError(f"EXECUTION_CASE_HASH_MISMATCH: {self.id}")
        return content


def _source_bytes(case: ExecutionCase) -> bytes:
    if case.molecule == "h2":
        return SUPPLIED_H2_XYZ
    return reference_molecules()[case.molecule].data()


def _planning(case_id: str) -> PlanningCase:
    return case_by_id(case_id)


def _build() -> tuple[ExecutionCase, ...]:
    molecules = reference_molecules()
    water, ethanol = molecules["h2o"], molecules["ethanol"]
    return (
        ExecutionCase(
            id="A-h2-hf-sto3g",
            label="Case A · H2 · HF/STO-3G (supplied geometry)",
            molecule="h2",
            filename="h2.xyz",
            format="XYZ",
            media_type="chemical/x-xyz",
            structure_name="H2 · supplied geometry",
            prompt=_planning("h2-hf-sto3g").prompt,
            geometry_basis=(
                "Supplied H2 reference, H at (0, 0, -0.37) and (0, 0, +0.37) Angstrom, charge 0, "
                "multiplicity 1: the geometry of the earlier accepted PySCF 2.14.0 run."
            ),
            recorded_sha256=hashlib.sha256(SUPPLIED_H2_XYZ).hexdigest(),
            comparable_reference=True,
        ),
        ExecutionCase(
            id="B-h2o-hf-sto3g",
            label="Case B · water · HF/STO-3G (PubChem CID 962 conformer)",
            molecule="h2o",
            filename=water.file,
            format=water.format,
            media_type=water.media_type,
            structure_name=water.structure_name,
            prompt=WATER_HF_STO3G_PROMPT,
            geometry_basis=(
                "PubChem CID 962 computed 3D conformer, stored unmodified "
                f"(sha256 {water.sha256[:12]}…); not an experimental or optimized geometry."
            ),
            recorded_sha256=water.sha256,
        ),
        ExecutionCase(
            id="C-ethanol-hf-sto3g",
            label="Case C · ethanol · HF/STO-3G (PubChem CID 702 conformer)",
            molecule="ethanol",
            filename=ethanol.file,
            format=ethanol.format,
            media_type=ethanol.media_type,
            structure_name=ethanol.structure_name,
            prompt=_planning("ethanol-hf-sto3g").prompt,
            geometry_basis=(
                "PubChem CID 702 computed 3D conformer, stored unmodified "
                f"(sha256 {ethanol.sha256[:12]}…); one conformer, not an optimized geometry."
            ),
            recorded_sha256=ethanol.sha256,
        ),
    )


EXECUTION_CASES: tuple[ExecutionCase, ...] = _build()


def execution_case(case_id: str) -> ExecutionCase:
    for case in EXECUTION_CASES:
        if case.id == case_id:
            return case
    raise KeyError(case_id)


def compare_to_reference(
    case: ExecutionCase,
    *,
    positions: list[tuple[str, float, float, float]],
    charge: int,
    multiplicity: int,
    engine: str,
    engine_version: str,
    method: str,
    basis: str,
    energy_eh: float,
) -> dict:
    """Compare a REAL engine energy with the earlier accepted H2 value, only if comparable.

    The reference applies to one geometry, one method/basis, one electronic state and one
    PySCF version. If any differs the verdict is NOT_COMPARABLE with the reasons; the reference is
    never used to decide whether a calculation is accepted.
    """
    if not case.comparable_reference:
        return {"verdict": "NO_REFERENCE", "reasons": ["no earlier accepted value for this case"]}
    reasons = []
    atoms = sorted(positions, key=lambda row: row[3])
    expected = [("H", 0.0, 0.0, -H2_SUPPLIED_Z_ANGSTROM), ("H", 0.0, 0.0, H2_SUPPLIED_Z_ANGSTROM)]
    if len(atoms) != 2 or any(
        a[0] != e[0] or dist(a[1:], e[1:]) > 1e-9 for a, e in zip(atoms, expected, strict=False)
    ):
        reasons.append("geometry differs from the supplied H at (0, 0, ±0.37) Angstrom")
    for name, got, want in (
        ("charge", charge, 0),
        ("multiplicity", multiplicity, 1),
        ("engine", engine, ENGINE),
        ("engine version", engine_version, EXPECTED_ENGINE_VERSION),
        ("method", method.lower(), METHOD),
        ("basis", basis.lower(), BASIS),
    ):
        if got != want:
            reasons.append(f"{name} {got!r} differs from the reference {want!r}")
    if reasons:
        return {"verdict": "NOT_COMPARABLE", "reasons": reasons}
    difference = energy_eh - H2_REFERENCE_ENERGY_EH
    return {
        "verdict": "AGREES" if abs(difference) <= H2_REFERENCE_TOLERANCE_EH else "DIFFERS",
        "difference_eh": difference,
        "tolerance_eh": H2_REFERENCE_TOLERANCE_EH,
        "reasons": [],
    }
