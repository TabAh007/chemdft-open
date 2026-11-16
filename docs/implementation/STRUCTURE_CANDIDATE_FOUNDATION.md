# StructureCandidate Foundation

Status: candidate representation/review foundation implemented; image reconstruction remains deferred.

## Authority boundary

`StructureCandidate` is project-scoped review metadata, not a `Structure` or
`StructureVersion`. It is absent from committed-structure, scene, export, and
calculation inputs. A candidate becomes usable by existing scientific actions
only after the explicit promotion action has validated a coordinate
representation and created a separate immutable `StructureVersion`.

## Lifecycle

Detected figure evidence creates one idempotent `REPORTED_FIGURE` candidate
with an `IMAGE_REFERENCE` representation, source document/evidence/anchor,
extractor method/version, actor, timestamp, and `EXTRACTED` provenance. It has
no coordinates. Users may append immutable SMILES, MOL-block, Cartesian, or
crystal-coordinate representations. Parseable molecular input may also
produce a deterministic RDKit ETKDGv3 conformer with a fixed seed and no
force-field optimization. This is a separate `DERIVED_PREVIEW` representation,
with a source-representation link, content hash, revision, generation
parameters, and validation diagnostics. It is visualization-only and is not
DFT-optimized or experimental evidence.

Candidate review and representation review are separate append-only decisions.
Rejection keeps the candidate, representation history, and original evidence
auditable. None of these actions alone changes scientific authority.

Promotion requires a reviewed candidate and an explicitly selected, reviewed
coordinate representation. The server validates the typed coordinate payload and
chemistry, then creates a new version with origin `RECONSTRUCTED` and
`UNVERIFIED` provenance retaining the source candidate/evidence lineage.
Promotion never edits a prior version or converts the candidate itself.
Representation provenance, revision, reviewer, and content hash are included
in lineage. Storage keys and representation payloads are not exposed in
candidate summaries.

Read-only `structure_candidate.list` and `structure_candidate.get` tools are
available to the AI Scientist. There are no candidate mutation tools in its
registry, and its policy requires the candidate inventory for questions about
detected paper structures. It must describe a figure without coordinates as
non-authoritative and unavailable for calculation.

## Supported source and UI

This foundation creates candidates only from already-detected, extracted
structure-figure evidence. The workspace links the candidate to the detected
figure, page, and source viewer. It offers manual SMILES entry or the existing
lazy Ketcher editor as a draft adapter, followed by a separately labeled
candidate preview using the existing 3Dmol/Studio renderers. A persistent
warning identifies generated coordinates as unverified. Only explicit review
and promotion create an immutable `StructureVersion`; calculation actions
continue to accept only that committed version. Candidate status does not
alter the underlying evidence review state.

## Manual promotion acceptance

On 2026-09-24, a synthetic coordinate-bearing candidate was created in an
isolated localhost test project using the supported API setup, then reviewed
and explicitly promoted through the workspace review flow. The resulting
`RECONSTRUCTED` V1 was immutable and retained candidate, source evidence,
representation, review, and promotion lineage. The candidate remained visible
as history and outside the committed Structures list; both Scientific 3D and
Studio rendered the promoted version. Passing the candidate ID as a calculation
structure-version ID was rejected. The representation preview remained
non-authoritative until this separate promotion step.

## Future preview seam

The intended later path is:

`StructureCandidate → CandidateRepresentation → PreviewScene → read-only renderer`

`PreviewScene` is a distinct, non-authoritative type from `ScientificScene`;
neither it nor an unpromoted candidate may enter a calculation. Molecular
image recognition and crystal-structure reconstruction require separate
evaluated strategies documented in
`STRUCTURE_RECONSTRUCTION_STRATEGY.md`.
