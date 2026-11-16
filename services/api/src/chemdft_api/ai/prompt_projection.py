"""Model-facing projection of tool schemas (PROMPT_PROJECTION_V1).

Only JSON-Schema ``title`` annotations are removed. They are derived from field names ("Method",
"Basis"), carry no constraint and duplicate the property names the model already sees. Types,
enums, constants, defaults, ``required`` lists, bounds and descriptions are kept, and tool
arguments are still validated server-side against the original Pydantic models, so what the model
is shown can never widen or narrow what is accepted or authorized.

Deliberately NOT projected: the serialized ``ProductContext``. It is persisted as the exact
snapshot of what the model received (``ai_context_snapshots``, schema ``product-context/1.0.0``)
and an accepted test pins that equality, so any reduction there needs a new, versioned context
schema rather than a silent prompt-only change.
"""

from __future__ import annotations

from typing import Any

PROJECTION_VERSION = "PROMPT_PROJECTION_V1"

# Keys whose values are data (not sub-schemas); never rewritten.
_OPAQUE_KEYS = frozenset({"default", "const", "enum", "examples", "example"})
# Keys whose values map arbitrary names to sub-schemas; the names themselves are kept.
_NAMED_SCHEMA_MAPS = frozenset({"properties", "$defs", "definitions", "patternProperties"})


def compact_tool_schema(node: Any) -> Any:
    """Return the schema without ``title`` annotations; all constraints are preserved."""
    if isinstance(node, list):
        return [compact_tool_schema(item) for item in node]
    if not isinstance(node, dict):
        return node
    result: dict[str, Any] = {}
    for key, value in node.items():
        if key == "title" and isinstance(value, str):
            continue
        if key in _OPAQUE_KEYS:
            result[key] = value
        elif key in _NAMED_SCHEMA_MAPS and isinstance(value, dict):
            result[key] = {name: compact_tool_schema(sub) for name, sub in value.items()}
        else:
            result[key] = compact_tool_schema(value)
    return result
