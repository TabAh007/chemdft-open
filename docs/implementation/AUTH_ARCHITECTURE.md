# ChemDFT Authentication Architecture (PF-1)

**Status**: implemented in the working tree, pre-launch. Public signup is **closed**. No production email, ORCID, billing or domain is configured. Reference design and rationale: `PRODUCT_FOUNDATION_SPIKE.md`.

## 1. The trust chain

```
Browser ── HttpOnly cookie (Better Auth session) ──▶ trusted Next.js server layer
                                                       │ proxy.ts: optimistic redirect only
                                                       │ protected layouts: authoritative session check
                                                       │ /api/chemdft/* forwarding Route Handler:
                                                       │   session → short-lived EdDSA JWT (15 min)
                                                       ▼
                                          Authorization: Bearer <JWT>        (server → server only)
                                                       │
                                                       ▼
FastAPI  require_identity (CHEMDFT_AUTH_MODE=jwt)
   1. signature via JWKS (/api/auth/jwks, cached)   2. iss, aud, exp, iat, sub required
   3. alg allow-list (EdDSA)                        4. email claim required
   5. sub → user_identities(provider='better-auth') → ChemDFT users row (kind HUMAN, not disabled)
   6. active organization = the user's PERSONAL organization
   7. Identity(user_id, organization_id)  ← the same type every route already receives
                                                       │
                                                       ▼
                                  existing project authorization (organization + project_members)
```

