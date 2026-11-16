"""Byte-level safety checks. Run BEFORE any text decoding or cclib call. Pure functions, no I/O, no cclib."""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import re

from .findings import Finding
from .limits import MAX_LINE_BYTES, MAX_SOURCE_BYTES

_ARCHIVE_MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"\x1f\x8b", "gzip"),
    (b"BZh", "bzip2"),
    (b"PK\x03\x04", "zip"),
    (b"PK\x05\x06", "zip"),
    (b"\xfd7zXZ\x00", "xz"),
    (b"\x28\xb5\x2f\xfd", "zstd"),
    (b"7z\xbc\xaf\x27\x1c", "7z"),
    (b"Rar!\x1a\x07", "rar"),
    (b"\x04\x22\x4d\x18", "lz4"),
)
_URL = re.compile(rb"^\s*(?:https?|ftp)s?://", re.IGNORECASE)
_CONTROL = re.compile(rb"[\x00-\x08\x0b\x0e-\x1a\x1c-\x1f\x7f]")  # excludes \t \n \f \r and ESC-free text
_LONG_LINE = re.compile(rb"[^\n]{%d}" % (MAX_LINE_BYTES + 1))


def precheck_bytes(raw: bytes) -> tuple[list[Finding], dict]:
    """Return (rejection/warning findings, stats). Any `reject` finding means: do not decode, do not parse."""
    findings: list[Finding] = []
    stats: dict = {"size_bytes": len(raw)}
    if not raw:
        return [Finding("EMPTY_FILE", "reject", "The file is empty.")], stats
    if len(raw) > MAX_SOURCE_BYTES:
        findings.append(Finding("FILE_TOO_LARGE", "reject", f"{len(raw)} bytes exceeds the {MAX_SOURCE_BYTES}-byte import limit."))
        return findings, stats
    head = raw[:16]
    for magic, name in _ARCHIVE_MAGIC:
        if head.startswith(magic):
            findings.append(Finding("COMPRESSED_INPUT_NOT_SUPPORTED", "reject", f"{name} data detected. Archives and compressed files are not accepted; upload the plain-text output."))
    if raw[257:262] == b"ustar":
        findings.append(Finding("COMPRESSED_INPUT_NOT_SUPPORTED", "reject", "tar archive detected. Upload the plain-text output."))
    if _URL.match(head):
        findings.append(Finding("URL_INPUT_REFUSED", "reject", "The content is a URL. ChemDFT never fetches remote files."))
    if b"\x00" in raw:
        findings.append(Finding("NOT_TEXT", "reject", f"{raw.count(b'\x00')} NUL byte(s): this is binary or corrupted data, not a text output."))
    sample = raw[:262144]
    controls = len(_CONTROL.findall(sample))
    if controls / max(1, len(sample)) > 0.001:
        findings.append(Finding("NOT_TEXT", "reject", f"{controls} control characters in the first 256 KB: not a text output."))
    if _LONG_LINE.search(raw):
        findings.append(Finding("LINE_TOO_LONG", "reject", f"A line longer than {MAX_LINE_BYTES} bytes was found."))
    if any(f.severity == "reject" for f in findings):
        return findings, stats
    try:
        raw.decode("utf-8")
        stats["encoding"] = "utf-8"
        stats["replaced_bytes"] = 0
    except UnicodeDecodeError:
        replaced = raw.decode("utf-8", errors="replace").count("�")
        stats["encoding"] = "utf-8-with-replacement"
        stats["replaced_bytes"] = replaced
        if replaced / len(raw) > 0.001:
            findings.append(Finding("NOT_TEXT", "reject", f"{replaced} undecodable bytes: the file is not UTF-8/ASCII text."))
        else:
            findings.append(Finding("NON_UTF8_BYTES_REPLACED", "warning", f"{replaced} non-UTF-8 byte(s) were replaced with U+FFFD before parsing."))
    return findings, stats


def decode_text(raw: bytes) -> str:
    return raw.decode("utf-8", errors="replace")
