# Data Provenance

## Taxonomy

Every scientifically important datum has a source class and a separately tracked validation state.

| Source class | Meaning | Authority posture |
|---|---|---|
| `EXPERIMENTAL` | Directly imported from instrument/raw dataset through a validated pipeline | Authoritative with acquisition/import provenance |
| `CALCULATED` | Produced by an approved deterministic scientific engine | Authoritative only after firewall validation |
| `EXTRACTED` | Explicitly stated in a paper, document, or table and captured with evidence coordinates | Authoritative as a claim about the source, not as raw measurement |
| `DIGITIZED` | Approximately reconstructed from a graph/image | Approximate; requires method/error metadata |
| `AI_HYPOTHESIS` | Proposed or reconstructed by AI | Non-authoritative until independently verified |

`VERIFIED` is a validation state, not a replacement source class. A record can be `DIGITIZED + VERIFIED`; it remains digitized. Additional states should include `UNVERIFIED`, `DISPUTED`, `SUPERSEDED`, and `RETRACTED` as needed.

## Provenance record

A provenance record captures:

- datum/entity and immutable version;
- source class and validation state;
- actor/producer identity and trust class;
- project/sample/structure/experiment/calculation context;
- source artifact and precise location (page, table, figure, range) where applicable;
- operation/parser/algorithm/engine plus version and parameters;
- input lineage and output content hashes;
- units, precision, uncertainty/approximation, and transformation history;
- timestamps, environment, signature/attestation, and audit correlation IDs;
- verification, correction, and supersession relationships.

## Calculated results

Each calculated result must trace to project, sample if applicable, StructureVersion/Conformer, Calculation/Input/Job, engine and adapter versions, method, basis, charge, multiplicity, solvent/settings, exact input coordinates, convergence state, timestamps, raw input/output/artifacts, and compute environment where practical.

## Experimental and document data

Raw files are immutable, content-addressed, and retained according to explicit policy. Normalization, baseline correction, smoothing, peak picking, integration, assignment, and comparison create new derived artifacts with algorithm/parameter lineage.

An explicitly printed value in a paper is `EXTRACTED`. A coordinate read from an image is `DIGITIZED`. A chemical structure interpreted from a figure by a model is `AI_HYPOTHESIS` with reconstruction metadata. None is silently promoted to `EXPERIMENTAL`.

## Evidence links

Evidence connects a claim/hypothesis to one or more source/result versions, records whether it supports, contradicts, or contextualizes the claim, and preserves citation coordinates. Verification records name the mechanism/reviewer and criteria; they do not erase uncertainty or source class.

## Immutability and corrections

- Preserve original source bytes and checksums.
- Use versions/variants for scientific edits.
- Append corrections and supersessions; never silently update evidence or result history.
- Restrict provenance writes by service/role and maintain tamper-evident audit trails.
- Export provenance sidecars/manifests with scientific results where appropriate.

Phase 2 enforces the taxonomy in strict contracts and persists typed provenance subjects, producer identity, source class/detail, orthogonal verification state, immutable source artifact, operation/version, bounded parameters, correlation ID, supersession, and ordered DAG inputs. Cross-project contract references fail validation; persisted artifact/result relationships use composite project foreign keys. Provenance records and edges reject application-level update/delete operations.

Phase 3 structure imports use `EXTRACTED + PARSER_EXTRACTED + UNVERIFIED` for user-provided structure files when the file itself does not prove an experimental, calculated, or published authority class. Manual editor saves use `EXTRACTED + MANUAL_ENTRY + UNVERIFIED`. Parser validation is not scientific verification. Raw source artifacts and normalized structure artifacts remain linked from the committed StructureVersion and audit event.

Phase 7 scientific PDFs are evidence documents, not raw instrument files. The immutable PDF artifact is parsed in a bounded isolated process; metadata, text, table/figure detections, and reported values become `EXTRACTED` candidates with a `DocumentSourceAnchor` (document, page, source type, normalized region, and snippet). Review can verify or dispute a candidate but cannot change its source class. PDF.js viewing and highlights are source inspection only. Experimental CSV/TSV/XY imports require explicit modality, columns, and units and commit as immutable `RAW + EXPERIMENTAL` datasets. Manual graph digitization creates `DERIVED + DIGITIZED + APPROXIMATE` datasets with source document hash, figure/page anchor, axis calibration, units, actor, timestamp, and digitizer version; it never becomes raw `EXPERIMENTAL`.

See the [Scientific Result Firewall](02_SCIENTIFIC_INTEGRITY.md), [domain model](03_DOMAIN_MODEL.md), and [ADR-015](adr/ADR-015-provenance-first-class.md).
