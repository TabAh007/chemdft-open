"""The single place that turns generated or stored bytes into an HTTP attachment.

Every scientific download (native artifacts, structure files, lineage JSON, analysis exports)
goes through `attachment_response`, so filename safety, cache policy and stale-authority
signalling cannot drift between routes.
"""

from __future__ import annotations

import re
from urllib.parse import quote

from fastapi import Response

from .contracts.result_state import EffectiveResultState

_UNSAFE = re.compile(r"[^A-Za-z0-9._ \-+()\[\],=]")
_MAX_NAME = 120


def safe_filename(name: str, fallback: str = "chemdft-export") -> str:
    """Strip path separators, control characters and quoting characters; keep it short."""
    cleaned = _UNSAFE.sub("_", name.replace("\\", "/").rsplit("/", 1)[-1]).strip(" .")
    cleaned = re.sub(r"_{2,}", "_", cleaned)
    if not cleaned or cleaned in {".", ".."}:
        cleaned = fallback
    if len(cleaned) > _MAX_NAME:
        stem, dot, ext = cleaned.rpartition(".")
        cleaned = (
            (stem[: _MAX_NAME - len(ext) - 1] + dot + ext)
            if dot and len(ext) < 12
            else cleaned[:_MAX_NAME]
        )
    return cleaned


def content_disposition(filename: str) -> str:
    """ASCII-safe attachment header; non-ASCII names use the RFC 5987 extended parameter."""
    encoded = quote(filename, safe="")
    if encoded != filename:
        return f"attachment; filename*=UTF-8''{encoded}"
    return f'attachment; filename="{filename}"'


def evidence_headers(effective: EffectiveResultState | None) -> dict[str, str]:
    """Read-time scientific standing of the evidence behind a download."""
    if effective is None:
        return {"X-ChemDFT-Evidence-Use": "UNKNOWN"}
    return {
        "X-ChemDFT-Effective-Authority": effective.authority,
        "X-ChemDFT-Source-Lineage": effective.source_lineage_validity,
        "X-ChemDFT-Verification": effective.verification_state,
        "X-ChemDFT-Evidence-Use": "CURRENT"
        if effective.eligible_for_derivation
        else "HISTORICAL_ONLY",
    }


def attachment_response(
    filename: str,
    media_type: str,
    payload: bytes,
    *,
    effective: EffectiveResultState | bool | None = False,
    extra_headers: dict[str, str] | None = None,
) -> Response:
    """`effective=False`: no result is involved. `None`: a result without effective state."""
    headers = {
        "Content-Disposition": content_disposition(filename),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        # Browsers must be allowed to read the attachment metadata from the same-origin proxy.
        "Access-Control-Expose-Headers": "Content-Disposition, X-ChemDFT-Evidence-Use, "
        "X-ChemDFT-Effective-Authority, X-ChemDFT-Source-Lineage, X-ChemDFT-Verification",
    }
    if effective is not False:
        headers.update(evidence_headers(effective))  # type: ignore[arg-type]
    if extra_headers:
        headers.update(extra_headers)
    return Response(content=payload, media_type=media_type, headers=headers)
