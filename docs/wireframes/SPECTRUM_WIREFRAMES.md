# Spectrum Wireframes

All names, values, mappings, and metrics are illustrative UI content—not authoritative scientific results.

## 8. FTIR + molecule linked mode

```text
┌ [FTIR-02] [Calc IR #142] [Compare] ────────────────────────────────────┐
│ Pan Zoom Reset Cursor Peaks Overlay Pipeline                    Export │
├────────────────────────────────────────────┬────────────────────────────┤
│ FTIR intensity                             │ Candidate A · Vibrations   │
│       experimental ─────                   │                            │
│       calculated  - - -                    │      atoms 4,7 highlighted │
│              │ selected 1718 cm⁻¹          │      actual mode 43 vectors│
│ ____________/\___________ wavenumber       │                            │
│ 2000       1718          1200 cm⁻¹         │ [Play] amplitude 1.0×      │
├────────────────────────────────────────────┼────────────────────────────┤
│ Peak mapping                               │ MAPPING                     │
│ 1718 exp ↔ mode 43 calc · confidence: mod. │ method… alternatives 2     │
│ ○ EXPERIMENTAL  ◇ CALCULATED               │ [Why am I seeing this?]     │
└────────────────────────────────────────────┴────────────────────────────┘
```

Plot selection, mode selection, atom highlight, and inspector are one linked selection. Animation uses actual displacement vectors; reduced motion uses arrows/phase frames.

## 9. Experimental versus calculated comparison

```text
┌ Compare: FTIR-02 ↔ Calculated IR #142 ─────────────────────────────────┐
│ [Overlay] Side by side  Residual   Zoom linked ✓   Mapping v2          │
├─────────────────────────────────────────────────────────────────────────┤
│ ○ EXPERIMENTAL raw→baseline→peaks      ◇ CALCULATED PySCF/method…      │
│       ───────────────                     - - - - - - -                 │
│          /‾\    /‾\    overlay / residual                                    │
│ ________/   \__/   \_______________________________ cm⁻¹               │
├────────────────────────────────────┬────────────────────────────────────┤
│ Metrics · algorithm / units        │ AI EXPLANATION (optional)          │
│ matched peaks 18/23                │ mismatch at [1718 cm⁻¹], evidence… │
│ scale factor …                     │ ambiguity and alternatives…        │
└────────────────────────────────────┴────────────────────────────────────┘
```

Each side keeps independent provenance. Scaling/alignment is explicit and versioned. AI closed leaves the complete comparison usable.

## Processing pipeline

```text
RAW FTIR-02 (immutable)
 ├─ Branch A: baseline(v2, params…) → smoothing(v1, 9/3) → peaks(v3)
 └─ Branch B: baseline(v4, params…) → peaks(manual corrections)
```

Selecting any node previews/opens that derived dataset; delete/reorder never mutates raw.
