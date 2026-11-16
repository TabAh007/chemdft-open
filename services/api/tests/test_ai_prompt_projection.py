"""Prompt-size reduction safety: nothing that grants, hides or constrains authority is removed.

Offline; a scripted gateway captures the request exactly as the service hands it over.
"""

# ruff: noqa: F811
from __future__ import annotations

import json

from chemdft_api.ai.gateway import request_input_bound
from chemdft_api.ai.prompt_projection import (
    compact_tool_schema,
)
from chemdft_api.ai.tool_policy import (
    AI_BOUNDED_WRITE_TOOLS,
    AI_PLANNING_WRITE_TOOLS,
    AI_TOOLS,
    AI_WRITE_TOOLS,
)
from test_ai_execution_durability import _final_response, env  # noqa: F401

# Measured on this fixture before the projections existed (same request, 2026-10-15).
UNREDUCED_REQUEST_BYTES = 55_033
UNREDUCED_FLOOR2_RESERVATION = 29_373


class Capture:
    def __init__(self):
        self.requests = []

    def generate(self, request):
        self.requests.append(request)
        return _final_response()


def _without_titles(node):
    """Independent re-implementation: drop schema `title` annotations, nothing else."""
    if isinstance(node, list):
        return [_without_titles(item) for item in node]
    if not isinstance(node, dict):
        return node
    out = {}
    for key, value in node.items():
        if key == "title" and isinstance(value, str):
            continue
        if key in {"default", "const", "enum", "examples"}:
            out[key] = value
        elif key in {"properties", "$defs"} and isinstance(value, dict):
            out[key] = {name: _without_titles(sub) for name, sub in value.items()}
        else:
            out[key] = _without_titles(value)
    return out


# ------------------------------------------------------------------- schema compaction
def test_only_title_annotations_are_removed_from_schemas():
    schema = {
        "title": "Calc",
        "type": "object",
        "properties": {
            "title": {
                "title": "Title",
                "type": "string",
                "minLength": 1,
                "description": "Run title",
            },
            "method": {"$ref": "#/$defs/Method", "default": {"title": "payload data", "n": 1}},
            "kind": {"enum": ["a", "b"], "title": "Kind", "const": "a"},
        },
        "required": ["title", "method"],
        "$defs": {
            "Method": {
                "title": "Method",
                "type": "object",
                "properties": {"x": {"title": "X", "type": "integer", "maximum": 5}},
            }
        },
        "additionalProperties": False,
    }
    compact = compact_tool_schema(schema)
    assert "title" not in compact
    assert compact["properties"]["title"] == {
        "type": "string",
        "minLength": 1,
        "description": "Run title",
    }
    assert compact["properties"]["method"]["default"] == {
        "title": "payload data",
        "n": 1,
    }  # data kept
    assert compact["required"] == ["title", "method"]
    assert compact["$defs"]["Method"]["properties"]["x"] == {"type": "integer", "maximum": 5}
    assert compact["additionalProperties"] is False
    assert compact["properties"]["kind"] == {"enum": ["a", "b"], "const": "a"}
    assert compact_tool_schema(compact) == compact  # idempotent
    assert schema["title"] == "Calc"  # input not mutated


def test_every_exposed_tool_schema_equals_its_registry_schema_minus_titles(env):
    from chemdft_api.ai.service import _model_tool_definitions

    with env.sessions() as session:
        registry = env.service(session)._registry  # the registry the model actually sees
        exposed = {d.name: d for d in _model_tool_definitions(registry)}
        originals = {
            d.name: registry.resolve(d.name, d.version).input_model.model_json_schema(
                mode="validation"
            )
            for d in registry.discover()
            if d.name in (AI_TOOLS | AI_PLANNING_WRITE_TOOLS)
        }
        for name, definition in exposed.items():
            assert definition.parameters_schema == _without_titles(originals[name]), name
            assert definition.parameters_schema.get("required") == originals[name].get("required")
    # no tool was dropped from the model's reach (the planning-profile write tool included)
    assert set(exposed) == set(AI_TOOLS | AI_PLANNING_WRITE_TOOLS)


# ------------------------------------------------- the ProductContext contract is untouched
def test_model_receives_the_exact_persisted_product_context_snapshot(env):
    # Provenance: ai_context_snapshots must equal what the model was sent. Only tool *schemas*
    # are projected; the context (including its allowed_tools table) is sent as-is.
    capture = Capture()
    env.execute(env.make_run(), capture)
    request = capture.requests[0]
    context = json.loads(request.system_prompt.split("data):\n", 1)[1])
    policies = {item["tool_id"]: item for item in context["allowed_tools"]}
    assert set(policies) == {tool.name for tool in request.tools} == set(AI_TOOLS)
    for tool_id, item in policies.items():
        assert item["mutates"] is (tool_id in AI_WRITE_TOOLS | AI_BOUNDED_WRITE_TOOLS)
        assert item["approval_required"] is (tool_id in AI_WRITE_TOOLS)
        assert item["authoritative_output"] is False  # AI output is never authoritative
        assert item["description"] and item["audit_category"] and item["input_schema_ref"]
    assert policies["calculation.submit"]["scientific_compute"] is True


# ------------------------------------------------------------------- measured reduction
def test_planning_request_is_materially_smaller_and_still_reserved_from_its_exact_bytes(env):
    capture = Capture()
    env.execute(env.make_run(), capture)
    request = capture.requests[0]
    bound1, bound2 = request_input_bound(request, 1.0), request_input_bound(request, 2.0)
    assert len(request.tools) == 25
    assert bound1.request_bytes <= UNREDUCED_REQUEST_BYTES * 0.93  # measured below, titles only
    assert bound2.tokens <= UNREDUCED_FLOOR2_RESERVATION * 0.93
    assert request.reserved_input_tokens == bound2.tokens  # still derived from the exact request
    # Published-tokenizer measurement (not hosted usage): this request is 3.4 bytes/token, so the
    # reservation must stay at least 1.13x above it. A weaker floor/formula fails here.
    assert request.reserved_input_tokens * 3.0 >= bound2.request_bytes
    # The policy text is untouched: scientific-integrity rules are not trimmed for size.
    from chemdft_api.ai.policy import SYSTEM_POLICY_V1

    assert request.system_prompt.startswith(SYSTEM_POLICY_V1)
