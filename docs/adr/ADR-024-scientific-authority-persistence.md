# ADR-024: Immutable scientific authority and trusted-producer capability

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Authoritative scientific results require a write path that ordinary users, browsers, models, and arbitrary API clients cannot manufacture. Large arrays must not become mutable relational JSON.

## Decision

Persist scientific artifact metadata, provenance lineage, calculation intent/input/result envelopes, audit events, and tool invocations. Numerical arrays and raw outputs stay in immutable hash-addressed artifacts. Composite project/reference constraints enforce tenant scope for persisted relationships.

The authoritative write action accepts a typed submission plus an out-of-band, project-scoped `TrustedProducerContext`. That capability is issued only inside server composition and admits scientific workers, validated import pipelines, or validated deterministic transforms. It is not a request model or tool argument. The firewall validates producer scope, schema version, succeeded lifecycle, project relationships, artifact existence/hashes, calculated provenance, and idempotency before generating server-owned authority and validation states.

Scientific artifacts, inputs, results, provenance, audit events, and tool invocations are append-only at the application model boundary. Correction, verification, dispute, and supersession are new records.

## Consequences

Phase 2 has a synthetic trusted-producer harness but no production trust issuer or worker. Production issuance must derive from authenticated internal service identity and attestations. No public result-create route exists.
