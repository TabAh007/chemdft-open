from chemdft_api.config import get_settings
from chemdft_api.main import app
from chemdft_api.models import Membership, Organization, Project, User
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker


def create_project(client: TestClient, slug: str = "water-study") -> dict[str, object]:
    response = client.post("/v1/projects", json={"name": "Water study", "slug": slug})
    assert response.status_code == 201
    return response.json()


def test_project_create_list_and_open_are_authorized(api) -> None:
    client, _sessions, _settings = api
    project = create_project(client)

    listing = client.get("/v1/projects")
    opened = client.get(f"/v1/projects/{project['id']}")

    assert listing.status_code == 200
    assert [item["id"] for item in listing.json()] == [project["id"]]
    assert opened.status_code == 200
    assert opened.json()["role"] == "owner"


def test_project_survives_database_engine_restart(api) -> None:
    client, sessions, settings = api
    project = create_project(client, slug="restart-persistence")
    engine = sessions.kw["bind"]
    assert engine is not None
    engine.dispose()

    restarted_engine = create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False},
    )
    restarted_sessions = sessionmaker(
        bind=restarted_engine,
        autoflush=False,
        expire_on_commit=False,
    )
    try:
        with restarted_sessions() as session:
            persisted = session.scalar(select(Project).where(Project.id == project["id"]))
            assert persisted is not None
            assert persisted.slug == "restart-persistence"
    finally:
        restarted_engine.dispose()


def test_missing_project_lookup_returns_not_found(api) -> None:
    client, _sessions, _settings = api
    response = client.get("/v1/projects/f3629c54-0ba3-4b41-a143-33cc2fa240a5")
    assert response.status_code == 404
    assert response.json()["detail"] == "Project not found."


def test_cross_organization_project_access_is_indistinguishable_from_missing(api) -> None:
    client, sessions, _settings = api
    project = create_project(client)
    other_org_id = "00000000-0000-4000-8000-000000000020"
    other_user_id = "00000000-0000-4000-8000-000000000002"
    with sessions() as session:
        session.add(Organization(id=other_org_id, name="Other organization"))
        session.add(
            User(id=other_user_id, email="other@example.invalid", display_name="Other user")
        )
        session.flush()
        session.add(Membership(organization_id=other_org_id, user_id=other_user_id, role="owner"))
        session.commit()

    response = client.get(
        f"/v1/projects/{project['id']}",
        headers={"X-ChemDFT-User-ID": other_user_id, "X-ChemDFT-Organization-ID": other_org_id},
    )
    assert response.status_code == 404


def test_duplicate_slug_conflicts_within_organization(api) -> None:
    client, _sessions, _settings = api
    create_project(client)
    response = client.post("/v1/projects", json={"name": "Another", "slug": "water-study"})
    assert response.status_code == 409


def test_dev_identity_must_be_explicitly_enabled(api) -> None:
    client, _sessions, settings = api
    disabled = settings.model_copy(update={"dev_identity_enabled": False})
    app.dependency_overrides[get_settings] = lambda: disabled
    try:
        response = client.get("/v1/projects")
    finally:
        app.dependency_overrides[get_settings] = lambda: settings
    assert response.status_code == 401


def test_dev_identity_does_not_accept_arbitrary_browser_actor_headers(api) -> None:
    client, _sessions, settings = api
    locked = settings.model_copy(update={"dev_identity_header_override_enabled": False})
    app.dependency_overrides[get_settings] = lambda: locked
    try:
        response = client.get(
            "/v1/projects",
            headers={
                "X-ChemDFT-User-ID": "00000000-0000-4000-8000-000000000999",
                "X-ChemDFT-Organization-ID": settings.dev_organization_id,
            },
        )
        create_response = client.post(
            "/v1/projects",
            json={"name": "Server resolved", "slug": "server-resolved"},
        )
    finally:
        app.dependency_overrides[get_settings] = lambda: settings
    assert response.status_code == 403
    assert response.json()["detail"] == "Development identity is resolved by the server."
    assert create_response.status_code == 201
    assert create_response.json()["organization_id"] == settings.dev_organization_id
