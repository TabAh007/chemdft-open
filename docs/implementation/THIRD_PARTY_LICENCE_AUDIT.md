# Third-party licence audit for an open release

**Engineering classification, not legal advice.** Nothing here is "cleared". Every row says how the fact was obtained and
what remains open. Prepared 2026-11-13 for release 0.0.51 at commit `17e461e`.

Column meanings:

- **Open repo** — may the third-party code be committed to the public source tree?
- **Docker image** — may it be inside the backend/compute image that ChemDFT builds and runs?
- **Needs lawyer** — is a legal reading required before the owner relies on this row?

## 1. How each fact was obtained

| Source | What it gives | Limitation |
|---|---|---|
| Installed package metadata (`*.dist-info`, `conda-meta/*.json`) read on **2026-11-02** and recorded in [RELEASES_AND_LICENSE.md §5](RELEASES_AND_LICENSE.md) | Exact licence of the versions ChemDFT actually runs | Not re-read today: the worktree has no installed engine environment (no `.venv` with the engines). Treated as the project's own recorded evidence. |
| `LICENSES/`, `environments/crest-3.0.2-ewinfix-a1/licenses/`, upstream `COPYING`/`LICENSE` files **read today** | CREST licence texts, Apache-2.0 text | Only the files named per row. |
| `apps/web/src/content/license.ts` (`THIRD_PARTY`, 39 rows) | The licence strings already published on the site, each with its status | Site data; kept in step with this audit by `tests/license.test.ts`. |
| Registry entry TECHNOLOGY_REGISTRY.md | Version, use, and the verification note per technology | Registry, not legal text. |

**Licence listing tool:** none was available offline (`pip-licenses`, `license-checker`, `reuse` and `cargo-about` are not
installed and were not installed). The Python and npm dependency trees were therefore **not enumerated exhaustively**; only
the packages this project names explicitly are audited below. See §6.

## 2. Classification table

| Software | Version | Licence (as read) | How ChemDFT uses it | In open repo? | In Docker image? | Needs lawyer |
|---|---|---|---|---|---|---|
| **PySCF** | 2.14.0 | Apache-2.0 (ships NOTICE) | Imported library, inside the isolated worker process | **No** — not vendored; declared as a dependency | **Yes** — installed as a package | No |
| **libcint** | bundled in the PySCF wheel | Apache-2.0 (registry) | Compiled into PySCF | No | Yes, inside the wheel | No — but the bundled copy was **not read** (`NOT VERIFIED`) |
| **LibXC** | bundled | MPL-2.0 (registry) | Compiled into PySCF/XCFun path | No | Yes, inside the wheel | **Yes** — file-level copyleft and which files are modified is unread |
| **geomeTRIC** | 1.1.1 | BSD-3-Clause **plus a no-AI-training clause** (custom, not OSI) | Imported in-process by `pyscf_worker.py` | **No** (removed from the tree in 0.0.51; optional user-installed extra) | **Removed from the lock files and Dockerfile in 0.0.53**; **still in the deployed image** (`runtime-qe-0046`; the flatten script was NOT RUN) and hosted optimisation is deliberately enabled live by owner decision (2026-11-14) | **Yes** — field-of-use restriction; is it a "training dataset" if a model is fine-tuned on repository text? |
| **xTB** | 6.7.1 | LGPL-3.0-or-later | Separate program (`subprocess.Popen`) | No | Yes | **Yes** — LGPL and separate-process use in a *hosted* service is not the same question as redistribution |
| **DFT-D4** | 4.2.0 | LGPL-3.0-or-later | Separate program | No | Yes (not available for new runs) | **Yes** — same LGPL question |
| **CREST** | 3.0.2 patched | **GPL-3.0** (`COPYING`) with **LGPL-3.0** components (`COPYING.LESSER`), both present in `environments/crest-3.0.2-ewinfix-a1/licenses/`; per-file applicability unresolved | Separate program, patched build | No | Yes, as a patched binary | **Yes** — the patched CREST build is a modified GPL work; a source offer is owed to anyone who receives the binary |
| **Psi4** | 1.11 | LGPL-3.0-only AND BSD-3-Clause AND MIT | Separate program (not available for new runs) | No | Yes, in the Psi4 prefix | **Yes** — bundled components under three licences |
| **Quantum ESPRESSO** | 7.6 (`qe-7.6`) | GPL-2.0-or-later | Separate programs (`pw.x`, `projwfc.x`, `dos.x`, `bands.x`), never linked | **No** — no source, binary or pseudopotential is vendored | **Yes** — compiled in the `qe-build` stage | **Yes** — a GPL binary inside an image the project builds and runs; whether the image is "conveyed" to anyone is the open question |
| **SSSP PBE Efficiency v2.0 pseudopotentials** | v2.0 | Per file: GBRV GPL-3.0; pslibrary GPL-2.0-or-later; PseudoDojo **LGPL-3.1-or-later on the SSSP page but CC BY 4.0 on its own page**; SG15/SPMS/JTH/TW14 not checked | Fetched at image build time; never redistributed with ChemDFT | No | Fetched into the image at build | **Yes** — two upstreams disagree, and CC BY 4.0 would add an attribution requirement |
| **CP2K GTH pseudopotentials + MOLOPT basis** | 2007 (VandeVondele) | GPL-2.0-or-later / open data (as recorded) | Bundled inside PySCF, used by the periodic worker | No | Yes, inside the PySCF wheel | **Yes** — GPL data inside an Apache-2.0 package is a known upstream ambiguity |
| **RDKit** | 2025.9.1 | BSD-3-Clause | Imported library (server) | No | Yes | No |
| **pymatgen** | 2025.10.7 | MIT | Imported library | No | Yes | No |
| **cclib** | local build | BSD-3-Clause (upstream checked) | Imported library, parses imported output | No | Yes | No |
| **3Dmol.js** | 2.5.5 | BSD-3-Clause (+ incorporated component notices) | **Vendored** in `services/api/src/chemdft_api/assets/**` | **Yes** — the only third-party code in the tree; notices must be preserved | Yes | No |
| **Ketcher / three.js / Blueprint / ECharts / VTK.js / pdf.js** | as in `license.ts` | Apache-2.0 / MIT | Web app dependencies | No (npm, not vendored) | No (frontend build) | No |
| **GSAP** | 3.15.0 | "Standard no charge" custom licence, not MIT | Web app dependency | No | No | **Yes** — custom terms; the "no charge" licence is not a standard OSI text |
| **NumPy / SciPy / h5py / pybaselines** | as recorded | BSD-3-Clause, 0BSD, MIT, Zlib, CC0-1.0 (compound) | Libraries | No | Yes | No |
| **Next.js / React / next-intl / better-auth** | as recorded | MIT | Web app | No | No | No |

