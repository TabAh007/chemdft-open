"""Shared deterministic conformer generation; a conformer is not a QM optimization."""

from __future__ import annotations

import math
from dataclasses import dataclass

from rdkit import Chem
from rdkit.Chem import AllChem, rdMolDescriptors

from ..contracts.structure_candidates import CandidateCoordinateRepresentation
from ..errors import ScientificValidationFailed
from .structures import validate_structure_name

RANDOM_SEED = 104729
MAX_HEAVY_ATOMS = 200
EMBED_TIMEOUT_SECONDS = 15
GENERATION_METHOD = "rdkit.etkdg3.preview-conformer"
_ELEMENTS = {1, 5, 6, 7, 8, 9, 14, 15, 16, 17, 35, 53}


class GeometryValidationFailed(ScientificValidationFailed):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


def parse_drawing(mol_block: str) -> Chem.Mol:
    try:
        molecule = Chem.MolFromMolBlock(
            mol_block, sanitize=True, removeHs=False, strictParsing=True
        )
    except (ValueError, RuntimeError) as error:
        raise GeometryValidationFailed(
            "GEOMETRY_INVALID_GRAPH", "MOL sanitization failed."
        ) from error
    if molecule is None or molecule.GetNumAtoms() == 0:
        raise GeometryValidationFailed("GEOMETRY_INVALID_GRAPH", "MOL input is not parseable.")
    return molecule


def generation_parameters() -> dict[str, str | int | bool]:
    return {
        "algorithm": "ETKDGv3",
        "random_seed": RANDOM_SEED,
        "num_threads": 1,
        "force_field_relaxation": False,
        "stereochemistry_policy": "EXPLICIT_ASSIGNMENT_REQUIRED",
        "stereochemistry_verification": "INDEPENDENT_ASSIGNMENT_FROM_3D",
        "rdkit_version": Chem.rdBase.rdkitVersion,
    }


def graph_identity(molecule: Chem.Mol) -> str:
    return Chem.MolToSmiles(Chem.RemoveHs(Chem.Mol(molecule)), canonical=True, isomericSmiles=True)


def require_explicit_stereochemistry(molecule: Chem.Mol) -> None:
    """Potential stereo is graph dependent; tetrahedral atoms alone are not chiral."""
    if any(
        group.GetGroupType() != Chem.StereoGroupType.STEREO_ABSOLUTE
        for group in molecule.GetStereoGroups()
    ):
        raise GeometryValidationFailed(
            "GEOMETRY_STEREOCHEMISTRY_UNSPECIFIED",
            "Specify absolute stereochemistry; relative or mixed stereoisomers are unsupported.",
        )
    potential = Chem.FindPotentialStereo(molecule, cleanIt=False, flagPossible=True)
    ambiguous = [
        f"{element.type} at index {element.centeredOn}"
        for element in potential
        if element.specified != Chem.StereoSpecified.Specified
    ]
    if ambiguous:
        raise GeometryValidationFailed(
            "GEOMETRY_STEREOCHEMISTRY_UNSPECIFIED",
            "Specify stereochemistry in the drawing before generating 3D (R/S or E/Z): "
            + ", ".join(ambiguous)
            + ". No stereoisomer has been selected.",
        )


def verify_generated_stereochemistry(molecule: Chem.Mol, source_identity: str) -> None:
    # Remove inherited stereo tags so this check measures the actual coordinates.
    measured = Chem.Mol(molecule)
    Chem.RemoveStereochemistry(measured)
    Chem.AssignStereochemistryFrom3D(measured, replaceExistingTags=True)
    Chem.AssignStereochemistry(measured, cleanIt=True, force=True)
    if graph_identity(measured) != source_identity:
        raise GeometryValidationFailed(
            "GEOMETRY_STEREOCHEMISTRY_MISMATCH",
            "Generated 3D stereochemistry does not match the explicit source drawing.",
        )


