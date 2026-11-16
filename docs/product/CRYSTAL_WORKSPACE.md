# Crystal and Materials Workspace

## Purpose

Periodic structures require a dedicated workspace; Ketcher is not used as a crystal editor. The workspace is designed around pymatgen/ASE-compatible deterministic structures and transformations in later implementation phases.

## Layout

- Central unit-cell/periodic viewport with axes, cell edges, selected atoms/sites/planes, and replication boundary.
- Left/local tools for select, translate/transform, measure, plane, replication, supercell, and display.
- Inspector sections for Cell, Sites, Symmetry, Occupancy, Replication, Validation, and Provenance.
- Document subviews: **Crystal**, **Sites**, **Symmetry**, **XRD**, **Calculations**, **History**.

## Cell editor

Display/edit `a`, `b`, `c`, `α`, `β`, `γ` with explicit units, precision, and coordinate convention. Cartesian/fractional site coordinates are switchable views of one canonical model; conversions are deterministic and do not introduce silent rounding. Editing cell parameters requires an explicit policy for keeping fractional or Cartesian positions, previewed before commit.

## Site table

Virtualized table columns: site index/label, element/species, fractional `x y z`, optional Cartesian values, occupancy, oxidation state where sourced, selected group, and validation warnings. Multi-select links table and viewport. Disorder/partial occupancy is preserved; unsupported semantics block destructive normalization.

## Symmetry

Show reported source symmetry separately from deterministically detected symmetry, including tool/version/tolerance. List space group, operations, equivalent sites, and deviations. “Apply/symmetrize” creates a previewed StructureVersion and never rewrites the source CIF.

## Unit cell, replication, supercells

Replication is display-only until the user explicitly creates a supercell. `n×m×p` display controls show viewport instances without changing the structure. Supercell transforms show matrix, resulting atom count, estimated cost impact, and create a new version. Warn before explosive cell sizes.

## Crystallographic planes and XRD

Plane tools use Miller indices, draw deterministic plane geometry, and expose spacing/source calculation. Selecting an XRD peak may highlight mapped planes/phases where data and method support it. Multiple candidates and confidence remain visible; AI explanations cite the mapping record.

## Import/export and failure

CIF is primary; POSCAR support is later/where appropriate. Import preview shows parser, source cell, sites, occupancy, symmetry claims, warnings, and unsupported fields. Invalid lattice, overlapping sites, ambiguous disorder, or unsupported magnetic/constraint semantics are never silently repaired. Export includes version/provenance and warns about fields the target format cannot preserve.

See [crystal wireframe](../wireframes/WORKSPACE_WIREFRAMES.md#3-crystal-editor) and [linked visualization](../design/SCIENTIFIC_VISUALIZATION_UX.md).
