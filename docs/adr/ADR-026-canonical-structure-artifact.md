# ADR-026: Canonical normalized structure artifact

Status: Accepted

Date: 2026-09-11

## Context

Phase 3 needs persistent molecular and periodic structure versions without overwriting raw SDF, XYZ, or CIF uploads. Future renderers and calculation inputs need a stable ChemDFT representation, but no toolkit-native object should become the domain model.

## Decision

ChemDFT stores every committed StructureVersion with:

- the immutable original source artifact; and
- a deterministic normalized ChemDFT JSON artifact, `application/vnd.chemdft.structure+json`.

The normalized artifact contains atom/site order, element/atomic number, coordinates, bonds where authoritative, charge, multiplicity, diagnostics, and optional periodic cell. Serialization is UTF-8 JSON with sorted keys and a trailing newline.

## Consequences

- Raw source and normalized representation can evolve independently.
- Hashes identify exact serialized representation, not universal chemical identity.
- Phase 4 visualization and later calculation inputs can consume one stable representation.
- Large-structure scaling may move representation payloads to chunked or specialized artifacts without changing StructureVersion identity.
