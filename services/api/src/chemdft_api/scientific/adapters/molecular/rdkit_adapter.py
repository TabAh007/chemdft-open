from __future__ import annotations

import math
import re

from chemdft_api.contracts.scientific import (
    CoordinateSystem,
    CoordinateUnit,
    DiagnosticSeverity,
    StructureDiagnosticCode,
    StructureKind,
)
from chemdft_api.errors import ScientificValidationFailed, StructureElectronicStateMismatch
from chemdft_api.scientific.structures import (
    CanonicalStructureCandidate,
    StructureSourceFormat,
    atomic_number_for_symbol,
    diagnostic,
    validate_canonical_candidate,
    validate_structure_name,
)
from rdkit import Chem

from ...molecular_geometry import GeometryValidationFailed

ADAPTER_NAME = "chemdft.rdkit.molecular"
ADAPTER_VERSION = "1.0.0"


def xyz_electronic_state(comment: str) -> tuple[str, tuple[int, int] | None]:
    """Only an explicit ChemDFT comment declaration assigns XYZ electronic state."""
    marker = " | chemdft:"
    if marker not in comment:
        return comment, None
    name, declaration = comment.split(marker, 1)
    match = re.fullmatch(r"charge=([+-]?[0-9]+);multiplicity=([0-9]+)", declaration)
    if match is None or len(match[1]) > 10 or len(match[2]) > 10 or int(match[2]) < 1:
        raise StructureElectronicStateMismatch(
            "XYZ_ELECTRONIC_STATE_INVALID",
            "Declare integer charge and positive integer multiplicity as "
            "'Name | chemdft:charge=+1;multiplicity=1' in the XYZ comment line.",
        )
    return name, (int(match[1]), int(match[2]))


def parse_sdf(data: bytes, *, selection_index: int = 0) -> CanonicalStructureCandidate:
    text = _decode_text(data)
    if text.count("$$$$") > 25:
        raise ScientificValidationFailed("SDF exceeds the Phase 3 record limit.")
    supplier = Chem.SDMolSupplier()
    supplier.SetData(text, sanitize=False, removeHs=False)
    mols = [mol for mol in supplier if mol is not None]
    if not mols:
        raise ScientificValidationFailed("SDF did not contain a parseable molecule.")
    if selection_index >= len(mols):
        raise ScientificValidationFailed("Requested SDF record does not exist.")
    candidate = _candidate_from_mol(
        mols[selection_index],
        source_format=StructureSourceFormat.SDF,
        fallback_name=f"SDF molecule {selection_index + 1}",
    )
    Chem.SanitizeMol(mols[selection_index], catchErrors=True)
    validate_canonical_candidate(candidate)
    return candidate


def parse_mol(
    data: bytes,
    *,
    fallback_name: str = "Edited molecule",
) -> CanonicalStructureCandidate:
    mol = Chem.MolFromMolBlock(_decode_text(data), sanitize=False, removeHs=False)
    if mol is None:
        raise ScientificValidationFailed("MOL payload did not contain a parseable molecule.")
    candidate = _candidate_from_mol(
        mol,
        source_format=StructureSourceFormat.MOL,
        fallback_name=fallback_name,
    )
    validate_canonical_candidate(candidate)
    return candidate


