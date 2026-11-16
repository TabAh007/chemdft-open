"""Scientific validation and chemical graph inspection for molecular diagram proposals.

Applies strict multi-stage RDKit validation:
1. Syntax validation (MolFromSmiles / MolFromMolBlock without sanitization)
2. Chemical valency and sanitization (SanitizeMol)
3. Aromaticity, ring perception, and bond-order preservation
4. Stereochemistry audit (FindPotentialStereo + new CIP labeler: R/S, r/s, E/Z, unassigned)
5. Formal charge and radical detection (never silently neutralize charges)
6. Isotope detection and preservation
7. Disconnected fragment detection (salts, mixtures, counterions -> flagged AMBIGUOUS)
8. Heavy atom count and unsupported elements (transition metals, coordination complexes)
9. Emits explicit scientific warnings that syntax validation != scientific verification.
10. Computes detailed graph differences between proposals and researcher corrections.
"""

from __future__ import annotations

import contextlib
from typing import Any

from rdkit import Chem, rdBase
from rdkit.Chem import rdCIPLabeler, rdMolDescriptors

from ...contracts.structure_candidates import (
    DoubleBondStereoInfo,
    MolecularGraphDifference,
    StereocenterInfo,
)
from .contracts import RecognitionStatus

# Core organic elements supported for unassisted single-molecule DFT / RDKit modeling
ORGANIC_ELEMENTS = frozenset({"H", "C", "N", "O", "F", "P", "S", "Cl", "Br", "I", "B", "Si"})

# Resource bound applied to the raw (pre-sanitization) parse so that oversized input is rejected
# before valence perception, stereo perception, or hydrogen addition run on it.
MAX_VALIDATED_ATOMS = 2000


_SUPPORTED_BOND_TYPES = frozenset(
    {
        Chem.BondType.SINGLE,
        Chem.BondType.DOUBLE,
        Chem.BondType.TRIPLE,
        Chem.BondType.AROMATIC,
    }
)


class GraphValidationResult:
    def __init__(
        self,
        is_parseable: bool,
        canonical_isomeric_smiles: str | None = None,
        formula: str | None = None,
        formal_charge: int | None = None,
        heavy_atom_count: int | None = None,
        elements: tuple[str, ...] = (),
        has_stereochemistry: bool = False,
        status: RecognitionStatus = RecognitionStatus.PARSE_FAILED,
        warnings: tuple[str, ...] = (),
        diagnostics: tuple[str, ...] = (),
        ambiguities: tuple[str, ...] = (),
        stereocenters: tuple[StereocenterInfo, ...] = (),
        double_bond_stereochemistry: tuple[DoubleBondStereoInfo, ...] = (),
        unassigned_stereocenters: tuple[str, ...] = (),
        unassigned_double_bonds: tuple[str, ...] = (),
        disconnected_fragments: int = 1,
        fragment_formulas: tuple[str, ...] = (),
        is_organic: bool = True,
        unsupported_elements: tuple[str, ...] = (),
        has_radicals: bool = False,
        num_radicals: int = 0,
        isotopes: tuple[dict[str, Any], ...] = (),
        can_generate_3d: bool = False,
        mol: Chem.Mol | None = None,
    ) -> None:
        self.is_parseable = is_parseable
        self.canonical_isomeric_smiles = canonical_isomeric_smiles
        self.formula = formula
        self.formal_charge = formal_charge
        self.heavy_atom_count = heavy_atom_count
        self.elements = elements
        self.has_stereochemistry = has_stereochemistry
        self.status = status
        self.warnings = warnings
        self.diagnostics = diagnostics
        self.ambiguities = ambiguities
        self.stereocenters = stereocenters
        self.double_bond_stereochemistry = double_bond_stereochemistry
        self.unassigned_stereocenters = unassigned_stereocenters
        self.unassigned_double_bonds = unassigned_double_bonds
        self.disconnected_fragments = disconnected_fragments
        self.fragment_formulas = fragment_formulas
        self.is_organic = is_organic
        self.unsupported_elements = unsupported_elements
        self.has_radicals = has_radicals
        self.num_radicals = num_radicals
        self.isotopes = isotopes
        self.can_generate_3d = can_generate_3d
        self.mol = mol


