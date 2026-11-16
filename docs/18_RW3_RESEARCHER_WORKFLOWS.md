# RW-3 — Researcher workflows, reports and workstation polish

Read-time projections of persisted, validated evidence plus one new stored object (saved comparison
selections). Nothing here runs an engine, changes a result's authority/validation/verification state,
or alters a numerical algorithm. Scientific standing is always recomputed when something is opened,
reported or exported.

## What was added

| Area | Where | Notes |
|---|---|---|
| Results overview | `GET /v1/projects/{p}/research-overview`; `/projects/{p}/results` page | One bulk-loaded table (≤300 calculations; `truncated` says so). Task, engine+version, method/basis, charge/multiplicity, structure, job state + persisted failure text, stored quantities with units, effective standing, visualizations and export formats that exist *now*, saved-comparison membership. Filter (text, task, engine, standing, state) and sort are client-side over that one response. Rows link to workspace (calculation/result), compare, jobs; "Standing · provenance · export" reuses `ScientificStateStrip` (provenance inspector + export panel). |
| Saved comparisons | `GET/POST /saved-comparisons`, `GET /saved-comparisons/{id}`, `POST …/{id}/archive`; Compare page | Stores a name + ordered result ids + a snapshot of each source's identity/standing. **Opening recomputes** authorization, source identity (payload SHA-256, provenance record, calculation) and effective state and returns the *live* comparison; snapshot is labelled historical. Per source: `UNCHANGED / STATE_CHANGED / SOURCE_CHANGED / MISSING`; overall `CURRENT / CHANGED / UNAVAILABLE` (a missing source yields no comparison). Rows are never deleted (archive sets `archived_at`). |
| Scientific report | export format `report` (per calculation) and `GET /scientific-report?format=html|markdown|json&result_id=…|saved_comparison_id=…` | Built from stored records only: project/structure, specification, engine + version, level of theory, results with units, charts (inline SVG of *stored* stick data or optimization energies — no broadening/fitting), comparison rules/conclusions, standing, lineage, provenance ids and artifact hashes, methods paragraph, limitations, report SHA-256. HTML is self-contained (CSP `default-src 'none'`, no script). `X-ChemDFT-Evidence-Use` is `CURRENT` only if every included result is current. |
| Evidence archive | export format `reproducibility-bundle` | Default-deny portable ZIP of **regenerated, allowlisted** content (see *Portable archive policy*). No artifact bytes are copied. |
| Calculation reuse | `GET /calculations/{c}/reuse-plan`; Reuse dialog (Results, Jobs) | Plan only. Re-checks specification validity, write access, structure version + hash identity, charge/multiplicity vs the structure, geometry eligibility, engine capability, equivalent existing calculations. Creation uses the ordinary `POST /calculations` with a **fresh idempotency key**: a new calculation; the old input/result are never touched; existing idempotency still returns the same calculation for the same key. |
| Queue/worker status | `GET /compute/queue-status`; Jobs page | Counts by state, oldest queued, active executions with heartbeat freshness judged by the scheduler's own lease deadline. No percent-complete. States that no worker process is observable. Project-scoped: other projects' queue is not shown. |

## Portable archive policy (security repair)

### Trust boundary
Everything read from the database or object store is **untrusted** for portable export: stored JSON (payloads, specifications,
producer/engine and environment records, provenance parameters), artifact bytes, artifact kinds/format identifiers, and every
name or label a user or engine could influence. Nothing is exported because a scanner returned "clean". Pattern scanning is
kept only as a last-line tripwire that can **block** an export; it never decides that content is safe (`_SECRET_TEXT` is
demonstrably unable to see unrecognized secrets — `test_a_credential_pattern_scanner_is_not_a_security_boundary`).

Paths from stored data into ZIP bytes (every one goes through `portable_export_policy`):
1. `calculation/specification.json` ← `calculation_inputs.specification_json`
2. `inputs/structure-version.json`, `inputs/structure.xyz` ← structure version atoms/charge/multiplicity (regenerated; fixed XYZ comment)
3. `inputs/calculation-input-summary.json` ← normalized-input artifact (read **only** to verify its SHA-256 and parse; bytes are not copied)
4. `results/result.json` ← `calculation_results` (payload, producer, standing)
5. `results/lineage.json` ← provenance records/inputs (no `parameters_json`)
6. `environment/execution-N.json` ← `compute_executions.environment_json`
7. `MANIFEST.json`, `README.txt`, `SHA256SUMS` ← validated facts, closed vocabularies, counts, fixed text
Raw artifacts, original uploads, project/structure names and artifact format identifiers have **no** path into the archive.

### Approved content
* Numbers (finite, bounded), booleans, `null`; UUIDs and SHA-256 digests re-emitted after parsing; datetimes serialized from datetime objects.
* Strings only from closed reviewed vocabularies: engine/method/basis registries (`scientific/engines/registry.py`), enum members and `Literal` constants of the contract models, reviewed unit codes, element symbols, spin channels, artifact-kind enum — or key-scoped strict patterns (versions, fixed-namespace producer/operation ids, platform string).
* Dictionary keys only if they are fields of the reviewed contract models (derived programmatically; `engine_extensions` values, labels and display names are never exported). A quantity whose unit is not reviewed is withheld **whole** (never unit-less).
* Member names: exactly the fixed list above (`environment/execution-1..99`); a name outside it raises `ExportBlocked`.

