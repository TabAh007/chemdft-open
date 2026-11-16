# Structure Candidate Proposal

## Why this may be useful

Scientific papers often show a proposed molecular or crystal drawing without
providing machine-readable atomic coordinates. A reviewable candidate could
connect that figure to later reconstruction work without confusing the drawing
with a usable structure.

## Authority boundary

A candidate is non-authoritative evidence. It must not enter 3D visualization,
calculation, export, or structure search as if it were a committed structure.
Those capabilities continue to require a validated immutable
`StructureVersion` with explicit coordinates.

## Candidate provenance classes

Possible source classes include `REPORTED_FIGURE`, `IMAGE_RECONSTRUCTION`,
`TEXT_RECONSTRUCTION`, `USER_DRAFT`, and `IMPORTED_COORDINATES_PENDING_REVIEW`.
Each candidate should retain the source document/artifact, page or region,
extractor/reconstruction method and version, actor, timestamp, and uncertainty.
These are proposal names, not current persisted enums.

## Review and promotion

Candidates should be inspectable with their source and uncertainty, but never
auto-promoted. Promotion should require a user-reviewed coordinate set,
server-side scientific validation, explicit provenance, and creation of a new
immutable `StructureVersion`. Candidate data and review history must remain
separate from the version history; rejecting a candidate must not alter source
evidence or committed structures.

## Separation from StructureVersion

`StructureCandidate` should be a distinct entity and API. A candidate may hold
an unvalidated draft representation, but it must not satisfy interfaces that
accept `StructureVersion`, be selected by calculation actions, or appear in
committed structure lists until an explicit validated promotion creates a new
version.

## Future reconstruction sources

Potential sources include user-drawn Ketcher output, machine-readable structure
files, text-reported coordinates, CIF/mmCIF tables, and image/diagram-assisted
reconstruction. Any inferred geometry should carry method/version and an
approximation label; image reconstruction should remain an opt-in proposal.

## Risks

Key risks are visual ambiguity, false precision, unit-cell/coordinate-frame
errors, unsupported bond inference, citation drift, and accidental use of
unverified coordinates in computation. UI labels, typed APIs, authorization,
and server-side action validation must all enforce the same authority boundary.

## Recommended sequence

1. Define candidate contracts, lifecycle, provenance, and isolation tests.
2. Add read-only candidate creation from explicitly supported sources.
3. Add a review surface that keeps source evidence and uncertainty visible.
4. Add a deliberate validation-and-promotion action that creates an immutable
   `StructureVersion` and preserves full lineage.
5. Only then consider preview visualization, with a renderer input type that
   cannot be mistaken for committed calculation input.

# Implementation status

The bounded non-authoritative foundation described by this proposal is
implemented in [STRUCTURE_CANDIDATE_FOUNDATION.md](STRUCTURE_CANDIDATE_FOUNDATION.md).
Image-to-structure reconstruction, candidate preview rendering, and generated
coordinates remain deferred.
