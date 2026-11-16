"""Export the real stored water calculation record the homepage shows (Act II and Act V).

One-time, read-only export from a ChemDFT development database that holds a genuine PySCF run: restricted
Hartree-Fock / STO-3G on the repository's water geometry, task ORBITAL, produced by the local PySCF worker and stored
through the Scientific Result Firewall. Nothing is computed or edited here; project, structure and artifact ids are
deliberately not exported (only content hashes and values), and the output is committed so the page never reads a
database.

    uv run --project services/api python tools/homepage_reference_run_record.py [path/to/chemdft.db]
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".chemdft/chemdft.db"
OUT = ROOT / "apps/web/src/app/_components/home/reference/water-run-record.json"
RESULT_ID = "0746b1d9-eadb-4028-95dc-8bf8c87a5990"  # chemdft.molecular-orbitals result, HF/STO-3G water


def main() -> None:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    result = con.execute(
        "select calculation_id, payload_json, producer_software_json, authority, source_class, verification_state, validation_state, created_at "
        "from calculation_results where id = ?",
        (RESULT_ID,),
    ).fetchone()
    assert result is not None, "result not found"
    calculation_id, payload_json, software_json, authority, source_class, verification, validation, stored_at = result
    payload = json.loads(payload_json)
    software = json.loads(software_json)
    inputs = con.execute(
        "select specification_json from calculation_inputs where calculation_id = ?", (calculation_id,)
    ).fetchone()
    spec = json.loads(inputs[0])
    attempt = con.execute(
        "select attempt_number, state, started_at, finished_at from calculation_attempts where calculation_id = ?",
        (calculation_id,),
    ).fetchone()
    assert payload["engine"] == "pyscf" and payload["method"] == "hf" and payload["basis"] == "sto-3g"
    frontier = payload["frontier_by_spin"][0]
    record = {
        "title": "Water · restricted Hartree–Fock / STO-3G",
        "task": payload["task_type"],
        "note": "A real stored ChemDFT calculation on the repository's water test geometry, exported once from a development database. Hashes and values only; identifiers are not exported.",
        "structure": {"input_structure_sha256": payload["input_structure_hash"], "formula": "H2O", "charge": payload["charge"], "multiplicity": payload["multiplicity"]},
        "method": {"method": spec["method"]["display_name"], "basis": spec["basis"]["display_name"], "scf_convergence_threshold": spec["scf"]["convergence_threshold"], "scf_max_iterations": spec["scf"]["max_iterations"]},
        "engine": {
            "name": "PySCF",
            "version": software["version"],
            "backend": software["execution_backend"],
            "hardware_class": software["hardware_class"],
            "library_versions": {v["key"]: v["value"] for lib in software["library_versions"] for v in lib["values"]},
            "environment_sha256": software["environment_digest"],
            "adapter_version": software["adapter_version"],
        },
        "attempt": {"number": attempt[0], "state": attempt[1], "started_utc": attempt[2], "finished_utc": attempt[3]},
        "result": {
            "converged": payload["converged"],
            "scf_iterations": payload["scf_iterations"],
            "total_energy_hartree": payload["total_energy_hartree"],
            "electron_count": payload["electron_count"],
            "alpha_electrons": payload["alpha_electron_count"],
            "beta_electrons": payload["beta_electron_count"],
            "basis_functions": payload["basis_function_count"],
            "molecular_orbitals": payload["molecular_orbital_count"],
            "homo": {"index": frontier["homo_index"] + 1, "energy_hartree": frontier["homo_energy_hartree"], "energy_ev": frontier["homo_energy_ev"]},
            "lumo": {"index": frontier["lumo_index"] + 1, "energy_hartree": frontier["lumo_energy_hartree"], "energy_ev": frontier["lumo_energy_ev"]},
            "gap_hartree": frontier["gap_hartree"],
            "gap_ev": frontier["gap_ev"],
            "gap_note": payload["orbital_gap_note"],
        },
        "provenance": {
            "authority": authority,
            "source_class": source_class,
            "verification_state": verification,
            "validation_state": validation,
            "stored_utc": stored_at,
            "calculation_input_sha256": payload["calculation_input_hash"],
            "result_sha256": payload["result_sha256"],
            "coefficient_artifact_sha256": payload["coefficient_artifact_sha256"],
            "producer": payload["producer"],
        },
    }
    OUT.write_text(json.dumps(record, indent=1) + "\n")
    print(json.dumps(record["result"], indent=1))


if __name__ == "__main__":
    main()
