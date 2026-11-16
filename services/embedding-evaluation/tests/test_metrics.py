from embedding_eval.metrics import ranking_metrics, source_page_hit
from embedding_eval.corpus import DOCUMENTS


def test_ranking_metrics_use_relevant_ids_and_reciprocal_rank() -> None:
    result = ranking_metrics(["a", "x", "b", "c"], {"b", "c"})

    assert result["recall_at_1"] == 0.0
    assert result["recall_at_3"] == 0.5
    assert result["recall_at_5"] == 1.0
    assert result["mrr"] == 1 / 3


def test_source_page_hit_requires_both_source_and_page() -> None:
    assert source_page_hit(
        {"source_id": "paper-1", "page": 4, "evidence_type": "XRD"},
        {"source_id": "paper-1", "pages": [4], "evidence_types": ["XRD"]},
    )
    assert not source_page_hit(
        {"source_id": "paper-1", "page": 5, "evidence_type": "XRD"},
        {"source_id": "paper-1", "pages": [4], "evidence_types": ["XRD"]},
    )


def test_exact_identifier_lexical_score_remains_high_after_blending() -> None:
    from embedding_eval.retrieval import lexical_score, hybrid_score

    query = "10.5555/chemdft.synthetic.2026.0042"
    exact = "DOI 10.5555/chemdft.synthetic.2026.0042"
    lexical = lexical_score(query, exact)

    assert lexical == 1.0
    assert hybrid_score(lexical, 0.0) > 0.35


def test_numeric_peak_lookup_has_a_lexical_exact_match_guardrail() -> None:
    from embedding_eval.corpus import QUERIES
    from embedding_eval.retrieval import lexical_score

    query = next(item for item in QUERIES if item.id == "numeric-003")
    ranked = sorted(DOCUMENTS, key=lambda item: lexical_score(query.text, item.text), reverse=True)

    assert ranked[0].id in query.relevant_ids