* The browser holds only the Better Auth session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` + `__Secure-` prefix whenever hosted). It never requests, receives or stores an API token; nothing auth-related is in `NEXT_PUBLIC_*`, `localStorage` or `sessionStorage` (asserted by tests).
* The forwarding layer forwards **only** `accept` and `content-type` from the browser plus the credential it adds itself. Client-supplied `Authorization`, cookies and `X-ChemDFT-*` headers are dropped. In jwt mode FastAPI ignores identity headers entirely.
* **No fallback**: in jwt mode a missing, invalid, expired or unmappable credential is `401`/`403`. The fixed development identity is never consulted, even if `CHEMDFT_DEV_IDENTITY_ENABLED` is mis-set (startup refuses that combination).

## 2. Identity model

| Concept | Where | Notes |
|---|---|---|
| Credentials, sessions, signing keys | Better Auth tables (`user`, `session`, `account`, `verification`, `jwks`) in the **web auth database** (`CHEMDFT_AUTH_DATABASE_URL`: SQLite file locally via `node:sqlite`, Postgres via `pg` when hosted) | Never read by the API |
| Domain user | `users` (`kind` HUMAN / SERVICE / LEGACY_LOCAL, `disabled_at`) | The FK target of every `created_by`; unchanged ids |
| Mapping | `user_identities (provider, subject) → user_id`, unique | provider `better-auth`, subject = Better Auth user id; only HUMAN users may be linked |
| Personal organization | `organizations.kind = PERSONAL` + owner `memberships` row | Created with the user on first verified token; ownership of projects stays `project_members` (no owner shortcut) |
| Service principals | `users.kind = SERVICE`, `ServiceIdentity` | Capability-bound to claimed work (PF-0); a browser session can never become one |
| Legacy local | `users.kind` / `organizations.kind = LEGACY_LOCAL` | The fixed dev user/org and its 12 projects, untouched until PF-2 |

First verified token for an unknown subject provisions, in one transaction, the user, personal organization, owner membership and identity row (idempotent; concurrent first requests converge). An email already belonging to another ChemDFT user is **never auto-linked** (`403 account_not_available`). Migration `0022_identity_foundation` is additive and reversible and labels existing rows only by their reserved ids.

## 3. Modes

| `CHEMDFT_AUTH_MODE` | Behaviour | Allowed when |
|---|---|---|
| `dev` (default) | Fixed local development identity; header override only in tests | Explicitly local only: `CHEMDFT_ENV` ∈ {development, local, test} **and** no hosted-platform marker (`VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `AWS_LAMBDA_FUNCTION_NAME`, `K_SERVICE`, `FLY_APP_NAME`, `RENDER`, `RAILWAY_ENVIRONMENT`, `DYNO`). Otherwise API startup fails and the web layer refuses |
| `jwt` | Bearer JWT verified against JWKS; Better Auth serves `/api/auth/*` | Anywhere; requires issuer, audience, JWKS URL (API) and a strong `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (https when hosted), auth database (web). Must not be combined with the dev identity flags |

Signup is gated by **launch state**, not by host. `CHEMDFT_LAUNCH_STATE=prelaunch` (default) | `public`, and `CHEMDFT_SIGNUP_MODE=closed` (default) | `google_only` | `invite` | `open`. `closed` disables email/password and Google sign-up (HTTP **and** server API); `google_only` enables Google sign-up for beta testers up to `CHEMDFT_BETA_USER_CAP` while keeping email/password sign-up closed; `invite` behaves as `closed` until an invitation store exists.

| Launch state | Signup mode | Result |
|---|---|---|
| prelaunch | closed | allowed (no public signup) |
| prelaunch | google_only | allowed (beta Google signup only, capped by `CHEMDFT_BETA_USER_CAP`) |
| prelaunch | invite | allowed (behaves as closed; no invitation store yet) |
| prelaunch | open | **refused at configuration time**, local or hosted |
| public | closed / invite | allowed (no public signup) |
| public | google_only | allowed (beta Google signup only, capped) |
| public | open | architecturally allowed; additionally requires an email provider for verification — locally only the dev sink exists, and a hosted `open` is refused until a production provider is attached |
| any | hosted + dev identity | **always refused** |

Accounts are created through `createControlledUser` (server-side function, CLI `pnpm --filter @chemdft/web auth:create-user`, local/test only, password from `CHEMDFT_NEW_USER_PASSWORD`); there is no HTTP route for it.

## 4. Environment variable names (never commit values)

Web (server only): `CHEMDFT_ENV`, `CHEMDFT_AUTH_MODE`, `CHEMDFT_LAUNCH_STATE`, `CHEMDFT_SIGNUP_MODE`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CHEMDFT_AUTH_DATABASE_URL`, `CHEMDFT_AUTH_ISSUER` (default = `BETTER_AUTH_URL`), `CHEMDFT_AUTH_AUDIENCE` (default `chemdft-api`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CHEMDFT_EMAIL_PROVIDER` (`none` | `dev`), `CHEMDFT_API_BASE_URL`.
API: `CHEMDFT_ENV`, `CHEMDFT_AUTH_MODE`, `CHEMDFT_AUTH_ISSUER`, `CHEMDFT_AUTH_AUDIENCE`, `CHEMDFT_AUTH_JWKS_URL` (or a static public `CHEMDFT_AUTH_JWKS_JSON` for tests), `CHEMDFT_AUTH_JWT_ALGORITHMS` (default `EdDSA`), `CHEMDFT_AUTH_JWT_LEEWAY_SECONDS` (10), `CHEMDFT_AUTH_JWKS_CACHE_SECONDS` (3600).

## 5. Pre-launch configuration

| | Local development | Preview / temporary Vercel URL | Future production |
|---|---|---|---|
| `CHEMDFT_ENV` | `development` (default) | unset or `preview` (hosted marker present) | `production` |
| Auth mode | `dev` (default) or `jwt` | **`jwt` only** — `dev` is refused | `jwt` |
| Launch state | `prelaunch` | **`prelaunch`** | `public` (an explicit owner decision) |
| Signup mode | `closed` (`open` only with `public` + dev email sink) | **`closed`** (`open` refused) | `closed` → `invite` → `open` by explicit decision, with a production email provider |
| Fixed dev identity | yes | **never** | never |
| Email provider | `none` or `dev` sink | `none` (no reset/verification mail) | real provider (to be attached; not configured) |
| Google | optional, credentials from env | optional, only with real credentials | yes, with a production OAuth client/domain |
| Cookies | HttpOnly, SameSite=Lax; `Secure` off only on `http://localhost`/`127.0.0.1` | `Secure` + `__Secure-` prefix | same |
| Auth database | SQLite file (default `./.chemdft/auth.db`) | **explicit PostgreSQL URL required**; file, SQLite, in-memory or relative-path databases are refused (not durable on serverless) | PostgreSQL |
| Accounts | controlled fixtures | none unless created by the owner out of band | per signup mode |

A preview deployment with no auth configuration serves public pages and shows "the authentication configuration is incomplete" on the sign-in page; protected pages redirect there. It cannot create accounts or inherit the legacy development identity.

## 6. Verification map

API (`services/api/tests`): `test_auth_jwt.py` (valid/expired/malformed/wrong issuer/audience/key/kid/claims, algorithm confusion, no JWT→dev fallback, header spoofing, provisioning, email conflict, disabled and non-human users, startup validation, JWKS unavailable, `/v1/me` shape), `test_multiuser_isolation.py` (every project-scoped GET route discovered from the live app, mutations, lists/search, spoofing, service separation), `test_service_principals.py`, `test_dev_identity_guard.py`, `test_migrations.py` (0022 data preservation + downgrade), helper `multiuser.py` (reused by PF-2).
Web (`apps/web/tests`): `auth-foundation.test.ts` (config, signup closed over HTTP and server API, Google disabled/enabled, cookie flags and `Secure` when hosted, real token verified against JWKS, redirect safety, no secrets in the client), `api-proxy.test.ts` (forwarding, header stripping, jwt mode), `auth-route.test.ts`; end-to-end `tests/e2e-auth` (`playwright.auth.config.ts`: real Better Auth → real FastAPI in jwt mode on isolated ports).

## 7. Tooling notes

* The controlled-user CLI (`pnpm --filter @chemdft/web auth:create-user`) runs on Node's built-in TypeScript support (Node ≥ 22.18; the repo uses 24), so there is no `tsx`/`esbuild` dependency. The modules in its import chain (`lib/auth/{controlled-users,server,config,email,environment}.ts`) therefore use explicit `.ts` import extensions (`allowImportingTsExtensions` in `apps/web/tsconfig.json`).
* `packages/ui` now declares `@types/react`/`@types/react-dom`. Without it, a clean `pnpm install` fails `tsc`/`next build` in `packages/ui` (it only passed in long-lived checkouts through hoisting). This predates PF-1 (reproduced at `f20ec53`).
* **Baseline lint debt (pre-existing, not PF-1):** `pnpm lint` (`--max-warnings=0`) fails at `f20ec53` and now with the same three `@typescript-eslint/no-unused-vars` warnings in the frozen `apps/web/tests/spectrum-raman.test.ts` (`DEFAULT_RAMAN_FWHM_CM1`, `DEFAULT_LASER_WAVELENGTH_NM`, `DEFAULT_RAMAN_TEMPERATURE_K`). It is deliberately left unmodified; lint of all PF-0/PF-1 files is clean.

## 8. Known limits (deliberate, pre-launch)

* Token minted per request (cheap, no cache); revocation latency ≤ token lifetime (15 min).
* Better Auth rate limiting is on only when hosted and uses in-memory storage; hosted deployments need shared storage or edge limits before launch.
* No invite mechanism, email verification, password reset mail, or account-deletion flow yet.
* The two hard-coded example buttons (Water, Chromium) are shown as "not available yet" to real (jwt) users, because they point at frozen legacy projects; PF-5 replaces them with copyable examples.
* Legacy projects can be claimed only through the audited operator CLI (see `OWNERSHIP_MODEL.md`); nothing has been claimed.

## 9. Sign-in providers: what is active and what could be added (report of 2026-11-09; nothing activated, no env or AWS read)

**Active in code today** (`apps/web/src/lib/auth/config.ts`, `server.ts`, `orcid-plugin.ts`):
- **Email and password** (Better Auth). Public signup is closed by launch state (section 5); accounts are created by the owner out of band.
- **ORCID sign-in** for accounts that already linked an iD in Settings (`CHEMDFT_ORCID_ENABLED=true`; the redirect is validated to `https://(sandbox.)orcid.org/oauth/authorize`). NEXT.md records it as enabled in production (owner-reported); it is not a signup path.
- **Google**: wired in code and switched on only when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set (`googleEnabled`). **Whether Google is configured in production is UNKNOWN from code and docs**: this document and NEXT.md never record a production Google client, and the environment was not read. The architecture table (section 5) says "yes, with a production OAuth client/domain" as the intended state.
- Not in the code at all: GitHub, Microsoft Entra, institutional login (CILogon/eduGAIN), passkeys, email magic link. No bug was found in the auth code while writing this section.

**Candidates** (analysis only; vendor behaviour was not verified here, so nothing in `docs/TECHNOLOGY_REGISTRY.md` was changed):
| Candidate | What it would need | Policy decisions that block it |
|---|---|---|
| Google (already coded) | OAuth client id and secret for the production domain (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), authorised redirect URI on chemdft.com, consent screen | Signup mode is `closed`; a real email provider is not configured; whether a Google account may be linked to an existing account by verified email (account-linking rule); privacy policy and terms wording for a third-party identity provider |
| Microsoft Entra | An app registration (client id/secret, tenant choice, redirect URI) and a new provider entry in `server.ts` | Same as Google, plus single-tenant versus multi-tenant, and organisational-admin consent for institutions |
| Institutional login via CILogon / eduGAIN | A CILogon (or federation) client registration and approval, a generic OIDC provider entry, attribute-release agreements | Which institutions are accepted, how an institutional identity maps to a ChemDFT account, data-processing review, owner-level contract with the federation operator |
| Passkeys (WebAuthn) | A passkey plugin in the auth layer and a database migration for credentials | Account recovery policy (no password reset mail exists yet), relying-party id (chemdft.com), supported devices |
| GitHub | An OAuth app (client id/secret, callback URL) and a provider entry | Same as Google; GitHub emails may be unverified or private, so the account-linking rule must not trust them |
| Email magic link | A real transactional email provider with SPF/DKIM for chemdft.com (sending is **not** set up) and a plugin | Signup mode, abuse and rate limiting on shared storage (section 8), deliverability ownership |
Common blockers for every provider: `CHEMDFT_SIGNUP_MODE` is `closed` and `open` is refused when hosted without an email provider (section 5); rate limiting is in-memory (section 8); no invite mechanism exists yet. Enabling any provider is an owner decision and is not part of release 0.0.25.

## 10. Sign in with Google: the exact callback, the rule, and the owner's console steps (release 0.0.26; built and tested, NOT enabled)

**State:** Google is OFF. `googleEnabled` is true only when BOTH `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set (`config.ts`); without them no provider is registered, the sign-in page shows no Google button and Settings shows no Google block. No Google client exists in any environment, and no real Google call was made while building this.

**Callback path (read from code):** Better Auth mounts at `/api/auth` (`apps/web/src/app/api/auth/[...all]/route.ts`) and serves provider callbacks at `/callback/:id` (`better-auth` 1.7.7, `api/routes/callback.mjs`), so the redirect URI for Google is **`https://chemdft.com/api/auth/callback/google`** (constant `GOOGLE_CALLBACK_PATH` in `apps/web/src/lib/auth/google.ts`; a test asserts the authorize URL carries exactly `<BETTER_AUTH_URL>/api/auth/callback/google`). It must equal `BETTER_AUTH_URL` + that path, character for character.

**Rule (decided and enforced; `server.ts` `account.accountLinking`, tests in `apps/web/tests/google-signin.test.ts`):**
1. Google never creates a ChemDFT account. `disableSignUp` is set on the provider unless signup is open and not self-service; with signup CLOSED (today) an unknown Google address is refused (`signup_disabled`) and nothing is created: no user, session or account row. With self-service signup the only creation path stays email + password (terms, verification, quotas), so Google is still sign-in only.
2. A Google sign-in is accepted for an existing account only when (a) it is already linked (same Google subject), or (b) Google reports `email_verified: true` AND the ChemDFT account's own address is verified AND identical (case-insensitive). `trustedProviders` is empty on purpose, so Better Auth never links on an unverified Google address; owner-created accounts are created with `emailVerified: true` (`controlled-users.ts`).
3. Linking while signed in ("Link Google" in Settings) uses the same checks and also requires the SAME email address (`allowDifferentEmails: false`): a Google account with another address cannot be linked.
4. "Unlink Google" is refused when it is the account's last sign-in method (`allowUnlinkingAll: false`, Better Auth `FAILED_TO_UNLINK_LAST_ACCOUNT`); the Settings button is also disabled with the reason. No migration is needed: the `account` table already exists. ORCID is a separate API-side link and is not counted as a sign-in method here.

**Errors in plain words** (`lib/auth/google.ts`, shown on the sign-in page; `errorCallbackURL` brings the user back to `/{locale}/login`): unknown account ("No ChemDFT account uses this Google address. Sign-up is closed: ask the owner for access, or sign in with your email and password."; with self-service signup it says to create an account with email and password first, then link Google in Settings), cancelled consent ("Google sign-in was cancelled. Nothing was changed."), unverified Google address, and a general "did not complete" sentence for provider errors. Raw codes are never shown.

**Owner's steps in Google Cloud (nothing here was done by an agent; screen names are from memory and TO VERIFY in the console):**
1. Google Cloud Console, a project owned by the owner. APIs & Services, OAuth consent screen (Google Auth Platform "Branding"): user type External; app name ChemDFT; support email and developer contact email; authorized domain **chemdft.com**; links to the app home page `https://chemdft.com`, privacy policy `https://chemdft.com/en/privacy` and terms `https://chemdft.com/en/terms` (check these URLs resolve first).
2. Data access (scopes): add only `openid`, `email` and `profile` (non-sensitive). Add nothing else; ChemDFT requests no other scope (a test checks the authorize URL).
3. Publishing status: move from Testing to **In production** (while in Testing only listed test users can sign in and tokens expire after 7 days). Non-sensitive scopes normally need no Google verification review (TO VERIFY).
4. Credentials, Create credentials, OAuth client ID, type **Web application**, name ChemDFT web. Authorized JavaScript origins: not needed for this server-side flow (leave empty; TO VERIFY). **Authorized redirect URI: `https://chemdft.com/api/auth/callback/google`** (exact).
5. Copy the client ID and secret into the environment of the web deployment as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Vercel environment, owner or architect action; never in git, chat or a document) and redeploy the frontend. The backend is not involved.
6. Check, signed out: the sign-in page shows "Continue with Google"; with a Google account whose address equals an existing ChemDFT account it signs in; with another address it shows the "No ChemDFT account uses this Google address" sentence and creates nothing. Then Settings, Link Google / Unlink Google. To turn Google off again, remove either variable and redeploy.
Privacy policy and terms wording for a third-party identity provider is still an owner/legal decision (section 9).

