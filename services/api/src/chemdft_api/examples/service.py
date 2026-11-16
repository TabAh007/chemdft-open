"""Published reads and a closed, structure-only copy. No inferred public access by UUID."""

import copy
import hashlib
from io import BytesIO
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..context import Identity, ServiceIdentity
from ..contracts.catalog import StructureVersionDetail
from ..contracts.examples import ExampleCopyOutput, ExampleDetail, ExampleSummary
from ..errors import ProjectAccessDenied, ProjectNotFound, ScientificValidationFailed
from ..example_models import ExampleTemplate, ProjectExampleOrigin
from ..models import (
    Membership,
    Organization,
    OrganizationKind,
    Project,
    ProjectKind,
    ProjectMember,
    ProjectRole,
    StoredFile,
    User,
    UserKind,
    new_id,
)
from ..navigator.capabilities import observe
from ..navigator.evaluate import evaluate
from ..navigator.extract import extract
from ..scientific_actions import (
    _provenance_from_version_record,
    _structure_from_record,
    _version_from_record,
)
from ..scientific_models import (
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureRecord,
    StructureVersionRecord,
)
from ..storage import ObjectStore
from .catalog import canonical_json, catalogue, definition, manifest_hash

GRAPH = (
    StoredFile,
    ScientificArtifactRecord,
    StructureRecord,
    ProvenanceRecordRow,
    ProvenanceInputRow,
    StructureVersionRecord,
)


def rows(session: Session, project_id: str):
    return {
        model: session.scalars(
            select(model).where(model.project_id == project_id).order_by(model.id)
        ).all()
        for model in GRAPH
    }


def content_hash(session: Session, project_id: str) -> str:
    records = rows(session, project_id)
    body = {
        model.__tablename__: [
            {column.name: getattr(row, column.name) for column in model.__table__.columns}
            for row in records[model]
        ]
        for model in GRAPH
    }
    return hashlib.sha256(canonical_json(body)).hexdigest()


def verify_template(session: Session, template: ExampleTemplate) -> dict:
    _assert_structure_only(session, template.project_id)
    spec = definition(template.slug)
    project = session.get(Project, template.project_id)
    if (
        not spec
        or not project
        or project.kind != ProjectKind.EXAMPLE_TEMPLATE
        or not template.sealed
        or template.project_id != spec["template_project_id"]
        or template.version != spec["version"]
        or template.manifest_sha256 != manifest_hash(spec)
        or template.content_sha256 != content_hash(session, template.project_id)
    ):
        raise ScientificValidationFailed(
            "Example template integrity check failed; nothing was copied."
        )
    return spec


def published(session: Session, slug: str) -> ExampleTemplate:
    template = session.scalar(
        select(ExampleTemplate)
        .join(Project, Project.id == ExampleTemplate.project_id)
        .where(
            ExampleTemplate.slug == slug,
            ExampleTemplate.published.is_(True),
            ExampleTemplate.sealed.is_(True),
            Project.kind == ProjectKind.EXAMPLE_TEMPLATE,
        )
    )
    if template is None:
        raise ProjectNotFound("Example not found.")
    return template


def summary(session: Session, template: ExampleTemplate) -> ExampleSummary:
    spec = verify_template(session, template)
    version = session.get(StructureVersionRecord, template.structure_version_id)
    return ExampleSummary(
        **{
            field: spec[field]
            for field in (
                "slug",
                "title",
                "formula",
                "type",
                "template_project_id",
                "source",
                "source_identifier",
                "source_url",
                "source_sha256",
                "citation",
                "citation_url",
                "reuse_basis",
                "licence_url",
                "review_date",
                "space_group",
                "description",
                "related_context",
            )
        },
        template_version=template.version,
        atom_count=version.atom_count,
    )


def list_examples(session: Session) -> tuple[ExampleSummary, ...]:
    templates = session.scalars(
        select(ExampleTemplate)
        .join(Project, Project.id == ExampleTemplate.project_id)
        .where(
            ExampleTemplate.published.is_(True),
            ExampleTemplate.sealed.is_(True),
            Project.kind == ProjectKind.EXAMPLE_TEMPLATE,
        )
        .order_by(ExampleTemplate.slug)
    ).all()
    order = {spec["slug"]: index for index, spec in enumerate(catalogue())}
    return tuple(
        summary(session, template)
        for template in sorted(templates, key=lambda t: order.get(t.slug, len(order)))
    )


def example_navigator(session: Session, slug: str, settings, goal=None):
    template = published(session, slug)
    verify_template(session, template)
    return evaluate(
        extract(session, template.project_id, template.structure_version_id),
        observe(settings),
        can_write=False,
        goal=goal,
        sealed=True,
    )


def detail(session: Session, slug: str, settings) -> ExampleDetail:
    template = published(session, slug)
    metadata = summary(session, template)
    version = session.get(StructureVersionRecord, template.structure_version_id)
    structure = session.get(StructureRecord, version.structure_id)
    return ExampleDetail(
        example=metadata,
        structure=StructureVersionDetail(
            structure=_structure_from_record(structure),
            version=_version_from_record(version),
            diagnostics=tuple(version.diagnostics_json),
            provenance=_provenance_from_version_record(session, version),
        ),
        navigator=example_navigator(session, slug, settings),
    )


