from chemdft_reconstruction.cli import _summarize
from chemdft_reconstruction.evaluation import has_stereochemistry, score_prediction


def test_graph_equivalence_ignores_smiles_spelling_but_preserves_stereochemistry():
    equivalent = score_prediction("CCO", "OCC")
    wrong_stereo = score_prediction("N[C@@H](C)O", "N[C@H](C)O")

    assert equivalent.parse_state == "PARSED"
    assert equivalent.graph_match is True
    assert equivalent.stereochemistry_match is True
    assert wrong_stereo.graph_match is False
    assert wrong_stereo.stereochemistry_match is False


def test_invalid_output_and_confident_looking_wrong_output_are_distinct():
    invalid = score_prediction("CCO", "C1(")
    wrong_valid = score_prediction("CCO", "CCN")

    assert invalid.parse_state == "PARSE_FAILED"
    assert invalid.graph_match is None
    assert wrong_valid.parse_state == "PARSED"
    assert wrong_valid.graph_match is False
    assert wrong_valid.confident_looking_incorrect is True


def test_missing_prediction_is_counted_as_abstention_not_parse_failure():
    result = score_prediction("CCO", None, abstention="MANUAL_REVIEW_REQUIRED")

    assert result.parse_state == "ABSTAINED"
    assert result.graph_match is None
    assert result.abstention == "MANUAL_REVIEW_REQUIRED"


def test_stereochemistry_applicability_and_nonoverlapping_graphs_are_measured():
    assert has_stereochemistry("N[C@@H](C)O") is True
    assert has_stereochemistry("CCO") is False
    unrelated = score_prediction("CCO", "[N-]=[N+]=N")
    assert unrelated.graph_match is False
    assert unrelated.atom_f1 == 0


def test_disconnected_salt_component_metrics_are_perfect_for_exact_graphs():
    result = score_prediction("[Na+].[Cl-]", "[Cl-].[Na+]")

    assert result.graph_match is True
    assert result.atom_f1 == 1
    assert result.bond_precision == 1
    assert result.bond_recall == 1


def test_bond_order_mismatch_is_not_normalized_away():
    result = score_prediction("CO", "C=O")

    assert result.graph_match is False
    assert result.bond_precision == 1
    assert result.bond_recall == 1
    assert result.bond_order_accuracy == 0


def test_category_routing_abstains_below_threshold_and_always_requires_review():
    categories = {
        "charged": [
            {
                "ground_truth_smiles": "C",
                "parse_state": "PARSED",
                "graph_match": False,
                "stereochemistry_applicable": False,
                "atom_f1": 0.0,
                "bond_precision": 0.0,
                "bond_recall": 0.0,
                "bond_order_accuracy": 0.0,
                "confident_looking_incorrect": True,
                "valid_output_on_unsupported_input": False,
                "runtime_ms": 1.0,
            }
        ],
        "aromatic": [
            {
                "ground_truth_smiles": "c1ccccc1",
                "parse_state": "PARSED",
                "graph_match": True,
                "stereochemistry_applicable": False,
                "atom_f1": 1.0,
                "bond_precision": 1.0,
                "bond_recall": 1.0,
                "bond_order_accuracy": 1.0,
                "confident_looking_incorrect": False,
                "valid_output_on_unsupported_input": False,
                "runtime_ms": 1.0,
            }
        ],
    }

    summary = {row["category"]: row for row in _summarize(categories)}

    assert summary["charged"]["recommendation"] == "ABSTAIN / UNSUPPORTED"
    assert summary["aromatic"]["recommendation"] == "GOOD ONLY WITH HUMAN REVIEW"
