# ADR-012: 3Dmol.js and Three.js dual rendering

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

ChemDFT needs a reliable scientific reference view and differentiated premium publication-quality presentation.

## Decision

Use 3Dmol.js for scientific/reference 3D and Three.js plus a custom layer for ChemDFT Studio. Both consume the same renderer-neutral ScientificScene.

## Consequences

Scene data, selections, coordinates, grids, and vectors are authoritative inputs; rendering may enhance presentation but never alter chemistry. Cross-renderer tests are required. See [visualization](../09_VISUALIZATION_ARCHITECTURE.md).
