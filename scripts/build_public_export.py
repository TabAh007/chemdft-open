#!/usr/bin/env python3
"""Build a CLEAN public export (plain directory tree, no git history) for ONE commit.

    python3 scripts/build_public_export.py <commit-sha> [--out DIR] [--exclude PATTERN ...]

Scope: every path REUSE.toml marks Apache-2.0, minus every path an annotation marks with a LicenseRef-* licence
(third-party, not-for-publication, artwork), minus EXCLUDE_PATTERNS below. Only committed content is used (`git archive`).
Nothing is published or uploaded. The whole export is content-scanned (SCAN_CATEGORIES); finding VALUES are never printed,
only the category, the file path and a count. Exit code 1 if any finding remains.

Reuses the helpers of scripts/build_zenodo_snapshot.py (git, resolve, show, read_members, clean, apache_patterns).
"""

from __future__ import annotations

import argparse
import fnmatch
import importlib.util
import json
import re
import shutil
import sys
import tomllib
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("build_zenodo_snapshot", HERE / "build_zenodo_snapshot.py")
snap = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
sys.modules["build_zenodo_snapshot"] = snap
_spec.loader.exec_module(snap)  # type: ignore[union-attr]

DEFAULT_OUT = Path.home() / "Desktop" / "chemdft" / "_work" / "public-export"

