from pytest import approx, raises

from embedding_eval.models import MODEL_CANDIDATES
from embedding_eval.retrieval_policy import (
    RRF_K,
    abstention_signals,
    average_precision,
    binary_auc,
    exact_match_signals,
    reciprocal_rank_fusion,
    semantic_with_exact_boost,
    split_isolated,
    threshold_metrics,
)


def test_rrf_is_correct_and_uses_one_predeclared_k() -> None:
    ranked, scores = reciprocal_rank_fusion(["a", "b", "c"], ["b", "a", "d"], k=RRF_K)
    assert ranked == ["a", "b", "c", "d"]
    assert scores["a"] == 1 / 61 + 1 / 62
    assert scores["b"] == 1 / 62 + 1 / 61
    assert RRF_K == 60


def test_rrf_does_not_depend_on_incompatible_raw_score_scales() -> None:
    semantic_a = ["a", "b", "c"]
    lexical_a = ["b", "a", "c"]
    semantic_b = ["a", "b", "c"]  # Any monotonic score transform preserves this order.
    lexical_b = ["b", "a", "c"]
    assert (
        reciprocal_rank_fusion(semantic_a, lexical_a)[0]
        == reciprocal_rank_fusion(semantic_b, lexical_b)[0]
    )


def test_exact_signals_recognize_doi_formula_and_numeric_units() -> None:
    signals = exact_match_signals(
        "Compare 10.1234/AbC-7, Cr2O3 at 4.958 Å with B3LYP/def2-TZVP",
        "The DOI 10.1234/abc-7 reports Cr2O3; a = 4.958 Å. B3LYP/def2-TZVP was used.",
    )
    assert signals["doi_matches"] == ["10.1234/abc-7"]
    assert signals["formula_matches"] == ["Cr2O3"]
    assert signals["numeric_unit_matches"] == ["4.958 å"]
    assert signals["method_matches"] == ["b3lyp", "def2-tzvp"]
    assert signals["exact_token_overlap"] is True


def test_formula_recognition_is_case_sensitive_and_element_checked() -> None:
    cobalt_formula = exact_match_signals("CoO", "CoO is discussed; CO is different.")
    assert cobalt_formula["formula_matches"] == ["CoO"]
    assert exact_match_signals("Al2(SO4)3", "Al2(SO4)3 was formed.")["formula_matches"] == [
        "Al2(SO4)3"
    ]
    assert exact_match_signals("O2", "O2 is the reactant.")["formula_matches"] == ["O2"]
    assert exact_match_signals("Xx2O", "Xx2O")["formula_matches"] == []


def test_exact_token_boost_only_nudges_a_dense_candidate() -> None:
    ranking, signals = semantic_with_exact_boost(
        "What does 10.1234/paper report?",
        ["semantic-best", "exact-second", "weak-third"],
        {
            "semantic-best": "A related chemistry paper without the DOI.",
            "exact-second": "10.1234/paper provides the reported result.",
            "weak-third": "A distant unrelated passage.",
        },
    )
    assert ranking == ["exact-second", "semantic-best", "weak-third"]
    assert signals["exact-second"]["exact_token_overlap"] is True
    far_ranking, _ = semantic_with_exact_boost(
        "What does 10.1234/paper report?",
        [f"candidate-{index}" for index in range(1, 12)],
        {
            **{f"candidate-{index}": "unrelated text" for index in range(1, 11)},
            "candidate-11": "10.1234/paper appears here",
        },
    )
    assert far_ranking[-1] == "candidate-11"


def test_russian_query_is_preserved_during_exact_matching() -> None:
    query = "Что сообщается о Cr2O3 при 4.958 Å?"
    signals = exact_match_signals(query, "Для Cr2O3 измерено 4.958 Å.")
    assert signals["formula_matches"] == ["Cr2O3"]
    assert signals["numeric_unit_matches"] == ["4.958 å"]


def test_abstention_signals_are_features_not_probabilities() -> None:
    result = abstention_signals(
        {"a": 0.91, "b": 0.72, "c": 0.31},
        {"b": 0.9, "a": 0.5, "c": 0.1},
        {"a": "doc-1", "b": "doc-1", "c": "doc-2"},
        {"a": "B3LYP results", "b": "B3LYP results", "c": "other"},
        "What were the B3LYP results?",
    )
    assert result["top1_dense_score"] == 0.91
    assert result["top1_top2_margin"] == approx(0.19)
    assert result["top1_lexical_rank"] == 2
    assert result["semantic_lexical_agreement"] is False
    assert result["top5_document_diversity"] == 2 / 3
    assert result["top1_exact_token_overlap"] is True


