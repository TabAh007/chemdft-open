"""Direct browser-to-API upload for PDFs larger than the web host's request-body limit.

The website proxy (Vercel) refuses request bodies above 4.5 MB.
The API itself accepts much larger files, so for a big PDF the browser asks the API (through the
normal signed-in proxy, a tiny request) for a short-lived **upload ticket** and then sends the file
straight to the API with it.

A ticket is stateless: an HMAC-SHA256 signature over {user, organization, project, expiry, byte cap,
nonce}. It grants exactly one thing, importing one document into one project for that user, until it
expires. It is not a login token: the API re-checks project membership and write permission when the
file arrives, so a revoked member cannot use a ticket that was issued earlier. A ticket may be used
more than once inside its lifetime; that is harmless because importing the same bytes is idempotent
(the document is de-duplicated by SHA-256).

The whole path is off unless the public API URL, the one allowed website origin and the ticket
secret are all configured.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field

from .config import Settings

TICKET_VERSION = 1
_DOMAIN = b"chemdft-upload-ticket-v1:"
MIN_SECRET_LENGTH = 32


class TicketError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class UploadTicket:
    user_id: str
    organization_id: str
    project_id: str
    expires_at: int
    max_bytes: int


def direct_upload_enabled(settings: Settings) -> bool:
    secret = settings.upload_ticket_secret or ""
    return bool(
        settings.direct_upload_public_url
        and settings.direct_upload_allowed_origin
        and len(secret) >= MIN_SECRET_LENGTH
    )


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _signature(settings: Settings, payload: bytes) -> bytes:
    key = (settings.upload_ticket_secret or "").encode("utf-8")
    return hmac.new(key, _DOMAIN + payload, hashlib.sha256).digest()


def issue_ticket(
    settings: Settings,
    *,
    user_id: str,
    organization_id: str,
    project_id: str,
    max_bytes: int,
    now: float | None = None,
) -> tuple[str, int]:
    if not direct_upload_enabled(settings):
        raise TicketError("direct_upload_unavailable")
    expires_at = int((time.time() if now is None else now) + settings.direct_upload_ticket_seconds)
    payload = json.dumps(
        {
            "v": TICKET_VERSION,
            "u": user_id,
            "o": organization_id,
            "p": project_id,
            "x": expires_at,
            "m": max_bytes,
            "n": secrets.token_hex(8),
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"{_b64(payload)}.{_b64(_signature(settings, payload))}", expires_at


def verify_ticket(
    settings: Settings, token: str | None, *, now: float | None = None
) -> UploadTicket:
    if not direct_upload_enabled(settings):
        raise TicketError("direct_upload_unavailable")
    if not token or token.count(".") != 1 or len(token) > 1024:
        raise TicketError("invalid_ticket")
    body, _, signature = token.partition(".")
    try:
        payload = _unb64(body)
        given = _unb64(signature)
    except (binascii.Error, ValueError):
        raise TicketError("invalid_ticket") from None
    if not hmac.compare_digest(given, _signature(settings, payload)):
        raise TicketError("invalid_ticket")
    try:
        claims = json.loads(payload)
        if claims["v"] != TICKET_VERSION:
            raise TicketError("invalid_ticket")
        ticket = UploadTicket(
            user_id=str(claims["u"]),
            organization_id=str(claims["o"]),
            project_id=str(claims["p"]),
            expires_at=int(claims["x"]),
            max_bytes=int(claims["m"]),
        )
    except (KeyError, TypeError, ValueError):
        raise TicketError("invalid_ticket") from None
    if (time.time() if now is None else now) >= ticket.expires_at:
        raise TicketError("ticket_expired")
    return ticket


def cors_headers(settings: Settings, origin: str | None) -> dict[str, str]:
    """CORS answer for the one configured website origin; nothing for any other origin."""
    allowed = settings.direct_upload_allowed_origin
    if not allowed or origin != allowed:
        return {}
    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "X-ChemDFT-Upload-Ticket",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin",
    }


class UploadTicketRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(gt=0)


class UploadTicketResponse(BaseModel):
    ticket: str
    upload_url: str
    expires_at: int
    max_bytes: int
