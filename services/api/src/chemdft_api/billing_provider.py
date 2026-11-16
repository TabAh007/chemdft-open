"""Provider boundary for billing integrations.

The fake provider is used by local verification. The Stripe adapter verifies
webhook signatures without leaking provider objects into domain services; live
checkout/retrieval remains disabled until the official Stripe SDK and account
configuration are provisioned.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import uuid4

from .errors import BillingNotConfigured, BillingWebhookInvalid


@dataclass(frozen=True)
class BillingEvent:
    event_id: str
    event_type: str
    created_at: int | None
    data: dict[str, Any]


class BillingProvider(Protocol):
    name: str
    test_mode: bool

    def create_checkout_session(
        self, *, customer_reference: str, plan_key: str
    ) -> dict[str, str]: ...

    def verify_webhook(self, payload: bytes, signature: str | None) -> BillingEvent: ...


class FakeBillingProvider:
    name = "fake"
    test_mode = True

    def create_checkout_session(self, *, customer_reference: str, plan_key: str) -> dict[str, str]:
        session_reference = f"fake_checkout_{uuid4().hex}"
        return {
            "session_reference": session_reference,
            "checkout_url": f"https://billing.test.local/checkout/{session_reference}",
            "customer_reference": customer_reference,
            "plan_key": plan_key,
        }

    def verify_webhook(self, payload: bytes, signature: str | None) -> BillingEvent:
        try:
            body = json.loads(payload.decode("utf-8"))
            return BillingEvent(
                event_id=str(body["id"]),
                event_type=str(body["type"]),
                created_at=int(body.get("created", 0)) or None,
                data=dict(body.get("data", {}).get("object", {})),
            )
        except (UnicodeDecodeError, ValueError, KeyError, TypeError) as error:
            raise BillingWebhookInvalid("The fake billing event is not valid JSON.") from error


class StripeBillingProvider:
    name = "stripe"
    test_mode = True

    def __init__(self, webhook_secret: str | None) -> None:
        self._webhook_secret = webhook_secret

    def create_checkout_session(self, *, customer_reference: str, plan_key: str) -> dict[str, str]:
        raise BillingNotConfigured(
            "Stripe checkout requires the official Stripe SDK, price mapping, "
            "and test-mode credentials."
        )

    def verify_webhook(self, payload: bytes, signature: str | None) -> BillingEvent:
        if not self._webhook_secret or not signature:
            raise BillingWebhookInvalid()
        timestamp, signatures = _parse_stripe_signature(signature)
        if abs(int(time.time()) - timestamp) > 300:
            raise BillingWebhookInvalid("Stripe webhook timestamp is outside the replay window.")
        signed_payload = f"{timestamp}.".encode("ascii") + payload
        expected = hmac.new(
            self._webhook_secret.encode("utf-8"), signed_payload, hashlib.sha256
        ).hexdigest()
        if not any(hmac.compare_digest(expected, value) for value in signatures):
            raise BillingWebhookInvalid()
        try:
            body = json.loads(payload.decode("utf-8"))
            return BillingEvent(
                event_id=str(body["id"]),
                event_type=str(body["type"]),
                created_at=int(body.get("created", 0)) or None,
                data=dict(body.get("data", {}).get("object", {})),
            )
        except (UnicodeDecodeError, ValueError, KeyError, TypeError) as error:
            raise BillingWebhookInvalid(
                "Stripe webhook payload is not a supported event."
            ) from error


def _parse_stripe_signature(signature: str) -> tuple[int, tuple[str, ...]]:
    values: dict[str, list[str]] = {}
    for item in signature.split(","):
        key, separator, value = item.partition("=")
        if separator:
            values.setdefault(key, []).append(value)
    try:
        timestamp = int(values["t"][0])
        signatures = tuple(values.get("v1", ()))
    except (KeyError, ValueError, IndexError) as error:
        raise BillingWebhookInvalid() from error
    if not signatures:
        raise BillingWebhookInvalid()
    return timestamp, signatures
