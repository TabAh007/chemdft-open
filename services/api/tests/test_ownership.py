# ruff: noqa: E501  (long literals and messages in test data)
"""PF-2: the legacy project claim, bootstrap administrator, ownership events and frozen-project protection."""

from __future__ import annotations

import json

import pytest
from chemdft_api import ownership_cli
from chemdft_api.models import (
    OwnershipEventRecord,
    OwnershipEventType,
    Project,
    ProjectKind,
    ProjectMember,
    User,
    UserIdentity,
)
from chemdft_api.ownership_service import (
    OwnershipDenied,
    authorize_bootstrap_admin,
    claim_legacy_project,
    configured_admin_emails,
)
from chemdft_api.service_principals import (
    SERVICE_COMPUTE_WORKER,
    SERVICE_USER_IDS,
    ensure_service_principals,
)
from multiuser import LEGACY_ORG_ID, LEGACY_USER_ID, database_snapshot, seed_legacy_workspace
from sqlalchemy import func, select

ADMIN = "alice@example.test"


@pytest.fixture
def world(multiuser):
    """Legacy workspace (2 claimable + 1 frozen project with content), a configured admin (alice) and bob."""
    multiuser.settings.bootstrap_admin_emails = ADMIN
    legacy = seed_legacy_workspace(multiuser)
    alice, bob = multiuser.actor("alice"), multiuser.actor("bob")
    alice.me, bob.me  # noqa: B018 - provision both accounts
    return multiuser, legacy, alice, bob


def _claim(env, **overrides):
    values = dict(
        actor_email=ADMIN,
        project_id=overrides.pop("project_id"),
        destination_organization_id=overrides.pop("destination_organization_id"),
        reason="pre-launch rehearsal",
        idempotency_key="claim-1",
    )
    values.update(overrides)
    with env.sessions() as session:
        return claim_legacy_project(session, env.settings, **values)


def _count(env, model) -> int:
    with env.sessions() as session:
        return session.scalar(select(func.count()).select_from(model))


def test_bootstrap_admin_exists_only_when_explicitly_configured(multiuser) -> None:
    alice = multiuser.actor("alice")
    alice.me  # noqa: B018
    with multiuser.sessions() as session:
        # nothing configured: nobody is an administrator, not even the first or only user
        assert configured_admin_emails(multiuser.settings) == frozenset()
        with pytest.raises(OwnershipDenied) as error:
            authorize_bootstrap_admin(session, multiuser.settings, "alice@example.test")
        assert error.value.code == "not_bootstrap_admin"
        multiuser.settings.bootstrap_admin_emails = " Alice@Example.test , other@example.test "
        assert (
            authorize_bootstrap_admin(session, multiuser.settings, "ALICE@example.test").id
            == alice.user_id
        )
        # exact email only: no domain guessing, no prefix matching
        for guess in (
            "bob@example.test",
            "alice@example.test.evil",
            "alic@example.test",
            "@example.test",
            "",
        ):
            with pytest.raises(OwnershipDenied):
                authorize_bootstrap_admin(session, multiuser.settings, guess)
        # a configured email that has never signed in (no mapped account) is not an administrator
        with pytest.raises(OwnershipDenied):
            authorize_bootstrap_admin(session, multiuser.settings, "other@example.test")


def test_only_active_human_accounts_can_be_the_administrator(multiuser) -> None:
    from datetime import UTC, datetime

    alice = multiuser.actor("alice")
    alice.me  # noqa: B018
    multiuser.settings.bootstrap_admin_emails = (
        f"{ADMIN},compute-worker@service.chemdft.invalid,developer@localhost.invalid"
    )
    with multiuser.sessions() as session:
        ensure_service_principals(session)
        session.add(
            User(
                id=LEGACY_USER_ID,
                email="developer@localhost.invalid",
                display_name="dev",
                kind="LEGACY_LOCAL",
            )
        )
        session.add(
            UserIdentity(user_id=LEGACY_USER_ID, provider="better-auth", subject="legacy-subject")
        )
        session.add(
            UserIdentity(
                user_id=SERVICE_USER_IDS[SERVICE_COMPUTE_WORKER],
                provider="better-auth",
                subject="service-subject",
            )
        )
        session.commit()
        for email in ("compute-worker@service.chemdft.invalid", "developer@localhost.invalid"):
            with pytest.raises(
                OwnershipDenied
            ):  # a SERVICE or LEGACY_LOCAL principal can never administer
                authorize_bootstrap_admin(session, multiuser.settings, email)
        session.get(User, alice.user_id).disabled_at = datetime.now(UTC)
        session.commit()
        with pytest.raises(OwnershipDenied):  # a disabled user cannot
            authorize_bootstrap_admin(session, multiuser.settings, ADMIN)


