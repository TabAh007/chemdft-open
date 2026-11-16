# Paper vs ChemDFT workstation (design/comparison-redesign-v1)

Status 2026-10-25: implemented on `design/comparison-redesign-v1` from `origin/main` @ 2628e59 (after PR #6, Claims). Pushed; **no PR, not
merged, not deployed**. The page `/projects/{id}/comparison` and the server delta computation changed. No engine, AWS, Vercel or AI
provider was used; browser evidence comes from a presentation-fixture mock API (`apps/web/tests/fixtures/comparison-mock-api.mjs`), never real
claims or results.

## What it is
A real table whose rows are styled as two-sided strips: **topic | paper | relation and difference | ChemDFT**. Under a row that cannot be
set side by side the server's own words appear in an amber note inside the row ("Why this is not directly comparable": `unresolved_reason`
and `comparison_rule`, verbatim); comparable rows carry the rule as one quiet line. Nothing is coloured better or worse: a difference is a
number the server sent, not a verdict. The inspector leads with **Relation** (state, units, the server's difference with "Source minus ChemDFT", rule, unresolved reason, authority,
review), then the paper and ChemDFT claims, and ends with an **Identifiers** section (record ids, document and evidence ids, provenance hash,
timestamp). An UNRESOLVED row's note is headed "Why this is unresolved"; not-comparable and semantics-differ rows keep "Why this is not
directly comparable". The nine server counts are one dense strip. The inspector (right, or under the rows when the page is narrower than 940 px, decided by a container
query) shows both sides in full. State is in the URL: `?row= ?relation= ?section= ?authority= ?review= ?q= ?view=agreement`. Selecting a
row pushes a history entry; editing filters or the view replaces it. A row named in the URL but hidden by the filters is reported, never
replaced by another. The AI dock is available through `useOverviewDock` as on Compare; the explorer stays hidden.
The page is read only: its only network call is the GET of `/scientific-comparison`.

## Scientific fidelity
- **No rounding.** The old `toFixed(4)` on the delta and `toLocaleString(maximumFractionDigits: 4)` on values are gone. Numbers are
  `String(n)` through `claim-format.ts`. A test fails the build if a comparison source contains `toFixed`, `toPrecision`, `toLocaleString`,
  `Math.round/floor/ceil` or `Intl.NumberFormat`.
- **Server delta fix (separate commit `fix(api): decimal difference of recorded values`).** The server formed the difference as
  `float(left) - float(right)`, so `24.482 - 24.4565` was `0.025500000000000966`. It now forms
  `float(Decimal(str(left)) - Decimal(str(right)))` at both sites in `scientific_claim_actions.py` (`_recorded_difference`): `0.0255`.
  Nothing is rounded, the sign is still source minus ChemDFT, there is no contract or schema change, and values `Decimal` cannot subtract
  (for example infinities) fall back to the previous float arithmetic. The browser still shows the server number verbatim; a unit test with
  `0.025500000000000966` proves the page never rounds it. `docs/02_SCIENTIFIC_INTEGRITY.md` does not document delta computation, so it is unchanged.
  Deltas stored before this change are not recomputed (none are persisted: the relation is built on every request).
- **Qualifier and uncertainty** of both sides are shown as recorded, in the row and the inspector ("Uncertainty (as recorded)", never "±").
- **Server codes** get friendly labels (relation labels were added to `claim-format.ts`, additive); the raw code is in a tooltip and in
  `data-code` / `data-authority`. Unknown codes are shown raw.
- **Type scale:** nothing on the page is below 0.75rem (uppercase labels) and meta text is 0.8125rem; the off-ramp sizes (0.72/0.74/1.05/1.45rem)
  are gone. A unit test checks the stylesheet and a Playwright test checks the rendered text (it also covers the shared Claims classes).
- **Words:** the page says "Source minus ChemDFT" only when the server sent a delta, and never says "agree", "disagree" or "difference" for a
  row without one.

