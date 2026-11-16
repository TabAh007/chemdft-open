"""Shared helpers for External Import tests.

* Real Gaussian / ORCA outputs are third-party files and are NOT committed. They live in `.chemdft/external-fixtures/`
  (fetched by `tools/fetch_external_import_fixtures.py`, pinned commit + SHA-256). Tests that need them are skipped when absent.
* The synthetic builders below are ChemDFT-authored text that mimics only the MARKERS the gate reads (banners, termination and
  convergence lines). They exercise logic, never scientific values.
"""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
WORKER_SRC = REPO / "services/import-worker/src"
WORKER_PYTHON = REPO / "services/import-worker/.venv/bin/python"
FIXTURE_DIR = Path(os.environ.get("CHEMDFT_EXTERNAL_FIXTURES_DIR", REPO / ".chemdft/external-fixtures"))

if str(WORKER_SRC) not in sys.path:
    sys.path.insert(0, str(WORKER_SRC))  # pure-python worker modules are importable without cclib

MANIFEST = Path(__file__).with_name("external_import_fixtures_manifest.json")

requires_corpus = pytest.mark.skipif(
    (not any(FIXTURE_DIR.glob("*/*.log")) and not any(FIXTURE_DIR.glob("*/*.out"))) or not WORKER_PYTHON.is_file(),
    reason="external Gaussian/ORCA fixtures or the import-worker environment are not available "
    "(run tools/fetch_external_import_fixtures.py and `uv sync --project services/import-worker`)",
)
requires_worker = pytest.mark.skipif(not WORKER_PYTHON.is_file(), reason="import-worker environment is not installed")


def expected() -> dict:
    return json.loads(MANIFEST.read_text())["fixtures"]


def fixture_path(fixture_id: str) -> Path:
    name = expected()[fixture_id]["upstream_url"].rsplit("/", 1)[-1]
    path = FIXTURE_DIR / fixture_id / name
    if not path.is_file():
        pytest.skip(f"fixture {fixture_id} is not present (run tools/fetch_external_import_fixtures.py)")
    return path


def fixture_bytes(fixture_id: str) -> bytes:
    return fixture_path(fixture_id).read_bytes()


# ---------------------------------------------------------------------------------------------- synthetic marker text
def gaussian_job(*, route: str = "#p B3LYP/6-31G(d) Freq", steps: int = 1, normal: bool = True, scf: str = "converged", opt: str | None = None) -> str:
    lines = [
        " Initial command:",
        " /opt/g16/l1.exe",
        " Entering Link 1 = /opt/g16/l1.exe PID=     1.",
        " Gaussian 16:  ES64L-G16RevC.01  3-Jul-2019",
        " ----------------------------------------------------------------------",
        f" {route}",
        " ----------------------------------------------------------------------",
        " Charge =  0 Multiplicity = 1",
        " NAtoms=      3",
    ]
    if scf == "converged":
        lines.append(" SCF Done:  E(RB3LYP) =  -76.4000000000     A.U. after   10 cycles")
    elif scf == "failed":
        lines.append(" SCF Done:  E(RB3LYP) =  -76.4000000000     A.U. after   10 cycles")
        lines.append(" Convergence failure -- run terminated.")
    if opt == "converged":
        lines += [" Optimization completed.", "    -- Stationary point found."]
    elif opt == "steps-exceeded":
        lines += ["    -- Number of steps exceeded,  NStep=   2", " Error termination request processed by link 9999."]
    for step in range(2, steps + 1):
        lines += [" Normal termination of Gaussian 16 at Mon Jan  1 00:00:00 2026.", f" Link1:  Proceeding to internal job step number  {step}."]
    if normal:
        lines.append(" Normal termination of Gaussian 16 at Mon Jan  1 00:00:01 2026.")
    return "\n".join(lines) + "\n"


def gaussian_banner_version(version: str) -> str:
    return gaussian_job().replace("Gaussian 16:  ES64L-G16RevC.01", f"Gaussian {version}:  ES64L-G{version}RevD.01")


