# ruff: noqa: E501  (SQL fixture lines)
import os
import subprocess
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]


def _alembic(database_url: str, *arguments: str) -> subprocess.CompletedProcess[str]:
    environment = {**os.environ, "CHEMDFT_DATABASE_URL": database_url}
    # The storage guard (eeb7a4b) requires the database and objects to be children of one test
    # workspace. Keep that guard for SQLite databases; a PostgreSQL URL is render-only (--sql),
    # so the subprocess runs outside test mode.
    if database_url.startswith("sqlite:///"):
        workspace = Path(database_url.removeprefix("sqlite:///")).parent
        environment.update(
            CHEMDFT_TEST_MODE="1",
            CHEMDFT_ENVIRONMENT="test",
            CHEMDFT_DEV_IDENTITY_ENABLED="true",
            CHEMDFT_TEST_WORKSPACE=str(workspace),
            CHEMDFT_OBJECT_ROOT=str(workspace / "objects"),
        )
    else:
        for key in ("CHEMDFT_TEST_MODE", "CHEMDFT_ENVIRONMENT", "CHEMDFT_TEST_WORKSPACE", "CHEMDFT_OBJECT_ROOT"):
            environment.pop(key, None)
    return subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=API_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )


def test_phase_3_migration_upgrade_downgrade_roundtrip(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path / 'migration.db'}"
    _alembic(database_url, "upgrade", "head")
    _alembic(database_url, "downgrade", "0001_application_foundation")
    _alembic(database_url, "upgrade", "head")
    current = _alembic(database_url, "current")
    assert "0030_beta_readiness (head)" in current.stdout


def test_phase_2_migration_renders_for_postgresql() -> None:
    rendered = _alembic(
        "postgresql+psycopg://fixture:fixture@127.0.0.1/fixture",
        "upgrade",
        "head",
        "--sql",
    )
    assert "CREATE TABLE scientific_artifacts" in rendered.stdout
    assert "CREATE TABLE calculation_results" in rendered.stdout
    assert "CREATE TABLE compute_jobs" in rendered.stdout
    assert "CREATE TABLE ai_conversations" in rendered.stdout
    assert "CREATE TABLE knowledge_items" in rendered.stdout
    assert "CREATE TABLE investigations" in rendered.stdout
    assert "CREATE TABLE billing_accounts" in rendered.stdout
    assert "CREATE TABLE ai_usage_ledger_entries" in rendered.stdout
    assert "CREATE TABLE compute_usage_ledger_entries" in rendered.stdout
    assert "CREATE TABLE structure_candidates" in rendered.stdout
    assert "CREATE TABLE candidate_representations" in rendered.stdout
    assert "CREATE TABLE structure_candidate_reviews" in rendered.stdout
    assert "CREATE TABLE external_imports" in rendered.stdout
    assert "CREATE TABLE imported_results" in rendered.stdout
    assert "REFERENCES scientific_artifacts (id, project_id)" in rendered.stdout


def test_identity_foundation_migration_labels_reserved_rows_and_preserves_everything_else(
    tmp_path: Path,
) -> None:
    import sqlite3

    database = tmp_path / "identity.db"
    url = f"sqlite:///{database}"
    _alembic(url, "upgrade", "0021_experimental_spectra")
    legacy_user = "00000000-0000-4000-8000-000000000001"
    legacy_org = "00000000-0000-4000-8000-000000000010"
    service = "00000000-0000-4000-8000-0000000000f1"
    system_org = "00000000-0000-4000-8000-0000000000f0"
    other_user = "11111111-1111-4111-8111-111111111111"
    with sqlite3.connect(database) as db:
        db.executescript(
            f"""
            INSERT INTO organizations (id, name, created_at) VALUES
              ('{legacy_org}', 'ChemDFT local development', '2026-09-16 10:00:00'),
              ('{system_org}', 'ChemDFT system services', '2026-10-06 10:00:00');
            INSERT INTO users (id, email, display_name, created_at) VALUES
              ('{legacy_user}', 'developer@localhost.invalid', 'Local developer', '2026-09-16 10:00:00'),
              ('{service}', 'compute-worker@service.chemdft.invalid', 'Service: compute-worker', '2026-10-06 10:00:00'),
              ('{other_user}', 'someone@example.test', 'Someone', '2026-10-06 10:00:00');
            INSERT INTO memberships (id, organization_id, user_id, role)
              VALUES ('m1', '{legacy_org}', '{legacy_user}', 'owner');
            INSERT INTO projects (id, organization_id, name, slug, created_by, created_at, updated_at)
              VALUES ('p1', '{legacy_org}', 'Legacy', 'legacy', '{legacy_user}', '2026-09-16 10:00:00', '2026-09-16 10:00:00');
            INSERT INTO project_members (id, project_id, user_id, role) VALUES ('pm1', 'p1', '{legacy_user}', 'owner');
            """
        )
        before = db.execute("SELECT id, organization_id, name, slug, created_by, created_at FROM projects").fetchall()
        members_before = db.execute("SELECT * FROM project_members").fetchall()

    _alembic(url, "upgrade", "head")
    with sqlite3.connect(database) as db:
        kinds = dict(db.execute("SELECT id, kind FROM users").fetchall())
        assert kinds == {legacy_user: "LEGACY_LOCAL", service: "SERVICE", other_user: "HUMAN"}
        assert dict(db.execute("SELECT id, kind FROM organizations").fetchall()) == {
            legacy_org: "LEGACY_LOCAL",
            system_org: "SYSTEM",
        }
        assert db.execute("SELECT id, organization_id, name, slug, created_by, created_at FROM projects").fetchall() == before
        assert db.execute("SELECT * FROM project_members").fetchall() == members_before
        assert db.execute("SELECT COUNT(*) FROM user_identities").fetchone() == (0,)
        assert db.execute("SELECT COUNT(*) FROM users WHERE disabled_at IS NOT NULL").fetchone() == (0,)

    _alembic(url, "downgrade", "0021_experimental_spectra")
    with sqlite3.connect(database) as db:
        assert "kind" not in [row[1] for row in db.execute("PRAGMA table_info(users)")]
        assert db.execute("SELECT id, organization_id, name, slug, created_by, created_at FROM projects").fetchall() == before
        assert db.execute("SELECT COUNT(*) FROM users").fetchone() == (3,)
