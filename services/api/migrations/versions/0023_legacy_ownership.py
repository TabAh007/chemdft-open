"""Legacy ownership foundation (PF-2): project kinds and the append-only ownership event log.

Additive and reversible. No project, membership, provenance, `created_by` or `submitted_by` value is
changed other than the new `projects.kind` label:
- `projects.kind` (NORMAL | LEGACY_LOCAL | ACCEPTANCE_FROZEN), default NORMAL;
- `ownership_events` (append-only access history; written only by the ownership service).

Labelling is by explicit rule, never by name: every project of the legacy local organization becomes
LEGACY_LOCAL, and the projects that the repository's acceptance documents and regression tests name as
reference data become ACCEPTANCE_FROZEN (evidence is listed in docs/implementation/OWNERSHIP_MODEL.md).
On any other database none of these ids exist and the labelling statements are no-ops.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023_legacy_ownership"
down_revision: str | None = "0022_identity_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LEGACY_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000010"
# Acceptance / regression reference projects, with the repository evidence for each (see OWNERSHIP_MODEL.md).
ACCEPTANCE_FROZEN_PROJECT_IDS = (
    "f39aefcf-a1cd-4606-8f03-f9b18eadb96d",  # Water acceptance (project memory section 13.1)
    "7ae7e41b-2483-42c3-823e-42dd1b9fa72f",  # Chromium CVD paper acceptance (project memory section 13.2)
    "3537048e-306a-4f4f-9b9e-493681c0df83",  # legacy water acceptance (unified-visualization-acceptance e2e)
    "85130614-31f8-4654-a767-31d42d2d633d",  # test-user-supplied-water (unified-visualization-acceptance e2e)
    "3606543b-cee0-47fa-b000-ec06645549c4",  # Phase 7 walkthrough (pre-merge-fixes e2e)
    "70d5fc2d-5e58-4a26-a512-44a9403af2a1",  # External Import V1 visual acceptance run
)


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("kind", sa.String(24), nullable=False, server_default="NORMAL"))
    op.create_table(
        "ownership_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("actor_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("subject_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("source_organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("destination_organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=True),
        sa.Column("previous_role", sa.String(20), nullable=True),
        sa.Column("new_role", sa.String(20), nullable=True),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("idempotency_key"),
    )
    op.create_index("ix_ownership_events_project_id", "ownership_events", ["project_id"])
    op.create_index("ix_ownership_events_subject_user_id", "ownership_events", ["subject_user_id"])

    projects = sa.table(
        "projects", sa.column("id", sa.String), sa.column("organization_id", sa.String), sa.column("kind", sa.String)
    )
    op.execute(
        projects.update().where(projects.c.organization_id == LEGACY_ORGANIZATION_ID).values(kind="LEGACY_LOCAL")
    )
    op.execute(projects.update().where(projects.c.id.in_(ACCEPTANCE_FROZEN_PROJECT_IDS)).values(kind="ACCEPTANCE_FROZEN"))


def downgrade() -> None:
    op.drop_index("ix_ownership_events_subject_user_id", table_name="ownership_events")
    op.drop_index("ix_ownership_events_project_id", table_name="ownership_events")
    op.drop_table("ownership_events")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("kind")
