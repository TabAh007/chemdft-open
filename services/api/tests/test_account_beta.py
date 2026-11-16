# ruff: noqa: E501
"""ADR-045: self-signup accounts, verification gate, quotas, export and deletion (offline, local accounts)."""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from chemdft_api import account_policy
from chemdft_api.account_models import AccountAuditEvent, AccountProfile
from chemdft_api.errors import AccountPolicyError
from chemdft_api.models import Project, StoredFile, User, UserIdentity
from sqlalchemy import select

XYZ = b"2\nH2\nH 0 0 -0.37\nH 0 0 0.37\n"


def _self_signup(env, name: str, *, verified: bool = True):
    """An actor whose token carries what the web layer's signup path adds (signup_source, terms)."""
    actor = env.actor(name)
    original = actor.token

    def token(**extra):
        return original(
            email_verified=verified,
            signup_source="self",
            terms_version="2026-11-03-draft",
            terms_accepted_at="2026-11-03T10:00:00Z",
            **extra,
        )

    actor.token = token  # type: ignore[method-assign]
    return actor


def test_self_signup_is_refused_while_the_flag_is_off(multiuser) -> None:
    multiuser.settings.signup_open = False
    alice = _self_signup(multiuser, "alice")
    response = alice.get("/v1/me")
    assert response.status_code == 403 and response.json()["detail"] == "signup_closed"
    with multiuser.sessions() as session:
        assert session.scalar(select(User).where(User.email == alice.email)) is None
        event = session.scalar(select(AccountAuditEvent))
        assert (event.event, event.outcome, event.reason) == ("signup_provisioned", "REFUSED", "signup_closed")


def test_open_signup_creates_a_researcher_with_a_profile_and_recorded_terms(multiuser) -> None:
    multiuser.settings.signup_open = True
    alice = _self_signup(multiuser, "alice")
    assert alice.get("/v1/me").status_code == 200
    with multiuser.sessions() as session:
        profile = session.get(AccountProfile, alice.user_id)
        assert profile.signup_source == "SELF_SIGNUP" and profile.email_verified_at is not None
        assert profile.terms_version == "2026-11-03-draft" and profile.terms_accepted_at is not None
    limits = alice.get("/v1/me/limits").json()
    assert limits["applies"] is True and limits["ai_enabled"] is False
    assert {q["key"] for q in limits["quotas"]} >= {"jobs_day", "projects", "storage_mb", "upload_mb"}


def test_accounts_without_a_profile_are_not_limited(multiuser) -> None:
    bob = multiuser.actor("bob")  # the owner / invited-researcher path: no signup claim
    assert bob.get("/v1/me/limits").json() == {"applies": False, "email_verified": True, "ai_enabled": True, "quotas": []}
    multiuser.settings.quota_max_projects = 1
    bob.create_project("p1")
    bob.create_project("p2")  # no refusal: quotas apply to self-signup accounts only


def test_project_quota_is_enforced_named_and_audited(multiuser) -> None:
    multiuser.settings.signup_open = True
    multiuser.settings.quota_max_projects = 2
    alice = _self_signup(multiuser, "alice")
    alice.create_project("a1")
    alice.create_project("a2")
    refused = alice.post("/v1/projects", json={"name": "a3", "slug": "a3"})
    assert refused.status_code == 429
    assert refused.json()["detail"]["code"] == "QUOTA_PROJECTS"
    with multiuser.sessions() as session:
        event = session.scalar(select(AccountAuditEvent).where(AccountAuditEvent.reason == "QUOTA_PROJECTS"))
        assert event.user_id == alice.user_id and event.outcome == "REFUSED"


def test_unverified_email_cannot_compute_or_use_ai(multiuser) -> None:
    multiuser.settings.signup_open = True
    alice = _self_signup(multiuser, "alice", verified=False)
    alice.get("/v1/me")
    with multiuser.sessions() as session:
        for gate in (account_policy.enforce_compute, account_policy.enforce_ai):
            with pytest.raises(AccountPolicyError) as raised:
                gate(session, multiuser.settings, alice.user_id)
            assert raised.value.code == "EMAIL_NOT_VERIFIED" and raised.value.status_code == 403


def test_job_and_ai_quotas_and_the_ai_flag(multiuser, monkeypatch) -> None:
    multiuser.settings.signup_open = True
    alice = _self_signup(multiuser, "alice")
    alice.get("/v1/me")
    s = multiuser.settings

    def codes(counts):
        monkeypatch.setattr(account_policy, "_job_counts", lambda *_: counts)
        with multiuser.sessions() as session:
            with pytest.raises(AccountPolicyError) as raised:
                account_policy.enforce_compute(session, s, alice.user_id)
            return raised.value.code

    assert codes((0, 0, s.quota_concurrent_jobs)) == "QUOTA_JOBS_CONCURRENT".replace("JOBS_CONCURRENT", "CONCURRENT_JOBS")
    assert codes((s.quota_jobs_per_day, 0, 0)) == "QUOTA_JOBS_DAY"
    assert codes((0, s.quota_jobs_per_month, 0)) == "QUOTA_JOBS_MONTH"
    monkeypatch.setattr(account_policy, "_job_counts", lambda *_: (0, 0, 0))
    with multiuser.sessions() as session:
        account_policy.enforce_compute(session, s, alice.user_id)  # within limits: no error
        s.ai_for_new_users = False
        with pytest.raises(AccountPolicyError) as raised:
            account_policy.enforce_ai(session, s, alice.user_id)
        assert raised.value.code == "AI_NOT_ENABLED"
        s.ai_for_new_users = True
        monkeypatch.setattr(account_policy, "_ai_runs_today", lambda *_: s.quota_ai_runs_per_day)
        with pytest.raises(AccountPolicyError) as raised:
            account_policy.enforce_ai(session, s, alice.user_id)
        assert raised.value.code == "QUOTA_AI_RUNS_DAY"


