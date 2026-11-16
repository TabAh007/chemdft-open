# ruff: noqa: E501
"""External Import V1 against REAL Gaussian 09/16 and ORCA 5/6 outputs (not committed; see tools/fetch_external_import_fixtures.py).

Everything runs through the production runner: an isolated import-worker subprocess with the pinned cclib commit.
"""
from __future__ import annotations

import bz2
import functools
import gzip
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

import pytest
from chemdft_api.config import Settings
from chemdft_api.contracts.external_import import ImportPreviewReport, body_sha256
from chemdft_api.external_import_runner import PARSER_INFO, run_import_worker
from external_import_support import (
    WORKER_PYTHON,
    WORKER_SRC,
    expected,
    fixture_bytes,
    requires_corpus,
)

pytestmark = requires_corpus

SETTINGS = Settings(auto_create_schema=False)


def run_bytes(data: bytes, settings: Settings = SETTINGS) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "upload"
        path.write_bytes(data)
        return run_import_worker(path, settings).report


@functools.cache
def report_for(fixture_id: str) -> dict:
    return run_bytes(fixture_bytes(fixture_id))


def body(fixture_id: str) -> dict:
    return report_for(fixture_id)["body"]


def payload(fixture_id: str, kind: str) -> dict:
    for entry in body(fixture_id)["results"]:
        if entry["result_type"] == f"chemdft.imported.{kind}":
            return entry["payload"]
    raise AssertionError(f"{fixture_id} has no {kind} result")


def codes(report_body: dict, severity: str = "reject") -> set[str]:
    return {d["code"] for d in report_body["diagnostics"] if d["severity"] == severity}


FIXTURES = sorted(expected())


# ------------------------------------------------------------------------------------------------ whole corpus parity
@pytest.mark.parametrize("fixture_id", FIXTURES)
def test_every_fixture_decides_as_the_validated_gate_expects(fixture_id):
    entry = expected()[fixture_id]
    report = report_for(fixture_id)
    ImportPreviewReport.model_validate(report)  # full strict contract
    assert body_sha256(report["body"]) == report["preview_sha256"]
    b = report["body"]
    assert ("ACCEPT" if b["status"] == "READY" else "REJECT") == entry["chemdft_gate"]
    if entry["chemdft_gate"] == "REJECT" and entry["reject_codes"]:
        assert set(entry["reject_codes"]) & codes(b), (entry["reject_codes"], codes(b))
    if b["status"] == "READY":
        assert b["job"]["charge"] == entry["charge"] and b["job"]["multiplicity"] == entry["multiplicity"]
        assert b["job"]["n_atoms"] == entry["natom"]
        assert b["cclib"]["network_or_archive_attempts"] == 0  # URL/archive paths are never needed


def test_parser_provenance_matches_the_pinned_wheel():
    b = body("g16-water-hf-freq")
    assert b["parser"] == PARSER_INFO and b["parser"]["commit"] == "b1364ecf5ac21042c5a37ed5446771217e0431ea"


# ------------------------------------------------------------------------------------------------ detection from the log
@pytest.mark.parametrize(
    ("fixture_id", "engine", "label_prefix"),
    [
        ("g09-dvb-ir", "Gaussian", "Gaussian 09"),
        ("g16-water-hf-freq", "Gaussian", "Gaussian 16"),
        ("orca5-water-hf-freq", "ORCA", "ORCA 5."),
        ("orca6-water-hf-freq", "ORCA", "ORCA 6.1"),
        ("orca6-dvb-raman", "ORCA", "ORCA 6.0"),
    ],
)
def test_engine_and_version_are_detected_from_the_log(fixture_id, engine, label_prefix):
    program = body(fixture_id)["program"]
    assert program["engine"] == engine and program["label"].startswith(label_prefix)


def test_detection_ignores_the_file_name():
    data = fixture_bytes("orca6-water-hf-freq")
    assert body_sha256(run_bytes(data)["body"]) == body_sha256(report_for("orca6-water-hf-freq")["body"])
    assert run_bytes(b"* O R C A *\nProgram Version 6.1.0\n" + b"x\n" * 10)["body"]["status"] == "REJECTED"


