"""Machine identities for ChemDFT background processes and webhook receivers.

A worker is not a person: it holds no human user id, membership or role. Each service has a
reserved row in `users` (so existing `created_by` foreign keys stay valid), a reserved email under
the non-routable `service.chemdft.invalid` domain, and exactly one capability:

| service              | capability         | project access                                       |
|----------------------|--------------------|------------------------------------------------------|
| compute-worker       | COMPUTE_EXECUTE    | read-level, only for a compute job it was given      |
| knowledge-worker     | KNOWLEDGE_INDEX    | read-level, only for a knowledge index job           |
| investigation-worker | INVESTIGATION_RUN  | editor-level, only for an investigation              |
| billing-webhook      | BILLING_WEBHOOK    | none (no project access of any kind)                 |

A service never has standing access to a project. Its `ServiceIdentity` is bound to one work item
and the project that item belongs to; `authorize_service_project_access` re-verifies in the
database that the item exists, is of the kind the service's capability allows, and belongs to the
requested project. Knowing a project id is not enough, and one service's work cannot be used by
another service. No synthetic `ProjectMember` is ever created: human membership stays separate.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy import select
from sqlalchemy.orm import Session

from .context import ServiceIdentity
from .models import Organization, OrganizationKind, Project, ProjectRole, User, UserKind

SERVICE_EMAIL_DOMAIN = "service.chemdft.invalid"
SYSTEM_ORGANIZATION_ID = "00000000-0000-4000-8000-0000000000f0"

SERVICE_COMPUTE_WORKER = "compute-worker"
SERVICE_KNOWLEDGE_WORKER = "knowledge-worker"
SERVICE_INVESTIGATION_WORKER = "investigation-worker"
SERVICE_BILLING_WEBHOOK = "billing-webhook"

SERVICE_USER_IDS: dict[str, str] = {
    SERVICE_COMPUTE_WORKER: "00000000-0000-4000-8000-0000000000f1",
    SERVICE_KNOWLEDGE_WORKER: "00000000-0000-4000-8000-0000000000f2",
    SERVICE_INVESTIGATION_WORKER: "00000000-0000-4000-8000-0000000000f3",
    SERVICE_BILLING_WEBHOOK: "00000000-0000-4000-8000-0000000000f4",
}


class ServiceCapability(StrEnum):
    COMPUTE_EXECUTE = "compute.execute"
    KNOWLEDGE_INDEX = "knowledge.index"
    INVESTIGATION_RUN = "investigation.run"
    BILLING_WEBHOOK = "billing.webhook"


SERVICE_CAPABILITIES: dict[str, ServiceCapability] = {
    SERVICE_COMPUTE_WORKER: ServiceCapability.COMPUTE_EXECUTE,
    SERVICE_KNOWLEDGE_WORKER: ServiceCapability.KNOWLEDGE_INDEX,
    SERVICE_INVESTIGATION_WORKER: ServiceCapability.INVESTIGATION_RUN,
    SERVICE_BILLING_WEBHOOK: ServiceCapability.BILLING_WEBHOOK,
}

# The project role each capability is granted *on its own work item*. Absent = no project access.
_PROJECT_ROLE: dict[ServiceCapability, ProjectRole] = {
    ServiceCapability.COMPUTE_EXECUTE: ProjectRole.VIEWER,
    ServiceCapability.KNOWLEDGE_INDEX: ProjectRole.VIEWER,
    ServiceCapability.INVESTIGATION_RUN: ProjectRole.EDITOR,
}


@dataclass(frozen=True)
class ServiceProjectGrant:
    """What a service may do in a project; the machine counterpart of a human `ProjectMember`."""

    project_id: str
    user_id: str
    role: ProjectRole
    capability: ServiceCapability
    work_id: str


def service_identity(
    service: str, organization_id: str = SYSTEM_ORGANIZATION_ID
) -> ServiceIdentity:
    if service not in SERVICE_USER_IDS:
        raise ValueError(f"Unknown service principal: {service!r}")
    return ServiceIdentity(
        user_id=SERVICE_USER_IDS[service], organization_id=organization_id, service=service
    )


def is_registered_service(identity: ServiceIdentity) -> bool:
    return SERVICE_USER_IDS.get(identity.service) == identity.user_id


def _work_project_id(session: Session, capability: ServiceCapability, work_id: str) -> str | None:
    """The project a work item of this capability's kind belongs to, if the item exists."""
    from .investigation_models import InvestigationRecord
    from .knowledge_models import KnowledgeIndexJobRecord
    from .scientific_models import ComputeJobRecord

    model = {
        ServiceCapability.COMPUTE_EXECUTE: ComputeJobRecord,
        ServiceCapability.KNOWLEDGE_INDEX: KnowledgeIndexJobRecord,
        ServiceCapability.INVESTIGATION_RUN: InvestigationRecord,
    }.get(capability)
    if model is None:
        return None
    return session.scalar(select(model.project_id).where(model.id == work_id))


def service_identity_for_work(session: Session, service: str, work_id: str) -> ServiceIdentity:
    """Bind a service to the work item it has claimed. Org is attribution only, never authority."""
    identity = service_identity(service)
    project_id = _work_project_id(session, SERVICE_CAPABILITIES[service], work_id)
    project = session.get(Project, project_id) if project_id else None
    if project is None:
        return identity  # no resolvable work: the identity is valid but can reach no project
    return identity.for_work(work_id, project.id, project.organization_id)


def authorize_service_project_access(
    session: Session, identity: ServiceIdentity, project_id: str
) -> tuple[Project, ServiceProjectGrant]:
    from .errors import ProjectNotFound

    capability = SERVICE_CAPABILITIES.get(identity.service)
    role = _PROJECT_ROLE.get(capability) if capability else None
    if (
        capability is None
        or role is None
        or not is_registered_service(identity)
        or identity.work_id is None
        or identity.work_project_id != project_id
        or _work_project_id(session, capability, identity.work_id) != project_id
    ):
        raise ProjectNotFound()
    project = session.get(Project, project_id)
    if project is None:
        raise ProjectNotFound()
    return project, ServiceProjectGrant(
        project_id=project.id,
        user_id=identity.user_id,
        role=role,
        capability=capability,
        work_id=identity.work_id,
    )


def ensure_service_principals(session: Session) -> None:
    """Idempotently create the reserved system organization and service rows."""
    if session.get(Organization, SYSTEM_ORGANIZATION_ID) is None:
        session.add(
            Organization(
                id=SYSTEM_ORGANIZATION_ID,
                name="ChemDFT system services",
                kind=OrganizationKind.SYSTEM,
            )
        )
    for name, user_id in SERVICE_USER_IDS.items():
        if session.get(User, user_id) is None:
            session.add(
                User(
                    id=user_id,
                    email=f"{name}@{SERVICE_EMAIL_DOMAIN}",
                    display_name=f"Service: {name}",
                    kind=UserKind.SERVICE,
                )
            )
    session.commit()
