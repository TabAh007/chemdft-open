from embedding_eval.molecules import (
    MOLECULES,
    build_morgan_fingerprints,
    canonical_model_smiles,
    molecular_metrics,
)


def test_molecular_dataset_has_duplicates_stereo_salts_and_varied_scaffolds() -> None:
    categories = {item.category for item in MOLECULES}

    assert {"duplicate", "stereoisomer", "salt", "heterocycle", "unrelated"} <= categories
    assert len(MOLECULES) >= 20


def test_morgan_fingerprint_reference_finds_equivalent_smiles() -> None:
    fingerprints = build_morgan_fingerprints()
    assert fingerprints["ethanol"] == fingerprints["ethanol_alt"]
    canonical = canonical_model_smiles()
    assert canonical[0] == canonical[1]


def test_molecular_metrics_are_bounded_and_report_duplicate_retrieval() -> None:
    vectors = {item.id: (1.0, 0.0) for item in MOLECULES}
    result = molecular_metrics(MOLECULES, vectors, k=5)

    assert 0 <= result["duplicate_recall_at_5"] <= 1
    assert 0 <= result["scaffold_recall_at_5"] <= 1
    assert result["pairwise_spearman"] <= 1
    assert result["stereoisomer_mean_model_similarity"] == 1.0
