# Typed Tool Registry

## Purpose

The Tool Registry is the transport-neutral catalogue of authenticated application actions. UI controls, the AI Scientist, REST/API, WebMCP, and later MCP adapt to these actions; none owns the underlying scientific/business logic.

## Tool contract

Each versioned tool definition includes:

- stable namespace/name and semantic version;
- human description and machine-readable input/output schemas;
- caller/project context supplied by trusted middleware;
- permission class and required domain capabilities;
- cost/risk classification, estimate behavior, approval policy, and idempotency behavior;
- side effects and reversibility;
- provenance obligations and authoritative-field policy;
- synchronous acknowledgement plus durable operation/job references where needed;
- typed error taxonomy and audit/event metadata.

Never place secrets in arguments or return unrestricted object-storage locations. Large data travels by scoped artifact references.

## Permission classes

| Class | Default posture | Examples |
|---|---|---|
| `READ` | May auto-run within access scope | project search, calculation/result lookup |
| `LOW_COST_REVERSIBLE` | May auto-run under user/org policy | create variant, measurement, inexpensive deterministic analysis |
| `EXPENSIVE` | Requires estimate, budget authorization, and possibly explicit approval | DFT, GPU, large conformer/frequency workflows |
| `DESTRUCTIVE_EXTERNAL` | Explicit authorization; strong confirmation/idempotency | deletion, external publish/export, credential connection, HPC submission |

Classification is server-side and cannot be downgraded by a prompt, client, or model.

## Naming conventions

Prefer domain-first, verb-explicit names such as `structure.version.create`, `calculation.submit`, `experiment.dataset.import`, `spectrum.ftir.analyze`, `result.compare`, and `visualization.scene.get`. Engine-specific actions are used only where engine choice is semantically necessary; otherwise `calculation.submit` carries a validated method specification and lets orchestration select an adapter.

Conceptual initial families:

- `project.*`, `knowledge.*`, `literature.*`
- `structure.*`, `conformer.*`, `crystal.*`
- `calculation.*`, `result.*`, `artifact.*`
- `experiment.*`, `spectrum.*`
- `visualization.*`, `export.*`
- `budget.*`, `approval.*`

The domain-first naming convention and stable-name-plus-version identity are accepted in Phase 2. New names still require contract review; engine-specific top-level names remain exceptional.

## Invocation path

1. Transport adapter authenticates the caller and establishes tenant/project context.
2. Registry validates schema and resolves tool version.
3. Policy checks authorization, permission class, quota, budget, and approval token.
4. Domain service applies invariants and emits durable commands/events.
5. Scientific tasks run through orchestration and the [Result Firewall](02_SCIENTIFIC_INTEGRITY.md).
6. Response contains typed state and references, with an audit record.

## Phase 3 implementation

`project.list`, `project.get`, and `project.create` version 1.0.0 dispatch to the Phase 1 application actions. `structure.version.create` 1.0.0 dispatches to the Phase 3 application action and creates only server-authorized manual-edit versions.

Default discovery exposes only executable definitions. `calculation.submit`, `calculation.get`, `result.compare`, `experiment.dataset.import`, and `visualization.scene.get` remain representative `FUTURE` contracts with no handlers and cannot execute.

Strict arguments and output models reject mass assignment. Trusted actor/organization/project/capability/approval context is passed out of band. Every resolved attempt emits an SHA-256 input fingerprint plus an append-only tool invocation/audit record; raw payloads are not logged. See [implementation details](implementation/TOOL_REGISTRY.md) and [ADR-025](adr/ADR-025-versioned-tool-registry.md).

`structure.import` is implemented as an application action behind REST upload/import flow, but Tool Registry exposure is deferred until artifact-first imports can be invoked without duplicating upload business logic.

## Agent safeguards

- Plans are non-executing data; every action is independently authorized.
- Retrieved document text cannot change tool policy or become tool arguments without validation.
- The model cannot supply trusted identity, approval, price, or provenance classifications.
- Multi-step plans reserve budget atomically or per approved stage and stop at policy boundaries.
- Tool outputs distinguish authoritative results, estimates, candidates, and narrative text.
- Destructive/external tools expose dry-run/preview where feasible.

## WebMCP and MCP

WebMCP is a progressive adapter over safe browser-relevant actions, not a dependency of the domain layer. Server-side MCP can expose the same registry later with its own authentication and policy adapter. Capabilities are allowlisted per surface; tool discovery does not imply permission.

Related: [application architecture](01_ARCHITECTURE.md), [AI Scientist](07_AI_SCIENTIST_AND_RAG.md), and [ADR-013](adr/ADR-013-webmcp-progressive.md).
