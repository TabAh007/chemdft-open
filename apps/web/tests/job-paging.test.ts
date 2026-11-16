import { describe, expect, it } from "vitest";
import type { ComputeJobView } from "@chemdft/schemas";

import { appendJobs, jobsListSearch, refreshLimit, SERVER_PAGE, serverFilterKey, serverFilterOf, supportsServerPaging } from "../src/lib/job-paging";

const job = (id: string) => ({ id }) as unknown as ComputeJobView;

describe("job list paging (0.0.18)", () => {
  it("sends only non-default filters", () => {
    expect(jobsListSearch({ limit: 200, offset: 0, phase: "all", provider: null, q: "" })).toBe("?limit=200");
    expect(jobsListSearch({ limit: 200, offset: 400, phase: "failed", provider: "aws", q: "h2o" }))
      .toBe("?limit=200&offset=400&phase=failed&provider=aws&q=h2o");
  });
  it("maps the URL query to a trimmed server filter", () => {
    const filter = serverFilterOf({ filter: "active", provider: null, q: "  water " });
    expect(filter).toEqual({ phase: "active", provider: null, q: "water" });
    expect(serverFilterKey(filter)).toBe("active||water");
  });
  it("feature-detects the server: a numeric total means paging, anything else falls back", () => {
    expect(supportsServerPaging({ total: 0 })).toBe(true);
    expect(supportsServerPaging({ total: 12 })).toBe(true);
    expect(supportsServerPaging({})).toBe(false);
    expect(supportsServerPaging({ total: null })).toBe(false);
  });
  it("appends a page without duplicating or reordering", () => {
    const held = [job("a"), job("b")];
    expect(appendJobs(held, [job("b"), job("c")]).map((j) => j.id)).toEqual(["a", "b", "c"]);
    expect(appendJobs([], [job("x")]).map((j) => j.id)).toEqual(["x"]);
  });
  it("a refresh keeps every page already loaded", () => {
    expect(refreshLimit(0)).toBe(SERVER_PAGE);
    expect(refreshLimit(SERVER_PAGE)).toBe(SERVER_PAGE);
    expect(refreshLimit(SERVER_PAGE + 1)).toBe(SERVER_PAGE * 2);
  });
  it("an old-server payload (no total, no next_offset) still parses as a job list", () => {
    const legacy: { jobs: ComputeJobView[]; total?: number | null } = { jobs: [] };
    expect(supportsServerPaging(legacy)).toBe(false);
  });
});
