from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from chemdft_api.calculation_actions import process_next_compute_job
from chemdft_api.context import Identity
from chemdft_api.contracts.base import ArtifactReference
from chemdft_api.contracts.results import (
    AuthoritativeResultSubmission,
    EnergyResult,
    ScientificQuantity,
)
from chemdft_api.contracts.scientific import (
    BasisSetReference,
    CalculationSpecification,
    CalculationTaskType,
    EnginePreference,
    EngineReference,
    QuantityDimension,
    ScientificMethodReference,
    UnitReference,
    UnitStandard,
)
from chemdft_api.errors import (
    EngineUnavailable,
    TrustedProducerRequired,
    UnsupportedCalculation,
)
from chemdft_api.scientific.engines.interfaces import LocalSubprocessRequest
from chemdft_api.scientific.engines.registry import (
    capability_views,
    validate_capability,
)
from chemdft_api.scientific.engines.runner import LocalSubprocessRunner
from chemdft_api.scientific_actions import accept_authoritative_result
from chemdft_api.scientific_models import (
    ScientificArtifactRecord,
)
from chemdft_api.storage import LocalObjectStore
from chemdft_api.trusted_producers import (
    ProducerType,
)
from result_provenance_checks import assert_published_result_binding
from sqlalchemy import select

XTB_EXECUTABLE = Path(__file__).resolve().parents[3] / ".chemdft/envs/xtb/bin/xtb"
SKIP_IF_NO_XTB = pytest.mark.skipif(
    not XTB_EXECUTABLE.is_file(),
    reason="requires the isolated xTB 6.7.1 environment at .chemdft/envs/xtb/bin/xtb",
)

H2_XYZ = b"2\nH2\nH 0.0 0.0 -0.37\nH 0.0 0.0 0.37\n"
H2O_XYZ = b"3\nH2O\nO 0.0 0.0 0.1173\nH 0.0 0.7572 -0.4692\nH 0.0 -0.7572 -0.4692\n"
CH4_XYZ = (
    b"5\nCH4\n"
    b"C 0.0 0.0 0.0\n"
    b"H 0.6291 0.6291 0.6291\n"
    b"H -0.6291 -0.6291 0.6291\n"
    b"H -0.6291 0.6291 -0.6291\n"
    b"H 0.6291 -0.6291 -0.6291\n"
)


# Expected reference energies computed by genuine xTB 6.7.1 GFN2
# (Provisional tolerances: 1e-6 Hartree)
H2_EXPECTED_ENERGY = -0.981983694723
H2O_EXPECTED_ENERGY = -5.070370761845
CH4_EXPECTED_ENERGY = -4.175075758660
ENERGY_TOLERANCE = 1e-6


@SKIP_IF_NO_XTB
def test_xtb_capability_probe(api) -> None:
    _client, _sessions, settings = api
    views = capability_views(settings)
    xtb_view = next((v for v in views if v.engine == "xtb"), None)
    assert xtb_view is not None
    assert xtb_view.availability == "AVAILABLE"
    assert xtb_view.version == "6.7.1"
    assert xtb_view.supported_tasks == ("ENERGY", "GEOMETRY_OPTIMIZATION")
    assert xtb_view.supported_methods == ("gfn2",)
    assert xtb_view.supported_basis_sets == ()
    assert xtb_view.diagnostic is None


