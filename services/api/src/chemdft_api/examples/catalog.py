import hashlib
import json
from datetime import datetime
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]


def canonical_json(value) -> bytes:
    def stable(item):
        return item.replace(tzinfo=None).isoformat() if isinstance(item, datetime) else str(item)

    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=stable).encode()


@lru_cache(maxsize=1)
def catalogue() -> tuple[dict, ...]:
    return tuple(json.loads((ROOT / "examples/catalog.json").read_text())["examples"])


def definition(slug: str) -> dict | None:
    return next((item for item in catalogue() if item["slug"] == slug), None)


def manifest_hash(spec: dict) -> str:
    return hashlib.sha256(canonical_json(spec)).hexdigest()
