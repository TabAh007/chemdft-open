"""Gate B: real pinned native runs; mutations below are rejection tests only."""

from __future__ import annotations

import json
import os
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from chemdft_api.config import Settings
from chemdft_api.scientific.engines.psi4 import (
    PAIRS,
    digest,
    encode,
    enrich_input,
    environment_identity,
    execute_native,
    number,
    parse_evidence,
    policy,
    validate_input,
    validate_specification,
)
from sqlalchemy import func, select
from test_xtb_optimization import run_job

ROOT = Path(__file__).resolve().parents[3]
CLI = ROOT / ".chemdft/envs/psi4-1.11-py312-gate-a1-20261009/bin/psi4"
FIXTURES = Path(__file__).parent / "fixtures/psi4"
NATIVE_AVAILABLE = CLI.is_file()
pytestmark = pytest.mark.scientific_integration


def specification(method="mp2", basis="def2-svp"):
    from chemdft_api.contracts.scientific import CalculationSpecification

    return CalculationSpecification.model_validate(
        {
            "task_type": "ENERGY",
            "method": {"identifier": method, "display_name": method, "registry": "chemdft.method"},
            "basis": {"identifier": basis, "display_name": basis, "registry": "chemdft.basis"},
            "charge": 0,
            "multiplicity": 1,
            "scf": {"reference": policy(method)["reference"]},
            "engine_preference": {"engine": "psi4", "allowed_version": "1.11"},
        }
    )


def native_document(method="mp2", basis="def2-svp"):
    golden = json.loads((FIXTURES / "hf-def2-svp-input.json").read_text())["molecule"]
    g = golden["geometry"]
    original = {
        "coordinate_system": "CARTESIAN",
        "unit": "bohr",
        "atoms": [
            {
                "index": i,
                "element": s,
                "atomic_number": {"O": 8, "H": 1}[s],
                **dict(zip(["x", "y", "z"], g[3 * i : 3 * i + 3], strict=True)),
            }
            for i, s in enumerate(golden["symbols"])
        ],
    }
    doc = {
        "task": "ENERGY",
        "method": method,
        "basis": basis,
        "charge": 0,
        "multiplicity": 1,
        "scf": specification(method, basis).scf.model_dump(mode="json"),
        "atoms": [],
    }
    enrich_input(doc, original)
    return doc


def save_native(label, result, document):
    target = os.environ.get("CHEMDFT_PF8D_EVIDENCE")
    if not target:
        return
    root = Path(target) / "tests-native" / label
    root.mkdir(parents=True, exist_ok=False)
    for name, data in result.native_artifacts.items():
        (root / name).write_bytes(data)
    (root / "normalized-calculation-input.json").write_bytes(encode(document))
    (root / "candidate.json").write_bytes(encode(result.result_document))


def save_outcome(label, detail):
    target = os.environ.get("CHEMDFT_PF8D_EVIDENCE")
    if target:
        root = Path(target) / "gateway-outcomes"
        root.mkdir(parents=True, exist_ok=True)
        (root / f"{label}.json").write_bytes(encode(detail.model_dump(mode="json")))


@pytest.fixture(scope="module")
def native_cases(tmp_path_factory):
    if not NATIVE_AVAILABLE:
        pytest.skip("Accepted Psi4 installation unavailable; capability stays disabled")
    roots = tmp_path_factory.mktemp("psi4-native")
    results = {}
    for method, basis in sorted(PAIRS):
        d = native_document(method, basis)
        r = execute_native(
            d,
            CLI,
            Settings(),
            calculation_id=str(uuid4()),
            execution_id=str(uuid4()),
            attempt_number=1,
            workdir=roots / f"{method}-{basis}",
        )
        assert r.exit_code == 0 and r.result_document is not None, r.native_artifacts.get(
            "validation-error.txt"
        )
        save_native(f"direct-{method}-{basis}", r, d)
        results[method, basis] = (d, r)
    return results


@pytest.mark.parametrize("method,basis", sorted(PAIRS))
def test_real_native_matches_accepted_fixture(native_cases, method, basis):
    d, r = native_cases[method, basis]
    parsed = parse_evidence(r.native_artifacts, d)
    golden = json.loads((FIXTURES / f"{method}-{basis}-output.json").read_text())
    # A regression assertion scoped to these exact frozen geometries, not a production tolerance.
    assert parsed["total_energy_hartree"] == pytest.approx(
        golden["return_result"], abs=1e-12, rel=0
    )
    assert r.result_document["environment"]["runtime_files_verified"] >= 1000
    assert json.loads(r.native_artifacts["execution.json"])["scratch_cleanup_complete"] is True
    assert r.result_document["effective_geometry_bohr"] == golden["molecule"]["geometry"]


def reseal(raw):
    raw["hashes.json"] = encode({n: digest(b) for n, b in raw.items() if n != "hashes.json"})
    return raw


def mutated_output(raw, mutate):
    changed = dict(raw)
    d = json.loads(changed["output.json"])
    mutate(d)
    changed["output.json"] = encode(d)
    return reseal(changed)


