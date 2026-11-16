"""Schema adapter qualification; retrieval runs here use fixtures only."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

from embedding_eval import blind_package_adapter as adapter
from embedding_eval import one_shot_blind_evaluation as evaluator
from embedding_eval.policy_dev_runner import _load_inputs

REPO = Path(__file__).resolve().parents[3]
V3 = Path("<local-path>/Desktop/chemdft-holdout-v3")


def fixture_source(qrels: list[dict], chunks: list[dict], *, rejected: bool = True) -> dict:
    """Make V3-shaped structural records without any V3 scientific content."""
    chunk_map = {c["chunk_id"]: c for c in chunks}
    rows = []
    for row in qrels:
        row = copy.deepcopy(row)
        answerable = not row.pop("no_answer")
        targets = []
        for target in row["acceptable_targets"]:
            chunk = chunk_map[target["expected_chunk_id"]]
            targets.append(target | {"content_sha256": chunk["content_sha256"]})
        row.update(
            answerable=answerable,
            acceptable_targets=targets,
            legitimate_alternate_targets=targets[1:],
            review_status="APPROVED",
        )
        rows.append(row)
    decisions = [
        {
            "query_id": row["query_id"],
            "retained_for_scoring": True,
            "review_status": "APPROVED",
            "decision": "APPROVE",
        }
        for row in rows
    ]
    provenance = {}
    if rejected:
        decisions.append(
            {
                "query_id": "rejected-synthetic",
                "retained_for_scoring": False,
                "review_status": "REJECTED",
                "decision": "REJECT",
            }
        )
        provenance["rejected_row"] = {"query_id": "rejected-synthetic"}
    documents = [{"document_id": doc} for doc in sorted({c["document_id"] for c in chunks})]
    return {
        "qrels": {
            "schema_version": 1,
            "benchmark_id": "fixture-v3",
            "qrels": rows,
            "summary": {
                "qrel_count": len(rows),
                "answerable_count": sum(r["answerable"] for r in rows),
                "no_answer_count": sum(not r["answerable"] for r in rows),
            },
        },
        "corpus": {
            "schema_version": 1,
            "chunks": chunks,
            "documents": documents,
            "chunk_count": len(chunks),
            "source_count": len(documents),
        },
        "inventory": [{k: v for k, v in c.items() if k != "content"} for c in chunks],
        "review": {
            "decisions": decisions,
            "retained_count": len(rows),
            "candidate_count": len(decisions),
            "review_status_counts": {
                "APPROVED": len(rows),
                "CORRECTED": 0,
                "REJECTED": int(rejected),
                "UNREVIEWED": 0,
                "NEEDS_SOURCE_CHECK": 0,
            },
        },
        "provenance": provenance,
    }


def synthetic_source() -> dict:
    chunks = [
        {
            "chunk_id": f"c{i}",
            "document_id": f"d{i}",
            "content": f"synthetic document {i}",
            "content_sha256": hashlib.sha256(f"synthetic document {i}".encode()).hexdigest(),
        }
        for i in range(6)
    ]
    qrels = [
        {
            "query_id": "s1",
            "query": "synthetic answerable",
            "no_answer": False,
            "expected_chunk_id": "c1",
            "expected_document_id": "d1",
            "acceptable_targets": [
                {"expected_chunk_id": "c1", "expected_document_id": "d1"},
                {"expected_chunk_id": "c3", "expected_document_id": "d3"},
            ],
            "language": "en",
            "query_class": "numeric",
        },
        {
            "query_id": "s2",
            "query": "synthetic no answer",
            "no_answer": True,
            "expected_chunk_id": None,
            "expected_document_id": None,
            "acceptable_targets": [],
            "language": "ru",
            "query_class": "semantic",
        },
    ]
    return fixture_source(qrels, chunks)


def dev_source() -> dict:
    qrels, chunks, _ = _load_inputs()
    return fixture_source(qrels, chunks, rejected=False)


def seal(path: Path, source: dict, purpose: str) -> tuple[str, dict]:
    binding = {
        "source_v3_package_sha256": "fixture",
        "source_v3_qrel_sha256": "fixture",
        "adapter_version": adapter.ADAPTER_VERSION,
        "adapter_sha256": adapter.adapter_sha256(),
        "source_schema_version": adapter.SOURCE_SCHEMA,
        "destination_evaluator_schema_version": adapter.DESTINATION_SCHEMA,
    }
    raw, evidence = adapter.transform(source, binding, purpose)
    path.mkdir()
    for name, data in raw.items():
        (path / name).write_bytes(data)
    return adapter.digest(raw["evaluator-package.json"]), evidence


class FixtureEncoder:
    def encode(self, texts, **_settings):
        vectors = np.zeros((len(texts), 1024), dtype=np.float32)
        for index, value in enumerate(texts):
            if value.startswith("synthetic document "):
                slot = int(value.rsplit(" ", 1)[1])
            elif value == "synthetic answerable":
                slot = 1
            else:
                slot = int(hashlib.sha256(value.encode()).hexdigest()[:6], 16) % 1024
            vectors[index, slot] = 1
        return vectors


def test_v3_identities_preservation_and_read_only(tmp_path: Path) -> None:
    before = {
        key: adapter.digest((V3 / name).read_bytes()) for key, name in adapter.SOURCE_NAMES.items()
    }
    policy = REPO / evaluator.SELECTED_POLICY_RELATIVE
    evaluator_file = (
        REPO / "services/embedding-evaluation/src/embedding_eval/one_shot_blind_evaluation.py"
    )
    frozen_before = (
        adapter.digest(policy.read_bytes()),
        adapter.digest(evaluator_file.read_bytes()),
    )
    one, two = tmp_path / "one", tmp_path / "two"
    result1 = adapter.adapt_v3(V3, one, REPO)
    result2 = adapter.adapt_v3(V3, two, REPO)
    assert result1 == result2
    assert result1["counts"] == {
        "qrels": 37,
        "answerable": 28,
        "no_answer": 9,
        "chunks": 147,
        "documents": 5,
    }
    assert result1["rejected_count"] == 1
    assert result1["target_set_sha256_before"] == result1["target_set_sha256_after"]
    assert result1["corpus_sha256_before"] == result1["corpus_sha256_after"]
    assert all(
        (one / name).read_bytes() == (two / name).read_bytes()
        for name in ("evaluator-package.json", "qrels.json", "corpus.json", "review.json")
    )
    assert before == {
        key: adapter.digest((V3 / name).read_bytes()) for key, name in adapter.SOURCE_NAMES.items()
    }
    assert frozen_before == (
        adapter.digest(policy.read_bytes()),
        adapter.digest(evaluator_file.read_bytes()),
    )
    snapshots, manifest, _, _ = evaluator.verify_identities(
        REPO, one, result1["evaluator_package_sha256"]
    )
    normalized, chunks = evaluator.validate_inputs(
        evaluator._load_json(snapshots["qrels.json"]),
        evaluator._load_json(snapshots["corpus.json"]),
    )
    assert len(normalized) == 37 and len(chunks) == 147 and manifest["purpose"] == "BLIND"
    source = adapter.verify_v3(V3, REPO)
    derived = json.loads((one / "qrels.json").read_bytes())
    assert adapter.target_projection(source["qrels"]["qrels"]) == adapter.target_projection(
        derived["qrels"]
    )
    assert all(x["query"] == y["query"] for x, y in zip(source["qrels"]["qrels"], derived["qrels"]))
    assert adapter.corpus_projection(source["corpus"]) == adapter.corpus_projection(
        json.loads((one / "corpus.json").read_bytes())
    )
    rejected_id = source["provenance"]["rejected_row"]["query_id"]
    assert rejected_id not in {row["query_id"] for row in derived["qrels"]}


def test_missing_answerability_fails_closed() -> None:
    source = synthetic_source()
    del source["qrels"]["qrels"][0]["answerable"]
    with pytest.raises(ValueError, match="ADAPTER_MAPPING_UNSAFE"):
        adapter.transform(source, {}, "SYNTHETIC_QUALIFICATION")


def test_adapter_lock_rejects_mapping_change(monkeypatch, tmp_path: Path) -> None:
    assert (
        adapter.verify_adapter_lock(REPO)["blind_package_adapter_sha256"]
        == adapter.adapter_sha256()
    )
    monkeypatch.setattr(adapter, "adapter_sha256", lambda: "0" * 64)
    with pytest.raises(ValueError, match="ADAPTER_LOCK_MISMATCH"):
        adapter.adapt_v3(V3, tmp_path / "view", REPO)
    assert not (tmp_path / "view").exists()


def test_review_correction_does_not_change_scoring_targets() -> None:
    source = synthetic_source()
    original, evidence = adapter.transform(source, {}, "SYNTHETIC_QUALIFICATION")
    source["qrels"]["qrels"][0]["review_status"] = "CORRECTED"
    source["review"]["decisions"][0].update(review_status="CORRECTED", decision="CORRECT")
    source["review"]["review_status_counts"].update(APPROVED=1, CORRECTED=1)
    corrected, corrected_evidence = adapter.transform(source, {}, "SYNTHETIC_QUALIFICATION")
    before_rows = adapter.load_json(original["qrels.json"])["qrels"]
    after_rows = adapter.load_json(corrected["qrels.json"])["qrels"]
    assert adapter.target_projection(before_rows) == adapter.target_projection(after_rows)
    assert evidence["target_set_sha256_after"] == corrected_evidence["target_set_sha256_after"]
    assert [r["no_answer"] for r in before_rows] == [r["no_answer"] for r in after_rows]


def test_output_cannot_be_v3_and_source_hashes_gate(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="OUTPUT_INSIDE_V3"):
        adapter.adapt_v3(V3, V3 / "forbidden-view", REPO)
    assert not (V3 / "forbidden-view").exists()
    alias = tmp_path / "v3-alias"
    alias.symlink_to(V3, target_is_directory=True)
    with pytest.raises(ValueError, match="OUTPUT_INSIDE_V3"):
        adapter.adapt_v3(V3, alias / "forbidden-view", REPO)
    with pytest.raises(ValueError, match="V3_QRELS_HASH_MISMATCH"):
        altered = tmp_path / "altered"
        altered.mkdir()
        for key, name in adapter.SOURCE_NAMES.items():
            path = altered / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((V3 / name).read_bytes() + (b" " if key == "qrels" else b""))
        adapter.verify_v3(altered, REPO)


@pytest.mark.parametrize(
    "purpose,source_factory,expected",
    [
        ("SYNTHETIC_QUALIFICATION", synthetic_source, (2, 1, 1)),
        ("DEV_QUALIFICATION", dev_source, (71, 50, 21)),
    ],
)
def test_evaluator_accepts_adapted_nonblind_fixture(
    tmp_path: Path, monkeypatch, purpose, source_factory, expected
) -> None:
    source = source_factory()
    digest, evidence = seal(tmp_path / purpose.lower(), source, purpose)
    monkeypatch.setattr(evaluator, "_load_model", lambda _policy: FixtureEncoder())
    result = evaluator.run(REPO, tmp_path / purpose.lower(), expected_package_sha256=digest)
    assert (
        result["counts"]["qrels"],
        result["counts"]["answerable"],
        result["counts"]["no_answer"],
    ) == expected
    assert evidence["target_set_sha256_before"] == evidence["target_set_sha256_after"]
    assert evidence["corpus_sha256_before"] == evidence["corpus_sha256_after"]
    assert result["scientific_metrics_produced"] is True
