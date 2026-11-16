# ruff: noqa: E501
"""Account data export and account deletion (ADR-045).

Export: the caller's own projects only, reached through the same authorized read actions the app uses, so
another account's data cannot appear. Binary uploads are listed (name, size, sha256), not included.

Deletion: irreversible. Content rows of the caller's projects are removed (the project shell stays so
append-only audit/ownership/ledger rows keep their foreign keys), stored objects are deleted, jobs are
cancelled, the identity is anonymised and disabled, ORCID links are removed. Audit rows keep only the
pseudonymous user id. Shared projects (other members) are never purged; only the caller's access ends.
"""

from __future__ import annotations

import contextlib
import io
import json
import zipfile
from datetime import datetime

from sqlalchemy import delete, inspect, select, update
from sqlalchemy.orm import Session

from .account_models import AccountProfile
from .account_policy import audit, get_profile
from .actions import list_project_files, list_projects
from .context import Identity
from .database import Base
from .models import Membership, Organization, Project, ProjectMember, StoredFile, User, utc_now
from .storage import ObjectStore

EXPORT_FORMAT = "chemdft.account-export.v1"
# Append-only history that must keep its foreign keys to the project shell.
KEEP_TABLES = frozenset(
    {
        "projects",
        "project_members",
        "audit_events",
        "ownership_events",
        "ai_usage_ledger_entries",
        "compute_usage_ledger_entries",
    }
)
_TERMINAL = ("SUCCEEDED", "FAILED", "CANCELED")


def _json(value) -> object:
    return json.loads(json.dumps(value, default=_default))


