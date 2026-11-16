import ipaddress
import os
import socket
import sys
import tempfile
from collections.abc import Generator
from pathlib import Path
from uuid import uuid4

import pytest
from engine_requirements import missing_requirement
from chemdft_api.test_environment import validate_test_storage

_REPOSITORY = Path(__file__).resolve().parents[3]
_TEST_WORKSPACE = None
_STORAGE_KEYS = ("CHEMDFT_DATABASE_URL", "CHEMDFT_OBJECT_ROOT", "CHEMDFT_TEST_WORKSPACE")
if any(os.environ.get(key) for key in _STORAGE_KEYS) or os.environ.get("CHEMDFT_TEST_MODE") or os.environ.get("CHEMDFT_ENVIRONMENT") == "test":
    if os.environ.get("CHEMDFT_TEST_MODE") != "1":
        raise RuntimeError("TEST_MODE_MISSING: backend pytest requires CHEMDFT_TEST_MODE=1 with explicit isolated storage")
    validate_test_storage(*(os.environ.get(key) for key in _STORAGE_KEYS), _REPOSITORY)
else:
    _TEST_WORKSPACE = tempfile.TemporaryDirectory(prefix="chemdft-pytest-", dir="/tmp")
    _root = Path(_TEST_WORKSPACE.name).resolve()
    os.environ.update({
        "CHEMDFT_TEST_MODE": "1", "CHEMDFT_ENVIRONMENT": "test",
        "CHEMDFT_TEST_WORKSPACE": str(_root),
        "CHEMDFT_DATABASE_URL": f"sqlite:///{_root / 'session.db'}",
        "CHEMDFT_OBJECT_ROOT": str(_root / "objects"),
        "CHEMDFT_AUTO_CREATE_SCHEMA": "false",
        # Explicit, so subprocesses (alembic) do not depend on a cwd-relative .env.
        "CHEMDFT_DEV_IDENTITY_ENABLED": "true",
        "CHEMDFT_DEV_USER_ID": str(uuid4()),
        "CHEMDFT_DEV_ORGANIZATION_ID": str(uuid4()),
    })

# Ordinary tests are independent of the developer's `.env` and shell credentials: a key that
# merely exists must never un-skip a live-provider test (see live_ai_gate).
from live_ai_gate import (  # noqa: E402
    LIVE_TEST_SKIP_REASON,
    NATIVE_OPT_IN_MARKERS,
    NATIVE_SKIP_REASON,
    configure_native_guard,
    convert_blocked_report,
    native_authorized,
    scrub_ambient_provider_settings,
)

scrub_ambient_provider_settings()

from chemdft_api.auth import ensure_dev_identity
from chemdft_api.config import Settings, get_settings
from chemdft_api.database import Base, get_session
from chemdft_api.main import app
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

Settings.model_config["env_file"] = None  # tests that need a file pass an explicit `_env_file`


def pytest_configure(config):
    configure_native_guard(config)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    del call
    outcome = yield
    convert_blocked_report(item, outcome.get_result())


def pytest_collection_modifyitems(config, items):
    live = pytest.mark.skip(reason=LIVE_TEST_SKIP_REASON)
    native = pytest.mark.skip(reason=NATIVE_SKIP_REASON)
    native_ok = native_authorized(config.option.markexpr)
    for item in items:
        absent = missing_requirement(item)
        if absent:
            item.add_marker(pytest.mark.skip(reason=absent))
        if item.get_closest_marker("ai_integration"):
            item.add_marker(live)
        elif not native_ok and any(item.get_closest_marker(n) for n in NATIVE_OPT_IN_MARKERS):
            item.add_marker(native)


