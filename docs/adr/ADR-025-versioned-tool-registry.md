# ADR-025: Versioned Tool Registry over application actions

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Web UI, AI, REST, WebMCP, and MCP need shared action contracts without moving business logic into a registry or allowing model arguments to control identity, permissions, approval, cost, or scientific authority.

## Decision

Tool identity is a stable domain-first name plus semantic version metadata. Runtime registration binds strict input/output models to existing application handlers. Dispatch resolves the latest registered version by default or an exact requested version, validates both directions, applies server-owned capability/approval policy, calls the handler once, and emits an input fingerprint plus append-only invocation/audit records.

Discovery returns executable definitions by default. Future scientific definitions are inspectable only through explicit catalog access and cannot resolve to handlers. Phase 2 makes `project.list`, `project.get`, and `project.create` executable; six representative scientific contracts remain `FUTURE`.

## Consequences

Tool discovery does not imply permission. Major versions may coexist only during deliberate migrations; unsupported exact versions fail with a typed error. Budget reservations and transport adapters plug into the policy seam in later phases.
