from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

import pytest
from chemdft_api.scientific.engines.crest import (
    BINARY_SHA256,
    CALCULATOR,
    VERSION,
    ConformerSearchOptions,
    execute_native,
    parse_evidence,
)
from result_provenance_checks import assert_published_result_binding
from test_xtb_optimization import run_job

ROOT = Path(__file__).resolve().parents[3]
BUILD = ROOT / ".chemdft/engines/crest-3.0.2-ewinfix-a1/reproduction"
CREST = ROOT / ".chemdft/envs/crest-3.0.2-ewinfix-a1/bin/crest-pf8c-ewinfix"
FIXTURES = Path(__file__).parent / "fixtures/crest"


def native_input(name="water"):
    lines = (FIXTURES / f"{name}.xyz").read_text().splitlines()
    return {
        "task": "CONFORMER_SEARCH",
        "engine": "crest",
        "engine_version": VERSION,
        "engine_executable_sha256": BINARY_SHA256,
        "calculator": CALCULATOR,
        "method": "gfn2",
        "basis": None,
        "coordinate_unit": "angstrom",
        "charge": 0,
        "multiplicity": 1,
        "conformer_search": ConformerSearchOptions().model_dump(mode="json"),
        "atoms": [
            {
                "index": i,
                "element": r[0],
                "atomic_number": {"H": 1, "C": 6, "O": 8}[r[0]],
                "xyz_angstrom": list(map(float, r[1:])),
            }
            for i, line in enumerate(lines[2:])
            if (r := line.split())
        ],
    }


def submit(api, name="water", project=None, version=None, key=None, options=None):
    client, _, _ = api
    if project is None:
        project = client.post(
            "/v1/projects", json={"name": "Disposable CREST acceptance", "slug": f"crest-{uuid4()}"}
        ).json()["id"]
    if version is None:
        response = client.post(
            f"/v1/projects/{project}/structures/imports",
            files={
                "upload": (
                    "input.xyz",
                    (FIXTURES / f"{name}.xyz")
                    .read_bytes()
                    .replace(b"\n\n", b"\nNative Gate A.1 seed\n", 1),
                    "chemical/x-xyz",
                )
            },
            data={"file_format": "XYZ", "idempotency_key": str(uuid4())},
        )
        assert response.status_code == 201, response.text
        version = response.json()["version"]
    request = {
        "structure_version": {
            "project_id": project,
            "entity_type": "structure.version",
            "entity_id": version["id"],
        },
        "specification": {
            "task_type": "CONFORMER_SEARCH",
            "method": {
                "identifier": "gfn2",
                "display_name": "GFN2 via embedded tblite",
                "registry": "chemdft.method",
            },
            "charge": 0,
            "multiplicity": 1,
            "conformer_search": options or ConformerSearchOptions().model_dump(mode="json"),
            "engine_preference": {"engine": "crest", "allowed_version": VERSION},
        },
        "idempotency_key": key or str(uuid4()),
    }
    response = client.post(f"/v1/projects/{project}/calculations", json=request)
    assert response.status_code == 201, response.text
    return project, version, response.json(), request


def test_backend_water_first(api):
    client, _sessions, _settings = api
    project, version, queued, request = submit(api)
    detail = run_job(api)
    assert detail.calculation.state == "SUCCEEDED", detail
    assert detail.result.trusted_producer_id == "local.crest.worker"
    assert_published_result_binding(api[1], detail.result.id, version["id"])
    m = detail.result.payload.manifest
    assert len(m.members) == 1 and m.effective_ewin_kcal_mol == 6.0
    assert m.members[0].minimum_status == "UNVERIFIED"
    assert m.members[0].geometry_convergence == "NATIVE_GRADIENT_CONVERGED"
    assert m.input_structure_version_id.hex == __import__("uuid").UUID(version["id"]).hex
    assert detail.optimization_trajectory is None
    versions = client.get(
        f"/v1/projects/{project}/structures/{version['structure_id']}/versions"
    ).json()
    assert len(versions) == 1
    assert (
        client.post(f"/v1/projects/{project}/calculations", json=request).json()["calculation"][
            "id"
        ]
        == queued["calculation"]["id"]
    )


