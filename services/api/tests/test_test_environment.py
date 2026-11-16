from pathlib import Path

import pytest
from chemdft_api.config import Settings
from chemdft_api.test_environment import (
    TestEnvironmentError as StorageError,
    validate_test_process,
    validate_test_storage,
)


REPOSITORY = Path(__file__).resolve().parents[3]


def test_live_database_is_rejected(tmp_path):
    with pytest.raises(StorageError, match="TEST_STORAGE_PROTECTED"):
        validate_test_storage(
            f"sqlite:///{REPOSITORY / '.chemdft/live-user-test-20261011/live.db'}",
            tmp_path / "objects", str(tmp_path), REPOSITORY,
        )


def test_historical_database_is_rejected(tmp_path):
    with pytest.raises(StorageError, match="TEST_STORAGE_PROTECTED"):
        validate_test_storage(
            f"sqlite:///{REPOSITORY / '.chemdft/chemdft.db'}",
            tmp_path / "objects", str(tmp_path), REPOSITORY,
        )


def test_live_object_root_symlink_is_rejected(tmp_path):
    alias = tmp_path / "objects"
    alias.symlink_to(REPOSITORY / ".chemdft/live-user-test-20261011/objects", target_is_directory=True)
    with pytest.raises(StorageError, match="TEST_STORAGE_PROTECTED"):
        validate_test_storage(f"sqlite:///{tmp_path / 'test.db'}", alias, str(tmp_path), REPOSITORY)


def test_missing_database_fails_closed(tmp_path):
    with pytest.raises(StorageError, match="TEST_DATABASE_MISSING"):
        validate_test_storage(None, tmp_path / "objects", str(tmp_path), REPOSITORY)


def test_disposable_storage_is_accepted(tmp_path):
    database, objects = validate_test_storage(
        f"sqlite:///{tmp_path / 'data/test.db'}", tmp_path / "objects", str(tmp_path), REPOSITORY,
    )
    assert database == tmp_path / "data/test.db"
    assert objects == tmp_path / "objects"


def test_test_process_rejects_missing_explicit_database(monkeypatch, tmp_path):
    monkeypatch.setenv("CHEMDFT_TEST_MODE", "1")
    monkeypatch.setenv("CHEMDFT_TEST_WORKSPACE", str(tmp_path))
    monkeypatch.setenv("CHEMDFT_OBJECT_ROOT", str(tmp_path / "objects"))
    monkeypatch.delenv("CHEMDFT_DATABASE_URL", raising=False)
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'fallback.db'}",
        object_root=tmp_path / "objects", environment="test", dev_identity_enabled=True,
        dev_user_id="4b8101e1-64b4-495a-a7d8-72ee27f94ca6",
    )
    with pytest.raises(StorageError, match="TEST_DATABASE_MISSING"):
        validate_test_process(settings, REPOSITORY)


def test_test_environment_requires_mode_marker(monkeypatch, tmp_path):
    monkeypatch.delenv("CHEMDFT_TEST_MODE", raising=False)
    settings = Settings(environment="test", database_url=f"sqlite:///{tmp_path / 'test.db'}")
    with pytest.raises(StorageError, match="TEST_MODE_MISSING"):
        validate_test_process(settings, REPOSITORY)


@pytest.mark.parametrize("relative", [".chemdft/live-user-test-20261011/live.db", ".chemdft/chemdft.db"])
def test_database_symlink_is_rejected(tmp_path, relative):
    alias = tmp_path / "alias.db"
    alias.symlink_to(REPOSITORY / relative)
    with pytest.raises(StorageError, match="TEST_STORAGE_PROTECTED"):
        validate_test_storage(f"sqlite:///{alias}", tmp_path / "objects", str(tmp_path), REPOSITORY)


@pytest.mark.parametrize("relative", [".chemdft/objects", ".chemdft/live-user-test-20261011/objects"])
def test_persistent_object_root_is_rejected(tmp_path, relative):
    with pytest.raises(StorageError, match="TEST_STORAGE_PROTECTED"):
        validate_test_storage(f"sqlite:///{tmp_path / 'test.db'}", REPOSITORY / relative, str(tmp_path), REPOSITORY)


@pytest.fixture
def runner():
    import importlib.util
    spec = importlib.util.spec_from_file_location("isolated_runner", REPOSITORY / "tools/run_isolated_e2e.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("flag", ["--api-port", "--web-port"])
def test_runner_refuses_unrelated_listener_before_workspace_creation(runner, monkeypatch, flag):
    import socket
    import sys
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        monkeypatch.setattr(sys, "argv", ["runner", flag, str(port)])
        monkeypatch.setattr(runner.tempfile, "mkdtemp", lambda **kwargs: pytest.fail("created workspace before port guard"))
        with pytest.raises(StorageError, match="TEST_PORT_OCCUPIED"):
            runner.main()
        assert listener.getsockname()[1] == port


@pytest.mark.parametrize("args", [["--api-port", "8148"], ["--web-port", "3148"], ["--", "--config", "playwright.config.ts"]])
def test_runner_rejects_live_ports_and_config_override(runner, monkeypatch, args):
    import sys
    monkeypatch.setattr(sys, "argv", ["runner", *args])
    monkeypatch.setattr(runner.tempfile, "mkdtemp", lambda **kwargs: pytest.fail("created unsafe workspace"))
    with pytest.raises(StorageError, match="TEST_PORT_PROTECTED|TEST_CONFIG_OVERRIDE"):
        runner.main()


def test_runner_rejects_wrong_service_identity(runner, monkeypatch):
    import io
    monkeypatch.setattr(runner.urllib.request, "urlopen", lambda *a, **k: io.BytesIO(b'{"id":"unrelated","organization":{"id":"wrong"}}'))
    with pytest.raises(StorageError, match="TEST_SERVICE_IDENTITY_MISMATCH"):
        runner.verify_stack_identity({"CHEMDFT_E2E_API_PORT": "8123", "CHEMDFT_E2E_WEB_PORT": "3100",
                                     "CHEMDFT_DEV_USER_ID": "test-only", "CHEMDFT_DEV_ORGANIZATION_ID": "test-org"})
