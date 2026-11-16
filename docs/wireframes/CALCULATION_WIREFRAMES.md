# Calculation Wireframes

All names, timings, cycles, statuses, and prices are illustrative UI content—not scientific, price, or product-performance claims.

## 10. Calculation running

```text
┌ DFT Optimization #142 · RUNNING ───────────────────────────────────────┐
│ Candidate A v3 · PySCF · method/basis · result not yet authoritative   │
│ Stage 3/5: geometry optimization            elapsed 04:18               │
│ Engine reports cycle 12; completion percentage unavailable             │
│ [indeterminate activity]                    estimate remaining 3–6 min  │
│ Compute: GPU class …    accrued $0.61    cap $2.20    remaining $1.59  │
│ [Cancel] [Open live log] [Artifacts]                                  │
├─────────────────────────────────────────────────────────────────────────┤
│ Stages: ✓ Validate  ✓ Prepare  ● Optimize  ○ Frequency  ○ Compare      │
└─────────────────────────────────────────────────────────────────────────┘
```

## 11. Completed calculation

```text
┌ DFT Optimization #142 · SUCCEEDED · result validated ─────────────────┐
│ Final geometry [Open]  Energy [value from engine]  Converged ✓         │
│ ◇ CALCULATED  ✓ VERIFIED (if independently checked)                    │
│ Method / basis / dispersion / solvent · engine v… · input v3           │
│ Actual compute $1.84 · authorized $2.20 · duration 09:42               │
│ [Orbitals] [Vibrations] [Compare] [Export] [Reproduce]                 │
├─────────────────────────────────────────────────────────────────────────┤
│ Why am I seeing this? → job → settings → engine → input → raw output   │
└─────────────────────────────────────────────────────────────────────────┘
```

`SUCCEEDED` is distinct from result firewall validation; this state shows both.

## 12. Failed / non-converged calculation

```text
┌ Frequency #143 · FAILED ────────────────────────────────────────────────┐
│ SCF did not converge after 100 cycles.                                  │
│ Last valid artifact: input geometry · no authoritative frequencies      │
│ Cost accrued $0.37 · job stopped · original calculation preserved       │
│                                                                         │
│ [Inspect log] [Retry recommended draft] [Modify settings] [Ask AI]      │
│                                                                         │
│ Details ▸ engine exit / convergence trace / compute execution / hashes  │
└─────────────────────────────────────────────────────────────────────────┘
```

Retry creates a new attempt/settings revision; it never changes the failed record.

## 13. Export

```text
┌ EXPORT ─────────────────────────────────────────────────────────────────┐
│ Source: Optimized Structure A · version v4 · calculation #142           │
│ Group:  Scientific  Visual  Publication  Report                         │
│ Format: [XYZ ▾]   Coordinates: optimized result                         │
│ ☑ Include provenance manifest    ☑ Include method/settings              │
│ Filename: candidate-a-optimized.xyz                                     │
│ Warning: XYZ cannot preserve bond order/formal charge.                   │
│ [Cancel]                                                [Create export]  │
└─────────────────────────────────────────────────────────────────────────┘
```

Publication export adds dimensions/background/legend/DPI; appearance never alters data.