def test_an_ordinary_human_cannot_claim_and_nothing_is_written(world) -> None:
    env, legacy, _alice, bob = world
    target = legacy["legacy-0"]
    before = database_snapshot(env)
    with pytest.raises(OwnershipDenied) as error, env.sessions() as session:
        claim_legacy_project(
            session,
            env.settings,
            actor_email="bob@example.test",
            project_id=target["id"],
            destination_organization_id=bob.organization_id,
            reason="trying",
            idempotency_key="bob-1",
        )
    assert error.value.code == "not_bootstrap_admin"
    assert database_snapshot(env) == before
    assert bob.get(f"/v1/projects/{target['id']}").status_code == 404


def test_a_claim_rehomes_the_project_and_rewrites_no_history(world) -> None:
    from chemdft_api.actions import authorize_project_access
    from chemdft_api.context import Identity
    from chemdft_api.errors import ProjectNotFound

    env, legacy, alice, bob = world
    target = legacy["legacy-0"]
    assert (
        alice.get(f"/v1/projects/{target['id']}").status_code == 404
    )  # no access before the claim
    before = database_snapshot(env)
    with env.sessions() as session:
        project_before = {
            c.name: getattr(session.get(Project, target["id"]), c.name)
            for c in Project.__table__.columns
        }

    result = _claim(env, project_id=target["id"], destination_organization_id=alice.organization_id)
    assert result.created and result.event.event_type == OwnershipEventType.LEGACY_CLAIM_GRANTED

    after = database_snapshot(env)
    changed = sorted(table for table in before if before[table] != after[table])
    # every scientific, provenance, audit, billing and compute table is byte-identical
    assert changed == ["ownership_events", "project_members", "projects"]
    with env.sessions() as session:
        project = session.get(Project, target["id"])
        now = {c.name: getattr(project, c.name) for c in Project.__table__.columns}
        differing = {name for name in now if now[name] != project_before[name]}
        assert differing == {
            "organization_id",
            "kind",
            "updated_at",
        }  # id, name, slug, created_by, created_at intact
        assert (project.organization_id, project.kind) == (
            alice.organization_id,
            ProjectKind.NORMAL,
        )
        assert project.created_by == LEGACY_USER_ID  # the historical creator is never rewritten
        members = {
            m.user_id: m.role
            for m in session.scalars(
                select(ProjectMember).where(ProjectMember.project_id == target["id"])
            )
        }
        # project_members is current access state: only the claimant remains on the claimed project
        assert members == {alice.user_id: "owner"}
        others = {  # the legacy user keeps its memberships on every unrelated legacy project
            m.project_id
            for m in session.scalars(
                select(ProjectMember).where(ProjectMember.user_id == LEGACY_USER_ID)
            )
        }
        assert others == {legacy["legacy-1"]["id"], legacy["frozen-2"]["id"]}
        assert session.get(User, LEGACY_USER_ID) is not None  # the legacy user itself is untouched
        removal = session.scalar(
            select(OwnershipEventRecord).where(
                OwnershipEventRecord.event_type == OwnershipEventType.MEMBERSHIP_REMOVED
            )
        )
        assert (removal.project_id, removal.subject_user_id, removal.actor_user_id) == (
            target["id"],
            LEGACY_USER_ID,
            alice.user_id,
        )
        assert (removal.source_organization_id, removal.destination_organization_id) == (
            LEGACY_ORG_ID,
            alice.organization_id,
        )
        assert (removal.previous_role, removal.new_role) == ("owner", None)
        event = session.scalar(
            select(OwnershipEventRecord).where(
                OwnershipEventRecord.event_type == OwnershipEventType.LEGACY_CLAIM_GRANTED
            )
        )
        assert (event.project_id, event.actor_user_id, event.subject_user_id) == (
            target["id"],
            alice.user_id,
            alice.user_id,
        )
        # the history of where the project came from lives in the append-only event
        assert (event.source_organization_id, event.destination_organization_id) == (
            LEGACY_ORG_ID,
            alice.organization_id,
        )
        assert (event.previous_role, event.new_role, event.reason) == (
            None,
            "owner",
            "pre-launch rehearsal",
        )
        # the legacy identity no longer reaches the re-homed project (it left that tenant) but keeps the rest
        with pytest.raises(ProjectNotFound):
            authorize_project_access(session, Identity(LEGACY_USER_ID, LEGACY_ORG_ID), target["id"])
        authorize_project_access(
            session, Identity(LEGACY_USER_ID, LEGACY_ORG_ID), legacy["legacy-1"]["id"]
        )

    # the claimant reaches it through the one normal rule; others still do not
    assert alice.get(f"/v1/projects/{target['id']}").status_code == 200
    assert [p["id"] for p in alice.get("/v1/projects").json()] == [target["id"]]
    assert (
        alice.get(f"/v1/projects/{target['id']}/structures").json()[0]["id"] == target["structure"]
    )
    assert (
        alice.get(f"/v1/projects/{target['id']}").json()["organization_id"] == alice.organization_id
    )
    assert bob.get(f"/v1/projects/{target['id']}").status_code == 404
    assert (
        alice.get(f"/v1/projects/{legacy['legacy-1']['id']}").status_code == 404
    )  # others unaffected
    assert alice.get("/v1/me").json()["setup"]["project_count"] == 1


