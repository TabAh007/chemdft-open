# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .bundle import ContractBundle

REPOSITORY_ROOT = Path(__file__).resolve().parents[5]
SCHEMA_PATH = REPOSITORY_ROOT / "packages/schemas/generated/chemdft-contracts.schema.json"


def rendered_schema() -> str:
    schema = ContractBundle.model_json_schema(mode="serialization")
    schema["$id"] = "https://schemas.chemdft.local/contracts/1.0.0"
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["description"] = "Generated from ChemDFT Pydantic contracts. Do not edit."
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = rendered_schema()
    if args.check:
        if not SCHEMA_PATH.exists() or SCHEMA_PATH.read_text() != expected:
            raise SystemExit("Generated JSON Schema is stale; run pnpm schemas:generate")
        return
    SCHEMA_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCHEMA_PATH.write_text(expected)


if __name__ == "__main__":
    main()
