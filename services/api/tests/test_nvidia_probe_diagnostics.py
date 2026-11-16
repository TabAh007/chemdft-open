"""Proposal diagnostics: sanitized error paths, and a replay of ChemDFT's real approval pipeline.

The inputs below are deliberately malformed TEST arguments. They are not reconstructions of any
model reply (those were never retained). No test reads a credential or opens a socket.
"""

import copy
import hashlib
import json
import sys
from pathlib import Path

import pytest
from chemdft_api.ai.gateway import FakeModelGateway, ModelResponse, ModelToolCall, ModelUsage
from chemdft_api.scientific.engines.registry import _probe_python, configured_path
from chemdft_api.storage import LocalObjectStore
from test_ai_scientist import _create_project, _import_h2

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from nvidia_probe import plan as probe_plan  # noqa: E402
from nvidia_probe import runner  # noqa: E402
from nvidia_probe.capture_fixture import XYZ  # noqa: E402
from nvidia_probe.replay import ProductionReplay  # noqa: E402

SENTINEL = "SENTINEL-PRIVATE-VALUE-7731"


@pytest.fixture(scope="module")
def fixture():
    return probe_plan.load_fixture()


@pytest.fixture(scope="module")
def replay(fixture):
    built = ProductionReplay.build(fixture)
    yield built
    built.close()


def good(fixture):
    context = probe_plan.planning_context(fixture)
    return {
        "structure_version": {
            "project_id": str(context.project_id),
            "entity_type": "structure.version",
            "entity_id": fixture["version_id"],
        },
        "specification": {
            "task_type": "ENERGY",
            "method": {"identifier": "hf", "display_name": "HF", "registry": "chemdft.method"},
            "basis": {
                "identifier": "sto-3g",
                "display_name": "STO-3G",
                "registry": "chemdft.basis",
            },
            "charge": 0,
            "multiplicity": 1,
            "engine_preference": {"engine": "pyscf"},
        },
        "provider_preference": "AUTO",
        "idempotency_key": "probe-h2-hf-sto3g",
    }


def loose(fixture):
    """Loose shapes production's normalizer is written to accept (strings, aliases, no key)."""
    return {
        "structure_version": fixture["version_id"],
        "specification": {
            "task_type": "single_point",
            "method": "HF",
            "basis": "STO-3G",
            "charge": 0,
            "multiplicity": 1,
            "engine_preference": "pyscf",
        },
    }


MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"


def reply(arguments, name="calculation.submit", model=MODEL):
    call = ModelToolCall("c", name, json.dumps(arguments))
    return ModelResponse(
        content=None,
        tool_calls=(call,),
        usage=ModelUsage(5, 5, 4),
        model_identifier=model,
        provider="nvidia",
        finish_reason="tool_calls",
    )


def judged(fixture, arguments, replay=None, case="PROPOSAL", name="calculation.submit"):
    return probe_plan.judge(case, fixture, reply(arguments, name), replay)


# --- sanitized error paths on the strict check --------------------------------------------------


def test_the_strict_check_reports_field_paths_and_pydantic_types_only(fixture):
    args = good(fixture)
    args["specification"]["method"] = SENTINEL  # a bare string where an object is required
    args["specification"]["basis"] = {"identifier": SENTINEL}  # display_name, registry missing
    args["specification"]["charge"] = "0"  # a coerced integer is refused
    args["specification"]["calculation_type"] = SENTINEL  # an extra field
    del args["idempotency_key"]
    verdict = judged(fixture, args)
    assert verdict["failure_codes"] == ["SUBMIT_SCHEMA_INVALID"]
    assert verdict["proposal_valid"] is False and verdict["tool_call_schema_valid"] is False
    found = {(e["path"], e["category"]) for e in verdict["schema_errors"]}
    assert found == {
        ("specification.method", "model_type"),
        ("specification.basis.display_name", "missing"),
        ("specification.basis.registry", "missing"),
        ("specification.charge", "value_error"),
        ("specification.calculation_type", "extra_forbidden"),
        ("idempotency_key", "missing"),
    }
    assert verdict["schema_error_count"] == 6 and verdict["schema_errors_truncated"] is False
    assert SENTINEL not in json.dumps(verdict)  # no value, message or context ever reaches a report