@pytest.mark.parametrize("name,count", [("ethanol", 2), ("butane", 2)])
def test_backend_real_multiple_conformer_search(api, tmp_path, name, count):
    from chemdft_api.scientific.engines.crest import parse_evidence
    from chemdft_api.scientific_models import ScientificArtifactRecord

    client, sessions, settings = api
    project, version, _queued, _ = submit(api, name)
    detail = run_job(api)
    assert detail.calculation.state == "SUCCEEDED", detail
    m = detail.result.payload.manifest
    assert len(m.members) >= count
    assert all(member.minimum_status == "UNVERIFIED" for member in m.members)
    energies = [a.native_electronic_energy.value for a in m.members]
    assert energies == sorted(energies) and energies[1] > energies[0]
    assert [a.native_rank for a in m.members] == list(range(1, len(m.members) + 1))
    assert [a.application_rank for a in m.members] == list(range(1, len(m.members) + 1))
    assert m.native_rotamer_count >= count
    with sessions() as session:
        raw = {
            a.name: (
                settings.object_root
                / session.get(ScientificArtifactRecord, str(a.artifact.artifact_id)).storage_key
            ).read_bytes()
            for a in m.native_artifacts
        }
        from chemdft_api.scientific_models import CalculationInputRecord

        input_record = session.get(CalculationInputRecord, str(detail.result.calculation_input_id))
        document = json.loads(
            (
                settings.object_root
                / session.get(
                    ScientificArtifactRecord, input_record.normalized_input_artifact_id
                ).storage_key
            ).read_bytes()
        )
    assert parse_evidence(raw, document)["members"][0]["energy_hartree"] == energies[0]
    assert (
        len(
            client.get(
                f"/v1/projects/{project}/structures/{version['structure_id']}/versions"
            ).json()
        )
        == 1
    )
    if name == "butane":
        import math

        def torsion(member):
            p = [
                [getattr(a, axis) for axis in ("x", "y", "z")]
                for a in member.conformer.coordinates.atoms[:4]
            ]

            def sub(a, b):
                return [x - y for x, y in zip(a, b, strict=False)]

            def dot(a, b):
                return sum(x * y for x, y in zip(a, b, strict=False))

            def cross(a, b):
                return [
                    a[1] * b[2] - a[2] * b[1],
                    a[2] * b[0] - a[0] * b[2],
                    a[0] * b[1] - a[1] * b[0],
                ]

            b0 = sub(p[0], p[1])
            b1 = sub(p[2], p[1])
            b2 = sub(p[3], p[2])
            norm = math.sqrt(dot(b1, b1))
            b1 = [x / norm for x in b1]
            v = sub(b0, [dot(b0, b1) * x for x in b1])
            w = sub(b2, [dot(b2, b1) * x for x in b1])
            return abs(math.degrees(math.atan2(dot(cross(b1, v), w), dot(v, w))))

        assert torsion(m.members[0]) > 170
        assert 50 < torsion(m.members[1]) < 80
        assert 0.5 < (energies[1] - energies[0]) * 627.50947428 < 0.7
    # Test reruns must never overwrite retained, sealed scientific acceptance evidence.
    evidence = tmp_path / "native-acceptance" / name
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / "manifest.json").write_text(m.model_dump_json(indent=2))
    for filename, data in raw.items():
        (evidence / filename).write_bytes(data)


