import { afterEach, describe, expect, it, vi } from "vitest";

import { getProductContextOrFallback } from "../src/lib/ai-scientist-api";

const ok = { project_id: "p", selection: {} };
function mockFetch(handler: (body: Record<string, unknown>) => { status: number; json: unknown }) {
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push(body);
    const { status, json } = handler(body);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("AI context id hints fall back to the view text (0.0.18)", () => {
  it("retries without the ids when the server refuses them", async () => {
    const calls = mockFetch((body) => (body.selected_claim_id ? { status: 409, json: { detail: "STALE_SELECTION" } } : { status: 200, json: ok }));
    const context = await getProductContextOrFallback("p", { current_view: "Claims", selected_claim_id: "c" });
    expect(context).toMatchObject(ok);
    expect(calls).toEqual([{ current_view: "Claims", selected_claim_id: "c" }, { current_view: "Claims" }]);
  });
  it("sends one request when the ids are accepted", async () => {
    const calls = mockFetch(() => ({ status: 200, json: ok }));
    await getProductContextOrFallback("p", { current_view: "Jobs", selected_job_id: "j" });
    expect(calls).toHaveLength(1);
  });
  it("a request with no id hints keeps its error", async () => {
    mockFetch(() => ({ status: 500, json: { detail: "boom" } }));
    await expect(getProductContextOrFallback("p", { current_view: "Overview" })).rejects.toThrow();
  });
});
