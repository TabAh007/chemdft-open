"""Worker entry point. One subprocess per request; every command is a pure function of its inputs.

    python -s -m chemdft_spectra_worker.cli resolve   --input <source file> --request <json> --output <json> --arrays-out <f64>
    python -s -m chemdft_spectra_worker.cli transform --request <json> --arrays-in <f64> --output <json> --arrays-out <f64> [--aux-out <f64>]
    python -s -m chemdft_spectra_worker.cli peaks     --request <json> --arrays-in <f64> --output <json>
    python -s -m chemdft_spectra_worker.cli compare   --request <json> --output <json> [--arrays-in <f64>]

Arrays travel as raw float64 little-endian files: x (n values) then y (n values); `point_count` in the request gives n.
Domain refusals (bad parameters, unsupported units) are written as {"error": {...}} with exit code 0 so the parent can
report them as validation failures; anything unexpected exits non-zero.
"""
# ruff: noqa: E501  (long evidence strings, scientific symbols and human-readable diagnostics)

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

from . import limits
from .canonical import array_bytes, body_sha256, canonical_json

REQUEST_MAX_BYTES = 8 * 1024 * 1024


def _read_request(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    if len(raw) > REQUEST_MAX_BYTES:
        raise ValueError("request too large")
    return json.loads(raw)


def _read_arrays(path: Path, point_count: int) -> tuple[np.ndarray, np.ndarray]:
    data = path.read_bytes()
    if len(data) != point_count * 16:
        raise ValueError(f"array file is {len(data)} bytes; expected {point_count * 16} for {point_count} points")
    flat = np.frombuffer(data, dtype="<f8")
    return flat[:point_count].astype(float), flat[point_count:].astype(float)


def _write(path: Path, payload: dict[str, Any], started: float) -> None:
    payload["worker"] = {"elapsed_seconds": round(time.monotonic() - started, 3)}
    path.write_bytes(canonical_json(payload))


def _refusal(path: Path, code: str, message: str, started: float) -> int:
    _write(path, {"error": {"code": code, "message": message}}, started)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("resolve", "transform", "peaks", "compare"))
    parser.add_argument("--input", type=Path)
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--arrays-in", type=Path)
    parser.add_argument("--arrays-out", type=Path)
    parser.add_argument("--aux-out", type=Path)
    parser.add_argument("--cpu-seconds", type=int, default=limits.DEFAULT_CPU_SECONDS)
    parser.add_argument("--memory-bytes", type=int, default=limits.DEFAULT_MEMORY_BYTES)
    args = parser.parse_args(argv)
    limits.apply_process_limits(args.cpu_seconds, args.memory_bytes)
    started = time.monotonic()
    request = _read_request(args.request)

    if args.command == "resolve":
        from .preview import resolve_preview

        if args.input is None:
            raise ValueError("resolve needs --input")
        preview = resolve_preview(args.input.read_bytes(), str(request.get("technique", "")), request.get("choices") or {})
        if args.arrays_out is not None and preview.arrays is not None:
            args.arrays_out.write_bytes(preview.arrays.artifact_bytes())
        _write(args.output, {"preview": preview.body, "preview_sha256": preview.preview_sha256, "has_arrays": preview.arrays is not None}, started)
        return 0

    from .compare import CompareError, compare
    from .transforms import TransformError, Version, detect_peaks, run_transform

    if args.command in ("transform", "peaks"):
        if args.arrays_in is None:
            raise ValueError(f"{args.command} needs --arrays-in")
        x, y = _read_arrays(args.arrays_in, int(request["point_count"]))
        parent = Version(x, y, request["x_unit"], request["y_quantity"], request["y_unit"], request.get("representation", "ABSOLUTE"))
        has_error = bool(request.get("input_has_y_error", False))
        try:
            if args.command == "peaks":
                record = detect_peaks(parent, request.get("params") or {}, has_error)
                _write(args.output, {"record": record, "record_sha256": body_sha256(record)}, started)
                return 0
            result = run_transform(str(request["op"]), request.get("params") or {}, parent, has_error)
        except TransformError as exc:
            return _refusal(args.output, exc.code, exc.message, started)
        if args.arrays_out is None:
            raise ValueError("transform needs --arrays-out")
        args.arrays_out.write_bytes(array_bytes(result.version.x) + array_bytes(result.version.y))
        if args.aux_out is not None and "baseline" in result.version.aux:
            args.aux_out.write_bytes(array_bytes(result.version.aux["baseline"]))
        _write(args.output, {"record": result.record, "record_sha256": body_sha256(result.record)}, started)
        return 0

    exp_arrays = None
    if args.arrays_in is not None:
        exp_arrays = _read_arrays(args.arrays_in, int(request["experimental"]["point_count"]))
    try:
        record = compare(request, exp_arrays)
    except CompareError as exc:
        return _refusal(args.output, exc.code, exc.message, started)
    _write(args.output, {"record": record, "record_sha256": body_sha256(record)}, started)
    return 0


if __name__ == "__main__":
    sys.exit(main())
