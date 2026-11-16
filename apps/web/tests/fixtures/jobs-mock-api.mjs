// PRESENTATION FIXTURES ONLY. Not scientific results; nothing here is real or persisted.
import http from "node:http";
const PORT = Number(process.env.PORT ?? 8291);
const SMALL = "00000000-0000-4000-8000-0000000000a1";
const BIG = "00000000-0000-4000-8000-0000000000b2";
const EMPTY = "00000000-0000-4000-8000-0000000000c3";
const READONLY = "00000000-0000-4000-8000-0000000000d4";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const calc = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (m) => new Date(Date.now() - m * 60000).toISOString().replace("Z", "");
const money = (c) => ({ currency: "USD", minor_units: c });
const STRUCT = {
  water: { structure_id: "30000000-0000-4000-8000-000000000001", structure_name: "Water", structure_version_id: "31000000-0000-4000-8000-000000000001", structure_revision: 1, formula_hill: "H2O", atom_count: 3 },
  ethanol: { structure_id: "30000000-0000-4000-8000-000000000002", structure_name: "Ethanol", structure_version_id: "31000000-0000-4000-8000-000000000002", structure_revision: 2, formula_hill: "C2H6O", atom_count: 9 },
  h2: { structure_id: "30000000-0000-4000-8000-000000000003", structure_name: "H2 (very long structure name used to test wrapping in the library row)", structure_version_id: "31000000-0000-4000-8000-000000000003", structure_revision: 1, formula_hill: "H2", atom_count: 2 },
};
const estimate = (provider, extra = {}) => ({ id: id(900), project_id: SMALL, requirement_hash: "a".repeat(64), provider, provider_summary: provider === "aws" ? "On-demand EC2 worker (fixture)" : "Local worker (fixture)", runtime_low_seconds: 20, runtime_high_seconds: 150, cost_low: null, cost_high: null, confidence: "MEDIUM", assumptions: ["Fixture assumption: single point, default grid."], valid_until: iso(-60), created_at: iso(30), ...extra });
const reservation = (state, cents, actual = null) => ({ id: id(901), project_id: SMALL, estimate_id: id(900), authorized_max: money(cents), actual_cost: actual, state, created_at: iso(30), reconciled_at: null });
const exec = (state, over = {}) => ({ id: id(800), project_id: SMALL, job_id: id(1), calculation_id: calc(1), calculation_attempt_id: null, provider: "local", state, worker_id: "local.pyscf.worker", lease_owner: null, started_at: iso(10), heartbeat_at: iso(0.2), finished_at: null, hardware_class: null, metering: null, failure_code: null, diagnostic: null, ...over });
function job(n, o) {
  return { id: id(n), project_id: SMALL, calculation_id: calc(n), calculation_input_id: id(500 + n), workload: { workload_type: o.workload ?? "chemdft.pyscf.energy.v1" }, requirement: {}, requirement_hash: "b".repeat(64), state: o.state, provider: o.provider ?? "local", priority: 0, estimate: o.estimate ?? null, reservation: o.reservation ?? null, latest_execution: o.exec ?? null, attempt_count: o.exec ? 1 : 0, specification_summary: o.spec ?? { task_type: "ENERGY", method: "hf", basis: "sto-3g", charge: 0, multiplicity: 1 }, structure_summary: o.structure ?? null, worker_status: o.worker_status ?? null, submitted_by: id(7), created_at: iso(o.age ?? n * 5), updated_at: iso((o.age ?? n * 5) - 1) };
}
const SMALL_JOBS = [
  job(1, { state: "SUCCEEDED", structure: STRUCT.water, estimate: estimate("local"), reservation: reservation("RELEASED", 0), exec: exec("FINISHED", { started_at: iso(9), finished_at: iso(8.8), metering: { runtime_ms: 11250, cpu_ms: null, gpu_ms: null, provider_cost: null, provider_cost_status: "UNKNOWN" } }), age: 9 }),
  job(2, { state: "RUNNING", provider: "aws", workload: "chemdft.pyscf.optimization.v1", spec: { task_type: "OPTIMIZATION", method: "b3lyp", basis: "def2-svp", charge: 0, multiplicity: 1 }, structure: STRUCT.ethanol, estimate: estimate("aws", { cost_low: money(12), cost_high: money(48), runtime_low_seconds: 300, runtime_high_seconds: 1500, assumptions: [] }), reservation: reservation("RESERVED", 100), exec: exec("RUNNING", { provider: "aws", worker_id: "i-0fixture", hardware_class: "t3.large (fixture)", started_at: iso(4) }), age: 6 }),
  job(3, { state: "READY", provider: "aws", structure: STRUCT.water, estimate: estimate("aws", { cost_low: money(5), cost_high: null }), reservation: reservation("RESERVED", 100), worker_status: "The AWS worker is starting. A waiting job begins automatically once it is up (fixture text).", age: 2 }),
  job(4, { state: "FAILED", workload: "chemdft.xtb.frequency.v1", spec: { task_type: "FREQUENCY", method: "gfn2-xtb", basis: null, charge: 0, multiplicity: 1 }, structure: STRUCT.ethanol, estimate: estimate("local"), reservation: reservation("RELEASED", 0), exec: exec("FAILED", { worker_id: "local.xtb.worker", started_at: iso(40), finished_at: iso(39), failure_code: "ENGINE_FAILED", diagnostic: "xtb exited with status 1: SCF did not converge (fixture)" }), age: 40 }),
  job(5, { state: "CANCELED", structure: STRUCT.h2, exec: null, age: 70 }),
  job(6, { state: "RUNNING", structure: STRUCT.water, exec: exec("LOST", { heartbeat_at: iso(12), started_at: iso(20) }), age: 20 }),
  job(7, { state: "SUCCEEDED", provider: "aws", workload: "chemdft.pyscf.frequency.v1", spec: { task_type: "FREQUENCY", method: "hf", basis: "sto-3g", charge: 0, multiplicity: 1 }, structure: STRUCT.water, estimate: estimate("aws", { cost_low: money(8), cost_high: money(22) }), reservation: reservation("RELEASED", 100, money(11)), exec: exec("FINISHED", { provider: "aws", worker_id: "i-0fixture", started_at: iso(100), finished_at: iso(98), hardware_class: "t3.large (fixture)", metering: { runtime_ms: 94000, cpu_ms: null, gpu_ms: null, provider_cost: money(11), provider_cost_status: "AVAILABLE" } }), age: 100 }),
  job(8, { state: "PENDING", structure: null, spec: null, age: 1 }),
];
const BIG_JOBS = Array.from({ length: 230 }, (_, i) => ({ ...job(1000 + i, { state: i % 9 === 0 ? "FAILED" : "SUCCEEDED", structure: i % 2 ? STRUCT.water : STRUCT.ethanol, exec: exec(i % 9 === 0 ? "FAILED" : "FINISHED", { failure_code: i % 9 === 0 ? "ENGINE_FAILED" : null, diagnostic: i % 9 === 0 ? "fixture failure" : null, finished_at: iso(i), metering: { runtime_ms: 5000 + i, cpu_ms: null, gpu_ms: null, provider_cost: null, provider_cost_status: "UNKNOWN" } }), age: 200 + i }), project_id: BIG }));
const STORE = { [SMALL]: structuredClone(SMALL_JOBS), [BIG]: BIG_JOBS, [EMPTY]: [], [READONLY]: SMALL_JOBS.map((j) => ({ ...j, project_id: READONLY })) };
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const m = url.pathname.match(/^\/v1\/projects\/([^/]+)(\/.*)?$/);
  if (url.pathname === "/healthz" || url.pathname === "/health" || url.pathname === "/v1/health") return send(res, 200, { ok: true });
  if (!m) return send(res, 404, { detail: "mock: not found" });
  const [, pid, rest = ""] = m;
  if (!STORE[pid]) return send(res, 404, { detail: "Project not found." });
  const jobs = STORE[pid];
  if (rest === "") return send(res, 200, { id: pid, organization_id: id(1), name: pid === BIG ? "Fixture: 230 jobs" : pid === EMPTY ? "Fixture: no jobs" : pid === READONLY ? "Fixture: read-only" : "Fixture: jobs", slug: "fixture", role: pid === READONLY ? "viewer" : "owner", created_at: iso(900), updated_at: iso(900) });
  if (rest === "/compute/jobs") return send(res, 200, { jobs: [...jobs].sort((a, b) => b.updated_at.localeCompare(a.updated_at)) });
  if (rest === "/compute/queue-status") {
    const c = (s) => jobs.filter((j) => s.includes(j.state)).length;
    return send(res, 200, { schema_id: "chemdft.queue-status.v1", project_id: pid, server_time: iso(0), counts: { queued: c(["READY", "PENDING"]), leased: c(["LEASED"]), running: c(["RUNNING"]), cancel_requested: c(["CANCEL_REQUESTED"]), succeeded: c(["SUCCEEDED"]), failed: c(["FAILED"]), canceled: c(["CANCELED"]) }, oldest_queued_at: jobs.some((j) => j.state === "READY") ? iso(2) : null, active: jobs.filter((j) => j.state === "RUNNING").map((j) => ({ job_id: j.id, calculation_id: j.calculation_id, job_state: j.state, worker_id: j.latest_execution?.worker_id ?? null, lease_owner: null, started_at: null, heartbeat_at: null, heartbeat_age_seconds: j.latest_execution?.state === "LOST" ? 720 : 12, heartbeat_status: j.latest_execution?.state === "LOST" ? "STALE" : "FRESH" })), heartbeat_stale_after_seconds: 60, worker_process_observable: false, notice: "ChemDFT reads persisted leases and heartbeats only; it cannot observe a worker process." });
  }
  let d = rest.match(/^\/compute\/jobs\/([^/]+)\/diagnostics$/);
  if (d) {
    const j = jobs.find((x) => x.id === d[1]); if (!j) return send(res, 404, { detail: "not found" });
    const e = j.latest_execution; const done = j.state === "SUCCEEDED";
    return send(res, 200, { schema_id: "chemdft.job-diagnostics.v1", project_id: pid, job_id: j.id, calculation_id: j.calculation_id, job_state: j.state, server_time: iso(0), executions: e ? [{ execution_id: e.id, attempt_id: null, state: e.state, provider: e.provider, worker_id: e.worker_id, started_at: e.started_at, heartbeat_at: e.heartbeat_at, finished_at: e.finished_at, failure_code: e.failure_code, diagnostic: e.diagnostic, created_at: e.started_at }] : [], attempts: done ? [{ attempt_id: id(700), attempt_number: 1, state: "SUCCEEDED", worker_id: e.worker_id, started_at: e.started_at, finished_at: e.finished_at, failure_code: null, diagnostic: null, engine_name: "pyscf", engine_version: "2.14.0", artifacts: [{ artifact_id: id(701), kind: "ENGINE_LOG", format_identifier: "pyscf.log", size_bytes: 2048, log_readable: true }] }] : [], active_lease: null, heartbeat_age_seconds: j.state === "RUNNING" ? 12 : null, heartbeat_status: j.state === "RUNNING" ? "FRESH" : done ? "NOT_APPLICABLE" : "NOT_REPORTED", heartbeat_stale_after_seconds: 60, progress_reported: false, progress_note: "Native engines do not report a trustworthy percent-complete; elapsed time is not progress.", logs_available: done });
  }
  d = rest.match(/^\/compute\/jobs\/([^/]+)\/logs\/([^/]+)$/);
  if (d) return send(res, 200, { artifact_id: d[2], attempt_id: null, kind: "ENGINE_LOG", media_type: "text/plain", size_bytes: 120, returned_bytes: 120, truncated: false, sha256: "c".repeat(64), text: "converged SCF energy = -74.96 (fixture log line)\nTotal wall time: 1.2 s\n" });
  d = rest.match(/^\/calculations\/([^/]+)\/cancel$/);
  if (d && req.method === "POST") { const j = jobs.find((x) => x.calculation_id === d[1]); if (j) { j.state = "CANCELED"; if (j.latest_execution) j.latest_execution = { ...j.latest_execution, state: "CANCELED", finished_at: iso(0) }; } return send(res, 200, {}); }
  console.log("mock miss", req.method, url.pathname);
  return send(res, 404, { detail: "mock: not found" });
});
server.listen(PORT, "127.0.0.1", () => console.log("jobs mock on", PORT));
