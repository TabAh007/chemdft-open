# Scientific document ingestion

Phase 7 stores uploaded PDFs as immutable `REPORT` scientific artifacts and creates a project-scoped `ScientificDocument`. PDF parsing runs in a bounded subprocess using pinned `pypdf`; the request handler never interprets PDF bytes directly. Parser output is bounded by upload size, page count, text size, and timeout settings.

Deterministic metadata and keyword/regex detectors create `EvidenceCandidate` records. Candidates remain `EXTRACTED` and point to a durable `DocumentSourceAnchor` (document, page, normalized region, source type, and snippet). Caption classification supports XRD, TG/DTG/DTA, DLS, chemical/structure figure candidates, and manual review fallbacks. Accepting a candidate records a review decision and verification state but never changes its source class to `EXPERIMENTAL`. Raw PDF storage keys are internal and are not returned by API contracts.

The browser uses PDF.js as a lazy viewer over the authorized immutable PDF source route. PDF.js is display infrastructure only: extraction remains server-side pypdf output and existing source anchors drive page navigation/highlights without text-search heuristics. If no usable text layer is present, import records `OCR_REQUIRED`; OCR is deferred rather than approximated.

Manual graph digitization starts from a figure candidate. Users calibrate axes and click points in the viewer; ChemDFT commits a derived `DIGITIZED` dataset with source document SHA-256, page, anchor region, calibration, axis units, actor, timestamp, digitizer version, and approximation metadata. Figure-to-structure reconstruction remains deferred; proposed structure figures never create authoritative `StructureVersion` records on PDF upload alone.
