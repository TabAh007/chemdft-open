# ADR-011: Hybrid RAG rather than vector-only RAG

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Scientific project knowledge includes prose and citations but also precise entities, values, versions, relationships, decisions, and rejected hypotheses.

## Decision

Combine semantic, structured, and project-history retrieval using PostgreSQL + pgvector initially. Preserve explicit relationships suitable for future graph projection.

## Consequences

Every retrieval path enforces tenant/project ACLs and provenance. Vector similarity is never the authority mechanism. See [AI Scientist and RAG](../07_AI_SCIENTIST_AND_RAG.md).
