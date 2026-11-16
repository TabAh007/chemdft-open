# Provenance UX

## Compact vocabulary

Source class and verification are orthogonal:

```text
○ EXPERIMENTAL        directly imported measurement
◇ CALCULATED          deterministic engine result
▣ EXTRACTED           explicitly written in source
△ DIGITIZED           approximate reconstruction
? AI HYPOTHESIS       non-authoritative proposal
✓ VERIFIED            independent validation state
```

Glyphs are paired with localized text on first/important use; color reinforces but never carries meaning alone. Compact tables may show a glyph plus abbreviation with accessible name. `VERIFIED` appears separately: `◇ CALCULATED  ✓ Verified`. Approximate/needs-review states use plain words, not only warning color.

## Display hierarchy

- **Inline:** compact glyph/label beside important values, assignments, results, and evidence.
- **Hover/focus card:** source class, validation, producer/date, uncertainty, immediate source.
- **Inspector:** complete trace and relationships.
- **Trace view:** result → job → method/settings → engine/version → input StructureVersion/coordinates → raw artifact/compute execution, or experimental datum → dataset → processing chain → raw upload.

Users can invoke **Why am I seeing this value?** from value context menu, inspector, or AI reference. This opens a deterministic trace; the AI may summarize it but is not the source of the trace.

## Source-specific UX

- `EXPERIMENTAL`: instrument/source file, acquisition context, importer/parser, sample link, raw download, derived pipeline.
- `CALCULATED`: calculation/job, method/basis/settings, engine/version, convergence, input geometry, raw output/grid.
- `EXTRACTED`: page/table/section quote region or coordinates; represents what the source states, not raw data.
- `DIGITIZED`: figure region, digitization method, calibration/axes, uncertainty and “Approximate.”
- `AI_HYPOTHESIS`: originating agent/model/run, rationale/evidence links, “Needs review,” accept/reject/verify actions.

## Corrections and conflicts

Correct creates an append-only UserCorrection or new derived/entity version, with author/reason. Conflicting sources appear side by side; ChemDFT does not silently select one. Superseded/retracted records remain traceable and are excluded from default actions only by explicit policy.

## Density rules

Do not badge every cell. Use a source column for provenance-heavy tables, group repeated source classes in section headers, and reserve full labels for first occurrence/ambiguity. Inspector and keyboard-focus details must remain available. Provenance cannot be hidden to achieve a cleaner screenshot.

See [scientific integrity](../02_SCIENTIFIC_INTEGRITY.md), [data provenance](../08_DATA_PROVENANCE.md), and [ADR-015](../adr/ADR-015-provenance-first-class.md).