def validate_geometry(representation: CandidateCoordinateRepresentation) -> None:
    """Check atomic identity and distances without testing coordinate planarity."""
    coordinates = representation.coordinates
    if coordinates.coordinate_system.value != "CARTESIAN" or coordinates.unit.value != "angstrom":
        raise GeometryValidationFailed("GEOMETRY_INVALID_UNITS", "Generated geometry requires Å.")
    atoms = coordinates.atoms
    if len(atoms) > 2000:
        raise GeometryValidationFailed("GEOMETRY_UNSUPPORTED", "Geometry exceeds the atom limit.")
    table = Chem.GetPeriodicTable()
    for index, atom in enumerate(atoms):
        if (
            atom.index != index
            or atom.atomic_number < 1
            or (table.GetElementSymbol(atom.atomic_number) != atom.element)
        ):
            raise GeometryValidationFailed(
                "GEOMETRY_ATOM_IDENTITY", "Invalid atom identity or map."
            )
        if not all(math.isfinite(v) for v in (atom.x, atom.y, atom.z)):
            raise GeometryValidationFailed(
                "GEOMETRY_INVALID_COORDINATES", "Coordinates must be finite."
            )
        for other in atoms[:index]:
            if math.dist((atom.x, atom.y, atom.z), (other.x, other.y, other.z)) < 0.35:
                raise GeometryValidationFailed("GEOMETRY_DEGENERATE", "Atoms overlap (< 0.35 Å).")
    for bond in coordinates.bonds:
        a, b = atoms[bond.atom_index_a], atoms[bond.atom_index_b]
        distance = math.dist((a.x, a.y, a.z), (b.x, b.y, b.z))
        radius = table.GetRcovalent(a.atomic_number) + table.GetRcovalent(b.atomic_number)
        if not 0.65 * radius <= distance <= 1.6 * radius:
            raise GeometryValidationFailed(
                "GEOMETRY_BOND_DISTANCE", "Unreasonable bonded distance."
            )


@dataclass(frozen=True)
class GeneratedGeometry:
    coordinates: CandidateCoordinateRepresentation
    formula: str
    canonical_smiles: str
    source_atom_count: int
    explicit_hydrogen_count: int
    source_atom_indices: tuple[int | None, ...]
    hydrogen_parent_indices: tuple[int | None, ...]


