import { describe, expect, it } from "vitest";
import type { ComputeJobView } from "@chemdft/schemas";
import {
  defaultJobId, filterCounts, filterJobs, matchesFilter, parseJobsQuery, providersIn, searchText, serializeJobsQuery,
} from "../src/lib/job-model";
import {
  describeEstimate, describeReservation, formatMoney, formatUtcSeconds, JOB_POLL_MS, diagnosticsPollInterval, providerCostText, providerLabel,
} from "../src/lib/job-view";

const base = {
  workload: { workload_type: "chemdft.pyscf.energy.v1" }, provider: "local", latest_execution: null, estimate: null, reservation: null,
  specification_summary: { task_type: "ENERGY", method: "hf", basis: "sto-3g", charge: 0, multiplicity: 1 },
  structure_summary: { structure_name: "Ethanol", formula_hill: "C2H6O", structure_revision: 2 },
};
let n = 0;
const job = (state: string, over: Record<string, unknown> = {}): ComputeJobView =>
  ({ ...base, id: `job-${n++}`, calculation_id: `calc-${n}`, state, created_at: "2026-10-11T05:54:44", ...over }) as unknown as ComputeJobView;

describe("filters, counts and search", () => {
  const jobs = [
    job("RUNNING", { provider: "aws" }), job("READY"), job("SUCCEEDED"), job("FAILED"), job("CANCELED"),
    job("RUNNING", { latest_execution: { state: "LOST" } }),
    job("SUCCEEDED", { structure_summary: { structure_name: "Water", formula_hill: "H2O" } }),
  ];
  it("counts every state chip over the loaded jobs", () => {
    expect(filterCounts(jobs)).toEqual({ all: 7, active: 3, succeeded: 2, failed: 2, canceled: 1 });
  });
  it("treats a lost execution as failed or lost and as still active", () => {
    const lost = jobs[5]!;
    expect(matchesFilter(lost, "failed")).toBe(true);
    expect(matchesFilter(lost, "active")).toBe(true);
  });
  it("searches structure name, formula, task, engine, level of theory, provider and ids", () => {
    const find = (q: string) => filterJobs(jobs, { filter: "all", provider: null, q }).length;
    expect(find("ethanol")).toBe(6);
    expect(find("C2H6O")).toBe(6);
    expect(find("h2o")).toBe(1);
    expect(find("sto-3g")).toBe(7);
    expect(find("single-point")).toBe(7);
    expect(find("aws")).toBe(1);
    expect(find(jobs[3]!.id)).toBe(1);
    expect(find("nothing-like-this")).toBe(0);
  });
  it("combines state, provider and text", () => {
    expect(filterJobs(jobs, { filter: "active", provider: "aws", q: "" })).toHaveLength(1);
    expect(filterJobs(jobs, { filter: "succeeded", provider: null, q: "water" })).toHaveLength(1);
  });
  it("searches a job without structure or specification without throwing", () => {
    const bare = job("PENDING", { structure_summary: null, specification_summary: null });
    expect(searchText(bare)).toContain("specification unavailable");
  });
  it("lists the providers present, and the default job is the newest active one", () => {
    expect(providersIn(jobs)).toEqual(["aws", "local"]);
    expect(defaultJobId(jobs)).toBe(jobs[0]!.id);
    expect(defaultJobId([jobs[2]!, jobs[3]!])).toBe(jobs[2]!.id);
    expect(defaultJobId([])).toBeNull();
  });
});

describe("URL state", () => {
  it("round-trips only the non-default parts", () => {
    expect(serializeJobsQuery({ job: null, filter: "all", provider: null, q: "" })).toBe("");
    const query = { job: "abc", filter: "failed" as const, provider: "aws", q: " ethanol " };
    const text = serializeJobsQuery(query);
    expect(text).toBe("?job=abc&state=failed&provider=aws&q=ethanol");
    expect(parseJobsQuery(text)).toEqual({ ...query, q: "ethanol" });
  });
  it("ignores an unknown state instead of trusting it", () => {
    expect(parseJobsQuery("?state=bogus&job=").filter).toBe("all");
    expect(parseJobsQuery("?job=").job).toBeNull();
  });
});

