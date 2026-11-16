# ADR-044: ORCID iD integration (authenticate only)

Status: Accepted. The production client is registered (client id `APP-80AVSHS08UXFPDND`, authenticate only); everything is OFF by default and is enabled only by the owner. Date: 2026-11-03.
Authority: owner batch "ORCID + Citation" (release 0.0.6). Related: [ADR-043](ADR-043-direct-large-pdf-upload.md) (secret pattern),
DECISIONS.md (citation roadmap, AWS identity), registry entry ORCID.

## Context

ChemDFT signs researchers in with Better Auth in the Next.js layer (email + password, optional Google). The API is a
resource server: it only verifies the short-lived JWT the Next layer mints (`jwt_auth.py`, `identity_service.py`, user
identity `better-auth` + subject). Public signup is closed. The owner wants researchers to link an ORCID iD that is
**authenticated by ORCID**, never typed, and to use it in citations and (for linked accounts only) as a sign-in method.

## Decision

**Public API (free), OAuth 2.0 authorization code + OpenID Connect.** Scope `openid` only (ORCID's discovery documents list
`openid` as the only supported scope and it yields the authenticated iD as `sub`). No `/read-limited`, no `/activities/update`,
no member API. Endpoints come from the discovery documents read on 2026-11-03:

| | sandbox | production |
|---|---|---|
| issuer / base | `https://sandbox.orcid.org` | `https://orcid.org` |
| authorize / token / JWKS | `/oauth/authorize`, `/oauth/token`, `/oauth/jwks` | same |
| id_token alg, client auth | RS256, `client_secret_post` | same |

**Redirect URIs (fixed, registered by the owner, implemented exactly):** `https://chemdft.com/orcid/callback`
(the only URI registered for the production client). `http://localhost:3000/orcid/callback` is for an optional sandbox client only. The page is non-localized (`apps/web/src/app/orcid/callback`).
The redirect URI sent to ORCID is configuration (`CHEMDFT_ORCID_REDIRECT_URI`), never derived from a request header, and **production refuses to run unless it equals the registered URI exactly** (`orcid.PRODUCTION_REDIRECT_URI`; a custom domain needs a code change plus a new registration).

**Where things run.** The client secret exists only on the backend host. The browser never sees a code exchange.

- *Link* (signed in): browser -> `POST /api/chemdft/v1/orcid/link/start` (normal proxy + JWT) -> authorize URL; ORCID ->
  `/orcid/callback?code&state` (static page) -> `POST /api/chemdft/v1/orcid/link/complete {code,state}` (JWT).
- *Sign in* (no session, **linked accounts only**): `GET /api/auth/orcid/start` (a small Better Auth plugin endpoint in the
  Next layer) asks the API for a state, sets an HttpOnly binding cookie and redirects to ORCID; `/orcid/callback` posts to
  `POST /api/auth/orcid/complete`, which calls the API `POST /v1/orcid/signin/complete` server to server. If (and only if) ORCID
  authenticated an iD that is linked, the API returns the Better Auth subject and the plugin creates the session with
  Better Auth's own `internalAdapter.createSession` + `setSessionCookie`. Nothing else in Better Auth changes.
- *Unlink*: `DELETE /v1/orcid/link`. *Status*: `GET /v1/orcid`.

**Security design.**
1. `state` (256-bit random, stored only as SHA-256, single use, 10 minute expiry, bound to purpose, to the user for *link*,
   and to the SHA-256 of the browser binding cookie for *sign-in*, which defeats login CSRF), PKCE `S256` challenge (the
   verifier is stored server side), and an OIDC `nonce` checked against the id_token. **ORCID's documentation does not
   mention PKCE and its discovery document does not advertise `code_challenge_methods_supported`: PKCE is sent but ChemDFT
   does not rely on it (confidential client, secret, state and nonce carry the protection). Whether ORCID enforces it is
   NOT VERIFIED.**
2. The id_token is verified: RS256 only, signature against the issuer's JWKS, `iss`, `aud` = client id, `exp`, `iat`, `nonce`;
   `sub` must match `NNNN-NNNN-NNNN-NNNX` with a valid ISO 7064 mod 11-2 checksum. The iD is **authenticated** only if it comes
   out of this path; there is no endpoint that accepts an iD from the client.
3. One iD per account and one account per iD (unique constraints on both). Linking an iD already linked elsewhere is refused
   with a generic message and audited; the other account is never revealed.