_CIP_MAX_ITERATIONS = 1_000_000


def normalize_mol_block(text: str) -> str:
    """Line endings and the three-line header of a MOL block, tolerant of a stripped title.

    Clients and JSON layers often strip the blank first (title) line, which shifts the fixed
    header; the counts line is the only line containing V2000/V3000, so the missing leading
    lines are restored from its position instead of failing the whole structure.
    """
    lines = text.replace("\r\n", "\n").replace("\r", "\n").rstrip().split("\n")
    for index, line in enumerate(lines[:4]):
        if "V2000" in line or "V3000" in line:
            lines = [""] * max(0, 3 - index) + lines
            break
    return "\n".join(lines) + "\n"


def perceive_stereo(
    mol: Chem.Mol,
) -> tuple[list[StereocenterInfo], list[DoubleBondStereoInfo], int]:
    """Perceive every potential stereo element with RDKit's graph-based stereo algorithm.

    Invalid stereo marks are removed from ``mol`` in place (the count removed is returned so the
    caller can say so). Each element is ``specified`` or not; CIP codes come from the new CIP
    labeler: R/S, pseudo-asymmetric r/s (e.g. cis/trans-1,4-disubstituted cyclohexanes) and E/Z.
    """
    tags_before = sum(a.GetChiralTag() != Chem.ChiralType.CHI_UNSPECIFIED for a in mol.GetAtoms())
    # Converts SMILES/MOL bond directions into double-bond stereo, which the graph-based
    # perception below reads; invalid marks are cleaned by the call that follows.
    Chem.AssignStereochemistry(mol, cleanIt=False, force=True)
    potential = Chem.FindPotentialStereo(mol, cleanIt=True, flagPossible=True)
    tags_after = sum(a.GetChiralTag() != Chem.ChiralType.CHI_UNSPECIFIED for a in mol.GetAtoms())
    with contextlib.suppress(Exception):  # labels are descriptive; "specified" does not need them
        rdCIPLabeler.AssignCIPLabels(mol, maxRecursiveIterations=_CIP_MAX_ITERATIONS)
    centers: list[StereocenterInfo] = []
    bonds: list[DoubleBondStereoInfo] = []
    for element in potential:
        specified = element.specified == Chem.StereoSpecified.Specified
        if element.type == Chem.StereoType.Atom_Tetrahedral:
            atom = mol.GetAtomWithIdx(element.centeredOn)
            code = atom.GetProp("_CIPCode") if atom.HasProp("_CIPCode") else None
            centers.append(
                StereocenterInfo(
                    atom_index=atom.GetIdx(),
                    element=atom.GetSymbol(),
                    stereo=(code or "specified") if specified else "?",
                    is_assigned=specified,
                )
            )
        elif element.type == Chem.StereoType.Bond_Double:
            bond = mol.GetBondWithIdx(element.centeredOn)
            code = bond.GetProp("_CIPCode") if bond.HasProp("_CIPCode") else None
            if code is None and specified:
                if bond.GetStereo() in (Chem.BondStereo.STEREOE, Chem.BondStereo.STEREOTRANS):
                    code = "E"
                elif bond.GetStereo() in (Chem.BondStereo.STEREOZ, Chem.BondStereo.STEREOCIS):
                    code = "Z"
            bonds.append(
                DoubleBondStereoInfo(
                    bond_index=bond.GetIdx(),
                    begin_atom_index=bond.GetBeginAtomIdx(),
                    end_atom_index=bond.GetEndAtomIdx(),
                    stereo=(code or "specified") if specified else "?",
                    is_assigned=specified,
                )
            )
    return centers, bonds, max(tags_before - tags_after, 0)


