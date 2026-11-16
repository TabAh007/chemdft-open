"""AI-2 operational telemetry: derived from existing records, honest about what it cannot know."""

from uuid import uuid4

from chemdft_api.ai.gateway import (
    FakeModelGateway,
    ModelGatewayError,
    ModelResponse,
    ModelTimeoutError,
    ModelToolCall,
    ModelUsage,
)
from chemdft_api.ai.http_transport import TransportDiagnostic
from chemdft_api.ai.model_performance import classify_failure, latency_summary
from chemdft_api.ai.usage_accounting import release_undispatched_invocation, reserve_invocation
from chemdft_api.ai_models import AIModelInvocationRecord
from sqlalchemy import text
from test_ai_foundation import approval_fixture
from test_ai_model_switching import ask, new_conversation, select_model
from test_ai_scientist import _create_project, _import_h2

URL = "/v1/ai/model-performance"
SECRET_PROMPT = "Explain the confidential fluorine scaffold PRIVATE-PROMPT-MARKER."


def transport(kind, status=None):
    return TransportDiagnostic(
        phase="RESPONSE_BODY",
        kind=kind,
        elapsed_ms=777,
        timeout_seconds=60,
        http_status=status,
    )


def rows_by_model(client):
    view = client.get(URL).json()
    return view, {row["model_name"]: row for row in view["rows"]}


def test_latency_percentiles_use_nearest_rank_and_hide_small_p95():
    few = latency_summary([30, 10, 20])
    assert (few.observations, few.median_ms, few.p95_ms, few.max_ms) == (3, 20, None, 30)
    values = list(range(1, 21))  # 1..20 ms: exactly the p95 threshold
    full = latency_summary(values)
    assert (full.median_ms, full.p95_ms, full.max_ms) == (10, 19, 20)
    assert latency_summary([]).model_dump() == {
        "observations": 0,
        "median_ms": None,
        "p95_ms": None,
        "max_ms": None,
    }


def test_failures_are_classified_from_recorded_transport_kind_only():
    assert classify_failure({"transport": {"kind": "READ_TIMEOUT"}}) == "timeout"
    assert classify_failure({"transport": {"kind": "TIMEOUT_PHASE_UNKNOWN"}}) == "timeout"
    assert classify_failure({"transport": {"kind": "HTTP_ERROR", "http_status": 429}}) == (
        "provider_error"
    )
    assert classify_failure({"transport": {"kind": "DNS_ERROR"}}) == "provider_error"
    assert classify_failure({}) == "unclassified_failure"
    assert classify_failure(None) == "unclassified_failure"


def test_metrics_follow_recorded_outcomes_and_keep_models_apart(api, monkeypatch):
    client, _sessions, _settings = api
    project = _create_project(client)
    conversation = new_conversation(client, project["id"])
    behaviour = {}

    def scripted(_gateway, request):
        step = behaviour["next"]
        if isinstance(step, Exception):
            raise step
        return step(request) if callable(step) else step

    monkeypatch.setattr(FakeModelGateway, "generate", scripted)

    def respond(request, *, usage, content="Answer."):
        return ModelResponse(
            content=content,
            usage=usage,
            model_identifier=request.model_identifier,
            provider="fake",
        )

    # fake-standard: one success with reported usage and one unknown-usage success.
    behaviour["next"] = lambda r: respond(r, usage=ModelUsage(100, 30, 12))
    assert ask(client, project["id"], conversation, SECRET_PROMPT)["status"] == "SUCCEEDED"
    behaviour["next"] = lambda r: respond(r, usage=None)
    assert ask(client, project["id"], conversation)["status"] == "SUCCEEDED"
    # fake-alternate: a timeout and a provider error, never retried on another model.
    select_model(client, "fake-alternate")
    behaviour["next"] = ModelTimeoutError("t", transport=transport("READ_TIMEOUT"))
    client.post(
        f"/v1/projects/{project['id']}/ai/conversations/{conversation}/messages",
        json={"content": "Explain a qualitative concept.", "mode": "STANDARD"},
    )
    behaviour["next"] = ModelGatewayError("e", transport=transport("HTTP_ERROR", 503))
    client.post(
        f"/v1/projects/{project['id']}/ai/conversations/{conversation}/messages",
        json={"content": "Explain a qualitative concept.", "mode": "STANDARD"},
    )

    view, rows = rows_by_model(client)
    standard, alternate = rows["fake-standard"], rows["fake-alternate"]
    assert standard["model_provider"] == "fake" and standard["synthetic"] is True
    assert standard["requests"]["dispatched"] == 2 and standard["requests"]["succeeded"] == 2
    assert standard["request_latency"]["observations"] == 1  # the unknown-usage call has no timing
    assert standard["request_latency"]["median_ms"] == 12
    assert standard["tokens"] == {
        "requests_reported": 1,
        "requests_unknown": 1,
        "input_tokens": 100,
        "output_tokens": 30,
    }
    assert alternate["requests"]["dispatched"] == 2 and alternate["requests"]["succeeded"] == 0
    assert alternate["requests"]["timeout"] == 1 and alternate["requests"]["provider_error"] == 1
    # Failures never contribute a latency, and unreported usage stays UNKNOWN rather than zero.
    assert alternate["request_latency"] == {
        "observations": 0,
        "median_ms": None,
        "p95_ms": None,
        "max_ms": None,
    }
    assert alternate["tokens"]["input_tokens"] is None
    assert alternate["tokens"]["requests_unknown"] == 2
    assert alternate["run_outcomes"]["failed"] == 2
    assert view["window"]["runs_considered"] == 4 and not view["window"]["truncated"]