def test_a_repeated_claim_is_idempotent(world) -> None:
    env, legacy, alice, bob = world
    target = legacy["legacy-0"]
    first = _claim(env, project_id=target["id"], destination_organization_id=alice.organization_id)
    snapshot = database_snapshot(env)
    again = _claim(env, project_id=target["id"], destination_organization_id=alice.organization_id)
    assert (
        again.created is False and again.event.id == first.event.id
    )  # same key: the original event
    other_key = _claim(
        env,
        project_id=target["id"],
        destination_organization_id=alice.organization_id,
        idempotency_key="claim-2",
    )
    assert (
        other_key.created is False and other_key.event is None
    )  # already in that state: no second event
    assert database_snapshot(env) == snapshot
    assert (
        _count(env, OwnershipEventRecord) == 2 and _count(env, ProjectMember) == 3
    )  # claim + removed legacy membership; 2 legacy owners left on other projects + alice
    with pytest.raises(
        OwnershipDenied
    ) as conflict:  # one key may not be reused for a different request
        _claim(
            env,
            project_id=legacy["legacy-1"]["id"],
            destination_organization_id=alice.organization_id,
        )
    assert conflict.value.code == "idempotency_key_conflict"
    # a claimed project is a NORMAL project of its new organization: it cannot be claimed away again
    with pytest.raises(OwnershipDenied) as reclaim:
        _claim(
            env,
            project_id=target["id"],
            destination_organization_id=bob.organization_id,
            idempotency_key="claim-3",
        )
    assert reclaim.value.code == "project_not_claimable"
    assert database_snapshot(env) == snapshot


def test_frozen_system_and_normal_projects_cannot_be_claimed(world) -> None:
    env, legacy, alice, bob = world
    frozen = legacy["frozen-2"]
    normal = bob.create_project("bobs-own")
    snapshot = database_snapshot(env)
    cases = {
        "project_frozen": frozen["id"],
        "project_not_claimable": normal["id"],  # another user's NORMAL project
        "project_not_found": "9" * 36,
    }
    for code, project_id in cases.items():
        with pytest.raises(OwnershipDenied) as error:
            _claim(
                env,
                project_id=project_id,
                destination_organization_id=alice.organization_id,
                idempotency_key=f"k-{code}",
            )
        assert error.value.code == code
    assert database_snapshot(env) == snapshot  # not a single byte changed
    # a frozen project keeps its kind, its organization and its single legacy member
    with env.sessions() as session:
        project = session.get(Project, frozen["id"])
        assert (project.kind, project.organization_id) == (
            ProjectKind.ACCEPTANCE_FROZEN,
            LEGACY_ORG_ID,
        )
        assert [
            m.user_id
            for m in session.scalars(
                select(ProjectMember).where(ProjectMember.project_id == frozen["id"])
            )
        ] == [LEGACY_USER_ID]


