"""Safe plain-text spectrum ingestion and format detection (production worker).

Design rules (validated in docs/implementation/EXPERIMENTAL_SPECTRA_SPIKE.md):
  * the uploaded bytes are data: never executed, never evaluated, hashed first, size/line/point limited;
  * numbers are tokenised with a strict ASCII grammar (Python's float() also accepts "1_0", Unicode digits, "nan", "inf");
  * detection looks for the longest consistent numeric BLOCK, so metadata headers/footers in other formats are tolerated;
  * nothing is guessed silently: unit evidence is graded, and an unconfirmed unit blocks the commit;
  * raw arrays are kept exactly in file order; reversed axes are recorded, not reordered.
"""
# ruff: noqa: E501, RUF001  (long evidence strings, scientific symbols and human-readable diagnostics)
from __future__ import annotations

import codecs
import hashlib
import re
from dataclasses import dataclass, field
from typing import Any

import numpy as np

MAX_BYTES = 32 * 1024 * 1024
MAX_LINE_BYTES = 4 * 1024 * 1024
MAX_POINTS = 200_000  # equals the existing ExperimentalDatasetView limit and Settings.experimental_max_points
MAX_HEADER_LINES = 1000
MAX_Y_COLUMNS = 256
MIN_POINTS = 10
MAX_ISSUES = 200
DETECTION_SAMPLE_LINES = 3000

# Strict ASCII grammar. [0-9] (not \d) so Unicode digits never match; "D" exponents are real Fortran exports.
_EXP = r"(?:[eEdD][+-]?[0-9]+)?"
NUM_DOT = re.compile(rf"^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+){_EXP}$")
NUM_COMMA = re.compile(rf"^[+-]?(?:[0-9]+,?[0-9]*|,[0-9]+){_EXP}$")
THOUSANDS = re.compile(r"^[+-]?[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?$")
RANGE_TOKEN = re.compile(r"^[0-9]+(?:\.[0-9]+)?\s*[-–]\s*[0-9]+(?:\.[0-9]+)?$")
INVALID_TOKENS = {"", "-", "--", "nan", "inf", "+inf", "-inf", "infinity", "-infinity", "n/a", "na", "#n/a", "null", "none", "1.#qnan", "1.#inf", "-1.#ind", "#div/0!"}
UNICODE_MINUS = re.compile("[−‒–—]")

_SIGNATURES: list[tuple[bytes, str]] = [
    (b"PK\x03\x04", "ZIP/OOXML archive (xlsx, docx, zip)"), (b"\x1f\x8b", "gzip"), (b"BZh", "bzip2"),
    (b"7z\xbc\xaf\x27\x1c", "7-zip"), (b"%PDF", "PDF"), (b"\xd0\xcf\x11\xe0", "OLE2 (xls, doc)"),
    (b"\x89PNG", "PNG image"), (b"\xff\xd8\xff", "JPEG image"), (b"SQLite format 3", "SQLite database"),
]

_DELIMITERS: list[tuple[str, str]] = [("\t", "."), ("\t", ","), (";", "."), (";", ","), (",", "."), ("WS", "."), ("WS", ","), ("|", ".")]
_DELIM_NAME = {"\t": "TAB", ";": "SEMICOLON", ",": "COMMA", "WS": "WHITESPACE", "|": "PIPE"}


@dataclass
class Issue:
    code: str
    severity: str  # ERROR | WARNING | INFO
    message: str
    line: int | None = None


@dataclass
class MetadataEntry:
    key: str
    value: str
    line: int


@dataclass
class Analysis:
    file_sha256: str
    size_bytes: int
    encoding: str = "utf-8"
    newline: str = "LF"
    delimiter: str | None = None
    decimal: str | None = None
    orientation: str = "COLUMNS"
    n_rows: int = 0
    n_cols: int = 0
    first_data_line: int | None = None
    last_data_line: int | None = None
    header_lines: list[tuple[int, str]] = field(default_factory=list)
    footer_lines: list[tuple[int, str]] = field(default_factory=list)
    column_labels: list[str | None] = field(default_factory=list)
    columns: list[np.ndarray] = field(default_factory=list)  # one array per series, FILE ORDER, NaN = invalid cell
    invalid_cells: list[tuple[int, int]] = field(default_factory=list)  # (line, column)
    metadata: list[MetadataEntry] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)
    detection_notes: list[str] = field(default_factory=list)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "ERROR"]

    def add(self, code: str, severity: str, message: str, line: int | None = None) -> None:
        if len(self.issues) < MAX_ISSUES:
            self.issues.append(Issue(code, severity, message, line))


