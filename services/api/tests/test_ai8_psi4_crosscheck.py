"""AI-8 offline checks for the independent Psi4 cross-check. Nothing here starts Psi4 or PySCF.

The plan is built from real imports and the real calculation-input path (the sealed Psi4 prefix is
hashed, never run); execution is exercised only with the native adapter replaced, to prove the
arming, the fixed tolerance and the report logic.
"""

import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from nvidia_probe.replica import Replica  # noqa: E402
from scientific_execution import psi4_crosscheck as cc  # noqa: E402

needs_prefix = pytest.mark.skipif(
    not cc.PSI4_EXECUTABLE.is_file(), reason="the sealed Psi4 prefix is absent (ignored directory)"
)
needs_reports = pytest.mark.skipif(
    not all((ROOT / path).is_file() for path in cc.PYSCF_REPORTS.values()),
    reason="the retained PySCF acceptance reports are absent (ignored directory)",
)


def test_the_tolerance_is_a_fixed_constant_never_an_option():
    assert cc.TOLERANCE_HARTREE == 1e-6
    help_text = Path(cc.__file__).read_text()
    assert "--tolerance" not in help_text
    assert cc.LIMITS == {
        "threads": 1,
        "engine_memory": "1GiB",
        "wall_seconds_per_case": 180,
        "scratch_directory_bytes": 512 * 1024**2,
        "max_cases": 3,
    }


def test_the_comparison_reports_a_real_difference_and_does_not_round_it_away():
    assert cc.compare(-1.0, -1.0 + 0.9e-6)["verdict"] == "AGREES"
    exceeded = cc.compare(-1.0, -1.0 + 1.0000001e-6)
    assert exceeded["verdict"] == "DISCREPANCY"
    assert exceeded["difference_hartree"] == pytest.approx(1.0000001e-6, abs=1e-12)
    assert exceeded["tolerance_hartree"] == 1e-6


def test_the_analytic_nuclear_repulsion_is_independent_of_both_engines():
    atoms = [
        {"atomic_number": 1, "xyz_angstrom": [0.0, 0.0, -0.37]},
        {"atomic_number": 1, "xyz_angstrom": [0.0, 0.0, 0.37]},
    ]
    assert cc.nuclear_repulsion(atoms, cc.BOHR_CODATA_2010) == pytest.approx(
        cc.BOHR_CODATA_2010 / 0.74, rel=1e-15
    )
    # the two Bohr conventions differ only in the 9th digit: a recorded diagnostic, not an excuse
    water = [
        {"atomic_number": 8, "xyz_angstrom": [0.0, 0.0, 0.0]},
        {"atomic_number": 1, "xyz_angstrom": [0.9, 0.0, 0.0]},
        {"atomic_number": 1, "xyz_angstrom": [0.0, 0.9, 0.0]},
    ]
    gap = abs(
        cc.nuclear_repulsion(water, cc.BOHR_CODATA_2010)
        - cc.nuclear_repulsion(water, cc.BOHR_CODATA_2014)
    )
    assert 0 < gap < 1e-6


def test_execution_is_refused_unless_armed_for_exactly_this_plan():
    assert cc.arming_error("a" * 64, {}) == "REFUSED_NOT_ARMED"
    assert cc.arming_error("a" * 64, {cc.ARM_ENV: "EXECUTE-" + "b" * 16}) == "REFUSED_NOT_ARMED"
    assert cc.arming_error("a" * 64, {cc.ARM_ENV: "EXECUTE-" + "a" * 16}) is None
    armed_offline = {cc.ARM_ENV: "EXECUTE-" + "a" * 16, "CHEMDFT_E2E_OFFLINE": "1"}
    assert cc.arming_error("a" * 64, armed_offline) == "REFUSED_OFFLINE_ENVIRONMENT"


@pytest.fixture(scope="module")
def built():
    replica = Replica.build()
    try:
        yield replica
    finally:
        replica.close()


@needs_prefix
@needs_reports
def test_preparing_the_plan_starts_no_process_and_both_engines_get_identical_atoms(
    built, monkeypatch
):
    def forbidden(*args, **kwargs):
        raise AssertionError("preparation must not start any process")

    monkeypatch.setattr(subprocess, "Popen", forbidden)
    first = cc.plan(built)
    second = cc.plan(built)
    assert first["plan_sha256"] == second["plan_sha256"]  # the approval binds a stable plan
    assert [c["case"] for c in first["plan"]["cases"]] == [
        "A-h2-hf-sto3g",
        "B-h2o-hf-sto3g",
        "C-ethanol-hf-sto3g",
    ]
    for entry in first["plan"]["cases"]:
        assert entry["atoms_identical_for_both_engines"] is True
        assert (entry["charge"], entry["multiplicity"]) == (0, 1)
        assert (entry["method"], entry["basis"]) == ("hf", "sto-3g")
        assert (
            entry["scf_policy"]["reference"] == "rhf"
            and entry["scf_policy"]["e_convergence"] == 1e-10
        )
        assert entry["pyscf_reference"]["energy_hartree"] < 0
        assert entry["pyscf_reference"]["producer"] == "pyscf 2.14.0"
    assert first["plan"]["engine"]["runtime_files_verified"] == 22885
    assert first["plan"]["tolerance_hartree"] == 1e-6


@needs_prefix
@needs_reports
def test_the_psi4_inputs_pass_the_adapters_own_validation_and_keep_the_stored_geometry(built):
    from chemdft_api.scientific.engines import psi4

    prepared = cc.plan(built)
    for case_id, document in prepared["documents"].items():
        psi4.validate_input(document)  # raises on any change of engine, settings or geometry
        entry = next(c for c in prepared["plan"]["cases"] if c["case"] == case_id)
        bohr = psi4.geometry(document["psi4_original_coordinates"])[1]
        assert len(bohr) == 3 * len(entry["atoms"])


@needs_prefix
@needs_reports
def test_execute_reports_agreement_and_discrepancy_from_the_adapters_results(
    built, monkeypatch, tmp_path
):
    from chemdft_api.scientific.engines import psi4
    from chemdft_api.scientific.engines.interfaces import ExecutionResult

    prepared = cc.plan(built)
    references = {
        c["case"]: c["pyscf_reference"]["energy_hartree"] for c in prepared["plan"]["cases"]
    }
    offsets = {"A-h2-hf-sto3g": 5e-7, "B-h2o-hf-sto3g": 2e-6, "C-ethanol-hf-sto3g": None}

    def fake(document, executable, settings, *, workdir, **_):
        case_id = Path(workdir).name
        if offsets[case_id] is None:
            return ExecutionResult(1, False, b"", b"", b"", None, {"validation-error.txt": b"x"})
        document = {
            "total_energy_hartree": references[case_id] + offsets[case_id],
            "scf_iterations": 7,
            "returned_geometry_sha256": "0" * 64,
        }
        return ExecutionResult(0, False, b"", b"", b"", document, {"output.json": b"{}"})

    monkeypatch.setattr(psi4, "execute_native", fake)
    report = cc.execute(prepared, tmp_path / "run")
    verdicts = {row["case"]: row["verdict"] for row in report["cases"]}
    assert verdicts == {
        "A-h2-hf-sto3g": "AGREES",
        "B-h2o-hf-sto3g": "DISCREPANCY",
        "C-ethanol-hf-sto3g": "NO_VALIDATED_RESULT",
    }
    assert report["all_agree"] is False and (tmp_path / "run" / "report.json").is_file()
    with pytest.raises(FileExistsError):  # a second run never overwrites evidence
        cc.execute(prepared, tmp_path / "run")
