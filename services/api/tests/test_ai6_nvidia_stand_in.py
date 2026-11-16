"""AI-6 offline checks: the loopback NVIDIA stand-in behaves like the endpoint the gateway expects.

The browser acceptance suite runs the real HTTP gateway against tools/e2e_offline/nvidia_stub.py.
These tests drive that stand-in through the same gateway so a mistake in the stand-in is found in
seconds rather than inside a browser run. The stand-in is not a model: nothing here is evidence
about any model, and no request leaves the machine.
"""

import json
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest
from chemdft_api.ai.gateway import (
    HttpOpenAIModelGateway,
    ModelAuthenticationError,
    ModelMessage,
    ModelRequest,
    ModelToolDefinition,
)
from chemdft_api.config import Settings
from pydantic import SecretStr

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools/e2e_offline"))

import nvidia_stub  # noqa: E402

SUPER = "nvidia/nemotron-3-super-120b-a12b"
CONTEXT = {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "selection": {"selected_structure_version_id": "22222222-2222-4222-8222-222222222222"},
}
TOOL = ModelToolDefinition("calculation.submit", "Propose a calculation.", {"type": "object"})


@pytest.fixture
def stand_in():
    server = ThreadingHTTPServer(("127.0.0.1", 0), nvidia_stub.Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    nvidia_stub._state.update(steps=[], repeat_last=False, log=[])
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/v1"
    finally:
        server.shutdown()
        server.server_close()


def gateway(base, key=nvidia_stub.STAND_IN_KEY):
    return HttpOpenAIModelGateway(
        Settings(
            _env_file=None,
            ai_provider="nvidia",
            ai_api_base_url=base,
            ai_api_key=SecretStr(key),
            run_ai_integration=True,
            ai_timeout_seconds=10,
        )
    )


def request(**overrides):
    fields = dict(
        system_prompt=nvidia_stub.CONTEXT_MARKER + json.dumps(CONTEXT),
        messages=(ModelMessage("user", "Calculate the HF/STO-3G energy."),),
        tools=(TOOL,),
        model_identifier=SUPER,
        max_tokens=1024,
        max_attempts=1,
    )
    return ModelRequest(**{**fields, **overrides})


def log():
    return list(nvidia_stub._state["log"])


def test_a_scripted_proposal_reaches_the_gateway_as_a_calculation_tool_call_for_the_context_ids(
    stand_in,
):
    nvidia_stub._state["steps"] = [
        {"kind": "propose", "method": "hf", "basis": "sto-3g"},
        {"kind": "text", "content": "Only energies can run here."},
    ]
    gw = gateway(stand_in)
    first = gw.generate(request())
    assert [c.name for c in first.tool_calls] == ["calculation.submit"]
    arguments = json.loads(first.tool_calls[0].arguments_json)
    assert arguments["structure_version"] == {
        "project_id": CONTEXT["project_id"],
        "entity_type": "structure.version",
        "entity_id": CONTEXT["selection"]["selected_structure_version_id"],
    }
    assert arguments["specification"]["method"] == {"identifier": "hf"}
    assert arguments["specification"]["engine_preference"] == {"engine": "pyscf"}
    assert (first.usage.input_tokens, first.usage.output_tokens) != (0, 0)
    assert first.model_identifier == SUPER and first.provider == "nvidia"
    second = gw.generate(request())
    assert second.content == "Only energies can run here." and not second.tool_calls
    assert [e["reply"] for e in log()] == ["propose", "text"]


def test_the_documented_sampling_is_what_arrives_and_reasoning_text_is_never_kept(stand_in):
    nvidia_stub._state["steps"] = [{"kind": "text", "content": "Done."}]
    response = gateway(stand_in).generate(
        request(
            temperature=1.0,
            top_p=0.95,
            chat_template_kwargs=(("enable_thinking", True), ("low_effort", True)),
        )
    )
    (seen,) = log()
    assert (seen["model"], seen["temperature"], seen["top_p"]) == (SUPER, 1.0, 0.95)
    assert seen["chat_template_kwargs"] == {"enable_thinking": True, "low_effort": True}
    assert seen["authorized"] and seen["tool_names"] == ["calculation__submit"]
    # The stand-in sent reasoning text; the gateway must have discarded it.
    assert nvidia_stub.REASONING_CANARY not in repr(response)


def test_a_default_request_carries_no_extra_sampling_fields(stand_in):
    nvidia_stub._state["steps"] = [{"kind": "text", "content": "Done."}]
    gateway(stand_in).generate(request())
    (seen,) = log()
    assert (seen["temperature"], seen["top_p"], seen["chat_template_kwargs"]) == (0.0, None, None)


def test_the_server_feedback_to_the_model_is_logged_as_code_and_fields_only(stand_in):
    nvidia_stub._state["steps"] = [{"kind": "text", "content": "Understood."}]
    refusal = {
        "code": "REQUEST_MISMATCH",
        "issues": [{"field": "specification.method.identifier", "message": "ignored"}],
        "next_step": "Send a corrected proposal.",
    }
    gateway(stand_in).generate(
        request(
            messages=(
                ModelMessage("user", "Calculate the B3LYP energy."),
                ModelMessage("tool", json.dumps(refusal), tool_call_id="call-1"),
            )
        )
    )
    (seen,) = log()
    assert seen["feedback"] == {
        "code": "REQUEST_MISMATCH",
        "fields": ["specification.method.identifier"],
        "has_next_step": True,
    }


def test_a_stubborn_script_repeats_and_an_empty_one_is_visible(stand_in):
    nvidia_stub._state.update(steps=[{"kind": "propose", "method": "hf", "basis": "sto-3g"}])
    nvidia_stub._state["repeat_last"] = True
    gw = gateway(stand_in)
    for _ in range(3):
        assert gw.generate(request()).tool_calls
    nvidia_stub._state.update(steps=[], repeat_last=False)
    gw.generate(request())
    assert [e["reply"] for e in log()] == ["propose"] * 3 + ["script_exhausted"]


def test_a_wrong_credential_is_refused_and_never_logged(stand_in):
    nvidia_stub._state["steps"] = [{"kind": "text", "content": "Done."}]
    with pytest.raises(ModelAuthenticationError):
        gateway(stand_in, key="some-other-key").generate(request())
    (seen,) = log()
    assert seen["authorized"] is False and seen["reply"] == "unauthorized"
    assert "some-other-key" not in json.dumps(log())


def test_the_stand_in_refuses_to_listen_beyond_loopback(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["nvidia_stub.py", "--port", "8999", "--host", "0.0.0.0"])
    assert nvidia_stub.main() == 2
