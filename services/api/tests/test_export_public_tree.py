"""scripts/export_public_tree.py is a dry run: it reports exclusions and flagged strings and never writes into the repo."""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location("export_public_tree", ROOT / "scripts" / "export_public_tree.py")
mod = importlib.util.module_from_spec(_spec)
assert _spec.loader
_spec.loader.exec_module(mod)

ACCOUNT = "2112" + "36626730"


def _tree(tmp: Path) -> Path:
    files = {
        "README.md": "plain",
        "apps/a.ts": f"account {ACCOUNT} and host x.sslip" ".io",
        "docs/history/old.md": f"{ACCOUNT}",
        "output/data.json": "i-" "0123456789abcdef0",
        "infra/aws/x.sh": "care" + "trace",
        "PF-4-report.md": "x",
        "docs/note.md": "contact tab@premium" + "robots.ai and i-" "0abcdef1234567890",
    }
    for rel, text in files.items():
        p = tmp / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    return tmp


def test_exclusions_and_counts_on_fixture_tree(tmp_path: Path) -> None:
    root = _tree(tmp_path / "repo")
    report = mod.build_report(root)
    assert "files included: 3" in report
    assert "excluded path): 2" in report
    assert "root report): 1" in report
    assert "infra/aws (excluded unless redacted)): 1" in report
    assert "aws_account_id: 1 hits in 1 files" in report
    assert "sslip_io_host: 1 hits" in report
    assert "owner_email: 1 hits" in report
    assert "ec2_instance_id: 1 hits" in report
    assert "apps/a.ts" in report and "docs/note.md" in report


def test_refuses_to_write_inside_repo_and_writes_outside(tmp_path: Path, capsys) -> None:
    root = _tree(tmp_path / "repo")
    assert mod.main(["--root", str(root), "--out", str(root / "report.txt")]) == 2
    assert not (root / "report.txt").exists()
    out = tmp_path / "elsewhere.txt"
    assert mod.main(["--root", str(root), "--out", str(out)]) == 0
    assert out.read_text().startswith("PUBLIC EXPORT DRY RUN")


def test_script_does_no_network_or_push() -> None:
    src = (ROOT / "scripts" / "export_public_tree.py").read_text()
    for forbidden in ("urllib", "requests", "socket", "git push", '"push"'):
        assert forbidden not in src
