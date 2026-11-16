from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
import statistics
from typing import Any, Callable


@dataclass(frozen=True)
class Molecule:
    id: str
    smiles: str
    category: str
    scaffold: str
    duplicate_group: str | None = None


MOLECULES = (
    Molecule("ethanol", "CCO", "duplicate", "acyclic", "ethanol"),
    Molecule("ethanol_alt", "OCC", "duplicate", "acyclic", "ethanol"),
    Molecule("methanol", "CO", "analogue", "acyclic"),
    Molecule("ethylamine", "CCN", "analogue", "acyclic"),
    Molecule("acetone", "CC(=O)C", "analogue", "acyclic"),
    Molecule("acetic_acid", "CC(=O)O", "analogue", "acyclic"),
    Molecule("benzene", "c1ccccc1", "scaffold", "benzene"),
    Molecule("toluene", "Cc1ccccc1", "analogue", "benzene"),
    Molecule("phenol", "Oc1ccccc1", "analogue", "benzene"),
    Molecule("aniline", "Nc1ccccc1", "analogue", "benzene"),
    Molecule("chlorobenzene", "Clc1ccccc1", "analogue", "benzene"),
    Molecule("cyclohexane", "C1CCCCC1", "scaffold", "cyclohexane"),
    Molecule("methylcyclohexane", "CC1CCCCC1", "analogue", "cyclohexane"),
    Molecule("pyridine", "c1ccncc1", "heterocycle", "pyridine"),
    Molecule("pyrimidine", "c1nccnc1", "heterocycle", "diazine"),
    Molecule("imidazole", "c1ncc[nH]1", "heterocycle", "imidazole"),
    Molecule("caffeine", "Cn1c(=O)c2c(ncn2C)n(C)c1=O", "heterocycle", "xanthine"),
    Molecule("lactic_r", "C[C@H](O)C(=O)O", "stereoisomer", "lactic_acid"),
    Molecule("lactic_s", "C[C@@H](O)C(=O)O", "stereoisomer", "lactic_acid"),
    Molecule("alanine_l", "C[C@@H](N)C(=O)O", "stereoisomer", "alanine"),
    Molecule("alanine_d", "C[C@H](N)C(=O)O", "stereoisomer", "alanine"),
    Molecule("sodium_acetate", "CC(=O)[O-].[Na+]", "salt", "acetate"),
    Molecule("acetate_anion", "CC(=O)[O-]", "salt", "acetate"),
    Molecule("ammonium", "[NH4+]", "charged", "ion"),
    Molecule("nitrate", "[O-][N+](=O)O", "charged", "ion"),
    Molecule("propane", "CCC", "unrelated", "acyclic"),
    Molecule("acetylene", "C#C", "unrelated", "acyclic"),
    Molecule(
        "ferrocene_like_fragment", "c1ccc[cH-]1.[Fe+2].c1ccc[cH-]1", "unrelated", "organometallic"
    ),
)


def _rdkit() -> Any:
    from rdkit import Chem
    from rdkit.Chem import AllChem

    return Chem, AllChem


def build_morgan_fingerprints() -> dict[str, Any]:
    Chem, AllChem = _rdkit()
    output: dict[str, Any] = {}
    for item in MOLECULES:
        molecule = Chem.MolFromSmiles(item.smiles)
        if molecule is None:
            raise ValueError(f"Invalid benchmark SMILES for {item.id}.")
        output[item.id] = AllChem.GetMorganGenerator(
            radius=2,
            fpSize=2048,
            includeChirality=True,
        ).GetFingerprint(molecule)
    return output


def canonical_model_smiles() -> list[str]:
    """Use one canonical, non-isomeric form so alternate SMILES test molecule identity."""
    from rdkit import Chem

    output = []
    for item in MOLECULES:
        molecule = Chem.MolFromSmiles(item.smiles)
        if molecule is None:
            raise ValueError(f"Invalid benchmark SMILES for {item.id}.")
        output.append(Chem.MolToSmiles(molecule, canonical=True, isomericSmiles=False))
    return output


def _cosine(left: tuple[float, ...], right: tuple[float, ...]) -> float:
    if len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    norm = sqrt(sum(a * a for a in left) * sum(b * b for b in right))
    return dot / norm if norm else 0.0


def _morgan_scaffolds(molecules: tuple[Molecule, ...]) -> dict[str, str]:
    from rdkit import Chem
    from rdkit.Chem.Scaffolds import MurckoScaffold

    output = {}
    for item in molecules:
        molecule = Chem.MolFromSmiles(item.smiles)
        scaffold = MurckoScaffold.GetScaffoldForMol(molecule)
        output[item.id] = (
            Chem.MolToSmiles(scaffold, canonical=True) if scaffold.GetNumAtoms() else ""
        )
    return output


