from __future__ import annotations

from dataclasses import replace
from uuid import uuid4

import pytest
from chemdft_api.context import Identity
from chemdft_api.contracts.base import ContractModel
from chemdft_api.contracts.tools import (
    ApprovalPolicy,
    AuthoritativeFieldPolicy,
    IdempotencyBehavior,
    PermissionClass,
    SemanticVersion,
    SideEffectClass,
    ToolAvailability,
    ToolDefinition,
    ToolErrorCode,
)
from chemdft_api.scientific_models import AuditEventRecord, ToolInvocationRecordRow
from chemdft_api.tool_registry import ToolInvocationContext, ToolInvocationError
from chemdft_api.tool_registry.catalog import build_phase_2_registry
from chemdft_api.tool_registry.registry import RegisteredTool, ToolAuditRecord, ToolRegistry
from pydantic import ValidationError
from sqlalchemy import func, select


class EchoInput(ContractModel):
    value: str


class EchoOutput(ContractModel):
    value: str


class RecordingAuditSink:
    def __init__(self) -> None:
        self.records: list[ToolAuditRecord] = []

    def emit(self, record: ToolAuditRecord) -> None:
        self.records.append(record)


def _context(settings, *, capabilities=frozenset(), approvals=frozenset()):
    return ToolInvocationContext(
        request_id=uuid4(),
        identity=Identity(
            user_id=settings.dev_user_id,
            organization_id=settings.dev_organization_id,
        ),
        project_id=None,
        capabilities=capabilities,
        approval_references=approvals,
        transport="INTERNAL",
    )


def _echo_definition(
    *,
    version: SemanticVersion | None = None,
    permission: PermissionClass = PermissionClass.READ,
) -> ToolDefinition:
    return ToolDefinition(
        name="synthetic.echo",
        version=version or SemanticVersion(major=1, minor=0, patch=0),
        description="Synthetic registry contract fixture.",
        input_schema_ref="chemdft.synthetic-echo-input.v1",
        output_schema_ref="chemdft.synthetic-echo-output.v1",
        permission_class=permission,
        cost_class="platform.none",
        risk_class="test",
        approval_policy=(
            ApprovalPolicy.EXPLICIT
            if permission is PermissionClass.DESTRUCTIVE_EXTERNAL
            else ApprovalPolicy.NONE
        ),
        side_effect=(
            SideEffectClass.DESTRUCTIVE
            if permission is PermissionClass.DESTRUCTIVE_EXTERNAL
            else SideEffectClass.PURE
        ),
        reversible=permission is not PermissionClass.DESTRUCTIVE_EXTERNAL,
        idempotency=IdempotencyBehavior.NATURAL,
        authoritative_field_policy=AuthoritativeFieldPolicy.NONE,
        availability=ToolAvailability.EXECUTABLE,
    )


def test_phase_2_registry_executes_existing_project_actions_and_audits(api) -> None:
    _client, sessions, settings = api
    with sessions() as session:
        registry = build_phase_2_registry(session)
        executable_names = {definition.name for definition in registry.discover()}
        all_definitions = {
            definition.name: definition for definition in registry.discover(executable_only=False)
        }
        context = _context(
            settings,
            capabilities=frozenset({"project.read", "project.create"}),
        )
        created = registry.invoke(
            "project.create",
            {"name": "Registry project", "slug": f"registry-{uuid4().hex[:8]}"},
            context,
        )
        listed = registry.invoke("project.list", {}, replace(context, request_id=uuid4()))
        invocation_count = session.scalar(select(func.count()).select_from(ToolInvocationRecordRow))
        audit_count = session.scalar(select(func.count()).select_from(AuditEventRecord))

    assert executable_names == {
        "project.create",
        "project.get",
        "project.list",
        "structure.version.create",
    }
    assert all_definitions["calculation.submit"].availability is ToolAvailability.FUTURE
    assert "calculation.submit" not in executable_names
    assert any(project.id == created.id for project in listed.projects)
    assert invocation_count == 2
    assert audit_count == 2


@pytest.mark.parametrize("injected", [{"actor_id": str(uuid4())}, {"permission_class": "READ"}])
def test_model_arguments_cannot_inject_context_or_policy(api, injected) -> None:
    _client, sessions, settings = api
    with sessions() as session:
        registry = build_phase_2_registry(session)
        context = _context(settings, capabilities=frozenset({"project.create"}))
        arguments = {
            "name": "Rejected injection",
            "slug": f"rejected-{uuid4().hex[:8]}",
            **injected,
        }
        with pytest.raises(ToolInvocationError) as caught:
            registry.invoke("project.create", arguments, context)
    assert caught.value.code is ToolErrorCode.VALIDATION_ERROR


