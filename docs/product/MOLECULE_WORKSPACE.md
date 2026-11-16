# Molecule Workspace

## Document structure

Subviews: **2D Structure**, **Scientific 3D**, **Studio 3D**, **Properties**, **Orbitals**, **Vibrations**, **Calculations**, **History/Versions**. Subviews retain the same active StructureVersion and typed selection; unavailable views explain the required calculation/data instead of showing placeholders.

Ketcher is the 2D foundation. 3Dmol.js supplies scientific/reference 3D. Three.js supplies Studio presentation. Both 3D modes consume the same ScientificScene; switching renderer preserves camera/selection where compatible and never changes coordinates, bonds, grids, vectors, or scientific values.

## Tool model

| Group | Actions | Primary exposure |
|---|---|---|
| Select | atom, bond, fragment, region | primary toolbar; contextual selection menu |
| Build | element, bond, ring, fragment, add H | primary 2D toolbar + grouped flyouts |
| Modify | move, rotate, delete, charge, bond order, geometry cleanup, constraints | context toolbar/inspector; preview for scientific change |
| Measure | distance, angle, dihedral, coordinates | compact measurement tool; persistent annotation optional |
| Analyze | optimize, conformers, orbitals, ESP, frequencies, NMR, properties | Analyze menu, AI Scientist, command palette |
| Display | representation, labels/numbers/H, axes, surfaces | viewport toolbar + inspector |

Do not show every action permanently. The primary toolbar carries frequent select/build/undo/redo; contextual toolbar reflects selection; grouped menus expose the rest; `⌘K` and AI call the same actions.

## Editing and versions

- Editing begins in a draft fork of the active StructureVersion.
- Undo/redo affects the draft. Save creates a named immutable version with parent and operation log; Save as variant creates a sibling branch.
- AI-generated chemical edits default to a previewed variant labeled with model/agent provenance.
- Geometry cleanup/3D generation is a deterministic operation with algorithm/version/settings; it never silently replaces uploaded coordinates.
- Charge, multiplicity, hydrogens, stereochemistry, aromaticity, atom mapping, and coordinate source are visible where relevant.

## Viewport character and motion

Use a soft, cool laboratory background with subtle depth cues, restrained environment lighting, clear axes/measurements, and no decorative particles, glow, or idle rotation. Scientific motion is allowed only for actual normal-mode displacement vectors, optimization/MD trajectories, conformer transitions with data, or calculated reaction path/IRC. Reduced-motion substitutes phase frames, vectors, and step controls.

## Orbitals and surfaces

Selector supports HOMO−n through LUMO+n and named/numbered molecular orbitals. Surface types: orbital, electron density, ESP, and later spin density. Controls:

- isovalue with validated range/default and reset;
- opacity, positive/negative phase visibility and legend;
- molecular opacity/representation;
- clipping plane/box, surface style, camera/projection;
- source calculation, method/basis, orbital index/energy/units where applicable, grid artifact/provenance.

Changing presentation never recalculates or modifies the grid. A missing orbital artifact cannot be filled by generative approximation.

## Vibrations

Mode list shows index, frequency, intensity where available, imaginary-status, assignment/mapping, and provenance. Controls: play/pause, frequency/mode, amplitude (visual scale labeled), speed, vectors, loop, optional phase scrub. Atomic movement is always derived from actual mode vectors. Spectrum selections can activate a mapped mode; ambiguous mapping exposes candidates/confidence.

## Properties and history

Properties separate intrinsic structure metadata, derived deterministic descriptors, and calculation results. History displays version graph, author/AI source, edit summary, timestamps, parent, validation, related calculations and comparison entry points. No value loses its provenance token/trace.

See [scientific visualization UX](../design/SCIENTIFIC_VISUALIZATION_UX.md) and [molecule wireframes](../wireframes/MOLECULE_WIREFRAMES.md).