def _rank_correlation(left: list[float], right: list[float]) -> float:
    if len(left) < 2:
        return 0.0

    def ranks(values: list[float]) -> list[float]:
        order = sorted(range(len(values)), key=values.__getitem__)
        result = [0.0] * len(values)
        cursor = 0
        while cursor < len(order):
            end = cursor + 1
            while end < len(order) and values[order[end]] == values[order[cursor]]:
                end += 1
            rank = (cursor + 1 + end) / 2
            for index in order[cursor:end]:
                result[index] = rank
            cursor = end
        return result

    x, y = ranks(left), ranks(right)
    mean_x, mean_y = sum(x) / len(x), sum(y) / len(y)
    cov = sum((a - mean_x) * (b - mean_y) for a, b in zip(x, y, strict=True))
    var_x = sum((a - mean_x) ** 2 for a in x)
    var_y = sum((b - mean_y) ** 2 for b in y)
    return cov / sqrt(var_x * var_y) if var_x and var_y else 0.0


def molecular_metrics(
    molecules: tuple[Molecule, ...],
    vectors: dict[str, tuple[float, ...]],
    k: int = 5,
    similarity_fn: Callable[[str, str], float] | None = None,
) -> dict[str, float]:
    fingerprints = build_morgan_fingerprints()
    from rdkit import DataStructs

    duplicate_hits_at_1 = duplicate_hits_at_5 = possible_duplicates = 0
    scaffold_hits_at_1 = scaffold_hits_at_5 = possible_scaffold_queries = 0
    nearest_neighbor_matches = 0
    embedding_sims: list[float] = []
    fingerprint_sims: list[float] = []
    scaffold_by_id = _morgan_scaffolds(molecules)
    embedding_similarity = similarity_fn or (
        lambda left_id, right_id: _cosine(vectors[left_id], vectors[right_id])
    )
    for query in molecules:
        candidates = [item for item in molecules if item.id != query.id]
        ranked = sorted(
            candidates,
            key=lambda item: embedding_similarity(query.id, item.id),
            reverse=True,
        )
        fingerprint_ranked = sorted(
            candidates,
            key=lambda item: DataStructs.TanimotoSimilarity(
                fingerprints[query.id], fingerprints[item.id]
            ),
            reverse=True,
        )
        nearest_neighbor_matches += int(ranked[0].id == fingerprint_ranked[0].id)
        duplicate_targets = [
            item
            for item in candidates
            if query.duplicate_group is not None and item.duplicate_group == query.duplicate_group
        ]
        if duplicate_targets:
            possible_duplicates += 1
            duplicate_ids = {item.id for item in duplicate_targets}
            duplicate_hits_at_1 += int(any(item.id in duplicate_ids for item in ranked[:1]))
            duplicate_hits_at_5 += int(any(item.id in duplicate_ids for item in ranked[:k]))
        scaffold = scaffold_by_id[query.id]
        scaffold_targets = [
            item for item in candidates if scaffold and scaffold_by_id[item.id] == scaffold
        ]
        if scaffold_targets:
            possible_scaffold_queries += 1
            scaffold_ids = {item.id for item in scaffold_targets}
            scaffold_hits_at_1 += int(any(item.id in scaffold_ids for item in ranked[:1]))
            scaffold_hits_at_5 += int(any(item.id in scaffold_ids for item in ranked[:k]))
        for other in candidates:
            embedding_sims.append(embedding_similarity(query.id, other.id))
            fingerprint_sims.append(
                DataStructs.TanimotoSimilarity(fingerprints[query.id], fingerprints[other.id])
            )
    return {
        "duplicate_recall_at_1": duplicate_hits_at_1 / possible_duplicates
        if possible_duplicates
        else 0.0,
        "duplicate_recall_at_5": duplicate_hits_at_5 / possible_duplicates
        if possible_duplicates
        else 0.0,
        "scaffold_recall_at_1": scaffold_hits_at_1 / possible_scaffold_queries
        if possible_scaffold_queries
        else 0.0,
        "scaffold_recall_at_5": scaffold_hits_at_5 / possible_scaffold_queries
        if possible_scaffold_queries
        else 0.0,
        "nearest_neighbor_consistency": nearest_neighbor_matches / len(molecules),
        "pairwise_spearman": _rank_correlation(embedding_sims, fingerprint_sims),
        "stereoisomer_mean_model_similarity": statistics.mean(
            embedding_similarity(left, right)
            for left, right in (("lactic_r", "lactic_s"), ("alanine_l", "alanine_d"))
        ),
        "stereoisomer_mean_morgan_tanimoto": statistics.mean(
            DataStructs.TanimotoSimilarity(fingerprints[left], fingerprints[right])
            for left, right in (("lactic_r", "lactic_s"), ("alanine_l", "alanine_d"))
        ),
    }