@pytest.mark.parametrize(
    "case",
    [
        "engine",
        "module",
        "reference",
        "basis",
        "method",
        "geometry",
        "both-geometries",
        "atom-order",
        "charge",
        "multiplicity",
        "wavefunction",
        "basis-primitives",
        "failed",
        "missing-convergence",
        "earlier-convergence-only",
        "residual",
        "delta",
        "iterations",
        "total",
        "correlation",
        "spin",
        "coherent-circular-correlation",
        "core",
        "df",
        "orbital-optimization",
        "scs",
        "dispersion",
        "malformed",
        "truncated",
        "missing",
        "hash",
        "input",
        "timeout",
        "canceled",
        "incomplete",
    ],
)
def test_native_adversarial_rejections(native_cases, case):
    d, r = native_cases["mp2", "def2-svp"]
    raw = dict(r.native_artifacts)

    def change(out):
        p, q = out["properties"], out["extras"]["qcvars"]
        if case == "engine":
            out["provenance"]["version"] = "1.10"
        if case == "module":
            out["provenance"]["module"] = "dfmp2"
        if case == "reference":
            out["input_data"]["specification"]["keywords"]["reference"] = "uhf"
        if case == "basis":
            out["input_data"]["specification"]["model"]["basis"] = "sto-3g"
        if case == "method":
            out["input_data"]["specification"]["model"]["method"] = "scs-mp2"
        if case in {"geometry", "both-geometries"}:
            out["molecule"]["geometry"][0] += 0.1
        if case == "both-geometries":
            out["input_data"]["molecule"]["geometry"][0] += 0.1
        if case == "atom-order":
            out["molecule"]["symbols"].reverse()
        if case == "charge":
            out["molecule"]["molecular_charge"] = 1
        if case == "multiplicity":
            out["molecule"]["molecular_multiplicity"] = 3
        if case == "wavefunction":
            out["wavefunction"]["restricted"] = False
        if case == "basis-primitives":
            center = next(iter(out["wavefunction"]["basis"]["center_data"].values()))
            center["electron_shells"][0]["exponents"][0] += 1
        if case == "failed":
            out["success"] = False
        if case == "missing-convergence":
            out["stdout"] = out["stdout"].replace("Energy and wave function converged.", "removed")
        if case == "earlier-convergence-only":
            out["stdout"] = "Energy and wave function converged.\n" + out["stdout"].replace(
                "Energy and wave function converged.", "removed"
            )
        if case in {"residual", "delta"}:
            import re

            matches = list(
                re.finditer(
                    r"@RHF iter\s+\d+:\s+([-+\d.Ee]+)\s+([-+\d.Ee]+)\s+([-+\d.Ee]+)", out["stdout"]
                )
            )
            m = matches[-1]
            index = 3 if case == "residual" else 2
            out["stdout"] = (
                out["stdout"][: m.start(index)] + "1.0e-2" + out["stdout"][m.end(index) :]
            )
        if case == "iterations":
            p["scf_iterations"] += 1
        if case == "total":
            out["return_result"] += 0.01
        if case == "correlation":
            p["mp2_correlation_energy"] += 0.01
        if case == "spin":
            p["mp2_same_spin_correlation_energy"] += 0.01
        if case == "coherent-circular-correlation":
            # Synthetic rejection: change correlated/total fields coherently.
            # Genuine spin evidence remains unchanged.
            for key in [
                "MP2 CORRELATION ENERGY",
                "CURRENT CORRELATION ENERGY",
                "CURRENT ENERGY",
                "MP2 TOTAL ENERGY",
            ]:
                q[key] += 0.01
            for key in ["return_energy", "mp2_correlation_energy", "mp2_total_energy"]:
                p[key] += 0.01
            out["return_result"] += 0.01
        if case in {"core", "df", "orbital-optimization", "scs"}:
            import re

            key, value = {
                "core": ("FREEZE_CORE", "1"),
                "df": ("MP2_TYPE", "DF"),
                "orbital-optimization": ("ORB_OPT", "TRUE"),
                "scs": ("SPIN_SCALE_TYPE", "SCS"),
            }[case]
            out["stdout"] = re.sub(r"(" + key + r"\s*=>\s*)\S+", r"\g<1>" + value, out["stdout"])
        if case == "dispersion":
            q["DISPERSION CORRECTION ENERGY"] = -0.001

    raw = mutated_output(raw, change)
    if case in {"malformed", "truncated"}:
        raw["output.json"] = b"{}" if case == "malformed" else raw["output.json"][:100]
        reseal(raw)
    if case == "missing":
        raw.pop("output.json")
        reseal(raw)
    if case == "hash":
        raw["output.json"] += b" "
    if case == "input":
        raw["input.json"] += b" "
        reseal(raw)
    if case in {"timeout", "canceled", "incomplete"}:
        st = json.loads(raw["execution.json"])
        if case == "incomplete":
            st["evidence_complete"] = False
        else:
            st["termination_reason"] = case
        raw["execution.json"] = encode(st)
        reseal(raw)
    with pytest.raises((ValueError, KeyError, TypeError, IndexError)):
        parse_evidence(raw, d)


