"""External Import: ChemDFT-side gate logic on ChemDFT-authored synthetic marker text (no third-party outputs, no cclib)."""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import bz2
import gzip
import io
import zipfile

import pytest
from chemdft_import_worker import logscan, units
from chemdft_import_worker.precheck import precheck_bytes
from chemdft_import_worker.report import body_sha256, canonical_json
from external_import_support import gaussian_job, orca_job

# ------------------------------------------------------------------ pre-check (byte level)


def codes(findings):
    return {f.code for f in findings if f.severity == "reject"}


def test_precheck_accepts_plain_text():
    findings, stats = precheck_bytes(gaussian_job().encode())
    assert not findings and stats["encoding"] == "utf-8"


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        (b"", "EMPTY_FILE"),
        (b"abc\x00def", "NOT_TEXT"),
        (b"x" * (1024 * 1024 + 10), "LINE_TOO_LONG"),
        (b"https://169.254.169.254/latest/meta-data", "URL_INPUT_REFUSED"),
        (bytes(range(1, 9)) * 4000, "NOT_TEXT"),
    ],
)
def test_precheck_rejects_hostile_or_binary_input(payload, code):
    findings, _ = precheck_bytes(payload)
    assert code in codes(findings)


def test_precheck_rejects_archives_before_any_decoding():
    base = gaussian_job().encode()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr("x.log", base)
    for blob in (gzip.compress(base), bz2.compress(base), buf.getvalue()):
        assert "COMPRESSED_INPUT_NOT_SUPPORTED" in codes(precheck_bytes(blob)[0])


def test_precheck_size_limit(monkeypatch):
    from chemdft_import_worker import precheck

    monkeypatch.setattr(precheck, "MAX_SOURCE_BYTES", 100)
    assert "FILE_TOO_LARGE" in codes(precheck.precheck_bytes(b"a\n" * 200)[0])


def test_invalid_utf8_is_replaced_only_when_rare_otherwise_rejected():
    mostly_text = (gaussian_job().encode() * 40) + b"\xff\xfe"
    findings, stats = precheck_bytes(mostly_text)
    assert not codes(findings) and stats["replaced_bytes"] >= 1
    assert any(f.code == "NON_UTF8_BYTES_REPLACED" for f in findings)
    garbage = b"\xff\xfe\xfd" * 5000
    assert "NOT_TEXT" in codes(precheck_bytes(garbage)[0])


# ------------------------------------------------------------------ engine / version detection (from the log, never the filename)


@pytest.mark.parametrize(("version", "engine"), [("09", "Gaussian"), ("16", "Gaussian")])
def test_gaussian_detection(version, engine):
    text = gaussian_job().replace("Gaussian 16:  ES64L-G16RevC.01", f"Gaussian {version}:  ES64L-G{version}RevD.01")
    info = logscan.sniff("Entering Gaussian System, Link 0=g\n" + text)
    assert (info.engine, info.version) == (engine, version) and logscan.is_supported(info)


@pytest.mark.parametrize(("version", "ok"), [("5.0.4", True), ("6.0.1", True), ("6.1.0", True), ("4.2.1", False), ("7.0.0", False)])
def test_orca_detection_and_supported_versions(version, ok):
    info = logscan.sniff(orca_job(version=version))
    assert info.engine == "ORCA" and info.version == version and logscan.is_supported(info) is ok


def test_gaussian_unsupported_version_and_unknown_programs():
    assert not logscan.is_supported(logscan.sniff("Entering Gaussian System\n Gaussian 03:  x\n"))
    assert logscan.sniff("hello world\nPsi4 started on").engine is None


# ------------------------------------------------------------------ job segmentation


def test_gaussian_single_route_opt_freq_is_one_job_with_internal_steps():
    text = gaussian_job(route="#p B3LYP/6-31G(d) Opt Freq", steps=2, opt="converged")
    segments = logscan.segment_jobs("Entering Gaussian System\n" + text, "Gaussian")
    assert len(segments) == 1 and segments[0].internal_steps == 2
    assert logscan.termination(segments[0], "Gaussian")[0] == "COMPLETED"


def test_gaussian_link1_is_two_jobs():
    text = "Entering Gaussian System\n" + gaussian_job(route="# B3LYP/6-31G(d) Opt", opt="converged") + gaussian_job(route="# B3LYP/6-31G(d) Freq")
    segments = logscan.segment_jobs(text, "Gaussian")
    assert len(segments) == 2
    assert {logscan.termination(s, "Gaussian")[0] for s in segments} == {"COMPLETED"}


