# Workspace Wireframes

Low-fidelity interaction architecture only; dimensions, names, and values are illustrative UI content—not scientific, price, or product-performance claims.

## 1. Empty / new project

```text
┌ ChemDFT ─ ASPHALTENE STUDY ───── Search / ⌘K ─ Jobs 0 ─ Budget ─ User ┐
├──┬──────────────────┬──────────────────────────────────┬───────────────┤
│P │▾ ASPHALTENE STUDY│ What would you like to do?       │ INSPECTOR  AI│
│J │  Overview        │                                  │               │
│  │  Samples       0 │ Draw a molecule   Import structure│ Project ready│
│  │  Structures    0 │ Upload experiment Import result   │ No selection  │
│  │  Experiments   0 │ Upload paper      Ask ChemDFT     │               │
│  │  Calculations  0 │                                  │ [Ask ChemDFT] │
│  │  Literature    0 │ Skip setup / open command palette │               │
│  │  Reports       0 │                                  │               │
├──┴──────────────────┴──────────────────────────────────┴───────────────┤
│ Ready · no active jobs                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

No dashboard metrics or placeholder science. Choosing an action opens the corresponding document/import surface; Skip leaves a clean Overview.

## 2. PDF ingestion / extracted evidence

```text
┌ [Paper: Chromium CVD…] ────────────────────────────────┬ EVIDENCE ─────┐
│ PDF page 6 / 10                                       │ Detected 12   │
│ ┌────────────────────────────────────────────────────┐ │ ▾ Methods 3   │
│ │ … highlighted paragraph / table / figure region … │ │ ▣ 900 °C     │
│ │                                                    │ │ page 6 · text│
│ │ Figure 3                         [selected region] │ │ [Accept]      │
│ └────────────────────────────────────────────────────┘ │ △ 42.1 nm     │
│ thumbnails · search · previous/next                    │ Fig 3 · low   │
│                                                        │ [? AI structure]
│                                                        │ Needs review  │
├────────────────────────────────────────────────────────┴───────────────┤
│ Source: original PDF · hash … · parser v… · [Open raw]                 │
└─────────────────────────────────────────────────────────────────────────┘
```

Selecting a ledger item focuses exact page coordinates. Accept/Correct/Ignore/Promote never changes its source class.

## 3. Crystal editor

```text
┌ [Crystal: Sample A] [Sites] [Symmetry] [XRD] ─────────┬ CELL ──────────┐
│ Tools: Select · Measure · Plane · Replicate · Supercell│ a  [value] Å   │
│                                                       │ b  [value] Å   │
│          z              periodic cell                 │ c  [value] Å   │
│          │       ┌──────────────┐                     │ α β γ 90°      │
│          └── y  / selected (111)/                     │ keep fractional│
│             /x   └──────────────┘                     │                │
│                                                       │ Symmetry       │
│ Replication (display): 2 × 2 × 2                      │ source / found │
├───────────────────────────────────────────────────────┼────────────────┤
│ Sites: #  species   x      y      z     occupancy     │ Validation 2   │
│        1  Si       .000   .000   .000   1.00          │ Provenance     │
└───────────────────────────────────────────────────────┴────────────────┘
```

Display replication is not a supercell edit. Cell/site/symmetry changes preview and save as a new version.

## Docking variants

Large desktop may show Inspector and AI split. Laptop switches them in one dock. Tablet uses explorer/context sheets. Mobile uses project/document routes and does not expose precision editing.
