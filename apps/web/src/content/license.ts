/**
 * The licensing model shown on the License page. The machine-readable map is /REUSE.toml and the full table with the open
 * questions is docs/implementation/RELEASES_AND_LICENSE.md; tests/license.test.ts keeps this file consistent with REUSE.toml.
 * The open parts are published at https://github.com/TabAh007/chemdft-open under Apache-2.0.
 */

/** The public repository link for the footer. null while the repository is private (checked 2026-11-02: PRIVATE). */
export const GITHUB_URL: string | null = null;
/** The repository (or mirror) holding only the open directories. */
export const OPEN_REPOSITORY_URL: string | null = "https://github.com/TabAh007/chemdft-open";

export type LicenseGroup = "open" | "third-party" | "excluded" | "artwork";

export interface LicenseRow {
  /** What a scientist would call it. */
  area: string;
  /** Paths as in REUSE.toml (globs end in /**) or a plain description for the proprietary rest. */
  paths: string[];
  group: LicenseGroup;
  spdx:
    | "Apache-2.0"
    | "LicenseRef-ChemDFT-Proprietary"
    | "LicenseRef-ChemDFT-ThirdParty"
    | "LicenseRef-ChemDFT-NotForPublication";
}

export const LICENSE_ROWS: readonly LicenseRow[] = [
  {
    area:
      "All ChemDFT first-party code and documentation: the web app and molecule editor, the API, the engine wrappers, schemas and contracts, the infrastructure code, the scripts, the examples, the tests and every document in docs/",
    paths: [
      "apps/web/**",
      "packages/**",
      "services/**",
      "scripts/**",
      "examples/**",
      "docs/**",
      "infra/**",
      "tools/**",
      ".github/**",
    ],
    group: "open",
    spdx: "Apache-2.0",
  },
  {
    area: "Third-party material kept in the tree: the accepted CREST source, its patches and the GPL/LGPL texts that govern them",
    paths: ["environments/**"],
    group: "third-party",
    spdx: "LicenseRef-ChemDFT-ThirdParty",
  },
  {
    area:
      "Retained evidence, history and build output. Kept for provenance and audit; excluded from every published snapshot until each file is audited",
    paths: ["output/**", "research/**", "docs/history/**", "tools/scientific-acceptance-archive/**"],
    group: "excluded",
    spdx: "LicenseRef-ChemDFT-NotForPublication",
  },
  {
    area: "The ChemDFT logo, favicons and app icons (artwork, not software; no open licence is assigned)",
    paths: ["apps/web/public/brand/**", "apps/web/src/app/icon.svg", "apps/web/src/app/favicon.ico"],
    group: "artwork",
    spdx: "LicenseRef-ChemDFT-Proprietary",
  },
];

/** The Zenodo record that archives the open-core part (latest published snapshot: 0.0.53). It verifies no scientific result. */
export const ZENODO_SNAPSHOT_DOI = "10.5281/zenodo.24209616";
/** "Cite all versions" concept DOI. */
export const ZENODO_CONCEPT_DOI = "10.5281/zenodo.24082321";

/** Shown verbatim on the home page and the License page (a test keeps them identical). */
export const OPEN_CORE_STATEMENT =
  "All of ChemDFT's own code is licensed under Apache-2.0: the web app, the API, the engine wrappers, the schemas and contracts, the infrastructure code and the documentation. Third-party engines and libraries keep their own licences.";

/** The one line that says what the repository status is. A test keeps it exact. */
export const REPOSITORY_STATUS =
  "Source licence: Apache-2.0 for all ChemDFT first-party code. Public source repository: https://github.com/TabAh007/chemdft-open";

/** Files inside the Apache-2.0 paths that are held back from the public snapshot (scripts/build_zenodo_snapshot.py HELD_BACK; tests keep this list equal to it). */
export const HELD_BACK_FILES: readonly string[] = [
  "services/api/src/chemdft_api/scientific/engines/psi4_environment.json",
];

/** Shown where a licence is not recorded in docs/TECHNOLOGY_REGISTRY.md and could not be verified. */
export const LICENCE_NOT_RECORDED = "Licence not yet recorded";