def source_bytes(session: Session, slug: str, store: ObjectStore) -> tuple[bytes, str]:
    template = published(session, slug)
    spec = verify_template(session, template)
    version = session.get(StructureVersionRecord, template.structure_version_id)
    artifact = session.scalar(
        select(ScientificArtifactRecord).where(
            ScientificArtifactRecord.id == version.source_artifact_id,
            ScientificArtifactRecord.project_id == template.project_id,
        )
    )
    data = store.get_bytes(artifact.storage_key, 1024 * 1024)
    if hashlib.sha256(data).hexdigest() != spec["source_sha256"]:
        raise ScientificValidationFailed("Example source hash mismatch.")
    return data, spec["source_file"].split("/")[-1]


def _remap(value, mapping):
    if isinstance(value, str):
        return mapping.get(value, value)
    if isinstance(value, list):
        return [_remap(item, mapping) for item in value]
    if isinstance(value, dict):
        return {key: _remap(item, mapping) for key, item in value.items()}
    return copy.deepcopy(value)


def _assert_structure_only(session: Session, project_id: str) -> None:
    # Fail closed on result/evidence/AI additions. Import audit history is not a result.
    from ..database import Base

    allowed = {model.__tablename__ for model in GRAPH} | {
        "example_templates",
        "project_members",
        "audit_events",
        "ownership_events",
        "project_example_origins",
    }
    for table in Base.metadata.sorted_tables:
        if (
            "project_id" in table.c
            and table.name not in allowed
            and session.scalar(
                select(func.count()).select_from(table).where(table.c.project_id == project_id)
            )
        ):
            raise ScientificValidationFailed(
                "This copy path supports structure-only templates; "
                "result/evidence copying is not implemented."
            )


def copy_example(
    session: Session, identity: Identity, slug: str, store: ObjectStore
) -> ExampleCopyOutput:
    if isinstance(identity, ServiceIdentity):
        raise ProjectAccessDenied("Copy requires an authenticated person.")
    user = session.get(User, identity.user_id)
    org = session.get(Organization, identity.organization_id)
    membership = session.scalar(
        select(Membership).where(
            Membership.user_id == identity.user_id,
            Membership.organization_id == identity.organization_id,
        )
    )
    if (
        not user
        or user.disabled_at
        or user.kind not in {UserKind.HUMAN, UserKind.LEGACY_LOCAL}
        or not org
        or org.kind
        not in {OrganizationKind.PERSONAL, OrganizationKind.TEAM, OrganizationKind.LEGACY_LOCAL}
        or not membership
    ):
        raise ProjectAccessDenied(
            "Copy destination must be the caller's authorized current organization."
        )
    template = published(session, slug)
    spec = verify_template(session, template)
    _assert_structure_only(session, template.project_id)
    source = rows(session, template.project_id)
    project_id = new_id()
    mapping = {template.project_id: project_id}
    mapping.update({row.id: new_id() for items in source.values() for row in items})
    object_keys = {}
    created_keys = []
    try:
        session.add(
            Project(
                id=project_id,
                organization_id=org.id,
                name=spec["title"],
                slug=f"{slug}-{project_id[:8]}",
                kind=ProjectKind.NORMAL,
                created_by=user.id,
            )
        )
        session.flush()
        session.add(ProjectMember(project_id=project_id, user_id=user.id, role=ProjectRole.OWNER))
        for artifact in source[ScientificArtifactRecord]:
            data = store.get_bytes(artifact.storage_key, 1024 * 1024)
            if hashlib.sha256(data).hexdigest() != artifact.sha256:
                raise ScientificValidationFailed("Example artifact hash mismatch; copy refused.")
            if artifact.storage_key not in object_keys:
                obj = store.put_raw(project_id, BytesIO(data), 1024 * 1024)
                created_keys.append(obj.key)
                object_keys[artifact.storage_key] = obj.key
        for model in GRAPH:
            for original in source[model]:
                values = {
                    col.name: _remap(getattr(original, col.name), mapping)
                    for col in model.__table__.columns
                }
                # Preserve scientific creators/times/producers; move relational identities only.
                for key in ("storage_key", "object_key"):
                    if key in values:
                        values[key] = object_keys[values[key]]
                if model == StructureVersionRecord:
                    values["idempotency_key"] = f"example-copy:{mapping[original.id]}"
                session.add(model(**values))
            session.flush()
        origin = ProjectExampleOrigin(
            project_id=project_id,
            template_project_id=template.project_id,
            template_version=template.version,
            example_slug=slug,
            template_content_sha256=template.content_sha256,
            copied_by=user.id,
            record_mapping_json=mapping,
        )
        session.add(origin)
        session.commit()
        return ExampleCopyOutput(
            project_id=UUID(project_id),
            organization_id=UUID(org.id),
            template_project_id=UUID(template.project_id),
            template_version=template.version,
            example_slug=slug,
            copied_at=origin.copied_at,
        )
    except BaseException:
        session.rollback()
        for key in created_keys:
            store.delete(key)
        raise
