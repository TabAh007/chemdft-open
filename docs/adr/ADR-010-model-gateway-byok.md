# ADR-010: Model Gateway with managed AI and BYOK

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Users need model choice, managed convenience, enterprise providers, and optionally direct provider billing.

## Decision

Place OpenAI, Anthropic, Gemini, OpenRouter, and future enterprise providers behind a Model Gateway supporting managed credentials and encrypted BYOK references.

## Consequences

Provider capabilities/usage/errors require normalization; keys require dedicated secret management. Model choice may affect explanations but never authoritative science. See [AI Scientist and RAG](../07_AI_SCIENTIST_AND_RAG.md).