## 11. Release 0.0.29: Google sign-up for beta testers (Option B)

### Overview
Release 0.0.29 introduces `google_only` sign-up mode for non-commercial beta testers under owner control. When configured, users with verified Google accounts can create a ChemDFT account via "Continue with Google" after accepting the Terms of Service and Privacy Policy.

### Rules and Enforcements
1. **Google-only Mode**: `CHEMDFT_SIGNUP_MODE=google_only`. Email/password sign-up remains completely disabled.
2. **Verified Email Required**: Only Google accounts with `email_verified: true` can create an account. Unverified Google emails are rejected with a clear localized error.
3. **Existing Account Linking**: An existing ChemDFT account is never merged unless the verified Google email matches the existing account's email exactly (existing linking rule unchanged).
4. **Global Account Cap**: Controlled by `CHEMDFT_BETA_USER_CAP` (default: unset / null = no cap; "0" or "unlimited" disables the cap; a positive integer sets a cap). When a cap is configured, sign-up checks count atomically via the transactional database adapter. If the cap is reached, sign-up is refused with a "beta is full" message and nothing is created. Owner accounts (`CHEMDFT_OWNER_EMAIL`) do not count against the cap.
5. **Beta Limits**: Self-signup accounts automatically receive `signupSource: "self"`. The API maps this to the `SELF_SIGNUP` profile (small limits: 5 jobs/day, 30 jobs/month, 1 concurrent job, 50MB storage, 5MB upload, AI Scientist disabled). Owner accounts retain `ADMIN` profile (unlimited).
6. **Terms and Privacy Acceptance**: At sign-up, the user must check the terms acceptance checkbox. The acceptance is recorded with `termsVersion: "2026-11-09"` and `termsAcceptedAt: new Date()`. A sign-up attempt without acceptance creates no account.
7. **Owner Management Console**: Located at `/[locale]/owner/accounts` (and `/api/owner/accounts`), accessible only to the owner (`isOwner`). Allows viewing account email, creation date, status, and limits. Owner can toggle account disabled/enabled (disabled users have active sessions invalidated immediately and are rejected on subsequent requests) and adjust per-user limits without hard deletes.
8. **Privacy and Security**: Scopes restricted to `openid`, `email`, `profile`. No tokens or secrets logged. Rate-limited on `/sign-in/social` and `/callback/google` (15 req/min).

