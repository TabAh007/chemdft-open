from sqlalchemy.orm import Session

from ..actions import authorize_project_access
from ..config import Settings
from ..context import Identity, ServiceIdentity
from ..contracts.navigator import GoalId, NavigatorState
from ..errors import ProjectAccessDenied
from ..models import ProjectKind
from ..project_access import ProjectCapability, can, require_capability
from .capabilities import observe
from .evaluate import evaluate
from .extract import extract


def get_navigator(
    session: Session,
    identity: Identity,
    project_id: str,
    settings: Settings,
    *,
    goal: GoalId | None = None,
    structure_version_id: str | None = None,
    provider_preference: str = "AUTO",
) -> NavigatorState:
    # A worker's work-item grant is not blanket permission to aggregate all project records.
    if isinstance(identity, ServiceIdentity):
        raise ProjectAccessDenied("Project Navigator requires a human project membership.")
    project, member = authorize_project_access(session, identity, project_id)
    require_capability(member, ProjectCapability.READ)
    facts = extract(session, project_id, structure_version_id)
    capabilities = (
        observe(settings)
        if provider_preference == "AUTO"
        else observe(settings, provider_preference=provider_preference)
    )
    return evaluate(
        facts, capabilities, can_write=can(member, ProjectCapability.WRITE), goal=goal,
        sealed=project.kind == ProjectKind.EXAMPLE_TEMPLATE,
    )
