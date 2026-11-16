---
title: ChemDFT — AI Scientist Product Vision and Architecture Decisions
created: 2026-10-12
status: Approved product principles; proposed technical implementation pending AS-0 architecture review
project: ChemDFT
tags:
  - chemdft
  - ai-scientist
  - rag
  - product-decisions
  - researcher-workstation
---

# ChemDFT — AI Scientist Product Vision and Architecture Decisions

> **Source of truth:** ChemDFT repository Markdown, viewed through Obsidian. Intended vault path: `/Users/<name>/Desktop/chemdft/docs/20_AI_SCIENTIST_PRODUCT_VISION.md`.
>
> **Decision context:** RW-3.2 researcher UX was accepted from a product perspective on 2026-10-12. Implementation had not yet been checkpointed/activated when these decisions were discussed. AI Scientist and RAG have **not** been implemented. This note records approved product behavior and architecture recommendations, not implemented functionality.

## Product objective — APPROVED

ChemDFT will evolve from a browser-first computational chemistry workstation into a genuine **AI Scientist** capable of planning, executing, inspecting and documenting multi-step computational research. It must retain its existing deterministic scientific engines, provenance, permissions and manual Guided/Advanced modes.

**Principles:**

1. **Act, don't just chat.** The AI creates real molecular objects, prepares scientifically valid workflows, opens actual viewers, retrieves evidence, and operates ChemDFT through authorized, typed application services.
2. **Ask only when necessary.** Make transparent, low-risk defaults; request clarification for ambiguous chemical identity, stereochemistry, variable groups, poor-quality PDF diagrams and other consequential uncertainties.
3. **Show everything meaningful.** The user sees stepwise progress, actual objects appearing in the workspace, sources, statuses, actions and outcomes; can inspect or intervene in the workflow.
4. **Keep the researcher in control.** Low-risk draft creation and view navigation can be automatic. Scientific job submission, irreversible changes, external data transfers and significant compute require appropriate authorization.
5. **Never fabricate science.** All geometry, energies, spectroscopy and numerical values come from deterministic tools or clearly cited external evidence. LLM interpretations/hypotheses are explicitly distinct from computed results.

## Supported user journeys — APPROVED goals, not yet implemented

### A. Text-to-molecules

Example request: “Create methane, ethane and benzene, generate their 3D structures, and show them side-by-side.”

- Parse named targets; identify chemical identity with trusted chemistry tools/catalogue records rather than guessing formulas.
- Produce validated representations and deterministic, labeled **generated 3D coordinates** (e.g., RDKit-based conformer generation).
- Display creation progress in the UI, populate molecule cards and 3D views, and let the researcher rotate/edit each molecule.
- Save to the project only according to the approved save policy; don't conflate new molecule with a structure version.
- Distinguish generated coordinates from engine-optimized geometries and experimental coordinates.

### B. Scientific PDF-to-molecules

Example: “Read this paper; identify the molecules and generate their 3D structures.”

- Ingest the PDF; preserve source/document/page/table/figure pointers and parsing provenance.
- Extract candidate mentions, formulas, identifiers, tables and chemical drawings using appropriate text parsing and chemical optical structure recognition as needed.
- **Do not claim all PDF diagrams can be recovered reliably.** Mark confidence, ambiguities, unresolved substituents, undefined stereochemistry, metal coordination uncertainty and incomplete molecular definitions.
- Resolve exact identities when supported; surface ambiguous candidates for user review, including Ketcher editing where helpful.
- Only then generate chemically validated 3D drafts and open them in ChemDFT.
- Separate “mentioned in the paper,” “depicted in a figure,” “inferred identity,” and “computed in ChemDFT.”

### C. Full research investigation

Example: “Create benzene, optimize its geometry, compute orbitals with an eligible method, compare prior results, and prepare an evidence-backed report.”

- Plan using the real ChemDFT capabilities catalogue; display actual engine/method/basis/geometry/charge/spin settings and limitations.
- Ask for calculation approval and enforce project/tenant permissions, session budget, job limits and scientific validation.
- Submit jobs to existing native workers (PySCF, Psi4, xTB, CREST, DFT-D4 where scientifically appropriate), and display authentic job status and persisted results.
- Analyze with deterministic result comparison and existing orbital, density, ESP, spectrum and conformer viewers **only when actual supported data exists**.
- Produce cited reports with truthful scientific standing and reproducibility classifications.
- Offer follow-up experiments as proposals, not unauthorized execution.

## Visible AI interaction and workstation UI — APPROVED

### Not browser-click automation

