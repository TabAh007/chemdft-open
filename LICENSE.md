# ChemDFT licensing

ChemDFT's own code and documentation are **Apache-2.0** (owner decision 2026-11-13). Copyright (c) 2026 Tabriz Ahmadli.

| Group | License | SPDX id | What |
|---|---|---|---|
| **First-party** | Apache License 2.0 ([text](LICENSES/Apache-2.0.txt)) | `Apache-2.0` | the web app and molecule editor, the AI gateway and AI Scientist logic, the compute gateway, the API, engine wrappers, schemas and contracts, infrastructure code, scripts, examples, tests and documentation |
| **Third-party** | their own licences | e.g. `BSD-3-Clause`, `LicenseRef-ChemDFT-ThirdParty` | bundled 3Dmol.js; CREST source and licence texts under `environments/` |
| **Not for publication** | n/a | `LicenseRef-ChemDFT-NotForPublication` | retained evidence and history, excluded from publication until audited |
| **Artwork** | all rights reserved ([notice](LICENSES/LicenseRef-ChemDFT-Proprietary.txt)) | `LicenseRef-ChemDFT-Proprietary` | the ChemDFT logo, favicons and app icons |

The machine-readable map is [`REUSE.toml`](REUSE.toml); the directory table and the open legal questions are in
`docs/implementation/RELEASES_AND_LICENSE.md`. Source files that carry an SPDX header use `Apache-2.0`; a test fails if an
excluded path claims it.

Third-party engines and libraries keep their own licences and are never relicensed here. geomeTRIC is optional and not
installed by default. The software is provided without warranty. This structure has not had a legal review.
