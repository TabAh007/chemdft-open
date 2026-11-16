# ADR-002: Blueprint.js as UI foundation

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

ChemDFT needs dense, keyboard-capable workstation interactions and a coherent base component library.

## Decision

Use Blueprint.js as the sole full UI component framework. Build a ChemDFT scientific design system on top; do not treat Blueprint defaults as the visual identity or mix additional full design systems.

## Consequences

Phase 0 must define tokens, composition rules, accessibility, scientific states, and anti-slop review. Impeccable is the planned design QA tool. See [UI/UX foundation](../10_UI_UX_FOUNDATION.md).
