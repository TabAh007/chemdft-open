"""Unit-evidence policy, hash binding, metadata honesty and security caps of the resolved preview."""
# ruff: noqa: E501  (long evidence strings, scientific symbols and human-readable diagnostics)

from __future__ import annotations

import numpy as np
import pytest
import synthetic_corpus as corpus
from chemdft_spectra_worker import preview as preview_module
from chemdft_spectra_worker.canonical import array_bytes, sha256_hex
from chemdft_spectra_worker.preview import resolve_preview
from chemdft_spectra_worker.textio import MAX_BYTES, MAX_POINTS

CASES = corpus.build()
IR_NO_HEADER = CASES["S04_whitespace_no_header"][0]
CONFIRM_IR = {"x_unit": "cm^-1", "y_quantity": "ABSORBANCE", "y_unit": "absorbance"}


def test_hint_alone_never_authorises_a_commit() -> None:
    body = resolve_preview(IR_NO_HEADER, "IR").body
    assert body["status"] == "NEEDS_CONFIRMATION"
    assert body["x"]["unit"] is None and body["y"]["unit"] is None
    assert body["proposals"]["x"] == {"quantity": "WAVENUMBER", "unit": "cm^-1", "level": "HINT_ONLY", "evidence": body["proposals"]["x"]["evidence"]}


def test_user_confirmation_is_recorded_as_such() -> None:
    preview = resolve_preview(IR_NO_HEADER, "IR", CONFIRM_IR)
    body = preview.body
    assert body["status"] == "READY"
    assert body["x"]["unit_evidence"] == "USER_CONFIRMED" and body["y"]["unit_evidence"] == "USER_CONFIRMED"
    assert "confirmed by the user" in body["x"]["unit_evidence_text"]
    assert preview.arrays is not None


def test_explicit_unit_in_the_file_is_recorded_as_explicit() -> None:
    body = resolve_preview(CASES["S01_csv_header_explicit_units"][0], "IR").body
    assert body["x"]["unit_evidence"] == "EXPLICIT_UNIT" and body["y"]["unit_evidence"] == "EXPLICIT_UNIT"
    assert "written in the file" in body["x"]["unit_evidence_text"]


def test_quantity_name_without_unit_is_not_enough() -> None:
    raw = ("Raman shift,Intensity\n" + "\n".join(f"{100 + 2 * i:.1f},{i:.2f}" for i in range(50)) + "\n").encode()
    body = resolve_preview(raw, "RAMAN").body
    assert body["status"] == "NEEDS_CONFIRMATION"
    assert "x_unit" in body["needs"]
    assert body["proposals"]["x"]["level"] == "QUANTITY_NAME"


def test_transmittance_scale_must_be_stated() -> None:
    raw, technique, _ = CASES["S12a_transmittance_fraction_scale_unstated"]
    body = resolve_preview(raw, technique).body
    assert body["needs"] == ["y_quantity_and_unit"]
    assert body["proposals"]["y"]["quantity"] == "TRANSMITTANCE" and body["proposals"]["y"]["unit"] is None
    confirmed = resolve_preview(raw, technique, {"y_quantity": "TRANSMITTANCE", "y_unit": "fraction"})
    assert confirmed.body["status"] == "READY" and confirmed.body["y"]["unit"] == "fraction"
    only_quantity = resolve_preview(raw, technique, {"y_quantity": "TRANSMITTANCE"})
    assert only_quantity.body["status"] == "NEEDS_CONFIRMATION"


def test_transmittance_is_never_converted_to_absorbance() -> None:
    raw, technique, _ = CASES["S12b_percent_T_explicit"]
    preview = resolve_preview(raw, technique)
    assert preview.body["y"]["quantity"] == "TRANSMITTANCE" and preview.body["y"]["unit"] == "percent"
    assert preview.arrays is not None and preview.arrays.y.max() > 1.5  # percent values stay as they were


@pytest.mark.parametrize(
    ("technique", "choice", "code"),
    [
        ("IR", {"x_unit": "nm", "y_quantity": "ABSORBANCE", "y_unit": "absorbance"}, "X_UNIT_NOT_SUPPORTED_FOR_TECHNIQUE"),
        ("RAMAN", {"x_unit": "cm^-1", "y_quantity": "ABSORBANCE", "y_unit": "absorbance"}, "Y_QUANTITY_NOT_SUPPORTED_FOR_TECHNIQUE"),
        ("UVVIS", {"x_unit": "cm^-1", "y_quantity": "CROSS_SECTION", "y_unit": "L/(mol*cm)"}, "Y_QUANTITY_NOT_SUPPORTED_FOR_TECHNIQUE"),
    ],
)
def test_units_outside_the_technique_are_refused(technique: str, choice: dict, code: str) -> None:
    assert code in [d["code"] for d in resolve_preview(IR_NO_HEADER, technique, choice).body["diagnostics"]]


def test_unknown_technique_is_refused() -> None:
    body = resolve_preview(IR_NO_HEADER, "NMR", CONFIRM_IR).body
    assert body["status"] == "REJECTED"


def test_override_of_an_explicit_file_unit_is_flagged() -> None:
    raw = CASES["S01_csv_header_explicit_units"][0]
    body = resolve_preview(raw, "IR", {"x_unit": "um"}).body
    assert "UNIT_OVERRIDES_FILE" in [d["code"] for d in body["diagnostics"]]
    assert body["x"]["unit_evidence"] == "USER_CONFIRMED"


