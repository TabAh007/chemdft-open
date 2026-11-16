# Guided Workspace redesign (Structure → Configure → Review & Submit)

Status: implemented in worktree `design/workspace-guided-v1` (from `1c1bc3e`, the local Overview commit). **Uncommitted, not
pushed, not deployed.** No backend, schema, engine, Result Firewall, AWS, auth or AI change. Advanced Workbench and the AI
Scientist are untouched. Results, Compare, Jobs and the other project pages are not redesigned.

## What the Guided workspace is now

`GuidedWorkspace` (`apps/web/src/app/_components/guided/guided-workspace.tsx`) replaces the old Structures page, the
calculation-setup page and the six-step journey bar. One persistent molecular view (`guided-viewer.tsx`, the product's
`StructureViewport` with atom selection, distance/angle measurement, representation and reset-view) stays mounted while a
contextual inspector moves through three stages:

1. **Structure** — committed structure facts, *Scientific review* state (an import is **Not reviewed**, never "success"),
   the server's geometry-eligibility verdict, and the electronic-state inputs (charge, multiplicity). The stage is done only
   when the server says the geometry is eligible **and** the researcher has explicitly confirmed those inputs. Importer
   diagnostics that mention charge/multiplicity/spin are shown beside the inputs (an imported H₂ XYZ can carry placeholders).
2. **Configure** — calculation family, engine (with the exact availability state and reason), method, basis, and
   Advanced settings (SCF convergence, excited states, optimizer cycles). Charge/multiplicity are shown, not hidden.
3. **Review & Submit** — the exact configuration, five checks (geometry, electronic state, engine availability, settings,
   role), scientific scope notes, expected outputs, the explicit confirmation, one **Submit calculation** action. After
   submission the same place shows the job status; **Jobs** owns monitoring, **Results** owns outputs. Execution, results
   and export are not wizard steps.

Each state has one primary action (`lib/guided-stages.ts`): confirm inputs → continue → continue → submit → *View in Jobs*
(active job) / *Open result* (succeeded) / *Edit configuration* (failed or canceled). Stage navigation never discards the
draft. The sidebar lost its duplicate Jobs/Compare/Settings/Help section (the top bar owns them); the Project Navigator is a
collapsed "Browse all workflows, blockers and project assets" disclosure on Guided home (mounted only when opened).

## Where every fact comes from (no duplicate domain logic)

| Shown | Source (existing) |
|---|---|
| Geometry eligibility | `GET …/versions/{id}/calculation-eligibility` (`useGeometryEligibility`) |
| Engine availability, supported tasks/methods/bases/optimizers, Psi4 pairs | `GET …/calculations/capabilities` (`useCalculationCapabilities`); Psi4 pair/structure rules from `lib/psi4-calculation.ts`; basis element limits from `lib/basis-element-limits.ts` |
| Submission payload | `buildGuidedSubmission` (unchanged logic) → `POST …/calculations` (server validates, authorizes, de-duplicates by `idempotency_key`) |
| Job state | `GET …/calculations/{id}` (calculation record + compute job + execution) → `lib/guided-job-status.ts` |
| Cancellation | `POST …/calculations/{id}/cancel` (server requires WRITE) |
| Role | `GET …/projects/{id}` `role`; owner/editor mirror the server's `ProjectCapability.WRITE`. The server stays the authority |

New pure models, all unit-tested: `guided-stages.ts` (stage + primary action), `guided-job-status.ts` (job presenter),
`guided-capability-state.ts` (engine availability classes), `guided-draft.ts` (draft persistence), `guided-engine-info.ts`
(engine/method descriptions).

## Engine availability classes

