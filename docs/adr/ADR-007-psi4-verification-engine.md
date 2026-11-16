# ADR-007: Psi4 as independent verification engine

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Selected high-risk scientific pathways benefit from a second implementation, while duplicating every calculation is wasteful.

## Decision

Support Psi4 behind the common adapter layer as a complementary engine and independent verification path for selected overlapping methods and benchmarks.

## Consequences

Cross-engine tolerances must be scientifically justified; differences are investigated, not averaged away. LGPL review is required. See [scientific integrity](../02_SCIENTIFIC_INTEGRITY.md).