@pytest.fixture(autouse=True)
def offline_network(monkeypatch):
    """Deny external Python networking, including DNS, even with dummy credentials.

    Loopback/Unix sockets support disposable PostgreSQL and local HTTP fixtures.
    This is test-only; it is not an OS sandbox for subprocesses or native libraries.
    Live-provider acceptance belongs in a separately authorized harness.
    """
    attempts = []

    def check(host):
        if isinstance(host, bytes):
            host = host.decode("ascii", errors="replace")
        if host == "localhost":
            return
        try:
            address = ipaddress.ip_address(host)
            if address.is_loopback or (
                isinstance(address, ipaddress.IPv6Address)
                and address.ipv4_mapped is not None
                and address.ipv4_mapped.is_loopback
            ):
                return
        except ValueError:
            pass
        attempts.append(host)
        # pytest's failure escapes broad `except Exception` provider/retry handlers.
        pytest.fail("OUTBOUND_NETWORK_BLOCKED: mock the transport boundary before dispatch")

    def guard_lookup(original):
        def lookup(host, *args, **kwargs):
            check(host)
            return original(host, *args, **kwargs)
        return lookup

    def guard_connect(original):
        def connect(sock, address):
            if sock.family in (socket.AF_INET, socket.AF_INET6):
                check(address[0])
            return original(sock, address)
        return connect

    original_sendto = socket.socket.sendto

    def sendto(sock, data, *args):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            check(args[-1][0])
        return original_sendto(sock, data, *args)

    for name in ("getaddrinfo", "gethostbyname", "gethostbyname_ex", "gethostbyaddr"):
        monkeypatch.setattr(socket, name, guard_lookup(getattr(socket, name)))
    monkeypatch.setattr(socket.socket, "connect", guard_connect(socket.socket.connect))
    monkeypatch.setattr(socket.socket, "connect_ex", guard_connect(socket.socket.connect_ex))
    monkeypatch.setattr(socket.socket, "sendto", sendto)
    if hasattr(socket.socket, "sendmsg"):
        original_sendmsg = socket.socket.sendmsg

        def sendmsg(sock, buffers, ancdata=(), flags=0, address=None):
            if address is not None and sock.family in (socket.AF_INET, socket.AF_INET6):
                check(address[0])
            if address is None:
                return original_sendmsg(sock, buffers, ancdata, flags)
            return original_sendmsg(sock, buffers, ancdata, flags, address)

        monkeypatch.setattr(socket.socket, "sendmsg", sendmsg)
    return attempts


def pytest_sessionfinish(session, exitstatus):
    del session, exitstatus
    if _TEST_WORKSPACE is not None:
        _TEST_WORKSPACE.cleanup()

# The import worker's pure-python modules (no cclib at import time) are importable by logic tests.
_WORKER_SRC = Path(__file__).resolve().parents[2] / "import-worker" / "src"
if str(_WORKER_SRC) not in sys.path:
    sys.path.insert(0, str(_WORKER_SRC))


@pytest.fixture
def api(
    tmp_path: Path,
) -> Generator[tuple[TestClient, sessionmaker[Session], Settings], None, None]:
    database = tmp_path / "test.db"
    settings = Settings(
        ai_provider="fake",
        ai_api_key=None,
        run_ai_integration=False,
        database_url=f"sqlite:///{database}",
        object_root=tmp_path / "objects",
        auto_create_schema=True,
        dev_identity_enabled=True,
        dev_identity_header_override_enabled=True,
    )
    test_engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
    with test_engine.connect() as connection:
        connection.execute(text("PRAGMA foreign_keys=ON"))
    sessions = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(test_engine)
    with sessions() as session:
        ensure_dev_identity(session, settings)

    def override_session() -> Generator[Session, None, None]:
        with sessions() as session:
            yield session

    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_session] = override_session
    with TestClient(app) as client:
        yield client, sessions, settings
    app.dependency_overrides.clear()
    test_engine.dispose()


@pytest.fixture
def multiuser(tmp_path: Path):
    """The real app in jwt auth mode with throw-away keys; see tests/multiuser.py."""
    from multiuser import MultiUserEnv, SigningKey, jwt_settings

    keys = SigningKey()
    settings = jwt_settings(f"sqlite:///{tmp_path / 'multiuser.db'}", tmp_path / "objects", keys)
    test_engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
    with test_engine.connect() as connection:
        connection.execute(text("PRAGMA foreign_keys=ON"))
    sessions = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(test_engine)

    def override_session() -> Generator[Session, None, None]:
        with sessions() as session:
            yield session

    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_session] = override_session
    # The lifespan reads the environment settings, not the override: keep it a no-op here.
    with TestClient(app) as client:
        yield MultiUserEnv(client, sessions, settings, keys)
    app.dependency_overrides.clear()
    test_engine.dispose()
