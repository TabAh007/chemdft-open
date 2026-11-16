# ADR-004: Scientific Result Firewall

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

LLMs can produce plausible but fabricated numerical chemistry and experimental claims. Prompt instructions alone cannot protect scientific authority.

## Decision

Enforce a server-side Scientific Result Firewall. Only trusted deterministic engine services and validated import pipelines can write authoritative result fields after schema, provenance, artifact, producer, and lifecycle checks. AI writes plans, interpretations, hypotheses, and candidates only.

## Consequences

Separate candidate/authoritative/verification states, service identities, protected database paths, and adversarial tests are required. See [scientific integrity](../02_SCIENTIFIC_INTEGRITY.md).