def orca_job(*, version: str = "6.1.0", bang: str = "! B3LYP def2-SVP", normal: bool = True, scf: str = "converged", opt: str | None = None) -> str:
    lines = [
        "                                 *****************",
        "                                 * O   R   C   A *",
        "                                 *****************",
        f"                         Program Version {version}  -  RELEASE   -",
        "INPUT FILE",
        f"|  1> {bang}",
        "|  2> * xyz 0 1",
        "|  3> *",
        "Total Charge           Charge          ....    0",
        "Multiplicity           Mult            ....    1",
        "Number of atoms                             ...      3",
    ]
    if scf == "converged":
        lines.append("               *           SCF CONVERGED AFTER   9 CYCLES          *")
    elif scf == "failed":
        lines += ["               *        SCF NOT CONVERGED AFTER   5 CYCLES         *", "ORCA finished by error termination in SCF"]
    if opt == "converged":
        lines.append("*** THE OPTIMIZATION HAS CONVERGED ***")
    elif opt == "not-converged":
        lines += ["                                   ERROR !!!", "       The optimization did not converge but reached the maximum"]
    if normal and scf != "failed":
        lines.append("                             ****ORCA TERMINATED NORMALLY****")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------------------------- synthetic preview reports
def synthetic_report(data: bytes, *, status: str = "READY", raman: bool = False, thermo: bool = True, extra_diagnostics: list[dict] | None = None) -> dict:
    """A contract-valid preview whose numbers are made up. Used ONLY to test API plumbing (hash binding, authority, atomicity)."""
    import hashlib

    from chemdft_import_worker import NORMALIZATION_VERSION
    from chemdft_import_worker.report import finalize, new_body

    source = {"sha256": hashlib.sha256(data).hexdigest(), "size_bytes": len(data), "line_count": data.count(b"\n"), "encoding": "utf-8", "replaced_bytes": 0}
    body = new_body(source)
    body["program"] = {"engine": "Gaussian", "version": "16", "label": "Gaussian 16 Rev C.01"}
    base_job = {
        "job_count": 1, "index": 0, "line_range": [1, max(1, source["line_count"])], "internal_steps": 1, "job_type": "freq",
        "job_type_evidence": ["#p B3LYP/6-31G(d) Freq"],
        "method": {"value": "B3LYP", "status": "ESTABLISHED", "evidence": ["route"]}, "basis": {"value": "6-31G(d)", "status": "ESTABLISHED", "evidence": ["route"]},
        "charge": 0, "multiplicity": 1, "reference": "restricted", "n_atoms": 3, "orientation": "standard orientation", "solvent_model": None,
        "termination": {"status": "COMPLETED", "evidence": "1 'Normal termination' for 1 internal job step(s)"},
        "convergence": {"scf": {"status": "CONVERGED", "evidence": "1 'SCF Done' record(s)"}, "optimization": {"requested": False, "status": "NOT_REQUESTED", "evidence": ""}},
    }
    body["job"] = base_job
    if status != "READY":
        body["status"] = "REJECTED"
        body["diagnostics"] = [{"code": "INCOMPLETE_OUTPUT", "severity": "reject", "message": "synthetic rejection", "line": None}]
        body["items"] = [{"id": "reject-INCOMPLETE_OUTPUT", "state": "REJECTED", "title": "Incomplete output", "detail": "synthetic rejection", "result_type": None}]
        body["job"]["termination"] = {"status": "INCOMPLETE", "evidence": "no termination"}
        return finalize(body)
    atoms = [
        {"index": 0, "element": "O", "atomic_number": 8, "x": 0.0, "y": 0.0, "z": 0.1173},
        {"index": 1, "element": "H", "atomic_number": 1, "x": 0.0, "y": 0.7572, "z": -0.4692},
        {"index": 2, "element": "H", "atomic_number": 1, "x": 0.0, "y": -0.7572, "z": -0.4692},
    ]
    header = lambda kind, attrs: {  # noqa: E731
        "payload_schema": f"chemdft.imported.{kind}", "payload_schema_version": "1.0.0", "source_class": "IMPORTED",
        "source": {"program": "Gaussian", "program_label": "Gaussian 16 Rev C.01"}, "normalization_version": NORMALIZATION_VERSION, "source_attributes": attrs,
    }
    raw_ev = -76.0 * 27.21138505
    results = [
        {"result_type": "chemdft.imported.structure", "source_attributes": ["atomnos", "atomcoords"], "source_locators": {"atomcoords": {"line_start": 10, "line_end": 20}},
         "payload": header("structure", ["atomnos", "atomcoords"]) | {"atoms": atoms, "coordinate_unit": "angstrom", "charge": 0, "multiplicity": 1, "geometry_role": "single-geometry",
                                                                        "frame": {"orientation": "standard orientation", "frame_index": 0, "frame_count": 1}, "optimized": False, "bonds": "not reported"}},
        {"result_type": "chemdft.imported.energy", "source_attributes": ["scfenergies"], "source_locators": {},
         "payload": header("energy", ["scfenergies"]) | {"energy_kind": "final SCF/DFT total energy", "scf_energy": {"value": raw_ev / 27.21138505, "unit": "Eh", "raw_value": raw_ev, "raw_unit": "eV", "conversion": "cclib.eV->Eh/1"},
                                                          "scf_energy_count": 1, "reference": "restricted", "method": "B3LYP / 6-31G(d)", "includes_dispersion_correction": None, "solvent_model": None, "excited_state_energies": "not part of this value"}},
        {"result_type": "chemdft.imported.vibrations", "source_attributes": ["vibfreqs", "vibdisps", "vibirs"] + (["vibramans"] if raman else []), "source_locators": {},
         "payload": header("vibrations", ["vibfreqs", "vibdisps", "vibirs"]) | {
             "mode_count": 3, "expected_mode_count": 3, "linear": False, "imaginary_mode_count": 0,
             "modes": [{"index": i, "frequency_cm1": f, "imaginary": False, "ir_intensity_km_mol": 10.0 + i, "raman_activity_a4_amu": (1.0 + i) if raman else None, "reduced_mass_amu": None,
                        "displacement": [[0.0, 0.0, 0.1 * (i + 1)], [0.0, 0.5, -0.2], [0.0, -0.5, -0.2]], "displacement_euclidean_norm": 1.0} for i, f in enumerate((1600.0, 3700.0, 3800.0))],
             "has_ir_intensities": True, "has_raman_activities": raman, "depolarization_ratios": "not reported by the source parser; never synthesized",
             "frequency_unit": "cm^-1", "ir_intensity_unit": "km/mol", "raman_activity_unit": "angstrom^4/amu", "frequency_sign": "preserved exactly as reported (negative = imaginary)",
             "displacement_convention": {"statement": "as reported; only the direction is meaningful", "euclidean_norm_min": 1.0, "euclidean_norm_max": 1.0, "frame": "standard orientation", "eckart_rotation_worst_relative": 0.0},
             "equilibrium_geometry": {"coordinate_unit": "angstrom", "atoms": atoms}, "zero_modes": "removed", "ordering": "as reported by the program"}},
    ]
    if thermo:
        quantity = lambda value, unit: {"value": value, "unit": unit, "raw_value": value, "raw_unit": unit, "conversion": "identity"}  # noqa: E731
        results.append(
            {"result_type": "chemdft.imported.thermochemistry", "source_attributes": ["zpve", "enthalpy", "freeenergy", "entropy", "temperature"], "source_locators": {},
             "payload": header("thermochemistry", ["zpve", "enthalpy", "freeenergy", "entropy", "temperature"]) | {
                 "reported_by": "Gaussian 16 Rev C.01", "temperature_k": 298.15, "pressure_atm": 1.0, "pressure_pa": 101325.0, "zero_point_energy_hartree": quantity(0.0212, "Eh"),
                 "enthalpy_hartree": quantity(-75.9757, "Eh"), "gibbs_free_energy_hartree": quantity(-75.9987, "Eh"), "entropy_hartree_per_k": quantity(7.2e-05, "Eh/K"),
                 "enthalpy_and_gibbs_include_electronic_energy": True, "electronic_energy_hartree": -76.0, "plausibility": {"h_minus_e0_hartree": 0.0243, "g_minus_e0_hartree": 0.0013},
                 "model": "as reported by the source program", "recomputed_by_chemdft": False, "temperature_pressure_preview": "not available for imported thermochemistry", "component_breakdown": "not reported by the parser"}}
        )
    body["results"] = results
    body["items"] = [{"id": "structure", "state": "DETECTED", "title": "Structure — 3 atoms", "detail": "synthetic", "result_type": "chemdft.imported.structure"}]
    body["diagnostics"] = list(extra_diagnostics or [])
    body["cclib"] = {"success_flag": True, "error_logs": [], "network_or_archive_attempts": 0}
    body["status"] = "READY"
    return finalize(body)


def fake_runner(report_factory):
    """A runner that returns `report_factory(raw_bytes)` instead of starting the worker."""
    from chemdft_api.external_import_runner import WorkerOutcome

    def runner(path, settings):
        return WorkerOutcome(report_factory(path.read_bytes()), {})

    return runner