def test_abstention_metrics_and_missing_class_behavior() -> None:
    labels = [True, True, False, False]
    scores = [0.9, 0.4, 0.7, 0.1]
    assert binary_auc(labels, scores) == 0.75
    assert average_precision(labels, scores) == approx(5 / 6)
    rows = threshold_metrics(labels, scores, [0.5])
    assert rows[0]["false_answer_rate"] == 0.5
    assert rows[0]["no_answer_recall"] == 0.5
    assert rows[0]["accepted_answer_precision"] == approx(1 / 2)
    assert rows[0]["abstention_rate"] == 0.5
    assert binary_auc([True, True], [0.1, 0.9]) is None
    assert average_precision([False, False], [0.1, 0.9]) is None


def test_split_is_deterministic_stratified_and_disjoint() -> None:
    rows = [
        {
            "query_id": f"q-{index:02}",
            "no_answer": index % 4 == 0,
            "query_class": "negative" if index % 4 == 0 else "numeric",
        }
        for index in range(20)
    ]
    development, holdout = split_isolated(rows, holdout_fraction=0.25, seed=17)
    again = split_isolated(rows, holdout_fraction=0.25, seed=17)
    assert [row["query_id"] for row in development] == [row["query_id"] for row in again[0]]
    assert [row["query_id"] for row in holdout] == [row["query_id"] for row in again[1]]
    assert not {row["query_id"] for row in development} & {row["query_id"] for row in holdout}
    assert len(development) + len(holdout) == len(rows)
    assert {row["no_answer"] for row in development} == {False, True}
    assert {row["no_answer"] for row in holdout} == {False, True}


def test_split_keeps_leakage_groups_together() -> None:
    rows = [
        {
            "query_id": f"q-{index:02}",
            "no_answer": False,
            "query_class": "numeric_value",
            "leakage_group_id": "translated-pair" if index in {0, 1} else f"q-{index:02}",
        }
        for index in range(12)
    ]
    development, holdout = split_isolated(rows, holdout_fraction=0.25, seed=23)
    partitions = {
        row["query_id"]: name
        for name, partition in (("dev", development), ("holdout", holdout))
        for row in partition
    }
    assert partitions["q-00"] == partitions["q-01"]


def test_split_rejects_duplicate_query_ids_and_mixed_answerability_groups() -> None:
    duplicate = [{"query_id": "q1"}, {"query_id": "q1"}]
    with raises(ValueError, match="Duplicate query_id"):
        split_isolated(duplicate)
    mixed = [
        {"query_id": "q1", "no_answer": False, "query_class": "semantic", "leakage_group_id": "g"},
        {"query_id": "q2", "no_answer": True, "query_class": "semantic", "leakage_group_id": "g"},
    ]
    with raises(ValueError, match="mixes answerability"):
        split_isolated(mixed)


def test_split_keeps_cross_class_translation_group_together() -> None:
    rows = [
        {
            "query_id": f"q-{index:02}",
            "no_answer": False,
            "query_class": "formula" if index == 0 else "cross_language",
            "language": "en" if index == 0 else "ru",
            "leakage_group_id": "answer-ce-zr-ratio" if index < 2 else f"q-{index:02}",
        }
        for index in range(30)
    ]
    development, holdout = split_isolated(rows, holdout_fraction=0.3, seed=20260924)
    partitions = {
        row["query_id"]: label
        for label, members in (("DEV", development), ("HOLDOUT", holdout))
        for row in members
    }
    assert partitions["q-00"] == partitions["q-01"]
    assert len(development) + len(holdout) == len(rows)
    assert abs(len(holdout) - 9) <= 1


def test_production_embedding_configuration_is_unchanged() -> None:
    assert MODEL_CANDIDATES["bge-m3"] == {
        "repository": "BAAI/bge-m3",
        "revision": "5617a9f61b028005a4858fdac845db406aefb181",
        "license": "MIT",
        "dimension": 1024,
        "query_prefix": "",
        "document_prefix": "",
    }
