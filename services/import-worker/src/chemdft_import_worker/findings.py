# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Finding:
    """A diagnostic. `reject` findings make the whole import impossible; `warning`/`info` never do."""

    code: str
    severity: str  # "reject" | "warning" | "info"
    message: str
    line: int | None = None

    def as_dict(self) -> dict:
        return {"code": self.code, "severity": self.severity, "message": self.message, "line": self.line}


def has_rejection(findings: list[Finding]) -> bool:
    return any(f.severity == "reject" for f in findings)