def test_preview_is_deterministic_and_binds_the_choices() -> None:
    a = resolve_preview(IR_NO_HEADER, "IR", CONFIRM_IR)
    b = resolve_preview(IR_NO_HEADER, "IR", dict(CONFIRM_IR))
    assert a.preview_sha256 == b.preview_sha256
    c = resolve_preview(IR_NO_HEADER, "IR", {**CONFIRM_IR, "y_unit": "absorbance", "x_unit": "um"})
    assert c.preview_sha256 != a.preview_sha256
    d = resolve_preview(IR_NO_HEADER, "IR", {**CONFIRM_IR, "metadata": {"phase": "GAS"}})
    assert d.preview_sha256 != a.preview_sha256


def test_different_source_bytes_change_the_hash() -> None:
    other = IR_NO_HEADER.replace(b"0", b"1", 1)
    assert resolve_preview(other, "IR", CONFIRM_IR).preview_sha256 != resolve_preview(IR_NO_HEADER, "IR", CONFIRM_IR).preview_sha256


def test_raw_arrays_keep_file_order_and_hash_matches() -> None:
    raw, technique, _ = CASES["S07_reversed_axis_high_to_low"]
    preview = resolve_preview(raw, technique)
    assert preview.arrays is not None
    assert preview.arrays.x[0] > preview.arrays.x[-1]  # the reversed axis is recorded, never re-ordered
    assert preview.body["x"]["direction_in_file"] == "DESCENDING"
    expected = sha256_hex(array_bytes(preview.arrays.x) + array_bytes(preview.arrays.y))
    assert preview.body["arrays"]["artifact_sha256"] == expected == sha256_hex(preview.arrays.artifact_bytes())


def test_display_decimation_never_touches_stored_arrays() -> None:
    x = np.arange(0.0, 20000.0)
    y = np.sin(x / 50.0)
    raw = ("Wavenumber (cm-1),Absorbance\n" + "\n".join(f"{a:.1f},{b:.6f}" for a, b in zip(x, y, strict=True)) + "\n").encode()
    preview = resolve_preview(raw, "IR")
    assert preview.body["point_count"] == 20000
    assert preview.body["display"]["decimated"] is True
    assert len(preview.body["display"]["x"]) <= 2 * preview_module.DISPLAY_BUCKETS
    assert preview.arrays is not None and len(preview.arrays.x) == 20000
    top = max(preview.body["display"]["y"])
    assert top == pytest.approx(float(np.round(y, 6).max()))  # min/max bucketing keeps the extremes


def test_metadata_is_never_inferred() -> None:
    raw, technique, _ = CASES["S31_cp1252_tab_metadata_then_space_data"]
    body = resolve_preview(raw, technique, {"x_unit": "cm^-1", "y_quantity": "INTENSITY", "y_unit": "arbitrary"}).body
    assert body["status"] == "READY"
    assert body["acquisition"]["excitation_wavelength_nm"] == {"status": "NOT_SUPPLIED", "value": None, "as_written": None, "line": None, "file_reported": None}
    assert body["instrument"]["status"] == "NOT_SUPPLIED" and body["sample"]["status"] == "NOT_SUPPLIED"


def test_user_entered_metadata_is_labelled_and_validated() -> None:
    choices = {"x_unit": "cm^-1", "y_quantity": "INTENSITY", "y_unit": "arbitrary", "metadata": {"excitation_wavelength_nm": 785, "phase": "LIQUID", "accumulations": -3, "integration_time_s": "abc"}, "instrument": "bench Raman"}
    raw, technique, _ = CASES["S31_cp1252_tab_metadata_then_space_data"]
    body = resolve_preview(raw, technique, choices).body
    assert body["acquisition"]["excitation_wavelength_nm"]["status"] == "USER_ENTERED"
    assert body["acquisition"]["phase"]["value"] == "LIQUID"
    assert body["acquisition"]["accumulations"]["status"] == "NOT_SUPPLIED"
    assert body["acquisition"]["integration_time_s"]["status"] == "NOT_SUPPLIED"
    assert "USER_METADATA_INVALID" in [d["code"] for d in body["diagnostics"]]
    assert body["instrument"] == {"status": "USER_ENTERED", "value": "bench Raman", "as_written": "bench Raman", "line": None, "file_reported": None}


def test_file_reported_laser_wavelength_is_kept_as_reported() -> None:
    raw, technique, _ = CASES["S03_tab_raman_metadata_block"]
    body = resolve_preview(raw, technique).body
    laser = body["acquisition"]["excitation_wavelength_nm"]
    assert laser["status"] == "AS_REPORTED_IN_FILE" and laser["value"] == 785.0 and "785" in laser["as_written"]
    assert body["instrument"]["status"] == "AS_REPORTED_IN_FILE"


def test_formula_like_metadata_is_inert_text() -> None:
    raw, technique, _ = CASES["S24_formula_like_metadata"]
    body = resolve_preview(raw, technique).body
    assert body["status"] == "READY"
    assert "CSV_FORMULA_LIKE" in [d["code"] for d in body["diagnostics"]]
    stored = " ".join(entry["value"] for entry in body["metadata_verbatim"])
    assert "HYPERLINK" in stored  # kept verbatim, never evaluated


def test_security_caps() -> None:
    too_many = ("Wavenumber (cm-1),Absorbance\n" + "\n".join("1.0,2.0" for _ in range(MAX_POINTS + 2000)) + "\n").encode()
    assert resolve_preview(too_many, "IR").body["status"] == "REJECTED"
    too_big = b"1.0,2.0\n" * (MAX_BYTES // 8 + 10)
    body = resolve_preview(too_big, "IR").body
    assert body["status"] == "REJECTED"
    assert any(d["severity"] == "error" for d in body["diagnostics"])


def test_negative_and_nonfinite_values_are_not_silently_repaired() -> None:
    raw, technique, _ = CASES["S30_negative_noise_kept"]
    preview = resolve_preview(raw, technique)
    assert preview.arrays is not None and preview.arrays.y.min() < 0
