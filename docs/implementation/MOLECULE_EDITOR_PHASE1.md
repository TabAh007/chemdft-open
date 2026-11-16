# Molecule editor, Phase 1 — dedicated full-pane 2D editor

Status: **merged and deployed (Phase 1 at fb00b05; compact chrome at 574497d, `dpl_<id>`).** Verified against a mock transport with the real Ketcher
(see "Evidence" for exactly what ran and what did not). The 2D drawing stays schematic; 3D coordinates and explicit
hydrogens still come only from the server's RDKit ETKDGv3 step ("Generate 3D"). Nothing in this change computes, simulates
or invents a scientific value, and no new dependency was added.

## What changed

| Area | Result |
|---|---|
| Entry | "New molecule → Draw manually", "Create molecule", the guided "Draw molecule" and "New version" now open an editor that **replaces the Project pane** (in-pane mode in `structure-workspace-client.tsx`). Import form, Documents and Project knowledge are not rendered while editing. Explorer and the context panel step aside while it is open and return on close. A history entry is pushed, so browser Back leaves the editor, not the project. |
| Action bar | Sticky at the top of the pane: Back ("Project home"), title and subtitle, Name (optional; unnamed → "Drawn molecule"), the schematic note, Cancel, Generate 3D. Buttons are `nowrap` with minimum widths. |
| Start faster | One field for pasted SMILES **or** a MOL/SDF block + "Load into editor"; templates Water, Ethanol, Benzene and a More menu (static SMILES). No network lookup (name search is Phase 2). |
| Toolbar | Labelled, grouped: Tools · Bonds · Rings & chains · Charge · History · Structure · Analyze (+ "More tools" menu). Active tool highlighted (`aria-pressed`), every button has an accessible name, a focus ring and a tooltip with the shortcut. Wraps; never clips. |
| Atoms / groups | H C N O S P F Cl Br (CPK-style colours), Periodic table…, CH3 OH NH2 COOH NO2 CN, More… (Ketcher's structure library). |
| Canvas | Takes the remaining height (min 300 px); hint line sits in its own strip under the canvas (no overlap); selection card (element, charge, valence, status from Ketcher/Indigo). |
| Identifier bar | Live SMILES from `ketcher.getSmiles()`, Copy, Export (SVG/PNG, filename = molecule name), note "Computed from the drawing in the browser · the server re-validates on Generate 3D". |
| Right column | Tabs "3D preview" (empty "Not generated yet" until the real server step returns, then the existing candidate viewer + acknowledgements + Accept) and "AI Scientist" (empty, marked "not available yet"; Phase 3). "Drawing checks" card: formula, heavy atoms, valence, stereo — from the drawing only. |

## How the toolbar drives Ketcher (verified in the browser, Ketcher 3.12.0)

`buttonsConfig` can only hide a subset of named buttons; it cannot hide the core tool groups. Ketcher's own toolbars are
therefore kept mounted but invisible, and ChemDFT's labelled toolbar drives Ketcher. They are **not** `display:none`:
with zero size Ketcher collapses the entries it has no room for (Clean up, Check, Calculated values disappeared from the DOM —
measured), so they keep a real size, sit off screen and are `visibility:hidden` (out of the tab order and the accessibility tree).

**Editor API** (`ketcher.editor.tool(name, opts)`, `undo()`, `redo()`): Select, Erase, Single, Double, Triple, Wedge (stereo 1),
Hash (stereo 6), Chain, Charge +, Charge −, Rotate, Flip (`tool("rotate","horizontal")`), Undo, Redo, and the six group stamps.
Group stamps are hand-built 2D MOL blocks (`lib/molecule-editor/groups.ts`) parsed by Ketcher's own
`formatterFactory.create("mol").getStructureFromStringAsync` and handed to the `template` tool. Hydrogens stay implicit.

**Native proxy** (click Ketcher's own hidden button, found by its stable `data-testid`): Benzene (`template-0`), Ring 6 =
cyclohexane (`template-2`), Ring 5 = cyclopentane (`template-3`), Clean up, Add H, Properties (Calculated values), the "More tools"
entries (Check structure, Aromatize, Dearomatize, CIP, Layout, Structure library), the atom chips (`H-button` … `Br-button`),
Periodic table, and "More…" for groups (Structure library).

**Highlight sync:** a `MutationObserver` reads which of Ketcher's buttons carries `.active` and `resolveActiveItem` merges it with the
toolbar's own choice (so Escape or a shortcut inside Ketcher keeps the highlight honest; a bond subtype survives while Ketcher shows
the generic bond button).

Findings that shaped the code:
- Indigo's auto-loader is lenient: `setMolecule("C(C")` loads two atoms, `"hello world"` loads an empty structure, `"[Xx]"` loads one
  atom — no error. A strict SMILES syntax check (`smiles-syntax.ts`) and a MOL structure check run first; Indigo's `convert` must then
  return at least one atom; only then is the canvas touched, so a failed load never erases the drawing.
- `ketcher.indigo.check(molfile, {types})` and `ketcher.calculate()` supply valence/stereo flags, the Hill gross formula and weights;
  heavy atoms are derived from that gross formula. `generateImage(molfile, {outputFormat})` supplies SVG/PNG.
- An unattached NO2 stamp reads `HNO2` (the N+ has one implicit hydrogen); attached to a carbon it has none. This is Ketcher's valence
  model, not an error.
- Functional-group *library* entries (Ketcher's FG templates) are not exposed by the installed build (`functionalGroups` option off), so
  the six chips use ChemDFT's own standard-connectivity stamps and "More…" opens the template library.

## Files

New: `src/lib/molecule-editor/{strings,smiles-syntax,structure-input,templates,groups,toolbar,export-name,drawing-checks,ketcher-types}.ts`,
`workspace/{molecule-editor-pane,molecule-editor-toolbar,molecule-editor-menu}.tsx`, `workspace/molecule-editor.module.css`,
`tests/molecule-editor.test.ts`, `tests/e2e/{molecule-editor-flow,molecule-editor-layout}.spec.ts`,
`tests/e2e/helpers/molecule-editor-mocks.ts`, `playwright.editor.config.ts`.
Changed: `structure-workspace-client.tsx` (in-pane mode, lazy pane, panels step aside, history entry; the unused
`saveKetcherMolfile` helper was removed, which exposed latent React-compiler lint findings in that file — suppressed line by line,
see NEXT.md), `ketcher-2d-3d-acceptance.spec.ts` and `localhost-real-flow.spec.ts` (selectors only).
`KetcherEditorPanel` in `ketcher-editor.tsx` still serves the "candidate" draft mode; its project-mode branch is now dead code (cleanup follow-up).

The pane is a `next/dynamic` import (`ssr:false`), so Ketcher and the editor load only when a drawing is opened.

## Evidence (real output; see the final report for the run log)

- Unit: `tests/molecule-editor.test.ts` — SMILES/MOL parse errors, load never touches the canvas on failure, toolbar-state mapping
  (`resolveActiveItem`), driver dispatch, export filename, drawing-check parsing.
- Playwright flow (mock transport, real Ketcher, installed Google Chrome 156): open as full pane, Back/Cancel without saving, browser
  Back, templates (formula verified by Indigo for all nine), paste SMILES/MOL, invalid input errors (drawing unchanged), bonds, rings,
  charge, erase, undo/redo, highlight, group stamps, wedge/hash molfile stereo, flip, Properties, Periodic table, selection card, drawing
  checks, copy, SVG/PNG export names, Generate 3D request body and preview, empty-drawing and server-failure errors, AI slot.
- Playwright layout at 1093×520, 1024×600, 1280×600, 1366×768, 1920×1080: no horizontal overflow, sticky bar and Generate 3D visible,
  every toolbar/atom/group button visible and labelled, canvas ≥ 300 px, preview empty — each with drawer closed, drawer open,
  post-Chrome-109 CSS stripped, and +40 % label length. Screenshots: `output/playwright/molecule-editor/{before,after}-*.png`.

## Isolated-runner results (real API + real RDKit, 2026-11-02)

`CHEMDFT_E2E_CHANNEL=chrome [CHEMDFT_E2E_GREP="…"] python3 tools/run_isolated_e2e.py --suite geometry --no-worker` (the isolated config gained the two optional env switches).

| Scenario | Result |
|---|---|
| F drawn ethanol / ethylamine, real Generate 3D, composition text | PASS |
| G raw 2D blocked (UI and API) | PASS |
| E edit existing structure, new version, lineage, parent untouched, cross-project 404, Accept | PASS |
| I (new) pasted SMILES: invalid refused, valid loaded, real Generate 3D, review text, Accept | PASS |
| A-D & H drawn hexane/heptane: Generate 3D, invalidation, async orderings, Accept | **FAIL** after Accept, at `panel.getByLabel("Method").selectOption("hf")` for Psi4 (Psi4 is not configured for new runs; run with `--no-worker`) |

**Baseline (2026-11-02):** the same scenario on `origin/main` at `c2b911c` (a throwaway worktree of main with only the two optional env switches added to its isolated config; the old spec and the old editor) also **FAILS**, in the same post-Accept calculation segment but one step earlier: `page.waitForResponse(.../calculations/capabilities)` timed out after 60 s (line 263), whereas with the editor the capabilities response arrived and the run then failed at the Psi4 Method selector (line ~278). So the failure is not introduced by the editor: drawing, Generate 3D and Accept pass in both; the Calculate/Psi4 part does not pass on either (Psi4 is not configured for new runs). The exact failing line differs, probably because the capabilities request fires at a different moment after Accept; that was not investigated.

Bugs found by these runs and fixed: (1) Ketcher's standalone worker crosses answers of overlapping calls (`getSmiles()` returned a MOL block, `getMolfile()` returned "CCN"), so every async Ketcher call is queued (`serial-ketcher.ts`) and MOL reads are verified (`read-molfile.ts`); (2) the candidate card lost the established wording ("9 atoms", "2 carbons, 1 oxygen", "Inspect Atomic Coordinates"). Spec migrations: native Clear button replaced by Select all + Delete (`setMolecule("")` made `getMolfile` return a bare sequence), the "Edit" button is now "New version", and the lineage acknowledgement is ticked when the composition differs (RW-3.2 guard).

## Not done / not verified

- `localhost-real-flow.spec.ts`: NOT RUN (the isolated runner lists it as excluded: interactive shared stack). Its selector was migrated only.
- `rw32-researcher-ux.spec.ts`: NOT RUN (needs the evidence stack).
- Real Chrome 109: not available. Runs strip every CSS rule with `color-mix(`, `text-wrap`, `subgrid`, `@starting-style`, `@scope`, anchor positioning or `field-sizing`; the new CSS uses none.
- Dark theme: the app has no dark theme (no `prefers-color-scheme`, `data-theme` or `.dark` rule anywhere). With dark emulated at 1366x768 the editor renders light and legible (`output/playwright/molecule-editor/after-1366x768-dark.png`).
- Not checked: real translation, phone/tablet widths, an automated axe scan, a keyboard-only walk-through, the deployed site, bundle size before/after (the editor and Ketcher load lazily).
- Reloading while the editor is open leaves Explorer/context panel hidden (their normal persisted preference); the history entry popped after Accept is not exercised.
- Phase 2 and Phase 3 are parked in NEXT.md.


## Compact chrome (2026-11-02): the canvas gets the height

Merged as PR #49 (574497d) and deployed 2026-11-02 (`dpl_<id>`; rollback `dpl_<id>`). No science change; no new dependency (Blueprint `OverflowList` was not needed, see G).
Impeccable workflow: design standards reviewed against the brief (labels stay visible, Blueprint primary, `--cdf-*` tokens), measured before/after with Playwright `getBoundingClientRect`, implemented, and visually reviewed from the screenshots listed below (the Impeccable CLI/skill itself was **not** invoked in this run).

### Editor (A-F, commit 1)
| | Change |
|---|---|
| A | While the editor is open `.workspace-tabs` and `.document-toolbar` are hidden (`.workspace-chrome[hidden]`, kept mounted so `:has(.workspace-tabs)` layout rules still hold) and return on close. Inspect/Ask AI/panel toggles: the header "AI Scientist" button (now also shown in the Advanced workbench while the editor is open) opens the context panel. |
| B | One ~44 px bar: Back (visible text "Back", aria-label unchanged) · "New molecule" + "2D · schematic" badge + (i) popover (subtitle and schematic note) · Name · Import ▾ · Focus · Cancel · Generate 3D. Buttons `nowrap`; only a +40 % label simulation may wrap the bar. |
| C | "Start faster" row replaced by the Import ▾ popover (SMILES/MOL field, Load, template chips, More). Errors show in the popover; with it closed a non-blocking strip (`role=alert`/status) sits under the bar. Success closes the popover. |
| D | Tool ribbon -> left rail (two columns, icon + label, thin dividers, group labels kept as `role=group` names and tooltips); Atoms/Groups -> right rail beside the canvas (3-column chips, Periodic table, More). Rails scroll independently. Below 960 px the side column drops under the canvas; below 760 px the atoms rail becomes a wrapping row. "More tools" opens a `position:fixed` menu so the scrolling rail does not clip it. |
| E | Focus button, Ctrl/Cmd+Shift+F and Esc: `html[data-editor-focus=on]` hides app header, project nav and shelf; `aria-pressed`, status announced via the live region, remembered per session only (`sessionStorage`). Ketcher has no fullscreen shortcut of its own, so Ctrl/Cmd+Shift+F is ChemDFT's. |
| F | 3D preview / AI Scientist tabs and Drawing checks unchanged in the right column; the identifier bar is one 34 px row (long note is a tooltip + short text). |

### Shell (G-I, commit 2)
- **G** At >= 1100 px the project navigation renders inside the 42 px app header (single instance, `useSyncExternalStore` + `matchMedia`); below it, the row under the header as before. All 8 tabs and routes kept; the existing container queries collapse labels (icons + `title`, active label stays) instead of a "More" menu.
- **H** 44 px targets only under `(pointer: coarse)`; mouse gets 32 px (`product-header.module.css`, `.ai-dock-toggle`); project name/focus links got a 24 px minimum.
- **I** "Show/Hide Explorer" and "context panel" are icon buttons with `title` below 1280 px (text stays in the DOM as the accessible name), full text from 1280 px.

### Before / after (Playwright `getBoundingClientRect`, mock transport, installed Chrome; canvas = `editor-canvas-frame`)
| Viewport | Header+nav (before) | Tabs | Doc toolbar | Action bar | Start row | Toolbar ribbon | Atoms row | Canvas top | **Canvas height** |
|---|---|---|---|---|---|---|---|---|---|
| 1093x520 before | 42+34 | 34 | 36 | 71.4 | 53.3 | 143.4 | 44 | 329 | 300 |
| 1093x520 after | 42+34 | 0 | 0 | 44 | popover | rail | rail | 129 | 300 (min; page scrolls) |
| 1280x600 before | 42+34 | 34 | 36 | 71.4 | 53.3 | 75.7 | 44 | 413 | 307.8 |
| 1280x600 after (G) | 42 (nav inline) | 0 | 0 | 44 | popover | rail | rail | 95 | **400.2** |
| 1366x768 before | 42+34 | 34 | 36 | 71.4 | 53.3 | 75.7 | 44 | 413 | 307.8 (identifier bar ended below the viewport) |
| 1366x768 after (G) | 42 (nav inline) | 0 | 0 | 44 | popover | rail | rail | 95 | **568.2 (+260)** |
| 1920x1080 before | 42+34 | 34 | 36 | 55.2 | 53.3 | 75.7 | 44 | 397 | 570 |
| 1920x1080 after (G) | 42 (nav inline) | 0 | 0 | 44 | popover | rail | rail | 95 | **880.2 (+310)** |

The measured header was 42 px (not 58) and the project nav 34 px (not 44). Editor-only (commit 1) at 1366x768: canvas 534 px (+226); the shell change (G) adds the rest. At 1093x520 the editor-only canvas is bounded by its 300 px minimum and the page scrolls, as before; the sticky bar, Generate 3D and the SMILES row stay inside the viewport (spec).

### Verification (real output, 2026-11-02)
- `tsc --noEmit` clean; `pnpm run lint` clean (`--max-warnings=0`); full vitest **113 files / 1459 tests PASS**.
- Playwright editor config (mock transport, real Ketcher, installed Chrome): `molecule-editor-flow` 15 + `molecule-editor-layout` 30 (5 viewports x {fits, drawer open, Chrome-109-stripped CSS, +40 % labels} plus new specs: chrome hidden/restored, one-line bar, info popover + Esc focus return, Import popover paste/Load/invalid/strip, Focus mode + Esc + shortcut + announcement, keyboard-only Tab path and Enter/Space activation, rails beside the canvas, single-row header, header target sizes 24-42 px, panel-toggle icon/text) = **45 PASS**. Canvas thresholds asserted: >= 360 px at 1366x768, >= 300 px elsewhere.
- Guided workspace `chrome109-workspace-layout.spec.ts`: **12/12 PASS** (run with `channel: chrome`; the bundled Playwright chromium is not installed here).
- Isolated runner (`CHEMDFT_E2E_CHANNEL=chrome CHEMDFT_E2E_GREP="Scenario (E|F|G|I):" python3 tools/run_isolated_e2e.py --suite geometry --no-worker`, real API + RDKit): **E, F, G, I PASS** (4 passed, 1.3 min). The runner first refused to start (`TEST_DISK_RESERVE`, free space hovered at 12.4 GiB against its 12 GiB floor); the regenerable `apps/web/.next` dev cache (1.9 GiB, only my dev server used it) was deleted and the dev server restarted afterwards.
- Screenshots: `output/playwright/molecule-editor/compact-<vp>{,-scrolled,-drawer,-chrome109,-ru}.png` (after); `before-chrome-compact-*.png` (state before this task) and `before-*.png` (older).

### Not done / not verified
- Scenarios A-D & H not re-run (same Psi4 baseline failure as before). `localhost-real-flow.spec.ts`, `rw32-researcher-ux.spec.ts`: NOT RUN. Real Chrome 109, touch device (`pointer: coarse`), screen reader and axe: NOT RUN. Other pages' header/nav at the new single row were checked only through the workspace and editor specs, not every route.
- No "More ▾" overflow menu for the header nav (labels collapse to icons instead); no collapse of the atoms rail into a popover (it wraps under 760 px instead).
- Deploy: done 2026-11-02 after "approve deploy"; alias chemdft-beta.vercel.app verified on the new deployment; `/en`, `/en/learn/cite` 200. Real-browser visual check of production not run.
