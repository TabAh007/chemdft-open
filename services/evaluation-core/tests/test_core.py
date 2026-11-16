from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import ir_measures
import pytest
from chemdft_evaluation_core.adapters.legacy import evaluator_v1_to_canonical
from chemdft_evaluation_core.beir import export_ir, import_ir_projection
from chemdft_evaluation_core.canonicalization import canonical_json, load_json_unique, sha256
from chemdft_evaluation_core.freeze import (
    canonical_parts,
    freeze_benchmark,
    manifest_hash,
    package_hash,
)
from chemdft_evaluation_core.metrics import (
    binary_ndcg_at_k,
    reciprocal_rank,
    score,
    target_recall_at_k,
)
from chemdft_evaluation_core.reporting import legacy_v3_retrieval_labels
from chemdft_evaluation_core.result import EvaluationResult, result_hash
from chemdft_evaluation_core.schema import (
    BenchmarkIdentity,
    ChemDFTBenchmark,
    Chunk,
    Review,
    Source,
)
from chemdft_evaluation_core.schema_export import schema_bytes
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

H = "a" * 64


def sample(*, alternates: int = 0, no_answer: bool = False, rejected: bool = False):
    chunks = [
        {
            "chunk_id": f"c{i}",
            "document_id": "d",
            "content_sha256": hashlib.sha256(f"synthetic c{i}".encode()).hexdigest(),
            "content": f"synthetic c{i}",
            "locator": {
                "kind": "XML_PARAGRAPH",
                "section_path": "Results",
                "paragraph_ordinal": i,
                "chunk_ordinal": i,
            },
        }
        for i in range(1, alternates + 2)
    ]
    qrel = (
        {"query_id": "q", "no_answer": True, "corpus_review_note": "checked all chunks"}
        if no_answer
        else {
            "query_id": "q",
            "no_answer": False,
            "primary_target": {"chunk_id": "c1", "document_id": "d"},
            "alternate_targets": [
                {"chunk_id": f"c{i}", "document_id": "d"} for i in range(2, alternates + 2)
            ],
        }
    )
    return {
        "identity": {"benchmark_id": "synthetic", "version": "1"},
        "sources": [{"document_id": "d", "source_kind": "XML", "source_sha256": H}],
        "chunks": chunks,
        "queries": [{"query_id": "q", "text": "synthetic?", "leakage_group": "g"}],
        "qrels": [qrel],
        "reviews": [
            {
                "query_id": "q",
                "decision": "REJECTED" if rejected else "APPROVED",
                "reviewer": "synthetic reviewer",
                "evidence_sha256": H,
            }
        ],
    }


@given(alternates=st.integers(min_value=0, max_value=10), no_answer=st.booleans())
def test_qrel_round_trip_and_freeze_order(alternates, no_answer):
    data = sample(alternates=alternates, no_answer=no_answer)
    first = ChemDFTBenchmark.model_validate(data)
    again = ChemDFTBenchmark.model_validate_json(first.model_dump_json())
    assert again == first
    assert freeze_benchmark(first) == freeze_benchmark(again)
    data["chunks"].reverse()
    assert freeze_benchmark(ChemDFTBenchmark.model_validate(data)) == freeze_benchmark(first)


@given(st.integers(min_value=0, max_value=10))
@settings(deadline=None)
def test_alternate_targets_and_ir_crosscheck(alternates):
    benchmark = ChemDFTBenchmark.model_validate(sample(alternates=alternates))
    ranked = [f"c{i}" for i in range(alternates + 1, 0, -1)]
    relevant = set(ranked)
    result = score(benchmark, {"q": ranked}, {"q": True})
    assert result["chemdft"]["pooled_target_recall"]["1"]["n"] == len(relevant)
    assert result["standard_macro"]["recall_at_1"] == pytest.approx(
        target_recall_at_k(ranked, relevant, 1)
    )
    assert result["standard_macro"]["mrr"] == pytest.approx(reciprocal_rank(ranked, relevant))
    assert result["standard_macro"]["ndcg_at_5"] == pytest.approx(
        binary_ndcg_at_k(ranked, relevant, 5)
    )