def test_tool_and_proposal_validity_are_counted_without_claiming_correctness(api, monkeypatch):
    client, _sessions, _settings = api
    project = _create_project(client)
    _import_h2(client, project["id"])
    conversation = new_conversation(client, project["id"])
    calls = iter(
        [
            ModelToolCall("a", "structure.list", "{}"),  # conforming read tool
            ModelToolCall("b", "result.converge", "{}"),  # outside the run's scope
            ModelToolCall("c", "calculation.submit", "{}"),  # fails schema validation
        ]
    )

    def one_call_per_turn(_gateway, request):
        call = next(calls, None)
        return ModelResponse(
            content=None if call else "Done.",
            tool_calls=(call,) if call else (),
            usage=ModelUsage(5, 5, 4),
            model_identifier=request.model_identifier,
            provider="fake",
        )

    monkeypatch.setattr(FakeModelGateway, "generate", one_call_per_turn)
    assert ask(client, project["id"], conversation)["status"] == "SUCCEEDED"
    monkeypatch.undo()
    approval_fixture(api)  # a valid proposal reaching human approval, driven by the fixture

    _view, rows = rows_by_model(client)
    row = rows["fake-standard"]
    assert row["tool_calls"]["rejected_by_validation"] == 2
    assert row["tool_calls"]["outside_run_scope"] == 1
    assert row["tool_calls"]["emitted"] >= 3
    assert row["tool_calls"]["conformance_rate"] < 1
    assert row["proposals"]["rejected_by_validation"] == 1
    assert row["proposals"]["validated_for_approval"] >= 1
    assert 0 < row["proposals"]["validity_rate"] < 1
    definitions = {d["metric"]: d["definition"] for d in _view["metric_definitions"]}
    assert "not scientific correctness" in definitions["Proposal validity"]


def test_undispatched_and_in_flight_receipts_are_excluded_from_rates(api):
    client, sessions, _settings = api
    project = _create_project(client)
    conversation = new_conversation(client, project["id"])
    run = ask(client, project["id"], conversation)
    baseline = rows_by_model(client)[1]["fake-standard"]["requests"]
    with sessions() as session:
        common = {
            "project_id": project["id"],
            "run_id": run["id"],
            "provider": "fake",
            "model": "fake-standard",
            "mode": "MANAGED",
            "prompt_version": "test",
        }
        released = reserve_invocation(session, **common)
        reserve_invocation(session, **common)  # stays RESERVED: a request still in flight
        session.commit()
        assert release_undispatched_invocation(
            session, released.id, reason="PROVIDER_NOT_CONFIGURED"
        )
    _view, rows = rows_by_model(client)
    requests = rows["fake-standard"]["requests"]
    assert (requests["not_dispatched"], requests["in_flight"]) == (1, 1)
    # Only genuinely dispatched requests count toward rates; the two extra receipts do not.
    assert requests["dispatched"] == baseline["dispatched"] > 0
    assert requests["succeeded"] == baseline["succeeded"]


def test_telemetry_is_scoped_to_the_caller_and_carries_no_research_content(api):
    client, sessions, settings = api
    project = _create_project(client)
    conversation = new_conversation(client, project["id"])
    ask(client, project["id"], conversation, SECRET_PROMPT)
    body = client.get(URL).text
    assert "PRIVATE-PROMPT-MARKER" not in body and project["id"] not in body
    assert "H2 Molecule" not in body
    other = str(uuid4())
    from chemdft_api.models import Membership, User

    with sessions() as session:
        session.add(User(id=other, email="ai2-perf@example.test", display_name="Other"))
        session.flush()
        session.add(
            Membership(user_id=other, organization_id=settings.dev_organization_id, role="member")
        )
        session.commit()
    seen = client.get(URL, headers={"X-ChemDFT-User-ID": other}).json()
    assert seen["rows"] == [] and seen["window"]["runs_considered"] == 0
    # No ranking, cost or scientific-quality field exists in the wire contract.
    row_keys = set(client.get(URL).json()["rows"][0])
    assert not {"score", "rank", "cost", "price", "accuracy"} & row_keys


def test_no_persistent_metric_store_exists(api):
    _client, sessions, _settings = api
    with sessions() as session:
        names = {
            row[0]
            for row in session.execute(text("select name from sqlite_master where type='table'"))
        }
    assert not [n for n in names if "perf" in n or "metric" in n or "benchmark" in n]
    assert AIModelInvocationRecord.__tablename__ in names
