"""Firewall tests use synthetic canaries, never real holdout plaintext."""

import ast
import hashlib
import inspect
import json
from pathlib import Path

import pytest

from embedding_eval import frozen_policy_dev_v1, policy_dev_evaluate
from embedding_eval.blind_holdout_gate import (
    BlindGateError,
    blind_result_row,
    canonical_sha256,
    main,
    prepare_blind_evaluation,
)

EVAL_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = EVAL_ROOT.parents[1]
CANARY = "PRIVATE_SYNTHETIC_QUERY_CANARY"


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n")


def seal(package: Path, manifest: dict) -> str:
    manifest = {key: value for key, value in manifest.items() if key != "package_sha256"}
    manifest["package_sha256"] = canonical_sha256(manifest)
    write_json(package / "blind-holdout-manifest.json", manifest)
    write_json(
        package / "blind-holdout-freeze.json",
        {
            "schema_version": 1,
            "benchmark_id": "blind-retrieval-holdout-v2",
            "manifest_sha256": hashlib.sha256(
                (package / "blind-holdout-manifest.json").read_bytes()
            ).hexdigest(),
            "package_sha256": manifest["package_sha256"],
        },
    )
    return manifest["package_sha256"]


@pytest.fixture
def synthetic_gate(tmp_path: Path) -> dict:
    # Temporary synthetic bytes only; this is not the future blind package.
    assert not tmp_path.resolve().is_relative_to(REPO_ROOT)
    package = tmp_path / "synthetic-package"
    package.mkdir()
    contents = {
        "README.md": b"Synthetic firewall fixture, not a scientific benchmark.\n",
        "blind-holdout-corpus.json": b'{"synthetic":true}',
        "blind-holdout-qrels.json": json.dumps({"query_id": "bhv2-0001", "query": CANARY}).encode(),
        "blind-holdout-review-record.md": b"Synthetic test; no human judgment claimed.\n",
    }
    for name, content in contents.items():
        (package / name).write_bytes(content)
    manifest = {
        "schema_version": 1,
        "benchmark_id": "blind-retrieval-holdout-v2",
        "status": "SEALED",
        "source_count": 1,
        "query_count": 1,
        "prepared_at": "2026-09-24",
        "files": {name: hashlib.sha256(content).hexdigest() for name, content in contents.items()},
    }
    package_hash = seal(package, manifest)
    policy = {
        "development_partition_only": True,
        "holdout_scored": False,
        "production_changed": False,
        "retriever": {"policy_id": "synthetic-only", "parameters": {}},
        "abstention": {"rule_id": "synthetic-only", "threshold": 0.5},
    }
    policy_path = tmp_path / "synthetic-policy.json"
    write_json(policy_path, policy)
    return {
        "external_package": package,
        "selected_policy": policy_path,
        "selected_policy_sha256": canonical_sha256(policy),
        "expected_package_sha256": package_hash,
    }


def test_dev_preparation_reads_only_pinned_dev_file(monkeypatch: pytest.MonkeyPatch) -> None:
    original_open = Path.open
    opened = []

    def dev_only_open(path: Path, *args, **kwargs):
        assert path.resolve() == frozen_policy_dev_v1.DEV_QRELS_PATH.resolve()
        opened.append(path)
        return original_open(path, *args, **kwargs)

    def forbid_discovery(*args, **kwargs):
        pytest.fail("DEV preparation attempted filesystem discovery")

    monkeypatch.setattr(Path, "open", dev_only_open)
    monkeypatch.setattr(Path, "glob", forbid_discovery)
    monkeypatch.setattr(Path, "rglob", forbid_discovery)
    monkeypatch.setattr(Path, "iterdir", forbid_discovery)
    inputs = policy_dev_evaluate.prepare_dev_evaluation()
    assert len(inputs.qrels) == 71
    assert sum(not row["no_answer"] for row in inputs.qrels) == 50
    assert sum(row["no_answer"] for row in inputs.qrels) == 21
    assert len(opened) == 1
    assert "query" not in repr(inputs)


