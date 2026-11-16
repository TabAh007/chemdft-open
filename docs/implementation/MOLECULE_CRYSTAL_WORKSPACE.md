# Molecule and Crystal Workspace

Status: Phase 4 complete.

The project workstation now has a real structure workspace instead of a standalone chemistry demo. It supports the Phase 3 structure lifecycle and Phase 4 deterministic visualization while leaving quantum chemistry, AI, spectroscopy, and calculated result layers unavailable.

## Molecules

- SDF/MOL and XYZ imports create persistent `Structure` records and immutable `StructureVersion` records.
- The molecule workspace exposes structure metadata, atom table, bond table, diagnostics, provenance, and version history.
- Ketcher is treated as an editor adapter. Editor output must be converted to ChemDFT canonical representation and validated by the server before save.
- A save creates V(N+1); it never rewrites an existing committed version.
- 3Dmol.js Scientific Mode and Three.js Studio Mode visualize the selected immutable version through `ScientificScene`.
- Ball-and-stick, sticks, wireframe, space-fill, labels, selection, and distance/angle/dihedral measurements are visualization state only.

## Crystals

- CIF imports create `StructureKind.PERIODIC` versions.
- Periodic cell, lattice parameters, fractional site table, species, occupancy, diagnostics, provenance, and version history are exposed.
- CIF structures are not flattened into fake ordinary molecules.
- Fractional coordinates are converted to display Cartesian positions using the actual lattice vectors.
- Unit-cell and bounded display-supercell controls are visual-only and do not create new structure versions.

## UX boundary

Phase 4 intentionally avoids orbitals, ESP, vibrations, XRD analysis, calculations, and generated scientific demo data. The UI uses compact workstation panes, a dominant scientific viewport, scientific tables, provenance, and diagnostics. Mobile supports inspection; professional editing remains desktop-first.

## Accessibility

Canvas/editor affordances are backed by nonvisual atom, bond, unit-cell, and site tables. Parser warnings are text-visible and not color-only.
