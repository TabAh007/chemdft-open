"""Deterministic SYNTHETIC export corpus for the parser spike.

These are NOT experimental data. They are generated, seeded, ChemDFT-authored files that reproduce the *shapes* of real exports
(delimiters, decimal commas, BOMs, reversed axes, metadata blocks, footers, row-oriented layouts, hostile content). Layouts that
imitate a vendor style (Cary, JASCO, OceanView, Horiba/Renishaw-like) are reconstructed from public descriptions and have NOT been
verified against files written by those instruments; they exist to exercise the detector, not to certify vendor support.

Each case: name -> (bytes, technique, expectation). Expectation keys are checked by run_spike.py.
"""
# ruff: noqa: E501, RUF001  (long evidence strings, scientific symbols and human-readable diagnostics)
from __future__ import annotations

import numpy as np

RNG = np.random.default_rng(20261006)


def _lorentz(x: np.ndarray, centre: float, fwhm: float, height: float) -> np.ndarray:
    return height * (fwhm / 2) ** 2 / ((x - centre) ** 2 + (fwhm / 2) ** 2)


def ir_signal(x: np.ndarray) -> np.ndarray:
    y = _lorentz(x, 1715, 18, 0.9) + _lorentz(x, 1220, 24, 0.5) + _lorentz(x, 2960, 40, 0.3) + 2e-5 * (x - 400)
    return y + 0.002 * RNG.standard_normal(len(x))


def raman_signal(x: np.ndarray) -> np.ndarray:
    y = 800 + 0.05 * x + _lorentz(x, 787, 9, 2500) + _lorentz(x, 1710, 12, 900) + _lorentz(x, 2925, 20, 1400)
    return y + 15 * RNG.standard_normal(len(x))


def uv_signal(x: np.ndarray) -> np.ndarray:
    y = 0.8 * np.exp(-0.5 * ((x - 280) / 18) ** 2) + 0.15
    return y + 0.002 * RNG.standard_normal(len(x))


def _rows(x, y, fmt="{:.4f},{:.6f}", nl="\n"):
    return nl.join(fmt.format(a, b) for a, b in zip(x, y, strict=True)) + nl


IR_X = np.arange(400.0, 4000.0 + 0.5, 4.0)  # 901 points
RAMAN_X = np.arange(100.0, 3200.0 + 0.5, 2.0)
UV_X = np.arange(200.0, 800.0 + 0.5, 1.0)


