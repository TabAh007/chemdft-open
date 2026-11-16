"""PF-0: background processes and webhooks act as service principals, never as a human dev user."""

from __future__ import annotations

import pytest
from chemdft_api.actions import authorize_project_access
from chemdft_api.composition import get_object_store_for_settings
from chemdft_api.context import Identity, ServiceIdentity
from chemdft_api.errors import ProjectNotFound
from chemdft_api.investigation_models import InvestigationRecord
from chemdft_api.knowledge_models import KnowledgeIndexJobRecord
from chemdft_api.models import Membership, Project, ProjectMember, User
from chemdft_api.scientific.engines.interfaces import ExecutionResult
from chemdft_api.scientific_models import (
    AuditEventRecord,
    CalculationAttemptRecord,
    ComputeJobRecord,
    ScientificArtifactRecord,
)
from chemdft_api.service_principals import (
    SERVICE_BILLING_WEBHOOK,
    SERVICE_CAPABILITIES,
    SERVICE_COMPUTE_WORKER,
    SERVICE_EMAIL_DOMAIN,
    SERVICE_INVESTIGATION_WORKER,
    SERVICE_KNOWLEDGE_WORKER,
    SERVICE_USER_IDS,
    SYSTEM_ORGANIZATION_ID,
    ServiceCapability,
    ServiceProjectGrant,
    ensure_service_principals,
    is_registered_service,
    service_identity,
    service_identity_for_work,
)
from sqlalchemy import func, select
from test_compute_gateway import _queued_energy_job


def _project(client, name: str) -> dict:
    return client.post("/v1/projects", json={"name": name, "slug": name}).json()


def test_service_identity_is_not_a_human_identity() -> None:
    worker = service_identity(SERVICE_COMPUTE_WORKER)
    assert isinstance(worker, ServiceIdentity) and isinstance(worker, Identity)
    assert worker.principal_type == "service"
    assert Identity(user_id="u", organization_id="o").principal_type == "user"
    assert worker.user_id == SERVICE_USER_IDS[SERVICE_COMPUTE_WORKER]
    assert worker.organization_id == SYSTEM_ORGANIZATION_ID
    assert is_registered_service(worker)
    # a forged service identity (right name, wrong id, or unknown name) is not registered
    assert not is_registered_service(ServiceIdentity("u", "o", service=SERVICE_COMPUTE_WORKER))
    assert not is_registered_service(ServiceIdentity(worker.user_id, "o", service="not-a-service"))
    with pytest.raises(ValueError):
        service_identity("not-a-service")


def test_service_rows_are_reserved_idempotent_and_never_members(api) -> None:
    _client, sessions, settings = api
    with sessions() as session:
        ensure_service_principals(session)
        ensure_service_principals(session)
        users = {u.id: u for u in session.scalars(select(User)).all()}
        for name, user_id in SERVICE_USER_IDS.items():
            assert users[user_id].email == f"{name}@{SERVICE_EMAIL_DOMAIN}"
            assert users[user_id].display_name == f"Service: {name}"
        # the dev human is a different principal and keeps its own row
        assert (
            settings.dev_user_id in users and settings.dev_user_id not in SERVICE_USER_IDS.values()
        )
        assert (
            session.scalar(
                select(func.count())
                .select_from(Membership)
                .where(Membership.user_id.in_(SERVICE_USER_IDS.values()))
            )
            == 0
        )
        assert (
            session.scalar(
                select(func.count())
                .select_from(ProjectMember)
                .where(ProjectMember.user_id.in_(SERVICE_USER_IDS.values()))
            )
            == 0
        )


def _knowledge_job(session, project_id: str) -> str:
    row = KnowledgeIndexJobRecord(
        project_id=project_id,
        source_entity_id=project_id,
        source_revision="rev-1",
        index_version="v1",
        idempotency_key=f"pf01-{project_id}",
    )
    session.add(row)
    session.flush()
    return row.id


def _investigation(session, project_id: str, user_id: str) -> str:
    row = InvestigationRecord(
        project_id=project_id, title="t", objective="o", created_by=user_id, status="ACTIVE"
    )
    session.add(row)
    session.flush()
    return row.id


def _work(session, project: dict, user_id: str, job_id: str) -> dict[str, str]:
    """One claimable work item of each kind in the project."""
    return {
        SERVICE_COMPUTE_WORKER: job_id,
        SERVICE_KNOWLEDGE_WORKER: _knowledge_job(session, project["id"]),
        SERVICE_INVESTIGATION_WORKER: _investigation(session, project["id"], user_id),
    }


