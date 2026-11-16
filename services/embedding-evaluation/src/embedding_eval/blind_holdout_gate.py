"""Read-only blind evaluation preflight; no QREL parsing, model loading, or scoring.

The future runner must use verified policy bytes, atomically claim its one shot,
and validate/load the package in a separate process. This gate alone is not a
sandbox, a scientific review, or a one-shot execution mechanism.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[4]
BLIND_BENCHMARK_ID = "blind-retrieval-holdout-v2"
PACKAGE_FILES = frozenset(
    {
        "README.md",
        "blind-holdout-corpus.json",
        "blind-holdout-qrels.json",
        "blind-holdout-review-record.md",
    }
)
USE_MARKERS = (
    "blind-holdout-evaluation-claim.json",
    "blind-holdout-result.json",
    "blind-holdout-opened-for-diagnostics.json",
)
MANIFEST_FIELDS = frozenset(
    {
        "schema_version",
        "benchmark_id",
        "status",
        "source_count",
        "query_count",
        "prepared_at",
        "files",
        "package_sha256",
    }
)
FREEZE_FIELDS = frozenset(
    {
        "schema_version",
        "benchmark_id",
        "manifest_sha256",
        "package_sha256",
    }
)


class BlindGateError(ValueError):
    """A fixed error code safe to log; never attach package plaintext."""


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate JSON key")
        value[key] = item
    return value


def _read_object(path: Path, error: str) -> tuple[dict[str, Any], bytes]:
    try:
        raw = path.read_bytes()
        value = json.loads(raw, object_pairs_hook=_unique_object)
        if not isinstance(value, dict):
            raise TypeError
        # Reject non-finite JSON values before hashing or exposing them.
        canonical_sha256(value)
    except (OSError, TypeError, ValueError, UnicodeError):
        raise BlindGateError(error) from None
    return value, raw


def _package_file(package: Path, name: str) -> Path:
    path = package / name
    try:
        if path.is_symlink() or not path.is_file():
            raise BlindGateError("PACKAGE_FILE_REQUIRED")
        # Fixed basenames only, no recursive discovery or manifest-controlled paths.
        if path.resolve().parent != package or path.stat().st_nlink != 1:
            raise BlindGateError("PACKAGE_FILE_REQUIRED")
    except OSError:
        raise BlindGateError("PACKAGE_FILE_UNREADABLE") from None
    return path


@dataclass(frozen=True)
class BlindPreflight:
    benchmark_id: str
    source_count: int
    query_count: int
    selected_policy_sha256: str
    package_sha256: str
    policy_bytes: bytes = field(repr=False)
    retrieval_scoring: str = "NOT_RUN"

    def public_metadata(self) -> dict[str, str | int]:
        return {
            "benchmark_id": self.benchmark_id,
            "source_count": self.source_count,
            "query_count": self.query_count,
            "selected_policy_sha256": self.selected_policy_sha256,
            "package_sha256": self.package_sha256,
            "retrieval_scoring": self.retrieval_scoring,
        }


def prepare_blind_evaluation(
    *,
    external_package: Path,
    selected_policy: Path,
    selected_policy_sha256: str,
    expected_package_sha256: str,
) -> BlindPreflight:
    """Verify explicit inputs; return no blind query text, labels, or file contents."""
    if not _is_sha256(selected_policy_sha256):
        raise BlindGateError("POLICY_HASH_REQUIRED")
    policy, policy_bytes = _read_object(selected_policy, "POLICY_UNREADABLE")
    if canonical_sha256(policy) != selected_policy_sha256:
        raise BlindGateError("POLICY_HASH_MISMATCH")
    if (
        policy.get("holdout_scored") is not False
        or policy.get("production_changed") is not False
        or policy.get("development_partition_only") is not True
        or not isinstance(policy.get("retriever"), dict)
        or not policy["retriever"]
        or not isinstance(policy.get("abstention"), dict)
        or not policy["abstention"]
    ):
        raise BlindGateError("POLICY_STATE_REJECTED")
    if not _is_sha256(expected_package_sha256):
        raise BlindGateError("PACKAGE_HASH_REQUIRED")
    package = external_package.resolve()
    if not external_package.is_absolute() or package.is_relative_to(REPO_ROOT):
        raise BlindGateError("EXTERNAL_PATH_REQUIRED")
    if any((package / name).exists() or (package / name).is_symlink() for name in USE_MARKERS):
        raise BlindGateError("PACKAGE_ALREADY_USED_OR_OPENED")
    manifest, manifest_raw = _read_object(
        _package_file(package, "blind-holdout-manifest.json"), "MANIFEST_SCHEMA"
    )
    if (
        set(manifest) != MANIFEST_FIELDS
        or type(manifest["schema_version"]) is not int
        or manifest["schema_version"] != 1
        or manifest["benchmark_id"] != BLIND_BENCHMARK_ID
        or manifest["status"] != "SEALED"
        or any(
            type(manifest[key]) is not int or manifest[key] < 1
            for key in ("source_count", "query_count")
        )
        or not isinstance(manifest["files"], dict)
        or set(manifest["files"]) != PACKAGE_FILES
        or not all(_is_sha256(value) for value in manifest["files"].values())
    ):
        raise BlindGateError("MANIFEST_SCHEMA")
    try:
        date.fromisoformat(manifest["prepared_at"])
    except (TypeError, ValueError):
        raise BlindGateError("MANIFEST_SCHEMA") from None
    payload = {key: value for key, value in manifest.items() if key != "package_sha256"}
    package_hash = canonical_sha256(payload)
    if package_hash != expected_package_sha256 or manifest["package_sha256"] != package_hash:
        raise BlindGateError("PACKAGE_HASH_MISMATCH")
    freeze, _ = _read_object(_package_file(package, "blind-holdout-freeze.json"), "FREEZE_SCHEMA")
    if (
        set(freeze) != FREEZE_FIELDS
        or type(freeze["schema_version"]) is not int
        or freeze["schema_version"] != 1
        or freeze["benchmark_id"] != BLIND_BENCHMARK_ID
    ):
        raise BlindGateError("FREEZE_SCHEMA")
    if freeze["manifest_sha256"] != hashlib.sha256(manifest_raw).hexdigest():
        raise BlindGateError("MANIFEST_HASH_MISMATCH")
    if freeze["package_sha256"] != package_hash:
        raise BlindGateError("PACKAGE_HASH_MISMATCH")
    for name in sorted(PACKAGE_FILES):
        digest = hashlib.sha256()
        try:
            with _package_file(package, name).open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
        except OSError:
            raise BlindGateError("PACKAGE_FILE_UNREADABLE") from None
        if digest.hexdigest() != manifest["files"][name]:
            raise BlindGateError("PACKAGE_FILE_HASH_MISMATCH")
    return BlindPreflight(
        benchmark_id=BLIND_BENCHMARK_ID,
        source_count=manifest["source_count"],
        query_count=manifest["query_count"],
        selected_policy_sha256=selected_policy_sha256,
        package_sha256=package_hash,
        policy_bytes=policy_bytes,
    )


def blind_result_row(query_id: str, *, rank: int | None, hit: bool) -> dict[str, Any]:
    """Allowlist future per-query logs; identifiers have no semantic interpretation."""
    if (
        not isinstance(query_id, str)
        or not re.fullmatch(r"bhv2-[0-9]{4}", query_id)
        or (query_id == "bhv2-0000")
    ):
        raise BlindGateError("OPAQUE_QUERY_ID_REQUIRED")
    if (rank is not None and (type(rank) is not int or rank < 1)) or type(hit) is not bool:
        raise BlindGateError("INVALID_RESULT_SUMMARY")
    return {"query_id": query_id, "rank": rank, "hit": hit}


class _PrivateArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        # argparse normally echoes invalid user input. Keep private values out.
        raise BlindGateError("ARGUMENTS_REQUIRED_OR_INVALID")


def main(argv: list[str] | None = None) -> int:
    parser = _PrivateArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--preflight", action="store_true", required=True)
    parser.add_argument("--external-package", type=Path, required=True)
    parser.add_argument("--selected-policy", type=Path, required=True)
    parser.add_argument("--selected-policy-sha256", required=True)
    parser.add_argument("--expected-package-sha256", required=True)
    try:
        args = parser.parse_args(argv)
        result = prepare_blind_evaluation(
            external_package=args.external_package,
            selected_policy=args.selected_policy,
            selected_policy_sha256=args.selected_policy_sha256,
            expected_package_sha256=args.expected_package_sha256,
        )
    except BlindGateError as exc:
        print(json.dumps({"error": str(exc), "retrieval_scoring": "NOT_RUN"}, sort_keys=True))
        return 2
    print(json.dumps(result.public_metadata(), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
