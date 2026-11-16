from __future__ import annotations

from dataclasses import asdict, dataclass

from rdkit import Chem, rdBase
from rdkit.Chem import rdFMCS, rdMolDescriptors


@dataclass(frozen=True)
class PredictionScore:
    parse_state: str
    graph_match: bool | None
    connectivity_match: bool | None
    stereochemistry_match: bool | None
    formula_match: bool | None
    charge_match: bool | None
    atom_precision: float | None
    atom_recall: float | None
    atom_f1: float | None
    bond_precision: float | None
    bond_recall: float | None
    bond_order_accuracy: float | None
    abstention: str | None
    confident_looking_incorrect: bool
    diagnostics: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        value = asdict(self)
        value["diagnostics"] = list(self.diagnostics)
        return value


def score_prediction(
    ground_truth_smiles: str,
    prediction_smiles: str | None,
    abstention: str | None = None,
) -> PredictionScore:
    with rdBase.BlockLogs():
        truth = Chem.MolFromSmiles(ground_truth_smiles, sanitize=True)
    if truth is None:
        raise ValueError("Ground truth SMILES must parse successfully")
    if not prediction_smiles:
        return PredictionScore(
            "ABSTAINED",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            abstention or "MANUAL_REVIEW_REQUIRED",
            False,
            ("No prediction was supplied",),
        )
    with rdBase.BlockLogs():
        prediction = Chem.MolFromSmiles(prediction_smiles, sanitize=True)
    if prediction is None:
        return PredictionScore(
            "PARSE_FAILED",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            False,
            ("RDKit could not parse/sanitize model output; no repair attempted",),
        )

    truth_noniso = Chem.MolToSmiles(truth, canonical=True, isomericSmiles=False)
    prediction_noniso = Chem.MolToSmiles(prediction, canonical=True, isomericSmiles=False)
    connectivity_match = truth_noniso == prediction_noniso
    truth_iso = Chem.MolToSmiles(truth, canonical=True, isomericSmiles=True)
    prediction_iso = Chem.MolToSmiles(prediction, canonical=True, isomericSmiles=True)
    stereo_match = truth_iso == prediction_iso if connectivity_match else False
    formula_match = rdMolDescriptors.CalcMolFormula(truth) == rdMolDescriptors.CalcMolFormula(
        prediction
    )
    truth_charge = sum(atom.GetFormalCharge() for atom in truth.GetAtoms())
    prediction_charge = sum(atom.GetFormalCharge() for atom in prediction.GetAtoms())
    graph_match = (
        connectivity_match and stereo_match and formula_match and truth_charge == prediction_charge
    )
    if graph_match:
        atom_precision, atom_recall, atom_f1 = 1.0, 1.0, 1.0
        bond_precision, bond_recall, bond_order_accuracy = 1.0, 1.0, 1.0
    else:
        (
            atom_precision,
            atom_recall,
            atom_f1,
            bond_precision,
            bond_recall,
            bond_order_accuracy,
        ) = _overlap_metrics(truth, prediction)
    return PredictionScore(
        "PARSED",
        graph_match,
        connectivity_match,
        stereo_match,
        formula_match,
        truth_charge == prediction_charge,
        atom_precision,
        atom_recall,
        atom_f1,
        bond_precision,
        bond_recall,
        bond_order_accuracy,
        None,
        not graph_match,
        ("Valid-looking incorrect output is a false-positive risk; confidence is not available.",)
        if not graph_match
        else (),
    )


def has_stereochemistry(smiles: str) -> bool:
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        return False
    chiral_centers = Chem.FindMolChiralCenters(molecule, includeUnassigned=True, includeCIP=True)
    bond_stereo = any(
        bond.GetStereo() != Chem.BondStereo.STEREONONE for bond in molecule.GetBonds()
    )
    return bool(chiral_centers) or bond_stereo


def _overlap_metrics(truth: Chem.Mol, prediction: Chem.Mol) -> tuple[float, ...]:
    parameters = rdFMCS.MCSParameters()
    parameters.AtomTyper = rdFMCS.AtomCompare.CompareElements
    parameters.BondTyper = rdFMCS.BondCompare.CompareAny
    parameters.AtomCompareParameters.MatchIsotope = True
    parameters.AtomCompareParameters.MatchFormalCharge = True
    parameters.AtomCompareParameters.RingMatchesRingOnly = True
    parameters.AtomCompareParameters.MatchChiralTag = False
    parameters.BondCompareParameters.RingMatchesRingOnly = True
    parameters.BondCompareParameters.MatchStereo = False
    parameters.Timeout = 2
    result = rdFMCS.FindMCS([truth, prediction], parameters)
    atom_overlap = float(result.numAtoms)
    atom_precision = atom_overlap / prediction.GetNumAtoms() if prediction.GetNumAtoms() else 0.0
    atom_recall = atom_overlap / truth.GetNumAtoms() if truth.GetNumAtoms() else 0.0
    atom_f1 = (
        2 * atom_precision * atom_recall / (atom_precision + atom_recall)
        if atom_precision + atom_recall
        else 0.0
    )
    query = Chem.MolFromSmarts(result.smartsString) if result.numAtoms else None
    if query is None:
        return atom_precision, atom_recall, atom_f1, 0.0, 0.0, 0.0
    truth_match = truth.GetSubstructMatch(query)
    prediction_match = prediction.GetSubstructMatch(query)
    mapped_bonds = 0
    matching_bonds = 0
    for query_bond in query.GetBonds():
        truth_bond = truth.GetBondBetweenAtoms(
            truth_match[query_bond.GetBeginAtomIdx()],
            truth_match[query_bond.GetEndAtomIdx()],
        )
        prediction_bond = prediction.GetBondBetweenAtoms(
            prediction_match[query_bond.GetBeginAtomIdx()],
            prediction_match[query_bond.GetEndAtomIdx()],
        )
        if truth_bond is not None and prediction_bond is not None:
            mapped_bonds += 1
            if truth_bond.GetBondType() == prediction_bond.GetBondType():
                matching_bonds += 1
    truth_bonds = truth.GetNumBonds()
    prediction_bonds = prediction.GetNumBonds()
    precision = mapped_bonds / prediction_bonds if prediction_bonds else 1.0
    recall = mapped_bonds / truth_bonds if truth_bonds else 1.0
    order_accuracy = matching_bonds / mapped_bonds if mapped_bonds else 1.0
    return atom_precision, atom_recall, atom_f1, precision, recall, order_accuracy
