#!/usr/bin/env python3
"""Helpers for scripts/local-gate (stdlib only; no network, no AWS, no providers)."""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "scripts" / "local-gate-baseline.txt"


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False).stdout


def main_checkout() -> Path:
    """The primary checkout that owns node_modules and .venv (the parent of the git common dir)."""
    common = Path(git("rev-parse", "--path-format=absolute", "--git-common-dir").strip())
    return common.parent


def changed_files(base: str) -> list[str]:
    """Files differing from `base` (committed, staged, unstaged and untracked), repo-relative."""
    names: set[str] = set()
    merge_base = git("merge-base", base, "HEAD").strip() or base
    for out in (git("diff", "--name-only", merge_base), git("ls-files", "--others", "--exclude-standard")):
        names.update(line for line in out.splitlines() if line)
    return sorted(names)


def link_modules() -> None:
    """In a linked worktree, make node_modules usable without installing anything.

    Entries are symlinked to the primary checkout's; `@chemdft/*` workspace packages are re-pointed at THIS
    worktree's packages so type checks and tests see this branch's code, not the primary checkout's.
    """
    main = main_checkout()
    if main == ROOT:
        return
    exclude = Path(git("rev-parse", "--path-format=absolute", "--git-path", "info/exclude").strip())
    exclude.parent.mkdir(parents=True, exist_ok=True)
    if "node_modules" not in (exclude.read_text() if exclude.exists() else ""):
        with exclude.open("a") as fh:
            fh.write("node_modules\n")
    root_nm = ROOT / "node_modules"
    if not root_nm.exists() and (main / "node_modules").exists():
        root_nm.symlink_to(main / "node_modules")
    for sub in ["apps/web", *sorted(f"packages/{p.name}" for p in (ROOT / "packages").iterdir() if p.is_dir())]:
        src, dst = main / sub / "node_modules", ROOT / sub / "node_modules"
        if dst.exists() or dst.is_symlink() or not src.is_dir():
            continue
        dst.mkdir()
        for entry in src.iterdir():
            if entry.name == "@chemdft":
                (dst / "@chemdft").mkdir()
                for pkg in entry.iterdir():
                    (dst / "@chemdft" / pkg.name).symlink_to(ROOT / "packages" / pkg.name)
            else:
                (dst / entry.name).symlink_to(entry)


def failed_ids(report: Path) -> list[str]:
    """Node ids from `pytest -rf` output ("FAILED tests/x.py::name - msg"), plus collection ERRORs."""
    ids = set()
    for line in report.read_text(errors="replace").splitlines():
        m = re.match(r"^(FAILED|ERROR) (\S+?)( - .*)?$", line)
        if m:
            ids.add(m.group(2))
    return sorted(ids)


def baseline_ids() -> set[str]:
    if not BASELINE.exists():
        return set()
    return {ln.strip() for ln in BASELINE.read_text().splitlines() if ln.strip() and not ln.startswith("#")}


def cmd_diff(report: str) -> int:
    failed = set(failed_ids(Path(report)))
    base = baseline_ids()
    new, fixed = sorted(failed - base), sorted(base - failed)
    print(f"known-failure baseline: {len(base)}; failing now: {len(failed)}; NEW: {len(new)}; no longer failing: {len(fixed)}")
    for item in new:
        print(f"  NEW FAILURE {item}")
    return 1 if new else 0


def cmd_write_baseline(report: str) -> int:
    sha = git("rev-parse", "HEAD").strip()
    ids = failed_ids(Path(report))
    header = (
        "# Known backend test failures that exist on a clean origin/main on the owner's machine (the baseline).\n"
        "# scripts/local-gate fails only on failures NOT listed here. Do not add ids to hide a new failure.\n"
        f"# Origin: full services/api pytest run at commit {sha}; {len(ids)} failing ids.\n"
        "# Regenerate on a CLEAN checkout of origin/main: scripts/local-gate --regen-baseline\n"
    )
    BASELINE.write_text(header + "\n".join(ids) + "\n")
    print(f"wrote {BASELINE.relative_to(ROOT)} with {len(ids)} ids at {sha[:10]}")
    return 0


def cmd_related_tests(base: str) -> int:
    """Backend test files to run in fast mode: changed tests plus tests naming a changed backend module."""
    files = changed_files(base)
    tests = {f.removeprefix("services/api/") for f in files if f.startswith("services/api/tests/test_") and f.endswith(".py")}
    modules = {Path(f).stem for f in files if f.startswith("services/api/src/chemdft_api/") and f.endswith(".py")}
    modules.discard("__init__")
    if modules:
        for test in (ROOT / "services/api/tests").glob("test_*.py"):
            text = test.read_text(errors="replace")
            if any(re.search(rf"\b{re.escape(m)}\b", text) for m in modules):
                tests.add(f"tests/{test.name}")
    if any(f.startswith("services/") for f in files):
        smoke = ROOT / "scripts" / "local-gate-smoke-tests.txt"
        tests.update(ln.strip() for ln in smoke.read_text().splitlines() if ln.strip() and not ln.startswith("#"))
    existing = sorted(t for t in tests if (ROOT / "services/api" / t).exists())
    print("\n".join(existing))
    return 0


def cmd_docs(base: str) -> int:
    ok = True
    nlines = len((ROOT / "NEXT.md").read_text().splitlines())
    print(f"NEXT.md lines: {nlines} (limit: under 150)")
    ok &= nlines < 150
    files = changed_files(base)
    if files:
        added = [ln for ln in git("diff", "-U0", git("merge-base", base, "HEAD").strip(), "--", "docs/history/CHANGELOG.md").splitlines()
                 if ln.startswith("+") and not ln.startswith("+++")]
        print(f"CHANGELOG lines added: {len(added)} (need at least 1 when the branch changes anything)")
        ok &= bool(added)
    try:
        tomllib.loads((ROOT / "REUSE.toml").read_text())
        print("REUSE.toml parses")
    except Exception as err:  # noqa: BLE001
        print(f"REUSE.toml does not parse: {err}")
        ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    cmd, *rest = sys.argv[1:]
    os.chdir(ROOT)
    sys.exit({
        "diff": cmd_diff, "write-baseline": cmd_write_baseline, "related-tests": cmd_related_tests,
        "docs": cmd_docs, "link-modules": lambda: (link_modules(), 0)[1], "changed": lambda b: (print("\n".join(changed_files(b))), 0)[1],
    }[cmd](*rest))