## 3. The four questions that decide the release

1. **Does the open tree carry any third-party code?** Only `services/api/src/chemdft_api/assets/**` (3Dmol.js, BSD-3-Clause)
   and `LICENSES/BSD-3-Clause.txt`. Everything else is a declared dependency. That is the cleanest possible position and it
   should stay that way — in particular **geomeTRIC must not be committed** (item 2 of this release).
2. **Does the image convey GPL binaries?** It contains patched CREST (GPL-3.0) and Quantum ESPRESSO (GPL-2.0-or-later).
   ChemDFT runs the image on its own account and does not hand the image to users, which is the argument that no conveyance
   occurs; the counter-argument is that the image is uploaded to a registry and can be pulled by anyone with account access.
   **This is the single most important legal question in the project** and it is not answered here.
3. **Are LGPL engines safe to run as separate processes?** xTB, DFT-D4 and Psi4 are started with `subprocess.Popen` and never
   linked. Running a separate program does not create a derivative work under the usual reading, but "usual reading" is not
   a licence grant.
4. **Do the pseudopotentials travel?** SSSP files are fetched during the image build and never redistributed in the snapshot.
   If they stay in the image, the image carries their terms (GPL and possibly CC BY 4.0).

## 4. Obligations triggered today

| Obligation | Status |
|---|---|
| Apache-2.0 NOTICE for PySCF, libcint, 3Dmol.js, Blueprint, ECharts, VTK.js, pdf.js, Ketcher | PySCF ships its own NOTICE; the web dependencies are bundled by the build, which keeps their licence comments; 3Dmol.js notices are preserved in `assets/` |
| Source offer for patched CREST | **Not implemented.** No written offer or source link is published anywhere. |
| Source offer for the built Quantum ESPRESSO | **Not implemented.** The pinned tag and commit are recorded in `qe-recipe.lock`, which is not a source offer to a recipient. |
| Attribution for CC BY 4.0 pseudopotentials (if that reading is right) | **Not implemented.** |
| MPL-2.0 file-level notice for LibXC | Not implemented; LibXC is unmodified inside the PySCF wheel. |

## 5. Recommended engineering actions (not taken in 0.0.51)

1. Publish a `THIRD-PARTY-NOTICES` document generated from the lock files, once a licence-listing tool is available.
2. Add a written source offer for CREST and Quantum ESPRESSO to the repository and to any image a third party can pull.
3. Resolve the PseudoDojo licence contradiction by reading the licence header inside the files themselves rather than the
   SSSP page.
4. Decide whether the hosted image needs to exist as a pullable artefact at all.

## 6. What this audit did not cover

- **No exhaustive dependency-tree scan.** The Python and npm trees have hundreds of transitive packages; only the named ones
  were audited. A full check needs `pip-licenses`/`license-checker` against the lock files (offline install not possible here).
- **No reading of bundled licences** inside wheels (libcint, LibXC, GTH data) — recorded as `NOT VERIFIED`.
- **No reading of the licence headers inside the SSSP pseudopotential files.**
- **No legal opinion.** Every "Needs lawyer" cell is a flag, not a finding.
