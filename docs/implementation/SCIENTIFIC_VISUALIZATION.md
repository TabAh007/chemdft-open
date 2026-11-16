# Scientific Visualization Implementation

Status: Phase 4 implemented.

## Renderers

ChemDFT now has two browser-only lazy visualization modes:

1. **Scientific 3D** — `3dmol@2.5.5`, loaded only when a committed structure version is displayed.
2. **Studio** — direct `three@0.186.0` renderer adapter for controlled atom/bond/cell geometry, lighting, instancing, disposal, and future publication-quality exports.

Both renderers consume the same `ScientificScene` object. Neither parses SDF/CIF directly and neither writes scientific state.

## Workspace behavior

The structure workspace builds a scene from the selected immutable version and offers compact workstation controls:

- Scientific 3D / Studio mode switch;
- ball-and-stick, sticks, wireframe, and space-fill representations;
- conventional, colorblind, and monochrome palettes;
- perspective / orthographic projection state;
- labels: off, element, atom index;
- unit-cell visibility and bounded display supercell for periodic structures;
- distance / angle / dihedral measurement selection;
- PNG export of the current WebGL viewport.

Atom table selection and renderer selection share stable atom indices. Version switching clears selection and measurement state and builds a new scene from the newly selected immutable version.

## Integrity and fallbacks

- XYZ structures with no canonical bonds render no bonds.
- CIF/periodic structures render sites and unit cells from canonical cell vectors and coordinates.
- Partial occupancy is displayed deterministically through opacity/metadata, never randomly realized.
- WebGL failures show specific fallback messages while tables and provenance remain available.
- Screenshot export is client-only in Phase 4 and does not create a `ScientificArtifact`.
- No fake orbitals, ESP, vibration, energy, charges, or calculated properties are displayed.
