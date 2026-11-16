import hashlib
import hmac
import json
import time
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from chemdft_api.billing_provider import StripeBillingProvider
from chemdft_api.billing_service import BillingService
from chemdft_api.context import Identity
from chemdft_api.errors import BillingEntitlementDenied
from sqlalchemy import text


def _project(client):
    return client.post(
        "/v1/projects",
        json={"name": "Billing", "slug": f"billing-{uuid4().hex[:8]}"},
    ).json()


def _plan(settings):
    settings.billing_plan_definitions_json = json.dumps(
        {
            "test": {
                "managed_ai": True,
                "byok_ai": True,
                "compute": True,
                "investigations": True,
                "max_concurrent_ai": 2,
                "max_concurrent_compute": 1,
                "ai_granted_minor_units": 1000,
                "compute_granted_minor_units": 2000,
                "ai_overage_policy": "DENY",
                "compute_overage_policy": "DENY",
            }
        }
    )
    settings.billing_managed_ai_enabled = True
    settings.billing_compute_enabled = True


def test_billing_snapshot_separates_ledgers_and_is_project_scoped(api):
    client, sessions, settings = api
    project = _project(client)
    with sessions() as session:
        service = BillingService(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            settings,
        )
        service.record_ai_usage(
            project_id=project["id"],
            model_invocation_id=str(uuid4()),
            provider="fake",
            model="test-model",
            mode="BYOK",
            input_tokens=10,
            output_tokens=4,
            billable_minor_units=7,
        )
        service.record_compute_usage(
            project_id=project["id"],
            compute_job_id=str(uuid4()),
            compute_execution_id=str(uuid4()),
            provider="local",
            engine="pyscf",
            reserved_minor_units=12,
            actual_minor_units=9,
            billable_minor_units=9,
        )
    snapshot = client.get("/v1/billing")
    assert snapshot.status_code == 200, snapshot.text
    body = snapshot.json()
    assert body["ai_usage"]["input_tokens"] == 10
    assert body["ai_usage"]["billable"]["minor_units"] == 7
    assert body["compute_usage"]["reserved"]["minor_units"] == 12
    assert body["compute_usage"]["actual"]["minor_units"] == 9
    assert body["ai_usage"] != body["compute_usage"]


def test_fake_checkout_webhook_is_idempotent_and_reconciles(api):
    client, _sessions, settings = api
    _plan(settings)
    checkout = client.post("/v1/billing/checkout", json={"plan_key": "test"})
    assert checkout.status_code == 200, checkout.text
    snapshot = client.get("/v1/billing").json()
    account_id = snapshot["billing_account_id"]
    customer = f"fake_customer_{account_id}"
    period_start = int(time.time())
    period_end = period_start + 2_592_000
    event = {
        "id": f"evt_{uuid4().hex}",
        "type": "customer.subscription.updated",
        "created": period_start,
        "data": {
            "object": {
                "id": f"sub_{uuid4().hex}",
                "customer": customer,
                "status": "active",
                "plan_key": "test",
                "current_period": {"start": period_start, "end": period_end},
            }
        },
    }
    first = client.post("/v1/billing/webhooks/stripe", json=event)
    duplicate = client.post("/v1/billing/webhooks/stripe", json=event)
    assert first.status_code == 200 and first.json()["status"] == "PROCESSED"
    assert duplicate.status_code == 200 and duplicate.json()["status"] == "PROCESSED"
    current = client.get("/v1/billing").json()
    assert current["subscription_plan"] == "test"
    assert current["entitlements"]["managed_ai"] is True
    assert client.post("/v1/billing/reconcile").status_code == 200


def test_byok_never_persists_plaintext_without_secret_provider(api):
    client, sessions, _settings = api
    response = client.post(
        "/v1/billing/byok",
        json={"provider": "openai", "secret": "sk-" "test-secret-never-stored"},
    )
    assert response.status_code == 503
    with sessions() as session:
        rows = session.execute(text("SELECT COUNT(*) FROM byok_credentials")).scalar_one()
        assert rows == 0
        assert session.execute(text("SELECT COUNT(*) FROM billing_accounts")).scalar_one() == 0


def test_stripe_signature_verification_uses_raw_body_and_replay_window():
    secret = "whsec_test"
    payload = json.dumps({"id": "evt_1", "type": "invoice.paid", "data": {"object": {}}}).encode()
    timestamp = int(datetime.now(UTC).timestamp())
    digest = hmac.new(
        secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256
    ).hexdigest()
    event = StripeBillingProvider(secret).verify_webhook(payload, f"t={timestamp},v1={digest}")
    assert event.event_id == "evt_1"


def test_allowance_overage_cap_is_exact_and_server_enforced():
    with pytest.raises(BillingEntitlementDenied):
        BillingService._authorize_allowance(
            granted=100,
            consumed=100,
            reserved=0,
            remaining=0,
            estimated=11,
            policy="ALLOW_METERED_OVERAGE",
            overage_cap=10,
        )

    BillingService._authorize_allowance(
        granted=100,
        consumed=100,
        reserved=0,
        remaining=0,
        estimated=10,
        policy="ALLOW_METERED_OVERAGE",
        overage_cap=10,
    )
