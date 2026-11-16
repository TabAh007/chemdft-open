from collections import Counter
from pathlib import Path

from embedding_eval.corpus import DOCUMENTS, DOCUMENT_METADATA, QUERIES, document_sha256
from embedding_eval.exact_query import classify_exact_query, guardrail_score
from embedding_eval.metrics import ndcg_at_k
from embedding_eval.models import MODEL_CANDIDATES


def test_benchmark_gold_schema_is_complete_and_explicit() -> None:
    evidence = {item.id for item in DOCUMENTS}
    assert len({item.source_id for item in DOCUMENTS}) == 10
    assert len(QUERIES) == 110
    assert all(query.language and query.category and query.id for query in QUERIES)
    assert all(set(query.relevant_ids) <= evidence for query in QUERIES)
    assert all(
        query.no_answer or (query.relevant_document_ids and query.relevant_pages)
        for query in QUERIES
    )
    assert all(query.no_answer == (not query.relevant_ids) for query in QUERIES)
    assert DOCUMENT_METADATA["license"] == "CC0-1.0"
    assert "hand-authored" in DOCUMENT_METADATA["judge_source"]
    assert all(item.source == DOCUMENT_METADATA["source"] for item in DOCUMENTS)
    assert all(item.license == DOCUMENT_METADATA["license"] for item in DOCUMENTS)
    assert all(len(document_sha256(item)) == len(item.sha256) == 64 for item in DOCUMENTS)


def test_benchmark_has_all_taxonomy_and_language_groups() -> None:
    classes = Counter(query.category for query in QUERIES)
    languages = Counter(query.language for query in QUERIES)
    assert len(classes) == 11 and set(classes.values()) == {10}
    assert {"en", "ru", "cross_en_ru", "cross_ru_en"} <= languages.keys()
    assert classes["no_answer"] == 10


def test_exact_query_router_handles_identifiers_without_semantic_overrouting() -> None:
    assert classify_exact_query("Cr2O3") == "formula"
    assert classify_exact_query("CO2 molecule") == "formula"
    assert classify_exact_query("10.5555/synth.xrd.2026.004") == "doi"
    assert classify_exact_query("47 kJ/mol") == "numeric_unit"
    assert classify_exact_query("6-31G(d)") == "basis_set"
    assert classify_exact_query("What does chromium oxide do during heating?") is None
    assert (
        classify_exact_query("Какое колебание углекислого газа дает наиболее сильную полосу ИК?")
        is None
    )
    assert classify_exact_query("What is the mean diameter of TiO2 nanoparticles?") is None
    assert (
        classify_exact_query("How difficult is lithium transport through the phosphate channel?")
        is None
    )


def test_exact_guardrail_prioritizes_lexical_only_for_classified_queries() -> None:
    assert guardrail_score("formula", 0.9, 0.1) == 0.9
    assert guardrail_score(None, 0.1, 0.9) == 0.9


def test_no_answer_cases_are_explicit_and_ndcg_is_bounded() -> None:
    negatives = [query for query in QUERIES if query.no_answer]
    assert len(negatives) >= 10
    assert ndcg_at_k(["wrong", "gold"], {"gold"}) == 1 / __import__("math").log2(3)
    assert ndcg_at_k(["wrong"], set()) == 0.0


def test_embedding_adapter_dimensions_are_pinned_and_distinct() -> None:
    assert MODEL_CANDIDATES["multilingual-e5-base"]["dimension"] == 768
    assert MODEL_CANDIDATES["bge-m3"]["dimension"] == 1024
    assert (
        MODEL_CANDIDATES["multilingual-e5-base"]["dimension"]
        != MODEL_CANDIDATES["bge-m3"]["dimension"]
    )


def test_migration_plan_matches_fixed_width_production_storage() -> None:
    repository_root = Path(__file__).resolve().parents[3]
    model_source = (
        repository_root / "services/api/src/chemdft_api/knowledge_models.py"
    ).read_text()
    migration_source = (
        repository_root / "services/api/migrations/versions/0009_phase9_production_index.py"
    ).read_text()
    indexing_source = (
        repository_root / "services/api/src/chemdft_api/knowledge/service.py"
    ).read_text()
    migration_plan = (
        repository_root / "docs/implementation/EMBEDDING_MIGRATION_PLAN.md"
    ).read_text()

    assert "NATIVE_VECTOR_DIMENSION = 64" in model_source
    assert "VECTOR(NATIVE_VECTOR_DIMENSION)" in model_source
    assert "VECTOR(64)" in migration_source
    assert "embedding.dimension != 64" in indexing_source
    assert "knowledge_embedding_vectors_768" in migration_plan
    assert "knowledge_embedding_vectors_1024" in migration_plan
    assert "active pointer" in migration_plan
