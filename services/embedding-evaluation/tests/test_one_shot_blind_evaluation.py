"""Evaluator qualification: generated fixtures and the pinned DEV loader only."""

from __future__ import annotations

import ast
import builtins
import copy
import json
import os
import subprocess
from pathlib import Path

import numpy as np
import pytest

from embedding_eval import one_shot_blind_evaluation as ev
from embedding_eval.evaluator_lock import build_lock, lock_digest
from embedding_eval.frozen_policy_dev_v1 import load_dev_qrels
from embedding_eval.one_shot_blind_evaluation import compute_metrics, score_answerable
from embedding_eval.qualify_evaluator import seal_fixture, synthetic_inputs

REPO = Path(__file__).resolve().parents[3]


def test_alternate_targets_are_all_relevant_for_recall_and_ndcg() -> None:
    targets = [
        {"chunk_id": "c2", "benchmark_document_id": "d1"},
        {"chunk_id": "c4", "benchmark_document_id": "d2"},
    ]
    scored = score_answerable(["c2", "c4", "c1"], targets, {"c2": "d1", "c4": "d2", "c1": "d3"})
    assert scored["recall_at_1"] == {"hits": 1, "n": 2, "rate": 0.5}
    assert scored["recall_at_3"] == {"hits": 2, "n": 2, "rate": 1.0}
    assert scored["chunk_hit_at_3"] is True
    assert scored["document_hit_at_3"] is True
    assert scored["mrr"] == 1.0
    assert scored["ndcg_at_5"] == pytest.approx(1.0)


def test_abstention_metrics_include_answerable_and_no_answer_denominators() -> None:
    qrels = [
        {
            "query_id": "q1",
            "query": "private",
            "no_answer": False,
            "language": "en",
            "query_class": "numeric_value",
            "acceptable_targets": [{"chunk_id": "c1", "benchmark_document_id": "d1"}],
        },
        {
            "query_id": "q2",
            "query": "private",
            "no_answer": False,
            "language": "ru",
            "query_class": "semantic",
            "acceptable_targets": [{"chunk_id": "c2", "benchmark_document_id": "d2"}],
        },
        {
            "query_id": "q3",
            "query": "private",
            "no_answer": True,
            "language": "en",
            "source_spec_id": "cross_noanswer_1",
            "query_class": "identifier",
            "acceptable_targets": [],
        },
    ]
    ranked = {"q1": ["c1"], "q2": ["c3"], "q3": ["c4"]}
    metrics, _ = compute_metrics(
        qrels,
        ranked,
        {"q1": 0.7, "q2": 0.5, "q3": 0.8},
        {"c1": "d1", "c2": "d2", "c3": "d3", "c4": "d4"},
        0.5555248856544495,
    )
    assert metrics["counts"] == {"qrels": 3, "answerable": 2, "no_answer": 1}
    assert metrics["abstention"]["no_answer_false_accept_count"] == 1
    assert metrics["abstention"]["no_answer_correct_abstain_count"] == 0
    assert metrics["abstention"]["answerable_accepted_count"] == 1
    assert metrics["abstention"]["answerable_abstained_count"] == 1
    assert metrics["abstention"]["safe_recall_at_5"] == {"hits": 1, "n": 2, "rate": 0.5}
    assert set(metrics["slices"]["language"]) == {"English", "cross-language", "Russian"}
    assert "numeric" in metrics["slices"]["query_class"]


class SyntheticEncoder:
    """Deterministic unit vectors, only for orchestration qualification, never a model claim."""

    def encode(self, texts, **settings):
        assert settings == {
            "batch_size": 16,
            "show_progress_bar": False,
            "convert_to_numpy": True,
            "normalize_embeddings": True,
            "prompt": "",
        }
        result = np.zeros((len(texts), 1024), dtype=np.float32)
        for i, text in enumerate(texts):
            if text.startswith("synthetic document "):
                result[i, int(text.rsplit(" ", 1)[1])] = 1
            elif text == "synthetic answerable":
                result[i, 1] = 0.8
                result[i, 3] = 0.6
            else:
                result[i, 100] = 1
        return result


