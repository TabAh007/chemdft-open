# Scientific Scene Model

Status: Phase 4 implemented.

`packages/scientific-scene` is the renderer-neutral visualization boundary. It converts authorized Phase 3 `StructureVersionDetail` read models into serializable `ScientificScene` data consumed by both 3Dmol.js Scientific Mode and Three.js Studio Mode.

## Boundary

The package may contain:

- scene types and schema version;
- deterministic `StructureVersionDetail` → `ScientificScene` builder;
- Cartesian display coordinate transforms;
- fractional → Cartesian conversion using `PeriodicCell.lattice_vectors`;
- Bohr → Ångström display-unit conversion;
- element colors and covalent / van der Waals radii with documented source conventions;
- renderer-neutral selection, camera, representation, labels, background, and supercell display state;
- distance, angle, and dihedral measurement math;
- bounded visual-only supercell expansion.

It must not depend on React, Next.js, Blueprint, 3Dmol.js, Three.js, Ketcher, RDKit, pymatgen, or any database/API runtime.

## Authority

Rendering is not scientific authority.

```text
StructureVersionDetail
  → ScientificScene
  → renderer adapter
  → pixels
```

The scene builder does not mutate the source `StructureVersion`. Centering, camera, labels, representation, lighting, material, selection, and screenshot export are visualization state only.

## Periodic semantics

Periodic fractional coordinates are rendered by multiplying the fractional coordinate by the actual lattice vectors. The renderer does not reconstruct an approximate orthogonal cell from `a/b/c` and angles. Measurements on periodic scenes are explicitly reported as display-Cartesian and do not silently apply a minimum-image convention.

## Element data

Phase 4 includes a compact deterministic visualization dataset for common elements used by tests and ordinary organic/inorganic structures:

- conventional chemistry colors follow CPK/Jmol-style conventions;
- covalent radii follow Cordero-style covalent radii conventions;
- van der Waals radii follow Bondi/common molecular-graphics conventions;
- alternate colorblind and monochrome palettes are display choices only.

This dataset is for visualization scale/color, not chemical identity or calculation.