def validate_chemical_graph(
    content: str | None,
    content_format: str = "SMILES",
    category_hint: str | None = None,
    engine_diagnostics: list[str] | None = None,
) -> GraphValidationResult:
    """Validate a molecular structure from SMILES or MOL/MOL_BLOCK with deterministic checks."""
    warnings: list[str] = [
        "RDKit parse and sanitization passed; this is NOT proof of scientific correctness.",
        "Researcher review and acceptance confirm the reviewed representation; "
        "they do not prove experimental or scientific correctness.",
    ]
    diagnostics: list[str] = list(engine_diagnostics or [])
    ambiguities: list[str] = []

    if not content or not content.strip():
        diagnostics.append("Input is empty or null; structure unrecognizable.")
        return GraphValidationResult(
            is_parseable=False,
            status=RecognitionStatus.UNRECOGNIZABLE,
            diagnostics=tuple(diagnostics),
            warnings=tuple(warnings),
        )

    norm_format = content_format.strip().upper()
    if norm_format in ("MOL", "MOL_BLOCK"):
        # A MOL block's first (title) line is routinely blank (Ketcher and RDKit both emit it so);
        # stripping leading whitespace shifts the fixed header lines and breaks parsing.
        clean_content = normalize_mol_block(content)
    else:
        clean_content = content.strip()

    # Stage 1: Basic syntax parsing without sanitization to isolate syntax from valency errors
    raw_mol: Chem.Mol | None = None
    with rdBase.BlockLogs():
        if norm_format in ("MOL", "MOL_BLOCK"):
            try:
                raw_mol = Chem.MolFromMolBlock(
                    clean_content, sanitize=False, removeHs=False, strictParsing=False
                )
            except Exception as exc:
                diagnostics.append(f"MOL parser exception: {type(exc).__name__}: {exc}")
                raw_mol = None
        else:
            try:
                # RDKit treats text after the first space as a molecule *name* and silently drops
                # it, so "CCO CCN" would validate as ethanol. Only a CXSMILES extension may follow.
                head, separator, tail = clean_content.partition(" ")
                has_trailing_text = bool(separator) and not tail.lstrip().startswith("|")
                if has_trailing_text or any(c in head for c in "\t\r\n"):
                    raise ValueError("whitespace-separated text after the SMILES is not allowed")
                raw_mol = Chem.MolFromSmiles(clean_content, sanitize=False)
            except Exception as exc:
                diagnostics.append(f"SMILES parser exception: {type(exc).__name__}: {exc}")
                raw_mol = None

    if raw_mol is None or raw_mol.GetNumAtoms() == 0:
        diagnostics.append(
            f"RDKit syntax parser failed on {norm_format} input: {clean_content[:120]}"
        )
        return GraphValidationResult(
            is_parseable=False,
            status=RecognitionStatus.PARSE_FAILED,
            diagnostics=tuple(diagnostics),
            warnings=(f"Raw input is syntactically invalid {norm_format}.",),
        )

    if raw_mol.GetNumAtoms() > MAX_VALIDATED_ATOMS:
        diagnostics.append(
            f"Structure has {raw_mol.GetNumAtoms()} atoms; the validation limit is "
            f"{MAX_VALIDATED_ATOMS}."
        )
        return GraphValidationResult(
            is_parseable=False,
            status=RecognitionStatus.UNSUPPORTED,
            diagnostics=tuple(diagnostics),
            warnings=("Structure exceeds the supported size for automated validation.",),
        )

    # Stage 2: Chemical sanitization (valency, Kekulization, aromaticity)
    try:
        with rdBase.BlockLogs():
            Chem.SanitizeMol(raw_mol)
    except Exception as exc:
        diagnostics.append(f"Valence violation / sanitization failure: {type(exc).__name__}: {exc}")
        return GraphValidationResult(
            is_parseable=False,
            status=RecognitionStatus.PARSE_FAILED,
            diagnostics=tuple(diagnostics),
            warnings=(f"Valency or Kekulization violation in proposed structure: {exc}",),
        )

    # Stage 3: Element audit & coordination chemistry
    elements = tuple(sorted({atom.GetSymbol() for atom in raw_mol.GetAtoms()}))
    # Dummy atoms (*, R#) are reported as wildcards below, not as inorganic elements.
    unsupported = tuple(
        e
        for e in elements
        if e not in ORGANIC_ELEMENTS
        and not any(a.GetSymbol() == e and a.GetAtomicNum() == 0 for a in raw_mol.GetAtoms())
    )
    is_organic = len(unsupported) == 0
    if unsupported:
        elem_list = ", ".join(unsupported)
        warnings.append(
            f"Structure contains elements requiring specialist verification: {elem_list}"
        )
        diagnostics.append(f"Unsupported coordination/inorganic elements: {elem_list}")
        ambiguities.append(f"Coordination/inorganic elements detected: {elem_list}")

    # Stage 4: Formal charge & radicals (preserve signed charges)
    formal_charge = sum(atom.GetFormalCharge() for atom in raw_mol.GetAtoms())
    num_radicals = sum(atom.GetNumRadicalElectrons() for atom in raw_mol.GetAtoms())
    has_radicals = num_radicals > 0
    if has_radicals:
        warnings.append(f"Proposed structure contains {num_radicals} open-shell radical electrons.")
        ambiguities.append("Open-shell radical proposal requires experimental confirmation.")

    # Stage 5: Disconnected fragments (mixtures, salts, counterions)
    fragments = Chem.GetMolFrags(raw_mol, asMols=True)
    fragment_count = len(fragments)
    fragment_formulas = tuple(rdMolDescriptors.CalcMolFormula(frag) for frag in fragments)
    if fragment_count > 1:
        warnings.append(
            f"Multiple disconnected fragments detected ({fragment_count} fragments: "
            f"{', '.join(fragment_formulas)}); diagram may contain counterions or separate "
            "structures."
        )
        ambiguities.append("Multi-component mixture or salt proposal.")
        diagnostics.append(
            f"Disconnected fragments detected ({fragment_count} fragments: "
            f"{', '.join(fragment_formulas)})."
        )

    # Stage 5b: Wildcard / R-group placeholders, query features and isotopic labels
    has_wildcards = any(atom.GetAtomicNum() == 0 or atom.HasQuery() for atom in raw_mol.GetAtoms())
    if has_wildcards:
        ambiguities.append(
            "Wildcard/attachment placeholder atoms (*) present: structure is partial."
        )
        diagnostics.append("Wildcard (*) placeholder atoms detected.")
    unsupported_bonds = sorted(
        {
            str(bond.GetBondType()).rsplit(".", 1)[-1]
            for bond in raw_mol.GetBonds()
            if bond.HasQuery() or bond.GetBondType() not in _SUPPORTED_BOND_TYPES
        }
    )
    if unsupported_bonds:
        ambiguities.append("Unsupported bond types present: " + ", ".join(unsupported_bonds) + ".")
        diagnostics.append(
            "Dative, zero-order, query or otherwise non-covalent bonds are not supported "
            f"({', '.join(unsupported_bonds)})."
        )
    relative_stereo_groups = [
        group
        for group in raw_mol.GetStereoGroups()
        if group.GetGroupType() != Chem.StereoGroupType.STEREO_ABSOLUTE
    ]
    if relative_stereo_groups:
        ambiguities.append(
            "Enhanced stereochemistry (AND/OR groups) describes relative or mixed "
            "configurations; no single stereoisomer is defined."
        )
        diagnostics.append(
            "Relative or mixed stereochemistry (AND/OR stereo groups) cannot be reduced to "
            "one absolute configuration."
        )

    isotope_items = tuple(
        {
            "atom_index": a.GetIdx(),
            "element": a.GetSymbol(),
            "isotope": a.GetIsotope(),
        }
        for a in raw_mol.GetAtoms()
        if a.GetIsotope() != 0
    )
    if isotope_items:
        iso_str = ", ".join(f"{item['element']}-{item['isotope']}" for item in isotope_items)
        warnings.append(f"Isotopic labels present ({iso_str}); preserved explicitly.")

    # Stage 6: Stereochemistry audit (tetrahedral centres AND double-bond E/Z)
    stereocenters_list, double_bond_stereo_list, discarded_marks = perceive_stereo(raw_mol)
    if discarded_marks:
        warnings.append(
            f"{discarded_marks} stereo mark(s) on atoms that are not stereocenters were "
            "discarded during stereo perception."
        )
    unassigned_chiral_list: list[str] = [
        f"Tetrahedral chiral center {item.element} at index {item.atom_index} "
        "has unassigned stereochemistry (R/S unspecified)"
        for item in stereocenters_list
        if not item.is_assigned
    ]
    unassigned_double_bond_list: list[str] = []
    for item in double_bond_stereo_list:
        if not item.is_assigned:
            b_a = raw_mol.GetAtomWithIdx(item.begin_atom_index).GetSymbol()
            b_b = raw_mol.GetAtomWithIdx(item.end_atom_index).GetSymbol()
            unassigned_double_bond_list.append(
                f"Double bond {b_a}{item.begin_atom_index}={b_b}{item.end_atom_index} "
                "has unassigned E/Z stereochemistry"
            )

    has_defined_stereo = any(s.is_assigned for s in stereocenters_list) or any(
        b.is_assigned for b in double_bond_stereo_list
    )
    has_unassigned_stereo = bool(unassigned_chiral_list or unassigned_double_bond_list)

    if has_unassigned_stereo:
        ambiguities.append(
            "Stereo elements (stereocentres or double bonds) present with unassigned/ambiguous "
            "stereochemistry."
        )
        warnings.append("Unassigned stereochemistry detected in proposal.")
        for item in unassigned_chiral_list:
            diagnostics.append(item)
        for item in unassigned_double_bond_list:
            diagnostics.append(item)

    # Stage 7: Canonical isomeric SMILES and formula
    # Explicit hydrogens (3D MOL input) are an input convention, not part of the graph identity.
    with rdBase.BlockLogs():
        canonical_smiles = Chem.MolToSmiles(
            Chem.RemoveHs(Chem.Mol(raw_mol), sanitize=False), isomericSmiles=True
        )
    formula = rdMolDescriptors.CalcMolFormula(raw_mol)
    heavy_atom_count = raw_mol.GetNumHeavyAtoms()

    # Determine 3D generation eligibility:
    # Requires: organic, single connected component, no wildcards, no radicals,
    # no unassigned stereocenters, <= 200 heavy atoms, closed-shell electron count.
    electrons = sum(a.GetAtomicNum() for a in Chem.AddHs(raw_mol).GetAtoms()) - formal_charge
    is_closed_shell = electrons > 0 and electrons % 2 == 0
    can_generate_3d = (
        is_organic
        and fragment_count == 1
        and not has_wildcards
        and not unsupported_bonds
        and not relative_stereo_groups
        and not has_radicals
        and not has_unassigned_stereo
        and heavy_atom_count <= 200
        and is_closed_shell
    )

    # Determine recognition status
    if unsupported or (
        category_hint
        and category_hint in ("coordination_complex", "polymer_repeat", "crystal_diagram")
    ):
        final_status = RecognitionStatus.UNSUPPORTED
    elif (
        fragment_count > 1
        or has_unassigned_stereo
        or has_wildcards
        or has_radicals
        or unsupported_bonds
        or relative_stereo_groups
    ):
        final_status = RecognitionStatus.AMBIGUOUS
    else:
        final_status = RecognitionStatus.MANUAL_REVIEW_REQUIRED

    return GraphValidationResult(
        is_parseable=True,
        canonical_isomeric_smiles=canonical_smiles,
        formula=formula,
        formal_charge=formal_charge,
        heavy_atom_count=heavy_atom_count,
        elements=elements,
        has_stereochemistry=has_defined_stereo,
        status=final_status,
        warnings=tuple(warnings),
        diagnostics=tuple(diagnostics),
        ambiguities=tuple(ambiguities),
        stereocenters=tuple(stereocenters_list),
        double_bond_stereochemistry=tuple(double_bond_stereo_list),
        unassigned_stereocenters=tuple(unassigned_chiral_list),
        unassigned_double_bonds=tuple(unassigned_double_bond_list),
        disconnected_fragments=fragment_count,
        fragment_formulas=fragment_formulas,
        is_organic=is_organic,
        unsupported_elements=unsupported,
        has_radicals=has_radicals,
        num_radicals=num_radicals,
        isotopes=isotope_items,
        can_generate_3d=can_generate_3d,
        mol=raw_mol,
    )


