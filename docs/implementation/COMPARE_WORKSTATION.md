# Compare workstation (design/compare-redesign-v1)

Status 2026-10-20: implemented on branch `design/compare-redesign-v1` (worktree `.claude/worktrees/design-compare-v1`), based on
`integration/workspace-results-v1` @ 88a3999. **Uncommitted, not pushed, not deployed.** No scientific engine, AI provider or live
data was used; browser evidence is a disposable copy of the accepted PySCF evidence (`tools/rw2_evidence_stack.py`).

## What it is
`/projects/{id}/compare` is one persistent split pane. Left: the published-results library (server-paged
`published-results`, search, type chips, engine / standing / sort, per-row checkbox, reference badge, Result Inspector link).
Right: the live comparison (sticky header with Save / Export / Clear; selected-result cards with Reference (A); compatibility
summary; tabs Key comparison, Plots, Data, Structures, Provenance, Rules). Selecting a second result updates the visible
panel in place; there is no second Compare button and nothing below the fold to find.

## Contracts and rules kept
- Selection = ordered `?result=` ids in the URL (first = reference). Selection changes push a history entry; back/forward,
  refresh and shared links reproduce it. `?saved=<id>` opens a saved comparison (revalidated by the server) and is dropped
  once the selection is edited. Existing `compareHref` / `savedComparisonHref` links work unchanged. Limit 2-8.
- Every verdict, rule outcome, delta and unit conversion is the server's (`calculation_comparison.py`, unchanged). The browser
  never subtracts. Incompatible pairings show the stored values and "No difference"; no chart is drawn for them.
- Plots (ECharts, loaded lazily): server deltas vs reference (hatched when "with limitations"); stored thermal values at their
  own T/p (markers, never joined); stored real mode positions. Each has a data-table equivalent. No temperature curves, no
  interpolation, no scores.
- Stale answers are aborted/ignored (AbortController + key match); selected rows are remembered so filters/paging never drop
  a selection; ids not on a loaded page are read by id; absent ids are reported as unavailable (missing and foreign ids are
  indistinguishable) while the other selections keep working.
- Read-only members see no Save/Archive. Saved comparisons keep members and reference order exactly.

## Backend change (narrow, tested)
`GET /v1/projects/{id}/published-results` accepts repeated `result_id` (max 16): returns only those published results of the
project (project-scoped; unknown/foreign ids simply absent). Tests: `services/api/tests/test_published_results.py`
(named ids, >300 published results paged and compared).

## Libraries
Reused: Blueprint (popovers/icons), ECharts, the existing molecular viewer (`StructureViewer`), `usePublishedResults`.
Not added: TanStack Table/Virtual/Query and react-resizable-panels were not installed in this repo and were not needed (rows use
`content-visibility`, the divider is a small WAI-ARIA separator with keyboard support). No dependency changed; registry unchanged.

## Verification
See the final report in the session; specs: `tests/compare-model.test.ts`, `tests/compare-workstation.test.ts`,
`tests/e2e/compare-workstation.spec.ts`, `tests/e2e/compare-large-library.spec.ts`, `tests/e2e/compare-fixture.spec.ts` (run with
`playwright.rw2-evidence.config.ts`, see each header). Migrated: rw2-analysis-journey (NOT RE-RUN: needs native engines),
rw3-workflows, rw32-researcher-ux, rw2-evidence-viewers selectors.

## Final refinement (2026-10-20, second pass)
Targeted UI/UX pass on the same architecture; nothing rebuilt, no dependency added.
- **Result identity (library):** each row shows type + version, structure and formula, method/basis, engine, charge / 2S+1, the stored
  **temperature and pressure for thermochemistry** (or "conditions not recorded"), a short result id and the stored time (UTC), so
  results with identical energies differ at a glance. Conditions come from the server: `ResultSummary.conditions` and
  `OverviewRow.conditions` (`StoredConditions`, set only when the payload holds both numbers; contracts + generated schemas
  regenerated; tests in `test_published_results.py`). No payload is fetched per row.
- **Count language:** "100 loaded of 1,215 published" (loaded vs matching vs published; the tooltip says what is in the browser),
  "Show more (N not loaded yet)", and a separate "n of 8 selected".
- **Vertical space:** single-row sticky header (title, short verdict, Save/Export/Clear), A–H navigator, two compact cards side by
  side, a compact compatibility strip (verdict + at most two attention rules + one "N of M rules pass · rule details" disclosure
  that holds every rule, each pairing and the server notice) and the Key comparison table. At 1366×768 with the AI dock open the
  title, both identities, the verdict and the first table rows are on the first screen (asserted by Playwright at every desktop size).
- **3–8 results:** navigator of eight slots (filled = selected, A = reference, dashed = free), count "n of 8 selected", real buttons
  that bring a card forward, visible previous/next buttons for the scrolling card row. URL, order and reference are unchanged.
- **Narrow (< 520 px analysis width):** inside the Comparison pane the reference card stays on top and one other result is shown at a
  time, chosen with the B–H slots; Save/Export/Clear are one row of three; wide tables scroll inside a focusable region. Tested at 390 px
  and 820 px (dock open and closed): no page overflow, no clipped card.
- **Quantity level:** every cell says Authorized / With limitations / Incompatible / Not formed / Not subtracted / Unavailable with a
  few words ("level of theory", "conditions differ") and a full sentence in the tooltip and for screen readers; one legend line replaces
  repeated warnings. Nothing is computed in the browser: a withheld thermal difference stays "Not formed" even when the two displayed
  values are equal.
- **AI Scientist context (investigation + smallest change):** the dock keeps the *Workspace* selection and last view label; the Compare
  page publishes no workspace selection, so an earlier answer (for example a Raman explanation) stays on screen and the assistant's
  context does not follow the comparison. Changing that binding means touching the shared AI context contract and
  `ai-scientist-panel.tsx`, so it is **documented, not done**: a future task should add an explicit "comparison" context. This pass only
  adds `CompareDockNotice` (above the dock, Compare page only), fed by a read-only `chemdft:compare-context` event, that states what is
  being compared and that earlier answers belong to their own context. It sends nothing, does not touch the conversation, and
  Playwright asserts no AI run/message request is created and the history text is unchanged.
- **Fixtures for a nonzero difference:** `tools/compare_fixture_seed.py` adds a project named "COMPARE TEST FIXTURE (deterministic test
  values, not scientific results)" to the *disposable* evidence stack only (it refuses any other database). Its results are copies of the
  accepted PySCF HF/STO-3G water record with labelled energy offsets, plus one B3LYP/def2-SVP copy. The server's own evaluator produces
  the verdicts (directly comparable, comparable with limitations on engine version, incompatible on level of theory) and the deltas;
  `tests/e2e/compare-fixture.spec.ts` checks plots, tables, kcal/mol, kJ/mol and Eh against the server. Never real results.

## Limits
Not offered because no real contract supports it: a "compatible candidates only" filter (would duplicate rule logic in the
browser), per-type counts on chips, optimization-history and temperature-curve plots, geometry overlay.