`classifyEngineChoice` distinguishes, from the capability contract only: **selectable**, **missing inputs**,
**worker unavailable** (not reported, or `availability != AVAILABLE`, with the worker's diagnostic), **unsupported
method/task/structure** (task not in `supported_tasks`, or a structure restriction such as Psi4's neutral closed-shell H/C/O
scope), **unknown** (service error / still reading), **expired** (the client's 60 s cache TTL), **no permission**.
Until the researcher picks an engine the first *selectable* one is used, so an unavailable xTB is never preselected.
Capability state is read again automatically (on expiry, every 45 s while deciding, and again immediately before
submission); it is never consulted for an already-accepted job.

Descriptions: PySCF — Gaussian-basis HF/DFT SCF; xTB — GFN2-xTB semi-empirical, built-in parameters, **energies not
comparable with ab initio energies**; Psi4 — HF/DFT/MP2 single points, restricted here to neutral closed-shell singlets of
H, C, O. TDDFT requires multiplicity 1 (this is now enforced; before, the field was only disabled).

## Calculation status: why "READY", "RUNNING", "in progress" and "expired" disagreed

Established from the code (no live system was observed):

* **Two state machines exist.** The calculation lifecycle is `DRAFT, VALIDATED, AUTHORIZED, QUEUED, RUNNING, SUCCEEDED,
  FAILED, CANCELED`; the compute job is `PENDING, READY, LEASED, RUNNING, CANCEL_REQUESTED, SUCCEEDED, FAILED, CANCELED`.
  **READY is a job state: queued and eligible for a worker to claim.** It does not mean running or finished.
* **The server moves both together.** `calculation_actions.py` claims a job with
  `UPDATE … SET state=RUNNING WHERE state IN (READY, PENDING)`, sets the job `RUNNING` and, in the same transaction, moves the
  calculation to `RUNNING` (~lines 669–745). A lease-sweep can return an expired job to `READY` (~3517). So a persisted
  "calculation RUNNING + job READY" pair is not produced by the claim itself.
* **The screen read different copies at different times.** The Explorer's "READY" came from the project catalogue
  (`workspace-inventory.ts`, `detail: ${job.state}`), which was refreshed (`chemdft:workspace-items-changed`) **only at
  submission and at the terminal state**. The setup form wrote `calculation.state · compute_job.state` from its own 1.5 s
  loop. Between submission and completion the Explorer therefore kept the state recorded at submission ("READY") while the
  form showed the later one ("RUNNING"). **This mechanism is established from the code.**
* **"Calculation in progress…" was a local flag**, true while the in-page `while` loop ran; it said nothing about a worker.
  The loop's state (busy, run id, status text) lived in the component, had no abort, and was lost on refresh.
* **"Expired"** is the client-side capability cache TTL (60 s), not a worker or job fact.
* **Not established:** whether a real worker was in fact running during the reported H₂ screenshots, or whether the live API
  returned a transiently inconsistent pair (e.g. after a lease-sweep). Only the live records could say. The new presenter
  flags such a pair as "Records disagree" instead of choosing silently.

Fix: one presenter (`presentGuidedJob`) over the persisted records, one hook (`useGuidedJob`) that is the only reader, and a
notification to the Explorer/Overview on every real state change (not only at submit/terminal).

## Job status presentation

States: Submitted, Awaiting authorization, Authorized (not queued), Queued, Starting, Running, Cancelling, Finalizing
(job done, calculation not yet finalized), Succeeded, Failed, Canceled, Execution lost. Shown: both record states, job id,
calculation id, last recorded update (newest persisted timestamp, not the browser clock), "waiting since" for queued jobs,
elapsed runtime only when an execution start is recorded, worker status when reported, the submitted method/engine/charge/
multiplicity and input hash, the recorded failure text verbatim, **View in Jobs** / **Open result**.
**Never shown** because the API reports none: progress %, queue position, ETA (the panel says so).

`useGuidedJob`: restores after a reload (remembered submission per project+version in `sessionStorage`, else the newest
active job in the project); polls every 3 s while active, backs off to 30 s on failures, pauses while the tab is hidden,
refetches on focus/online, ignores out-of-order responses, stops when terminal; on failure keeps the last confirmed record,
marks it stale and offers *Retry now*. **Cancel job** appears only for an active, non-cancelling job and a writer, asks for
confirmation, says drafts are unaffected, and is separate from editing the draft.

## Duplicate submission

Client lock + disabled control; the payload (with its `idempotency_key`) is kept in `sessionStorage` keyed by the
configuration signature, so a retry after a failure or reload re-sends the same key and the server de-duplicates it. Once a
job exists the submit control is replaced by the job panel (a new submission needs *Edit configuration* after the job ended).
The redundant acknowledgement was **kept** as an explicit confirmation checkbox (it is the researcher's deliberate act and
existing e2e contracts rely on it); it now states that the exact configuration was reviewed.

## Verification

Unit/jsdom: 947 tests pass (was 906 at the Overview commit; 41 added for stages, presenter, capability classes, draft
persistence, the job hook and the submit flow; the old six-step journey tests were replaced). ESLint and `tsc` clean.
Production build OK. Browser QA on the production server against a local mock API (no real computation, no AI call, no
beta-project submission): see the report. Impeccable detector: 0 findings on the new files.

## Not done / limits

* The Overview `StructureViewer` has no atom selection or measurement, so the Guided viewer keeps the product's
  `StructureViewport` (selection, measurement, representations) in the Overview's framing, tokens and restraint.
* The conformer-search task keeps its existing panel (selecting it in the family list leaves the new workspace).
* A finished job is not auto-opened as a result; the primary action is *Open result*.
* ~~Live e2e specs reference the removed controls.~~ Migrated; see *E2E migration* below. The calculation-executing specs
  were updated but **not run** (no live scientific calculation was authorized).
* The scientific-context HTTP 404 in the AI dock is unrelated and unchanged (see `OVERVIEW_REDESIGN.md`).
* No live job was submitted to the beta project; every job state was a controlled fixture.

## Acknowledgement is bound to the reviewed configuration

Found while migrating the e2e specs: the explicit confirmation ("I have reviewed this exact configuration…") was plain
component state, so it survived going back to Configure and changing the method, basis or engine. The old setup form
withdrew it on any change and the live Psi4 spec asserts exactly that. The acknowledgement is now stored together with the
signature of the configuration it covered (project, structure version, engine, method, basis, settings, electronic state) and
only counts while that signature is current; the stored submission payload and its idempotency key are keyed by the same
signature. Unit test: "withdraws the acknowledgement when the reviewed configuration changes".

## E2E migration (real API and database)

Run against `tools/rw2_evidence_stack.py` started from this worktree (disposable copy of the accepted evidence database, real
API, **no compute worker**, fake AI provider, no AI request made) and, for the geometry spec, the official isolated runner
(`tools/run_isolated_e2e.py --suite geometry --no-worker`). Baseline: the same specs on a stack started from the clean
`1c1bc3e`; five of them already failed there (they target the removed empty-project screen, the "what ChemDFT found" panel and
the old per-result buttons, which earlier commits had replaced), so they are brought current here as well.

Shared helpers: `tests/e2e/guided-helpers.ts` (`openGuidedStructure`, `openGuidedConfigure`, `reachGuidedReview`,
`reviewAndAcknowledge`, `openResultFromJob`, `openGuidedElectronicResult`, `expectAiScientistDock`, and reference values
computed from the *stored* coordinates). No helper submits a calculation or an AI request. Measurements are compared with the
distance and angle computed from the stored atoms instead of remembered numbers.

What changed in the contract the specs rely on: Structure → Configure → Review & Submit replaces the setup page; charge and
multiplicity are confirmed on the Structure stage (`#gw-charge`, `guided-primary-confirm-inputs`); the acknowledgement and
`run-calculation-btn` are on Review; the job panel (`guided-job-state`, `guided-job-failure`, `guided-cancel-job`) replaces
`guided-calculation-status`; a finished job offers **Open result** (`guided-primary-open-result`) instead of opening it;
Jobs/Compare/Settings are project sections (`project-section-*`), not Guided sidebar items; the sidebar's last item is Files &
Data; the Project Navigator is a collapsed disclosure on Guided home; AI Scientist is the shell's docked panel.

| Spec | Result |
|---|---|
| `guided-visual-acceptance` (rewritten) | 1 pass (welcome entry creates nothing, Guided home, structure facts, stored energy/eV/HOMO/LUMO, MO/density/ESP, Review with Submit disabled, Advanced and back, 1024 px, axe: 0 violations) |
| `guided-workflow-acceptance` (rewritten) | 1 pass; the AI-question test is skipped unless `CHEMDFT_E2E_AI_QUESTIONS=1` |
| `unified-visualization-acceptance` | 2 pass |
| `final-visualization-polish` | 1 pass (AI answers recorded only with `CHEMDFT_E2E_AI_QUESTIONS=1`) |
| `pre-merge-fixes` | 1 pass |
| `pf8b13-corrections` | 10 pass (all non-engine tests); the 5 engine tests (4 real-energy runs and the B3LYP submission) updated, **not run** |
| `pf8b13-calculation-lifecycle` | 4 pass (simulated RUNNING→FAILED / CANCELED over a consistent compute job, real validation refusal, real queued cancellation); 3 engine tests updated, **not run** |
| `pf8d-psi4-acceptance` | 10 pass (synthetic / mocked capability and transport); 2 live-Psi4 tests updated, **not run** |
| `rw1-researcher-journey` | 2 pass (authorization boundaries; PySCF basis limits from the backend); engine journey updated, selectors dry-checked to the aborted request, **not run** |
| `pf8b2-native-optimization` | 1 pass (capability withholding); engine tests updated, **not run** |
| `pf8c-conformer-workstation` | 1 pass (CREST unavailable disables submission); real CREST tests unchanged, **not run** |
| `rw32-researcher-ux` | 12 pass |
| `e2e-navigator/navigator.spec.ts` | 11 pass after integration: the two Overview scroll tests now find the unavailable reasons by `[data-reason-code]` and open "Browse all workflows" before the keyboard phase, as a researcher must |
| `ketcher-2d-3d-acceptance` | 2 pass via the isolated runner (Scenario G: raw 2D is blocked in Guided, Advanced and the API) |
| `pf8b13-result-association`, `rw2-analysis-journey`, `pf8c-context-correction` | updated, **not run** (they seed real calculations in `beforeAll`) |

Infrastructure fixes: the isolated runner now passes `CHEMDFT_REPO_ROOT` and `isolated-fixtures.ts` uses it (the web copy under
the workspace had no `.venv`/`tools`, so the legacy-2D fixture could not start); the ketcher spec creates its project through
the API (the old "New Project" form is gone).

Not fixed here (not Guided or Results): `e2e-ai-foundation` still names the removed `.dock-ai-content` and needs the auth configuration; `e2e-examples`/`e2e-onboarding`
were not touched. `guided/empty-chemdft-experience.tsx` has no importer at `1c1bc3e` (dead code) and its screens are no longer
reachable.

