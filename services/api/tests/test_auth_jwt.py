"""PF-1: jwt auth mode, identity provisioning and /v1/me."""

from __future__ import annotations

import time

import jwt
import pytest
from chemdft_api.auth import validate_auth_configuration
from chemdft_api.config import Settings
from chemdft_api.jwt_auth import JwtVerifier, TokenError
from chemdft_api.models import (
    Membership,
    Organization,
    ProjectMember,
    User,
    UserIdentity,
)
from chemdft_api.service_principals import SERVICE_USER_IDS, ensure_service_principals
from multiuser import AUDIENCE, ISSUER, SigningKey, claims_for, jwt_settings
from sqlalchemy import func, select

ME_KEYS = {"id", "display_name", "email", "kind", "auth_mode", "organization", "setup"}


def _count(env, model) -> int:
    with env.sessions() as session:
        return session.scalar(select(func.count()).select_from(model))


def test_a_valid_token_provisions_a_human_with_a_personal_organization(multiuser) -> None:
    alice = multiuser.actor("alice")
    me = alice.get("/v1/me")
    assert me.status_code == 200, me.text
    body = me.json()
    assert set(body) == ME_KEYS  # nothing else leaks: no claims, tokens, subjects or provider data
    assert body["email"] == "alice@example.test" and body["display_name"] == "alice"
    assert body["kind"] == "HUMAN" and body["auth_mode"] == "jwt"
    assert body["organization"]["kind"] == "PERSONAL" and body["organization"]["role"] == "owner"
    assert body["setup"] == {"has_personal_organization": True, "project_count": 0}
    with multiuser.sessions() as session:
        user = session.get(User, body["id"])
        assert user.kind == "HUMAN" and user.disabled_at is None
        organization = session.get(Organization, body["organization"]["id"])
        assert organization.kind == "PERSONAL"
        membership = session.scalar(select(Membership).where(Membership.user_id == user.id))
        assert (membership.organization_id, membership.role) == (organization.id, "owner")
        identity = session.scalar(select(UserIdentity).where(UserIdentity.user_id == user.id))
        assert (identity.provider, identity.subject) == ("better-auth", alice.subject)
        # ownership of projects uses project_members; there is no owner shortcut on the project
        assert session.scalar(select(func.count()).select_from(ProjectMember)) == 0


def test_provisioning_is_idempotent_and_the_same_subject_keeps_its_ids(multiuser) -> None:
    alice = multiuser.actor("alice")
    first = alice.get("/v1/me").json()
    for _ in range(3):
        assert alice.get("/v1/me").json()["id"] == first["id"]
    assert _count(multiuser, User) == 1 and _count(multiuser, UserIdentity) == 1
    assert _count(multiuser, Organization) == 1


def test_me_counts_projects_and_names_the_role(multiuser) -> None:
    alice = multiuser.actor("alice")
    alice.create_project("alpha")
    me = alice.get("/v1/me").json()
    assert me["setup"]["project_count"] == 1


@pytest.mark.parametrize(
    ("label", "build", "code"),
    [
        ("expired", lambda k: k.sign(claims_for("s1", "a@x.test", lifetime=-60)), "token_expired"),
        (
            "wrong issuer",
            lambda k: k.sign(claims_for("s1", "a@x.test", issuer="https://evil.test")),
            "invalid_token",
        ),
        (
            "wrong audience",
            lambda k: k.sign(claims_for("s1", "a@x.test", audience="other-api")),
            "invalid_token",
        ),
        (
            "unknown key id",
            lambda k: k.sign(claims_for("s1", "a@x.test"), kid="not-a-key"),
            "invalid_token",
        ),
        (
            "other signing key",
            lambda k: SigningKey().sign(claims_for("s1", "a@x.test")),
            "invalid_token",
        ),
        (
            "no email claim",
            lambda k: k.sign({**claims_for("s1", "a@x.test"), "email": None}),
            "invalid_token",
        ),
        ("malformed", lambda k: "not.a.jwt", "invalid_token"),
        ("garbage", lambda k: "x", "invalid_token"),
    ],
)
def test_bad_tokens_are_rejected_with_401(multiuser, label, build, code) -> None:
    token = build(multiuser.keys)
    response = multiuser.client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401, label
    assert response.json()["detail"] == code
    assert response.headers["www-authenticate"] == "Bearer"
    assert _count(multiuser, UserIdentity) == 0  # a rejected token provisions nothing