def validate_molecular_graph_proposal(
    raw_smiles: str | None,
    engine_diagnostics: list[str] | None = None,
    category_hint: str | None = None,
) -> GraphValidationResult:
    """Validate a raw OCSR molecular structure proposal (backwards compatible)."""
    return validate_chemical_graph(
        raw_smiles,
        content_format="SMILES",
        category_hint=category_hint,
        engine_diagnostics=engine_diagnostics,
    )


def _to_diff_mol(content: str | Chem.Mol | None, fmt: str) -> Chem.Mol | None:
    """Parse and sanitize one side of a comparison; explicit hydrogens are folded away."""
    if content is None:
        return None
    if isinstance(content, Chem.Mol):
        mol: Chem.Mol | None = Chem.Mol(content)
    else:
        raw = str(content)
        if not raw.strip():
            return None
        with rdBase.BlockLogs():
            if fmt.upper() in ("MOL", "MOL_BLOCK"):
                mol = Chem.MolFromMolBlock(
                    normalize_mol_block(raw), sanitize=False, removeHs=False, strictParsing=False
                )
            else:
                mol = Chem.MolFromSmiles(raw.strip(), sanitize=False)
    if mol is None or mol.GetNumAtoms() == 0 or mol.GetNumAtoms() > MAX_VALIDATED_ATOMS:
        return None
    try:
        with rdBase.BlockLogs():
            Chem.SanitizeMol(mol)
            mol = Chem.RemoveHs(mol, sanitize=False)
            perceive_stereo(mol)
    except Exception:
        return None
    return mol


