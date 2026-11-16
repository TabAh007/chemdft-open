"""Gate B.2: real owned-process stops while a separate native Psi4 run survives."""

import json
import os
import subprocess

import pytest
from chemdft_api.compute_gateway import LocalComputeProvider
from chemdft_api.scientific.engines.psi4 import (
    command,
    encode,
    native_environment,
    validate_input,
)
from test_psi4_integration import (
    CLI,
    FIXTURES,
    assert_reconciled,
    native_document,
    save_native,
    save_outcome,
    submit,
)
from test_xtb_optimization import run_job

pytestmark = pytest.mark.scientific_integration


@pytest.mark.parametrize("stop", ["timeout", "cancel"])
def test_real_stop_preserves_unrelated_native_process(api, monkeypatch, tmp_path, stop):
    project, _, queued, _ = submit(api)
    assert queued.status_code == 201
    unrelated_root = tmp_path / "unrelated-native"
    unrelated_root.mkdir()
    (unrelated_root / "scratch").mkdir()
    (unrelated_root / "tmp").mkdir()
    document = native_document("hf", "sto-3g")
    (unrelated_root / "input.json").write_bytes(encode(validate_input(document)))
    unrelated = None
    observed = {}
    execute = LocalComputeProvider.execute

    def controlled(self, **kwargs):
        nonlocal unrelated
        if stop == "timeout":
            self._settings = self._settings.model_copy(
                update={"scientific_execution_timeout_seconds": 0.25}
            )
        tick = kwargs["on_tick"]

        def launch_and_tick():
            nonlocal unrelated
            if unrelated is None:
                # This callback runs only after the target's Popen has started.
                unrelated = subprocess.Popen(
                    command(CLI, unrelated_root), cwd=unrelated_root,
                    env=native_environment(CLI, unrelated_root),
                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, start_new_session=True,
                )
                assert unrelated.poll() is None
                if stop == "cancel":
                    response = api[0].post(
                        f"/v1/projects/{project}/calculations/"
                        f"{queued.json()['calculation']['id']}/cancel"
                    )
                    assert response.status_code == 200
            return tick()

        kwargs["on_tick"] = launch_and_tick
        result = execute(self, **kwargs)
        save_native(f"b2-real-{stop}", result, json.loads(kwargs["normalized_input"]))
        status = json.loads(result.native_artifacts["execution.json"])
        assert status["termination_reason"] == (
            "wall timeout" if stop == "timeout" else "canceled or lease lost"
        )
        assert status["process_group_cleanup"] and status["scratch_cleanup_complete"]
        assert status["exit_code"] != 0 and not status["evidence_complete"]
        assert result.timed_out is (stop == "timeout")
        assert unrelated is not None and unrelated.pid != status["process_group_id"]
        with pytest.raises(ProcessLookupError):
            os.killpg(status["process_group_id"], 0)
        _, stderr = unrelated.communicate(timeout=30)
        assert unrelated.returncode == 0, stderr
        output = json.loads((unrelated_root / "output.json").read_bytes())
        golden = json.loads((FIXTURES / "hf-sto-3g-output.json").read_bytes())
        assert output["success"] is True
        assert output["return_result"] == pytest.approx(golden["return_result"], abs=1e-12, rel=0)
        observed.update({
            "owned": status, "unrelated_pid": unrelated.pid,
            "unrelated_exit_code": unrelated.returncode,
            "unrelated_energy_hartree": output["return_result"],
        })
        evidence = os.environ.get("CHEMDFT_PF8D_EVIDENCE")
        if evidence:
            from pathlib import Path

            root = Path(evidence) / f"unrelated-native-{stop}"
            root.mkdir()
            for name in ["input.json", "output.json"]:
                (root / name).write_bytes((unrelated_root / name).read_bytes())
            (root / "observations.json").write_bytes(encode(observed))
        return result

    monkeypatch.setattr(LocalComputeProvider, "execute", controlled)
    try:
        detail = run_job(api)
        save_outcome(f"b2-real-{stop}", detail)
        expected = "FAILED" if stop == "timeout" else "CANCELED"
        assert detail.result is None and detail.calculation.state == expected
        assert_reconciled(api, expected)
        assert observed
    finally:
        if unrelated is not None and unrelated.poll() is None:
            from chemdft_api.scientific.engines.crest import _terminate

            _terminate(unrelated)