def parse_xyz(data: bytes, *, selection_index: int = 0) -> CanonicalStructureCandidate:
    text = _decode_text(data)
    frames = _split_xyz_frames(text)
    if len(frames) > 25:
        raise ScientificValidationFailed("XYZ exceeds the Phase 3 frame limit.")
    if selection_index >= len(frames):
        raise ScientificValidationFailed("Requested XYZ frame does not exist.")
    atoms_count, comment, atom_lines = frames[selection_index]
    name, declared_state = xyz_electronic_state(comment)
    atoms = []
    for index, line in enumerate(atom_lines):
        parts = line.split()
        if len(parts) < 4:
            raise ScientificValidationFailed("XYZ atom line must contain element and x/y/z.")
        element = parts[0]
        atomic_number = atomic_number_for_symbol(element)
        try:
            x, y, z = (float(parts[1]), float(parts[2]), float(parts[3]))
        except ValueError as error:
            raise ScientificValidationFailed("XYZ coordinates must be numeric.") from error
        if any(not math.isfinite(value) for value in (x, y, z)):
            raise ScientificValidationFailed("XYZ coordinates must be finite.")
        atoms.append(
            {
                "index": index,
                "atomic_number": atomic_number,
                "element": element,
                "x": x,
                "y": y,
                "z": z,
                "formal_charge": None,
                "label": None,
                "isotope": None,
                "occupancy": None,
            }
        )
    if len(atoms) != atoms_count:
        raise ScientificValidationFailed("XYZ atom count does not match the frame header.")
    if declared_state is not None:
        from ...engines.normalization import validate_electronic_state_composition

        validate_electronic_state_composition(atoms, *declared_state)
    candidate = CanonicalStructureCandidate(
        name=name or f"XYZ frame {selection_index + 1}",
        kind=StructureKind.MOLECULE,
        coordinates={
            "structure_version_id": "00000000-0000-4000-8000-000000000000",
            "coordinate_system": CoordinateSystem.CARTESIAN,
            "unit": CoordinateUnit.ANGSTROM,
            "dimensionality": 3,
            "atom_ordering": "AS_LISTED",
            "source": None,
            "atoms": atoms,
            "bonds": [],
        },
        overall_charge=declared_state[0] if declared_state else 0,
        multiplicity=declared_state[1] if declared_state else 1,
        electronic_state_declared=declared_state is not None,
        source_format=StructureSourceFormat.XYZ,
        parser_name="rdkit",
        parser_version=Chem.rdBase.rdkitVersion,
        adapter_name=ADAPTER_NAME,
        adapter_version=ADAPTER_VERSION,
        diagnostics=(
            diagnostic(
                DiagnosticSeverity.WARNING,
                StructureDiagnosticCode.MISSING_CONNECTIVITY,
                "XYZ source does not contain authoritative bond connectivity.",
            ),
            diagnostic(
                DiagnosticSeverity.WARNING,
                StructureDiagnosticCode.PARSER_WARNING,
                "Electronic state is user-declared in the XYZ comment; parity is only a "
                "consistency check, not proof of chemical correctness."
                if declared_state else
                "XYZ electronic state is unspecified. Stored 0/1 values are placeholders; "
                "explicit calculation charge and multiplicity are required.",
            ),
        ),
    )
    validate_canonical_candidate(candidate)
    return candidate


def export_sdf(candidate: CanonicalStructureCandidate) -> bytes:
    mol = _mol_from_candidate(candidate)
    return (Chem.MolToMolBlock(mol) + "$$$$\n").encode("utf-8")


def export_mol(candidate: CanonicalStructureCandidate) -> bytes:
    mol = _mol_from_candidate(candidate)
    return Chem.MolToMolBlock(mol).encode("utf-8")


def export_smiles(candidate: CanonicalStructureCandidate) -> bytes:
    mol = _mol_from_candidate(candidate)
    return (Chem.MolToSmiles(mol) + "\n").encode("utf-8")


def export_xyz(candidate: CanonicalStructureCandidate) -> bytes:
    validate_structure_name(candidate.name)
    lines = [str(len(candidate.atoms)), candidate.name]
    for atom in candidate.atoms:
        lines.append(f"{atom['element']} {atom['x']:.10g} {atom['y']:.10g} {atom['z']:.10g}")
    return ("\n".join(lines) + "\n").encode("utf-8")


def _decode_text(data: bytes) -> str:
    if len(data) > 10 * 1024 * 1024:
        raise ScientificValidationFailed("Structure source exceeds parser size limit.")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ScientificValidationFailed("Structure source must be UTF-8 text.") from error
    if any(len(line) > 20_000 for line in text.splitlines()):
        raise ScientificValidationFailed("Structure source contains an overlong line.")
    return text


def _candidate_from_mol(
    mol: Chem.Mol,
    *,
    source_format: StructureSourceFormat,
    fallback_name: str,
) -> CanonicalStructureCandidate:
    if mol.GetNumAtoms() > 10_000:
        raise ScientificValidationFailed("Molecule exceeds the Phase 3 atom limit.")
    if mol.GetNumBonds() > 40_000:
        raise ScientificValidationFailed("Molecule exceeds the Phase 3 bond limit.")
    conformer = mol.GetConformer() if mol.GetNumConformers() else None
    require_computational_mol(mol)
    atoms = []
    for atom in mol.GetAtoms():
        index = atom.GetIdx()
        position = conformer.GetAtomPosition(index) if conformer else None
        atoms.append(
            {
                "index": index,
                "atomic_number": atom.GetAtomicNum(),
                "element": atom.GetSymbol(),
                "x": float(position.x) if position else 0.0,
                "y": float(position.y) if position else 0.0,
                "z": float(position.z) if position else 0.0,
                "isotope": atom.GetIsotope() or None,
                "formal_charge": atom.GetFormalCharge(),
                "label": atom.GetProp("atomLabel") if atom.HasProp("atomLabel") else None,
                "occupancy": None,
            }
        )
    bonds = [
        {
            "atom_index_a": bond.GetBeginAtomIdx(),
            "atom_index_b": bond.GetEndAtomIdx(),
            "order": float(bond.GetBondTypeAsDouble()),
        }
        for bond in mol.GetBonds()
    ]
    if mol.HasProp("_Name"):
        validate_structure_name(mol.GetProp("_Name"))
    name = (
        mol.GetProp("_Name").strip()
        if mol.HasProp("_Name") and mol.GetProp("_Name").strip()
        else fallback_name
    )
    candidate = CanonicalStructureCandidate(
        name=name,
        kind=StructureKind.MOLECULE,
        coordinates={
            "structure_version_id": "00000000-0000-4000-8000-000000000000",
            "coordinate_system": CoordinateSystem.CARTESIAN,
            "unit": CoordinateUnit.ANGSTROM,
            "dimensionality": 3,
            "atom_ordering": "AS_LISTED",
            "source": None,
            "atoms": atoms,
            "bonds": bonds,
        },
        overall_charge=sum(atom.GetFormalCharge() for atom in mol.GetAtoms()),
        multiplicity=1,
        source_format=source_format,
        parser_name="rdkit",
        parser_version=Chem.rdBase.rdkitVersion,
        adapter_name=ADAPTER_NAME,
        adapter_version=ADAPTER_VERSION,
    )
    validate_canonical_candidate(candidate)
    return candidate