@pytest.mark.parametrize(
    "name,expected",
    [
        ("original-cregen-6", None),
        ("original-cregen-6p0", None),
        ("original-cregen-30p0", None),
        ("candidate-cregen-6", 2),
        ("candidate-cregen-6p0", 2),
        ("candidate-cregen-30p0", 2),
        ("candidate-cregen-0p1", 1),
        ("candidate-cregen-duplicates", 2),
    ],
)
def test_genuine_sorting_window_regressions(name, expected):
    from chemdft_api.scientific.engines.crest import parse_sorting

    directory = FIXTURES / name
    window = 0.1 if name.endswith("0p1") else 30.0 if name.endswith("30p0") else 6.0
    args = (
        (directory / "pair.xyz.sorted").read_bytes(),
        (directory / "stdout.txt").read_text(),
        native_input("butane")["atoms"],
        window,
    )
    if expected is None:
        with pytest.raises(ValueError, match="EWIN"):
            parse_sorting(*args)
    else:
        records = parse_sorting(*args)
        assert len(records) == expected
        if name.endswith("duplicates"):
            assert "number of doubles removed by rot/RMSD" in args[1]


@pytest.mark.parametrize("window", ["missing", "zero", "wrong", "contradictory"])
def test_final_window_missing_incorrect_or_contradictory(window):
    from chemdft_api.scientific.engines.crest import effective_window

    text = {
        "missing": "",
        "zero": "sorting energy window (EWIN) : 0.0000",
        "wrong": "sorting energy window (EWIN) : 30.0000",
        "contradictory": (
            "sorting energy window (EWIN) : 6.0000\nsorting energy window (EWIN) : 0.0000"
        ),
    }[window]
    with pytest.raises(ValueError, match="EWIN"):
        effective_window(text, 6.0)


@pytest.fixture(scope="module")
def real_water(tmp_path_factory):
    from chemdft_api.config import Settings

    document = native_input()
    result = execute_native(
        document,
        CREST,
        Settings(),
        calculation_id="disposable-water-parser",
        workdir=tmp_path_factory.mktemp("crest-parser"),
    )
    assert result.result_document is not None, result.native_artifacts.get("validation-error.txt")
    return document, result


@pytest.mark.parametrize(
    "corruption",
    [
        "missing",
        "truncated",
        "nan",
        "atom",
        "rank",
        "relative",
        "energy",
        "count",
        "incomplete",
        "exit",
        "method",
        "input",
        "zero",
        "final_protocol",
        "duplicates",
    ],
)
def test_native_evidence_corruption_fails_closed(real_water, corruption):
    from chemdft_api.scientific.engines.crest import encode

    document, result = real_water
    raw = dict(result.native_artifacts)
    if corruption == "missing":
        del raw["crest_best.xyz"]
    elif corruption == "truncated":
        raw["crest_conformers.xyz"] = raw["crest_conformers.xyz"][:-30]
    elif corruption == "nan":
        raw["crest_best.xyz"] = raw["crest_best.xyz"].replace(b"-5.07054445", b"nan")
    elif corruption == "atom":
        raw["crest_best.xyz"] = raw["crest_best.xyz"].replace(b"\n O ", b"\n C ")
    elif corruption == "rank":
        raw["crest.energies"] = b"2 0.000\n"
    elif corruption == "relative":
        raw["crest.energies"] = b"1 1.000\n"
    elif corruption == "energy":
        raw["crest_best.xyz"] = raw["crest_best.xyz"].replace(b"-5.07054445", b"-9.07054445")
    elif corruption == "count":
        raw["stdout.txt"] = raw["stdout.txt"].replace(
            b"number of reliable points      :     1", b"number of reliable points      :     2"
        )
    elif corruption == "incomplete":
        raw["stdout.txt"] = raw["stdout.txt"].replace(b"CREST terminated normally.", b"")
    elif corruption == "exit":
        raw["execution.json"] = encode({"exit_code": 1, "evidence_complete": True})
    elif corruption == "method":
        raw["stdout.txt"] = raw["stdout.txt"].replace(b"GFN2-xTB level", b"GFN1-xTB level")
    elif corruption == "input":
        raw["input.xyz"] += b"changed\n"
    elif corruption == "zero":
        raw["stdout.txt"] = raw["stdout.txt"].replace(b"6.0000 / kcal", b"0.0000 / kcal")
    elif corruption == "final_protocol":
        raw["stdout.txt"] = raw["stdout.txt"].replace(b"0.200E-03 Eh/a0", b"0.500E-03 Eh/a0")
    elif corruption == "duplicates":
        raw["crest_conformers.xyz"] *= 2
    with pytest.raises(ValueError):
        parse_evidence(raw, document)


