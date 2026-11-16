"""Live-fix 2: the model must be OFFERED the proposal tool, and a proposal run that ends
without a proposal must fail loudly instead of returning a chat refusal."""

from __future__ import annotations

from chemdft_api.ai import providers
from test_ai_60_completion import ScriptedCapture
from test_ai_execution_durability import _final_response
from test_ai_scientist import _create_project, _import_h2


def _post(client, project_id, parent_version_id, profile, content):
    conv = client.post(f"/v1/projects/{project_id}/ai/conversations", json={})
    conv_id = conv.json()["conversation"]["id"]
    return client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json={
            "content": content,
            "planning_profile": profile,
            "selected_structure_version_id": parent_version_id,
            "run_limits": {
                "max_model_calls": 1,
                "max_input_tokens": 20000,
                "max_output_tokens": 2048,
            },
        },
    )


def test_structure_edit_run_sends_the_proposal_tool_to_the_model(api, monkeypatch):
    client, _sessions, _settings = api
    project_id = _create_project(client)["id"]
    parent = _import_h2(client, project_id)["version"]["id"]
    capture = ScriptedCapture(_final_response())
    monkeypatch.setattr(providers, "build_model_gateway", lambda _s: capture)
    _post(client, project_id, parent, "STRUCTURE_EDIT_PROPOSAL", "Add an oxygen atom.")
    assert capture.requests, "the model was never called"
    offered = {t.name for t in capture.requests[0].tools}
    assert "structure.edit.propose" in offered, f"model was offered only {sorted(offered)}"


def test_proposal_run_without_a_proposal_fails_loudly(api, monkeypatch):
    client, _sessions, _settings = api
    project_id = _create_project(client)["id"]
    parent = _import_h2(client, project_id)["version"]["id"]
    capture = ScriptedCapture(_final_response())  # plain text, no tool call
    monkeypatch.setattr(providers, "build_model_gateway", lambda _s: capture)
    resp = _post(client, project_id, parent, "STRUCTURE_EDIT_PROPOSAL", "Add an oxygen atom.")
    run = resp.json()["latest_run"]
    assert run["status"] == "FAILED"
    assert run["error_code"] == "PROPOSAL_NOT_PRODUCED"
    assert "Nothing was changed" in run["error_detail"]


def test_periodic_proposal_without_a_prior_periodic_run_is_refused_not_invented(api, monkeypatch):
    import json

    from chemdft_api.ai.gateway import ModelToolCall
    from test_ai_60_completion import CIF_NACL, _tool_response

    client, _sessions, _settings = api
    project_id = _create_project(client)["id"]
    from uuid import uuid4

    cif = client.post(
        f"/v1/projects/{project_id}/structures/imports",
        data={"file_format": "CIF", "idempotency_key": f"cif-{uuid4().hex}"},
        files={"upload": ("nacl.cif", CIF_NACL, "chemical/x-cif")},
    )
    version_id = cif.json()["version"]["id"]
    call = ModelToolCall(
        id="c1",
        name="calculation.submit",
        arguments_json=json.dumps(
            {
                "structure_version": {
                    "project_id": project_id,
                    "entity_type": "structure.version",
                    "entity_id": version_id,
                },
                "idempotency_key": "p-1",
            }
        ),
    )
    capture = ScriptedCapture(_tool_response(call))
    monkeypatch.setattr(providers, "build_model_gateway", lambda _s: capture)
    resp = _post(client, project_id, version_id, "PERIODIC_ENERGY_PROPOSAL", "Prepare it.")
    run = resp.json()["latest_run"]
    assert run["status"] != "WAITING_FOR_APPROVAL"  # no approval card without a source run