def test_dev_path_has_no_blind_loader_or_scoring_imports() -> None:
    for module in (frozen_policy_dev_v1, policy_dev_evaluate):
        tree = ast.parse(inspect.getsource(module))
        imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                imports.append(node.module)
        assert set(imports) <= {
            "__future__",
            "argparse",
            "dataclasses",
            "hashlib",
            "json",
            "pathlib",
            "typing",
            "frozen_policy_dev_v1",
        }
    assert not hasattr(frozen_policy_dev_v1, "load_holdout_qrels")
    assert not hasattr(frozen_policy_dev_v1, "_load_partition")
    assert not hasattr(frozen_policy_dev_v1, "load_all_qrels")
    assert "load_dev_qrels" in inspect.getsource(policy_dev_evaluate.prepare_dev_evaluation)


def test_dev_loader_rejects_replaced_artifact(tmp_path: Path, monkeypatch) -> None:
    replaced = tmp_path / "substituted.json"
    replaced.write_text(CANARY)
    monkeypatch.setattr(frozen_policy_dev_v1, "DEV_QRELS_PATH", replaced)
    with pytest.raises(ValueError, match="DEV artifact digest mismatch"):
        frozen_policy_dev_v1.load_dev_qrels()


def test_blind_gate_requires_explicit_path_and_hashes() -> None:
    signature = inspect.signature(prepare_blind_evaluation)
    for name in (
        "external_package",
        "selected_policy",
        "selected_policy_sha256",
        "expected_package_sha256",
    ):
        assert signature.parameters[name].default is inspect.Parameter.empty
    with pytest.raises(TypeError):
        prepare_blind_evaluation()


def test_valid_preflight_is_private_read_only_and_not_scoring(synthetic_gate, capsys) -> None:
    package = synthetic_gate["external_package"]
    before = {p.name: p.read_bytes() for p in package.iterdir()}
    permit = prepare_blind_evaluation(**synthetic_gate)
    assert permit.selected_policy_sha256 == synthetic_gate["selected_policy_sha256"]
    assert permit.package_sha256 == synthetic_gate["expected_package_sha256"]
    assert permit.retrieval_scoring == "NOT_RUN"
    assert CANARY not in repr(permit)
    assert capsys.readouterr() == ("", "")
    assert {p.name: p.read_bytes() for p in package.iterdir()} == before
    # Immutable verified bytes are the future runner's policy input, not a path to re-read.
    assert canonical_sha256(json.loads(permit.policy_bytes)) == permit.selected_policy_sha256
    with pytest.raises(AttributeError):
        permit.policy_bytes = b"changed"


@pytest.mark.parametrize("bad_hash", ["", "wrong", "0" * 64, None])
def test_policy_hash_rejected_before_external_package_access(synthetic_gate, bad_hash) -> None:
    synthetic_gate["selected_policy_sha256"] = bad_hash
    synthetic_gate["external_package"] = Path("/nonexistent-unopened-package")
    with pytest.raises(BlindGateError, match="POLICY_HASH"):
        prepare_blind_evaluation(**synthetic_gate)


def test_absent_policy_refused(synthetic_gate) -> None:
    synthetic_gate["selected_policy"] = Path("/nonexistent-policy.json")
    with pytest.raises(BlindGateError, match="POLICY_UNREADABLE"):
        prepare_blind_evaluation(**synthetic_gate)


@pytest.mark.parametrize(
    "field,value",
    [
        ("holdout_scored", True),
        ("production_changed", True),
        ("holdout_scored", 0),
        ("development_partition_only", False),
    ],
)
def test_policy_state_gate(synthetic_gate, field, value) -> None:
    path = synthetic_gate["selected_policy"]
    policy = json.loads(path.read_bytes())
    policy[field] = value
    write_json(path, policy)
    synthetic_gate["selected_policy_sha256"] = canonical_sha256(policy)
    with pytest.raises(BlindGateError, match="POLICY_STATE"):
        prepare_blind_evaluation(**synthetic_gate)


