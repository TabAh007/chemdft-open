#!/usr/bin/env python3
"""DRY-RUN ONLY: preview what a fresh public export of the repository would include and exclude.

No network access, nothing is pushed, nothing is written into the repository. The report goes to stdout and to --out (default: a
file in the system temp directory, outside the repo). Rules come from docs/implementation/PUBLICATION_READINESS.md.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

EXCLUDED_PREFIXES = ("docs/history/", "output/", "research/", "tools/scientific-acceptance-archive/")
INFRA_PREFIX = "infra/aws/"  # excluded unless redacted: any flagged hit keeps it excluded
ROOT_PF = re.compile(r"^PF-[^/]*\.md$")  # the root PF-*.md reports
ROOT_REPORTS = {"AS-C1.2-Stage3.2-Verification-Report.md", "ONBOARDING_AS_C1_2_REPORT.md"}
FLAGS = {
    "aws_account_id": re.compile("2112" + "36626730"),
    "ec2_instance_id": re.compile(r"\bi-0[0-9a-f]{8,17}\b"),
    "sslip_io_host": re.compile(r"sslip\.io", re.I),
    "owner_email": re.compile("tab@premium" + "robots" + r"\.ai|tabriz" + "007" + "@gmail" + r"\.com", re.I),
    "other_project_name": re.compile("care" + "trace", re.I),
}
MAX_BYTES = 5_000_000


def list_files(root: Path) -> list[str]:
    try:
        out = subprocess.run(["git", "-C", str(root), "ls-files"], capture_output=True, text=True, check=True).stdout
        return [line for line in out.splitlines() if line]
    except (OSError, subprocess.CalledProcessError):
        return sorted(str(p.relative_to(root)).replace("\\", "/") for p in root.rglob("*") if p.is_file() and ".git" not in p.parts)


def exclusion_reason(rel: str) -> str | None:
    if rel.startswith(EXCLUDED_PREFIXES):
        return "excluded path"
    if ROOT_PF.match(rel) or rel in ROOT_REPORTS:
        return "root report"
    if rel.startswith(INFRA_PREFIX):
        return "infra/aws (excluded unless redacted)"
    return None


def scan(path: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    try:
        if path.stat().st_size > MAX_BYTES:
            return counts
        text = path.read_bytes().decode("utf-8", errors="ignore")
    except OSError:
        return counts
    for name, rx in FLAGS.items():
        n = len(rx.findall(text))
        if n:
            counts[name] = n
    return counts


def build_report(root: Path) -> str:
    included: list[str] = []
    excluded: dict[str, list[str]] = {}
    inc_hits: dict[str, dict[str, int]] = {}
    exc_hits: dict[str, int] = {k: 0 for k in FLAGS}
    for rel in list_files(root):
        reason = exclusion_reason(rel)
        hits = scan(root / rel)
        if reason:
            excluded.setdefault(reason, []).append(rel)
            for k, v in hits.items():
                exc_hits[k] += v
        else:
            included.append(rel)
            if hits:
                inc_hits[rel] = hits
    lines = ["PUBLIC EXPORT DRY RUN (nothing written, nothing pushed, nothing made public)", f"root: {root.name}", ""]
    lines.append(f"files included: {len(included)}")
    for reason, files in sorted(excluded.items()):
        lines.append(f"files excluded ({reason}): {len(files)}")
    lines.append("")
    lines.append("flagged strings in INCLUDED files (must be redacted before any export):")
    total = {k: 0 for k in FLAGS}
    for hits in inc_hits.values():
        for k, v in hits.items():
            total[k] += v
    for k in FLAGS:
        lines.append(f"  {k}: {total[k]} hits in {sum(1 for h in inc_hits.values() if k in h)} files")
    lines.append("flagged strings in EXCLUDED files (stay private):")
    for k in FLAGS:
        lines.append(f"  {k}: {exc_hits[k]} hits")
    lines.append("")
    lines.append("included files that still contain flagged strings (top 40 by hits):")
    for rel, hits in sorted(inc_hits.items(), key=lambda kv: -sum(kv[1].values()))[:40]:
        lines.append(f"  {rel}: " + ", ".join(f"{k}={v}" for k, v in sorted(hits.items())))
    lines.append("")
    lines.append("This scans current tracked files only. Git history is NOT scanned: history rewrite is not recommended (see OWNER_DECISIONS.md).")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    ap.add_argument("--out", default=str(Path(tempfile.gettempdir()) / "chemdft-export-dry-run.txt"))
    args = ap.parse_args(argv)
    root = Path(args.root).resolve()
    out = Path(args.out).resolve()
    if root in out.parents:
        print("refusing to write the report inside the repository", file=sys.stderr)
        return 2
    report = build_report(root)
    sys.stdout.write(report)
    out.write_text(report, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