@pytest.mark.parametrize("case", ["vwn", "hybrid", "grid", "pruning", "pbe", "dispersion"])
def test_dft_native_identity_rejections(native_cases, case):
    method = "pbe" if case == "pbe" else "b3lyp"
    d, r = native_cases[method, "def2-svp"]

    def mutate(out):
        if case == "vwn":
            out["stdout"] = out["stdout"].replace("VWN5_RPA", "VWN5")
        if case == "hybrid":
            import re

            out["stdout"] = re.sub(r"0.2000(\s+HF)", r"0.2500\1", out["stdout"])
        if case == "grid":
            out["extras"]["qcvars"]["XC GRID RADIAL POINTS"] = 75
        if case == "pruning":
            out["stdout"] = out["stdout"].replace("FLAT", "ROBUST")
        if case == "pbe":
            out["stdout"] = out["stdout"].replace("XC_GGA_X_PBE:", "XC_GGA_X_B88:")
        if case == "dispersion":
            out["extras"]["qcvars"]["DFT VV10 ENERGY"] = -0.001

    with pytest.raises(ValueError):
        parse_evidence(mutated_output(r.native_artifacts, mutate), d)


def test_genuine_failed_operation_exit_zero(native_cases):
    d, r = native_cases["mp2", "def2-svp"]
    raw = dict(r.native_artifacts)
    raw["output.json"] = (FIXTURES / "failed-rhf-output.json").read_bytes()
    assert json.loads(raw["output.json"])["error"]["error_type"] == "SCFConvergenceError"
    assert json.loads(raw["execution.json"])["exit_code"] == 0
    with pytest.raises(ValueError, match="failed or malformed"):
        parse_evidence(reseal(raw), d)


@pytest.mark.parametrize(
    "mutation",
    [
        "method",
        "basis",
        "charge",
        "spin",
        "ref",
        "convergence",
        "iterations",
        "dispersion",
        "extension",
        "task",
    ],
)
def test_unsupported_specifications_fail_closed(mutation):
    data = specification().model_dump(mode="json")
    if mutation == "method":
        data["method"]["identifier"] = "df-mp2"
    if mutation == "basis":
        data["basis"]["identifier"] = "sto-3g"
    if mutation == "charge":
        data["charge"] = 1
    if mutation == "spin":
        data["multiplicity"] = 3
    if mutation == "ref":
        data["scf"]["reference"] = "uhf"
    if mutation == "convergence":
        data["scf"]["convergence_threshold"] = 1e-3
    if mutation == "iterations":
        data["scf"]["max_iterations"] = 1
    if mutation == "dispersion":
        data["dispersion"] = {"identifier": "d3", "display_name": "D3", "registry": "custom"}
    if mutation == "extension":
        data["property_requests"] = ["chemdft.arbitrary-keywords"]
    if mutation == "task":
        data["task_type"] = "GEOMETRY_OPTIMIZATION"
    from chemdft_api.contracts.scientific import CalculationSpecification

    with pytest.raises(ValueError):
        validate_specification(CalculationSpecification.model_validate(data))


@pytest.mark.parametrize("change", ["element", "odd-electrons", "nan", "atom-order", "options"])
def test_invalid_molecules_and_inputs(change):
    d = native_document()
    original = d["psi4_original_coordinates"]
    if change == "element":
        original["atoms"][0].update(element="N", atomic_number=7)
    if change == "odd-electrons":
        original["atoms"].pop()
    if change == "nan":
        original["atoms"][0]["x"] = float("nan")
    if change == "atom-order":
        original["atoms"][0]["index"] = 2
    if change == "options":
        d["psi4_input"]["specification"]["keywords"]["freeze_core"] = True
    with pytest.raises(ValueError):
        validate_input(d)


def test_zero_and_positive_values_are_not_rejected_by_sign():
    # Value-domain check only; these numbers are not fabricated native results.
    assert number(0.0) == 0.0 and number(1.0) == 1.0


