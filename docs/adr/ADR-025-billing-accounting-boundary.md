# ADR-025: Internal billing accounting boundary

## Decision

ChemDFT owns organization-scoped billing accounts, normalized subscriptions, entitlements, allowance periods, append-only AI/compute usage ledgers, invoice references, webhook idempotency, and reconciliation state. Stripe is a payment and subscription provider adapter, not the domain source of truth.

AI and compute usage remain separate ledgers. A compute reservation is not a charge; reservation, actual metering, and final billable amount are stored distinctly. Historical usage is immutable and corrections are adjustment rows.

The phase does not introduce a general double-entry ledger because taxes, credits, refunds, and settlement rules are not yet defined. It also does not choose commercial prices; plan definitions are configuration.

## Consequences

Billing can deny future managed-AI or compute work without invalidating published scientific results or bypassing existing approvals and investigation budgets. A live Stripe SDK/test account and KMS/Vault-backed BYOK secret provider are required before production billing is enabled.
