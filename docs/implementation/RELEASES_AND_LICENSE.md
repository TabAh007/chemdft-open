# Releases, versioning and licensing (open core)

Status 2026-11-02: implemented on branch `feat/releases-page`; **nothing deployed, tagged or published**. The repository is
private (`gh repo view`: PRIVATE, checked 2026-11-02), so the website links no GitHub repository.
**This document and the licensing structure are not legal advice and need a legal read** (owner is not a lawyer; neither is the author).

## 1. Releases: design

- One typed file, `apps/web/src/content/releases.ts`, holds every public release, newest first: `version` (SemVer 0.x), `date`,
  `title`, `summary`, `added` / `changed` / `fixed` and a `scientificStatus` block (`verified` claims with platform and engine,
  `notYetVerified`, `knownLimits`). Notes are English only (stated on the page).
- Derived from it: the footer version (`SiteFooter`), `/[locale]/releases` (server rendered; native `<details>`, latest open, anchors
  `#0.0.1`, a small client effect opens a collapsed release that an anchor points at), the Atom feed
  `/[locale]/releases/feed.xml` (`lib/releases-feed.ts`, no library), `lib/citation.ts` (BibTeX `version`/`year`, APA "Version x"),
  and the cite page.
- Checked against it (`apps/web/tests/releases.test.ts`): `apps/web/package.json` `version`, `CITATION.cff` `version` and
  `date-released`, the cite metadata, the footer, feed validity and order, and the absence of internal strings
  (`dpl_`, hashes, instance ids, localhost, addresses, PR numbers, file paths, test names).
- `apps/web/package.json` went 0.1.0 -> 0.0.1; nothing read the old value (grep of `apps/web/src`, tests and config).

## 2. Versioning rules and how to add a release

1. Every user-visible change adds or updates an entry and bumps the version: patch for fixes, 0.0.x steps for meaningful batches,
   **1.0.0 is reserved** (owner decision). Backend-only changes get an entry only if users would notice.
2. Add a new object at the **top** of `RELEASES`; set `date` (ISO). Write plain language for scientists.
3. Fill `scientificStatus` honestly: `verified` only what `NEXT.md` / the implementation documents record as executed and
   verified, naming platform and engine; one platform's result is not evidence for another; keep unverified items listed.
4. Update `apps/web/package.json` `version`, `CITATION.cff` `version` and `date-released` to the same values.
5. Run `pnpm --filter @chemdft/web test` (the consistency tests fail on any disagreement), add a line to `docs/history/CHANGELOG.md`.
6. Tag and publish the GitHub Release yourself (section 6); the agent never creates tags or Releases.

## 3. Licensing model (owner decision 2026-11-13: the whole first-party codebase is Apache-2.0)

- **Apache-2.0:** every first-party path — the web app and molecule editor, the AI gateway and AI Scientist logic, the
  compute gateway and hosting, billing, authentication, the API, the engine wrappers, schemas and contracts, infrastructure
  code, scripts, examples, tests and every document under `docs/`. `REUSE.toml` is the machine-readable map.
- **Not Apache-2.0, and why:** `environments/**` holds third-party CREST source and its GPL/LGPL texts
  (`LicenseRef-ChemDFT-ThirdParty`); `output/`, `research/`, `docs/history/`, `tools/scientific-acceptance-archive/`,
  `artifacts/` and the root milestone reports are retained evidence excluded from publication until audited
  (`LicenseRef-ChemDFT-NotForPublication`); the logo and icons are artwork (`LicenseRef-ChemDFT-Proprietary`).
- **Public snapshot published.** The public snapshot repository is at `https://github.com/TabAh007/chemdft-open` (published 2026-11-16), and the licence page states:
  "Source licence: Apache-2.0 for all ChemDFT first-party code. Public source repository: https://github.com/TabAh007/chemdft-open".
- **SPDX headers** stay on the files that already carried them (the open-core set). They were deliberately **not** added to
  every file; `tests/test_licensing_map.py` enforces the header rule for the open-core pattern set defined in
  `scripts/build_zenodo_snapshot.py` (`OPEN_CORE_PATTERNS`), so the map, the tests and the snapshot cannot disagree.
- **The published snapshot is unchanged in scope.** `scripts/build_zenodo_snapshot.py` defaults to `--scope open-core`
  with a frozen pattern list; `--scope all-first-party` exists for the owner and is not the default.