### Exact Environment Variables to Switch Google Sign-up On and Off

*(Prerequisite: The four auth database columns must be applied before deployment; see Section 13 for required ordering).*

**To switch Google sign-up ON (Option B beta):**
- **Vercel (Web frontend / Better Auth layer):**
  - `GOOGLE_CLIENT_ID=<google-client-id>` (OAuth client id)
  - `GOOGLE_CLIENT_SECRET=<google-client-secret>` (OAuth client secret)
  - `CHEMDFT_SIGNUP_MODE=google_only` (enables Google sign-up flow while keeping password sign-up closed)
  - `CHEMDFT_BETA_USER_CAP=20` (maximum allowed self-signup non-owner accounts)
  - `CHEMDFT_OWNER_EMAIL=<owner-email>` (comma-separated owner addresses; exempt from cap and beta quotas)
- **Backend SSM (`<ssm-prefix>/env` on AWS EC2):**
  - `CHEMDFT_SIGNUP_OPEN=true` (allows FastAPI identity layer to auto-provision `SELF_SIGNUP` user rows on first valid JWT)
  - `CHEMDFT_AI_FOR_NEW_USERS=false` (AI Scientist disabled for new self-signup accounts by default)
  - Quota keys (optional overrides for defaults; 0 = unlimited):
    - `CHEMDFT_QUOTA_JOBS_PER_DAY=5`
    - `CHEMDFT_QUOTA_JOBS_PER_MONTH=40`
    - `CHEMDFT_QUOTA_CONCURRENT_JOBS=2`
    - `CHEMDFT_QUOTA_STORAGE_MB=200`
    - `CHEMDFT_QUOTA_UPLOAD_MB=25`
    - `CHEMDFT_QUOTA_AI_RUNS_PER_DAY=20`
    - `CHEMDFT_QUOTA_MAX_PROJECTS=5`

