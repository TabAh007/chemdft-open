from dataclasses import dataclass
from typing import BinaryIO

from sqlalchemy import ColumnElement, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .context import Identity, ServiceIdentity
from .errors import ProjectAccessDenied, ProjectNotFound, ProjectSlugConflict
from .models import Project, ProjectKind, ProjectMember, ProjectRole, ProvenanceClass, StoredFile
from .project_access import ProjectCapability, can
from .schemas import FileRead, ProjectCreate, ProjectRead, ProjectRename
from .storage import ObjectStore


@dataclass(frozen=True)
class SealedProjectAccess:
    role: str
    sealed: bool = True


def project_response(project: Project, role: str) -> ProjectRead:
    return ProjectRead(
        id=project.id,
        organization_id=project.organization_id,
        name=project.name,
        slug=project.slug,
        role=role,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def in_active_organization(identity: Identity) -> ColumnElement[bool]:
    """Tenant boundary for a human caller: the project belongs to the caller's active organization.

    `projects.organization_id` is the project's CURRENT tenant, access and billing organization
    (compute usage is charged to it through the worker's identity; AI usage to the caller's, which
    this check makes the same). There is no cross-organization exception: a project changes tenant
    only by an audited re-home (`ownership_service`), never by an extra membership row.
    """
    return Project.organization_id == identity.organization_id


def authorize_project_access(
    session: Session, identity: Identity, project_id: str
) -> tuple[Project, ProjectMember | SealedProjectAccess]:
    if isinstance(identity, ServiceIdentity):
        project = session.get(Project, project_id)
        if project and project.kind == ProjectKind.EXAMPLE_TEMPLATE:
            raise ProjectAccessDenied("Example templates are sealed.")
        from .service_principals import authorize_service_project_access

        # Machine authorization is separate from human membership: no ProjectMember is involved.
        return authorize_service_project_access(session, identity, project_id)  # type: ignore[return-value]
    row = session.execute(
        select(Project, ProjectMember)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(
            Project.id == project_id,
            in_active_organization(identity),
            ProjectMember.user_id == identity.user_id,
        )
    ).one_or_none()
    if row is None:
        raise ProjectNotFound()
    project, member = row._tuple()
    if project.kind == ProjectKind.EXAMPLE_TEMPLATE:
        return project, SealedProjectAccess(role=member.role)
    return project, member


def list_projects(session: Session, identity: Identity) -> list[ProjectRead]:
    rows = session.execute(
        select(Project, ProjectMember)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(
            in_active_organization(identity),
            ProjectMember.user_id == identity.user_id,
        )
        .order_by(Project.updated_at.desc())
    ).all()
    return [project_response(project, member.role) for project, member in rows]


def create_project(session: Session, identity: Identity, payload: ProjectCreate) -> ProjectRead:
    project = Project(
        organization_id=identity.organization_id,
        name=payload.name,
        slug=payload.slug,
        created_by=identity.user_id,
    )
    try:
        session.add(project)
        session.flush()
        member = ProjectMember(
            project_id=project.id,
            user_id=identity.user_id,
            role=ProjectRole.OWNER,
        )
        session.add(member)
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise ProjectSlugConflict() from error
    session.refresh(project)
    return project_response(project, member.role)


def rename_project(
    session: Session, identity: Identity, project_id: str, payload: ProjectRename
) -> ProjectRead:
    """Change the display name only. The slug is never touched. Writers and owners only."""
    from .models import new_id
    from .scientific_models import AuditEventRecord

    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    previous = project.name
    project.name = payload.name
    session.add(
        AuditEventRecord(
            event_name="project.renamed",
            actor_or_service_id=identity.user_id,
            organization_id=identity.organization_id,
            project_id=project.id,
            request_id=new_id(),
            targets_json=[
                {"project_id": project.id, "entity_type": "project", "entity_id": project.id}
            ],
            outcome="SUCCEEDED",
            artifact_references_json=[],
            safe_metadata_json=[
                {"key": "previous_name", "value": previous[:160]},
                {"key": "new_name", "value": payload.name[:160]},
            ],
        )
    )
    session.commit()
    session.refresh(project)
    return project_response(project, member.role)


def get_project(session: Session, identity: Identity, project_id: str) -> ProjectRead:
    project, member = authorize_project_access(session, identity, project_id)
    return project_response(project, member.role)


def list_project_files(session: Session, identity: Identity, project_id: str) -> list[FileRead]:
    project, _member = authorize_project_access(session, identity, project_id)
    rows = session.scalars(
        select(StoredFile)
        .where(StoredFile.project_id == project.id)
        .order_by(StoredFile.created_at.desc(), StoredFile.id.desc())
        .limit(1000)
    ).all()
    return [FileRead.model_validate(row) for row in rows]


def register_raw_file(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    project_id: str,
    original_name: str | None,
    media_type: str | None,
    stream: BinaryIO,
    max_upload_bytes: int,
    settings=None,
) -> FileRead:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    if settings is not None:
        # Self-signup accounts: smaller per-file limit and a storage total (ADR-045).
        from .account_policy import enforce_upload, upload_limit_bytes

        enforce_upload(session, settings, identity.user_id, None)
        own_limit = upload_limit_bytes(session, settings, identity.user_id)
        max_upload_bytes = min(max_upload_bytes, own_limit)

    stored_object = object_store.put_raw(project.id, stream, max_upload_bytes)
    record = StoredFile(
        project_id=project.id,
        original_name=original_name or "unnamed-source",
        media_type=media_type or "application/octet-stream",
        size_bytes=stored_object.size_bytes,
        sha256=stored_object.sha256,
        object_key=stored_object.key,
        provenance_class=ProvenanceClass.RAW,
        created_by=identity.user_id,
    )
    session.add(record)
    try:
        session.commit()
    except Exception:
        session.rollback()
        object_store.delete(stored_object.key)
        raise
    session.refresh(record)
    return FileRead.model_validate(record)
