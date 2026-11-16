"""Verification of the short-lived identity token the trusted web layer sends to this API.

The API is a resource server: it never sees passwords, sessions or OAuth tokens. It accepts a JWT
only if the signature verifies against the configured key set and the issuer, audience, expiry and
required claims are valid. Algorithms are an explicit allow-list (no `none`, no algorithm taken from
the token). Keys come from a JWKS URL (cached) or, for tests/offline use, a static public key set.
"""

from __future__ import annotations

from dataclasses import dataclass

import jwt
from jwt import PyJWKClient, PyJWKSet

from .config import Settings

REQUIRED_CLAIMS = ["exp", "iat", "iss", "aud", "sub"]


class TokenError(Exception):
    """The presented token cannot be accepted. `code` is stable and safe to show to the client."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class VerifiedToken:
    subject: str
    email: str
    name: str | None
    email_verified: bool | None
    # Set only by the web layer's self-service signup path (Better Auth user field, input:false).
    self_signup: bool = False
    terms_version: str | None = None
    terms_accepted_at: str | None = None


class JwtVerifier:
    def __init__(self, settings: Settings) -> None:
        if not (settings.auth_issuer and settings.auth_audience):
            raise ValueError("auth issuer and audience must be configured for jwt mode")
        self._issuer = settings.auth_issuer
        self._audience = settings.auth_audience
        self._algorithms = [a.strip() for a in settings.auth_jwt_algorithms.split(",") if a.strip()]
        if not self._algorithms or "none" in (a.lower() for a in self._algorithms):
            raise ValueError("auth_jwt_algorithms must be an explicit non-empty allow-list")
        self._leeway = settings.auth_jwt_leeway_seconds
        self._static: PyJWKSet | None = None
        self._client: PyJWKClient | None = None
        if settings.auth_jwks_json:
            self._static = PyJWKSet.from_json(settings.auth_jwks_json)
        elif settings.auth_jwks_url:
            self._client = PyJWKClient(
                settings.auth_jwks_url, cache_keys=True, lifespan=settings.auth_jwks_cache_seconds
            )
        else:
            raise ValueError("a JWKS url or static JWKS must be configured for jwt mode")

    def _signing_key(self, token: str) -> object:
        try:
            if self._static is not None:
                kid = jwt.get_unverified_header(token).get("kid")
                for key in self._static.keys:
                    if key.key_id == kid:
                        return key.key
                raise TokenError("invalid_token")
            assert self._client is not None
            return self._client.get_signing_key_from_jwt(token).key
        except TokenError:
            raise
        except jwt.PyJWKClientConnectionError as error:
            raise TokenError("key_set_unavailable") from error
        except jwt.PyJWTError as error:
            raise TokenError("invalid_token") from error

    def verify(self, token: str) -> VerifiedToken:
        try:
            claims = jwt.decode(
                token,
                self._signing_key(token),  # type: ignore[arg-type]
                algorithms=self._algorithms,
                audience=self._audience,
                issuer=self._issuer,
                leeway=self._leeway,
                options={"require": REQUIRED_CLAIMS},
            )
        except jwt.ExpiredSignatureError as error:
            raise TokenError("token_expired") from error
        except jwt.PyJWTError as error:
            raise TokenError("invalid_token") from error
        subject, email = claims.get("sub"), claims.get("email")
        if (
            not isinstance(subject, str)
            or not subject
            or not isinstance(email, str)
            or "@" not in email
        ):
            raise TokenError("invalid_token")
        name = claims.get("name")
        verified = claims.get("email_verified")
        return VerifiedToken(
            subject=subject,
            email=email.strip().lower(),
            name=name.strip() if isinstance(name, str) and name.strip() else None,
            email_verified=verified if isinstance(verified, bool) else None,
            self_signup=claims.get("signup_source") == "self",
            terms_version=_short(claims.get("terms_version")),
            terms_accepted_at=_short(claims.get("terms_accepted_at")),
        )


def _short(value: object) -> str | None:
    return value.strip()[:32] if isinstance(value, str) and value.strip() else None


_CACHE: dict[tuple, JwtVerifier] = {}


def get_verifier(settings: Settings) -> JwtVerifier:
    """One verifier per distinct configuration, so the JWKS key cache is reused across requests."""
    key = (
        settings.auth_issuer,
        settings.auth_audience,
        settings.auth_jwks_url,
        settings.auth_jwks_json,
        settings.auth_jwt_algorithms,
        settings.auth_jwt_leeway_seconds,
        settings.auth_jwks_cache_seconds,
    )
    verifier = _CACHE.get(key)
    if verifier is None:
        verifier = JwtVerifier(settings)
        _CACHE[key] = verifier
    return verifier