def test_upload_size_limit_applies_to_self_signup_only(multiuser) -> None:
    multiuser.settings.signup_open = True
    multiuser.settings.quota_upload_mb = 1
    alice = _self_signup(multiuser, "alice")
    bob = multiuser.actor("bob")
    big = b"x" * (1024 * 1024 + 10)
    for actor, expected in ((alice, 413), (bob, 201)):
        project = actor.create_project(f"{actor.name}-p")
        response = actor.post(f"/v1/projects/{project['id']}/files", files={"upload": ("big.bin", big, "application/octet-stream")})
        assert response.status_code == expected, (actor.name, response.status_code, response.text)


def _seed(actor, slug):
    project = actor.create_project(slug)
    imported = actor.post(
        f"/v1/projects/{project['id']}/structures/imports",
        files={"upload": ("h2.xyz", XYZ, "chemical/x-xyz")},
        data={"file_format": "XYZ", "coordinate_unit": "angstrom", "structure_name": "H2", "idempotency_key": f"{slug}-import-1"},
    )
    assert imported.status_code in (200, 201), imported.text
    return project


def test_export_contains_only_the_callers_data_and_no_secrets(multiuser) -> None:
    alice, bob = multiuser.actor("alice"), multiuser.actor("bob")
    mine, theirs = _seed(alice, "alice-proj"), _seed(bob, "bob-proj")
    response = alice.get("/v1/me/export")
    assert response.status_code == 200 and response.headers["content-type"] == "application/zip"
    bundle = zipfile.ZipFile(io.BytesIO(response.content))
    names = bundle.namelist()
    assert "manifest.json" in names and f"projects/{mine['id']}/project.json" in names
    assert not any(theirs["id"] in name for name in names)
    text = b"".join(bundle.read(name) for name in names).decode()
    assert theirs["id"] not in text and "bob@example.test" not in text
    for secret in ("password", "token", "secret", "jwks"):
        assert secret not in json.dumps(json.loads(bundle.read("account.json"))).lower()
    assert json.loads(bundle.read("account.json"))["email"] == "alice@example.test"
    assert bob.get("/v1/me/export").status_code == 200  # independent; still bob's own


def test_deletion_requires_confirmation_then_purges_and_isolates(multiuser) -> None:
    alice, bob = multiuser.actor("alice"), multiuser.actor("bob")
    mine, theirs = _seed(alice, "alice-proj"), _seed(bob, "bob-proj")
    alice_id = alice.user_id
    alice.post(f"/v1/projects/{mine['id']}/files", files={"upload": ("n.txt", b"hello", "text/plain")})
    with multiuser.sessions() as session:
        keys = [f.object_key for f in session.scalars(select(StoredFile).where(StoredFile.project_id == mine["id"]))]
    assert keys
    assert alice.post("/v1/me/delete", json={"confirm_email": "wrong@example.test"}).status_code == 400
    assert alice.get("/v1/me").status_code == 200  # nothing happened
    done = alice.post("/v1/me/delete", json={"confirm_email": "ALICE@example.test"})
    assert done.status_code == 200 and done.json()["deleted"] is True and done.json()["projects_purged"] == 1
    # the old token is now refused; the identity cannot be re-provisioned
    again = alice.get("/v1/me")
    assert again.status_code == 403 and again.json()["detail"] == "account_disabled"
    with multiuser.sessions() as session:
        user = session.get(User, alice_id)
        assert user.email.endswith("@deleted.invalid") and user.display_name == "Deleted user" and user.disabled_at
        assert session.scalar(select(StoredFile).where(StoredFile.project_id == mine["id"])) is None
        assert session.get(Project, mine["id"]).name == "Deleted project"
        assert session.scalar(select(UserIdentity).where(UserIdentity.user_id == alice_id)) is not None
        events = session.scalars(select(AccountAuditEvent).where(AccountAuditEvent.event == "account_delete")).all()
        assert [e.outcome for e in events] == ["REFUSED", "SUCCEEDED"]
        assert all("example.test" not in f"{e.reason}{e.user_id}" for e in events)
    for key in keys:  # the stored bytes are gone from the object store
        assert not (multiuser.settings.object_root / key).exists()
    # bob is untouched and still sees his own project and structure
    assert bob.get(f"/v1/projects/{theirs['id']}").status_code == 200
    assert bob.get(f"/v1/projects/{theirs['id']}/structures").json()
    assert bob.get(f"/v1/projects/{mine['id']}").status_code == 404


def test_deleted_account_cannot_come_back_through_signup_claims(multiuser) -> None:
    multiuser.settings.signup_open = True
    alice = _self_signup(multiuser, "alice")
    alice.get("/v1/me")
    assert alice.post("/v1/me/delete", json={"confirm_email": alice.email}).status_code == 200
    assert alice.get("/v1/me").status_code == 403
    assert alice.get("/v1/me/export").status_code == 403
