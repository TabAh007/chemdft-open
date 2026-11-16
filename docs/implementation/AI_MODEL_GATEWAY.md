# AI Model Gateway (Phase 8)

## AI-2 — model switching and performance tracking (2026-10-17)

**AI-2 OFFLINE VERIFIED — hosted behaviour NOT RUN.** Built on the three local commits AI-1
`98593b196e24`, UI-1 `4cd4fe5530dc` and offline E2E `d819728`. AI-2 is a single local commit on
top of them (28 paths; not pushed or deployed; hosted testing pending separate approval).
No NVIDIA/Hugging Face/Moonshot request, no scientific calculation, no AWS action, no credential
change and no migration occurred. Offline fixture timings and counts are synthetic and are not
evidence about any real model.

### What the registry actually says (code-derived, no external check)

| Model (provider) | Registry state | Notes |
| --- | --- | --- |
| Nemotron 3.5 Lightning 30B A3B (NVIDIA) | REGISTERED; SELECTABLE only when the server is configured on the NVIDIA endpoint with it as fast/standard/reasoning | Tool selection/structure read verified 2026-10-16 (historical, limited scope); proposal acceptance failed, V2 timed out; no SLA |
| Nemotron 3 Super 120B A12B (NVIDIA) | REGISTERED, UNVERIFIED | Account access, adapter parameters and H2 orchestration unverified; never selectable even if configured |
| DeepSeek V4.1 Flash (NVIDIA) | REGISTERED, UNVERIFIED | Tool/streaming compatibility unknown; image input not implemented |
| DeepSeek V4 Flash, Kimi K3, K2 Thinking, K2 Instruct (NVIDIA) | UNAVAILABLE | Deprecated endpoints |
| Kimi K2.6 (NVIDIA) | UNVERIFIED | Catalogue availability unresolved |
| Kimi K3 (direct Moonshot) | UNSUPPORTED | No ChemDFT adapter; unconfigured |

CONFIGURED depends on deployment settings (not inspected here). HOSTED VERIFIED applies only
to the Lightning tool read above. No model is labelled free or priced; rate limits, entitlement
and cost are UNKNOWN. The existing backend already supported switching: `PUT /v1/ai/settings`
validates provider/model against server options and persists one row per user.

### Quick model switcher (right-docked AI Scientist, Chat tab)

The model name in the status bar is now a button opening a compact popover: eligible models
first, an explicit disclosure for models the server will refuse (each with its server-authored
reason), and a details area for the focused model that keeps *registry*, *configured on this
server*, *eligible* and *hosted verification* as separate lines, plus the request types it may
serve and observed counts from the user's own runs. It reuses `getAiSettings`/`saveAiSettings`
and the Settings tab's `modelChoices`; there is no second selection system. After a save the
panel's settings revision refreshes both the status bar and the product context, and the
Settings tab re-reads the server on mount, so both always agree. Keyboard: Enter/Space opens,
arrows move, Enter selects, Escape closes and returns focus. Mobile (≤760 px) uses 44 px
targets and layers above the dock sheet. During a run or pending approval the popover states
that the run keeps its bound model and the new selection applies to the next request.

### Backend routing, binding and restrictions

- **Run binding.** A run's model is the provider/model/mode in its immutable context snapshot
  (`AIContextSnapshotRecord.summary.ai`). `AIProviderService.pin()` fixes a service to that
  selection at run creation, and `_generate` re-pins for every later call (resume, continuation).
  Earlier code re-read the current preference on every model call, so a switch mid-run changed
  the model between steps; the mutation check shows the new test fails without the binding.
  Legacy rows without a readable snapshot use the current preference as before.
- **No fallback.** A pinned model that is no longer eligible fails closed with the existing
  `MODEL_UNAVAILABLE`-family code and a message that no fallback was used; a provider error or
  timeout makes one request on one model and is never retried elsewhere.
- **Request-class gate.** `profile_gate` (called in `post_message` before any snapshot,
  reservation or dispatch) refuses with `MODEL_PROFILE_INELIGIBLE` (422) when registry evidence
  cannot serve the request: Ask needs `Text`; both planning profiles need documented tool calling
  plus ChemDFT tool-adapter verification. Server-authored `planning_profiles` and
  `unselectable_reason` on each registry row drive the UI. With the current registry every
  selectable row serves all three request types (the gate is exercised with a synthetic text-only
  catalogue); providers with no registry rows (generic BYOK endpoints) keep their prior
  server-approved-model behaviour and the selector does not offer them, as before.
- **Fixture.** The local test provider now offers `fake-standard` and `fake-alternate`; the fake
  gateway echoes the requested model so receipts record it. This exists only under dev identity
  with the fake provider.
- **Provenance.** Historical runs and receipts keep their model; a pending approval's immutable
  parameters and run model are unchanged by a later switch (browser-verified).

### Performance tracking (derived, no new storage)

`GET /v1/ai/model-performance` aggregates the caller's own last 500 runs from existing
`ai_runs`, `ai_model_invocations` and `ai_run_steps` rows. No table or migration was added and
no prompt, response, structure or document is read. Definitions (also returned by the API):

- **Request latency:** one model HTTP request, dispatch to fully parsed response, success only;
  not time-to-first-token (non-streaming), tool time, approval waits or calculation time.
  Median and max; p95 only with at least 20 observations; nearest-rank.
- **Outcomes:** dispatched = succeeded + failed; failures classified from the recorded transport
  kind (any timeout kind = timeout; other recorded transport failures = provider error; no
  record = unclassified). NOT_DISPATCHED and in-flight receipts are excluded from rates.
- **Tokens:** provider-reported counts only; UNKNOWN (null), never zero, when unreported.
- **Tool-call conformance:** model-emitted calls passing schema/scope/authorization over all
  model-emitted calls (rejections carry `TOOL_REJECTED`/`TOOL_NOT_IN_PROFILE`).
- **Proposal validity:** `calculation.submit` proposals reaching human approval over those
  reaching validation. Not scientific correctness and not human acceptance.
- **Run outcomes** by final status; run wall time is deliberately not reported.
Runs that used several models before binding existed are counted as unattributed. Attribution
is by the receipts' own provider/model. Cost is never estimated; nothing is ranked.

### Privacy

Responses contain aggregate counters and fixed definitions only, scoped to the caller inside
their organization. Tests assert no prompt text, project id or structure name appears, no
cross-user data, no score/cost/rank field and no metric table in the schema.

### Verification evidence (offline)

Backend, in the offline runner's clean environment under the loopback-only sandbox:
544 selected tests (28 files incl. 15 new) PASS, 0 failures, 3 skipped (the 2 live-provider
tests and 1 other). A first run outside the sandbox loaded the repository `.env`, took 2
live-provider tests past their skip gate and failed them locally on a pre-dispatch output-budget
check (`max_tokens` 64 below the Nemotron minimum) before any network I/O; the same file in the
clean sandbox PASSes with those 2 skipped. Schemas regenerated and fresh. Frontend: 117 focused
tests PASS (UI-1 45 adjusted mocks, 3 new), TypeScript PASS, targeted ESLint zero warnings,
Ruff PASS for touched files, Impeccable detector `[]` for the new component and no findings in
the new CSS block. Browser (real Next.js + FastAPI, fake provider, worker disabled), 7 suites
PASS with zero compute executions/results and only fake receipts: `ai-model-switching` 1 (new:
keyboard and mouse switching, Settings sync, reload persistence, invalid pair refused, disabled
reasons, proposal immutability, 1920×1080 / 1440×900 / 1366×768 / 390×844 with zero overflow,
popover fully inside the viewport and topmost, axe WCAG 2 A/AA zero violations), UI-1 2, approval
geometry 1, legacy AI Scientist 1, B4 2, molecule creator 3, scientific safety 1.

### Limitations

Hosted behaviour, real latency, tokens and tool reliability of any NVIDIA model: NOT RUN. With
the current registry only Lightning can ever be selected on a configured NVIDIA server, so real
multi-model switching needs the benchmark below to verify another model first. Selection is
per user, not per conversation. The switcher cannot change a model mid-run by design. Telemetry
covers the latest 500 runs and attributes only single-model runs. Accessibility evidence is
focused Chromium checks, not a certification.

### Future hosted benchmark

Preflight for the first, much smaller probe (at most six calls) is in
NVIDIA_PROBE_PREFLIGHT.md (AI-3, NOT RUN).

AI_MODEL_BENCHMARK_PLAN.md: candidates, fixtures, categories,
metrics, timeout handling, repetition, request bounds (19 logical cases; pilot 38 executions /
38–60 calls, baseline 190 executions / 190–300 calls, retries disabled; no budget authorized),
safety. Requires explicit owner approval; not run.

## Offline E2E reliability — 2026-10-17

**OFFLINE E2E ACCEPTANCE VERIFIED for the tested working tree.** AI-1 `98593b196e24` and
UI-1 `4cd4fe5530dc` remain unchanged local commits; the larger existing harness and this task's
corrections were committed locally as `d819728` after this note was written (not pushed). This does not certify the original commit trees in isolation,
hosted model acceptance, scientific results or publication readiness. Prior blocker notes below
are historical where superseded by these actual runs.

| Latest isolated suite | Actual result | Scope |
| --- | --- | --- |
| `ui-1-ai-scientist` | 2 PASS, rerun after both UI fixes | Five tabs, scoped H2 context, exact approval, reject/no job, approve/READY, Runs/Evidence/navigation, desktop/mobile/focus/axe |
| `approval-geometry-offline` | 1 PASS | Exact saved coordinates; stale binding blocks approval; zero jobs |
| `ai-molecule-creator` | 3 PASS | Five identities/drafts and 2D/3D viewers, event provenance/order, follow/stay/clarify, reload, pause/resume/terminal stop |
| `ai-scientific-workflow` (B4) | 2 PASS | Separate approve/reject projects; synthetic saved recognition, real Ketcher edit/RDKit conformer/review/promotion, persisted gate and approval |
| `ai-scientist` | 1 PASS | Real UI project creation/import, grounded summary, explicit scoped Plan request, approval-only READY job |
| `scientific-safety` | 1 PASS | Electronic-state/D4 rejection, real idempotent queue/cancel, unchanged input, no execution |