# ------------------------------------------------------------------------------------------------ science: charge/multiplicity/spin/linear/imaginary
@pytest.mark.parametrize("fixture_id", ["g16-o2anion-doublet", "orca6-o2anion-doublet"])
def test_open_shell_charge_multiplicity_and_two_spin_channels(fixture_id):
    b = body(fixture_id)
    assert (b["job"]["charge"], b["job"]["multiplicity"]) == (-1, 2) and b["job"]["reference"] == "unrestricted"
    structure = payload(fixture_id, "structure")
    assert (structure["charge"], structure["multiplicity"]) == (-1, 2)
    channels = payload(fixture_id, "orbital-table")["spin_channels"]
    assert [c["label"] for c in channels] == ["alpha", "beta"]
    assert channels[0]["homo_index"] != channels[1]["homo_index"]  # alpha and beta occupations differ for a doublet


@pytest.mark.parametrize("fixture_id", ["g16-hcn-linear-freq", "g16-cs2-linear-freq", "orca6-hcn-linear-freq", "orca6-cs2-linear-freq", "orca5-hcn-linear-freq", "g16-o2anion-doublet"])
def test_linear_molecules_use_3n_minus_5_modes(fixture_id):
    vib = payload(fixture_id, "vibrations")
    natom = len(vib["equilibrium_geometry"]["atoms"])
    assert vib["linear"] is True and vib["mode_count"] == 3 * natom - 5 == vib["expected_mode_count"]
    assert all(m["frequency_cm1"] > 0 for m in vib["modes"]) and min(m["frequency_cm1"] for m in vib["modes"]) > 100


def test_nonlinear_molecules_use_3n_minus_6_modes():
    vib = payload("g16-water-hf-freq", "vibrations")
    assert vib["linear"] is False and vib["mode_count"] == 3 * 3 - 6


@pytest.mark.parametrize(
    ("fixture_id", "printed"),
    [("g16-sn2-ts-imaginary", -345.2661), ("orca5-sn2-ts-imaginary", -344.23), ("orca6-sn2-ts-imaginary", -343.71), ("orca5-nh3-ts-imaginary", -775.8), ("orca6-nh3-ts-imaginary", -774.07)],
)
def test_imaginary_frequencies_are_preserved_with_their_sign(fixture_id, printed):
    vib = payload(fixture_id, "vibrations")
    imaginary = [m for m in vib["modes"] if m["imaginary"]]
    assert len(imaginary) == 1 == vib["imaginary_mode_count"]
    assert imaginary[0]["frequency_cm1"] == pytest.approx(printed, abs=1e-3) and imaginary[0]["frequency_cm1"] < 0
    assert "IMAGINARY_FREQUENCIES_PRESENT" in codes(body(fixture_id), "warning")
    assert any(i["state"] == "WARNING" for i in body(fixture_id)["items"])


# ------------------------------------------------------------------------------------------------ job structure
def test_gaussian_opt_freq_is_one_logical_job_with_internal_steps():
    b = body("g16-ethane-opt-freq")
    assert b["job"]["job_count"] == 1 and b["job"]["internal_steps"] == 2 and b["job"]["job_type"] == "opt+freq"
    assert b["job"]["termination"]["status"] == "COMPLETED"
    types = {r["result_type"].rsplit(".", 1)[-1] for r in b["results"]}
    assert {"structure", "energy", "optimization", "vibrations", "orbital-table", "thermochemistry"} <= types
    structure, vib = payload("g16-ethane-opt-freq", "structure"), payload("g16-ethane-opt-freq", "vibrations")
    assert structure["geometry_role"] == "final-optimized" and structure["optimized"] is True
    assert structure["atoms"] == vib["equilibrium_geometry"]["atoms"]  # frequency geometry equals the final optimized geometry


def test_gaussian_link1_is_rejected_not_merged():
    b = body("g16-acetone-linked")
    assert b["status"] == "REJECTED" and "MULTIPLE_JOBS_NOT_SUPPORTED_V1" in codes(b)
    assert b["results"] == [] and len(b["jobs"]) == 2 and b["job"]["job_count"] == 2


def test_orca_multiple_jobs_are_rejected():
    data = fixture_bytes("orca6-water-hf-freq") + fixture_bytes("orca6-benzene-sp")
    b = run_bytes(data)["body"]
    assert b["status"] == "REJECTED" and "MULTIPLE_JOBS_NOT_SUPPORTED_V1" in codes(b) and b["results"] == []


