"""PF-8F: small cross-engine benchmark through the real application pipeline.

PySCF 2.14.0 (an independent code base) is run through submission, worker, Result Firewall and
publication, then compared with the accepted native Psi4 1.11 results committed as fixtures
(`fixtures/psi4`). Only like-with-like definitions are compared: RHF (identical), and B3LYP/PBE with
the same LibXC functional definitions. PySCF's default DFT grid is coarser than the sealed Psi4
(99,590) grid, so DFT agreement is grid-limited; tolerances below are derived from measured grid
sensitivity (PySCF grid level 3 vs 6 differs by ~2e-7 Eh for water) and recorded with the evidence.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from uuid import uuid4

import pytest
from chemdft_api.scientific.engines.normalization import BOHR_PER_ANGSTROM
from result_provenance_checks import assert_published_result_binding
from test_xtb_optimization import run_job

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = Path(__file__).parent / "fixtures/psi4"
PSI4 = ROOT / ".chemdft/envs/psi4-1.11-py312-gate-a1-20261009/bin/psi4"
pytestmark = [
    pytest.mark.scientific_integration,
    pytest.mark.skipif(
        os.environ.get("CHEMDFT_RUN_SCIENTIFIC_INTEGRATION") != "1",
        reason="requires the separately provisioned pinned PySCF worker",
    ),
]

# method, basis, tolerance (Eh), scientific justification
CASES = [
    ("hf", "sto-3g", 5e-7, "identical RHF definition; analytic integrals; SCF thresholds only"),
    ("hf", "def2-svp", 5e-7, "identical RHF definition; spherical def2-SVP in both codes"),
    ("b3lyp", "def2-svp", 1e-6, "LibXC B3LYP (VWN-RPA) in both codes; DFT grid-limited"),
    ("pbe", "def2-svp", 1e-6, "LibXC PBE in both codes; DFT grid-limited"),
]


def water_xyz():
    source = json.loads((FIXTURES / "hf-def2-svp-input.json").read_text())["molecule"]
    g = source["geometry"]
    lines = [
        s + " " + " ".join(format(v / BOHR_PER_ANGSTROM, ".17g") for v in g[3 * i : 3 * i + 3])
        for i, s in enumerate(source["symbols"])
    ]
    return (
        str(len(lines))
        + "\nPF-8F water (accepted Psi4 fixture geometry)\n"
        + "\n".join(lines)
        + "\n"
    ).encode()


def project_with(api, xyz, declaration=None):
    client = api[0]
    project = client.post(
        "/v1/projects", json={"name": "PF-8F benchmark", "slug": f"pf8f-{uuid4()}"}
    ).json()["id"]
    comment = "" if declaration is None else " | chemdft:" + declaration
    head, rest = xyz.split(b"\n", 1)
    title, body = rest.split(b"\n", 1)
    upload = head + b"\n" + title + comment.encode() + b"\n" + body
    imported = client.post(
        f"/v1/projects/{project}/structures/imports",
        files={"upload": ("input.xyz", upload, "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": str(uuid4())},
    )
    assert imported.status_code == 201, imported.text
    return project, imported.json()["version"]


def submit(api, project, version, engine, method, basis, charge=0, multiplicity=1, **extra):
    specification = {
        "task_type": "ENERGY",
        "method": {"identifier": method, "display_name": method, "registry": "chemdft.method"},
        "basis": None
        if basis is None
        else {"identifier": basis, "display_name": basis, "registry": "chemdft.basis"},
        "charge": charge,
        "multiplicity": multiplicity,
        "engine_preference": {
            "engine": engine,
            "allowed_version": {"pyscf": "2.14.0", "psi4": "1.11", "xtb": "6.7.1"}[engine],
        },
        **extra,
    }
    return api[0].post(
        f"/v1/projects/{project}/calculations",
        json={
            "structure_version": {
                "project_id": project,
                "entity_type": "structure.version",
                "entity_id": version["id"],
            },
            "specification": specification,
            "idempotency_key": str(uuid4()),
        },
    )


def audit_provenance(api, detail, version, engine):
    """Every retained artifact re-hashes from object storage and the immutable input is complete."""
    from chemdft_api.scientific.engines.psi4 import digest
    from chemdft_api.scientific_models import (
        CalculationInputRecord,
        CalculationResultRecord,
        ProvenanceRecordRow,
        ScientificArtifactRecord,
    )
    from chemdft_api.storage import LocalObjectStore

    settings = api[2]
    store = LocalObjectStore(settings.object_root)
    with api[1]() as session:
        result = session.get(CalculationResultRecord, str(detail.result.id))
        provenance = session.get(ProvenanceRecordRow, result.provenance_record_id)
        assert provenance.subject_id == result.id and provenance.source_class == "CALCULATED"
        assert result.source_class == "CALCULATED" and result.trusted_producer_type
        refs = list(detail.result.raw_artifacts) + list(detail.attempt.raw_artifacts)
        assert refs, "no retained native evidence"
        formats = set()
        for ref in refs:
            row = session.get(ScientificArtifactRecord, str(ref.artifact_id))
            assert row.project_id == result.project_id and row.sha256 == ref.sha256
            assert digest(store.get_bytes(row.storage_key, 64 * 1024 * 1024)) == ref.sha256
            formats.add(row.format_identifier)
        assert any(f.startswith(f"{engine}.") or f == "chemdft.calculation_input" for f in formats)
        inp = session.get(CalculationInputRecord, result.calculation_input_id)
        artifact = session.get(ScientificArtifactRecord, inp.normalized_input_artifact_id)
        raw = store.get_bytes(artifact.storage_key, 64 * 1024 * 1024)
        assert digest(raw) == detail.calculation_input_hash == artifact.sha256
        document = json.loads(raw)
        spec = inp.specification_json
        assert (
            document["charge"] == spec["charge"]
            and document["multiplicity"] == spec["multiplicity"]
        )
        assert document["method"] == spec["method"]["identifier"]
        assert document.get("basis") == (spec["basis"] or {}).get("identifier")
        assert [a["element"] for a in document["atoms"]] and inp.structure_version_id == version[
            "id"
        ]
        software = detail.result.producer_software
        assert software.name == engine and software.version and software.environment_digest
        assert len(software.environment_digest) == 64


def published(api, queued, version, engine=None):
    assert queued.status_code == 201, queued.text
    detail = run_job(api)
    assert detail.calculation.state == "SUCCEEDED", detail
    result = detail.result
    assert result.authority == "AUTHORITATIVE" and result.validation_state == "VALIDATED"
    assert result.verification_state == "UNVERIFIED"
    assert result.payload.converged is True and result.payload.total_energy.unit.code == "Eh"
    assert_published_result_binding(api[1], result.id, version["id"])
    audit_provenance(api, detail, version, engine or detail.result.producer_software.name)
    return detail


@pytest.mark.parametrize("method,basis,tolerance,why", CASES)
def test_pyscf_matches_accepted_psi4_fixture_for_water(api, method, basis, tolerance, why):
    project, version = project_with(api, water_xyz())
    detail = published(api, submit(api, project, version, "pyscf", method, basis), version)
    expected = json.loads((FIXTURES / f"{method}-{basis}-output.json").read_text())["return_result"]
    energy = detail.result.payload.total_energy.value
    difference = energy - expected
    assert abs(difference) < tolerance, (method, basis, why, difference)
    assert detail.result.producer_software.name == "pyscf"
    if target := os.environ.get("CHEMDFT_PF8F_EVIDENCE"):
        out = Path(target)
        out.mkdir(parents=True, exist_ok=True)
        (out / f"water-{method}-{basis}.json").write_text(
            json.dumps(
                {
                    "molecule": "water (accepted Psi4 fixture geometry)",
                    "method": method,
                    "basis": basis,
                    "pyscf_2_14_0_Eh": energy,
                    "psi4_1_11_accepted_Eh": expected,
                    "difference_Eh": difference,
                    "tolerance_Eh": tolerance,
                    "justification": why,
                },
                indent=2,
            )
            + "\n"
        )


def test_h2_hf_sto3g_psi4_and_pyscf_agree_and_match_accepted_reference(api):
    api[2].psi4_executable = PSI4
    xyz = b"2\nH2 0.74 angstrom\nH 0 0 -0.37\nH 0 0 0.37\n"
    energies = {}
    for engine in ("pyscf", "psi4"):
        project, version = project_with(api, xyz)
        extra = {"scf": {"reference": "rhf"}} if engine == "psi4" else {}
        queued = submit(api, project, version, engine, "hf", "sto-3g", **extra)
        energies[engine] = published(api, queued, version).result.payload.total_energy.value
    # Accepted PySCF value (test_pyscf_integration); textbook H2/STO-3G RHF is about -1.1168 Eh.
    assert energies["pyscf"] == pytest.approx(-1.1167593073964255, abs=1e-9)
    assert abs(energies["psi4"] - energies["pyscf"]) < 5e-7
    assert -1.1168 < energies["psi4"] < -1.1167


@pytest.mark.parametrize(
    "name,declaration,atoms,charge,multiplicity",
    [
        (
            "ammonium",
            "charge=+1;multiplicity=1",
            "N 0 0 0\nH 0.5946 0.5946 0.5946\nH -0.5946 -0.5946 0.5946\n"
            "H -0.5946 0.5946 -0.5946\nH 0.5946 -0.5946 -0.5946\n",
            1,
            1,
        ),
        ("oh", "charge=0;multiplicity=2", "O 0 0 0\nH 0 0 0.97\n", 0, 2),
    ],
)
def test_charged_and_open_shell_systems_pyscf_only_and_psi4_fails_closed(
    api, name, declaration, atoms, charge, multiplicity
):
    api[2].psi4_executable = PSI4
    count = len(atoms.strip().splitlines())
    xyz = f"{count}\n{name}\n{atoms}".encode()
    project, version = project_with(api, xyz, declaration)
    detail = published(
        api, submit(api, project, version, "pyscf", "hf", "sto-3g", charge, multiplicity), version
    )
    assert detail.result.payload.total_energy.value < 0
    # Psi4 is sealed to neutral closed-shell H/C/O: refused before any native execution.
    refused = submit(
        api,
        project,
        version,
        "psi4",
        "hf",
        "sto-3g",
        charge,
        multiplicity,
        scf={"reference": "rhf"},
    )
    assert refused.status_code == 422, refused.text
    # Wrong electronic state for the structure's authoritative declaration is also refused.
    wrong = submit(api, project, version, "pyscf", "hf", "sto-3g", 0, 1 if multiplicity != 1 else 2)
    assert wrong.status_code == 422, wrong.text


def test_native_d4_is_not_reachable_through_generic_engine_selection(api):
    project, version = project_with(api, water_xyz())
    dispersion = {"identifier": "d4", "display_name": "D4", "registry": "chemdft.dispersion"}
    for engine in ("pyscf", "psi4"):
        api[2].psi4_executable = PSI4
        extra = {"scf": {"reference": "rks"}} if engine == "psi4" else {}
        queued = submit(
            api, project, version, engine, "b3lyp", "def2-svp", dispersion=dispersion, **extra
        )
        assert queued.status_code == 422, (engine, queued.text)


def test_xtb_gfn2_water_publishes_with_full_provenance_and_is_not_comparable_to_dft(api):
    project, version = project_with(api, water_xyz())
    detail = published(api, submit(api, project, version, "xtb", "gfn2", None), version)
    energy = detail.result.payload.total_energy.value
    # GFN2-xTB is a semi-empirical total energy (a different, atomization-style reference
    # scale): it must never be compared with the ab initio energies above.
    assert -6.0 < energy < -4.0
    assert detail.result.producer_software.version == "6.7.1"


def _forge(monkeypatch, mutate):
    """Run the real engine, then hand the application a doctored candidate."""
    from dataclasses import replace

    from chemdft_api.compute_gateway import LocalComputeProvider

    real = LocalComputeProvider.execute

    def wrapper(self, **kwargs):
        result = real(self, **kwargs)
        document = dict(result.result_document or {})
        changes = mutate(document, result)
        return replace(result, result_document=document, **changes)

    monkeypatch.setattr(LocalComputeProvider, "execute", wrapper)


FORGERIES = {
    "nonfinite-energy": lambda d, r: d.update(total_energy_hartree=float("nan")) or {},
    "wrong-method": lambda d, r: d.update(method="pbe") or {},
    "wrong-basis": lambda d, r: d.update(basis="def2-svp") or {},
    "nonconverged-claimed-converged-false": lambda d, r: d.update(converged=False) or {},
    "success-document-with-failed-exit": lambda d, r: {"exit_code": 1},
    "claimed-other-engine": lambda d, r: d.update(engine="psi4") or {},
    "energy-changed-after-native-run": lambda d, r: (
        d.update(total_energy_hartree=d["total_energy_hartree"] + 1e-3) or {}
    ),
}


@pytest.mark.parametrize("name", sorted(FORGERIES))
def test_forged_pyscf_worker_candidates_never_publish(api, monkeypatch, name):
    from chemdft_api.scientific_models import CalculationResultRecord
    from sqlalchemy import func, select

    project, version = project_with(api, water_xyz())
    queued = submit(api, project, version, "pyscf", "hf", "sto-3g")
    assert queued.status_code == 201, queued.text
    _forge(monkeypatch, FORGERIES[name])
    detail = run_job(api)
    assert detail.calculation.state == "FAILED", (name, detail.calculation.state)
    assert detail.result is None
    assert detail.attempt.state == "FAILED" and detail.attempt.attempt_number == 1
    from chemdft_api.scientific_models import (
        ComputeExecutionRecord,
        ComputeJobRecord,
        ComputeLeaseRecord,
        ComputeReservationRecord,
        ProvenanceRecordRow,
    )

    with api[1]() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
        # No half-published state: provenance for a result that does not exist, a SUCCEEDED job,
        # a finished execution or a held reservation would all contradict the FAILED calculation.
        assert (
            session.scalar(
                select(func.count())
                .select_from(ProvenanceRecordRow)
                .where(ProvenanceRecordRow.operation == "chemdft.calculation.energy")
            )
            == 0
        )
        job = session.scalar(select(ComputeJobRecord))
        assert job.state == "FAILED"
        assert session.get(ComputeReservationRecord, job.reservation_id).state == "RELEASED"
        assert {e.state for e in session.scalars(select(ComputeExecutionRecord))} <= {"FAILED"}
        assert all(lease.state != "ACTIVE" for lease in session.scalars(select(ComputeLeaseRecord)))


@pytest.mark.parametrize(
    "task,extra",
    [
        ("ORBITAL", {"scf": {"convergence_threshold": 1e-10, "max_iterations": 100}}),
        (
            "FREQUENCY",
            {
                "hessian": {
                    "strategy": "ANALYTIC",
                    "exclude_translation_rotation": True,
                    "coordinate_unit": "angstrom",
                    "hessian_unit": "Eh/bohr^2",
                    "frequency_unit": "cm^-1",
                },
            },
        ),
    ],
)
def test_rejected_publication_in_derived_pyscf_tasks_ends_failed_not_succeeded(
    api, monkeypatch, task, extra
):
    """A Firewall rejection must roll back SUCCEEDED state, provenance and usage together."""
    from chemdft_api import calculation_actions as actions
    from chemdft_api.errors import ScientificValidationFailed
    from chemdft_api.scientific_models import (
        CalculationResultRecord,
        ComputeJobRecord,
        ComputeReservationRecord,
    )
    from sqlalchemy import func, select

    project, version = project_with(api, b"2\nH2\nH 0 0 -0.37\nH 0 0 0.37\n")
    queued = api[0].post(
        f"/v1/projects/{project}/calculations",
        json={
            "structure_version": {
                "project_id": project,
                "entity_type": "structure.version",
                "entity_id": version["id"],
            },
            "specification": {
                "task_type": task,
                "method": {"identifier": "hf", "display_name": "hf", "registry": "chemdft.method"},
                "basis": {
                    "identifier": "sto-3g",
                    "display_name": "STO-3G",
                    "registry": "chemdft.basis",
                },
                "charge": 0,
                "multiplicity": 1,
                "engine_preference": {"engine": "pyscf", "allowed_version": "2.14.0"},
                **extra,
            },
            "idempotency_key": str(uuid4()),
        },
    )
    assert queued.status_code == 201, queued.text
    real = actions.accept_authoritative_result

    def reject(session, producer, submission, **kwargs):
        # Mirror the real publisher: reject, roll back the shared transaction, then raise.
        session.rollback()
        raise ScientificValidationFailed("forced Firewall rejection")

    monkeypatch.setattr(actions, "accept_authoritative_result", reject)
    detail = run_job(api)
    monkeypatch.setattr(actions, "accept_authoritative_result", real)
    assert detail.calculation.state == "FAILED", (task, detail.calculation.state)
    assert detail.result is None and detail.attempt.state == "FAILED"
    with api[1]() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
        job = session.scalar(select(ComputeJobRecord))
        assert job.state == "FAILED"
        assert session.get(ComputeReservationRecord, job.reservation_id).state == "RELEASED"