def test_invalid_destinations_are_refused(world) -> None:
    from datetime import UTC, datetime

    env, legacy, alice, bob = world
    target = legacy["legacy-0"]
    snapshot = database_snapshot(env)
    with pytest.raises(OwnershipDenied) as error:  # the legacy organization is not a personal one
        _claim(
            env,
            project_id=target["id"],
            destination_organization_id=LEGACY_ORG_ID,
            idempotency_key="d1",
        )
    assert error.value.code == "destination_not_personal_organization"
    with pytest.raises(OwnershipDenied):  # unknown organization
        _claim(
            env, project_id=target["id"], destination_organization_id="8" * 36, idempotency_key="d2"
        )
    with pytest.raises(OwnershipDenied):  # empty reason
        _claim(
            env,
            project_id=target["id"],
            destination_organization_id=alice.organization_id,
            reason=" ",
        )
    assert database_snapshot(env) == snapshot
    with env.sessions() as session:  # a disabled destination user
        session.get(User, bob.user_id).disabled_at = datetime.now(UTC)
        session.commit()
    snapshot = database_snapshot(env)
    with pytest.raises(OwnershipDenied) as disabled:
        _claim(
            env,
            project_id=target["id"],
            destination_organization_id=bob.organization_id,
            idempotency_key="d3",
        )
    assert disabled.value.code == "destination_user_invalid"
    assert database_snapshot(env) == snapshot and _count(env, OwnershipEventRecord) == 0


def test_a_slug_that_already_exists_in_the_destination_is_refused_cleanly(world) -> None:
    env, legacy, alice, _bob = world
    alice.create_project("legacy-0")  # same slug as the legacy project
    snapshot = database_snapshot(env)
    with pytest.raises(OwnershipDenied) as error:
        _claim(
            env,
            project_id=legacy["legacy-0"]["id"],
            destination_organization_id=alice.organization_id,
        )
    assert error.value.code == "destination_slug_conflict"
    assert database_snapshot(env) == snapshot  # nothing was half-moved


def test_a_claim_is_atomic_whatever_step_fails(world) -> None:
    """Fail the transaction at each write; the database must equal the pre-claim state exactly."""
    from sqlalchemy import event

    env, legacy, alice, _bob = world
    target = legacy["legacy-0"]
    before = database_snapshot(env)

    def boom(*_args):
        raise RuntimeError("injected failure")

    def boom_on_claim_event(_mapper, _connection, row):
        if row.event_type == OwnershipEventType.LEGACY_CLAIM_GRANTED:
            raise RuntimeError("injected failure")

    steps = (
        ("project re-home", Project, "before_update", boom),
        ("legacy membership removal", ProjectMember, "before_delete", boom),
        ("destination owner membership creation", ProjectMember, "before_insert", boom),
        # fails on the first event written (the removed-membership record)
        ("ownership event insertion", OwnershipEventRecord, "before_insert", boom),
        # fails on the claim event after the removal event and every other write were flushed
        (
            "claim event insertion after other writes",
            OwnershipEventRecord,
            "before_insert",
            boom_on_claim_event,
        ),
    )
    for label, model, hook, listener in steps:
        event.listen(model, hook, listener)
        try:
            with env.sessions() as session:
                with pytest.raises(RuntimeError, match="injected failure"):
                    claim_legacy_project(
                        session,
                        env.settings,
                        actor_email=ADMIN,
                        project_id=target["id"],
                        destination_organization_id=alice.organization_id,
                        reason="atomicity",
                        idempotency_key=f"atomic-{label}",
                    )
                # the failed session is usable again and sees the original state
                assert session.get(Project, target["id"]).organization_id == LEGACY_ORG_ID
                assert {
                    m.user_id
                    for m in session.scalars(
                        select(ProjectMember).where(ProjectMember.project_id == target["id"])
                    )
                } == {LEGACY_USER_ID}
        finally:
            event.remove(model, hook, listener)
        assert database_snapshot(env) == before, label  # nothing persisted, nothing partial
    assert alice.get(f"/v1/projects/{target['id']}").status_code == 404
    # with the failures removed the same claim succeeds, completely
    assert _claim(
        env, project_id=target["id"], destination_organization_id=alice.organization_id
    ).created
    assert alice.get(f"/v1/projects/{target['id']}").status_code == 200
    assert _count(env, OwnershipEventRecord) == 2  # claim + the removed legacy membership


