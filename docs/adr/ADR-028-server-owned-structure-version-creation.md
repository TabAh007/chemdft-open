# ADR-028: Server-owned structure-version creation

Status: Accepted

Date: 2026-09-11

## Context

The Phase 2 future tool accepted a full `StructureVersion`, which would have let a browser, API caller, or future model supply trusted fields such as id, project_id, revision, created_by, created_at, and origin. That is unsafe once executable.

Scientific artifacts also exposed `storage_key`, which revealed provider/local storage implementation details to browser-facing contracts.

## Decision

Phase 3 replaces full client-authored StructureVersion creation with dedicated commands:

- import actions create `IMPORTED` V1 through validated parser pipelines;
- `structure.version.create` accepts editable coordinates and artifact references only;
- server code assigns id, project, revision, actor, timestamp, final origin, provenance, and audit records.

`OPTIMIZED` is forbidden in Phase 3 unless a future qualifying deterministic calculation result authorizes it.

`ScientificArtifact` public contracts no longer expose `storage_key`. Storage locations remain internal ORM/object-store metadata and future reads/downloads must go through authorized application flows.

## Consequences

- Mass assignment cannot create fake optimized structures.
- Tool Registry execution uses the same application action as REST/UI.
- Object storage providers can change without changing browser/domain contracts.
