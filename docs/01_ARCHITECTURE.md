# Application Architecture

## Architectural style

Begin as a modular product with explicit service boundaries, not a premature microservice fleet. The web application, API/domain layer, asynchronous compute orchestration, scientific workers, and storage have different trust and scaling profiles and may deploy separately. Contracts, not directory names, are the lasting architecture.

```text
Browser workstation
  UI / AI Scientist / future WebMCP client
                 |
        authenticated API boundary
                 |
       Typed Domain Action Registry
     /       |         |          \
Projects  Knowledge  Calculation  Usage/Budget
                           |
                 Scientific Result Firewall
                           |
             Calculation Orchestrator / Queue
                           |
                    Compute Gateway
                   /       |       \
                Modal    RunPod    BYOC/HPC
                           |
          isolated versioned scientific workers
                           |
 PostgreSQL+pgvector / object storage / audit & telemetry
```

## Logical ownership boundaries

| Boundary | Owns | Must not own |
|---|---|---|
| Web client | Workstation state, interaction, deterministic presentation | Authoritative scientific writes, budget decisions, secrets |
| API/application | Identity, authorization, project workflows, typed actions | Engine-specific process management |
| Domain | Invariants, entity lifecycles, permissions, provenance requirements | Framework- or provider-specific concerns |
| Calculation orchestration | Job state machine, validation, dispatch, retries, artifact registration | Numerical chemistry kernels |
| Scientific adapters | QCSchema translation, engine invocation contracts, result parsing | User authorization or billing |
| Compute Gateway | Requirements, estimates, policy-enforced placement and execution | Chemistry semantics |
| Knowledge service | ingestion, evidence links, hybrid retrieval, corrections | Treating retrieved text as trusted instructions |
| Model Gateway | AI provider routing, managed/BYOK credentials, usage metadata | Authoritative scientific fields |
| Data layer | relational facts, vectors, immutable objects, ledgers, audit data | Hidden business logic in ad hoc queries |

## Probable repository shape for Phase 1

This is directional, not a scaffold commitment:

```text
apps/web                     Next.js/React/TypeScript workstation
services/api                 Python/FastAPI application boundary
services/compute-orchestrator asynchronous job and policy coordination
packages/domain              language-neutral domain definitions/generated clients
packages/schemas             versioned API, event, QCSchema-extension contracts
packages/tool-registry       typed action metadata and adapters
packages/scientific-scene    renderer-neutral scene contracts
packages/ui                  ChemDFT system atop Blueprint.js
packages/i18n                locale routing/messages
scientific/adapters          engine adapters and parsers
scientific/experiments       deterministic experimental pipelines
scientific/validation        firewall validators and benchmark fixtures
```

Phase 1 chose pnpm workspaces for TypeScript and uv workspaces for Python. Avoid sharing database records directly across boundaries; share versioned contracts.

## Data architecture

- **PostgreSQL** is the system of record for identity, tenancy, structured project facts, workflow state, provenance, budgets, and append-only usage events.
- **pgvector** augments PostgreSQL for semantic retrieval; it is not the sole knowledge model.
- **S3-compatible object storage** holds immutable raw uploads, engine input/output, volumetric data, exports, and derived artifacts. Cloudflare R2 is a candidate, not yet frozen.
- Large scientific arrays remain in typed artifacts with indexed metadata and content hashes, not bloated relational rows.
- The model supports explicit relationships now and future graph projections without requiring a separate graph database in V1.

## Shared action architecture

React handlers, the AI Scientist, REST/API, WebMCP, and later MCP call the same authenticated application actions. An adapter supplies caller identity and transport metadata; domain services enforce authorization, validation, budget, provenance, and idempotency. See [Tool Registry](04_TOOL_REGISTRY.md).

Phase 2 implements this as strict Pydantic domain contracts plus a versioned Tool Registry over the existing application actions. The registry supplies validation, server-owned permission/approval checks, version resolution, and audit; it does not own business logic. Scientific authoritative writes use a separate internal firewall action requiring an out-of-band trusted-producer capability. No public result-create transport exists.

## Deployment posture

- Web/API services use least privilege and cannot directly run arbitrary scientific binaries.
- Workers receive scoped, time-limited job inputs and artifact credentials.
- API requests enqueue durable work; long calculations never depend on an HTTP connection.
- Events/outbox patterns keep job state, artifacts, usage, and audit records consistent.
- Observability correlates request, agent run, tool call, calculation, compute execution, and artifact IDs without logging secrets or sensitive raw content by default.

## Open decisions

- **Resolved in Phase 1:** monorepo tooling, web/API foundation, local development identity adapter, application-level project authorization, Alembic migration foundation, and local object-store adapter. See [ADR-021](adr/ADR-021-phase-1-application-foundation.md).
- **OPEN after Phase 1:** production identity provider, tenant RLS implementation, final object storage provider, deployment topology, and retention policy.
- **OPEN (Phase 5/6):** adopt QCFractal/QCArchive or retain a simpler generic durable queue; see [calculation architecture](05_CALCULATION_ARCHITECTURE.md#qcfractalqcarchive-evaluation).
- **Resolved in Phase 2:** Pydantic is canonical; deterministic JSON Schema and TypeScript are generated and freshness-checked. See [ADR-022](adr/ADR-022-generated-scientific-contracts.md).

Related ADRs: [web-first](adr/ADR-001-web-first-application.md), [Python backend](adr/ADR-003-python-scientific-backend.md), and [WebMCP](adr/ADR-013-webmcp-progressive.md).