def test_a_key_the_model_invented_is_never_recorded_verbatim(fixture):
    args = good(fixture)
    args["sk-live-" + SENTINEL] = "x"  # not an identifier: it could be anything
    args["calculation_type"] = "x"  # an ordinary field name is kept
    verdict = judged(fixture, args)
    paths = {e["path"] for e in verdict["schema_errors"]}
    assert paths == {"<key>", "calculation_type"}
    assert SENTINEL not in json.dumps(verdict)


def test_list_positions_and_error_volume_are_bounded(fixture):
    many = good(fixture)
    for index in range(30):
        many[f"extra_{index}"] = 1
    verdict = judged(fixture, many)
    assert verdict["schema_errors_truncated"] is True and len(verdict["schema_errors"]) == 20
    assert verdict["schema_error_count"] == 30
    listed = good(fixture)
    listed["specification"]["constraints"] = [SENTINEL]
    result = judged(fixture, listed)
    assert {e["path"] for e in result["schema_errors"]} == {"specification.constraints[]"}
    assert SENTINEL not in json.dumps(verdict) + json.dumps(result)


def test_the_tool_case_also_reports_paths_and_a_valid_call_reports_none(fixture):
    bad = judged(fixture, {"structure_id": SENTINEL}, case="TOOL", name=probe_plan.READ_TOOL)
    assert bad["tool_call_schema_valid"] is False
    assert {(e["path"], e["category"]) for e in bad["schema_errors"]} >= {
        ("version_id", "missing"),
        ("structure_id", "uuid_parsing"),
    }
    assert SENTINEL not in json.dumps(bad)
    ok = judged(
        fixture,
        {"structure_id": fixture["structure_id"], "version_id": fixture["version_id"]},
        case="TOOL",
        name=probe_plan.READ_TOOL,
    )
    assert "schema_errors" not in ok and ok["failure_codes"] == []
    assert "schema_errors" not in judged(fixture, good(fixture))


def test_the_strict_verdict_is_unchanged_by_the_diagnostics(fixture):
    # The strict validator was not weakened: loose shapes still fail it, valid ones still pass it.
    assert judged(fixture, good(fixture))["proposal_valid"] is True
    strict = judged(fixture, loose(fixture))
    assert strict["proposal_valid"] is False and strict["failure_codes"] == [
        "SUBMIT_SCHEMA_INVALID"
    ]
    wrong_tool = judged(fixture, good(fixture), name="calculation.cancel")
    assert wrong_tool["failure_codes"] == ["WRONG_TOOL"] and "schema_errors" not in wrong_tool


# --- production replay ----------------------------------------------------------------------------


def test_the_replica_is_built_from_the_same_bytes_the_fixture_was_captured_from(fixture, replay):
    context = probe_plan.planning_context(fixture)
    source = context.scientific_input.provenance.source_artifact
    assert hashlib.sha256(XYZ).hexdigest() == source.sha256


def test_production_accepts_loose_shapes_the_strict_check_rejects(fixture, replay):
    strict = judged(fixture, loose(fixture), replay)
    assert strict["proposal_valid"] is False and strict["failure_codes"] == [
        "SUBMIT_SCHEMA_INVALID"
    ]
    assert strict["production_replay"] == {
        "accepted": True,
        "stage": None,
        "error_code": None,
        "adherence_failure_codes": [],
        "valid_for_prompt": True,
    }
    canonical = judged(fixture, good(fixture), replay)
    assert canonical["proposal_valid"] is True
    assert canonical["production_replay"]["accepted"] is True