def submit(api, method="mp2", basis="def2-svp", *, name="water"):
    client, _, settings = api
    if not NATIVE_AVAILABLE:
        pytest.skip("Accepted native Psi4 installation unavailable")
    settings.psi4_executable = CLI
    project = client.post(
        "/v1/projects", json={"name": "Disposable Psi4 acceptance", "slug": f"psi4-{uuid4()}"}
    ).json()["id"]
    source = json.loads((FIXTURES / "hf-def2-svp-input.json").read_text())["molecule"]
    from chemdft_api.scientific.engines.normalization import BOHR_PER_ANGSTROM

    g = source["geometry"]
    if name == "water":
        lines = [
            s + " " + " ".join(format(v / BOHR_PER_ANGSTROM, ".17g") for v in g[3 * i : 3 * i + 3])
            for i, s in enumerate(source["symbols"])
        ]
    elif name == "nitrogen":
        lines = ["N 0 0 0", "H 0 0 1", "H 1 0 0", "H 0 1 0"]
    elif name == "carbon-frame":
        lines = [
            "C 0.123456789123456 0.234567891234567 0.345678912345678",
            "O 0.123456789123456 0.234567891234567 1.505678912345678",
            "O 0.123456789123456 0.234567891234567 -0.814321087654322",
        ]
    else:
        raise AssertionError(name)
    uploaded = client.post(
        f"/v1/projects/{project}/structures/imports",
        files={
            "upload": (
                "input.xyz",
                str(len(lines)) + "\nFrozen scientific fixture\n" + "\n".join(lines) + "\n",
                "chemical/x-xyz",
            )
        },
        data={"file_format": "XYZ", "idempotency_key": str(uuid4())},
    )
    assert uploaded.status_code == 201, uploaded.text
    version = uploaded.json()["version"]
    command = {
        "structure_version": {
            "project_id": project,
            "entity_type": "structure.version",
            "entity_id": version["id"],
        },
        "specification": specification(method, basis).model_dump(mode="json"),
        "idempotency_key": str(uuid4()),
    }
    queued = client.post(f"/v1/projects/{project}/calculations", json=command)
    return project, version, queued, command


def assert_reconciled(api, state):
    from chemdft_api.scientific_models import (
        ComputeJobRecord,
        ComputeLeaseRecord,
        ComputeReservationRecord,
    )

    with api[1]() as s:
        job = s.scalar(select(ComputeJobRecord))
        reservation = s.get(ComputeReservationRecord, job.reservation_id)
        assert job.state == state and reservation.state == "RELEASED"
        assert all(a.state != "ACTIVE" for a in s.scalars(select(ComputeLeaseRecord)))
        assert reservation.actual_cost_json == {"currency": "USD", "minor_units": 0}


@pytest.mark.parametrize("method,basis", sorted(PAIRS))
def test_backend_authoritative_energy(api, monkeypatch, method, basis):
    from chemdft_api import calculation_actions as actions
    from chemdft_api.compute_gateway import LocalComputeProvider
    from result_provenance_checks import assert_published_result_binding

    execute = LocalComputeProvider.execute

    def retain(self, **kwargs):
        result = execute(self, **kwargs)
        save_native(f"backend-{method}-{basis}", result, json.loads(kwargs["normalized_input"]))
        return result

    monkeypatch.setattr(LocalComputeProvider, "execute", retain)
    accept = actions.accept_authoritative_result

    def publish_twice(session, producer, submission, **kwargs):
        first = accept(session, producer, submission, **kwargs)
        second = accept(session, producer, submission, **kwargs)
        assert first == second
        return first

    monkeypatch.setattr(actions, "accept_authoritative_result", publish_twice)
    project, version, queued, command = submit(api, method, basis)
    assert queued.status_code == 201, queued.text
    detail = run_job(api)
    save_outcome(f"backend-{method}-{basis}", detail)
    assert detail.calculation.state == "SUCCEEDED", detail
    assert detail.result.trusted_producer_id == "local.psi4.worker"
    assert detail.result.producer_software.name == "psi4"
    assert detail.result.payload.method == method and detail.result.payload.basis == basis
    assert detail.result.payload.total_energy.unit.code == "Eh"
    expected = json.loads((FIXTURES / f"{method}-{basis}-output.json").read_text())["return_result"]
    assert detail.result.payload.total_energy.value == pytest.approx(expected, abs=1e-12, rel=0)
    assert detail.optimization_trajectory is None
    assert (
        len(
            api[0]
            .get(f"/v1/projects/{project}/structures/{version['structure_id']}/versions")
            .json()
        )
        == 1
    )
    assert (
        api[0]
        .post(f"/v1/projects/{project}/calculations", json=command)
        .json()["calculation"]["id"]
        == queued.json()["calculation"]["id"]
    )
    assert_reconciled(api, "SUCCEEDED")
    assert_published_result_binding(api[1], detail.result.id, version["id"])


def test_backend_unsupported_element(api):
    _, _, queued, _ = submit(api, name="nitrogen")
    assert queued.status_code == 422, queued.text