# ------------------------------------------------------------------------------------------------ decoding
def decode_text(raw: bytes, analysis: Analysis) -> str | None:
    if len(raw) > MAX_BYTES:
        analysis.add("FILE_TOO_LARGE", "ERROR", f"file is {len(raw)} bytes; the limit is {MAX_BYTES}")
        return None
    for magic, name in _SIGNATURES:
        if raw.startswith(magic):
            analysis.add("ARCHIVE_OR_BINARY_NOT_ACCEPTED", "ERROR", f"the file is a {name}, not plain text; archives and office files are not accepted")
            return None
    encoding = "utf-8"
    body = raw
    if raw.startswith(codecs.BOM_UTF8):
        body, encoding = raw[3:], "utf-8-sig"
    elif raw.startswith((codecs.BOM_UTF32_LE, codecs.BOM_UTF32_BE)):
        analysis.add("ENCODING_NOT_SUPPORTED", "ERROR", "UTF-32 text is not supported; export as UTF-8, UTF-16 or ASCII")
        return None
    elif raw.startswith(codecs.BOM_UTF16_LE):
        body, encoding = raw[2:], "utf-16-le"
    elif raw.startswith(codecs.BOM_UTF16_BE):
        body, encoding = raw[2:], "utf-16-be"
    elif b"\x00" in raw:
        zeros_even = raw[0::2].count(0)
        zeros_odd = raw[1::2].count(0)
        half = max(1, len(raw) // 2)
        if zeros_odd / half > 0.25 and zeros_even / half < 0.05:
            encoding = "utf-16-le"
        elif zeros_even / half > 0.25 and zeros_odd / half < 0.05:
            encoding = "utf-16-be"
        else:
            analysis.add("NOT_TEXT", "ERROR", "the file contains NUL bytes and is not UTF-16 text; it looks binary")
            return None
    try:
        text = body.decode(encoding if encoding != "utf-8-sig" else "utf-8", errors="strict")
    except UnicodeDecodeError:
        for fallback in ("cp1252", "latin-1"):
            try:
                text = body.decode(fallback, errors="strict")
                analysis.add("ENCODING_FALLBACK", "WARNING", f"not valid UTF-8; decoded as {fallback}. Numbers are unaffected; accented or symbol characters in labels may differ")
                encoding = fallback
                break
            except UnicodeDecodeError:
                continue
        else:  # pragma: no cover - latin-1 never fails
            return None
    if "\x00" in text:
        analysis.add("NOT_TEXT", "ERROR", "decoded text still contains NUL characters")
        return None
    analysis.encoding = encoding
    return text


# ------------------------------------------------------------------------------------------------ tokenising
def split_line(line: str, delim: str) -> list[str]:
    if delim == "WS":
        return line.split()
    tokens = [t.strip() for t in line.split(delim)]
    while tokens and tokens[-1] == "":  # trailing delimiters are common in instrument exports
        tokens.pop()
    return tokens


def is_number(token: str, decimal: str) -> bool:
    return bool((NUM_DOT if decimal == "." else NUM_COMMA).match(token))


def to_float(token: str, decimal: str) -> float:
    t = token.replace("D", "E").replace("d", "e")
    if decimal == ",":
        t = t.replace(",", ".")
    return float(t)  # safe: the strict grammar already excluded underscores, Unicode digits and nan/inf words


def _kind(line: str, delim: str, decimal: str) -> tuple[str, int]:
    if not line.strip():
        return "BLANK", 0
    tokens = split_line(line, delim)
    if len(tokens) >= 2 and sum(is_number(t, decimal) for t in tokens) == len(tokens):
        return "NUM", len(tokens)
    if len(tokens) >= 2 and all(is_number(t, decimal) or t.lower() in INVALID_TOKENS for t in tokens) and any(is_number(t, decimal) for t in tokens):
        return "NUMINV", len(tokens)
    if len(tokens) >= 2 and RANGE_TOKEN.match(tokens[0]) and all(is_number(t, decimal) for t in tokens[1:]):
        return "RANGE", len(tokens)  # must be tested before LNUM: "270-279" is a bin, not a text label
    if len(tokens) >= 3 and not is_number(tokens[0], decimal) and tokens[0].lower() not in INVALID_TOKENS and all(is_number(t, decimal) for t in tokens[1:]):
        return "LNUM", len(tokens) - 1
    return "TEXT", len(tokens)


def _longest_run(kinds: list[tuple[str, int]], accept: set[str], min_count: int = 2) -> tuple[int, int, int]:
    """(start, end_exclusive, columns) of the longest run of accepted lines sharing one column count."""
    best = (0, 0, 0)
    i, n = 0, len(kinds)
    while i < n:
        k, c = kinds[i]
        if k in accept and c >= min_count:
            j = i
            while j < n and kinds[j][0] in accept and kinds[j][1] == c:
                j += 1
            if j - i > best[1] - best[0]:
                best = (i, j, c)
            i = j
        else:
            i += 1
    return best


# ------------------------------------------------------------------------------------------------ metadata
_KV = re.compile(r"^\s*[#;%/]*\s*([A-Za-z][^:=\t]{0,59}?)\s*[:=]\s*(\S.*)$")
_KV_COMMA = re.compile(r"^([A-Z][A-Z0-9 _]{1,30}),\s*(\S.*)$")
FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def harvest_metadata(analysis: Analysis, lines: list[str], zone: list[tuple[int, str]]) -> None:
    pending: tuple[int, list[str]] | None = None
    for lineno, text in zone:
        stripped = text.strip()
        if not stripped:
            pending = None
            continue
        match = _KV.match(text) or _KV_COMMA.match(text)
        if match:
            analysis.metadata.append(MetadataEntry(match.group(1).strip(), match.group(2).strip(), lineno))
            pending = None
            continue
        tokens = [t.strip() for t in text.split("\t")]
        if len(tokens) >= 2:  # tab table: a names line followed by a values line (seen in real Raman exports)
            if pending and len(pending[1]) == len(tokens):
                for key, value in zip(pending[1], tokens, strict=True):
                    if key and value:
                        analysis.metadata.append(MetadataEntry(key, value, lineno))
                pending = None
            else:
                pending = (lineno, tokens)
    for entry in analysis.metadata:
        if entry.value.startswith(FORMULA_START) or entry.key.startswith(FORMULA_START):
            analysis.add("CSV_FORMULA_LIKE", "WARNING", f'metadata "{entry.key}" starts with a spreadsheet-formula character; it is stored as inert text and must be escaped on any CSV export', entry.line)


_RECOGNISED = {
    "excitation_wavelength_nm": re.compile(r"(laser|excitation).*(wavelength|nm)|^(laser|excitation)$", re.I),
    "integration_time_s": re.compile(r"(integration|exposure|acq(uisition)?\s*time)", re.I),
    "accumulations": re.compile(r"(accumulation|co-?add|average|scan)", re.I),
    "resolution_cm1": re.compile(r"\bresolution\b", re.I),
    "instrument": re.compile(r"(instrument|spectrometer|device|model)", re.I),
    "sample": re.compile(r"^(sample|title|name|compound|substance)", re.I),
    "path_length_cm": re.compile(r"path\s*length", re.I),
}


def recognised_metadata(entries: list[MetadataEntry]) -> dict[str, dict[str, Any]]:
    """Only whitelisted keys, always 'as reported' with line provenance. Missing stays missing: nothing is inferred."""
    out: dict[str, dict[str, Any]] = {}
    for entry in entries:
        for name, pattern in _RECOGNISED.items():
            if name not in out and pattern.search(entry.key):
                number = re.match(r"\s*[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?", entry.value.replace(",", ".") if re.match(r"\s*[0-9]+,[0-9]+(?:[eE]|\s|$)", entry.value) else entry.value)
                out[name] = {"as_reported": f"{entry.key}: {entry.value}", "line": entry.line, "number": float(number.group()) if number else None,
                             "status": "AS_REPORTED_IN_FILE"}
    return out


# ------------------------------------------------------------------------------------------------ analysis
def analyze_text_spectrum(raw: bytes) -> Analysis:
    analysis = Analysis(file_sha256=hashlib.sha256(raw).hexdigest(), size_bytes=len(raw))
    text = decode_text(raw, analysis)
    if text is None:
        return analysis
    analysis.newline = "CRLF" if "\r\n" in text else ("CR" if "\r" in text else "LF")
    lines = re.split(r"\r\n|\n|\r", text)
    if lines and lines[-1] == "":
        lines.pop()
    if lines and lines[-1].strip("\x1a") == "" and lines[-1]:
        lines.pop()
        analysis.add("DOS_EOF_MARKER", "INFO", "a trailing Ctrl-Z (DOS end-of-file) character was ignored")
    for number, line in enumerate(lines, 1):
        if len(line.encode("utf-8", "replace")) > MAX_LINE_BYTES:
            analysis.add("LINE_TOO_LONG", "ERROR", f"line {number} exceeds {MAX_LINE_BYTES} bytes", number)
            return analysis
    if UNICODE_MINUS.search(text):
        analysis.add("UNICODE_MINUS_PRESENT", "WARNING", "typographic minus/dash characters (U+2212 etc.) are present; numbers using them are NOT read as negative numbers (no silent normalisation)")

    if len(lines) > MAX_POINTS + MAX_HEADER_LINES + 100:
        analysis.add("TOO_MANY_POINTS", "ERROR", f"{len(lines)} lines exceed the limit of {MAX_POINTS} points plus a header (rejected before any parsing)")
        return analysis

    def evaluate(kinds: list[tuple[str, int]]) -> dict:
        start, end, cols = _longest_run(kinds, {"NUM", "NUMINV"})
        row_start, row_end, row_cols = _longest_run(kinds, {"NUM", "NUMINV", "LNUM"}, min_count=16)
        rows = end - start
        score = rows if cols >= 2 else 0
        row_score = (row_end - row_start) * 3 if 2 <= (row_end - row_start) <= 64 and row_cols >= 16 else 0
        return {"col": (start, end, cols), "row": (row_start, row_end, row_cols), "range": _longest_run(kinds, {"RANGE"}), "score": max(score, row_score), "mode": "ROWS" if row_score > score else "COLUMNS"}

    sample = lines[:DETECTION_SAMPLE_LINES]  # candidates are scored on a bounded sample, then the winner is applied to the whole file once
    best = None
    for delim, decimal in _DELIMITERS:
        candidate = {"delim": delim, "decimal": decimal, **evaluate([_kind(line, delim, decimal) for line in sample])}
        if best is None or candidate["score"] > best["score"]:
            best = candidate
    assert best is not None
    if best["score"] < 3:
        thousands = [n for n, ln in enumerate(lines, 1) if re.search(r'"[+-]?[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?"', ln)]
        if thousands:
            analysis.add("THOUSANDS_SEPARATOR_AMBIGUOUS", "ERROR", "quoted numbers such as 1,234.5 look like thousands separators; the file cannot be read unambiguously", thousands[0])
        elif best["range"][1] - best["range"][0] >= 3:
            analysis.add("BINNED_X_NOT_SUPPORTED", "ERROR", 'the first column holds wavelength RANGES such as "270-279"; binned axes are not a sampled spectrum and are not supported in V1', best["range"][0] + 1)
        else:
            analysis.add("NO_NUMERIC_BLOCK", "ERROR", "no block of at least 3 consistent numeric rows was found")
        analysis.header_lines = [(i + 1, ln) for i, ln in enumerate(lines[:MAX_HEADER_LINES]) if ln.strip()]
        return analysis

    delim, decimal = best["delim"], best["decimal"]
    kinds = [_kind(line, delim, decimal) for line in lines]
    best = {"delim": delim, "decimal": decimal, "kinds": kinds, **evaluate(kinds)}
    analysis.delimiter, analysis.decimal, analysis.orientation = _DELIM_NAME[delim], decimal, best["mode"]
    start, end, cols = best["row"] if best["mode"] == "ROWS" else best["col"]
    if start > MAX_HEADER_LINES:
        analysis.add("HEADER_TOO_LONG", "ERROR", f"data starts after line {MAX_HEADER_LINES}")
        return analysis
    analysis.first_data_line, analysis.last_data_line = start + 1, end
    analysis.header_lines = [(i + 1, lines[i]) for i in range(start) if lines[i].strip()]
    analysis.footer_lines = [(i + 1, lines[i]) for i in range(end, len(lines)) if lines[i].strip()]
    block = lines[start:end]
    matrix: list[list[float]] = []
    labels_from_rows: list[str | None] = []
    for offset, text_line in enumerate(block):
        tokens = split_line(text_line, delim)
        label = None
        if kinds[start + offset][0] == "LNUM":
            label, tokens = tokens[0], tokens[1:]
        labels_from_rows.append(label)
        row: list[float] = []
        for col, token in enumerate(tokens):
            if is_number(token, decimal):
                row.append(to_float(token, decimal))
            else:
                row.append(float("nan"))
                analysis.invalid_cells.append((start + offset + 1, col))
        matrix.append(row)
    data = np.asarray(matrix, dtype=float)
    if best["mode"] == "ROWS":
        analysis.columns = [data[i] for i in range(data.shape[0])]
        analysis.n_rows, analysis.n_cols = data.shape[1], data.shape[0]
        analysis.column_labels = labels_from_rows
        analysis.add("ROW_ORIENTED_LAYOUT", "INFO", f"{data.shape[0]} series stored in rows ({data.shape[1]} points each); read as x = first row")
    else:
        analysis.columns = [data[:, c] for c in range(data.shape[1])]
        analysis.n_rows, analysis.n_cols = data.shape
        analysis.column_labels = _column_labels(lines, start, cols, delim)
    if analysis.n_rows > MAX_POINTS:
        analysis.add("TOO_MANY_POINTS", "ERROR", f"{analysis.n_rows} points exceed the limit {MAX_POINTS}")
    if analysis.n_cols - 1 > MAX_Y_COLUMNS:
        analysis.add("TOO_MANY_COLUMNS", "ERROR", f"{analysis.n_cols} columns exceed the limit")
    if analysis.invalid_cells:
        first = analysis.invalid_cells[0]
        analysis.add("INVALID_VALUES", "WARNING", f"{len(analysis.invalid_cells)} placeholder/NaN/Inf cells (first at line {first[0]}, column {first[1] + 1})", first[0])
    # A malformed row (or a section break) must never silently truncate the data: numeric rows with the same layout outside
    # the chosen block mean the block was interrupted.
    if best["mode"] == "COLUMNS":
        outside = [i for i, (k, c) in enumerate(kinds) if (i < start or i >= end) and k in ("NUM", "NUMINV") and c == cols]
        if outside:
            interrupted = next((i for i in range(end, len(lines)) if kinds[i][0] == "TEXT"), outside[0])
            analysis.add("DATA_BLOCK_INTERRUPTED", "ERROR",
                         f"{len(outside)} further numeric rows with the same layout exist outside the main block (first at line {outside[0] + 1}); a malformed row or section break at line {interrupted + 1} interrupted the data", interrupted + 1)
    metadata_zone = analysis.header_lines + analysis.footer_lines
    harvest_metadata(analysis, lines, metadata_zone)
    if best["decimal"] == "," :
        analysis.detection_notes.append("decimal comma detected from the numeric block (delimiter is not a comma)")
    return analysis


def _column_labels(lines: list[str], start: int, cols: int, delim: str) -> list[str | None]:
    for i in range(start - 1, max(-1, start - 6), -1):
        if not lines[i].strip():
            continue
        tokens = split_line(lines[i], delim) if delim != "WS" else re.split(r"\s{2,}|\t", lines[i].strip())
        if len(tokens) == cols:
            return [t or None for t in tokens]
        if len(tokens) == 1 and delim != "WS":
            continue
        break
    return [None] * cols


