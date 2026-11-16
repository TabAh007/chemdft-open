# Jobs workstation (design/jobs-redesign-v1)

Status 2026-10-25: commits `d58943b` backend, `77e5402` web, `1ff4235` tests, `d6b6359` docs on `design/jobs-redesign-v1`
(from `origin/main` @ 98f8f90), reviewed in PR #5. **Not deployed.** Only the project page `/projects/{id}/jobs` changed; the global
`/[locale]/jobs` page is untouched. No engine, AI provider, AWS or Vercel was used; browser evidence comes from a presentation-fixture
mock API (`apps/web/tests/fixtures/jobs-mock-api.mjs`), never real jobs.

## What it is
Compare's split pane: left, a job library (search, state chips with counts, provider chips when more than one provider exists, one compact
row per job, 100 rows at a time with "Show more"); right, a persistent inspector. State is in the URL (`?job= ?state= ?provider= ?q=`);
selecting pushes a history entry. At ≤820 px of page width one pane shows at a time (Jobs / Details switch).

Inspector sections: header (task, state, structure name · formula · version, method/basis/charge/multiplicity, recorded failure, Open
result/calculation, Open structure, Reuse settings, Cancel), **Where it runs** (provider, hardware class, worker, and the server's
`worker_status` verbatim), **Estimate and reservation**, **Timeline** (local time with stored UTC underneath), **Execution record**
(unchanged diagnostics: heartbeat, executions, attempts, artifacts, log).

## Rules kept
- Only server values. No percent-complete, ETA or cost is computed; money is `minor_units` divided by the currency's own minor digits.
- Estimates are labelled "Estimated runtime/cost", with confidence, basis, validity and assumptions; a reservation shows its state, the
  authorized maximum and the actual cost ("not reconciled yet" when absent); provider cost is shown only when `provider_cost_status` is
  `AVAILABLE`. "No estimate recorded" otherwise. Payments are disabled and the page says so.
- Cancel and Reuse are offered only when the role can write (unknown role offers nothing); cancel is the only write the page makes.

## Backend change (additive, read-only)
`ComputeJobView.structure_summary: JobStructureSummary | None` (structure id/name, version id/revision, Hill formula, atom count) read
from the immutable calculation input, project-scoped, resolved once per structure version per list request (`hill_formula`/`version_atoms`
from `calculation_summary`, as `research_overview.py` does). Schemas regenerated. Tests: `test_rw2_job_diagnostics.py` (4 new).

Measured, SQLite, 320 jobs on one structure version, 5 requests each, scratch script (not committed):

| | SQL statements | median | min–max |
|---|---|---|---|
| before | 1603 | 164 ms | 153–247 ms |
| after | 1605 | ~151 ms | 148–206 ms |

Cost per additional *distinct* structure version is two statements (not measured with many versions; 50 versions would add ~100 on ~1600).
PostgreSQL timings were not measured.

## Test ids
Kept: `job-row` (now on the list item; `data-job-id`/`data-job-state`), `job-specification`, `job-open`, `job-reuse`, `job-cancel`,
`job-failure`, `job-diagnostics` and its children, `jobs-refresh`, `jobs-error`, `jobs-table` (the list), `queue-status`, `queue-queued`,
`queue-running`, `queue-active`. Replaced: `job-details-toggle` → `job-select`; `job-details-row` → `job-inspector`; `jobs-filter` →
`jobs-filter-chip[data-filter]`. Because `job-inspector` also carries `data-job-id`, specs must scope row lookups with
`[data-testid="job-row"]`. `rw2-analysis-journey.spec.ts` is migrated but NOT re-run (needs native engines).

## Limits
Filtering is client-side over the loaded list (no server paging yet). The queue note is inside a disclosure. Not verified: PostgreSQL
timing, a real AWS job with a real estimate (fixture values only), dark theme, and the AI dock's contents (mock misses).
