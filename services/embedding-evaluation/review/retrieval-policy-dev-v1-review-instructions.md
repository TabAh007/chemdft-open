# Retrieval policy dev V1 QREL review and freeze

The completed combined answerable/no-answer review pack is in
[`retrieval-policy-dev-v1-qrels-review.csv`](retrieval-policy-dev-v1-qrels-review.csv)
with canonical JSON at
[`retrieval-policy-dev-v1-qrels-review.json`](retrieval-policy-dev-v1-qrels-review.json).
All 101 labels have resolved owner-provided independent review outcomes: 93
`APPROVED`, 8 `CORRECTED`, 0 `REJECTED`, and 0 `UNREVIEWED`. The frozen QRELs
and leakage-isolated partition artifacts are stored at the evaluation package
root; the summary is in
[`retrieval-policy-dev-v1-review-record.md`](retrieval-policy-dev-v1-review-record.md).

The freeze script validates the complete six-paper authoring corpus described by
[`retrieval-policy-dev-v1-manifest.json`](../retrieval-policy-dev-v1-manifest.json)
against the pinned 342-chunk inventory and local source companion. Review states
record the owner-provided decision; assistant recommendations remain preserved
as authoring provenance only. Corrections and alternate targets are described
per QREL in `review_notes` and target-specific evidence excerpts.

For XML targets, use `source_kind`, `section`, `paragraph_ordinal`,
`chunk_ordinal`, and `xml_node_id`; `expected_page` is intentionally blank.
Do not infer a PDF page for an XML paragraph. For future PDF-backed targets,
`PDF_PAGE` locators carry a one-based page and optional anchor ID. Confirm
answerable evidence in the indicated chunk and add every legitimate alternate
target before approving. No-answer rows must have no expected document/chunk.

The QRELs and split are frozen. **HOLDOUT MUST NOT BE SCORED UNTIL THE
RETRIEVAL/FUSION/ABSTENTION POLICY IS FROZEN FROM DEVELOPMENT DATA.** This pass
performed no retrieval scoring.
