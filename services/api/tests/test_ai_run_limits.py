"""Offline lower-only caps using isolated databases and labeled scripted gateways.

These checks are not live NVIDIA acceptance or scientific-result evidence.
"""

from uuid import uuid4

import pytest
from chemdft_api.ai.budgets import AIBudgetExceededError, AIRunBudget
from chemdft_api.ai.gateway import ModelToolCall
from chemdft_api.ai.service import AIScientistService
from chemdft_api.ai_models import AIRunRecord
from chemdft_api.context import Identity
from chemdft_api.contracts.ai import PostMessageInput
from chemdft_api.storage import LocalObjectStore
from test_ai_execution_durability import (
    ScriptedGateway,
    _final_response,
    _tool_response,
)
from test_ai_scientist import _create_project


def conversation(api):
    client, _, _ = api
    project = _create_project(client)
    base = f"/v1/projects/{project['id']}/ai"
    conv = client.post(f"{base}/conversations", json={"title": "Offline cap test"}).json()
    return project["id"], conv["conversation"]["id"], base


@pytest.mark.parametrize(
    "limits",
    [
        {"max_model_calls": 16},
        {"max_output_tokens": 12_001},
        {"max_input_tokens": 60_001},
        {"max_tool_calls": 31},
        {"max_model_calls": True},
        {"max_model_calls": "2"},
        {"max_model_calls": 0},
        {"input_tokens_used": 0},
    ],
)
def test_http_rejects_increased_or_malformed_limits_before_run_creation(api, limits):
    client, _, _ = api
    _, conv_id, base = conversation(api)
    result = client.post(
        f"{base}/conversations/{conv_id}/messages",
        json={
            "content": "Plan one calculation.",
            "run_limits": limits,
        },
    )
    assert result.status_code == 422
    saved = client.get(f"{base}/conversations/{conv_id}").json()
    assert saved["messages"] == [] and saved["latest_run"] is None


def test_message_limits_stop_third_call_and_persist_across_rejection_of_resume(api):
    client, sessions, settings = api
    project_id, conv_id, base = conversation(api)
    read = ModelToolCall(
        id="read-project",
        name="project.get",
        arguments_json=('{"project_id":"' + project_id + '"}'),
    )
    gateway = ScriptedGateway([_tool_response(read), _tool_response(read), _final_response()])
    limits = {
        "max_model_calls": 2,
        "max_input_tokens": 60_000,
        "max_output_tokens": 4096,
        "max_tool_calls": 2,
    }
    with sessions() as session:
        service = AIScientistService(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            gateway,
        )
        result = service.post_message(
            project_id,
            conv_id,
            PostMessageInput(
                content="Use project.get to inspect this project before planning.",
                run_limits=limits,
            ),
        )
    assert gateway.calls == 2
    assert result.latest_run.status == "FAILED"
    assert result.latest_run.error_code == "BUDGET_EXCEEDED"
    with sessions() as session:
        row = session.get(AIRunRecord, str(result.latest_run.id))
        budget = AIRunBudget.from_dict(row.budget_json)
    assert budget.max_model_calls == budget.model_calls_used == 2
    assert budget.max_output_tokens == 4096
    assert budget.max_input_tokens == budget.max_input_reservation_tokens == 60_000
    assert 0 < budget.input_reservation_tokens_used <= 60_000
    after = client.get(f"{base}/runs/{result.latest_run.id}").json()
    assert after["budget"] == result.latest_run.budget
    resumed = client.post(f"{base}/runs/{result.latest_run.id}/resume")
    assert resumed.status_code == 200 and resumed.json()["status"] == "FAILED"
    assert gateway.calls == 2


def test_cumulative_reservations_do_not_reset_when_actual_usage_is_smaller():
    budget = AIRunBudget(
        max_input_tokens=60_000,
        max_input_reservation_tokens=60_000,
        max_model_calls=2,
        max_output_tokens=4096,
    )
    budget.reserve_model_call(30_000, 2048)
    budget.reconcile_model_usage(actual_input_tokens=1, actual_output_tokens=1)
    restored = AIRunBudget.from_dict(budget.to_dict())
    with pytest.raises(AIBudgetExceededError, match="cumulative input reservations"):
        restored.reserve_model_call(30_001, 2048)
    assert restored.input_reservation_tokens_used == 30_000
    assert not restored.model_call_in_flight


def test_output_reservations_never_exceed_run_remaining_allowance():
    budget = AIRunBudget(max_model_calls=2, max_output_tokens=4096)
    budget.reserve_model_call(1, 2048)
    budget.reconcile_model_usage(actual_input_tokens=1, actual_output_tokens=2000)
    budget.reserve_model_call(1, 4096)
    assert budget.reserved_output_tokens == 2096
    budget.reconcile_model_usage(actual_input_tokens=1, actual_output_tokens=2096)
    with pytest.raises(AIBudgetExceededError):
        budget.reserve_model_call(1, 512)


def test_stale_selection_with_limits_creates_no_run_or_message(api):
    client, _, _ = api
    _, conv_id, base = conversation(api)
    result = client.post(
        f"{base}/conversations/{conv_id}/messages",
        json={
            "content": "Plan exactly one ENERGY calculation.",
            "selected_structure_id": str(uuid4()),
            "run_limits": {"max_model_calls": 2, "max_output_tokens": 4096},
        },
    )
    assert result.status_code == 409
    assert result.json()["detail"]["code"] == "STALE_SELECTION"
    saved = client.get(f"{base}/conversations/{conv_id}").json()
    assert saved["latest_run"] is None and saved["messages"] == []
