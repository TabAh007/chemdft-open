from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from pydantic import BaseModel, ValidationError

from ..context import Identity
from ..contracts.tools import (
    ApprovalPolicy,
    PermissionClass,
    SemanticVersion,
    ToolAvailability,
    ToolDefinition,
    ToolErrorCode,
)
from ..errors import (
    ApplicationError,
    ProjectAccessDenied,
    ProjectNotFound,
    ProjectSlugConflict,
    ScientificValidationFailed,
)
from ..models import utc_now


@dataclass(frozen=True, slots=True)
class ExecutionBinding:
    """Server-issued identity of one supervised AI action (never model-controlled)."""

    run_id: str
    epoch: int
    action_key: str
    conversation_id: str | None = None


@dataclass(frozen=True, slots=True)
class ToolInvocationContext:
    request_id: UUID
    identity: Identity
    project_id: UUID | None
    capabilities: frozenset[str]
    approval_references: frozenset[UUID]
    transport: str
    provider: str | None = None
    model: str | None = None
    execution: ExecutionBinding | None = None


@dataclass(frozen=True, slots=True)
class ToolAuditRecord:
    request_id: UUID
    organization_id: str
    project_id: str | None
    actor_id: str
    tool_name: str
    tool_version: str
    transport: str
    input_fingerprint: str
    outcome: str
    error_code: ToolErrorCode | None
    result_reference: str | None
    invoked_at: datetime
    provider: str | None = None
    model: str | None = None
    approval_id: str | None = None


class ToolAuditSink(Protocol):
    def emit(self, record: ToolAuditRecord) -> None: ...


class ToolInvocationError(Exception):
    def __init__(self, code: ToolErrorCode, detail: str) -> None:
        self.code = code
        self.detail = detail
        super().__init__(detail)


@dataclass(frozen=True, slots=True)
class RegisteredTool[InputModel: BaseModel, OutputModel: BaseModel]:
    definition: ToolDefinition
    input_model: type[InputModel]
    output_model: type[OutputModel]
    handler: Callable[[ToolInvocationContext, InputModel], OutputModel]


class NullAuditSink:
    def emit(self, _record: ToolAuditRecord) -> None:
        pass