@pytest.fixture
def fake_model(monkeypatch):
    monkeypatch.setattr(ev, "_load_model", lambda policy: SyntheticEncoder())


@pytest.fixture
def package(tmp_path):
    qrels, chunks = synthetic_inputs()
    path = tmp_path.resolve() / "fixture"
    digest = seal_fixture(path, qrels, chunks, "SYNTHETIC_QUALIFICATION")
    return path, digest


def test_original_keyerror_reproduced_without_blind_data():
    raw = subprocess.check_output(
        [
            "git",
            "-C",
            str(REPO),
            "show",
            "76eda200d7b88bd6dd6d10897fc33bb152d7f5c0:services/embedding-evaluation/src/embedding_eval/one_shot_blind_evaluation.py",
        ],
        text=True,
    )
    node = next(
        n
        for n in ast.parse(raw).body
        if isinstance(n, ast.FunctionDef) and n.name == "score_answerable"
    )
    namespace = dict(vars(ev))
    exec(  # noqa: S102 — execute only the pinned historical function AST for regression
        compile(ast.Module(body=[node], type_ignores=[]), "original_evaluator.py", "exec"),
        namespace,
    )
    target = {"expected_chunk_id": "c", "expected_document_id": "d"}
    with pytest.raises(KeyError, match="chunk_id"):
        namespace["score_answerable"]([], [target], {})
    assert ev.score_answerable(["c"], [target], {"c": "d"})["recall_at_5"]["rate"] == 1
    row = next(q for q in load_dev_qrels() if not q["no_answer"])
    with pytest.raises(KeyError, match="chunk_id"):
        namespace["score_answerable"]([], row["acceptable_targets"], {})


def test_synthetic_full_run_metrics_states_and_rerun_block(package, fake_model):
    path, digest = package
    result = ev.run(REPO, path, expected_package_sha256=digest)
    metrics = result["metrics"]
    assert result["purpose"] == "SYNTHETIC_QUALIFICATION"
    for k, expected in [(1, 0.5), (3, 1), (5, 1)]:
        assert metrics["retrieval"][f"recall_at_{k}"]["rate"] == expected
        assert metrics["retrieval"][f"document_hit_at_{k}"]["rate"] == 1
        assert metrics["retrieval"][f"chunk_hit_at_{k}"]["rate"] == 1
    assert metrics["retrieval"]["mrr"] == 1
    assert metrics["retrieval"]["ndcg_at_5"] == 1
    assert metrics["abstention"]["safe_recall_at_5"]["rate"] == 1
    assert metrics["abstention"]["no_answer_false_accept_rate"]["rate"] == 0
    assert metrics["abstention"]["answerable_acceptance_rate"]["rate"] == 1
    assert set(metrics["slices"]["language"]) == {"English", "Russian"}
    journal = path / ev.JOURNAL_NAME
    assert [
        json.loads((journal / f"{i:02d}-{s}.json").read_bytes())["status"]
        for i, s in enumerate(ev.STATES)
    ] == list(ev.STATES)
    before = {p.name: p.read_bytes() for p in journal.iterdir()}
    with pytest.raises(FileExistsError):
        ev.run(REPO, path, expected_package_sha256=digest)
    assert before == {p.name: p.read_bytes() for p in journal.iterdir()}


def test_dev_shaped_full_run_pinned_71_queries(tmp_path, fake_model):
    rows = load_dev_qrels()
    chunks = {}
    for row in rows:
        for target in row["acceptable_targets"]:
            chunks[target["expected_chunk_id"]] = {
                "chunk_id": target["expected_chunk_id"],
                "document_id": target["expected_document_id"],
                "content": "synthetic stand-in; not source text",
            }
    package = tmp_path.resolve() / "dev-shaped"
    digest = seal_fixture(package, rows, list(chunks.values()), "DEV_QUALIFICATION")
    result = ev.run(REPO, package, expected_package_sha256=digest)
    assert result["metrics"]["counts"] == {"qrels": 71, "answerable": 50, "no_answer": 21}
    assert (package / ev.JOURNAL_NAME / "04-COMPLETED.json").exists()


