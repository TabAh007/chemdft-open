# ADR-015: Scientific provenance as first-class domain data

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Scientific trust requires distinguishing raw measurement, engine calculation, document extraction, graph digitization, hypothesis, and verification with full lineage.

## Decision

Model provenance, evidence, validation, correction, and supersession explicitly on scientific entities and artifacts. Preserve immutable sources and derived-operation lineage.

## Consequences

Storage and UI are more deliberate, but results become auditable, comparable, and exportable with reproducibility metadata. Verification never erases source class. See [data provenance](../08_DATA_PROVENANCE.md).
