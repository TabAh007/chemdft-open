"""End-to-end through the subprocess entry point: files in, canonical JSON and float64 arrays out."""
# ruff: noqa: E501  (long evidence strings, scientific symbols and human-readable diagnostics)

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import synthetic_corpus as corpus
from chemdft_spectra_worker.canonical import array_bytes, sha256_hex

ROOT = Path(__file__).resolve().parents[1]
CASES = corpus.build()


def run(command: str, tmp_path: Path, request: dict, extra: list[str] | None = None, expect_ok: bool = True) -> tuple[subprocess.CompletedProcess[str], dict | None]:
    request_path, output_path = tmp_path / "request.json", tmp_path / f"{command}.json"
    request_path.write_text(json.dumps(request))
    process = subprocess.run(
        [sys.executable, "-s", "-m", "chemdft_spectra_worker.cli", command, "--request", str(request_path), "--output", str(output_path), "--cpu-seconds", "30", "--memory-bytes", str(2 * 1024**3), *(extra or [])],
        capture_output=True,
        text=True,
        cwd=tmp_path,
        env={"PYTHONPATH": str(ROOT / "src"), "PATH": "/usr/bin:/bin", "OMP_NUM_THREADS": "1"},
        check=False,
    )
    if expect_ok:
        assert process.returncode == 0, process.stderr
    return process, (json.loads(output_path.read_text()) if output_path.exists() else None)


def test_resolve_transform_peaks_compare_round_trip(tmp_path: Path) -> None:
    raw, _, _ = CASES["S01_csv_header_explicit_units"]
    source = tmp_path / "source.csv"
    source.write_bytes(raw)
    _, resolved = run("resolve", tmp_path, {"technique": "IR", "choices": {}}, ["--input", str(source), "--arrays-out", str(tmp_path / "raw.f64")])
    assert resolved is not None and resolved["preview"]["status"] == "READY" and resolved["has_arrays"]
    n = resolved["preview"]["point_count"]
    assert sha256_hex((tmp_path / "raw.f64").read_bytes()) == resolved["preview"]["arrays"]["artifact_sha256"]

    again_dir = tmp_path / "again"
    again_dir.mkdir()
    _, again = run("resolve", again_dir, {"technique": "IR", "choices": {}}, ["--input", str(source), "--arrays-out", str(again_dir / "raw.f64")])
    assert again is not None and again["preview_sha256"] == resolved["preview_sha256"]  # a second process reproduces the hash

    parent = {"point_count": n, "x_unit": "cm^-1", "y_quantity": "ABSORBANCE", "y_unit": "absorbance"}
    _, transformed = run("transform", tmp_path, {**parent, "op": "baseline.snip", "params": {"half_window_x": 80}}, ["--arrays-in", str(tmp_path / "raw.f64"), "--arrays-out", str(tmp_path / "base.f64"), "--aux-out", str(tmp_path / "baseline.f64")])
    assert transformed is not None
    record = transformed["record"]
    assert record["input"]["artifact_sha256"] == resolved["preview"]["arrays"]["artifact_sha256"]
    assert sha256_hex((tmp_path / "base.f64").read_bytes()) == record["output"]["artifact_sha256"]
    assert sha256_hex((tmp_path / "baseline.f64").read_bytes()) == record["output"]["aux"]["baseline"]["sha256"]

    corrected = {**parent, "point_count": record["output"]["point_count"]}
    _, peaks = run("peaks", tmp_path, {**corrected, "params": {"prominence_sigma": 8}}, ["--arrays-in", str(tmp_path / "base.f64")])
    assert peaks is not None and peaks["record"]["peak_count"] >= 3 and peaks["record"]["authority"] == "DERIVED_NOT_RAW"

    request = {
        "technique": "IR",
        "experimental": {"x_unit": "cm^-1", "x_min": 400.0, "x_max": 4000.0, "peaks": peaks["record"]["peaks"], "y_quantity": "ABSORBANCE"},
        "calculated": {"modes": [{"index": 1, "frequency_cm1": 1722.0, "intensity": 300.0}, {"index": 2, "frequency_cm1": 1231.0, "intensity": 120.0}], "phase": "GAS"},
        "matching": {"tolerance_cm1": 25.0},
        "experimental_phase": "NOT_SUPPLIED",
    }
    _, compared = run("compare", tmp_path, request)
    assert compared is not None and compared["record"]["metrics"]["matched"] == 2
    assert compared["record_sha256"] and "PHASE_UNKNOWN" in [d["code"] for d in compared["record"]["diagnostics"]]


def test_domain_refusals_exit_zero_with_an_error_body(tmp_path: Path) -> None:
    x = np.arange(0.0, 50.0)
    (tmp_path / "in.f64").write_bytes(array_bytes(x) + array_bytes(np.sin(x)))
    parent = {"point_count": 50, "x_unit": "cm^-1", "y_quantity": "ABSORBANCE", "y_unit": "absorbance"}
    process, body = run("transform", tmp_path, {**parent, "op": "baseline.arpls", "params": {}}, ["--arrays-in", str(tmp_path / "in.f64"), "--arrays-out", str(tmp_path / "out.f64")])
    assert process.returncode == 0 and body is not None and body["error"]["code"] == "PARAMETER_MISSING"
    assert not (tmp_path / "out.f64").exists()
    _, refused = run("compare", tmp_path, {"technique": "IR", "experimental": {"x_unit": "cm^-1", "x_min": 0, "x_max": 1, "peaks": []}, "calculated": {"modes": []}, "matching": {}})
    assert refused is not None and refused["error"]["code"] == "TOLERANCE_REQUIRED"


def test_corrupt_array_file_fails_loudly(tmp_path: Path) -> None:
    (tmp_path / "in.f64").write_bytes(b"\x00" * 100)
    process, _ = run("peaks", tmp_path, {"point_count": 50, "x_unit": "cm^-1", "y_quantity": "ABSORBANCE", "y_unit": "absorbance", "params": {"prominence": 1.0}}, ["--arrays-in", str(tmp_path / "in.f64")], expect_ok=False)
    assert process.returncode != 0 and "expected 800 for 50 points" in process.stderr


def test_transform_hash_does_not_depend_on_thread_count(tmp_path: Path) -> None:
    x = np.arange(400.0, 4000.0, 4.0)
    y = 0.9 / (1 + ((x - 1715) / 9.0) ** 2) + 1e-4 * x + 0.002 * np.random.default_rng(1).standard_normal(len(x))
    (tmp_path / "in.f64").write_bytes(array_bytes(x) + array_bytes(y))
    request_path = tmp_path / "request.json"
    request_path.write_text(json.dumps({"point_count": len(x), "x_unit": "cm^-1", "y_quantity": "ABSORBANCE", "y_unit": "absorbance", "op": "baseline.arpls", "params": {"stiffness_length_x": 400}}))
    digests = []
    for threads in ("1", "6"):
        out = tmp_path / f"out{threads}.f64"
        subprocess.run(
            [sys.executable, "-s", "-m", "chemdft_spectra_worker.cli", "transform", "--request", str(request_path), "--output", str(tmp_path / f"o{threads}.json"), "--arrays-in", str(tmp_path / "in.f64"), "--arrays-out", str(out)],
            check=True,
            env={"PYTHONPATH": str(ROOT / "src"), "PATH": "/usr/bin:/bin", "OMP_NUM_THREADS": threads, "OPENBLAS_NUM_THREADS": threads, "VECLIB_MAXIMUM_THREADS": threads},
            cwd=tmp_path,
        )
        digests.append(sha256_hex(out.read_bytes()))
    assert digests[0] == digests[1] and len(digests[0]) == 64
