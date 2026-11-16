#!/usr/bin/env python3
"""Reproduce a legacy importer record inside a validated disposable E2E database.

The patch exists only in this short-lived fixture process. The running API keeps
its normal import and calculation rejection rules throughout the test.
"""

import json
import os
import sys
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/api/src"))


def main() -> None:
    from chemdft_api.config import get_settings
    from chemdft_api.test_environment import TestEnvironmentError, validate_test_process

    if os.environ.get("CHEMDFT_TEST_MODE") != "1":
        raise TestEnvironmentError("TEST_MODE_MISSING: fixtures require the isolated E2E runner")
    validate_test_process(get_settings(), ROOT)

    # Import the database/app only after the guard has passed.
    from chemdft_api.main import app
    from fastapi.testclient import TestClient

    data = json.load(sys.stdin)
    if data.get("fixture") != "legacy-raw-2d":
        raise ValueError("TEST_FIXTURE_UNKNOWN: expected legacy-raw-2d")
    project = str(data["project_id"])
    with TestClient(app) as client:
        with patch(
            "chemdft_api.scientific.adapters.molecular.rdkit_adapter.require_computational_mol",
            lambda mol: None,
        ):
            response = client.post(
                f"/v1/projects/{project}/structures/imports",
                data={"file_format": "MOL", "structure_name": "Isolated legacy raw 2D n-Hexane",
                      "idempotency_key": f"legacy-fixture-{uuid4()}"},
                files={"upload": ("legacy-drawing.mol", data["mol_block"].encode(), "chemical/x-mdl-molfile")},
            )
        if response.status_code != 201:
            raise RuntimeError(f"TEST_FIXTURE_IMPORT_FAILED: {response.status_code} {response.text}")
        imported = response.json()
    print(json.dumps({"project_id": project, "structure_id": imported["structure"]["id"],
                      "version_id": imported["version"]["id"]}))


if __name__ == "__main__":
    main()
