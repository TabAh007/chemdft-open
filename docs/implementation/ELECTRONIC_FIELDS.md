# Saved-SCF electron density and electrostatic potential

This phase extends the accepted molecular-orbital workspace with linked immutable fields. It reuses the existing ScientificArtifact/Provenance models and object store; no migration, live schema creation, or manual DB patch is required. The original calculation/result remains immutable. The Chromium project and retrieval benchmark are outside this phase.

## Authority and derivation

Only an authorized project owner/editor can request a field from a successful, AUTHORITATIVE / CALCULATED / VALIDATED molecular-orbital result. The result hash, normalized input and coefficient artifact bytes, geometry, method, basis, producer version, occupations and orbital table must agree. CandidateRepresentation, PreviewScene, failed SCF, and client-authored field values/density matrices cannot supply calculated fields. Public artifact registration rejects MO_COEFFICIENTS, ORBITAL_GRID and VOLUMETRIC_GRID. AI has no field-write tool.

Restricted density matrix: `D = (C * occ) Cᵀ`. Unrestricted readiness sums alpha/beta matrices, each with occupation capacity 1 (restricted capacity 2). Coefficients/occupations/dimensions/electron sum, matrix finiteness/symmetry/positive semidefiniteness and `trace(D S)` are validated. A float64 density matrix is included in each field NPZ and hash-linked to the saved SCF result and coefficients.

Electron density is evaluated by PySCF `eval_gto('GTOval_sph')` and the AO contraction `rho(r) = AO(r) D AO(r)ᵀ`, in **e/a0³**. It is not a sum of rendered MO meshes. Published density values must be finite and nonnegative to 1e-8 tolerance.