def require_computational_mol(mol: Chem.Mol) -> None:
    """Use conformer metadata, never planarity, to distinguish drawings from coordinates."""
    if not mol.GetNumConformers() or not mol.GetConformer().Is3D():
        raise GeometryValidationFailed(
            "GEOMETRY_2D_REQUIRES_GENERATION",
            "A 2D drawing requires Generate 3D, preview and explicit acceptance.",
        )
    try:
        Chem.SanitizeMol(mol)
    except (ValueError, RuntimeError) as error:
        raise GeometryValidationFailed(
            "GEOMETRY_INVALID_GRAPH", "Invalid molecular valence."
        ) from error
    if any(a.GetNumImplicitHs() or a.GetNumExplicitHs() for a in mol.GetAtoms()):
        raise GeometryValidationFailed(
            "GEOMETRY_HYDROGEN_COORDINATES_REQUIRED",
            "Implicit hydrogens need explicit atomic coordinates before calculation.",
        )


def _split_xyz_frames(text: str) -> list[tuple[int, str, list[str]]]:
    frames: list[tuple[int, str, list[str]]] = []
    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    index = 0
    while index < len(lines):
        try:
            atoms_count = int(lines[index])
        except ValueError as error:
            raise ScientificValidationFailed("XYZ frame must start with an atom count.") from error
        if atoms_count < 1 or atoms_count > 10_000:
            raise ScientificValidationFailed("XYZ atom count is outside Phase 3 limits.")
        if index + atoms_count + 1 >= len(lines) + 1:
            raise ScientificValidationFailed("XYZ frame is truncated.")
        comment = lines[index + 1]
        atom_lines = lines[index + 2 : index + 2 + atoms_count]
        if len(atom_lines) != atoms_count:
            raise ScientificValidationFailed("XYZ frame is truncated.")
        frames.append((atoms_count, comment, atom_lines))
        index += atoms_count + 2
    if not frames:
        raise ScientificValidationFailed("XYZ did not contain any frames.")
    return frames


def _mol_from_candidate(candidate: CanonicalStructureCandidate) -> Chem.Mol:
    validate_structure_name(candidate.name)
    rw_mol = Chem.RWMol()
    for atom in candidate.atoms:
        rd_atom = Chem.Atom(int(atom["atomic_number"]))
        if atom.get("formal_charge") is not None:
            rd_atom.SetFormalCharge(int(atom["formal_charge"]))
        if atom.get("isotope") is not None:
            rd_atom.SetIsotope(int(atom["isotope"]))
        rw_mol.AddAtom(rd_atom)
    for bond in candidate.bonds:
        order = float(bond.get("order") or 1)
        bond_type = {
            1.0: Chem.BondType.SINGLE,
            1.5: Chem.BondType.AROMATIC,
            2.0: Chem.BondType.DOUBLE,
            3.0: Chem.BondType.TRIPLE,
        }.get(order, Chem.BondType.SINGLE)
        rw_mol.AddBond(int(bond["atom_index_a"]), int(bond["atom_index_b"]), bond_type)
    mol = rw_mol.GetMol()
    conformer = Chem.Conformer(len(candidate.atoms))
    for atom in candidate.atoms:
        conformer.SetAtomPosition(
            int(atom["index"]),
            (float(atom["x"]), float(atom["y"]), float(atom["z"])),
        )
    mol.AddConformer(conformer)
    mol.SetProp("_Name", candidate.name)
    return mol
