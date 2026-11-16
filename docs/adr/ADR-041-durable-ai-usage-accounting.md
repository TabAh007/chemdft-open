# ADR-041: Durable AI usage observations and conservative reservations

Status: Accepted. Date: 2026-10-14. Authority: the user's approved AS-C1.2
migration design and targeted implementation request.

## Decision

Provider token observations are nullable. `REPORTED` requires known input and
output counts, including confirmed zero. `UNKNOWN` retains any valid partial
counts and leaves missing fields null. `LEGACY_UNSPECIFIED` preserves historical
values without asserting that a provider confirmed them. Budget counters and
confirmed platform charges remain non-null integers.

An invocation receipt and its reservation identity are committed before model
dispatch. Receipt finalization, append-only billing observations, and normal
budget settlement share one transaction. Recovery retains uncertain allocations
as conservative quota spend. Late observations append idempotent `USAGE_REPORT`
adjustments in the original billing period. They can increase conservative quota
spend but cannot settle a successor reservation or duplicate a platform fee.
The AI Scientist's existing budget recovery can precede receipt recovery; an
idempotent recovery path covers this commit gap and preserves its quota charge.

Investigation model calls and token allocations use the existing investigation
budget CAS and a durable invocation identity. Budgeted AI orchestration makes one
physical HTTP attempt per reservation. A retry requires a new authorized
reservation; the standalone gateway's existing retry default is unchanged.

Usage summaries expose nullable totals, reported subtotals, and unknown,
historical, and pending entry counts. Provider cost remains unknown unless an
authoritative amount exists; token counts never imply prices. Confirmed platform
charges retain their own accounting, including BYOK semantics.

## Migration and consequences

Alembic revision `0028_ai_usage_status` preserves all historical values, IDs,
relationships, idempotency keys, and charges. It uses SQLite batch alteration
and PostgreSQL column alteration. A historical-only downgrade is reversible.
Downgrade refuses before altering tables when new accounting information would
be lost; it never fills null observations with zero.

Historical investigations with calls but no recorded token allocation require
an explicit allocation review before further model dispatch. Existing user
databases are not migrated by this implementation task. Scientific authority,
approvals, and execution behavior remain governed by their existing boundaries.

See implementation and test evidence.