def test_each_service_has_exactly_one_capability_and_the_webhook_no_project_access() -> None:
    assert SERVICE_CAPABILITIES == {
        SERVICE_COMPUTE_WORKER: ServiceCapability.COMPUTE_EXECUTE,
        SERVICE_KNOWLEDGE_WORKER: ServiceCapability.KNOWLEDGE_INDEX,
        SERVICE_INVESTIGATION_WORKER: ServiceCapability.INVESTIGATION_RUN,
        SERVICE_BILLING_WEBHOOK: ServiceCapability.BILLING_WEBHOOK,
    }
    assert len(set(SERVICE_CAPABILITIES.values())) == len(SERVICE_CAPABILITIES)


def test_service_access_is_bound_to_its_own_claimed_work_with_least_privilege(
    api, monkeypatch
) -> None:
    client, sessions, settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "service-access")
    with sessions() as session:
        ensure_service_principals(session)
        work = _work(session, project, settings.dev_user_id, detail["compute_job"]["id"])
        expected_role = {
            SERVICE_COMPUTE_WORKER: "viewer",
            SERVICE_KNOWLEDGE_WORKER: "viewer",
            SERVICE_INVESTIGATION_WORKER: "editor",  # the only service that edits project records
        }
        for service, work_id in work.items():
            identity = service_identity_for_work(session, service, work_id)
            found, grant = authorize_project_access(session, identity, project["id"])
            assert found.id == project["id"]
            assert isinstance(grant, ServiceProjectGrant) and not isinstance(grant, ProjectMember)
            assert (grant.role, grant.capability, grant.work_id) == (
                expected_role[service],
                SERVICE_CAPABILITIES[service],
                work_id,
            )
            # organization is attribution, not authority: it is copied from the project
            assert identity.organization_id == project["organization_id"]
        # the machine grant never becomes a stored human membership
        assert (
            session.scalar(
                select(func.count())
                .select_from(ProjectMember)
                .where(ProjectMember.user_id.in_(SERVICE_USER_IDS.values()))
            )
            == 0
        )


def test_a_service_cannot_use_another_services_work_or_authority(api, monkeypatch) -> None:
    client, sessions, settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "service-isolation")
    with sessions() as session:
        ensure_service_principals(session)
        work = _work(session, project, settings.dev_user_id, detail["compute_job"]["id"])
        services = list(work)
        for actor in services:
            for owner in services:
                if actor == owner:
                    continue
                # `actor` presents work that belongs to `owner`'s capability: the work id does not
                # exist in the kind `actor` is allowed to touch, so it reaches no project.
                borrowed = service_identity(actor).for_work(
                    work[owner], project["id"], project["organization_id"]
                )
                with pytest.raises(ProjectNotFound):
                    authorize_project_access(session, borrowed, project["id"])
        # the webhook has no project access at all, whatever work it claims to hold
        for work_id in work.values():
            webhook = service_identity(SERVICE_BILLING_WEBHOOK).for_work(
                work_id, project["id"], project["organization_id"]
            )
            with pytest.raises(ProjectNotFound):
                authorize_project_access(session, webhook, project["id"])


def test_knowing_a_project_id_is_not_enough_for_a_service(api, monkeypatch) -> None:
    client, sessions, settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "service-needs-work")
    other = _project(client, "service-other-project")
    with sessions() as session:
        ensure_service_principals(session)
        work = _work(session, project, settings.dev_user_id, detail["compute_job"]["id"])
        good = service_identity_for_work(
            session, SERVICE_COMPUTE_WORKER, work[SERVICE_COMPUTE_WORKER]
        )
        denied = (
            (service_identity(SERVICE_COMPUTE_WORKER), project["id"]),  # no claimed work
            (good, other["id"]),  # claimed work belongs to a different project
            (good, "2" * 36),  # no such project
            (good.for_work("3" * 36, project["id"], project["organization_id"]), project["id"]),
            # forged registration: right name, wrong reserved id
            (
                ServiceIdentity(
                    "1" * 36,
                    good.organization_id,
                    SERVICE_COMPUTE_WORKER,
                    good.work_id,
                    project["id"],
                ),
                project["id"],
            ),
            (
                ServiceIdentity(
                    good.user_id, good.organization_id, "forged", good.work_id, project["id"]
                ),
                project["id"],
            ),
        )
        for identity, project_id in denied:
            with pytest.raises(ProjectNotFound):
                authorize_project_access(session, identity, project_id)
        # the same identity works for exactly its own project
        assert authorize_project_access(session, good, project["id"])[0].id == project["id"]
        # a human who is not a member still gets nothing from a service-shaped work id
        stranger = Identity(user_id="9" * 36, organization_id=project["organization_id"])
        with pytest.raises(ProjectNotFound):
            authorize_project_access(session, stranger, project["id"])


