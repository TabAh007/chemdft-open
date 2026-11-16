"""PF-7 private preferences/credentials and actor-bound single-use AI approvals."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025_ai_product_foundation"
down_revision: str | None = "0024_example_templates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_user_preferences",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    sqlite = op.get_bind().dialect.name == "sqlite"
    convention = {"uq": "uq_%(table_name)s_%(column_0_name)s"}
    with op.batch_alter_table("byok_credentials", naming_convention=convention) as batch:
        batch.add_column(sa.Column("user_id", sa.String(36), nullable=True))
        batch.add_column(sa.Column("validated_at", sa.DateTime(), nullable=True))
        batch.add_column(
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now())
        )
        batch.create_foreign_key("fk_byok_user", "users", ["user_id"], ["id"])
        batch.drop_constraint(
            "uq_byok_credentials_billing_account_id"
            if sqlite
            else "byok_credentials_billing_account_id_provider_key",
            type_="unique",
        )
        batch.create_unique_constraint(
            "uq_byok_account_user_provider", ["billing_account_id", "user_id", "provider"]
        )
        batch.create_index("ix_byok_credentials_user_id", ["user_id"])
    # Legacy credentials have no asserted human owner and cannot be selected by a user.
    with op.batch_alter_table("ai_approvals") as batch:
        batch.add_column(sa.Column("actor_id", sa.String(36), nullable=True))
        batch.add_column(sa.Column("organization_id", sa.String(36), nullable=True))
        batch.add_column(sa.Column("consumed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    # Multiple private keys cannot safely collapse into one org key. Refuse lossy downgrade.
    if (
        op.get_bind()
        .execute(sa.text("SELECT COUNT(*) FROM byok_credentials WHERE user_id IS NOT NULL"))
        .scalar()
    ):
        raise RuntimeError(
            "Private BYOK metadata exists; a reviewed migration is required before downgrade. "
            "No credentials are discarded."
        )
    with op.batch_alter_table("ai_approvals") as batch:
        for name in ["consumed_at", "organization_id", "actor_id"]:
            batch.drop_column(name)
    with op.batch_alter_table("byok_credentials") as batch:
        batch.drop_index("ix_byok_credentials_user_id")
        batch.drop_constraint("uq_byok_account_user_provider", type_="unique")
        batch.drop_constraint("fk_byok_user", type_="foreignkey")
        for name in ["updated_at", "validated_at", "user_id"]:
            batch.drop_column(name)
        batch.create_unique_constraint(
            "uq_byok_credentials_billing_account_id", ["billing_account_id", "provider"]
        )
    op.drop_table("ai_user_preferences")
