"""Commands against the isolated PF-7 browser fixture only, never the user's projects."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
os.environ.update(
    {
        "CHEMDFT_ENVIRONMENT": "test",
        "CHEMDFT_AI_PROVIDER": "fake",
        "CHEMDFT_AI_API_KEY": "",
        "CHEMDFT_RUN_AI_INTEGRATION": "false",
        "CHEMDFT_DATABASE_URL": "sqlite:////private/tmp/chemdft-pf7-browser.db",
        "CHEMDFT_OBJECT_ROOT": "/private/tmp/chemdft-pf7-browser-objects",
        "CHEMDFT_SCIENTIFIC_WORKER_PYTHON": str(
            ROOT / "services/scientific-worker/.venv/bin/python"
        ),
        "CHEMDFT_AUTO_CREATE_SCHEMA": "true",
    }
)


def main():
    from chemdft_api.database import SessionLocal
    from chemdft_api.models import ProjectMember
    from sqlalchemy import update

    if sys.argv[1] == "compute":
        from chemdft_api.compute_worker import run_once

        # Existing engine path and Firewall; no test value is inserted.
        assert run_once(worker_id="pf7-isolated-browser-worker")
    elif sys.argv[1] == "viewer":
        from uuid import UUID

        project = str(UUID(sys.argv[2]))
        with SessionLocal() as session:
            changed = session.execute(
                update(ProjectMember)
                .where(ProjectMember.project_id == project)
                .values(role="viewer")
            )
            assert changed.rowcount == 1
            session.commit()
    else:
        raise RuntimeError("Unsupported isolated fixture action")


if __name__ == "__main__":
    main()