4. Link only from a signed-in session. Sign in with ORCID never creates an account (`disableSignUp` stays true; the API has
   no code path that provisions a user from ORCID); an unlinked or disabled account gets one generic refusal.
5. Unlink at any time; the row is deleted (hard delete) and an audit record is written.
6. Audit table `orcid_audit_events` (event, user id when known, outcome, reason code, timestamp; no iD for refused attempts,
   no tokens, no codes). Rate limits (database counted, per user for authenticated calls, per source address hash for
   sign-in) bound start and complete calls.
7. Stored: ORCID iD, `verified_at`, `environment` (sandbox/production), and **only if the researcher ticks the consent box
   and ORCID returned a name (public), the display name**. Access/refresh tokens are discarded, never stored, never logged.
   Production and sandbox iDs are different record spaces: a link records its environment, a production-disabled deployment
   refuses production links, and a sandbox iD is never shown as a production citation identity.
8. The consent text is shown before the redirect (what is read, what is stored, how to unlink). ORCID's own screen asks for
   the permission; ChemDFT's checkbox decides whether the name is kept.

**Display.** Per [ORCID iD display guidelines](https://info.orcid.org/documentation/integration-guide/orcid-id-display-guidelines/)
(read 2026-11-03): full iD `https://orcid.org/XXXX-XXXX-XXXX-XXXX` linked to the record, the official green iD icon unaltered
before the iD, 24 px, `alt="ORCID iD"`, `aria-label="View ORCID record - iD"`. ORCID's wording is **authenticated**; ChemDFT's
the product uses ORCID's own word **authenticated** ("ORCID iD authenticated by ORCID") and never "verified". A sandbox iD (optional test environment) links to `https://sandbox.orcid.org/...` and is never added to a citation.

## Configuration (names only)

`CHEMDFT_ORCID_ENABLED` (default false), `CHEMDFT_ORCID_ENVIRONMENT` (`production` default | `sandbox`), `CHEMDFT_ORCID_CLIENT_ID`,
`CHEMDFT_ORCID_CLIENT_SECRET_FILE`, `CHEMDFT_ORCID_REDIRECT_URI`. The secret follows the `nvidia-api-key` pattern: SSM
SecureString -> `chemdft-render-env.sh` -> `/etc/chemdft/secrets/...` -> `/run/secrets/...`. Parameter (fetched by the host script only when it exists):
`<ssm-prefix>/orcid-client-secret`, created by the owner. **Production credentials are only read from the secret file; an inline
`CHEMDFT_ORCID_CLIENT_SECRET` is refused for production.**
The Next layer needs only the existing API base URL. Off by default; every ORCID route answers 404 when disabled.

## Licence and plan

The free ORCID **Public API** is for non-commercial use and for authentication only. Paid plans, write access to ORCID records or any
`/activities/update`-style scope would need ORCID Member API membership, which ChemDFT does not have and this ADR does not request.

## Consequences

- Fits the existing provider without replacing it: one Better Auth plugin (about 60 lines) and a backend module. Had Better
  Auth been unable to create a session for a given user, the option would have been a larger change (a second session
  mechanism); that was not needed.
- New migration `0029_orcid`. Deploy order: backend (migration + config + secret) first, frontend after.
- Zenodo/DOI registration is **out of scope** and stays out until the open-core parts are public.
- **Live acceptance, 2026-11-03 (owner, production site, ORCID Public API production client, authenticate-only, owner account):**
  PASSED: linking from Settings > General (ORCID's consent screen asked only for "Get your ORCID iD"; Settings then showed "ORCID iD
  authenticated by ORCID on 2026-11-03" with the name kept) and "Sign in with ORCID" signing the owner into the same account after linking.
  These are reported by the owner, one account, one iD; they establish the happy path on this platform only.
- A denied authorization (`error=access_denied`) never reaches the API, so its one-time state is not burned: it expires after 10 minutes and cannot be completed without a code. Burning it would need a new field or route (not done).
- **NOT VERIFIED:** Unlink (a screenshot showed the Connect button again, but the owner did not confirm testing it); a second account linking
  the same iD; an unlinked iD being refused at sign-in; denying access on ORCID's page; which id_token name claims ORCID returns; PKCE
  enforcement by ORCID. The offline tests cover the refusal paths against a locally signed token, which is not evidence about ORCID.
