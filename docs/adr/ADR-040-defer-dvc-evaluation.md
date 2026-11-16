# ADR: Defer DVC for ChemDFT evaluation artifacts

Status: **DEFER** (2026-09-25)

ChemDFT currently has small committed scientific result manifests, exact
SHA-256 identities, an external sealed blind package, and one-shot evaluation
rules. Adding DVC now would introduce a second metadata and hash system,
additional cache/remote management, and a reproducible-stage command that is
inappropriate for already consumed blind packages. DVC's value is real for
large corpus/chunk and model artifacts: it tracks data through Git metadata,
stores large contents in an external remote, and describes pipeline stages with
dependencies and outputs. See [DVC remote storage](https://dvc.org/doc/user-guide/data-management/remote-storage)
and [DVC pipelines](https://dvc.org/doc/user-guide/pipelines/defining-pipelines).

Decision: keep the canonical ChemDFT freeze API and Git-tracked manifests for
new benchmarks. Keep sealed blind packages and historical evidence outside any
automatic `dvc repro` path. Reconsider DVC when at least one future source,
chunk, or model collection is too large for ordinary Git plus current local
provenance, must be shared across machines, and has an approved immutable remote.
At that point, pilot DVC on a **new development-only** corpus, measure whether
it simplifies transfer and reconstruction, and preserve the canonical ChemDFT
scientific hash as the authority.
