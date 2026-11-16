# Scientific Integrity and the Scientific Result Firewall

## Non-negotiable rule

**REAL SCIENCE ONLY.** Researcher-facing scientific results require real validated
computational engines or authoritative scientific sources with their provenance
and source status retained. AI-generated values must never masquerade as
engine-calculated results. Production execution must fail explicitly when an
engine/provider is unavailable, never silently substitute simulated providers or
results. Explicitly labeled test doubles may support isolated automated tests;
their outputs are not real scientific acceptance evidence.

An LLM cannot write authoritative calculation or experimental result fields. It may plan, request, summarize, compare, or hypothesize. Numerical authority comes only from validated uploads/imports, explicit extraction/digitization, or deterministic scientific engines.

The prohibition includes invented energies, coordinates, optimized geometries, orbital energies, HOMO/LUMO values, spectra, peaks, frequencies, NMR shifts, ESP/density grids, thermodynamic properties, bond lengths/angles, convergence claims, and simulation output.

## Scientific Result Firewall

The firewall is a server-side trust boundary, not prompt wording.

```text
untrusted caller / LLM tool proposal
              |
       typed command validation
              |
 authorization + budget + immutable input references
              |
 isolated engine or validated import/extraction pipeline
              |
 signed service identity + parser + schema validation
              |
 provenance completeness + artifact hash checks
              |
 authoritative result store
```

### Write policy

Only trusted service principals for approved calculation workers and validated import pipelines can invoke the authoritative-result write path. User and agent actions create commands, hypotheses, annotations, corrections, or import candidates—not final calculated values.

An authoritative write must provide:

- source class and producer identity;
- immutable input and raw artifact references with hashes;
- schema and parser versions;
- required method/engine/environment metadata;
- validation status, units, uncertainty/precision where applicable;
- idempotency key and audit correlation IDs.

The firewall rejects missing provenance, impossible units/shapes, unrecognized producer identities, mutable artifact references, invalid lifecycle transitions, and AI-origin payloads targeting protected fields.

### Phase 2 enforced boundary

The Phase 2 application action accepts only `AuthoritativeResultSubmission` plus an issued, project-scoped `TrustedProducerContext`. The context is not serializable request data and permits only a scientific worker, validated import pipeline, or validated deterministic transform. Browser/user/model contexts, cross-project capabilities, and forged producer types fail before persistence.

Deterministic checks cover project/input/provenance relationships, succeeded calculation state, recognized schema version, immutable artifact existence and SHA-256, required calculated provenance/source artifact, and project-scoped idempotency. Authority, source class, verification state, validation state, producer type, and attestation are generated server-side. Phase 5 registers the first property validator: EnergyResult requires a finite canonical Hartree scalar, convergence, exact method/basis identity, parser/validator versions, raw and normalized artifacts, server-issued execution identity, and matching immutable input. Unknown calculated worker payload types are ineligible for authoritative publication.

The accepted result and its audit event are immutable. Duplicate idempotency keys return the existing result. Rejections within the firewall emit compact audit events without raw payloads. See [ADR-024](adr/ADR-024-scientific-authority-persistence.md).

### Separate stores/views

- `candidate` data: proposed assignments, extracted values awaiting review, hypotheses, and preview estimates.
- `authoritative` data: validated experimental imports and completed deterministic calculation results.
- `verification` data: append-only checks that qualify, dispute, or supersede a datum without erasing its history.

The UI must visually label source class and validation state. AI prose must cite result/evidence IDs and cannot remove those labels.

## Calculation lifecycle

`DRAFT → VALIDATED → AUTHORIZED → QUEUED → RUNNING → {SUCCEEDED | FAILED | CANCELED}`. Only a `SUCCEEDED` job whose artifacts pass firewall validation may publish a calculation result. Partial/nonconverged output is retained and clearly marked, never silently promoted.

## Import and extraction lifecycle

Raw uploads are immutable and quarantined. A versioned parser produces candidates; validation determines whether they become authoritative experimental records. PDF text/table extraction remains `EXTRACTED`; plot reconstruction remains `DIGITIZED`; structure recognition from a figure is `AI_HYPOTHESIS` with an `AI_RECONSTRUCTED` method note until independently verified.

## Comparisons and derived results

Deterministic transforms may produce derived scientific data only when the algorithm, parameters, inputs, units, software version, and output artifact are recorded. Comparisons must preserve each source's provenance and must not relabel calculated data as experimental. AI narratives are interpretations linked to the underlying comparison record.

## Corrections and disputes

Never mutate history invisibly. A user correction creates a new record linked to the original, with author, reason, timestamp, and verification status. Fraud-sensitive fields use append-only audit events and restricted service roles. Retractions/supersessions remain queryable.

## Scientific citation and software attribution

Researchers retain ownership of their scientific work; ChemDFT receives appropriate
software attribution, never automatic authorship. The planned
citation feature
must derive Methods and calculation citations deterministically from validated
stored/native evidence, preserving exact input, actual software versions, engine
attribution, hashes and validation/verification states. Unavailable values remain
unavailable; an LLM must never invent scientific values, structures, citations,
publication references, versions or DOI identifiers.

Private immutable calculation IDs and authorized links identify internal records,
not publicly resolvable scholarly identifiers. Exports stay private by default;
public deposition, ORCID linking and DOI registration require separate researcher/
owner consent and real metadata/identifier verification. Attribution or citation
formatting cannot confer independent scientific verification or overwrite evidence.

## Validation strategy

- Contract/schema, dimensional, unit, and numerical sanity checks.
- Golden-file parser tests from licensed/redistributable fixtures.
- Cross-engine benchmark sets for selected methods, with tolerances justified scientifically.
- Independent Psi4 checks for selected PySCF pathways, not universal forced duplication.
- Reproducibility tests from captured inputs and pinned environments.
- UI tests ensuring provisional, failed, approximate, and authoritative states cannot be confused.

See [provenance](08_DATA_PROVENANCE.md), [calculation architecture](05_CALCULATION_ARCHITECTURE.md), and [ADR-004](adr/ADR-004-scientific-result-firewall.md).

## Evidence vocabulary and platform boundary (2026-10-15)

Keep these states distinct in every document, UI label and report: **installed** (a package or binary
exists), **implemented** (ChemDFT code can call it), **executed** (a genuine native run with retained
output exists), **scientifically verified** (independently checked against a reference or second method —
not implied by a Result Firewall `VALIDATED` flag), **planned** and **deferred**. An execution on one
platform (the retained macOS evidence) is not evidence for another (Linux/AWS). Machine-learning
predictions and AI-proposed structures are hypotheses, never `CALCULATED` results. Numerical acceptance
compares energies and convergence within stated tolerances against native evidence; implementation-dependent
quantities such as SCF iteration counts need scientific assessment before they may serve as cross-platform
criteria. Acceptance criteria are never edited while looking at the new platform's results.