- **geomeTRIC** is not part of the tree or the default install: its licence forbids use in AI-training datasets. It is an
  optional extra (`services/scientific-worker/pyproject.toml`, `[project.optional-dependencies] optimization`).

### 4.1 Table (matches `REUSE.toml`; updated 2026-11-16)

| Path (REUSE.toml) | SPDX | Notes |
|---|---|---|
| `apps/web/**`, `packages/**`, `services/**`, `scripts/**`, `examples/**`, `docs/**`, `infra/**`, `tools/**`, `.github/**` and the root project files | Apache-2.0 | all first-party source, tests, infrastructure code and documentation |
| `services/api/src/chemdft_api/assets/**` | BSD-3-Clause | bundled 3Dmol.js with its notices; third-party, not relicensed |
| `environments/**` | LicenseRef-ChemDFT-ThirdParty | CREST source, patches and GPL/LGPL texts; governed by the licence files kept inside; never in a snapshot |
| `output/**`, `research/**`, `docs/history/**`, `artifacts/**`, `tools/scientific-acceptance-archive/**`, `user-tests/**`, `skills/**`, root milestone reports and `*.zip` | LicenseRef-ChemDFT-NotForPublication | retained evidence and history, excluded from publication until audited |
| `apps/web/public/brand/**`, `services/api/src/chemdft_api/assets/brand/**`, icon files in `apps/web/src/app/` | LicenseRef-ChemDFT-Proprietary | the owner's artwork (logo, favicons, app icons); not software; no open licence assigned |

The earlier "open core" split (Apache-2.0 for schemas, contracts and engine wrappers only; everything else proprietary or held back)
was replaced by the 2026-11-13 decision. `scripts/build_zenodo_snapshot.py` still defaults to the frozen open-core scope for Zenodo;
`--scope all-first-party` and `scripts/build_public_export.py` select the whole first-party set.

### 4.2 Status of the items that were open in 2026-11-02

1. `pyscf_worker.py` (imports geomeTRIC) and `pyscf_periodic_worker.py`: first-party, Apache-2.0 since 0.0.51. geomeTRIC is not in the tree or the default install; it is an optional extra (`services/scientific-worker/pyproject.toml`, `optimization`).
2. `psi4_environment.json` (inventory of a local Psi4 build prefix) is still `HELD_BACK` in `scripts/build_zenodo_snapshot.py` and is not part of any snapshot or export.
3. `scientific/qe_periodic/` (0.0.43) is first-party Apache-2.0 like the rest of `services/**`.
3b. **Quantum ESPRESSO is GPL-2.0-or-later and is only ever run as separate programs** (`pw.x`, `projwfc.x`, `dos.x`, `bands.x`, started with `mpirun`; files in, files out). No QE library is linked or imported, and **no QE source, binary or pseudopotential file is vendored in the repository or in any snapshot.** In the hosted image QE is compiled from the pinned tag `qe-7.6` and the SSSP files are fetched at image build time (`infra/aws/ec2-pilot/qe-recipe.lock`); the hosted image is therefore a combined work with QE's own obligations (source offer: the pinned tag and commit). Pseudopotentials are never redistributed with ChemDFT.
4. The engine files are not standalone: they import other ChemDFT modules (`storage`, `errors`, `config`, `scientific_models`, `scientific.structures`). With the whole first-party tree published this no longer matters; the public export is the whole tree.
5. xTB, DFT-D4, CREST and Psi4 are started as separate programs, not linked (to be confirmed in a legal read). If a binary or container of them is ever distributed, their source-offer obligations apply.
6. `CITATION.cff` `repository-code` points to `https://github.com/TabAh007/chemdft-open` (the public repository).

### 4.3 Open legal questions (no legal review has happened)

1. **geomeTRIC 1.1.1** adds a clause forbidding use of the code or binary in training datasets for machine-learning algorithms (not OSI-approved). ChemDFT does not bundle it and installs it only as an optional extra; whether calling it in-process from an Apache-2.0 file is acceptable needs a legal read. Options: keep as optional extra with a notice, or replace the optimiser.
2. **Copyright ownership:** the headers say "Tabriz Ahmadli". Whether the individual or premiumrobots.ai owns the code, how AI-assisted contributions are treated, and whether any outside contributor holds rights are unanswered.
3. **Third-party data rights:** `examples/catalog.json` (some values from PubChem-derived or published sources), engine-output fixtures (Psi4/CREST logs), and the SSSP pseudopotential licences (PseudoDojo inconsistent, SG15/SPMS/JTH/TW14 not verified) are not checked.
4. **CREST:** the upstream licence file is detected as LGPL-3.0 while the accepted 3.0.2 copy records GPL-3.0 with LGPL-3.0 components; `environments/` stays out of every snapshot.
5. **Hosted image:** whether it conveys GPL binaries and what that implies.

