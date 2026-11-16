# Scientific Engine Architecture

## Authoritative path

`StructureVersion → CalculationSpecification → normalized CalculationInput → CalculationAttempt → raw artifacts → typed parser → property validator → Scientific Result Firewall → CalculationResult`.

No adapter writes result tables. Public callers submit only `structure_version`, `CalculationSpecification`, and an idempotency key. They cannot submit lifecycle, worker attestation, actual engine identity, result values, storage paths, or trusted producer context.

## Execution boundary

FastAPI calls `calculation_actions`; the action reads authoritative structure coordinates, validates the server capability registry, persists canonical JSON and SHA-256, and invokes a fixed worker script with an argv array. The configured interpreter, work directory, filenames, environment, thread count, timeout, output size, and atom count are server controlled. `shell=True` is never used.

The PySCF worker environment is pinned separately in `services/scientific-worker/pyproject.toml`. Normal web/API tests do not install or require it. Each attempt uses an isolated temporary directory; allowlisted outputs are copied into immutable object storage before cleanup. The environment manifest captures Python, PySCF, NumPy, SciPy, platform, architecture, and thread settings. Raw logs remain non-authoritative and are exposed only through a project-authorized artifact endpoint.

Geometry optimization uses PySCF's `geometric_solver` integration and the established geomeTRIC optimizer, pinned in that isolated worker environment. geomeTRIC supplies the optimization algorithm; ChemDFT only records the engine callback's actual energy/gradient evaluations. Each callback appends a step in atom order to the durable trajectory and becomes available through calculation polling. The final worker output must exactly match those persisted steps. Nonconvergence, failure, and cancellation retain valid progress without publishing an optimized version. A converged result and child `StructureVersion` commit together only after Scientific Result Firewall acceptance; canonical final coordinates must equal the last validated evaluation.

## Supported result

`EnergyResult` requires ENERGY, a finite Hartree scalar, convergence, exact method/basis, parser and validator versions, execution identity, normalized input, raw output, environment manifest, and complete calculated provenance. The firewall matches task/result type and immutable method/basis before publication. `OptimizationResult` additionally requires a converged, hashed trajectory artifact and a canonical final structure hash tracing to the last engine evaluation.

## Lifecycle and attempts

Only application code may transition `DRAFT → VALIDATED → AUTHORIZED → QUEUED → RUNNING → SUCCEEDED | FAILED | CANCELED`. An attempt records worker identity, timing, outcome, diagnostics, actual engine identity, and artifact references. Failed/nonconverged attempts retain artifacts but publish no result.

## QCSchema/QCEngine

The existing explicit QCSchema v2 adapter remains the interchange boundary. QCElemental 0.50.4 and QCEngine 0.50.0 are compatible with pinned Pydantic in isolation, but QCEngine is deferred until it improves an adapter without weakening ChemDFT lifecycle, validation, artifacts, provenance, or firewall authority.
