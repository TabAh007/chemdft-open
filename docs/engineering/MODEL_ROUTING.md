# Model and Token Routing Policy

## Objective

Use the lowest reasonable model/token cost that preserves correctness. Escalation is based on risk and demonstrated difficulty, not availability or prestige.

## Routing

### Cheap / routine

Prefer GPT-5.5-class or Gemini Flash-class models when available for basic repository inspection, repetitive coding, formatting, documentation cleanup, straightforward tests, minor UI changes, simple bug fixes, and mechanical refactors.

### Normal complexity

Prefer Sonnet-class models for normal feature development, multi-file implementation, moderate debugging, and integration work.

### High risk / hard

Use GPT-5.6-class, Astra-class, or equivalent stronger reasoning only when justified for architecture, scientific correctness, numerical-computation architecture, security, permissions, billing, complex distributed systems, difficult cross-system debugging, or failures cheaper models could not resolve.

## Operating rules

- Never escalate merely because a stronger model exists.
- Never ask multiple expensive models to solve the same routine problem.
- Use a second strong model only when independent review materially reduces scientific, architectural, security, permissions, or billing risk.
- Read NEXT.md and relevant architecture/ADRs first; do not repeatedly reread the entire repository.
- Inspect only files relevant to the current task, expanding scope when evidence requires it.
- Prefer code, tests, benchmark outputs, diffs, and concise decisions over lengthy explanations.
- Reuse summaries, schemas, fixtures, and targeted search rather than repasting large contexts.
- Route independent mechanical work cheaply; reserve expensive context for decision points.
- Record material model-assisted scientific hypotheses as non-authoritative and validate them through deterministic mechanisms.
- Never trade away the Scientific Result Firewall, provenance, security review, or deterministic budget enforcement to save tokens.

Model brand/class availability changes over time. Treat names as routing examples; preserve the risk tiers and selection principles when tooling changes.
