# Dependency and License Baseline

This is an engineering inventory, not legal advice. Commercial release requires legal review, especially for copyleft or binary-distribution dependencies.

**Historical baseline clarification, 2026-10-15:** the tables/phase notes below
retain earlier inventories and evaluation decisions. For current versions,
installation/implementation/native evidence and licensing findings consult the
single Technology Registry. In particular, xTB/CREST
now have local end-to-end evidence, Psi4 historical evidence/current configuration
blocking, QCEngine no operational route, and React Three Fiber is now declared,
installed and imported. Old “not installed”/“not added” statements are not current
capability claims. geomeTRIC has custom non-AI-training terms; CREST includes GPL
and bundled LGPL source; GSAP has custom Standard terms. Exact redistribution
review remains required; no historical decision or accepted binary is rewritten.

## JavaScript direct dependencies

| Package | Version | License | Purpose |
|---|---:|---|---|
| `next` | 16.3.4 | MIT | App Router web application |
| `react` | 19.3.0 | MIT | UI runtime |
| `react-dom` | 19.3.0 | MIT | Browser rendering |
| `next-intl` | 4.14.3 | MIT | Locale routing and messages |
| `@blueprintjs/core` | 6.18.0 | Apache-2.0 | Accessible component behavior |
| `@blueprintjs/icons` | 6.13.0 | Apache-2.0 | Workstation icon set |
| `ketcher-react` | 3.12.0 | Apache-2.0 | Lazy molecule editor adapter for Phase 3 manual edits |
| `ketcher-standalone` | 3.12.0 | Apache-2.0 | Standalone Ketcher runtime boundary; not a domain model |
| `3dmol` | 2.5.5 | BSD-3-Clause | Lazy Scientific Mode 3D structure renderer over ChemDFT ScientificScene |
| `three` | 0.186.0 | MIT | Lazy Studio Mode WebGL renderer foundation over ChemDFT ScientificScene |
| `@kitware/vtk.js` | 37.3.1 | BSD-3-Clause | Browser-only deterministic indexed isosurface extraction; saved scientific grids remain authoritative |
| `pdfjs-dist` | 6.3.289 | Apache-2.0 | Lazy browser PDF viewer for immutable scientific document sources; display-only, not extraction authority |
| `echarts` | 6.1.0 | Apache-2.0 | Experimental dataset preview charts over already-imported ChemDFT series data |
| `@playwright/test` | 1.63.0 | Apache-2.0 | Browser verification |
| `vitest` | 5.0.0 | MIT | Unit/static tests |
| `typescript` | 5.9.3 | Apache-2.0 | Type checking |
| `eslint` | 9.39.2 | MIT | Linting |
| `eslint-config-next` | 16.3.4 | MIT | Next.js lint rules |
| `json-schema-to-typescript` | 16.0.0 | MIT | Deterministic JSON Schema → generated TypeScript contract build |

## Python direct dependencies

| Package | Version | License | Purpose |
|---|---:|---|---|
| `fastapi` | 0.141.1 | MIT | API framework |
| `pydantic` | 2.13.5 | MIT | API/request models |
| `pydantic-settings` | 2.15.0 | MIT | Environment configuration |
| `SQLAlchemy` | 2.0.52 | MIT | ORM/database boundary |
| `alembic` | 1.19.2 | MIT | Database migrations |
| `psycopg` | 3.3.5 | LGPL-3.0-only | PostgreSQL driver |
| `psycopg-binary` | 3.3.5 | LGPL-3.0-only | Local binary PostgreSQL driver package |
| `python-multipart` | 0.0.32 | Apache-2.0 | Upload parsing at HTTP boundary |
| `pypdf` | 5.9.0 | BSD-3-Clause | Isolated, bounded PDF text/metadata parser for Phase 7; no embedded-action execution |
| `pgvector` | 0.5.0 | MIT | SQLAlchemy PostgreSQL `vector(64)` type and exact cosine-distance operator for the Phase 9 production adapter |
| `rdkit` | 2025.9.1 | BSD-3-Clause | Deterministic SDF/MOL/XYZ molecular parser/export adapter; no calculation engine |
| `pymatgen` | 2025.10.7 | MIT | Deterministic CIF/periodic structure parser/export adapter |
| `uvicorn` | 0.52.4 | BSD-3-Clause | ASGI server |
| `pytest` | 9.1.1 | MIT | Backend tests |
| `httpx` | 0.28.1 | BSD-3-Clause | Test client dependency |
| `ruff` | 0.16.7 | MIT | Python linting |

