"""Token and resource budget tracking for AI Scientist execution.

Adheres to AS-0 and Batch A rules:
- Tracks input tokens, output tokens, model call count, tool call count.
- Enforces mission-level limits on the server. A missing limit falls back to the finite server
  defaults below, a zero limit means "no allocation", and a malformed stored budget is rejected
  rather than treated as unlimited.
- Conservative reservation before every model call (input *and* output), reconciled with actual
  usage afterwards. At most one call may be in flight, so reservations cannot be double-spent.
  The input reservation is derived from the exact request (see ``token_policy``) and is never
  silently reduced: a request whose reservation exceeds the remaining input allowance is rejected.
  Provider-reported input above the reservation is counted in ``input_overruns``; once any
  overrun has happened the run reserves with the conservative 1 byte/token fallback (still a
  heuristic, not a guaranteed bound).
- A call whose outcome is unknown (crash/timeout) keeps its reservation as spent on recovery
  (``settle_uncertain``); counters are never reset by Pause/Resume.
- The authoritative copy lives in ``ai_runs.budget_json`` and is persisted with a fencing-epoch
  compare-and-set by the execution manager.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any
from uuid import UUID, uuid4

from ..errors import ApplicationError
from .token_policy import (
    CONSERVATIVE_FALLBACK_BYTES_PER_TOKEN,
    InputReservationBound,
    bound_from_bytes,
)

DEFAULT_MAX_INPUT_TOKENS = 60_000
DEFAULT_MAX_OUTPUT_TOKENS = 12_000
DEFAULT_MAX_MODEL_CALLS = 15
DEFAULT_MAX_TOOL_CALLS = 30


class AIBudgetExceededError(ApplicationError):
    def __init__(self, resource: str, limit: int, current: int):
        self.code = "AI_BUDGET_EXCEEDED"
        self.status_code = 400
        self.resource = resource
        self.limit = limit
        self.current = current
        super().__init__(f"AI execution exceeded {resource} limit ({current}/{limit}).")


class AIBudgetInvalidError(ApplicationError):
    def __init__(self, detail: str):
        self.code = "AI_BUDGET_INVALID"
        self.status_code = 500
        super().__init__(f"Stored AI budget is invalid and execution is blocked: {detail}")


_FIELDS = (
    "max_input_tokens",
    "max_output_tokens",
    "max_model_calls",
    "max_tool_calls",
    "input_tokens_used",
    "output_tokens_used",
    "model_calls_used",
    "tool_calls_used",
    "reserved_input_tokens",
    "reserved_output_tokens",
    "input_overruns",
    "input_reservation_tokens_used",
)


@dataclass
class AIRunBudget:
    max_input_tokens: int = DEFAULT_MAX_INPUT_TOKENS
    max_output_tokens: int = DEFAULT_MAX_OUTPUT_TOKENS
    max_model_calls: int = DEFAULT_MAX_MODEL_CALLS
    max_tool_calls: int = DEFAULT_MAX_TOOL_CALLS
    # Optional lower-only request cap also bounds the SUM of input reservations,
    # independently of provider-reported usage reconciled after each call.
    max_input_reservation_tokens: int | None = None
    input_reservation_tokens_used: int = 0
    input_tokens_used: int = 0
    output_tokens_used: int = 0
    model_calls_used: int = 0
    tool_calls_used: int = 0
    reserved_input_tokens: int = 0
    reserved_output_tokens: int = 0
    input_overruns: int = 0
    model_call_in_flight: bool = False
    reservation_id: str | None = None

    def check_can_call_model(
        self, estimated_input_tokens: int = 1000, estimated_output_tokens: int = 256
    ) -> None:
        if self.model_call_in_flight:
            raise AIBudgetExceededError("concurrent model calls", 1, 2)
        if self.model_calls_used >= self.max_model_calls:
            raise AIBudgetExceededError("model calls", self.max_model_calls, self.model_calls_used)
        # A reservation is only possible when there is remaining headroom for
        # both input and output. The actual reservation is capped at the
        # remaining budget so the per-request limit never exceeds the run-level
        # allowance.
        remaining_input = self.max_input_tokens - self.input_tokens_used
        remaining_output = self.max_output_tokens - self.output_tokens_used
        if remaining_input <= 0:
            raise AIBudgetExceededError(
                "input tokens", self.max_input_tokens, self.input_tokens_used
            )
        if remaining_output <= 0:
            raise AIBudgetExceededError(
                "output tokens", self.max_output_tokens, self.output_tokens_used
            )

    def reserve_model_call(
        self, estimated_input_tokens: int = 1000, estimated_output_tokens: int = 256
    ) -> None:
        self.check_can_call_model(estimated_input_tokens, estimated_output_tokens)
        remaining_input = self.max_input_tokens - self.input_tokens_used
        remaining_output = self.max_output_tokens - self.output_tokens_used
        # The input reservation is the pre-dispatch estimate of what the request may consume.
        # It must never be cut down to whatever headroom remains: a request that cannot be
        # fully reserved is rejected before dispatch so an overspend cannot be discovered only
        # after the provider has been called.
        estimated_input = max(estimated_input_tokens, 0)
        if estimated_input > remaining_input:
            raise AIBudgetExceededError("input reservation", remaining_input, estimated_input)
        if self.max_input_reservation_tokens is not None:
            cumulative = self.input_reservation_tokens_used + estimated_input
            if cumulative > self.max_input_reservation_tokens:
                raise AIBudgetExceededError(
                    "cumulative input reservations", self.max_input_reservation_tokens, cumulative
                )
        # Output is bounded on the wire by max_tokens, so capping it at the remaining
        # allowance is enforceable and safe.
        self.reserved_input_tokens = estimated_input
        self.input_reservation_tokens_used += estimated_input
        self.reserved_output_tokens = min(max(estimated_output_tokens, 0), remaining_output)
        self.model_call_in_flight = True
        self.reservation_id = str(uuid4())

    def reserve_request(
        self,
        request_bytes: int,
        message_count: int,
        tool_count: int,
        configured_bytes_per_token_floor: float,
        estimated_output_tokens: int,
        dynamic_bytes: int = 0,
    ) -> InputReservationBound:
        """Reserve for one exact request. A run that ever exceeded a reservation uses floor 1."""
        floor = (
            CONSERVATIVE_FALLBACK_BYTES_PER_TOKEN
            if self.input_overruns
            else configured_bytes_per_token_floor
        )
        bound = bound_from_bytes(request_bytes, message_count, tool_count, floor, dynamic_bytes)
        self.reserve_model_call(bound.tokens, estimated_output_tokens)
        return bound

    def reconcile_model_usage(
        self,
        actual_input_tokens: int = 0,
        actual_output_tokens: int = 0,
        actual_input: int | None = None,
        actual_output: int | None = None,
    ) -> None:
        if actual_input is not None:
            actual_input_tokens = actual_input
        if actual_output is not None:
            actual_output_tokens = actual_output
        if max(0, actual_input_tokens) > self.reserved_input_tokens:
            # Provider-reported input above what was reserved: recorded, never clamped.
            self.input_overruns += 1
        self.reserved_input_tokens = 0
        self.reserved_output_tokens = 0
        self.model_call_in_flight = False
        self.reservation_id = None
        self.model_calls_used += 1
        self.input_tokens_used += max(0, actual_input_tokens)
        self.output_tokens_used += max(0, actual_output_tokens)

        if self.input_tokens_used > self.max_input_tokens:
            raise AIBudgetExceededError(
                "input tokens", self.max_input_tokens, self.input_tokens_used
            )
        if self.output_tokens_used > self.max_output_tokens:
            raise AIBudgetExceededError(
                "output tokens", self.max_output_tokens, self.output_tokens_used
            )

    def release_unsent_reservation(self) -> bool:
        """Drop an in-flight reservation for a request that was provably never dispatched.

        Unlike ``settle_uncertain`` nothing is charged and the call does not count as a model
        call; only the reservation and the in-flight slot are released.
        """
        if not self.model_call_in_flight:
            return False
        self.reserved_input_tokens = 0
        self.reserved_output_tokens = 0
        self.model_call_in_flight = False
        self.reservation_id = None
        return True

    def settle_uncertain(self) -> bool:
        """Count an unreconciled in-flight call as fully spent (crash/timeout recovery)."""
        if not self.model_call_in_flight:
            return False
        self.model_calls_used += 1
        self.input_tokens_used += self.reserved_input_tokens
        self.output_tokens_used += self.reserved_output_tokens
        self.reserved_input_tokens = 0
        self.reserved_output_tokens = 0
        self.model_call_in_flight = False
        self.reservation_id = None
        return True

    reserve = reserve_model_call
    reconcile = reconcile_model_usage

    @property
    def input_tokens(self) -> int:
        return self.input_tokens_used

    @property
    def output_tokens(self) -> int:
        return self.output_tokens_used

    @property
    def tool_calls(self) -> int:
        return self.tool_calls_used

    def record_tool_call(self) -> None:
        if self.tool_calls_used >= self.max_tool_calls:
            raise AIBudgetExceededError("tool calls", self.max_tool_calls, self.tool_calls_used)
        self.tool_calls_used += 1

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> AIRunBudget:
        """Missing keys take the finite defaults; malformed values block execution."""
        if data is None:
            return cls()
        if not isinstance(data, dict):
            raise AIBudgetInvalidError("budget is not an object")
        values: dict[str, Any] = {}
        for name in _FIELDS:
            if name in data:
                value = data[name]
                if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                    raise AIBudgetInvalidError(f"{name} must be a non-negative integer")
                values[name] = value
        in_flight = data.get("model_call_in_flight", False)
        if not isinstance(in_flight, bool):
            raise AIBudgetInvalidError("model_call_in_flight must be a boolean")
        reservation_id = data.get("reservation_id")
        reservation_limit = data.get("max_input_reservation_tokens")
        if reservation_limit is not None:
            if (
                isinstance(reservation_limit, bool)
                or not isinstance(reservation_limit, int)
                or reservation_limit < 0
            ):
                raise AIBudgetInvalidError(
                    "max_input_reservation_tokens must be a non-negative integer or null"
                )
            values["max_input_reservation_tokens"] = reservation_limit
        if reservation_id is not None:
            try:
                UUID(reservation_id)
            except (ValueError, TypeError, AttributeError) as error:
                raise AIBudgetInvalidError("reservation_id must be a UUID") from error
        return cls(**values, model_call_in_flight=in_flight, reservation_id=reservation_id)
