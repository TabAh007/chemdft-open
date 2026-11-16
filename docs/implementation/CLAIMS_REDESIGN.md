# Claims workstation (design/claims-redesign-v1)

Status 2026-10-25: implemented on `design/claims-redesign-v1` from `origin/main` @ 350dac5. reviewed in PR #6; **not deployed**.
Only the project page `/projects/{id}/claims` changed. No engine, AI provider, AWS or Vercel was used; browser evidence comes from a
presentation-fixture mock API (`apps/web/tests/fixtures/claims-mock-api.mjs`), never real claims or results.

## What it is
Library on the left (server order, grouped by claim type with counts), persistent inspector on the right. The AI dock is enabled as on
Jobs/Compare (the header "AI Scientist" button shows and hides it through `useOverviewDock`); the explorer stays hidden.
State is in the URL: `?claim= ?type= ?authority= ?review= ?q=`. Selecting a claim pushes a history entry; editing filters
replaces it. A claim named in the URL but hidden by the filters is reported ("hidden by the current filters", with a clear button),
never replaced by another claim. The page is read only: its single network call is the GET of `/scientific-claims`.

## Scientific fidelity (the point of this change)
- **No rounding.** The previous `toPrecision(5)` rendering (24.4565 → 24.456, -1.1167593073964255 → -1.1168, 123456 → 1.2346e+5) and
  the relation delta `toFixed(4)` are gone. Numbers are shown as `String(n)`, the shortest string that round-trips the double the
  server sent, so no digit is lost or invented. Search matches those full digits.
- **Contract limit (accepted):** a claim value is a JSON number, so a source token such as `24.480` arrives as `24.48` and `100.0` as
  `100`. The page says "digits as the server recorded them". Preserving the original token needs a backend field: follow-up in NEXT.md.
- **Qualifier** is shown verbatim beside the value (rows and inspector), for example the OCR-scaling caveat on a median.
- **Uncertainty** is shown labelled "Uncertainty (as recorded)", never as "±" and never interpreted. A bare number carries the claim's
  unit (it is a field of the same stored quantity, `contracts/scientific.py` `Quantity.uncertainty`); an object is shown as labelled
  fields. Only calculation-result claims carry it today.
- **Ranges** are only called ranges when the server says so (claim type `RANGE` or a qualifier containing "range"), shown "a to b unit".
  Any other two-number array is a plain list.
- **Objects** are labelled fields (`nested.key`, `list[0]`), never raw JSON; rows show two fields and "+N more", the inspector shows up
  to 60 and says how many are omitted.
- **Server codes** (`claim_type`, `source_authority`, `review_state`, `semantic_status`, relation) get friendly labels; the raw code is in
  a tooltip and in `data-authority` / `data-review` / `data-claim-type` / `data-code`. Unknown codes are shown raw.
- Newly shown: `effective_result_state` (with the inactive-source banner and reason), `created_at` (local and UTC), `evidence_id`,
  `source_document_id` (plain ids; links only through the server's `source_href`).
- Relations and `numeric_delta` are the server's, with every digit; no "difference" wording appears when the server gave no delta.
- The claim-type filter gained `NUMERIC_VALUE` and `CALCULATION_RESULT`; unknown types get their own group titled with the raw code.
  Filter counts ignore only their own facet, so a count says what choosing it would show.

## Files
`src/lib/claim-format.ts` (all formatting rules, pure), `src/app/_components/claims/{claims-workstation,claim-inspector,claim-value}.tsx`,
page `claims/page.tsx` (Suspense wrapper), CSS in `globals.css` (`.claims-*`, now on `--cdf-*` tokens), `shell.css` (dock no longer hidden
on Claims; explorer still hidden). Removed: `project-claims-client.tsx`. No dependency added; backend untouched.

## Tests
- `tests/claim-format.test.ts` (30 tests): exact digits (0.123456789, 24.4565, -1.1167593073964255, 1e-10, 12000.5, 123456, round-trip of
  extreme doubles), ranges, objects, uncertainty, deltas, labels, filters, counts, URL round trip, no silent substitution; documents that
  `1.50` as a JSON number arrives as `1.5`.
- `tests/claims-workstation.test.ts`: inspector/value rendering, qualifier/uncertainty, inactive source, ids/links, and the read-only guard
  (loads with one GET; the page sources contain no `fetch`, write method or other transport).
- `tests/e2e/claims-workstation.spec.ts` (20 tests with the migrated `scientific-claims.spec.ts`), desktop only, against the mock API:
  digits, qualifier/uncertainty/objects, labels with raw-code fallback, filters and counts, URL push/replace/back/reload, hidden selection,
  inactive source, ids/links, no non-GET request, 400-claim and empty projects, keyboard, axe (WCAG 2 A/AA serious/critical), and
  1280/1440/1920 px with the dock open and closed (no page overflow, table and inspector side by side, cells inside their columns).
  Run: see `playwright.claims.config.ts`.
- Migrated selectors: `scientific-claims.spec.ts` `/EXTRACTED.*DETECTED/` → `/Extracted.*Detected/` (row text is now the label);
  `rw2-evidence-viewers.spec.ts` authority check now counts `.claim-row[data-authority=…]` (NOT RE-RUN: needs native engines).

## Limits
Desktop (>= 1280 px) only; below 1100 px the inspector stacks under the library (unchanged behaviour, not redesigned, no mobile tests).
Not verified: real claims from a real project, PostgreSQL, dark theme, the AI dock's contents (the mock does not serve them), a
deployed build. The AI context for Claims is still only the view label "Scientific Claims" (`project-dock.tsx`); it does not follow the
selected claim.
