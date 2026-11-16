# ruff: noqa: E501
"""Deterministic molecule identity catalogue, graph validation, and resolution.

Follows AS-0 architecture:
- Reviewed deterministic organic catalogue for common, well-defined organic molecules.
- Explicit SMILES graph validation via RDKit (closed-shell, neutral, supported elements).
- Ambiguity detection for constitutional isomers and unspecified stereochemistry.
- Bounded PubChem PUG-REST lookup adapter (disabled by default, strict timeout, SSRF-safe).
- NEVER fabricates or guesses chemical name-to-structure mappings.
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Literal
from urllib.error import URLError

from rdkit import Chem, rdBase
from rdkit.Chem.rdMolDescriptors import CalcMolFormula

SUPPORTED_ELEMENTS = frozenset({1, 6, 7, 8, 9, 15, 16, 17, 35, 53})  # H, C, N, O, F, P, S, Cl, Br, I
MAX_HEAVY_ATOMS = 200


@dataclass(frozen=True, slots=True)
class ResolvedMoleculeIdentity:
    name: str
    canonical_isomeric_smiles: str
    formula: str
    charge: int
    multiplicity: int
    stereo_status: Literal["NONE", "SPECIFIED", "AMBIGUOUS"]
    identity_source: Literal["REVIEWED_CATALOGUE", "EXPLICIT_SMILES", "PUBCHEM"]
    source_hash: str
    heavy_atom_count: int


@dataclass(frozen=True, slots=True)
class AmbiguousMoleculeCandidate:
    name: str
    canonical_isomeric_smiles: str
    formula: str
    description: str


@dataclass(frozen=True, slots=True)
class IdentityResolutionResult:
    resolved: bool
    identity: ResolvedMoleculeIdentity | None = None
    alternatives: tuple[AmbiguousMoleculeCandidate, ...] = ()
    clarification_required: bool = False
    clarification_prompt: str | None = None
    diagnostics: tuple[str, ...] = ()


def _compute_hash(data: dict[str, Any]) -> str:
    raw = json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


# Deterministic catalogue of reviewed, well-defined common organic molecules
_CATALOGUE_DEFINITIONS: list[dict[str, Any]] = [
    {"name": "methane", "aliases": ["marsh gas", "methyl hydride"], "smiles": "C", "formula": "CH4"},
    {"name": "ethane", "aliases": ["ethyl hydride"], "smiles": "CC", "formula": "C2H6"},
    {"name": "propane", "aliases": ["propyl hydride"], "smiles": "CCC", "formula": "C3H8"},
    {"name": "benzene", "aliases": ["benzol", "[6]annulene"], "smiles": "c1ccccc1", "formula": "C6H6"},
    {"name": "toluene", "aliases": ["methylbenzene"], "smiles": "Cc1ccccc1", "formula": "C7H8"},
    {"name": "methanol", "aliases": ["methyl alcohol", "wood alcohol", "ch3oh"], "smiles": "CO", "formula": "CH4O"},
    {"name": "ethanol", "aliases": ["ethyl alcohol", "grain alcohol", "c2h5oh"], "smiles": "CCO", "formula": "C2H6O"},
    {"name": "acetone", "aliases": ["propan-2-one", "2-propanone", "dimethyl ketone"], "smiles": "CC(=O)C", "formula": "C3H6O"},
    {"name": "ethylene", "aliases": ["ethene"], "smiles": "C=C", "formula": "C2H4"},
    {"name": "acetylene", "aliases": ["ethyne"], "smiles": "C#C", "formula": "C2H2"},
    {"name": "formaldehyde", "aliases": ["methanal"], "smiles": "C=O", "formula": "CH2O"},
    {"name": "acetaldehyde", "aliases": ["ethanal"], "smiles": "CC=O", "formula": "C2H4O"},
    {"name": "acetic acid", "aliases": ["ethanoic acid"], "smiles": "CC(=O)O", "formula": "C2H4O2"},
    {"name": "formic acid", "aliases": ["methanoic acid"], "smiles": "C(=O)O", "formula": "CH2O2"},
    {"name": "diethyl ether", "aliases": ["ethoxyethane", "ethyl ether"], "smiles": "CCOCC", "formula": "C4H10O"},
    {"name": "tetrahydrofuran", "aliases": ["thf", "oxolane"], "smiles": "C1CCOC1", "formula": "C4H8O"},
    {"name": "cyclohexane", "aliases": ["hexahydrobenzene"], "smiles": "C1CCCCC1", "formula": "C6H12"},
    {"name": "cyclopentane", "aliases": [], "smiles": "C1CCCC1", "formula": "C5H10"},
    {"name": "pyridine", "aliases": ["azine"], "smiles": "c1ccncc1", "formula": "C5H5N"},
    {"name": "furan", "aliases": ["oxole"], "smiles": "c1ccoc1", "formula": "C4H4O"},
    {"name": "thiophene", "aliases": ["thiole"], "smiles": "c1ccsc1", "formula": "C4H4S"},
    {"name": "pyrrole", "aliases": ["azole"], "smiles": "c1cc[nH]c1", "formula": "C4H5N"},
    {"name": "water", "aliases": ["h2o", "oxidane", "dihydrogen monoxide"], "smiles": "O", "formula": "H2O"},
    {"name": "ammonia", "aliases": ["nh3", "azane"], "smiles": "N", "formula": "H3N"},
    {"name": "carbon dioxide", "aliases": ["co2"], "smiles": "O=C=O", "formula": "CO2"},
    {"name": "carbon monoxide", "aliases": ["co"], "smiles": "[C-]#[O+]", "formula": "CO"},
    {"name": "hydrogen cyanide", "aliases": ["hcn"], "smiles": "C#N", "formula": "CHN"},
    {"name": "urea", "aliases": ["carbamide"], "smiles": "NC(=O)N", "formula": "CH4N2O"},
    {"name": "naphthalene", "aliases": [], "smiles": "c1ccc2ccccc2c1", "formula": "C10H8"},
    {"name": "phenol", "aliases": ["hydroxybenzene"], "smiles": "Oc1ccccc1", "formula": "C6H6O"},
    {"name": "aniline", "aliases": ["aminobenzene", "phenylamine"], "smiles": "Nc1ccccc1", "formula": "C6H7N"},
    {"name": "benzoic acid", "aliases": ["benzenecarboxylic acid"], "smiles": "O=C(O)c1ccccc1", "formula": "C7H6O2"},
    {"name": "glycine", "aliases": ["2-aminoacetic acid"], "smiles": "NCC(=O)O", "formula": "C2H5NO2"},
]

# Reviewed ambiguous chemicals that must prompt the researcher for clarification
_KNOWN_AMBIGUITIES: dict[str, dict[str, Any]] = {
    "xylene": {
        "prompt": "Xylene has three constitutional isomers: ortho-xylene, meta-xylene, and para-xylene. Which isomer would you like to create?",
        "alternatives": [
            {"name": "o-xylene", "smiles": "Cc1ccccc1C", "formula": "C8H10", "description": "1,2-dimethylbenzene (ortho-xylene)"},
            {"name": "m-xylene", "smiles": "Cc1cccc(C)c1", "formula": "C8H10", "description": "1,3-dimethylbenzene (meta-xylene)"},
            {"name": "p-xylene", "smiles": "Cc1ccc(C)cc1", "formula": "C8H10", "description": "1,4-dimethylbenzene (para-xylene)"},
        ],
    },
    "xylenes": {
        "prompt": "Xylene has three constitutional isomers: ortho-xylene, meta-xylene, and para-xylene. Which isomer would you like to create?",
        "alternatives": [
            {"name": "o-xylene", "smiles": "Cc1ccccc1C", "formula": "C8H10", "description": "1,2-dimethylbenzene (ortho-xylene)"},
            {"name": "m-xylene", "smiles": "Cc1cccc(C)c1", "formula": "C8H10", "description": "1,3-dimethylbenzene (meta-xylene)"},
            {"name": "p-xylene", "smiles": "Cc1ccc(C)cc1", "formula": "C8H10", "description": "1,4-dimethylbenzene (para-xylene)"},
        ],
    },
    "butanol": {
        "prompt": "Butanol has multiple constitutional isomers: 1-butanol, 2-butanol, isobutanol, or tert-butanol. Which isomer would you like to create?",
        "alternatives": [
            {"name": "1-butanol", "smiles": "CCCCO", "formula": "C4H10O", "description": "butan-1-ol (n-butanol)"},
            {"name": "2-butanol", "smiles": "CCC(C)O", "formula": "C4H10O", "description": "butan-2-ol (sec-butanol)"},
            {"name": "isobutanol", "smiles": "CC(C)CO", "formula": "C4H10O", "description": "2-methylpropan-1-ol"},
            {"name": "tert-butanol", "smiles": "CC(C)(C)O", "formula": "C4H10O", "description": "2-methylpropan-2-ol"},
        ],
    },
    "propanol": {
        "prompt": "Propanol can refer to 1-propanol or 2-propanol (isopropanol). Which isomer should be generated?",
        "alternatives": [
            {"name": "1-propanol", "smiles": "CCCO", "formula": "C3H8O", "description": "propan-1-ol"},
            {"name": "2-propanol", "smiles": "CC(C)O", "formula": "C3H8O", "description": "propan-2-ol (isopropanol)"},
        ],
    },
    "butene": {
        "prompt": "Butene has several constitutional and stereochemical isomers. Which isomer would you like to create?",
        "alternatives": [
            {"name": "1-butene", "smiles": "CCC=C", "formula": "C4H8", "description": "but-1-ene"},
            {"name": "cis-2-butene", "smiles": "C/C=C\\C", "formula": "C4H8", "description": "(Z)-but-2-ene"},
            {"name": "trans-2-butene", "smiles": "C/C=C/C", "formula": "C4H8", "description": "(E)-but-2-ene"},
            {"name": "isobutene", "smiles": "CC(=C)C", "formula": "C4H8", "description": "2-methylprop-1-ene"},
        ],
    },
    "dichloroethane": {
        "prompt": "Dichloroethane has two constitutional isomers: 1,1-dichloroethane and 1,2-dichloroethane. Which isomer would you like to create?",
        "alternatives": [
            {"name": "1,1-dichloroethane", "smiles": "CC(Cl)Cl", "formula": "C2H4Cl2", "description": "1,1-dichloroethane"},
            {"name": "1,2-dichloroethane", "smiles": "ClCCCl", "formula": "C2H4Cl2", "description": "1,2-dichloroethane"},
        ],
    },
    "tartaric acid": {
        "prompt": "Tartaric acid has three stereoisomers: (2R,3R)-tartaric acid, (2S,3S)-tartaric acid, and meso-tartaric acid. Which stereoisomer do you require?",
        "alternatives": [
            {"name": "(2R,3R)-tartaric acid", "smiles": "O=C(O)[C@@H](O)[C@@H](O)C(=O)O", "formula": "C4H6O6", "description": "L-(+)-tartaric acid (dextrorotatory)"},
            {"name": "(2S,3S)-tartaric acid", "smiles": "O=C(O)[C@H](O)[C@H](O)C(=O)O", "formula": "C4H6O6", "description": "D-(-)-tartaric acid (levorotatory)"},
            {"name": "meso-tartaric acid", "smiles": "O=C(O)[C@@H](O)[C@H](O)C(=O)O", "formula": "C4H6O6", "description": "achiral meso-tartaric acid"},
        ],
    },
    "2-butanol": {
        "prompt": "2-Butanol has two enantiomers: (2R)-2-butanol and (2S)-2-butanol. Which stereoisomer would you like to create?",
        "alternatives": [
            {"name": "(2R)-butan-2-ol", "smiles": "CC[C@@H](C)O", "formula": "C4H10O", "description": "(R)-(-)-2-butanol"},
            {"name": "(2S)-butan-2-ol", "smiles": "CC[C@H](C)O", "formula": "C4H10O", "description": "(S)-(+)-2-butanol"},
        ],
    },
}


def _parse_smiles_quiet(text: str) -> Chem.Mol | None:
    """Parse user text that may be an ordinary word without flooding the log with RDKit errors."""
    with rdBase.BlockLogs():
        return Chem.MolFromSmiles(text)


def _normalize_name(name: str) -> str:
    cleaned = name.strip().lower()
    cleaned = re.sub(r"[\s\-_]+", " ", cleaned)
    return cleaned


def _build_catalogue_index() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    exact_index: dict[str, dict[str, Any]] = {}
    normalized_index: dict[str, dict[str, Any]] = {}
    for entry in _CATALOGUE_DEFINITIONS:
        exact_index[entry["name"].lower()] = entry
        normalized_index[_normalize_name(entry["name"])] = entry
        for alias in entry.get("aliases", []):
            exact_index[alias.lower()] = entry
            normalized_index[_normalize_name(alias)] = entry
    return exact_index, normalized_index


_CATALOGUE_EXACT, _CATALOGUE_NORMALIZED = _build_catalogue_index()

# Every alternative offered in a clarification must itself be resolvable by name, otherwise picking
# one just loops. Extra spellings are reviewed synonyms of the same single graph.
_ALTERNATIVE_SYNONYMS: dict[str, tuple[str, ...]] = {
    "o-xylene": ("ortho-xylene", "1,2-dimethylbenzene", "1,2-xylene"),
    "m-xylene": ("meta-xylene", "1,3-dimethylbenzene", "1,3-xylene"),
    "p-xylene": ("para-xylene", "1,4-dimethylbenzene", "1,4-xylene"),
    "1-butanol": ("n-butanol", "butan-1-ol"),
    "2-propanol": ("isopropanol", "isopropyl alcohol", "propan-2-ol"),
    "1-propanol": ("n-propanol", "propan-1-ol"),
}


def _build_alternative_index() -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for ambiguity in _KNOWN_AMBIGUITIES.values():
        for alt in ambiguity["alternatives"]:
            entry = {"name": alt["name"], "smiles": alt["smiles"], "formula": alt["formula"]}
            for label in (alt["name"], *_ALTERNATIVE_SYNONYMS.get(alt["name"], ())):
                index[_normalize_name(label)] = entry
    return index


_ALTERNATIVE_NORMALIZED = _build_alternative_index()


def validate_molecular_graph(mol: Chem.Mol) -> tuple[bool, str | None, dict[str, Any]]:
    """Strict RDKit validation for single-molecule, closed-shell organic graphs."""
    if mol is None:
        return False, "Invalid molecular structure (could not be parsed).", {}

    # Disconnected components / salts check
    frags = Chem.GetMolFrags(mol)
    if len(frags) > 1:
        return False, "Multi-component mixtures, salts, and disconnected graphs are not supported.", {}

    # Heavy atom count
    num_heavy = mol.GetNumHeavyAtoms()
    if num_heavy == 0:
        return False, "Molecular structure has no heavy atoms.", {}
    if num_heavy > MAX_HEAVY_ATOMS:
        return False, f"Heavy atom count ({num_heavy}) exceeds maximum limit ({MAX_HEAVY_ATOMS}).", {}

    # Element validation
    for atom in mol.GetAtoms():
        atomic_num = atom.GetAtomicNum()
        if atomic_num not in SUPPORTED_ELEMENTS:
            return False, f"Element {atom.GetSymbol()} (atomic number {atomic_num}) is not in supported elements.", {}

    # Charge and spin validation (closed-shell neutral only for Batch A)
    total_charge = Chem.GetFormalCharge(mol)
    if total_charge != 0:
        return False, f"Non-neutral charge ({total_charge:+d}) is not supported for Batch A conformer generation.", {}

    # Radical electrons check
    num_radicals = sum(atom.GetNumRadicalElectrons() for atom in mol.GetAtoms())
    if num_radicals > 0:
        return False, "Open-shell radical molecules are not supported for singlet conformer generation.", {}

    # Stereochemistry detection
    centers = Chem.FindMolChiralCenters(mol, includeUnassigned=True)
    if not centers:
        stereo_status: Literal["NONE", "SPECIFIED", "AMBIGUOUS"] = "NONE"
    else:
        has_unassigned = any(center[1] == "?" for center in centers)
        stereo_status = "AMBIGUOUS" if has_unassigned else "SPECIFIED"

    canon_smiles = Chem.MolToSmiles(mol, isomericSmiles=True)
    formula = CalcMolFormula(mol)

    return True, None, {
        "canonical_isomeric_smiles": canon_smiles,
        "formula": formula,
        "stereo_status": stereo_status,
        "heavy_atom_count": num_heavy,
    }


def _resolve_from_pubchem(name: str, timeout: float = 3.0) -> ResolvedMoleculeIdentity | None:
    """Bounded, SSRF-safe lookup via PubChem PUG-REST API."""
    encoded_name = urllib.parse.quote(name.strip())
    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{encoded_name}/property/IsomericSMILES,CanonicalSMILES,MolecularFormula/JSON"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "ChemDFT-AIScientist/1.0 (scientific-research)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            payload = json.loads(resp.read().decode("utf-8"))
            properties = payload.get("PropertyTable", {}).get("Properties", [])
            if not properties or len(properties) != 1:
                # Ambiguous or no results
                return None
            prop = properties[0]
            smiles = prop.get("IsomericSMILES") or prop.get("CanonicalSMILES")
            if not smiles:
                return None

            mol = Chem.MolFromSmiles(smiles)
            if mol is None:
                return None
            valid, reason, info = validate_molecular_graph(mol)
            if not valid:
                return None

            source_hash = _compute_hash({
                "source": "PUBCHEM",
                "cid": prop.get("CID"),
                "smiles": info["canonical_isomeric_smiles"],
                "formula": info["formula"],
            })
            return ResolvedMoleculeIdentity(
                name=name.strip().lower(),
                canonical_isomeric_smiles=info["canonical_isomeric_smiles"],
                formula=info["formula"],
                charge=0,
                multiplicity=1,
                stereo_status=info["stereo_status"],
                identity_source="PUBCHEM",
                source_hash=source_hash,
                heavy_atom_count=info["heavy_atom_count"],
            )
    except (URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def resolve_molecule_identity(
    query: str,
    *,
    allow_smiles: bool = True,
    allow_pubchem: bool = False,
    pubchem_timeout: float = 3.0,
) -> IdentityResolutionResult:
    """Resolves chemical query to a verified identity or requests clarification."""
    trimmed = query.strip()
    if not trimmed:
        return IdentityResolutionResult(
            resolved=False,
            diagnostics=("Empty query provided.",),
        )

    lower = trimmed.lower()
    norm = _normalize_name(trimmed)

    # 1. Check known ambiguous chemicals first
    if lower in _KNOWN_AMBIGUITIES or norm in _KNOWN_AMBIGUITIES:
        ambig = _KNOWN_AMBIGUITIES.get(lower) or _KNOWN_AMBIGUITIES[norm]
        alts = tuple(
            AmbiguousMoleculeCandidate(
                name=a["name"],
                canonical_isomeric_smiles=a["smiles"],
                formula=a["formula"],
                description=a["description"],
            )
            for a in ambig["alternatives"]
        )
        return IdentityResolutionResult(
            resolved=False,
            alternatives=alts,
            clarification_required=True,
            clarification_prompt=ambig["prompt"],
            diagnostics=(f"Chemical identity '{trimmed}' is ambiguous across multiple isomers.",),
        )

    # 2. Check deterministic reviewed catalogue
    cat_entry = (
        _CATALOGUE_EXACT.get(lower)
        or _CATALOGUE_NORMALIZED.get(norm)
        or _ALTERNATIVE_NORMALIZED.get(norm)
    )
    if cat_entry is not None and allow_smiles:
        # A string that is both a catalogue name/symbol and a different valid SMILES (e.g. "CO":
        # carbon monoxide vs methanol) is ambiguous; never pick one silently.
        as_smiles = _parse_smiles_quiet(trimmed)
        if as_smiles is not None:
            smiles_graph = Chem.MolToSmiles(as_smiles, isomericSmiles=True)
            catalogue_mol = Chem.MolFromSmiles(cat_entry["smiles"])
            if catalogue_mol is not None and smiles_graph != Chem.MolToSmiles(
                catalogue_mol, isomericSmiles=True
            ):
                return IdentityResolutionResult(
                    resolved=False,
                    alternatives=(
                        AmbiguousMoleculeCandidate(
                            name=cat_entry["name"],
                            canonical_isomeric_smiles=Chem.MolToSmiles(
                                catalogue_mol, isomericSmiles=True
                            ),
                            formula=cat_entry["formula"],
                            description=f"'{trimmed}' read as the name/symbol of {cat_entry['name']}",
                        ),
                        AmbiguousMoleculeCandidate(
                            name=trimmed,
                            canonical_isomeric_smiles=smiles_graph,
                            formula=CalcMolFormula(as_smiles),
                            description=f"'{trimmed}' read as an explicit SMILES string",
                        ),
                    ),
                    clarification_required=True,
                    clarification_prompt=(
                        f"'{trimmed}' could be the name of {cat_entry['name']} or a SMILES string "
                        "for a different molecule. Which did you mean?"
                    ),
                    diagnostics=(f"'{trimmed}' is ambiguous between a name and a SMILES string.",),
                )
    if cat_entry is not None:
        mol = Chem.MolFromSmiles(cat_entry["smiles"])
        valid, reason, info = validate_molecular_graph(mol)
        if not valid:
            return IdentityResolutionResult(
                resolved=False,
                diagnostics=(f"Catalogue entry failed graph validation: {reason}",),
            )
        source_hash = _compute_hash({
            "source": "REVIEWED_CATALOGUE",
            "name": cat_entry["name"],
            "smiles": info["canonical_isomeric_smiles"],
            "formula": info["formula"],
        })
        identity = ResolvedMoleculeIdentity(
            name=cat_entry["name"],
            canonical_isomeric_smiles=info["canonical_isomeric_smiles"],
            formula=info["formula"],
            charge=0,
            multiplicity=1,
            stereo_status=info["stereo_status"],
            identity_source="REVIEWED_CATALOGUE",
            source_hash=source_hash,
            heavy_atom_count=info["heavy_atom_count"],
        )
        return IdentityResolutionResult(
            resolved=True,
            identity=identity,
        )

    # 3. Check explicit SMILES if allowed
    if allow_smiles:
        # Avoid treating ordinary plain English words as SMILES unless valid
        # A simple check: if trimmed looks like SMILES or can be parsed cleanly
        parsed_mol = _parse_smiles_quiet(trimmed)
        if parsed_mol is not None:
            valid, reason, info = validate_molecular_graph(parsed_mol)
            if valid:
                if info["stereo_status"] == "AMBIGUOUS":
                    # Unspecified chiral centers in SMILES
                    return IdentityResolutionResult(
                        resolved=False,
                        clarification_required=True,
                        clarification_prompt=f"The structure '{trimmed}' contains stereocenters with unspecified stereochemistry. Please specify isomeric configuration (e.g. using @ or @@).",
                        diagnostics=("Structure contains unspecified chiral stereocenters.",),
                    )
                source_hash = _compute_hash({
                    "source": "EXPLICIT_SMILES",
                    "smiles": info["canonical_isomeric_smiles"],
                    "formula": info["formula"],
                })
                identity = ResolvedMoleculeIdentity(
                    name=trimmed,
                    canonical_isomeric_smiles=info["canonical_isomeric_smiles"],
                    formula=info["formula"],
                    charge=0,
                    multiplicity=1,
                    stereo_status=info["stereo_status"],
                    identity_source="EXPLICIT_SMILES",
                    source_hash=source_hash,
                    heavy_atom_count=info["heavy_atom_count"],
                )
                return IdentityResolutionResult(
                    resolved=True,
                    identity=identity,
                )

    # 4. Optional bounded PubChem lookup
    if allow_pubchem:
        pubchem_identity = _resolve_from_pubchem(trimmed, timeout=pubchem_timeout)
        if pubchem_identity is not None:
            return IdentityResolutionResult(
                resolved=True,
                identity=pubchem_identity,
            )

    # 5. Unresolved
    return IdentityResolutionResult(
        resolved=False,
        clarification_required=True,
        clarification_prompt=f"Could not unambiguously resolve chemical identity for '{trimmed}'. Please provide a valid explicit SMILES or choose a known compound.",
        diagnostics=(f"Unrecognized chemical name or unsupported molecular structure: '{trimmed}'.",),
    )
