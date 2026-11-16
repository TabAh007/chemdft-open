import os
from collections.abc import Mapping
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .context import Identity
from .database import get_session
from .identity_service import IdentityDenied, resolve_human_identity
from .jwt_auth import TokenError, get_verifier
from .models import Membership, Organization, OrganizationKind, User, UserKind

LOCAL_ENVIRONMENTS = frozenset({"local", "development", "test"})
# Variables that hosted platforms set on their own; a process that sees one is not a local machine.
HOSTED_ENVIRONMENT_MARKERS = (
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL",
    "AWS_LAMBDA_FUNCTION_NAME",
    "K_SERVICE",
    "FLY_APP_NAME",
    "RENDER",
    "RAILWAY_ENVIRONMENT",
    "DYNO",
)


def dev_identity_permitted(settings: Settings, environ: Mapping[str, str] | None = None) -> bool:
    """The fixed development identity is for explicitly local environments only.

    Not having real authentication yet is never a reason to enable it: it is refused when
    `CHEMDFT_ENV` names anything but local/development/test, and whenever a hosted-platform marker
    is present in the process environment.
    """
    environ = os.environ if environ is None else environ
    if settings.environment.strip().lower() not in LOCAL_ENVIRONMENTS:
        return False
    return not any(environ.get(marker) for marker in HOSTED_ENVIRONMENT_MARKERS)


AUTH_MODES = frozenset({"dev", "jwt"})


def validate_auth_configuration(
    settings: Settings, environ: Mapping[str, str] | None = None
) -> None:
    """Fail fast at startup on an unsafe or incomplete authentication configuration."""
    if settings.auth_mode not in AUTH_MODES:
        raise RuntimeError(f"CHEMDFT_AUTH_MODE must be one of {sorted(AUTH_MODES)}.")
    if settings.auth_mode == "jwt":
        if settings.dev_identity_enabled or settings.dev_identity_header_override_enabled:
            raise RuntimeError(
                "CHEMDFT_AUTH_MODE=jwt must not be combined with the development identity; "
                "unset CHEMDFT_DEV_IDENTITY_ENABLED (there is no fallback from jwt to dev)."
            )
        if not (settings.auth_issuer and settings.auth_audience):
            raise RuntimeError("jwt mode requires CHEMDFT_AUTH_ISSUER and CHEMDFT_AUTH_AUDIENCE.")
        if not (settings.auth_jwks_url or settings.auth_jwks_json):
            raise RuntimeError("jwt mode requires CHEMDFT_AUTH_JWKS_URL (or a static JWKS).")
        get_verifier(settings)  # constructs it: rejects an empty or `none` algorithm allow-list
        return
    if settings.dev_identity_enabled and not dev_identity_permitted(settings, environ):
        raise RuntimeError(
            "CHEMDFT_DEV_IDENTITY_ENABLED is set in a non-local environment; refusing to start. "
            "The fixed development identity only operates locally."
        )


def assert_dev_identity_allowed(settings: Settings) -> None:
    validate_auth_configuration(settings)


def ensure_dev_identity(session: Session, settings: Settings) -> None:
    organization = session.get(Organization, settings.dev_organization_id)
    if organization is None:
        session.add(
            Organization(
                id=settings.dev_organization_id,
                name="ChemDFT local development",
                kind=OrganizationKind.LEGACY_LOCAL,
            )
        )
    user = session.get(User, settings.dev_user_id)
    if user is None:
        session.add(
            User(
                id=settings.dev_user_id,
                email="developer@localhost.invalid",
                display_name="Local developer",
                kind=UserKind.LEGACY_LOCAL,
            )
        )
    session.flush()
    membership = session.scalar(
        select(Membership).where(
            Membership.organization_id == settings.dev_organization_id,
            Membership.user_id == settings.dev_user_id,
        )
    )
    if membership is None:
        session.add(
            Membership(
                organization_id=settings.dev_organization_id,
                user_id=settings.dev_user_id,
                role="owner",
            )
        )
    session.commit()


def _unauthorized(code: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=code,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise _unauthorized("missing_token")
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        raise _unauthorized("invalid_token")
    return value.strip()


def _jwt_identity(session: Session, settings: Settings, authorization: str | None) -> Identity:
    # Identity headers are never read in this mode and there is no fallback to the dev identity.
    try:
        token = get_verifier(settings).verify(_bearer_token(authorization))
    except TokenError as error:
        if error.code == "key_set_unavailable":
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=error.code
            ) from error
        raise _unauthorized(error.code) from error
    try:
        return resolve_human_identity(
            session, token, signup_open=settings.signup_open
        ).identity
    except IdentityDenied as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=error.code) from error


def require_identity(
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    user_header: Annotated[str | None, Header(alias="X-ChemDFT-User-ID")] = None,
    organization_header: Annotated[str | None, Header(alias="X-ChemDFT-Organization-ID")] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> Identity:
    if settings.auth_mode == "jwt":
        return _jwt_identity(session, settings, authorization)
    if not settings.dev_identity_enabled or not dev_identity_permitted(settings):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication provider is not configured.",
        )
    if settings.dev_identity_header_override_enabled:
        user_id = user_header or settings.dev_user_id
        organization_id = organization_header or settings.dev_organization_id
    else:
        if (user_header is not None and user_header != settings.dev_user_id) or (
            organization_header is not None and organization_header != settings.dev_organization_id
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Development identity is resolved by the server.",
            )
        user_id = settings.dev_user_id
        organization_id = settings.dev_organization_id
    membership = session.scalar(
        select(Membership).where(
            Membership.organization_id == organization_id,
            Membership.user_id == user_id,
        )
    )
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required."
        )
    return Identity(user_id=user_id, organization_id=organization_id)