class ToolRegistry:
    def __init__(
        self,
        audit_sink: ToolAuditSink | None = None,
        approval_verifier: Callable[[ToolInvocationContext, ToolDefinition, object], None]
        | None = None,
    ) -> None:
        self._definitions: dict[str, dict[str, ToolDefinition]] = {}
        self._executables: dict[tuple[str, str], RegisteredTool] = {}
        self._audit_sink = audit_sink or NullAuditSink()
        self._approval_verifier = approval_verifier
        self._ai_guard = None

    def declare(self, definition: ToolDefinition) -> None:
        version = str(definition.version)
        definitions = self._definitions.setdefault(definition.name, {})
        if version in definitions:
            raise ValueError(f"Duplicate tool definition: {definition.name}@{version}")
        definitions[version] = definition

    def register(self, tool: RegisteredTool) -> None:
        if tool.definition.availability is not ToolAvailability.EXECUTABLE:
            raise ValueError("Only executable definitions can register a handler")
        self.declare(tool.definition)
        self._executables[(tool.definition.name, str(tool.definition.version))] = tool

    def discover(self, *, executable_only: bool = True) -> tuple[ToolDefinition, ...]:
        definitions = (
            definition
            for versions in self._definitions.values()
            for definition in versions.values()
        )
        if executable_only:
            definitions = (
                definition
                for definition in definitions
                if definition.availability is ToolAvailability.EXECUTABLE
            )
        return tuple(sorted(definitions, key=lambda item: (item.name, str(item.version))))

    def resolve(self, name: str, version: SemanticVersion | None = None) -> RegisteredTool:
        definitions = self._definitions.get(name)
        if not definitions:
            raise ToolInvocationError(ToolErrorCode.NOT_FOUND, "Unknown tool.")
        if version:
            version_key = str(version)
        else:
            executable_versions = tuple(
                candidate
                for candidate, definition in definitions.items()
                if definition.availability is ToolAvailability.EXECUTABLE
                and (name, candidate) in self._executables
            )
            version_key = max(
                executable_versions or tuple(definitions),
                key=lambda item: tuple(int(part) for part in item.split(".")),
            )
        definition = definitions.get(version_key)
        if definition is None:
            raise ToolInvocationError(
                ToolErrorCode.TOOL_VERSION_UNSUPPORTED,
                "Requested tool version is unavailable.",
            )
        tool = self._executables.get((name, version_key))
        if tool is None or definition.availability is not ToolAvailability.EXECUTABLE:
            raise ToolInvocationError(
                ToolErrorCode.CAPABILITY_UNAVAILABLE,
                "Tool is declared but not executable.",
            )
        return tool

    def invoke(
        self,
        name: str,
        arguments: object,
        context: ToolInvocationContext,
        version: SemanticVersion | None = None,
    ) -> BaseModel:
        invoked_at = utc_now()
        input_fingerprint = _fingerprint(arguments)
        try:
            tool = self.resolve(name, version)
        except ToolInvocationError as error:
            definition = self._definition_for_attempt(name, version)
            if definition is not None:
                self._emit_error(context, definition, input_fingerprint, invoked_at, error)
            raise
        try:
            missing = set(tool.definition.required_capabilities) - context.capabilities
            if missing:
                raise ToolInvocationError(
                    ToolErrorCode.FORBIDDEN,
                    "Caller lacks a required server-issued capability.",
                )
            if (
                tool.definition.permission_class
                in {PermissionClass.EXPENSIVE, PermissionClass.DESTRUCTIVE_EXTERNAL}
                or tool.definition.approval_policy is ApprovalPolicy.EXPLICIT
            ) and not context.approval_references:
                raise ToolInvocationError(
                    ToolErrorCode.APPROVAL_REQUIRED,
                    "A server-issued approval reference is required.",
                )
            parsed = tool.input_model.model_validate(arguments)
            if context.transport.casefold() in {"ai_scientist", "investigation"}:
                if self._ai_guard is None:
                    raise ToolInvocationError(
                        ToolErrorCode.FORBIDDEN, "AI execution policy is not configured."
                    )
                self._ai_guard(context, tool.definition, parsed.model_dump(mode="json"))
            if (
                context.transport.casefold() in {"ai_scientist", "investigation"}
                and tool.definition.side_effect.value not in {"PURE", "READ_ONLY"}
                and self._approval_verifier is None
            ):
                raise ToolInvocationError(
                    ToolErrorCode.APPROVAL_REQUIRED, "Server approval verification is unavailable."
                )
            if context.approval_references and self._approval_verifier is not None:
                self._approval_verifier(context, tool.definition, arguments)
            output = tool.handler(context, parsed)
            validated_output = tool.output_model.model_validate(output)
            self._emit(
                context,
                tool.definition,
                input_fingerprint,
                "SUCCEEDED",
                invoked_at,
                result_reference=_result_reference(validated_output),
            )
            return validated_output
        except ValidationError as error:
            invocation_error = ToolInvocationError(
                ToolErrorCode.VALIDATION_ERROR,
                "Tool arguments or output failed schema validation.",
            )
            self._emit_error(
                context, tool.definition, input_fingerprint, invoked_at, invocation_error
            )
            raise invocation_error from error
        except ToolInvocationError as error:
            self._emit_error(context, tool.definition, input_fingerprint, invoked_at, error)
            raise
        except ApplicationError as error:
            invocation_error = ToolInvocationError(application_error_code(error), error.detail)
            self._emit_error(
                context, tool.definition, input_fingerprint, invoked_at, invocation_error
            )
            raise invocation_error from error
        except Exception as error:
            invocation_error = ToolInvocationError(
                ToolErrorCode.INTERNAL_ERROR,
                "Tool execution failed.",
            )
            self._emit_error(
                context, tool.definition, input_fingerprint, invoked_at, invocation_error
            )
            raise invocation_error from error

    def _definition_for_attempt(
        self, name: str, version: SemanticVersion | None
    ) -> ToolDefinition | None:
        definitions = self._definitions.get(name)
        if not definitions:
            return None
        if version is not None:
            return definitions.get(str(version))
        latest = max(
            definitions,
            key=lambda item: tuple(int(part) for part in item.split(".")),
        )
        return definitions[latest]

    def _emit_error(
        self,
        context: ToolInvocationContext,
        definition: ToolDefinition,
        fingerprint: str,
        invoked_at: datetime,
        error: ToolInvocationError,
    ) -> None:
        self._emit(
            context,
            definition,
            fingerprint,
            "REJECTED",
            invoked_at,
            error_code=error.code,
        )

    def _emit(
        self,
        context: ToolInvocationContext,
        definition: ToolDefinition,
        fingerprint: str,
        outcome: str,
        invoked_at: datetime,
        *,
        error_code: ToolErrorCode | None = None,
        result_reference: str | None = None,
    ) -> None:
        if context.transport.casefold() in {"ai_scientist", "investigation"}:
            from ..ai.observability import emit

            emit(
                "ai.tool.completed",
                human_id=context.identity.user_id,
                organization_id=context.identity.organization_id,
                project_id=str(context.project_id) if context.project_id else None,
                tool_id=definition.name,
                provider=context.provider,
                model=context.model,
                arguments_hash=fingerprint,
                approval_id=str(next(iter(context.approval_references)))
                if context.approval_references
                else None,
                status=outcome,
                error_code=error_code.value if error_code else None,
            )
        self._audit_sink.emit(
            ToolAuditRecord(
                request_id=context.request_id,
                organization_id=context.identity.organization_id,
                project_id=str(context.project_id) if context.project_id else None,
                actor_id=context.identity.user_id,
                tool_name=definition.name,
                tool_version=str(definition.version),
                transport=context.transport,
                input_fingerprint=fingerprint,
                outcome=outcome,
                error_code=error_code,
                result_reference=result_reference,
                invoked_at=invoked_at,
                provider=context.provider,
                model=context.model,
                approval_id=str(next(iter(context.approval_references)))
                if context.approval_references
                else None,
            )
        )


def _fingerprint(arguments: object) -> str:
    encoded = json.dumps(arguments, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def _result_reference(output: BaseModel) -> str | None:
    value = getattr(output, "id", None)
    return str(value) if value is not None else None


def application_error_code(error: ApplicationError) -> ToolErrorCode:
    """Canonical tool diagnostic for domain errors, which need not expose `.code`."""
    if isinstance(error, ProjectNotFound):
        return ToolErrorCode.NOT_FOUND
    if isinstance(error, ProjectAccessDenied):
        return ToolErrorCode.FORBIDDEN
    if isinstance(error, ProjectSlugConflict):
        return ToolErrorCode.CONFLICT
    if isinstance(error, ScientificValidationFailed):
        return ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED
    return ToolErrorCode.INTERNAL_ERROR


def executable_names(definitions: Iterable[ToolDefinition]) -> set[str]:
    return {
        definition.name
        for definition in definitions
        if definition.availability is ToolAvailability.EXECUTABLE
    }
