# Tool Registry Implementation

Status: Phase 3 structure action foundation complete as of 2026-09-11.

## Runtime boundary

The registry describes and dispatches application actions; it contains no project or scientific business logic. Invocation follows:

```text
trusted transport context
  → version resolution
  → server-owned capability / approval policy
  → strict input validation
  → application handler (exactly once)
  → strict output validation
  → append-only invocation + audit records
```

Actor, organization, project scope, request ID, capabilities, and approval references live in `ToolInvocationContext`, never in model-controlled arguments. Inputs cannot override permission, cost, approval, producer trust, or authority. Failures return the stable `ToolErrorCode` taxonomy without exposing stack traces.

## Names and versions

Names are domain-first actions such as `project.list` and `calculation.submit`. Version is metadata, not part of the name. Omitted versions resolve to the latest executable registered version; exact unsupported versions fail. Multiple major versions coexist only during deliberate migrations.

Permission class and side-effect class are separate. `EXPENSIVE`/`DESTRUCTIVE_EXTERNAL` or explicit-approval tools require an out-of-band server approval reference. Durable jobs declare key-required idempotency even though no scientific durable job is executable in Phase 2.

## Phase 3 catalog

Executable:

- `project.list` 1.0.0
- `project.get` 1.0.0
- `project.create` 1.0.0
- `structure.version.create` 1.0.0

Declared `FUTURE`, never returned by default executable discovery and never dispatchable:

- `calculation.submit`
- `calculation.get`
- `result.compare`
- `experiment.dataset.import`
- `visualization.scene.get`

The project handlers call the existing Phase 1 application actions directly. `structure.version.create` calls the Phase 3 application action and accepts only the dedicated create command; callers cannot provide server-owned id, project id, revision, created-by, created-at, or `OPTIMIZED` origin. REST remains independent and thin; neither route nor registry calls the other.

`structure.import` is implemented behind REST/application upload flow and is intentionally not a Tool Registry executable yet. It should become a tool only when the caller already has a project-scoped source artifact reference and the upload step does not need to be duplicated.

## Audit and safety

Every attempted resolved invocation produces an input SHA-256 fingerprint and a compact append-only record containing server context, tool/version, outcome, typed error, and result reference when present. Full sensitive inputs are not logged. Discovery reports implementation availability, not caller authorization.

Budget reservation, rate limits, production approvals, per-transport allowlists, and WebMCP/MCP adapters remain future policy adapters around this same registry.
