# RW-3.2 — Researcher experience: navigation, molecule identity, results and exports

UI/UX milestone over the accepted RW-1…RW-3.1 workstation. No engine, numerical algorithm, migration or
stored scientific record changed. One backend change: the export catalog now classifies the evidence
archive with the same assessment as the download.

## Audit findings (root causes, verified before changing code)

| Observed | Root cause | Fix |
|---|---|---|
| Ethanol committed as "Water V2" | After a commit the workspace opens the structure tab, whose toolbar offered only **Edit**. Edit opened Ketcher with `parent_structure_version` = the selected version and still showed an editable *Molecule name* field — which the server ignores for a parented candidate. The save target was also read from the *current* selection at render time. | Distinct **New molecule** / **New version** actions; frozen, stated save target; composition check (below). |
| Stale default names | New-molecule editor was prefilled with the selected structure's name; a name typed after *Generate 3D* was silently not used (the candidate carries the name it was generated with). | New molecule starts empty (`Drawn molecule` only if left blank); changing the name invalidates the candidate. |
| Results → "Open result" → empty tab | (a) The link targeted the *calculation* record; calculation tabs rendered nothing for MO/TDDFT/IR/Raman/thermochemistry/D4 results (their viewers render only for result tabs, and the summary was suppressed for those types). (b) The workspace state lives in the project layout and read `?selection=` only on first load or `popstate`, so client-side links into the workspace were ignored. | Links open the result; calculation records always show a summary with **Open result**; the provider follows URL selection changes. |
| Guided and Advanced not clearly separated | Guided mode hid the icon rail, so Results/Compare/Jobs had only per-page tab strips (each linking a different subset); `/compare` was also highlighted on `/comparison` (substring match). | One section navigation for both modes (below). |
| Cramped tables, horizontal scrolling (1400/640 px) | Results/Compare page grids sized their column to the table's min-content; `.screen-reader-only` spans (absolute, no positioned ancestor) widened the page; explorer + AI dock left 464 px at 1024; Guided mode set `overflow: hidden` on every page's document, so Results/Compare/Jobs could not scroll at all in Guided mode. | See *Layout*. |
| Search "hf / sto-3g" found nothing | Search text held method and basis separately, not the displayed "hf / sto-3g". | Displayed level of theory is searchable. |
| Actions vs navigation | Panel toggles led the Advanced toolbar; three explorer text actions were squeezed by a 28 px icon-button rule and overlapped headers. | Actions first, panel toggles at the end; explorer actions sized normally. |
| CREST catalog said REPRODUCIBILITY_PACKAGE, archive was PROVENANCE_ARCHIVE | `assess_variant` ran `_assess(read=False)`: it never read/projected the stored engine input, so inputs that cannot be exported without scientific loss (CREST) or whose bytes fail their hash were counted as included. | Catalog uses the download's assessment (`read=True`). |

Not addressed (per instruction): the `Maximum update depth exceeded` freeze seen once during AI-driven
browser automation (UV-Vis → optimization trajectory). It was not experienced by the user and was not
reproduced or investigated here.

## Information architecture

One **section navigation** (`ProjectSectionNav` in `project-shell.tsx`, sections in `lib/project-sections.ts`)
sits at the top of the document column in both modes, in research order:

`Overview · Workspace · Results · Compare · Jobs | Claims · Paper vs ChemDFT | Settings`

It replaces the icon rail and the per-page tab strips; active state is an exact segment match.
The header shows **project › research focus** (last molecule/result/view the workspace reported, kept per
project in `sessionStorage`; a link back to it from other sections). Concepts stay distinct: project (header),
molecule + version (structure tabs, `Name · Vn`), calculation record (calculation tab), result (result tab with
its context header), analysis (viewers inside the result), exported evidence (export panel).

## Molecule identity and versions

`lib/molecule-target.ts` defines the semantics; the editor and toolbar use it.

* **New molecule** — separate structure with its own history. Offered in the project toolbar, the structure
  toolbar (next to New version), the Guided home and the empty state. Name starts empty.
* **New version** — appends `V(n+1)` to the explicitly chosen lineage; the lineage name is shown read-only.
* The editor states its target (`Saves as Water · V2`) and the accept step repeats it ("Accepting commits …").
* The target (structure, version, expected revision, name, composition) is **frozen when the editor opens** and
  the panel is keyed by it, so selecting another structure never redirects a save and no state carries over.
* A new version whose atoms differ in composition from its parent (e.g. H₂O → C₂H₆O) blocks acceptance until
  the researcher confirms the lineage change or chooses **Save as a new molecule instead** (keeps the drawing).
* Commit feedback names what happened ("Committed Ethanol V1 as a new molecule…" / "…V2 as a new version… parent V1").
* An open drawing is registered as unsaved work; switching mode or section asks before discarding it.
* Server semantics, history and provenance are unchanged; existing results stay attached to their versions.

## Guided and Advanced

* **Guided journey** (`lib/guided-journey.ts`, `guided/guided-journey.tsx`): Prepare molecule → Review geometry →
  Choose calculation → Run calculation → Inspect result → Analyze & export. Shows done/current/blocked (with the
  server's geometry-eligibility reason) and a **Next** action; *Analyze & export* opens Results (reports, exports,
  comparison). The guided nav item formerly labelled "Overview" is now **Guided home**.
