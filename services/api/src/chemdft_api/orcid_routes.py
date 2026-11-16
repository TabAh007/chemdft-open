"""ORCID routes (ADR-044). All answer 404 when ORCID is not enabled, except the status read."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from .auth import require_identity
from .config import Settings, get_settings
from .context import Identity
from .database import get_session
from .orcid import HttpOrcidClient, OrcidClient, OrcidError, OrcidService

router = APIRouter(prefix="/v1/orcid", tags=["orcid"])


class OrcidStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    environment: str
    linked: bool
    orcid_id: str | None = None
    record_url: str | None = None
    verified_at: datetime | None = None
    display_name: str | None = None


class LinkStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    keep_name: bool = False


class StartResponse(BaseModel):
    authorize_url: str


class CompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=512)
    state: str = Field(min_length=1, max_length=128)


class SigninStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    binding_hash: str = Field(min_length=64, max_length=64)
    source_hash: str | None = Field(default=None, min_length=64, max_length=64)


class SigninCompleteRequest(CompleteRequest):
    binding: str = Field(min_length=16, max_length=128)


class SigninSubject(BaseModel):
    subject: str


def get_orcid_client(settings: Annotated[Settings, Depends(get_settings)]) -> OrcidClient | None:
    if not (settings.orcid_enabled and settings.orcid_client_id and settings.orcid_client_secret):
        return None
    return HttpOrcidClient(settings)


def _service(
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    client: Annotated[OrcidClient | None, Depends(get_orcid_client)],
) -> OrcidService:
    return OrcidService(session, settings, client)


Service = Annotated[OrcidService, Depends(_service)]
Caller = Annotated[Identity, Depends(require_identity)]


def _http(error: OrcidError) -> HTTPException:
    return HTTPException(status_code=error.status, detail=error.code)


@router.get("", response_model=OrcidStatus)
def read_status(identity: Caller, service: Service) -> OrcidStatus:
    return OrcidStatus.model_validate(service.status(identity.user_id).__dict__)


@router.post("/link/start", response_model=StartResponse)
def link_start(body: LinkStartRequest, identity: Caller, service: Service) -> StartResponse:
    try:
        result = service.start("link", user_id=identity.user_id, keep_name=body.keep_name)
    except OrcidError as error:
        raise _http(error) from error
    return StartResponse(authorize_url=result.authorize_url)


@router.post("/link/complete", response_model=OrcidStatus)
def link_complete(body: CompleteRequest, identity: Caller, service: Service) -> OrcidStatus:
    try:
        status = service.complete_link(identity.user_id, body.code, body.state)
    except OrcidError as error:
        raise _http(error) from error
    return OrcidStatus.model_validate(status.__dict__)


@router.post("/unlink", response_model=OrcidStatus)
def unlink(identity: Caller, service: Service) -> OrcidStatus:
    service.unlink(identity.user_id)
    return OrcidStatus.model_validate(service.status(identity.user_id).__dict__)


# Public: called by the trusted web layer before any session exists. Authorization is the single-use
# state, the browser-binding hash and ORCID's own authentication of an already linked iD.
@router.post("/signin/start", response_model=StartResponse)
def signin_start(body: SigninStartRequest, service: Service) -> StartResponse:
    try:
        result = service.start(
            "signin", user_id=None, binding_hash=body.binding_hash, source_hash=body.source_hash
        )
    except OrcidError as error:
        raise _http(error) from error
    return StartResponse(authorize_url=result.authorize_url)


@router.post("/signin/complete", response_model=SigninSubject)
def signin_complete(body: SigninCompleteRequest, service: Service) -> SigninSubject:
    try:
        subject = service.complete_signin(body.code, body.state, body.binding)
    except OrcidError as error:
        raise _http(error) from error
    return SigninSubject(subject=subject)
