"""PF-0.1: the fixed development identity operates only in an explicitly local environment."""

from __future__ import annotations

import pytest
from chemdft_api.auth import (
    HOSTED_ENVIRONMENT_MARKERS,
    assert_dev_identity_allowed,
    dev_identity_permitted,
)
from chemdft_api.config import Settings, get_settings
from chemdft_api.main import app
from fastapi.testclient import TestClient


def _settings(**values) -> Settings:
    return Settings(dev_identity_enabled=True, **values)


@pytest.mark.parametrize("environment", ["development", "local", "test", " Local "])
def test_local_environments_permit_the_dev_identity(environment: str) -> None:
    assert dev_identity_permitted(_settings(environment=environment), {})


@pytest.mark.parametrize("environment", ["production", "preview", "staging", "", "prod"])
def test_non_local_environments_refuse_the_dev_identity(environment: str) -> None:
    assert not dev_identity_permitted(_settings(environment=environment), {})


@pytest.mark.parametrize("marker", HOSTED_ENVIRONMENT_MARKERS)
def test_a_hosted_platform_marker_refuses_the_dev_identity(marker: str) -> None:
    assert not dev_identity_permitted(_settings(), {marker: "1"})
    assert dev_identity_permitted(_settings(), {marker: ""})  # an empty value is not a marker


def test_requests_get_no_dev_identity_in_a_hosted_environment(api, monkeypatch) -> None:
    client, _sessions, settings = api
    assert client.get("/v1/projects").status_code == 200  # local test mode
    monkeypatch.setenv("VERCEL", "1")
    refused = client.get("/v1/projects")
    assert refused.status_code == 401
    assert refused.json()["detail"] == "Authentication provider is not configured."
    # header overrides cannot get around it either
    assert (
        client.get("/v1/projects", headers={"X-ChemDFT-User-ID": settings.dev_user_id}).status_code
        == 401
    )
    monkeypatch.delenv("VERCEL")
    settings.environment = "production"
    try:
        assert client.get("/v1/projects").status_code == 401
    finally:
        settings.environment = "development"
    assert client.get("/v1/projects").status_code == 200


def test_startup_refuses_to_serve_anonymous_traffic_as_the_dev_user(monkeypatch) -> None:
    assert_dev_identity_allowed(Settings(dev_identity_enabled=False, environment="production"))
    with pytest.raises(RuntimeError, match="non-local environment"):
        assert_dev_identity_allowed(_settings(environment="production"))
    monkeypatch.setenv("VERCEL_ENV", "preview")
    with pytest.raises(RuntimeError, match="refusing to start"):
        assert_dev_identity_allowed(_settings())

    monkeypatch.setenv("CHEMDFT_DEV_IDENTITY_ENABLED", "true")
    get_settings.cache_clear()
    try:
        with pytest.raises(RuntimeError), TestClient(app):
            pass
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()
