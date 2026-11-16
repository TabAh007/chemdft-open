"""Regenerate the frozen probe fixture OFFLINE from the real planning pipeline.

Runs the production AI Scientist service in-process against a disposable SQLite database with the
local fake gateway replaced by a recorder: it captures, byte for byte, the system prompt, the
EnergyPlanningContext and the two tool schemas that production would send for the supplied-H2
PySCF energy proposal. It makes no network request, reads no credentials and runs no calculation.

Run only through the offline sandbox, with the clean environment of
tools/run_isolated_e2e.offline_environment():
  sandbox-exec -f tools/e2e_offline/loopback-only.sb \\
    .venv/bin/python -B tools/nvidia_probe/capture_fixture.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "services/api/src"))
OUT = HERE / "fixtures/h2_probe_v1.json"
PROMPT = "Calculate the HF/STO-3G single-point energy for H2 with charge 0 and multiplicity 1."
XYZ = b"2\nSupplied H2 reference | chemdft:charge=0;multiplicity=1\nH 0 0 -0.37\nH 0 0 0.37\n"


def main() -> int:
    if os.environ.get("CHEMDFT_E2E_OFFLINE") != "1" and "--i-know-this-is-offline" not in sys.argv:
        print("Refusing: run under the offline sandbox environment (CHEMDFT_E2E_OFFLINE=1).")
        return 2
    work = Path(tempfile.mkdtemp(prefix="chemdft-probe-capture-", dir="/tmp"))
    os.environ.update(
        CHEMDFT_TEST_MODE="1",
        CHEMDFT_ENVIRONMENT="test",
        CHEMDFT_TEST_WORKSPACE=str(work),
        CHEMDFT_DATABASE_URL=f"sqlite:///{work / 'c.db'}",
        CHEMDFT_OBJECT_ROOT=str(work / "objects"),
        CHEMDFT_DEV_IDENTITY_ENABLED="true",
        CHEMDFT_DEV_USER_ID=str(uuid4()),
        CHEMDFT_DEV_ORGANIZATION_ID=str(uuid4()),
        CHEMDFT_AI_PROVIDER="fake",
        CHEMDFT_RUN_AI_INTEGRATION="false",
        CHEMDFT_AUTO_CREATE_SCHEMA="true",
    )
    from chemdft_api.ai.gateway import FakeModelGateway, ModelResponse, ModelUsage
    from chemdft_api.auth import ensure_dev_identity
    from chemdft_api.config import Settings, get_settings
    from chemdft_api.database import Base, get_session
    from chemdft_api.main import app
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    settings = Settings(_env_file=None)
    engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with sessions() as session:
        ensure_dev_identity(session, settings)

    def override():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_session] = override
    captured = []

    def record(_gateway, request):
        captured.append(request)
        return ModelResponse(
            content="captured",
            usage=ModelUsage(1, 1, 1),
            model_identifier=request.model_identifier or "fake-standard",
            provider="fake",
        )

    FakeModelGateway.generate = record
    with TestClient(app) as client:
        project = client.post(
            "/v1/projects", json={"name": "probe fixture", "slug": f"p-{uuid4().hex[:8]}"}
        ).json()
        imported = client.post(
            f"/v1/projects/{project['id']}/structures/imports",
            files={"upload": ("h2.xyz", XYZ, "chemical/x-xyz")},
            data={"file_format": "XYZ", "idempotency_key": str(uuid4())},
        ).json()
        conversation = client.post(
            f"/v1/projects/{project['id']}/ai/conversations", json={}
        ).json()["conversation"]["id"]
        response = client.post(
            f"/v1/projects/{project['id']}/ai/conversations/{conversation}/messages",
            json={
                "content": PROMPT,
                "mode": "STANDARD",
                "planning_profile": "PYSCF_ENERGY_PROPOSAL",
                "selected_structure_version_id": imported["version"]["id"],
            },
        )
        assert response.status_code == 201, response.text
    assert len(captured) == 1, f"expected one planning request, captured {len(captured)}"
    request = captured[0]
    fixture = {
        "fixture": "chemdft-probe-h2-v1",
        "structure_id": str(
            imported["structure"]["id"]
            if "structure" in imported
            else imported["version"]["structure_id"]
        ),
        "version_id": str(imported["version"]["id"]),
        "user_prompt": PROMPT,
        "proposal_request": {
            "system_prompt": request.system_prompt,
            "messages": [{"role": m.role, "content": m.content} for m in request.messages],
            "tools": [
                {
                    "name": t.name,
                    "description": t.description,
                    "parameters_schema": t.parameters_schema,
                }
                for t in request.tools
            ],
            "temperature": request.temperature,
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(fixture, indent=1, sort_keys=True) + "\n"
    OUT.write_text(text)
    OUT.with_suffix(".sha256").write_text(hashlib.sha256(text.encode()).hexdigest() + "\n")
    print(
        f"captured {OUT.name}: {len(text)} bytes, {len(fixture['proposal_request']['tools'])} tools"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