### Excluded (withheld by policy)
Engine logs, stdout/stderr, native outputs, binary or text artifacts of any kind, original uploads and structure/input files (their original bytes), free-text labels/comments, producer metadata beyond name/version/adapter version, environment fields beyond python/platform/architecture/known library versions (incl. `python`, `qcelemental`, `qcengine`)/thread counts and native build SHA-256 digests, provenance parameters, artifact format identifiers and media types. Withheld artifacts are listed only as `(artifact id, closed-vocabulary kind or UNKNOWN, size)`; rejected values, names and keys are never echoed — omission records carry only trusted paths and counts, reason codes come from a fixed set.

### Classification rules
* **REPRODUCIBILITY_PACKAGE** — all six required categories are `INCLUDED`: `SPECIFICATION` (task, method, charge, multiplicity, engine, basis if one was requested; nothing scientifically dropped), `STRUCTURE` (valid elements/finite coordinates and original artifact hash verified in-process), `ENGINE_INPUT` (stored input hash verified, projected without scientific loss), `ENGINE_IDENTITY` (name+version in the registry/pattern), `ENVIRONMENT` (sufficient software evidence for the engine — see *Environment sufficiency*), `RESULT` (payload projected without scientific loss). Withheld raw outputs are **not** required for a re-run and do not change the class, but README/manifest state that the archive is not a complete record of the run.
* **PROVENANCE_ARCHIVE** — anything else. `manifest.missing` lists `{category, reason_code}`.
* Dropped free text in a **result payload** (labels) is not scientific loss; dropped strings in a **specification or engine input**, unapproved keys, non-finite or oversized values, or unreviewed units are.
* `exact_reproducibility_claimed` is always `false`; `executable_workflow.provided` is always `false`.

### Environment sufficiency (RW-3.1)
Hardware and OS facts — architecture, platform, hardware class, thread settings — are **never** sufficient. An environment record is judged against the engine that produced the result (`portable_export_policy.environment_sufficiency`), using only values that survived the allowlist projection:

| Engine | Requires |
|---|---|
| `psi4`, `xtb`, `crest`, `dftd4` (native executables) | a recorded build identity: an executable and/or package SHA-256 (top-level `executable_sha256`/`package_sha256`, xTB `build.executable_sha256`/`build.package_archive_sha256`, or D4 `files["bin/dftd4"]`). Python metadata is not required. |
| `pyscf` (Python-hosted) | a valid Python runtime version **and** at least one library version. |
| any other engine | either of the above. |

Exported as `environment/execution-N.json` → `recorded_environment.native_build` (digests only) and `libraries`. Nothing is inferred or filled in; a malformed digest or version counts as absent. An engine name alone projects to nothing and is `NOT_RECORDED`.

If no recorded execution is sufficient, the archive is a **`PROVENANCE_ARCHIVE`**: `required_evidence.ENVIRONMENT` and `missing` carry one of the closed reason codes `NOT_RECORDED` (nothing usable), `NO_BUILD_IDENTITY` (native engine, no digest) or `NO_SOFTWARE_VERSIONS` (missing runtime/library versions), with their meanings in `reason_code_meanings`. The environment members that exist are still written; results, lineage, standing and verification are unchanged and never upgraded.

A `REPRODUCIBILITY_PACKAGE` is still a documented evidence package: it lets a researcher *attempt* the calculation with the same engine build. It is not exact reproduction and not an executable workflow, and a `PROVENANCE_ARCHIVE` is not a reproducible calculation. Other categories can still downgrade an archive independently (e.g. the accepted Psi4 results withhold `scf.reference` and display names as free text, so they remain `PROVENANCE_ARCHIVE` even though their environment is now sufficient). Tests: `test_rw3_environment_sufficiency.py`.

### Resource limits (enforced while members are produced, before the ZIP exists)
≤24 members, ≤8 MiB per member, ≤24 MiB total uncompressed, ≤16 MiB final ZIP, projection ≤400 000 nodes / depth 12 / 20 000 items per list, ≤6 environment records, ≤64 lineage records, ≤200 listed withheld artifacts. Exceeding a bound returns HTTP 413 with a fixed message and **no archive**; an oversized list is withheld and flagged (never truncated). Normalized-input verification reads at most `scientific_max_output_bytes` (5 MiB).

