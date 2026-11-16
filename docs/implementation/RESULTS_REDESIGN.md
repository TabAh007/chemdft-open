# Results redesign (Results Library + Scientific Result Inspector)

Status (final refinement pass included below): implemented in worktree `design/results-redesign-v1` (from `1c1bc3e`, the local Overview commit). **Uncommitted, not
pushed, not deployed.** No backend, schema, engine, Result Firewall, AWS, auth or AI change. Workspace, Compare, Jobs, Claims and
the AI Scientist are untouched. All scientific values, classifications and artifacts are the stored ones.

## What changed

**Results Library** (`/[locale]/projects/[projectId]/results`, `_components/results/results-library.tsx`) chooses its shape from
what the project has (`lib/results-model.ts` `libraryMode`):

* **One published result** → a featured summary: the stored primary quantity with its unit, the method/basis/engine/charge-2S+1,
  standing and verification, SCF convergence read from the stored result, and one **Inspect result** action; Compare, Export,
  Job and Reuse settings are compact links. Failed or pending calculations alongside it are a compact list and never change
  the mode. No filter, compare or report controls are shown (they could not be used).
* **Several published results** → a sticky-header scientific table (task, structure, level of theory + engine, primary stored
  quantity with its label and unit, standing + verification, updated). Search, task/engine/standing/state filters, sortable
  columns, multi-selection feeding **Compare** (existing 2–8 limit) and **reports**; compare/report controls appear only
  when selected. 100 rows are rendered at a time with "Show more", so hundreds of results stay usable.
* **No published results** → an empty state that tells four situations apart: no calculations, in progress, failed (with the
  recorded reason), finished without a published result; with Workspace and Jobs actions.
* Saved comparisons are one link to Compare; the structures list is gone (Workspace owns structures). The expanded
  "standing · provenance · export" row moved into the inspector.

**Scientific Result Inspector** (new route `/[locale]/projects/[projectId]/results/[resultId]`, optional `?section=`):

