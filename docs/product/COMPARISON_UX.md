# Comparison Workspace

## Comparison types

- Structure or conformer A/B/C.
- Original versus user/AI-created variant.
- Calculated versus experimental spectrum.
- PySCF versus Psi4 verification or method/basis comparisons.
- Raw versus processed dataset or processing branch.
- Candidate structures ranked against multiple evidence sources.

## Layout selection

Use the representation that makes the scientific difference legible:

- **Side-by-side:** structures/crystals, provenance, parameter/result tables.
- **Overlay + residual:** compatible spectra/trajectories/curves.
- **Three-column original · difference · variant:** structural or pipeline changes where a deterministic diff exists.
- **Matrix/rank table:** more than two conformers/candidates/methods; selecting rows opens a focused A/B comparison.

Arbitrary overlay is blocked when units/axes/semantics are incompatible unless the user chooses and records a deterministic conversion.

## Synchronization

Linked camera, cursor, zoom, selection, frame/mode, and representation are explicit toggles and only activate for compatible views. A visible link indicator names what is synchronized. Unlinking one property does not break others. Spectrum selections focus the corresponding structure/mode through a stored mapping; camera synchronization never implies atom correspondence.

## Difference and metrics

Metrics name algorithm, alignment, units, parameters, and source versions. Examples: RMSD after chosen atom mapping/alignment, energy difference, peak residual/match score, frequency scaling, assignment coverage, parser/result field differences. “Better” requires a declared criterion; the AI cannot invent a universal ranking.

## Provenance and AI

Each side retains independent source/verification tokens and complete trace. Derived comparison has its own provenance and never converts calculated to experimental. AI explanation appears in a contextual evidence block and cites sides, mapping, metrics, conflicts, and uncertainty. The compare result remains usable with AI closed.

## Variants and processing

Originals are read-only references. Choosing “Use as current” changes the project pointer or creates a new version; it does not delete the other side. Before/after processing exposes every pipeline step and supports branching/reverting by creating derived versions.

## Export

Export combined figures, aligned data (when formats permit), metrics, settings, and a comparison manifest. Publication styling affects presentation only; source values and geometry remain intact.

See [comparison wireframe](../wireframes/SPECTRUM_WIREFRAMES.md#9-experimental-versus-calculated-comparison) and [linked visualization](../design/SCIENTIFIC_VISUALIZATION_UX.md).
