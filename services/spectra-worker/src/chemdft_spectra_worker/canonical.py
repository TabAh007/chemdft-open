"""Canonical JSON and array hashing shared by the preview, transform and comparison records."""
# ruff: noqa: E501  (long evidence strings, scientific symbols and human-readable diagnostics)

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

import numpy as np


def _clean(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if isinstance(value, np.ndarray):
        return _clean(value.tolist())
    if isinstance(value, (np.floating, float)):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("canonical JSON refuses NaN and infinity")
        return number
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    return value


def canonical_json(value: Any) -> bytes:
    return json.dumps(_clean(value), sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def body_sha256(body: Any) -> str:
    return sha256_hex(canonical_json(body))


def array_bytes(array: np.ndarray) -> bytes:
    """Float64 little-endian, C-contiguous: the exact stored representation (and therefore the hash input)."""
    return np.ascontiguousarray(array, dtype="<f8").tobytes()


def array_sha256(array: np.ndarray) -> str:
    return sha256_hex(array_bytes(array))
