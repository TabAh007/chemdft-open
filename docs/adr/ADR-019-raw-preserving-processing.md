# ADR-019: Raw-preserving experimental processing

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Baseline correction, smoothing, normalization, peak picking, integration, and assignments can materially change interpretation. Overwriting imported data destroys reproducibility.

## Decision

Store experimental raw uploads immutably. Model processing as versioned deterministic pipelines/branches whose steps record algorithm, version, parameters, actor, input/output, timestamp, units, and warnings.

## Consequences

Preview is separate from committed derived data; manual corrections create new analysis versions. Raw remains accessible and exports/comparisons identify the exact branch. See [spectrum workspace](../product/SPECTRUM_WORKSPACE.md).
