"""0.0.18: GET /v1/billing has no side effects; write paths still create the row."""

from __future__ import annotations

from chemdft_api.billing_models import BillingAccountRecord, BillingAllowancePeriodRecord
from chemdft_api.billing_service import BillingService
from chemdft_api.context import Identity
from sqlalchemy import func, select
from test_billing import _plan


def _counts(sessions):
    with sessions() as session:
        return (
            session.scalar(select(func.count()).select_from(BillingAccountRecord)),
            session.scalar(select(func.count()).select_from(BillingAllowancePeriodRecord)),
        )


def _stable(body):
    drop = {"id", "billing_account_id"}
    out = {k: v for k, v in body.items() if k not in drop}
    out["allowance"] = {k: v for k, v in body["allowance"].items() if k not in drop}
    return out


def test_get_billing_on_a_new_user_writes_nothing(api):
    client, sessions, _ = api
    before = _counts(sessions)
    first = client.get("/v1/billing")
    second = client.get("/v1/billing")
    assert first.status_code == 200 and second.status_code == 200
    assert _counts(sessions) == before == (0, 0)
    body = first.json()
    assert body["status"] == "NOT_CONFIGURED"
    assert body["ai_usage"] and body["compute_usage"] and "allowance" in body
    assert body["allowance"]["ai_consumed"]["minor_units"] == 0
    # Same account id every time, even though nothing is stored.
    assert body["billing_account_id"] == second.json()["billing_account_id"]


def test_first_write_path_creates_the_row_and_get_matches_the_old_first_read(api):
    client, sessions, settings = api
    read_only = client.get("/v1/billing").json()
    with sessions() as session:
        identity = Identity(settings.dev_user_id, settings.dev_organization_id)
        written = BillingService(session, identity, settings).snapshot()  # writing variant
    assert _counts(sessions)[0] == 1
    after = client.get("/v1/billing").json()
    assert _stable(read_only) == _stable(after)
    assert _stable(read_only) == _stable(
        written.model_dump(mode="json")
    )


def test_checkout_still_creates_the_account_row(api):
    client, sessions, settings = api
    _plan(settings)
    assert _counts(sessions)[0] == 0
    client.post("/v1/billing/checkout", json={"plan_key": "test"})
    assert _counts(sessions)[0] == 1
