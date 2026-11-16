import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The script lives outside the web app and is plain ESM; load it by variable path so the type checker does not need declarations.
const libPath = fileURLToPath(new URL("../../../scripts/live-smoke-lib.mjs", import.meta.url));
const lib = (await import(/* @vite-ignore */ libPath)) as Record<string, (...args: never[]) => unknown> & { H2_HF_STO3G_ENERGY_HARTREE: number };
const call = <T>(name: string, ...args: unknown[]): T => (lib[name] as (...a: unknown[]) => unknown)(...args) as T;

describe("live smoke logic (offline, no network)", () => {
  it("parses --job and rejects unknown options", () => {
    expect(call("parseArgs", [])).toMatchObject({ job: false, unknown: [] });
    expect(call("parseArgs", ["--job"])).toMatchObject({ job: true });
    expect(call<{ unknown: string[] }>("parseArgs", ["--jobs"]).unknown).toEqual(["--jobs"]);
  });

  it("requires both credentials and never echoes a value", () => {
    const missing = call<{ ok: boolean; message: string }>("readCredentials", { CHEMDFT_SMOKE_EMAIL: "smoke@example.test" });
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain("CHEMDFT_SMOKE_PASSWORD");
    expect(missing.message).not.toContain("smoke@example.test");
    expect(call<{ ok: boolean }>("readCredentials", {}).ok).toBe(false);
    expect(call<{ ok: boolean; email: string }>("readCredentials", { CHEMDFT_SMOKE_EMAIL: " a@b.test ", CHEMDFT_SMOKE_PASSWORD: "x" })).toMatchObject({ ok: true, email: "a@b.test" });
  });

  it("defaults to the live site and trims the trailing slash", () => {
    expect(call("readBaseUrl", {})).toBe("https://chemdft.com");
    expect(call("readBaseUrl", { CHEMDFT_SMOKE_BASE_URL: "https://staging.example.test//" })).toBe("https://staging.example.test");
  });

  it("expects geomeTRIC optimisation ON by default and honours 0/1 overrides", () => {
    expect(call("readExpectations", {})).toEqual({ pyscfAvailable: true, geometricOptimisation: true });
    expect(call("readExpectations", { CHEMDFT_SMOKE_EXPECT_GEOMETRIC: "0" })).toMatchObject({ geometricOptimisation: false });
  });

  it("checks the health body", () => {
    expect(call<{ ok: boolean }>("checkHealth", { status: "ok", service: "chemdft-api", scientific_execution: "capability-detected" }).ok).toBe(true);
    expect(call<{ ok: boolean }>("checkHealth", { status: "degraded", service: "chemdft-api" }).ok).toBe(false);
    expect(call<{ ok: boolean }>("checkHealth", null).ok).toBe(false);
  });

  it("compares capability flags with the expectations", () => {
    const pyscf = (optimizers: string[], availability = "AVAILABLE") => [{ engine: "pyscf", availability, version: "2.14.0", supported_optimizers: optimizers }];
    const on = { pyscfAvailable: true, geometricOptimisation: true };
    expect(call<{ ok: boolean }[]>("checkCapabilities", pyscf(["geometric"]), on).every((r) => r.ok)).toBe(true);
    expect(call<{ ok: boolean }[]>("checkCapabilities", pyscf([]), on).some((r) => !r.ok)).toBe(true);
    expect(call<{ ok: boolean }[]>("checkCapabilities", pyscf([]), { ...on, geometricOptimisation: false }).every((r) => r.ok)).toBe(true);
    expect(call<{ ok: boolean }[]>("checkCapabilities", pyscf(["geometric"], "UNAVAILABLE"), on).some((r) => !r.ok)).toBe(true);
    expect(call<{ ok: boolean }[]>("checkCapabilities", { not: "a list" }, on)[0]?.ok).toBe(false);
  });

  it("compares the H2 energy with the recorded value", () => {
    const expected = lib.H2_HF_STO3G_ENERGY_HARTREE;
    expect(expected).toBe(-1.1167593073964255);
    const detail = (energy: number, state = "SUCCEEDED") => ({ calculation: { state }, result: { payload: { scf: { energy_hartree: energy } } } });
    expect(call<{ ok: boolean }>("compareEnergy", detail(-1.1167593073964255)).ok).toBe(true);
    expect(call<{ ok: boolean }>("compareEnergy", detail(-1.1167593073964255 + 1e-12)).ok).toBe(true);
    expect(call<{ ok: boolean }>("compareEnergy", detail(-1.1167)).ok).toBe(false);
    expect(call<{ ok: boolean; detail: string }>("compareEnergy", detail(expected, "FAILED"))).toMatchObject({ ok: false });
    expect(call<{ ok: boolean }>("compareEnergy", { calculation: { state: "SUCCEEDED" }, result: { payload: {} } }).ok).toBe(false);
  });

  it("finds the first project id in page links and recognises terminal states", () => {
    const id = "6408f6c2-0000-4000-8000-000000000001";
    expect(call("firstProjectId", ["/en/projects", `/en/projects/${id}/workspace`])).toBe(id);
    expect(call("firstProjectId", ["/en/projects", "/en/projects/new"])).toBeUndefined();
    expect(call("isTerminalState", "SUCCEEDED")).toBe(true);
    expect(call("isTerminalState", "RUNNING")).toBe(false);
  });

  it("builds the H2 HF/STO-3G submission without any credential", () => {
    const body = call<{ specification: { task_type: string; basis: { identifier: string } }; idempotency_key: string }>("buildH2Submission", "p", "v", "key-1234567");
    expect(body.specification).toMatchObject({ task_type: "ENERGY", method: { identifier: "hf" }, basis: { identifier: "sto-3g" } });
    expect(body.idempotency_key).toBe("key-1234567");
  });
});
