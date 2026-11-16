# ADR-034: PDF evidence trust boundary

## Decision

Scientific PDFs are document/evidence sources, not raw instrument datasets. Uploaded bytes are immutable artifacts. A bounded `pypdf` subprocess extracts text and metadata; deterministic detectors create project-scoped evidence candidates with page/source anchors. Candidate review is orthogonal to source class: accepting `EXTRACTED` or `DIGITIZED` evidence cannot relabel it `EXPERIMENTAL`.

## Consequences

The API can preserve exact source snippets and provenance without claiming that a paper is the original instrument file. OCR, figure digitization, and AI interpretation require separate explicit workflows and provenance records.