def test_two_unrelated_gaussian_jobs_are_rejected_not_merged():
    b = run_bytes(fixture_bytes("g16-water-hf-freq") + fixture_bytes("g16-benzene-sp"))["body"]
    assert b["status"] == "REJECTED" and "MULTIPLE_JOBS_NOT_SUPPORTED_V1" in codes(b)


# ------------------------------------------------------------------------------------------------ rejection of failed / incomplete runs
@pytest.mark.parametrize("fixture_id", ["g16-fe-scf-fail", "orca5-fe-scf-fail", "orca6-fe-scf-fail"])
def test_unconverged_scf_is_rejected(fixture_id):
    b = body(fixture_id)
    assert b["status"] == "REJECTED" and "SCF_NOT_CONVERGED" in codes(b) and b["results"] == []


@pytest.mark.parametrize("fixture_id", ["g16-opt-notconverged", "orca6-opt-notconverged"])
def test_unconverged_optimization_never_publishes_a_converged_structure(fixture_id):
    b = body(fixture_id)
    assert b["status"] == "REJECTED" and "OPTIMIZATION_NOT_CONVERGED" in codes(b) and b["results"] == []
    assert b["job"]["convergence"]["optimization"]["status"] == "NOT_CONVERGED"


def test_orca_normal_termination_does_not_imply_convergence():
    b = body("orca6-opt-notconverged")
    assert b["job"]["termination"]["status"] == "COMPLETED"  # ORCA says TERMINATED NORMALLY...
    assert b["status"] == "REJECTED"  # ...but the optimization did not converge


@pytest.mark.parametrize("fixture_id", ["g16-timed-out", "orca6-timed-out", "orca6-wrong-charge-mult", "g16-wrong-charge-mult"])
def test_real_incomplete_or_failed_runs_are_rejected(fixture_id):
    b = body(fixture_id)
    assert b["status"] == "REJECTED" and (codes(b) & {"INCOMPLETE_OUTPUT", "ERROR_TERMINATION"}) and b["results"] == []


@pytest.mark.parametrize("fixture_id", ["g16-water-hf-freq", "g16-ethane-opt-freq", "orca6-water-hf-freq", "orca6-ethane-opt-freq", "orca5-hcn-linear-freq"])
@pytest.mark.parametrize("fraction", [0.95, 0.6, 0.3])
def test_truncated_outputs_are_rejected(fixture_id, fraction):
    lines = fixture_bytes(fixture_id).decode().splitlines(keepends=True)
    b = run_bytes("".join(lines[: int(len(lines) * fraction)]).encode())["body"]
    assert b["status"] == "REJECTED" and b["results"] == []
    assert codes(b) & {"INCOMPLETE_OUTPUT", "NO_SCF_ENERGY", "OPTIMIZATION_NOT_CONVERGED", "ERROR_TERMINATION"}


def test_cclib_success_true_does_not_rescue_a_truncated_file():
    """cclib reports `success=True` for a Gaussian Opt+Freq cut after its first internal step; ChemDFT must still reject."""
    lines = fixture_bytes("g16-ethane-opt-freq").decode().splitlines(keepends=True)
    first = next(i for i, ln in enumerate(lines) if "Normal termination of Gaussian" in ln)
    truncated = "".join(lines[: first + 4])
    probe = subprocess.run(
        [str(WORKER_PYTHON), "-s", "-c", "import sys, json; from chemdft_import_worker.parse import parse_segment; r = parse_segment(sys.stdin.read()); print(json.dumps({'success': r.success_flag if isinstance(r.success_flag, (bool, str)) else str(r.success_flag), 'parsed': r.data is not None}))"],
        input=truncated,
        capture_output=True,
        text=True,
        env={"PYTHONPATH": str(WORKER_SRC), "PATH": "/usr/bin:/bin"},
        check=True,
    )
    assert json.loads(probe.stdout) == {"success": True, "parsed": True}  # the parser alone would have accepted it
    b = run_bytes(truncated.encode())["body"]
    assert b["status"] == "REJECTED" and "INCOMPLETE_OUTPUT" in codes(b) and b["results"] == []