@pytest.mark.parametrize(
    "mutate, stage, code, path",
    [
        (
            lambda a: a["specification"].pop("engine_preference"),
            "NORMALIZATION",
            "VALIDATION_ERROR",
            None,
        ),
        (
            lambda a: a["specification"].update(calculation_type="x"),
            "SCHEMA",
            None,
            "specification.calculation_type",
        ),
        (
            lambda a: a["structure_version"].update(
                entity_id="11111111-1111-4111-8111-111111111111"
            ),
            "NORMALIZATION",
            "NOT_FOUND",
            None,
        ),
        (
            lambda a: a["specification"]["engine_preference"].update(engine="xtb"),
            "PROFILE_GUARD",
            "PLANNING_PROFILE_MISMATCH",
            None,
        ),
        (
            lambda a: a["specification"].update(task_type="FREQUENCY"),
            "PROFILE_GUARD",
            "PLANNING_PROFILE_MISMATCH",
            None,
        ),
        (lambda a: a.update(provider_preference="local"), "SCHEMA", None, "provider_preference"),
    ],
)
def test_production_still_rejects_what_it_must(fixture, replay, mutate, stage, code, path):
    args = good(fixture)
    mutate(args)
    verdict = replay.replay(args)
    assert verdict["accepted"] is False and verdict["stage"] == stage
    assert verdict["error_code"] == code
    if path:
        assert path in {e["path"] for e in verdict["schema_errors"]}


def test_stringified_objects_with_the_frozen_ids_are_accepted_by_the_replay(fixture, replay):
    """The strict-check shape of a live Super reply: its nested objects were not objects."""
    base = good(fixture)
    args = {
        "structure_version": json.dumps(base["structure_version"]),
        "specification": json.dumps(base["specification"]),
        "provider_preference": "AUTO",
        "idempotency_key": "probe-h2-hf-sto3g",
    }
    verdict = judged(fixture, args, replay)
    assert {(e["path"], e["category"]) for e in verdict["schema_errors"]} == {
        ("structure_version", "model_type"),
        ("specification", "model_type"),
    }
    assert verdict["argument_shape"] == {
        "structure_version": "string",
        "specification": "string",
        "provider_preference": "string",
        "idempotency_key": "string",
    }
    assert verdict["production_replay"]["accepted"] is True  # the frozen ids map to the replica's


def test_argument_shape_is_names_and_json_types_only(fixture):
    args = good(fixture)
    args["sk-live-" + SENTINEL] = SENTINEL
    args["notes"] = None
    args["count"] = 3
    args["flags"] = [SENTINEL]
    args["structure_version"] = SENTINEL
    shape = judged(fixture, args)["argument_shape"]
    assert shape["<key>"] == "string" and shape["notes"] == "null" and shape["count"] == "number"
    assert shape["flags"] == "array" and shape["structure_version"] == "string"
    assert shape["specification"] == "object"
    assert SENTINEL not in json.dumps(shape)
    assert "argument_shape" not in judged(
        fixture, good(fixture)
    )  # only recorded on a strict failure


@pytest.mark.parametrize(
    "mutate, conditions",
    [
        (lambda a: a["specification"].update(task_type="FREQUENCY"), ["TASK_NOT_ENERGY"]),
        (
            lambda a: a["specification"]["engine_preference"].update(engine="psi4"),
            ["ENGINE_NOT_PYSCF"],
        ),
        (
            lambda a: (
                a["specification"].update(task_type="ORBITAL"),
                a["specification"]["engine_preference"].update(engine="xtb"),
            ),
            ["TASK_NOT_ENERGY", "ENGINE_NOT_PYSCF"],
        ),
    ],
)
def test_a_profile_guard_refusal_names_the_condition_that_failed(
    fixture, replay, mutate, conditions
):
    args = good(fixture)
    mutate(args)
    verdict = replay.replay(args)
    assert (
        verdict["stage"] == "PROFILE_GUARD" and verdict["error_code"] == "PLANNING_PROFILE_MISMATCH"
    )
    assert verdict["guard_conditions"] == conditions
    assert "guard_conditions" not in replay.replay(good(fixture))


def test_a_version_the_profile_did_not_select_is_named(fixture, replay, monkeypatch):
    from uuid import uuid4

    context = replay._context
    other = context.model_copy(
        update={
            "selection": context.selection.model_copy(
                update={"selected_structure_version_id": uuid4()}
            )
        }
    )
    monkeypatch.setattr(replay, "_context", other)
    verdict = replay.replay(good(fixture))
    assert verdict["stage"] == "PROFILE_GUARD"
    assert verdict["guard_conditions"] == ["VERSION_NOT_SELECTED"]


