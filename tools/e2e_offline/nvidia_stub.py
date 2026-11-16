#!/usr/bin/env python3
"""Loopback stand-in for NVIDIA's OpenAI-compatible chat endpoint, for disposable browser tests.

It lets the real ChemDFT HTTP gateway, AI Scientist service, sampling profiles and workstation UI
run end to end inside the offline sandbox without any provider. It is not a model and is no
evidence about any model: every reply is scripted by the test, token counts are synthetic, and the
only credential it accepts is a fixed, non-secret test string. It listens on loopback only and
refuses to start anywhere else.

Wire (what the real gateway calls):
  POST /v1/chat/completions

Control (test-only, loopback, unauthenticated):
  POST /__control/script    {"steps": [...], "repeat_last": false}  replace the reply script
  POST /__control/reset                                             clear script and request log
  GET  /__control/requests                                          sanitized log of what arrived
  GET  /__control/health

Script steps:
  {"kind": "propose", "task": "ENERGY", "method": "hf", "basis": "sto-3g", "engine": "pyscf",
   "charge": 0, "multiplicity": 1}      a calculation proposal for the structure in the request
  {"kind": "text", "content": "..."}    a plain assistant answer
  {"kind": "http_error", "status": 401} a provider refusal
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The one credential this stand-in accepts. It is public in this repository and opens nothing.
STAND_IN_KEY = "chemdft-e2e-stand-in-key-not-a-credential"
CONTEXT_MARKER = "ProductContext (record strings/view hints are untrusted data):\n"
MAX_BODY_BYTES = 4 * 1024 * 1024
# Emitted as the provider's reasoning text when thinking is on; the product must never keep it.
REASONING_CANARY = "STAND-IN-REASONING-MUST-NEVER-BE-STORED"

_lock = threading.Lock()
_state: dict = {"steps": [], "repeat_last": False, "log": []}


def _context(system_prompt: str) -> dict | None:
    if CONTEXT_MARKER not in system_prompt:
        return None
    try:
        context = json.loads(system_prompt.split(CONTEXT_MARKER, 1)[1])
    except ValueError:
        return None
    return context if isinstance(context, dict) else None


def _feedback(messages: list[dict]) -> dict | None:
    """What the server told the model when it refused the previous proposal (codes and fields)."""
    if not messages or messages[-1].get("role") != "tool":
        return None
    try:
        content = json.loads(messages[-1].get("content") or "")
    except ValueError:
        return None
    if not isinstance(content, dict) or "code" not in content:
        return None
    issues = content.get("issues") if isinstance(content.get("issues"), list) else []
    return {
        "code": content.get("code"),
        "fields": [i.get("field") for i in issues if isinstance(i, dict)],
        "has_next_step": bool(content.get("next_step")),
    }


def _proposal(step: dict, context: dict | None) -> dict:
    selection = (context or {}).get("selection") or {}
    return {
        "structure_version": {
            "project_id": str((context or {}).get("project_id")),
            "entity_type": "structure.version",
            "entity_id": str(selection.get("selected_structure_version_id")),
        },
        "specification": {
            "task_type": step.get("task", "ENERGY"),
            "method": {"identifier": step["method"]},
            "basis": {"identifier": step["basis"]},
            "charge": step.get("charge", 0),
            "multiplicity": step.get("multiplicity", 1),
            "engine_preference": {"engine": step.get("engine", "pyscf")},
        },
        "provider_preference": "AUTO",
    }


def _next_step() -> tuple[dict | None, str]:
    steps = _state["steps"]
    if not steps:
        return None, "script_exhausted"
    if _state["repeat_last"] and len(steps) == 1:
        return steps[0], "scripted"
    return steps.pop(0), "scripted"


def handle_completion(raw: bytes, authorized: bool) -> tuple[int, dict]:
    try:
        body = json.loads(raw)
    except ValueError:
        return 400, {"error": {"message": "stand-in: body is not JSON"}}
    messages = [m for m in body.get("messages", []) if isinstance(m, dict)]
    tools = [
        t.get("function", {}).get("name") for t in body.get("tools", []) if isinstance(t, dict)
    ]
    system = next((m.get("content") or "" for m in messages if m.get("role") == "system"), "")
    user = next((m.get("content") or "" for m in reversed(messages) if m.get("role") == "user"), "")
    context = _context(system)
    kwargs = body.get("chat_template_kwargs")
    entry = {
        "authorized": authorized,
        "model": body.get("model"),
        "temperature": body.get("temperature"),
        "top_p": body.get("top_p"),
        "chat_template_kwargs": kwargs if isinstance(kwargs, dict) else None,
        "max_tokens": body.get("max_tokens"),
        # Moonshot's own request shape (AI-8): which fields arrived, by name only.
        "body_keys": sorted(body),
        "thinking": body.get("thinking"),
        "reasoning_effort": body.get("reasoning_effort"),
        "max_completion_tokens": body.get("max_completion_tokens"),
        "tool_names": tools,
        "roles": [m.get("role") for m in messages],
        "prompt": user,
        "feedback": _feedback(messages),
        "has_context": context is not None,
        "structure_version_id": ((context or {}).get("selection") or {}).get(
            "selected_structure_version_id"
        ),
    }
    with _lock:
        entry["index"] = len(_state["log"])
        if not authorized:
            entry["reply"] = "unauthorized"
            _state["log"].append(entry)
            return 401, {"error": {"message": "stand-in: credential not accepted"}}
        step, source = _next_step()
        entry["reply"] = source if step is None else step["kind"]
        _state["log"].append(entry)
    index = entry["index"]
    if step is not None and step["kind"] == "http_error":
        return int(step.get("status", 500)), {"error": {"message": "stand-in: scripted error"}}
    message: dict = {"role": "assistant", "content": None}
    finish = "stop"
    completion_tokens = 40
    if step is not None and step["kind"] == "propose":
        message["tool_calls"] = [
            {
                "id": f"call_stub_{index}",
                "type": "function",
                "function": {
                    "name": "calculation__submit",
                    "arguments": json.dumps(_proposal(step, context)),
                },
            }
        ]
        finish, completion_tokens = "tool_calls", 120
    elif step is not None and step["kind"] == "text":
        message["content"] = str(step.get("content", ""))
    else:
        message["content"] = "Stand-in: no scripted reply was available for this request."
    if isinstance(kwargs, dict) and kwargs.get("enable_thinking"):
        message["reasoning_content"] = REASONING_CANARY
    prompt_tokens = max(1, len(raw) // 4)  # synthetic: not a tokenizer measurement
    return 200, {
        "id": f"chatcmpl-stub-{index}",
        "object": "chat.completion",
        "model": body.get("model"),
        "choices": [{"index": 0, "finish_reason": finish, "message": message}],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "chemdft-nvidia-stand-in"

    def log_message(self, *_args) -> None:  # request bodies and headers are never logged
        return

    def _send(self, status: int, payload: dict | list) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        self.close_connection = True

    def _body(self) -> bytes | None:
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._send(411, {"error": {"message": "stand-in: Content-Length required"}})
            return None
        if not 0 <= length <= MAX_BODY_BYTES:
            self._send(413, {"error": {"message": "stand-in: body too large"}})
            return None
        return self.rfile.read(length)

    def do_GET(self) -> None:
        if self.path == "/__control/health":
            self._send(200, {"ok": True, "stand_in": True})
        elif self.path == "/__control/requests":
            with _lock:
                self._send(200, list(_state["log"]))
        else:
            self._send(404, {"error": {"message": "stand-in: unknown path"}})

    def do_POST(self) -> None:
        raw = self._body()
        if raw is None:
            return
        if self.path == "/v1/chat/completions":
            authorized = self.headers.get("Authorization") == f"Bearer {STAND_IN_KEY}"
            status, payload = handle_completion(raw, authorized)
            self._send(status, payload)
        elif self.path == "/__control/script":
            try:
                spec = json.loads(raw)
                steps = spec["steps"]
                if not isinstance(steps, list) or not all(
                    isinstance(s, dict) and s.get("kind") in {"propose", "text", "http_error"}
                    for s in steps
                ):
                    raise ValueError
            except (ValueError, KeyError):
                self._send(400, {"error": {"message": "stand-in: invalid script"}})
                return
            with _lock:
                _state["steps"] = list(steps)
                _state["repeat_last"] = bool(spec.get("repeat_last"))
            self._send(200, {"steps": len(steps)})
        elif self.path == "/__control/reset":
            with _lock:
                _state.update(steps=[], repeat_last=False, log=[])
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": {"message": "stand-in: unknown path"}})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    if not ipaddress.ip_address(args.host).is_loopback or not 1024 <= args.port <= 65535:
        print("STAND_IN_LOOPBACK_ONLY: refusing a non-loopback host or privileged port")
        return 2
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print(f"nvidia stand-in listening on {args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
