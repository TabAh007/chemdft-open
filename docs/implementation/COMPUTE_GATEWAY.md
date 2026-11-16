# Compute Gateway Implementation

Phase 6 implements a database-backed compute gateway foundation.

## Boundary

`CalculationSpecification` remains scientific intent. `ComputeRequirement` and
`ExecutionRequest` are provider-neutral orchestration contracts. Local interpreter
paths and worker scripts are confined to `LocalSubprocessRequest` inside the local
provider.

## Durable records

- `compute_estimates`: append-only estimate snapshots with exact money fields.
- `compute_reservations`: internal reservation/reconciliation state.
- `compute_jobs`: durable queue row for one calculation input/workload.
- `compute_executions`: provider execution attempt and metering evidence.
- `compute_leases`: worker ownership, heartbeat deadline, and recovery state.

## Flow

1. API submit validates structure/specification/capability and stores immutable input.
2. Application action creates estimate, reservation, and `READY` job.
3. Worker claims a job, creates execution + lease + authorization hash, and transitions calculation to `RUNNING`.
4. Provider executes scientific worker.
5. Worker registers logs/result/environment artifacts.
6. Parser/validator/firewall publish authoritative result only if all checks pass.
7. Job, execution, reservation, and leases are reconciled.

Normal verification never requires cloud credentials.