/** verified: read from installed package metadata or licence file; upstream: the upstream repository's licence was checked on 2026-11-13, the installed copy was not read; not verified: neither. */
export type ThirdPartyStatus = "verified" | "upstream" | "not verified";
export const THIRD_PARTY_STATUS_LABEL: Record<ThirdPartyStatus, string> = {
  verified: "Verified",
  upstream: "Upstream checked",
  "not verified": "Not verified",
};

export interface ThirdPartyRow {
  /** The name as the registry (docs/TECHNOLOGY_REGISTRY.md) lists it. */
  name: string;
  version: string;
  /** The licence as recorded, in full. */
  license: string;
  /** Short licence name or SPDX expression for the table and the Engines card; null = not recorded. */
  short: string | null;
  status: ThirdPartyStatus;
  /** How it was verified, or why it was not. */
  evidence: string;
  /** Whether the code is linked in-process or run as a separate program. */
  use: string;
  /** The upstream project (from the registry); its repository holds the licence text. */
  upstream: string | null;
  /** A clause that matters, or an open question. */
  note: string;
  /** Names of the Engines cards this row gives their licence to. */
  cards?: readonly string[];
}

const NONE = "";

export const THIRD_PARTY: readonly ThirdPartyRow[] = [
  { name: "PySCF", version: "2.14.0", license: "Apache-2.0", short: "Apache-2.0", status: "verified", evidence: "Installed package metadata and its LICENSE file (also ships a NOTICE file)", use: "Library, imported in the isolated worker process", upstream: "https://github.com/pyscf/pyscf", note: "Ships its own NOTICE file. The GTH pseudopotentials and MOLOPT basis sets bundled with it have separate terms (see CP2K data row).", cards: ["PySCF", "PySCF periodic"] },
  { name: "geomeTRIC", version: "1.1.1", license: "BSD 3-clause with an added no-AI-training condition (custom, not an OSI license)", short: "BSD-3-Clause plus a no-AI-training clause (custom)", status: "verified", evidence: "Installed LICENSE file read in full", use: "Library, imported by PySCF's optimizer in the worker process", upstream: "https://github.com/leeping/geomeTRIC", note: "The added clause is a field-of-use restriction, not OSI-approved. The wrapper that imports it (pyscf_worker.py) is held back from the open group. The licence terms include a no-AI-training clause; ChemDFT's use of this component is under review.", cards: ["geomeTRIC"] },
  { name: "xTB", version: "6.7.1", license: "LGPL-3.0-or-later", short: "LGPL-3.0-or-later", status: "verified", evidence: "Conda package metadata of the installed build", use: "Separate program, started as its own process", upstream: "https://github.com/grimme-lab/xtb", note: "Copyleft (LGPL). Registry: bundled licences require review.", cards: ["xTB (GFN2)"] },
  { name: "DFT-D4", version: "4.2.0", license: "LGPL-3.0-or-later", short: "LGPL-3.0-or-later", status: "verified", evidence: "Conda package metadata of the installed build", use: "Separate program, started as its own process (not available for new runs)", upstream: "https://github.com/dftd4/dftd4", note: "Copyleft (LGPL). ChemDFT's use of this component is under review; it is not available for new runs.", cards: ["DFT-D4"] },
  { name: "Quantum ESPRESSO", version: "7.6", license: "GPL-2.0-or-later", short: "GPL-2.0-or-later", status: "upstream", evidence: "Registry entry; upstream repository licence checked 2026-11-13; not read from a built tree (the hosted image was built once by the owner)", use: "Separate programs (pw.x, projwfc.x, dos.x, bands.x), started as their own processes; never linked", upstream: "https://github.com/QEF/q-e", note: "Copyleft (GPL). No QE source or binary is vendored in the repository or the Zenodo snapshot; the hosted image carries QE's own source-offer obligations.", cards: ["Quantum ESPRESSO"] },
  { name: "SSSP PBE Efficiency pseudopotentials", version: "2.0", license: "Per file: GBRV GPL-3.0, pslibrary GPL-2.0-or-later; PseudoDojo LGPL-3.1-or-later on the SSSP page but CC BY 4.0 on its own page (inconsistent); SG15, SPMS, JTH, TW14 not checked", short: null, status: "not verified", evidence: "SSSP download page; the licence headers inside the files were not read", use: "Fetched when the compute image is built; never redistributed with ChemDFT", upstream: "https://www.materialscloud.org/sssp", note: "Mixed licences per file; two sources disagree for the PseudoDojo files. Not resolved." },
  { name: "CREST", version: "3.0.2 (patched)", license: "GPL-3.0 (with LGPL-3.0 components)", short: "GPL-3.0 (with LGPL-3.0 components)", status: "verified", evidence: "COPYING and COPYING.LESSER kept with the accepted source copy", use: "Separate program, started as its own process", upstream: "https://github.com/crest-lab/crest", note: "Copyleft. The upstream repository's licence file is currently detected as LGPL-3.0 (checked 2026-11-13), which differs from the accepted 3.0.2 copy recorded here. The upstream repository holds both COPYING (GPL-3.0) and COPYING.LESSER, and a source file header read on 2026-11-13 names the LGPL; which licence applies to which file is not resolved and is under review.", cards: ["CREST"] },
  { name: "Psi4", version: "1.11", license: "LGPL-3.0-only AND BSD-3-Clause AND MIT", short: "LGPL-3.0-only AND BSD-3-Clause AND MIT", status: "verified", evidence: "Conda package metadata of the accepted installed prefix", use: "Separate program, started as its own process (not available for new runs)", upstream: "https://github.com/psi4/psi4", note: "Copyleft (LGPL). Not set up for new runs; the terms of the bundled components are under review.", cards: ["Psi4"] },
  { name: "RDKit", version: "2025.9.1", license: "BSD-3-Clause", short: "BSD-3-Clause", status: "verified", evidence: "Installed package metadata and LICENSE.md", use: "Library, imported by the server", upstream: "https://github.com/rdkit/rdkit", note: NONE, cards: ["RDKit"] },
  { name: "pymatgen", version: "2025.10.7", license: "MIT", short: "MIT", status: "verified", evidence: "Installed package metadata", use: "Library, imported by the server", upstream: "https://github.com/materialsproject/pymatgen", note: NONE, cards: ["pymatgen"] },
  { name: "cclib", version: "1.8.1.post1278+b1364ecf (local build)", license: "BSD-3-Clause", short: "BSD-3-Clause", status: "upstream", evidence: "Registry entry; upstream repository licence checked 2026-11-13; installed copy not read", use: "Library, parses imported Gaussian and ORCA output", upstream: "https://github.com/cclib/cclib", note: NONE, cards: ["cclib"] },
  { name: "Ketcher", version: "3.12.0", license: "Apache-2.0", short: "Apache-2.0", status: "verified", evidence: "Installed package metadata (ketcher-react and ketcher-standalone)", use: "Library, bundled in the web app", upstream: "https://github.com/epam/ketcher", note: NONE },
  { name: "3Dmol.js", version: "2.5.5", license: "BSD-3-Clause", short: "BSD-3-Clause", status: "verified", evidence: "Installed package metadata", use: "Library, bundled in the web app", upstream: "https://github.com/3dmol/3Dmol.js", note: NONE },
  { name: "three.js", version: "0.186.0", license: "MIT", short: "MIT", status: "verified", evidence: "Installed package metadata", use: "Library, bundled in the web app", upstream: "https://github.com/mrdoob/three.js", note: NONE },
  { name: "Blueprint", version: "6.18.0", license: "Apache-2.0", short: "Apache-2.0", status: "verified", evidence: "Installed package metadata (core and icons packages)", use: "Library, bundled in the web app", upstream: "https://github.com/palantir/blueprint", note: NONE },
  { name: "Apache ECharts", version: "6.1.0", license: "Apache-2.0", short: "Apache-2.0", status: "verified", evidence: "Installed package metadata", use: "Library, bundled in the web app", upstream: "https://github.com/apache/echarts", note: NONE },
  { name: "VTK.js", version: "37.3.1", license: "BSD-3-Clause", short: "BSD-3-Clause", status: "verified", evidence: "Installed package metadata", use: "Library, bundled in the web app", upstream: "https://github.com/Kitware/vtk-js", note: NONE },
  { name: "GSAP", version: "3.15.0", license: "GSAP Standard \"no charge\" license (custom, not MIT)", short: "GSAP Standard \"no charge\" license (custom)", status: "verified", evidence: "Installed package metadata", use: "Library, bundled in the web app", upstream: "https://github.com/greensock/GSAP", note: "Custom licence, not an open-source licence; its own terms apply." },
  { name: "React Three Fiber and React Three Postprocessing", version: "9.8.1, 3.1.3", license: "MIT", short: "MIT", status: "upstream", evidence: "Registry entries; upstream repositories checked 2026-11-13; installed copies not read", use: "Libraries, bundled in the web app", upstream: "https://github.com/pmndrs/react-three-fiber", note: NONE },
  { name: "NumPy", version: "2.5.3", license: "BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0", short: "BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0", status: "verified", evidence: "Installed package metadata", use: "Library", upstream: "https://github.com/numpy/numpy", note: NONE },
  { name: "SciPy", version: "1.18.1", license: "BSD (classifier License :: OSI Approved :: BSD License)", short: "BSD (OSI-approved BSD classifier)", status: "verified", evidence: "Installed package metadata and LICENSE.txt", use: "Library", upstream: "https://github.com/scipy/scipy", note: NONE },
  { name: "h5py", version: "3.16.0", license: "BSD-3-Clause", short: "BSD-3-Clause", status: "verified", evidence: "Installed package metadata", use: "Library, in the worker process", upstream: "https://github.com/h5py/h5py", note: "HDF5 has its own terms (registry)." },
  { name: "pybaselines", version: "1.2.1", license: "BSD-3-Clause", short: "BSD-3-Clause", status: "verified", evidence: "Installed package metadata", use: "Library, in the spectra worker", upstream: "https://github.com/derb12/pybaselines", note: NONE },
  { name: "libxc (C library, in the Psi4 prefix)", version: "7.1.2", license: "MPL-2.0", short: "MPL-2.0", status: "verified", evidence: "Conda package metadata of the Psi4 prefix", use: "Library inside Psi4's own process", upstream: "https://gitlab.com/libxc/libxc", note: NONE },
  { name: "QCEngine", version: "0.51.0", license: "BSD-3-Clause", short: "BSD-3-Clause", status: "verified", evidence: "Conda package metadata of the Psi4 prefix", use: "Library inside the Psi4 prefix; not operational in ChemDFT", upstream: "https://github.com/MolSSI/QCEngine", note: NONE },
  { name: "QCElemental", version: "0.51.2", license: "BSD-3-Clause", short: "BSD-3-Clause", status: "verified", evidence: "Conda package metadata of the Psi4 prefix", use: "Library inside the Psi4 prefix; planned as an interchange layer, not integrated", upstream: "https://github.com/MolSSI/QCElemental", note: NONE },
  { name: "libcint", version: "UNKNOWN", license: "Apache-2.0 (registry, upstream)", short: "Apache-2.0", status: "upstream", evidence: "Registry entry; upstream repository licence checked 2026-11-13; the copy inside the PySCF wheel was not read", use: "Compiled into PySCF", upstream: "https://github.com/sunqm/libcint", note: NONE },
  { name: "LibXC (inside PySCF)", version: "UNKNOWN", license: "MPL-2.0 (registry, upstream)", short: "MPL-2.0", status: "not verified", evidence: "Bundled inside PySCF wheels; version and license not read from the wheel; upstream is on GitLab and was not checked", use: "Compiled into PySCF", upstream: "https://gitlab.com/libxc/libxc", note: "Value is the registry's; not verified." },
  { name: "XCFun", version: "UNKNOWN", license: "MPL-2.0 (registry, upstream)", short: "MPL-2.0", status: "upstream", evidence: "Registry entry; upstream repository licence checked 2026-11-13; deferred in the registry, not installed", use: "Not used", upstream: "https://github.com/dftlibs/xcfun", note: NONE },
  { name: "CP2K GTH pseudopotentials and MOLOPT basis sets", version: "2007 data", license: "Registry: \"GPL-2.0+ / open data license\"", short: null, status: "not verified", evidence: "Bundled with PySCF 2.14.0 (pyscf/pbc/gto/basis); the registry names two options and the data files' own terms were not read", use: "Data used by the periodic PySCF worker", upstream: "https://pyscf.org/", note: "The registry gives two possible terms; not resolved." },
  { name: "GPU4PySCF", version: "UNKNOWN", license: "Apache-2.0 upstream; CUDA terms separate (registry)", short: "Apache-2.0", status: "upstream", evidence: "Registry entry; upstream repository licence checked 2026-11-13; not installed", use: "Planned, not integrated", upstream: "https://github.com/pyscf/gpu4pyscf", note: "CUDA terms are separate.", cards: ["GPU4PySCF"] },
  { name: "ASE", version: "UNKNOWN", license: "LGPL-2.1-or-later (registry)", short: "LGPL-2.1-or-later", status: "not verified", evidence: "Registry entry; upstream is on GitLab and was not checked", use: "Planned, not integrated", upstream: "https://ase-lib.org/", note: "Copyleft (LGPL). Value is the registry's." },
  { name: "QCFractal", version: "UNKNOWN", license: "Not recorded in docs/TECHNOLOGY_REGISTRY.md", short: null, status: "not verified", evidence: "No registry entry", use: "Planned, not integrated", upstream: null, note: "Not integrated; no licence value is stated here." },
  { name: "Basis Set Exchange", version: "UNKNOWN", license: "Not recorded in docs/TECHNOLOGY_REGISTRY.md", short: null, status: "not verified", evidence: "No registry entry", use: "Planned, not integrated", upstream: null, note: "Not integrated; no licence value is stated here." },
  { name: "nmrglue and pyOpenMS", version: "UNKNOWN", license: "Not recorded in docs/TECHNOLOGY_REGISTRY.md", short: null, status: "not verified", evidence: "No registry entry", use: "Planned, not integrated", upstream: null, note: "Not integrated; no licence value is stated here.", cards: ["nmrglue · pyOpenMS"] },
  { name: "Next.js, React, next-intl, better-auth", version: "16.3.4, 19.3.0, 4.14.3, 1.7.7", license: "MIT", short: "MIT", status: "verified", evidence: "Installed package metadata", use: "Libraries, in the web app", upstream: "https://github.com/vercel/next.js", note: NONE },
  { name: "pdf.js (pdfjs-dist)", version: "6.3.289", license: "Apache-2.0", short: "Apache-2.0", status: "verified", evidence: "Installed package metadata", use: "Library, in the web app", upstream: "https://github.com/mozilla/pdf.js", note: NONE },
  { name: "pypdf", version: "5.9.0", license: "BSD-3-Clause (registry)", short: "BSD-3-Clause", status: "not verified", evidence: "Registry entry; the upstream licence file was not detected automatically on 2026-11-13 and was not read", use: "Library, in the server", upstream: "https://github.com/py-pdf/pypdf", note: "Value is the registry's." },
  { name: "pikepdf", version: "10.17.0", license: "MPL-2.0", short: "MPL-2.0", status: "upstream", evidence: "Registry entry; upstream repository licence checked 2026-11-13; installed copy not read", use: "Library, in the server", upstream: "https://github.com/pikepdf/pikepdf", note: NONE },
];

/** Engines cards that stand for several projects with different licences; they point at the table instead of choosing one. */
const MIXED_CARDS: Readonly<Record<string, string>> = {
  "QCElemental · QCEngine · QCFractal · Basis Set Exchange · ASE": "Differs per project; see the licence table",
};

/** The licence shown for an Engines card, or the explicit "not recorded" text. */
export function licenceForCard(cardName: string): string {
  if (MIXED_CARDS[cardName]) return MIXED_CARDS[cardName];
  const row = THIRD_PARTY.find((candidate) => candidate.cards?.includes(cardName));
  return row?.short ?? LICENCE_NOT_RECORDED;
}

/** Dependencies the technology registry names that the table above must cover (checked by tests/license.test.ts). */
export const REGISTRY_NAMED_FOR_LICENSE_PAGE: readonly string[] = [
  "PySCF", "xTB", "CREST", "Quantum ESPRESSO", "Psi4", "RDKit", "Ketcher", "3Dmol.js", "three.js", "Blueprint",
  "geomeTRIC", "DFT-D4", "pymatgen", "cclib", "libcint", "GPU4PySCF",
];