def generate_conformer(
    molecule: Chem.Mol, name: str, *, multiplicity: int = 1
) -> GeneratedGeometry:
    validate_structure_name(name)
    molecule = Chem.Mol(molecule)
    try:
        Chem.SanitizeMol(molecule)
    except (ValueError, RuntimeError) as error:
        raise GeometryValidationFailed(
            "GEOMETRY_INVALID_GRAPH", "Molecular graph is invalid."
        ) from error
    if (
        not molecule.GetNumAtoms()
        or molecule.GetNumHeavyAtoms() > MAX_HEAVY_ATOMS
        or len(Chem.GetMolFrags(molecule)) != 1
        or any(
            a.GetAtomicNum() not in _ELEMENTS or a.HasQuery() or a.GetNumRadicalElectrons()
            for a in molecule.GetAtoms()
        )
        or any(
            b.HasQuery() or b.GetBondTypeAsDouble() not in {1, 1.5, 2, 3}
            for b in molecule.GetBonds()
        )
    ):
        raise GeometryValidationFailed(
            "GEOMETRY_UNSUPPORTED", "Requires one closed-shell organic graph (≤200 heavy atoms)."
        )
    charge = Chem.GetFormalCharge(molecule)
    require_explicit_stereochemistry(molecule)
    formula = rdMolDescriptors.CalcMolFormula(molecule)
    identity = graph_identity(molecule)
    source_count = molecule.GetNumAtoms()
    hydrated = Chem.AddHs(molecule)
    electrons = sum(a.GetAtomicNum() for a in hydrated.GetAtoms()) - charge
    if multiplicity != 1 or electrons <= 0 or electrons % 2:
        raise GeometryValidationFailed(
            "GEOMETRY_MULTIPLICITY", "This generator supports compatible closed-shell singlets."
        )
    params = AllChem.ETKDGv3()
    params.randomSeed = RANDOM_SEED
    params.numThreads = 1
    # Wall-clock bound: pathological graphs fail with GEOMETRY_GENERATION_FAILED instead of
    # holding a request worker for tens of seconds. Successful embeddings are unaffected.
    params.timeout = EMBED_TIMEOUT_SECONDS
    params.clearConfs = True
    params.enforceChirality = True
    if AllChem.EmbedMolecule(hydrated, params) != 0:
        raise GeometryValidationFailed("GEOMETRY_GENERATION_FAILED", "ETKDGv3 embedding failed.")
    if (
        graph_identity(hydrated) != identity
        or rdMolDescriptors.CalcMolFormula(hydrated) != formula
        or Chem.GetFormalCharge(hydrated) != charge
        or any(a.GetNumImplicitHs() or a.GetNumExplicitHs() for a in hydrated.GetAtoms())
    ):
        raise GeometryValidationFailed("GEOMETRY_IDENTITY_MISMATCH", "Hydration changed identity.")
    # AddHs appends atoms. Assert the original atom and bond mapping rather than relying on it.
    for atom in molecule.GetAtoms():
        generated = hydrated.GetAtomWithIdx(atom.GetIdx())
        if (atom.GetAtomicNum(), atom.GetIsotope(), atom.GetFormalCharge()) != (
            generated.GetAtomicNum(),
            generated.GetIsotope(),
            generated.GetFormalCharge(),
        ):
            raise GeometryValidationFailed("GEOMETRY_ATOM_IDENTITY", "Source atom mapping changed.")
    for bond in molecule.GetBonds():
        generated = hydrated.GetBondBetweenAtoms(bond.GetBeginAtomIdx(), bond.GetEndAtomIdx())
        if generated is None or generated.GetBondType() != bond.GetBondType():
            raise GeometryValidationFailed(
                "GEOMETRY_IDENTITY_MISMATCH", "Source connectivity changed."
            )
    conformer = hydrated.GetConformer()
    if not conformer.Is3D():
        raise GeometryValidationFailed("GEOMETRY_GENERATION_FAILED", "No generated 3D conformer.")
    verify_generated_stereochemistry(hydrated, identity)
    atoms = []
    parents: list[int | None] = []
    for atom in hydrated.GetAtoms():
        p = conformer.GetAtomPosition(atom.GetIdx())
        atoms.append(
            {
                "index": atom.GetIdx(),
                "atomic_number": atom.GetAtomicNum(),
                "element": atom.GetSymbol(),
                "x": p.x,
                "y": p.y,
                "z": p.z,
                "isotope": atom.GetIsotope() or None,
                "formal_charge": atom.GetFormalCharge(),
            }
        )
        added = atom.GetIdx() >= source_count
        if atom.GetAtomicNum() == 1 and atom.GetDegree() != 1:
            raise GeometryValidationFailed("GEOMETRY_HYDROGEN", "Hydrogen must have one parent.")
        parents.append(atom.GetNeighbors()[0].GetIdx() if added else None)
    coordinates = CandidateCoordinateRepresentation.model_validate(
        {
            "kind": "MOLECULE",
            "name": name,
            "overall_charge": charge,
            "multiplicity": multiplicity,
            "coordinates": {
                "coordinate_system": "CARTESIAN",
                "unit": "angstrom",
                "atoms": atoms,
                "bonds": [
                    {
                        "atom_index_a": b.GetBeginAtomIdx(),
                        "atom_index_b": b.GetEndAtomIdx(),
                        "order": b.GetBondTypeAsDouble(),
                    }
                    for b in hydrated.GetBonds()
                ],
            },
        }
    )
    validate_geometry(coordinates)
    return GeneratedGeometry(
        coordinates,
        formula,
        identity,
        source_count,
        sum(a.GetAtomicNum() == 1 for a in hydrated.GetAtoms()),
        tuple(i if i < source_count else None for i in range(len(atoms))),
        tuple(parents),
    )
