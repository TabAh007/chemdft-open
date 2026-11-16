from logging.config import fileConfig

from alembic import context
from chemdft_api import (
    ai_models,  # noqa: F401
    billing_models,  # noqa: F401
    example_models,  # noqa: F401
    investigation_models,  # noqa: F401
    knowledge_models,  # noqa: F401
    models,  # noqa: F401
    scientific_models,  # noqa: F401
)
from chemdft_api.config import get_settings
from chemdft_api.database import Base
from chemdft_api.db_timezone import pin_session_timezone_utc
from sqlalchemy import engine_from_config, pool

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)
config.set_main_option("sqlalchemy.url", get_settings().database_url)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    pin_session_timezone_utc(connectable)  # timestamps are naive UTC; never session-dependent
    with connectable.connect() as connection:
        if connection.dialect.name == "postgresql":
            # Revision ids here are up to 39 characters; Alembic's default VARCHAR(32) version
            # column rejects them on PostgreSQL (SQLite does not enforce lengths).
            connection.exec_driver_sql(
                "CREATE TABLE IF NOT EXISTS alembic_version ("
                "version_num VARCHAR(255) NOT NULL, "
                "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
            )
            connection.exec_driver_sql(
                "ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(255)"
            )
            connection.commit()
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