ESP is `sum_A Z_A / |r-R_A| - integral rho(r')/|r-r'| dr'`, in **a.u.**, following [PySCF cubegen.mep](https://pyscf.org/_modules/pyscf/tools/cubegen.html). Electronic Coulomb integrals use `df.incore.aux_e2(mol, gto.fakemol_for_charges(points))`, contracted with D. There are no fitted charges. Coordinates enter AO/integral evaluation in Bohr. Deterministic grid offsets exclude exact nuclei; singular/non-finite samples fail validation rather than being clamped.

The existing bounded, pinned PySCF subprocess evaluates fields before any SCF kernel branch. No live in-memory SCF object or new calculation is needed. Failure leaves accepted SCF/MO and other successful fields intact.

## Grid identity, quality and persistence

Shared typed quantities: MO_AMPLITUDE (a0^-3/2), ELECTRON_DENSITY (e/a0³), ELECTROSTATIC_POTENTIAL (a.u.). POST `/v1/projects/{project}/calculations/{calculation}/fields/grid` accepts a quantity and STANDARD profile; MO additionally requires orbital index/spin. Requests forbid extra fields.

STANDARD v2.0.0: **0.12 Å**, nominal **3 Å margin**, Cartesian x/y/z C-order, StructureVersion frame, maximum **250000 points / 160 per axis**. Caps are part of specification identity. Oversized systems fail explicitly without lowering resolution. A half-spacing lattice offset (bounded deterministic alternatives when needed) avoids exact nuclear coincidence. Origin is floor-snapped relative to the minimum coordinates; half-cell sampling means boundary margin can differ by a half-spacing from the nominal value.

Water benchmark (saved acceptance result):

| Spacing | Dimensions | Density integral | Absolute relative discrepancy |
| --- | --- | --- | --- |
| 0.20 Å probe | 36 × 31 × 38 | 8.790536 e | 12.09% |
| 0.15 Å probe | 47 × 41 × 49 | 9.355640 e | 6.44% |
| **0.12 Å STANDARD** | **59 × 51 × 61** | **9.619521 e** | **3.80%** |

The 5% QA tolerance documents finite-box/core-discretization error for this profile; it is a diagnostic and is not a replacement SCF electron count. Coarse sampling of the oxygen core, as well as box clipping, contributes to error. Other systems may exceed this diagnostic tolerance; their discrepancy stays explicit in the manifest rather than being silently repaired.

Specification SHA includes result SHA, quantity/unit, density-matrix SHA, profile/version/caps, generator/version, Cartesian grid specification and MO selection. Grid SHA includes specification SHA plus float32 field bytes. Artifact UUID is derived deterministically from project + specification SHA. NPZ bytes are deterministic; elapsed time/timestamps remain record metadata outside scientific NPZ identity. Artifact SHA, internal manifest, matrix SHA, field SHA and grid SHA are checked on every cache read. Concurrent duplicate requests converge on one unique artifact record; errors other than that collision are re-raised.

Legacy 0.35 Å MO artifacts remain valid and unchanged, accessible with `grid_profile: LEGACY` on the existing orbitals/grid endpoint. STANDARD is the new default. Old identities are never overwritten.

## ScientificScene and controls

`packages/scientific-scene` produces deterministic renderer-neutral mesh positions, gradient normals and scalar samples. Geometry is marching-tetrahedra v2.0.0 with consistent outward winding. Finer grids and interpolated gradient normals remove unnecessary lighting facets; field values are not smoothed or modified. The molecule comes from existing `buildScientificScene(StructureVersionDetail)`.

One retained Three.js camera/renderer supports MO, density and ESP. A mapped ESP surface requires valid density and potential fields with the same result hash, dimensions, origin and spacing. Trilinear v1.0.0 samples ESP at density-mesh vertices. MO colors are positive/negative amplitude phase; density is one positive isosurface. ESP uses red/white/blue for negative/zero/positive scalar potential, with a visible symmetric numeric range `±max(abs(surface min), abs(surface max))` in a.u. Actual surface min/max are also shown. No percentile clipping or adjustable ESP range is implemented.

Default MO amplitude is ±0.035 a0^-3/2; density is 0.001 e/a0³. Visible logarithmic sliders and numeric inputs use field-derived bounds and Reset. Density bounds span a useful positive range around the default rather than being dominated by core peaks. Isovalue/opacity/molecule visibility/phase visibility are local rendering preferences, never field-generation inputs. Modes preserve camera orientation within the mounted scene. Browser reload persists mode and view preferences; camera serialization and surface picking are not added in this phase.

UI requests are asynchronous and display NOT GENERATED / GENERATING / READY / FAILED. Previous geometry is hidden during generation while its renderer/camera is retained. The project tree keeps one existing calculation and one result; fields are accessed through result inspection/provenance.

## Provenance and AI

Linked field manifests expose source result/calculation/StructureVersion/input/coefficient/density-matrix hashes, frame, origin/axes/dimensions/spacing/margin, profile/version, units, extrema, algorithm/version, timestamp, sizes/timing and provenance record IDs. ESP also references the density artifact and its default mapped surface statistics. Authority is AUTHORITATIVE, source_class CALCULATED, review UNVERIFIED (UI: NOT REVIEWED).

AI ProjectContext reads and hash-validates stored field artifacts before including manifests. Deterministic project answers cite [P] saved result records, including linked artifact/hash evidence. AI reports actual integral and sampled default-surface ESP extrema/positions; exact current browser isovalue is not supplied and is explicitly distinguished. Stored extrema describe sampled mesh points, not mathematically continuous global extrema. The model cannot author fields, assign atomic charges, or invent an oxygen-negative interpretation.

## Local restart

From the repository root, start the API against the persisted local DB/object store with schema creation disabled:

```sh
CHEMDFT_AUTO_CREATE_SCHEMA=false CHEMDFT_DEV_IDENTITY_ENABLED=true \
CHEMDFT_DATABASE_URL=sqlite:///./.chemdft/chemdft.db \
CHEMDFT_OBJECT_ROOT=./.chemdft/objects \
uv run --project services/api uvicorn chemdft_api.main:app --host 127.0.0.1 --port 8123
```

Start the web proxy pointing to that API:

```sh
CHEMDFT_WEB_DIST_DIR=build-e2e/fields-dev \
CHEMDFT_API_BASE_URL=http://127.0.0.1:8123 CHEMDFT_DEV_IDENTITY_ENABLED=true \
pnpm --filter @chemdft/web dev --webpack --port 3100
```

The configured scientific worker Python is `services/scientific-worker/.venv/bin/python` (PySCF 2.14.0). Cached reopening uses persisted NPZ artifacts without worker/SCF recomputation. Local API restart and browser reload are exercised in acceptance. A full OS restart is not performed.

## Verification scope

Focused API, real pinned PySCF integration, matrix/field/manifest/firewall/cache/provenance, legacy MO, AI Scientist, scientific-scene mesh/interpolation, web API tests and manual browser acceptance are covered. Schema checks, TypeScript, web lint, production build, changed-file Ruff and diff checks are required. No retrieval benchmarks are run. The existing Impeccable detector flags only unchanged legacy CSS patterns; no new decorative product gradient is introduced (the ESP scalar legend is a scientific color scale).