def test_issue494_compares_only_compatible_protocols(real_water):
    document, result = real_water
    raw = dict(result.native_artifacts)
    synthetic = b"\noptimization with very tight thresholds\nCREGEN> E lowest : -6.00000\n"
    raw["stdout.txt"] = synthetic + raw["stdout.txt"]
    with pytest.raises(ValueError, match="#494"):
        parse_evidence(raw, document)
    for protocol in (b"crude pre-optimization", b"optimization with tight thresholds"):
        raw["stdout.txt"] = (
            b"\n"
            + protocol
            + b"\nCREGEN> E lowest : -6.00000\n"
            + result.native_artifacts["stdout.txt"]
        )
        assert parse_evidence(raw, document)["members"]


@pytest.mark.parametrize("termination", ["cancel", "timeout"])
def test_actual_native_termination(tmp_path, termination):
    import time

    from chemdft_api.config import Settings

    document = native_input("butane")
    if termination == "timeout":
        document["conformer_search"]["timeout_seconds"] = 1
    start = time.monotonic()
    result = execute_native(
        document,
        CREST,
        Settings(),
        calculation_id="disposable-termination",
        on_tick=(lambda: False) if termination == "cancel" else None,
        workdir=tmp_path / termination,
    )
    assert time.monotonic() - start < 6
    assert result.result_document is None and result.exit_code != 0
    assert result.timed_out == (termination == "timeout")
    assert result.native_artifacts["stdout.txt"]
    assert json.loads(result.native_artifacts["execution.json"])["process_group_cleanup"]


@pytest.mark.parametrize("resource", ["output", "scratch", "retention"])
def test_live_resource_limits_do_not_accept_truncated_evidence(tmp_path, resource):
    from chemdft_api.config import Settings

    settings = Settings(
        **{
            "output": {"crest_max_output_bytes": 1024},
            "scratch": {"crest_max_scratch_bytes": 1024},
            "retention": {"crest_max_retained_bytes": 1024},
        }[resource]
    )
    result = execute_native(
        native_input("butane"),
        CREST,
        settings,
        calculation_id="resource-limit",
        workdir=tmp_path / resource,
    )
    assert result.result_document is None
    status = json.loads(result.native_artifacts["execution.json"])
    assert status["evidence_complete"] is False


@pytest.mark.parametrize(
    "case", ["atom_limit", "element", "spin", "charge", "coordinate", "order", "digest", "workflow"]
)
def test_unsupported_input_fails_before_execution(case):
    from chemdft_api.scientific.engines.crest import validate_input

    d = deepcopy(native_input())
    if case == "atom_limit":
        d["atoms"] *= 20
    elif case == "element":
        d["atoms"][0].update(element="N", atomic_number=7)
    elif case == "spin":
        d["multiplicity"] = 3
    elif case == "charge":
        d["charge"] = 1
    elif case == "coordinate":
        d["atoms"][0]["xyz_angstrom"][0] = float("inf")
    elif case == "order":
        d["atoms"][0]["index"] = 2
    elif case == "digest":
        d["engine_executable_sha256"] = "0" * 64
    elif case == "workflow":
        d["conformer_search"]["workflow"] = "unverified"
    with pytest.raises(ValueError):
        validate_input(d)