def test_complete_first_job_plus_truncated_second_job_does_not_pass():
    lines = fixture_bytes("g16-acetone-linked").decode().splitlines(keepends=True)
    b = run_bytes("".join(lines[: int(len(lines) * 0.8)]).encode())["body"]
    assert b["status"] == "REJECTED" and {"MULTIPLE_JOBS_NOT_SUPPORTED_V1", "INCOMPLETE_OUTPUT"} <= codes(b)
    second_job_start = "".join(fixture_bytes("orca6-benzene-sp").decode().splitlines(keepends=True)[:20]).encode()
    o = run_bytes(fixture_bytes("orca6-water-hf-freq") + second_job_start)["body"]
    assert o["status"] == "REJECTED" and "MULTIPLE_JOBS_NOT_SUPPORTED_V1" in codes(o)


def test_correlated_and_excited_state_optimization_are_out_of_scope():
    assert "CORRELATED_METHOD_NOT_SUPPORTED_V1" in codes(body("g16-ch2-triplet"))
    raw = fixture_bytes("orca6-formaldehyde-td").decode()
    patched = raw.replace("|  1> ! BP86 def2-SVP def2/J TightSCF", "|  1> ! BP86 def2-SVP def2/J TightSCF Opt", 1).replace("|  4> nroots 3 #", "|  4> iroot 1\n|  4> nroots 3 #", 1)
    assert patched != raw
    assert "EXCITED_STATE_OPTIMIZATION_NOT_SUPPORTED_V1" in codes(run_bytes(patched.encode())["body"])


# ------------------------------------------------------------------------------------------------ hostile inputs through the runner
def test_nul_and_invalid_utf8_are_rejected():
    base = fixture_bytes("g16-water-hf-freq")
    nul = bytearray(base)
    for i in range(1000, len(nul), 3000):
        nul[i] = 0
    assert "NOT_TEXT" in codes(run_bytes(bytes(nul))["body"])
    assert codes(run_bytes(b"\xff\xfe\xfd" * 5000)["body"]) == {"NOT_TEXT"}


def test_archives_are_rejected_before_parsing():
    base = fixture_bytes("g16-water-hf-freq")
    for blob in (gzip.compress(base), bz2.compress(base)):
        b = run_bytes(blob)["body"]
        assert "COMPRESSED_INPUT_NOT_SUPPORTED" in codes(b) and b["cclib"] is None and b["results"] == []


def test_a_url_cannot_be_the_input():
    b = run_bytes(b"https://169.254.169.254/latest/meta-data/iam/\n")["body"]
    assert "URL_INPUT_REFUSED" in codes(b) and b["cclib"] is None


def test_pathologically_long_lines_are_rejected():
    assert codes(run_bytes(b"x" * (1024 * 1024 + 10))["body"]) == {"LINE_TOO_LONG"}


def test_parser_never_attempts_network_or_archive_access():
    for fixture_id in FIXTURES:
        b = body(fixture_id)
        if b["cclib"] is not None:
            assert b["cclib"]["network_or_archive_attempts"] == 0
    src = (WORKER_SRC / "chemdft_import_worker" / "parse.py").read_text()
    assert len(re.findall(r"ccopen\(", src)) == 1 and "ccopen(path," in src  # one call site, always a pathlib.Path
    assert "joboutput" in src and "ccopen(str(" not in src and "ccopen(source" not in src


def padded_valid_output() -> bytes:
    """A valid Gaussian output followed by 55 MB of ordinary text: passes the pre-check, then takes the parser ~17 s unrestricted."""
    return fixture_bytes("g16-water-hf-freq") + b"filler line of ordinary text that must be scanned\n" * 1_100_000


def test_parser_wall_clock_timeout():
    b = run_bytes(padded_valid_output(), Settings(auto_create_schema=False, import_parse_wall_seconds=1))["body"]
    assert b["status"] == "REJECTED" and codes(b) == {"PARSE_TIMEOUT"} and b["results"] == []


def test_parser_cpu_limit_stops_the_worker():
    cpu = Settings(auto_create_schema=False, import_parse_cpu_seconds=1, import_parse_wall_seconds=60)
    b = run_bytes(padded_valid_output(), cpu)["body"]
    assert b["status"] == "REJECTED" and codes(b) == {"PARSE_RESOURCE_LIMIT"} and b["results"] == []


