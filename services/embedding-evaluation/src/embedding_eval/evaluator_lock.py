"""Content-addressed evaluator release lock; no benchmark discovery or reads."""

from __future__ import annotations

import importlib.metadata
import platform
import subprocess
from pathlib import Path

from .one_shot_blind_evaluation import (
    EVALUATOR_VERSION,
    EXPECTED_MODEL_REVISION,
    POLICY_COMMIT,
    POLICY_SHA256,
    RESULT_SCHEMA_VERSION,
    STATUS_MACHINE_VERSION,
    _expect,
    _load_json,
    canonical_bytes,
    load_policy,
    sha256_bytes,
)

ROOT = Path("services/embedding-evaluation")
LOCK_PATH = ROOT / "results/blind-evaluator-v1/evaluator-lock.json"
SOURCE_FILES = (
    ROOT / "src/embedding_eval/one_shot_blind_evaluation.py",
    ROOT / "src/embedding_eval/evaluator_lock.py",
    ROOT / "src/embedding_eval/qualify_evaluator.py",
    ROOT / "src/embedding_eval/policy_dev_runner.py",
    ROOT / "src/embedding_eval/frozen_policy_dev_v1.py",
    ROOT / "src/embedding_eval/models.py",
    ROOT / "src/embedding_eval/retrieval.py",
    ROOT / "src/embedding_eval/retrieval_policy.py",
    ROOT / "src/embedding_eval/metrics.py",
    ROOT / "tests/test_one_shot_blind_evaluation.py",
    ROOT / "pyproject.toml",
    ROOT / "uv.lock",
)
LIBRARIES = (
    "numpy",
    "torch",
    "sentence-transformers",
    "transformers",
    "tokenizers",
    "huggingface-hub",
)


def source_hashes(repo: Path) -> dict[str, str]:
    return {str(p): sha256_bytes((repo / p).read_bytes()) for p in SOURCE_FILES}


def implementation_digest(repo: Path) -> str:
    return sha256_bytes(canonical_bytes(source_hashes(repo)))


def runtime_versions() -> dict[str, str]:
    return {
        "python": platform.python_version(),
        **{n: importlib.metadata.version(n) for n in LIBRARIES},
    }


def lock_digest(value: dict) -> str:
    return sha256_bytes(
        canonical_bytes({k: v for k, v in value.items() if k != "blind_evaluator_sha256"})
    )


def build_lock(repo: Path, source_commit: str, qualification: dict) -> dict:
    _, policy = load_policy(repo)
    lock = {
        "schema_version": 1,
        "evaluator_version": EVALUATOR_VERSION,
        "evaluator_source_commit": source_commit,
        "evaluator_entrypoint": "embedding_eval.one_shot_blind_evaluation",
        "source_files_sha256": source_hashes(repo),
        "selected_policy_sha256": POLICY_SHA256,
        "policy_selection_commit": POLICY_COMMIT,
        "model_revision": EXPECTED_MODEL_REVISION,
        "model": policy["model"],
        "embedding": policy["embedding"],
        "retriever": policy["retriever"],
        "abstention": policy["abstention"],
        "schemas": {
            "package": 2,
            "qrels": 1,
            "corpus": 1,
            "result": RESULT_SCHEMA_VERSION,
            "status_machine": STATUS_MACHINE_VERSION,
        },
        "package_versions": runtime_versions(),
        "platform": {"system": platform.system(), "machine": platform.machine()},
        "determinism": {
            "inference": "evaluation mode; no sampling; frozen model defaults",
            "ranking": "float32 cosine dot product; score descending; chunk_id ascending",
            "serialization": "UTF-8 sorted keys, compact JSON, finite values; no wall clock in scientific result",
            "policy_seeds": policy["seeds"],
            "qualification_seed": 20260925,
        },
        "test_qualification": qualification,
        "blind_v2_status": "FAILED_EXECUTION_NO_RESULT",
    }
    lock["blind_evaluator_sha256"] = lock_digest(lock)
    return lock


def verify_lock(repo: Path) -> dict:
    lock = _load_json((repo / LOCK_PATH).read_bytes())
    _expect(lock.get("blind_evaluator_sha256") == lock_digest(lock), "EVALUATOR_LOCK_HASH_MISMATCH")
    _expect(lock.get("source_files_sha256") == source_hashes(repo), "EVALUATOR_SOURCE_CHANGED")
    _expect(lock.get("package_versions") == runtime_versions(), "EVALUATOR_RUNTIME_CHANGED")
    _expect(
        lock.get("platform") == {"system": platform.system(), "machine": platform.machine()},
        "EVALUATOR_PLATFORM_CHANGED",
    )
    load_policy(repo)
    _expect(lock.get("selected_policy_sha256") == POLICY_SHA256, "EVALUATOR_POLICY_MISMATCH")
    for path, digest in lock["source_files_sha256"].items():
        raw = subprocess.check_output(
            ["git", "-C", str(repo), "show", f"{lock['evaluator_source_commit']}:{path}"]
        )
        _expect(sha256_bytes(raw) == digest, "EVALUATOR_COMMIT_MISMATCH")
    return lock
