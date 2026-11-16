# Compute Gateway

## Goal

The chemistry layer describes what resources and execution guarantees it needs; it never imports Modal-, RunPod-, cloud-, or SLURM-specific concepts. The Compute Gateway estimates, authorizes, routes, executes, and meters provider-neutral work.

## Core contracts

```text
ComputeRequirement
  cpu_count, memory, accelerator_kind/count, gpu_vram,
  cuda_capability, storage, runtime_range, region/data constraints,
  priority, deadline, reproducibility/isolation class

ComputeProvider
  capabilities(), estimate(), submit(), status(), cancel(), collect()

ComputeEstimate
  requirement_hash, provider/sku candidate, runtime range,
  cost range/currency, confidence, assumptions, valid_until

ComputeJob
  immutable workload reference, requirement, policy scope,
  max_authorized_cost, reservation, lifecycle, idempotency

ComputeExecution
  provider attempt, environment/hardware, timestamps,
  metering, actual cost, state, logs/artifact references

ComputeArtifact
  typed content-addressed input/output with size, hash,
  retention, confidentiality, producer, and lineage
```

## Phase 6 implementation status

Phase 6 establishes the provider-neutral gateway boundary and moves the Phase 5 local
PySCF path behind it:

- calculation submission validates/authorizes/persists immutable input, creates a
  `ComputeEstimate`, `ComputeReservation`, durable `ComputeJob`, then returns while the
  calculation remains queued;
- `chemdft-compute-worker` claims jobs, issues a lease and execution authorization,
  runs the local provider, stores artifacts, and publishes candidates only through the
  Scientific Result Firewall;
- leases, heartbeats, cancellation request handling, lease-expiry recovery, and
  reservation reconciliation are persisted in the database;
- public calculation/job read models expose safe provider state, estimates, attempts,
  and metering without storage keys or provider-internal references.

Modal is represented by an infrastructure adapter seam only. Official Modal docs and
PyPI metadata were reviewed on 2026-09-16: current SDK `modal==1.5.5`, Apache-2.0,
with Python functions/images/resources as cloud execution primitives. Real Modal CPU
execution remains blocked until server-side Modal credentials and a deployed pinned
PySCF function are configured. No Modal SDK types or fields enter chemistry contracts.

## Routing and rollout

- **V1:** local provider is executable through the gateway; Modal CPU/GPU seam exists but is gated.
- **V2:** Modal CPU execution with pinned PySCF container/function and gated integration test.
- **Later:** RunPod, public clouds, BYOC, private clusters, and SLURM adapters.

Provider capability negotiation is deterministic and auditable. Routing may optimize cost but cannot change requested scientific semantics without a new validated calculation input and user-visible plan revision.

## Budget enforcement

“Do not spend more than $5” becomes a server-side budget policy, not an LLM reminder.

1. Normalize the workflow and resource requirements.
2. Produce a versioned time/cost range with expiry and uncertainty.
3. Check scoped user/org allowances and reserve the maximum authorized amount atomically.
4. Require explicit approval when policy/risk/cost threshold says so.
5. Pass a signed authorization/reservation token to orchestration—not a caller-supplied number.
6. Refuse start or additional stages when the cap cannot be honored; enforce runtime/resource shutdown ceilings where providers permit.
7. Reconcile immutable actual metering, release unused reservation, and surface variance.

Multi-stage workflows authorize per stage or reserve a safe aggregate cap. A provider quote is not itself authorization. Estimates are clearly labeled non-authoritative financial forecasts.

## Economic separation

Maintain distinct ledgers and user-facing summaries for:

1. platform subscription/entitlements;
2. AI model usage (managed or BYOK metadata); and
3. scientific CPU/GPU compute estimates and actuals.

An internal ledger may normalize money and units, but the UI must not obscure these behind one undifferentiated credit balance. Stripe is planned for Phase 11 and is not part of this phase.

## Execution security and reliability

- Workers run untrusted inputs in hardened, ephemeral isolation without general-purpose credentials.
- Inputs/artifacts use scoped, short-lived access; outputs are hash-verified and quarantined until validation.
- Enforce CPU/RAM/GPU/runtime/output/network limits and egress allowlists.
- Provider webhooks/status updates are authenticated, replay-protected, and reconciled by polling where needed.
- Idempotent submission prevents duplicate charges; cancellation is best effort and state is explicit.
- Provider-reported metering is retained beside ChemDFT estimates and job facts.

## Open decisions

- Modal deployed-function packaging, credential provisioning, and callback/polling mode.
- Estimate models and acceptable confidence by engine/workload beyond local development.
- Reservation/overrun policy when a provider cannot guarantee hard monetary caps.
- Regional data residency and provider allowlists by organization.
- SLURM agent architecture, trust bootstrap, artifact movement, and chargeback semantics.

See [calculation architecture](05_CALCULATION_ARCHITECTURE.md), [threat model](11_SECURITY_THREAT_MODEL.md), and [ADR-009](adr/ADR-009-compute-gateway-modal-first.md).