## Agreement view
A scatter of paper value against ChemDFT value, one chart per unit, in a square plot, with a dashed y = x line. **Both axes use the identical
min and max** (the smallest and largest plotted value on either side plus an 8% margin; `axisExtent`), so the line is a true "paper equals
ChemDFT" reference; a unit test asserts identical ranges and that every value lies inside them. A row is plotted only if the server marked it
`SAME_QUANTITY`, it holds one paper claim and one ChemDFT claim, both values are finite JSON numbers, and both recorded units are the same
string. Points carry the server's numbers unchanged (a unit test asserts identity). The extent is axis range, not a statistic: no fit, no residual, no summary, no unit conversion, no error bars (the uncertainty shape is
unspecified). Every excluded row is listed with the reason. The exact values are in a table under each chart; axis ticks are scale labels.
Clicking a point or a table row selects the row. ECharts 6.1.0 (already a dependency) is imported on demand.

## Source links and CSV
- Each side links through the server's `source_href` only ("Source" on the paper side, "Record" on the ChemDFT side); a missing link is said so.
- **Export CSV** writes the visible rows from the loaded server data, in the browser (a Blob download, no request). Columns are fixed
  (`CSV_COLUMNS`); numbers are written with `String(n)`, so `-1.1167593073964255` stays raw. CRLF line ends, RFC 4180 quoting, a UTF-8 BOM so
  spreadsheets read `θ` and `Å`. **Formula-injection policy:** a text cell beginning with `=`, `+`, `@`, TAB or CR gets one leading single
  quote; number cells are never touched. Several claims on one side are joined with ` | ` inside the cell.

## Files
`src/lib/comparison-format.ts` (filters, URL state, explanation, Agreement eligibility, CSV; pure), `src/app/_components/comparison/`
(`comparison-workstation`, `comparison-rows`, `comparison-inspector`, `agreement-chart`, `comparison.module.css`),
`src/app/_components/shared/filter-controls.tsx` (`FacetSelect`, `Chip` moved out of Claims; markup unchanged), `claim-format.ts` (relation
labels), page `comparison/page.tsx` (Suspense wrapper), `globals.css` (old `.comparison-*` block removed), backend
`scientific_claim_actions.py`. Removed: `scientific-comparison-client.tsx`. No dependency added.

## Selectors
Kept: `aria-label="Comparison summary"` with `label` then number text; `tr.comparison-row` (one per row; the reason/rule notes are separate
`tr` without that class, so `rw2-evidence-viewers.spec.ts` counts and filters still hold and was **not migrated or re-run**); `aria-label="Comparison
row inspector"`; heading "Paper vs ChemDFT"; the "View structure" link and the reconstruction warning. **Migrations in `scientific-comparison.spec.ts`:**
(1) `NOT DIRECTLY COMPARABLE` becomes the friendly label "Not directly comparable"; (2) `getByText("1524.4 nm")` becomes a row-name match
(the value is now in both the row and the inspector); (3) the **"Comparable" and "All" quick buttons were removed** (they duplicated
Relation = Same quantity): `click("Comparable")` becomes `getByLabel("Filter by relation").selectOption("SAME_QUANTITY")` and `click("All")`
becomes `selectOption("all")`; "Clear filters" appears with any active filter.

## Verification (fixture mock API; desktop only)
See the delivery report for the raw outputs. Suites: `tests/comparison-format.test.ts` (44), `tests/comparison-workstation.test.ts` (20), the
whole web vitest run, `playwright.comparison.config.ts` (22 new + the migrated `scientific-comparison.spec.ts`), the Claims Playwright suite
(20) after the `FacetSelect`/`Chip` move, backend `test_scientific_comparison_projection.py` (18), ruff and the CI-deselected API run.
Playwright covers digits, qualifier/uncertainty, the why-not-comparable notes, labels, filters and counts, URL push/replace/back/reload, hidden
selection, source links, the Agreement view, the CSV download content, zero non-GET requests, 300 rows and an empty project, keyboard, axe
(WCAG 2 A/AA serious/critical) and 1280/1440/1920 px with the dock open and closed (no page overflow, cells inside their columns).

## Limits
Desktop (>= 1280 px) only; no phone/tablet work. At 1280 px with the dock open the inspector sits under the rows (the page is narrower than
940 px). Not verified: a real project, PostgreSQL, a deployed build, dark theme, the dock's contents (the mock does not serve them), the AI
context for this page (still only the view label; it does not follow the selected row). Dev-mode React strict mode issues the GET twice; a
production build issues it once. The web checks ran with `next dev/build --webpack` because Turbopack rejects the symlinked
`node_modules` of this worktree (no install was run). Backend limits are in `NEXT.md` (no `NEAREST_TO`, order-based XRD pairing, hardcoded XRD
`delta_unit`, JSON-number precision).
