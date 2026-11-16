# ADR-008: QCSchema and QCEngine interoperability

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Engine-specific inputs/results would couple workflows, storage, and clients to particular implementations.

## Decision

Use QCSchema, QCElemental, and QCEngine concepts as the normalization/interoperability layer, adding versioned ChemDFT extensions only for product concerns not represented upstream.

## Consequences

Raw engine artifacts remain available and no normalization may erase scientifically important information. Adapter conformance and schema migrations are required. See [calculation architecture](../05_CALCULATION_ARCHITECTURE.md).