def test_capability_and_approval_are_server_owned(api) -> None:
    _client, _sessions, settings = api
    calls = 0

    def handler(_context: ToolInvocationContext, payload: EchoInput) -> EchoOutput:
        nonlocal calls
        calls += 1
        return EchoOutput(value=payload.value)

    registry = ToolRegistry()
    registry.register(
        RegisteredTool(
            definition=_echo_definition(permission=PermissionClass.DESTRUCTIVE_EXTERNAL),
            input_model=EchoInput,
            output_model=EchoOutput,
            handler=handler,
        )
    )
    with pytest.raises(ToolInvocationError) as caught:
        registry.invoke("synthetic.echo", {"value": "safe fixture"}, _context(settings))
    assert caught.value.code is ToolErrorCode.APPROVAL_REQUIRED
    assert calls == 0


def test_duplicate_unknown_unavailable_and_version_resolution(api) -> None:
    _client, sessions, settings = api
    sink = RecordingAuditSink()
    calls: list[str] = []

    def handler_100(_context: ToolInvocationContext, payload: EchoInput) -> EchoOutput:
        calls.append("1.0.0")
        return EchoOutput(value=payload.value)

    def handler_110(_context: ToolInvocationContext, payload: EchoInput) -> EchoOutput:
        calls.append("1.1.0")
        return EchoOutput(value=payload.value)

    first = RegisteredTool(
        definition=_echo_definition(),
        input_model=EchoInput,
        output_model=EchoOutput,
        handler=handler_100,
    )
    registry = ToolRegistry(sink)
    registry.register(first)
    with pytest.raises(ValueError, match="Duplicate"):
        registry.register(first)
    registry.register(
        RegisteredTool(
            definition=_echo_definition(version=SemanticVersion(major=1, minor=1, patch=0)),
            input_model=EchoInput,
            output_model=EchoOutput,
            handler=handler_110,
        )
    )
    registry.declare(
        _echo_definition(version=SemanticVersion(major=2, minor=0, patch=0)).model_copy(
            update={"availability": ToolAvailability.FUTURE}
        )
    )

    output = registry.invoke("synthetic.echo", {"value": "typed"}, _context(settings))
    assert output == EchoOutput(value="typed")
    assert calls == ["1.1.0"]
    assert len(sink.records) == 1

    with pytest.raises(ToolInvocationError) as unsupported_version:
        registry.resolve("synthetic.echo", SemanticVersion(major=1, minor=2, patch=0))
    assert unsupported_version.value.code is ToolErrorCode.TOOL_VERSION_UNSUPPORTED

    with pytest.raises(ToolInvocationError) as unknown:
        registry.invoke("synthetic.unknown", {}, _context(settings))
    assert unknown.value.code is ToolErrorCode.NOT_FOUND

    with sessions() as session:
        phase_2 = build_phase_2_registry(session)
        with pytest.raises(ToolInvocationError) as unavailable:
            phase_2.invoke(
                "calculation.submit",
                {},
                _context(settings, capabilities=frozenset({"calculation.submit"})),
            )
        rejected_count = session.scalar(
            select(func.count())
            .select_from(ToolInvocationRecordRow)
            .where(ToolInvocationRecordRow.outcome == "REJECTED")
        )
    assert unavailable.value.code is ToolErrorCode.CAPABILITY_UNAVAILABLE
    assert rejected_count == 1


def test_tool_definitions_are_immutable_server_metadata() -> None:
    definition = _echo_definition()
    with pytest.raises(ValidationError):
        definition.permission_class = PermissionClass.LOW_COST_REVERSIBLE


def test_output_validation_occurs_after_exactly_one_handler_call(api) -> None:
    _client, _sessions, settings = api
    calls = 0

    def invalid_handler(_context: ToolInvocationContext, _payload: EchoInput) -> EchoOutput:
        nonlocal calls
        calls += 1
        return {"unexpected": "shape"}  # type: ignore[return-value]

    registry = ToolRegistry()
    registry.register(
        RegisteredTool(
            definition=_echo_definition(),
            input_model=EchoInput,
            output_model=EchoOutput,
            handler=invalid_handler,
        )
    )
    with pytest.raises(ToolInvocationError) as caught:
        registry.invoke("synthetic.echo", {"value": "typed"}, _context(settings))
    assert caught.value.code is ToolErrorCode.VALIDATION_ERROR
    assert calls == 1
