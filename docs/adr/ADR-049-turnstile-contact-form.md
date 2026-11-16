# ADR-049: Cloudflare Turnstile for the Public Contact Form

- **Status:** Selected and implemented (code in 0.0.35); NOT yet executed against the live provider; NOT verified end-to-end.
- **Date:** 2026-11-10
- **Scope:** Public contact form anti-abuse (`apps/web`, Release 0.0.35).
- **Consulted:** `docs/TECHNOLOGY_REGISTRY.md` (Index and lines 1079–1085), `docs/15_ENGINEERING_RULES.md` (Rule 12, Rule 23).

---

## Context

ChemDFT Release 0.0.35 introduces an unauthenticated public contact page (`/[locale]/contact`) allowing outside researchers, prospective partners, and the press to contact the project operator (`tab@chemdft.com`). Because this endpoint is public and triggers outbound transactional email delivery via Resend, robust anti-abuse protection is required to prevent automated spam relays and malicious flooding.

Per permanent engineering rules and owner decisions:
1. **No heavy SDKs without justification:** Vendor client SDK packages should be avoided when simple HTTPS REST APIs and official vanilla scripts suffice.
2. **Privacy preservation:** The anti-abuse system must not track researchers across third-party websites or deploy invasive tracking cookies.
3. **Fail closed:** If anti-abuse credentials or verification services are unreachable, the service must fail closed (HTTP 503 `CONTACT_UNAVAILABLE`) with a clear user fallback rather than blindly accepting unverified traffic.
4. **Content Security Policy (CSP):** External challenge scripts, frames, and connect endpoints must be strictly scoped to the contact page only.

---

## Evaluation of Candidate Solutions

Official documentation and technical characteristics were evaluated across four anti-abuse candidates on 2026-11-10:

### 1. Cloudflare Turnstile (Selected)
- **Official Docs & URLs:** [https://developers.cloudflare.com/turnstile/](https://developers.cloudflare.com/turnstile/), [https://developers.cloudflare.com/turnstile/get-started/server-side-validation/](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- **Pricing & Tier:** Free for up to 1,000,000 challenge responses per month with unlimited visitor volume.
- **Client Integration:** Single official script (`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`) loaded exclusively on the contact page. **Zero npm dependencies added**.
- **Server Verification:** Standard HTTPS `fetch` request to `https://challenges.cloudflare.com/turnstile/v0/siteverify` using `TURNSTILE_SECRET_KEY` with timeout enforcement.
- **Privacy & Compliance:** Non-interactive, privacy-first design. Does not sell personal data, does not profile users for advertising, and requires no tracking cookies.
- **Testability:** Cloudflare publishes standard dummy test keys that always pass (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`) and always fail (`2x00000000000000000000AB` / `2x0000000000000000000000000000000AB`), enabling fully offline deterministic unit and end-to-end testing.

### 2. Google reCAPTCHA (v2 / v3)
- **Official Docs & URLs:** [https://developers.google.com/recaptcha](https://developers.google.com/recaptcha)
- **Evaluation:** reCAPTCHA v2 introduces high user friction (image puzzle challenges). reCAPTCHA v3 uses behavioral heuristics that can penalize privacy-focused browsers or VPN users, while sharing browsing signals across Google domains.
- **Decision:** Rejected due to user friction, tracking overhead, and heavyweight client bundle.

### 3. hCaptcha
- **Official Docs & URLs:** [https://www.hcaptcha.com/](https://www.hcaptcha.com/)
- **Evaluation:** Free tier presents aggressive visual challenge puzzles to users. Requires extensive enterprise plans to achieve seamless passive verification.
- **Decision:** Rejected due to excessive puzzle interaction friction for academic and professional visitors.

### 4. Custom Mathematical or In-House Challenges
- **Evaluation:** Static or simple algorithmic math/word challenges are trivial for modern generative AI and bot automation to defeat.
- **Decision:** Inadequate protection against automated spam relays.

---

## Decision

**Cloudflare Turnstile** is selected as the anti-abuse verification system for the ChemDFT public contact form.

1. **Zero npm packages added:** Standard script tag loaded on the contact page using `window.turnstile.render()`.
2. **Serverless verification:** Evaluated via native `fetch` in `apps/web/src/lib/contact/turnstile.ts`.
3. **Fail-closed security:** If `TURNSTILE_SECRET_KEY` is missing or the verification endpoint is unreachable, the API returns HTTP 503 (`CONTACT_UNAVAILABLE`), and the client presents an honest manual email fallback.
4. **Scoped CSP:** `next.config.ts` allows `https://challenges.cloudflare.com` exclusively on `/contact` and `/:locale/contact`.
5. **Defense-in-depth:** Paired with a hidden honeypot field, a minimum 3-second render-to-submit fill time, and HMAC-SHA256 hashed IP rate limiting (3/10m, 5/24h, 50 global daily cap).

---

## Verification & Status

- **Implemented:** Client widget in `apps/web/src/app/[locale]/contact/turnstile-widget.tsx` and server verifier in `apps/web/src/lib/contact/turnstile.ts`.
- **Offline testing:** Unit tests in `apps/web/tests/contact.test.ts` test token validation, missing secret, network timeout, and failure modes with mocked transport.
- **Not yet executed:** Live execution against production Cloudflare endpoints has NOT been performed.
- **Not verified end-to-end:** Live secret and sitekey configuration in Vercel environment variables is an architect operational step performed after PR merge.

