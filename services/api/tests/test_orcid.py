"""ORCID (ADR-044). OFFLINE: ORCID is replaced by a local RSA issuer and a patched `httpx.post`; the real
state, PKCE, nonce, id_token and link code runs. This is not evidence that ORCID itself accepts the flow
(that is the sandbox acceptance)."""

import hashlib
import time
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from chemdft_api.config import Settings
from chemdft_api.models import Membership, Organization, OrganizationKind, User, UserIdentity
from chemdft_api.orcid import HttpOrcidClient, OrcidError, OrcidService, orcid_checksum_valid
from chemdft_api.orcid_models import OrcidAuditEvent, OrcidLink
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import SecretStr
from sqlalchemy import select

IDS = (
    "0000-0002-1825-0097",
    "0000-0001-5109-3700",
)  # ORCID's documented example iDs (valid checksums)
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
CLIENT_ID = "APP-TEST0000000000"


def enable(settings: Settings) -> Settings:
    settings.orcid_enabled = True
    settings.orcid_environment = "sandbox"
    settings.orcid_client_id = CLIENT_ID
    settings.orcid_client_secret = SecretStr("not-a-real-secret")
    settings.orcid_redirect_uri = "http://localhost:3000/orcid/callback"
    return settings


def client_for(settings: Settings, monkeypatch, orcid_id: str, *, bad_nonce: bool = False):
    """A real HttpOrcidClient whose network and key set are local; the id_token is signed for `nonce`."""
    client = HttpOrcidClient(settings)
    holder = {"nonce": None}

    class Key:
        key = KEY.public_key()

    monkeypatch.setattr(client._jwks, "get_signing_key_from_jwt", lambda _t: Key)

    def post(url, data, **_kw):
        assert url == "https://sandbox.orcid.org/oauth/token"
        assert data["grant_type"] == "authorization_code" and data["code_verifier"]
        now = int(time.time())
        token = jwt.encode(
            {
                "iss": "https://sandbox.orcid.org",
                "aud": CLIENT_ID,
                "sub": orcid_id,
                "iat": now,
                "exp": now + 600,
                "nonce": "wrong" if bad_nonce else holder["nonce"],
                "given_name": "Josiah",
                "family_name": "Carberry",
            },
            KEY,
            algorithm="RS256",
            headers={"kid": "k"},
        )
        return httpx.Response(200, json={"id_token": token, "access_token": "discarded"})

    monkeypatch.setattr(httpx, "post", post)
    return client, holder


def begin(service: OrcidService, holder, purpose="link", **kw):
    url = service.start(purpose, **kw).authorize_url
    query = parse_qs(urlparse(url).query)
    holder["nonce"] = query["nonce"][0]
    assert query["scope"] == ["openid"] and query["code_challenge_method"] == ["S256"]
    assert query["redirect_uri"] == ["http://localhost:3000/orcid/callback"]
    return query["state"][0]


def second_user(sessions, email="second@example.invalid", subject="sub-2") -> str:
    with sessions() as s:
        user = User(email=email, display_name="Second")
        s.add(user)
        s.flush()
        org = Organization(name="second", kind=OrganizationKind.PERSONAL)
        s.add(org)
        s.flush()
        s.add(Membership(organization_id=org.id, user_id=user.id, role="owner"))
        s.add(UserIdentity(user_id=user.id, provider="better-auth", subject=subject))
        s.commit()
        return user.id


def test_orcid_id_checksum() -> None:
    assert all(orcid_checksum_valid(i) for i in (*IDS, "0000-0002-1694-233X"))
    assert not orcid_checksum_valid("0000-0002-1825-0098")
    assert not orcid_checksum_valid("not-an-id")


def test_routes_are_off_by_default_and_status_still_answers(api) -> None:
    client, _sessions, _settings = api
    assert client.get("/v1/orcid").json()["enabled"] is False
    assert client.post("/v1/orcid/link/start", json={}).status_code == 404
    assert client.post("/v1/orcid/signin/start", json={"binding_hash": "0" * 64}).status_code == 404


