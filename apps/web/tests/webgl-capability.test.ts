import { afterEach, expect, it, vi } from "vitest";
import { hasWebGl } from "../src/lib/visualization/webgl";

afterEach(() => vi.unstubAllGlobals());

it("releases every support-probe context across repeated viewer mounts", () => {
  let active = 0;
  let probes = 0;
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => {
    active += 1;
    probes += 1;
    return { getExtension: () => ({ loseContext: () => { active -= 1; } }) };
  } }) });
  for (let index = 0; index < 100; index += 1) {
    expect(hasWebGl()).toBe(true);
    expect(active).toBe(0);
  }
  expect(probes).toBe(100);
});

it("falls back to WebGL 1 and releases its context", () => {
  const loseContext = vi.fn();
  const getContext = vi.fn((kind: string) => kind === "webgl2" ? null : {
    getExtension: () => ({ loseContext }),
  });
  vi.stubGlobal("document", { createElement: () => ({ getContext }) });
  expect(hasWebGl()).toBe(true);
  expect(getContext.mock.calls).toEqual([["webgl2"], ["webgl"]]);
  expect(loseContext).toHaveBeenCalledOnce();
});

it("reports unavailable support safely without a document or working context", () => {
  expect(hasWebGl()).toBe(false);
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
  expect(hasWebGl()).toBe(false);
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => { throw new Error("GPU unavailable"); } }) });
  expect(hasWebGl()).toBe(false);
});
