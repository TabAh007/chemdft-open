# ADR-030: Direct Three.js Studio Renderer

## Status

Accepted.

## Context

ChemDFT Studio Mode needs explicit control over atom/bond geometry, instancing, WebGL lifecycle, disposal, camera behavior, image export, and future publication/scientific layers. React component trees per atom would be inappropriate for large molecules and crystals.

## Decision

Use direct `three@0.186.0` behind an imperative Studio adapter. Do not add React Three Fiber in Phase 4.

React owns viewport lifecycle and typed visualization state. The Studio adapter owns disposable renderer objects and rebuilds them from `ScientificScene`.

## Consequences

- Renderer objects remain disposable projections, not application state.
- Instancing and explicit material/geometry disposal are straightforward.
- The app avoids a large React-Three ecosystem until there is a clear maintainability advantage.
- Studio code must remain carefully isolated and tested through adapter/boundary tests and browser verification.