@given(st.booleans())
def test_no_answer_acceptance_and_rejected_exclusion(accepted):
    benchmark = ChemDFTBenchmark.model_validate(sample(no_answer=True))
    result = score(benchmark, {"q": ["c1"]}, {"q": accepted})
    assert result["chemdft"]["no_answer_false_accept"]["hits"] == int(accepted)
    rejected = ChemDFTBenchmark.model_validate(sample(rejected=True))
    assert rejected.scoring_qrels() == ()
    assert export_ir(rejected)["qrels"] == {}


@pytest.mark.parametrize(
    "mutation",
    [
        lambda d: d["qrels"][0].update(no_answer=True),
        lambda d: d["qrels"][0].pop("primary_target"),
        lambda d: d["qrels"][0].update(alternate_targets=[d["qrels"][0]["primary_target"]]),
        lambda d: d["chunks"][0]["locator"].update(page=3),
        lambda d: d["chunks"].append(d["chunks"][0]),
        lambda d: d["qrels"].append(d["qrels"][0]),
        lambda d: d["queries"][0].update(leakage_group=""),
        lambda d: d["reviews"][0].update(query_id="missing"),
        lambda d: d["chunks"][0].update(document_id="missing"),
        lambda d: d["qrels"][0]["primary_target"].update(chunk_id="missing"),
    ],
)
def test_invalid_states_fail(mutation):
    data = sample()
    mutation(data)
    with pytest.raises(ValidationError):
        ChemDFTBenchmark.model_validate(data)


@given(st.text(min_size=1, max_size=20).filter(lambda x: x.strip() != ""))
def test_canonical_json_key_order_and_unicode(value):
    assert canonical_json({"z": value, "a": 1}) == canonical_json({"a": 1, "z": value})
    assert sha256({"z": value, "a": 1}) == sha256({"a": 1, "z": value})
    assert load_json_unique(canonical_json({"z": value})) == {"z": value}


def test_missing_review_and_json_input_errors():
    data = sample()
    data["reviews"] = []
    benchmark = ChemDFTBenchmark.model_validate(data)
    with pytest.raises(ValueError, match="review decision"):
        freeze_benchmark(benchmark)
    with pytest.raises(ValidationError):
        ChemDFTBenchmark.model_validate({"identity": data["identity"]})
    with pytest.raises(ValueError, match="duplicate JSON key"):
        load_json_unique(b'{"a":1,"a":2}')
    with pytest.raises(ValueError, match="non-finite"):
        load_json_unique(b'{"a":NaN}')
    with pytest.raises(UnicodeDecodeError):
        load_json_unique('{"a": 1}'.encode("utf-16"))


def test_legacy_aliases_and_ir_projection():
    data = sample()
    canonical = ChemDFTBenchmark.model_validate(data)
    legacy = evaluator_v1_to_canonical(
        identity=BenchmarkIdentity(benchmark_id="legacy", version="1"),
        corpus={"schema_version": 1, "chunks": [{"chunk_id": "c1", "document_id": "d"}]},
        qrels={
            "schema_version": 1,
            "qrels": [
                {
                    "query_id": "q",
                    "query": "synthetic?",
                    "no_answer": False,
                    "acceptable_targets": [
                        {"expected_chunk_id": "c1", "expected_document_id": "d"}
                    ],
                }
            ],
        },
        reviews=[Review.model_validate(data["reviews"][0])],
        source_metadata={"d": Source.model_validate(data["sources"][0])},
        chunk_metadata={"c1": Chunk.model_validate(data["chunks"][0])},
    )
    assert legacy.qrels[0].primary_target == canonical.qrels[0].primary_target
    projection = export_ir(canonical)
    assert import_ir_projection(projection)[2] == {"q": {"c1": 1}}


@given(st.integers(min_value=-10, max_value=10), st.booleans())
def test_malformed_locators_are_rejected(page, xml):
    data = sample()
    locator = data["chunks"][0]["locator"]
    if xml:
        locator["paragraph_ordinal"] = page
        invalid = page < 1
    else:
        locator["page"] = page
        invalid = True  # XML locators cannot claim a PDF page, even if positive
    if invalid:
        with pytest.raises(ValidationError):
            ChemDFTBenchmark.model_validate(data)
    else:
        ChemDFTBenchmark.model_validate(data)


