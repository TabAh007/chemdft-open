# AI Investigation Security

- Every investigation child record is project-scoped; cross-project sources are rejected.
- Model output cannot create an authoritative observation: a typed, existing source entity is required.
- `AI_HYPOTHESIS` is a reasoning artifact only and is never promoted to another provenance class.
- Plans do not grant permission. Side effects continue through Tool Registry capabilities, approvals, idempotency, audit, and the Scientific Result Firewall.
- Server-owned bounds cover steps, calculations, AI calls, elapsed time, and allowed tool classes.
- Pause/cancel controls, terminal-state checks, immutable plan revisions, and committed observation references make review and restart explicit.
- Calculation submissions use stable step-scoped idempotency keys, and approval fingerprints include the exact normalized arguments. Resume reuses an existing calculation reference instead of dispatching a duplicate.