def _layer_smiles(
    mol: Chem.Mol, *, bond_orders: bool, charges: bool, isotopes: bool, stereo: bool
) -> str:
    """Atom-order independent canonical string of one chemical information layer."""
    work = Chem.RWMol(mol)
    if not stereo:
        Chem.RemoveStereochemistry(work)
    for atom in work.GetAtoms():
        if not isotopes:
            atom.SetIsotope(0)
        if not charges:
            atom.SetFormalCharge(0)
            atom.SetNumRadicalElectrons(0)
        if not bond_orders:
            atom.SetIsAromatic(False)
        if not (charges and bond_orders):
            atom.SetNoImplicit(False)
            atom.SetNumExplicitHs(0)
    if not bond_orders:
        for bond in work.GetBonds():
            bond.SetBondType(Chem.BondType.SINGLE)
            bond.SetIsAromatic(False)
    out = work.GetMol()
    out.UpdatePropertyCache(strict=False)
    return Chem.MolToSmiles(out, isomericSmiles=True)


def _stereo_labels(mol: Chem.Mol) -> tuple[dict[int, str], dict[int, str]]:
    """Per-atom R/S/r/s/? and per-bond E/Z/? labels for every potential stereo element."""
    centers, bonds, _discarded = perceive_stereo(Chem.Mol(mol))
    return (
        {c.atom_index: c.stereo for c in centers},
        {b.bond_index: b.stereo for b in bonds},
    )


