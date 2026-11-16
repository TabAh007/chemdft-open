"""Two bounded read tools; neither runs compute nor mutates scientific records."""

from sqlalchemy import select

from ..contracts.ai import StructureListInput
from ..contracts.ai_foundation import AIExamplesOutput, ProductSelection
from ..contracts.navigator import NavigatorState
from ..contracts.tools import (
    IdempotencyBehavior,
    PermissionClass,
    SideEffectClass,
    ToolAvailability,
)
from ..example_models import ExampleTemplate
from ..navigator.service import get_navigator
from ..tool_registry.catalog import _definition
from ..tool_registry.registry import RegisteredTool


def add_context_tools(registry, session, settings) -> None:
    def navigator_read(context, hints):
        from .product_context import ProductContextBuilder

        validated = (
            ProductContextBuilder(session, context.identity, settings, registry)
            .build(str(context.project_id), hints)
            .selection
        )
        return get_navigator(
            session,
            context.identity,
            str(context.project_id),
            settings,
            goal=validated.goal,
            structure_version_id=str(validated.selected_structure_version_id)
            if validated.selected_structure_version_id
            else None,
        )

    registry.register(
        RegisteredTool(
            definition=_definition(
                name="navigator.get",
                description=("Read authoritative PF-4 goal, HAVE, NEXT and BLOCKED; "
                "never override its rules."),
                input_schema="chemdft.product-selection.v1",
                output_schema="chemdft.navigator-state.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="project.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=ProductSelection,
            output_model=NavigatorState,
            handler=navigator_read,
        )
    )
    registry.register(
        RegisteredTool(
            definition=_definition(
                name="examples.list",
                description=("Inspect published public reference example slugs, "
                "without copying or creating a project."),
                input_schema="chemdft.structure-list-input.v1",
                output_schema="chemdft.ai-examples-output.v1",
                permission=PermissionClass.READ,
                side_effect=SideEffectClass.READ_ONLY,
                availability=ToolAvailability.EXECUTABLE,
                capability="project.read",
                idempotency=IdempotencyBehavior.NATURAL,
            ),
            input_model=StructureListInput,
            output_model=AIExamplesOutput,
            handler=lambda _context, _hints: AIExamplesOutput(
                slugs=tuple(
                    session.scalars(
                        select(ExampleTemplate.slug)
                        .where(ExampleTemplate.published.is_(True))
                        .order_by(ExampleTemplate.slug)
                        .limit(3)
                    ).all()
                )
            ),
        )
    )