def test_orca_concatenated_outputs_are_multiple_jobs():
    text = orca_job() + orca_job(bang="! HF STO-3G")
    assert len(logscan.segment_jobs(text, "ORCA")) == 2
    assert logscan.orca_declared_job_count(text) >= 1


def test_orca_declared_compound_jobs_are_counted():
    text = orca_job() + "\n*  JOB NUMBER  2 of  3  *\n"
    assert logscan.orca_declared_job_count(text) == 3


# ------------------------------------------------------------------ termination (a normal-termination marker is necessary, never sufficient)


def test_gaussian_truncated_after_first_internal_step_is_incomplete():
    text = gaussian_job(route="#p B3LYP/6-31G(d) Opt Freq", steps=2, normal=False, opt="converged")
    seg = logscan.segment_jobs("Entering Gaussian System\n" + text, "Gaussian")[0]
    # one 'Normal termination' (end of step 1) for two internal steps
    assert seg.internal_steps == 2 and logscan.termination(seg, "Gaussian")[0] == "INCOMPLETE"


def test_gaussian_error_and_missing_termination():
    err = gaussian_job(opt="steps-exceeded", route="# B3LYP/6-31G(d) Opt", normal=False)
    assert logscan.termination(logscan.segment_jobs(err, "Gaussian")[0], "Gaussian")[0] == "ERROR_TERMINATION"
    cut = gaussian_job(normal=False)
    assert logscan.termination(logscan.segment_jobs(cut, "Gaussian")[0], "Gaussian")[0] == "INCOMPLETE"


def test_orca_termination_states():
    assert logscan.termination(logscan.segment_jobs(orca_job(), "ORCA")[0], "ORCA")[0] == "COMPLETED"
    assert logscan.termination(logscan.segment_jobs(orca_job(normal=False), "ORCA")[0], "ORCA")[0] == "INCOMPLETE"
    assert logscan.termination(logscan.segment_jobs(orca_job(scf="failed"), "ORCA")[0], "ORCA")[0] == "ERROR_TERMINATION"


# ------------------------------------------------------------------ convergence


def test_gaussian_scf_and_optimization_convergence_rules():
    for text, scf_status, opt_status in [
        (gaussian_job(), "CONVERGED", "NOT_REQUESTED"),
        (gaussian_job(scf="failed"), "NOT_CONVERGED", "NOT_REQUESTED"),
        (gaussian_job(route="# B3LYP/6-31G(d) Opt", opt="converged"), "CONVERGED", "CONVERGED"),
        (gaussian_job(route="# B3LYP/6-31G(d) Opt", opt="steps-exceeded"), "CONVERGED", "NOT_CONVERGED"),
        (gaussian_job(route="# B3LYP/6-31G(d) Opt"), "CONVERGED", "NOT_CONVERGED"),
    ]:
        seg = logscan.segment_jobs(text, "Gaussian")[0]
        info, findings = logscan.convergence(seg, "Gaussian", logscan.declared_job(seg, "Gaussian"))
        assert (info["scf"]["status"], info["optimization"]["status"]) == (scf_status, opt_status)
        assert bool(findings) == (scf_status == "NOT_CONVERGED" or opt_status == "NOT_CONVERGED")


def test_orca_optimization_not_converged_despite_normal_termination():
    text = orca_job(bang="! B3LYP def2-SVP Opt", opt="not-converged")
    assert "****ORCA TERMINATED NORMALLY****" in text
    seg = logscan.segment_jobs(text, "ORCA")[0]
    info, findings = logscan.convergence(seg, "ORCA", logscan.declared_job(seg, "ORCA"))
    assert info["optimization"]["status"] == "NOT_CONVERGED"
    assert any(f.code == "OPTIMIZATION_NOT_CONVERGED" for f in findings)
    ok = logscan.segment_jobs(orca_job(bang="! B3LYP def2-SVP Opt", opt="converged"), "ORCA")[0]
    assert logscan.convergence(ok, "ORCA", logscan.declared_job(ok, "ORCA"))[0]["optimization"]["status"] == "CONVERGED"


def test_gaussian_freq_only_job_is_not_treated_as_an_optimization():
    # Gaussian prints 'Berny optimization.' even for freq-only jobs; the route, not banners, decides.
    text = gaussian_job(route="#p HF/6-31G(d) Freq") + " Berny optimization.\n"
    seg = logscan.segment_jobs(text, "Gaussian")[0]
    assert logscan.declared_job(seg, "Gaussian").opt is False


