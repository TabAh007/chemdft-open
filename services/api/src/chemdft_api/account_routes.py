"""Account self-service routes (ADR-045): limits, data export, deletion. Caller-scoped only."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from .account_policy import limits_view
from .account_service import build_export, delete_account
from .auth import require_identity
from .composition import get_object_store
from .config import Settings, get_settings
from .context import Identity
from .database import get_session
from .storage import ObjectStore

router = APIRouter(prefix="/v1/me", tags=["account"])
Caller = Annotated[Identity, Depends(require_identity)]


class QuotaItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    label: str
    used: int | None
    limit: int | None
    unit: str


class LimitsRead(BaseModel):
    model_config = ConfigDict(extra="forbid")
    applies: bool
    email_verified: bool
    ai_enabled: bool
    quotas: list[QuotaItem]


class DeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm_email: str = Field(min_length=3, max_length=320)


class DeleteResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    deleted: bool
    projects_purged: int
    jobs_cancelled: int


@router.get("/limits", response_model=LimitsRead)
def read_limits(
    identity: Caller,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    return limits_view(session, settings, identity.user_id)


@router.get("/export")
def export_account(identity: Caller, session: Annotated[Session, Depends(get_session)]) -> Response:
    data = build_export(session, identity)
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="chemdft-account-export.zip"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/delete", response_model=DeleteResult)
def delete_my_account(
    payload: DeleteRequest,
    identity: Caller,
    session: Annotated[Session, Depends(get_session)],
    object_store: Annotated[ObjectStore, Depends(get_object_store)],
) -> dict:
    try:
        return delete_account(session, object_store, identity, payload.confirm_email)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="confirmation_mismatch") from error
