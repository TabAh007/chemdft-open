# Structure Import

Status: Phase 3 complete.

ChemDFT now imports SDF, XYZ, and CIF through deterministic adapters after raw bytes are persisted. The import path is:

```text
raw upload
  -> StoredFile
  -> ScientificArtifact STRUCTURE_FILE
  -> parser adapter
  -> canonical ChemDFT structure JSON artifact
  -> Structure + immutable StructureVersion V1
  -> provenance + audit
```

The original file is never rewritten. The normalized representation is stored separately as `application/vnd.chemdft.structure+json` with deterministic UTF-8, sorted-key JSON serialization. Its SHA-256 means "same serialized representation", not universal chemical identity.

## Adapters

- RDKit `2025.9.1` parses SDF/MOL and supports XYZ coordinate import. SDF preserves atoms, atom order, coordinates, formal charges, isotopes where present, and bonds. XYZ imports coordinates without pretending source bond connectivity exists.
- pymatgen `2025.10.7` parses CIF into periodic structures with lattice parameters, lattice vectors, fractional coordinates, species, and occupancy.
- Toolkit-native objects do not cross adapter boundaries. Public contracts, database rows, and TypeScript schemas use ChemDFT contracts only.

## Application actions

- `structure.import` is implemented as an application action and exposed through REST upload/import flow.
- `structure.version.create` creates a new immutable manual-edit version and is executable through the Tool Registry.
- Import through the Tool Registry is deferred because tool invocations currently operate on existing artifact references, while the browser import flow must upload bytes first.

## Authority

Structure origin is server-owned:

- imports produce `IMPORTED`;
- user/editor saves produce `MANUALLY_EDITED`;
- `OPTIMIZED` is forbidden in Phase 3 because no qualifying deterministic calculation result exists.

All committed versions carry provenance, audit, project scope, source artifact references, normalized artifact references, and server-assigned revisions.
