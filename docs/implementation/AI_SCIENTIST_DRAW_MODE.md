# AI Scientist "Draw" mode — live molecule drawing through typed editor commands (Phase 3a)

Status: **Phase 3a deployed (PR #51/#53); quality fixes in branch `fix/draw-quality-a` (this document, "Quality fixes 2026-11-02") are NOT deployed.** Live calls: 40 of 40 (first acceptance) and 25 of 25 (quality task) used; no more approved. Deploys wait for the researcher's "approve deploy".
This mode edits a **schematic 2D drawing**. It never produces an energy, spectrum, property, citation, DOI, version or structure authority. English is the only tested language; other languages are **untested**.

## Design

The researcher chats in the full-pane molecule editor (AI Scientist tab). The model never draws: it returns one JSON object of **typed commands**; the server validates each with RDKit and returns, for every step, the resulting molfile (2D coordinates), SMILES and formula. The editor loads each step's molfile into Ketcher one by one (no Ketcher atom-level API), runs Ketcher's clean-up at the end, and marks the drawing "AI-drafted · schematic".

| Piece | Where |
|---|---|
| Reference table, name matching | `ai/draw_known.py` |
| Route `POST /v1/projects/{id}/ai/conversations/{cid}/draw` (READ capability, same auth/project/creator scoping and per-user AI run limit as `/messages`) | `main.py`, `ai/draw_service.py` (`DrawServiceMixin` on `AIScientistService`) |
| Ops, RDKit engine, count/formula check, refusal filter, reply filter, prompt | `ai/draw.py` |
| Contracts `DrawInput`, `DrawResponse`, `DrawStepView`, … (generated into `@chemdft/schemas`) | `contracts/ai.py`, `contracts/bundle.py` |
| Chat panel, banner | `workspace/molecule-editor-ai-draw.tsx`, `workspace/use-ai-draw.ts`, `lib/molecule-editor/ai-draw.ts` |

**Reuse of the existing AI path (same as CHAT):** `_reserve_model_request` → `_generate` → `_record_model_usage` → `settle_model_usage` (or `settle_uncertain_usage` on failure), per-run budget, `ai_model_invocations` row (`prompt_version = CHEMDFT_DRAW_MODE_V1`), `ai.request.started/completed` audit events, provider pinning to the run's context snapshot, `profile_gate("EVIDENCE")`, the STANDARD tier with `direct_answer=True` (thinking off where the model card allows). A user message and the assistant reply are stored in the conversation (`evidence_status` null, `evidence_note` = "AI-drafted schematic drawing…"). **Deviation (written reason):** DRAW has its own route instead of being a `mode` on `/messages` because its response is structured (steps with molfiles), which `AIConversationDetail` cannot carry; everything else follows CHAT.

## Op table (closed list of 13; max 40 ops per request)

| Op | Arguments | Notes |
|---|---|---|
| `add_atom` | `element`, `count`=1, `attach_to`? | explicit atoms; `attach_to` single-bonds each new atom to that atom |
| `add_bond` | `a`, `b`, `order` 1-3, `stereo`? (`wedge`/`hash`) | on an existing bond it changes the order |
| `add_ring` | `size` 3-8, `aromatic`=false (size 6 only), `attach_to`? | carbon ring; aromatic = Kekulé alternating |
| `add_group` | `name` ∈ CH3, C2H5, OH, OCH3, NH2, SH, CHO, COOH, COOCH3, CONH2, NO2, CN, CF3; `attach_to` | fixed SMILES table in code, never model text |
| `set_charge` | `atom`, `value` -3..3 | |
| `set_element` | `atom`, `element` | |
| `delete` | exactly one of `atom`, `bond:[a,b]` | |
| `connect_fragments` | `a`, `b`, `order` | atoms must be in different fragments |
| `load_smiles` | `smiles`, `label`, `replace`=false | SMILES charset-restricted, ≤400 chars; **always labelled an AI proposal** |
| `add_copies` | `source`, `count` 1-12, `layout` grid\|row | N separate copies of ONE validated molecule: `source` is a table name (`ai/draw_known.py`), the label of an earlier `load_smiles`, or `current` (the single-fragment drawing); each copy laid out by RDKit, packed on a grid |
| `clear_all` | – | the drawing becomes empty in one step (a valid zero-atom molfile, so Ketcher clears) |
| `clean_up` | – | RDKit re-layout |
| `undo_last` | – | restores `previous_molfile` supplied by the client |

Atom ids are the 1-based molfile numbers of the drawing the request carried; atoms the plan creates get consecutive ids (`add_ring` in ring order, `add_group` attachment atom first). The server tells the model the next free id. Unknown ops, extra fields, more than 40 ops, invalid JSON or any schema violation reject the plan (`PlanRejected`); nothing is executed from free text. Elements must be real symbols 1-118 (`Xx`, `Q`, `c` are refused per step). Limits: ≤120 atoms, ≤200 kB molfile.

## Validation rules

1. **Per step:** the op is applied to a copy, the molecule is sanitized (valence, kekulization), existing atoms keep their coordinates (RDKit `coordMap` pinning) and new atoms are laid out. A failing op leaves the drawing untouched and **stops the plan at the last valid step**; the reason and a suggestion are returned (`PARTIAL`, or `REJECTED` when no step succeeded). Ordering limit: because every step is sanitized, a plan must set a charge before adding the fourth hydrogen of NH4+ (the model repaired exactly this in the live run).
2. **One repair retry** (shared by: invalid plan, failed step, count mismatch, stated counts with no ops and no `clarify`). Never more than 2 model calls per request. The failed step is replaced by the retry's ops, applied on the last valid state.
3. **Stated counts/formula:** counts ("6 H, 2 N, 1 C", "two nitrogens") are verified against RDKit totals including hydrogens implied by valence. On an empty drawing they are the totals (a bare formula such as `C2H6O` must match exactly, no extra elements); on a non-empty drawing they are the added amount (final − initial) per stated element. A mismatch after the repair → `REJECTED`, nothing is applied, the numbers are explained. Not covered: bare formula tokens on a non-empty drawing (skipped, since `NH2` is also a group name), and counts the researcher did not state.
4. **Names from the model's knowledge** (`load_smiles`): the response carries `AI-proposed structure for '<name>' — verify against a trusted source before use`; the reply never says looked up or verified (replies containing values, units, DOI/citation/lookup wording are replaced by a neutral server sentence). RDKit only proves the SMILES is parseable.
5. **Reference table check (PARTIAL safeguard, added after the live run):** `ai/draw_known.py` holds a small static table of common molecules (water, methane, ethane, propane, butane, ethene, ethanol, methanol, acetone, acetic acid, benzene, toluene, phenol, aniline, ammonia, carbon dioxide, glucose, caffeine, aspirin, urea, formaldehyde, acetonitrile, DMSO; synonyms such as propanone, CO2, dimethyl sulfoxide). Every entry is verified by a test (SMILES parses, RDKit's formula equals the declared formula). When the message is exactly a plain "draw <name>" request (strict pattern: "add a methyl to phenol" or "draw phenol with a nitro group" are never checked, so no false rejections), the drawn result must contain a connected fragment whose formula (first) and structure (canonical SMILES without stereo, aromaticity perceived; glucose: formula only) match the table. A mismatch is rejected with a plain message ("the drawing does not match the expected formula for acetone: expected C3H6O, got C5H10") and feeds the single repair retry together with the table's reference SMILES; a mismatch after the repair is `REJECTED`, nothing applied. The same check runs after a repair that returns no ops. **This is a partial safeguard limited to the table, not proof of correctness**: the UI says so ("Checked against ChemDFT's small built-in table of common molecules … partial safeguard for listed names only"). A match replaces the model-knowledge proposal label for that name.
5b. **Name caution (all other drawings):** every applied drawing that was not matched against the table carries "RDKit confirms the drawing is chemically valid, not that it is the molecule you named." Reason: in the first final live set the model "drew acetone" as 1,2-dimethylcyclopropane and nothing in RDKit can see that. Molecules outside the table keep the "AI-proposed structure … verify against a trusted source" label when they come from `load_smiles`.
5c. **Clarify options are model text:** each option `message` must restate the researcher's exact stated counts (parsed with the same counts parser); options that change the counts are dropped, fewer than two valid options trigger the repair retry, and a second failure shows no options. A label may still be wrong chemistry (the live model labelled a 1C/2N/6H option "methylamine"); the integrity check on the next request is the safety net, not the label.
5d. **Small talk (added after a first production try, 2026-11-02):** a greeting, "are you working", "what can you do" or "help" (strict pattern, ≤60 characters; "hi, draw ethanol" is a drawing request) is answered by the server with a friendly fixed sentence and examples, status `NO_CHANGE`, **no model call and no cost**. Other non-drawing messages go to the model, whose policy now says to answer in one friendly sentence that it only draws/edits the molecule. A missing route (HTTP 404 from an older server) shows "not available on this server yet" instead of a raw status.
6. **No properties:** energy/spectrum/property/DOI/citation/boiling-point style requests are refused **before** any model call (`REFUSED`, zero cost) and point to calculations/Evidence. The system prompt also forbids values, sources and "verified" claims.
7. **Ambiguity:** the model may return `clarify` {question, 2-4 options {label, message}}; each option's `message` restates the full request (with the counts) so the integrity check applies to the next request. The server cannot detect ambiguity itself; see limits.
8. **Prompt-injection hygiene:** the model receives the fixed policy, a server-built summary of the drawing (element symbols, ids, bond orders, formula), the researcher's text and ≤6 history turns of ≤500 chars. No project names, labels or file content; `tools=()`; no network; output is schema-validated; the op list is the only capability.

## Frontend behaviour

Send → "Working…" → plan arrives → steps are applied one at a time (320 ms apart; with `prefers-reduced-motion` the final molfile is loaded at once) by `setMolecule(step.molfile)`, newest atom briefly selected when Ketcher's struct holds it, Ketcher "Clean Up" at the end. The chat message lists each step with ✓ (applied) / ↶ (undone) / ✗ (failed + reason + suggestion) and the formula after each step; the "Drawing checks" card updates because Ketcher's change event fires for every load.
Canvas banner (top-right, overlay, never resizes the canvas): **AI-drafted · schematic · Keep · Undo last step · Undo all**. The undo trail is the list of the server's step molfiles (independent of Ketcher's history, which `setMolecule` does not feed); a user edit after AI steps is allowed and flagged "edited since" (undo then returns to the AI snapshots, discarding that edit). Keep clears the marker only. If the drawing changed while the request was in flight, nothing is applied. `clarify` options are buttons that send the option message. Unavailable AI: calm notice, input disabled, hand drawing unaffected. Per reply: model, tokens in/out, "1 repair retry". Nothing is saved before Generate 3D → server ETKDGv3 → Accept (unchanged).
Not built: a budget bar (only per-reply tokens are shown; the run uses the normal per-run budget and usage ledger).

## Evidence (real output)

### Backend (stub model)
`tests/test_ai_draw_mode.py`: **40 tests** — every op valid/invalid, 5-valent carbon stops at the last valid step, element whitelist, op-count limit, unknown op, malformed output, count/formula verification, refusal, reply filter, clarify path, goldens (ethanol, 2C+1O then connect, 6H+2N+1C clarify then each option, phenol, water, undo, impossible request), caffeine labelled as a proposal, name caution, repair retry (valence and mismatch), never more than two calls, injection text, invalid molfile 422, unknown conversation / other project 404, history bound, usage recorded. Route-authorization matrix updated (+1 READ route: 153 routes, 130 project, 75 read). Full results below.

### Live acceptance (nemotron-3.5-lightning-30b-a3b, STANDARD, through `HttpOpenAIModelGateway`; **40 of 40 approved calls used**, 31 requests)
Harness `tools/draw_live_acceptance.py` (in-process app + throw-away SQLite, hard cap 40 calls in `output/draw-live-calls.txt`, never prints credentials); raw logs `output/draw-live/*.jsonl` (prompt, model output, ops, server validation, SMILES/formula, latency, tokens; not committed). Not run via `tools/nvidia_probe` (a different, typed-authorization path); the researcher's chat approval covered these calls. **No further live calls are approved.**
Latency 0.9-7.0 s per call (mean ~1.7 s); input ≈2.8-3.4k tokens, output 26-523.

**Round 1 (27 calls, 22 requests).** Development set (10 prompts, prompt adjusted from it): ethanol, "add an OH group on atom 1", "undo that", phenol, para-nitro, boiling-point refusal (no call), impossible 5-valent carbon (declined in words) all OK; "6 H + 2 N + 1 C" → plain-text question, no `clarify`; caffeine improvised from `add_group` (PARTIAL). Prompt change: `load_smiles` for non-trivial named molecules, one clarify example; after it caffeine OK, counts case still rejected. First held-out 8: cyclohexane, toluene, ammonium (after a repair), glycine, NH3 (after a repair), benzoic acid OK; `C2H6O` rejected (no clarify); **"draw acetone" produced 1,2-dimethylcyclopropane (`CC1CC1C`, C5H10), accepted — RDKit cannot see it.** That gap led to the reference table above.

**Round 2 (13 calls, 9 requests; after the table check, two more clarify examples, option filter, closed-formula rule).**
Development set (prompts different from the examples in the system prompt): "6 H + 2 N + 1 C" → **`clarify` used by the real model (1 call)** — the option labels were chemically wrong (it called a 1C/2N/6H option methylamine) and one option changed the counts; the new filter exists because of this (not re-run: no calls left). "add 2 carbons, 1 nitrogen and 1 oxygen" first rejected for "H not asked for" — a server bug (unstated hydrogens were treated as forbidden for counts lists), fixed, re-run → OK. "connect them" on that drawing → the model connected only two pairs (`CN.CO`, two fragments; the fragment warning shows) instead of asking: ambiguous "connect them" was **not** clarified by the real model.
**Held-out (4 prompts, run once, not used for tuning; includes acetone, a clarify-needed formula and 2 table molecules):**

| Prompt | Result | Calls | Notes |
|---|---|---|---|
| draw acetone | ✓ `CC(C)=O` after **table-check rejection + repair** | 2 | first plan: 3 unbonded C + O → "does not match the expected formula for acetone"; the repair (given the reference SMILES) loaded acetone. The earlier wrong answer can no longer be accepted for this name |
| C3H6O | ✓ CLARIFY (acetone / propanal / allyl alcohol) | 1 | the real model used `clarify` this time; option counts were not machine-checked at that time (the filter was added after) |
| draw urea | REJECTED (safe) | 2 | drew unbonded N/O atoms (C2H8N2O4), the repair did not fix it; the table check refused it |
| draw aspirin | REJECTED | 2 | invalid plan twice: `load_smiles` without the required `label` (schema rejection), 523 output tokens on the first answer |

**Honest rates (all 31 requests / 40 calls, reruns included; computed from the logs):** outcomes OK 19, REJECTED 6, NO_CHANGE 2 (model declined in words), CLARIFY 2, REFUSED 1 (before any call), PARTIAL 1. Invalid JSON 0 of 40 calls; schema rejections 2 calls (aspirin twice: `load_smiles` without `label`); wrong molecule that passed every check **1** (acetone, round 1; blocked by the table since); 10 requests needed the repair retry and it fixed 3 (2 count-only cases and the urea/aspirin cases were not fixed). Table-listed molecules in round 2: acetone fixed by the repair, urea and aspirin rejected, none wrongly accepted. The real model used `clarify` in 2 of the 6 requests that called for it: it did not before the prompt change (6H/2N/1C, `C2H6O`) and not for "connect them"; it did after the change (6H/2N/1C, `C3H6O`). n is small; do not read these as reliability figures. A table-listed molecule that the model cannot draw ends in a rejection, not in a guess; the researcher can still draw it by hand.

### Frontend and browser
2026-11-02, real output: `tsc --noEmit` clean; `pnpm run lint` clean (`--max-warnings=0`); full vitest **114 files / 1463 tests PASS** (incl. 4 new in `tests/ai-draw.test.ts`); full backend `pytest` **exit 0, no failures** (skips are the existing ones); editor Playwright config (mock transport, real Ketcher, installed Chrome) **66 PASS** = 12 draw-flow specs (send, steps one by one, Undo last/all, Keep, clarify buttons, proposal label, partial plan, refusal, unavailable, reduced motion, keyboard path, Generate 3D request) + 9 layout specs (1093x520, 1280x600, 1366x768, 1920x1080 each normal and with post-Chrome-109 CSS removed, plus +label growth; canvas >= 300/360 px asserted, no horizontal overflow, controls inside the viewport) + the existing 45; isolated runner (`CHEMDFT_E2E_CHANNEL=chrome CHEMDFT_E2E_GREP="Scenario (E|F|G|I|J):" python3 tools/run_isolated_e2e.py --suite geometry --no-worker`, real API + RDKit): **E, F, G, I PASS and new Scenario J PASS** (AI-drawn ethanol with the draw endpoint mocked by an RDKit-produced response, real Generate 3D and Accept). Screenshots: `output/playwright/molecule-editor/ai-draw-<viewport>-<normal|chrome109>.png`.
Bugs found by these runs and fixed: (1) whitespace stripping in the contract models removed the blank title line of every molfile, so Ketcher loaded an empty drawing (molfile fields now keep whitespace; the client also re-pads); (2) selecting atoms before Ketcher knew them threw an uncatchable wasm error that crashed the page (ids are checked first).
### Impeccable workflow (2026-11-02, second pass; ran for real, **degraded**)
What actually ran, in order: (1) `context.mjs` (loaded PRODUCT.md, mode Operate); (2) `critique` Assessment B: the bundled `detect.mjs` on the component and the CSS module — **1 finding: `side-tab`** (3 px coloured `border-left` on the proposal/warning notes, the craft-floor ban); (3) Assessment A, my own design review of Playwright captures at 1093x520, 1280x600, 1366x768 and 1920x1080 (chat with steps, clarify buttons, partial plan, error, unavailable; `output/playwright/molecule-editor/impeccable/before-*.png`); (4) `audit`/`typeset`/`layout` fixes; (5) the craft-floor checks; (6) a second capture round (`after-*.png`) and re-run of the detector (**0 findings**) and of the draw/layout specs (**29 PASS**). **Degraded:** the critique protocol asks for Assessments A and B in two isolated sub-agents; this session does not spawn sub-agents unprompted, so both ran inline in one context (banner: ⚠️ DEGRADED: single-context). No snapshot was persisted, the browser overlay (`live-server` + `detect.js` injection) was not run, no axe scan, no real Chrome 109, no screen reader, no touch device.
Findings and what changed: the AI-drafted banner overlapped the Selection card at 1366x768 → moved to the bottom-left of the canvas (clear of the card and the hint strip; still an overlay, canvas size unchanged); the "typed commands · RDKit-checked" tab note was clipped ("RDKit-…") → "RDKit-checked"; ✓ ✗ ↶ Unicode glyphs standing in for icons → Blueprint icons (`tick`, `cross`, `undo`, `dot`); the 3 px `border-left` notes → a 1 px bordered note with an info icon; the failure reason was printed twice (reply and red step text) → shown once, the step is just marked; `--cdf-ink-faint` (#718096, ≈4.0:1 on white) used for 11 px usage/footnote text and undone steps → `--cdf-ink-muted` (≈6:1); shorter footnote. Checked without change: no horizontal overflow at the four viewports, canvas minimums, tokens only, no `color-mix`, keyboard path and visible focus rings, `role=log` live region, labelled controls.

## Quality fixes (2026-11-02, after live testing on production)

Production evidence: "draw 6 water molecules" gave 6 O + 12 H, 14 fragments, overlapping atoms, formula "Not available" **and** the reply "Drew 6 water molecules" with Done; Ketcher then zoomed out to specks; "draw 1-B-3-MIHS" was guessed as BH3; "make it two" failed with a valence error; "clear the drawing" took 21 delete steps.

| Fix | Where | What |
|---|---|---|
| Never "Done" on a bad result | `draw_service._execute_draw_run`, `draw.integrity_problems` | After every plan the server checks: expected fragment count, overlapping atoms, formula available, empty result. Expected fragments: N for "N <table molecule>" (`requested_copies`, also verifies N x formula and structure per fragment), N for "N … molecules" with any name (`requested_molecule_count`, empty drawing only), 1 for a plain "draw <table name>", a bare formula, or a single-molecule request on an empty/cleared drawing (`single_molecule_requested`: no digit, list, "and", "molecules"…). A finding feeds the **single** repair retry (the problem text names add_copies/clear_all); if it persists the response is status **`NEEDS_ATTENTION`** (new value of `DrawResponse.status`) with a server-written reply "Needs attention, not done: …", the steps are still returned so the researcher can inspect/Undo all. The model's own sentence is never shown in that case. |
| Typed ops | `draw.py` | `add_copies`, `clear_all` (see op table). "clear the drawing / start over / erase everything" is also answered by the server with no model call (one `clear_all` step; "already empty" → NO_CHANGE). More than 12 copies is declined before any call. |
| Compact layout | `DrawState._layout`, `pack_fragments` | Every molfile is laid out per fragment (RDKit depiction, bond length 1.5, existing sane coordinates kept, crowded ring systems retried with CoordGen), fragments packed on a grid (cell = largest box + 2.25 margin, `row` layout optional), whole drawing centred on the origin. Wild input coordinates (thousands of units apart) are re-laid out. A drawing spanning more than `1.5 x (4 x atoms + 20)` is refused (`max_justified_extent`; cannot happen after packing, kept as a guard). |
| Unknown names | `draw.unmappable_subject`, prompt | Narrow server rule: a one-token "draw <code>" with a digit, no long lowercase word, that is no table name, formula or SMILES (`1-B-3-MIHS`) is declined with no model call and no drawing ("I don't recognise … describe the atoms"). Everything else (e.g. "florbazine") relies on the prompt rule: clarify or decline, never a similar molecule. |
| Ambiguous follow-ups | `draw.ambiguous_follow_up`, prompt | A bare "make it two/three…", "again", "bigger", "more", "another one", "double/triple/twice" with exactly one molecule on the canvas is answered by the server with option buttons (CLARIFY, no model call); the first option's message is a normal request. The prompt gained three clarify examples for the other cases. |
| Table | `draw_known.py` | +8 molecules (pentane, hexane, cyclopentane, cyclohexane, pyridine, naphthalene, benzoic acid, glycine; 31 in total) after a live run drew butane for "hexane"; the prompt lists the names `add_copies` accepts directly. Still a partial safeguard for listed names. |
| Frontend zoom | `lib/molecule-editor/fit-view.ts`, `use-ai-draw.ts`, `AiDraftBanner` | After every applied/undone step the view is fitted with zoom clamped to 0.5-1.0 (Ketcher's own fit goes down to 0.1: the specks). If the whole drawing cannot be shown at >= 0.5 the main fragment is fitted and the banner says "Showing the main fragment" with a **Fit all** button; a **Fit** button is always visible (banner when drafted, small bottom-left group otherwise). Ketcher's final Clean Up is no longer run: the server layout is authoritative (Clean Up re-laid out disconnected fragments). `NEEDS_ATTENTION` steps are applied like OK ones; the bubble says "Needs attention". |

Changed API surface: `POST …/ai/conversations/{cid}/draw` request unchanged; response `status` gains `NEEDS_ATTENTION`; new step ops `add_copies` and `clear_all` (op dictionaries in `steps[].op`); `final.molfile` of a clear step is a zero-atom molfile. Generated `@chemdft/schemas` updated. No new route, provider or model.

### Evidence (real output)
Offline: `tests/test_ai_draw_quality.py` + `test_ai_draw_mode.py` stub tests (6 waters bad plan -> repair -> grid; fragmented result -> NEEDS_ATTENTION with server text; 3 ethanol; 12 copies; tiny atom, coronene, 40-carbon chain, wild coordinates; clear without a model call; nonsense name; "make it two" family; acetone still correct; pyridine count; hexane-as-butane; empty result; single-molecule rule). Playwright (real Ketcher, mock transport) `molecule-editor-ai-draw-fit.spec.ts`: 6 waters and 3 ethanol at 1093x520, 1366x768, 1920x1080 with every atom inside the canvas rectangle (6 px pad), zoom >= 0.5, atom spacing > 40 px, minimum rendered bond length >= 18 px, 12 copies, main-fragment fit + Fit all, Fit after the user zoomed away, clear/undo, needs-attention bubble.

### Live acceptance of the quality fixes (25 of 25 approved calls; nemotron-3.5-lightning-30b-a3b through the app gateway; logs `output/draw-live-quality/*.jsonl`, not committed)
24 requests, 25 model calls (6 requests answered by the server without a call). Latency 0.8-7.6 s per call (mean 1.6 s); input 4.2-4.7k tokens (the policy grew), output <= 69. **The prompts were not all held out in the strict sense: after the first held-out set I fixed what it showed and ran fresh prompts (sets 2 and 3); the fixes made after set 3 were NOT re-run live (budget exhausted), only with stub tests.**

| Set | Prompt | Result |
|---|---|---|
| dev | draw 6 water molecules | OK, `add_copies` first try, 6 fragments |
| dev | make it two (1 water) | **model silently made 3 waters** -> server guard added |
| dev | draw 1-B-3-MIHS / clear the drawing | declined / cleared by the server, 0 calls |
| dev | draw acetone | OK after one repair |
| 1 | 5 methanol; 4 CO2; draw ethanol | OK |
| 1 | two molecules of acetic acid | OK after one repair (verified 2 fragments) |
| 1 | 3 pyridine molecules | **OK but 4 pyridines** (no check for names outside the table) -> generic molecule-count check |
| 1 | again; make it three | CLARIFY (server guard) |
| 1 | double it (1 ammonia) | **model silently copied** -> guard extended |
| 1 | draw florbazine | model declined, asked which molecule (OK) |
| 1 | 7-X-9-QWERT | declined by the server (0 calls) |
| 1 | start over and draw methane | **only cleared**, reply truthful ("Cleared") but the request was half done -> prompt note |
| 2 | 6 molecules of glycine; 2 toluene | OK (glycine after a repair, 6 verified) |
| 2 | 3 cyclohexane molecules | REJECTED (honest): model used an unknown `add_copies` source twice -> table + names note |
| 2 | clear it and draw propane | **OK with 3 unbonded carbons** (C.C.C) -> single-molecule fragment rule |
| 2 | twice | CLARIFY (guard) |
| 3 | clear it and draw pentane | PARTIAL: only clear, repair repeated clear_all; empty result now flagged |
| 3 | 3 hexane molecules | **OK but 3 butane** (wrong molecule, hexane not in table then) -> table +8 |
| 3 | 4 cyclopentane molecules | ERROR: provider returned an invalid response (1 call, transient) |

Honest rate: of 24 requests, 6 gave a result that passed the server's checks of that time although it was wrong or incomplete (make it two, pyridine x4, double it, methane half done, propane C.C.C, hexane as butane); every one of them was turned into a rule + test, none re-verified live. The model chose `add_copies` correctly for table names (6/6 first tries) and clarified/declined correctly for "florbazine"; it needed the server for ambiguous follow-ups and for counting outside the table. n is small; these are not reliability figures.

### Not verified
Hosted backend (not deployed), real Chrome 109, axe, screen reader, other languages, the post-set-3 fixes against the live model, dark theme.

## Quality fixes, second pass (2026-11-02, after live testing of the first pass on production)

Production findings: with one water drawn, "make it two" offered "A 2-carbon version"; choosing it drew two unbonded CH4 and the reply said "Drew a 2-carbon chain" with Done (2 fragments).

| Rule | Where | What |
|---|---|---|
| Options must apply to the drawing | `draw.option_inapplicable`, `ambiguous_follow_up(..., mol)`, service clarify filter | An option that needs carbon / a chain / an "N-<element> version" is dropped when the drawing has no such element. Model-made and server-made options alike. When only one option is left there is no question: the server runs it as the request (water + "make it two" -> "add 1 more copy ... so the drawing has 2 molecules in total"). |
| Claims are verified | `draw.claims_connected`, service `effective_expected` | "chain", "connected", "bonded", "one molecule" in the request or in the model's own sentence means the result may not have more fragments than the drawing had (1 for an empty drawing); a violation feeds the single repair and ends in `NEEDS_ATTENTION` with the server's text. Plural wording ("2 propane chains", "6 molecules") is not a claim of one piece. |
| Totals are verified | `draw.requested_total_molecules` | "... has N molecules in total" (the wording of the "N molecules" option) must end with exactly N fragments (the live model drew 3 for 2). |
| A reply naming a table molecule must be true | `draw_known.claimed_molecule` | "Replaced with ethane." / "Drew acetic acid." must be matched by a fragment of the drawing (formula and structure); the live model said ethane for dimethyl ether. Only sentences that start with drew/replaced with/created/built/loaded/made. |
| Model text never overrides findings | all of the above | on any server finding the reply is the server's "Needs attention, not done: ..." text; the model's sentence is shown only when every check passed. |
| N molecules is information | `DrawResponse.info` (new, additive, default empty) | When the number of fragments equals what was asked ("6 molecules"), it is an info line, not the warning "has N separate fragments". The frontend shows `info` lines with an info icon. |
| Combined formula | `lib/molecule-editor/drawing-checks.ts` | Indigo reports a multi-fragment drawing as "H2 O; H2 O; ..." and the old parser gave "Not available". The Drawing checks card now shows the Hill formula of the whole drawing (H12O6), a "Molecules" row ("6 × H2O" or "2 × C2H6O + 1 × H2O") and the total heavy atoms (6). |
| Lone-atom molecules drawn with their hydrogens | `DrawState._insert_mol` | Water, methane, ammonia ... from `load_smiles` / `add_copies` get their hydrogens as real atoms (O + 2 H, bonded), because Ketcher draws a bare O with implicit H as the text label "H2O". The molfile contract is unchanged (it only has more atoms: 6 waters = 18 atoms). Atoms built one by one and attached groups are NOT expanded (they must stay open for bonds). Not done for single-fragment drawings made of heavy atoms only (ethanol etc. are unaffected). |

Changed API surface: `DrawResponse.info: string[]` (additive). No new route, op or status. Fixtures `apps/web/tests/e2e/fixtures/ai-draw/*.json` were regenerated (compact layout, explicit H).

### Live acceptance, second pass (15 of 15 approved calls; logs `output/draw-live-quality-b/*.jsonl`)
First run (12 calls, 16 steps; the canvas carried over between steps, which distorted some follow-ups): 4 ethanol, 3 ammonia (drawn as N with 3 H), 2 benzoic acid, "draw the stuff from the other day" (rejected after one repair: no guess), toluene + "bigger" -> options -> methyl added: correct. **Two wrong results passed the checks of that time:** water + "make it two" drew 3 waters; "Replace the drawing with a version ... 2 carbon atoms" said "Replaced with ethane" for dimethyl ether. Both became rules (rows 3 and 4 above) and stub tests. Re-check (3 calls): water + "make it two" -> 2 waters after one server-triggered repair; water + "Replace the drawing with a two-carbon alkane" -> ethane `CC`. n is tiny; "make it three" on ethanol-derived drawings and its "3-carbon version" ended PARTIAL (the model deleted atoms by wrong numbers; honest message, no false success).

## Third pass (2026-11-02): from two live conversations to general rules (no live calls left, stub tests only)

Live: "can you create a hydrogen molecules?" drew two lone H atoms (H4, 2 fragments) and said Done; "why two seperate?" ended in "I could not turn that into a valid drawing plan".
Fixed as classes of request, not as those sentences:
- **Polite and natural phrasing** ("can you / could you please / I want a / I'd like an" + draw/make/create/generate/...) is recognised as a creation request; "a hydrogen molecules" (article + typo plural) still means one molecule. A single-molecule request on an empty drawing must end as ONE fragment (repair, then `NEEDS_ATTENTION`).
- **Diatomic elements are table molecules**: hydrogen (H2), oxygen (O2), nitrogen (N2), fluorine (F2), chlorine (Cl2), matched only with "molecule"/"gas" or the formula name (`o2`, `dioxygen`), because a bare "oxygen" means the atom in "add 2 carbons and 1 oxygen". "3 hydrogen atoms" is never 3 molecules. The prompt now says a molecule is one connected structure and never to build one from unbonded atoms.
- **Questions about the drawing are answered, not planned**: "why separate / how many atoms / what is the formula / what did you draw" are answered by the server from RDKit facts (counts, formula, SMILES, "does not say what it is called"), no model call. Any other question that the model answers in plain words is shown as that answer (through the usual reply filter) instead of being rejected as an invalid plan; a non-question in prose is still rejected. The prompt tells the model to answer questions with `ops: []` and a factual sentence.

Not verified live (the 15 + 25 + 40 approved calls are spent): the model's behaviour on these prompts; only stub tests cover them.

## Honest limits / failure modes

- The server proves chemical validity, not identity: a valid but wrong structure for a name is possible (seen once in 8). The UI says so on every applied drawing.
- The real model did not use `clarify` in any of the 3 situations that called for it; ambiguous count/formula requests currently end in a rejection with an explanation, never a silent guess.
- Sanitization after every step means some orders of ops are impossible (hydrogens before charge); the repair usually fixes it, `load_smiles` avoids it.
- Counts and formulas are checked only when stated; a bare formula is not checked on a non-empty drawing. Fragment expectations exist only for the cases listed under "Quality fixes": an unlisted name drawn as a wrong but valid molecule still passes (labelled AI-proposed).
- Hydrogens: isolated atoms receive implicit hydrogens in the total, so "6 H" must be a connected structure.
- Stereo wedge/hash is accepted but rendering is whatever RDKit/Ketcher make of the molfile flags (not verified).
- Highlighting the newest atom is best-effort (Ketcher's wasm layer throws on unknown ids, so ids are checked first); a user edit between steps is possible; Ketcher's own undo does not span AI steps.
- Other languages untested; only the one model/provider above was exercised; the hosted backend was **not** run.

## Parked (Phase 3b and later)
Reactions and reaction energies; atom selection for calculation setup (constraints/scans/fragments); engine results on the 2D drawing; substructure search; name lookup (PubChem etc.) — all **parked, not started**.
