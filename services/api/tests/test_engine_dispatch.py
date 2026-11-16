from __future__ import annotations

import json
from pathlib import Path

import pytest
from chemdft_api.compute_gateway import (
    WORKLOAD_PYSCF_ENERGY,
    LocalComputeProvider,
)
from chemdft_api.errors import (
    UnsupportedCalculation,
)
from chemdft_api.scientific.engines.interfaces import ExecutionResult

XTB_EXECUTABLE = Path(__file__).resolve().parents[3] / ".chemdft/envs/xtb/bin/xtb"
SKIP_IF_NO_XTB = pytest.mark.skipif(
    not XTB_EXECUTABLE.is_file(),
    reason="requires the isolated xTB 6.7.1 environment at .chemdft/envs/xtb/bin/xtb",
)


def _make_h2_pyscf_input() -> bytes:
    return json.dumps(
        {
            "schema": "chemdft.calculation_input",
            "schema_version": "1.0.0",
            "task": "ENERGY",
            "method": "hf",
            "basis": "sto-3g",
            "charge": 0,
            "multiplicity": 1,
            "atoms": [
                {"element": "H", "xyz_angstrom": [0.0, 0.0, -0.37]},
                {"element": "H", "xyz_angstrom": [0.0, 0.0, 0.37]},
            ],
        },
        sort_keys=True,
    ).encode()


def _make_h2_xtb_input() -> bytes:
    return json.dumps(
        {
            "schema": "chemdft.calculation_input",
            "schema_version": "1.0.0",
            "task": "ENERGY",
            "method": "gfn2",
            "basis": None,
            "charge": 0,
            "multiplicity": 1,
            "atoms": [
                {"element": "H", "xyz_angstrom": [0.0, 0.0, -0.37]},
                {"element": "H", "xyz_angstrom": [0.0, 0.0, 0.37]},
            ],
        },
        sort_keys=True,
    ).encode()


# 1. Explicit PySCF routing
def test_explicit_pyscf_routing(api, monkeypatch) -> None:
    _client, _sessions, settings = api
    recorded = {}

    def fake_execute(self, request, **kwargs):
        recorded["script"] = request.worker_script.name
        recorded["calc_id"] = request.calculation_id
        return ExecutionResult(
            exit_code=0,
            timed_out=False,
            stdout=b"",
            stderr=b"",
            engine_log=b"",
            result_document={"engine": "pyscf", "total_energy_hartree": -1.117},
        )

    monkeypatch.setattr("chemdft_api.compute_gateway.LocalSubprocessRunner.execute", fake_execute)

    provider = LocalComputeProvider(settings)
    res = provider.execute(
        calculation_id="pyscf-explicit-1",
        normalized_input=_make_h2_pyscf_input(),
        engine="pyscf",
    )
    assert recorded["script"] == "pyscf_worker.py"
    assert recorded["calc_id"] == "pyscf-explicit-1"
    assert res.result_document.get("engine") == "pyscf"


# 2. Explicit xTB routing
@SKIP_IF_NO_XTB
def test_explicit_xtb_routing(api, monkeypatch) -> None:
    _client, _sessions, settings = api
    recorded = {}

    def fake_execute(self, request, **kwargs):
        recorded["script"] = request.worker_script.name
        recorded["calc_id"] = request.calculation_id
        recorded["extra_args"] = request.extra_args
        return ExecutionResult(
            exit_code=0,
            timed_out=False,
            stdout=b"",
            stderr=b"",
            engine_log=b"",
            result_document={"engine": "xtb", "total_energy_hartree": -0.98198},
        )

    monkeypatch.setattr("chemdft_api.compute_gateway.LocalSubprocessRunner.execute", fake_execute)

    provider = LocalComputeProvider(settings)
    res = provider.execute(
        calculation_id="xtb-explicit-1",
        normalized_input=_make_h2_xtb_input(),
        engine="xtb",
    )
    assert recorded["script"] == "xtb_worker.py"
    assert recorded["calc_id"] == "xtb-explicit-1"
    assert "--xtb-executable" in recorded["extra_args"]
    assert res.result_document.get("engine") == "xtb"