The AI Scientist **does not need to move a mouse or simulate DOM clicks**. It invokes authorized typed backend/application tools; successful state transitions emit structured events to the frontend. ChemDFT opens/highlights the relevant project, editor, calculation, job or result and renders the actual updated scientific object. This is much faster and less fragile than screenshot-based browser automation.

### What users should see

- **Research activity timeline:** `proposed → validating → running → complete / blocked / needs input / failed` with inspectable tool results and links to objects.
- **Visible editing:** molecular cards and 3D views populate as structures are created; viewers show authentic geometry and evidence labels. Optional animations/highlights may communicate completed actions; never imply a click or result that did not happen.
- **Follow AI / Stay Here:** Follow mode automatically opens relevant panels; Stay Here preserves the user's current workspace while background-safe activities update the timeline. The AI must not forcibly steal focus while the user is editing.
- **Clarification cards:** ask specific questions inline and resume the paused workflow after a valid answer. Preserve state across reconnects and browser refreshes.
- **Approval cards:** show exact job specifications, permissions, estimated compute/token cost where estimable, and hard budgets before execution.
- **Manual collaboration:** researcher can stop, inspect, take over or edit an authorized step.

### Modes

1. **Manual Workbench:** existing Guided/Advanced workflows remain available with no AI dependency.
2. **AI Copilot:** contextual scientific Q&A and suggested actions in the current project/workspace.
3. **Autonomous Research:** durable, bounded multi-step research missions with plan review, staged authorization, timeline and evidence log.

The AI should be a first-class workstation capability, not merely a chat bubble. Preserve Blueprint.js and the accepted custom scientific-workstation visual language; don't replace Ketcher or scientific visualization engines.

## LLM connection and token/cost architecture — RECOMMENDED, not yet selected

### Data flow

`Researcher UI → authenticated ChemDFT backend → provider-independent LLM adapter/gateway → hosted LLM API → structured tool proposal → ChemDFT permission/science checks → deterministic chemical tools + scientific workers → persisted evidence and UI events`

- Provider API credentials live **only on trusted servers / secret storage**; never ship platform keys to the browser or expose them in logs, screenshots, archives or model prompts.
- Initially evaluate at least one **economical tool-capable model** and a separate **stronger reasoning model**. Candidate providers include OpenAI, Google Gemini and Anthropic; choose by ChemDFT-specific scientific/tool-use evaluations, latency, price, availability and privacy terms, rather than popularity.
- Start with narrowly scoped direct provider adapters; evaluate a unified gateway (e.g., LiteLLM or Vercel AI Gateway) only if its operational cost, dependencies and security are justified. Pin and audit third-party dependencies.
- Separate models for extraction/classification, retrieval/reranking, research planning and explanation **only if evaluations show a benefit**. Deterministic RDKit/geometries and scientific engines require no LLM tokens by themselves.
- Model usage consumes input/output tokens, potentially cached tokens and sometimes vision/document/tool-related fees. Multi-step agents can make multiple requests and cost more than one chat turn.
- ChatGPT/Claude consumer subscriptions do not automatically cover ChemDFT's backend API traffic. Billing depends on the provider account and API plan.
- Cost controls: per-user/per-project/session budgets; maximum tool/LLM steps; allowed-model lists; rate limits; caching; compact context retrieval; spend monitoring; early stop when evidence is sufficient; compute budget distinct from token budget.
- Consider **platform-managed API** for initial private beta (ChemDFT operator pays and meters usage), and optional **bring-your-own API key** for suitable research/institution plans later (securely stored and isolated). Institutional local/on-prem endpoints may be supported later.
- Treat provider response as an untrusted proposal; schema validation and authorization are enforced by ChemDFT, including for model-suggested tool arguments.

### Streaming and durability

- Stream user-facing text and structured agent-event updates to the UI (e.g., server-sent events), not hidden browser automation.
- Long-running research plans must persist state, support human approval interrupts, resume after disconnection, and avoid duplicate/repeated job submissions.
- Evaluate LangGraph for durable research orchestration and checkpointed human-in-the-loop approval. Preserve backend-native job and scientific data ownership.

## Scientific evidence policy — NON-NEGOTIABLE

| Evidence category | Required treatment |
|---|---|
| **Computed result** | Link to exact stored engine calculation, units, input geometry, settings and scientific standing |
| **Literature claim** | Cite source with document/page/fragment and extraction provenance |
| **AI interpretation** | Explicit interpretation; not represented as a computed or published fact |
| **Hypothesis/prediction** | Explicitly unverified until supported |
| **Generated 3D geometry** | Clearly labeled generated/unoptimized and method-tagged |
| **Optimized geometry** | Clearly labeled engine, level of theory and convergence status |
| **Experimental structure** | Only when a verifiable experimental source exists |

