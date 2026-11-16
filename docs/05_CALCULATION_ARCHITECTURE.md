# Calculation Architecture

## Objectives

Provide reproducible, replaceable scientific engines behind normalized contracts while retaining full raw inputs/outputs. ChemDFT does not implement its own quantum-chemistry kernel.

## Layers

1. **Scientific intent:** property/workflow requested against an immutable structure or conformer.
2. **Normalized input:** QCSchema-compatible molecule/model/driver plus ChemDFT extensions for workflow, provenance, budget, and artifacts.
3. **Validation:** elements, geometry, units, charge/multiplicity, method/basis compatibility, resource bounds, and policy.
4. **Engine adapter:** deterministic preparation, invocation, status mapping, parsing, and environment capture.
5. **Compute execution:** provider-neutral requirements dispatched through the [Compute Gateway](06_COMPUTE_GATEWAY.md).
6. **Result validation:** schema/unit/numerical checks, convergence mapping, artifact hashes, and producer attestation.
7. **Publication:** Scientific Result Firewall writes authoritative normalized results and immutable artifacts.

Phase 5 implemented the first execution pathway: immutable StructureVersion data is normalized and hashed, capability-validated, executed by a local bounded subprocess, parsed into a typed EnergyResult, validated, and published through the existing firewall.

Phase 6 moves that local subprocess behind the Compute Gateway. FastAPI submission now creates a calculation, immutable input, estimate, reservation, and durable compute job, then returns while a worker process claims and executes the job. The local subprocess details live only inside the local provider implementation; public `ExecutionRequest` remains provider-neutral and never contains interpreter paths, shell commands, Modal function names, image names, pod ids, or scheduler partitions.

Public `EnginePreference` contains only requested family/version constraint/capability/execution preference. `EngineReference` is actual server/worker-owned identity: exact engine and adapter versions, backend, environment artifact/digest, hardware class, and library metadata. Public callers cannot supply lifecycle or execution identity.

The QCSchema exchange adapter targets the atomic-input v2 boundary (`qcschema_atomic_input` v2, molecule v3). It supports explicit Cartesian bohr atomic energy and frequency/Hessian interchange. QCElemental 0.50.4 and QCEngine 0.50.0 were compatibility-checked with Pydantic 2.13.5 in an isolated environment. Phase 5 retains the bounded adapter and direct PySCF worker because QCEngine adds no authority benefit to this narrow path; it remains an interoperability option, never the publisher of record.

## Engine portfolio

- **RDKit:** molecular sanitization, representation, descriptors, conformer utilities; never a blanket validation oracle.
- **xTB + CREST:** fast prescreening, geometry/conformer generation and ranking.
- **PySCF:** primary programmable QM/DFT engine; libcint integral path, LibXC/XCFun functional options, DFT-D4 corrections, Basis Set Exchange inputs where supported.
- **GPU4PySCF:** compatible accelerated pathways selected only after capability/correctness checks.
- **Psi4:** complementary engine and independent validation path for selected supported calculations.
- **QCSchema, QCElemental, QCEngine:** interoperability, units/models, and program execution interfaces.
- **cclib:** import/interoperability parser for supported external outputs, with parser/version and unsupported-field handling recorded.
- **GPAW:** later periodic/materials specialization candidate.
- **GradDFT:** later experimental research path, isolated from production-authoritative defaults.
- **ORCA:** optional external engine only after commercial license, redistribution, service-access, and operational review.

Engines remain pinned and identified by version/container digest. Adapter conformance tests ensure equivalent contract shape, not scientifically identical algorithms.

## Workflows

A workflow is a versioned DAG of explicit steps and typed artifacts. Example: CREST conformer search → xTB ranking → top-five optimization → top-two DFT → frequencies/NMR → deterministic comparison. Each child calculation has exact inputs, authorization, state, and provenance. Selection criteria are stored; the AI may propose the DAG but does not manufacture outputs.

Failures, retries, and cancellation are explicit. A retry reuses immutable intent/input only when safe and creates a new compute execution/attempt. Checkpoints and partial logs remain artifacts with non-authoritative status.

## Reproducibility record

Every calculated result should resolve to project, sample (if any), structure/version/conformer, calculation and job, engine/adapter versions, method, basis, charge, multiplicity, solvent/settings, exact input coordinates, convergence state, timestamps, raw artifacts, parsed schema version, and practical compute environment details including container digest/hardware class.

## QCFractal/QCArchive evaluation

QCFractal/QCArchive offers chemistry-aware records, services, provenance, and QCSchema-aligned distributed execution. It could reduce bespoke scientific orchestration and enable ecosystem interoperability. Costs include operational complexity, its own data/job model, integration with ChemDFT authorization/billing, and possible duplication of product-specific queues and ledgers.

V1 does **not** blindly commit to QCFractal. In Phase 5/6, implement a bounded proof of concept comparing:

- supported workflow coverage and result/provenance fidelity;
- tenancy/authorization integration;
- cancellation, retry, priority, and budget reservation semantics;
- Modal/GPU worker integration and operational burden;
- artifact/storage behavior and migration risk.

Choose QCFractal when its domain value exceeds adaptation cost; otherwise use a simpler durable queue with QCSchema-compatible records so future interoperability remains possible.

## Validation and benchmarks

Maintain small deterministic smoke cases, parser golden files, curated scientific benchmarks, cross-engine comparisons with stated tolerances, and resource-limit tests. A passing process exit code is insufficient: convergence and property-specific validity must be parsed and recorded.

Related ADRs: [PySCF](adr/ADR-005-pyscf-primary-engine.md), [xTB/CREST](adr/ADR-006-xtb-crest-screening.md), [Psi4](adr/ADR-007-psi4-verification-engine.md), and [QCSchema/QCEngine](adr/ADR-008-qcschema-qcengine.md).