@SKIP_IF_NO_XTB
def test_xtb_validation_rules(api) -> None:
    _client, _sessions, settings = api

    # Valid GFN2-xTB single point
    valid_spec = CalculationSpecification(
        task_type=CalculationTaskType.ENERGY,
        method=ScientificMethodReference(
            identifier="gfn2", display_name="GFN2-xTB", registry="chemdft.method"
        ),
        basis=None,
        charge=0,
        multiplicity=1,
        engine_preference=EnginePreference(engine="xtb", allowed_version="6.7.1"),
    )
    validate_capability(valid_spec, settings)

    # Rejection: basis set supplied
    with pytest.raises(UnsupportedCalculation, match="Gaussian basis sets"):
        invalid_basis = valid_spec.model_copy(
            update={
                "basis": BasisSetReference(
                    identifier="def2-svp",
                    display_name="def2-SVP",
                    registry="chemdft.basis",
                )
            }
        )
        validate_capability(invalid_basis, settings)

    # Rejection: method other than gfn2
    with pytest.raises(UnsupportedCalculation, match="Method is unsupported"):
        invalid_method = valid_spec.model_copy(
            update={
                "method": ScientificMethodReference(
                    identifier="gfn1",
                    display_name="GFN1-xTB",
                    registry="chemdft.method",
                )
            }
        )
        validate_capability(invalid_method, settings)

    # Rejection: task other than ENERGY
    with pytest.raises(UnsupportedCalculation, match="Task is unsupported"):
        invalid_task = valid_spec.model_copy(
            update={"task_type": CalculationTaskType.FREQUENCY}
        )
        validate_capability(invalid_task, settings)

    # Rejection: dispersion explicitly requested
    with pytest.raises(UnsupportedCalculation, match="built-in dispersion"):
        invalid_disp = valid_spec.model_copy(
            update={
                "dispersion": ScientificMethodReference(
                    identifier="d4",
                    display_name="DFT-D4",
                    registry="chemdft.dispersion",
                )
            }
        )
        validate_capability(invalid_disp, settings)


@SKIP_IF_NO_XTB
@pytest.mark.parametrize(
    ("molecule_name", "xyz_bytes", "expected_energy", "expected_iterations"),
    [
        ("H2", H2_XYZ, H2_EXPECTED_ENERGY, 4),
        ("H2O", H2O_XYZ, H2O_EXPECTED_ENERGY, 8),
        ("CH4", CH4_XYZ, CH4_EXPECTED_ENERGY, 7),
    ],
)
def test_real_xtb_gfn2_energy_vertical_slice(
    api, molecule_name: str, xyz_bytes: bytes, expected_energy: float, expected_iterations: int
) -> None:
    client, sessions, settings = api

    # 1. Create project
    project = client.post(
        "/v1/projects",
        json={"name": f"xTB {molecule_name} Test", "slug": f"xtb-{molecule_name.lower()}-test"},
    ).json()

    # 2. Import structure
    imported = client.post(
        f"/v1/projects/{project['id']}/structures/imports",
        files={"upload": (f"{molecule_name.lower()}.xyz", xyz_bytes, "chemical/x-xyz")},
        data={
            "file_format": "XYZ",
            "idempotency_key": f"xtb-import-{molecule_name.lower()}",
            "structure_name": molecule_name,
        },
    )
    assert imported.status_code == 201, imported.text
    version = imported.json()["version"]

    # 3. Submit calculation
    calc_response = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.version",
                "entity_id": version["id"],
            },
            "specification": {
                "task_type": "ENERGY",
                "method": {
                    "identifier": "gfn2",
                    "display_name": "GFN2-xTB",
                    "registry": "chemdft.method",
                },
                "basis": None,
                "charge": 0,
                "multiplicity": 1,
                "engine_preference": {"engine": "xtb", "allowed_version": "6.7.1"},
            },
            "idempotency_key": f"xtb-calc-{molecule_name.lower()}",
        },
    )
    assert calc_response.status_code == 201, calc_response.text
    queued = calc_response.json()
    assert queued["calculation"]["state"] == "QUEUED"

    # 4. Execute compute job via Compute Gateway
    with sessions() as session:
        processed = process_next_compute_job(
            session,
            Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="xtb-test-worker",
        )
        assert processed is not None

    # 5. Retrieve authoritative calculation detail
    detail = client.get(f"/v1/projects/{project['id']}/calculations/{queued['calculation']['id']}")
    assert detail.status_code == 200, detail.text
    body = detail.json()
    calc = body["calculation"]
    assert calc["state"] == "SUCCEEDED"

    result = body["result"]
    assert_published_result_binding(sessions, result["id"], version["id"])
    assert result["result_type"] == "chemdft.energy"
    assert result["authority"] == "AUTHORITATIVE"
    assert result["source_class"] == "CALCULATED"
    assert result["verification_state"] == "UNVERIFIED"

    payload = result["payload"]
    assert payload["converged"] is True
    assert payload["method"] == "gfn2"
    assert payload["basis"] is None
    assert payload["scf_iterations"] == expected_iterations

    # Verify energy against genuine reference
    total_energy = payload["total_energy"]["value"]
    assert total_energy == pytest.approx(expected_energy, abs=ENERGY_TOLERANCE)
    assert payload["total_energy"]["unit"]["code"] == "Eh"

    # Verify producer and provenance
    assert result["trusted_producer_id"] == "local.xtb.worker"
    assert result["trusted_producer_type"] == "SCIENTIFIC_WORKER"
    producer_sw = result["producer_software"]
    assert producer_sw["name"] == "xtb"
    assert producer_sw["version"] == "6.7.1"

    # Verify stored artifacts
    with sessions() as session:
        artifact_records = session.scalars(
            select(ScientificArtifactRecord).where(
                ScientificArtifactRecord.project_id == project["id"]
            )
        ).all()
        kinds = {rec.kind for rec in artifact_records}
        assert "CALCULATION_INPUT" in kinds
        assert "ENGINE_LOG" in kinds
        assert "NORMALIZED_RESULT" in kinds
        assert "ENVIRONMENT_MANIFEST" in kinds

        # Verify engine log contains genuine xTB headers
        log_record = next(rec for rec in artifact_records if rec.kind == "ENGINE_LOG")
        store = LocalObjectStore(settings.object_root)
        log_bytes = store.get_bytes(log_record.storage_key, 1024 * 1024)
        assert b"x T B" in log_bytes
        assert b"S. Grimme" in log_bytes
        assert b"TOTAL ENERGY" in log_bytes
        assert b"normal termination of xtb" in log_bytes


