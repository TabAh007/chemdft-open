# ADR-037: Server-Owned Approval Authorization

## Context
Scientific workflows involve actions with non-trivial financial costs or permanent side effects (such as GPU quantum chemistry runs, large cluster allocations, or destructive cancellations). If an AI could self-authorize or pass an `approved=true` flag, prompt injection or erratic model outputs could trigger unbounded compute charges.

## Decision
1. **Server-Side Action Classification**: Tool definitions explicitly declare their `PermissionClass` (`READ`, `LOW_COST_REVERSIBLE`, `EXPENSIVE`, `DESTRUCTIVE_EXTERNAL`). Expensive tools (`calculation.submit`) enforce `ApprovalPolicy.EXPLICIT`.
2. **Action Fingerprinting**: When an expensive tool is proposed by the planner, the AI Scientist service creates an `AIApprovalRecord` bound to:
   - Specific project ID
   - Exact tool name and semantic version
   - Normalized argument SHA-256 fingerprint
   - Expiration deadline (default 2 hours)
3. **Cryptographic / Server Verification**: During tool invocation, the Tool Registry's approval verifier validates that a matching `AIApprovalRecord` exists in state `APPROVED`, belongs to the project, has matching argument fingerprints, and has not expired. The model cannot self-approve; only an authenticated project owner/editor can grant approval.
4. **Non-Replayable**: Altering arguments by even a single character invalidates the SHA-256 fingerprint, requiring a new approval request.

## Consequences
- **Positive**: Absolute protection against unauthorized compute spending or privilege escalation via prompt injection.
- **Negative**: Adds a human-in-the-loop approval step for high-cost actions.
