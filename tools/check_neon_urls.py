#!/usr/bin/env python3
"""Verify the two private Neon connection-string files WITHOUT ever printing a credential.

    .venv/bin/python tools/check_neon_urls.py [DIRECT_FILE] [POOLED_FILE]

Defaults: ~/.config/chemdft-web/neon-direct-url and neon-pooled-url. File safety (regular file,
mode 0600, not a symlink), URL shape (postgresql scheme, host, database chemdft_auth, role
neondb_owner, sslmode=require), that the pooled host contains "-pooler" and the direct host does not,
that both strings differ, and finally opens a short read-only connection through each endpoint
(`select current_database(), current_user`). It prints host, database, role and results only; error
text has the password and the whole URL removed. The connection tests make network calls to Neon.
"""

from __future__ import annotations

import re
import stat
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

import psycopg

DEFAULTS = (
    Path("~/.config/chemdft-web/neon-direct-url").expanduser(),
    Path("~/.config/chemdft-web/neon-pooled-url").expanduser(),
)
DATABASE = "chemdft_auth"
ROLE = "neondb_owner"


def read_url(path: Path) -> tuple[str | None, list[str]]:
    problems: list[str] = []
    try:
        info = path.lstat()
    except OSError:
        return None, [f"{path.name}: file not found"]
    if not stat.S_ISREG(info.st_mode):
        problems.append(f"{path.name}: not a regular file (symlinks are refused)")
    if info.st_mode & 0o077:
        problems.append(f"{path.name}: permissions {oct(info.st_mode & 0o777)} - run chmod 600")
    text = path.read_text().strip()
    if "\n" in text or " " in text:
        problems.append(f"{path.name}: must contain exactly one URL (no psql prefix, no quotes)")
    return text, problems


def describe(url: str) -> tuple[dict[str, str], list[str]]:
    problems: list[str] = []
    parts = urlsplit(url)
    query = parse_qs(parts.query)
    facts = {
        "scheme": parts.scheme,
        "host": parts.hostname or "",
        "database": unquote(parts.path.lstrip("/")),
        "role": unquote(parts.username or ""),
        "sslmode": (query.get("sslmode") or [""])[0],
        "has_password": "yes" if parts.password else "NO",
    }
    if facts["scheme"] not in {"postgres", "postgresql"}:
        problems.append("scheme must be postgresql://")
    if facts["database"] != DATABASE:
        problems.append(f"database must be {DATABASE} (found {facts['database'] or 'none'})")
    if facts["role"] != ROLE:
        problems.append(f"role must be {ROLE} (found {facts['role'] or 'none'})")
    if facts["sslmode"] != "require":
        problems.append("sslmode=require is missing")
    if facts["has_password"] != "yes":
        problems.append("the URL carries no password")
    if not facts["host"].endswith(".neon.tech"):
        problems.append("host is not a *.neon.tech address")
    return facts, problems


def connect_test(url: str) -> str:
    try:
        with psycopg.connect(url, connect_timeout=30, autocommit=True) as connection:
            row = connection.execute("select current_database(), current_user").fetchone()
            tls = connection.pgconn.ssl_in_use
            if not tls:
                return "FAILED the connection is not encrypted (TLS not in use)"
            return f"OK database={row[0]} role={row[1]} tls=in-use"
    except Exception as error:  # report the class and a scrubbed message only
        message = str(error)
        for secret in (url, urlsplit(url).password or ""):
            if secret:
                message = message.replace(secret, "***")
        message = re.sub(r"postgres(ql)?://\S+", "postgresql://***", message)
        return f"FAILED {type(error).__name__}: {message.splitlines()[0][:200]}"


def main(argv: list[str]) -> int:
    direct_path, pooled_path = (
        (Path(a).expanduser() for a in argv[:2]) if len(argv) >= 2 else DEFAULTS
    )
    failed = False
    urls: dict[str, str] = {}
    for label, path in (("direct", direct_path), ("pooled", pooled_path)):
        url, problems = read_url(path)
        if url is None:
            print(f"[{label}] {problems[0]}")
            failed = True
            continue
        facts, more = describe(url)
        problems += more
        urls[label] = url
        print(f"[{label}] host={facts['host']} database={facts['database']} role={facts['role']} "
              f"sslmode={facts['sslmode']} password={facts['has_password']}")  # fmt: skip
        host = facts["host"]
        if label == "pooled" and "-pooler" not in host:
            problems.append(
                "pooled host must contain '-pooler' (enable pooling in the Connect dialog)"
            )
        if label == "direct" and "-pooler" in host:
            problems.append("direct host must NOT contain '-pooler'")
        for problem in problems:
            print(f"    PROBLEM: {problem}")
        failed |= bool(problems)
    if set(urls) == {"direct", "pooled"} and urls["direct"] == urls["pooled"]:
        print("PROBLEM: the direct and pooled strings are identical")
        failed = True
    if failed:
        print("RESULT: fix the problems above before any connection test")
        return 1
    for label in ("direct", "pooled"):
        outcome = connect_test(urls[label])
        print(f"[{label}] connection: {outcome}")
        failed |= outcome.startswith("FAILED")
    print(
        "RESULT: both connections work" if not failed else "RESULT: a connection failed (see above)"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
