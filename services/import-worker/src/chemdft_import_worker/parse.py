"""The ONLY place cclib is imported and called.

cclib is given a server-created, extension-less, local `pathlib.Path` (never a `str`, never a URL): its FileWrapper fetches URLs only for
`str` sources matching a URL pattern and chooses gz/zip/bz2 readers only by file extension (verified in the pinned source). As defence in
depth, every network and archive reader is replaced by an instrumented stub while parsing; a recorded attempt is a hard failure.
"""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import bisect
import bz2
import contextlib
import gzip
import io
import logging
import lzma
import socket
import tempfile
import urllib.request
import warnings
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

BLOCKED_ATTEMPTS: list[str] = []


class _Blocked(AssertionError):
    pass


@contextlib.contextmanager
def network_and_archives_blocked():
    import cclib.parser.logfilewrapper as lfw

    def boom(*args, **kwargs):
        BLOCKED_ATTEMPTS.append("network/archive reader called")
        raise _Blocked("network/archive reader used")

    targets = {
        "urlopen": (urllib.request, "urlopen"), "gzip.open": (gzip, "open"), "gzip.GzipFile": (gzip, "GzipFile"), "bz2.open": (bz2, "open"),
        "bz2.BZ2File": (bz2, "BZ2File"), "lzma.open": (lzma, "open"), "zipfile.ZipFile": (zipfile, "ZipFile"), "lfw.urlopen": (lfw, "urlopen"),
        "socket.connect": (socket.socket, "connect"),
    }
    originals = {k: getattr(o, n) for k, (o, n) in targets.items()}
    for o, n in targets.values():
        setattr(o, n, boom)
    try:
        yield
    finally:
        for k, (o, n) in targets.items():
            setattr(o, n, originals[k])


@dataclass
class ParseResult:
    data: object | None
    error: str | None
    error_logs: list[str] = field(default_factory=list)
    success_flag: object = None  # cclib metadata["success"]: True / False / "absent" -- recorded, NEVER trusted
    blocked_attempts: int = 0
    locators: dict[str, dict] = field(default_factory=dict)  # attribute -> {"line_start","line_end"} (block level, 1-based, file-relative)


def parse_segment(text: str, segment_line_offset: int = 0) -> ParseResult:
    warnings.filterwarnings("ignore")
    from cclib.io import ccopen
    from cclib.parser import ORCA, Gaussian, ccData

    encoded = text.encode("utf-8")
    line_starts = [0]
    pos = encoded.find(b"\n")
    while pos != -1:
        line_starts.append(pos + 1)
        pos = encoded.find(b"\n", pos + 1)
    attrs = list(ccData._attributes)
    seen: dict[str, dict] = {}
    stream = io.StringIO()
    attempts_before = len(BLOCKED_ATTEMPTS)
    with tempfile.TemporaryDirectory(prefix="chemdft-import-") as tmp:
        path = Path(tmp) / "joboutput"  # server-created; no user-controlled characters; no extension
        path.write_bytes(encoded)
        try:
            with network_and_archives_blocked():
                parser = ccopen(path, loglevel=logging.ERROR, logstream=stream)
                if parser is None:
                    return ParseResult(None, "cclib could not recognise the program output")
                engine_cls = type(parser)
                if engine_cls in (Gaussian, ORCA):
                    parser = _tracked(engine_cls, path, stream, line_starts, attrs, seen)
                data = parser.parse()
        except Exception as error:
            return ParseResult(None, f"{type(error).__name__}: {str(error)[:160]}", blocked_attempts=len(BLOCKED_ATTEMPTS) - attempts_before)
    blocked = len(BLOCKED_ATTEMPTS) - attempts_before
    logs = [line for line in stream.getvalue().splitlines() if "ERROR" in line]
    meta = getattr(data, "metadata", None) or {}
    locators = {k: {"line_start": v["first"] + segment_line_offset, "line_end": v["last"] + segment_line_offset} for k, v in seen.items()}
    return ParseResult(data, None, logs, meta.get("success", "absent"), blocked, locators)


def _fingerprint(value):
    try:
        if isinstance(value, np.ndarray):
            return (value.shape, float(value.ravel()[-1]) if value.size else None)
        if isinstance(value, (list, tuple, dict)):
            return (len(value),)
        return value
    except Exception:
        return None


def _tracked(cls, path, stream, line_starts, attrs, seen):
    """Subclass the engine parser to record, per attribute, the line range of the block that produced it (cclib exposes none)."""

    class Tracked(cls):  # type: ignore[misc, valid-type]
        def extract(self, inputfile, line):
            start = bisect.bisect_right(line_starts, inputfile.pos)
            super().extract(inputfile, line)
            end = bisect.bisect_right(line_starts, inputfile.pos)
            for name in attrs:
                if hasattr(self, name):
                    fp = _fingerprint(getattr(self, name))
                    previous = seen.get(name)
                    if previous is None:
                        seen[name] = {"first": start, "last": end, "fp": fp}
                    elif previous["fp"] != fp:
                        previous.update(last=end, fp=fp)

    return Tracked(path, loglevel=logging.ERROR, logstream=stream)