def test_a_proposal_for_another_method_passes_production_but_not_the_prompt(fixture, replay):
    args = good(fixture)
    args["specification"]["method"]["identifier"] = "b3lyp"
    verdict = replay.replay(args)
    assert verdict["accepted"] is True and verdict["valid_for_prompt"] is False
    assert verdict["adherence_failure_codes"] == ["METHOD_NOT_HF"]


def test_a_missing_or_different_basis_is_told_apart(fixture, replay):
    missing = good(fixture)
    del missing["specification"]["basis"]
    other = good(fixture)
    other["specification"]["basis"]["identifier"] = "6-31g"
    for args, code in ((missing, "BASIS_MISSING"), (other, "BASIS_NOT_STO3G")):
        verdict = replay.replay(args)
        assert verdict["accepted"] is True and verdict["valid_for_prompt"] is False
        assert verdict["adherence_failure_codes"] == [code]


def test_the_replay_verdict_never_contains_argument_values(fixture, replay):
    args = loose(fixture)
    args["idempotency_key"] = SENTINEL
    args["specification"]["notes"] = SENTINEL
    args["specification"]["method"] = SENTINEL
    verdict = replay.replay(args)
    assert verdict["accepted"] is False
    assert SENTINEL not in json.dumps(verdict)
    assert replay.replay(copy.deepcopy(args)) == verdict  # deterministic, and the input untouched
    assert args["specification"]["method"] == SENTINEL


def test_a_probe_run_reports_both_verdicts_and_leaks_nothing(fixture, replay):
    from test_nvidia_probe_preflight import ScriptedGateway, authorize

    def loose_proposal(request):
        names = {t.name for t in request.tools}
        if "calculation.submit" in names:
            return reply(loose(fixture), model=request.model_identifier)
        return ScriptedGateway(fixture).default(request)

    gateway = ScriptedGateway(fixture, {3: loose_proposal})
    report = runner.run_probe(
        authorize(max_total_calls=3, max_total_tokens=20_000, models=[MODEL]),
        fixture,
        gateway,
        replay=replay,
    )
    body = report.as_dict()
    assert body["production_replay"]["status"] == "ENABLED"
    assert "validate_compute_guidance" in body["production_replay"]["not_replayed"]
    proposal = next(c for c in body["calls"] if c["request_class"] == "PROPOSAL")
    assert proposal["verdict"]["proposal_valid"] is False  # strict, as before
    assert proposal["verdict"]["production_replay"]["accepted"] is True
    assert SENTINEL not in json.dumps(body)
    plain = runner.run_probe(
        authorize(max_total_calls=3, max_total_tokens=20_000, models=[MODEL]),
        fixture,
        ScriptedGateway(fixture),
    ).as_dict()
    assert plain["production_replay"]["status"] == "NOT_ENABLED"
    assert all("production_replay" not in c.get("verdict", {}) for c in plain["calls"])


def test_a_replay_that_cannot_run_never_breaks_a_probe(fixture):
    class Broken:
        def replay(self, arguments):
            raise RuntimeError(SENTINEL)

    verdict = judged(fixture, good(fixture), Broken())
    assert verdict["production_replay"] == {
        "accepted": None,
        "stage": "REPLAY_ERROR",
        "error_type": "RuntimeError",
    }
    assert SENTINEL not in json.dumps(verdict)


# --- differential test: the replay agrees with the real production approval flow ------------------


def _worker_available() -> bool:
    from chemdft_api.config import Settings

    state, _version, _diagnostic = _probe_python(
        configured_path(Settings(_env_file=None).scientific_worker_python)
    )
    return state == "AVAILABLE"