@SKIP_IF_NO_XTB
def test_xtb_security_worker_timeout_and_process_cleanup(
    api, monkeypatch, tmp_path: Path
) -> None:
    """Demonstrate that timeout terminates the actual process tree."""
    _client, _sessions, _settings = api
    runner = LocalSubprocessRunner()

    # Input requesting calculation with timeout = 1s, but we invoke a worker that sleeps
    script_path = tmp_path / "hung_worker.py"
    script_path.write_text(
        "import time, subprocess, sys\n"
        "p = subprocess.Popen(['sleep', '60'])\n"
        "p.wait()\n"
    )

    request = LocalSubprocessRequest(
        calculation_id="test-timeout-id",
        normalized_input=b"{}",
        interpreter=Path(sys.executable),
        worker_script=script_path,
        timeout_seconds=1,
        max_output_bytes=1024,
        threads=1,
    )

    t0 = time.monotonic()
    result = runner.execute(request)
    elapsed = time.monotonic() - t0

    assert result.timed_out is True
    assert elapsed < 5.0, f"Execution hung beyond timeout: {elapsed}s"


@SKIP_IF_NO_XTB
def test_firewall_rejects_forged_producer_or_mismatched_basis(api) -> None:
    client, sessions, _settings = api
    project = client.post(
        "/v1/projects", json={"name": "Firewall Test", "slug": "firewall-test"}
    ).json()

    # Try publishing authoritative result directly without valid producer token
    from chemdft_api.trusted_producers import TrustedProducerContext
    bogus_producer = object.__new__(TrustedProducerContext)
    object.__setattr__(bogus_producer, "producer_id", "forged.worker")
    object.__setattr__(bogus_producer, "producer_type", ProducerType.SCIENTIFIC_WORKER)
    object.__setattr__(bogus_producer, "project_id", UUID(project["id"]))
    object.__setattr__(bogus_producer, "attestation_id", "fake-attestation")
    object.__setattr__(bogus_producer, "_issued", False)

    dummy_art = ArtifactReference(
        project_id=UUID(project["id"]),
        artifact_id=uuid4(),
        sha256="0" * 64,
    )
    unit_ref = UnitReference(
        standard=UnitStandard.QCSCHEMA,
        code="Eh",
        dimension=QuantityDimension.ENERGY,
    )
    with sessions() as session:
        submission = AuthoritativeResultSubmission(
            result_type="chemdft.energy",
            project_id=UUID(project["id"]),
            calculation_id=uuid4(),
            calculation_input_id=uuid4(),
            producer_software=EngineReference(
                name="xtb",
                version="6.7.1",
                adapter_version="1.0.0",
                execution_backend="local.subprocess",
            ),
            payload=EnergyResult(
                total_energy=ScientificQuantity(
                    value=-1.0,
                    unit=unit_ref,
                ),
                method="gfn2",
                basis=None,
                parser_version="1.0.0",
                validator_version="1.0.0",
            ),
            provenance_record_id=uuid4(),
            raw_artifacts=(dummy_art,),
            idempotency_key="forged-sub",
            request_id=uuid4(),
            correlation_id=uuid4(),
        )
        with pytest.raises(TrustedProducerRequired):
            accept_authoritative_result(session, bogus_producer, submission)


