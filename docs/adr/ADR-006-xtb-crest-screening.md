# ADR-006: xTB and CREST screening/conformer layer

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

High-level DFT on an unfiltered conformer space is inefficient and costly.

## Decision

Use xTB and CREST behind adapters for fast geometry/conformer generation, screening, and ranking before higher-level calculations where scientifically appropriate.

## Consequences

The workflow records versions, settings, coordinates, rankings, and selection criteria. Screening results are method-specific, not universal truth. LGPL deployment/distribution requires review. See [calculation architecture](../05_CALCULATION_ARCHITECTURE.md).
