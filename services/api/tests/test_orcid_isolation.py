"""Two jwt-authenticated accounts and the ORCID routes. OFFLINE: ORCID is a local RSA issuer (not ORCID evidence)."""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest
from chemdft_api.main import app
from chemdft_api.orcid_routes import get_orcid_client
from pydantic import SecretStr
from test_orcid import CLIENT_ID, IDS, client_for


@pytest.fixture
def two_orcid_users(multiuser, monkeypatch):
    settings = multiuser.settings
    settings.orcid_enabled = True
    settings.orcid_environment = "sandbox"
    settings.orcid_client_id = CLIENT_ID
    settings.orcid_client_secret = SecretStr("not-a-real-secret")
    settings.orcid_redirect_uri = "http://localhost:3000/orcid/callback"
    http, holder = client_for(settings, monkeypatch, IDS[0])
    app.dependency_overrides[get_orcid_client] = lambda: http
    yield multiuser.actor("alice"), multiuser.actor("bob"), holder
    app.dependency_overrides.pop(get_orcid_client, None)


def link(actor, holder, *, keep_name=False):
    start = actor.post("/v1/orcid/link/start", json={"keep_name": keep_name})
    assert start.status_code == 200, start.text
    query = parse_qs(urlparse(start.json()["authorize_url"]).query)
    holder["nonce"] = query["nonce"][0]
    return query["state"][0], actor.post(
        "/v1/orcid/link/complete", json={"code": "c", "state": query["state"][0]}
    )


def test_a_linked_iD_belongs_to_one_account_and_the_other_account_sees_none_of_it(
    two_orcid_users,
) -> None:
    alice, bob, holder = two_orcid_users
    _state, linked = link(alice, holder, keep_name=True)
    assert linked.status_code == 200 and linked.json()["orcid_id"] == IDS[0]
    assert bob.get("/v1/orcid").json()["linked"] is False  # status is per account
    _state, claimed = link(bob, holder)  # the same iD
    assert claimed.status_code == 409 and claimed.json()["detail"] == "orcid_id_unavailable"
    assert (
        bob.post("/v1/orcid/unlink").json()["linked"] is False
    )  # bob's unlink changes nothing of alice's
    assert alice.get("/v1/orcid").json()["orcid_id"] == IDS[0]


def test_a_state_started_by_one_account_cannot_be_completed_by_another_or_anonymously(
    two_orcid_users, multiuser
) -> None:
    alice, bob, holder = two_orcid_users
    start = alice.post("/v1/orcid/link/start", json={})
    query = parse_qs(urlparse(start.json()["authorize_url"]).query)
    holder["nonce"] = query["nonce"][0]
    stolen = bob.post("/v1/orcid/link/complete", json={"code": "c", "state": query["state"][0]})
    assert stolen.status_code == 400 and stolen.json()["detail"] == "state_invalid"
    assert bob.get("/v1/orcid").json()["linked"] is False
    anonymous = multiuser.client.post("/v1/orcid/link/start", json={})
    assert anonymous.status_code == 401
