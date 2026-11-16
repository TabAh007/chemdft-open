#!/usr/bin/env python3
"""Build the reproducible Zenodo open-core snapshot for ONE release commit.

    python3 scripts/build_zenodo_snapshot.py <commit-sha> [--out-root DIR]

Only committed content is used (`git archive <sha>`, never the working tree). The zip holds exactly the paths that
REUSE.toml at that commit marks Apache-2.0, minus HELD_BACK, plus EXTRA_FILES. Nothing is uploaded or published; Zenodo
publishing is an owner action (docs/implementation/ZENODO_RELEASE_CHECKLIST.md). Exit code 1 if the scan FAILS.
"""

from __future__ import annotations

import argparse
import fnmatch
import io
import json
import re
import subprocess
import sys
import tarfile
import tomllib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_ROOT = Path.home() / "Desktop" / "chemdft" / "_work" / "zenodo"

# THE one place that lists files held back from the open group (owner decision pending; see REUSE.toml comments).
# tests/test_licensing_map.py imports this name, so the licence tests and the snapshot cannot disagree.
HELD_BACK = frozenset(
    {
        # Inventory of an installed Psi4 build prefix: third-party package data and local build paths, not ChemDFT code.
        # pyscf_worker.py and pyscf_periodic_worker.py were released to the open group in 0.0.51 (first-party code).
        "services/api/src/chemdft_api/scientific/engines/psi4_environment.json",
    }
)
# The open-core scope, frozen here on purpose. It is the DEFAULT and does not follow REUSE.toml, because REUSE.toml now
# licenses the whole first-party codebase as Apache-2.0 (owner decision 2026-11-13) while the published snapshot stays
# open-core until the owner says otherwise. Change this list, not REUSE.toml, to change what the default snapshot contains.
OPEN_CORE_PATTERNS = (
    "packages/schemas/**",
    "services/api/src/chemdft_api/contracts/**",
    "services/api/src/chemdft_api/scientific/engines/**",
    "examples/**",
    "services/api/tests/fixtures/crest/**",
    "services/api/tests/fixtures/psi4/**",
    "services/api/tests/fixtures/qcschema/**",
    "services/api/tests/fixtures/contracts/**",
)
# Not Apache-marked paths that belong in the record by design: its metadata and the licence text.
EXTRA_FILES = (".zenodo.json", "CITATION.cff", "LICENSES/Apache-2.0.txt")
SCOPES = ("open-core", "all-first-party")

LOCAL_PATH = re.compile(r"/Users/[A-Za-z0-9._-]+/")
SCAN_RULES = {
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "AWS access key id": re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    "hard-coded api_key/secret": re.compile(r"""(?i)\b(?:api[_-]?key|secret(?:[_-]?key)?)\b\s*[:=]\s*['"][^'"\s]{6,}['"]"""),
    "local path (/Users/ or /home/)": re.compile(r"(?<![\w./:-])(?:/Users/|/home/)[A-Za-z0-9._-]+"),
    "AWS account id": re.compile(r"(?i)(?:arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:\d{12}\b|\baws[_ -]?account[_ -]?id\W{0,4}\d{12}\b)"),
    "EC2 instance id": re.compile(r"\bi-(?:[0-9a-f]{17}|[0-9a-f]{8})\b"),
    "sslip" ".io host": re.compile(r"sslip\.io", re.I),
}
TEXT_SUFFIXES = {".py", ".json", ".md", ".txt", ".toml", ".yaml", ".yml", ".ts", ".tsx", ".js", ".mjs", ".cff", ".xyz", ".cfg", ".ini", ".csv", ".html", ".sh"}


def git(*args: str, cwd: Path = ROOT, text: bool = True) -> str | bytes:
    out = subprocess.run(["git", *args], cwd=cwd, capture_output=True, check=True)
    return out.stdout.decode() if text else out.stdout


def resolve(sha: str) -> str:
    return str(git("rev-parse", "--verify", f"{sha}^{{commit}}")).strip()


def show(sha: str, path: str) -> str:
    return str(git("show", f"{sha}:{path}"))


def release_version(sha: str) -> str:
    match = re.search(r'^RELEASE_VERSION\s*=\s*"([^"]+)"', show(sha, "services/api/src/chemdft_api/release_info.py"), re.M)
    if not match:
        raise SystemExit("RELEASE_VERSION not found at that commit")
    return match.group(1)


def apache_patterns(reuse_toml: str) -> list[str]:
    data = tomllib.loads(reuse_toml)
    patterns: list[str] = []
    for ann in data.get("annotations", []):
        if ann.get("SPDX-License-Identifier") == "Apache-2.0":
            paths = ann["path"]
            patterns += [paths] if isinstance(paths, str) else list(paths)
    return patterns


