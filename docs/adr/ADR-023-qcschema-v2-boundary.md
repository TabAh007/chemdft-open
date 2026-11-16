# ADR-023: QCSchema v2 at an explicit exchange boundary

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

QCSchema standardizes quantum-chemistry exchange but does not model ChemDFT projects, samples, experiments, evidence, permissions, or result authority. Current QCElemental 0.50.2 was evaluated as a validator, but its released v2 models fail to import with ChemDFT's pinned Pydantic 2.13.5.

## Decision

Keep ChemDFT contracts independent and map supported atomic calculations through an explicit QCSchema v2 adapter. Phase 2 tests pin the upstream shapes inspected at QCElemental tag `v0.50.2` / commit `b09840dd34491a29eb0ed153737fac3f165c9e0e`: `qcschema_atomic_input` version 2, `qcschema_atomic_specification`, and `qcschema_molecule` version 3.

QCSchema atomic coordinates are emitted only from explicit Cartesian bohr inputs. Phase 2 rejects implicit ångström conversion instead of embedding an unreviewed conversion layer. QCSchema outputs and engines remain unavailable.

## Consequences

No QCElemental or QCEngine dependency is added. Compatibility is tested with a small synthetic exchange golden, fixed schema identifiers/versions, flat `3N` geometry, and adapter rejection cases. Re-evaluate QCElemental when its release is compatible; add full upstream validation before engine execution.