@pytest.mark.parametrize(
    "case",
    [
        "software",
        "producer",
        "attestation",
        "attempt",
        "lease",
        "energy",
        "input-settings",
        "source-geometry",
        "hash",
        "bytes",
        "missing",
        "execution",
        "mp2-spin",
        "worker-json",
        "environment",
        "reservation",
        "requirement",
        "superseded",
    ],
)
def test_firewall_persisted_native_rejection(api, monkeypatch, case):
    from chemdft_api import calculation_actions as actions
    from chemdft_api.models import utc_now
    from chemdft_api.scientific_models import (
        CalculationAttemptRecord,
        CalculationInputRecord,
        CalculationResultRecord,
        ComputeExecutionRecord,
        ComputeJobRecord,
        ComputeLeaseRecord,
        ComputeReservationRecord,
        ScientificArtifactRecord,
        StructureVersionRecord,
    )
    from chemdft_api.trusted_producers import issue_trusted_producer_context

    _, _, queued, _ = submit(api)
    assert queued.status_code == 201, queued.text
    accept = actions.accept_authoritative_result

    def controlled(s, producer, submission, **kw):
        refs = list(submission.raw_artifacts)
        records = [s.get(ScientificArtifactRecord, str(r.artifact_id)) for r in refs]
        native = {
            r.format_identifier.removeprefix("psi4.native."): r
            for r in records
            if r.format_identifier.startswith("psi4.native.")
        }
        attempt = s.scalar(select(CalculationAttemptRecord))
        if case == "software":
            submission = submission.model_copy(
                update={
                    "producer_software": submission.producer_software.model_copy(
                        update={"name": "pyscf"}
                    )
                }
            )
        if case in {"producer", "attestation"}:
            producer = issue_trusted_producer_context(
                producer_id="local.xtb.worker" if case == "producer" else producer.producer_id,
                producer_type=producer.producer_type,
                project_id=producer.project_id,
                attestation_id="wrong" if case == "attestation" else producer.attestation_id,
            )
        if case == "attempt":
            attempt.attempt_number += 1
        if case == "lease":
            s.scalar(select(ComputeLeaseRecord)).expires_at = utc_now() - timedelta(seconds=1)
        if case == "energy":
            submission = submission.model_copy(
                update={
                    "payload": submission.payload.model_copy(
                        update={
                            "total_energy": submission.payload.total_energy.model_copy(
                                update={"value": -99.0}
                            )
                        }
                    )
                }
            )
        if case == "input-settings":
            ci = s.scalar(select(CalculationInputRecord))
            changed = deepcopy(ci.specification_json)
            changed["scf"]["max_iterations"] = 1
            ci.specification_json = changed
        if case == "source-geometry":
            v = s.scalar(select(StructureVersionRecord))
            changed = deepcopy(v.representation_json)
            changed["coordinates"]["atoms"][0]["x"] += 0.01
            v.representation_json = changed
        if case == "hash":
            native["output.json"].sha256 = "0" * 64
        if case in {"bytes", "missing"}:
            path = api[2].object_root / native["output.json"].storage_key
            path.write_bytes(b"corrupt") if case == "bytes" else path.unlink()
        if case in {"execution", "mp2-spin"}:
            # Synthetic resealed corrupt evidence exercises server semantics.
            raw = {
                name: (api[2].object_root / r.storage_key).read_bytes()
                for name, r in native.items()
            }
            name = "invocation.json" if case == "execution" else "output.json"
            data = json.loads(raw[name])
            if case == "execution":
                data["execution_id"] = str(uuid4())
            else:
                data["properties"]["mp2_same_spin_correlation_energy"] += 0.01
            raw[name] = encode(data)
            reseal(raw)
            for changed_name in [name, "hashes.json"]:
                record = native[changed_name]
                (api[2].object_root / record.storage_key).write_bytes(raw[changed_name])
                record.sha256 = digest(raw[changed_name])
                record.size_bytes = len(raw[changed_name])
            refs = [actions._artifact_reference(r) for r in records]
            attempt.raw_artifacts_json = [r.model_dump(mode="json") for r in refs]
            submission = submission.model_copy(update={"raw_artifacts": tuple(refs)})
        if case == "worker-json":
            record = next(r for r in records if r.format_identifier == "chemdft.worker.energy")
            path = api[2].object_root / record.storage_key
            data = json.loads(path.read_bytes())
            data["returned_geometry_sha256"] = "0" * 64
            path.write_bytes(encode(data))
        if case == "environment":
            s.scalar(select(ComputeExecutionRecord)).worker_id = "local.other.worker"
        if case == "superseded":
            current = s.scalar(select(ComputeExecutionRecord))
            values = {
                c.name: getattr(current, c.name)
                for c in ComputeExecutionRecord.__table__.columns
                if c.name not in {"id", "started_at", "provider_execution_ref"}
            }
            s.add(
                ComputeExecutionRecord(
                    **values, id=str(uuid4()), started_at=utc_now(), provider_execution_ref=None
                )
            )
        if case == "requirement":
            job = s.scalar(select(ComputeJobRecord))
            job.requirement_hash = "0" * 64
        if case == "reservation":
            job = s.scalar(select(ComputeJobRecord))
            s.get(ComputeReservationRecord, job.reservation_id).state = "RECONCILED"
        return accept(s, producer, submission, **kw)

    monkeypatch.setattr(actions, "accept_authoritative_result", controlled)
    detail = run_job(api)
    save_outcome(f"synthetic-rejection-{case}", detail)
    assert detail.result is None and detail.calculation.state == "FAILED", detail
    assert detail.attempt.raw_artifacts
    with api[1]() as s:
        assert s.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
    assert_reconciled(api, "FAILED")


