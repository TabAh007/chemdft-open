"""Deterministic failure doctor and calculation explainer knowledge (Release 0.0.60, Part 3).

Maps known failure codes and engine stdout/stderr signatures to plain-language causes,
typical remedies, and repository citations (adapter file:line or fixture).
Engines covered:
- Quantum ESPRESSO (QE): SCF non-convergence, BFGS step limit, diagonalization, timeout,
  SSSP pseudo missing, Hubbard U bounds.
- PySCF: ground-state SCF non-convergence, periodic cell requirements.
- xTB: geometry optimization convergence.
Provides log sanitization (strips paths, secrets, tokens).
Labels all hints as 'typical cause, not verified for this run'.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class FailureHint:
    error_code: str
    engine: str
    cause: str
    remedy: str
    source_citation: str


FAILURE_HINTS_CATALOG: list[FailureHint] = [
    # Quantum ESPRESSO
    FailureHint(
        error_code="QE_SCF_NONCONVERGENT",
        engine="quantum_espresso",
        cause=(
            "Self-consistent field (SCF) electronic iterations did not converge "
            "within the maximum step limit."
        ),
        remedy=(
            "Increase electron_maxstep, reduce mixing_beta (e.g. 0.2 to 0.3), or introduce "
            "occupation smearing (e.g. Marzari-Vanderbilt) for metallic or magnetic systems."
        ),
        source_citation="services/api/src/chemdft_api/scientific/adapters/periodic/qe_parsers.py:45",
    ),
    FailureHint(
        error_code="QE_BFGS_STEP_LIMIT",
        engine="quantum_espresso",
        cause=(
            "Ionic relaxation reached the maximum number of BFGS geometry steps "
            "without meeting force thresholds."
        ),
        remedy=(
            "Increase nstep in relaxation settings, check whether the initial structure is "
            "far from equilibrium, or relax force convergence criteria."
        ),
        source_citation="services/api/src/chemdft_api/scientific/adapters/periodic/qe_parsers.py:88",
    ),
    FailureHint(
        error_code="QE_DIAGONALIZATION_ERROR",
        engine="quantum_espresso",
        cause=(
            "Subspace diagonalization (c_diaghg/choldc) failed, typically due to linear "
            "dependency or non-positive definite overlap."
        ),
        remedy=(
            "Switch diagonalization algorithm from david to cg, or adjust the "
            "wavefunction cutoff (ecutwfc)."
        ),
        source_citation="services/api/src/chemdft_api/scientific/adapters/periodic/qe_parsers.py:112",
    ),
    FailureHint(
        error_code="QE_TIMEOUT",
        engine="quantum_espresso",
        cause=(
            "Calculation exceeded the maximum wall-clock time limit configured for the "
            "execution stage."
        ),
        remedy=(
            "Increase the stage timeout, coarsen the k-point mesh, or reduce the cutoff "
            "energy if appropriate."
        ),
        source_citation="services/api/src/chemdft_api/scientific/adapters/periodic/qe_parsers.py:130",
    ),
    FailureHint(
        error_code="QE_PSEUDO_MISSING",
        engine="quantum_espresso",
        cause=(
            "SSSP pseudopotential file is missing for one or more elements in the "
            "periodic structure."
        ),
        remedy=(
            "Verify that all elements in the crystal unit cell have compatible pseudopotentials "
            "in the configured pseudo directory."
        ),
        source_citation="services/api/src/chemdft_api/scientific/adapters/periodic/qe_inputs.py:75",
    ),
    FailureHint(
        error_code="QE_HUBBARD_U_BOUNDS",
        engine="quantum_espresso",
        cause="Hubbard U parameter is negative or outside physically valid bounds.",
        remedy=(
            "Ensure Hubbard U parameters are non-negative, specified in eV, and within "
            "physical range (typically 1-8 eV for 3d transition metals)."
        ),
        source_citation="services/api/src/chemdft_api/scientific/adapters/periodic/qe_inputs.py:120",
    ),
    # PySCF
    FailureHint(
        error_code="PYSCF_SCF_NONCONVERGENT",
        engine="pyscf",
        cause=(
            "Mean-field Hartree-Fock or DFT SCF did not converge within the maximum cycle limit."
        ),
        remedy=(
            "Increase max_cycle, apply level shifting or damping, or enable second-order "
            "SCF (SOSCF)."
        ),
        source_citation="services/api/src/chemdft_api/scientific/engines/pyscf_worker.py:65",
    ),
    FailureHint(
        error_code="PYSCF_PERIODIC_CELL_REQUIRED",
        engine="pyscf",
        cause=(
            "Periodic boundary condition (PBC) calculation attempted without a valid lattice "
            "or periodic cell definition."
        ),
        remedy=(
            "Ensure a periodic cell with valid lattice vectors a, b, c is provided when calling "
            "PySCF periodic engines."
        ),
        source_citation="services/api/src/chemdft_api/scientific/engines/pyscf_periodic_worker.py:40",
    ),
    # xTB
    FailureHint(
        error_code="XTB_GEOMETRY_NOT_CONVERGED",
        engine="xtb",
        cause=(
            "Semi-empirical xTB geometry optimization did not achieve force convergence "
            "within the iteration cycle limit."
        ),
        remedy=(
            "Check the input structure for overlapping or highly strained atoms, or "
            "increase the maximum optimization cycles."
        ),
        source_citation="services/api/src/chemdft_api/scientific/engines/xtb_optimization.py:90",
    ),
]

_SIGNATURE_PATTERNS: list[tuple[re.Pattern, str]] = [
    (
        re.compile(r"convergence NOT achieved|SCF failed to converge", re.I),
        "QE_SCF_NONCONVERGENT",
    ),
    (
        re.compile(r"Maximum number of steps reached|bfgs failed", re.I),
        "QE_BFGS_STEP_LIMIT",
    ),
    (
        re.compile(r"choldc failed|c_diaghg|diagonalization failed", re.I),
        "QE_DIAGONALIZATION_ERROR",
    ),
    (
        re.compile(r"STAGE_TIMEOUT|wall time exceeded|timed out", re.I),
        "QE_TIMEOUT",
    ),
    (
        re.compile(r"pseudo(?:potential)? file not found|read_pseudo", re.I),
        "QE_PSEUDO_MISSING",
    ),
    (
        re.compile(r"Hubbard U negative|Hubbard_U invalid", re.I),
        "QE_HUBBARD_U_BOUNDS",
    ),
    (
        re.compile(r"SCF not converged|scf\.hf failed", re.I),
        "PYSCF_SCF_NONCONVERGENT",
    ),
    (
        re.compile(r"cell must be defined for PBC|pbc\.gto\.Cell required", re.I),
        "PYSCF_PERIODIC_CELL_REQUIRED",
    ),
    (
        re.compile(
            r"GEOMETRY OPTIMIZATION FAILED TO CONVERGE|xtb opt not converged",
            re.I,
        ),
        "XTB_GEOMETRY_NOT_CONVERGED",
    ),
]

# Patterns for sanitizing logs
_PATH_PATTERN = re.compile(
    r"(?:/Users/[^\s:]+|/home/[^\s:]+|/private/var/[^\s:]+|/tmp/[^\s:]+|[A-Za-z]:\\[^\s:]+)"
)
_SECRET_PATTERN = re.compile(
    r"\b(?:bearer\s+[a-zA-Z0-9_\-\.]+|token=[^\s]+|secret=[^\s]+|key=[^\s]+)\b",
    re.I,
)


def sanitize_log_tail(log_text: str | None, max_chars: int = 500) -> str:
    """Sanitize log text by stripping file system paths, credentials, and capping length."""
    if not log_text:
        return "[no log text available]"
    cleaned = _SECRET_PATTERN.sub("[REDACTED_CREDENTIAL]", log_text)
    cleaned = _PATH_PATTERN.sub("[PATH]", cleaned)
    if len(cleaned) > max_chars:
        return "..." + cleaned[-max_chars:].strip()
    return cleaned.strip()


def find_failure_hint(
    error_code: str | None,
    log_text: str | None = None,
) -> FailureHint | None:
    """Find a failure hint matching the error code or log signatures."""
    if error_code:
        code_upper = error_code.strip().upper()
        for hint in FAILURE_HINTS_CATALOG:
            if hint.error_code == code_upper:
                return hint

    if log_text:
        for pattern, code in _SIGNATURE_PATTERNS:
            if pattern.search(log_text):
                for hint in FAILURE_HINTS_CATALOG:
                    if hint.error_code == code:
                        return hint

    return None


def format_calculation_doctor_explanation(
    *,
    calculation_id: str,
    status: str,
    task_type: str,
    method: str | None,
    error_code: str | None,
    error_detail: str | None,
    authority: str | None = None,
    log_tail: str | None = None,
) -> str:
    """Deterministic plain-text explanation of a calculation run for chat."""
    status_upper = (status or "UNKNOWN").upper()
    lines = []

    if status_upper == "SUCCEEDED":
        lines.append(f"Calculation {calculation_id[:8]}... finished with status SUCCEEDED.")
        lines.append(f"Task: {task_type}, Method: {method or 'unspecified'}.")
        lines.append(f"Authority: {authority or 'Calculated'}.")
        lines.append("To inspect properties, orbital energies, and outputs, open the Results view.")
        return "\n".join(lines)

    # Failed or canceled
    code_display = error_code or "NO_CODE"
    lines.append(f"Calculation {calculation_id[:8]}... failed with {code_display}.")
    lines.append(f"Status: {status_upper}, Task: {task_type}, Method: {method or 'unspecified'}.")

    sanitized_log = sanitize_log_tail(log_tail or error_detail)

    hint = find_failure_hint(error_code, log_tail or error_detail)
    if hint is not None:
        lines.append(f"Typical cause, not verified for this run: {hint.cause}")
        lines.append(f"Typical remedy: {hint.remedy}")
        lines.append(f"Source citation: {hint.source_citation}")
    else:
        lines.append("The log did not record a known failure code.")

    lines.append(f"Sanitized log excerpt:\n{sanitized_log}")
    return "\n".join(lines)
