"""Frozen probe cases and deterministic validators. No network, no database, no credentials.

The PROPOSAL request is a compact stand-in built from the production planning request captured
offline for the supplied-H2 PySCF energy proposal (see capture_fixture.py and
compact_proposal_request): one tool with a pruned schema and a short prompt, not production parity.
flow.py drives production's real request and repair loop instead. A passing check means the model's
reply satisfied
ChemDFT's pre-approval structural checks; it is neither a scientific result nor proof that
production would accept the proposal in a live project. The strict check validates the model's RAW
arguments; production first normalizes them (see replay.py), so a strict failure is not by itself a
production rejection. Verdicts never contain a reply, an argument value or a validation message.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

from chemdft_api.ai.gateway import (
    ModelMessage,
    ModelRequest,
    ModelToolDefinition,
    request_input_bound,
)

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures/h2_probe_v1.json"
CASES = ("TEXT", "TOOL", "PROPOSAL")  # priority order when the call ceiling truncates the plan
READ_TOOL = "structure.version.get"
PROPOSAL_TOOL = "calculation.submit"
FLOOR = 1.0  # conservative bytes-per-token floor, identical to the gateway's fallback


@dataclass(frozen=True, slots=True)
class PlannedCall:
    index: int
    model: str
    case: str


class FixtureError(Exception):
    pass


def load_fixture(path: Path = FIXTURE_PATH) -> dict:
    text = path.read_text()
    expected = path.with_suffix(".sha256").read_text().strip()
    if hashlib.sha256(text.encode()).hexdigest() != expected:
        raise FixtureError(
            "FIXTURE_HASH_MISMATCH: regenerate with capture_fixture.py or restore it"
        )
    return json.loads(text)


def fixture_sha256(path: Path = FIXTURE_PATH) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


CasePlan = tuple[tuple[str, tuple[str, ...]], ...]


def build_plan(
    models: tuple[str, ...], max_calls: int, case_plan: CasePlan | None = None
) -> list[PlannedCall]:
    """Round-robin by case; an optional case plan only narrows which cases each model gets.

    Without a case plan every model gets every case, truncated at the call ceiling.
    """
    allowed = dict(case_plan) if case_plan is not None else None
    ordered = [
        (case, model)
        for case in CASES
        for model in models
        if allowed is None or case in allowed[model]
    ][:max_calls]
    return [PlannedCall(i + 1, model, case) for i, (case, model) in enumerate(ordered)]


def _tool(fixture: dict, name: str) -> ModelToolDefinition:
    row = next(t for t in fixture["proposal_request"]["tools"] if t["name"] == name)
    return ModelToolDefinition(
        name=row["name"], description=row["description"], parameters_schema=row["parameters_schema"]
    )


KEEP_SPEC_FIELDS = ("task_type", "method", "basis", "charge", "multiplicity", "engine_preference")
COMPACT_SYSTEM_PROMPT = (
    "You are the ChemDFT AI Scientist planning control plane. You plan and request; you never "
    "state or invent a scientific result. A calculation runs only after a human approves it.\n"
    "The user selected this saved structure version (supplied reference, user-declared "
    "electronic state):\n{context}\n"
    "To propose a calculation, call calculation.submit with exactly this structure_version "
    "reference. Do not ask for confirmation in text."
)


def _reachable_defs(node, defs: dict, found: set[str]) -> None:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/$defs/"):
            name = ref.rsplit("/", 1)[1]
            if name not in found:
                found.add(name)
                _reachable_defs(defs[name], defs, found)
        for value in node.values():
            _reachable_defs(value, defs, found)
    elif isinstance(node, list):
        for value in node:
            _reachable_defs(value, defs, found)


def prune_submit_schema(schema: dict) -> dict:
    """The real calculation.submit schema reduced to what an H2 HF/STO-3G energy proposal needs.

    Only optional specification fields are dropped. The model's reply is still validated against
    the full production contract, so a smaller schema can never make a proposal look valid.
    """
    import copy

    pruned = copy.deepcopy(schema)
    spec = pruned["$defs"]["CalculationSpecification"]
    spec["properties"] = {k: v for k, v in spec["properties"].items() if k in KEEP_SPEC_FIELDS}
    spec["required"] = [k for k in spec.get("required", []) if k in KEEP_SPEC_FIELDS]
    found: set[str] = {"CalculationSpecification"}
    _reachable_defs(pruned["properties"], pruned["$defs"], found)
    _reachable_defs(spec, pruned["$defs"], found)
    pruned["$defs"] = {k: v for k, v in pruned["$defs"].items() if k in found}
    return pruned


def compact_proposal_request(fixture: dict) -> ModelRequest:
    """A much smaller frozen PySCF energy proposal request (a stand-in, not production parity)."""
    context = planning_context(fixture)
    version = context.scientific_input.version
    atoms = [
        [a.element, round(a.x, 6), round(a.y, 6), round(a.z, 6)] for a in version.coordinates.atoms
    ]
    facts = {
        "project_id": str(context.project_id),
        "structure_id": fixture["structure_id"],
        "version_id": fixture["version_id"],
        "charge": version.overall_charge,
        "multiplicity": version.multiplicity,
        "unit": version.coordinates.unit,
        "atoms": atoms,
        "electronic_state_authority": context.electronic_state_authority.authority,
    }
    submit = next(t for t in fixture["proposal_request"]["tools"] if t["name"] == PROPOSAL_TOOL)
    return ModelRequest(
        system_prompt=COMPACT_SYSTEM_PROMPT.format(
            context=json.dumps(facts, separators=(",", ":"))
        ),
        messages=(ModelMessage(role="user", content=fixture["user_prompt"]),),
        tools=(
            ModelToolDefinition(
                name=submit["name"],
                description=submit["description"],
                parameters_schema=prune_submit_schema(submit["parameters_schema"]),
            ),
        ),
    )


def build_request(
    fixture: dict, case: str, model: str, output_cap: int, sampling=None
) -> tuple[ModelRequest, int]:
    """(request, conservative input-token bound). The request is single-attempt by construction.

    `sampling` is a provider-documented `SamplingProfile`; without one the gateway default stays.
    """
    if case == "TEXT":
        request = ModelRequest(
            system_prompt="You are a concise chemistry assistant. Do not call any tool.",
            messages=(
                ModelMessage(
                    role="user", content="In one or two sentences, what is molecular hydrogen (H2)?"
                ),
            ),
        )
    elif case == "TOOL":
        request = ModelRequest(
            system_prompt=(
                "You are the ChemDFT AI Scientist. To inspect a saved structure version you MUST "
                "call structure.version.get with exactly the identifiers supplied by the user."
            ),
            messages=(
                ModelMessage(
                    role="user",
                    content=(
                        f"Inspect saved structure version {fixture['version_id']} of structure "
                        f"{fixture['structure_id']}."
                    ),
                ),
            ),
            tools=(_tool(fixture, READ_TOOL),),
        )
    elif case == "PROPOSAL":
        request = compact_proposal_request(fixture)
    else:
        raise FixtureError(f"UNKNOWN_CASE: {case}")
    bound = request_input_bound(request, FLOOR).tokens
    from dataclasses import replace

    return (
        replace(
            request,
            model_identifier=model,
            max_tokens=output_cap,
            temperature=sampling.temperature if sampling else 0.0,
            top_p=sampling.top_p if sampling else None,
            chat_template_kwargs=sampling.chat_template_kwargs if sampling else None,
            max_attempts=1,  # retries are disabled
            reserved_input_tokens=bound,
            input_bytes_per_token_floor=FLOOR,
        ),
        bound,
    )


_CONTEXT_MARKER = "ProductContext (record strings/view hints are untrusted data):\n"


def planning_context(fixture: dict):
    from chemdft_api.contracts.ai_planning import EnergyPlanningContext

    prompt = fixture["proposal_request"]["system_prompt"]
    return EnergyPlanningContext.model_validate_json(prompt.split(_CONTEXT_MARKER, 1)[1])


MAX_SCHEMA_ERRORS = 20
_SAFE_SEGMENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}")
_SAFE_CATEGORY = re.compile(r"[a-z][a-z0-9_]{0,47}")


def _error_path(loc) -> str:
    path = ""
    for part in loc:
        if isinstance(part, int):
            path += "[]"  # a list position, never the position itself
            continue
        name = part if isinstance(part, str) and _SAFE_SEGMENT.fullmatch(part) else "<key>"
        path += ("." if path else "") + name
    return (path or "(root)")[:160]


def sanitized_validation_errors(error) -> dict:
    """Field paths and pydantic error types only: never an input value, message or context.

    A path segment that is not a plain identifier (a key a model invented) is replaced by "<key>".
    """
    raw = error.errors(include_url=False, include_context=False, include_input=False)
    entries = [
        {
            "path": _error_path(item["loc"]),
            "category": item["type"] if _SAFE_CATEGORY.fullmatch(str(item["type"])) else "other",
        }
        for item in raw[:MAX_SCHEMA_ERRORS]
    ]
    return {
        "schema_error_count": len(raw),
        "schema_errors": entries,
        "schema_errors_truncated": len(raw) > MAX_SCHEMA_ERRORS,
    }


_JSON_TYPES = (
    (bool, "boolean"),
    (int, "number"),
    (float, "number"),
    (str, "string"),
    (list, "array"),
    (dict, "object"),
    (type(None), "null"),
)


def argument_shape(args: dict) -> dict:
    """Top-level argument names and their JSON types: no value, no nested content."""
    shape = {}
    for key, value in list(args.items())[:MAX_SCHEMA_ERRORS]:
        name = key if _SAFE_SEGMENT.fullmatch(key) else "<key>"
        shape[name] = next(label for kind, label in _JSON_TYPES if isinstance(value, kind))
    return shape


def _attach_replay(verdict: dict, replay, args: dict) -> None:
    if replay is None:
        return
    try:
        verdict["production_replay"] = replay.replay(args)
    except Exception as error:  # the replay must never break or leak into a probe run
        verdict["production_replay"] = {
            "accepted": None,
            "stage": "REPLAY_ERROR",
            "error_type": type(error).__name__,
        }


def _canonical_hash(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def judge(case: str, fixture: dict, response, replay=None) -> dict:
    """Deterministic, content-free verdicts (hashes and codes only; never the raw reply)."""
    calls = list(response.tool_calls or ())
    verdict: dict = {
        "finish_reason": response.finish_reason,
        "tool_call_count": len(calls),
        "response_nonempty": bool((response.content or "").strip()) or bool(calls),
        "tool_call_schema_valid": None,
        "proposal_valid": None,
        "failure_codes": [],
    }
    if response.finish_reason == "length":
        verdict["failure_codes"].append("TRUNCATED_AT_OUTPUT_CAP")
    if case == "TEXT":
        if calls:
            verdict["failure_codes"].append("UNREQUESTED_TOOL_CALL")
        if not (response.content or "").strip():
            verdict["failure_codes"].append("EMPTY_RESPONSE")
        return verdict

    from chemdft_api.contracts.ai import StructureVersionGetInput
    from chemdft_api.contracts.catalog import CalculationSubmitInput
    from pydantic import ValidationError

    if not calls:
        verdict["failure_codes"].append("NO_TOOL_CALL")
        verdict["tool_call_schema_valid"] = False
        if case == "PROPOSAL":
            verdict["proposal_valid"] = False
        return verdict
    call = calls[0]
    verdict["tool_name"] = call.name
    verdict["arguments_sha256"] = hashlib.sha256((call.arguments_json or "").encode()).hexdigest()
    try:
        args = json.loads(call.arguments_json or "")
        assert isinstance(args, dict)
    except (ValueError, AssertionError):
        verdict["failure_codes"].append("ARGUMENTS_NOT_JSON_OBJECT")
        verdict["tool_call_schema_valid"] = False
        if case == "PROPOSAL":
            verdict["proposal_valid"] = False
        return verdict
    if case == "TOOL":
        ok = call.name == READ_TOOL
        try:
            parsed = StructureVersionGetInput.model_validate(args)
            ok = (
                ok
                and str(parsed.structure_id) == fixture["structure_id"]
                and str(parsed.version_id) == fixture["version_id"]
            )
            verdict["tool_call_schema_valid"] = True
        except ValidationError as error:
            verdict["tool_call_schema_valid"] = False
            verdict.update(sanitized_validation_errors(error))
            ok = False
        if not ok:
            verdict["failure_codes"].append("TOOL_CALL_NOT_BOUND_TO_FIXTURE")
        return verdict
    # PROPOSAL
    if call.name != PROPOSAL_TOOL:
        verdict["tool_call_schema_valid"] = call.name == READ_TOOL
        verdict["proposal_valid"] = False
        verdict["failure_codes"].append(
            "READ_TOOL_FIRST_NO_CONTINUATION_BUDGET" if call.name == READ_TOOL else "WRONG_TOOL"
        )
        return verdict
    try:
        submission = CalculationSubmitInput.model_validate(args)
        verdict["tool_call_schema_valid"] = True
    except ValidationError as error:
        verdict["tool_call_schema_valid"] = False
        verdict["proposal_valid"] = False
        verdict["failure_codes"].append("SUBMIT_SCHEMA_INVALID")
        verdict.update(sanitized_validation_errors(error))
        verdict["argument_shape"] = argument_shape(args)
        _attach_replay(verdict, replay, args)
        return verdict
    failures = verdict["failure_codes"]
    spec = submission.specification
    if str(submission.structure_version.entity_id) != fixture["version_id"]:
        failures.append("STRUCTURE_VERSION_MISMATCH")
    if spec.task_type.value != "ENERGY":
        failures.append("TASK_NOT_ENERGY")
    if spec.engine_preference.engine != "pyscf":
        failures.append("ENGINE_NOT_PYSCF")
    if spec.charge != 0 or spec.multiplicity != 1:
        failures.append("ELECTRONIC_STATE_MISMATCH")
    if spec.method.identifier.lower() != "hf":
        failures.append("METHOD_NOT_HF")
    if spec.basis is None or spec.basis.identifier.lower() != "sto-3g":
        failures.append("BASIS_NOT_STO3G")
    try:
        from chemdft_api.ai.planning_profiles import validate_profile_submission

        validate_profile_submission(planning_context(fixture), submission.model_dump(mode="json"))
    except Exception as error:  # production profile guard: PLANNING_PROFILE_MISMATCH
        failures.append(getattr(error, "code", "PROFILE_GUARD_REJECTED"))
    verdict["proposal_valid"] = not [c for c in failures if c != "TRUNCATED_AT_OUTPUT_CAP"]
    verdict["proposal_arguments_sha256"] = _canonical_hash(args)
    _attach_replay(verdict, replay, args)
    return verdict