def _stereo_differences(orig: Chem.Mol, corr: Chem.Mol) -> list[MolecularGraphDifference]:
    """Compare stereo of two constitutionally identical molecules under the best atom mapping."""
    o_atoms, o_bonds = _stereo_labels(orig)
    c_atoms, c_bonds = _stereo_labels(corr)
    # Constitutional automorphisms give several valid mappings; the correct one (if any) is the
    # mapping that reproduces the stereo, so keep the mapping with the fewest disagreements.
    matches = corr.GetSubstructMatches(orig, uniquify=False, useChirality=False, maxMatches=2000)
    best: list[MolecularGraphDifference] | None = None
    for mapping in matches or ():
        found: list[MolecularGraphDifference] = []
        for o_idx, o_tag in o_atoms.items():
            c_idx = mapping[o_idx]
            c_tag = c_atoms.get(c_idx, "?")
            if o_tag != c_tag:
                symbol = orig.GetAtomWithIdx(o_idx).GetSymbol()
                found.append(
                    MolecularGraphDifference(
                        category="STEREOCHEMISTRY",
                        description=(
                            f"Tetrahedral center {symbol} (original atom {o_idx}, corrected atom "
                            f"{c_idx}) changed from {o_tag} to {c_tag}"
                        ),
                        original_value=o_tag,
                        corrected_value=c_tag,
                    )
                )
        for o_idx, o_tag in o_bonds.items():
            ob = orig.GetBondWithIdx(o_idx)
            cb = corr.GetBondBetweenAtoms(
                mapping[ob.GetBeginAtomIdx()], mapping[ob.GetEndAtomIdx()]
            )
            c_tag = c_bonds.get(cb.GetIdx(), "?") if cb is not None else "?"
            if o_tag != c_tag:
                found.append(
                    MolecularGraphDifference(
                        category="DOUBLE_BOND_STEREOCHEMISTRY",
                        description=(
                            f"Double bond (original atoms {ob.GetBeginAtomIdx()}="
                            f"{ob.GetEndAtomIdx()}) changed from {o_tag} to {c_tag}"
                        ),
                        original_value=o_tag,
                        corrected_value=c_tag,
                    )
                )
        if best is None or len(found) < len(best):
            best = found
        if not best:
            break
    return best if best is not None else []