def test_conflicting_legacy_aliases_fail():
    data = sample()
    target = {"chunk_id": "c1", "expected_chunk_id": "other", "benchmark_document_id": "d"}
    with pytest.raises(ValueError, match="conflicting"):
        evaluator_v1_to_canonical(
            identity=BenchmarkIdentity(benchmark_id="legacy", version="1"),
            corpus={"schema_version": 1, "chunks": [{"chunk_id": "c1", "document_id": "d"}]},
            qrels={
                "schema_version": 1,
                "qrels": [
                    {
                        "query_id": "q",
                        "query": "synthetic?",
                        "no_answer": False,
                        "acceptable_targets": [target],
                    }
                ],
            },
            reviews=[Review.model_validate(data["reviews"][0])],
            source_metadata={"d": Source.model_validate(data["sources"][0])},
            chunk_metadata={"c1": Chunk.model_validate(data["chunks"][0])},
        )


def test_schema_and_frozen_v3_reporting_golden():
    schema = Path(__file__).resolve().parents[1] / "schemas" / "chemdft-benchmark-v1.schema.json"
    assert schema.read_bytes() == schema_bytes()
    result_path = (
        Path(__file__).resolve().parents[2]
        / "embedding-evaluation"
        / "results"
        / "blind-holdout-v3-final"
        / "result.json"
    )
    raw = result_path.read_bytes()
    result = json.loads(raw)
    scientific = {k: v for k, v in result.items() if k != "blind_evaluation_result_sha256"}
    assert sha256(scientific) == "f06ca2103779766db5a8cfcfb4f2677534f32ef242c43292d9d29e5562c46f5b"
    assert (
        hashlib.sha256(raw).hexdigest()
        == "5722d54dba5e560c2f9abae2e31453524d1329b51c71b05d08ad873c0c2c0908"
    )
    labeled = legacy_v3_retrieval_labels(result["metrics"]["retrieval"])
    assert labeled["pooled_target_recall_at_5"] == {"hits": 29, "n": 37, "rate": 29 / 37}
    assert result["counts"]["answerable"] == 28


def test_hash_golden_and_sorting():
    benchmark = ChemDFTBenchmark.model_validate(sample(alternates=1))
    assert canonical_parts(benchmark)["qrels"][0]["alternate_targets"][0]["chunk_id"] == "c2"
    assert (
        sha256({"a": 1, "é": "\u03b1"})
        == "dc68f1dec8003b304ddcbf6e95449b84481dc16cb8e3ce4cac74f92cd824fbaf"
    )
    manifest = {"a": 1, "manifest_sha256": "self"}
    assert manifest_hash(manifest) == sha256({"a": 1})
    assert package_hash({"a": 1, "package_sha256": "self"}) == sha256({"a": 1})
    result = EvaluationResult(
        benchmark_id="synthetic",
        package_sha256=H,
        policy_sha256=H,
        evaluator_version="new",
        metrics={"n": 1},
    ).with_identity()
    assert result.result_sha256 == result_hash(result.model_dump(mode="json"))


@given(st.sets(st.integers(min_value=1, max_value=8), min_size=1, max_size=8))
def test_existing_chemdft_metrics_agree_with_ir_measures(relevant_positions):
    """Compare the existing unfrozen helper on synthetic rankings only."""
    old_file = (
        Path(__file__).resolve().parents[2]
        / "embedding-evaluation"
        / "src"
        / "embedding_eval"
        / "metrics.py"
    )
    spec = importlib.util.spec_from_file_location("historical_metrics", old_file)
    assert spec is not None and spec.loader is not None
    old = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)
    ranked = [f"c{i}" for i in range(1, 9)]
    relevant = {f"c{i}" for i in relevant_positions}
    qrels = [ir_measures.Qrel("q", chunk, 1) for chunk in relevant]
    run = [ir_measures.ScoredDoc("q", chunk, float(9 - i)) for i, chunk in enumerate(ranked, 1)]
    standard = ir_measures.calc_aggregate(
        [
            ir_measures.R @ 1,
            ir_measures.R @ 3,
            ir_measures.R @ 5,
            ir_measures.RR,
            ir_measures.nDCG @ 5,
        ],
        qrels,
        run,
    )
    historical = old.ranking_metrics(ranked, relevant)
    for k in (1, 3, 5):
        assert standard[ir_measures.R @ k] == pytest.approx(historical[f"recall_at_{k}"])
    assert standard[ir_measures.RR] == pytest.approx(historical["mrr"])
    assert standard[ir_measures.nDCG @ 5] == pytest.approx(old.ndcg_at_k(ranked, relevant, 5))
