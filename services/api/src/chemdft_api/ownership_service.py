"""Legacy project ownership: the audited, atomic claim operation.

`projects.organization_id` is a project's current tenant, access and billing organization, so a
claim re-homes the project to the claimant's personal organization, gives that organization's owner
the OWNER membership and removes the memberships that no longer confer access. The original
organization and every removed membership are kept in append-only ownership events. A claim never
touches historical provenance (`created_by`, `submitted_by`, producers, audit rows, scientific
records). It is reachable only through the operator CLI (`ownership_cli`), never an HTTP route, and
only for an explicitly configured bootstrap administrator.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .identity_service import AUTH_PROVIDER
from .models import (
    Membership,
    Organization,
    OrganizationKind,
    OrganizationRole,
    OwnershipEventRecord,
    OwnershipEventType,
    Project,
    ProjectKind,
    ProjectMember,
    ProjectRole,
    User,
    UserIdentity,
    UserKind,
)


class OwnershipDenied(Exception):
    """The operation is refused. `code` is stable; nothing is written."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ClaimResult:
    created: bool  # False when the request was an exact repeat (idempotent no-op)
    event: OwnershipEventRecord | None
    project: Project
    subject: User


def configured_admin_emails(settings: Settings) -> frozenset[str]:
    return frozenset(
        part.strip().lower() for part in settings.bootstrap_admin_emails.split(",") if part.strip()
    )


def _active_human(session: Session, user: User | None, code: str) -> User:
    """A real, enabled person who has authenticated through the identity provider."""
    if user is None or user.kind != UserKind.HUMAN or user.disabled_at is not None:
        raise OwnershipDenied(code)
    linked = session.scalar(
        select(UserIdentity.id).where(
            UserIdentity.user_id == user.id, UserIdentity.provider == AUTH_PROVIDER
        )
    )
    if linked is None:
        raise OwnershipDenied(code)
    return user


def authorize_bootstrap_admin(session: Session, settings: Settings, actor_email: str) -> User:
    """The bootstrap administrator is exactly a configured email of a real HUMAN account."""
    email = actor_email.strip().lower()
    if email not in configured_admin_emails(settings):
        raise OwnershipDenied("not_bootstrap_admin")
    user = session.scalar(select(User).where(User.email == email))
    return _active_human(session, user, "not_bootstrap_admin")


def _destination_user(session: Session, organization_id: str) -> tuple[Organization, User]:
    organization = session.get(Organization, organization_id)
    if organization is None or organization.kind != OrganizationKind.PERSONAL:
        raise OwnershipDenied("destination_not_personal_organization")
    owner_ids = session.scalars(
        select(Membership.user_id).where(
            Membership.organization_id == organization.id,
            Membership.role == OrganizationRole.OWNER,
        )
    ).all()
    if len(owner_ids) != 1:
        raise OwnershipDenied("destination_not_personal_organization")
    return organization, _active_human(
        session, session.get(User, owner_ids[0]), "destination_user_invalid"
    )


def claim_legacy_project(
    session: Session,
    settings: Settings,
    *,
    actor_email: str,
    project_id: str,
    destination_organization_id: str,
    reason: str,
    idempotency_key: str,
) -> ClaimResult:
    """Re-home a LEGACY_LOCAL project to the destination personal organization, atomically.

    One transaction changes `projects.organization_id` (and kind, LEGACY_LOCAL -> NORMAL), gives the
    destination organization's owner the OWNER membership, removes the now-stale memberships (each
    recorded as an event), and appends the claim event that keeps the original organization. Any
    failure rolls everything back: no partial state is visible.
    """
    try:
        return _claim(
            session,
            settings,
            actor_email=actor_email,
            project_id=project_id,
            destination_organization_id=destination_organization_id,
            reason=reason,
            idempotency_key=idempotency_key,
        )
    except BaseException:
        session.rollback()
        raise


def _claim(
    session: Session,
    settings: Settings,
    *,
    actor_email: str,
    project_id: str,
    destination_organization_id: str,
    reason: str,
    idempotency_key: str,
) -> ClaimResult:
    if not idempotency_key.strip() or not reason.strip():
        raise OwnershipDenied("reason_and_idempotency_key_required")
    actor = authorize_bootstrap_admin(session, settings, actor_email)
    project = session.get(Project, project_id)
    if project is None:
        raise OwnershipDenied("project_not_found")
    if project.kind == ProjectKind.ACCEPTANCE_FROZEN:
        raise OwnershipDenied("project_frozen")  # never re-homed, whatever else is true
    destination, subject = _destination_user(session, destination_organization_id)

    previous = session.scalar(
        select(OwnershipEventRecord).where(OwnershipEventRecord.idempotency_key == idempotency_key)
    )
    if previous is not None:
        same = (
            previous.project_id == project.id
            and previous.subject_user_id == subject.id
            and previous.destination_organization_id == destination.id
            and previous.actor_user_id == actor.id
        )
        if not same:
            raise OwnershipDenied("idempotency_key_conflict")
        return ClaimResult(False, previous, project, subject)

    member = session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id, ProjectMember.user_id == subject.id
        )
    )
    if (
        project.organization_id == destination.id
        and member is not None
        and member.role == ProjectRole.OWNER
    ):
        return ClaimResult(False, None, project, subject)  # already in the requested state
    if project.kind != ProjectKind.LEGACY_LOCAL:
        raise OwnershipDenied("project_not_claimable")
    conflicting_slug = session.scalar(
        select(Project.id).where(
            Project.organization_id == destination.id,
            Project.slug == project.slug,
            Project.id != project.id,
        )
    )
    if conflicting_slug is not None:
        raise OwnershipDenied("destination_slug_conflict")

    source_organization_id = project.organization_id
    previous_role = member.role if member is not None else None
    project.organization_id = destination.id
    project.kind = ProjectKind.NORMAL
    reason_text = reason.strip()[:500]
    key = idempotency_key.strip()[:200]
    # `project_members` is current access state. Every other member belonged to the old (legacy)
    # ownership context and no longer reaches the project in its new organization, so those rows are
    # removed here, in the same transaction, each one preserved as an ownership event.
    stale = session.scalars(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id, ProjectMember.user_id != subject.id
        )
    ).all()
    for old_member in stale:
        session.add(
            OwnershipEventRecord(
                project_id=project.id,
                event_type=OwnershipEventType.MEMBERSHIP_REMOVED,
                actor_user_id=actor.id,
                subject_user_id=old_member.user_id,
                source_organization_id=source_organization_id,
                destination_organization_id=destination.id,
                previous_role=old_member.role,
                new_role=None,
                reason=reason_text,
                idempotency_key=f"{key}:removed:{old_member.user_id}"[:200],
            )
        )
        session.delete(old_member)
    if member is None:
        session.add(
            ProjectMember(project_id=project.id, user_id=subject.id, role=ProjectRole.OWNER)
        )
    else:
        member.role = ProjectRole.OWNER
    event = OwnershipEventRecord(
        project_id=project.id,
        event_type=OwnershipEventType.LEGACY_CLAIM_GRANTED,
        actor_user_id=actor.id,
        subject_user_id=subject.id,
        source_organization_id=source_organization_id,
        destination_organization_id=destination.id,
        previous_role=previous_role,
        new_role=ProjectRole.OWNER,
        reason=reason_text,
        idempotency_key=key,
    )
    session.add(event)
    session.commit()
    return ClaimResult(True, event, project, subject)