# 3. Forged engine identity rejected
def test_forged_engine_identity_rejected(api) -> None:
    _client, _sessions, settings = api
    provider = LocalComputeProvider(settings)

    # Authorized engine is PySCF, but client forged "xtb" in normalized input
    forged_input = json.dumps(
        {
            "schema": "chemdft.calculation_input",
            "schema_version": "1.0.0",
            "engine": "xtb",
            "task": "ENERGY",
            "method": "hf",
            "basis": "sto-3g",
        }
    ).encode()

    with pytest.raises(
        UnsupportedCalculation,
        match="Engine mismatch between authorized specification",
    ):
        provider.execute(
            calculation_id="forged-1",
            normalized_input=forged_input,
            engine="pyscf",
        )

    # Authorized engine is xTB, but forged "pyscf" in input
    forged_input_2 = json.dumps(
        {
            "schema": "chemdft.calculation_input",
            "schema_version": "1.0.0",
            "engine": "pyscf",
            "task": "ENERGY",
            "method": "gfn2",
            "basis": None,
        }
    ).encode()

    with pytest.raises(
        UnsupportedCalculation,
        match="Engine mismatch between authorized specification",
    ):
        provider.execute(
            calculation_id="forged-2",
            normalized_input=forged_input_2,
            engine="xtb",
        )


# 4. Method / engine mismatch rejected
def test_method_engine_mismatch_rejected(api) -> None:
    _client, _sessions, settings = api
    provider = LocalComputeProvider(settings)

    # PySCF requested with GFN2
    mismatched_pyscf = json.dumps(
        {
            "task": "ENERGY",
            "method": "gfn2",
            "basis": "sto-3g",
        }
    ).encode()
    with pytest.raises(
        UnsupportedCalculation,
        match="Method 'gfn2' is unsupported by PySCF engine adapter",
    ):
        provider.execute(
            calculation_id="mismatch-1",
            normalized_input=mismatched_pyscf,
            engine="pyscf",
        )

    # xTB requested with B3LYP
    mismatched_xtb_method = json.dumps(
        {
            "task": "ENERGY",
            "method": "b3lyp",
            "basis": None,
        }
    ).encode()
    with pytest.raises(
        UnsupportedCalculation,
        match="Method 'b3lyp' is unsupported by xTB engine adapter",
    ):
        provider.execute(
            calculation_id="mismatch-2",
            normalized_input=mismatched_xtb_method,
            engine="xtb",
        )

    # xTB requested with Gaussian basis
    mismatched_xtb_basis = json.dumps(
        {
            "task": "ENERGY",
            "method": "gfn2",
            "basis": "6-31g",
        }
    ).encode()
    with pytest.raises(UnsupportedCalculation, match="xTB does not support Gaussian basis sets"):
        provider.execute(
            calculation_id="mismatch-3",
            normalized_input=mismatched_xtb_basis,
            engine="xtb",
        )

    # xTB requested with unsupported task
    mismatched_xtb_task = json.dumps(
        {
            "task": "FREQUENCY",
            "method": "gfn2",
            "basis": None,
        }
    ).encode()
    with pytest.raises(
        UnsupportedCalculation,
        match="Task 'FREQUENCY' is unsupported by xTB engine adapter",
    ):
        provider.execute(
            calculation_id="mismatch-4",
            normalized_input=mismatched_xtb_task,
            engine="xtb",
        )


# 5. Missing engine identity fails closed (no method heuristics!)
def test_missing_engine_identity_fails_closed(api) -> None:
    _client, _sessions, settings = api
    provider = LocalComputeProvider(settings)

    # Ambiguous input with method="gfn2" but no engine specified
    # Must NOT guess "xtb"! Must fail closed!
    gfn2_input = json.dumps(
        {
            "task": "ENERGY",
            "method": "gfn2",
            "basis": None,
        }
    ).encode()

    with pytest.raises(UnsupportedCalculation, match="Explicit engine identity is required"):
        provider.execute(
            calculation_id="ambiguous-1",
            normalized_input=gfn2_input,
            engine=None,
            workload=None,
        )

    # Ambiguous input with method="hf" but no engine specified
    # Must NOT guess "pyscf"! Must fail closed!
    hf_input = json.dumps(
        {
            "task": "ENERGY",
            "method": "hf",
            "basis": "sto-3g",
        }
    ).encode()

    with pytest.raises(UnsupportedCalculation, match="Explicit engine identity is required"):
        provider.execute(
            calculation_id="ambiguous-2",
            normalized_input=hf_input,
            engine=None,
            workload=None,
        )


