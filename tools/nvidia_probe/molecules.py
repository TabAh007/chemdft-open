"""Real molecular inputs and repeatable planning cases for AI Scientist acceptance (AI-6).

Three genuine structures with traceable sources (see molecules/manifest.json): the hydrogen molecule
built once from NIST's cited equilibrium bond length, and PubChem's own 3D records for water
(CID 962) and ethanol (CID 702), stored unmodified. Nothing here is a ChemDFT calculation or a
result, and no geometry, energy or spectrum is invented.

Each molecule carries planning cases: a researcher's request together with what a correct proposal
must contain, or, for a request the server cannot meet, the fact that no proposal may be made. The
same cases drive the offline tests, the browser acceptance and any separately authorized hosted
run, so the three can be compared.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Literal

DIRECTORY = Path(__file__).resolve().parent / "molecules"
MANIFEST_SCHEMA = "chemdft.reference-molecules.v1"
# A flow authorization that names these cases carries this fixture id, not the supplied-H2 one.
REFERENCE_FIXTURE_ID = "chemdft-reference-molecules-v1"


@dataclass(frozen=True, slots=True)
class ReferenceMolecule:
    id: str
    title: str
    formula: str
    atoms: int
    charge: int
    multiplicity: int
    inchikey: str
    file: str
    format: str
    sha256: str
    structure_name: str
    source: dict
    reuse_basis: str
    expected: dict = field(default_factory=dict)

    @property
    def media_type(self) -> str:
        return "chemical/x-xyz" if self.format == "XYZ" else "chemical/x-mdl-sdfile"

    @property
    def path(self) -> Path:
        return DIRECTORY / self.file

    def data(self) -> bytes:
        """The source bytes, refused if they differ from the recorded hash."""
        content = self.path.read_bytes()
        if hashlib.sha256(content).hexdigest() != self.sha256:
            raise ValueError(f"REFERENCE_MOLECULE_HASH_MISMATCH: {self.id}")
        return content


@cache
def reference_molecules() -> dict[str, ReferenceMolecule]:
    manifest = json.loads((DIRECTORY / "manifest.json").read_text())
    if manifest.get("schema") != MANIFEST_SCHEMA:
        raise ValueError("REFERENCE_MANIFEST_SCHEMA_MISMATCH")
    keys = set(ReferenceMolecule.__dataclass_fields__)
    return {
        row["id"]: ReferenceMolecule(**{k: v for k, v in row.items() if k in keys})
        for row in manifest["molecules"]
    }


@dataclass(frozen=True, slots=True)
class PlanningCase:
    id: str
    molecule: str
    prompt: str
    # PROPOSE: a proposal with exactly `expect` must reach approval.
    # EXPLAIN_UNAVAILABLE / EXPLAIN_OUT_OF_SCOPE: no proposal may reach approval; the model must
    # explain what cannot be run (the request is never silently replaced).
    kind: Literal["PROPOSE", "EXPLAIN_UNAVAILABLE", "EXPLAIN_OUT_OF_SCOPE"]
    expect: dict = field(default_factory=dict)


def _expect(method: str, basis: str) -> dict:
    return {
        "task": "ENERGY",
        "engine": "pyscf",
        "method": method,
        "basis": basis,
        "charge": 0,
        "multiplicity": 1,
    }


PLANNING_CASES: tuple[PlanningCase, ...] = (
    PlanningCase(
        "h2-hf-sto3g",
        "h2",
        "Calculate the Hartree-Fock single-point energy of the selected H2 structure with PySCF "
        "using the STO-3G basis. Charge 0, singlet.",
        "PROPOSE",
        _expect("hf", "sto-3g"),
    ),
    PlanningCase(
        "h2-b3lyp-def2svp",
        "h2",
        "Plan a B3LYP/def2-SVP single-point energy calculation for the selected hydrogen "
        "molecule with PySCF. Neutral, singlet.",
        "PROPOSE",
        _expect("b3lyp", "def2-svp"),
    ),
    PlanningCase(
        "h2-unavailable-ccsdt",
        "h2",
        "Calculate the CCSD(T)/cc-pVDZ energy of the selected hydrogen molecule.",
        "EXPLAIN_UNAVAILABLE",
    ),
    PlanningCase(
        "h2o-hf-631g",
        "h2o",
        "Calculate the HF/6-31G single-point energy for the selected water molecule with PySCF. "
        "Neutral singlet.",
        "PROPOSE",
        _expect("hf", "6-31g"),
    ),
    PlanningCase(
        "h2o-pbe-def2svp",
        "h2o",
        "Plan a PBE/def2-SVP single-point energy for the selected water molecule using PySCF. "
        "Charge 0, singlet.",
        "PROPOSE",
        _expect("pbe", "def2-svp"),
    ),
    PlanningCase(
        "h2o-optimization-out-of-scope",
        "h2o",
        "Optimize the geometry of the selected water molecule with B3LYP/6-31G.",
        "EXPLAIN_OUT_OF_SCOPE",
    ),
    PlanningCase(
        "ethanol-hf-sto3g",
        "ethanol",
        "Calculate the Hartree-Fock single-point energy of the selected ethanol structure with "
        "the STO-3G basis using PySCF. Neutral singlet.",
        "PROPOSE",
        _expect("hf", "sto-3g"),
    ),
    PlanningCase(
        "ethanol-b3lyp-631g",
        "ethanol",
        "Plan a B3LYP/6-31G single-point energy calculation for the selected ethanol structure "
        "with PySCF. Charge 0, singlet.",
        "PROPOSE",
        _expect("b3lyp", "6-31g"),
    ),
    PlanningCase(
        "ethanol-unavailable-pbe0",
        "ethanol",
        "Calculate the PBE0/def2-SVP single-point energy of the selected ethanol structure.",
        "EXPLAIN_UNAVAILABLE",
    ),
)


def planning_cases(
    molecule: str | None = None, kind: str | None = None
) -> tuple[PlanningCase, ...]:
    return tuple(
        case
        for case in PLANNING_CASES
        if (molecule is None or case.molecule == molecule) and (kind is None or case.kind == kind)
    )


CASE_IDS: tuple[str, ...] = tuple(case.id for case in PLANNING_CASES)


def case_by_id(case_id: str) -> PlanningCase:
    for case in PLANNING_CASES:
        if case.id == case_id:
            return case
    raise KeyError(case_id)


def reference_cases_digest(case_ids) -> str:
    """sha256 over exactly what a flow would send and expect for these cases, in this order.

    Each entry holds the case (id, kind, prompt, expected parameters) and its molecule (id, recorded
    hash, format, name and electronic state). Reading a molecule through ReferenceMolecule.data()
    also refuses a file whose bytes differ from the recorded hash, so an authorization that carries
    this digest is bound to the reviewed prompts, expectations and structure files. Raises KeyError
    for an unknown case and ValueError for a changed molecule file.
    """
    molecules = reference_molecules()
    entries = []
    for case_id in case_ids:
        case = case_by_id(case_id)
        molecule = molecules[case.molecule]
        molecule.data()
        entries.append(
            {
                "case": case.id,
                "kind": case.kind,
                "prompt": case.prompt,
                "expect": case.expect,
                "molecule": molecule.id,
                "molecule_sha256": molecule.sha256,
                "format": molecule.format,
                "structure_name": molecule.structure_name,
                "charge": molecule.charge,
                "multiplicity": molecule.multiplicity,
            }
        )
    encoded = json.dumps(entries, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()
