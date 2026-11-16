# Test fixtures

Everything in this directory is test data: accepted historical records (for example the AS-C1.2 H₂ HF/STO-3G log) and
synthetic inputs that exercise presentation and validation code. **These files are never imported by production code**
(`tests/results-fixture-isolation.test.ts` fails the build if `src/` imports them or embeds their values or markers), they
are never written to a project database, and they are not authoritative scientific results.

Browser QA that needs several calculations, result types or failure states uses a throwaway mock API outside the repository,
served on a local port, with fixtures built from these files. It cannot reach a real ChemDFT API, and results only enter a
real project through the single worker-attested publication path in `services/api` (`scientific_actions.py`), which has no
HTTP write route for results.

`jobs-mock-api.mjs` is a presentation-fixture HTTP server for the Jobs workstation (`playwright.jobs.config.ts`): invented jobs,
estimates and reservations, **not scientific results**; never imported by production code.
