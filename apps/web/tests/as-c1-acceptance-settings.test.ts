import type { AISettingsView } from "@chemdft/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ResponseStub = { status: () => number; json: () => Promise<unknown> };
type SetupFixtures = {
  page: { goto: () => Promise<never> };
  request: {
    post: (url: string) => Promise<ResponseStub>;
    get: (url: string) => Promise<ResponseStub>;
    put: (url: string, options: unknown) => Promise<ResponseStub>;
  };
};
const registered = vi.hoisted(() => ({
  flow: undefined as undefined | ((fixtures: SetupFixtures) => Promise<void>),
}));

// Execute the actual acceptance setup with in-memory transport stubs. No browser,
// database, provider request, approval control, or scientific worker is started.
vi.mock("@playwright/test", async () => {
  const { expect, vi } = await import("vitest");
  return {
    expect,
    test: Object.assign((_name: string, flow: NonNullable<typeof registered.flow>) => {
      registered.flow = flow;
    }, { setTimeout: vi.fn(), use: vi.fn() }),
  };
});
vi.mock("node:fs", () => ({ mkdirSync: vi.fn(), writeFileSync: vi.fn() }));
import "./e2e/as-c1-nvidia-acceptance.spec";

const model = "nvidia/nemotron-3.5-lightning-30b-a3b";
function settings(): AISettingsView {
  return {
    preferences: { mode: "MANAGED", provider: "nvidia", model },
    availability: {
      mode: "MANAGED", provider: "nvidia", model, available: true,
      error_code: null, managed_enabled: true, byok_enabled: false,
      secret_storage_available: false, local_test_only: false, allowance_status: "AVAILABLE",
    },
    providers: [{ provider: "nvidia", models: [model], local_test_only: false }],
    credentials: [],
  };
}
function setup(current: unknown = settings(), configured: unknown = settings(), getStatus = 200, putStatus = 200) {
  const atBrowser = new Error("OFFLINE STOP: settings validated; browser/planning forbidden");
  const response = (body: unknown, status: number): ResponseStub => ({ status: () => status, json: async () => body });
  const page = { goto: vi.fn(async () => { throw atBrowser; }) };
  const request = {
    post: vi.fn(async (url: string) => {
      if (url === "/api/chemdft/v1/projects") return response({ id: "offline-project" }, 201);
      if (url === "/api/chemdft/v1/projects/offline-project/structures/imports") return response({ version: { id: "offline-version" } }, 201);
      throw new Error(`Unexpected offline POST: ${url}`);
    }),
    get: vi.fn(async (url: string) => {
      expect(url).toBe("/api/chemdft/v1/ai/settings");
      return response(current, getStatus);
    }),
    put: vi.fn(async (url: string, options: unknown) => {
      expect(url).toBe("/api/chemdft/v1/ai/settings");
      expect(options).toEqual({ data: { mode: "MANAGED", provider: "nvidia", model } });
      return response(configured, putStatus);
    }),
  };
  return { page, request, atBrowser, run: () => registered.flow!({ page, request }) };
}

beforeEach(() => {
  vi.stubEnv("CHEMDFT_E2E_WORKER_MODE", "disabled");
  vi.stubEnv("CHEMDFT_E2E_MANUAL_APPROVAL", "1");
  vi.stubEnv("CHEMDFT_AI_PROVIDER", "nvidia");
});
afterEach(() => vi.unstubAllEnvs());

describe("AS-C1.2 acceptance settings contract (offline)", () => {
  it("accepts the nested API contract with no top-level provider and stops before planning", async () => {
    const fixture = settings();
    expect(fixture).not.toHaveProperty("provider");
    const flow = setup(fixture);
    await expect(flow.run()).rejects.toBe(flow.atBrowser);
    expect(flow.request.put).toHaveBeenCalledOnce();
    expect(flow.page.goto).toHaveBeenCalledOnce();
    expect(flow.request.post).toHaveBeenCalledTimes(2); // Only stubbed project/import setup.
  });

  it.each(["preferences.provider", "preferences.model", "availability.provider", "availability.model"] as const)("refuses mismatched initial %s before changing settings or planning", async field => {
    const fixture = settings();
    const [section, key] = field.split(".") as ["preferences" | "availability", "provider" | "model"];
    if (key === "provider") fixture[section].provider = "openai";
    else fixture[section].model = "different-model";
    const flow = setup(fixture);
    const failure = await flow.run().catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBe(flow.atBrowser);
    expect(flow.request.put).not.toHaveBeenCalled();
    expect(flow.page.goto).not.toHaveBeenCalled();
  });

  it.each(["preferences.provider", "preferences.model", "preferences.mode", "availability.provider", "availability.model", "availability.mode", "availability.available"] as const)("refuses invalid settings update %s before planning", async field => {
    const fixture = settings();
    if (field === "preferences.provider") fixture.preferences.provider = "fake";
    if (field === "preferences.model") fixture.preferences.model = "different-model";
    if (field === "preferences.mode") fixture.preferences.mode = "BYOK";
    if (field === "availability.provider") fixture.availability.provider = "fake";
    if (field === "availability.model") fixture.availability.model = "different-model";
    if (field === "availability.mode") fixture.availability.mode = "NONE";
    if (field === "availability.available") fixture.availability.available = false;
    const flow = setup(settings(), fixture);
    const failure = await flow.run().catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBe(flow.atBrowser);
    expect(flow.request.put).toHaveBeenCalledOnce();
    expect(flow.page.goto).not.toHaveBeenCalled();
  });

  it("rejects a misleading top-level provider when authoritative nested identity disagrees", async () => {
    const fixture = settings();
    fixture.preferences.provider = "fake";
    const flow = setup({ ...fixture, provider: "nvidia" });
    const failure = await flow.run().catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBe(flow.atBrowser);
    expect(flow.request.put).not.toHaveBeenCalled();
    expect(flow.page.goto).not.toHaveBeenCalled();
  });

  it.each(["GET", "PUT"])("rejects unsuccessful %s settings responses even with plausible JSON", async method => {
    const flow = setup(settings(), settings(), method === "GET" ? 503 : 200, method === "PUT" ? 422 : 200);
    const failure = await flow.run().catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBe(flow.atBrowser);
    expect(flow.page.goto).not.toHaveBeenCalled();
  });
});
