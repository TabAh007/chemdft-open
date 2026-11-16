// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement, lazy, Suspense, useEffect, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { KetcherHost, type KetcherApi } from "../src/app/[locale]/projects/[projectId]/workspace/ketcher-editor";

const mocks = vi.hoisted(() => ({ ready: undefined as undefined | ((api: unknown) => Promise<void>) }));
vi.mock("next/dynamic", () => ({ default: (load: () => Promise<ComponentType>) => lazy(async () => ({ default: await load() })) }));
vi.mock("ketcher-standalone", () => ({ StandaloneStructServiceProvider: class {} }));
vi.mock("ketcher-react", () => ({ Editor: ({ onInit }: { onInit: typeof mocks.ready }) => {
  useEffect(() => { mocks.ready = onInit; }, [onInit]);
  return createElement("div", null, "Editor fixture");
} }));
afterEach(() => { vi.unstubAllGlobals(); mocks.ready = undefined; });

it("coalesces readiness callbacks and preserves edits when the SDK announces readiness again", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const onInit = vi.fn();
  let drawing = "original";
  let finishLoad: () => void = () => {};
  const loaded = new Promise<void>(resolve => { finishLoad = resolve; });
  const setMolecule = vi.fn(async (mol: string) => { await loaded; drawing = mol; });
  const api = { setMolecule, getMolfile: async () => drawing } as KetcherApi;
  try {
    await act(async () => {
      root.render(createElement(Suspense, { fallback: null }, createElement(KetcherHost, { initialMolfile: "original", onInit })));
    });
    await vi.waitFor(() => expect(mocks.ready).toBeTypeOf("function"));
    const first = mocks.ready!(api);
    await mocks.ready!(api);
    expect(setMolecule).toHaveBeenCalledTimes(1);
    expect(onInit).not.toHaveBeenCalled();
    finishLoad();
    await first;
    drawing = "researcher-edited nitrogen graph";
    await mocks.ready!(api);
    expect(await api.getMolfile()).toBe("researcher-edited nitrogen graph");
    expect(setMolecule).toHaveBeenCalledTimes(1);
    expect(onInit).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
  }
});
