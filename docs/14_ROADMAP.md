# Roadmap

Roadmap changes require documented justification in DECISIONS.md and the affected source-of-truth documents.

**Evidence clarification, 2026-10-14:** phase descriptions are intended scope,
not proof of operational support. Scientific engine readiness
and project memory record current
verified, blocked and planned capabilities. This synchronization changes no
historical ADR or cloud-provider selection; justification is appended in
DECISIONS.md.

## Phase -1 — Architecture and permanent memory

Architecture blueprint, permanent engineering/scientific rules, licensing triage, threat model, ADRs, roadmap, and repository/Obsidian memory. **Status: complete.**

Permanent technology selection now consults TECHNOLOGY_REGISTRY.md.
The 2026-10-15 inventory distinguishes approved candidates, installed packages,
implementation, retained local execution evidence and cloud readiness. This adds
no execution/deployment authorization and supersedes no historical ADR.

## Phase 0 — Product Definition and UX

Define product requirements, personas, critical workflows, information architecture, workspace behavior, manual/AI control boundaries, Blueprint.js-based ChemDFT design system, accessibility/responsive expectations, and Impeccable anti-slop review criteria. **Status: complete.**

## Phase 1 — Repository and application foundation

Create the Next.js/TypeScript and Python/FastAPI foundation, database, authentication/authorization, tenancy, projects, files/object storage, CI, observability baseline, and i18n routing. Record exact dependency licenses and lockfiles. **Status: complete.**

## Phase 2 — Scientific Data Model and Tool Registry

Implement versioned scientific/domain schemas, QCSchema-compatible contracts, provenance primitives, Scientific Result Firewall write paths, typed Tool Registry, transport adapters, permissions, and audit events.

**Status: complete.** REST remains the existing thin Phase 1 adapter; Tool Registry is the second transport-neutral invocation path. WebMCP/MCP transport adapters remain correctly scheduled for Phase 12.

## Phase 3 — Molecule and crystal workspace

Integrate Ketcher and RDKit, molecular imports/exports, StructureVersion/variants, 3D coordinates/constraints, and initial pymatgen/ASE periodic/CIF workflows.

## Phase 4 — Visualization

Deliver renderer-neutral ScientificScene, 3Dmol.js reference view, Three.js Studio renderer, actual orbital/density/ESP surfaces, vibrational vectors, linked selection, and publication exports.

## Phase 5 — Core compute

Integrate isolated xTB, CREST, PySCF, Psi4, QCEngine adapters; reproducible inputs/artifacts; parser/firewall validation; workflows; scientific smoke and benchmark suites. Evaluate QCFractal/QCArchive against the simpler queue criteria.

**Current evidence:** PySCF, xTB and bounded patched CREST are locally verified
end-to-end. Psi4 has genuine historical native/Gateway/Firewall evidence and a
verified installed prefix, but is currently unconfigured for new runs. QCEngine
orchestration is not operational; QCSchema interchange/package installation is
not equivalent to integration. No engine is certified production-ready.

## Phase 6 — Compute Gateway

Implement Modal CPU/GPU providers, GPU4PySCF capability paths, durable queueing, estimates, reservations, approvals, metering, cancellation, deterministic budgets, isolation, and operational controls. Prepare RunPod adapter contract.

**Status 2026-10-25 (supersedes the AWS statements in the two paragraphs below):** on-demand AWS EC2 PySCF is
verified on the hosted beta (H2 HF/STO-3G, 2026-10-18/19; worker starts for an approved job and powers off when
idle); see NEXT.md. Modal and GPU execution remain not operational.

**To be built later (owner, 2026-11-13):** Psi4, DFT-D4 and GPU4PySCF stay on the roadmap; they are shown as Not available on the home page (no Linux Psi4 build, DFT-D4 needs a Psi4 energy, GPU4PySCF has no program to drive). No schedule.

