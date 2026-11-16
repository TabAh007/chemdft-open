# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Cooperative shutdown of an owned CREST execution, including publication cleanup.

Only the main thread may install Python signal handlers. Nested native/gateway
scopes share one request; the outer owner exits after its cleanup and lock release.
No process discovery or name-based killing is performed here.
"""

from __future__ import annotations

import signal
import threading
from contextlib import contextmanager

_requested: int | None = None
_installed = False


def shutdown_signal() -> int | None:
    return _requested


@contextmanager
def crest_shutdown_scope():
    global _installed, _requested
    if _installed or threading.current_thread() is not threading.main_thread():
        yield
        return

    def request(signum, _frame):
        global _requested
        if _requested is None:
            _requested = signum

    previous = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
    _requested = None
    _installed = True
    try:
        for s in previous:
            signal.signal(s, request)
        yield
    finally:
        requested = _requested
        for s, handler in previous.items():
            signal.signal(s, handler)
        _installed = False
        _requested = None
        if requested is not None:
            raise SystemExit(128 + requested)