Never let LLM confidence or agreement upgrade an `UNVERIFIED` result into `INDEPENDENTLY VERIFIED`. Preserve authoritative historical standing, comparison eligibility, export confidentiality and default-deny archive policies.

## RAG and chemistry libraries to evaluate (not install wholesale)

- **Docling:** PDF extraction with structured layout/table representation.
- **PaperQA2:** citation-oriented scientific-paper Q&A; evaluate alongside ChemDFT's own retrieval and scientific evidence policies.
- **GROBID:** publication metadata and bibliography parsing if needed.
- **Hybrid retrieval:** exact formula/method/basis/chemical name matching + semantic embeddings + reranking; candidate Qwen3-Embedding/BGE-M3; SQLite-compatible local prototype or pgvector later.
- **RDKit and existing validated chemistry tools:** identity, formula, conformers, deterministic geometry.
- **LangGraph:** candidate research-orchestration framework with checkpoints and approval interrupts.
- **Ragas, DSPy, Phoenix:** optional evaluation/optimization/tracing tools where they improve measurable correctness; build on ChemDFT's existing blinded QREL benchmark, including no-answer questions.
- Adopt one orchestration system rather than multiple competing frameworks. Test compatibility with current ChemDFT Python/TypeScript versions and security constraints before installing dependencies.

## Accepted autonomy / clarification policy

**Auto-executable after validated user intent and permissions:** document browsing within allowed project, read-only research search, draft molecule candidates, deterministic geometry drafts, UI navigation/highlighting, draft plans and reports.

**Ask a specific clarifying question:** ambiguous molecule identity or stereochemistry; unspecified R-group or incomplete paper diagram; conflicting input; a decision that could change chemical correctness.

**Require explicit approval:** submitting scientific jobs, expensive operations, new external data disclosure, destructive writes, broad project modifications or escalation beyond an approved plan. Approval is attached to an immutable validated plan/spec, not a vague chat response.

**Pause safely:** scientific validity fails, source provenance missing, output is unsupported, authorization denied, budget exhausted, researcher takes control or input is required.

## Development sequence (planning, not authorization to start)

- **Before AS-0:** checkpoint/activate the previously accepted RW-3.2 changes with careful Git and live-data preservation. Resolve the previously exposed API credential independently.
- **AS-0:** audit existing agent/UI/API code; define typed tool schemas, events, permissions, LLM adapter, scientific evidence contracts, cost model and approval-state machine.
- **AS-1:** context-aware copilot + text-to-molecules, deterministic draft geometry and visible tool-driven UI transitions.
- **AS-2:** PDF/RAG ingestion with precise source citations; candidate molecule extraction, ambiguity review and 3D generation.
- **AS-3:** bounded calculation planning, approval and native-engine submission with durable task timeline.
- **AS-4:** multi-step autonomous investigations that combine literature and computation with result-aware evaluation.
- **AS-5:** adversarial scientific/tool/retrieval validation, performance/cost metrics and private-beta hardening.

These are logical milestones, not instructions to begin implementation now.

## Current open design questions

- Primary economical/strong model combinations, provider data-handling requirements and supported customer regions: **benchmark before selecting**.
- Platform-managed API keys for beta vs BYOK launch timing and how to enforce usage caps.
- Whether draft molecules are persisted automatically or only after explicit Save (UI could still render unsaved drafts).
- Scientific PDF diagram extraction method and confidence thresholds requiring researcher review.
- Which long-running AI missions can resume unattended within an approved compute budget.
- Precise UI behavior for Follow AI vs Stay Here, user edits during a running plan, and auditable event retention.

## Relevant reference documentation

- OpenAI API streaming: https://developers.openai.com/api/docs/guides/streaming-responses
- OpenAI API/ChatGPT billing separation: https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
- Anthropic Messages API and tool use: https://platform.claude.com/docs/en/api/messages/create
- Gemini API function calling: https://ai.google.dev/gemini-api/docs/function-calling
- LangGraph durable execution: https://langchain-ai.github.io/langgraph/concepts/durable_execution/
- Vercel AI SDK tool calling: https://github.com/vercel/ai/blob/main/content/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx

---
**Record status:** Approved product vision and interaction principles; technical options pending AS-0 evaluation. No claim that the local Obsidian vault or repository has been modified by this downloaded copy.
