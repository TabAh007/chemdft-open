from __future__ import annotations

from embedding_eval.models import MODEL_CANDIDATES, DeterministicFakeEmbeddingGateway
from embedding_eval.real_paper_evaluate import (
    EXPECTED_HASHES,
    SCORE_THRESHOLD,
    _score_summaries,
    _cosine,
    language_group,
    score_ranking,
    verify_frozen_inputs,
)
from embedding_eval.retrieval import hybrid_score, lexical_score


def test_frozen_input_hashes_match_before_evaluation() -> None:
    assert verify_frozen_inputs() == EXPECTED_HASHES


def test_model_revisions_dimensions_and_e5_prefixes_are_pinned() -> None:
    assert MODEL_CANDIDATES["multilingual-e5-base"] == {
        "repository": "intfloat/multilingual-e5-base",
        "revision": "d128750597153bb5987e10b1c3493a34e5a4502a",
        "license": "MIT",
        "dimension": 768,
        "query_prefix": "query: ",
        "document_prefix": "passage: ",
    }
    assert MODEL_CANDIDATES["bge-m3"]["revision"] == "5617a9f61b028005a4858fdac845db406aefb181"
    assert MODEL_CANDIDATES["bge-m3"]["dimension"] == 1024
    assert MODEL_CANDIDATES["bge-m3"]["query_prefix"] == ""
    assert MODEL_CANDIDATES["bge-m3"]["document_prefix"] == ""


def test_multi_target_scoring_accepts_every_frozen_chunk_target() -> None:
    qrel = {
        "no_answer": False,
        "acceptable_targets": [
            {"chunk_id": "c1", "benchmark_document_id": "doc-a", "page": 1},
            {"chunk_id": "c2", "benchmark_document_id": "doc-b", "page": 3},
        ],
    }
    chunks = {
        "c1": {"benchmark_document_id": "doc-a", "page": 1},
        "c2": {"benchmark_document_id": "doc-b", "page": 3},
        "c3": {"benchmark_document_id": "doc-a", "page": 1},
        "c4": {"benchmark_document_id": "doc-c", "page": 4},
        "c5": {"benchmark_document_id": "doc-c", "page": 5},
    }
    result = score_ranking(["c1", "c3", "c4", "c5", "c2"], qrel, chunks)
    assert result["recall_at_1"] == 0.5
    assert result["recall_at_3"] == 0.5
    assert result["recall_at_5"] == 1.0
    assert result["document_hit_at_1"] is True
    assert result["page_hit_at_1"] is True
    assert result["chunk_hit_at_1"] is True


def test_no_answer_scoring_keeps_empty_gold_and_fixed_prior_threshold() -> None:
    qrel = {"no_answer": True, "acceptable_targets": []}
    chunk = {"chunk_id": "candidate", "benchmark_document_id": "doc-a", "page": 1}
    result = score_ranking(["candidate"], qrel, {"candidate": chunk})
    assert result["recall_at_1"] is None
    assert result["mrr"] == 0.0
    assert SCORE_THRESHOLD == 0.50


def test_language_groups_keep_cross_language_separate() -> None:
    papers = {
        "russian_bilingual": {"language": ["ru", "en"]},
        "english": {"language": ["en"]},
        "russian": {"language": ["ru"]},
    }
    assert (
        language_group(
            {
                "no_answer": False,
                "language": "ru",
                "acceptable_targets": [{"benchmark_document_id": "russian_bilingual"}],
            },
            papers,
        )
        == "russian"
    )
    assert (
        language_group(
            {
                "no_answer": False,
                "language": "ru",
                "acceptable_targets": [{"benchmark_document_id": "english"}],
            },
            papers,
        )
        == "cross_language"
    )
    assert (
        language_group(
            {
                "no_answer": False,
                "language": "en",
                "source_spec_id": "cross_en_to_ru_formats",
                "acceptable_targets": [{"benchmark_document_id": "russian_bilingual"}],
            },
            papers,
        )
        == "cross_language"
    )


def test_category_grouping_reports_n_and_keeps_no_answer_separate() -> None:
    qrels = [
        {
            "query_id": "q-en",
            "query_class": "numeric_value",
            "language": "en",
            "no_answer": False,
            "acceptable_targets": [
                {"chunk_id": "c1", "benchmark_document_id": "doc-en", "page": 1}
            ],
        },
        {
            "query_id": "q-ru-cross",
            "query_class": "no_answer",
            "language": "ru",
            "no_answer": True,
            "acceptable_targets": [],
        },
    ]
    papers = {"doc-en": {"language": ["en"]}}
    common = {
        "strategy": "lexical_only",
        "query_class": "numeric_value",
        "top_score": 0.4,
        "top_document": "doc-en",
        "top_chunk_id": "c1",
        "threshold_crossed": False,
        "recall_at_1": 1.0,
        "recall_at_3": 1.0,
        "recall_at_5": 1.0,
        "mrr": 1.0,
        "ndcg_at_5": 1.0,
        "document_hit_at_1": True,
        "document_hit_at_5": True,
        "page_hit_at_1": True,
        "page_hit_at_5": True,
        "chunk_hit_at_1": True,
        "chunk_hit_at_5": True,
        "failure_level": "NONE",
        "failure_reason": "none",
    }
    rows = [
        {**common, "query_id": "q-en", "no_answer": False},
        {
            **common,
            "query_id": "q-ru-cross",
            "query_class": "no_answer",
            "no_answer": True,
            "threshold_crossed": True,
            "failure_level": "NO_ANSWER",
            "failure_reason": "false_retrieval",
        },
    ]
    strategies, category_rows = _score_summaries(qrels, papers, rows)
    assert strategies["lexical_only"]["n_answerable"] == 1
    category_by_key = {(row["group_type"], row["group"]): row for row in category_rows}
    assert category_by_key[("query_class", "numeric_value")]["n"] == 1
    assert category_by_key[("language", "english")]["n"] == 1
    assert category_by_key[("query_class", "no_answer")]["n"] == 1
    assert category_by_key[("query_class", "no_answer")]["n_answerable"] == 0
    assert category_by_key[("query_class", "no_answer")]["no_answer_false_hits"] == 1


def test_deterministic_fake_rankings_reproduce_without_model_download() -> None:
    gateway = DeterministicFakeEmbeddingGateway()
    query = "What lattice parameters were reported?"
    passages = [
        "lattice parameters a b c",
        "thermal degradation analysis",
        "lattice parameters a b c",
    ]

    def rank() -> list[str]:
        query_vector = gateway.embed_query(query).vector
        vectors = [item.vector for item in gateway.embed_documents(passages)]
        return [
            str(index)
            for index, _ in sorted(
                enumerate(vectors),
                key=lambda item: (
                    -hybrid_score(
                        lexical_score(query, passages[item[0]]),
                        _cosine(query_vector, item[1]),
                    ),
                    item[0],
                ),
            )
        ]

    assert rank() == rank()
