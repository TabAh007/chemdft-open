# ADR-005: PySCF as primary programmable QM/DFT engine

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

ChemDFT needs an extensible, inspectable quantum-chemistry engine with a credible GPU path and strong Python integration.

## Decision

Use PySCF as the primary programmable QM/DFT engine behind a QCSchema-compatible adapter, with GPU4PySCF for validated supported acceleration.

## Consequences

PySCF is not coupled directly to product/domain code and does not exclude other engines. Methods and accelerated paths require benchmarks, pinned environments, and provenance. See [calculation architecture](../05_CALCULATION_ARCHITECTURE.md).
