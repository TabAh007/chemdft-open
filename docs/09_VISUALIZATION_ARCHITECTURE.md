# Visualization Architecture

## Stack

- **2D chemistry/editing:** Ketcher, with RDKit-backed server validation/transformations.
- **Scientific/reference 3D:** 3Dmol.js.
- **ChemDFT Studio 3D:** Three.js plus a custom rendering layer.
- **Scientific charts:** Apache ECharts.
- **Large biomolecules later:** Mol*.
- **Dense tabular/raw expert views where useful:** TanStack Table and Monaco candidates.

## Shared scientific scene

Phase 4 implements the renderer-neutral scene model in `packages/scientific-scene`. This package depends only on generated ChemDFT contracts and contains scene types, deterministic coordinate transforms, element visualization data, bounded supercell display helpers, and geometry/measurement utilities. It must not import React, Next.js, Blueprint, 3Dmol.js, Three.js, Ketcher, RDKit, or pymatgen.

Scene generation currently happens in the browser from already-authorized `StructureVersionDetail` read models. This avoids adding a separate visualization API or Tool Registry action for a deterministic projection that has no independent authority. The API remains responsible for project authorization and authoritative structure/version retrieval; the browser scene builder is a tested presentation transform.

3Dmol.js and Three.js consume the same versioned, renderer-neutral `ScientificScene`; renderers never infer or alter chemistry for visual effect.

```text
ScientificScene
  source entity/version + provenance
  atoms/elements/coordinates/labels
  bonds and representation provenance
  periodic cell/symmetry instances
  volumetric fields + isovalues/sign/color policy
  vectors/modes + scale/time metadata
  selections/annotations/measurements
  units, coordinate frame, artifact hashes
```

Scene construction is deterministic from validated data. Three.js may improve lighting, PBR materials, antialiasing, ambient occlusion, contact shadows, camera behavior, surfaces, clipping, and publication presentation. It must not move atoms, change bonds, smooth away scientific features, or invent grids/vectors.

Camera, labels, representation, background, supercell display, and selection live in typed visualization state, not in `StructureVersion` or scientific provenance. Client-only PNG export of the current viewport is a visual export action and does not create a scientific artifact in Phase 4.

## Linked scientific visualization

The defining interaction is typed selection across coordinated scientific views:

- FTIR peak → calculated mode mapping → involved atoms → actual displacement vectors → evidence-linked explanation.
- NMR peak → assignment record → atom(s) highlighted in 2D/3D.
- HOMO/LUMO selection → actual calculated volumetric/orbital artifact rendered at explicit isovalue.
- XRD peak → indexed crystallographic association and relevant unit-cell/plane information where available.

A shared selection/event model uses stable entity IDs, never screen coordinates or labels as identity. Links record the matching algorithm, confidence, manual overrides, and provenance. AI explains a stored association; it does not fabricate one.

## Editing environments

1. **Molecule editor:** atoms, bonds, fragments, charge, hydrogens, structure operations.
2. **3D structure editor:** coordinates, distance/angle/dihedral, fragment transforms, constraints/freeze operations.
3. **Crystal/materials editor:** lattice, cells, symmetry, supercells, periodic structures, CIF/POSCAR using pymatgen/ASE.
4. **Spectrum editor:** peak picking, assignments, overlays, baseline/smoothing, appropriate integration, and calculated/experimental comparisons.

All meaningful edits support undo/redo during a session and commit to provenance-aware versions/variants. AI changes normally fork a variant instead of overwriting originals.

## Import/export rendering contracts

Plan for SDF/MOL/MOL2/XYZ/PDB; CIF/POSCAR; CUBE and supported Gaussian/ORCA/Psi4/PySCF outputs; CSV/JCAMP-DX/mzML; GLB/glTF/OBJ/STL where useful; and PNG/transparent PNG/SVG where technically valid. cclib is used where appropriate. Exports include units, source/result IDs, renderer/settings, and reproducibility metadata; scientific arrays remain available separately from images.

## Quality gates

- Golden scenes rendered in both engines from identical data.
- Unit/coordinate-frame and atom-index integrity tests.
- Surface/mode/image snapshots plus numerical checks on source arrays.
- Explicit UI labels for source class, approximation, units, isovalue, and animation scaling.
- No generative image model output in analytical result views.

See [ADR-012](adr/ADR-012-dual-3d-renderers.md) and [scientific integrity](02_SCIENTIFIC_INTEGRITY.md).
