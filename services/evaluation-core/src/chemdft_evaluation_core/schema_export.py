"""Deterministic committed schema generation."""

from __future__ import annotations

import argparse
from pathlib import Path

from .canonicalization import canonical_json
from .schema import ChemDFTBenchmark


def schema_bytes() -> bytes:
    return canonical_json(ChemDFTBenchmark.model_json_schema()) + b"\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    path = Path(__file__).resolve().parents[2] / "schemas" / "chemdft-benchmark-v1.schema.json"
    if args.check:
        if path.read_bytes() != schema_bytes():
            raise SystemExit("committed benchmark JSON Schema is stale")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(schema_bytes())


if __name__ == "__main__":
    main()