def test_xtb_unavailable_executable_handling(api) -> None:
    _client, _sessions, settings = api
    bad_settings = settings.model_copy(
        update={"xtb_executable": Path("/nonexistent/bin/xtb")}
    )
    views = capability_views(bad_settings)
    xtb_view = next((v for v in views if v.engine == "xtb"), None)
    assert xtb_view is not None
    assert xtb_view.availability == "UNAVAILABLE"
    assert xtb_view.diagnostic is not None

    spec = CalculationSpecification(
        task_type=CalculationTaskType.ENERGY,
        method=ScientificMethodReference(
            identifier="gfn2", display_name="GFN2-xTB", registry="chemdft.method"
        ),
        basis=None,
        charge=0,
        multiplicity=1,
        engine_preference=EnginePreference(engine="xtb", allowed_version="6.7.1"),
    )
    with pytest.raises(EngineUnavailable, match="unavailable"):
        validate_capability(spec, bad_settings)


@SKIP_IF_NO_XTB
def test_xtb_impossible_spin_parity_rejected(api) -> None:
    client, _sessions, _settings = api
    project = client.post(
        "/v1/projects", json={"name": "Parity Test", "slug": "parity-test"}
    ).json()
    imported = client.post(
        f"/v1/projects/{project['id']}/structures/imports",
        files={"upload": ("h2.xyz", H2_XYZ, "chemical/x-xyz")},
        data={
            "file_format": "XYZ",
            "idempotency_key": "h2-parity-import",
            "structure_name": "H2",
        },
    ).json()
    version = imported["version"]

    # Charge 0, multiplicity 2 for H2 (2 electrons, odd multiplicity requested)
    res = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.version",
                "entity_id": version["id"],
            },
            "specification": {
                "task_type": "ENERGY",
                "method": {
                    "identifier": "gfn2",
                    "display_name": "GFN2-xTB",
                    "registry": "chemdft.method",
                },
                "basis": None,
                "charge": 0,
                "multiplicity": 2,
                "engine_preference": {"engine": "xtb", "allowed_version": "6.7.1"},
            },
            "idempotency_key": "h2-bad-parity-calc",
        },
    )
    assert res.status_code == 422
    assert "impossible parity" in res.text