def compute_graph_differences(
    original_content: str | Chem.Mol | None,
    corrected_content: str | Chem.Mol | None,
    original_format: str = "SMILES",
    corrected_format: str = "SMILES",
) -> tuple[MolecularGraphDifference, ...]:
    """Structured, atom-order independent differences between a proposal and a correction.

    Each chemical information layer (connectivity, bond orders, charge placement, isotope
    placement, tetrahedral and double-bond stereo) is compared through a canonical string, never
    through atom indices of the two inputs, so reordering atoms reports no difference and
    relocated charges, relocated isotopes and E/Z changes are each reported as what they are.
    """
    diffs: list[MolecularGraphDifference] = []
    orig_mol = _to_diff_mol(original_content, original_format)
    corr_mol = _to_diff_mol(corrected_content, corrected_format)

    if orig_mol is None or corr_mol is None:
        if corr_mol is not None:
            corr_smi = Chem.MolToSmiles(corr_mol, isomericSmiles=True)
            diffs.append(
                MolecularGraphDifference(
                    category="MOLECULAR_IDENTITY",
                    description=(
                        f"Initial proposal was empty or invalid; corrected graph: {corr_smi}"
                    ),
                    original_value=None,
                    corrected_value=corr_smi,
                )
            )
        return tuple(diffs)

    orig_smi = Chem.MolToSmiles(orig_mol, isomericSmiles=True)
    corr_smi = Chem.MolToSmiles(corr_mol, isomericSmiles=True)
    if orig_smi == corr_smi:
        return ()

    orig_formula = rdMolDescriptors.CalcMolFormula(orig_mol)
    corr_formula = rdMolDescriptors.CalcMolFormula(corr_mol)
    if orig_formula != corr_formula:
        diffs.append(
            MolecularGraphDifference(
                category="FORMULA",
                description=f"Formula changed from {orig_formula} to {corr_formula}",
                original_value=orig_formula,
                corrected_value=corr_formula,
            )
        )

    orig_charge = sum(a.GetFormalCharge() for a in orig_mol.GetAtoms())
    corr_charge = sum(a.GetFormalCharge() for a in corr_mol.GetAtoms())
    if orig_charge != corr_charge:
        diffs.append(
            MolecularGraphDifference(
                category="FORMAL_CHARGE",
                description=f"Formal charge changed from {orig_charge:+d} to {corr_charge:+d}",
                original_value=str(orig_charge),
                corrected_value=str(corr_charge),
            )
        )

    orig_heavy = orig_mol.GetNumHeavyAtoms()
    corr_heavy = corr_mol.GetNumHeavyAtoms()
    if orig_heavy != corr_heavy:
        diffs.append(
            MolecularGraphDifference(
                category="ATOM_COUNT",
                description=f"Heavy atom count changed from {orig_heavy} to {corr_heavy}",
                original_value=str(orig_heavy),
                corrected_value=str(corr_heavy),
            )
        )

    orig_elems = {a.GetSymbol() for a in orig_mol.GetAtoms()}
    corr_elems = {a.GetSymbol() for a in corr_mol.GetAtoms()}
    if orig_elems != corr_elems:
        parts: list[str] = []
        if corr_elems - orig_elems:
            parts.append(f"added {', '.join(sorted(corr_elems - orig_elems))}")
        if orig_elems - corr_elems:
            parts.append(f"removed {', '.join(sorted(orig_elems - corr_elems))}")
        diffs.append(
            MolecularGraphDifference(
                category="ATOM_IDENTITY",
                description=f"Atom elements modified: {'; '.join(parts)}",
                original_value=", ".join(sorted(orig_elems)),
                corrected_value=", ".join(sorted(corr_elems)),
            )
        )

    def layer(mol: Chem.Mol, **kwargs: bool) -> str:
        return _layer_smiles(mol, **kwargs)  # type: ignore[arg-type]

    flat = {"charges": False, "isotopes": False, "stereo": False}
    o_conn = layer(orig_mol, bond_orders=False, **flat)
    c_conn = layer(corr_mol, bond_orders=False, **flat)
    o_order = layer(orig_mol, bond_orders=True, **flat)
    c_order = layer(corr_mol, bond_orders=True, **flat)
    o_charge = layer(orig_mol, bond_orders=True, charges=True, isotopes=False, stereo=False)
    c_charge = layer(corr_mol, bond_orders=True, charges=True, isotopes=False, stereo=False)
    o_iso = layer(orig_mol, bond_orders=True, charges=True, isotopes=True, stereo=False)
    c_iso = layer(corr_mol, bond_orders=True, charges=True, isotopes=True, stereo=False)

    if o_conn != c_conn:
        diffs.append(
            MolecularGraphDifference(
                category="BOND_CONNECTIVITY",
                description="Atoms are connected differently (constitution changed)",
                original_value=orig_smi,
                corrected_value=corr_smi,
            )
        )
    elif o_order != c_order:
        diffs.append(
            MolecularGraphDifference(
                category="BOND_ORDER",
                description="Bond orders or aromaticity changed with identical atom connectivity",
                original_value=orig_smi,
                corrected_value=corr_smi,
            )
        )
    elif o_charge != c_charge and orig_charge == corr_charge:
        diffs.append(
            MolecularGraphDifference(
                category="FORMAL_CHARGE",
                description=(
                    "Formal charges were relocated to different atoms (net charge unchanged)"
                ),
                original_value=o_charge,
                corrected_value=c_charge,
            )
        )

    orig_isos = sorted(
        f"{a.GetSymbol()}-{a.GetIsotope()}" for a in orig_mol.GetAtoms() if a.GetIsotope()
    )
    corr_isos = sorted(
        f"{a.GetSymbol()}-{a.GetIsotope()}" for a in corr_mol.GetAtoms() if a.GetIsotope()
    )
    if orig_isos != corr_isos:
        diffs.append(
            MolecularGraphDifference(
                category="ISOTOPE",
                description=f"Isotopic labels modified: {orig_isos} -> {corr_isos}",
                original_value=", ".join(orig_isos) or "None",
                corrected_value=", ".join(corr_isos) or "None",
            )
        )
    elif o_iso != c_iso and o_charge == c_charge and not diffs:
        diffs.append(
            MolecularGraphDifference(
                category="ISOTOPE",
                description="Isotopic labels were relocated to different atoms",
                original_value=o_iso,
                corrected_value=c_iso,
            )
        )

    if o_iso == c_iso:
        # Identical constitution, charges and isotopes: any remaining difference is stereo.
        found = _stereo_differences(orig_mol, corr_mol)
        if not found:
            found = [
                MolecularGraphDifference(
                    category="STEREOCHEMISTRY",
                    description="Stereo configuration differs (no per-atom CIP label changed)",
                    original_value=orig_smi,
                    corrected_value=corr_smi,
                )
            ]
        diffs.extend(found)
    else:
        o_a, o_b = _stereo_labels(orig_mol)
        c_a, c_b = _stereo_labels(corr_mol)
        o_set = (
            sum(v in ("R", "S") for v in o_a.values()),
            sum(v in ("E", "Z") for v in o_b.values()),
        )
        c_set = (
            sum(v in ("R", "S") for v in c_a.values()),
            sum(v in ("E", "Z") for v in c_b.values()),
        )
        if o_set != c_set:
            diffs.append(
                MolecularGraphDifference(
                    category="STEREOCHEMISTRY",
                    description=(
                        "Number of specified stereo elements changed (tetrahedral, double bond) "
                        f"from {o_set} to {c_set}; per-atom comparison is unavailable because "
                        "the constitution also changed"
                    ),
                    original_value=str(o_set),
                    corrected_value=str(c_set),
                )
            )

    return tuple(diffs)
