"""Direct large-PDF upload: ticket signing, CORS, and the ticket-authorised import endpoint."""

from __future__ import annotations

from uuid import uuid4

import pytest
from chemdft_api import direct_upload as du
from chemdft_api.config import Settings
from test_ai_scientist import _pdf_with_text

SECRET = "s" * 40
ORIGIN = "https://site.example"
URL = "https://api.example"


def _enable(settings: Settings) -> None:
    settings.direct_upload_public_url = URL
    settings.direct_upload_allowed_origin = ORIGIN
    settings.upload_ticket_secret = SECRET


def _project(client) -> str:
    return client.post("/v1/projects", json={"name": "du", "slug": f"du-{uuid4().hex[:8]}"}).json()["id"]


def _ticket(client, pid: str, size: int = 5_000_000):
    return client.post(
        f"/v1/projects/{pid}/documents/upload-tickets", json={"filename": "a.pdf", "size_bytes": size}
    )


def test_ticket_roundtrip_expiry_and_tamper() -> None:
    s = Settings(upload_ticket_secret=SECRET, direct_upload_public_url=URL, direct_upload_allowed_origin=ORIGIN)
    token, exp = du.issue_ticket(s, user_id="u", organization_id="o", project_id="p", max_bytes=10, now=1000)
    t = du.verify_ticket(s, token, now=1000)
    assert (t.user_id, t.organization_id, t.project_id, t.max_bytes, t.expires_at) == ("u", "o", "p", 10, exp)
    with pytest.raises(du.TicketError) as e:
        du.verify_ticket(s, token, now=exp + 1)
    assert e.value.code == "ticket_expired"
    body, sig = token.split(".")
    for bad in (f"{body}.{sig[:-2]}AA", f"{body[:-2]}AA.{sig}", "x", "", None, "a.b.c"):
        with pytest.raises(du.TicketError) as e:
            du.verify_ticket(s, bad, now=1000)
        assert e.value.code == "invalid_ticket"
    other = s.model_copy(update={"upload_ticket_secret": "t" * 40})
    with pytest.raises(du.TicketError):
        du.verify_ticket(other, token, now=1000)


def test_disabled_without_full_configuration() -> None:
    for kw in (
        {},
        {"upload_ticket_secret": "short", "direct_upload_public_url": URL, "direct_upload_allowed_origin": ORIGIN},
        {"upload_ticket_secret": SECRET, "direct_upload_public_url": URL},
    ):
        s = Settings(**kw)
        assert not du.direct_upload_enabled(s)
        with pytest.raises(du.TicketError) as e:
            du.issue_ticket(s, user_id="u", organization_id="o", project_id="p", max_bytes=1)
        assert e.value.code == "direct_upload_unavailable"


def test_cors_only_for_the_configured_origin() -> None:
    s = Settings(direct_upload_allowed_origin=ORIGIN)
    assert du.cors_headers(s, ORIGIN)["Access-Control-Allow-Origin"] == ORIGIN
    assert du.cors_headers(s, "https://evil.example") == {}
    assert du.cors_headers(s, None) == {}


def test_ticket_route_unavailable_by_default(api) -> None:
    client, _s, _settings = api
    assert _ticket(client, _project(client)).status_code == 503


def test_full_flow_import_and_limits(api) -> None:
    client, _sessions, settings = api
    _enable(settings)
    pid = _project(client)
    assert _ticket(client, pid, settings.max_upload_bytes + 1).status_code == 413
    body = _ticket(client, pid).json()
    assert body["upload_url"] == f"{URL}/v1/direct-uploads/documents"
    headers = {"X-ChemDFT-Upload-Ticket": body["ticket"], "Origin": ORIGIN}
    pre = client.options(
        "/v1/direct-uploads/documents", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST"}
    )
    assert pre.status_code == 204 and pre.headers["access-control-allow-origin"] == ORIGIN
    assert client.options("/v1/direct-uploads/documents", headers={"Origin": "https://evil.example"}).status_code == 403
    pdf = _pdf_with_text("Lattice parameter a = 5.64 Angstrom.")
    files = {"upload": ("p.pdf", pdf, "application/pdf")}
    ok = client.post("/v1/direct-uploads/documents", headers=headers, files=files)
    assert ok.status_code == 201, ok.text
    assert ok.headers["access-control-allow-origin"] == ORIGIN
    docs = client.get(f"/v1/projects/{pid}/documents").json()
    assert len(docs["documents"] if isinstance(docs, dict) and "documents" in docs else docs) == 1
    # wrong origin, missing / bad / expired ticket
    assert client.post("/v1/direct-uploads/documents", headers={**headers, "Origin": "https://evil.example"}, files=files).status_code == 403
    assert client.post("/v1/direct-uploads/documents", files=files).status_code == 401
    assert client.post("/v1/direct-uploads/documents", headers={"X-ChemDFT-Upload-Ticket": "bad"}, files=files).status_code == 401
    expired, _ = du.issue_ticket(settings, user_id="u", organization_id="o", project_id=pid, max_bytes=10, now=1)
    r = client.post("/v1/direct-uploads/documents", headers={"X-ChemDFT-Upload-Ticket": expired}, files=files)
    assert (r.status_code, r.json()["detail"]) == (401, "ticket_expired")


def test_ticket_cannot_exceed_its_size_cap_or_be_used_when_disabled(api) -> None:
    client, _sessions, settings = api
    _enable(settings)
    pid = _project(client)
    real = du.verify_ticket(settings, _ticket(client, pid).json()["ticket"])
    tiny, _ = du.issue_ticket(
        settings, user_id=real.user_id, organization_id=real.organization_id, project_id=pid, max_bytes=50
    )
    pdf = _pdf_with_text("x" * 500)
    r = client.post(
        "/v1/direct-uploads/documents",
        headers={"X-ChemDFT-Upload-Ticket": tiny},
        files={"upload": ("p.pdf", pdf, "application/pdf")},
    )
    assert r.status_code == 413, r.text
    settings.upload_ticket_secret = None
    r = client.post(
        "/v1/direct-uploads/documents",
        headers={"X-ChemDFT-Upload-Ticket": tiny},
        files={"upload": ("p.pdf", pdf, "application/pdf")},
    )
    assert r.status_code == 503


def test_pdf_metadata_is_clamped_to_column_widths() -> None:
    from chemdft_api.phase7_actions import _fit, _metadata

    assert _fit(None, 5) is None and _fit("\x00 ", 5) is None
    assert _fit("abcdefgh", 5) == "abcde" and _fit("a\x00b", 5) == "ab"
    info = _metadata({"metadata": {"subject": "J" * 1273, "title": "T" * 900}}, [{"text": "10." + "1234/" + "x" * 400}])
    assert len(info["journal"]) == 240 and len(info["title"]) <= 500 and len(info["doi"]) <= 240