**To switch Google sign-up OFF (safely reverting to sign-in only / closed):**
- **Vercel (Web frontend):**
  - `CHEMDFT_SIGNUP_MODE=closed` (default in code; immediately blocks any new account creation)
- **Backend SSM (`<ssm-prefix>/env`):**
  - `CHEMDFT_SIGNUP_OPEN=false` (default in code; refuses auto-provisioning)

*Note:* Existing Google users can still sign in to their existing accounts if `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` remain configured. Setting `CHEMDFT_SIGNUP_MODE=closed` on Vercel immediately prevents any new account from being created.

## 12. Release 0.0.30: Beta cap cross-instance hold and owner console honesty

### Gap 1 Fix: Honest Global Beta Limits
- **Finding:** In 0.0.29, the owner page saved per-user limits into Better Auth's `verification` table (`chemdft:meta:<userId>`), but the FastAPI backend enforces only its own global per-config limits (`account_policy.py`, ADR-045). The console showed limits that did nothing.
- **Resolution (Path b):** Because enforcing per-user overrides on the backend would require a database migration (to add per-user limit columns to `account_profiles` or a quota table) or a new FastAPI route / schema contract change, per-user editable limits were removed.
- The owner console now displays the actual global beta limits enforced by the backend (`DEFAULT_BETA_LIMITS`, configured via backend SSM / env `CHEMDFT_QUOTA_*`).
- The disable/enable toggle remains fully functional (invalidates active sessions and rejects subsequent API requests).
- Pre-existing accounts that are not owners (invited/test accounts with no `signupSource`) are labelled as "Invited Researcher" and are unlimited (ADR-045).
- A design for per-user limits (Path a) is recorded in `NEXT.md` as an open item for future owner approval.

