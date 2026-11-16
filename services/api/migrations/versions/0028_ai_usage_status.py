"""Nullable observed AI usage; preserve every historical counter and charge.

Only token observations become nullable. Confirmed platform charges and budget
counters remain integers. SQLite rebuilds these two tables through Alembic batch;
PostgreSQL uses ALTER TABLE. Downgrade refuses to discard new accounting data.
"""

import sqlalchemy as sa
from alembic import op

revision = "0028_ai_usage_status"
down_revision = "0027_ai_execution_state"
branch_labels = None
depends_on = None

TABLES = {
    "ai_model_invocations": ("input_tokens", "output_tokens"),
    "ai_usage_ledger_entries": ("input_tokens", "output_tokens", "cached_tokens"),
}


def upgrade():
    for table, counters in TABLES.items():
        with op.batch_alter_table(table) as batch:
            for name in counters:
                batch.alter_column(name, existing_type=sa.Integer(), nullable=True)
            batch.add_column(
                sa.Column(
                    "usage_status",
                    sa.String(24),
                    nullable=False,
                    server_default="LEGACY_UNSPECIFIED",
                )
            )
            if table == "ai_model_invocations":
                batch.add_column(sa.Column("reservation_json", sa.JSON(), nullable=True))
                batch.add_column(
                    sa.Column(
                        "accounting_version", sa.Integer(), nullable=False, server_default="0"
                    )
                )
            batch.create_check_constraint(
                f"{table}_usage_status",
                "usage_status IN ('REPORTED', 'UNKNOWN', 'LEGACY_UNSPECIFIED')",
            )


def downgrade():
    # Check ALL tables before altering either one. Filling NULL with zero or
    # dropping new status/reservation identities would destroy accounting truth.
    bind = op.get_bind()
    for table, counters in TABLES.items():
        conditions = " OR ".join(f"{name} IS NULL" for name in counters)
        if table == "ai_model_invocations":
            conditions += " OR reservation_json IS NOT NULL OR accounting_version != 0"
        count = bind.execute(
            sa.text(
                f"SELECT COUNT(*) FROM {table} "
                f"WHERE usage_status != 'LEGACY_UNSPECIFIED' OR {conditions}"
            )
        ).scalar()
        if count:
            raise RuntimeError(
                "AI usage history cannot be downgraded without losing accounting information; "
                "nothing was changed. A reviewed preservation migration is required."
            )
    for table, counters in TABLES.items():
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"{table}_usage_status", type_="check")
            if table == "ai_model_invocations":
                batch.drop_column("accounting_version")
                batch.drop_column("reservation_json")
            batch.drop_column("usage_status")
            for name in counters:
                batch.alter_column(name, existing_type=sa.Integer(), nullable=False)