def test_membership_cleanup_is_scoped_to_the_claimed_project_and_never_repeats(world) -> None:
    env, legacy, alice, bob = world
    target, other = legacy["legacy-0"], legacy["legacy-1"]
    first = _claim(env, project_id=target["id"], destination_organization_id=alice.organization_id)
    assert first.created
    with env.sessions() as session:
        owners = session.scalars(
            select(ProjectMember).where(
                ProjectMember.project_id == target["id"], ProjectMember.role == "owner"
            )
        ).all()
        assert [m.user_id for m in owners] == [alice.user_id]  # exactly one owner, no duplicates
        # unrelated legacy projects keep their legacy owner membership
        for project in (other, legacy["frozen-2"]):
            assert [
                m.user_id
                for m in session.scalars(
                    select(ProjectMember).where(ProjectMember.project_id == project["id"])
                )
            ] == [LEGACY_USER_ID]
    snapshot = database_snapshot(env)
    for key in ("claim-1", "claim-2", "claim-3"):  # same key, new key, another new key
        again = _claim(
            env,
            project_id=target["id"],
            destination_organization_id=alice.organization_id,
            idempotency_key=key,
        )
        assert again.created is False
    # a different user or organization cannot take the claimed project
    with pytest.raises(OwnershipDenied) as taken:
        _claim(
            env,
            project_id=target["id"],
            destination_organization_id=bob.organization_id,
            idempotency_key="claim-bob",
        )
    assert taken.value.code == "project_not_claimable"
    assert database_snapshot(env) == snapshot  # no duplicate memberships or events, nothing else


def test_a_claimed_project_is_charged_to_the_new_organization_not_the_old_one(
    world, monkeypatch
) -> None:
    """Compute usage is charged to the project's organization (via the worker identity); AI usage to the caller's."""
    from uuid import UUID

    from chemdft_api.auth import require_identity
    from chemdft_api.billing_service import BillingService
    from chemdft_api.context import Identity
    from chemdft_api.contracts.base import EntityReference
    from chemdft_api.main import app
    from chemdft_api.scientific_models import ComputeJobRecord
    from chemdft_api.service_principals import (
        SERVICE_COMPUTE_WORKER,
        ensure_service_principals,
        service_identity_for_work,
    )
    from test_compute_gateway import _energy_spec

    env, legacy, alice, bob = world
    target = legacy["legacy-0"]
    monkeypatch.setattr("chemdft_api.calculation_actions.validate_capability", lambda _s, _t: None)
    app.dependency_overrides[require_identity] = lambda: Identity(LEGACY_USER_ID, LEGACY_ORG_ID)
    try:  # a queued compute job in the legacy project, created under the legacy identity as before
        version = target["version"]
        created = env.client.post(
            f"/v1/projects/{target['id']}/calculations",
            json={
                "structure_version": EntityReference(
                    project_id=UUID(target["id"]),
                    entity_type="structure.version",
                    entity_id=UUID(version),
                ).model_dump(mode="json"),
                "specification": _energy_spec(),
                "idempotency_key": "legacy-calc-1",
            },
        )
        assert created.status_code == 201, created.text
    finally:
        app.dependency_overrides.pop(require_identity, None)
    with env.sessions() as session:
        ensure_service_principals(session)
        job_id = session.scalar(
            select(ComputeJobRecord.id).where(ComputeJobRecord.project_id == target["id"])
        )
        legacy_account = str(
            BillingService(session, Identity(LEGACY_USER_ID, LEGACY_ORG_ID), env.settings)
            .snapshot()
            .billing_account_id
        )
        worker = service_identity_for_work(session, SERVICE_COMPUTE_WORKER, job_id)
        assert (
            str(BillingService(session, worker, env.settings).snapshot().billing_account_id)
            == legacy_account
        )  # before the claim

    _claim(env, project_id=target["id"], destination_organization_id=alice.organization_id)
    alice_account = alice.get("/v1/billing").json()["billing_account_id"]
    with env.sessions() as session:
        worker = service_identity_for_work(session, SERVICE_COMPUTE_WORKER, job_id)
        assert worker.organization_id == alice.organization_id
        charged = str(BillingService(session, worker, env.settings).snapshot().billing_account_id)
    assert (
        charged == alice_account != legacy_account
    )  # compute now follows the new owner, like her AI usage
    # and neither organization's account leaks to the other user
    assert bob.get("/v1/billing").json()["billing_account_id"] not in (
        alice_account,
        legacy_account,
    )