**Current evidence (2026-10-14):** local Compute Gateway workflows are verified. GPU4PySCF is
unavailable; Modal and AWS/cloud CPU/GPU execution are not operational. AWS is a
planned future target, not a deployed adapter or an ADR-009 supersession. Hard
worker isolation/quotas, remote identity, artifact transfer and cloud pricing/recovery
acceptance remain incomplete. New live tests are blocked below 12 GiB free disk;
the last audit observed approximately 9.5 GiB. Recheck before any authorized run.

**AWS pilot status, 2026-10-15 (supersedes the earlier 40-test/35-hour wording):** EC2/Docker
CPU configuration, IAM/SSM and layered shutdown guards are prepared and offline-tested (81
tests, cfn-lint clean); **BLOCKED, nothing provisioned**. us-east-1, stack `chemdft-ec2-pilot`,
`m7i-flex.large`, encrypted 40 GiB gp3, initial ceiling 25 hours (24 reserved), planning estimate
about $7.38/month (an estimate; Budgets are alerts, not caps). A dedicated ChemDFT identity,
account-level verification, AMI/image pins and Linux PySCF/xTB acceptance remain pending; Linux
CREST Firewall acceptance is blocked. AWS is the primary cloud ([ADR-042](adr/ADR-042-aws-primary-cloud-and-deferred-huggingface.md));
this uses the local provider on EC2 and preserves ADR-009's Modal-first decision as historical.
See deployment gate and
registry cost/network policy.

## Phase 7 — Experimental data

Implement immutable import and deterministic analysis/versioning for FTIR, NMR, HRMS, XRD, UV–Vis, TG/DTA/DLS and related formats incrementally; enable calculated-versus-experimental comparison and linked visualization.

## Phase 8 — AI Scientist

Implement provider-independent Model Gateway, planner/explainer, typed tool calls, permissions/approvals, bounded workflows, authoritative-state UI, and adversarial firewall/tool-use evaluation.

## Phase 9 — RAG and project memory

Implement secure PDF/document ingestion, citations/evidence, semantic + structured + project-history retrieval, literature integrations, user corrections, conflicts, and provenance-aware project memory.

## Phase 10 — Agentic scientific workflows

Add robust multi-step candidate generation, ranking, selection, comparison, resumability, checkpoints, human review, and reproducible workflow templates with explicit budget/scientific criteria.

## Phase 11 — Billing and AI economics

Implement Stripe subscriptions, platform entitlements, separate AI/compute usage ledgers, managed AI, BYOK secret management, allowances/overages, invoices/disclosures, reconciliation, and abuse controls.

**Status: BLOCKED, not complete.** Offline foundations and durable accounting are
implemented; payments/subscriptions remain disabled and no payment-provider
activation is authorized. Production KMS/Vault, payment integration, managed tariffs,
provider receipt/price reconciliation and reliable full-input token reservations
remain gates. A successful NVIDIA scientific experiment does not complete Phase 11.

## Phase 12 — Interoperability and BYOC/HPC

Expose appropriate typed actions through stable REST/API, progressive WebMCP, server-side MCP, and secure BYOC/HPC/SLURM foundations. Add enterprise model/compute providers as justified.

## Phase 13 — Validation, hardening, and production

Complete scientific benchmarks and reproducibility claims, security/privacy review, tenant and worker isolation testing, incident/backup/recovery drills, performance/accessibility, licensing sign-off, production deployment, and operational runbooks.

## Cross-phase gates

Every phase begins with repository health review and ends with tests/evidence proportional to risk, updated architecture/ADRs when intentionally changed, and an accurate NEXT.md. No phase may bypass provenance, the Scientific Result Firewall, permission policy, or deterministic budget controls.

## Cross-phase feature — Scientific Citation & Attribution (PLANNED)

Approved scope: Cite ChemDFT, Cite this Calculation, one-click copying, BibTeX/RIS,
selected journal styles, evidence-backed Methods, reproducibility exports, engine
attribution, official CITATION.cff and public How to Cite page; future consent-based
ORCID and separately authorized Zenodo/DOI registration. Existing evidence-source
citations are distinct from these unimplemented software/calculation exports.