def test_missing_required_claims_and_algorithm_confusion_are_rejected(multiuser) -> None:
    keys = multiuser.keys
    for claim in ("exp", "iat", "iss", "aud", "sub"):
        claims = claims_for("s1", "a@x.test")
        del claims[claim]
        response = multiuser.client.get(
            "/v1/me", headers={"Authorization": f"Bearer {keys.sign(claims)}"}
        )
        assert response.status_code == 401, claim
    # `alg: none` and an HMAC-signed token (algorithm confusion) must not verify
    none_token = jwt.encode(claims_for("s1", "a@x.test"), None, algorithm="none")
    hs_token = jwt.encode(
        claims_for("s1", "a@x.test"),
        "an-hmac-secret-that-is-long-enough-for-hs256",
        algorithm="HS256",
        headers={"kid": keys.kid},
    )
    for token in (none_token, hs_token):
        assert (
            multiuser.client.get("/v1/me", headers={"Authorization": f"Bearer {token}"}).status_code
            == 401
        )


def test_missing_or_non_bearer_credentials_are_401(multiuser) -> None:
    assert multiuser.client.get("/v1/me").json()["detail"] == "missing_token"
    token = multiuser.actor("alice").token()
    for value in (f"Basic {token}", f"Token {token}", "Bearer", "Bearer   "):
        response = multiuser.client.get("/v1/me", headers={"Authorization": value})
        assert response.status_code == 401


def test_a_token_expires_after_its_lifetime_but_leeway_covers_clock_skew(multiuser) -> None:
    alice = multiuser.actor("alice")
    almost = alice.token(issued_ago=905, lifetime=900)  # expired 5 s ago: inside the 10 s leeway
    assert (
        multiuser.client.get("/v1/me", headers={"Authorization": f"Bearer {almost}"}).status_code
        == 200
    )
    stale = alice.token(issued_ago=1000, lifetime=900)  # expired 100 s ago
    assert (
        multiuser.client.get("/v1/me", headers={"Authorization": f"Bearer {stale}"}).status_code
        == 401
    )


def test_jwt_mode_never_falls_back_to_the_development_identity(multiuser) -> None:
    settings = multiuser.settings
    # even a mis-set dev flag at runtime must not matter in jwt mode
    settings.dev_identity_enabled = True
    settings.dev_identity_header_override_enabled = True
    try:
        for headers in (
            {},
            {
                "X-ChemDFT-User-ID": settings.dev_user_id,
                "X-ChemDFT-Organization-ID": settings.dev_organization_id,
            },
            {"Authorization": "Bearer broken", "X-ChemDFT-User-ID": settings.dev_user_id},
        ):
            response = multiuser.client.get("/v1/projects", headers=headers)
            assert response.status_code == 401, headers
    finally:
        settings.dev_identity_enabled = False
        settings.dev_identity_header_override_enabled = False
    assert _count(multiuser, User) == 0  # nothing, not even the dev user, was created


def test_spoofed_identity_headers_do_not_change_who_the_caller_is(multiuser) -> None:
    alice, bob = multiuser.actor("alice"), multiuser.actor("bob")
    spoof = {"X-ChemDFT-User-ID": bob.user_id, "X-ChemDFT-Organization-ID": bob.organization_id}
    assert alice.get("/v1/me", headers=spoof).json()["id"] == alice.user_id
    assert (
        alice.get(
            "/v1/me", headers={"X-ChemDFT-User-ID": SERVICE_USER_IDS["compute-worker"]}
        ).json()["id"]
        == alice.user_id
    )


def test_an_email_that_belongs_to_another_user_is_never_auto_linked(multiuser) -> None:
    alice = multiuser.actor("alice")
    alice.me  # noqa: B018 - provisions alice
    impostor = multiuser.keys.sign(claims_for("a-different-subject", "ALICE@example.test"))
    response = multiuser.client.get("/v1/me", headers={"Authorization": f"Bearer {impostor}"})
    assert response.status_code == 403 and response.json()["detail"] == "account_not_available"
    assert _count(multiuser, UserIdentity) == 1 and _count(multiuser, User) == 1


