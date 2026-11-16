# Calculation, Compute Approval, and Job UX

## Quick / AI-assisted

Quick mode starts from a scientific intent (“Optimize structure”, “Calculate IR”). It shows the selected structure/version, recommended preset with rationale, engine `Auto` or explicit choice, method/basis/dispersion/solvent summary, charge/multiplicity, estimate range, and warnings. One primary **Review & run** action opens the approval step; low-cost auto-run occurs only under an explicit policy.

Example recommendations are illustrative UI content, not frozen scientific defaults. Phase 5 must validate actual presets before presenting them as recommendations.

## Advanced / expert

Progressively disclosed sections:

1. Task and target StructureVersion/Conformer.
2. Engine and version/capabilities.
3. Method, basis, dispersion, solvent/environment.
4. Charge, multiplicity, electronic state.
5. SCF and convergence settings.
6. Property-specific settings (frequency/NMR/TDDFT/orbitals/ESP).
7. Resources/priority/region/provider policy (provider-neutral by default).
8. Constraints/frozen atoms/coordinates.
9. Normalized input preview and preset/settings diff.

Validation is inline, exact, and deterministic. Unsupported combinations identify the field and capability; no generic “invalid settings.”

## Approval sheet

```text
CALCULATION PLAN                           PLAN v4
CREST conformer search            $0.06–0.10
xTB screening                     $0.04–0.08
DFT optimize top 5                $0.60–0.84
Frequencies                       $0.74–0.96
NMR                               $0.44–0.66
──────────────────────────────────────────────
Estimated total                   $1.88–2.64
Maximum authorized                $3.00 [editable ≤ policy]
Budget remaining after max        $12.40
Estimate valid until              14:32

[Edit plan]                                  [Authorize & run]
```

Figures are examples labeled illustrative. Production values come from the Compute Gateway. Approval binds plan revision, settings/input hashes, scope, estimate, cap, user/policy, and expiration. Material edits invalidate it. Platform, AI, and scientific compute costs remain separate.

## During execution

Show stage-level estimate/actual, cap consumed/remaining, cancel semantics, and partial completed stages. If projected work cannot stay within cap, do not start the next stage. Cancellation is honest about jobs already billed or not immediately interruptible.

## Job states

`DRAFT → VALIDATED → AUTHORIZED → QUEUED → RUNNING → {SUCCEEDED | FAILED | CANCELED}`.

Job rows/documents show name, structure/version, engine/method, stage, honest progress, elapsed time, remaining range only when reliable, compute class (not unnecessary provider marketing), accrued cost, state, logs, artifacts, retry, and cancel.

- Use percentage only from meaningful engine/stage telemetry.
- Otherwise use stage steps or indeterminate activity plus elapsed time.
- `SUCCEEDED` means execution finished; authoritative result publication additionally requires firewall validation.
- Nonconverged output is failed/partial with exact reason, not success with a warning buried in logs.

## Failures

Lead with scientific/system fact: “SCF did not converge after 100 cycles.” Then show affected stage, last valid state, cost, log excerpt/source, artifacts, and actions: Inspect log, Retry recommended settings, Modify settings, Ask AI Scientist. Retry creates a new attempt/draft and preserves the failed one.

Budget exceeded, stale estimate, compute unavailable, insufficient basis support, invalid charge/multiplicity, parser failure, provider interruption, cancellation, and firewall rejection each have distinct states and recovery paths.

See [calculation wireframes](../wireframes/CALCULATION_WIREFRAMES.md) and [AI-first workflow H](AI_FIRST_WORKFLOWS.md#workflow-h--expensive-agent-plan--estimate--approval--enforced-budget).