@pytest.mark.parametrize(
    "tamper",
    [
        "producer_id",
        "producer_type",
        "software",
        "attestation",
        "execution",
        "input",
        "project",
        "attempt",
        "hash",
        "bytes",
        "manifest",
        "energy",
        "geometry",
        "lease",
        "worker_json",
        "artifact_coverage",
    ],
)
def test_firewall_reparses_storage_and_rejects_tampering_atomically(api, monkeypatch, tamper):
    from chemdft_api import calculation_actions
    from chemdft_api.scientific_models import (
        CalculationResultRecord,
        ComputeLeaseRecord,
        ScientificArtifactRecord,
    )
    from chemdft_api.trusted_producers import ProducerType, issue_trusted_producer_context
    from sqlalchemy import func, select

    client, sessions, settings = api
    project, version, _, _ = submit(api)
    accept = calculation_actions.accept_authoritative_result

    def controlled(session, producer, submission, **kwargs):
        payload = submission.payload
        m = payload.manifest
        if tamper in {"producer_id", "producer_type", "attestation"}:
            producer = issue_trusted_producer_context(
                producer_id="local.xtb.worker" if tamper == "producer_id" else producer.producer_id,
                producer_type=ProducerType.VALIDATED_IMPORT_PIPELINE
                if tamper == "producer_type"
                else producer.producer_type,
                project_id=producer.project_id,
                attestation_id="wrong" if tamper == "attestation" else producer.attestation_id,
            )
        if tamper == "software":
            submission = submission.model_copy(
                update={
                    "producer_software": submission.producer_software.model_copy(
                        update={"name": "xtb"}
                    )
                }
            )
        if tamper == "execution":
            m = m.model_copy(update={"execution_id": uuid4()})
        if tamper == "input":
            m = m.model_copy(update={"input_structure_version_id": uuid4()})
        if tamper == "project":
            m = m.model_copy(update={"project_id": uuid4()})
        if tamper == "attempt":
            m = m.model_copy(update={"attempt_number": m.attempt_number + 1})
        if tamper in {"hash", "bytes"}:
            ref = next(a.artifact for a in m.native_artifacts if a.name == "crest_conformers.xyz")
            record = session.get(ScientificArtifactRecord, str(ref.artifact_id))
            if tamper == "hash":
                record.sha256 = "0" * 64
            else:
                (settings.object_root / record.storage_key).write_bytes(
                    b"corrupt persisted native bytes"
                )
        if tamper == "manifest":
            m = m.model_copy(update={"native_duplicate_count": 999})
        if tamper == "energy":
            a = m.members[0]
            a = a.model_copy(
                update={
                    "native_electronic_energy": a.native_electronic_energy.model_copy(
                        update={"value": -99.0}
                    )
                }
            )
            m = m.model_copy(update={"members": (a,)})
        if tamper == "geometry":
            a = m.members[0]
            coords = a.conformer.coordinates
            atom = coords.atoms[0].model_copy(update={"x": 99.0})
            a = a.model_copy(
                update={
                    "conformer": a.conformer.model_copy(
                        update={
                            "coordinates": coords.model_copy(
                                update={"atoms": (atom, *coords.atoms[1:])}
                            )
                        }
                    )
                }
            )
            m = m.model_copy(update={"members": (a,)})
        if tamper == "lease":
            session.scalar(select(ComputeLeaseRecord)).state = "EXPIRED"
        if tamper == "worker_json":
            # Worker JSON cannot substitute for absent persisted native bytes.
            ref = next(a.artifact for a in m.native_artifacts if a.name == "stdout.txt")
            record = session.get(ScientificArtifactRecord, str(ref.artifact_id))
            (settings.object_root / record.storage_key).write_bytes(b"")
        if tamper == "artifact_coverage":
            m = m.model_copy(
                update={
                    "native_artifacts": tuple(
                        a for a in m.native_artifacts if a.name != "stderr.txt"
                    )
                }
            )
        submission = submission.model_copy(
            update={"payload": payload.model_copy(update={"manifest": m})}
        )
        return accept(session, producer, submission, **kwargs)

    monkeypatch.setattr(calculation_actions, "accept_authoritative_result", controlled)
    detail = run_job(api)
    assert detail.calculation.state == "FAILED"
    assert detail.result is None and detail.attempt.failure_code == "RESULT_VALIDATION_FAILED"
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
        assert not any(
            a.format_identifier == "chemdft.conformer-ensemble-manifest"
            for a in session.scalars(select(ScientificArtifactRecord))
        )
    assert (
        len(
            client.get(
                f"/v1/projects/{project}/structures/{version['structure_id']}/versions"
            ).json()
        )
        == 1
    )