1. Primary stored output once, prominently (value, unit, precise label, convergence, derived conversions identified as such).
2. Context facts (calculation, method, basis, engine/version, charge/2S+1, input structure and version).
3. Input geometry drawn by the product renderer from the hash-verified immutable input (the Overview's `StructureViewer`).
4. **Scientific authority** as four separate facts: result authority, platform validation, independent verification,
   standing & lineage (`describeScientificState`, unchanged). "Validated" is explained as not "verified".
5. Evidence on demand, collapsed by default: **Provenance** (copyable IDs, input SHA-256, producer, attestation, UTC
   timestamps, recorded operations/lineage), **Native evidence** (display-only quantities parsed from the bound native log,
   explicit evidence-derived classification, sanitized excerpt, original-artifact SHA-256, sensitive-content warning,
   authorized original download; PySCF only), **Coordinates** (the hash-verified input table), **Artifacts** (SHA-256 and
   authorized downloads), **Export & reports** (the existing catalog-driven panel).

Other result types reuse their existing viewers inside the inspector (optimization trajectory, molecular orbitals, conformer
ensemble, DFT-D4). A type with no Results viewer (e.g. thermochemistry) says so, shows no invented plot, and links to the
scientific workbench.

## Preserved deep links and navigation

The workspace result deep link (`workspace?selection=calculationResult:…&source=…`), Overview, Jobs, Compare and the
workspace "All results" link are unchanged and still work. Only the Results Library's open action now goes to the
Results-owned detail page. The older Guided six-step flow is not used in Results. The AI Scientist context is kept on the
inspected result (the same read-only selection event the workspace emits). The header AI toggle now works on Results
(same show/hide hook as the Overview); it only shows or hides the panel.

## Scientific wording

The server labels the stored quantity "Total electronic energy". For a single-point SCF energy that is ambiguous: PySCF's SCF
total energy includes nuclear repulsion and is not the electronic-only component. The UI now says "Hartree–Fock total
energy" (method-specific; MP2; GFN2-xTB with its not-comparable-with-ab-initio note) and, for PySCF, states that it includes
nuclear repulsion. **The stored value, unit and the server's label are untouched**; only presentation changed. Conversions
(eV, kcal/mol) use the CODATA 2018 constants, only for hartree, and are marked Derived. No SCF chart or orbital rendering is
created: the stored H₂ result has only the iteration count, and HOMO/LUMO energies from a native log are shown as
evidence-derived numbers, never as orbitals.

## Verification

Unit/jsdom: 43 new tests (949 pass in total, 906 before) (model, inspector model, inspector and library UI incl. evidence binding, missing log, permission
failure, selection limits, the four empty situations). Browser QA on the production build against a local mock API built from
the accepted historical H₂ fixture (`tests/fixtures/as-c1-h2-scientific-log.json`): every library state, the inspector, hash
integrity of a downloaded input artifact, no write requests, permission and not-found states, 1440×900 / 1920×1080 /
1366×768, dock open.

## Not done / limits

* ~~Live e2e specs reference the removed expanded detail row.~~ Migrated and run against the real API and database; see
  *E2E compatibility* below.
* Spectra, thermochemistry, TDDFT and vibrational results have no Results viewer yet (they open in the workbench).
* The convergence tag in the featured card needs one extra read of the stored calculation.
* Negative numbers use a hyphen-minus so copied values stay machine-readable (DESIGN.md prefers U+2212 for prose).
* The scientific-context HTTP 404 in the AI dock is the known, separate AI Scientist integration issue.


## Final refinement pass (scientific integrity & UX acceptance)

### Architectural findings (calculations vs published results)

* `GET /v1/projects/{id}/research-overview` (`research_overview.py`) is **calculation-centric**: one row per
  `CalculationRecord` (newest 300, `total_calculations` counts calculations, `truncated` refers to calculations). Each row
  carries at most one `result_id`, looked up by calculation (a calculation with several result records shows only one).
  `evidence_use` is `NO_RESULT` when no result exists. Failed/queued/running/succeeded-without-result calculations are
  therefore *rows with no result*, not results. A separate `GET /v1/projects/{id}/results` lists result records but without
  quantities or standing, so the overview remains the right source and no parallel state model was introduced.
* Publication is separate from execution: result records are created in one place, the worker-attested publication path
  (`scientific_actions.py`, `CalculationResultRecord(...)`), after validators run; there is no HTTP route that writes a result.
  A succeeded calculation without a result record stays a row with `result_id = null`.
* Superseded/historical results are result records whose read-time `effective_state` is inactive; they stay listed with that
  standing. A row with a `result_id` is shown regardless of its calculation's later state.
* Other consumers of the contract: the Overview results panel and the workspace result-context header read the same
  endpoint and are unchanged; Compare/reports consume result ids only.
* Limits of the overview contract (it still feeds the Overview results panel and the workspace result-context header): the
  300-calculation window can hide older published results behind newer unpublished calculations, and only one result per
  calculation is represented. **The Results Library no longer reads it**: it reads the result-centric endpoint described under
  *Server-side pagination* below.

### What changed

* **Results Library is result-centric.** Only rows with a stored result are listed. Failed, queued, running, canceled and
  succeeded-without-result calculations are **not rows**; one sentence ("N calculations have no published result (1 failed, …)")
  with **View in Jobs** points to Jobs, which owns execution state, failures and logs. Header counts keep apart *published
  results*, *calculation records* (server total) and calculations without a result. No execution-state filter, no "no result"
  standing, no failure labels in the standing column.
* **Table**: one visible action (**Inspect result**) plus an accessible row menu (Compare, Export & reports, Provenance &
  evidence, View job, Reuse settings). Actions are offered only when they apply (View job only with a job) and are permitted
  (Reuse settings only for owner/editor; unknown role offers nothing). Selection, Compare limits (2–8) and reports unchanged;
  Compare still performs the compatibility checks.
* **Inspector**: authority sits under the primary card, beside the viewer (no empty block); IDs/hashes appear once (the
  Provenance operations table no longer repeats artifact hashes); Reuse settings hidden for read-only roles.
* **Native evidence viewer**: search, copy, jump-to sections, line numbers and overflow handling over the *display excerpt*,
  with an explicit "display excerpt, not the original" note; sections are offered only when present in the excerpt; the
  original artifact download, SHA-256 and sensitive-content warning are unchanged. HOMO/LUMO remain evidence-derived numbers.

### Fixture isolation (audit)

* Synthetic records exist only in `apps/web/tests/fixtures` (the accepted historical H₂ log and presentation fixtures) and in
  a throwaway mock API outside the repository used for browser QA; the seven-row screenshots came from that mock on a local
  port. `tests/results-fixture-isolation.test.ts` fails if `src/` imports tests/fixtures, embeds fixture values/hashes/markers
  or zero-filled ids (except the documented dev-identity constants), or if Results code POSTs/PUTs/DELETEs or generates values.
* Production components never manufacture energies, spectra, geometries, hashes, provenance or verification records: values
  come from the stored result/calculation/input artifact and are shown as unavailable when absent.
* No result can be created through the app's HTTP API; nothing was written to any real project or database in this work.

## Server-side pagination over published results

**Problem.** The Library read `research-overview`, which is calculation-centric and capped at the newest 300 calculations. In a
project with more than 300 calculations an older published result could be hidden behind newer unpublished ones, and a
calculation with several result records showed only one.

**Endpoint.** `GET /v1/projects/{project_id}/published-results` (`published_results.py`, contract `PublishedResultsPage`).
One entry per stored result record, so superseded/historical results and several results per calculation are listed.

* **Authorization.** Same project READ scoping as the other project reads: a foreign or unknown project is the same 404 as
  elsewhere, and rows, counts and facets are computed only from that project's records. The route is in the route-authorization
  matrix (150 routes; reads 74). It is read-only: no write, no state change, no artifact access.
* **Stable ordering and paging.** `sort` is one of `updated` (the result record's update time, default), `task`, `engine`,
  `formula` or `energy`, with `direction` `asc`/`desc`, always tie-broken by result id and with missing values last. The cursor
  is keyset (sort value + result id) and is bound to the sort and direction it was issued for, so results published during
  paging never duplicate or skip a row. Pages hold 1–200 rows (default 50); an invalid cursor, sort, direction or standing is
  rejected, never silently replaced.
* **Exact counts.** `total_published`, `total_matching` (after filters), `total_calculations` and the exact breakdown of
  calculations *without* a published result (pending / failed / canceled / finished without a result) come from the whole
  project, not from the loaded rows. Filter facets (tasks, engines, standings) are counted over all published results.
* **Filtering.** `task`, `engine`, `standing` (`current`/`historical`) and free text `q` are applied on the server before
  paging, so a filtered view is complete, not a filter over the loaded page. Energy sorting uses only total electronic energy stored in Eh; a result without such a
  quantity sorts last and no other quantity is ever substituted.
* **Rows are the same rows.** `rows_for_pairs` is the single row builder shared with `research-overview` (refactored into a
  `_Context`); the standing, validation, verification, units and stored values are the server's, uncached and per result
  (`effective_result_state`). The overview's behaviour is unchanged (existing rw3 tests pass).

**UI.** `usePublishedResults` drives the Library: server-side filters/sort, "Load more" by cursor, selection by result id,
Library mode decided from the exact `total_published` (so filtering a long table can never turn it into the single-result card or
the empty state), and no partial-window note any more.

**Tests.** `services/api/tests/test_published_results.py` (15 tests): a project with more than 300 calculations whose oldest
ones carry the only published results; rows equal to the overview's for the same results; counts; two results on one
calculation; historical/superseded; completeness for every ordering with no duplicate and no gap; stable ordering; energy sort;
concurrent publication between pages; filters, facets and text; invalid parameters and cursors; project scoping; read-only;
exact stored energy. `tests/results-model.test.ts` and `results-ui.test.ts` cover the page-based model and UI.

## E2E compatibility (real API and database)

Run against `tools/rw2_evidence_stack.py` (a disposable copy of the accepted evidence database, the real API, no compute
worker, fake AI provider) with `playwright.rw2-evidence.config.ts`:

| Spec | Result |
|---|---|
| `rw3-workflows.spec.ts` | 11 pass when `RW2_EVIDENCE_DB` names the disposable database copy. The supersession test needs it to make one result historical; without it that test is skipped and the later "report download" test fails because the report is still CURRENT. That is a missing test input, not an application defect (an earlier note here called it a pre-existing report bug; it is not). The "reuse" test submits a calculation, which stays queued on the worker-less stack; it is excluded from acceptance runs that must not submit calculations |
| `rw32-researcher-ux.spec.ts` | 12 pass |
| `results-inspector-evidence.spec.ts` (new) | 7 pass: published result with native log evidence, hashes, coordinates, artifacts, export, deep links |

The migrated specs assert the real behaviour of the new Library and Inspector (server counts, filters, paging, selection by
result id, inspector sections, export labels); no assertion was weakened to a mock-only check.

`tests/e2e/integration-overview-guided-results.spec.ts` (integration branch) walks Overview → Results (exact published count) →
result inspector → back → the workspace deep link in Guided mode (same result id) → Guided stages → project sections, on the
same evidence stack; it submits nothing.
