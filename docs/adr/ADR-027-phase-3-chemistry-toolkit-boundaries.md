# ADR-027: Phase 3 chemistry toolkit boundaries

Status: Accepted

Date: 2026-09-11

## Context

Phase 3 must import real molecular and crystal files without adding quantum chemistry execution, AI generation, or renderer authority. Toolkit classes are useful parser internals but cannot leak into public contracts.

## Decision

- Use RDKit `2025.9.1` for SDF/MOL/XYZ molecular parsing and serialization.
- Use pymatgen `2025.10.7` for CIF and periodic structure semantics.
- Use Ketcher `3.12.0` only as a browser editor adapter for molecule drafts.
- Do not adopt ASE in Phase 3 because CIF import does not require it.

Toolkit-native objects remain behind `scientific/adapters/`. Contracts, Tool Registry payloads, database records, and generated TypeScript expose only ChemDFT models.

## Consequences

- Phase 3 gets real chemistry import behavior without pretending toolkit aromaticity, valence, or renderer state is universal scientific truth.
- ASE can be reconsidered for interoperability/manipulation if a later phase has a concrete need and legal review accepts LGPL-2.1-or-later implications.
- Parser/process isolation remains required before broad production trust expansion.
