# Molecule Wireframes

All names and values are illustrative UI content—not authoritative scientific results.

## 6. Molecule editing

```text
┌ [Candidate A ● draft] ─ 2D │ Scientific 3D │ Studio │ Properties ─────┐
│ Select | Build ▾ | Modify ▾ | Measure ▾ | Analyze ▾ | Display ▾        │
├───────────────────────────────────────────────────────┬ INSPECTOR ─────┤
│                                                       │ Selected atom 7│
│                  editable 2D structure                │ Element   O    │
│                                                       │ Charge    0    │
│                                                       │ Coordinates — │
│                                                       │ Valence valid  │
│                                                       │               │
│                                                       │ Draft changes │
│                                                       │ replace bond… │
│                                                       │ [Save version]│
├───────────────────────────────────────────────────────┴────────────────┤
│ Original v3 preserved · undo 4 / redo 0 · AI changes create variant    │
└─────────────────────────────────────────────────────────────────────────┘
```

## 7. HOMO / LUMO

```text
┌ [Candidate A] ─ Orbitals ─────────────────────────────┬ ORBITAL ───────┐
│ Orbital: [HOMO-1] [HOMO] [LUMO] [LUMO+1]             │ LUMO · #64     │
│                                                       │ Energy  … eV   │
│           molecule + actual orbital surface           │ Occupancy 0    │
│          phase + / phase − legend                     │ Iso  [0.03]    │
│                                                       │ Opacity [70%]  │
│                                                       │ Phase + − both │
│                                                       │ Clip / style   │
│                                                       │ ◇ CALCULATED ✓│
│                                                       │ PySCF · method │
│                                                       │ [Why this?]    │
└───────────────────────────────────────────────────────┴────────────────┘
```

Switching an existing orbital is deterministic/no-token. Missing grids show the required calculation, never a decorative blob.

## Version history

```text
v1 imported ── v2 cleanup ── v3 optimized
                    └──── v2a AI variant · Needs review
```

Selecting a node updates the document; comparing nodes opens a dedicated comparison document.
