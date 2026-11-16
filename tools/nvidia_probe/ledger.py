"""Hard budget enforcement for a live probe. Pure arithmetic: no clock reads, no network."""

from __future__ import annotations

from dataclasses import dataclass, field

from .authorization import ProbeAuthorization


class BudgetStop(Exception):
    """A limit would be crossed: stop the whole probe; never retry or downsize silently."""

    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason


@dataclass(slots=True)
class BudgetLedger:
    authorization: ProbeAuthorization
    calls_admitted: int = 0
    committed_tokens: int = 0  # conservative: worst case until a reported usage replaces it
    committed_usd: float = 0.0
    unknown_usage_calls: int = 0
    _open: tuple[int, float] | None = field(default=None, repr=False)

    def worst_case(self, input_bound: int, output_cap: int) -> tuple[int, float | None]:
        return (
            input_bound + output_cap,
            self.authorization.spend_control.worst_case_usd(input_bound, output_cap),
        )

    def admit(self, *, input_bound: int, output_cap: int, elapsed_seconds: float) -> None:
        auth = self.authorization
        if self._open is not None:
            raise BudgetStop("CALL_NOT_SETTLED", "settle the previous call before the next")
        if self.calls_admitted >= auth.max_total_calls:
            raise BudgetStop("CALL_CEILING", f"{auth.max_total_calls} calls")
        if elapsed_seconds + auth.per_call_wall_clock_seconds > auth.max_wall_clock_seconds:
            raise BudgetStop("WALL_CLOCK", f"{auth.max_wall_clock_seconds} s total")
        if input_bound > auth.max_input_tokens_per_request:
            raise BudgetStop("INPUT_CAP", f"{input_bound} > {auth.max_input_tokens_per_request}")
        if output_cap > auth.max_output_tokens_per_request:
            raise BudgetStop("OUTPUT_CAP", f"{output_cap} > {auth.max_output_tokens_per_request}")
        tokens, usd = self.worst_case(input_bound, output_cap)
        if self.committed_tokens + tokens > auth.max_total_tokens:
            raise BudgetStop("TOKEN_CEILING", f"{auth.max_total_tokens} tokens")
        if usd is not None and self.committed_usd + usd > auth.spend_control.ceiling_usd:
            raise BudgetStop("USD_CEILING", f"{auth.spend_control.ceiling_usd} USD")
        self.calls_admitted += 1
        self.committed_tokens += tokens
        self.committed_usd += usd or 0.0
        self._open = (tokens, usd or 0.0)

    def settle(self, usage: tuple[int, int] | None) -> None:
        """Replace the worst-case reservation with provider-reported usage, if any.

        Unknown usage keeps the conservative reservation: it is never treated as zero.
        """
        if self._open is None:
            raise BudgetStop("CALL_NOT_ADMITTED")
        reserved_tokens, reserved_usd = self._open
        self._open = None
        if usage is None:
            self.unknown_usage_calls += 1
            return
        used_input, used_output = usage
        actual_tokens = used_input + used_output
        if actual_tokens < reserved_tokens:
            self.committed_tokens -= reserved_tokens - actual_tokens
            spend = self.authorization.spend_control
            if spend.kind == "USD_CEILING":
                self.committed_usd += spend.worst_case_usd(used_input, used_output) - reserved_usd
        # A provider that reports more than reserved cannot be undone; the next admit will stop.
        elif actual_tokens > reserved_tokens:
            self.committed_tokens += actual_tokens - reserved_tokens