# Excluded in addition to the REUSE.toml LicenseRef-* paths (third-party, not-for-publication, artwork).
EXCLUDE_PATTERNS = (
    "node_modules/**",
    "**/node_modules/**",
    ".env",
    ".env.*",
    "**/.env",
    "**/.env.*",
    ".claude/**",
    ".mcp.json",
    "CLAUDE.md",
    "AGENTS.md",
    "**/CLAUDE.md",
    "**/AGENTS.md",
    # internal process / operations notes that name accounts, hosts and a second project (decision in the PR report)
    "DECISIONS.md",
    "NEXT.md",
    # AWS pilot infrastructure: pervasive account, instance and project identifiers; excluded rather than made neutral
    "infra/aws/**",
    "tools/vercel_set_*.sh",
    "tools/check_backend.sh",
    "tools/render_backend_secrets.py",
    "tools/export_poc/live_smoke_test.mjs",
    "**/__pycache__/**",
    "**/*.pyc",
    # (psi4_environment.json is NOT excluded: psi4.py reads it at import time and it holds no identifier)
    # internal agent memory and handoffs
    "docs/history/**",
    "docs/TECHNOLOGY_REGISTRY.md",
    "docs/TEST_ENVIRONMENT_ISOLATION.md",
    "docs/17_RW3_HANDOFF.md",
    # phase contracts and verifications
    "docs/**/PHASE_*",
    # milestone reports, acceptances, preflights, checkpoints, recoveries, handoffs, status reports
    "docs/implementation/RELEASE_*",
    "docs/implementation/PF-*",
    "docs/implementation/AS-*",
    "docs/implementation/AS_*",
    "docs/implementation/*ACCEPTANCE*",
    "docs/implementation/*PREFLIGHT*",
    "docs/implementation/*CHECKPOINT*",
    "docs/implementation/*RECOVERY*",
    "docs/implementation/*REPORT*",
    "docs/implementation/*HANDOFF*",
    "docs/implementation/*RECONCILIATION*",
    "docs/implementation/*STATUS*",
    # Subdirectories with spikes, fixtures, captures, measurements
    "docs/implementation/captures-0.0.51/**",
    "docs/implementation/captures-0.0.52/**",
    "docs/implementation/external_import_spike/**",
    "docs/implementation/external_import_acceptance/**",
    "docs/implementation/experimental_spectra_spike/**",
    "docs/implementation/measurements/**",
    "docs/implementation/thermochemistry_acceptance/**",
    "docs/implementation/thermochemistry_spike/**",
    "docs/implementation/ai_eval/**",
    "docs/implementation/sql/**",
    "docs/implementation/pf7-ai/**",
    # Specific implementation reports, evals, spikes, checklists, notes, repairs
    "docs/implementation/2D_TO_3D_GEOMETRY_FOUNDATION.md",
    "docs/implementation/AI_CHAT_MODEL_EVALUATION.md",
    "docs/implementation/AI_MODEL_BENCHMARK_PLAN.md",
    "docs/implementation/AI_PROVIDER_TERMS_FOR_BETA.md",
    "docs/implementation/AWS_COMPUTE_PROVIDER.md",
    "docs/implementation/AWS_ON_DEMAND_COMPUTE.md",
    "docs/implementation/BETA_OWNER_CHECKLIST.md",
    "docs/implementation/BLIND_EVALUATOR_FREEZE.md",
    "docs/implementation/BLIND_HOLDOUT_PACKAGE.md",
    "docs/implementation/CHEMDFT_PROJECT_MEMORY.md",
    "docs/implementation/CI_MINUTES.md",
    "docs/implementation/COMPLEX_BUILDER_DESIGN_NOTE.md",
    "docs/implementation/CREST_NITROGEN_VERIFICATION_PLAN.md",
    "docs/implementation/EMAIL_DELIVERY_DESIGN.md",
    "docs/implementation/EMBEDDING_EVALUATION.md",
    "docs/implementation/EMBEDDING_MIGRATION_PLAN.md",
    "docs/implementation/ENGINE_EXPANSION_PLAN.md",
    "docs/implementation/ENGINE_LINUX_BUILD_AUDIT.md",
    "docs/implementation/EXPERIMENTAL_SPECTRA_SPIKE.md",
    "docs/implementation/EXPORT_AND_SHARE.md",
    "docs/implementation/EXTERNAL_IMPORT_CCLIB_SPIKE.md",
    "docs/implementation/IR_DEPENDENCY_SPIKE.md",
    "docs/implementation/IR_VALIDATION_GATE.md",
    "docs/implementation/KNOWLEDGE_INDEX_WORKER.md",
    "docs/implementation/LIVE_SMOKE.md",
    "docs/implementation/MODAL_PROVIDER.md",
    "docs/implementation/NEMOTRON_TOKENIZER_MEASUREMENT.md",
    "docs/implementation/NVIDIA_MODEL_DISCOVERY.md",
    "docs/implementation/NVIDIA_SUPERVISED_USAGE_PROBE.md",
    "docs/implementation/OPEN_CORE_AND_ZENODO.md",
    "docs/implementation/OWNER_DECISIONS.md",
    "docs/implementation/PAPER_TEST_FIXES_0_0_11.md",
    "docs/implementation/POSTGRES_UTC_SESSION.md",
    "docs/implementation/PRIVATE_BETA_LAUNCH.md",
    "docs/implementation/PRODUCT_FOUNDATION_SPIKE.md",
    "docs/implementation/PUBLICATION_READINESS.md",
    "docs/implementation/RAG_EVALUATION.md",
    "docs/implementation/RAMAN_DEPENDENCY_SPIKE.md",
    "docs/implementation/REAL_PAPER_RETRIEVAL_BENCHMARK.md",
    "docs/implementation/RETRIEVAL_EVALUATION_CONSOLIDATION.md",
    "docs/implementation/RETRIEVAL_POLICY_EVALUATION.md",
    "docs/implementation/SCIENTIFIC_RENDERER_BENCHMARK.md",
    "docs/implementation/STRUCTURE_RECONSTRUCTION_EVALUATION.md",
    "docs/implementation/STRUCTURE_RECONSTRUCTION_STRATEGY.md",
    "docs/implementation/THERMOCHEMISTRY_DEPENDENCY_SPIKE.md",
    "docs/implementation/WORKSPACE_LAYOUT_OTHER_PAGES.md",
    "docs/implementation/WORKSPACE_RESPONSIVE_CHROME109_REPAIR.md",
    "docs/implementation/XYZ_ELECTRONIC_STATE_REGRESSION_REPAIR.md",
    "docs/implementation/ZENODO_RELEASE_CHECKLIST.md",
    # tests that read a path excluded above (infra/aws, tools/, the git tree); they stay in the private repo unchanged
    "services/api/tests/test_aws_compute_provider.py",
    "services/api/tests/test_aws_timeout_vs_host_cap.py",
    "services/api/tests/test_aws_on_demand.py",
    "services/api/tests/test_aws_timeout_fits_session.py",  # imports test_aws_timeout_vs_host_cap
    "services/api/tests/test_aws_host_fsize.py",
    "services/api/tests/test_aws_periodic_pyscf_dispatch.py",
    "services/api/tests/test_render_backend_secrets.py",
    "services/api/tests/test_hosted_configuration.py",
    "services/api/tests/test_zenodo_snapshot.py",
    "services/api/tests/test_licensing_map.py",
)
KEEP_ENV_EXAMPLE = {".env.example"}

