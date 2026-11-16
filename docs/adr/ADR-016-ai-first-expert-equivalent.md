# ADR-016: AI-first, expert-equivalent interaction

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Natural language should remove multi-step workflow friction, while scientific users require inspectable parameters and direct control. Separate AI and manual implementations would drift in validation, permissions, provenance, and cost behavior.

## Decision

Make AI the default/easiest interface for multi-step work, never the only interface. AI plans and expert forms edit the same normalized action drafts and invoke the same typed Tool Registry actions.

## Consequences

Users can move between plan and Advanced settings without translation loss. Material edits invalidate estimates/approval. AI cannot bypass permissions/budgets or author authoritative results. See [AI-first workflows](../product/AI_FIRST_WORKFLOWS.md) and [expert workflows](../product/EXPERT_WORKFLOWS.md).