describe("estimate, reservation and provider cost wording", () => {
  const usd = (cents: number) => ({ currency: "USD", minor_units: cents });
  it("formats money with the currency's own minor digits", () => {
    expect(formatMoney(usd(1234))).toBe("$12.34");
    expect(formatMoney({ currency: "JPY", minor_units: 500 })).toBe("¥500");
    expect(formatMoney({ currency: "ZZZ", minor_units: 7 })).toContain("ZZZ");
    expect(formatMoney({ currency: "not-a-code", minor_units: 7 })).toBe("7 not-a-code (minor units)");
  });
  it("has no estimate when the server recorded none", () => {
    expect(describeEstimate(null)).toBeNull();
    expect(describeReservation(undefined)).toBeNull();
  });
  it("shows ranges, one-sided bounds and missing parts exactly as provided", () => {
    const estimate = (over: Record<string, unknown>) => describeEstimate({
      confidence: "LOW", provider_summary: "x", assumptions: [], valid_until: "2026-10-11T05:54:44", runtime_low_seconds: null, runtime_high_seconds: null,
      cost_low: null, cost_high: null, ...over,
    } as never)!;
    expect(estimate({}).runtime).toBe("not provided");
    expect(estimate({}).cost).toBe("not provided");
    expect(estimate({ cost_low: usd(8), cost_high: usd(22) }).cost).toBe("$0.08 to $0.22");
    expect(estimate({ cost_low: usd(5) }).cost).toBe("at least $0.05");
    expect(estimate({ cost_high: usd(5) }).cost).toBe("up to $0.05");
    expect(estimate({ cost_low: usd(5), cost_high: usd(5) }).cost).toBe("$0.05");
    expect(estimate({ runtime_low_seconds: 20, runtime_high_seconds: 150 }).runtime).toBe("20 s to 2 min 30 s");
    expect(estimate({ confidence: "HIGH" }).confidence).toBe("high");
  });
  it("labels reservations and never invents an actual cost", () => {
    expect(describeReservation({ state: "RESERVED", authorized_max: usd(100), actual_cost: null } as never))
      .toEqual({ state: "Reserved", authorizedMax: "$1.00", actualCost: "not reconciled yet" });
    expect(describeReservation({ state: "RELEASED", authorized_max: usd(100), actual_cost: usd(11) } as never)?.actualCost).toBe("$0.11");
  });
  it("reports provider cost only when the provider reported it", () => {
    const withCost = (status: string) => ({ latest_execution: { metering: { provider_cost: usd(11), provider_cost_status: status } } }) as never;
    expect(providerCostText(withCost("AVAILABLE"))).toBe("$0.11");
    expect(providerCostText(withCost("UNKNOWN"))).toBe("not reported by the provider");
    expect(providerCostText({ latest_execution: null })).toBe("not reported by the provider");
  });
  it("labels providers and shows stored UTC", () => {
    expect([providerLabel("aws"), providerLabel("local"), providerLabel("modal"), providerLabel("other")]).toEqual(["AWS", "Local", "Modal", "other"]);
    expect(formatUtcSeconds("2026-10-11T05:54:44.576154")).toBe("2026-10-11 05:54:44 UTC");
    expect(formatUtcSeconds(null)).toBe("—");
  });
  it("uses one polling cadence", () => {
    expect(diagnosticsPollInterval("RUNNING", true)).toBe(JOB_POLL_MS);
    expect(diagnosticsPollInterval("SUCCEEDED", true)).toBeNull();
    expect(diagnosticsPollInterval("RUNNING", false)).toBeNull();
  });
});
