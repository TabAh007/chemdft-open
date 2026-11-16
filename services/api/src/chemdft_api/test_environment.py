"""Fail-closed storage boundary for explicitly isolated test services."""

import os
from pathlib import Path
from urllib.parse import unquote, urlsplit


class TestEnvironmentError(RuntimeError):
    pass


def _path(value: str, label: str) -> Path:
    if not value:
        raise TestEnvironmentError(f"TEST_STORAGE_MISSING: {label} is required")
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise TestEnvironmentError(f"TEST_STORAGE_RELATIVE: {label} must be absolute: {value}")
    return path.resolve(strict=False)


def _overlaps(a: Path, b: Path) -> bool:
    return a == b or a in b.parents or b in a.parents


def validate_test_storage(database_url: str | None, object_root: str | Path | None,
                          workspace: str | None, repository: Path) -> tuple[Path, Path]:
    if not database_url:
        raise TestEnvironmentError("TEST_DATABASE_MISSING: CHEMDFT_DATABASE_URL is required")
    parsed = urlsplit(database_url)
    if parsed.scheme != "sqlite" or parsed.netloc or parsed.query or parsed.fragment or not parsed.path.startswith("//"):
        raise TestEnvironmentError("TEST_DATABASE_URL_INVALID: use an absolute sqlite://// path")
    database = _path(unquote(parsed.path[1:]), "CHEMDFT_DATABASE_URL")
    objects = _path(str(object_root or ""), "CHEMDFT_OBJECT_ROOT")
    sandbox = _path(workspace or "", "CHEMDFT_TEST_WORKSPACE")
    protected = (
        repository / ".chemdft/live-user-test-20261011/live.db",
        repository / ".chemdft/live-user-test-20261011/objects",
        repository / ".chemdft/chemdft.db",
        repository / ".chemdft/objects",
    )
    for target in (database, objects, sandbox):
        for item in protected:
            if _overlaps(target, item.resolve(strict=False)):
                raise TestEnvironmentError(f"TEST_STORAGE_PROTECTED: {target} overlaps persistent scientific data")
    if sandbox not in database.parents or sandbox not in objects.parents or _overlaps(database, objects):
        raise TestEnvironmentError("TEST_STORAGE_OUTSIDE_WORKSPACE: database and objects must be separate children of CHEMDFT_TEST_WORKSPACE")
    return database, objects


def validate_test_process(settings: object, repository: Path) -> None:
    mode = os.environ.get("CHEMDFT_TEST_MODE")
    if settings.environment == "test" and mode != "1":
        raise TestEnvironmentError("TEST_MODE_MISSING: CHEMDFT_TEST_MODE=1 is required in test environment")
    if mode != "1":
        return
    # Do not accept BaseSettings defaults or a repository .env as test configuration.
    validate_test_storage(os.environ.get("CHEMDFT_DATABASE_URL"),
                          os.environ.get("CHEMDFT_OBJECT_ROOT"),
                          os.environ.get("CHEMDFT_TEST_WORKSPACE"), repository)
    if settings.environment != "test":
        raise TestEnvironmentError("TEST_MODE_INVALID: CHEMDFT_ENVIRONMENT=test is required")
    if not settings.dev_identity_enabled or settings.dev_user_id == "00000000-0000-4000-8000-000000000001":
        raise TestEnvironmentError("TEST_IDENTITY_INVALID: use a distinct enabled CHEMDFT_DEV_USER_ID")