## 5. Dependency license facts (read from metadata/files on 2026-11-02, not from memory)

| Software | Version | License as read | Source of the fact | Use |
|---|---|---|---|---|
| PySCF | 2.14.0 | Apache-2.0 (+ NOTICE file) | `pyscf-2.14.0.dist-info` METADATA + LICENSE | imported in the worker process |
| geomeTRIC | 1.1.1 | BSD-3 plus clause 4: code/binary "may not be included in training datasets for improving machine learning algorithms" | installed `LICENSE` read in full; SPDX empty | imported by PySCF's optimizer |
| xTB | 6.7.1 | LGPL-3.0-or-later | conda-meta JSON of the installed env | separate process (`subprocess.Popen` in `xtb_worker.py`) |
| DFT-D4 | 4.2.0 | LGPL-3.0-or-later | conda-meta JSON | separate process (`dftd4.py` Popen) |
| CREST | 3.0.2 patched | GPL-3.0 with LGPL-3.0 components | `COPYING`, `COPYING.LESSER` in `environments/crest-3.0.2-ewinfix-a1/licenses` | separate process (`crest.py` Popen) |
| Psi4 | 1.11 | LGPL-3.0-only AND BSD-3-Clause AND MIT | conda-meta JSON of the accepted prefix | separate process (`psi4.py` Popen); not set up for new runs |
| libxc (Psi4 prefix) | 7.1.2 | MPL-2.0 | conda-meta | inside Psi4 |
| QCEngine / QCElemental / optking | 0.51.0 / 0.51.2 / 0.5.0 | BSD-3-Clause | conda-meta | Psi4 prefix |
| RDKit | 2025.9.1 | BSD-3-Clause | dist-info METADATA + LICENSE.md | imported by the server (not by open files directly except where engines import it) |
| NumPy, SciPy, h5py, pybaselines, pymatgen | 2.5.3, 1.18.1, 3.16.0, 1.2.1, 2025.10.7 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0; BSD; BSD-3-Clause; BSD-3-Clause; MIT | dist-info | libraries |
| Ketcher (react, standalone) | 3.12.0 | Apache-2.0 | `package.json` in `node_modules` | web app (proprietary group) |
| 3Dmol.js | 2.5.5 | BSD-3-Clause | package.json | web app |
| three.js | 0.186.0 | MIT | package.json | web app |
| Blueprint core / icons | 6.18.0 / 6.13.0 | Apache-2.0 | package.json | web app |
| ECharts, VTK.js, pdf.js | 6.1.0, 37.3.1, 6.3.289 | Apache-2.0, BSD-3-Clause, Apache-2.0 | package.json | web app |
| GSAP | 3.15.0 | "Standard no charge license" (custom) | package.json | web app |
| Next.js, React, next-intl, better-auth | 16.3.4, 19.3.0, 4.14.3, 1.7.7 | MIT | package.json | web app |
| libcint, LibXC (inside PySCF wheels), XCFun | UNKNOWN | Apache-2.0 / MPL-2.0 per registry | **NOT VERIFIED** (bundled in wheels; not read) | compiled into PySCF; XCFun not used |
| Quantum ESPRESSO | 7.6 (tag `qe-7.6`, commit `9f93ddec…`) | GPL-2.0-or-later | upstream licence; **built in the hosted image only**, not read from a built tree (image NOT built) | separate processes started by `qe_periodic_worker.py`; never linked |
| SSSP PBE Efficiency v2.0 pseudopotential files (95 files) | v2.0 | per file: GBRV files GPL-3.0; pslibrary files GPL-2.0-or-later (as stated on the SSSP page and by the owner); PseudoDojo files **inconsistent: LGPL-3.1-or-later on the SSSP page, CC BY 4.0 on the PseudoDojo GitHub page: NOT VERIFIED**; SG15, SPMS, JTH and TW14 files **NOT VERIFIED** | SSSP download page / `sssp-pbe-eff-v2.files.sha256` (hashes only; the licence headers inside the files were not read) | fetched at image build time, never redistributed with ChemDFT or the Zenodo snapshot |
| CP2K / Quickstep GTH pseudopotentials & MOLOPT basis | 2007 (VandeVondele) | GPL-2.0+ / open data license | Bundled with PySCF 2.14.0 `pyscf/pbc/gto/basis` | Periodic DFT calculations in `pyscf_periodic_worker.py` |

