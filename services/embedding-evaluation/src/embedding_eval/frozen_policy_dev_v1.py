"""DEV-only access to the pinned policy-development judgments.

Historical combined/holdout artifacts are not inputs to this module.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

EVAL_ROOT = Path(__file__).resolve().parents[2]
DEV_QRELS_PATH = EVAL_ROOT / "retrieval-policy-dev-v1-dev-qrels.json"
DEV_FILE_SHA256 = "08402888b2e1dfe3f5571745d109122ea522a244f8f565dc2e30c933ecacc537"


def load_dev_qrels() -> list[dict[str, Any]]:
    """Read exactly the frozen DEV file, without discovery or partition selection."""
    raw = DEV_QRELS_PATH.read_bytes()
    if hashlib.sha256(raw).hexdigest() != DEV_FILE_SHA256:
        raise ValueError("DEV artifact digest mismatch.")
    artifact = json.loads(raw)
    if artifact.get("benchmark_id") != "retrieval-policy-dev-v1":
        raise ValueError("Unexpected DEV benchmark.")
    if artifact.get("status") != "FROZEN" or artifact.get("partition") != "DEV":
        raise ValueError("Expected the frozen DEV partition.")
    return artifact["qrels"]