@pytest.mark.parametrize("failure", ["missing", "cancel", "timeout", "stale", "stale_tick"])
def test_backend_lifecycle_never_publishes_failed_or_stale_search(api, monkeypatch, failure):
    from dataclasses import replace
    from datetime import timedelta

    from chemdft_api.compute_gateway import LocalComputeProvider
    from chemdft_api.models import utc_now
    from chemdft_api.scientific_models import ComputeLeaseRecord
    from sqlalchemy import select

    client, sessions, _settings = api
    project, _version, queued, _ = submit(
        api,
        options={**ConformerSearchOptions().model_dump(mode="json"), "timeout_seconds": 1}
        if failure == "timeout"
        else None,
        name="butane" if failure == "timeout" else "water",
    )
    execute = LocalComputeProvider.execute

    def controlled(self, **kwargs):
        if failure == "stale_tick":
            with sessions() as other:
                lease = other.scalar(select(ComputeLeaseRecord))
                lease.heartbeat_deadline_at = utc_now() - timedelta(minutes=1)
                other.commit()
            assert kwargs["on_tick"]() is False
        result = execute(self, **kwargs)
        if failure == "missing":
            raw = dict(result.native_artifacts)
            raw.pop("crest_best.xyz", None)
            return replace(result, native_artifacts=raw)
        if failure == "cancel":
            assert (
                client.post(
                    f"/v1/projects/{project}/calculations/{queued['calculation']['id']}/cancel"
                ).status_code
                == 200
            )
        if failure == "stale":
            with sessions() as other:
                lease = other.scalar(select(ComputeLeaseRecord))
                lease.heartbeat_deadline_at = utc_now() - timedelta(minutes=1)
                other.commit()
        return result

    monkeypatch.setattr(LocalComputeProvider, "execute", controlled)
    detail = run_job(api)
    assert detail.result is None
    if failure == "cancel":
        assert detail.calculation.state == "CANCELED"
    elif failure == "timeout":
        assert detail.attempt.failure_code == "EXECUTION_TIMEOUT"
    elif failure in {"stale", "stale_tick"}:
        assert detail.calculation.state == "FAILED"
        assert detail.attempt.raw_artifacts
    else:
        assert detail.attempt.failure_code == "RESULT_VALIDATION_FAILED"


def test_host_wide_lock_blocks_parallel_claims(api, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from chemdft_api.compute_gateway import LocalComputeProvider

    _client, _, _ = api
    project, version, _, _ = submit(api)
    submit(api, project=project, version=version)
    started, release = Event(), Event()
    execute = LocalComputeProvider.execute

    def blocked(self, **kwargs):
        started.set()
        assert release.wait(30)
        return execute(self, **kwargs)

    monkeypatch.setattr(LocalComputeProvider, "execute", blocked)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(run_job, api)
        assert started.wait(10)
        second = pool.submit(run_job, api)
        assert second.result(5) is None
        release.set()
        assert first.result(30).calculation.state == "SUCCEEDED"
    assert run_job(api).calculation.state == "SUCCEEDED"


def test_simultaneous_same_key_submissions_are_idempotent(api):
    from concurrent.futures import ThreadPoolExecutor

    client, _sessions, _settings = api
    project, _version, _queued, request = submit(api)
    request = {**request, "idempotency_key": str(uuid4())}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda _: client.post(f"/v1/projects/{project}/calculations", json=request),
                range(2),
            )
        )
    assert all(r.status_code == 201 for r in responses), [r.text for r in responses]
    assert len({r.json()["calculation"]["id"] for r in responses}) == 1


