# ADR-017: Central multi-document scientific workspace

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Researchers inspect structures, spectra, calculations, papers, comparisons, and reports concurrently. Dashboard/page navigation loses cross-object selection and working context.

## Decision

Use a central document workspace with pinned/overflow tabs, bounded split view, typed active selection, project explorer synchronization, switchable Inspector/AI context dock, and durable activity shelf. The scientific document remains dominant.

## Consequences

Workspace state and scientific project state remain distinct; closing tabs never deletes data. Comparison is a first-class document. Responsive layouts reduce panel concurrency rather than compressing every panel. See [workspace specification](../product/WORKSPACE_SPECIFICATION.md).
