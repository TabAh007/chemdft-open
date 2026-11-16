# ADR-038: Resumable Asynchronous AI Runs

## Context
Quantum chemistry calculations (DFT, MP2, coupled cluster) can take seconds, minutes, or hours to converge. Holding an open HTTP request or active model process while awaiting scientific compute results would lead to connection timeouts, socket exhaustion, runaway LLM token costs, and catastrophic fragility across page refreshes or server restarts.

## Decision
1. **Asynchronous Run Lifecycle**: An AI run transitions from `EXECUTING` to `WAITING_FOR_CALCULATION` immediately upon submitting an approved calculation to the Compute Gateway, recording `waiting_calculation_id`.
2. **Immediate Connection Release**: The server completes the client request without holding the connection open. The client UI polls `GET /v1/projects/{id}/ai/runs/{run_id}` or listens to activity updates.
3. **Persisted State & Explicit Resumption**: All conversation, run, and step entities are persisted to durable relational storage. When the compute job transitions to `SUCCEEDED` or `FAILED`, the run is resumed via `POST /v1/projects/{id}/ai/runs/{run_id}/resume`, synthesizing the final grounded answer from the firewall-published `CalculationResult`.
4. **Survives Restarts**: Because state is fully database-persisted rather than in-memory, runs survive browser refreshes, network drops, and backend process restarts without losing conversation or tool execution history.

## Consequences
- **Positive**: High scalability, resilience against network interruptions, zero compute-time LLM billing.
- **Negative**: Requires state machine polling and explicit resume handlers on client and server.
