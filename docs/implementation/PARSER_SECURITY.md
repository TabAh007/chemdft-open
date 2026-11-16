# Parser Security

Status: Phase 3 baseline complete.

ChemDFT treats scientific structure files as untrusted input. Phase 3 keeps parsing synchronous for small bounded files but isolates parser usage behind replaceable adapter interfaces so future worker/process isolation can be introduced without changing application actions.

## Bounds and rejection rules

- Maximum parser input: 10 MB per structure source.
- Maximum atoms/sites: 10,000.
- Maximum bonds: 40,000.
- Maximum SDF records, XYZ frames, and CIF data blocks: 25.
- Maximum text line length: 20,000 characters.
- NaN/Infinity coordinates are rejected.
- Unknown elements and atomic-number/symbol mismatches are rejected.
- Bond indices must exist, cannot self-reference, and cannot duplicate a pair.
- Periodic structures require a cell and canonical fractional coordinates.

Parser failure rolls back structure/version/provenance/audit persistence. Raw bytes may remain registered because raw preservation happens before parsing by design.

## Current isolation posture

RDKit and pymatgen parsing currently runs in the API process for bounded Phase 3 inputs. This is acceptable for the local foundation but not the long-term trust posture for arbitrary native parser exposure. Production trust expansion should move parsing behind an isolated worker/process with resource limits and the same adapter contracts.

## Diagnostics

Parser and validation diagnostics are typed as `ERROR`, `WARNING`, or `INFO`. Warnings such as missing XYZ connectivity, partial occupancy, and parser notes remain visible to the UI and do not become scientific verification.