All six use the real copied Next.js frontend, repository FastAPI, fresh disposable SQLite/object
storage and random test identity. `--offline` restricts suites, forces fake AI and disables the
compute worker; credentials/hosted markers are not forwarded, repository dotenv is ignored, and
the whole process tree runs in a macOS loopback-only network sandbox. Python DNS/socket hooks and
browser routing add explicit denial. The native Node EPERM regression proves denial before a
non-loopback connection. Missing OS sandbox fails closed; other OS backends remain unavailable.
Readonly post-suite audits found **zero compute executions/results** and only fake model receipts
(none in the non-AI safety case). READY jobs never ran; applicable test jobs were canceled or
removed with their disposable database. RDKit draft/conformer geometry is labelled unoptimized;
B4's recognition is explicitly a synthetic persisted fixture, not model inference evidence.

Corrections and failure classifications:

- Harness: derive repository fixture/venv paths from the runner, not copied-workspace cwd; retain
  captures using the disposable workspace; clean up own processes/storage even after copy failure.
  Preserve minimum12GiB free/max2GiB workspace guards. New offline safety shim initially broke a
  version-only capability probe in the minimal installed worker prefix; corrected and regression-tested.
- Test semantics: the real molecule sequence is start, five identity/tool pairs, five atomic
  object creations, completion. The extra five generic `molecule.resolve` receipts are legitimate.
  Replace total12 with required effects, unique/gap-free ordering, project/run provenance and
  draft identity checks; do not substitute another fixed total. No duplicate jobs/executions.
- Stale UI interactions: current status/five-tab selectors, explicit Ask/Plan submission,
  real Advanced pressed-state checks, import-form scoping, cold dev-navigation allowance and
  geometry-ready screenshot conditions. No application safety check was weakened.
- **Application fix:** primary StructureViewport support probes leaked temporary WebGL contexts
  until GC, losing a visible canvas during five-viewer navigation. Release probe contexts promptly;
  repeated-probe unit test and full molecule/browser rechecks pass.
- **Application fix:** Ketcher3.12 announces the same molecule API again as its other editor loads.
  ChemDFT reloaded initial content, erasing N edits after validation. Initialize once per API,
  including concurrent callbacks. Unit test and both B4 cases now preserve C2H7N through saved
  MOL, exact conformer parent, promotion and approval. No backend science contract/schema change.
- Cleanup regression's `ps` inspection is denied by the macOS sandbox. Replace it with an actual
  non-scientific child heartbeat that must stop after interruption; retain the OS network guard.

Final checks: **169 backend PASS** (no skips), **114 focused frontend PASS** across8 files
(includes45 UI-1 behaviours), full web TypeScript and targeted ESLint/Ruff/whitespace PASS.
The initial backend run was168 PASS/1 harness failure; its receipt is preserved. Full backend and
full frontend suites were not rerun. Explicit synthetic unit-result fixtures exercise the Firewall;
none is an engine run or scientific acceptance result.

Installed Impeccable context/standards, audit/optimize/craft-floor/polish guidance, source review,
detector and visual confirmation used for the functional UI fixes. Requested1920×1080,1440×900,
1366×768,390×844 captures reviewed; viewer left/AI right, usable controls, focus and zero page/panel
horizontal overflow verified. Focused axe checks across five tabs, approval and mobile sheet had
no violations. Ketcher detector's2 accent-border warnings and9 palette advisories are unchanged
outside the initialization repair; no redesign or whole-file clean-detector claim.

Detailed commands, failure matrix, file inventory, preservation fingerprints, JUnit and the
full final report: audit report.
Browser logs/traces/captures: `output/playwright/offline-e2e-20261017/`; final summaries in each
acceptance subdirectory and `final-browser-summary.json` in the audit. Workspaces removed after
their own process groups stopped; diagnostics retained separately. Unrelated files survive.

Committed as `d819728` (20 files) after separate owner authorization; originally proposed as:
`fix: stabilize offline AI Scientist end-to-end workflows` — reviewed hardened harness, offline
guards/tests, five corrected browser specs, the two UI lifecycle fixes and these evidence notes.
Review the whole mixed harness diff because prior hardened infrastructure remains a dependency;
do not stage unrelated AWS/configuration/design/report/archive/preview work. No stage/commit,
push/merge/deploy, external provider request, scientific calculation, installation, credential
or existing database change occurred. Hosted/native/live suites remain NOT RUN and separately gated;
the scientific pilot remains STOPPED.

## Scoped local commit authorization — 2026-10-17

The owner authorized exactly two local commits: AI-1 backend/contracts/schemas/tests,
then UI-1 frontend/integration/tests. Verify each staged state before its commit.
This supersedes older notes awaiting staging/commit permission; those remain historical.
No push, merge, deployment, provider call, scientific execution or existing database migration
is authorized. Unrelated working-tree files and hunks must remain intact.

## AI-1 reliability checkpoint — 2026-10-16 (implemented and offline tested)

**NOT DEPLOYED. No live inference/scientific run.** The historical diagnosis/prototype below is
preserved as its original evidence, not the current local implementation status. Hosted V2 remains
FAIL; no performance or scientific capability is promoted by these offline checks.

### Integrated request scope and diagnostics

- `PostMessageInput.planning_profile=PYSCF_ENERGY_PROPOSAL` explicitly selects a lower-only STANDARD
  planning scope. GENERAL remains the default; no keyword heuristic changes permissions.
  [Profile builder](../../services/api/src/chemdft_api/ai/planning_profiles.py) verifies selected
  version/project access, editable state, existing geometry/electronic-state guards and both artifact
  byte hashes. Typed [context1.1](../../services/api/src/chemdft_api/contracts/ai_planning.py) includes
  exact saved coordinates, representation hashes/source authority/provenance, full Navigator and
  immutable approval requirement. Oversized context is refused, never silently trimmed.
- Only `structure.version.get` and `calculation.submit` are advertised **and dispatched**. Complete
  selected schemas and all policy flags remain; duplicate prose descriptions and the other23 tools
  are excluded. Scientific submission must reference this selected version, PySCF, ENERGY. Existing
  schema/scientific/workflow validation creates PENDING/WAITING_FOR_APPROVAL, never a job. Resume
  re-authorizes/hash-checks the saved selection and preserves scope rather than widening to GENERAL.
  Routine planning skips unrelated document prefetch; GENERAL evidence retrieval is unchanged.
- The exact model-facing context is persisted as `product-context/1.1.0`; invocation reservations
  record profile/context versions alongside existing input-bound evidence. Full system safety,
  per-user/project authorization, budget/epoch fencing, action fingerprints and Result Firewall remain.
- [Transport](../../services/api/src/chemdft_api/ai/http_transport.py) uses stdlib verified TLS and
  proxy handling with measured connect/write/header/body phases, DNS/TLS/network distinctions and
  known integer HTTP statuses. Redirects are refused to prevent an extra dispatch/credential forward.
  The gateway persists fixed phase/kind/status, elapsed/header milliseconds, timeout, attempt and retry
  eligibility in existing invocation receipt JSON; safe structured logs separate estimated input from
  reported usage. No prompts, payloads, arbitrary headers, exception text or secrets are logged.
  Rejected tool steps distinguish invalid arguments from scientific/policy validation without storing
  rejected raw arguments. Response parsing is bounded and malformed/null JSON is rejected.
- **Timeout60s, model, sampling, thinking defaults and non-streamed protocol are unchanged.** Scientist
  still permits one physical attempt per reservation; retry eligibility never grants a retry. Missing
  usage stays NULL/UNKNOWN with conservative quota settlement and real failure elapsed time. A late
  diagnostic after uncertain recovery uses CAS without another charge/ledger entry. No
  automatic fallback/model switch, dependency, migration, credential or production change.

Equivalent offline H2 fixture, same objective/history and full safety instructions:

| Measurement | GENERAL | Scoped ENERGY |
| --- | ---: | ---: |
| Selected tool schemas |25 |2 |
| Reservation-input bytes |50,192 |29,862 |
| Estimated input-token reservation, existing floor2 policy |27,004 |16,103 |

**40.4% reservation reduction** on both SQLite and disposable local PostgreSQL. This fixture is
different from the historical deployed V2 request (28,373) and its prototype (16,993); do not mix their
denominators. These are reservation estimates, not tokenizer counts, supplier usage or latency gains.
Remaining overhead is primarily full safety text and the complete calculation schema. Further
schema specialization needs its own contract/security tests; do not remove validation constraints.

### Current model evidence and selection gate

The single executable capability registry is
[`ai/model_catalog.py`](../../services/api/src/chemdft_api/ai/model_catalog.py), surfaced in
`GET /v1/ai/settings.model_capabilities` through a generated typed contract. Status is one of
DOCUMENTED / CONFIGURED / LIVE-VERIFIED / UNAVAILABLE / UNSUPPORTED. CONFIGURED means an explicit
matching server model/endpoint route; current-user credentials, allowance and kill switches remain
separate availability gates. LIVE-VERIFIED is narrowly scoped historical tool-response compatibility,
**not** H2 proposal acceptance, current account entitlement, an SLA or authorization to call it.
`proposal_workflow_verified=false` for every candidate. No candidate becomes selectable merely by
appearing in documentation or server model settings. An unknown/custom endpoint inherits no NVIDIA
verification. Existing provider/model identity checks and per-run receipts prevent silent switching.

Public documentation reviewed2026-10-16; no authenticated discovery or inference:

| Candidate and exact identifier | Documented endpoint/capabilities | ChemDFT state and limitation |
| --- | --- | --- |
| [Lightning](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b), `nvidia/nemotron-3.5-lightning-30b-a3b` | NVIDIA `/v1/chat/completions`; text/tools/reasoning/SSE; published1M context; free endpoint Available | Existing configured model; historical genuine tool responses; V2 timeout and hosted proposal FAIL. Only eligible NVIDIA selection on its reviewed configured endpoint. |
| [Nemotron3 Super](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/build), `nvidia/nemotron-3-super-120b-a12b` | Same NVIDIA base; text/tools, thinking and streaming examples;1M; Available free endpoint | DOCUMENTED, no account/adapter/H2 verification. [Model card](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/modelcard) recommends temperature1/top_p0.95, unlike current defaults. Not selectable. |
| [DeepSeek V4 Flash](https://build.nvidia.com/deepseek-ai/deepseek-v4-flash), `deepseek-ai/deepseek-v4-flash` | Published1M; free endpoint Deprecated, partner endpoint separate | UNAVAILABLE for this free route. Exact current request/tool/reasoning/streaming compatibility UNKNOWN; do not infer from model family benchmarks. |
| [DeepSeek V4.1 Flash](https://build.nvidia.com/deepseek-ai/deepseek-v4.1-flash), `deepseek-ai/deepseek-v4.1-flash` | NVIDIA chat-completions example; text/image,1M; free endpoint Available | DOCUMENTED distinct candidate, never an automatic replacement. Tool/schema/thinking compatibility UNKNOWN; image adapter not implemented. |
| [Kimi K3 NVIDIA](https://build.nvidia.com/moonshotai/kimi-k3), `moonshotai/kimi-k3` | Text/image, agentic/reasoning,1M; free endpoint Deprecated | UNAVAILABLE; partner service availability is not access through our key. Tool protocol/reasoning settings UNKNOWN for this endpoint. |
| [Kimi K2 Thinking](https://build.nvidia.com/moonshotai/kimi-k2-thinking), `moonshotai/kimi-k2-thinking` | Function calling/reasoning,256K; free endpoint Deprecated | UNAVAILABLE; continuation compatibility not verified. |
| [Kimi K2 Instruct](https://build.nvidia.com/moonshotai/kimi-k2-instruct), `moonshotai/kimi-k2-instruct` | Agentic/text; free endpoint Deprecated | UNAVAILABLE; current context/parameter compatibility UNKNOWN. |
| [Kimi K2.6 NVIDIA](https://build.nvidia.com/moonshotai/kimi-k2.6), `moonshotai/kimi-k2.6` | Current page empty; K2.5 redirects here; older indexed example conflicts | UNKNOWN availability, not selectable. A stale indexed snippet is not a successful connection. |
| [Direct Moonshot K3](https://platform.kimi.ai/docs/overview), `kimi-k3` | Separate `https://api.moonshot.ai/v1/chat/completions`; tools/SSE,1M | UNSUPPORTED/unconfigured in ChemDFT; no key/purchase/connection. [Parameter reference](https://platform.kimi.ai/docs/api/models-overview) fixes temperature1/top_p0.95 and requires preserved assistant reasoning in multi-turn tool workflows, incompatible with this adapter's stripping/history policy. |

Across NVIDIA candidates, exact account rate limits/current entitlement and billed cost remain
UNKNOWN. A public Free Endpoint badge is evaluation availability, not unlimited use or permission for
researcher production traffic. Existing [trial terms review](#nvidia-modelservice-comparison-official-sources-checked2026-10-16)
still gates external beta; model-weight licensing does not grant hosted service rights. No provider
activation or paid plan is implemented by this registry. Direct Moonshot terms/privacy/pricing remain
unapproved; NVIDIA work needs no Moonshot credentials.

Lightning's [Build example](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b) documents
`chat_template_kwargs.enable_thinking` and `reasoning_budget`. The
[self-hosted NIM guide](https://docs.nvidia.com/nim/large-language-models/2.0.10/get-started/advanced/get-started-nemotron-3.5-lightning.html)
instead documents `thinking_token_budget`: these are endpoint-specific, not interchangeable.
No new reasoning parameter is sent. A separate offline adapter test and approved hosted probe are
required before changing them. Streaming needs SSE/tool-fragment/usage/cancellation handling in the
gateway; switching a boolean alone cannot prove reliability or reduce the provider's inference time.

### Offline compatibility benchmark and next controlled live plan

Reproducible fixtures are [planning profiles](../../services/api/tests/test_ai_planning_profiles.py),
[transport diagnostics](../../services/api/tests/test_ai_http_diagnostics.py) and
[model selection](../../services/api/tests/test_ai_model_catalog.py). They exercise actual API/
validation/persistence code with **explicitly scripted offline protocol fixtures**, never mocked
responses represented as genuine NVIDIA intelligence. H2 is exact H(0,0,-0.37),H(0,0,+0.37)Å,
HF/STO-3G/PySCF2.14.0 ENERGY, charge0/multiplicity1. SQLite and isolated local PostgreSQL persist
pending approval across fresh reads/resume; no AWS/engine/guard/job/result. An NVIDIA-format JSON
fixture covers wire-name conversion through the real gateway and invalid-spin rejection; omitted
fixture usage remains UNKNOWN. Stale/foreign selection, tampered artifact and out-of-profile tools
are rejected. Existing approval/isolation/accounting regressions remain applicable.

Metrics protocol for every future eligible model: freeze identical context/history/tool schemas,
geometry/authority and caps; record request hash/profile/bytes/reservation, explicit provider/model,
transport elapsed/status/phase, provider-reported tokens separately, tool and scientific argument
correctness, proposal validation/approval/persistence, forbidden effects and duplicates. Text-only
completion is not a successful plan. Failed/uncertain attempts remain in timeout-rate denominators;
one trial is insufficient to estimate a reliable latency/timeout distribution. Current provider
latency, timeout rates, actual tokens and cost for this new profile are **NOT MEASURED**. Costs stay
UNKNOWN without applicable verified tariffs and supplier receipts. No model ranking or switch yet.

**Prepared, NOT AUTHORIZED/NOT RUN:**

1. Finish UI-1 selection of this explicit planning profile, targeted checks and separately approved
   minimal backend/frontend rollout. Verify source hashes, health/auth and stopped scientific pilot.
2. Reuse existing hosted H2 project `16950006-f687-4bec-aca9-355301e690a1`, version
   `31019098-3955-4343-9fb9-578dac2c0e7c`; resolve and hash-check it through current founder access.
   Check available daily/run quotas and exact assembled request **before** dispatch; stop if the
   reservation exceeds20,000 or quota is insufficient. Do not increase limits or silently trim.
3. One Lightning call, max attempts1/max model calls1/max input reservation20,000/max output2,048;
   unchanged60s timeout/sampling. Explicit objective: prepare this selected H2 HF/STO-3G/PySCF ENERGY,
   charge0/multiplicity1, approval only, using the exact validated geometry already in context. The
   model can directly propose; if it instead requests a read and needs another call, stop/report
   incomplete within the one-call cap rather than making a second request.
4. Require a schema/scientifically valid proposal, PENDING/WAITING_FOR_APPROVAL, retained objective,
   context/input hashes, tool/model receipts/provenance in PostgreSQL and browser reload persistence.
   Compare calculation/job/execution/result counts and scientific input/artifact hashes before/after;
   all must be unchanged. Never approve, run PySCF or open a compute session.
5. On failure retain redacted diagnostics and UNKNOWN actual usage when absent; no auto-retry or
   fallback. Retain evidence, stop and report. No Phase I. Expected allowance consumption is capped
   at20k estimated input/2,048 output, **not** a proven price. Dollar cost UNKNOWN; no purchase/new
   infrastructure authorized. Separate explicit live-call approval is required.

**180 unique focused checks PASS**, zero failures/errors/skips across overlapping receipts. Source
lint/diff checks, generated schema freshness and schemas/web TypeScript checks PASS; no full suite/build.
Exact local test commands/results and continuation gate are in NEXT.md. Test receipts
and reservation measurements: `.chemdft/audits/ai-1-checkpoint3-20261016/` (ignored, redacted).

## NVIDIA timeout diagnosis — 2026-10-16 (read-only / offline prototype)

No live provider calls, runtime source/config changes, deployment, scientific execution,
credential changes, commit or push. This diagnosis does not convert the V2 acceptance FAIL to PASS.
Evidence: `.chemdft/audits/nvidia-timeout-20261016/`, especially `deployed.json`,
`request-analysis.json`, the explicitly NOT-SENT/NOT-PERSISTED candidate files and test receipts.

### Verified transport and limits

Existing root session/account verified, then read-only deployed inspection at **09:28:39 UTC**.
Model FAST/STANDARD/REASONING are all `nvidia/nemotron-3.5-lightning-30b-a3b`; endpoint
`https://integrate.api.nvidia.com/v1/chat/completions`. Key configuration boolean true;
no key value was exported or printed. Runtime hashes of gateway/service/policy/projection/token policy/
tool catalogue/context tools match local source. Image remains `e28bde985cfa…`.

- `Settings.ai_timeout_seconds=60` reaches `urllib.request.urlopen(..., timeout=60)`.
  This is a blocking connect/socket-read timeout, not a guaranteed total wall-clock deadline.
  Observed V2 invocation-to-failure is about60.16 seconds. The adapter uses stdlib `urllib.request`,
  not the older ADR-036 description's `httpx`; actual code governs.
- Payload: model/messages/25 tools/temperature0/max_tokens2048. `stream`, `top_p`,
  `chat_template_kwargs` and `reasoning_budget` are absent. Thus the adapter requests the normal
  non-streamed JSON response and waits for headers/body. No SSE parsing/fragment assembly exists.
  NVIDIA documents thinking enabled by default for the published Lightning checkpoint; actual
  hosted thinking settings on the failed call are **UNKNOWN** because they were not explicit.
- Scientist overrides generic gateway retry defaults with **max_attempts=1** before dispatch;
  offline429/503 tests prove no hidden retry. Timeout/network failures are never retried.
- Recognized429 maps to `PROVIDER_RATE_LIMIT`;402/5xx to `PROVIDER_UNAVAILABLE`;401/403 to
  authentication failure. V2's `PROVIDER_TIMEOUT` came from the timeout/`URLError` branch,
  **not a recognized429/402/5xx**. This branch also conflates DNS/TLS/connection failures.
  HTTP status, response/request ID, Retry-After, underlying exception, headers-vs-body phase and
  time-to-first-byte were not retained. A200 followed by body-read timeout is also possible.
  Therefore **no complete usable response** is established; "no HTTP headers at all" is NOT VERIFIED.
  The receipt's latency0 is missing failure instrumentation, not zero provider latency.
- Prior successful calls to this same model recorded48,027ms and18,081ms header latency with
  reported usage. Those observations support basic endpoint/model compatibility, not a latency SLA.
  Successful latency currently measures only until headers, omitting body-read time.
- Deployed Caddy has no explicit60-second response deadline; outbound model traffic goes directly
  from API to NVIDIA. HTTP(S)/ALL_PROXY environment flags are absent. Next's application proxy
  source adds no60-second abort; actual Vercel platform limits are NOT VERIFIED. A durable backend
  provider error establishes that a frontend-only timeout is not the sole cause.
- Supplemental Docker/Caddy log read later failed because the AWS session expired, verified at
  **12:39 UTC**. No renewal/escalation. Earlier bounded journal inspection returned no parsed JSON
  events. Historical HTTP headers/status cannot be recovered from this evidence.

**Cause assessment:** confirmed application timeout, with upstream latency plus unnecessary request
size and possible default reasoning as plausible contributors. NVIDIA documents shared Lightning
endpoint congestion/timeouts; this makes congestion plausible, not proved for our request.
Rate-limit/credit rejection, upstream congestion vs inference time, and exact network phase remain
UNKNOWN. Wrong endpoint/model is less likely given exact published identifiers and prior success.

### Exact failed-request size and offline reduction

Reconstruction uses the persisted ProductContext, the two user messages visible at dispatch and
the exact deployed tool schemas. No gateway/handler was invoked. Its **51,589 reservation-input
bytes /28,373 estimated tokens** match the committed receipt exactly. These are heuristic
reservation measurements, **not actual provider usage** (which remains UNKNOWN for V2).

| Component | Serialized input bytes | Approximate reservation contribution |
| --- | ---: | ---: |
| Full system instructions + message framing | 8,544 | 4,272 |
| Scientific Navigator context | 2,114 | 1,057 |
| Molecular selection/references/provenance summary | 928 | 464 |
| Duplicated25-tool policy catalogue in ProductContext | 14,311 | 7,155.5 |
| Other context metadata | 854 | 427 |
|25 actual tool definitions | 23,425 | 11,712.5 |
| Earlier objective/history | 347 | 347 |
| Current objective + dynamic framing | 1,066 | 1,066 |
| RAG evidence | 0 | 0 |
| Additional protocol/message/tool allowances | — | 1,872 |
| Total | 51,589 | 28,373 |

Static bytes use the unchanged floor2, dynamic bytes1 token/byte; fractional contributions sum
before rounding. This accounting is not the raw HTTP body's byte length or a tokenizer measurement.
The request has no documents/RAG prefetch. The separately persisted graph-context snapshot is
**not appended** to this planning prompt; counting it too would overstate actual context.
Baseline geometry is explicit in the user objective; ProductContext contains references and atom/
charge summaries, not the complete canonical coordinate record until `structure.version.get`.
The largest schema, `calculation.submit`, is11,791 bytes and includes options for other task types;
it remains intact in this experiment rather than silently narrowing scientific constraints.

**Offline prototype only:** explicit `PYSCF_ENERGY_PROPOSAL_ONLY` profile exposes
`structure.version.get` + `calculation.submit`, retains the full unchanged system policy and
original complete schemas, same existing history/objective, all Navigator blockers and source
authority, and adds the saved exact structure/geometry, both actual artifact hashes and original
provenance record. Policy catalogue includes only these same two tools. New context version is
explicitly `planning-profile-prototype/1.0.0`, never passed off as a deployed contract.

Measured **30,301 bytes /16,993 input reservation**, a **40.1% reservation reduction**.
All four lightweight prototype/transport tests PASS (0.008s), plus **14 existing targeted checks
PASS** (12 in7.202s +2 in0.040s), serial/numeric threads1/nice10. No builds, scientific engine,
full regression or tokenizer download. These results establish preservation/size, not faster
NVIDIA inference or genuine model success. Prototype is in ignored evidence, **not integrated**.

### Minimum corrective implementation and next live gate

1. Integrate an **explicit typed planning profile** into the existing server context builder;
   persist the exact new versioned model-facing snapshot. Scope both advertised schemas and actual
   dispatch allowlist to the two tools. Authorize/read/hash-check saved input before assembling it;
   fail closed on stale/cross-project data. Preserve the full default profile for unrelated work;
   no keyword-only heuristic or silent trimming of an oversized request. No new model tool needed.
2. Persist secret-free transport diagnostics with the existing invocation receipt: integer HTTP
   status when observed, fixed error kind/phase, bounded validated request-ID/Retry-After where
   available, timeout, elapsed-to-headers and total elapsed, request component sizes. Never body,
   prompt, arbitrary headers, exception text, credentials or reasoning content. Distinguish actual
   socket timeout from other network failures. Keep actual missing usage NULL and retain uncertain
   reservations; one reservation remains one physical attempt.
3. **Do not raise timeout yet.** Measure the reduced request under the existing60s limit. Only
   if evidence shows legitimate completion beyond it, propose a bounded total/idle deadline change
   and check the entire browser/proxy request lifetime. No configuration change in this task.
4. SSE is supported by NVIDIA, **not this gateway**. It can expose first-byte/progress timings and
   avoid long idle reads once chunks begin; it does not fix queue delay or guarantee lower total
   latency. A later implementation needs bounded argument-fragment assembly, final usage handling,
   absolute + idle deadlines, discarded reasoning and zero effects before complete validated
   tool calls; interrupted streams retain UNKNOWN usage. No automatic reconnect/retry. It is a
   larger change than context scoping + diagnostics and is not the first corrective step.
5. For routine typed planning, NVIDIA documents `enable_thinking=false` as a possible direct-answer
   mode. Evaluate only under an explicit approved provider option and separate structured-tool
   acceptance test; don't change model, sampling, reasoning and timeout simultaneously.

After separate implementation/deployment approval: one existing H2 objective, same Lightning
model, one physical attempt, **20,000 cumulative input-reservation /2,048 output cap** (lower-only),
fresh quota check and exact pre-dispatch estimate. Stop if the full request does not fit. Target
PENDING/WAITING_FOR_APPROVAL, persist normalized input/fingerprint/context/model/tool receipts,
reload, zero calculations/jobs/results and pilot STOPPED. No second call without new approval.
No live latency improvement or completed proposal is claimed before that acceptance evidence.

### NVIDIA model/service comparison (official sources checked2026-10-16)

| Option | Published free endpoint | Decision |
| --- | --- | --- |
| Existing Lightning3.5 30B/3B active | Available | Keep; existing integration/tool selection evidence, optimize first. No verified faster hosted alternative. |
| Nemotron3 Nano30B-A3B | Deprecated | Not an eligible free replacement merely because older advice recommends it. |
| Nemotron Nano9B v2 | Deprecated | Smaller weights do not establish an available free endpoint. |
| Nemotron3 Ultra550B-A55B | Available | Agentic/tool-capable but much larger; no measured latency advantage for routine H2. Not selected. |
| Nemotron3 Nano Omni30B-A3B reasoning | Available | Multimodal reasoning is unnecessary here; no comparative latency/tool acceptance evidence. Not selected. |

Model changes do not remove application-supplied schema/context overhead. Lightning's published
scientific/tool benchmarks do not independently validate ChemDFT inputs; server scientific gates
remain authoritative. Current temperature0 differs from NVIDIA's recommended1/top_p0.95, but earlier
successful requests used the same configuration, so this is not evidence of a timeout cause.

Free endpoint remains usable for **internal evaluation**, with variable availability and account
limits UNKNOWN. It is not an assured external-researcher-beta service: linked NVIDIA Trial Terms
§1.2/§1.4 restrict it to internal testing/evaluation and exclude production without a separate
subscription; §2.6(a) also restricts confidential/sensitive inputs. Confirm applicable production
terms before external researcher use. No provider switch, subscription, account upgrade or paid
infrastructure is authorized or performed by this finding. Open model license and hosted trial
service rights are distinct; an open model license does not authorize production on the trial API.

Primary sources:
[Lightning catalogue](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b),
[official model card/reasoning controls](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4),
[NVIDIA hosted-availability guidance](https://docs.nvidia.com/aiq-blueprint/2.2.0/resources/troubleshooting.html#nemotron-hosted-endpoint-availability),
[NVIDIA API Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf),
[Nano catalogue](https://build.nvidia.com/nvidia/nemotron-3-nano-30b-a3b),
[Nano9B catalogue](https://build.nvidia.com/nvidia/nvidia-nemotron-nano-9b-v2),
[Ultra catalogue](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b),
[Omni catalogue](https://build.nvidia.com/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning).

**Latest hosted acceptance V2 — 2026-10-16 13:21 Baku: FAIL / PROVIDER_TIMEOUT.** One authorized
NVIDIA/Nemotron3.5 Lightning attempt on existing H2, durable cap1; timed out after configured60s.
Actual usage UNKNOWN/NULL;28,373 input/2,048 output reservations conservatively charged, not reported
usage. No response/tool execution/proposal/approval/calculation/job/result. Objective, two contexts,
model/UNKNOWN ledger receipts and failure persist in PostgreSQL and after reload. All prior project
records/input hashes/provenance unchanged; backend/three workers healthy, pilot STOPPED. Previous
58,991 reservations are run-specific;36 daily run slots were available. No retry/deployment/quota or
scientific status change. Authorization exhausted; read-only timeout diagnosis then separate approval
for another live call. Current evidence and next gate. Earlier pending retest notes are historical.

**2026-10-16 hosted Navigator fix DEPLOYED / verification PASS (13:04 Baku).** Three approved source
files only, API-only restart; existing lower-only run limits/model/auth configuration preserved.
69 targeted tests passed again. Read-only validation of the genuine stored H2 input succeeds and
authenticated Navigator displays single-point ENERGY; unsupported AWS tasks and unapproved submission
remain rejected. No model call, proposal persistence, job or scientific execution was invoked for
verification; all production table digests and scientific objects/backups unchanged. Pilot STOPPED.
The previous NVIDIA acceptance remains FAIL until a separately approved capped retest produces an
actual WAITING_FOR_APPROVAL proposal. Current image, rollback and test gate.
Earlier NOT DEPLOYED annotations below describe prior checkpoints.

**2026-10-16 Navigator fix prepared — OFFLINE PASS / NOT DEPLOYED.** Existing AWS static configuration
now supplies proposal capabilities without a local worker or active AWS session; explicit provider
scope and PySCF ENERGY-only checks precede approval. No queue/claim/execution/firewall or run-limit
change. 69 targeted tests PASS, including 14 new cases and real disposable local PostgreSQL persistence/
reload reads; two final artifact-integrity cases rerun PASS. Valid offline proposals wait for approval
with zero jobs; explicit test approval only queues READY and no-session workers refuse claim. Fresh
read-only hosted source/configuration compatibility PASS, backend healthy/pilot stopped. No NVIDIA
call or deployment in this fix task. The live acceptance failure below remains the current hosted
result. Current handoff and exact next approval gates.

**Hosted acceptance 2026-10-16 — FAIL, real NVIDIA transport/tool selection verified.** One H2 objective,
two successful Nemotron 3.5 Lightning calls: 31,547 input / 2,574 output tokens, 58,991 cumulative input
reservations. Lower-only request caps are now deployed and verified (2 calls / 60k reservations / 4,096
output); no third dispatch. `structure.version.get` succeeded; `calculation.submit` was rejected by
Navigator `worker_unavailable` before any approval. Run ended FAILED/BUDGET_EXCEEDED. Context, model
receipts, tool rejection and failed state persist in PostgreSQL and after browser reload; rejected
scientific arguments are not retained, so exact proposed PySCF specification is NOT VERIFIED.
No calculation/job/result or approval was created; scientific EC2 remains STOPPED. Review the local-only
Navigator capability observation against the hosted AWS provider, preserving approval/firewall and
execution readiness gates. **No more calls authorized under this completed test.** Exact current evidence,
deployment provenance and next gate. Earlier prepared-only/authentication notices below
are historical and superseded; they are not the current deployment state.

## 1. Design Overview
The Model Gateway provides a strict boundary between ChemDFT's business logic and underlying foundation models. ChemDFT core contains zero dependencies on proprietary vendor SDKs (`openai`, `@ai-sdk`, etc.).

## 2. Model Gateway Protocol
```python
class ModelGateway(Protocol):
    def generate(self, request: ModelRequest) -> ModelResponse: ...
```

### Request & Response Contracts
- **`ModelRequest`**: System prompt, structured message history (`user`, `assistant`, `tool`), tool definitions schema, model tier (`FAST`, `STANDARD`, `REASONING`), temperature.
- **`ModelResponse`**: Content string, typed tool calls (`id`, `name`, `arguments_json`), usage metrics (`input_tokens`, `output_tokens`, `latency_ms`), provider, model identifier.

Usage is optional. Missing or partial core usage yields `usage=None`, while
`reported_usage` preserves valid individual observations. Confirmed zero counts
remain known zero; absent cache usage remains unknown. Truncation errors preserve
valid reported usage for accounting without accepting truncated content/tools.
`ModelRequest.max_attempts` is bounded to 1–3. Budgeted AI Scientist and
investigation calls use one attempt per durable reservation; retrying requires
another authorized reservation. See [ADR-041](../adr/ADR-041-durable-ai-usage-accounting.md).

## 3. Supported Implementations
1. **`FakeModelGateway`**:
   - Deterministic scripted responses for offline CI and testing.
   - Accurately simulates multi-step tool calls (`structure.list`, `calculation.submit`, `document.list`, `document.get`).
   - Grounded responses using authoritative fixtures.
   - Refuses unsupported science (e.g. NMR, CCSD(T) optimization).
   - Defends against simulated prompt injections.
2. **`HttpOpenAIModelGateway`**:
   - OpenAI-compatible HTTP adapter using Python `urllib.request`; live/production acceptance is separate from implementation.
   - Formats tools as OpenAI function calling specs.
   - Maps standard chat completions with JSON schema tool calls.
   - Parses usage tokens and enforces request timeouts.

## 4. Configuration & CI Safety
- `CHEMDFT_AI_PROVIDER`: source supports `openai`, `openrouter`, `huggingface`, `nvidia`; the default `fake` is a local/test boundary and is refused in hosted production selection, never a silent fallback.
- `CHEMDFT_AI_MODEL_FAST`: default `"gpt-4o-mini"`.
- `CHEMDFT_AI_MODEL_STANDARD`: default `"gpt-4o"`.
- `CHEMDFT_AI_MODEL_REASONING`: default `"o3-mini"`.
- Standard CI (`pnpm verify`) runs 100% offline with zero external network access.
- Live integration is explicitly opt-in. Settings use `CHEMDFT_AI_API_KEY` or `CHEMDFT_AI_API_KEY_FILE`; never print values or confuse a historical provider-specific test variable with the current authoritative Settings contract. `CHEMDFT_AI_API_KEY_FILE` fails closed (2026-10-15): symlinks, non-regular/multi-link files, foreign owners, any group/other permission bit, files outside 1-8,192 bytes and multi-token/non-UTF-8 content are rejected with path-only messages, and a configured missing file is an error rather than a silent fallback.

## Input-token reservation — INPUT_RESERVATION_V2 (2026-10-15, offline-verified only)

Implemented in `ai/token_policy.py`; used by the AI Scientist loop, the evidence-answer path
and the investigation decision call. It replaces the flat 1,500-token input reservation. **No
live provider request validated it.**

| Quantity | Meaning | Where it lives |
| --- | --- | --- |
| Estimated input | conservative heuristic (not a guaranteed bound) derived from the exact request before dispatch | `reservation_json.estimated_input_*`, `InputReservationBound` |
| Reserved input | quota held for the call; never below the estimate | `AIRunBudget.reserved_input_tokens`, `reservation_json.input_tokens` |
| Provider-reported | `usage.prompt_tokens/completion_tokens` as received; unknown stays NULL | invocation `input_tokens`/`output_tokens`, `usage_status` |
| Billed cost | never derived; supplier pricing is unknown | `provider_cost_minor_units = NULL` |

V1 (all bytes ÷ floor) was superseded the same day by V2 after measuring the published tokenizer;
see NEMOTRON_TOKENIZER_MEASUREMENT.md.

Estimate = ceil(static bytes ÷ floor) + dynamic bytes at **one token per byte** + 1,024
protocol + 16 per message + 32 per tool, where *static* is the system message plus the tool
definitions (server-authored, bounded, measured 2.7–4.3 bytes/token) and *dynamic* is every other
message (user text, assistant turns, tool results, evidence passages), serialized exactly as
`HttpOpenAIModelGateway` sends them (decoded, no ASCII escaping; the shared builders
`chat_messages_payload`/`chat_tools_payload` keep estimator and adapter from drifting). The
first version divided *all* bytes by the floor; measurement showed that under-reserves numeric
tables, coordinates, hex/base64 and combining marks by up to 2x. A request is **rejected before
dispatch** when its reservation exceeds the remaining input allowance (`AIBudgetExceededError`,
"input reservation"); the old silent truncation was removed. The gateway re-derives the estimate
from the bytes it is about to send and refuses with `ModelInputBudgetInsufficientError` before
any network I/O if the request carries a smaller `reserved_input_tokens`.

**This is a conservative heuristic, not a guaranteed upper bound.** Earlier text calling floor
1.0 "provably sound" was wrong and is withdrawn. Measured against the published tokenizer, the
V2 estimate was at or above the local token count on all 25 request samples (minimum 1.014x on a
digit stream; real planning request 1.83x; investigation 4.3x). The published tokenizer is a
byte-level BPE without a normalizer, so locally it cannot emit more than one token per byte; but
the hosted service's template/tokenizer are unverified, so every reservation records
`input_estimate_basis = BYTE_HEURISTIC_NOT_A_GUARANTEE`. The static floor is
`CHEMDFT_AI_INPUT_BYTES_PER_TOKEN_FLOOR` (default **2.0**, range 1.0–8.0). Provider-reported
input above a reservation is stored exactly as received (never clamped), increments the
persisted `input_overruns` counter and moves every later reservation of that run to floor 1.0;
detection happens after dispatch. The 16,384 reported input tokens remain provider-reported
values with no retained raw HTTP receipt and are not independent verification.

### Provider-compatible token counting — measured offline, not a runtime dependency

The open checkpoint's tokenizer and chat template were downloaded once (pinned revision, SHA-256
recorded) and used **for measurement only**; see
NEMOTRON_TOKENIZER_MEASUREMENT.md for source, versions,
results and reproduction. Counting with it at request time is not adopted: it would add a 17 MB
asset, a template renderer and an unverified assumption that the hosted service matches this
checkpoint. Local counts are not NVIDIA hosted usage.

### Never-sent versus dispatched requests (2026-10-15)

A request rejected before any network I/O is a different accounting event from a dispatched
request with an uncertain outcome:

| Case | Marker | Budget | Receipt (`ai_model_invocations`) | Ledger |
| --- | --- | --- | --- | --- |
| Never sent (input/output reservation insufficient, no credential, provider not configured, local protocol rejection, provider selection failure) | `ModelRequestNotSentError.request_sent = False` | reservation released; no spend; not counted as a model call; in-flight slot freed | `status = NOT_DISPATCHED`, token columns NULL, `usage_status` UNKNOWN, `reservation_json.dispatch_state/not_dispatched_reason/released_*` | no entry |
| Dispatched, outcome uncertain (timeout, network error, 5xx, protocol error, any unclassified exception) | default `request_sent = True` | reservation counted as spent | `FAILED_UNCERTAIN`, UNKNOWN, NULL counts | one UNKNOWN entry, billable 0 |
| Dispatched with usage reported | response | reported counts settled | `SUCCEEDED`, REPORTED | one entry |

The default is deliberately the conservative one: only error types that prove a request never
left the process are released. Release is idempotent and scoped to the current reservation id
and to receipts still `RESERVED`, so crash recovery, a successor's reservation and an already
settled receipt cannot be altered; reasons are a closed set of fixed labels, never exception
text. Investigations additionally return the reserved model-call count.

### Prompt size — why 25 tools, and the safe reduction (PROMPT_PROJECTION_V1)

The AI Scientist planning request measured 55,033 UTF-8 bytes: 24,645 system prompt (8,336
policy text + 16,244 serialized ProductContext, of which the 25-entry `allowed_tools` table is
13,142) and 26,328 tool definitions. **The 25 tools are the full `AI_TOOLS` allowlist** (19 read,
2 approval-gated write, 4 bounded write) filtered only by the caller's project role in
`tool_policies` (a read-only member gets 19); they are neither a leak nor a bug, and each is
needed for a different workflow. `allowed_tools` repeats the tool prose that the tools array
also carries.

Implemented (`ai/prompt_projection.py`): the model-facing tool schemas drop JSON-Schema `title`
annotations only (5,271 bytes of field-name echoes). Types, enums, constants, defaults,
`required`, bounds and descriptions are kept; arguments are still validated against the original
Pydantic models; tests prove each exposed schema equals the registry schema minus titles and
that all 25 tools remain. Result: **55,033 → 49,762 bytes (−9.6%)**; floor-2.0 reservation
**29,373 → 26,737 (−9.0%)**. Every reservation records `prompt_projection = PROMPT_PROJECTION_V1`.

Tried and reverted: shrinking the `allowed_tools` table inside the serialized ProductContext
(dropping description/schema refs/audit strings gave −7,195 bytes, and omitting it for the
tool-free evidence request a further ~5.9 KB). `test_product_context_snapshot_is_exact_bounded_model_payload`
pins that `ai_context_snapshots.summary` (schema `product-context/1.0.0`) equals what the model
was sent; diverging would break that provenance guarantee. The reduction therefore needs a
versioned context schema (for example `product-context/1.1.0`) and an accepted contract change —
an owner decision, not a silent prompt tweak.

Not done, deliberately: `calculation.submit` is 11,614 bytes (23% of the request) because it
embeds the full `CalculationSpecification` (task types and options for Raman, Hessian, TDDFT,
thermochemistry and conformer search); trimming it risks invalid scientific inputs. Sending it
only for calculation intent, or shortening the 8,336-byte policy text, would change model
behaviour and needs an evaluation set first.

Unchanged: one in-flight call per run, optimistic compare-and-set persistence, worker-epoch
fencing, idempotent settlement by reservation id, unknown/failed/timed-out calls settled
as uncertain at the reserved amount (UNKNOWN, NULL counts), output bounded by `max_tokens`
(Nemotron minimum 512), one attempt for paid calls, no provider/model fallback.

Current approved provider is `nvidia`, model
`nvidia/nemotron-3.5-lightning-30b-a3b`, endpoint
`https://integrate.api.nvidia.com/v1/chat/completions`. Historical live success,
usage/receipt limitations, full-input reservation weakness and unknown pricing
are recorded in the single Technology Registry.
Kimi is only a planned paid backup, with no purchase/configuration. This note
authorizes no live call, scientific execution or provider fallback.

## Hosted AI Scientist smoke test — prepared, NOT RUN (2026-10-16)

**Latest authorization:** the owner approved one live test with at most **2 NVIDIA calls**,
**60,000 cumulative input reservations** and **4,096 output tokens**. The older wider-limit proposal
below is superseded. Live dispatch is blocked until the strict lower limits are enforced on the
hosted endpoint; the prepared related server change has not been deployed. Target: `https://chemdft-beta.vercel.app`, existing founder JWT session, existing
NVIDIA key/provider/model. Do not run the full `as-c1-nvidia-acceptance.spec.ts` against production:
its later stages require human compute approval, a running PySCF worker, and local-worker provenance.
Those are not evidence for hosted AWS execution. No new dependency/provider/deployment is needed for
this first slice. Six inspected deployed AI source hashes match this checkout (service, gateway,
budgets, prompt projection, message contract and ORM models); read-only host inspection confirms
NVIDIA configuration and local scientific execution disabled.

### Exact proposed sequence

1. Confirm application health, founder login, actual `/v1/ai/settings` provider/model and availability
   using GET only. Do not change AI preferences. Stop on any mismatch or unavailable provider.
2. Create one clearly labeled `Hosted AI smoke — <UTC timestamp>` project and conversation using the
   normal browser/API. Import the existing test's **user-supplied H2 XYZ**, charge 0/multiplicity 1,
   with coordinates H(0,0,-0.37), H(0,0,0.37) Å. This is a specified input geometry, not an optimized or
   AI-derived scientific result. Retain its real returned structure/version IDs and import hashes.
3. Before the paid request, submit the same planning message with an intentionally nonexistent
   selected structure ID. Expect `409 / STALE_SELECTION`, no model invocation and unchanged
   conversation/run counts; the existing offline isolation test verifies this pre-dispatch boundary.
   Stop if a run/provider receipt appears. Use only a random nonexistent UUID, never another
   researcher's real project ID. This exercises live request/error handling without inducing a
   provider failure or changing production configuration.
4. Select the genuine imported version in the hosted workspace. Submit **one STANDARD message**:

   > Propose exactly one ENERGY calculation for the selected H2 structure version. Use charge 0,
   > multiplicity 1, Hartree-Fock (HF), STO-3G, and PySCF. Request my approval before submission.
   > Do not optimize geometry, create molecular drafts, submit additional calculations, or report
   > an energy that has not been calculated.

   This deliberately follows the model planning loop, not the deterministic project-summary or
   structure-inspection shortcuts. Do not post a second objective or automatically retry a failed
   request. A failed/uncertain provider call is recorded as such; no fallback provider.
5. Require an actual NVIDIA invocation receipt and registered scientific tool proposal
   `calculation.submit`, validated arguments bound to this exact project/version, units/engine/method/
   basis/electronic state, action fingerprint, pending approval and `WAITING_FOR_APPROVAL`. Read tools
   may be selected first; record actual steps and tool versions. Prose alone is not a PASS.
6. Require **zero compute jobs, executions and calculated results** in this new project before and
   after. Leave the proposal unapproved; the researcher may reject it through the visible UI.
   Rejection persists without another model call in the inspected implementation. Never click
   Approve, start EC2, enable compute access, or assert a known H2 energy as a produced result.
7. Reload the workspace and retrieve the same conversation/run/events again. Read-only database
   checks, scoped to these new IDs, must confirm persisted messages, context snapshot, ordered tool/
   approval events, validated proposal, model/provider, invocation receipt/reservation and actual
   provider usage (or explicitly UNKNOWN). Verify import/source hashes and linked immutable input
   references. Retain private evidence without credentials/JWTs/full research payloads. No cleanup
   deletion of research/evidence. Existing research projects must remain untouched.

Acceptance is a **hosted planning/approval/persistence smoke PASS**, not hosted scientific calculation
acceptance. It exercises typed proposal validation, the human gate, evidence references and the
absence of unauthorized result writes. Authoritative `CALCULATED` result schema validation,
engine attestations, raw output/artifact hashes and engine provenance remain **NOT RUN** until the
separately approved hosted PySCF milestone. Real provider timeout/auth errors are not deliberately
injected; existing isolated tests cover these and uncertain settlement without spending tokens.

### Estimated usage and actual enforceable limits

The existing captured-payload dry run made **zero requests** and read no credential. Its 49,741-byte,
25-tool request reserves **26,753 input tokens at floor 2**, or 51,597 at floor 1. These are byte-based
heuristics, **not tokenizer measurements or guaranteed actual-token bounds**. The hosted H2 context
will differ, so retain its own receipt/reservation; do not copy this fixture estimate as actual usage.
Expected proposal path: **1–2 provider calls**, about **26.8k–53.5k input reservations** and at most
**2,048 output tokens per planning call** (4,096 across two). NVIDIA-reported usage must be recorded
separately. Monetary cost/credit terms are **UNKNOWN**; no verified NVIDIA rate is configured, and
AWS promotional credits must not be assumed to pay NVIDIA charges.

There is **no per-message call-limit parameter** in the deployed HTTP contract. Do not claim that
"one objective" enforces one or two provider calls. Existing server defaults enforce 60,000 cumulative
input reservation quota, 12,000 output tokens, 15 model calls and 30 tool calls; the deployed planning
loop has 10 steps, so this new STANDARD planning run can make up to **10 provider calls** before its
step ceiling. Paid calls use one HTTP attempt; no automatic retry/fallback. The input quota is checked
before dispatch, actual reported overruns are counted, and uncertain usage consumes the reservation;
it is not a hard supplier-dollar cap. The expected short path can instead end in budget exhaustion
and must then be reported FAIL, never automatically retried.

Approve the above existing-limit envelope for this single objective before execution. If a strict
**two-call** cap is required, a separately reviewed per-run server limit is needed first; do not use
prompt wording, a browser timeout or direct edits to production run records as a substitute.

Offline preparation validation: **104 tests PASS** across hosted configuration, AI Scientist, durable
execution, prompt projection, usage accounting and NVIDIA usage handling. These use isolated
storage/labeled doubles and are not live-provider acceptance. Detailed Phase H and scheduling status
remain in NEXT.md; do not create another backup follow-up task.

### Lower-only per-run limits — implemented offline, not deployed (2026-10-16)

`PostMessageInput.run_limits` accepts only strict positive integer maxima for input tokens, output
tokens, model calls and tool calls. Values above existing server defaults or counter/unknown fields
are rejected. Omitted limits preserve existing behavior. Supplied values are intersected with the
server defaults, persisted before execution in existing `ai_runs.budget_json`, and never reset by
resume. No migration or dependency. Specifying max_input_tokens also sets an independent cumulative
input-reservation ceiling: successful settlement to a smaller actual count cannot free that ceiling
for another call. Undispatched reservations remain conservatively counted toward this optional sum.

The authorized test payload must include:

```json
{"run_limits":{"max_model_calls":2,"max_input_tokens":60000,"max_output_tokens":4096}}
```

The deployed browser message path must actually carry these limits and the live server must accept
and enforce them before any model dispatch. Current production does neither; do not treat the
prepared patch as deployed. A related rollout needs owner approval; normal authenticated transport
must be preserved, with no manual production budget edits or direct identity impersonation. One test
project and exact H2 input already exist; reuse the IDs in NEXT rather than creating another project.
The planned objective is authorized once these limits are enforced; no broader quota is authorized.

154 focused offline tests PASS (12 new lower-limit checks), generated JSON/TypeScript synchronization
and schema typecheck PASS. Live NVIDIA planning, scientific proposal validation and proposal reload
remain NOT RUN; only genuine input import/provenance/persistence have passed on the hosted platform.

### Browser transport and authentication gate — prepared, not deployed (2026-10-16)

The AI Scientist input form now has optional **Run limits** controls. Enabling them sends run_limits
through the existing authenticated postAiMessage path; unchecked controls omit the field and preserve
normal requests. Initial lower limits are 2 calls/60,000 cumulative input reservations/4,096 output
tokens. Positive whole-number/maximum validation disables send and the send handler also checks it.
The server remains the enforcement boundary. Browser controls and backend caps must both be deployed
and checked before the live objective; never submit an uncapped message or assume offline code is live.

Web typecheck/scoped panel lint PASS; 86 targeted API safety tests PASS in this continuation.
Actual live testing is awaiting operator AWS sign-in under the replacement no-root instructions.
See NEXT for the exact existing project and login handoff. No NVIDIA call has been made.

## AI-1 backend repair and UI-1 commit boundary — 2026-10-17 (offline)

**AI-1 REPAIRS VERIFIED — COMMIT PLAN READY.** This supersedes the two open backend
repair items in the historical UI-1 Pass 4 report; it does not supersede its UI/browser
findings or approve a release. Branch verified as
`antigravity/batch-b4-ai-scientist-orchestration`, HEAD
`67432b050f887dee4d3474efe53dd565f4cbe019`. Index empty before/after; no staging,
commit, push, branch switch, deployment, provider call, scientific calculation or existing
user-database migration. The scientific pilot was not contacted or changed.

### Repairs and scientific safeguards

1. The null-tool-calls test patched `urllib.request.urlopen`, but `gateway.py` imports
   `open_response` directly and that transport uses `build_opener(...).open(...)`.
   The test now patches **`chemdft_api.ai.gateway.open_response`**, verifies the POST
   URL/messages/60-second timeout, implements context-manager/status/bounded-read behavior,
   and checks parsed content, empty tool tuple, provider/model, HTTP status and one call.
   Its shared `offline_network` fixture reports zero DNS/socket attempts.
2. `tests/conftest.py` now installs an autouse, fail-closed Python network guard. External
   `getaddrinfo`, `gethostbyname`, `gethostbyname_ex`, `gethostbyaddr`, IPv4/IPv6
   `connect`/`connect_ex`, UDP `sendto` and available `sendmsg` fail with
   `OUTBOUND_NETWORK_BLOCKED`. The pytest failure escapes broad provider exception/retry
   handlers. Loopback and Unix sockets remain available for local HTTP/disposable PostgreSQL.
   **13 guard regressions PASS**, including the real unmocked opener path and numeric-IP
   bypass attempts. There is no live-test exemption. This is a Python test guard, **not an
   OS sandbox for native libraries or subprocesses**; selected proposal fixtures additionally
   forbid scientific subprocesses, compute execution, AWS/SSM/guard calls. Production HTTP
   behavior is unchanged. Full backend/native/cloud suites were not run.
3. `UnsupportedCalculation` inherits `ScientificValidationFailed` → `ApplicationError`;
   ordinary domain errors have `detail` but no `code`. The old diagnostic branch accessed
   `error.code` for every ApplicationError, crashing after correct scientific rejection.
   Exposed the registry's existing mapping as `application_error_code` and reused it:
   domain scientific errors → `SCIENTIFIC_VALIDATION_FAILED`, project access → `FORBIDDEN`,
   project absence → `NOT_FOUND`, slug conflict → `CONFLICT`, unclassified application
   errors → `INTERNAL_ERROR`. Mapping behavior is unchanged for registry calls.
   Typed `ToolInvocationError` retains its enum value; typed `AIFoundationError` retains its
   server-authored code/detail (including `PLANNING_PROFILE_MISMATCH`). Generic ValueError
   and Pydantic failures record `INVALID_TOOL_ARGUMENTS`. Domain errors use class-owned
   default prose, never arbitrary exception text/class names or rejected arguments.
4. Rejection still records the existing FAILED `TOOL_RESULT` / `TOOL_REJECTED` step,
   with stable `operational_diagnostics.kind/code`, no raw tool input, a safe explanation,
   and a finished timestamp. The planner receives that rejection through the existing
   loop. A scripted planner can then finish the run successfully; a failed tool step does
   not imply that the whole run must fail. No approval or scientific execution is invented.
   The 8 actual invalid-proposal cases all PASS: method, basis, engine version, electronic
   state, task, engine, unavailable LOCAL provider and foreign-project structure. They
   assert zero approvals/calculations/jobs/executions/results, proper project/run binding,
   stable diagnostics, HTTP 201 with no crash, and consistent reloaded state.
   Eight injected error-family cases plus one schema case cover typed/domain/argument
   classification and sensitive-detail redaction. These are explicit offline fixtures,
   not scientific engine acceptance.

### Verification receipts and exact commands

Results below overlap; **do not add them into a claimed unique total**. Receipts are
local/ignored under `.chemdft/audits/ai-1-repair-20261017/`.

| Check | Actual result |
| --- | --- |
| A: corrected gateway test alone, after inspecting/fixing binding | PASS 1; zero network attempts |
| B: original method/basis/version cases + initial network guard tests | PASS 11 |
| C: original complete rejection matrix + initial classification/schema regressions | PASS 16 |
| D: focused backend regression across 14 modules | PASS 300; zero failures/errors/skips; live markers excluded |
| Final network/classification/profile/HTTP/proposal subset after preserving typed AI codes and expanding guard | PASS 72; zero failures/errors/skips |
| E: contract/QCSchema tests | PASS 15 |
| Pydantic JSON Schema and generated TypeScript freshness | PASS both; no regeneration needed |
| Schemas TypeScript; working-tree web TypeScript | PASS both |
| F: UI-1 scientific-integrity behavioural tests independently rerun | PASS 45 |
| Review copy, HEAD + explicit AI files: rejection/network regressions | PASS 30 |
| Review copy, AI gateway without the UI-owned FakeModelGateway hunk: gateway, all 8 invalid proposals, SQLite + disposable-PG scoped proposals | PASS 11 |
| Review copy: AI-only schema freshness and HEAD frontend TypeScript | PASS both |
| Review copy: AI + explicit UI file set, own generated schema explicitly mapped | PASS web TypeScript; no missing UI import |
| Scoped Ruff on changed runtime/tests other than legacy conftest issues | PASS |
| Complete conftest Ruff | FAIL: 2 existing E501 + 7 existing E402; HEAD reproduces these plus an import-order issue now corrected |
| Complete working-tree whitespace check | FAIL: existing UI panel whitespace at line 722; repair code/doc scope passes |

```sh
# Common prefix for backend pytest runs (one suite at a time):
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1
nice -n 10 .venv/bin/python -m pytest -q services/api/tests/test_ai_scientist.py::test_openai_compatible_gateway_accepts_null_tool_calls --junitxml=.chemdft/audits/ai-1-repair-20261017/step-a.xml
nice -n 10 .venv/bin/python -m pytest -q services/api/tests/test_offline_network.py 'services/api/tests/test_hosted_ai_proposals.py::test_invalid_or_unsupported_proposal_is_rejected_without_compute[method]' 'services/api/tests/test_hosted_ai_proposals.py::test_invalid_or_unsupported_proposal_is_rejected_without_compute[basis]' 'services/api/tests/test_hosted_ai_proposals.py::test_invalid_or_unsupported_proposal_is_rejected_without_compute[version]' --junitxml=.chemdft/audits/ai-1-repair-20261017/step-b-safety.xml
nice -n 10 .venv/bin/python -m pytest -q services/api/tests/test_hosted_ai_proposals.py -k 'invalid_or_unsupported or rejection_classifies or schema_rejection' --junitxml=.chemdft/audits/ai-1-repair-20261017/step-c.xml
nice -n 10 .venv/bin/python -m pytest -q services/api/tests/test_ai_http_diagnostics.py services/api/tests/test_ai_planning_profiles.py services/api/tests/test_ai_model_catalog.py services/api/tests/test_ai_foundation.py services/api/tests/test_ai_provider_integration.py services/api/tests/test_ai_input_reservation.py services/api/tests/test_ai_prompt_projection.py services/api/tests/test_ai_scientist.py services/api/tests/test_scientific_ai_validation.py services/api/tests/test_tool_registry.py services/api/tests/test_result_firewall.py services/api/tests/test_ai_run_limits.py services/api/tests/test_ai_execution_durability.py services/api/tests/test_hosted_ai_proposals.py -m 'not ai_integration and not scientific_integration and not benchmark' --junitxml=.chemdft/audits/ai-1-repair-20261017/step-d.xml
nice -n 10 .venv/bin/python -m pytest -q services/api/tests/test_offline_network.py services/api/tests/test_hosted_ai_proposals.py services/api/tests/test_ai_planning_profiles.py services/api/tests/test_ai_http_diagnostics.py services/api/tests/test_ai_scientist.py::test_openai_compatible_gateway_accepts_null_tool_calls --junitxml=.chemdft/audits/ai-1-repair-20261017/final-repair.xml
nice -n 10 .venv/bin/python -m pytest -q services/api/tests/test_contracts.py services/api/tests/test_qcschema.py --junitxml=.chemdft/audits/ai-1-repair-20261017/step-e.xml
.venv/bin/python -m chemdft_api.contracts.generate --check
node packages/schemas/scripts/generate-typescript.mjs --check
pnpm --filter @chemdft/schemas typecheck
pnpm --filter @chemdft/web exec tsc --noEmit --incremental false
pnpm --filter @chemdft/web exec vitest run tests/ui-1-scientific-integrity.test.ts --reporter=default --reporter=junit --outputFile=/Users/<name>/Desktop/chemdft/.chemdft/audits/ai-1-repair-20261017/step-f-ui.xml
.venv/bin/ruff check services/api/tests/test_offline_network.py services/api/tests/test_hosted_ai_proposals.py services/api/tests/test_ai_scientist.py services/api/src/chemdft_api/ai/service.py services/api/src/chemdft_api/tool_registry/registry.py --output-format concise
```

The review tree was assembled from `git archive HEAD`, explicit file copies and a source-only
removal of the UI FakeModelGateway branch, with **no Git index, checkout or branch operation**.
Backend commands used the existing absolute `.venv/bin/python`, `PYTHONPATH` pointing to the
review tree's `services/api/src`, the same three thread limits and JUnit receipts above.
`proposed-ai-tree-final.xml` selects the 8 invalid cases, classification/schema cases and
`test_offline_network.py` via `-k 'invalid_or_unsupported or rejection_classifies or
schema_rejection or test_external_dns or test_numeric_addresses or test_real_gateway_transport'`.
`proposed-ai-without-ui-hunk.xml` selects exactly the gateway node, the entire invalid-proposal
function and `test_scoped_h2_proposal_preserves_science_schema_snapshot_and_waits`.
TypeScript used the installed absolute web `tsc --noEmit --incremental false -p apps/web`;
review-only tsconfig mapped `@chemdft/schemas` to its own copied generated.ts. Installed dependencies
were reused; no dependency/weight/image installation or build. Existing Starlette deprecations remain.

### AI-1 / UI-1 integration findings

- `planning_profile` recognizes GENERAL and PYSCF_ENERGY_PROPOSAL; generated `PlanningProfile1`
  matches. UI Ask sends GENERAL/EVIDENCE; scoped Plan sends STANDARD with a saved version;
  the general planner remains an explicit choice. Backend dispatch limits and exact context
  hashes/provenance/geometry, project/user binding and mandatory approval are authoritative.
- `AISettingsView.model_capabilities` and generated `AIModelCapability` match backend contracts.
  Registry rows retain their **2026-10-16 reviewed evidence**, with every
  `proposal_workflow_verified=false`. Historical tool compatibility is separate from hosted
  proposal acceptance, account entitlement and selection. Untested/deprecated models and
  custom endpoints cannot inherit NVIDIA verification. No model/provider was changed.
- Tests verify isolated user settings/credentials, permitted provider/model selection, absent
  silent managed/BYOK/fake fallback, current member permissions, exact approval binding,
  stale/foreign/tampered inputs, worker epochs and prohibition on model-authoritative writes.
  Registry documentation is locally consistent with retained evidence; **current external
  endpoint availability/account rights were not rechecked**, under the offline-only constraint.

### Proposed commits — inventory only, NOT staged or authorized

**Order: A (AI-1 backend + complete generated contracts), then B (UI-1).** No need for
one inseparable product commit: the review copy typechecks with AI-1 and the HEAD frontend,
then with UI-1. UI-1 alone at HEAD lacks planning/model contracts. No approvals, migrations,
credentials, cloud infra or source captures belong in either commit.

**A — minimum complete implementation/test file set (31 paths):** include the current AI-1
and its lower-only limits + provider-aware Navigator prerequisites. Their service/contracts/
budget/generated-schema changes cannot be independently omitted from this proposed snapshot.
For `ai/gateway.py`, select HTTP diagnostics/transport changes only; reserve its separately
reviewed scoped FakeModelGateway branch for B.

```text
services/api/src/chemdft_api/ai/budgets.py
services/api/src/chemdft_api/ai/gateway.py
services/api/src/chemdft_api/ai/http_transport.py
services/api/src/chemdft_api/ai/model_catalog.py
services/api/src/chemdft_api/ai/observability.py
services/api/src/chemdft_api/ai/planning_profiles.py
services/api/src/chemdft_api/ai/providers.py
services/api/src/chemdft_api/ai/service.py
services/api/src/chemdft_api/ai/tool_policy.py
services/api/src/chemdft_api/ai/usage_accounting.py
services/api/src/chemdft_api/contracts/ai.py
services/api/src/chemdft_api/contracts/ai_foundation.py
services/api/src/chemdft_api/contracts/ai_models.py
services/api/src/chemdft_api/contracts/ai_planning.py
services/api/src/chemdft_api/contracts/bundle.py
services/api/src/chemdft_api/navigator/capabilities.py
services/api/src/chemdft_api/navigator/service.py
services/api/src/chemdft_api/tool_registry/registry.py
packages/schemas/generated/chemdft-contracts.schema.json
packages/schemas/src/generated.ts
services/api/tests/conftest.py
services/api/tests/test_ai_foundation.py
services/api/tests/test_ai_input_reservation.py
services/api/tests/test_ai_provider_integration.py
services/api/tests/test_ai_scientist.py
services/api/tests/test_ai_http_diagnostics.py
services/api/tests/test_ai_model_catalog.py
services/api/tests/test_ai_planning_profiles.py
services/api/tests/test_ai_run_limits.py
services/api/tests/test_hosted_ai_proposals.py
services/api/tests/test_offline_network.py
```

The existing unmodified tests imported by these tests are already at HEAD. Canonical docs for
A: this repair/commit-plan section and AI-1 hunks in `NEXT.md`, `docs/14_ROADMAP.md`,
`docs/implementation/CHEMDFT_PROJECT_MEMORY.md`, `docs/implementation/AI_MODEL_GATEWAY.md`,
`docs/TECHNOLOGY_REGISTRY.md`, `DECISIONS.md` and the hosted-provider prerequisite section of
`docs/implementation/AWS_COMPUTE_PROVIDER.md`. Select only relevant evidence; omit unrelated
backup/budget/deployment history. AGENTS/engineering-rules policy edits are separate owner
work, not required code dependencies of A.

**B — minimum complete UI source/test set (30 paths), plus the identified partial files:**

```text
apps/web/src/app/[locale]/projects/[projectId]/workspace/ai-scientist-approval-screen.tsx
apps/web/src/app/[locale]/projects/[projectId]/workspace/ai-scientist-evidence-tab.tsx
apps/web/src/app/[locale]/projects/[projectId]/workspace/ai-scientist-header.tsx
apps/web/src/app/[locale]/projects/[projectId]/workspace/ai-scientist-runs-tab.tsx
apps/web/src/app/[locale]/projects/[projectId]/workspace/ai-scientist-settings-tab.tsx
apps/web/src/app/[locale]/projects/[projectId]/workspace/ai-scientist-status-bar.tsx
apps/web/src/app/[locale]/projects/[projectId]/workspace/ai-scientist-tools-tab.tsx
apps/web/src/app/ai-scientist.css
apps/web/src/lib/ai-evidence-records.ts
apps/web/src/lib/ai-run-timeline.ts
apps/web/src/lib/scientific-labels.ts
apps/web/tests/e2e/ai-composer.ts
apps/web/tests/e2e/ui-1-ai-scientist.spec.ts
apps/web/tests/ui-1-scientific-integrity.test.ts
apps/web/src/app/[locale]/projects/[projectId]/workspace/ai-scientific-workflow.tsx
apps/web/src/app/[locale]/projects/[projectId]/workspace/ai-scientist-panel.tsx
apps/web/src/app/[locale]/projects/[projectId]/workspace/evidence-workspace-panel.tsx
apps/web/src/app/[locale]/projects/[projectId]/workspace/structure-workspace-client.tsx
apps/web/src/app/_components/project-dock.tsx
apps/web/src/app/_components/project-shell.tsx
apps/web/src/app/layout.tsx
apps/web/src/app/shell.css
apps/web/src/lib/ai-scientist-workflow.ts
apps/web/tests/e2e-ai-foundation/foundation.spec.ts
apps/web/tests/e2e/ai-molecule-creator.spec.ts
apps/web/tests/e2e/ai-scientist.spec.ts
apps/web/tests/e2e/approval-geometry-offline.spec.ts
apps/web/tests/e2e/as-c1-nvidia-acceptance.spec.ts
apps/web/tests/e2e/batch-b4-scientist-flow.spec.ts
apps/web/tests/e2e/batch-b42-calculation-execution.spec.ts
```

Additional partial paths for B:

| File | Selected change; preserve other hunks |
| --- | --- |
| `services/api/src/chemdft_api/ai/gateway.py` | Only scoped FakeModelGateway branch; explicitly test/dev support, not a hosted provider result |
| `tools/run_isolated_e2e.py` | UI suite registration + disabled-worker rule, adapted to the committed expression; do not select the 556-line mixed harness rewrite |
| `apps/web/playwright.isolated.config.ts` | UI suite registration + disabled-worker guard; keep other AS-C1/geometry registrations and workspace-root rewrite separate |
| `DESIGN.md` | Four ai color-token lines + AI Scientist workstation-token prose; omit unrelated badge/radius additions |
| `NEXT.md`, `docs/14_ROADMAP.md`, `docs/implementation/CHEMDFT_PROJECT_MEMORY.md` | UI-1 Pass 4/integration evidence only; preserve history and unrelated operating-state notes |

A review-only `ui-harness-minimal.patch` under the ignored audit directory demonstrates the
minimal two-file registration against HEAD (Python syntax checked). It was **not applied to
working files or an index**, and its browser runtime was **NOT RUN**. Current Pass 4 browser
receipts exercised the larger pre-existing hardened harness; they cannot be attributed to this
minimal patch. Keep the unrelated harness hardening as a separate owner-reviewed change, or
explicitly approve including its required infrastructure-neutral hunks and reverify that exact
assembled browser state. This does not block product/schema compilation. No broad path adds.
Both generated files belong to A as deterministic complete outputs; check/regenerate against
only A's assembled contracts rather than hand-selecting generated alias-renumbering hunks.

**Excluded/preserved:** every `infra/aws/*` change; `.claude/`, `.mcp.json`, root standalone
reports, `ChemDFT_Approved_UI_References.zip`, `apps/web/next-env.d.ts`, preview-only
`apps/web/tools/*`, ignored captures/audits/critique, environment/credential files, temporary
review trees and unrelated AGENTS/rules/architecture/operational hunks. No changes were discarded.

### This repair's actual file changes and preservation check

Changed exactly these 10 paths (the larger A/B inventory above describes existing mixed work too):

```text
services/api/src/chemdft_api/ai/service.py
services/api/src/chemdft_api/tool_registry/registry.py
services/api/tests/conftest.py
services/api/tests/test_ai_scientist.py
services/api/tests/test_hosted_ai_proposals.py
services/api/tests/test_offline_network.py
NEXT.md
docs/14_ROADMAP.md
docs/implementation/AI_MODEL_GATEWAY.md
docs/implementation/CHEMDFT_PROJECT_MEMORY.md
```

Before/after fingerprint audit: **87 → 91** modified/untracked individual files;
81 pre-existing changed/untracked files remain byte-identical, six were intentionally extended
or repaired, three previously clean tracked files changed, one new test file, zero deleted.
All UI source/test/config files and all infrastructure changes remain byte-identical to the
start of this task. Branch/HEAD unchanged; index empty. Repair-scope whitespace and Ruff PASS
(conftest's nine reproduced legacy diagnostics excluded only for the scoped new-code check).
Before/after hashes/status and JUnit receipts are in the ignored audit directory, not a new
permanent status registry. No source capture or credential is proposed for a commit.

### Remaining limits and next action

- **PASS:** both backend defects repaired, focused offline regressions and contract/UI compatibility.
- **FAIL (pre-existing, not repaired here):** nine legacy conftest lint diagnostics; whole-tree
  whitespace in UI panel; prior browser `ai-molecule-creator` 12-versus-17 event expectation.
  The latter is present at HEAD and aligns with the prior report's extra `identity.resolved` /
  generic `tool.executed` emissions; browser behaviour/event count was not independently rerun.
- **BLOCKED:** B4 browser fixture uses cwd-relative `.venv`/tool paths absent in the copied workspace
  (confirmed in HEAD source); no application execution was attempted here.
- **NOT RUN:** full backend suite, full 782-test frontend rerun, new browser/visual critique,
  browser acceptance of the proposed partial harness, hosted inference, live model discovery,
  native scientific engines/calculations, cloud tests/deployments and release acceptance.
  Opus's Pass 4 782/frontend, 45/UI and browser reports stay historical except for the 45
  independently rerun behavioural checks. No UI was modified; Impeccable was not rerun or claimed.
- Owner may review the explicit A/B inventories and mixed-file selections, then separately
  authorize staging/committing. Recheck HEAD/status and reviewed diffs at that time. No hosted
  verification or release approval is implied; live/provider/scientific permissions remain gated.

## DRAW mode — typed drawing commands (2026-11-02, offline + local live acceptance; hosted NOT run)

New AI mode on its own route (`POST /v1/projects/{id}/ai/conversations/{cid}/draw`), same gateway, STANDARD tier (`nvidia/nemotron-3.5-lightning-30b-a3b` in the local run), `direct_answer=True`, no tools, ≤2048 output tokens, at most two model calls per request (original + one repair), reserved and settled per call through `_reserve_model_request` / `settle_model_usage`, usage rows with `prompt_version = CHEMDFT_DRAW_MODE_V1`. **No new provider or model.** The output is JSON validated against a closed op schema; RDKit applies it. Property/energy/citation requests are refused before any model call. Details, live log and limits: [AI_SCIENTIST_DRAW_MODE.md](AI_SCIENTIST_DRAW_MODE.md).

Contract change (2026-11-02, second pass): `DrawResponse` gains `reference_check` (`DrawReferenceCheck`: name, formula, note) when a plain "draw <name>" request matched the built-in reference table (partial safeguard, listed names only). No new route, provider or model; the live gateway budget approved for this feature (40 calls) is fully used.