@pytest.mark.parametrize(
    "failure", ["missing", "cancel", "timeout", "stale", "stale_tick", "expires_tick"]
)
def test_backend_lifecycle_no_partial_publication(api, monkeypatch, failure):
    from chemdft_api.compute_gateway import LocalComputeProvider
    from chemdft_api.models import utc_now
    from chemdft_api.scientific_models import ComputeLeaseRecord

    client, sessions, settings = api
    project, _, queued, _ = submit(api)
    assert queued.status_code == 201
    if failure == "timeout":
        settings.scientific_execution_timeout_seconds = 10
    execute = LocalComputeProvider.execute

    def controlled(self, **kwargs):
        if failure in {"stale_tick", "expires_tick"}:
            with sessions() as s:
                lease = s.scalar(select(ComputeLeaseRecord))
                setattr(
                    lease,
                    "heartbeat_deadline_at" if failure == "stale_tick" else "expires_at",
                    utc_now() - timedelta(seconds=1),
                )
                s.commit()
            assert kwargs["on_tick"]() is False
        if failure == "timeout":
            self._settings = self._settings.model_copy(
                update={"scientific_execution_timeout_seconds": 0.1}
            )
        if failure == "cancel":
            tick = kwargs["on_tick"]
            called = False

            def cancel_tick():
                nonlocal called
                if not called:
                    called = True
                    assert (
                        client.post(
                            f"/v1/projects/{project}/calculations/{queued.json()['calculation']['id']}/cancel"
                        ).status_code
                        == 200
                    )
                return tick()

            kwargs["on_tick"] = cancel_tick
        result = execute(self, **kwargs)
        save_native(f"lifecycle-{failure}", result, json.loads(kwargs["normalized_input"]))
        if failure == "missing":
            raw = dict(result.native_artifacts)
            raw.pop("output.json", None)
            return replace(result, native_artifacts=raw)
        if failure == "stale":
            with sessions() as s:
                s.scalar(select(ComputeLeaseRecord)).heartbeat_deadline_at = utc_now() - timedelta(
                    seconds=1
                )
                s.commit()
        return result

    monkeypatch.setattr(LocalComputeProvider, "execute", controlled)
    detail = run_job(api)
    save_outcome(f"lifecycle-{failure}", detail)
    assert detail.result is None
    expected = "CANCELED" if failure == "cancel" else "FAILED"
    assert detail.calculation.state == expected, detail
    assert_reconciled(api, expected)


def test_atomic_failure_after_firewall_rolls_back_success(api, monkeypatch):
    from chemdft_api import calculation_actions as actions
    from chemdft_api.scientific_models import CalculationResultRecord, ProvenanceRecordRow

    _, _, queued, _ = submit(api)
    assert queued.status_code == 201
    accept = actions.accept_authoritative_result

    def fail_after(*args, **kwargs):
        accept(*args, **kwargs)
        raise RuntimeError("Injected atomic failure after Firewall flush")

    monkeypatch.setattr(actions, "accept_authoritative_result", fail_after)
    detail = run_job(api)
    save_outcome("atomic-publication-failure", detail)
    assert detail.result is None and detail.calculation.state == "FAILED"
    with api[1]() as s:
        assert s.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
        assert (
            s.scalar(
                select(func.count())
                .select_from(ProvenanceRecordRow)
                .where(ProvenanceRecordRow.operation == "chemdft.calculation.energy")
            )
            == 0
        )
    assert_reconciled(api, "FAILED")


def test_artifact_transfer_failure_reconciles_without_result(api, monkeypatch):
    from chemdft_api import calculation_actions as actions
    from chemdft_api.scientific_models import CalculationResultRecord

    _, _, queued, _ = submit(api)
    assert queued.status_code == 201
    store = actions._store_artifact

    def fail_transfer(*args, **kw):
        if kw.get("format_identifier") == "psi4.native.output.json":
            raise OSError("Injected native artifact transfer failure")
        return store(*args, **kw)

    monkeypatch.setattr(actions, "_store_artifact", fail_transfer)
    detail = run_job(api)
    save_outcome("artifact-transfer-failure", detail)
    assert detail.result is None and detail.calculation.state == "FAILED"
    with api[1]() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
    assert_reconciled(api, "FAILED")


@pytest.mark.parametrize("late_change", ["lease-expiry", "cancel"])
def test_authorization_change_after_firewall_flush_cannot_publish(api, monkeypatch, late_change):
    from chemdft_api import calculation_actions as actions
    from chemdft_api.models import utc_now
    from chemdft_api.scientific_models import (
        CalculationResultRecord,
        ComputeJobRecord,
        ComputeLeaseRecord,
    )

    _, _, queued, _ = submit(api)
    assert queued.status_code == 201
    accept = actions.accept_authoritative_result

    def change_after(session, *args, **kw):
        result = accept(session, *args, **kw)
        if late_change == "lease-expiry":
            session.scalar(select(ComputeLeaseRecord)).expires_at = utc_now() - timedelta(seconds=1)
        else:
            session.scalar(select(ComputeJobRecord)).state = "CANCEL_REQUESTED"
        return result

    monkeypatch.setattr(actions, "accept_authoritative_result", change_after)
    detail = run_job(api)
    save_outcome(f"after-firewall-{late_change}", detail)
    expected = "CANCELED" if late_change == "cancel" else "FAILED"
    assert detail.result is None and detail.calculation.state == expected
    with api[1]() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
    assert_reconciled(api, expected)