def test_authoritative_rows_rollback_together_on_failure_after_firewall(api, monkeypatch):
    from chemdft_api import calculation_actions
    from chemdft_api.scientific_models import (
        CalculationRecord,
        CalculationResultRecord,
        ScientificArtifactRecord,
    )
    from sqlalchemy import func, select

    submit(api)
    accept = calculation_actions.accept_authoritative_result

    def fail_after_validation(*args, **kwargs):
        accept(*args, **kwargs)
        raise RuntimeError("injected crash after Firewall flush before commit")

    monkeypatch.setattr(calculation_actions, "accept_authoritative_result", fail_after_validation)
    with pytest.raises(RuntimeError, match="injected crash"):
        run_job(api)
    with api[1]() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
        assert session.scalar(select(CalculationRecord)).state == "RUNNING"
        assert not any(
            a.format_identifier == "chemdft.conformer-ensemble-manifest"
            for a in session.scalars(select(ScientificArtifactRecord))
        )


def test_additive_contracts_retain_existing_records():
    from chemdft_api.contracts.scientific import CalculationSpecification

    fixture = Path(__file__).parent / "fixtures/contracts/calculation-specification.json"
    old = CalculationSpecification.model_validate_json(fixture.read_text())
    assert old.conformer_search is None
    with pytest.raises(ValueError):
        ConformerSearchOptions(energy_window_kcal_mol=0.0)
    with pytest.raises(ValueError):
        ConformerSearchOptions(timeout_seconds=3601)


def test_outer_restart_fails_closed_pending_native_restart_acceptance(real_water):
    document, result = real_water
    raw = dict(result.native_artifacts)
    raw["stdout.txt"] = b"A new lower conformer was found!\n" + raw["stdout.txt"]
    with pytest.raises(ValueError, match="outer-restart integrity"):
        parse_evidence(raw, document)


def test_internal_window_changes_are_not_final_authorization(real_water):
    document, result = real_water
    raw = dict(result.native_artifacts)
    raw["stdout.txt"] = b"sorting energy window (EWIN) : 0.0000\n" + raw["stdout.txt"]
    assert parse_evidence(raw, document)["effective_ewin_kcal_mol"] == 6.0


def test_genuine_sorting_completion_is_not_search_completion(real_water):
    document, result = real_water
    raw = dict(result.native_artifacts)
    raw["stdout.txt"] = (FIXTURES / "candidate-cregen-6p0/stdout.txt").read_bytes()
    with pytest.raises(ValueError):
        parse_evidence(raw, document)


@pytest.mark.parametrize("field", ["calculator", "executable_sha256"])
def test_worker_calculator_or_digest_cannot_override_native_identity(api, monkeypatch, field):
    from dataclasses import replace

    from chemdft_api.compute_gateway import LocalComputeProvider

    submit(api)
    execute = LocalComputeProvider.execute

    def incorrect(self, **kwargs):
        result = execute(self, **kwargs)
        document = deepcopy(result.result_document)
        document["environment"][field] = "unverified"
        return replace(result, result_document=document)

    monkeypatch.setattr(LocalComputeProvider, "execute", incorrect)
    detail = run_job(api)
    assert detail.result is None and detail.attempt.failure_code == "RESULT_VALIDATION_FAILED"


def test_unmodified_crest_installation_cannot_be_selected():
    from chemdft_api.scientific.engines.registry import _probe_crest

    original = ROOT / ".chemdft/envs/crest-3.0.2-gate-a/bin/crest"
    assert _probe_crest(original)[0] == "MISCONFIGURED"