def test_link_authenticated_id_then_refuse_replay_and_unlink(api, monkeypatch) -> None:
    client, sessions, settings = api
    enable(settings)
    me = client.get("/v1/me").json()["id"]
    http, holder = client_for(settings, monkeypatch, IDS[0])
    with sessions() as s:
        service = OrcidService(s, settings, http)
        state = begin(service, holder, user_id=me, keep_name=True)
        status = service.complete_link(me, "code-1", state)
        assert (status.linked, status.orcid_id, status.display_name) == (
            True,
            IDS[0],
            "Josiah Carberry",
        )
        assert status.record_url == f"https://sandbox.orcid.org/{IDS[0]}"
        with pytest.raises(OrcidError) as replay:  # a state works once
            service.complete_link(me, "code-1", state)
        assert replay.value.code == "state_invalid"
        service.unlink(me)
        assert service.status(me).linked is False
        events = [(e.event, e.outcome) for e in s.scalars(select(OrcidAuditEvent))]
        assert ("link", "SUCCEEDED") in events and ("unlink", "SUCCEEDED") in events
        assert not any(IDS[0] in (e.reason or "") for e in s.scalars(select(OrcidAuditEvent)))


def test_name_is_dropped_without_consent_and_a_wrong_nonce_is_refused(api, monkeypatch) -> None:
    client, sessions, settings = api
    enable(settings)
    me = client.get("/v1/me").json()["id"]
    with sessions() as s:
        http, holder = client_for(settings, monkeypatch, IDS[0], bad_nonce=True)
        service = OrcidService(s, settings, http)
        state = begin(service, holder, user_id=me)
        with pytest.raises(OrcidError) as bad:
            service.complete_link(me, "c", state)
        assert bad.value.code == "orcid_token_invalid" and s.scalar(select(OrcidLink)) is None
        http, holder = client_for(settings, monkeypatch, IDS[0])
        service = OrcidService(s, settings, http)
        state = begin(service, holder, user_id=me, keep_name=False)
        assert service.complete_link(me, "c", state).display_name is None


def test_second_account_cannot_claim_a_linked_id_and_state_is_user_bound(api, monkeypatch) -> None:
    client, sessions, settings = api
    enable(settings)
    me = client.get("/v1/me").json()["id"]
    other = second_user(sessions)
    http, holder = client_for(settings, monkeypatch, IDS[0])
    with sessions() as s:
        service = OrcidService(s, settings, http)
        service.complete_link(me, "c", begin(service, holder, user_id=me))
        state = begin(service, holder, user_id=other)
        with pytest.raises(OrcidError) as taken:
            service.complete_link(other, "c", state)
        assert (taken.value.code, taken.value.status) == ("orcid_id_unavailable", 409)
        stolen = begin(service, holder, user_id=other)  # someone else's state is useless to me
        with pytest.raises(OrcidError) as mismatch:
            service.complete_link(me, "c", stolen)
        assert mismatch.value.code == "state_invalid"


def test_signin_only_for_linked_accounts_and_never_creates_one(api, monkeypatch) -> None:
    client, sessions, settings = api
    enable(settings)
    client.get("/v1/me")
    me = second_user(
        sessions, "human@example.invalid", "subject-of-human"
    )  # the dev principal is LEGACY_LOCAL
    with sessions() as s:
        users_before = len(s.scalars(select(User)).all())
        binding = "b" * 32
        binding_hash = hashlib.sha256(binding.encode()).hexdigest()
        http, holder = client_for(settings, monkeypatch, IDS[1])  # an iD nobody linked
        service = OrcidService(s, settings, http)
        state = begin(service, holder, "signin", user_id=None, binding_hash=binding_hash)
        with pytest.raises(OrcidError) as unlinked:
            service.complete_signin("c", state, binding)
        assert (unlinked.value.code, unlinked.value.status) == ("not_linked", 403)
        assert len(s.scalars(select(User)).all()) == users_before
        service.complete_link(
            me, "c", begin(service, holder, user_id=me)
        )  # now link IDS[1] to the account
        state = begin(service, holder, "signin", user_id=None, binding_hash=binding_hash)
        with pytest.raises(OrcidError) as csrf:  # a state started in another browser
            service.complete_signin("c", state, "x" * 32)
        assert csrf.value.code == "state_invalid"
        state = begin(service, holder, "signin", user_id=None, binding_hash=binding_hash)
        assert service.complete_signin("c", state, binding) == "subject-of-human"


