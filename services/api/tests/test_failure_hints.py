"""Tests for Failure Doctor, Error Hints, and Log Sanitization (Release 0.0.60, Part 3)."""

from __future__ import annotations

from chemdft_api.ai.failure_hints import (
    find_failure_hint,
    format_calculation_doctor_explanation,
    sanitize_log_tail,
)


def test_qe_scf_failure_hint() -> None:
    hint = find_failure_hint("QE_SCF_NONCONVERGENT")
    assert hint is not None
    assert hint.engine == "quantum_espresso"
    assert "Self-consistent field" in hint.cause
    assert "mixing_beta" in hint.remedy
    assert "qe_parsers.py" in hint.source_citation

    # Test regex match from log text
    log = "iteration # 100: convergence NOT achieved after 100 iterations"
    matched = find_failure_hint(None, log)
    assert matched is not None
    assert matched.error_code == "QE_SCF_NONCONVERGENT"


def test_pyscf_scf_failure_hint() -> None:
    hint = find_failure_hint("PYSCF_SCF_NONCONVERGENT")
    assert hint is not None
    assert hint.engine == "pyscf"
    assert "Hartree-Fock" in hint.cause
    assert "pyscf_worker.py" in hint.source_citation


def test_xtb_geometry_failure_hint() -> None:
    hint = find_failure_hint("XTB_GEOMETRY_NOT_CONVERGED")
    assert hint is not None
    assert hint.engine == "xtb"
    assert "xTB geometry optimization" in hint.cause
    assert "xtb_optimization.py" in hint.source_citation


def test_unknown_error_code_fallback() -> None:
    explanation = format_calculation_doctor_explanation(
        calculation_id="calc-unknown-12345",
        status="FAILED",
        task_type="energy",
        method="PBE",
        error_code="MYSTERY_ERROR_999",
        error_detail="Something obscure happened in cluster node 4",
    )

    assert "Calculation calc-unk... failed with MYSTERY_ERROR_999" in explanation
    assert "The log did not record a known failure code." in explanation
    assert "Sanitized log excerpt:" in explanation


def test_succeeded_run_quotes_authority() -> None:
    explanation = format_calculation_doctor_explanation(
        calculation_id="calc-succeed-12345",
        status="SUCCEEDED",
        task_type="energy",
        method="PBE+U",
        error_code=None,
        error_detail=None,
        authority="Quantum ESPRESSO 7.2",
    )

    assert "status SUCCEEDED" in explanation
    assert "Authority: Quantum ESPRESSO 7.2" in explanation
    assert "Results view" in explanation


def test_secret_and_path_stripping_on_log_tails() -> None:
    raw_log = (
        "Error in /Users/" "tab/Desktop/chemdft/secret_dir/run.py at line 42:\n"
        "Failed authentication with token=xyzSecret123456789 and bearer abcdef12345\n"
        "Scratch file located at /private/var/folders/xyz/temp.dat"
    )

    sanitized = sanitize_log_tail(raw_log)
    assert "/Users/" "tab" not in sanitized
    assert "/private/var" not in sanitized
    assert "token=xyzSecret" not in sanitized
    assert "[PATH]" in sanitized
    assert "[REDACTED_CREDENTIAL]" in sanitized