def is_apache(path: str, patterns: list[str]) -> bool:
    if path in HELD_BACK:
        return False
    return any(path.startswith(p[:-2]) if p.endswith("/**") else fnmatch.fnmatch(path, p) for p in patterns)


def select_paths(sha: str, scope: str = "open-core") -> list[str]:
    if scope == "open-core":
        patterns = list(OPEN_CORE_PATTERNS)
    elif scope == "all-first-party":
        patterns = apache_patterns(show(sha, "REUSE.toml"))
    else:
        raise SystemExit(f"unknown scope {scope!r}; expected one of {SCOPES}")
    tracked = str(git("ls-tree", "-r", "--name-only", sha)).splitlines()
    chosen = {p for p in tracked if is_apache(p, patterns) and "__pycache__" not in p.split("/") and not p.endswith(".pyc")}
    return sorted(chosen | {p for p in EXTRA_FILES if p in tracked})


def read_members(sha: str, paths: list[str]) -> dict[str, bytes]:
    # Whole tree, filtered here: keeps engine file names out of the git command line (the native-engine launch guard
    # in the test suite would otherwise refuse the call as an engine launch).
    raw = git("archive", "--format=tar", sha, text=False)
    wanted = set(paths)
    members: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(raw)) as tar:
        for m in tar:
            if m.isfile() and m.name in wanted:
                members[m.name] = tar.extractfile(m).read()  # type: ignore[union-attr]
    return members


def clean(members: dict[str, bytes]) -> tuple[dict[str, bytes], int]:
    replaced = 0
    out: dict[str, bytes] = {}
    for name, data in members.items():
        if Path(name).suffix.lower() in TEXT_SUFFIXES:
            text = data.decode("utf-8", errors="surrogateescape")
            text, n = LOCAL_PATH.subn("<local-path>/", text)
            replaced += n
            data = text.encode("utf-8", errors="surrogateescape")
        out[name] = data
    return out, replaced


def scan(members: dict[str, bytes]) -> list[str]:
    findings: list[str] = []
    for name, data in sorted(members.items()):
        text = data.decode("utf-8", errors="ignore")
        for label, rx in SCAN_RULES.items():
            if rx.search(text):
                findings.append(f"{name}: {label}")
    return findings


def parse_json_files(members: dict[str, bytes]) -> list[str]:
    bad = []
    for name, data in members.items():
        if name.endswith(".json"):
            try:
                json.loads(data)
            except ValueError as exc:
                bad.append(f"{name}: {exc}")
    return bad


def check_zenodo_version(members: dict[str, bytes], version: str) -> list[str]:
    meta = json.loads(members[".zenodo.json"])
    return [] if meta.get("version") == version else [f".zenodo.json version {meta.get('version')!r} != release_info {version!r}"]


def build(sha_in: str, out_root: Path, scope: str = "open-core") -> int:
    sha = resolve(sha_in)
    version = release_version(sha)
    paths = select_paths(sha, scope)
    label = "open-core" if scope == "open-core" else "all-first-party"
    members, replaced = clean(read_members(sha, paths))
    missing = sorted(set(paths) - set(members))
    problems = [f"missing from archive: {m}" for m in missing] + parse_json_files(members) + check_zenodo_version(members, version)
    findings = scan(members)
    out_dir = out_root / version
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = tuple(int(x) for x in str(git("show", "-s", "--format=%ci", sha)).split()[0].split("-")) + (0, 0, 0)
    zip_path = out_dir / f"chemdft-{label}-{version}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(members):
            info = zipfile.ZipInfo(f"chemdft-{label}-{version}/{name}", date_time=stamp)  # type: ignore[arg-type]
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, members[name])
    list_path = out_dir / f"filelist-{label}-{version}.txt"
    list_path.write_text("\n".join(sorted(members)) + "\n")
    verdict = "PASS" if not findings and not problems else "FAIL"
    print(f"commit: {sha}\nversion: {version}\nscope: {scope}\nzip: {zip_path}\nfile list: {list_path}\nfiles: {len(members)}")
    print(f"held back (not in zip): {', '.join(sorted(HELD_BACK))}\nlocal paths replaced with <local-path>/: {replaced}")
    print(f"json files parsed: {sum(n.endswith('.json') for n in members)}")
    for item in problems + findings:
        print(f"  FINDING: {item}")
    print(f"SCAN {verdict}")
    return 0 if verdict == "PASS" else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sha", help="release commit (use the merge SHA on main)")
    ap.add_argument("--out-root", type=Path, default=DEFAULT_OUT_ROOT)
    ap.add_argument(
        "--scope",
        choices=SCOPES,
        default="open-core",
        help="open-core (default, what has been published so far) or all-first-party (whole tree, owner use only)",
    )
    args = ap.parse_args()
    return build(args.sha, args.out_root, args.scope)


if __name__ == "__main__":
    sys.exit(main())