**Finding to decide before proceeding (stop rule):** geomeTRIC's added clause is a field-of-use restriction, not OSI-approved, and is
not Apache-2.0-compatible if geomeTRIC code were bundled or redistributed with the open group. The open group does not bundle it, but
`pyscf_worker.py` calls it in-process, so the question is open (4.3 item 1). Options: make geometry optimization
an optional, separately installed dependency with the file open and a notice; replace the optimizer. No GPL/AGPL/LGPL code is linked into
an open file in-process: xTB, DFT-D4, CREST and Psi4 are started as separate programs (a fact to confirm in the legal read, not a
guarantee). If a binary or container of CREST/xTB/Psi4 were ever distributed, their source-offer obligations apply.

## 6. Publication options (nothing published; the License page says "licensed under Apache-2.0" and links no repository)

| Option | What it needs |
|---|---|
| A. Separate public repository containing only the open paths | new repo; copy the open paths (layout will not run standalone: item 4.2.3); `LICENSES/`, `NOTICE`, a README; fresh history, so no proprietary file ever appears in it; set `GITHUB_URL`/`OPEN_REPOSITORY_URL` in `content/license.ts` |
| B. Mirror via `git filter-repo --path ...` keeping history | history of the open paths only, **audit every historical commit** (secrets, earlier proprietary content, author emails) before it goes public; higher risk than A |
| C. Make the current repository public | **not recommended**: exposes proprietary code and history; not allowed by this task |

### 6.1 Publication procedure (owner decision 2026-11-16)

Option A was selected. The snapshot export is published to `TabAh007/chemdft-open`:
- **Target repository:** `TabAh007/chemdft-open` (GitHub repository names are case-insensitive, so `chemdft` was unavailable).
- **Snapshot model:** One single commit per release, built directly from the merged release commit on `main` using `scripts/build_public_export.py`.
- **Export isolation:** Clean rebuild into a dedicated export directory; tests run strictly in an isolated temporary copy (`cp -r`), never run or installed inside the publish directory itself.
- **Identifier scan:** Full identifier scan on the export directory must yield zero findings across all categories (cloud accounts, instances, bucket names, hostnames/IP addresses, emails, deployment IDs, unrelated project names, keys/tokens, local filesystem paths).
- **Privacy and manual push:** The repository is created private. The agent never makes anything public, never changes visibility, and never auto-publishes without explicit approval; the owner flips visibility to public when ready.

Published 2026-11-16: `TabAh007/chemdft-open` is public; `OPEN_REPOSITORY_URL` and `CITATION.cff` `repository-code` point to it.

## 7. Commands for you (NOT run)

After the PR is merged to `main` (replace `<merge-sha>`):

```bash
git fetch origin && git tag -a v0.0.1 <merge-sha> -m "ChemDFT 0.0.1: first public beta"
git push origin v0.0.1
gh release create v0.0.1 --title "ChemDFT 0.0.1: first public beta" --notes-file /tmp/chemdft-0.0.1-notes.md --verify-tag
```

Write the notes file from `apps/web/src/content/releases.ts` (same text as the Releases page). DOI for the open group, only after it is public:
on zenodo.org sign in with GitHub, open GitHub settings in Zenodo, switch on the public repository, then publish a GitHub Release
(Zenodo archives each Release and issues a DOI); afterwards add the DOI to `CITATION.cff` (`identifiers`/`doi`) in a later release. Zenodo cannot
archive a private repository.

Because the repository is private, every software citation ChemDFT prints (APA, BibTeX, RIS, plain text, the cite page and the
citation block in the exports) gives the public website `https://chemdft.com` as its URL, not the repository address; `repository-code`
stays in `CITATION.cff`, `.zenodo.json` and `software_citation.json` as metadata only (release 0.0.36).

## 8. Verification (2026-11-02)

