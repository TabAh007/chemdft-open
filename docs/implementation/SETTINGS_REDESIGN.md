# Settings (design/settings-redesign-v1)

Status 2026-10-26: implemented on `design/settings-redesign-v1` from `origin/main` @ e8b9674. **Not deployed, no PR.** No engine, AI provider,
AWS, Vercel or real credential was used; browser evidence comes from a presentation-fixture mock API
(`apps/web/tests/fixtures/settings-mock-api.mjs`, realistic NVIDIA/Kimi responses, never a provider call). Backend untouched.

## What changed
- **Global `/settings/[section]`:** rail + pane (`_components/settings/settings-shell.tsx`). Rail lists **General**, **AI** and a greyed **Billing**
  ("Not in beta"). Compute, Scientific, Privacy and Advanced have no server data: not listed, but their URLs resolve to one "Not available yet" state.
- **General:** real name, email, workspace, role, project count and sign-in kind from `GET /v1/me`; interface language links (translations fall back to English, and
  the page says so). **Header:** initials from `/v1/me` (nothing is drawn until the server answers); "Development identity" only when `isLocalDevelopment()`.
- **AI (`ai-settings-panel.tsx`):** same credential safety as before (password input, `autocomplete=off`, secret cleared on submit and in `finally`, masked
  fingerprint only, "no fallback" wording kept). Friendly labels with raw codes in tooltips and `data-*` attributes; one model picker shared with the dock tab
  (`lib/ai-model-choices.ts`); "SecretProvider" jargon removed.
- **Billing:** static, greyed, one message: "Billing is not available during the beta. No charges are made." **It makes no request at all** (the server creates the
  billing-account row on the first `GET /v1/billing`, so even a read is a write). The checkout button and `createBillingCheckout` are gone.
- **Project `/projects/{id}/settings/[section]`:** General shows the real project name, address, role, dates and id from `GET /v1/projects/{id}`, read-only with
  "Renaming is not available yet." (no update endpoint exists). AI is a read-only view that links to the account page. Billing and the unavailable sections say so.
  The header AI Scientist button now shows/hides the dock here (`useOverviewDock`), as on Jobs and Compare.
- **No fake values for users:** `modelChoices(view, { allowLocalTest })` drops any option with `local_test_only` unless the server page says the app runs in
  local development (`lib/local-development.ts`, same rule as the Projects header; passed to client code through `LocalDevelopmentProvider`). Applies to the
  account AI page, the dock's Settings tab and the dock's model switcher. A saved preference that is not offered (for example `fake-standard` on a hosted build)
  is shown as "not available in this environment", never as raw text; the page says "Test providers are only available in local development." when the server
  offered one that was hidden. The server already refuses to offer the fake provider outside local development (`providers.py` `dev_identity_permitted`).

## What `/v1/me` returns (verified through the mock only; the real endpoint was not called)
`id, display_name, email, kind, auth_mode ("dev"|"jwt"), organization {id, name, kind, role}, setup {has_personal_organization, project_count}`
(`schemas.py` `MeRead`, `identity_service.build_me`; "works for both auth modes"). Roles and `auth_mode` are shown as friendly labels with the raw code in a tooltip.

## Files
New: `lib/{money,local-development,ai-model-choices,settings-model}.ts`, `_components/local-development-context.tsx`,
`_components/settings/{settings-shell,header-identity,general-account-panel,ai-settings-panel,billing-unavailable,ai-usage-readout,project-settings-panels}.tsx`,
`settings.module.css`. Changed: both settings pages, project `layout.tsx` (provider), the dock Settings tab and model switcher, `billing-api.ts`, `shell.css`
(legacy `.settings-*`/`.billing-*` rules removed). Removed: `settings/{ai-settings-panel,billing-panel}.tsx`, `ai-settings.module.css`. No dependency added.

## Tests
- Unit `tests/settings-redesign.test.ts` (25): `formatMinorUnits` (1250 USD → `$12.50`, 0, 5, negative, JPY, KWD, max safe integer, fractional/unsafe/unknown-currency
  fallbacks; BigInt integer arithmetic, no float division), local-test filtering, local-development detection, rail contents, initials, rendered Billing/unavailable/rail.
- E2E `tests/e2e/settings-redesign.spec.ts` (19, desktop, `playwright.settings.config.ts`, two web servers: hosted-like and local development): real account, rail,
  Billing makes **zero `/v1/billing*` requests and zero non-GET requests**, hosted-like build never lists the fake provider while the mock offers it, local development
  does (labelled), model save sends one PUT of an offered pair, credential safety (password field, cleared, key absent from DOM/storage/console/mock state, masked
  fingerprint, revoke), project General real name, AI read-only, axe (WCAG 2 A/AA serious/critical), 1280/1440/1920 × dock open/closed (no overflow).
- Migrated: `ai-model-switcher.test.ts` (fixture passes `allowLocalTest: true`; new test for the hosted case), `billing-usage-ui.test.ts` (import path),
  `e2e/foundation.spec.ts` (stale settings expectations rewritten), `e2e-ai-foundation/foundation.spec.ts` (selectors: model select, "Save key", `data-*` status;
  **NOT RE-RUN**, it needs the real stack and fake provider).

## Limits and NOT VERIFIED
Desktop (≥1280 px) only; below 760 px of container width the rail wraps above the pane (not tested, no mobile work). Not verified: the real `/v1/me` and AI settings
responses on a running API, PostgreSQL, a hosted build, dark theme, the dock's own contents (the mock does not serve them), the "secure key storage unavailable"
state in a browser (copy only), `rw2`/native-engine specs. `AIUsageReadout` is kept with its test but shown nowhere. Jobs/Projects/project-shell identity chips are unchanged.
