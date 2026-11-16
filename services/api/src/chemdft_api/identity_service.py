"""Map an authenticated external subject to a ChemDFT human user and personal organization."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .account_models import AccountAuditEvent, AccountProfile
from .actions import in_active_organization
from .context import Identity
from .jwt_auth import VerifiedToken
from .models import (
    Membership,
    Organization,
    OrganizationKind,
    OrganizationRole,
    Project,
    ProjectMember,
    User,
    UserIdentity,
    UserKind,
)
from .schemas import MeOrganization, MeRead, MeSetup

AUTH_PROVIDER = "better-auth"


class IdentityDenied(Exception):
    """A valid token that must not become a ChemDFT identity. `code` is stable and client-safe."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ResolvedHuman:
    identity: Identity
    user: User


def _display_name(token: VerifiedToken) -> str:
    return (token.name or token.email.split("@", 1)[0])[:160]


def active_organization_id(session: Session, user_id: str) -> str | None:
    """The user's personal organization (the active one until teams exist), else None."""
    return session.scalar(
        select(Organization.id)
        .join(Membership, Membership.organization_id == Organization.id)
        .where(Membership.user_id == user_id, Organization.kind == OrganizationKind.PERSONAL)
        .order_by(Organization.created_at)
        .limit(1)
    )


def _parse_time(value: str | None):
    from datetime import datetime

    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


def provision_human(session: Session, token: VerifiedToken) -> User:
    """Create the ChemDFT user, personal organization and owner membership for a new subject.

    An email that already belongs to another ChemDFT user is never auto-linked: that would let a new
    external account take over an existing one.
    """
    if session.scalar(select(User.id).where(User.email == token.email)) is not None:
        raise IdentityDenied("account_not_available")
    user = User(email=token.email, display_name=_display_name(token), kind=UserKind.HUMAN)
    session.add(user)
    session.flush()
    organization = Organization(
        name=f"{_display_name(token)}'s workspace"[:160], kind=OrganizationKind.PERSONAL
    )
    session.add(organization)
    session.flush()
    session.add(
        Membership(organization_id=organization.id, user_id=user.id, role=OrganizationRole.OWNER)
    )
    session.add(UserIdentity(user_id=user.id, provider=AUTH_PROVIDER, subject=token.subject))
    session.flush()
    if token.self_signup:
        from .models import utc_now

        session.add(
            AccountProfile(
                user_id=user.id,
                signup_source="SELF_SIGNUP",
                email_verified_at=utc_now() if token.email_verified else None,
                terms_version=token.terms_version,
                terms_accepted_at=_parse_time(token.terms_accepted_at),
            )
        )
        session.add(
            AccountAuditEvent(event="signup_provisioned", user_id=user.id, outcome="SUCCEEDED")
        )
        session.flush()
    return user


def resolve_human_identity(
    session: Session, token: VerifiedToken, *, signup_open: bool = False
) -> ResolvedHuman:
    def lookup() -> User | None:
        return session.scalar(
            select(User)
            .join(UserIdentity, UserIdentity.user_id == User.id)
            .where(UserIdentity.provider == AUTH_PROVIDER, UserIdentity.subject == token.subject)
        )

    user = lookup()
    if user is None:
        if token.self_signup and not signup_open:
            session.add(
                AccountAuditEvent(
                    event="signup_provisioned", outcome="REFUSED", reason="signup_closed"
                )
            )
            session.commit()
            raise IdentityDenied("signup_closed")
        try:
            user = provision_human(session, token)
            session.commit()
        except IntegrityError:  # a concurrent first request provisioned the same subject
            session.rollback()
            user = lookup()
            if user is None:
                raise IdentityDenied("account_not_available") from None
    if user.kind != UserKind.HUMAN:
        # A browser session can never act as a service or the legacy local principal.
        raise IdentityDenied("principal_not_human")
    if user.disabled_at is not None:
        raise IdentityDenied("account_disabled")
    if token.email_verified:
        profile = session.get(AccountProfile, user.id)
        if profile is not None and profile.email_verified_at is None:
            from .models import utc_now

            profile.email_verified_at = utc_now()
            session.commit()
    organization_id = active_organization_id(session, user.id)
    if organization_id is None:
        raise IdentityDenied("no_organization")
    return ResolvedHuman(Identity(user_id=user.id, organization_id=organization_id), user)


def build_me(session: Session, identity: Identity, auth_mode: str) -> MeRead:
    """The authenticated caller's product identity (works for both auth modes)."""
    user = session.get(User, identity.user_id)
    organization = session.get(Organization, identity.organization_id)
    membership = session.scalar(
        select(Membership).where(
            Membership.organization_id == identity.organization_id,
            Membership.user_id == identity.user_id,
        )
    )
    if user is None or organization is None or membership is None:
        raise IdentityDenied("no_organization")
    project_count = session.scalar(
        select(func.count())
        .select_from(ProjectMember)
        .join(Project, Project.id == ProjectMember.project_id)
        .where(ProjectMember.user_id == user.id, in_active_organization(identity))
    )
    return MeRead(
        id=user.id,
        display_name=user.display_name,
        email=user.email,
        kind=user.kind,
        auth_mode=auth_mode,
        organization=MeOrganization(
            id=organization.id,
            name=organization.name,
            kind=organization.kind,
            role=membership.role,
        ),
        setup=MeSetup(
            has_personal_organization=organization.kind == OrganizationKind.PERSONAL,
            project_count=int(project_count or 0),
        ),
    )