PR #61 merged as `b4de54b` after `api` and `web` CI passed. Follow-up checks before any frontend deploy:

| Check | Result |
|---|---|
| ruff, tsc, eslint, `schemas:check`, `pnpm build`, full vitest (1486), API pytest (CI selection) | PASS |
| `releases-license-layout.spec.ts` (62 cases: 5 pages x 4 viewports x normal / Chrome-109-stripped / +40% labels, plus anchor, keyboard and feed) | PASS, 6 consecutive runs after the stabilisation below |
| `other-pages-layout.spec.ts` rows for Releases, License, cite, Learn, Projects | PASS (60) |
| `molecule-editor-*` Playwright specs | PASS (81) |
| `chrome109-workspace-layout.spec.ts` (against `next dev`, installed Chrome, mocked data) | PASS (12/12) |
| `rw32-researcher-ux.spec.ts` (disposable evidence stack) | first run 6 PASS, 1 FAIL: the test still drove the pre-Phase-1 editor (save-target banner, structure switcher while editing); the old `KetcherEditorPanel` still renders that test id but the project now uses `MoleculeEditorPane`. Spec updated afterwards (target kind on the panel, title, no switcher while editing, `editor-cancel`): 12/12 PASS. |
| `localhost-real-flow.spec.ts` | NOT RUN: it creates a real project in the interactive local database (the runner excludes it) |
| `tools/run_isolated_e2e.py` scenarios | NOT RUN: `TEST_DISK_RESERVE` (about 11 GiB free, 12 GiB required); no files were deleted to make room |
| Real Chrome 109, dark theme, phone/tablet | NOT RUN |

Flaky case: the spec raced `next dev`'s on-demand compile and mutated text nodes before React hydrated them (the +40% label step then lost
its change). Fixed by warming every route once in `beforeAll`, waiting for a React fiber on `<main>` before mutating, and retrying the focus
assertion; `networkidle` was tried and rejected (never settles under HMR).
Landing overflow: the run-record traceability values (`white-space: nowrap`) widened the page by 8 px at 1093 px with longer labels; they now wrap
(`overflow-wrap: anywhere`). The exemption in the spec was removed.
License page reviewed by screenshot at 1366x768 and 1093x520: no horizontal overflow, tables readable, status tags no longer wrap.
The public pages have no AI drawer, so "with and without the drawer" does not apply to them. Impeccable: skill workflow applied inline, no separate agent.

## 9. Deployment (2026-11-02, owner-approved)

Frontend only, from a clean `git archive` of `c28a2df`: `dpl_<id>` (production, Ready, alias `chemdft-beta.vercel.app`). Rollback target: `dpl_<id>`. Live backend `/draw` answered 401 before and after. No tag was created; backend untouched.

### 0.0.49 note
The License page (`/[locale]/license`) now renders the section 5 facts as a table built from `apps/web/src/content/license.ts` (`THIRD_PARTY`, 39 rows): each row has a short licence name or the text "Licence not yet recorded", a status (Verified = read from installed metadata or a licence file; Upstream checked = the upstream repository's licence was checked on 2026-11-13, installed copy not read; Not verified), an upstream project link and a note. The same data gives the licence line on every Engines card; the home page has a Licences section; the cite page links the page. The three held-back files are listed from `HELD_BACK` in `scripts/build_zenodo_snapshot.py` (a test keeps them equal). New open question: the upstream CREST repository's licence file is detected as LGPL-3.0 while the accepted 3.0.2 copy records GPL-3.0 with LGPL-3.0 components (item 5 above is unchanged). The legal read stays pending; the page says so.

### 0.0.42 note
0.0.42 adds no new licence paths. Version bump sites for a release: `apps/web/package.json`, `apps/web/src/content/releases.ts`, `CITATION.cff`, `.zenodo.json`, `services/api/src/chemdft_api/data/software_citation.json`, `release_info.py`, and the pin in `services/api/tests/test_release_version_agrees.py`. Version DOIs are recorded only after Zenodo publishes them (never invented).

The version DOI of a release lives only in `CITATION.cff`, `services/api/src/chemdft_api/data/software_citation.json`, `ALLOWED_DOIS` in `services/api/tests/test_zenodo_metadata.py`, `apps/web/src/content/license.ts` and `releases.ts`. `.zenodo.json` deliberately carries no DOI-scheme related identifier (a test forbids it) because Zenodo assigns the DOI when the version is published.
