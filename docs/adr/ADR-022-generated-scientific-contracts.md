# ADR-022: Pydantic-first generated scientific contracts

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

ChemDFT needs one reviewable source for backend validation, JSON Schema, TypeScript clients, tool metadata, and long-lived serialized scientific records. Hand-maintained Python and TypeScript definitions would drift.

## Decision

Versioned strict Pydantic models are the canonical contract source. A deterministic generator emits JSON Schema 2020-12 and `json-schema-to-typescript` 16.0.0 emits checked-in TypeScript. `pnpm schemas:generate` updates both; `pnpm schemas:check` fails on stale output and runs in root verification and CI.

Serialized contracts carry a schema version. Patch changes may clarify documentation or safely correct constraints, minor changes are additive only when consumers tolerate them, and semantic or structural breaks require a major version plus explicit migration. Stored payloads retain the version used to validate them.

New scientific IDs remain opaque UUIDs compatible with Phase 1 UUIDv4 identifiers. UUIDv7 was evaluated, but changing existing identity generation without a migration or demonstrated index need would create needless mixed-ID behavior. Time ordering remains an explicit column concern.

## Consequences

Generated files are never edited manually. Contract diffs are reviewed through their canonical Python and generated-schema changes. TypeScript gains compile-time contracts without becoming a second authority. UUIDv7 can be adopted through a deliberate migration later.
