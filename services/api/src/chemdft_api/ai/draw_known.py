# ruff: noqa: E501
"""A small STATIC table of common molecules used to cross-check "draw <name>" requests.

RDKit proves a drawing is chemically valid, not that it is the molecule the researcher named. For the
names in this table the drawn result is compared with the table (formula first, then structure) and a
mismatch is rejected. This is a PARTIAL safeguard limited to the table: a molecule that is not in it is
never checked and keeps the "AI-proposed, verify against a trusted source" label. The table is not a
source of scientific values and is not shown as one. Every entry is verified by a test with RDKit
(SMILES parses, RDKit's formula equals the declared formula).
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

from rdkit import Chem

from .draw import formula_of


@dataclass(frozen=True, slots=True)
class KnownMolecule:
    name: str
    synonyms: tuple[str, ...]
    smiles: str
    formula: str  # declared, cross-checked against RDKit in tests
    # False when several valid drawings exist for one name (glucose ring/chain, stereo): formula only.
    structure_exact: bool = True
    # True for elements whose bare name is ambiguous ("oxygen" = atom or O2): the table matches them only when the
    # request says "molecule" or "gas", or uses the formula name (o2, dioxygen).
    molecule_word_required: bool = False


KNOWN: tuple[KnownMolecule, ...] = (
    KnownMolecule("water", ("h2o",), "O", "H2O"),
    # Elements that exist as diatomic molecules: "a hydrogen molecule" is H-H, never two lone H atoms.
    KnownMolecule("hydrogen", ("h2", "dihydrogen"), "[H][H]", "H2", molecule_word_required=True),
    KnownMolecule("oxygen", ("o2", "dioxygen"), "O=O", "O2", molecule_word_required=True),
    KnownMolecule("nitrogen", ("n2", "dinitrogen"), "N#N", "N2", molecule_word_required=True),
    KnownMolecule("fluorine", ("f2",), "FF", "F2", molecule_word_required=True),
    KnownMolecule("chlorine", ("cl2",), "ClCl", "Cl2", molecule_word_required=True),
    KnownMolecule("methane", ("ch4",), "C", "CH4"),
    KnownMolecule("ethane", (), "CC", "C2H6"),
    KnownMolecule("propane", (), "CCC", "C3H8"),
    KnownMolecule("butane", ("n-butane",), "CCCC", "C4H10"),
    KnownMolecule("ethene", ("ethylene",), "C=C", "C2H4"),
    KnownMolecule("ethanol", ("ethyl alcohol",), "CCO", "C2H6O"),
    KnownMolecule("methanol", ("methyl alcohol",), "CO", "CH4O"),
    KnownMolecule("acetone", ("propanone",), "CC(=O)C", "C3H6O"),
    KnownMolecule("acetic acid", ("ethanoic acid",), "CC(=O)O", "C2H4O2"),
    KnownMolecule("benzene", (), "c1ccccc1", "C6H6"),
    KnownMolecule("toluene", ("methylbenzene",), "Cc1ccccc1", "C7H8"),
    KnownMolecule("phenol", (), "Oc1ccccc1", "C6H6O"),
    KnownMolecule("aniline", ("aminobenzene",), "Nc1ccccc1", "C6H7N"),
    KnownMolecule("ammonia", ("nh3",), "N", "H3N"),
    KnownMolecule("carbon dioxide", ("co2",), "O=C=O", "CO2"),
    KnownMolecule("glucose", ("d-glucose",), "OCC1OC(O)C(O)C(O)C1O", "C6H12O6", False),
    KnownMolecule("caffeine", (), "CN1C=NC2=C1C(=O)N(C(=O)N2C)C", "C8H10N4O2"),
    KnownMolecule("aspirin", ("acetylsalicylic acid",), "CC(=O)Oc1ccccc1C(=O)O", "C9H8O4"),
    KnownMolecule("urea", ("carbamide",), "NC(N)=O", "CH4N2O"),
    KnownMolecule("formaldehyde", ("methanal",), "C=O", "CH2O"),
    KnownMolecule("acetonitrile", ("methyl cyanide",), "CC#N", "C2H3N"),
    KnownMolecule("pentane", ("n-pentane",), "CCCCC", "C5H12"),
    KnownMolecule("hexane", ("n-hexane",), "CCCCCC", "C6H14"),
    KnownMolecule("cyclopentane", (), "C1CCCC1", "C5H10"),
    KnownMolecule("cyclohexane", (), "C1CCCCC1", "C6H12"),
    KnownMolecule("pyridine", (), "c1ccncc1", "C5H5N"),
    KnownMolecule("naphthalene", (), "c1ccc2ccccc2c1", "C10H8"),
    KnownMolecule("benzoic acid", (), "OC(=O)c1ccccc1", "C7H6O2"),
    KnownMolecule("glycine", (), "NCC(=O)O", "C2H5NO2"),
    KnownMolecule("dmso", ("dimethyl sulfoxide", "dimethyl sulphoxide"), "CS(C)=O", "C2H6OS"),
)

_CREATE = (
    r"(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i(?:'d|\s+would|\s+want|\s+need)\s+(?:like\s+)?(?:you\s+to\s+)?|let'?s\s+)?"
    r"(?:draw|make|build|create|generate|produce|sketch|show|give|put|add)(?:\s+me)?"
)
_ARTICLE = r"(?:(?:an?|the|some)\s+)?"
_TAIL_REQUIRED = r"\s+(?:molecules?|gas)"
_TAIL = r"(?:\s+(?:molecules?|structures?|compounds?|gas))?"


def _names(entry: KnownMolecule) -> list[str]:
    return [entry.name, *entry.synonyms]


def requested_molecule(message: str) -> KnownMolecule | None:
    """The table entry when the message is exactly a plain "draw <name>" request, else None.

    Deliberately strict: "add a methyl to phenol" or "draw phenol with a nitro group" name a table
    molecule but ask for something else, so they are never checked (no false rejections).
    """
    text = re.sub(r"[^a-z0-9\- ]+", " ", message.lower())
    text = " ".join(text.split())
    for entry in KNOWN:
        for name in _names(entry):
            tail = _TAIL_REQUIRED if entry.molecule_word_required and name == entry.name else _TAIL
            pattern = rf"^{_CREATE}\s+{_ARTICLE}{re.escape(name)}{tail}$"
            if re.match(pattern, text):
                return entry
    return None


_COUNT_WORDS = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
]
_COUNT_TOKEN = r"(\d{1,3}|" + "|".join(_COUNT_WORDS) + r")"


def known_by_name(name: str) -> KnownMolecule | None:
    key = " ".join(name.lower().split())
    for entry in KNOWN:
        if key in _names(entry):
            return entry
    return None


def requested_copies(message: str) -> tuple[KnownMolecule, int] | None:
    """ "draw 6 water molecules" / "3 ethanol" -> (table entry, count); None for anything else."""
    text = " ".join(re.sub(r"[^a-z0-9\- ]+", " ", message.lower()).split())
    best: tuple[KnownMolecule, int] | None = None
    for entry in KNOWN:
        for name in _names(entry):
            plural = (
                r"s?\s+(?:molecules?|gas)"
                if entry.molecule_word_required and name == entry.name
                else r"(?:s|\s+molecules?)?"
            )
            pattern = (
                rf"(?<![a-z0-9]){_COUNT_TOKEN}\s+(?:x\s+)?(?:(?:separate|individual|identical)\s+)?"
                rf"(?:molecules?\s+of\s+)?{re.escape(name)}{plural}(?![a-z0-9])(?!\s+atoms?)"
            )
            found = re.search(pattern, text)
            if found:
                raw = found.group(1)
                count = int(raw) if raw.isdigit() else _COUNT_WORDS.index(raw)
                if best is None or len(name) > 0:
                    best = (entry, count)
    return best


_CLAIM_VERB = r"(?:drew|replaced\s+(?:it\s+|the\s+drawing\s+)?with|created|built|loaded|made)"


def claimed_molecule(reply: str) -> KnownMolecule | None:
    """The table molecule a reply like "Replaced with ethane." says it drew, else None."""
    text = " ".join(re.sub(r"[^a-z0-9\- ]+", " ", (reply or "").lower()).split())
    best: tuple[int, KnownMolecule] | None = None
    for entry in KNOWN:
        for name in _names(entry):
            matched = re.match(
                rf"^{_CLAIM_VERB}\s+(?:(?:an?|the|one)\s+)?{re.escape(name)}(?![a-z0-9])", text
            )
            if matched and (best is None or len(name) > best[0]):
                best = (len(name), entry)
    return best[1] if best else None


def verify_copies(entry: KnownMolecule, count: int, drawn: Chem.Mol) -> str | None:
    """None when the drawing is exactly ``count`` separate molecules of ``entry`` (count x formula)."""
    expected_formula, expected_smiles = _expected(entry)
    if drawn.GetNumAtoms() == 0:
        return f"the drawing is empty; expected {count} x {expected_formula}"
    fragments = Chem.GetMolFrags(drawn, asMols=True, sanitizeFrags=False)
    formulas = [formula_of(f) for f in fragments]
    matching = sum(
        1
        for frag, formula in zip(fragments, formulas, strict=True)
        if formula == expected_formula
        and (not entry.structure_exact or _plain_smiles(frag) == expected_smiles)
    )
    if len(fragments) == count and matching == count:
        return None
    seen = ", ".join(f"{n} x {f}" for f, n in sorted(Counter(formulas).items()))
    return (
        f"asked for {count} {entry.name} molecule(s) ({count} x {expected_formula}); the drawing has "
        f"{len(fragments)} separate fragment(s) ({seen}), of which {matching} are {entry.name}"
    )


def _plain_smiles(mol: Chem.Mol) -> str:
    copy = Chem.Mol(mol)
    try:
        Chem.SanitizeMol(
            copy
        )  # perceive aromaticity: a Kekulé drawing equals the aromatic reference
        copy = Chem.RemoveHs(copy)
    except Exception:
        return Chem.MolToSmiles(copy, isomericSmiles=False)
    return Chem.MolToSmiles(copy, isomericSmiles=False)


def _expected(entry: KnownMolecule) -> tuple[str, str]:
    ref = Chem.MolFromSmiles(entry.smiles)
    return formula_of(ref), _plain_smiles(ref)


def verify_known(entry: KnownMolecule, drawn: Chem.Mol) -> str | None:
    """None when some connected fragment of the drawing is the named molecule, else the reason."""
    expected_formula, expected_smiles = _expected(entry)
    if drawn.GetNumAtoms() == 0:
        return f"the drawing is empty; expected {entry.name} ({expected_formula})"
    fragments = Chem.GetMolFrags(drawn, asMols=True, sanitizeFrags=False)
    got = []
    for frag in fragments:
        frag_formula = formula_of(frag)
        got.append(frag_formula)
        if frag_formula != expected_formula:
            continue
        if not entry.structure_exact or _plain_smiles(frag) == expected_smiles:
            return None
    seen = ", ".join(got) if got else "nothing"
    if expected_formula in got:
        return (
            f"the drawing has the formula {expected_formula} but not the structure of {entry.name} "
            f"(expected SMILES {entry.smiles})"
        )
    return (
        f"the drawing does not match the expected formula for {entry.name}: "
        f"expected {expected_formula}, got {seen}"
    )


__all__ = [
    "KNOWN",
    "KnownMolecule",
    "claimed_molecule",
    "known_by_name",
    "requested_copies",
    "requested_molecule",
    "verify_copies",
    "verify_known",
]
