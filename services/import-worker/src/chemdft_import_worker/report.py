"""Preview report assembly. The hashed `body` excludes everything that varies between runs (timestamps, file name, timings)."""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import hashlib
import json

from . import (
    IMPORTER_VERSION,
    NORMALIZATION_VERSION,
    PARSER_INFO,
    REPORT_SCHEMA,
    REPORT_SCHEMA_VERSION,
)


def canonical_json(value) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False, ensure_ascii=True) + "\n").encode("ascii")


def body_sha256(body: dict) -> str:
    return hashlib.sha256(canonical_json(body)).hexdigest()


def new_body(source: dict) -> dict:
    return {
        "importer_version": IMPORTER_VERSION,
        "normalization_version": NORMALIZATION_VERSION,
        "parser": dict(PARSER_INFO),
        "source": source,
        "status": "REJECTED",
        "program": {"engine": None, "version": None, "label": None},
        "job": None,
        "jobs": [],
        "items": [],
        "results": [],
        "diagnostics": [],
        "cclib": None,
    }


def finalize(body: dict) -> dict:
    return {"schema": REPORT_SCHEMA, "schema_version": REPORT_SCHEMA_VERSION, "body": body, "preview_sha256": body_sha256(body)}