# A pattern must match the way it is written; values are never printed.
SCAN_CATEGORIES: dict[str, re.Pattern[str]] = {
    "aws-account-id": re.compile(r"(?<!\d)2112" r"36626730(?!\d)"),
    "ec2-instance-id": re.compile(r"\bi-(?:[0-9a-f]{17}|[0-9a-f]{8})\b"),
    "s3-bucket-name": re.compile(r"\bchemdft(?:-[a-z0-9]+)*-(?:[0-9]{12})(?:-[a-z0-9-]+)?\b|s3://(?!<)[a-z0-9][a-z0-9.-]{2,}"),
    "sslip-host-or-ip": re.compile(r"sslip\.io|100[-.]26[-.]130[-.]224", re.I),
    "email-address": re.compile(r"tabriz" r"007|tabs" r"gcp|[A-Za-z0-9._%+-]+@premium" r"robots\.ai", re.I),
    "vercel-id": re.compile(r"\b(?:prj|team|dpl)_[A-Za-z0-9]{12,}\b"),
    "other-project-name": re.compile(r"care" r"trace", re.I),
    "private-key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "api-key-or-token": re.compile(
        r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bnvapi-[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9_-]{24,}|\bghp_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}"
        r"|\bxox[abp]-[A-Za-z0-9-]{20,}|\bhf_[A-Za-z0-9]{30,}"
        r"""|(?i:\b(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token)\b)\s*[:=]\s*['"][A-Za-z0-9+/_-]{16,}['"]"""
    ),
    "local-path": re.compile(r"(?<![\w./:<-])(?:/Users/|/home/)(?!<)[A-Za-z0-9._-]+"),
    "ssm-parameter-path": re.compile(r"(?<![\w.-])/chemdft/(?!<)[A-Za-z0-9_-]+/[A-Za-z0-9_/.-]+"),
    "zenodo-token": re.compile(r"(?i:zenodo[_-]?(?:access[_-]?)?token)\s*[:=]\s*['\"]?[A-Za-z0-9]{20,}"),
}
TEXT_SUFFIXES = snap.TEXT_SUFFIXES | {".tsx", ".css", ".svg", ".sql", ".mdx", ".tf", ".lock", ".example", ".gitignore", ".env"}


def non_apache_patterns(reuse_toml: str) -> list[str]:
    out: list[str] = []
    for ann in tomllib.loads(reuse_toml).get("annotations", []):
        if str(ann.get("SPDX-License-Identifier", "")).startswith("LicenseRef-"):
            paths = ann["path"]
            out += [paths] if isinstance(paths, str) else list(paths)
    return out


def matches(path: str, pattern: str) -> bool:
    if pattern.endswith("/**"):
        return path.startswith(pattern[:-2])
    if pattern.startswith("**/"):
        tail = pattern[3:]
        return fnmatch.fnmatch(path, tail) or fnmatch.fnmatch(path.rsplit("/", 1)[-1], tail) or ("/" + tail.rstrip("/*") + "/") in "/" + path
    return fnmatch.fnmatch(path, pattern)


