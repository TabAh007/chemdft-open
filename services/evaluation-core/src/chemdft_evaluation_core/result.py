"""Immutable scientific result identity for future evaluations."""

from __future__ import annotations

from typing import Any

from pydantic import Field

from .canonicalization import sha256
from .schema import Sha256, StrictModel


class EvaluationResult(StrictModel):
    benchmark_id: str
    package_sha256: Sha256
    policy_sha256: Sha256
    evaluator_version: str
    metrics: dict[str, Any]
    result_sha256: Sha256 | None = Field(default=None)

    def with_identity(self) -> EvaluationResult:
        payload = self.model_dump(mode="json", exclude={"result_sha256"})
        return self.model_copy(update={"result_sha256": result_hash(payload)})


def result_hash(payload: dict) -> str:
    return sha256({k: value for k, value in payload.items() if k != "result_sha256"})
