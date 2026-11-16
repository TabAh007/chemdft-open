"""Operator-only create-once/verify seeding. No public seed or publication HTTP route."""

import argparse
import hashlib
from io import BytesIO
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..actions import register_raw_file
from ..config import get_settings
from ..context import Identity
from ..contracts.artifacts import ScientificArtifactRegistration
from ..contracts.base import ArtifactReference
from ..contracts.catalog import StructureImportInput
from ..database import SessionLocal
from ..example_models import ExampleTemplate
from ..models import (
    Membership,
    Organization,
    OrganizationKind,
    Project,
    ProjectKind,
    ProjectMember,
    ProjectRole,
    User,
    UserKind,
)
from ..scientific_actions import import_structure, register_scientific_artifact
from ..scientific_models import ScientificArtifactRecord, StructureVersionRecord
from ..storage import LocalObjectStore, ObjectStore
from .catalog import ROOT, catalogue, manifest_hash
from .service import content_hash, source_bytes, verify_template

SYSTEM_ORG = str(uuid5(NAMESPACE_URL, "chemdft:sealed-examples:organization"))
SEED_USER = str(uuid5(NAMESPACE_URL, "chemdft:sealed-examples:builder"))


def seed_examples(session: Session, store: ObjectStore, *, publish: bool = False) -> list[str]:
    if session.get(Organization, SYSTEM_ORG) is None:
        session.add(
            Organization(
                id=SYSTEM_ORG, name="ChemDFT reference examples", kind=OrganizationKind.SYSTEM
            )
        )
        session.flush()
    if session.get(User, SEED_USER) is None:
        session.add(
            User(
                id=SEED_USER,
                email="examples-builder@service.chemdft.invalid",
                display_name="ChemDFT reference importer",
                kind=UserKind.SERVICE,
            )
        )
        session.flush()
        session.add(Membership(organization_id=SYSTEM_ORG, user_id=SEED_USER, role="owner"))
    session.commit()
    identity = Identity(SEED_USER, SYSTEM_ORG)
    done = []
    for spec in catalogue():
        data = (ROOT / spec["source_file"]).read_bytes()
        if hashlib.sha256(data).hexdigest() != spec["source_sha256"]:
            raise ValueError("Vetted example source changed; create/review a new manifest version.")
        template = session.get(ExampleTemplate, spec["template_project_id"])
        if template is not None:
            verify_template(session, template)
            version = session.get(StructureVersionRecord, template.structure_version_id)
            for artifact_id in (version.source_artifact_id, version.canonical_artifact_id):
                artifact = session.get(ScientificArtifactRecord, artifact_id)
                stored = store.get_bytes(artifact.storage_key, 1024 * 1024)
                if hashlib.sha256(stored).hexdigest() != artifact.sha256:
                    raise ValueError(
                        "Sealed example artifact changed; never overwrite it in place."
                    )
            if publish and spec["publication_state"] == "PUBLISHED":
                template.published = True
                session.commit()
            done.append(spec["slug"])
            continue
        project = session.get(Project, spec["template_project_id"])
        if project is None:
            project = Project(
                id=spec["template_project_id"],
                organization_id=SYSTEM_ORG,
                name=spec["title"],
                slug=spec["slug"],
                created_by=SEED_USER,
                kind=ProjectKind.NORMAL,
            )
            session.add(project)
            session.flush()
            session.add(
                ProjectMember(project_id=project.id, user_id=SEED_USER, role=ProjectRole.OWNER)
            )
            session.commit()
        elif (
            project.kind != ProjectKind.NORMAL
            or project.organization_id != SYSTEM_ORG
            or project.created_by != SEED_USER
        ):
            raise ValueError("Example project ID collides with non-builder state.")
        artifact = session.scalar(
            select(ScientificArtifactRecord).where(
                ScientificArtifactRecord.project_id == project.id,
                ScientificArtifactRecord.format_identifier
                == f"chemical.{spec['file_format'].lower()}",
            )
        )
        if artifact is None:
            file = register_raw_file(
                session,
                identity,
                store,
                project.id,
                spec["source_file"].split("/")[-1],
                "chemical/x-cif" if spec["type"] == "crystal" else "chemical/x-mdl-sdfile",
                BytesIO(data),
                1024 * 1024,
            )
            registered = register_scientific_artifact(
                session,
                identity,
                ScientificArtifactRegistration(
                    project_id=UUID(project.id),
                    stored_file_id=UUID(file.id),
                    kind="STRUCTURE_FILE",
                    format_identifier=f"chemical.{spec['file_format'].lower()}",
                    format_version="1.0.0",
                ),
            )
            artifact = session.get(ScientificArtifactRecord, str(registered.id))
        imported = import_structure(
            session,
            identity,
            store,
            StructureImportInput(
                project_id=UUID(project.id),
                source_artifact=ArtifactReference(
                    project_id=UUID(project.id),
                    artifact_id=UUID(artifact.id),
                    sha256=artifact.sha256,
                ),
                requested_format=spec["file_format"],
                structure_name=spec["title"],
                idempotency_key=f"example:{spec['slug']}:{spec['version']}",
            ),
        )
        if len(imported.version.coordinates.atoms) != spec["atom_count"]:
            raise ValueError("Example atom-count validation failed.")
        members = session.scalars(
            select(ProjectMember).where(ProjectMember.project_id == project.id)
        ).all()
        for member in members:
            session.delete(member)
        project.kind = ProjectKind.EXAMPLE_TEMPLATE
        template = ExampleTemplate(
            project_id=project.id,
            slug=spec["slug"],
            version=spec["version"],
            structure_version_id=str(imported.version.id),
            manifest_sha256=manifest_hash(spec),
            content_sha256=content_hash(session, project.id),
            sealed=True,
            published=publish and spec["publication_state"] == "PUBLISHED",
        )
        session.add(template)
        session.commit()
        verify_template(session, template)
        if template.published:
            source_bytes(session, template.slug, store)
        done.append(spec["slug"])
    return done


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build or verify sealed examples from reviewed source files."
    )
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Explicitly publish the manifest's reviewed examples.",
    )
    args = parser.parse_args()
    settings = get_settings()
    with SessionLocal() as session:
        print(
            "Verified examples:",
            ", ".join(
                seed_examples(session, LocalObjectStore(settings.object_root), publish=args.publish)
            ),
        )


if __name__ == "__main__":
    main()