## Isolated scientific worker dependencies

| Package | Version | License | Purpose / redistribution note |
|---|---:|---|---|
| `pyscf` | 2.14.0 | Apache-2.0 | Isolated molecular HF/DFT single-point engine. Native wheels are installed in a separate worker environment; preserve notices when redistributing binaries. |
| `qcelemental` | 0.50.4 | BSD-3-Clause | Compatibility-evaluated only; not a runtime dependency in Phase 5. |
| `qcengine` | 0.50.0 | BSD-3-Clause | Compatibility-evaluated only; direct PySCF adapter retained for the narrow authoritative path. |
| `Psi4` | 1.11 | LGPL-3.0 | Evaluated/deferred; separate conda/container environment and redistribution review required. |
| `xTB` | not installed | LGPL-3.0-or-later | External executable seam only; binary redistribution/service packaging review required. |
| `CREST` | not installed | LGPL-3.0-or-later | Workflow executable seam only; binary redistribution/service packaging review required. |

## Evaluated / deferred provider dependencies

| Package | Version | License | Purpose / status |
|---|---:|---|---|
| `modal` | 1.5.5 | Apache-2.0 | Evaluated for Phase 6 Modal provider seam; not installed as a default runtime dependency until Modal credentials/deployed function are configured. |

## Review notes

- Foundation renderer comparison pins Mol* 5.12.0 (MIT) in a contained development prototype under `tools/renderer-benchmark`; it is not an application runtime dependency. VTK.js 37.3.1 package metadata and bundled license were inspected locally; preserve its BSD notices when distributing the renderer.

- `psycopg` and `psycopg-binary` are the only direct Phase 1 dependencies flagged for legal review before commercial distribution because they are LGPL-licensed.
- `pnpm licenses list --json` produced a transitive Node inventory during Phase 1 verification. Notable transitive licenses include MIT, Apache-2.0, BSD variants, ISC, MPL-2.0, CC0-1.0, CC-BY-4.0, BlueOak-1.0.0, Python-2.0, and LGPL-3.0-or-later for Sharp/libvips binaries.
- Root `uv.lock` and `pnpm-lock.yaml` inventory the core app; `services/scientific-worker/uv.lock` separately pins the isolated PySCF environment.
- Phase 2 adds only `json-schema-to-typescript` as a direct dependency. It is build-time tooling owned by the shared-contract boundary and does not ship scientific logic.
- Phase 3 adds RDKit, pymatgen, and Ketcher packages after license review. RDKit is used only for cheminformatics parsing/serialization, pymatgen only for CIF/periodic semantics, and Ketcher only behind the editor adapter. ASE was evaluated and deferred because CIF import does not need it in Phase 3; its LGPL-2.1-or-later license remains a legal-review item if adopted later.
- Phase 4 adds 3Dmol.js and Three.js as browser-only lazy visualization dependencies. Both consume renderer-neutral ScientificScene data and are not scientific authority. React Three Fiber was intentionally not added; ChemDFT uses direct Three.js adapters for renderer lifecycle, disposal, instancing, and strict state boundaries.
- QCElemental 0.50.4 and QCEngine 0.50.0 import successfully with Pydantic 2.13.5 in an isolated compatibility check. They are not runtime dependencies because the current bounded QCSchema adapter and direct PySCF worker are simpler for the single supported pathway. See ADR-023 and ADR-033.
- Modal SDK 1.5.5 was reviewed from official docs/PyPI metadata for the Phase 6 provider seam. It remains deferred from default installation so normal verification does not require cloud credentials or paid execution.
- Phase 7 selects pypdf rather than AGPL/strong-copyleft PDF parser stacks. PDF.js is pinned as `pdfjs-dist` 6.3.289 for browser viewing/highlighting only; pypdf remains the bounded text/metadata extraction path. ECharts 6.1.0 renders imported/digitized datasets without generating scientific values. Exact package versions are pinned by `services/api/pyproject.toml`, `uv.lock`, `apps/web/package.json`, and `pnpm-lock.yaml`.

## Addendum — 2026-10-15

Seven registry entries were added on 2026-10-15 (five deferred Hugging Face model families, Hugging Face compute
and AWS alarm/alert services); their license evidence and open review items are in the
[licensing matrix addendum](../12_LICENSING_MATRIX.md) and the registry. No
dependency was added to any manifest. No root ChemDFT license exists yet; this baseline is not a release approval.