* **Advanced Workbench** keeps the explorer, tabs, inspector and all direct controls.
* Mode switching keeps project, selection, structure version and active result (existing provider logic);
  an uncommitted drawing is only discarded after confirmation.

## Results and analysis

* Results/Compare "Open result" → `workspace?selection=calculationResult:<id>&source=<calc>` (`resultWorkspacePath`).
* Every result and calculation canvas — and the Guided result, spectra and thermochemistry views — starts with a
  **result context** header (`result-context-header.tsx`) built from the server's `research-overview` row:
  task, primary stored quantity with unit, engine + version, method/basis (+dispersion), charge/2S+1, structure
  (name · Vn · formula), effective standing (Current / Historical / No result), verification
  ("Not independently verified" unless the server says otherwise), available analyses, links to Results/Compare/Job.
  Historical and UNKNOWN standing never read as current. One overview request per project, cached 15 s,
  refreshed on `chemdft:workspace-items-changed`.
* Calculation records always render: status, failure diagnostic, "not published yet" while running, and **Open result**.
* Missing/foreign links: the tab is closed and a notice says the item is not available; nothing is substituted.
* Back/forward follow the URL selection (unchanged `popstate` handling plus the new URL follower).

## Comparison and exports

* Compare links open results directly; tables scroll within their section; rules R1–R8 untouched.
* Export panel grouped as **Raw scientific data** (result JSON, trajectory XYZ, spectrum CSV, CUBE),
  **Human-readable report**, **Evidence archive**. The archive class (Reproducibility package / Provenance archive)
  and its reason are visible text, and the download button names the class.
* Catalog = download: `reproducibility_bundle.assess_variant` now calls `_assess(read=True)` (stored structure and
  engine-input bytes read, hash-verified and projected — the same path as `build_bundle`). If the archive would be
  refused (limit/content check), the catalog marks it unavailable instead of offering it. Default-deny projection,
  credential withholding, limits, historical labels, project authorization and RW-3.1 environment sufficiency are
  unchanged. Cost: the catalog now reads two small stored artifacts (≤ `scientific_max_output_bytes`).

## Layout and responsive behaviour

* Section pages (Results, Compare, Jobs…) put the document first: below 1280 px the Advanced explorer yields on
  those pages; below 760 px the AI dock yields there too (the workspace keeps both and its own toggles).
* Page grids use `minmax(0, 1fr)`; wide tables scroll inside their own regions; `.screen-reader-only` is anchored.
* Guided mode locks the document scroller only for the guided workspace.
* Section-nav labels for secondary groups collapse by container width; below 760 px only the current label shows.
* The molecule editor is full width (it had inherited the coordinates pane's two-column grid).
* The expanded standing/export row on Results stays in view (sticky, container width) while the table scrolls.
* Explorer text actions no longer overlap headers; explorer count/empty labels meet 4.5:1 contrast.
* Below 760 px the mode switch shows icons (names kept for assistive technology) and Guided field tabs wrap.
* Verified at 1920/1440/1024/640 px in both modes: neither the page nor the document column scrolls sideways.

## Tests and evidence

* Unit: `apps/web/tests/rw32-researcher-ux.test.ts` — save target, Hill formula, composition change,
  section matching, focus label, result deep link round-trip, context model (standing never upgraded), journey,
  export grouping, results search by displayed level of theory (18). Full web suite: 57 files / 598 tests pass (56 / 580 before).
* Backend: `services/api/tests/test_rw32_export_catalog_agreement.py` (4, real xTB run on disposable storage) —
  catalog = archive for non-exportable engine input and hash mismatch (both fail with the old `read=False`),
  refused archive not offered, project isolation.
* Browser (disposable copy of the accepted evidence DB): `apps/web/tests/e2e/rw32-researcher-ux.spec.ts` (11) —
  navigation, Open result + back, never-blank calculation records, missing links, export grouping vs actual
  download class, Water → Ethanol → Water V2 identity flow (formulas checked through the API), unsaved-drawing
  guard, Guided journey, layout at four widths, axe (WCAG 2 A/AA serious/critical) on Results and Guided.
  Run: `python3 tools/rw2_evidence_stack.py --api-port 8191 --web-port 3191`, then
  `RW2_EVIDENCE_API_PORT=8191 RW2_EVIDENCE_WEB_PORT=3191 RW2_EVIDENCE_SPEC=e2e/rw32-researcher-ux.spec.ts playwright test --config playwright.rw2-evidence.config.ts`.
* Regression on the same disposable stack: RW-2 evidence viewers 10 passed / 1 skipped (conditional), RW-3 workflows
  9/9 (incl. its axe sweep); isolated Ketcher geometry suite (`tools/run_isolated_e2e.py --suite geometry`) 2/2;
  backend export/archive/workflow/authorization suites 130 passed.
* Screenshots: `output/rw32-review/screens/` (after) and `output/rw32-review/baseline/` (before).

## Known limitations / deferred

* The Guided side navigation still repeats Compare, Jobs and Settings in its "Secondary" block (kept because
  accepted e2e specs drive those controls); the section navigation is the primary route.
* The header AI Scientist toggle only acts inside the workspace (pre-existing).
* The research focus label is taken from the workspace's existing selection broadcast; views that do not broadcast
  keep the previous focus.
* Explorer N+1 calculation requests (RW-3 finding) are unchanged.
* `reproducibility_bundle.py` / `scientific_export.py` were not reformatted (pre-existing `ruff format` drift).
