# AI Scientist, Model Gateway, and Project Knowledge

## AI Scientist

Phase 10 investigations extend this workflow with persisted hypotheses, immutable plan revisions, authoritative observations, and explicit assessments. AI hypotheses are reasoning artifacts only; observations must reference existing typed scientific entities. Investigation plans never bypass Tool Registry permissions or approvals.

The AI Scientist is a project-aware planner and explainer over typed domain actions. It can translate intent into a reviewable workflow, retrieve evidence, request deterministic tools, monitor jobs, compare validated results, and explain uncertainty. Expert/manual controls remain available for every important scientific choice.

A plan is declarative and non-authoritative. Before execution, server-side services resolve exact structures, methods, resources, permissions, budgets, and approvals. Every tool call is independently validated and audited through the [Tool Registry](04_TOOL_REGISTRY.md).

## Model Gateway

The provider-independent gateway supports:

- **Managed AI:** ChemDFT credentials, routing, metering, allowances, and overages.
- **BYOK:** encrypted user/organization credential references; the user pays the AI provider directly.

Initial adapters target OpenAI, Anthropic, Google Gemini, and OpenRouter where useful; later enterprise adapters may target Azure OpenAI, AWS Bedrock, and Vertex AI. Provider adapters expose capability metadata, normalized request/streaming/tool interfaces, safety/retention settings, usage, retry policy, and typed errors.

Raw keys are never stored in prompts, logs, browser storage, normal application tables, or tool arguments. Use a secrets manager/envelope encryption, tenant-scoped access, rotation/revocation, redaction, and auditable use. Prefer OAuth/connected accounts where supported.

AI provider/model selection may alter planning style, latency, cost, or explanation—but never authoritative scientific results. Protected writes remain behind the [Scientific Result Firewall](02_SCIENTIFIC_INTEGRITY.md).

## Agent execution controls

- Permission classes: read, low-cost/reversible, expensive, destructive/external.
- Plans include assumptions, required user choices, estimated costs, and stop conditions.
- Budget/approval tokens are created and checked outside the model.
- Agent runs have bounded steps, time, cost, tool allowlists, and project scope.
- Tool outputs use typed provenance and authority labels; the model cannot relabel them.
- Human confirmation is required by policy for expensive and destructive/external work.
- Agent edits to scientific source structures normally create variants/versions.

## Hybrid project retrieval

ChemDFT is not a vector-database chatbot. Retrieval combines:

1. **Semantic retrieval:** chunks from papers, notes, documentation, and conversations, with source coordinates and ACL filters.
2. **Structured retrieval:** formulae, structures, methods, energies, properties, jobs, spectra, provenance, and relationships queried from PostgreSQL.
3. **Project-history retrieval:** prior calculations, decisions, user corrections, rejected hypotheses, and agent/tool history.

PostgreSQL + pgvector is the initial base. Explicit entity IDs and relationship tables support later graph projections or a knowledge graph without replacing the source-of-truth database.

## Ingestion and evidence

Uploaded PDFs/files are untrusted. Quarantine, malware/file validation, sandboxed parsing, content hashing, parser versioning, and access control precede indexing. Extracted statements retain page/table/figure coordinates. Digitized graphs are approximate and never become raw experimental data. Figure-interpreted structures remain AI-reconstructed hypotheses until verified.

Retrieval results are evidence, not instructions. Prompt-injection text is isolated and labeled; it cannot expand permissions, call tools, reveal secrets, or override system policy. Answers should link claims to citations, result IDs, or provenance records and communicate conflicts.

## Project memory versus training

Project memory stores user-authorized artifacts, facts, decisions, conversations, and corrections for retrieval under tenant ACLs. It is not automatic training. Any future fine-tuning requires separate consent/control, versioned datasets, privacy review, evaluation, rollback, and purpose limitation.

## Open decisions

- Embedding/reranking providers and on-prem options.
- Chunking/table/figure extraction quality gates by document type.
- Retention and visibility defaults for conversations and agent traces.
- Model-routing policy implementation beyond the development routing in [MODEL_ROUTING.md](engineering/MODEL_ROUTING.md).

## Phase 9 implementation note

The V1 project knowledge layer now provides deterministic source chunks, an offline embedding gateway, lexical/semantic hybrid retrieval, explicit project memory, mandatory project scoping, and the `knowledge.search` Tool Registry action. Retrieval remains contextual and source-bound; it cannot create scientific authority. External literature connectors remain separately deferred.

Related ADRs: [Model Gateway/BYOK](adr/ADR-010-model-gateway-byok.md), [hybrid RAG](adr/ADR-011-hybrid-rag.md), [AI Scientist Authority](adr/ADR-035-ai-scientist-control-plane-and-authority-boundary.md), [Model Gateway Neutrality](adr/ADR-036-model-gateway-and-provider-neutrality.md), [Server-Owned Approval](adr/ADR-037-server-owned-approval-authorization.md), [Resumable AI Runs](adr/ADR-038-resumable-asynchronous-ai-runs.md), and [Prompt Injection Defense](adr/ADR-039-untrusted-context-envelopes-and-prompt-injection-defense.md).