@pytest.mark.parametrize(
    "missing,code",
    [
        ("query_id", "QUERY_ID_REQUIRED"),
        ("query", "QUERY_REQUIRED"),
        ("no_answer", "NO_ANSWER_BOOLEAN_REQUIRED"),
        ("acceptable_targets", "TARGET_SCHEMA"),
    ],
)
def test_missing_required_fields_fail_explicitly(missing, code):
    rows, chunks = synthetic_inputs()
    del rows[0][missing]
    with pytest.raises(ValueError, match=code):
        ev.validate_inputs(
            {"schema_version": 1, "qrels": rows}, {"schema_version": 1, "chunks": chunks}
        )


def test_optional_fields_and_target_aliases():
    rows, chunks = synthetic_inputs()
    for row in rows:
        row.pop("language", None)
        row.pop("query_class", None)
    normalized, _ = ev.validate_inputs(
        {"schema_version": 1, "qrels": rows}, {"schema_version": 1, "chunks": chunks}
    )
    assert normalized[1]["acceptable_targets"] == []
    assert ev._query_language(normalized[0]) == "other"
    bad = {"chunk_id": "c", "expected_chunk_id": "different", "benchmark_document_id": "d"}
    with pytest.raises(ValueError, match="CONFLICTING_TARGET_CHUNK"):
        ev.normalize_targets([bad])
    with pytest.raises(ValueError, match="TARGET_DOCUMENT_ID_REQUIRED"):
        ev.normalize_targets([{"chunk_id": "c"}])


def test_threshold_exact_boundary_and_candidate_a_tie_break():
    rows, chunks = synthetic_inputs()
    rows, chunks = ev.validate_inputs(
        {"schema_version": 1, "qrels": rows}, {"schema_version": 1, "chunks": chunks}
    )
    threshold = ev.THRESHOLD
    for delta, expected in [(-1e-9, False), (0, True), (1e-9, True)]:
        _, scored = ev.compute_metrics(
            rows,
            {"s1": ["c1"], "s2": ["c1"]},
            {"s1": threshold + delta, "s2": threshold + delta},
            {"c1": "d1"},
            threshold,
        )
        assert scored["s1"]["accepted"] is expected
        assert scored["s2"]["accepted"] is expected
    ranked, _ = ev.rank_dense(
        rows,
        list(reversed(chunks)),
        np.ones((6, 1024), dtype=np.float32),
        np.ones((2, 1024), dtype=np.float32),
    )
    assert ranked["s1"] == ["c0", "c1", "c2", "c3", "c4"]


def test_deterministic_full_result_and_journal(tmp_path, fake_model):
    rows, chunks = synthetic_inputs()
    outputs, journals = [], []
    for name in ("a", "b"):
        package = tmp_path.resolve() / name
        digest = seal_fixture(package, rows, chunks, "SYNTHETIC_QUALIFICATION")
        result = ev.run(REPO, package, expected_package_sha256=digest)
        outputs.append(ev.canonical_bytes(result))
        journals.append({p.name: p.read_bytes() for p in (package / ev.JOURNAL_NAME).iterdir()})
        assert ev.result_digest(result) == result["blind_evaluation_result_sha256"]
        assert ev.result_digest(dict(reversed(list(result.items())))) == ev.result_digest(result)
    assert outputs[0] == outputs[1]
    assert journals[0] == journals[1]


@pytest.mark.parametrize("phase", ["PRECHECK", "CLAIMED", "SCORING", "RESULT_WRITTEN"])
def test_failure_is_immutable_and_never_retried(package, fake_model, monkeypatch, phase):
    path, digest = package
    original = ev.ExecutionJournal.transition

    def transition(self, state):
        if state != "FAILED" and self.state == phase:
            raise RuntimeError("PRIVATE_SENTINEL")
        return original(self, state)

    monkeypatch.setattr(ev.ExecutionJournal, "transition", transition)
    with pytest.raises(RuntimeError):
        ev.run(REPO, path, expected_package_sha256=digest)
    journal = path / ev.JOURNAL_NAME
    raw = (journal / "failure.json").read_bytes()
    record = json.loads(raw)
    assert record["status"] == "FAILED"
    assert record["failed_during"] == phase
    assert b"PRIVATE_SENTINEL" not in raw
    assert (journal / "failure.json").stat().st_mode & 0o222 == 0
    with pytest.raises(FileExistsError):
        ev.run(REPO, path, expected_package_sha256=digest)
    assert (journal / "failure.json").read_bytes() == raw
    assert record["scientific_metrics_produced"] is (phase in {"SCORING", "RESULT_WRITTEN"})