@pytest.mark.parametrize("location", [REPO_ROOT, Path("relative-package")])
def test_repo_and_relative_packages_refused(synthetic_gate, location) -> None:
    synthetic_gate["external_package"] = location
    with pytest.raises(BlindGateError, match="EXTERNAL_PATH_REQUIRED"):
        prepare_blind_evaluation(**synthetic_gate)


def test_symlink_into_repository_refused(synthetic_gate, tmp_path) -> None:
    link = tmp_path / "alias"
    link.symlink_to(REPO_ROOT, target_is_directory=True)
    synthetic_gate["external_package"] = link
    with pytest.raises(BlindGateError, match="EXTERNAL_PATH_REQUIRED"):
        prepare_blind_evaluation(**synthetic_gate)


@pytest.mark.parametrize("filename", ["blind-holdout-qrels.json", "blind-holdout-corpus.json"])
def test_package_file_tampering_is_rejected_without_plaintext(synthetic_gate, filename) -> None:
    (synthetic_gate["external_package"] / filename).write_text(CANARY)
    with pytest.raises(BlindGateError, match="PACKAGE_FILE_HASH") as exc:
        prepare_blind_evaluation(**synthetic_gate)
    assert CANARY not in str(exc.value)


def test_package_hash_gate(synthetic_gate) -> None:
    synthetic_gate["expected_package_sha256"] = "0" * 64
    with pytest.raises(BlindGateError, match="PACKAGE_HASH"):
        prepare_blind_evaluation(**synthetic_gate)


def test_missing_package_hash_refused(synthetic_gate) -> None:
    synthetic_gate["expected_package_sha256"] = ""
    with pytest.raises(BlindGateError, match="PACKAGE_HASH_REQUIRED"):
        prepare_blind_evaluation(**synthetic_gate)


def test_policy_parameter_change_invalidates_frozen_hash(synthetic_gate) -> None:
    path = synthetic_gate["selected_policy"]
    policy = json.loads(path.read_bytes())
    policy["abstention"]["threshold"] = 0.6
    write_json(path, policy)
    with pytest.raises(BlindGateError, match="POLICY_HASH_MISMATCH"):
        prepare_blind_evaluation(**synthetic_gate)


def test_duplicate_policy_keys_refused(synthetic_gate) -> None:
    synthetic_gate["selected_policy"].write_text('{"holdout_scored":false,"holdout_scored":true}')
    with pytest.raises(BlindGateError, match="POLICY_UNREADABLE"):
        prepare_blind_evaluation(**synthetic_gate)


def test_package_file_symlink_refused(synthetic_gate, tmp_path) -> None:
    path = synthetic_gate["external_package"] / "blind-holdout-qrels.json"
    moved = tmp_path / "synthetic-canary.json"
    path.rename(moved)
    path.symlink_to(moved)
    with pytest.raises(BlindGateError, match="PACKAGE_FILE_REQUIRED"):
        prepare_blind_evaluation(**synthetic_gate)


def test_preflight_does_not_deserialize_blind_qrels(synthetic_gate, monkeypatch) -> None:
    loads = json.loads

    def forbid_query_parse(value, *args, **kwargs):
        assert CANARY.encode() not in (value.encode() if isinstance(value, str) else value)
        return loads(value, *args, **kwargs)

    monkeypatch.setattr(json, "loads", forbid_query_parse)
    prepare_blind_evaluation(**synthetic_gate)


def test_manifest_and_freeze_mismatch_refused(synthetic_gate) -> None:
    path = synthetic_gate["external_package"] / "blind-holdout-freeze.json"
    freeze = json.loads(path.read_bytes())
    freeze["manifest_sha256"] = "0" * 64
    write_json(path, freeze)
    with pytest.raises(BlindGateError, match="MANIFEST_HASH"):
        prepare_blind_evaluation(**synthetic_gate)