def test_parser_memory_limit_stops_the_worker():
    memory = Settings(auto_create_schema=False, import_parse_memory_bytes=128 * 1024 * 1024, import_parse_wall_seconds=60)
    b = run_bytes(padded_valid_output(), memory)["body"]
    assert b["status"] == "REJECTED" and codes(b) == {"PARSE_RESOURCE_LIMIT"} and b["results"] == []


def test_files_over_the_size_cap_are_rejected_before_parsing():
    over = b"a line of text\n" * (5 * 1024 * 1024 + 10)  # > 64 MiB
    b = run_bytes(over)["body"]
    assert b["status"] == "REJECTED" and codes(b) == {"FILE_TOO_LARGE"} and b["cclib"] is None


# ------------------------------------------------------------------------------------------------ hashes
def test_source_sha256_and_preview_hash_are_stable():
    data = fixture_bytes("g16-ethane-opt-freq")
    first, second = run_bytes(data), run_bytes(data)
    assert first["body"]["source"]["sha256"] == hashlib.sha256(data).hexdigest() == second["body"]["source"]["sha256"]
    assert first["preview_sha256"] == second["preview_sha256"] == report_for("g16-ethane-opt-freq")["preview_sha256"]
    changed = run_bytes(data + b" \n")
    assert changed["preview_sha256"] != first["preview_sha256"] and changed["body"]["source"]["sha256"] != first["body"]["source"]["sha256"]


# ------------------------------------------------------------------------------------------------ units
def printed_gaussian_scf(fixture_id: str) -> float:
    return float(re.findall(r"SCF Done:\s+E\(\w+\)\s+=\s+(-?\d+\.\d+)", fixture_bytes(fixture_id).decode())[-1])


@pytest.mark.parametrize("fixture_id", ["g16-water-hf-freq", "g16-ethane-opt-freq", "g16-benzene-sp", "g09-dvb-opt", "g16-dvb-td"])
def test_gaussian_energies_recover_the_printed_hartree_value_exactly(fixture_id):
    energy = payload(fixture_id, "energy")["scf_energy"]
    assert energy["unit"] == "Eh" and energy["raw_unit"] == "eV" and energy["conversion"] == "cclib.eV->Eh/1"
    assert energy["value"] == pytest.approx(printed_gaussian_scf(fixture_id), abs=1e-9)
    assert energy["value"] == energy["raw_value"] / 27.21138505  # parser convention, not ChemDFT's CODATA constant


def test_orca_energy_includes_dispersion_as_reported():
    text = fixture_bytes("orca6-benzene-sp").decode()
    scf = float(re.findall(r"TOTAL SCF ENERGY\n-+\n(?:.*\n)*?Total Energy\s+:\s+(-?\d+\.\d+) Eh", text)[-1])
    disp = float(re.findall(r"Dispersion correction\s+(-?\d+\.\d+)", text)[-1])
    assert payload("orca6-benzene-sp", "energy")["scf_energy"]["value"] == pytest.approx(scf + disp, abs=1e-8)


def test_orbital_energies_keep_raw_values_and_conversion():
    channel = payload("g16-water-hf-freq", "orbital-table")["spin_channels"][0]
    assert channel["label"] == "restricted"
    assert all(h == pytest.approx(e / 27.21138505, abs=1e-12) for h, e in zip(channel["energies_hartree"], channel["raw_energies_ev"], strict=True))


def test_dipole_moments_are_not_imported():
    for entry in body("g16-water-hf-freq")["results"]:
        assert "moments" not in entry["payload"] and "dipole" not in json.dumps(entry["payload"]).lower().replace("transition dipoles", "")
    assert any(i["id"] == "dipole" and i["state"] == "UNAVAILABLE" for i in body("g16-water-hf-freq")["items"])


