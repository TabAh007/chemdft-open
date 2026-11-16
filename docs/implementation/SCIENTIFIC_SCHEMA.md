# Scientific Schema Implementation

Status: Phase 3 structure foundation complete as of 2026-09-11.

## Contract authority and versioning

Strict Pydantic models under `services/api/src/chemdft_api/contracts/` are canonical. They reject unknown fields, are immutable after validation, and carry `schema_version = 1.0.0` where serialized independently. `pnpm schemas:generate` emits deterministic JSON Schema 2020-12 and generated TypeScript under `packages/schemas/`; `pnpm schemas:check` detects drift.

Compatibility is semantic as well as syntactic: patch releases may clarify or safely correct constraints, minor releases are additive only for tolerant consumers, and breaking shape or meaning changes require a major version and migration. Long-lived artifact/result rows persist their validating schema version.

Scientific identifiers remain opaque UUIDs consistent with Phase 1 UUIDv4 identifiers. Mutable names never determine identity. UUIDv7 is deferred until a deliberate migration and measured ordering/index need justify mixed-version complexity.

## Domain classification

`Contract` means canonical validation shape, `Relational` means persisted identity/relationships now, `Artifact` means immutable object-storage content, and `Read model` means derived presentation/query shape.

| Concept | Phase 2 classification |
|---|---|
| Sample | Contract; relational persistence in the workflow phase that creates samples |
| Structure | Contract and relational project-scoped identity |
| StructureVersion | Immutable contract and relational version record; raw plus normalized representation artifacts |
| Conformer | Contract with parent StructureVersion; coordinate artifact; persistence deferred |
| Experiment | Contract with typed modality extension; persistence deferred until import workflows |
| ExperimentalDataset | Immutable raw/derived contract plus artifact; persistence deferred until import workflows |
| Spectrum | Typed derived contract/read model plus data artifact |
| ExperimentalSeries | Non-spectrum series contract for TG/DTA and DLS plus data artifact |
| Calculation | Contract and minimal relational lifecycle identity |
| CalculationSpecification | Immutable versioned contract embedded in CalculationInput persistence |
| CalculationInput | Contract and immutable relational record; normalized content is an artifact |
| CalculationResult | Contract and immutable relational result envelope; large/raw output remains artifacts |
| ScientificArtifact | Contract, relational metadata, immutable object content, SHA-256 verification |
| ScientificMethod/BasisSet/Engine | Validated references; no premature exhaustive registry tables |
| ProvenanceRecord | Contract and relational lineage/subject record with DAG inputs |
| Evidence/Hypothesis/UserCorrection | Immutable contracts; workflow persistence deferred |
| Citation/KnowledgeSource | Contracts; knowledge persistence remains a later phase |
| AuditEvent/ToolInvocation | Append-only contracts and relational records |

No universal `ScientificObject` table or unbounded metadata dictionary exists. Extensions are namespaced, versioned, scalar-only, and bounded in count and key/value size.

## Units, coordinates, and values

`ScientificQuantity` stores a finite machine number, an explicit `UnitReference`, optional source unit, optional uncertainty/precision, and approximation state. A unit reference declares `UCUM` or `QCSCHEMA`, a bounded code, and a quantity dimension. Authoritative payload types must narrow allowed unit/dimension combinations for their result family; formatted locale strings are display-only.

Source units are preserved. Display conversion creates presentation values and never rewrites the canonical stored value. Phase 3 does not implement a general conversion engine. Coordinate contracts separately require Cartesian/fractional system, ångström/bohr unit, three dimensions, fixed atom ordering, source, and owning StructureVersion. Periodic structures add a typed `PeriodicCell` with lattice vectors plus conventional a/b/c/alpha/beta/gamma display values.

## QCSchema interoperability

ChemDFT maps supported atomic inputs through an exchange adapter instead of adopting QCSchema as its whole domain. The Phase 2 subset follows QCElemental 0.50.2's QCSchema v2 definitions: AtomicInput version 2, AtomicSpecification, and Molecule version 3 with flat Cartesian bohr geometry. Only energy and frequency-to-Hessian mappings are currently representable; no engine runs.

QCElemental was evaluated but not installed because 0.50.2 fails to import with pinned Pydantic 2.13.5. Compatibility is checked against the inspected upstream tag/commit using a synthetic golden, fixed schema names/versions, flat `3N` validation, and rejection of implicit unit conversion. Re-evaluate before Phase 5 execution.

## Persistence and immutability

Migration `0002_scientific_domain_foundation` adds artifact metadata, provenance/lineage, calculation/input/result, audit, and tool-invocation tables. Composite `(id, project_id)` foreign keys prevent cross-project persisted references for artifacts, calculations, inputs, provenance, and results. Application validation covers generic lineage references until their target tables exist.

Migration `0003_molecule_crystal_workspace` adds `structures` and `structure_versions`. Revisions are server-assigned, `(structure_id, revision)` is unique, and parent/source/canonical/provenance references are project-scoped through composite constraints. StructureVersion rows are append-only.

Scientific artifacts, provenance inputs/records, structure versions, calculation inputs/results, audit events, and tool invocations reject ORM update/delete operations. Corrections, verification, dispute, retraction, and supersession append records rather than changing scientific history.