# 6. Existing queued PySCF jobs compatibility
def test_existing_queued_pyscf_jobs_compatibility(api, monkeypatch) -> None:
    _client, _sessions, settings = api
    recorded = {}

    def fake_execute(self, request, **kwargs):
        recorded["script"] = request.worker_script.name
        return ExecutionResult(
            exit_code=0,
            timed_out=False,
            stdout=b"",
            stderr=b"",
            engine_log=b"",
            result_document={"engine": "pyscf", "total_energy_hartree": -1.117},
        )

    monkeypatch.setattr("chemdft_api.compute_gateway.LocalSubprocessRunner.execute", fake_execute)

    provider = LocalComputeProvider(settings)

    # Queued job carrying WORKLOAD_PYSCF_ENERGY reference
    res = provider.execute(
        calculation_id="queued-pyscf-1",
        normalized_input=_make_h2_pyscf_input(),
        workload=WORKLOAD_PYSCF_ENERGY,
    )
    assert recorded["script"] == "pyscf_worker.py"
    assert res.result_document.get("engine") == "pyscf"


# 7. Historical normalized input compatibility
def test_historical_normalized_input_compatibility(api, monkeypatch) -> None:
    _client, _sessions, settings = api

    # Historical normalized input v1.0.0 has NO "engine" field
    historical_payload = _make_h2_pyscf_input()
    doc = json.loads(historical_payload)
    assert "engine" not in doc
    assert doc["schema"] == "chemdft.calculation_input"
    assert doc["schema_version"] == "1.0.0"

    recorded = {}

    def fake_execute(self, request, **kwargs):
        recorded["script"] = request.worker_script.name
        # Verify the raw bytes received by runner are exactly the historical bytes
        assert request.normalized_input == historical_payload
        return ExecutionResult(
            exit_code=0,
            timed_out=False,
            stdout=b"",
            stderr=b"",
            engine_log=b"",
            result_document={"engine": "pyscf", "total_energy_hartree": -1.117},
        )

    monkeypatch.setattr("chemdft_api.compute_gateway.LocalSubprocessRunner.execute", fake_execute)

    provider = LocalComputeProvider(settings)
    res = provider.execute(
        calculation_id="hist-1",
        normalized_input=historical_payload,
        engine="pyscf",
    )
    assert recorded["script"] == "pyscf_worker.py"
    assert res.result_document.get("engine") == "pyscf"


# 8. Unsupported engine rejected
def test_unsupported_engine_rejected(api) -> None:
    _client, _sessions, settings = api
    provider = LocalComputeProvider(settings)

    with pytest.raises(UnsupportedCalculation, match="Unsupported calculation engine: 'turbomole'"):
        provider.execute(
            calculation_id="bad-engine-1",
            normalized_input=_make_h2_pyscf_input(),
            engine="turbomole",
        )

    with pytest.raises(
        UnsupportedCalculation,
        match="Unsupported calculation engine: 'quantum-espresso'",
    ):
        provider.execute(
            calculation_id="bad-engine-2",
            normalized_input=_make_h2_pyscf_input(),
            engine="quantum-espresso",
        )


# 9. Wrong engine version rejected
@SKIP_IF_NO_XTB
def test_wrong_engine_version_rejected(api) -> None:
    _client, _sessions, settings = api
    provider = LocalComputeProvider(settings)

    # Installed is 6.7.1, requesting 6.7.0 must fail
    with pytest.raises(UnsupportedCalculation, match=r"violates requested constraint '6\.7\.0'"):
        provider.execute(
            calculation_id="wrong-ver-1",
            normalized_input=_make_h2_xtb_input(),
            engine="xtb",
            allowed_version="6.7.0",
        )

    # Requesting wrong PySCF version
    with pytest.raises(UnsupportedCalculation, match=r"violates requested constraint '1\.0\.0'"):
        provider.execute(
            calculation_id="wrong-ver-2",
            normalized_input=_make_h2_pyscf_input(),
            engine="pyscf",
            allowed_version="1.0.0",
        )


# 10. Executed engine mismatch with requested engine
def test_executed_engine_mismatch_fails_closed(api, monkeypatch) -> None:
    _client, _sessions, settings = api

    # Simulate rogue worker returning pyscf when xtb was requested
    def rogue_execute(self, request, **kwargs):
        return ExecutionResult(
            exit_code=0,
            timed_out=False,
            stdout=b"",
            stderr=b"",
            engine_log=b"",
            result_document={"engine": "pyscf", "total_energy_hartree": -0.98},
        )

    monkeypatch.setattr("chemdft_api.compute_gateway.LocalSubprocessRunner.execute", rogue_execute)

    provider = LocalComputeProvider(settings)
    with pytest.raises(
        ValueError,
        match="Executed engine 'pyscf' does not match requested engine 'xtb'",
    ):
        provider.execute(
            calculation_id="rogue-1",
            normalized_input=_make_h2_xtb_input(),
            engine="xtb",
        )
