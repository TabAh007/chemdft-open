"""Identity foundation (PF-1): principal kinds and the external-identity mapping.

Additive and reversible. No project, membership, provenance, `created_by` or `submitted_by` value is
read or rewritten:
- `users.kind` (HUMAN | SERVICE | LEGACY_LOCAL), `users.disabled_at`;
- `organizations.kind` (PERSONAL | TEAM | LEGACY_LOCAL | SYSTEM);
- `user_identities` maps an authentication subject to a ChemDFT user.

Existing rows are labelled only by their reserved ids: the four service principals and the system
organization created by PF-0, and the fixed local development user/organization. Everything else keeps
the column default (users HUMAN, organizations TEAM).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022_identity_foundation"
down_revision: str | None = "0021_experimental_spectra"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SERVICE_USER_IDS = (
    "00000000-0000-4000-8000-0000000000f1",
    "00000000-0000-4000-8000-0000000000f2",
    "00000000-0000-4000-8000-0000000000f3",
    "00000000-0000-4000-8000-0000000000f4",
)
SYSTEM_ORGANIZATION_ID = "00000000-0000-4000-8000-0000000000f0"
LEGACY_USER_ID = "00000000-0000-4000-8000-000000000001"
LEGACY_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000010"


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("kind", sa.String(16), nullable=False, server_default="HUMAN"))
        batch.add_column(sa.Column("disabled_at", sa.DateTime(), nullable=True))
    with op.batch_alter_table("organizations") as batch:
        batch.add_column(sa.Column("kind", sa.String(16), nullable=False, server_default="TEAM"))
    op.create_table(
        "user_identities",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("provider", "subject"),
    )
    op.create_index("ix_user_identities_user_id", "user_identities", ["user_id"])

    users = sa.table("users", sa.column("id", sa.String), sa.column("kind", sa.String))
    organizations = sa.table("organizations", sa.column("id", sa.String), sa.column("kind", sa.String))
    op.execute(users.update().where(users.c.id.in_(SERVICE_USER_IDS)).values(kind="SERVICE"))
    op.execute(users.update().where(users.c.id == LEGACY_USER_ID).values(kind="LEGACY_LOCAL"))
    op.execute(organizations.update().where(organizations.c.id == SYSTEM_ORGANIZATION_ID).values(kind="SYSTEM"))
    op.execute(organizations.update().where(organizations.c.id == LEGACY_ORGANIZATION_ID).values(kind="LEGACY_LOCAL"))


def downgrade() -> None:
    op.drop_index("ix_user_identities_user_id", table_name="user_identities")
    op.drop_table("user_identities")
    with op.batch_alter_table("organizations") as batch:
        batch.drop_column("kind")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("disabled_at")
        batch.drop_column("kind")
