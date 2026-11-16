# ADR-001: Web-first application

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

ChemDFT must make scientific editing, computation, analysis, knowledge, and collaboration available without requiring users to install a local chemistry stack.

## Decision

The browser is the primary product surface. Long-running and authoritative work executes in backend services/workers; the web client is an interactive workstation and deterministic viewer/editor.

## Consequences

Central deployment simplifies updates and collaboration, while offline/native operation is not a V1 goal. Browser limits, large artifacts, latency, accessibility, and secure remote compute must be designed explicitly. See [application architecture](../01_ARCHITECTURE.md).
