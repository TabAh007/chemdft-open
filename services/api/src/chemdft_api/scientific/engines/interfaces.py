# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from ...contracts.results import AuthoritativeScientificPayload
from ...contracts.scientific import CalculationSpecification, EngineReference


@dataclass(frozen=True, slots=True)
class LocalSubprocessRequest:
    calculation_id: str
    normalized_input: bytes
    interpreter: Path
    worker_script: Path
    timeout_seconds: int
    max_output_bytes: int
    threads: int
    extra_args: tuple[str, ...] = ()
    max_scratch_bytes: int | None = None


@dataclass(frozen=True, slots=True)
class ExecutionResult:
    exit_code: int | None
    timed_out: bool
    stdout: bytes
    stderr: bytes
    engine_log: bytes
    result_document: dict[str, object] | None
    native_artifacts: dict[str, bytes] = field(default_factory=dict)
    failure_code: str | None = None
    # Opaque provider-side run reference (for example "aws:<run id>"); None for local runs.
    provider_ref: str | None = None


class EngineAdapter(Protocol):
    def identify(self, result: ExecutionResult) -> EngineReference: ...
    def validate_specification(self, specification: CalculationSpecification) -> None: ...
    def prepare_input(self, specification: CalculationSpecification) -> bytes: ...


class ExecutionRunner(Protocol):
    def execute(self, request: LocalSubprocessRequest) -> ExecutionResult: ...


class ResultParser(Protocol):
    def parse(self, execution: ExecutionResult) -> dict[str, object]: ...


class PropertyValidator(Protocol):
    def validate(self, candidate: dict[str, object]) -> AuthoritativeScientificPayload: ...
