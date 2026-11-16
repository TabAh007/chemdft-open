# ADR-018: Linked scientific visualization

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

The product's differentiating scientific workflow depends on moving between peaks, atoms, modes, orbitals, structures, energy points, and crystallographic information without losing evidence or ambiguity.

## Decision

Use stable typed selections and explicit deterministic mapping records to coordinate scientific views. Cross-view links include method, source versions, confidence/ambiguity, and provenance. AI explains links but does not invent them.

## Consequences

Viewers, charts, inspector, and AI references share selection contracts and accessible alternatives. Approximate/manual mappings remain labeled/versioned. See [scientific visualization UX](../design/SCIENTIFIC_VISUALIZATION_UX.md).
