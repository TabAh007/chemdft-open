"""Tests for Periodic DFT (Phase 1 / Release 0.0.41).

Covers:
1. Periodic contracts, options, and results.
2. Element coverage validator and scan test against PySCF GTH pseudo/basis.
3. Hosted AWS compute refusal rules (atom count, k-mesh).
4. Result Firewall refusal of non-converged periodic results.
5. Fast end-to-end MgO smoke test using the PySCF periodic worker.
6. Opt-in slow Cr2O3 PBE+U Gamma reference acceptance test.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

import pytest

from chemdft_api.aws_compute import (
    AWS_PERIODIC_ENERGY_TASK,
    AWS_PYSCF_PERIODIC_TASKS,
    aws_periodic_refusal,
)
from chemdft_api.config import Settings
from chemdft_api.calculation_actions import _validate_periodic_energy_candidate
from chemdft_api.contracts.bundle import ContractBundle
from chemdft_api.contracts.catalog import WorkloadReference
from chemdft_api.contracts.results import AuthoritativeScientificPayload, PeriodicEnergyResult
from chemdft_api.contracts.scientific import (
    BasisSetReference,
    CalculationSpecification,
    CalculationTaskType,
    EnginePreference,
    PeriodicOptions,
    ScientificMethodReference,
)
from chemdft_api.errors import UnsupportedCalculation
from chemdft_api.scientific.engines.registry import (
    PYSCF_PERIODIC_COVERED_ATOMIC_NUMBERS,
    validate_capability,
    validate_pyscf_periodic_elements,
)


# -----------------------------------------------------------------------------
# 1. Contracts & Models
# -----------------------------------------------------------------------------


def test_periodic_contracts_and_options() -> None:
    assert CalculationTaskType.PERIODIC_ENERGY == "PERIODIC_ENERGY"

    options = PeriodicOptions(
        k_mesh=[1, 1, 1],
        u_effective_ev={"Cr": 3.7},
        magnetic_order="antiferromagnetic",
    )
    assert options.k_mesh == (1, 1, 1)
    assert options.u_effective_ev == {"Cr": 3.7}
    assert options.magnetic_order == "antiferromagnetic"

    spec = CalculationSpecification(
        task_type=CalculationTaskType.PERIODIC_ENERGY,
        method=ScientificMethodReference(
            identifier="pbe+u",
            display_name="PBE+U",
            registry="chemdft.method",
        ),
        basis=BasisSetReference(
            identifier="gth-dzvp-molopt-sr",
            display_name="GTH-DZVP-MOLOPT-SR",
            registry="chemdft.basis",
        ),
        charge=0,
        multiplicity=1,
        engine_preference=EnginePreference(engine="pyscf"),
        periodic=options,
    )
    assert spec.periodic is not None
    assert spec.periodic.k_mesh == (1, 1, 1)

    # Verify bundle exposure
    assert "periodic_options" in ContractBundle.model_fields
    assert "periodic_energy_result" in ContractBundle.model_fields


def test_periodic_energy_candidate_validation() -> None:
    valid_candidate = {
        "schema": "chemdft.worker.periodic-energy",
        "task": "PERIODIC_ENERGY",
        "engine": "pyscf",
        "converged": True,
        "finite": True,
        "total_energy_hartree": -443.645349,
        "scf_iterations": 25,
        "band_gap_ev": 3.849,
        "k_mesh": [1, 1, 1],
        "magnetic_order": "antiferromagnetic",
        "u_effective_ev": {"Cr": 3.7},
        "local_magnetic_moments": {"0": -3.11, "1": 3.11},
        "total_magnetization": 0.0,
        "runtime_seconds": 120.5,
    }
    result = _validate_periodic_energy_candidate(valid_candidate)
    assert result.converged is True
    assert result.total_energy.value == -443.645349
    assert result.total_energy.unit.code == "Eh"
    assert result.band_gap is not None
    assert result.band_gap.value == 3.849
    assert result.band_gap.unit.code == "eV"
    assert result.k_mesh == (1, 1, 1)
    assert result.local_magnetic_moments["0"] == -3.11

    # Nonconverged must raise ValueError
    non_converged = dict(valid_candidate, converged=False)
    with pytest.raises(ValueError, match="Nonconverged or non-finite"):
        _validate_periodic_energy_candidate(non_converged)

    # Non-finite must raise ValueError
    non_finite = dict(valid_candidate, finite=False)
    with pytest.raises(ValueError, match="Nonconverged or non-finite"):
        _validate_periodic_energy_candidate(non_finite)

    # Wrong task or schema
    wrong_task = dict(valid_candidate, task="ENERGY")
    with pytest.raises(ValueError, match="Worker result type does not match"):
        _validate_periodic_energy_candidate(wrong_task)


# -----------------------------------------------------------------------------
# 2. Element Coverage & PySCF Library Scan
# -----------------------------------------------------------------------------


def test_periodic_element_coverage_validation() -> None:
    # Covered elements: H..Ba (1..56), Hf..Rn (72..86)
    validate_pyscf_periodic_elements(["Mg", "O"])
    validate_pyscf_periodic_elements(["Cr", "O"])
    validate_pyscf_periodic_elements(["Fe", "S"])
    validate_pyscf_periodic_elements(["Au", "Pt"])

    # Lanthanides and Actinides are not covered by gth-dzvp-molopt-sr
    with pytest.raises(UnsupportedCalculation, match="not supported"):
        validate_pyscf_periodic_elements(["La", "O"])

    with pytest.raises(UnsupportedCalculation, match="not supported"):
        validate_pyscf_periodic_elements(["U", "O"])

    with pytest.raises(UnsupportedCalculation, match="not supported"):
        validate_pyscf_periodic_elements(["Ce"])


def _resolve_worker_python(settings: Settings) -> Path:
    worker = settings.scientific_worker_python
    if worker.is_absolute() and worker.exists():
        return worker
    repo_root = Path(__file__).resolve().parents[3]
    candidate = repo_root / worker
    if candidate.exists():
        return candidate
    fallback = Path("<local-path>/Desktop/chemdft/services/scientific-worker/.venv/bin/python")
    if fallback.exists():
        return fallback
    return worker


def test_periodic_element_table_scan_against_pyscf() -> None:
    """Verifies that all elements declared covered in registry actually exist in PySCF basis/pseudo."""
    settings = Settings()
    worker_python = _resolve_worker_python(settings)
    if not worker_python.exists():
        pytest.skip(f"Worker python not found at {worker_python}")

    covered_z = sorted(PYSCF_PERIODIC_COVERED_ATOMIC_NUMBERS)
    code = (
        "import json\n"
        "from pyscf.pbc import gto\n"
        "from pyscf.data import elements as e\n"
        "basis = 'gth-dzvp-molopt-sr'\n"
        "pseudo = 'gth-pbe'\n"
        "missing_basis = []\n"
        "missing_pseudo = []\n"
        f"for z in {covered_z}:\n"
        "    sym = e.ELEMENTS[z]\n"
        "    try:\n"
        "        gto.load(basis, sym)\n"
        "    except Exception:\n"
        "        missing_basis.append(sym)\n"
        "    try:\n"
        "        gto.pseudo.load(pseudo, sym)\n"
        "    except Exception:\n"
        "        missing_pseudo.append(sym)\n"
        "assert not missing_basis, f'Missing basis: {missing_basis}'\n"
        "assert not missing_pseudo, f'Missing pseudo: {missing_pseudo}'\n"
        "print('OK')\n"
    )
    proc = subprocess.run(
        [str(worker_python), "-B", "-c", code],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
        env={"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1"},
    )
    assert proc.returncode == 0, f"PySCF element scan failed:\n{proc.stderr}\n{proc.stdout}"
    assert "OK" in proc.stdout


# -----------------------------------------------------------------------------
# 3. Hosted AWS Refusal Rules
# -----------------------------------------------------------------------------


def test_aws_periodic_refusal_rules() -> None:
    settings = Settings(
        aws_periodic_max_atoms=20,
        aws_periodic_allowed_kmeshes="1x1x1",
    )
    # Valid configurations
    assert aws_periodic_refusal(settings, atom_count=10, k_mesh=[1, 1, 1]) is None
    assert aws_periodic_refusal(settings, atom_count=20, k_mesh=[1, 1, 1]) is None
    assert Settings().aws_periodic_allowed_kmeshes == "1x1x1"
    assert Settings().aws_periodic_timeout_seconds == 3600

    # Oversized cell
    refusal = aws_periodic_refusal(settings, atom_count=21, k_mesh=[1, 1, 1])
    assert refusal is not None
    assert "Hosted periodic DFT is limited to 20 atoms in the unit cell" in refusal

    # Disallowed k-mesh
    refusal = aws_periodic_refusal(settings, atom_count=10, k_mesh=[3, 3, 3])
    assert refusal is not None
    assert "not offered for PySCF periodic jobs on the hosted beta" in refusal
    refusal = aws_periodic_refusal(settings, atom_count=10, k_mesh=[2, 2, 2])
    assert refusal is not None
    assert "Bigger k-point meshes are available with the Quantum ESPRESSO engine" in refusal


# -----------------------------------------------------------------------------
# 4. Result Firewall Refusal of Non-converged Results
# -----------------------------------------------------------------------------


def test_periodic_result_contract_enforces_converged() -> None:
    from pydantic import ValidationError
    from chemdft_api.contracts.scientific import QuantityDimension, ScientificQuantity, UnitReference, UnitStandard

    with pytest.raises(ValidationError):
        PeriodicEnergyResult(
            total_energy=ScientificQuantity(
                value=-79.038,
                unit=UnitReference(
                    standard=UnitStandard.QCSCHEMA,
                    code="Eh",
                    dimension=QuantityDimension.ENERGY,
                ),
            ),
            converged=False,  # Contract strictly requires converged=True
        )


# -----------------------------------------------------------------------------
# 5. Real PySCF End-to-End Smoke Test (2-atom MgO)
# -----------------------------------------------------------------------------


@pytest.mark.scientific_integration
def test_periodic_worker_mgo_smoke_e2e(tmp_path: Path) -> None:
    settings = Settings()
    worker_python = _resolve_worker_python(settings)
    if not worker_python.exists():
        pytest.skip(f"Worker python not found at {worker_python}")

    worker_script = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "chemdft_api"
        / "scientific"
        / "engines"
        / "pyscf_periodic_worker.py"
    )
    assert worker_script.exists()

    input_file = tmp_path / "mgo_input.json"
    output_file = tmp_path / "mgo_output.json"
    log_file = tmp_path / "mgo_log.log"

    # FCC primitive cell for rock-salt MgO (2 atoms, a_fcc ~ 4.213 Angstrom)
    # Primitive vectors:
    # a1 = [0, a/2, a/2], a2 = [a/2, 0, a/2], a3 = [a/2, a/2, 0]
    a = 4.213
    half = a / 2.0
    lattice_vectors = [
        [0.0, half, half],
        [half, 0.0, half],
        [half, half, 0.0],
    ]
    # Atoms in Cartesian Angstrom: Mg at [0,0,0], O at [half, half, half] / 2
    atoms = [
        ["Mg", [0.0, 0.0, 0.0]],
        ["O", [half * 0.5, half * 0.5, half * 0.5]],
    ]

    task_document = {
        "engine": "pyscf",
        "task": "PERIODIC_ENERGY",
        "method": "pbe",
        "basis": "gth-dzvp-molopt-sr",
        "charge": 0,
        "multiplicity": 1,
        "periodic_cell": {
            "lattice_vectors_angstrom": lattice_vectors,
            "periodic_boundary_conditions": [True, True, True],
        },
        "atoms": atoms,
        "periodic": {
            "k_mesh": [1, 1, 1],
            "magnetic_order": "none",
            "u_effective_ev": {},
        },
    }

    input_file.write_text(json.dumps(task_document), encoding="utf-8")

    env = os.environ.copy()
    env["TMPDIR"] = str(tmp_path)
    env["PYSCF_TMPDIR"] = str(tmp_path)
    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")

    proc = subprocess.run(
        [
            str(worker_python),
            str(worker_script),
            "--input",
            str(input_file),
            "--result",
            str(output_file),
            "--log",
            str(log_file),
        ],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    assert proc.returncode == 0, f"Worker failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
    assert output_file.exists()

    result = json.loads(output_file.read_text(encoding="utf-8"))
    assert result.get("converged") is True
    assert result.get("total_energy_hartree") < -70.0
    assert result.get("band_gap_ev") > 5.0
    assert result.get("scf_iterations") is not None and result.get("scf_iterations") < 80

    # Candidate validation check
    validated_res = _validate_periodic_energy_candidate(result)
    assert validated_res.converged is True
    assert validated_res.total_energy.value < -70.0
    assert validated_res.band_gap is not None
    assert validated_res.band_gap.value > 5.0


# -----------------------------------------------------------------------------
# 6. Opt-In Slow Acceptance Test (Cr2O3 PBE+U Gamma)
# -----------------------------------------------------------------------------


@pytest.mark.scientific_integration
@pytest.mark.skipif(
    os.environ.get("CHEMDFT_RUN_SLOW_PERIODIC") != "1",
    reason="Opt-in slow periodic test. Set CHEMDFT_RUN_SLOW_PERIODIC=1 to run (~14 min).",
)
def test_cr2o3_pbe_plus_u_gamma_acceptance(tmp_path: Path) -> None:
    """Verifies that PySCF periodic worker reproduces user-validated Cr2O3 Gamma PBE+U reference values:

    Reference:
      - Band gap: 3.849 eV (assert within 0.02 eV)
      - Cr local spin populations (Mulliken-type): +/- 3.11 (assert within 0.02)

    Prints and (when CHEMDFT_EVIDENCE_DIR is set) writes the actual values; see the report lines below.
    """
    import numpy as np

    settings = Settings()
    worker_python = _resolve_worker_python(settings)
    if not worker_python.exists():
        pytest.skip(f"Worker python not found at {worker_python}")

    worker_script = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "chemdft_api"
        / "scientific"
        / "engines"
        / "pyscf_periodic_worker.py"
    )

    # Alpha-Cr2O3 primitive cell (COD 9014036, Sawada 1994)
    cif_paths = [
        Path(__file__).resolve().parents[3] / "user-tests/aliyeva-cr2o3/dft-feasibility/periodic_reference_for_B1/Cr2O3_rhomb_thiswork.cif",
        Path("<local-path>/Desktop/chemdft/user-tests/aliyeva-cr2o3/dft-feasibility/periodic_reference_for_B1/Cr2O3_rhomb_thiswork.cif"),
    ]
    cif_file = next((p for p in cif_paths if p.exists()), None)
    if cif_file:
        from chemdft_api.scientific.adapters.periodic.pymatgen_adapter import parse_cif
        cand = parse_cif(cif_file.read_bytes())
        lattice_matrix = np.array(cand.periodic_cell["lattice_vectors"], dtype=float)
        atoms = []
        for a in cand.atoms:
            frac = np.array([a["x"], a["y"], a["z"]], dtype=float)
            cart = frac @ lattice_matrix
            atoms.append([a["element"], [float(c) for c in cart]])
    else:
        lattice_matrix = np.array([
            [4.395739343458032, 0.0, 3.0661633955286924],
            [1.5996495291571524, 4.0943431413954725, 3.0661633955286924],
            [0.0, 0.0, 5.35946661],
        ], dtype=float)
        sites = [
            ("Cr", [0.84749, 0.84749, 0.84749]),
            ("Cr", [0.34749, 0.34749, 0.34749]),
            ("Cr", [0.15251, 0.15251, 0.15251]),
            ("Cr", [0.65251, 0.65251, 0.65251]),
            ("O", [0.44430, 0.05570, 0.75000]),
            ("O", [0.05570, 0.75000, 0.44430]),
            ("O", [0.55570, 0.94430, 0.25000]),
            ("O", [0.25000, 0.55570, 0.94430]),
            ("O", [0.94430, 0.25000, 0.55570]),
            ("O", [0.75000, 0.44430, 0.05570]),
        ]
        atoms = [[sym, [float(c) for c in np.array(frac) @ lattice_matrix]] for sym, frac in sites]

    task_document = {
        "engine": "pyscf",
        "task": "PERIODIC_ENERGY",
        "method": "pbe+u",
        "basis": "gth-dzvp-molopt-sr",
        "charge": 0,
        "multiplicity": 1,
        "periodic_cell": {
            "lattice_vectors_angstrom": lattice_matrix.tolist(),
            "periodic_boundary_conditions": [True, True, True],
        },
        "atoms": atoms,
        "periodic": {
            "k_mesh": [1, 1, 1],
            "magnetic_order": "antiferromagnetic",
            "u_effective_ev": {"Cr": 3.7},
        },
    }

    input_file = tmp_path / "cr2o3_input.json"
    output_file = tmp_path / "cr2o3_output.json"
    log_file = tmp_path / "cr2o3_log.log"
    input_file.write_text(json.dumps(task_document), encoding="utf-8")

    env = os.environ.copy()
    env["TMPDIR"] = str(tmp_path)
    env["PYSCF_TMPDIR"] = str(tmp_path)
    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")

    proc = subprocess.run(
        [
            str(worker_python),
            str(worker_script),
            "--input",
            str(input_file),
            "--result",
            str(output_file),
            "--log",
            str(log_file),
        ],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    assert proc.returncode == 0, f"Worker failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"

    result = json.loads(output_file.read_text(encoding="utf-8"))
    assert result.get("converged") is True

    gap = result.get("band_gap_ev")
    moments = result.get("local_magnetic_moments", {})
    cr_populations = {k: m for k, m in moments.items() if int(k) in (0, 1, 2, 3)}
    pyscf_version = result.get("engine_version")
    report_lines = [
        "Cr2O3 PBE+U Gamma acceptance (opt-in)",
        f"band gap (Kohn-Sham, eV): {gap}",
        f"local spin populations (Mulliken-type, Cr atoms 0-3): {cr_populations}",
        f"total energy (Ha): {result.get('total_energy_hartree')}",
        f"SCF cycles: {result.get('scf_iterations')}",
        f"PySCF version: {pyscf_version}",
        f"runtime (s): {result.get('runtime_seconds')}",
        "expected values come from PySCF 2.15; the hosted image pins PySCF 2.14.0"
        + ("" if pyscf_version == "2.14.0" else f" - NOTE: installed version is {pyscf_version}, not 2.14.0"),
    ]
    report = "\n".join(report_lines)
    print("\n" + report)
    report_dir = os.environ.get("CHEMDFT_EVIDENCE_DIR")
    if report_dir:
        Path(report_dir).mkdir(parents=True, exist_ok=True)
        (Path(report_dir) / "cr2o3_acceptance_report.txt").write_text(report + "\n", encoding="utf-8")
        (Path(report_dir) / "cr2o3_acceptance_result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    # Assert within 0.02 eV of 3.849 eV
    assert abs(gap - 3.849) <= 0.02, f"Expected gap near 3.849 eV, got {gap} eV"

    # Assert Cr local spin populations within 0.02 of 3.11
    for m in (abs(v) for v in cr_populations.values()):
        assert abs(m - 3.11) <= 0.02, f"Expected Cr local spin population near 3.11, got {m}"