def test_model_failure_and_interrupted_process_records(package, monkeypatch):
    path, digest = package

    def fail(policy):
        raise RuntimeError("private")

    monkeypatch.setattr(ev, "_load_model", fail)
    with pytest.raises(RuntimeError):
        ev.run(REPO, path, expected_package_sha256=digest)
    assert (
        json.loads((path / ev.JOURNAL_NAME / "failure.json").read_bytes())[
            "scientific_metrics_produced"
        ]
        is False
    )
    other = path.parent / "interrupted"
    other.mkdir()
    journal = ev.ExecutionJournal(other, {})
    journal.transition("CLAIMED")
    journal.transition("SCORING")
    ev.record_interrupted_failure(other)
    record = json.loads((journal.path / "FAILED.json").read_bytes())
    assert record["scientific_metrics_produced"] is None
    assert record["rerun_allowed"] is False
    with pytest.raises(ValueError, match="ALREADY_FAILED"):
        ev.record_interrupted_failure(other)


def test_policy_cannot_mutate_before_or_during_execution(
    package, fake_model, monkeypatch, tmp_path
):
    raw, policy = ev.load_policy(REPO)
    assert ev.sha256_bytes(raw) == ev.POLICY_SHA256
    assert policy["model"]["revision"] == ev.EXPECTED_MODEL_REVISION
    assert policy["embedding"] | {"dimension": 1024} == policy["embedding"]
    assert policy["retriever"]["top_k"] == 5
    assert policy["abstention"]["threshold"] == ev.THRESHOLD
    copied_repo = tmp_path / "repo"
    target = copied_repo / ev.SELECTED_POLICY_RELATIVE
    target.parent.mkdir(parents=True)
    changed = copy.deepcopy(policy)
    changed["abstention"]["threshold"] += 0.001
    target.write_bytes(ev.canonical_bytes(changed))
    with pytest.raises(ValueError, match="POLICY_HASH_MISMATCH"):
        ev.load_policy(copied_repo)
    path, digest = package
    original = ev.compute_metrics

    def mutate(*args):
        target.write_bytes(ev.canonical_bytes(changed))
        return original(*args)

    # Other source paths are read from the genuine repo; intercept only the policy snapshot.
    original_read = Path.read_bytes

    def read(p):
        if p == REPO / ev.SELECTED_POLICY_RELATIVE:
            return original_read(target)
        return original_read(p)

    target.write_bytes(raw)
    monkeypatch.setattr(Path, "read_bytes", read)
    monkeypatch.setattr(ev, "compute_metrics", mutate)
    with pytest.raises(ValueError, match="POLICY_CHANGED_DURING_EVALUATION"):
        ev.run(REPO, path, expected_package_sha256=digest)
    assert not (path / ev.JOURNAL_NAME / "result.json").exists()


def test_evaluator_lock_is_deterministic_and_source_sensitive():
    first = build_lock(REPO, "a" * 40, {"synthetic": "PASS"})
    assert first == build_lock(REPO, "a" * 40, {"synthetic": "PASS"})
    assert lock_digest(first) == first["blind_evaluator_sha256"]
    first["schemas"]["result"] += 1
    assert lock_digest(first) != first["blind_evaluator_sha256"]