def select(sha: str, extra_exclude: tuple[str, ...]) -> tuple[list[str], dict[str, int]]:
    reuse = snap.show(sha, "REUSE.toml")
    apache = snap.apache_patterns(reuse)
    excluded_license = non_apache_patterns(reuse)
    tracked = str(snap.git("ls-tree", "-r", "--name-only", sha)).splitlines()
    chosen: list[str] = []
    dropped: dict[str, int] = defaultdict(int)
    for path in tracked:
        in_apache = any(matches(path, p) for p in apache)
        if path.startswith("LICENSES/"):
            chosen.append(path)
            continue
        if path in ("REUSE.toml",):
            chosen.append(path)
            continue
        if not in_apache:
            dropped["not-apache-annotated"] += 1
            continue
        if any(matches(path, p) for p in excluded_license):
            dropped["reuse-licenseref (third-party/not-for-publication/artwork)"] += 1
            continue
        if path not in KEEP_ENV_EXAMPLE and any(matches(path, p) for p in (*EXCLUDE_PATTERNS, *extra_exclude)):
            dropped["export-exclude-pattern"] += 1
            continue
        chosen.append(path)
    return sorted(chosen), dict(dropped)


def scan(members: dict[str, bytes]) -> dict[str, dict[str, int]]:
    """category -> {path: match count}. Values are never returned."""
    result: dict[str, dict[str, int]] = {c: {} for c in SCAN_CATEGORIES}
    for name, data in sorted(members.items()):
        if b"\x00" in data[:4096]:
            continue
        text = data.decode("utf-8", errors="ignore")
        for category, rx in SCAN_CATEGORIES.items():
            n = len(rx.findall(text))
            if n:
                result[category][name] = n
    return result


def build(sha_in: str, out: Path, extra_exclude: tuple[str, ...], scan_only: bool = False) -> int:
    sha = snap.resolve(sha_in)
    paths, dropped = select(sha, extra_exclude)
    members = snap.read_members(sha, paths)
    members, replaced = snap.clean(members)  # /Users/<name>/ -> <local-path>/ in text files
    findings = scan(members)
    totals = {c: sum(v.values()) for c, v in findings.items()}
    files_with = {c: len(v) for c, v in findings.items()}
    print(f"commit: {sha}\nselected files: {len(members)}\ndropped: {json.dumps(dropped)}\nlocal paths auto-neutralised: {replaced}")
    for category in SCAN_CATEGORIES:
        print(f"scan {category}: {totals[category]} matches in {files_with[category]} files")
        for path, n in findings[category].items():
            print(f"    {path} ({n})")
    bad = [f"{n}: {e}" for n, d in members.items() if n.endswith(".json") for e in _json_err(d)]
    for item in bad:
        print(f"  JSON ERROR: {item}")
    clean_ok = not any(totals.values()) and not bad
    print("SCAN PASS" if clean_ok else "SCAN FAIL")
    if clean_ok and not scan_only:
        if out.exists():
            shutil.rmtree(out)
        for name, data in members.items():
            target = out / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        size = sum(len(d) for d in members.values())
        print(f"written: {out}\nfiles: {len(members)}\nbytes: {size}")
    return 0 if clean_ok else 1


def _json_err(data: bytes) -> list[str]:
    try:
        json.loads(data)
        return []
    except ValueError as exc:
        return [str(exc)[:80]]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sha")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--exclude", action="append", default=[], help="extra path pattern to exclude (repeatable)")
    ap.add_argument("--scan-only", action="store_true", help="report findings, write nothing")
    args = ap.parse_args()
    return build(args.sha, args.out, tuple(args.exclude), args.scan_only)


if __name__ == "__main__":
    sys.exit(main())
