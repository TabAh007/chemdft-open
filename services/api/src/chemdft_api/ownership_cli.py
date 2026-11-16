"""Operator CLI for legacy project ownership. Not an HTTP route: it runs on the operator's machine.

    python -m chemdft_api.ownership_cli list-legacy
    python -m chemdft_api.ownership_cli claim --actor-email admin@example.org --project <id> \\
        --destination-organization <personal-org-id> --reason "…" \\
        --idempotency-key <key>

The database is chosen by CHEMDFT_DATABASE_URL; the administrator by CHEMDFT_BOOTSTRAP_ADMIN_EMAILS.
`list-legacy` is read-only. A claim re-homes one LEGACY_LOCAL project to the destination personal
organization, grants its owner the OWNER membership and appends one ownership event; see
docs/implementation/OWNERSHIP_MODEL.md.
"""

from __future__ import annotations

import argparse
import json
import re
import sys

from sqlalchemy import func, select

from .config import get_settings
from .database import SessionLocal
from .models import Project, ProjectKind, ProjectMember
from .ownership_service import OwnershipDenied, claim_legacy_project

# A hint for the operator, never a classification: names that look like acceptance data are
# flagged for review before a real claim.
REVIEW_HINT = re.compile(r"accept", re.IGNORECASE)


def _list_legacy() -> int:
    with SessionLocal() as session:
        rows = session.execute(
            select(Project.id, Project.name, Project.kind, func.count(ProjectMember.id))
            .outerjoin(ProjectMember, ProjectMember.project_id == Project.id)
            .where(Project.kind.in_([ProjectKind.LEGACY_LOCAL, ProjectKind.ACCEPTANCE_FROZEN]))
            .group_by(Project.id)
            .order_by(Project.created_at)
        ).all()
    for project_id, name, kind, members in rows:
        claimable = "claimable" if kind == ProjectKind.LEGACY_LOCAL else "FROZEN (never claimable)"
        if kind == ProjectKind.LEGACY_LOCAL and REVIEW_HINT.search(name):
            claimable += " [OPERATOR REVIEW REQUIRED: name suggests reference data; no evidence]"
        print(f"{project_id}  {kind:<18} members={members}  {claimable}  {name}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ownership_cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list-legacy")
    claim = sub.add_parser("claim")
    claim.add_argument("--actor-email", required=True)
    claim.add_argument("--project", required=True)
    claim.add_argument("--destination-organization", required=True)
    claim.add_argument("--reason", required=True)
    claim.add_argument("--idempotency-key", required=True)
    args = parser.parse_args(argv)
    if args.command == "list-legacy":
        return _list_legacy()
    with SessionLocal() as session:
        try:
            result = claim_legacy_project(
                session,
                get_settings(),
                actor_email=args.actor_email,
                project_id=args.project,
                destination_organization_id=args.destination_organization,
                reason=args.reason,
                idempotency_key=args.idempotency_key,
            )
        except OwnershipDenied as error:
            print(json.dumps({"ok": False, "refused": error.code}))
            return 1
    print(
        json.dumps(
            {
                "ok": True,
                "changed": result.created,
                "project": result.project.id,
                "subject_user": result.subject.id,
                "event": result.event.id if result.event else None,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
