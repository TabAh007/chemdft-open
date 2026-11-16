"""The single place that says what a project role may do.

Capabilities, not roles, are what actions ask for. Every role check in the API goes through `can` /
`require_capability`, so changing a role's rights is one edit here, and a test asserts that no
action module compares roles on its own.

READ    see the project and its records.
WRITE   change scientific project content: imports, uploads, calculations, spectrum processing and
        comparison, investigations, approvals, knowledge indexing.
MANAGE  ownership and administration of the project itself (membership, rename, archive). No
        HTTP route needs it yet (the API has no rename/delete/member endpoints); the ownership
        service uses it.

A machine grant (`ServiceProjectGrant`) carries a role too, so services use the same mapping.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Protocol

from .errors import ProjectAccessDenied
from .models import ProjectRole


class ProjectCapability(StrEnum):
    READ = "read"
    WRITE = "write"
    MANAGE = "manage"


ROLE_CAPABILITIES: dict[str, frozenset[ProjectCapability]] = {
    ProjectRole.OWNER: frozenset(
        {ProjectCapability.READ, ProjectCapability.WRITE, ProjectCapability.MANAGE}
    ),
    ProjectRole.EDITOR: frozenset({ProjectCapability.READ, ProjectCapability.WRITE}),
    ProjectRole.VIEWER: frozenset({ProjectCapability.READ}),
}


class HasRole(Protocol):
    role: str


# Test hook: when a list, every capability decision is appended to it so an audit can prove that a
# route consulted the central mapping. None (the default) costs nothing.
AUDIT_LOG: list[tuple[ProjectCapability, str, bool]] | None = None


def can(member: HasRole, capability: ProjectCapability) -> bool:
    """Whether this membership or service grant allows the capability (unknown roles: nothing)."""
    allowed = capability in ROLE_CAPABILITIES.get(str(member.role), frozenset()) and (
        not getattr(member, "sealed", False) or capability == ProjectCapability.READ
    )
    if AUDIT_LOG is not None:
        AUDIT_LOG.append((capability, str(member.role), allowed))
    return allowed


def require_capability(member: HasRole, capability: ProjectCapability) -> None:
    if not can(member, capability):
        raise ProjectAccessDenied()