@pytest.mark.skipif(
    not _worker_available(),
    reason="PySCF worker venv absent (ignored directory): the real flow cannot reach approval",
)
def test_the_replay_agrees_with_the_real_approval_flow(api, monkeypatch, fixture):
    client, sessions, settings = api
    project = _create_project(client)
    imported = _import_h2(client, project["id"])
    version_id = str(imported["version"]["id"])
    context = probe_plan.planning_context(fixture)
    bound = context.model_copy(
        update={
            "selection": context.selection.model_copy(
                update={"selected_structure_version_id": version_id}
            )
        }
    )
    live = ProductionReplay(
        sessions, LocalObjectStore(settings.object_root), project["id"], bound, {}
    )

    canonical = good(fixture)
    canonical["structure_version"].update(project_id=project["id"], entity_id=version_id)
    string_forms = {
        "structure_version": version_id,
        "specification": {
            "task_type": "single_point",
            "method": "hf",
            "basis": "sto-3g",
            "charge": 0,
            "multiplicity": 1,
            "engine_preference": "pyscf",
        },
    }
    stringified = {
        "structure_version": json.dumps(canonical["structure_version"]),
        "specification": json.dumps(canonical["specification"]),
    }
    alt_key = {"structure_version_id": version_id, "specification": canonical["specification"]}
    no_engine = copy.deepcopy(canonical)
    no_engine["specification"].pop("engine_preference")
    extra_spec = copy.deepcopy(canonical)
    extra_spec["specification"]["calculation_type"] = "x"
    extra_top = copy.deepcopy(canonical)
    extra_top["calculation_type"] = "x"
    bad_charge = copy.deepcopy(canonical)
    bad_charge["specification"]["charge"] = "0"
    bad_provider = copy.deepcopy(canonical)
    bad_provider["provider_preference"] = "local"
    wrong_id = copy.deepcopy(canonical)
    wrong_id["structure_version"]["entity_id"] = "11111111-1111-4111-8111-111111111111"
    xtb = copy.deepcopy(canonical)
    xtb["specification"]["engine_preference"]["engine"] = "xtb"
    frequency = copy.deepcopy(canonical)
    frequency["specification"]["task_type"] = "FREQUENCY"
    corpus = [
        ("canonical", canonical, True),
        ("strings and alias, no idempotency key", string_forms, True),
        ("stringified objects", stringified, True),
        ("structure_version_id key", alt_key, True),
        ("extra top-level key is dropped", extra_top, True),
        ("missing engine_preference", no_engine, False),
        ("extra specification key", extra_spec, False),
        ("charge as a string", bad_charge, False),
        ("lower-case provider_preference", bad_provider, False),
        ("unknown structure version", wrong_id, False),
        ("another engine", xtb, False),
        ("another task", frequency, False),
    ]

    def real_flow_accepts(arguments) -> bool:
        responses = iter(
            [
                ModelResponse(
                    content=None,
                    tool_calls=(ModelToolCall("t1", "calculation.submit", json.dumps(arguments)),),
                    usage=ModelUsage(5, 5, 4),
                    model_identifier="fake-standard",
                    provider="fake",
                ),
                ModelResponse(
                    content="Done.",
                    usage=ModelUsage(5, 5, 4),
                    model_identifier="fake-standard",
                    provider="fake",
                ),
            ]
        )
        monkeypatch.setattr(
            FakeModelGateway, "generate", lambda _gateway, _request: next(responses)
        )
        conversation = client.post(
            f"/v1/projects/{project['id']}/ai/conversations", json={}
        ).json()["conversation"]["id"]
        response = client.post(
            f"/v1/projects/{project['id']}/ai/conversations/{conversation}/messages",
            json={
                "content": fixture["user_prompt"],
                "mode": "STANDARD",
                "planning_profile": "PYSCF_ENERGY_PROPOSAL",
                "selected_structure_version_id": version_id,
            },
        )
        assert response.status_code == 201, response.text
        return response.json()["latest_run"]["status"] == "WAITING_FOR_APPROVAL"

    for name, arguments, expected in corpus:
        replayed = live.replay(copy.deepcopy(arguments))["accepted"]
        real = real_flow_accepts(copy.deepcopy(arguments))
        assert real is expected, f"{name}: the real flow gave {real}"
        assert replayed is real, f"{name}: replay {replayed} disagrees with the real flow {real}"
