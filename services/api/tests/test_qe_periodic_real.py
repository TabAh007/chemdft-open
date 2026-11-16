"""OPT-IN real Quantum ESPRESSO 7.6 acceptance tests for the alpha-Cr2O3 AFM PBE+U (U = 3.7 eV) reference.

NOT RUN on the Mac (no QE there): skipped unless pw.x, projwfc.x, dos.x, bands.x and mpirun are installed and
CHEMDFT_QE_PSEUDO_DIR points at the extracted SSSP PBE Efficiency v2.0 library. The expected numbers are the ones the owner
measured on AWS (QE 7.6, 2 vCPU / 8 GB); a failure here means the engine, the image or the writer drifted.

    CHEMDFT_QE_BIN_DIR=/opt/qe/bin CHEMDFT_QE_PSEUDO_DIR=/opt/sssp/library CHEMDFT_RUN_QE=1 \
        pytest services/api/tests/test_qe_periodic_real.py -m qe_integration -s
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest
from test_qe_periodic import cr2o3_document

from chemdft_api.scientific.qe_periodic import qe_periodic_worker as worker

BIN = os.environ.get("CHEMDFT_QE_BIN_DIR") or (str(Path(shutil.which("pw.x")).parent) if shutil.which("pw.x") else "")
PSEUDO = os.environ.get("CHEMDFT_QE_PSEUDO_DIR", "")
READY = bool(BIN) and all((Path(BIN) / n).is_file() for n in ("pw.x", "projwfc.x", "dos.x", "bands.x")) and Path(PSEUDO).is_dir()
pytestmark = [
    pytest.mark.qe_integration,
    pytest.mark.skipif(not READY or os.environ.get("CHEMDFT_RUN_QE") != "1", reason="real Quantum ESPRESSO is not installed or CHEMDFT_RUN_QE is not 1"),
]

# The path that was verified on AWS (reciprocal-basis coordinates of the primitive cell, 12 points per segment).
VERIFIED_PATH = {
    "labels": ["Γ", "Z", "F", "Γ", "L"],
    "points": [[0, 0, 0], [0.5, 0.5, 0.5], [0.5, 0.5, 0], [0, 0, 0], [0.5, 0, 0]],
    "weights": [12, 12, 12, 12, 1],
    "source": "verified Gamma-Z-F-Gamma-L path (owner AWS run)",
}


def run(tmp_path, monkeypatch, document):
    monkeypatch.setenv("CHEMDFT_QE_BIN_DIR", BIN)
    monkeypatch.setenv("CHEMDFT_QE_PSEUDO_DIR", PSEUDO)
    monkeypatch.setenv("CHEMDFT_QE_SCRATCH", str(tmp_path / "scratch"))
    (tmp_path / "input.json").write_text(json.dumps(document))
    code = worker.run(tmp_path / "input.json", tmp_path / "result.json", tmp_path / "engine.log")
    result = json.loads((tmp_path / "result.json").read_text())
    print(json.dumps({k: result.get(k) for k in ("band_gap_ev", "total_energy_hartree", "scf_iterations", "irreducible_k_points", "runtime_seconds")}))
    assert code == 0, result.get("failure_reason")
    return result


def test_gamma_gap_and_lowdin_moment(tmp_path, monkeypatch):
    result = run(tmp_path, monkeypatch, cr2o3_document(k_mesh=[1, 1, 1]))
    assert result["band_gap_ev"] == pytest.approx(3.680, abs=0.03)
    moments = list(result["local_magnetic_moments"].values())
    assert sorted(abs(m) for m in moments) == pytest.approx([3.0607] * 4, abs=0.03)  # Gamma mesh; 2.997 belongs to the 3x3x3 mesh
    assert sum(moments) == pytest.approx(0.0, abs=0.05)
    assert result["total_magnetization"] == pytest.approx(0.0, abs=0.05)


def test_3x3x3_gap_and_energy(tmp_path, monkeypatch):
    result = run(tmp_path, monkeypatch, cr2o3_document(k_mesh=[3, 3, 3]))
    assert result["band_gap_ev"] == pytest.approx(3.247, abs=0.03)
    assert result["total_energy_hartree"] == pytest.approx(-475.9995944, abs=2e-4)
    moments = list(result["local_magnetic_moments"].values())
    assert sorted(abs(m) for m in moments) == pytest.approx([2.997] * 4, abs=0.03)  # Lowdin, 3x3x3 mesh
    assert result["total_magnetization"] == pytest.approx(0.0, abs=0.05)
    assert result["irreducible_k_points"] == 6  # needs QE's symmetry detection to find the full R-3c group for this cell


def test_relaxation_returns_to_the_experimental_neighbourhood(tmp_path, monkeypatch):
    document = cr2o3_document(k_mesh=[2, 2, 2], relax=True)
    for atom, z in zip(document["atoms"][:4], (0.85249, 0.35249, 0.14751, 0.64751), strict=True):
        atom["fractional"] = [z, z, z]
    result = run(tmp_path, monkeypatch, document)
    final = result["relaxation"]["final_positions"]
    assert result["relaxation"]["converged"] is True
    assert final[0]["fractional"][2] == pytest.approx(0.84796, abs=0.001)


def test_dos_and_band_path_gap(tmp_path, monkeypatch):
    result = run(tmp_path, monkeypatch, cr2o3_document(k_mesh=[3, 3, 3], dos=True, dos_k_mesh=[6, 6, 6], bands=True, band_path=VERIFIED_PATH))
    assert result["dos"]["gap_from_eigenvalues_ev"] == pytest.approx(3.234, abs=0.03)
    assert result["bands"]["gap_along_path_ev"] == pytest.approx(3.231, abs=0.03)