# ------------------------------------------------------------------------------------------------ Raman / IR / UV-Vis / thermochemistry semantics
def test_ir_only_output_never_gains_raman_activities():
    vib = payload("orca5-dvb-ir", "vibrations")
    assert vib["has_ir_intensities"] is True and vib["has_raman_activities"] is False
    assert all(m["raman_activity_a4_amu"] is None for m in vib["modes"]) and "not reported" in vib["raman_activity_note"]
    raman_item = next(i for i in body("orca5-dvb-ir")["items"] if i["id"] == "raman")
    assert raman_item["state"] == "UNAVAILABLE"


@pytest.mark.parametrize("fixture_id", ["g16-dvb-raman", "g09-dvb-raman", "orca6-dvb-raman"])
def test_raman_activities_are_imported_only_where_actually_present(fixture_id):
    vib = payload(fixture_id, "vibrations")
    assert vib["has_raman_activities"] is True and any(m["raman_activity_a4_amu"] > 0 for m in vib["modes"])
    assert "never synthesized" in vib["depolarization_ratios"]
    assert all("depolarization" not in m for m in vib["modes"])


def test_ir_intensities_and_displacements_for_animation():
    vib = payload("g16-water-hf-freq", "vibrations")
    assert vib["has_ir_intensities"] and len(vib["modes"]) == 3
    assert all(len(m["displacement"]) == 3 and m["displacement_euclidean_norm"] > 0 for m in vib["modes"])
    assert "only the direction is meaningful" in vib["displacement_convention"]["statement"]


def test_uvvis_states_keep_original_order_and_never_coerce_spin():
    triplets = payload("orca6-dvb-td", "excitations")
    labels = {s["spin_label"] for s in triplets["states"]}
    assert "triplet" in labels and all(s["spin_multiplicity"] == 3 for s in triplets["states"] if s["spin_label"] == "triplet")
    assert [s["index"] for s in triplets["states"]] == list(range(triplets["state_count"]))
    assert "not coerced" in triplets["spin_semantics"] and triplets["method"] == "TDA"
    singlets = payload("g16-dvb-td", "excitations")
    assert {s["spin_label"] for s in singlets["states"]} == {"singlet"} and singlets["states"][0]["oscillator_strength"] == pytest.approx(0.1707)
    assert singlets["oscillator_strength_gauge"] == "not reported by the parser"
    assert not any(r["result_type"].endswith("tddft") for r in body("orca6-dvb-td")["results"])  # never forced into the singlet-only TDDFT contract


def test_thermochemistry_is_imported_as_reported_never_recomputed():
    thermo = payload("g16-ethane-opt-freq", "thermochemistry")
    assert thermo["temperature_k"] == 398.15 and thermo["pressure_atm"] == 2.0 and thermo["pressure_pa"] == 202650.0
    assert thermo["reported_by"].startswith("Gaussian 16") and thermo["recomputed_by_chemdft"] is False
    assert "not available" in thermo["temperature_pressure_preview"] and thermo["plausibility"]["h_minus_e0_hartree"] > 0
    assert thermo["enthalpy_hartree"]["raw_unit"] == "Eh" and thermo["enthalpy_hartree"]["conversion"] == "identity"
    assert payload("orca6-ethane-opt-freq", "thermochemistry")["reported_by"].startswith("ORCA 6")


def test_orbital_table_has_no_coefficients_and_isosurfaces_are_unavailable():
    table = payload("g16-water-hf-freq", "orbital-table")
    assert "not imported" in table["orbital_coefficients"]
    assert any(i["id"] == "mo-isosurfaces" and i["state"] == "UNAVAILABLE" for i in body("g16-water-hf-freq")["items"])


def test_method_and_basis_are_unknown_when_not_established():
    b = body("orca6-water-hf-freq")["job"]
    assert b["method"]["status"] in {"ESTABLISHED", "UNKNOWN"} and b["basis"]["status"] in {"ESTABLISHED", "REPORTED", "UNKNOWN"}
    for fixture_id in FIXTURES:
        job = body(fixture_id)["job"]
        if job:
            for field in ("method", "basis"):
                assert job[field]["status"] != "UNKNOWN" or job[field]["value"] == "UNKNOWN"


def test_source_locators_are_persisted_with_results():
    entry = next(r for r in body("g16-ethane-opt-freq")["results"] if r["result_type"].endswith("vibrations"))
    loc = entry["source_locators"]["vibfreqs"]
    assert loc["line_start"] > 0 and loc["line_end"] >= loc["line_start"]