def test_manifest_rejects_plaintext_or_extra_file_paths(synthetic_gate) -> None:
    package = synthetic_gate["external_package"]
    manifest = json.loads((package / "blind-holdout-manifest.json").read_bytes())
    manifest["query"] = CANARY
    synthetic_gate["expected_package_sha256"] = seal(package, manifest)
    with pytest.raises(BlindGateError, match="MANIFEST_SCHEMA") as exc:
        prepare_blind_evaluation(**synthetic_gate)
    assert CANARY not in str(exc.value)
    del manifest["query"]
    manifest["files"]["../escape.json"] = "0" * 64
    synthetic_gate["expected_package_sha256"] = seal(package, manifest)
    with pytest.raises(BlindGateError, match="MANIFEST_SCHEMA"):
        prepare_blind_evaluation(**synthetic_gate)


@pytest.mark.parametrize(
    "marker",
    [
        "blind-holdout-evaluation-claim.json",
        "blind-holdout-result.json",
        "blind-holdout-opened-for-diagnostics.json",
    ],
)
def test_consumed_or_opened_package_refused(synthetic_gate, marker) -> None:
    (synthetic_gate["external_package"] / marker).write_text("{}")
    with pytest.raises(BlindGateError, match="PACKAGE_ALREADY_USED_OR_OPENED"):
        prepare_blind_evaluation(**synthetic_gate)


def test_blind_rows_are_opaque_and_have_no_plaintext_field() -> None:
    assert blind_result_row("bhv2-0001", rank=2, hit=True) == {
        "query_id": "bhv2-0001",
        "rank": 2,
        "hit": True,
    }
    for identifier in ("chromium-query", CANARY, "bhv2-0001\nprivate", "bhv2-0000"):
        with pytest.raises(BlindGateError, match="OPAQUE_QUERY_ID_REQUIRED"):
            blind_result_row(identifier, rank=None, hit=False)


def test_cli_preflight_does_not_log_plaintext_or_claim_evaluation(synthetic_gate, capsys) -> None:
    assert (
        main(
            [
                "--preflight",
                "--external-package",
                str(synthetic_gate["external_package"]),
                "--selected-policy",
                str(synthetic_gate["selected_policy"]),
                "--selected-policy-sha256",
                synthetic_gate["selected_policy_sha256"],
                "--expected-package-sha256",
                synthetic_gate["expected_package_sha256"],
            ]
        )
        == 0
    )
    output = capsys.readouterr()
    assert CANARY not in output.out + output.err
    assert "NOT_RUN" in output.out
    assert "policy_bytes" not in output.out


def test_canonical_hash_is_deterministic() -> None:
    assert canonical_sha256({"b": 2, "a": 1}) == canonical_sha256({"a": 1, "b": 2})
    with pytest.raises(ValueError):
        canonical_sha256({"bad": float("nan")})


def test_cli_invalid_arguments_never_echo_private_values(capsys) -> None:
    assert main(["--query", CANARY]) == 2
    output = capsys.readouterr()
    assert CANARY not in output.out + output.err
    assert "ARGUMENTS_REQUIRED_OR_INVALID" in output.out


def test_blind_cli_missing_required_inputs_refused(capsys) -> None:
    assert main(["--preflight"]) == 2
    assert "ARGUMENTS_REQUIRED_OR_INVALID" in capsys.readouterr().out


def test_dev_preflight_cli_does_not_invoke_scoring(capsys) -> None:
    assert policy_dev_evaluate.main(["--preflight"]) == 0
    output = json.loads(capsys.readouterr().out)
    assert output["query_count"] == 71
    assert output["answerable_count"] == 50
    assert output["no_answer_count"] == 21
    assert output["retrieval_scoring"] == "NOT_RUN"


def test_no_actual_blind_content_or_package_in_repository() -> None:
    # Filename enumeration only; never search artifact contents.
    for filename in (
        "blind-holdout-qrels.json",
        "blind-holdout-corpus.json",
        "blind-holdout-freeze.json",
    ):
        assert not list(EVAL_ROOT.rglob(filename))
    assert not (REPO_ROOT / "chemdft-holdout-v2").exists()
