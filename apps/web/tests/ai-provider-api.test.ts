import { afterEach, describe, expect, it, vi } from "vitest";
import { getProductContext, saveAiCredential, revokeAiCredential, saveAiSettings } from "../src/lib/ai-scientist-api";

afterEach(() => vi.unstubAllGlobals());
describe("PF-7 private credential and provider transport", () => {
  it("sends a fake credential once in a POST body and returns masked status", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ provider: "openai", status: "CONFIGURED", fingerprint: "123456789abc" })));
    vi.stubGlobal("fetch", fetcher);
    const value = "pf7-not-a-real-provider-key";
    const status = await saveAiCredential("openai", value);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).not.toContain(value);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ provider: "openai", secret: value });
    expect(JSON.stringify(status)).not.toContain(value);
  });
  it("preserves explicit BYOK failure and never retries with another source", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { code: "BYOK_KEY_INVALID", message: "The selected credential failed." } }), { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(saveAiSettings({ mode: "BYOK", provider: "openai", model: "approved-model" })).rejects.toThrow("BYOK_KEY_INVALID");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("posts only selection hints to the authorized project scope", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    await getProductContext("project-id", { goal: "thermochemistry", current_view: "results" });
    expect(fetcher.mock.calls[0]![0]).toContain("/projects/project-id/ai/context");
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ goal: "thermochemistry", current_view: "results" });
  });
  it("revokes without requesting or returning secret contents", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    await revokeAiCredential("openai");
    expect(fetcher.mock.calls[0]![1].body).toBe(JSON.stringify({ provider: "openai" }));
  });
});