def test_external_blind_directory_never_accessed(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Filesystem access attempted")

    for method in ("open", "stat", "lstat", "resolve", "iterdir"):
        monkeypatch.setattr(Path, method, forbidden)
    monkeypatch.setattr(builtins, "open", forbidden)
    monkeypatch.setattr(os, "open", forbidden)
    with pytest.raises(ValueError, match="RETIRED_BENCHMARK"):
        ev.run(REPO, ev.RETIRED_PATH, expected_package_sha256="a" * 64)
    with pytest.raises(ValueError, match="RETIRED_BENCHMARK"):
        ev.run(REPO, Path("/unused"), expected_package_sha256=ev.RETIRED_PACKAGE_SHA256)
    with pytest.raises(ValueError, match="RETIRED_BENCHMARK"):
        ev.record_interrupted_failure(ev.RETIRED_PATH)


def test_package_tampering_leaves_precheck_failure(package, fake_model):
    path, digest = package
    (path / "corpus.json").write_text("{}")
    with pytest.raises(ValueError, match="PACKAGE_FILE_HASH_MISMATCH"):
        ev.run(REPO, path, expected_package_sha256=digest)
    record = json.loads((path / ev.JOURNAL_NAME / "failure.json").read_bytes())
    assert record["failed_during"] == "PRECHECK"
    assert record["scientific_metrics_produced"] is False


def test_atomic_publication_is_exclusive(tmp_path):
    path = tmp_path / "value.json"
    ev._atomic_json_create(path, {"x": 1})
    with pytest.raises(FileExistsError):
        ev._atomic_json_create(path, {"x": 2})
    assert path.read_bytes() == b'{"x":1}\n'
    assert not list(tmp_path.glob(".pending-*"))


def test_json_rejects_duplicate_keys_and_nonfinite_values():
    with pytest.raises(ValueError, match="DUPLICATE_JSON_KEY"):
        ev._load_json(b'{"a":1,"a":2}')
    with pytest.raises(ValueError, match="NONFINITE_JSON"):
        ev._load_json(b'{"a":NaN}')


def test_invalid_and_terminal_status_transitions(tmp_path):
    journal = ev.ExecutionJournal(tmp_path, {})
    with pytest.raises(ValueError, match="INVALID_STATUS_TRANSITION"):
        journal.transition("COMPLETED")
    journal.fail(RuntimeError())
    with pytest.raises(ValueError, match="TERMINAL_STATUS"):
        journal.transition("CLAIMED")


def test_prior_diagnostic_or_failed_legacy_marker_blocks_scoring(package, fake_model):
    path, digest = package
    (path / "blind-holdout-evaluation-claim.json").write_text('{"status":"STARTED"}')
    with pytest.raises(ValueError, match="PACKAGE_ALREADY_USED_OR_OPENED"):
        ev.run(REPO, path, expected_package_sha256=digest)
    assert not (path / ev.JOURNAL_NAME / "02-SCORING.json").exists()


def test_metrics_and_embedding_formulas_are_unchanged_from_original():
    raw = subprocess.check_output(
        [
            "git",
            "-C",
            str(REPO),
            "show",
            "76eda200d7b88bd6dd6d10897fc33bb152d7f5c0:services/embedding-evaluation/src/embedding_eval/one_shot_blind_evaluation.py",
        ],
        text=True,
    )
    original = {n.name: n for n in ast.parse(raw).body if isinstance(n, ast.FunctionDef)}
    current = {
        n.name: n
        for n in ast.parse(Path(ev.__file__).read_text()).body
        if isinstance(n, ast.FunctionDef)
    }
    for name in (
        "rate",
        "binary_ndcg",
        "compute_metrics",
        "summarize_slice",
        "_load_model",
        "_embed",
    ):
        assert ast.dump(original[name]) == ast.dump(current[name])
    scoring = current["score_answerable"]
    scoring.body = [
        node
        for node in scoring.body
        if not (
            isinstance(node, ast.Assign)
            and isinstance(node.value, ast.Call)
            and isinstance(node.value.func, ast.Name)
            and node.value.func.id == "normalize_targets"
        )
    ]
    assert ast.dump(original["score_answerable"]) == ast.dump(scoring)


def test_atomic_publication_failure_does_not_leave_partial_result(tmp_path, monkeypatch):
    def fail(*args):
        raise OSError("simulated filesystem failure")

    monkeypatch.setattr(os, "link", fail)
    with pytest.raises(OSError):
        ev._atomic_json_create(tmp_path / "result.json", {"metrics": "complete"})
    assert not (tmp_path / "result.json").exists()


def test_concurrent_claim_cannot_mutate_existing_journal(tmp_path):
    ev.ExecutionJournal(tmp_path, {"run": 1})
    with pytest.raises(FileExistsError):
        ev.ExecutionJournal(tmp_path, {"run": 2})
    assert json.loads((tmp_path / ev.JOURNAL_NAME / "00-PRECHECK.json").read_bytes())["run"] == 1


def test_original_run_target_validation_keyerror_is_before_retrieval():
    raw = subprocess.check_output(
        [
            "git",
            "-C",
            str(REPO),
            "show",
            "76eda200d7b88bd6dd6d10897fc33bb152d7f5c0:services/embedding-evaluation/src/embedding_eval/one_shot_blind_evaluation.py",
        ],
        text=True,
    )
    original_run = next(
        n for n in ast.parse(raw).body if isinstance(n, ast.FunctionDef) and n.name == "run"
    )
    loop = next(
        n
        for n in original_run.body
        if isinstance(n, ast.For) and isinstance(n.target, ast.Name) and n.target.id == "qrel"
    )
    namespace = {
        "qrels": synthetic_inputs()[0],
        "chunk_to_doc": {"c1": "d1", "c3": "d3"},
        "_expect": ev._expect,
    }
    with pytest.raises(KeyError, match="chunk_id"):
        exec(  # noqa: S102 — pinned historical target-validation loop, synthetic rows only
            compile(ast.Module(body=[loop], type_ignores=[]), "original_run.py", "exec"), namespace
        )


def test_package_mutation_after_scoring_prevents_publication(package, fake_model, monkeypatch):
    path, digest = package
    original = ev.compute_metrics

    def mutate(*args):
        result = original(*args)
        (path / "qrels.json").write_text("{}")
        return result

    monkeypatch.setattr(ev, "compute_metrics", mutate)
    with pytest.raises(ValueError, match="PACKAGE_CHANGED_DURING_EVALUATION"):
        ev.run(REPO, path, expected_package_sha256=digest)
    failure = json.loads((path / ev.JOURNAL_NAME / "failure.json").read_bytes())
    assert failure["scientific_metrics_produced"] is True
    assert failure["result_published"] is False


def test_fresh_blind_mode_requires_lock_before_model(package, monkeypatch):
    path, _ = package
    manifest = json.loads((path / ev.MANIFEST_NAME).read_bytes())
    manifest["purpose"] = "BLIND"
    review = ev.canonical_bytes(
        {"scientific_review_complete": True, "fresh_sources_verified": True, "unreviewed_count": 0}
    )
    (path / "review.json").write_bytes(review)
    manifest["files"]["review.json"] = ev.sha256_bytes(review)
    raw = ev.canonical_bytes(manifest)
    (path / ev.MANIFEST_NAME).write_bytes(raw)

    def refuse(repo):
        raise ValueError("UNQUALIFIED_EVALUATOR")

    def no_model(policy):
        pytest.fail("model loaded without lock")

    monkeypatch.setattr("embedding_eval.evaluator_lock.verify_lock", refuse)
    monkeypatch.setattr(ev, "_load_model", no_model)
    with pytest.raises(ValueError, match="UNQUALIFIED_EVALUATOR"):
        ev.run(REPO, path, expected_package_sha256=ev.sha256_bytes(raw))


@pytest.mark.parametrize(
    "change,code",
    [
        ("source", "EVALUATOR_SOURCE_CHANGED"),
        ("runtime", "EVALUATOR_RUNTIME_CHANGED"),
        ("lock", "EVALUATOR_LOCK_HASH_MISMATCH"),
    ],
)
def test_lock_verification_rejects_mutation(monkeypatch, change, code):
    from embedding_eval import evaluator_lock as lock_module

    lock = build_lock(REPO, "a" * 40, {"qualification": "fixture"})
    if change == "lock":
        lock["evaluator_version"] = "modified"
    original_read = Path.read_bytes

    def read(path):
        if path == REPO / lock_module.LOCK_PATH:
            return ev.canonical_bytes(lock)
        return original_read(path)

    monkeypatch.setattr(Path, "read_bytes", read)
    if change == "source":
        monkeypatch.setattr(lock_module, "source_hashes", lambda repo: {})
    if change == "runtime":
        monkeypatch.setattr(lock_module, "runtime_versions", dict)
    with pytest.raises(ValueError, match=code):
        lock_module.verify_lock(REPO)
