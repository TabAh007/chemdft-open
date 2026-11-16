# AI Scientist Architecture (Phase 8)

AS-C1.2 approval now exposes the exact server version's coordinate table and
blocks approval while geometry is loading or mismatched. The manual NVIDIA
acceptance harness initializes disposable storage via Alembic, preserves original
web sources, and starts one compute worker only after observing actual researcher
consent. Local resource watchdogs remain distinct from hard RAM/disk isolation.
See final preflight corrections.

## 1. Architectural Role
The ChemDFT AI Scientist is an interactive, project-scoped computational chemistry copilot and planning control plane. It coordinates multi-step investigations, retrieves and explains structures, queries calculations, extracts evidence from scientific documents, and formulates calculation proposals.

### Permanent Invariant
- **AI plans and explains.**
- **Scientific engines calculate.**
- **Deterministic systems validate.**
- **Deterministic renderers visualize.**
- **AI must never become the scientific authority.**

## 2. Component Topology

```
Browser Workspace (AI Scientist Panel & Dock)
     │
     ▼ HTTP REST
FastAPI Endpoints (/v1/projects/{id}/ai/...)
     │
     ▼
AIScientistService (Orchestrator)
  ├── AIContextBuilder (Deterministic project summaries & untrusted envelopes)
  ├── ModelGateway (Provider-neutral protocol: Fake & HTTP-OpenAI)
  ├── BillingService (entitlement check → invocation ledger metering)
  ├── ToolRegistry (Sole action surface: 16 typed application tools)
  └── ApprovalVerifier (Server-owned action fingerprinting & authorization)
     │
     ▼ Compute / Actions
Compute Gateway → Isolated Worker (PySCF) → Scientific Result Firewall
```

## 3. Core Domain Entities
- **`AIConversationRecord`**: Project-scoped container for user and assistant messages.
- **`AIMessageRecord`**: Immutable append-only message history with structured citations.
- **`AIRunRecord`**: Finite state run execution (`PLANNING`, `WAITING_FOR_APPROVAL`, `EXECUTING`, `WAITING_FOR_CALCULATION`, `SUCCEEDED`, `FAILED`, `CANCELED`).
- **`AIRunStepRecord`**: Ordered user-visible tool execution timeline and activity logs.
- **`AIApprovalRecord`**: Server-issued authorization token binding tool name, normalized arguments SHA-256 fingerprint, and expiration.
- **`AIContextSnapshotRecord`**: Audit trail of exact entity references supplied to the model during each run.
- **`AIModelInvocationRecord`**: Usage accounting record (tokens, latency, provider, model, prompt policy version).
- **`AIUsageLedgerEntryRecord`**: Append-only billing usage record keyed to one model invocation; billable accounting is separate from compute usage.

Invocation receipts now persist nullable token observations and explicit
`REPORTED`, `UNKNOWN`, or `LEGACY_UNSPECIFIED` usage status. Durable reservation
identities bind accounting to the call that consumed the allocation. Receipt,
ledger, and budget settlement are atomic, with idempotent recovery for the
existing budget-recovery commit gap. Late reports append corrections in the
original billing period, retain conservative quota spend, and leave successor
reservations intact. Billing completeness and provider cost are independent of
confirmed platform charges. See [ADR-041](../adr/ADR-041-durable-ai-usage-accounting.md).

## 4. Bounded Multi-Step Loop
Every AI run enforces server-owned limits:
- Maximum tool steps (`CHEMDFT_AI_MAX_TOOL_STEPS`, default 10)
- Hard timeout on tool execution
- No self-spawning agents or infinite autonomous loops
- No arbitrary code execution or direct SQL/filesystem access

## 5. CHAT mode (free conversation grounded in a server fact sheet)

`POST .../messages` accepts `mode: "CHAT"`, which the web Ask tab now sends. The strict
`EVIDENCE` mode is unchanged and still available to API callers and the starter prompts.

- **Routing (`ai/service.py`):** result, view, spectrum, calculation, next-step, project-summary
  and document questions (`_chat_needs_cited_evidence`) go to the existing cited evidence path.
  Everything else (greetings, questions about the AI, counts and names in the project, general
  chemistry) goes to `_execute_chat_run`: one model call, no tools, no stored claims.
- **Fact sheet (`ai/chat_facts.py`):** built by the server from durable records on every chat
  request: project name and role, the serving provider and model (from server settings, never
  from the model's own claim), structures with atom counts and charge/multiplicity, calculations
  with task/method/basis, state and result class, and document titles. It carries no numeric
  scientific value; names and titles are marked untrusted.
- **Policy (`CHAT_POLICY`):** general knowledge is allowed and must be said to be general;
  project statements come only from the fact sheet; counts are read, not guessed; numeric
  scientific values are never stated in chat, the researcher is sent to a cited question.
- **Labelling without a schema change:** the stored reply has `evidence_status = null` and
  `evidence_note = CHAT_REPLY_NOTE`. The web panel shows "AI reply · not project evidence" for
  exactly that note (`apps/web/src/lib/ai-chat-reply.ts`; a test pins both strings together),
  and the Evidence desk ignores replies without an evidence status.
- **Gate:** CHAT uses the `EVIDENCE` planning-profile gate, so a development-only model
  (for example Kimi K3, evidence for `PYSCF_ENERGY_PROPOSAL` only) is still refused by name.
- **Not changed:** the Result Firewall, AI hypothesis labelling, approvals, budgets (the call is
  reserved and settled like an evidence answer), and the provider/model registry.