def test_concurrent_workers_cannot_claim_same_execution(api, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from chemdft_api.compute_gateway import LocalComputeProvider
    from chemdft_api.scientific_models import ComputeExecutionRecord

    _, _, queued, _ = submit(api)
    assert queued.status_code == 201
    entered, release = Event(), Event()
    execute = LocalComputeProvider.execute

    def blocked(self, **kw):
        entered.set()
        assert release.wait(30)
        return execute(self, **kw)

    monkeypatch.setattr(LocalComputeProvider, "execute", blocked)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(run_job, api)
        assert entered.wait(10)
        assert pool.submit(run_job, api).result(10) is None
        release.set()
        assert first.result(30).calculation.state == "SUCCEEDED"
    with api[1]() as s:
        assert s.scalar(select(func.count()).select_from(ComputeExecutionRecord)) == 1


def test_stale_cancel_cannot_overwrite_committed_native_publication(api):
    from chemdft_api.calculation_actions import cancel_calculation
    from chemdft_api.context import Identity
    from chemdft_api.scientific_models import CalculationRecord, ComputeJobRecord

    project, _, queued, _ = submit(api)
    assert queued.status_code == 201
    calculation_id = queued.json()["calculation"]["id"]
    with api[1]() as stale:
        job = stale.scalar(select(ComputeJobRecord))
        calculation = stale.get(CalculationRecord, calculation_id)
        assert job.state == "READY" and calculation.state == "QUEUED"
        assert run_job(api).calculation.state == "SUCCEEDED"
        # This session still holds the state read before the other worker committed.
        assert job.state == "READY" and calculation.state == "QUEUED"
        detail = cancel_calculation(
            stale,
            Identity(user_id=api[2].dev_user_id, organization_id=api[2].dev_organization_id),
            project, calculation_id,
        )
        save_outcome("stale-cancel-after-publication", detail)
        assert detail.calculation.state == "SUCCEEDED" and detail.result is not None
    assert_reconciled(api, "SUCCEEDED")


def test_environment_identity_rejects_wrong_cli(tmp_path):
    fake = tmp_path / "bin/psi4"
    fake.parent.mkdir()
    fake.write_text("#!/bin/sh\nexit 0\n")
    with pytest.raises(ValueError):
        environment_identity(fake)


@pytest.mark.parametrize("kind", ["environment", "memory", "libxc-threshold"])
def test_launch_and_density_policy_cannot_be_resealed(native_cases, kind):
    document, result = native_cases["b3lyp", "def2-svp"]
    raw = dict(result.native_artifacts)
    name = "output.json" if kind == "libxc-threshold" else "invocation.json"
    data = json.loads(raw[name])
    if kind == "environment":
        data["environment"]["OMP_NUM_THREADS"] = "8"
    elif kind == "memory":
        data["engine_memory_bytes"] *= 2
    else:
        data["stdout"] = data["stdout"].replace(
            "XC_HYB_GGA_XC_B3LYP:  1.00E-14", "XC_HYB_GGA_XC_B3LYP:  1.00E-06"
        )
    raw[name] = encode(data)
    with pytest.raises(ValueError):
        parse_evidence(reseal(raw), document)


@pytest.mark.parametrize("resource", ["output", "directory"])
def test_real_native_resource_limit_fails_closed(tmp_path, resource):
    settings = Settings().model_copy(
        update={
            "scientific_max_output_bytes"
            if resource == "output"
            else "compute_local_temporary_storage_bytes": 1024
        }
    )
    document = native_document()
    result = execute_native(
        document,
        CLI,
        settings,
        calculation_id=str(uuid4()),
        execution_id=str(uuid4()),
        attempt_number=1,
        workdir=tmp_path / resource,
    )
    save_native(f"resource-{resource}", result, document)
    assert result.result_document is None
    status = json.loads(result.native_artifacts["execution.json"])
    assert status["evidence_complete"] is False
    assert status["process_group_cleanup"] and status["scratch_cleanup_complete"]
    assert status["hard_memory_limit"] is False and status["hard_disk_quota"] is False


def test_changed_immutable_input_never_reaches_native_provider(api, monkeypatch):
    from chemdft_api.compute_gateway import LocalComputeProvider
    from chemdft_api.scientific_models import CalculationInputRecord, ScientificArtifactRecord

    _, _, queued, _ = submit(api)
    assert queued.status_code == 201
    with api[1]() as session:
        ci = session.scalar(select(CalculationInputRecord))
        record = session.get(ScientificArtifactRecord, ci.normalized_input_artifact_id)
        path = api[2].object_root / record.storage_key
        path.write_bytes(path.read_bytes() + b" ")
    called = False

    def forbidden(*args, **kw):
        nonlocal called
        called = True
        raise AssertionError("Changed immutable input reached provider")

    monkeypatch.setattr(LocalComputeProvider, "execute", forbidden)
    detail = run_job(api)
    save_outcome("immutable-input-rejection", detail)
    assert not called and detail.result is None and detail.calculation.state == "FAILED"
    assert_reconciled(api, "FAILED")


def test_real_worker_sigterm_reconciles_before_exit(api, tmp_path):
    import signal
    import subprocess
    import sys

    from chemdft_api.scientific_models import CalculationResultRecord, ScientificArtifactRecord

    _, _, queued, _ = submit(api)
    assert queued.status_code == 201
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(api[2].model_dump_json())
    script = """
import os, signal, sys
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from chemdft_api.config import Settings
from chemdft_api.compute_gateway import LocalComputeProvider
sys.path.insert(0, str(Path(sys.argv[2])))
from test_xtb_optimization import run_job
from test_psi4_integration import save_native
import json
settings = Settings.model_validate_json(Path(sys.argv[1]).read_text())
sessions = sessionmaker(bind=create_engine(settings.database_url), expire_on_commit=False,
                       autoflush=False)
execute = LocalComputeProvider.execute
def controlled(self, **kw):
    original_tick = kw["on_tick"]
    sent = False
    def signal_tick():
        nonlocal sent
        if not sent:
            sent = True
            os.kill(os.getpid(), signal.SIGTERM)
        return original_tick()
    kw["on_tick"] = signal_tick
    result = execute(self, **kw)
    save_native("worker-sigterm", result, json.loads(kw["normalized_input"]))
    return result
LocalComputeProvider.execute = controlled
run_job((None, sessions, settings))
"""
    process = subprocess.run(
        [sys.executable, "-B", "-c", script, str(settings_file), str(FIXTURES.parents[1])],
        capture_output=True,
        timeout=45,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )
    assert process.returncode == 128 + signal.SIGTERM, process.stderr.decode()
    with api[1]() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
        record = session.scalar(
            select(ScientificArtifactRecord).where(
                ScientificArtifactRecord.format_identifier == "psi4.native.execution.json"
            )
        )
        status = json.loads((api[2].object_root / record.storage_key).read_bytes())
        assert status["termination_reason"] == "worker shutdown"
        assert status["process_group_cleanup"] and status["scratch_cleanup_complete"]
        with pytest.raises(ProcessLookupError):
            os.killpg(status["process_group_id"], 0)
    assert_reconciled(api, "FAILED")


def test_no_capability_without_verified_installation():
    from chemdft_api.scientific.engines.registry import capability_views

    view = next(r for r in capability_views(Settings(psi4_executable=None)) if r.engine == "psi4")
    assert (
        view.availability == "UNAVAILABLE"
        and view.supported_tasks == view.supported_methods == view.supported_basis_sets == ()
        and view.supported_method_basis_pairs == ()
    )


def test_available_capability_reports_exact_pairs():
    from chemdft_api.scientific.engines.registry import capability_views

    view = next(r for r in capability_views(Settings(psi4_executable=CLI)) if r.engine == "psi4")
    assert view.availability == "AVAILABLE"
    assert tuple((p.method, p.basis) for p in view.supported_method_basis_pairs) == tuple(
        sorted(PAIRS)
    )


def test_backend_carbon_fixed_frame_and_geometry_hashes(api, monkeypatch):
    from chemdft_api.compute_gateway import LocalComputeProvider
    from chemdft_api.scientific_models import StructureVersionRecord

    execute = LocalComputeProvider.execute
    retained = {}

    def retain(self, **kwargs):
        result = execute(self, **kwargs)
        document = json.loads(kwargs["normalized_input"])
        save_native("backend-carbon-fixed-frame", result, document)
        retained.update(result=result, document=document)
        return result

    monkeypatch.setattr(LocalComputeProvider, "execute", retain)
    _, version, queued, _ = submit(api, name="carbon-frame")
    assert queued.status_code == 201, queued.text
    with api[1]() as session:
        before = deepcopy(session.get(StructureVersionRecord, version["id"]).representation_json)
    detail = run_job(api)
    save_outcome("backend-carbon-fixed-frame", detail)
    assert detail.calculation.state == "SUCCEEDED", detail
    document, result = retained["document"], retained["result"]
    parsed = parse_evidence(result.native_artifacts, document)
    native = json.loads(result.native_artifacts["output.json"])
    assert native["molecule"]["symbols"] == ["C", "O", "O"]
    assert parsed["returned_geometry_bohr"] == parsed["effective_geometry_bohr"]
    assert native["molecule"]["geometry"][0] != 0  # Retained translation, not centered.
    assert document["psi4_geometry"]["original_sha256"] == digest(encode(before["coordinates"]))
    assert parsed["returned_geometry_sha256"] == digest(encode(native["molecule"]))
    with api[1]() as session:
        assert session.get(StructureVersionRecord, version["id"]).representation_json == before
    assert_reconciled(api, "SUCCEEDED")
