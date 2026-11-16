"""Pre-dispatch input-token reservation policy (INPUT_RESERVATION_V2).

Four quantities are kept distinct everywhere they are stored or reported:

* ``estimated`` - what this module derives from the exact serialized request, before dispatch.
* ``reserved`` - the quota reserved for the call; never smaller than the estimate (a request
  whose estimate does not fit the remaining run budget is rejected, not trimmed).
* ``provider-reported`` - ``usage.prompt_tokens`` from the response, stored as received.
* billed cost - never derived here; provider pricing is unknown and cost stays NULL.

**The estimate is a conservative heuristic, not a guaranteed upper bound.** The UTF-8 bytes of
the text sent to the model are split into two classes, JSON-encoded exactly as the wire adapter
builds them:

* *static* - the system prompt (policy text and ProductContext) and the tool definitions, written
  by the server and bounded. Their measured density is 2.7-4.3 bytes per token, so they are
  divided by the configured floor (default 2.0).
* *dynamic* - every other message (user text, assistant turns, tool results, document passages,
  coordinate or numeric tables). Natural text is cheap, but digits, coordinates, hex/base64 and
  combining marks reach about one token per byte, so dynamic bytes are reserved at one token per
  byte regardless of the floor.

Fixed allowances cover chat-template framing. Measured against the published Nemotron
tokenizer (see docs/implementation/AI_MODEL_GATEWAY.md), this reserves 1.8x the template-rendered
count on real planning requests and never fell below the measured count on any sample. That
tokenizer is a byte-level BPE without a normalizer, so locally it never emits more than one token
per byte of text; but local counts are not NVIDIA hosted usage, the hosted template and
tokenizer are unverified, and nothing here is a guarantee. The safety net is detection:
provider-reported usage above a reservation is stored unclamped, counted as an overrun, and moves
the run to a floor of ``1.0`` for static bytes too. Budget exhaustion remains an explicit,
pre-dispatch rejection.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass

POLICY_VERSION = "INPUT_RESERVATION_V2"
ESTIMATE_BASIS = "BYTE_HEURISTIC_NOT_A_GUARANTEE"
CONSERVATIVE_FALLBACK_BYTES_PER_TOKEN = 1.0
MAX_BYTES_PER_TOKEN_FLOOR = 8.0
PROTOCOL_ALLOWANCE_TOKENS = 1024
PER_MESSAGE_ALLOWANCE_TOKENS = 16
PER_TOOL_ALLOWANCE_TOKENS = 32
# Dynamic (user/tool/document) content is reserved at one token per byte; see module docstring.
DYNAMIC_BYTES_PER_TOKEN = 1.0


@dataclass(frozen=True, slots=True)
class InputReservationBound:
    request_bytes: int
    message_count: int
    tool_count: int
    bytes_per_token_floor: float
    tokens: int
    dynamic_bytes: int = 0
    policy: str = POLICY_VERSION

    def reservation_fields(self) -> dict[str, object]:
        """Durable, clearly-labelled estimate evidence for the invocation reservation."""
        return {
            "input_estimate_policy": self.policy,
            "input_estimate_basis": ESTIMATE_BASIS,
            "estimated_input_request_bytes": self.request_bytes,
            "estimated_input_dynamic_bytes": self.dynamic_bytes,
            "estimated_input_bytes_per_token_floor": self.bytes_per_token_floor,
            "estimated_input_tokens": self.tokens,
        }


def _compact_bytes(value: object) -> int:
    return len(
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
    )


def payload_byte_parts(
    messages_payload: list[dict[str, object]], tools_payload: object
) -> tuple[int, int]:
    """(static_bytes, dynamic_bytes): system message + tool definitions vs every other message.

    The wire adapter always sends the system prompt as the first message; everything after it
    (user text, assistant turns, tool calls and results) is dynamic content.
    """
    static = _compact_bytes(messages_payload[:1]) + _compact_bytes(tools_payload or [])
    return static, _compact_bytes(messages_payload[1:])


def payload_utf8_bytes(messages_payload: list[dict[str, object]], tools_payload: object) -> int:
    """Total UTF-8 bytes of the content the model receives, encoded without ASCII escaping."""
    static, dynamic = payload_byte_parts(messages_payload, tools_payload)
    return static + dynamic


def bound_from_bytes(
    request_bytes: int,
    message_count: int,
    tool_count: int,
    bytes_per_token_floor: float,
    dynamic_bytes: int = 0,
) -> InputReservationBound:
    """Estimate: static bytes / floor + dynamic bytes at one token per byte + fixed allowances."""
    floor = float(bytes_per_token_floor)
    if not CONSERVATIVE_FALLBACK_BYTES_PER_TOKEN <= floor <= MAX_BYTES_PER_TOKEN_FLOOR:
        raise ValueError("bytes-per-token floor must be between 1.0 and 8.0")
    if min(request_bytes, message_count, tool_count, dynamic_bytes) < 0:
        raise ValueError("request measurements must be non-negative")
    if dynamic_bytes > request_bytes:
        raise ValueError("dynamic bytes cannot exceed the request bytes")
    tokens = (
        math.ceil((request_bytes - dynamic_bytes) / floor)
        + math.ceil(dynamic_bytes / DYNAMIC_BYTES_PER_TOKEN)
        + PROTOCOL_ALLOWANCE_TOKENS
        + PER_MESSAGE_ALLOWANCE_TOKENS * message_count
        + PER_TOOL_ALLOWANCE_TOKENS * tool_count
    )
    return InputReservationBound(
        request_bytes, message_count, tool_count, floor, tokens, dynamic_bytes
    )