def test_expired_state_and_rate_limit(api, monkeypatch) -> None:
    client, sessions, settings = api
    enable(settings)
    me = client.get("/v1/me").json()["id"]
    http, holder = client_for(settings, monkeypatch, IDS[0])
    with sessions() as s:
        service = OrcidService(s, settings, http)
        state = begin(service, holder, user_id=me)
        from chemdft_api.orcid_models import OrcidAuthState
        from datetime import timedelta

        row = s.scalar(select(OrcidAuthState))
        row.expires_at = row.expires_at - timedelta(hours=1)
        s.commit()
        with pytest.raises(OrcidError) as expired:
            service.complete_link(me, "c", state)
        assert expired.value.code == "state_invalid"
        for _ in range(25):
            try:
                service.start("link", user_id=me)
            except OrcidError as error:
                assert (error.code, error.status) == ("rate_limited", 429)
                break
        else:
            raise AssertionError("no rate limit")


def test_production_uses_orcid_org_and_only_the_registered_redirect_and_a_secret_file(
    api, monkeypatch, tmp_path
) -> None:
    client, sessions, settings = api
    me = client.get("/v1/me").json()["id"]
    settings.orcid_enabled = True
    settings.orcid_environment = "production"
    settings.orcid_client_id = CLIENT_ID
    settings.orcid_client_secret = SecretStr("file-supplied")
    settings.orcid_redirect_uri = "https://chemdft.com/orcid/callback"
    with sessions() as s:
        service = OrcidService(s, settings, None)
        url = service.start("link", user_id=me).authorize_url
        assert url.startswith("https://orcid.org/oauth/authorize?")
        assert parse_qs(urlparse(url).query)["redirect_uri"] == [settings.orcid_redirect_uri]
        settings.orcid_redirect_uri = "https://chemdft.com/orcid/callback/"
        with pytest.raises(OrcidError) as wrong:  # not the registered URI: production stays off
            service.start("link", user_id=me)
        assert wrong.value.status == 404
    secret_file = tmp_path / "orcid-client-secret"
    secret_file.write_text("from-a-file\n")
    secret_file.chmod(0o600)
    with pytest.raises(ValueError, match="refused for production"):  # env text is never accepted
        Settings(orcid_environment="production", orcid_client_secret="from-env")
    ok = Settings(orcid_environment="production", orcid_client_secret_file=secret_file)
    assert ok.orcid_client_secret.get_secret_value() == "from-a-file"


def test_unlink_deletes_the_id_and_name_and_signin_is_refused_afterwards(api, monkeypatch) -> None:
    client, sessions, settings = api
    enable(settings)
    client.get("/v1/me")
    human = second_user(sessions, "unlinker@example.invalid", "subject-unlinker")
    binding = "u" * 32
    binding_hash = hashlib.sha256(binding.encode()).hexdigest()
    http, holder = client_for(settings, monkeypatch, IDS[0])
    with sessions() as s:
        service = OrcidService(s, settings, http)
        service.complete_link(human, "c", begin(service, holder, user_id=human, keep_name=True))
        assert s.scalar(select(OrcidLink).where(OrcidLink.user_id == human)).display_name
        state = begin(service, holder, "signin", user_id=None, binding_hash=binding_hash)
        assert service.complete_signin("c", state, binding) == "subject-unlinker"
        service.unlink(human)
        assert s.scalars(select(OrcidLink)).all() == []  # iD and kept name are gone, not hidden
        state = begin(service, holder, "signin", user_id=None, binding_hash=binding_hash)
        with pytest.raises(OrcidError) as refused:
            service.complete_signin("c", state, binding)
        assert (refused.value.code, refused.value.status) == ("not_linked", 403)
        assert ("unlink", "SUCCEEDED") in [
            (e.event, e.outcome) for e in s.scalars(select(OrcidAuditEvent))
        ]


def test_a_signin_state_is_single_use(api, monkeypatch) -> None:
    client, sessions, settings = api
    enable(settings)
    client.get("/v1/me")
    human = second_user(sessions, "reuse@example.invalid", "subject-reuse")
    binding = "r" * 32
    binding_hash = hashlib.sha256(binding.encode()).hexdigest()
    http, holder = client_for(settings, monkeypatch, IDS[1])
    with sessions() as s:
        service = OrcidService(s, settings, http)
        service.complete_link(human, "c", begin(service, holder, user_id=human))
        state = begin(service, holder, "signin", user_id=None, binding_hash=binding_hash)
        assert service.complete_signin("c", state, binding) == "subject-reuse"
        with pytest.raises(OrcidError) as replay:
            service.complete_signin("c", state, binding)
        assert replay.value.code == "state_invalid"
        reasons = [e.reason for e in s.scalars(select(OrcidAuditEvent)) if e.outcome == "REFUSED"]
        assert "state_reused" in reasons
