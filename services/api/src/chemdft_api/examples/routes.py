from typing import Annotated

from fastapi import APIRouter, Depends, Response
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from ..auth import require_identity
from ..composition import get_object_store
from ..config import Settings, get_settings
from ..context import Identity
from ..contracts.examples import ExampleCopyOutput, ExampleDetail, ExampleSummary
from ..contracts.navigator import GoalId, NavigatorState
from ..database import get_session
from ..errors import ApplicationError
from ..storage import ObjectStore
from . import service


class ExampleRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request):
            try:
                return await handler(request)
            except ApplicationError as error:
                from ..main import application_error_to_http

                raise application_error_to_http(error) from error

        return handle


router = APIRouter(prefix="/v1/examples", tags=["examples"], route_class=ExampleRoute)
SessionDependency = Annotated[Session, Depends(get_session)]
SettingsDependency = Annotated[Settings, Depends(get_settings)]


@router.get("", response_model=tuple[ExampleSummary, ...])
def examples(session: SessionDependency):
    return service.list_examples(session)


@router.get("/{slug}", response_model=ExampleDetail)
def example(slug: str, session: SessionDependency, settings: SettingsDependency):
    return service.detail(session, slug, settings)


@router.get("/{slug}/navigator", response_model=NavigatorState)
def navigator(
    slug: str, session: SessionDependency, settings: SettingsDependency, goal: GoalId | None = None
):
    return service.example_navigator(session, slug, settings, goal)


@router.get("/{slug}/source")
def source(
    slug: str, session: SessionDependency, store: Annotated[ObjectStore, Depends(get_object_store)]
):
    data, filename = service.source_bytes(session, slug, store)
    return Response(
        data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/{slug}/copy", response_model=ExampleCopyOutput, status_code=201)
def copy(
    slug: str,
    session: SessionDependency,
    identity: Annotated[Identity, Depends(require_identity)],
    store: Annotated[ObjectStore, Depends(get_object_store)],
):
    return service.copy_example(session, identity, slug, store)