def test_excited_state_optimization_detection():
    g = logscan.segment_jobs(gaussian_job(route="# TD(NStates=3,Root=1) B3LYP/6-31G(d) Opt", opt="converged"), "Gaussian")[0]
    assert logscan.excited_state_optimization(g, "Gaussian", logscan.declared_job(g, "Gaussian"))
    o = logscan.segment_jobs(orca_job(bang="! BP86 def2-SVP Opt").replace("|  2>", "|  2> %tddft\n|  2> iroot 1\n|  2> end\n|  2>"), "ORCA")[0]
    assert logscan.excited_state_optimization(o, "ORCA", logscan.declared_job(o, "ORCA"))
    sp = logscan.segment_jobs(orca_job(bang="! BP86 def2-SVP"), "ORCA")[0]
    assert not logscan.excited_state_optimization(sp, "ORCA", logscan.declared_job(sp, "ORCA"))


def test_job_type_comes_from_the_log_echo_not_from_filenames():
    seg = logscan.segment_jobs(orca_job(bang="! B3LYP def2-SVP Freq"), "ORCA")[0]
    declared = logscan.declared_job(seg, "ORCA")
    assert declared.freq and not declared.opt and declared.label == "freq"


def test_method_and_basis_are_unknown_unless_established():
    seg = logscan.segment_jobs(gaussian_job(route="#p B3LYP/6-31G(d) Freq"), "Gaussian")[0]
    facts = logscan.raw_facts(seg, "Gaussian")
    method, basis = logscan.method_and_basis(seg, "Gaussian", "B3LYP", "6-31G(d)", facts)
    assert (method.status, basis.status) == ("ESTABLISHED", "ESTABLISHED")
    odd = logscan.segment_jobs(gaussian_job(route="#p B3LYP 6-31G(d) Freq"), "Gaussian")[0]
    m2, b2 = logscan.method_and_basis(odd, "Gaussian", None, None, logscan.raw_facts(odd, "Gaussian"))
    assert (m2.status, b2.status, m2.value) == ("UNKNOWN", "UNKNOWN", "UNKNOWN")
    o = logscan.segment_jobs(orca_job(bang="! SOMEFUNCTIONAL def2-SVP"), "ORCA")[0]
    m3, b3 = logscan.method_and_basis(o, "ORCA", None, "def2-SVP", logscan.raw_facts(o, "ORCA"))
    assert m3.status == "UNKNOWN" and b3.status == "ESTABLISHED"


# ------------------------------------------------------------------ units (explicit, tested conversions)


def test_cclib_constants_match_the_pinned_parser_convention():
    assert units.CCLIB_HARTREE_TO_EV == 27.21138505
    assert units.CCLIB_EV_TO_WAVENUMBER == 8065.54429
    assert units.CCLIB_WAVENUMBER_TO_HARTREE == 219474.6313708


def test_hartree_recovery_uses_the_parser_constant_not_the_chemdft_one():
    printed = -10.02022  # Hartree printed in a Gaussian log; cclib stores it in eV
    raw_ev = printed * 27.21138505
    assert units.eV_to_hartree(raw_ev) == pytest.approx(printed, abs=1e-12)
    naive = raw_ev / 27.211386245988  # ChemDFT's unrelated CODATA constant would change the user's number
    assert abs(naive - printed) > 1e-7


def test_wavenumber_conversions_and_atm():
    assert units.wavenumber_to_nm(25000.0) == pytest.approx(400.0)
    assert units.wavenumber_to_ev(8065.54429) == pytest.approx(1.0)
    assert units.wavenumber_to_hartree(219474.6313708) == pytest.approx(1.0)
    assert units.atm_to_pa(2.0) == 202650.0
    with pytest.raises(ValueError):
        units.wavenumber_to_nm(0.0)


def test_scalar_keeps_raw_value_unit_and_conversion():
    q = units.scalar(-2173.0, "eV", units.eV_to_hartree(-2173.0), "Eh", "cclib.eV->Eh/1")
    assert q["raw_value"] == -2173.0 and q["raw_unit"] == "eV" and q["conversion"] in units.CONVERSIONS


# ------------------------------------------------------------------ preview hash determinism


def test_preview_hash_is_stable_and_sensitive():
    body = {"b": 1, "a": [1.5, 2.0], "c": {"z": None}}
    assert body_sha256(body) == body_sha256(dict(reversed(list(body.items()))))
    assert body_sha256(body) != body_sha256({**body, "b": 2})
    assert canonical_json(body).endswith(b"\n")
    with pytest.raises(ValueError):
        canonical_json({"x": float("nan")})