Keep phase numbering: software identity in -1/13; citation/evidence contracts in
9; export/interoperability in 12; Methods/reproducibility/privacy/publication gates
in 13, drawing on validated Phase 5 inputs/results. The six approved candidate
repositories and their maintenance/licensing/compatibility findings are recorded
once in the registry.
No dependency is installed or feature marked complete by this roadmap update.
Researchers retain ownership; software attribution grants no automatic authorship.
Private immutable records are not public DOIs. Never invent citations, identifiers,
versions or scientific values, or publish private data without consent.

## Historical development priorities — 2026-10-15 (priorities, NOT replacement phases)

Strategy: **working product first, new capabilities second.** These letters order the
current work across the existing phases; no phase is renumbered, added or retired, and
none authorizes deployment, spending or activation. Each item still needs the researcher's
explicit approval before any cloud, paid-provider or scientific execution step.

| Priority | Work | Phases touched | Gate |
| --- | --- | --- | --- |
| A | Complete AWS security and deployment gates: dedicated ChemDFT identity, Access Analyzer/simulator, AMI and base-image review, Lambda quota, tag/bootstrap review, change set | 6, 13 | deployment gate |
| B | Deploy the first authorized private scientific worker | 6 | A closed; user approval |
| C | Validate real PySCF and xTB calculations on Linux (CREST stays blocked) | 5, 6 | acceptance plan; B |
| D | Validate host shutdown, secret retrieval, cost attribution and provenance on the real host | 6, 13 | B, C |
| E | One authorized, supervised NVIDIA usage test (INPUT_RESERVATION_V2 versus provider-reported usage) | 8, 11 | procedure; personal approval |
| F | Researcher-facing workflows, scientific visualization and reliability | 3, 4, 7, 8, 10 | repository health review |
| G | Scientific citation and attribution system (**PLANNED**) | -1, 9, 12, 13 | no dependency installed; owner-confirmed metadata first |
| H | Evaluate the five deferred Hugging Face models (**DEFERRED**) | 5, 9, 10 | only after F is stable; per-model prerequisites in the registry |
| I | Evaluate Hugging Face compute as an AWS backup (**DEFERRED**) | 6 | verify entitlements, persistence, privacy, license, cost first |

Production readiness for public researchers (security, scientific and operational
verification, tenant isolation, licensing sign-off) is Phase 13 work. Production billing,
ORCID link/sign-in is implemented (release 0.0.6/0.0.7; live link and sign-in passed once on production, see ADR-044 for what is not verified); public signup and ORCID enablement are **not** activated merely because they appear on the
roadmap.

## Approved continuation — 2026-10-16

This is the current cross-phase task index, not a second implementation/status registry.
NEXT.md owns the latest handoff; linked source/tests are the evidence. Older phase/deployment
annotations above are historical. **IMPLEMENTED** means code exists; **TESTED** names actual offline
checks; **VERIFIED ON HOSTED ENVIRONMENT** requires retained hosted evidence. Unchecked work is open,
even when a related implementation exists. No deployment/live model/science/payment approval implied.

### AI-1 — request efficiency and model reliability

- [ ] **AI-1.1 · P0 · Phases8/10/11 — NVIDIA request and recovery correction.** Status: typed two-tool
  ENERGY profile/dispatch/resume and durable phased HTTP diagnostics IMPLEMENTED and offline TESTED;
  100 targeted checks PASS, no skips, including disposable local PostgreSQL; final combined evidence
  180 unique checks including catalogue/late diagnostics/approvals, no skips. Fixture reservation
  27,004→16,103 (-40.4%). NOT DEPLOYED/HOSTED VERIFIED. Dependencies: typed Tool Registry,
  ProductContext snapshots, ADR-041 budgets/receipts.
  Acceptance: deterministic task profile selects only needed complete schemas; exact geometry,
  hashes/provenance/authority, safety and approval preserved; scoped tools enforced at dispatch;
  no redundant policy catalogue; measure full request before reservation; timeout remains60s.
  Distinguish connection/read/network/DNS/TLS/HTTP/malformed-output/tool/scientific errors with
  redacted status/phase/duration/retry eligibility and separate actual/estimated usage. No fallback,
  silent switching, unknown-as-zero or duplicate submissions. Evidence/tests:
  [diagnosis](implementation/AI_MODEL_GATEWAY.md), focused gateway/context/accounting/approval checks.
  Blocker: hosted proposal acceptance FAIL/timeout, supplier cause UNKNOWN. Next: UI-1 explicit profile
  integration, separate deploy/live approval (one Lightning H2 call,20k reservation/2,048 out).
