"""ORCID iD authentication (ADR-044): authorize URL, code exchange, id_token check, link, sign-in.

Scope is `openid` only. The iD is "authenticated" only when it comes out of `complete_*`; no
caller can supply one. Tokens from ORCID are used inside one call and discarded.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx
import jwt
from jwt import PyJWKClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import Settings
from .models import User, UserIdentity, UserKind, utc_now
from .orcid_models import OrcidAuditEvent, OrcidAuthState, OrcidLink

STATE_LIFETIME = timedelta(minutes=10)
MAX_STARTS_PER_WINDOW = 20
MAX_SIGNIN_STARTS_ALL = 200  # the source hash comes from the web layer; also bound the total
RATE_WINDOW = timedelta(minutes=10)
ORCID_ID = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")
# The redirect URI registered with ORCID for the production client; production refuses any other.
PRODUCTION_REDIRECT_URI = "https://chemdft.com/orcid/callback"
BASE_URLS = {"sandbox": "https://sandbox.orcid.org", "production": "https://orcid.org"}
AUTH_PROVIDER = "better-auth"


class OrcidError(Exception):
    """`code` is stable and safe to show; `status` is the HTTP status the route answers with."""

    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def base_url(environment: str) -> str:
    return BASE_URLS[environment]


def orcid_checksum_valid(orcid_id: str) -> bool:
    """ISO 7064 mod 11-2 check character of an ORCID iD (https://support.orcid.org/hc/en-us/articles/360006897674)."""
    if not ORCID_ID.match(orcid_id):
        return False
    digits = orcid_id.replace("-", "")
    total = 0
    for char in digits[:-1]:
        total = (total + int(char)) * 2
    result = (12 - total % 11) % 11
    return digits[-1] == ("X" if result == 10 else str(result))


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _naive_utc(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


def _now() -> datetime:
    return _naive_utc(utc_now())


class OrcidClient(Protocol):
    """The two network operations (`HttpOrcidClient`; tests may inject another implementation)."""

    def exchange_code(self, code: str, code_verifier: str) -> dict[str, Any]: ...

    def verify_id_token(self, id_token: str, nonce: str) -> dict[str, Any]: ...


class HttpOrcidClient:
    def __init__(self, settings: Settings) -> None:
        self._environment = settings.orcid_environment
        self._client_id = settings.orcid_client_id or ""
        self._secret = (
            settings.orcid_client_secret.get_secret_value() if settings.orcid_client_secret else ""
        )
        self._redirect_uri = settings.orcid_redirect_uri or ""
        self._base = base_url(settings.orcid_environment)
        self._jwks = PyJWKClient(f"{self._base}/oauth/jwks", cache_keys=True, lifespan=3600)

    def exchange_code(self, code: str, code_verifier: str) -> dict[str, Any]:
        try:
            response = httpx.post(
                f"{self._base}/oauth/token",
                data={
                    "client_id": self._client_id,
                    "client_secret": self._secret,
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": self._redirect_uri,
                    "code_verifier": code_verifier,
                },
                headers={"Accept": "application/json"},
                timeout=15.0,
            )
        except httpx.HTTPError as error:
            raise OrcidError("orcid_unavailable", 502) from error
        if response.status_code != 200:
            raise OrcidError("orcid_exchange_failed", 400)
        try:
            return dict(response.json())
        except ValueError as error:
            raise OrcidError("orcid_exchange_failed", 400) from error

    def verify_id_token(self, id_token: str, nonce: str) -> dict[str, Any]:
        try:
            key = self._jwks.get_signing_key_from_jwt(id_token).key
            return jwt.decode(
                id_token,
                key,  # type: ignore[arg-type]
                algorithms=["RS256"],
                audience=self._client_id,
                issuer=self._base,
                leeway=10,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
        except jwt.PyJWKClientConnectionError as error:
            raise OrcidError("orcid_unavailable", 502) from error
        except jwt.PyJWTError as error:
            raise OrcidError("orcid_token_invalid", 400) from error


@dataclass(frozen=True)
class StartResult:
    authorize_url: str


@dataclass(frozen=True)
class LinkStatus:
    enabled: bool
    environment: str
    linked: bool
    orcid_id: str | None = None
    record_url: str | None = None
    verified_at: datetime | None = None
    display_name: str | None = None


class OrcidService:
    def __init__(
        self, session: Session, settings: Settings, client: OrcidClient | None = None
    ) -> None:
        self._session = session
        self._settings = settings
        self._client = client

    # -- guards
    def require_enabled(self) -> None:
        s = self._settings
        if not (
            s.orcid_enabled and s.orcid_client_id and s.orcid_client_secret and s.orcid_redirect_uri
        ):
            raise OrcidError("not_found", 404)
        if s.orcid_environment == "production" and s.orcid_redirect_uri != PRODUCTION_REDIRECT_URI:
            raise OrcidError("not_found", 404)

    def _audit(
        self, event: str, outcome: str, user_id: str | None = None, reason: str | None = None
    ) -> None:
        self._session.add(
            OrcidAuditEvent(event=event, user_id=user_id, outcome=outcome, reason=reason)
        )
        self._session.commit()

    # -- status
    def status(self, user_id: str) -> LinkStatus:
        s = self._settings
        enabled = bool(
            s.orcid_enabled and s.orcid_client_id and s.orcid_client_secret and s.orcid_redirect_uri
        )
        link = self._session.scalar(select(OrcidLink).where(OrcidLink.user_id == user_id))
        if link is None:
            return LinkStatus(enabled=enabled, environment=s.orcid_environment, linked=False)
        return LinkStatus(
            enabled=enabled,
            environment=link.environment,
            linked=True,
            orcid_id=link.orcid_id,
            record_url=f"{base_url(link.environment)}/{link.orcid_id}",
            verified_at=link.verified_at,
            display_name=link.display_name,
        )

    # -- start
    def start(
        self,
        purpose: str,
        *,
        user_id: str | None,
        binding_hash: str | None = None,
        source_hash: str | None = None,
        keep_name: bool = False,
    ) -> StartResult:
        self.require_enabled()
        if purpose == "link":
            if user_id is None:
                raise OrcidError("not_found", 404)
            if self._session.scalar(select(OrcidLink.id).where(OrcidLink.user_id == user_id)):
                raise OrcidError("already_linked", 409)
        elif purpose == "signin":
            if not (binding_hash and re.fullmatch(r"[0-9a-f]{64}", binding_hash)):
                raise OrcidError("invalid_request", 400)
        else:
            raise OrcidError("invalid_request", 400)
        window_start = _now() - RATE_WINDOW
        scope = (
            OrcidAuthState.user_id == user_id
            if user_id
            else OrcidAuthState.source_hash == source_hash
        )
        recent = self._session.scalar(
            select(func.count())
            .select_from(OrcidAuthState)
            .where(scope, OrcidAuthState.created_at >= window_start)
        )
        overall = (
            self._session.scalar(
                select(func.count())
                .select_from(OrcidAuthState)
                .where(
                    OrcidAuthState.purpose == "signin", OrcidAuthState.created_at >= window_start
                )
            )
            if purpose == "signin"
            else 0
        )
        if (recent or 0) >= MAX_STARTS_PER_WINDOW or (overall or 0) >= MAX_SIGNIN_STARTS_ALL:
            self._audit(f"{purpose}_start", "REFUSED", user_id, "rate_limited")
            raise OrcidError("rate_limited", 429)
        # the prefix tells the callback page which flow it is in; the rest is the random secret
        state = f"{'l' if purpose == 'link' else 's'}.{secrets.token_urlsafe(32)}"
        verifier = secrets.token_urlsafe(48)
        nonce = secrets.token_urlsafe(24)
        self._session.add(
            OrcidAuthState(
                state_hash=_sha256(state),
                purpose=purpose,
                user_id=user_id,
                binding_hash=binding_hash,
                source_hash=source_hash,
                code_verifier=verifier,
                nonce=nonce,
                keep_name=keep_name,
                created_at=_now(),
                expires_at=_now() + STATE_LIFETIME,
            )
        )
        self._session.commit()
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        query = urlencode(
            {
                "client_id": self._settings.orcid_client_id,
                "response_type": "code",
                "scope": "openid",
                "redirect_uri": self._settings.orcid_redirect_uri,
                "state": state,
                "nonce": nonce,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        return StartResult(
            authorize_url=f"{base_url(self._settings.orcid_environment)}/oauth/authorize?{query}"
        )

    # -- complete
    def _consume_state(
        self, state: str, purpose: str, user_id: str | None, binding: str | None
    ) -> OrcidAuthState:
        row = self._session.scalar(
            select(OrcidAuthState).where(OrcidAuthState.state_hash == _sha256(state))
        )
        if row is None or row.purpose != purpose:
            self._audit(f"{purpose}_complete", "REFUSED", user_id, "state_unknown")
            raise OrcidError("state_invalid", 400)
        reason = None
        if row.consumed_at is not None:
            reason = "state_reused"
        elif _naive_utc(row.expires_at) < _now():
            reason = "state_expired"
        elif purpose == "link" and row.user_id != user_id:
            reason = "state_user_mismatch"
        elif purpose == "signin" and not (
            binding and row.binding_hash and hmac.compare_digest(row.binding_hash, _sha256(binding))
        ):
            reason = "binding_mismatch"
        if reason is not None:
            self._audit(f"{purpose}_complete", "REFUSED", user_id, reason)
            raise OrcidError("state_invalid", 400)
        row.consumed_at = _now()
        self._session.commit()  # single use, even if the exchange below fails
        return row

    def _authenticate(self, state_row: OrcidAuthState, code: str) -> tuple[str, str | None]:
        if self._client is None:
            raise OrcidError("not_found", 404)
        tokens = self._client.exchange_code(code, state_row.code_verifier)
        id_token = tokens.get("id_token")
        if not isinstance(id_token, str) or not id_token:
            raise OrcidError("orcid_token_invalid", 400)
        claims = self._client.verify_id_token(id_token, state_row.nonce)
        nonce = claims.get("nonce")
        if not isinstance(nonce, str) or not hmac.compare_digest(nonce, state_row.nonce):
            raise OrcidError("orcid_token_invalid", 400)
        orcid_id = claims.get("sub")
        if not isinstance(orcid_id, str) or not orcid_checksum_valid(orcid_id):
            raise OrcidError("orcid_token_invalid", 400)
        given, family = claims.get("given_name"), claims.get("family_name")
        parts = [p.strip() for p in (given, family) if isinstance(p, str) and p.strip()]
        return orcid_id, (" ".join(parts)[:160] if parts else None)

    def complete_link(self, user_id: str, code: str, state: str) -> LinkStatus:
        self.require_enabled()
        row = self._consume_state(state, "link", user_id, None)
        try:
            orcid_id, name = self._authenticate(row, code)
        except OrcidError as error:
            self._audit("link_complete", "REFUSED", user_id, error.code)
            raise
        environment = self._settings.orcid_environment
        taken = self._session.scalar(
            select(OrcidLink).where(
                OrcidLink.orcid_id == orcid_id, OrcidLink.environment == environment
            )
        )
        if taken is not None and taken.user_id != user_id:
            self._audit("link_complete", "REFUSED", user_id, "orcid_id_in_use")
            raise OrcidError("orcid_id_unavailable", 409)
        if self._session.scalar(select(OrcidLink.id).where(OrcidLink.user_id == user_id)):
            raise OrcidError("already_linked", 409)
        self._session.add(
            OrcidLink(
                user_id=user_id,
                orcid_id=orcid_id,
                environment=environment,
                verified_at=_now(),
                display_name=name if row.keep_name else None,
            )
        )
        try:
            self._session.commit()
        except IntegrityError as error:
            self._session.rollback()
            self._audit("link_complete", "REFUSED", user_id, "orcid_id_in_use")
            raise OrcidError("orcid_id_unavailable", 409) from error
        self._audit("link", "SUCCEEDED", user_id)
        return self.status(user_id)

    def complete_signin(self, code: str, state: str, binding: str) -> str:
        """Return the Better Auth subject of the linked account; never creates an account."""
        self.require_enabled()
        row = self._consume_state(state, "signin", None, binding)
        try:
            orcid_id, _name = self._authenticate(row, code)
        except OrcidError as error:
            self._audit("signin_complete", "REFUSED", None, error.code)
            raise
        environment = self._settings.orcid_environment
        link = self._session.scalar(
            select(OrcidLink).where(
                OrcidLink.orcid_id == orcid_id, OrcidLink.environment == environment
            )
        )
        user = self._session.get(User, link.user_id) if link else None
        subject = (
            self._session.scalar(
                select(UserIdentity.subject).where(
                    UserIdentity.user_id == user.id, UserIdentity.provider == AUTH_PROVIDER
                )
            )
            if user
            else None
        )
        if (
            user is None
            or subject is None
            or user.kind != UserKind.HUMAN
            or user.disabled_at is not None
        ):
            # One generic refusal for unlinked or unusable accounts; the iD is not recorded.
            self._audit("signin_complete", "REFUSED", None, "not_linked")
            raise OrcidError("not_linked", 403)
        self._audit("signin", "SUCCEEDED", user.id)
        return subject

    def unlink(self, user_id: str) -> None:
        link = self._session.scalar(select(OrcidLink).where(OrcidLink.user_id == user_id))
        if link is not None:
            self._session.delete(link)
            self._session.commit()
            self._audit("unlink", "SUCCEEDED", user_id)
