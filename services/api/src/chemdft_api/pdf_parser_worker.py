"""Bounded PDF parser worker. It reads bytes on stdin and emits JSON only."""

from __future__ import annotations

import json
import sys
from io import BytesIO

from pypdf import PdfReader


def main() -> None:
    payload = sys.stdin.buffer.read()
    reader = PdfReader(BytesIO(payload), strict=False)
    if len(reader.pages) > 500:
        raise ValueError("PAGE_LIMIT_EXCEEDED")
    pages: list[dict[str, object]] = []
    for index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        pages.append({"page": index, "text": text[:200_000]})
    metadata = reader.metadata or {}
    result = {
        "page_count": len(reader.pages),
        "pages": pages,
        "metadata": {
            str(key).lstrip("/"): str(value) for key, value in metadata.items() if value is not None
        },
    }
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
