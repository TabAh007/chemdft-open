# ruff: noqa: E501  (long literals and messages in test data)
"""Reusable multi-user authorization test helper (PF-1; PF-2 extends it across the API surface).

`MultiUserEnv` runs the real FastAPI app in `jwt` auth mode against a throw-away database with a
throw-away Ed25519 key pair standing in for the trusted web layer. `actor("alice")` returns a person
who is provisioned on first use exactly as in production (first verified token -> ChemDFT user,
personal organization, owner membership) and whose requests carry a freshly signed token.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field

import jwt
from chemdft_api.config import Settings
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

ISSUER = "https://chemdft.test"
AUDIENCE = "chemdft-api"
KID = "test-key-1"


class SigningKey:
    def __init__(self, kid: str = KID) -> None:
        self.kid = kid
        self.private = Ed25519PrivateKey.generate()

    def jwk(self) -> dict:
        public = json.loads(jwt.algorithms.OKPAlgorithm.to_jwk(self.private.public_key()))
        return {**public, "kid": self.kid, "alg": "EdDSA", "use": "sig"}

    def jwks_json(self) -> str:
        return json.dumps({"keys": [self.jwk()]})

    def sign(self, claims: dict, *, algorithm: str = "EdDSA", kid: str | None = None) -> str:
        return jwt.encode(
            claims, self.private, algorithm=algorithm, headers={"kid": kid or self.kid}
        )


def claims_for(
    subject: str,
    email: str,
    *,
    name: str | None = None,
    issuer: str = ISSUER,
    audience: str = AUDIENCE,
    lifetime: int = 900,
    issued_ago: int = 0,
    **extra: object,
) -> dict:
    now = int(time.time()) - issued_ago
    return {
        "iss": issuer,
        "aud": audience,
        "sub": subject,
        "iat": now,
        "exp": now + lifetime,
        "email": email,
        "name": name or email.split("@")[0],
        **extra,
    }


def jwt_settings(database_url: str, object_root, keys: SigningKey, **overrides) -> Settings:
    values = dict(
        ai_provider="fake",
        ai_api_key=None,
        run_ai_integration=False,
        database_url=database_url,
        object_root=object_root,
        auto_create_schema=True,
        auth_mode="jwt",
        dev_identity_enabled=False,
        dev_identity_header_override_enabled=False,
        auth_issuer=ISSUER,
        auth_audience=AUDIENCE,
        auth_jwks_json=keys.jwks_json(),
    )
    values.update(overrides)
    return Settings(**values)


@dataclass
class Actor:
    """One signed-in person. Every request carries a newly signed token unless overridden."""

    env: MultiUserEnv
    name: str
    subject: str
    email: str
    _me: dict | None = field(default=None, repr=False)

    def token(self, **claim_overrides: object) -> str:
        return self.env.keys.sign(claims_for(self.subject, self.email, **claim_overrides))

    def headers(self, extra: dict | None = None) -> dict:
        return {"Authorization": f"Bearer {self.token()}", **(extra or {})}

    def request(self, method: str, path: str, **kwargs):
        headers = {**self.headers(), **kwargs.pop("headers", {})}
        return self.env.client.request(method, path, headers=headers, **kwargs)

    def get(self, path: str, **kw):
        return self.request("GET", path, **kw)

    def post(self, path: str, **kw):
        return self.request("POST", path, **kw)

    def put(self, path: str, **kw):
        return self.request("PUT", path, **kw)

    def delete(self, path: str, **kw):
        return self.request("DELETE", path, **kw)

    @property
    def me(self) -> dict:
        if self._me is None:
            response = self.get("/v1/me")
            assert response.status_code == 200, response.text
            self._me = response.json()
        return self._me

    @property
    def user_id(self) -> str:
        return self.me["id"]

    @property
    def organization_id(self) -> str:
        return self.me["organization"]["id"]

    def create_project(self, slug: str, name: str | None = None) -> dict:
        response = self.post("/v1/projects", json={"name": name or slug, "slug": slug})
        assert response.status_code == 201, response.text
        return response.json()


@dataclass
class MultiUserEnv:
    client: TestClient
    sessions: sessionmaker[Session]
    settings: Settings
    keys: SigningKey
    _actors: dict[str, Actor] = field(default_factory=dict)

    def actor(self, name: str) -> Actor:
        if name not in self._actors:
            self._actors[name] = Actor(self, name, f"ba_{name}_subject", f"{name}@example.test")
        return self._actors[name]


def project_get_paths() -> list[str]:
    """Every parameter-free project-scoped GET route of the live app (new routes included)."""
    from chemdft_api.main import app

    prefix = "/v1/projects/{project_id}"
    paths = {
        route.path.removeprefix(prefix)
        for route in app.routes
        if hasattr(route, "methods")
        and "GET" in route.methods
        and route.path.startswith(prefix)
        and "{" not in route.path.removeprefix(prefix)
    }
    return sorted(paths)


# --- legacy ownership helpers (PF-2) -----------------------------------------------------------

LEGACY_USER_ID = "00000000-0000-4000-8000-000000000001"
LEGACY_ORG_ID = "00000000-0000-4000-8000-000000000010"


def seed_legacy_workspace(env: MultiUserEnv, claimable: int = 2, frozen: int = 1) -> dict:
    """The pre-account world: the LEGACY_LOCAL user and organization with real project content.

    Content is created through the real API under the fixed development identity (a temporary
    dependency override, exactly what dev mode did), so provenance and `created_by` are genuine.
    """
    from chemdft_api.auth import require_identity
    from chemdft_api.context import Identity
    from chemdft_api.main import app
    from chemdft_api.models import (
        Membership,
        Organization,
        OrganizationKind,
        Project,
        ProjectKind,
        User,
        UserKind,
    )

    with env.sessions() as session:
        session.add(
            Organization(
                id=LEGACY_ORG_ID,
                name="ChemDFT local development",
                kind=OrganizationKind.LEGACY_LOCAL,
            )
        )
        session.add(
            User(
                id=LEGACY_USER_ID,
                email="developer@localhost.invalid",
                display_name="Local developer",
                kind=UserKind.LEGACY_LOCAL,
            )
        )
        session.flush()
        session.add(Membership(organization_id=LEGACY_ORG_ID, user_id=LEGACY_USER_ID, role="owner"))
        session.commit()
    previous = app.dependency_overrides.get(require_identity)
    app.dependency_overrides[require_identity] = lambda: Identity(
        user_id=LEGACY_USER_ID, organization_id=LEGACY_ORG_ID
    )
    projects: dict[str, dict] = {}
    try:
        for index in range(claimable + frozen):
            frozen_one = index >= claimable
            name = f"{'frozen' if frozen_one else 'legacy'}-{index}"
            created = env.client.post("/v1/projects", json={"name": name, "slug": name})
            assert created.status_code == 201, created.text
            project = created.json()
            imported = env.client.post(
                f"/v1/projects/{project['id']}/structures/imports",
                files={"upload": ("h2.xyz", b"2\nH2\nH 0 0 -0.37\nH 0 0 0.37\n", "chemical/x-xyz")},
                data={
                    "file_format": "XYZ",
                    "idempotency_key": f"legacy-import-{index}",
                    "structure_name": "H2",
                },
            )
            assert imported.status_code == 201, imported.text
            with env.sessions() as session:
                session.get(Project, project["id"]).kind = (
                    ProjectKind.ACCEPTANCE_FROZEN if frozen_one else ProjectKind.LEGACY_LOCAL
                )
                session.commit()
            projects[name] = {
                **project,
                "frozen": frozen_one,
                "structure": imported.json()["structure"]["id"],
                "version": imported.json()["version"]["id"],
            }
    finally:
        if previous is None:
            app.dependency_overrides.pop(require_identity, None)
        else:
            app.dependency_overrides[require_identity] = previous
    return projects


def database_snapshot(env: MultiUserEnv, exclude: frozenset[str] = frozenset()) -> dict[str, str]:
    """A content hash per table (every column of every row, ordered), to prove what did not change."""
    import hashlib

    from chemdft_api.database import Base
    from sqlalchemy import select

    snapshot = {}
    with env.sessions() as session:
        for table in Base.metadata.sorted_tables:
            if table.name in exclude:
                continue
            rows = session.execute(select(table).order_by(*table.primary_key.columns)).all()
            snapshot[table.name] = hashlib.sha256(
                repr([tuple(map(str, row)) for row in rows]).encode()
            ).hexdigest()
    return snapshot
