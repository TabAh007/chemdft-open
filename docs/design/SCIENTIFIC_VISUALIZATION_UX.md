# Scientific Visualization UX

## Deterministic selection contract

Every visual mark maps to stable scientific entity/version/sub-entity IDs and a source artifact. A selection event includes source view, selection type, value/units, mapping relationship if cross-view, confidence/ambiguity, and provenance. Views render this shared selection; the AI may explain it but cannot create a hidden association.

## Linked interactions

| Origin | Deterministic link | Destination behavior |
|---|---|---|
| FTIR peak/range | calculated peak ↔ normal mode mapping | focus region, select mode, highlight involved atoms, animate actual displacement vectors |
| NMR peak/multiplet | assignment record | highlight associated nuclei; show alternative assignments/confidence |
| HOMO/LUMO/orbital row | orbital grid artifact/index | render the exact grid/isovalue/phase; show source calculation |
| ESP point/region | volumetric grid sample | inspector shows coordinates, value/units/interpolation method |
| XRD peak | indexed plane/phase mapping | highlight plane/cell information and alternatives where supported |
| Energy/path point | structure/conformer/frame ID | select corresponding geometry and calculation state |

Approximate mappings use dashed link styling, confidence text, candidate count, and a direct “Inspect mapping” action. Manual reassignment creates a versioned correction; it does not overwrite algorithm output.

## Spectrum/chart behavior

Axes, units, direction, normalization/scaling, full-data versus display decimation, and provenance remain visible. Zoom/pan/cursor work without AI. Series use semantic line style and restrained colors; selected region/series receives accent and increased contrast. Keyboard/data-table alternatives expose the same peaks, values, assignments, and actions.

## Molecule/crystal viewport

Selection uses outline/halo with sufficient contrast, not color alone; inspector lists selected atoms/sites and coordinates. Measurement overlays show endpoints, unit, precision, and source coordinates. Axes/grid/cell/planes appear only when useful. Scientific and Studio renderers share scene data and selection identifiers.

Phase 4 implements this baseline for committed StructureVersion data: 3Dmol.js Scientific Mode and Three.js Studio Mode consume the same `ScientificScene`; atom table rows and viewports share atom-index selection; distance/angle/dihedral measurements use renderer-neutral geometry utilities; CIF unit cells use actual lattice vectors; bounded supercell display is labeled as display-only.

## Orbital/surface controls

Show orbital index/name, energy/units where produced, occupancy, calculation/method/basis, grid resolution/artifact, isovalue, opacity, phase legend, clipping, molecular representation, and reset. Changing display settings updates only a figure/scene view state. Exported figures include or link a manifest.

## Vibration controls

Play/pause, mode/frequency, intensity where available, amplitude visual scale, speed, vectors, loop, and phase scrub. Imaginary frequencies are unmistakable. Reduced motion defaults to vectors and step/phase frames. No interpolation between unrelated modes or invented atom movement.

## Color and uncertainty

Use scientifically conventional palettes only when their meaning is explicit (for example orbital phase or ESP scale), with legend, numerical domain, clipping/out-of-range behavior, and color-vision-safe alternatives where feasible. Confidence is text/numeric/category plus line/glyph treatment, never a green-to-red guess without scale.

## Empty/failure

Missing grid/mode/mapping says what calculation/artifact is required. Corrupt/incompatible artifacts identify parser/validation state. Partial results show only validated available layers; no decorative substitute image.

See [molecule workspace](../product/MOLECULE_WORKSPACE.md), [spectrum workspace](../product/SPECTRUM_WORKSPACE.md), and [ADR-018](../adr/ADR-018-linked-scientific-visualization.md).