def build() -> dict[str, tuple[bytes, str, dict]]:
    iy, ry, uy = ir_signal(IR_X), raman_signal(RAMAN_X), uv_signal(UV_X)
    c: dict[str, tuple[bytes, str, dict]] = {}

    c["S01_csv_header_explicit_units"] = (("Wavenumber (cm-1),Absorbance\n" + _rows(IR_X, iy)).encode(), "IR",
        {"delimiter": "COMMA", "decimal": ".", "n_rows": 901, "commit": True, "needs": [], "x_evidence": "EXPLICIT_UNIT", "direction": "ASCENDING"})
    c["S02_semicolon_decimal_comma"] = (("Wavenumber [1/cm];Absorbance\n" + _rows(IR_X, iy, "{:.4f};{:.6f}").replace(".", ",")).encode(), "IR",
        {"delimiter": "SEMICOLON", "decimal": ",", "n_rows": 901, "commit": True, "needs": []})
    c["S03_tab_raman_metadata_block"] = (("# Laser: 785 nm\n# Integration time: 10 s\n# Accumulations: 3\n# Instrument: ExampleRaman 1000\n"
        "Raman shift (cm^-1)\tIntensity (counts)\n" + _rows(RAMAN_X, ry, "{:.3f}\t{:.2f}")).encode(), "RAMAN",
        {"delimiter": "TAB", "n_rows": len(RAMAN_X), "commit": True, "needs": [], "meta": {"excitation_wavelength_nm": 785.0, "integration_time_s": 10.0, "accumulations": 3.0}})
    c["S04_whitespace_no_header"] = (_rows(IR_X, iy, "{:.2f} {:.5f}").encode(), "IR",
        {"delimiter": "WHITESPACE", "n_rows": 901, "commit": False, "needs": ["x_unit", "y_quantity_and_unit"], "x_hint": "cm^-1"})
    c["S05_utf16le_bom_crlf"] = (("Wavenumber (cm-1),Absorbance\r\n" + _rows(IR_X, iy, nl="\r\n")).encode("utf-16"), "IR",
        {"encoding": "utf-16-le", "n_rows": 901, "commit": True, "needs": []})
    c["S06_utf8_bom_trailing_delimiters"] = (b"\xef\xbb\xbf" + ("Wavenumber (cm-1),Absorbance,\n" + _rows(IR_X, iy, "{:.4f},{:.6f},")).encode(), "IR",
        {"encoding": "utf-8-sig", "n_rows": 901, "commit": True, "needs": []})
    c["S07_reversed_axis_high_to_low"] = (("Wavenumber (cm-1),Absorbance\n" + _rows(IR_X[::-1], iy[::-1])).encode(), "IR",
        {"direction": "DESCENDING", "n_rows": 901, "commit": True, "needs": []})
    dup_x = IR_X.copy()
    dup_x[450] = dup_x[449]
    c["S08_duplicate_x"] = (("Wavenumber (cm-1),Absorbance\n" + _rows(dup_x, iy)).encode(), "IR", {"commit": False, "build_error": "DUPLICATE_X"})
    stitched = np.concatenate([IR_X[:400], IR_X[395:]])[:901]
    c["S09_non_monotonic_stitched"] = (("Wavenumber (cm-1),Absorbance\n" + _rows(stitched, iy)).encode(), "IR", {"commit": False, "build_error": "NON_MONOTONIC_X"})
    body = _rows(IR_X, iy).split("\n")
    body[100], body[101], body[102] = "500.0000,NaN", "504.0000,-", "508.0000,inf"
    c["S10_nan_inf_placeholders"] = (("Wavenumber (cm-1),Absorbance\n" + "\n".join(body)).encode(), "IR",
        {"commit": False, "build_error": "INVALID_VALUES_IN_SERIES", "commit_with_exclusion": True, "analysis_warning": "INVALID_VALUES"})
    body = _rows(IR_X, iy).split("\n")
    body[450] = "abc,def"
    c["S11_malformed_row_mid_file"] = (("Wavenumber (cm-1),Absorbance\n" + "\n".join(body)).encode(), "IR", {"analysis_error": "DATA_BLOCK_INTERRUPTED"})
    t_frac = 1.0 - np.clip(iy, 0, 0.95)
    c["S12a_transmittance_fraction_scale_unstated"] = (("Wavenumber (cm-1),Transmittance\n" + _rows(IR_X, t_frac)).encode(), "IR",
        {"commit": False, "needs": ["y_quantity_and_unit"]})
    c["S12b_percent_T_explicit"] = (("Wavenumber (cm-1),%T\n" + _rows(IR_X, 100 * t_frac)).encode(), "IR", {"commit": True, "needs": []})
    c["S13_ir_wavelength_micrometre"] = (("Wavelength (µm),Absorbance\n" + _rows(1e4 / IR_X[::-1], iy[::-1], "{:.5f},{:.6f}")).encode("utf-8"), "IR",
        {"commit": True, "needs": [], "x_unit": "um", "direction": "ASCENDING", "nonuniform": True})
    c["S14_cary_style_descending_with_footer"] = (("Wavelength (nm),Abs\n" + _rows(UV_X[::-1], uy[::-1], "{:.1f},{:.5f}") + "\nStart Time: 2026-10-06 10:00\nScan Rate: 600 nm/min\nSample: example\n").encode(), "UVVIS",
        {"delimiter": "COMMA", "direction": "DESCENDING", "commit": True, "needs": [], "footer_lines": 3})
    jasco = ("TITLE,example sample\nDATA TYPE,INFRARED SPECTRUM\nORIGIN,example\nXUNITS,1/CM\nYUNITS,ABSORBANCE\nNPOINTS,901\nFIRSTX,400\nLASTX,4000\nXYDATA\n"
             + _rows(IR_X, iy, "{:.1f},{:.6f}"))
    c["S15_jasco_style_keyvalue_header"] = (jasco.encode(), "IR", {"delimiter": "COMMA", "commit": True, "needs": [], "x_evidence": "EXPLICIT_UNIT", "meta_keys": ["XUNITS", "YUNITS"]})
    ocean = ("Data from example_001.txt Node\nDate: Tue Oct 06 10:00:00 UTC 2026\nUser: example\nSpectrometer: ExampleSpec\nIntegration Time (sec): 1,000000E-1\n"
             "Number of Pixels in Spectrum: 601\n>>>>>Begin Spectral Data<<<<<\n" + _rows(UV_X, uy, "{:.3f}\t{:.5f}").replace(".", ","))
    c["S16_oceanview_style_decimal_comma_marker"] = (ocean.encode(), "UVVIS", {"delimiter": "TAB", "decimal": ",", "commit": False, "needs": ["x_unit", "y_quantity_and_unit"]})
    c["S17_row_oriented_two_rows"] = ((",".join(f"{v:.4f}" for v in IR_X) + "\n" + ",".join(f"{v:.6f}" for v in iy) + "\n").encode(), "IR",
        {"orientation": "ROWS", "commit": False, "needs": ["x_unit", "y_quantity_and_unit"], "n_rows": 901})
    err = 0.01 * np.ones_like(uy)
    s18 = "Wavelength (nm),Absorbance,Uncertainty\n" + "\n".join(f"{a:.1f},{b:.5f},{e:.4f}" for a, b, e in zip(UV_X, uy, err, strict=True)) + "\n"
    c["S18_three_columns_with_uncertainty"] = (s18.encode(), "UVVIS", {"commit": False, "needs": ["column_roles"], "commit_with_choice": {"y_error_index": 2}})
    s19 = "Raman shift (cm^-1),Intensity (counts),Intensity (counts),Intensity (counts)\n" + "\n".join(
        f"{a:.2f},{b:.2f},{b + 3:.2f},{b - 2:.2f}" for a, b in zip(RAMAN_X, ry, strict=True)) + "\n"
    c["S19_multiple_y_columns"] = (s19.encode(), "RAMAN", {"commit": False, "needs": ["column_roles"]})
    c["S20_fortran_D_exponent"] = (("Wavenumber (cm-1),Absorbance\n" + "\n".join(f"{a:.4f}D+00,{b:.6e}".replace("e", "D") for a, b in zip(IR_X, iy, strict=True)) + "\n").encode(), "IR",
        {"commit": True, "needs": [], "n_rows": 901})
    quoted = '"Wavelength (nm)","Absorbance"\n' + "\n".join(f'"{a:,.1f}","{b:.5f}"' for a, b in zip(np.linspace(1000, 2500, 40), np.linspace(0.1, 0.9, 40), strict=True)) + "\n"
    c["S21_quoted_thousands_separators"] = (quoted.encode(), "UVVIS", {"analysis_error": "THOUSANDS_SEPARATOR_AMBIGUOUS"})
    under = "Wavenumber (cm-1),Absorbance\n" + "\n".join(f"{a:.1f},{b:.4f}" for a, b in zip(IR_X[:40], iy[:40], strict=True)).replace("1", "1_0", 1) + "\n"
    c["S22_underscore_digit_groups"] = (under.encode(), "IR", {"analysis_error": "DATA_BLOCK_INTERRUPTED"})
    c["S23a_zip_archive"] = (b"PK\x03\x04" + bytes(RNG.integers(0, 255, 300, dtype=np.uint8)), "IR", {"analysis_error": "ARCHIVE_OR_BINARY_NOT_ACCEPTED"})
    c["S23b_pdf"] = (b"%PDF-1.7\n" + b"x" * 100, "IR", {"analysis_error": "ARCHIVE_OR_BINARY_NOT_ACCEPTED"})
    c["S23c_binary_with_nul"] = (bytes(RNG.integers(0, 255, 4000, dtype=np.uint8)) + b"\x00" * 500, "IR", {"analysis_error": "NOT_TEXT"})
    c["S23d_gzip"] = (b"\x1f\x8b\x08\x00" + bytes(RNG.integers(0, 255, 200, dtype=np.uint8)), "IR", {"analysis_error": "ARCHIVE_OR_BINARY_NOT_ACCEPTED"})
    c["S24_formula_like_metadata"] = (("# Sample: =HYPERLINK(\"http://example.invalid\",\"x\")\n# Note: @SUM(1+1)\n# Operator: +cmd|' /C calc'!A0\nWavenumber (cm-1),Absorbance\n" + _rows(IR_X, iy)).encode(), "IR",
        {"commit": True, "needs": [], "analysis_warning": "CSV_FORMULA_LIKE"})
    ranged = "wavelength\tcross sect.\tuncertainty\n" + "\n".join(f"{lo}-{lo + 9}\t{1.0e-20 * (1 + i):.2e}\t2.7e-22" for i, lo in enumerate(range(270, 360, 10))) + "\n"
    c["S25_binned_wavelength_ranges"] = (ranged.encode(), "UVVIS", {"analysis_error": "BINNED_X_NOT_SUPPORTED"})
    c["S26a_too_few_points"] = (("Wavenumber (cm-1),Absorbance\n" + _rows(IR_X[:5], iy[:5])).encode(), "IR", {"commit": False, "build_error": "TOO_FEW_POINTS"})
    c["S26b_header_only"] = (b"Wavenumber (cm-1),Absorbance\n", "IR", {"analysis_error": "NO_NUMERIC_BLOCK"})
    c["S26c_empty"] = (b"", "IR", {"analysis_error": "NO_NUMERIC_BLOCK"})
    umin = _rows(IR_X, iy).split("\n")
    umin[200] = "1204.0000,−0.001"
    c["S27_unicode_minus_in_data"] = (("Wavenumber (cm-1),Absorbance\n" + "\n".join(umin)).encode(), "IR", {"analysis_error": "DATA_BLOCK_INTERRUPTED", "analysis_warning": "UNICODE_MINUS_PRESENT"})
    c["S28_dos_ctrl_z_eof"] = (("Wavenumber (cm-1),Absorbance\n" + _rows(IR_X, iy)).encode() + b"\x1a", "IR", {"commit": True, "needs": [], "analysis_warning": "DOS_EOF_MARKER"})
    c["S29_single_huge_line"] = (b"1," * 2_600_000 + b"1\n", "IR", {"analysis_error": "LINE_TOO_LONG"})
    c["S30_negative_noise_kept"] = (("Wavenumber (cm-1),Absorbance\n" + _rows(IR_X, iy - 0.02)).encode(), "IR", {"commit": True, "needs": [], "build_warning": "NEGATIVE_SIGNAL"})
    # cp1252 header with degree sign and superscript, whitespace data, tab metadata table (shape of a real Raman export)
    meta = "xA        \txB           \tdensity/kg/m³ \tt/°C      \n1.000000\t0.000000\t0.000000\t25.631160\t\n"
    c["S31_cp1252_tab_metadata_then_space_data"] = ((meta + "\n".join(f"{a:.6f} {b:.1f}" for a, b in zip(RAMAN_X, ry, strict=True)) + "\n").encode("cp1252"), "RAMAN",
        {"encoding": "cp1252", "delimiter": "WHITESPACE", "commit": False, "needs": ["x_unit", "y_quantity_and_unit"], "analysis_warning": "ENCODING_FALLBACK", "n_rows": len(RAMAN_X)})
    c["S32_trailing_summary_numeric_footer_ok"] = (("Wavelength (nm),Abs\n" + _rows(UV_X, uy, "{:.1f},{:.5f}") + "\nMax,0.95\nMin,0.01\n").encode(), "UVVIS",
        {"commit": True, "needs": [], "n_rows": 601})
    return c
