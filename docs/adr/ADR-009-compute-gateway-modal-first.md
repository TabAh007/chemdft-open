# ADR-009: Provider-independent Compute Gateway; Modal first

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Compute cost, capability, and institutional requirements will span multiple providers and HPC environments.

## Decision

Define provider-neutral requirements, estimates, jobs, executions, and artifacts.

Phase 6 implements the local provider behind this gateway first so localhost and
verification stay durable and cloud-free. Modal remains the first cloud target,
but real Modal CPU/GPU execution is gated until server credentials and a deployed
pinned worker function exist. RunPod, public clouds, and BYOC/SLURM follow the
same provider interface later.

## Consequences

Chemistry code cannot import provider concepts. Routing and budget authorization are deterministic/auditable, and providers need conformance tests. See [Compute Gateway](../06_COMPUTE_GATEWAY.md).
