# ADR-043: Direct large-PDF upload with a short-lived upload ticket

Status: Accepted. Date: 2026-10-28. Authority: the researcher asked to upload large PDFs himself.

## Context

Browser uploads pass through the Vercel Route Handler proxy, which rejects request bodies above
4.5 MB (HTTP 413 `FUNCTION_PAYLOAD_TOO_LARGE`). The API and Caddy already accept 64 MB.

## Decision

For PDFs above 4 MB the browser asks the API, through the normal signed-in proxy, for an upload ticket
(`POST /v1/projects/{id}/documents/upload-tickets`, WRITE access required), then posts the file straight to
`POST /v1/direct-uploads/documents` with header `X-ChemDFT-Upload-Ticket`.

- Ticket: stateless HMAC-SHA256 over user, organization, project, expiry, byte cap and nonce
  (`direct_upload.py`). Default lifetime 600 s (60-3600). It is not a login token and grants one thing:
  importing a document into one project.
- Membership and write permission are re-checked on arrival (`import_scientific_document`), so a revoked
  member cannot use an earlier ticket. Re-use inside the lifetime is harmless: imports are de-duplicated by SHA-256.
- CORS answers only the single configured website origin; other origins get 403.
- Off unless `CHEMDFT_DIRECT_UPLOAD_PUBLIC_URL`, `CHEMDFT_DIRECT_UPLOAD_ALLOWED_ORIGIN` and
  `CHEMDFT_UPLOAD_TICKET_SECRET` (>= 32 chars) are all set; then the ticket route returns 503.
- No new dependency; the secret lives in the SSM SecureString env like other backend secrets.

## Consequences

The ticket endpoint is a classified route (`PUBLIC_TICKET`) in the route authorization matrix. The 64 MB
cap (`max_upload_bytes`) still applies server-side. Rotating the secret invalidates outstanding tickets.