### Gap 2 Fix: Database-Enforced Atomic Beta Cap
- **Finding:** In 0.0.29, `withSignupLock` was an in-process promise mutex, allowing two simultaneous Google sign-ups on different serverless instances to bypass the cap check.
- **Resolution:** Retains the fast pre-check before row creation, and adds a post-create database verification in the user-create `after` hook.
- Non-owner self-signup accounts are counted and sorted deterministically by `createdAt` ascending, then `id` ascending (`localeCompare`).
- If a newly inserted user exceeds the cap (`position >= betaUserCap`), that user row, any associated session, account, and metadata rows are immediately deleted from the database, and the request is refused with `BETA_FULL`.
- No module-level state is relied upon; the database is the source of truth across all serverless instances.
- Pre-existing invited accounts and owner accounts are excluded from the cap count.
- A test simulates the race condition when `cap - 1` slots remain and proves exactly one user succeeds and the excess user is deleted.

### Additional Hardening
- **API Proxy Disabled-User Gate:** `getApiToken` checks `isUserDisabled` in `session.ts`. If an account is disabled, `getApiToken` returns `null`, and `forwardApiRequest` refuses the call with 401 `authentication_required`.
- **Localized Login Errors:** Login error banners support `en`, `tr`, `ru`, and `de` for `BETA_FULL`, `TERMS_NOT_ACCEPTED`, `EMAIL_NOT_VERIFIED`, and `ACCOUNT_DISABLED`.
- **Owner Console Security:** Non-owner and unauthenticated requests to `/api/owner/accounts` return 403 `forbidden` and never expose email addresses.