def test_a_client_cannot_impersonate_a_service_through_identity_headers(api) -> None:
    client, sessions, settings = api
    with sessions() as session:
        ensure_service_principals(session)
    service_id = SERVICE_USER_IDS[SERVICE_COMPUTE_WORKER]
    # test-mode header override: a service has no organization membership, so it cannot be assumed
    spoofed = client.get(
        "/v1/projects",
        headers={
            "X-ChemDFT-User-ID": service_id,
            "X-ChemDFT-Organization-ID": SYSTEM_ORGANIZATION_ID,
        },
    )
    assert spoofed.status_code == 403
    # without the override (the non-test dev behaviour) any foreign identity header is refused
    settings.dev_identity_header_override_enabled = False
    try:
        for headers in (
            {"X-ChemDFT-User-ID": service_id},
            {"X-ChemDFT-Organization-ID": SYSTEM_ORGANIZATION_ID},
        ):
            refused = client.get("/v1/projects", headers=headers)
            assert refused.status_code == 403
            assert "resolved by the server" in refused.json()["detail"]
        assert client.get("/v1/projects").status_code == 200
    finally:
        settings.dev_identity_header_override_enabled = True


def test_compute_worker_acts_as_its_service_principal_inside_the_project_org(
    api, monkeypatch
) -> None:
    from chemdft_api.calculation_actions import process_next_compute_job

    client, sessions, settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "service-compute")
    job_id = detail["compute_job"]["id"]

    class CrashingProvider:
        def __init__(self, _settings) -> None:
            pass

        def execute(self, **_kwargs) -> ExecutionResult:
            return ExecutionResult(
                exit_code=1,
                timed_out=False,
                stdout=b"",
                stderr=b"engine crashed",
                engine_log=b"",
                result_document=None,
            )

    monkeypatch.setattr("chemdft_api.calculation_actions.LocalComputeProvider", CrashingProvider)
    with sessions() as session:
        ensure_service_principals(session)
        finished = process_next_compute_job(
            session,
            service_identity(SERVICE_COMPUTE_WORKER),
            get_object_store_for_settings(settings),
            settings,
        )
        assert finished is not None and finished.calculation.state == "FAILED"

        service_id = SERVICE_USER_IDS[SERVICE_COMPUTE_WORKER]
        job = session.get(ComputeJobRecord, job_id)
        # who asked is preserved: the job was submitted by the human, not rewritten to the worker
        assert job.submitted_by == settings.dev_user_id
        artifacts = session.scalars(select(ScientificArtifactRecord)).all()
        worker_artifacts = [a for a in artifacts if a.created_by == service_id]
        assert worker_artifacts, (
            "the worker's engine log must be attributed to its service principal"
        )
        assert all(a.created_by != settings.dev_user_id for a in worker_artifacts)
        audit = session.scalars(
            select(AuditEventRecord).where(AuditEventRecord.event_name == "compute.lease.issued")
        ).all()
        assert [(a.actor_or_service_id, a.organization_id) for a in audit] == [
            (service_id, project["organization_id"])
        ]
        # the project and its membership are untouched by the worker
        assert session.get(Project, project["id"]).organization_id == project["organization_id"]
        assert session.scalars(select(CalculationAttemptRecord)).all()


def test_billing_webhook_acts_as_a_service_principal_and_stays_idempotent(api) -> None:
    client, sessions, settings = api
    event = {
        "id": "evt_pf0_service",
        "type": "invoice.unknown",
        "created": 1_800_000_000,
        "data": {"object": {}},
    }
    first = client.post("/v1/billing/webhooks/stripe", json=event)
    duplicate = client.post("/v1/billing/webhooks/stripe", json=event)
    assert first.status_code == 200 and duplicate.status_code == 200
    with sessions() as session:
        # the service rows now exist, and the dev human is not what the webhook ran as
        assert session.get(User, SERVICE_USER_IDS[SERVICE_BILLING_WEBHOOK]) is not None
        assert session.get(User, settings.dev_user_id) is not None