- [ ] **AI-1.2 · P1 · Phases8/10/11 — model registry, equivalent benchmarks and Kimi.** Status:
  typed9-entry registry and settings exposure/selection gate IMPLEMENTED/offline TESTED;77 focused
  catalogue/foundation checks PASS. Lightning configured/historical live tool selection only, not
  successful proposal acceptance; other models non-selectable CANDIDATES/deprecated/unconfigured.
  Dependencies: AI-1.1, official current docs, isolated preferences and exact provider/model receipts.
  Acceptance: DOCUMENTED/CONFIGURED/LIVE-VERIFIED/UNAVAILABLE/UNSUPPORTED distinct; exact model IDs,
  tool/structured/stream/reasoning/context/limits/terms requirements recorded; unverified models cannot
  be selected as operational. Benchmark identical H2 geometry/PySCF HF/STO-3G/0/1 and permissions;
  score schema/science/approval/safety/duplicates, latency/timeouts/tokens and only verifiable costs.
  Evidence/tests: offline compatibility fixtures + separately approved retained live receipts.
  Blockers: no live benchmark authorization, account access/price/terms may be UNKNOWN; V4/Kimi free
  routes deprecated, current K2.6 catalogue unresolved. Next: UI-1 truthful selector and separately
  approved same-model one-call test; evaluate further candidates only after adapter compatibility.
  Direct Moonshot remains an unconfigured independent candidate, no purchase/key and no fallback.

