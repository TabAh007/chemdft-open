# Conceptual Domain Model

This is an ownership and invariant model, not a frozen database schema. IDs are stable and globally unique; mutable scientific objects are versioned; cross-project access is denied by default.

Phase 3 adds real structure persistence and import/version actions on top of the Phase 2 contract foundation. Structure and StructureVersion are now relational, project-scoped, immutable where scientifically meaningful, and backed by raw plus normalized artifacts. The complete contract/relational/artifact/read-model classification is in [Scientific Schema Implementation](implementation/SCIENTIFIC_SCHEMA.md).

## Identity and tenancy

- **User**: human identity and preferences.
- **Organization**: billing, policy, and isolation boundary.
- **Membership**: user role within an organization.
- **Project**: scientific collaboration and default authorization boundary, owned by an organization or permitted personal tenant.
- **ProjectMember**: project-specific role and permissions.

Organization and project IDs must be enforced from authenticated context, never accepted as sufficient authorization from a client payload.

## Scientific subjects

- **Sample**: physical or conceptual material under study; links experiments and candidate structures without assuming identity is proven.
- **Structure**: stable chemical identity/work item.
- **StructureVersion**: immutable molecular or periodic representation plus parent/edit provenance, source artifact, normalized representation artifact, diagnostics, and server-assigned revision.
- **Conformer**: coordinate-bearing variant associated with a structure version and generation method.

Scientifically meaningful edits create a new StructureVersion or variant. Original uploads and representations remain immutable.

Phase 3 supports SDF, XYZ, and CIF imports. XYZ connectivity is not fabricated. CIF remains periodic with lattice/cell/site semantics. `OPTIMIZED` origin is forbidden until a qualifying deterministic calculation result exists.

## Experimental data

- **Experiment**: context, method, sample, acquisition metadata, operator, and conditions.
- **ExperimentalDataset**: immutable raw or normalized data artifact with parser/transform lineage.
- **Spectrum**: typed spectral representation and axes/units derived from a dataset.
- **ScientificDocument**: immutable project-scoped publication/report record linked to a raw document artifact and bounded parser metadata.
- **EvidenceCandidate**: source-linked reported text/table/figure candidate. Its `EXTRACTED` or `DIGITIZED` class remains distinct from `EXPERIMENTAL` regardless of review state.
- **DocumentSourceAnchor**: durable page/source-type/snippet and normalized region locator for evidence navigation.

Peak picks, baselines, smoothing, integrations, and assignments are versioned derived analyses. They never overwrite source measurements.

## Calculations

- **Calculation**: scientific intent and method family applied to a precise structure/conformer version.
- **CalculationSpecification**: engine-neutral scientific request: task, method/basis, dispersion/solvation, charge/multiplicity, constraints, SCF options, and requested properties.
- **CalculationInput**: exact immutable StructureVersion/Conformer and artifact references plus a versioned CalculationSpecification.
- **CalculationJob**: orchestration state, attempts, authorization, and links to compute executions.
- **CalculationResult**: validated normalized result published through the Scientific Result Firewall.
- **CalculationArtifact**: content-addressed raw input/output, checkpoints, grids, or logs.
- **ScientificMethod**, **BasisSet**, **Engine**: extensible versioned references rather than exhaustive enums; engine records implementation and adapter versions.

A retry is a new attempt/execution, not a rewrite of history. Results point to exact inputs and successful jobs.

## Compute

- **ComputeRequirement**: provider-neutral CPU/RAM/GPU/VRAM/CUDA/runtime/region constraints.
- **ComputeProvider**: adapter/capability identity, not embedded in chemistry contracts.
- **ComputeEstimate**: time/cost range and validity window for a normalized requirement.
- **ComputeExecution**: one provider attempt with metering, environment, state, and artifacts.

## Knowledge and reasoning

- **Paper**: bibliographic identity.
- **Citation**: precise support relationship to page/section/table/figure/coordinates when possible.
- **KnowledgeSource**: immutable uploaded or external source and ingestion versions.
- **Evidence**: typed claim-to-source/result relationship with direction, strength, and provenance.
- **Hypothesis**: explicitly non-authoritative scientific proposal and lifecycle.
- **UserCorrection**: append-only correction/supersession with reason and author.

Relationships live in PostgreSQL from the start so a future graph projection can be added without replatforming.

## AI interaction

- **Conversation**: project-scoped communication container.
- **AgentRun**: model, gateway route, policies, plan, and outcome for one run.
- **ToolCall**: typed action request/response, permission decision, input/output references, and correlation IDs.

Agent output is never inherently scientific authority. Tool calls resolve through the same domain services as UI/API calls.

## Provenance, usage, and commerce

- **ProvenanceRecord**: who/what/when/how lineage attached to scientific data and transforms.
- **UsageEvent**: append-only metering fact categorized as platform, AI, or scientific compute.
- **Budget**: scoped deterministic policy and reservations/actuals.
- **Subscription**: platform commercial entitlement, separate from usage ledgers.

## Key relationships

```text
Organization ─ Membership ─ User
     └─ Project ─ ProjectMember
          ├─ Sample ─ Experiment ─ ExperimentalDataset ─ Spectrum
          ├─ Structure ─ StructureVersion ─ Conformer
          │                    └─ Calculation ─ CalculationInput
          │                                      └─ CalculationJob
          │                                           ├─ ComputeExecution
          │                                           └─ CalculationResult ─ Artifact
          ├─ KnowledgeSource ─ Paper/Citation ─ Evidence ─ Hypothesis
          ├─ ScientificDocument ─ DocumentSourceAnchor ─ EvidenceCandidate
          └─ Conversation ─ AgentRun ─ ToolCall

Scientific entities ── ProvenanceRecord
Organization/Project/User ── Budget/UsageEvent/Subscription
```

## Open modeling questions

- Whether a personal project uses a synthetic organization or nullable organization ownership.
- Exact role/capability matrix and regulated-data requirements.
- Canonical chemical identity rules for salts, mixtures, disorder, polymers, and periodic systems.
- Whether peak assignments are generic annotations or modality-specific aggregates.

Resolve the remaining workflow-specific questions in the owning phases. See [provenance](08_DATA_PROVENANCE.md), [tool contracts](04_TOOL_REGISTRY.md), and the Phase 3 acceptance contract.