def test_there_is_no_cross_organization_access_for_any_project_kind(world) -> None:
    env, legacy, alice, bob = world
    alice_project = alice.create_project("alice-own")
    candidates = [
        legacy["legacy-0"]["id"],
        legacy["frozen-2"]["id"],
        alice_project["id"],
    ]  # LEGACY, FROZEN, NORMAL
    with (
        env.sessions() as session
    ):  # even real membership rows (e.g. inserted by hand) open nothing
        for project_id in candidates:
            session.add(ProjectMember(project_id=project_id, user_id=bob.user_id, role="owner"))
        session.commit()
    for project_id in candidates:
        assert bob.get(f"/v1/projects/{project_id}").status_code == 404, project_id
    assert [p["id"] for p in bob.get("/v1/projects").json()] == []
    assert bob.get("/v1/me").json()["setup"]["project_count"] == 0


def test_ownership_events_are_append_only_and_have_no_api(world) -> None:
    env, legacy, alice, bob = world
    _claim(
        env, project_id=legacy["legacy-0"]["id"], destination_organization_id=alice.organization_id
    )
    with env.sessions() as session:
        event = session.scalar(select(OwnershipEventRecord))
        event.reason = "rewritten"
        with pytest.raises(ValueError, match="append-only"):
            session.commit()
        session.rollback()
        session.delete(session.scalar(select(OwnershipEventRecord)))
        with pytest.raises(ValueError, match="append-only"):
            session.commit()
        session.rollback()
    assert _count(env, OwnershipEventRecord) == 2
    from chemdft_api.main import app

    assert not [
        r.path
        for r in app.routes
        if "ownership" in getattr(r, "path", "")
        or getattr(r, "path", "").endswith(("/claim", "/claims"))
    ]
    for who in (alice, bob):  # and no HTTP method can reach them
        for method in ("get", "post", "put", "delete"):
            assert getattr(who, method)("/v1/ownership-events").status_code in (404, 405)


def test_the_cli_claims_and_lists_without_touching_anything_else(
    world, monkeypatch, capsys
) -> None:
    env, legacy, alice, bob = world
    monkeypatch.setattr(ownership_cli, "SessionLocal", env.sessions)
    monkeypatch.setattr(ownership_cli, "get_settings", lambda: env.settings)
    with (
        env.sessions() as session
    ):  # a name that looks like reference data is flagged, never reclassified
        session.get(Project, legacy["legacy-1"]["id"]).name = "Phase7Acceptance"
        session.commit()
    assert ownership_cli.main(["list-legacy"]) == 0
    listing = capsys.readouterr().out
    assert listing.count("OPERATOR REVIEW REQUIRED") == 1 and "Phase7Acceptance" in listing
    assert listing.count("LEGACY_LOCAL") == 2 and listing.count("ACCEPTANCE_FROZEN") == 1
    assert "FROZEN (never claimable)" in listing
    arguments = [
        "claim",
        "--actor-email",
        ADMIN,
        "--destination-organization",
        alice.organization_id,
        "--reason",
        "cli",
        "--idempotency-key",
        "cli-1",
    ]
    refused = ownership_cli.main([*arguments, "--project", legacy["frozen-2"]["id"]])
    assert refused == 1 and json.loads(capsys.readouterr().out) == {
        "ok": False,
        "refused": "project_frozen",
    }
    assert ownership_cli.main([*arguments, "--project", legacy["legacy-0"]["id"]]) == 0
    assert json.loads(capsys.readouterr().out)["changed"] is True
    assert ownership_cli.main([*arguments, "--project", legacy["legacy-0"]["id"]]) == 0
    assert json.loads(capsys.readouterr().out)["changed"] is False
    non_admin = [
        "claim",
        "--actor-email",
        "bob@example.test",
        "--destination-organization",
        bob.organization_id,
        "--reason",
        "x",
        "--idempotency-key",
        "cli-2",
        "--project",
        legacy["legacy-1"]["id"],
    ]
    assert ownership_cli.main(non_admin) == 1
    assert json.loads(capsys.readouterr().out)["refused"] == "not_bootstrap_admin"