def test_disabled_and_non_human_users_cannot_authenticate(multiuser) -> None:
    from datetime import UTC, datetime

    alice, bob = multiuser.actor("alice"), multiuser.actor("bob")
    alice.me, bob.me  # noqa: B018
    with multiuser.sessions() as session:
        session.get(User, alice.user_id).disabled_at = datetime.now(UTC)
        session.get(
            User, bob.user_id
        ).kind = "SERVICE"  # a browser session mapped onto a service row
        session.commit()
    assert alice.get("/v1/me").json()["detail"] == "account_disabled"
    assert alice.get("/v1/me").status_code == 403
    denied = bob.get("/v1/projects")
    assert denied.status_code == 403 and denied.json()["detail"] == "principal_not_human"
    with multiuser.sessions() as session:
        session.get(User, bob.user_id).kind = "LEGACY_LOCAL"
        session.commit()
    assert bob.get("/v1/me").json()["detail"] == "principal_not_human"


def test_a_token_cannot_claim_a_service_or_legacy_identity(multiuser) -> None:
    with multiuser.sessions() as session:
        ensure_service_principals(session)
    service_id = SERVICE_USER_IDS["compute-worker"]
    # The subject is only a key into user_identities. A service id as the subject, or asserting
    # kind/service/role claims, provisions an ordinary new human and nothing else.
    claims = claims_for(
        service_id,
        "mallory@example.test",
        kind="SERVICE",
        service="compute-worker",
        role="owner",
        sub_kind="service",
    )
    response = multiuser.client.get(
        "/v1/me", headers={"Authorization": f"Bearer {multiuser.keys.sign(claims)}"}
    )
    assert response.status_code == 200
    assert response.json()["kind"] == "HUMAN" and response.json()["id"] != service_id
    # and the resulting identity has no access to a project through a service-shaped path
    alice = multiuser.actor("alice")
    project = alice.create_project("private")
    mallory = {"Authorization": f"Bearer {multiuser.keys.sign(claims)}"}
    assert multiuser.client.get(f"/v1/projects/{project['id']}", headers=mallory).status_code == 404


def test_configuration_is_validated_at_startup(tmp_path) -> None:
    keys = SigningKey()
    url = f"sqlite:///{tmp_path / 'c.db'}"
    validate_auth_configuration(jwt_settings(url, tmp_path, keys))
    bad = {
        "unknown mode": dict(auth_mode="oauth"),
        "no issuer": dict(auth_issuer=None),
        "no audience": dict(auth_audience=None),
        "no key source": dict(auth_jwks_json=None),
        "dev identity alongside jwt": dict(dev_identity_enabled=True),
        "header override alongside jwt": dict(dev_identity_header_override_enabled=True),
        "none algorithm": dict(auth_jwt_algorithms="none"),
        "empty algorithms": dict(auth_jwt_algorithms=" , "),
    }
    for override in bad.values():
        with pytest.raises((RuntimeError, ValueError)):
            validate_auth_configuration(jwt_settings(url, tmp_path, keys, **override))
    # dev mode is unchanged: the PF-0 hosted guard still applies
    validate_auth_configuration(Settings(auth_mode="dev", dev_identity_enabled=True), {})
    with pytest.raises(RuntimeError):
        validate_auth_configuration(
            Settings(auth_mode="dev", dev_identity_enabled=True), {"VERCEL": "1"}
        )


def test_the_verifier_reports_an_unreachable_key_set_as_unavailable_not_as_a_valid_token(
    tmp_path,
) -> None:
    settings = Settings(
        auth_mode="jwt",
        auth_issuer=ISSUER,
        auth_audience=AUDIENCE,
        auth_jwks_url="http://127.0.0.1:9/jwks",
    )
    token = SigningKey().sign(claims_for("s", "a@x.test"))
    with pytest.raises(TokenError) as error:
        JwtVerifier(settings).verify(token)
    assert error.value.code == "key_set_unavailable"


def test_dev_mode_still_serves_the_local_identity_through_me(api) -> None:
    client, _sessions, settings = api
    me = client.get("/v1/me")
    assert me.status_code == 200, me.text
    body = me.json()
    assert set(body) == ME_KEYS
    assert body["kind"] == "LEGACY_LOCAL" and body["auth_mode"] == "dev"
    assert body["id"] == settings.dev_user_id
    assert body["organization"]["kind"] == "LEGACY_LOCAL"
    assert time.time() > 0
