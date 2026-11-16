import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineCapabilityView } from "@chemdft/schemas";
import {
  createCapabilitiesResource,
  CAPABILITY_CACHE_TTL_MS,
} from "../src/lib/use-calculation-capabilities";
import * as structureApi from "../src/lib/structure-workspace-api";

describe("Calculation capabilities caching strategy", () => {
  const mockCapabilities: EngineCapabilityView[] = [
    {
      engine: "psi4",
      version: "1.11",
      availability: "AVAILABLE",
      supported_tasks: ["ENERGY"],
      supported_methods: ["hf", "b3lyp", "pbe", "mp2"],
      supported_basis_sets: ["sto-3g", "def2-svp"],
    },
    {
      engine: "pyscf",
      version: "2.14.0",
      availability: "AVAILABLE",
      supported_tasks: ["ENERGY", "GEOMETRY_OPTIMIZATION", "FREQUENCY"],
      supported_methods: ["hf", "b3lyp", "pbe"],
      supported_basis_sets: ["sto-3g", "def2-svp"],
    },
  ];

  let resource = createCapabilitiesResource();
  beforeEach(() => {
    resource = createCapabilitiesResource();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fetches capabilities once and returns cached values within TTL", async () => {
    const listSpy = vi
      .spyOn(structureApi, "listCalculationCapabilities")
      .mockResolvedValue(mockCapabilities);

    const first = await resource.get("project-1");
    expect(first).toEqual(mockCapabilities);
    expect(listSpy).toHaveBeenCalledTimes(1);

    // Immediate second call should be served from memory cache without new network call
    const second = await resource.get("project-1");
    expect(second).toEqual(mockCapabilities);
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent in-flight requests for the same project", async () => {
    let resolveNetwork: (val: EngineCapabilityView[]) => void;
    const networkPromise = new Promise<EngineCapabilityView[]>((resolve) => {
      resolveNetwork = resolve;
    });

    const listSpy = vi
      .spyOn(structureApi, "listCalculationCapabilities")
      .mockReturnValue(networkPromise);

    // Trigger two concurrent requests
    const promise1 = resource.get("project-dedup");
    const promise2 = resource.get("project-dedup");

    expect(listSpy).toHaveBeenCalledTimes(1);

    resolveNetwork!(mockCapabilities);

    const [res1, res2] = await Promise.all([promise1, promise2]);
    expect(res1).toEqual(mockCapabilities);
    expect(res2).toEqual(mockCapabilities);
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it("isolates caches across different projects", async () => {
    const listSpy = vi
      .spyOn(structureApi, "listCalculationCapabilities")
      .mockResolvedValue(mockCapabilities);

    await resource.get("project-alpha");
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledWith("project-alpha");

    await resource.get("project-beta");
    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(listSpy).toHaveBeenCalledWith("project-beta");
  });

  it("allows on-demand force refresh to bypass cache", async () => {
    const listSpy = vi
      .spyOn(structureApi, "listCalculationCapabilities")
      .mockResolvedValue(mockCapabilities);

    await resource.get("project-refresh");
    expect(listSpy).toHaveBeenCalledTimes(1);

    // Forced refresh should call network even though cached within TTL
    await resource.get("project-refresh", { force: true });
    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  it("caches failures temporarily to prevent render/retry storms", async () => {
    const listSpy = vi
      .spyOn(structureApi, "listCalculationCapabilities")
      .mockRejectedValue(new Error("Worker environment validation timeout"));

    await expect(resource.get("project-err")).rejects.toThrow(
      "Worker environment validation timeout",
    );
    expect(listSpy).toHaveBeenCalledTimes(1);

    // Subsequent call within error TTL should immediately throw cached error without retrying
    await expect(resource.get("project-err")).rejects.toThrow(
      "Worker environment validation timeout",
    );
    expect(listSpy).toHaveBeenCalledTimes(1);
  });
});

describe("workspace resource isolation and stale-cache safety", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  it("caches an empty response and refreshes only on demand after expiry", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(structureApi, "listCalculationCapabilities").mockResolvedValue([]);
    const resource = createCapabilitiesResource();
    await resource.get("p"); await resource.get("p"); expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CAPABILITY_CACHE_TTL_MS + 1); expect(spy).toHaveBeenCalledTimes(1);
    expect(resource.snapshot("p").error).toContain("expired");
    expect(resource.snapshot("p").loading).toBe(false);
    await resource.get("p"); expect(spy).toHaveBeenCalledTimes(2);
  });
  it("clears previously available data after a failed refresh and requires explicit retry", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(structureApi, "listCalculationCapabilities").mockResolvedValueOnce([{ engine: "psi4" } as EngineCapabilityView]).mockRejectedValue(new Error("offline"));
    const resource = createCapabilitiesResource(); await resource.get("p");
    await expect(resource.get("p", { force: true })).rejects.toThrow("offline");
    expect(resource.snapshot("p").capabilities).toEqual([]);
    vi.advanceTimersByTime(CAPABILITY_CACHE_TTL_MS + 1);
    await expect(resource.get("p")).rejects.toThrow("offline"); expect(spy).toHaveBeenCalledTimes(2);
  });
  it("a late response stays within the originating workspace and project", async () => {
    let finish!: (data: EngineCapabilityView[]) => void;
    vi.spyOn(structureApi, "listCalculationCapabilities").mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue([]);
    const oldWorkspace = createCapabilitiesResource(), newWorkspace = createCapabilitiesResource();
    const pending = oldWorkspace.get("p"); await newWorkspace.get("p"); await oldWorkspace.get("other");
    finish([{ engine: "psi4" } as EngineCapabilityView]); await pending;
    expect(newWorkspace.snapshot("p").capabilities).toEqual([]);
    expect(oldWorkspace.snapshot("other").capabilities).toEqual([]);
  });
});
