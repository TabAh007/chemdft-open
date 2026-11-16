from datetime import UTC, datetime
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import ForeignKey, String, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def new_id() -> str:
    return str(uuid4())


def utc_now() -> datetime:
    return datetime.now(UTC)


class OrganizationRole(StrEnum):
    OWNER = "owner"
    MEMBER = "member"


class ProjectRole(StrEnum):
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"


class UserKind(StrEnum):
    """What kind of principal a `users` row is. Never inferred from the email address."""

    HUMAN = "HUMAN"
    SERVICE = "SERVICE"
    LEGACY_LOCAL = "LEGACY_LOCAL"


class OrganizationKind(StrEnum):
    PERSONAL = "PERSONAL"
    TEAM = "TEAM"
    LEGACY_LOCAL = "LEGACY_LOCAL"
    SYSTEM = "SYSTEM"


class ProjectKind(StrEnum):
    """Why a project exists, for ownership policy. Never inferred from names or ids at runtime.

    NORMAL: a user's own project. LEGACY_LOCAL: created before real accounts under the local
    development identity; may be claimed by an authorized administrator, which re-homes it to the
    claimant's personal organization (it then becomes NORMAL; history stays in ownership_events).
    ACCEPTANCE_FROZEN: a regression/acceptance reference project; never claimable, never re-homed,
    never shared. EXAMPLE_TEMPLATE: sealed reference project, never a mutable user project;
    publication is explicit in example_templates, not implied by kind.
    """

    NORMAL = "NORMAL"
    LEGACY_LOCAL = "LEGACY_LOCAL"
    ACCEPTANCE_FROZEN = "ACCEPTANCE_FROZEN"
    EXAMPLE_TEMPLATE = "EXAMPLE_TEMPLATE"


class OwnershipEventType(StrEnum):
    """Closed vocabulary. A claim re-homes a legacy project; copy events come with the examples."""

    LEGACY_CLAIM_GRANTED = "LEGACY_CLAIM_GRANTED"
    # One per membership that stopped conferring access because its project left their organization.
    MEMBERSHIP_REMOVED = "MEMBERSHIP_REMOVED"


class ProvenanceClass(StrEnum):
    RAW = "raw"
    NORMALIZED = "normalized"
    DERIVED = "derived"


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(
        String(16), default=OrganizationKind.TEAM, server_default=OrganizationKind.TEAM
    )
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    display_name: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(
        String(16), default=UserKind.HUMAN, server_default=UserKind.HUMAN
    )
    disabled_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class UserIdentity(Base):
    """Maps an external authentication subject (e.g. a Better Auth user id) to a ChemDFT user.

    The external identity provider owns credentials and sessions; ChemDFT owns the domain user that
    projects, provenance and authorization refer to. Only HUMAN users may be linked.
    """

    __tablename__ = "user_identities"
    __table_args__ = (UniqueConstraint("provider", "subject"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(40))
    subject: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("organization_id", "user_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20), default=OrganizationRole.MEMBER)


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("organization_id", "slug"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160))
    slug: Mapped[str] = mapped_column(String(96))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(
        String(24), default=ProjectKind.NORMAL, server_default=ProjectKind.NORMAL
    )
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20), default=ProjectRole.VIEWER)


class StoredFile(Base):
    __tablename__ = "stored_files"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    original_name: Mapped[str] = mapped_column(String(255))
    media_type: Mapped[str] = mapped_column(String(160))
    size_bytes: Mapped[int]
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    object_key: Mapped[str] = mapped_column(String(255), unique=True)
    provenance_class: Mapped[str] = mapped_column(String(20), default=ProvenanceClass.RAW)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class OwnershipEventRecord(Base):
    """Append-only history of who was given access to a project, and by whom.

    Access ownership is not scientific provenance: these rows never alter `created_by`, producers or
    any scientific record. There is no update or delete path; the ORM rejects both, and no API
    exposes them. Contains no secrets, only ids, roles and the operator's stated reason.
    """

    __tablename__ = "ownership_events"
    __table_args__ = (UniqueConstraint("idempotency_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(32))
    actor_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    subject_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    source_organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    destination_organization_id: Mapped[str | None] = mapped_column(
        ForeignKey("organizations.id"), nullable=True
    )
    previous_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    new_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    reason: Mapped[str] = mapped_column(String(500))
    idempotency_key: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


def _reject_ownership_event_mutation(_mapper: object, _connection: object, target: object) -> None:
    raise ValueError(f"{type(target).__name__} is append-only")


event.listen(OwnershipEventRecord, "before_update", _reject_ownership_event_mutation)
event.listen(OwnershipEventRecord, "before_delete", _reject_ownership_event_mutation)
