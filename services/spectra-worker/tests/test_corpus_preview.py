"""The 38 synthetic spike cases, promoted to committed regression tests of the PRODUCTION preview path.

The corpus is ChemDFT-authored and seeded (no third-party data). Each case carries an expectation record; this module maps every
expectation key to an assertion about the resolved preview body.
"""
# ruff: noqa: E501  (long evidence strings, scientific symbols and human-readable diagnostics)

from __future__ import annotations

import pytest
import synthetic_corpus as corpus
from chemdft_spectra_worker.preview import resolve_preview

CASES = corpus.build()


def _codes(body: dict, severity: str | None = None) -> list[str]:
    return [d["code"] for d in body["diagnostics"] if severity is None or d["severity"] == severity]


def test_corpus_has_the_expected_size() -> None:
    assert len(CASES) == 38


@pytest.mark.parametrize("name", sorted(CASES))
def test_case(name: str) -> None:
    raw, technique, expected = CASES[name]
    preview = resolve_preview(raw, technique)
    body = preview.body
    codes = _codes(body)

    if "analysis_error" in expected:
        assert body["status"] == "REJECTED"
        assert expected["analysis_error"] in codes
    if "build_error" in expected:
        assert body["status"] == "REJECTED"
        assert expected["build_error"] in _codes(body, "error")
        assert preview.arrays is None
    if "analysis_warning" in expected:
        assert expected["analysis_warning"] in codes
    if "build_warning" in expected:
        assert expected["build_warning"] in codes
    if "commit" in expected and "build_error" not in expected:
        assert (body["status"] == "READY") is expected["commit"]
    if "needs" in expected:
        assert body["needs"] == expected["needs"]
    if "delimiter" in expected:
        assert body["source"]["delimiter"] == expected["delimiter"]
    if "decimal" in expected:
        assert body["source"]["decimal"] == expected["decimal"]
    if "encoding" in expected:
        assert body["source"]["encoding"] == expected["encoding"]
    if "orientation" in expected:
        assert body["source"]["orientation"] == expected["orientation"]
    if "n_rows" in expected:
        assert body["point_count"] == expected["n_rows"]
    if "direction" in expected:
        assert body["x"]["direction_in_file"] == expected["direction"]
    if "x_evidence" in expected:
        assert body["x"]["unit_evidence"] == expected["x_evidence"]
    if "x_unit" in expected:
        assert body["x"]["unit"] == expected["x_unit"]
    if expected.get("nonuniform"):
        assert "NON_UNIFORM_SPACING" in codes
    if "x_hint" in expected:
        assert body["proposals"]["x"]["unit"] == expected["x_hint"]
        assert body["proposals"]["x"]["level"] == "HINT_ONLY"
        assert body["x"]["unit"] is None  # a hint never authorises persistence
    if "meta_keys" in expected:
        keys = {entry["key"] for entry in body["metadata_verbatim"]}
        assert set(expected["meta_keys"]) <= keys
    for field, value in (expected.get("meta") or {}).items():
        reported = body["acquisition"][field]
        assert reported["status"] == "AS_REPORTED_IN_FILE"
        assert reported["value"] == value
        assert reported["line"] is not None and reported["as_written"]


def test_commit_with_exclusion_is_explicit() -> None:
    raw, technique, _ = CASES["S10_nan_inf_placeholders"]
    assert resolve_preview(raw, technique).body["status"] == "REJECTED"
    chosen = resolve_preview(raw, technique, {"exclude_invalid_rows": True})
    assert chosen.body["status"] == "READY"
    assert chosen.body["point_count"] == 901 - 3
    assert "ROWS_EXCLUDED" in _codes(chosen.body)
    assert len(chosen.body["choice"]["excluded_lines"]) == 3


def test_commit_with_column_choice() -> None:
    raw, technique, _ = CASES["S18_three_columns_with_uncertainty"]
    assert resolve_preview(raw, technique).body["needs"] == ["column_roles"]
    chosen = resolve_preview(raw, technique, {"x_index": 0, "y_index": 1, "y_error_index": 2})
    assert chosen.body["status"] == "READY"
    assert chosen.body["y_error"]["column"] == 2
    assert chosen.arrays is not None and chosen.arrays.y_error is not None


def test_same_axis_for_x_and_y_is_refused() -> None:
    raw, technique, _ = CASES["S19_multiple_y_columns"]
    body = resolve_preview(raw, technique, {"x_index": 1, "y_index": 1}).body
    assert body["status"] == "REJECTED" and "COLUMN_ROLES_INVALID" in _codes(body)


def test_out_of_range_column_is_refused() -> None:
    raw, technique, _ = CASES["S19_multiple_y_columns"]
    body = resolve_preview(raw, technique, {"x_index": 0, "y_index": 99}).body
    assert body["status"] == "REJECTED" and "COLUMN_OUT_OF_RANGE" in _codes(body)