def _default(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    return str(value)


def build_export(session: Session, identity: Identity) -> bytes:
    from .calculation_actions import list_compute_jobs
    from .orcid_models import OrcidLink
    from .result_read_actions import list_results, result_lineage_export
    from .scientific_actions import list_structure_versions, list_structures

    user = session.get(User, identity.user_id)
    profile = get_profile(session, identity.user_id)
    link = session.scalar(select(OrcidLink).where(OrcidLink.user_id == identity.user_id))
    manifest = {
        "format": EXPORT_FORMAT,
        "generated_at": utc_now().isoformat(),
        "contains": [
            "account",
            "projects",
            "files (metadata only)",
            "structures and versions",
            "compute jobs",
            "results with provenance lineage",
        ],
        "excludes": [
            "other accounts' data",
            "passwords, sessions and tokens",
            "uploaded file bytes",
            "audit events (kept by ChemDFT without personal data)",
        ],
    }
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:

        def put(name: str, value: object) -> None:
            bundle.writestr(name, json.dumps(_json(value), indent=2, sort_keys=True))

        put("manifest.json", manifest)
        put(
            "account.json",
            {
                "id": user.id,
                "email": user.email,
                "display_name": user.display_name,
                "created_at": user.created_at,
                "orcid_id": link.orcid_id if link else None,
                "terms_version": profile.terms_version if profile else None,
                "terms_accepted_at": profile.terms_accepted_at if profile else None,
            },
        )
        for project in list_projects(session, identity):
            base = f"projects/{project.id}"
            put(f"{base}/project.json", project)
            put(f"{base}/files.json", list_project_files(session, identity, project.id))
            structures = list_structures(session, identity, project.id)
            put(f"{base}/structures.json", structures)
            for structure in structures:
                put(
                    f"{base}/structure-versions-{structure.id}.json",
                    list_structure_versions(session, identity, project.id, str(structure.id)),
                )
            put(f"{base}/jobs.json", list_compute_jobs(session, identity, project.id))
            results = list_results(session, identity, project.id)
            put(f"{base}/results.json", results)
            for result in results:
                put(
                    f"{base}/result-lineage-{result.id}.json",
                    result_lineage_export(session, identity, project.id, str(result.id)),
                )
    audit(session, "account_export", identity.user_id, "SUCCEEDED")
    return archive.getvalue()


def _purge_project_content(session: Session, project_ids: list[str]) -> None:
    """Delete every project-scoped content row, retrying in a savepoint until foreign keys allow it."""
    tables = [
        t
        for t in reversed(Base.metadata.sorted_tables)
        if "project_id" in t.c and t.name not in KEEP_TABLES
    ]
    present = inspect(session.connection())
    pending = [t for t in tables if present.has_table(t.name)]
    for _ in range(len(tables) + 3):
        if not pending:
            return
        still = []
        for table in pending:
            nested = session.begin_nested()
            try:
                session.execute(delete(table).where(table.c.project_id.in_(project_ids)))
                nested.commit()
            except Exception:
                nested.rollback()
                still.append(table)
        if len(still) == len(pending):
            break
        pending = still
    if pending:
        raise RuntimeError("account purge incomplete: " + ", ".join(t.name for t in pending))


def delete_account(
    session: Session, object_store: ObjectStore, identity: Identity, confirm_email: str
) -> dict:
    from .orcid_models import OrcidAuthState, OrcidLink
    from .scientific_models import ComputeJobRecord, ScientificArtifactRecord

    user = session.get(User, identity.user_id)
    if user is None or confirm_email.strip().lower() != user.email.lower():
        audit(session, "account_delete", identity.user_id, "REFUSED", "confirmation_mismatch")
        raise ValueError("confirmation_mismatch")
    user_id = user.id
    owned = [
        row.id
        for row in session.scalars(select(Project).where(Project.created_by == user_id))
        if not session.scalar(
            select(ProjectMember.id).where(
                ProjectMember.project_id == row.id, ProjectMember.user_id != user_id
            )
        )
    ]
    cancelled = 0
    object_keys: list[str] = []
    if owned:
        cancelled = session.execute(
            update(ComputeJobRecord)
            .where(ComputeJobRecord.project_id.in_(owned), ComputeJobRecord.state.notin_(_TERMINAL))
            .values(state="CANCEL_REQUESTED", updated_at=utc_now())
        ).rowcount
        object_keys += list(
            session.scalars(select(StoredFile.object_key).where(StoredFile.project_id.in_(owned)))
        )
        object_keys += list(
            session.scalars(
                select(ScientificArtifactRecord.storage_key).where(
                    ScientificArtifactRecord.project_id.in_(owned)
                )
            )
        )
        _purge_project_content(session, owned)
        for project_id in owned:
            session.execute(
                update(Project)
                .where(Project.id == project_id)
                .values(
                    name="Deleted project", slug=f"deleted-{project_id[:8]}", updated_at=utc_now()
                )
            )
    session.execute(delete(ProjectMember).where(ProjectMember.user_id == user_id))
    for table in Base.metadata.sorted_tables:
        if table.name in {"ai_user_preferences", "byok_credentials"}:
            session.execute(delete(table).where(table.c.user_id == user_id))
    session.execute(delete(OrcidLink).where(OrcidLink.user_id == user_id))
    session.execute(delete(OrcidAuthState).where(OrcidAuthState.user_id == user_id))
    for organization_id in session.scalars(
        select(Membership.organization_id).where(Membership.user_id == user_id)
    ):
        organization = session.get(Organization, organization_id)
        if organization is not None and organization.kind == "PERSONAL":
            organization.name = "Deleted workspace"
    user.email = f"deleted-{user_id}@deleted.invalid"
    user.display_name = "Deleted user"
    user.disabled_at = utc_now()
    profile = session.get(AccountProfile, user_id)
    if profile is not None:
        profile.deleted_at = utc_now()
        profile.ai_enabled = False
    session.commit()
    for key in object_keys:
        with contextlib.suppress(Exception):  # a missing object is fine; the rows are gone
            object_store.delete(key)
    audit(session, "account_delete", user_id, "SUCCEEDED")
    return {"deleted": True, "projects_purged": len(owned), "jobs_cancelled": int(cancelled or 0)}
