# AI Scientist Wireframes

All names, durations, confidence labels, and prices are illustrative UI content—not scientific, price, or product-performance claims.

## 4. AI-requested calculation

```text
┌ CENTRAL: Structure A / 3D ────────────────┬ AI SCIENTIST ──────────────┐
│                                           │ YOU                         │
│            selected molecule              │ Optimize this structure,   │
│                                           │ calculate IR, compare FTIR-02
│                                           │                             │
│                                           │ ANALYSIS PLAN · Draft v1    │
│                                           │ 1 Validate Structure A      │
│                                           │ 2 Optimize geometry         │
│                                           │ 3 Frequency calculation     │
│                                           │ 4 Compare with FTIR-02      │
│                                           │ 8–12 min · $0.74–1.10       │
│                                           │ [Review settings] [Review]  │
└───────────────────────────────────────────┴─────────────────────────────┘
```

The plan is a structured, non-executing object. Entity names select/open central documents; no giant bubbles.

## 5. Approval request

```text
┌ CALCULATION PLAN · v3 ─────────────────────────────────────────────────┐
│ Stage                              Runtime         Estimate             │
│ CREST conformers                   1–2 min         $0.06–0.10           │
│ xTB screen                         <1 min          $0.04–0.08           │
│ DFT optimize top 5                 4–7 min         $0.60–0.84           │
│ Frequency                          3–5 min         $0.74–0.96           │
│ ────────────────────────────────────────────────────────────────────── │
│ Estimated total                                    $1.44–1.98           │
│ Maximum authorized                                 [$ 2.20]             │
│ Remaining project budget after max                 $12.40               │
│ Estimate expires 14:32 · settings hash … · EXPENSIVE                   │
│ [Edit plan] [Cancel]                         [Authorize & run]           │
└─────────────────────────────────────────────────────────────────────────┘
```

Changing settings or plan invalidates approval and recalculates the estimate. The AI cannot activate the button or alter the server cap.

## Evidence-linked explanation

```text
│ RESULT COMPARISON · linked to Compare FTIR-02 / Calc IR #142           │
│ Largest mismatch: [1718 cm⁻¹]                                          │
│ ◇ CALCULATED mode 43 ↔ ○ EXPERIMENTAL peak 1718 · confidence: moderate │
│ Evidence: [mapping details] [source calculations]                       │
│ Uncertainty: two neighboring modes remain plausible.                    │
│ Suggested: inspect mode 43 and alternative mode 41.                     │
```

Activating 1718 cm⁻¹ focuses the plot, mapped atoms, and actual mode vectors. Confidence is mapping metadata, not conversational styling.
