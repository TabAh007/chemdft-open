"""The hosted CREST worker must record the REAL calculation id in invocation.json.

Regression for hosted job 79e6c6ae (2026-11-03): CREST finished, but the Result Firewall rejected
"CREST native invocation calculation mismatch" because the worker wrote the structure version id.
The Firewall check stays strict; the id is handed to the worker instead.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from chemdft_api.scientific.engines import crest_worker


def _fake_execute(captured):
    def execute(document, executable, limits, *, calculation_id, workdir=None):
        captured["calculation_id"] = calculation_id
        return SimpleNamespace(
            native_artifacts={}, result_document={"ok": True}, exit_code=0
        )

    return execute


def test_worker_passes_the_real_calculation_id_not_the_structure_version_id(tmp_path, monkeypatch):
    captured: dict = {}
    monkeypatch.setattr(
        "chemdft_api.scientific.engines.crest.execute_native", _fake_execute(captured)
    )
    source = tmp_path / "input.json"
    source.write_text(json.dumps({"structure_version_id": "structure-version-9"}))
    code = crest_worker.run(
        source, tmp_path / "out" / "result.json", tmp_path / "engine.log", Path("/x"),
        calculation_id="calculation-42",
    )
    assert code == 0
    assert captured["calculation_id"] == "calculation-42"


@pytest.mark.parametrize("bad", ["", "a b", "../x", "x" * 100, "a;b"])
def test_worker_refuses_a_missing_or_unsafe_calculation_id(tmp_path, bad):
    source = tmp_path / "input.json"
    source.write_text("{}")
    with pytest.raises(ValueError):
        crest_worker.run(
            source, tmp_path / "r.json", tmp_path / "l.log", Path("/x"), calculation_id=bad
        )


def test_worker_command_line_requires_the_calculation_id(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(
        "sys.argv",
        ["w", "--input", "i", "--result", "r", "--log", str(tmp_path / "l"),
         "--crest-executable", "/x"],
    )
    with pytest.raises(SystemExit):
        crest_worker.main()
