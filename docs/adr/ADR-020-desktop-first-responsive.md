# ADR-020: Desktop/workstation-first responsive strategy

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Professional molecular, crystal, spectrum, and comparison work requires precision, space, and concurrent context. Pretending full editing works equally on phones creates unsafe and unusable UX.

## Decision

Design the browser product desktop/laptop-first. Tablet reduces multi-panel concurrency. Mobile supports project viewing, AI, jobs, approvals, and simple result/provenance inspection, but does not claim full professional editing.

## Consequences

Routes preserve deep-link context for continuation on desktop. Responsive changes use drawers/sheets and explicit capability boundaries. Exact breakpoints may be tuned without changing this strategy. See [responsive behavior](../design/RESPONSIVE_BEHAVIOR.md).
