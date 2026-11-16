# ADR-029: Renderer-neutral Scientific Scene Model

## Status

Accepted.

## Context

Phase 4 needs 3Dmol.js and Three.js visualization over the same authoritative Phase 3 `StructureVersion` data. Letting renderers parse raw files or own scientific state would create visual disagreement and authority leaks.

## Decision

Create `packages/scientific-scene` as a renderer-neutral TypeScript package. It derives `ScientificScene` from authorized `StructureVersionDetail` read models in the browser, performs deterministic display transforms, and exposes shared measurement and visualization-state types.

The package is deliberately free of React, Next.js, renderer libraries, Ketcher, Python toolkit objects, and API/database code.

## Consequences

- 3Dmol.js Scientific Mode and Three.js Studio Mode consume the same scene.
- Visualization settings do not mutate `StructureVersion`.
- `visualization.scene.get` remains a future Tool Registry action because Phase 4 scene generation is a deterministic client projection from existing read models.
- Coordinate transform and measurement correctness are testable without WebGL.
