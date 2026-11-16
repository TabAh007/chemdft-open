#!/usr/bin/env python3
"""RETIRED live probe; the offline dry run remains.

The live `--send` form is permanently disabled. Its one-request limiter wrapped
`urllib.request.urlopen`, but the model gateway has used `open_response` since AI-1, so the limiter
no longer observed or limited the real request. `--send` and `--key-file` now refuse before reading
any credential or opening any socket. Live NVIDIA verification belongs to `tools/nvidia_probe/`
(typed authorization, exact allowlist, call/token/spend/wall-clock ceilings, no retries,
no fallback).

What remains: a DRY RUN that reads a captured wire payload, records the INPUT_RESERVATION_V2
estimate and makes no network request and reads no credential.

    uv run --offline --frozen python tools/nvidia_usage_probe.py --out-dir DIR            # dry run
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from chemdft_api.ai.token_policy import bound_from_bytes, payload_byte_parts

PROBE_VERSION = "nvidia-usage-probe/1"
PROVIDER = "nvidia"
MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"
BASE_URL = "https://integrate.api.nvidia.com/v1"
EXPECTED_URL = f"{BASE_URL}/chat/completions"
RETIRED_MESSAGE = (
    "RETIRED: the live form of this utility is permanently disabled (its request limiter no longer "
    "intercepts the gateway transport). Use tools/nvidia_probe/ with a typed authorization."
)
DEFAULT_PAYLOAD = (
    Path(__file__).resolve().parents[1] / "docs/implementation/measurements/planning_call1.json"
)
MAX_PAYLOAD_BYTES = 200_000


class ProbeError(SystemExit):
    """Refusal with a fixed, secret-free message."""


def load_payload(path: Path) -> tuple[list[dict], list[dict]]:
    raw = path.read_bytes()
    if len(raw) > MAX_PAYLOAD_BYTES:
        raise ProbeError("Payload is larger than the probe allows")
    data = json.loads(raw)
    messages, tools = data.get("messages"), data.get("tools") or []
    if not isinstance(messages, list) or not messages or messages[0].get("role") != "system":
        raise ProbeError("Payload must start with a system message")
    if any(m.get("role") != "user" or "tool_calls" in m for m in messages[1:]):
        raise ProbeError("Only a single planning request (system + user messages) is supported")
    if any(not isinstance(t.get("function"), dict) for t in tools):
        raise ProbeError("Tool definitions must use the wire function format")
    return messages, tools


def estimates(messages, tools, floor) -> dict[str, object]:
    static, dynamic = payload_byte_parts(messages, tools)
    both = {
        str(f): bound_from_bytes(static + dynamic, len(messages), len(tools), f, dynamic).tokens
        for f in sorted({floor, 1.0})
    }
    return {
        "static_bytes": static,
        "dynamic_bytes": dynamic,
        "request_bytes": static + dynamic,
        "message_count": len(messages),
        "tool_count": len(tools),
        "policy": "INPUT_RESERVATION_V2",
        "basis": "BYTE_HEURISTIC_NOT_A_GUARANTEE",
        "estimated_input_tokens_by_floor": both,
    }


def write_private(path: Path, data: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(data)


def compare(estimate: dict, floor: float, usage: dict | None, local_tokens: int | None) -> dict:
    reserved = estimate["estimated_input_tokens_by_floor"][str(floor)]
    out: dict[str, object] = {
        "reserved_input_tokens_at_floor": reserved,
        "floor": floor,
        "provider_usage_object": usage,
        "local_tokenizer_tokens": local_tokens,
        "local_tokenizer_note": "published tokenizer, not NVIDIA hosted usage",
    }
    prompt = (usage or {}).get("prompt_tokens")
    if isinstance(prompt, int) and prompt > 0:
        out.update(
            provider_reported_prompt_tokens=prompt,
            reservation_covers_reported=reserved >= prompt,
            reservation_over_reported=round(reserved / prompt, 3),
            conservative_fallback_covers_reported=(
                estimate["estimated_input_tokens_by_floor"]["1.0"] >= prompt
            ),
            request_bytes_per_reported_token=round(estimate["request_bytes"] / prompt, 3),
        )
        if local_tokens:
            out["reported_minus_local"] = prompt - local_tokens
    else:
        out["provider_reported_prompt_tokens"] = None
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--payload", type=Path, default=DEFAULT_PAYLOAD)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--key-file", type=Path, help="RETIRED: never read")
    parser.add_argument("--max-output-tokens", type=int, default=512)
    parser.add_argument("--floor", type=float, default=2.0)
    parser.add_argument("--local-token-count", type=int)
    parser.add_argument("--send", action="store_true", help="RETIRED: always refused")
    args = parser.parse_args(argv)
    if args.send or args.key_file is not None:
        raise ProbeError(RETIRED_MESSAGE)  # before any credential read, output or socket
    if not 512 <= args.max_output_tokens <= 2048:
        raise ProbeError("--max-output-tokens must be between 512 (provider minimum) and 2048")
    if args.out_dir.exists():
        raise ProbeError("The output directory must not exist; evidence is never overwritten")
    messages, tools = load_payload(args.payload)
    estimate = estimates(messages, tools, args.floor)
    reserved = estimate["estimated_input_tokens_by_floor"][str(args.floor)]
    receipt: dict[str, object] = {
        "probe": PROBE_VERSION,
        "mode": "DRY_RUN",
        "at": datetime.now(UTC).isoformat(),
        "provider": PROVIDER,
        "model": MODEL,
        "endpoint": EXPECTED_URL,
        "payload_sha256": hashlib.sha256(args.payload.read_bytes()).hexdigest(),
        "max_output_tokens": args.max_output_tokens,
        "estimate": estimate,
        "network_requests": 0,
    }
    args.out_dir.mkdir(mode=0o700)
    receipt["comparison"] = compare(estimate, args.floor, None, args.local_token_count)
    write_private(
        args.out_dir / "plan.json",
        (json.dumps(receipt, indent=2, sort_keys=True) + "\n").encode(),
    )
    print(json.dumps({"mode": receipt["mode"], "estimate": reserved, "out_dir": str(args.out_dir)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