### Known limitations (stated, not hidden)
* Values that are members of a closed vocabulary or match a strict identifier/version pattern are exported by design; those sets are small and code-defined, but a vocabulary-shaped value is not distinguishable from a legitimate one. Identifier-pattern fields (`subject_type`, producer, operation) accept any string matching a fixed-namespace pattern.
* Numbers are exported exactly; a hostile database could in principle encode information in numeric arrays (bounded by the limits above).
* The tripwire only recognizes common credential shapes; the guarantee comes from the allowlist, not the tripwire.
* **Scientific reports are a different deliverable:** they still show the project/structure names (HTML-escaped) and are not governed by the archive policy, though raw specification and producer metadata, artifact format identifiers and non-registry method/basis strings are no longer embedded.
* The export-catalog route still validates the calculation through `get_calculation`; a deliberately malformed stored record can make the *catalog* fail while the archive endpoint itself fails closed.
* Not rotated/revoked by any of this: previously exposed credentials (handled separately by the user).

### Security regression tests
`services/api/tests/test_rw3_archive_security.py` (32 tests, synthetic sentinels per input path, whole-ZIP inspection of member names and bodies): raw log/binary/recognized-credential/unknown-kind/format-identifier artifacts; producer, nested result, unknown-key and malformed metadata; environment keys and paths; structure/input comments and project/structure names; specification extensions; provenance parameters; NaN, oversized and deeply nested records (413); member-name grammar; whole-archive limits; final-ZIP limit; tripwire blocking; extraction safety, `SHA256SUMS` and manifest consistency; classification truthfulness (hash mismatch, no environment, no result); authorization and project isolation; scientific fidelity (every number/unit of the accepted PySCF fixtures, coordinates, charge/multiplicity, hashes, lineage, standing, no verification upgrade).

## Scientific-state rules carried through

* Inactive or missing effective state is never shown as current: overview, saved-comparison revalidation, reports, archive manifests
  and download headers use the same `effective_result_state`.
* Comparison agreement never changes verification; reports restate "not independent verification".
* A saved comparison is a selection, not authority.

## Activation requirement (NOT done in this milestone)

Saved comparisons need migration `0026_saved_comparisons` (additive: one table; downgrade refuses while rows exist).
Verified on (a) a fresh disposable DB (`test_migrations`), (b) a disposable **copy of the accepted evidence database**
(`tools/rw2_evidence_stack.py` runs `alembic upgrade head`). The live database has **not** been migrated. Until it is,
the endpoints report `NOT_ACTIVATED`/503 and every other route is unaffected; the live API process is not restarted by this milestone.
Activation = snapshot live DB → `alembic upgrade head` → restart API (and web only if desired; the new pages need no restart under `next dev`).

## Verification harnesses

* `uv run --project services/api pytest services/api/tests/test_rw3_workflows.py` (28 tests; includes a real xTB run through the real worker for reuse, queue and a verified REPRODUCIBILITY_PACKAGE).
* Browser, disposable evidence copy: `python3 tools/rw2_evidence_stack.py --api-port 8191 --web-port 3191`, then
  `RW2_EVIDENCE_API_PORT=8191 RW2_EVIDENCE_WEB_PORT=3191 RW2_EVIDENCE_DB=<workspace>/data/evidence.db RW2_EVIDENCE_SPEC=e2e/rw3-workflows.spec.ts playwright test --config playwright.rw2-evidence.config.ts`
  (restart the stack between runs: the spec supersedes evidence in the copy).

## Measured performance (disposable stack, `next dev`, 15-result project; dev numbers are unminified and indicative only)

* `research-overview` 12–21 ms server time for 15 results (~1 ms/result), 24 KiB; candidates 10 ms; queue 4 ms.
* Page load (networkidle) results/compare/jobs ≈1.3 s, workspace ≈1.4–2.5 s; 1–2 long tasks (77–193 ms) per page.
* No viewer/Ketcher/ECharts chunk is requested on results, compare, jobs or overview.
* **Demonstrated issue (not fixed here):** the project shell's explorer (`loadWorkspaceInventory`) issues one `GET /calculations/{id}` per job on every project page (16 requests / 208 KiB on this project; 31 on the workspace in dev strict mode), plus ~6 `GET /projects/{id}` and 3 AI-context POSTs. Linear in calculations; browsers cap 6 connections per host. Fix = build the explorer's calculation rows from `research-overview` and fetch detail lazily on selection; deferred because it touches selection/tab persistence in the 3,877-line workspace and needs its own review.
* `structure-workspace-client.tsx`: one 1,733-line component (`StructureWorkspaceContent`, 46 `useState`, 39 `useEffect`, 37 `dispatchEvent`, 6 `getElementById`) plus four inline sub-components (423/352/294/189 lines). No rendering problem was measured, so no refactor was made; extracting the four sub-components is the lowest-risk first step.

## Accessibility found and fixed

* axe (WCAG 2A/2AA, serious/critical) on Results (with export panel open), the Reuse dialog, Compare with revalidation, and Jobs with queue panel: one real defect — status text colours (`pass`/`limit`/`fail`/historical) failed 4.5:1 contrast on the panel background, including the pre-existing RW-2 rule list. Fixed with darker text-weight colours in `compare.module.css`, the reuse dialog and results.
* Keyboard-only path verified: select two results (Space on checkboxes), follow Compare (Enter), enter a name and save (Enter), reopen revalidates; the reuse dialog is a native `<dialog>` (focus trap, Esc closes); the results table scroll region is focusable and labelled.