## 13. Auth database schema and switching sign-up on

### The Two Databases
ChemDFT relies on two separate databases with distinct lifecycles and migration tools:
1. **Backend Postgres database:** Runs domain tables (users, organizations, projects, calculations, results, claims, etc.) managed by Alembic migrations in `services/api`.
2. **Better Auth database (`chemdft_auth`):** Managed by Better Auth (`CHEMDFT_AUTH_DATABASE_URL`, hosted on Neon project `chemdft-auth`, database `chemdft_auth`, table `public."user"`). Alembic does NOT cover or touch the Better Auth database. Changes to Better Auth `additionalFields` in `apps/web/src/lib/auth/server.ts` require a direct schema migration on `chemdft_auth`.

### The Four Columns and Their Types
The user `additionalFields` defined in `apps/web/src/lib/auth/server.ts` are registered only when self-service or Google sign-up is allowed (`CHEMDFT_SIGNUP_MODE` is `open` or `google_only`). The four columns and their SQL types, exactly as applied in production, are:

```sql
ALTER TABLE public."user"
  ADD COLUMN IF NOT EXISTS "signupSource" text,
  ADD COLUMN IF NOT EXISTS "termsVersion" text,
  ADD COLUMN IF NOT EXISTS "termsAcceptedAt" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "termsAccepted" boolean;
```

All four columns are nullable and additive. Existing rows keep `NULL`. A `NULL` `signupSource` denotes an owner or invited account and is excluded from the beta user cap calculation.

### Failure Mode: Database Schema Mismatch (Auth Outage)
Better Auth validates its configured schema against the database on first use. If any declared column is missing, Better Auth throws a schema mismatch error (`BetterAuthError: Database schema mismatch — Missing columns user.signupSource, user.termsVersion, user.termsAcceptedAt, user.termsAccepted`).

Critically, this validation failure breaks **every** `/api/auth/*` call (including `/api/auth/get-session` and regular email/password sign-in), returning HTTP 500 across the entire application—not just on the sign-up route. Warm serverless instances can keep failing for a while; a fresh deployment clears it once the schema is in place.

### Required Operational Order to Switch Google Sign-up On and Off

**To switch Google sign-up ON:**
1. **Apply the four columns to the auth database:** Execute the additive `ALTER TABLE public."user"` statement above on `chemdft_auth`.
2. **Backend SSM and deploy:** Set backend SSM `<ssm-prefix>/env` `CHEMDFT_SIGNUP_OPEN=true` and deploy the backend.
3. **Frontend environment variables:** Set Vercel production environment variables:
   - `CHEMDFT_SIGNUP_MODE=google_only`
   - `CHEMDFT_BETA_USER_CAP=20`
   - `CHEMDFT_OWNER_EMAIL=contact@example.org` (plus `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`)
4. **Deploy frontend:** Deploy the frontend to production.
5. **Verify live:** Verify `/api/auth/get-session` returns HTTP 200, existing sign-in works, and the login page displays the Google sign-in option with terms acceptance.

**To switch Google sign-up OFF:**
1. Set `CHEMDFT_SIGNUP_MODE=closed` on Vercel and redeploy the frontend first. (The auth database columns safely remain in place).
2. Set `CHEMDFT_SIGNUP_OPEN=false` in backend SSM and redeploy the backend.

### Production Record (2026-11-09)
Turning on Google sign-up in production on 2026-11-09 caused an auth outage of approximately 20 minutes when `/api/auth/*` endpoints returned 500 due to the missing columns. The four columns were applied to the production Neon auth database (`chemdft-auth`, database `chemdft_auth`, table `public."user"`) by the architect with explicit owner approval, and the frontend was redeployed, recovering sign-in.

Production sign-up state is now:
- `CHEMDFT_SIGNUP_MODE=google_only`
- `CHEMDFT_BETA_USER_CAP=20`
- `CHEMDFT_OWNER_EMAIL=contact@example.org`
- Backend SSM `<ssm-prefix>/env` `CHEMDFT_SIGNUP_OPEN=true`
- Auth database columns: applied and active.