**2026-10-17 offline repair gate:** AI-1 network-test leak and proposal-rejection crash
corrected and regression-verified; initial focused backend300 PASS, final related subset72
PASS, contract15 PASS, schemas/web TypeScript PASS and UI-1 behavioural45 PASS (overlap).
AI-1 backend/schema → UI-1 separate commit order validated in source review copies; no
staging/commit/hosted/native acceptance. Selective-file inventory and remaining harness/
lint limits are in [the canonical handoff](implementation/AI_MODEL_GATEWAY.md#ai-1-backend-repair-and-ui-1-commit-boundary--2026-10-17-offline).

### UI-1 — AI Scientist workstation

- [ ] **UI-1.1 · P0 · Phases3/4/8/10 — five-view approved redesign.** Status: references APPROVED;
  current panel IMPLEMENTED, replacement NOT IMPLEMENTED/NOT HOSTED VERIFIED. Dependencies: existing
  Blueprint/tokens, actual backend records/capabilities, AI-1 registry. Acceptance: resizable,
  expandable responsive keyboard-accessible right panel, Chat/Tools/Evidence/Runs/Settings; fixed
  composer, actual pending proposal controls, functional searchable/filterable compact icon tool rows
  and detail actions. Real source/citation/provenance inspection; distinguish planning, jobs and
  verified results; settings persist only supported options, cannot weaken mandatory safety.
  Preserve navigation/scientific functions. No mock literature/energies/progress/prices/configured badges,
  dead controls or claims that unintegrated web search/ORCA/Gaussian are operational. Evidence/tests:
  targeted components/TS, desktop+compact/mobile browser captures compared to the five reference PNGs.
  Blocker: pending owner choice required by installed Impeccable Codex critique gate (dual agents or
  labelled single-context fallback); no UI redesign/captures claimed. Next: resolve choice, critique
  of incumbent + references, implement approved layout with truthful data, bounded polish/visual check.
  **Update 2026-10-16 (Opus verification):** five-view panel IMPLEMENTED locally (uncommitted, NOT
  HOSTED VERIFIED); truthful data paths corrected (capability-driven Tools, per-message planning profile,
  server model settings with Chat refresh, firewall-gated Runs, recorded evidence states). LOCAL BACKEND
  INTEGRATION browser suite `ui-1-ai-scientist` PASS (fake planning, worker disabled). Remaining: run
  history beyond the active conversation needs a list-runs API decision; hosted acceptance not run.
  **Update 2026-10-17 (owner-approved 1A/2A/3B):** dedicated approval screen, two-mode composer with one
  send button, single status bar, researcher-facing labels, ≤760 px bottom sheet, conversation run history
  with stated coverage limits (no new endpoint). Browser suites `ui-1-ai-scientist` and
  `approval-geometry-offline` PASS offline; Impeccable dual-agent re-critique 25/40 with its P0/P1 fixed.
  Not committed, not hosted-verified.
  **Update 2026-10-17 (pass 4, desktop-first):** Plan prerequisite (no silent downgrade) with explicit general-
  planner opt-in; pending composer reduced to one row with confirmed Stop; approval decision context (request,
  compute preference, estimate, expiry); stable proportional dock width; workstation tokens/header/Tools registry.
  LOCAL BROWSER VERIFIED at 1920/1440/1366/390 incl. rejection and approval with the worker disabled. Not
  committed (depends on uncommitted AI-1 contracts), not hosted-verified.
- [ ] **UI-1.2 · P0 · all UI phases — mandatory Impeccable standards.** Status: skill4.1.3 installed;
  permanent rule IMPLEMENTED in AGENTS/DECISIONS/engineering rules, design checks not yet claimed.
  Dependencies: each touched surface's current design standards and approved visual reference.
  Acceptance: record real audit/critique, typography/layout/spacing/alignment, accessible names/focus/
  contrast/keyboard, responsive modes, error/empty states and final visual polish. Blueprint preserved.
  Evidence/tests: named Impeccable checks and focused browser screenshots, no needless builds/reinstall.
  Blocker: per-surface evidence cannot precede implementation. Next: execute for UI-1.1 and every future UI edit.
  **Update 2026-10-16:** UI-1.1 axe WCAG A/AA scan 0 violations on all five tabs in the real app;
  focus-visible, ARIA tabs/radio keyboard patterns and dialog focus handling added; class audit found and
  fixed ~100 unstyled classes. The earlier 35/40 critique is not accepted as dual-agent evidence; the
  re-run record is in `.impeccable/critique/` and `.chemdft/audits/ui-1-verification-20261016/`.
  **Update 2026-10-17 (pass 4):** final gate = genuine dual-agent critique 24/40 (detector 0 static findings),
  its P1/P2 findings fixed and browser-verified afterwards; axe A/AA 0 on every tab, approval screen and sheet.

**Local commit checkpoint 2026-10-17:** AI-1 `98593b196e24` is committed first; UI-1 follows in
this local commit. Exact staged backend108 / UI behavioural45 and contract/TypeScript/lint
checks PASS. Hosted acceptance stays open. Review the remaining offline harness/E2E gaps
before separately requesting push or deployment; no live model/scientific run is authorized.

### SCI-1 — hosted scientific acceptance

- [ ] **SCI-1.1 · P0 · Phases5/6/8/10/13 — browser-to-AWS PySCF.** Status: provider/proposal gates
  IMPLEMENTED/targeted TESTED; complete hosted chain NOT VERIFIED. Dependencies: AI-1 genuine valid
  pending proposal, explicit human approval and separately authorized bounded scientific compute session.
  Acceptance: browser → model plan → typed proposal → human approval → AWS engine → parser → Result
  Firewall → immutable provenance/artifacts → verified visualization → saved-result reopening.
  No AI-created energies/citations, duplicate jobs or execution without approval. Evidence/tests:
  existing engine/provider/approval checks + future actual hosted native artifacts/reference comparison.
  Blockers: no scientific-start/run authorization, stopped pilot, live proposal FAIL. Next: finish AI-1;
  prepare Phase I only, keep scientific EC2 STOPPED until separately approved.
- [ ] **SCI-1.2 · P1 · Phases5/13 — CREST and recovery of real results.** Status: local CREST evidence
  exists with two unresolved integration failures; isolated DB/pgvector/input-artifact recovery PASS,
  actual hosted scientific-result recovery NOT VERIFIED. Dependencies: retained native fixtures and
  future SCI-1 result. Acceptance: diagnose CREST failures without weakening criteria; recover a genuine
  result with all hashes/provenance/associations into isolated storage, no production overwrite.
  Evidence/tests: focused CREST tests only when safe/authorized; existing Phase G receipts, future
  result-bearing recovery drill. Blockers: scientific result not yet available/engine test scope.
  Next: preserve the known failures, plan result-bearing recovery after SCI-1.1.

### BETA-1 — researchers, isolation and release readiness

- [ ] **BETA-1.1 · P0 · Phases1/11/13 — isolation, privacy and costs.** Status: authentication,
  quotas and accounting IMPLEMENTED/targeted TESTED; comprehensive hosted multi-user acceptance open.
  Dependencies: distinct authorized test accounts, private object storage, provider service rights.
  Acceptance: user/project boundaries for conversations/preferences/tools/evidence/results/exports;
  safe research-file handling, no sensitive provider payload/logging leaks; reservations/actual usage/
  UNKNOWN costs separated, finite quotas and no hidden retries/fallback. NVIDIA trial rights reviewed
  before external researcher use; no automatic paid upgrade. Evidence/tests: existing adversarial
  isolation/accounting checks + separately approved two-user hosted checks. Blockers: account/service
  approval, supplier prices/access UNKNOWN, trial terms exclude production. Next: offline isolation
  regressions for touched paths and list exact hosted verification/terms decisions required.
- [ ] **BETA-1.2 · P1 · Phases6/13 — backup, monitoring, onboarding and release quality.** Status:
  Phase G first manual/scheduled backup + isolated recovery VERIFIED ON HOSTED ENVIRONMENT; Phase H
  existing budget correction verified, Component attribution pending. Founder login works; researcher
  onboarding/release readiness open. Dependencies: NEXT/runbook evidence, SCI-1 acceptance, PR#1 review.
  Acceptance: protect genuine results/backups, verify retention and scheduled checks without duplicate
  tasks, clear invited-researcher onboarding, focused CI/lint and security/licensing review, Draft PR#1
  remains unmerged until owner approval. Evidence/tests: Phase G/H receipts, focused onboarding/CI checks.
  Blockers: Component billing discovery, result-bearing recovery, existing lint/CI gaps and CREST failures.
  Next: carry completed operational evidence forward; do not repeat successful backup work or deploy.

### RAG-2 — source-grounded scientific retrieval

- [ ] **RAG-2.1 · P1 · Phases7/9/13 — literature ingestion and retrieval evaluation.** Status:
  project-scoped RAG IMPLEMENTED/live owner evidence; external literature/web integration and NVIDIA
  embedding/reranker/document-tool evaluation open. Dependencies: source rights/privacy, existing
  pgvector hybrid retrieval, scientific QREL methodology and retained licensed corpus.
  Acceptance: compare ingestion/chunking/retrieval/reranking against fixed QRELs, enforce tenant scope,
  immutable source hashes/passages/citation references, no fabricated DOI/references, no unsupported
  absence claims. Do not replace pgvector or provision GPUs without benchmark justification/approval.
  Evidence/tests: offline retrieval/citation/isolation/QREL tests and later separately approved provider
  evaluation. Blockers: candidate documentation/access/terms and no live call authorization. Next:
  document NVIDIA candidates and a comparable bounded evaluation plan; keep external search truthful.

Coverage of the12 owner-approved areas: hosted workflows→SCI-1.1; multi-model reliability→AI-1.1/2;
AI UX→UI-1.1; literature RAG→RAG-2.1; provider recovery→AI-1.1; hosted isolation→BETA-1.1;
backup/recovery→SCI-1.2/BETA-1.2; onboarding→BETA-1.2; GitHub/CI/release→BETA-1.2;
usage/quotas/costs→AI-1/BETA-1.1; research privacy/terms→BETA-1.1/RAG-2.1;
mandatory design standards→UI-1.2. These mappings reference existing work rather than duplicating tasks.