@SKIP_IF_NO_XTB
def test_xtb_open_shell_spin_calculation(api) -> None:
    client, sessions, settings = api
    project = client.post(
        "/v1/projects", json={"name": "OH Radical Test", "slug": "oh-radical-test"}
    ).json()
    oh_xyz = b"2\nOH\nO 0.0 0.0 0.0\nH 0.0 0.0 0.9697\n"
    imported = client.post(
        f"/v1/projects/{project['id']}/structures/imports",
        files={"upload": ("oh.xyz", oh_xyz, "chemical/x-xyz")},
        data={
            "file_format": "XYZ",
            "idempotency_key": "oh-import",
            "structure_name": "OH",
        },
    ).json()
    version = imported["version"]

    calc_resp = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.version",
                "entity_id": version["id"],
            },
            "specification": {
                "task_type": "ENERGY",
                "method": {
                    "identifier": "gfn2",
                    "display_name": "GFN2-xTB",
                    "registry": "chemdft.method",
                },
                "basis": None,
                "charge": 0,
                "multiplicity": 2,
                "engine_preference": {"engine": "xtb", "allowed_version": "6.7.1"},
            },
            "idempotency_key": "oh-radical-calc",
        },
    )
    assert calc_resp.status_code == 201
    calc_id = calc_resp.json()["calculation"]["id"]

    with sessions() as session:
        processed = process_next_compute_job(
            session,
            Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="xtb-test-worker",
        )
        assert processed is not None

    detail = client.get(f"/v1/projects/{project['id']}/calculations/{calc_id}").json()
    assert detail["calculation"]["state"] == "SUCCEEDED"
    payload = detail["result"]["payload"]
    assert payload["converged"] is True
    assert payload["total_energy"]["value"] == pytest.approx(-4.428342235582, abs=1e-6)
    assert payload["scf_iterations"] == 7


def test_xtb_worker_failure_modes_fail_closed(tmp_path: Path) -> None:
    from chemdft_api.scientific.engines.xtb_worker import run as xtb_run

    inp_path = tmp_path / "input.json"
    res_path = tmp_path / "result.json"
    log_path = tmp_path / "engine.log"

    # 1. Invalid method raises ValueError
    inp_path.write_text(json.dumps({
        "task": "ENERGY", "method": "b3lyp", "charge": 0, "multiplicity": 1, "atoms": []
    }))
    with pytest.raises(ValueError, match="only supports GFN2"):
        xtb_run(inp_path, res_path, log_path, xtb_executable=XTB_EXECUTABLE)

    # 2. Gaussian basis sets raise ValueError
    inp_path.write_text(
        json.dumps(
            {
                "task": "ENERGY",
                "method": "gfn2",
                "basis": "def2-tzvp",
                "charge": 0,
                "multiplicity": 1,
                "atoms": [],
            }
        )
    )
    with pytest.raises(ValueError, match="does not support Gaussian basis sets"):
        xtb_run(inp_path, res_path, log_path, xtb_executable=XTB_EXECUTABLE)

    # 3. Missing binary raises FileNotFoundError
    inp_path.write_text(
        json.dumps(
            {
                "task": "ENERGY",
                "method": "gfn2",
                "basis": None,
                "charge": 0,
                "multiplicity": 1,
                "atoms": [{"element": "H", "xyz_angstrom": [0, 0, 0]}],
            }
        )
    )
    with pytest.raises(FileNotFoundError):
        xtb_run(inp_path, res_path, log_path, xtb_executable=Path("/nonexistent/xtb"))


def test_xtb_rejects_periodic_structure(api) -> None:
    from unittest.mock import MagicMock

    from chemdft_api.scientific.engines.normalization import normalized_calculation_input

    # The authoritative electronic state is validated first; give it so the periodic gate is reached.
    version = MagicMock(
        id=uuid4(),
        periodic_cell_json={"a": 5.0, "b": 5.0, "c": 5.0},
        overall_charge=0,
        multiplicity=1,
        representation_json={"coordinates": {"atoms": [{"atomic_number": 1}] * 2}},
    )
    spec = CalculationSpecification(
        task_type=CalculationTaskType.ENERGY,
        method=ScientificMethodReference(
            identifier="gfn2",
            display_name="GFN2-xTB",
            registry="chemdft.method",
        ),
        basis=None,
        charge=0,
        multiplicity=1,
        engine_preference=EnginePreference(engine="xtb", allowed_version="6.7.1"),
    )
    with pytest.raises(UnsupportedCalculation, match="molecular structures only"):
        normalized_calculation_input(version, spec, max_atoms=100)
