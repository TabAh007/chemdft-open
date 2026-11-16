import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GuidedNav } from "../src/app/_components/guided/guided-nav";
import { calculationNeedsPolling } from "../src/lib/ai-run-timeline";
import { listCalculationCapabilities } from "../src/lib/structure-workspace-api";
import { RELEASES } from "../src/content/releases";

afterEach(() => vi.unstubAllGlobals());

describe("0.0.19: the AI panel's Runs and Tools tabs survive unexpected replies", () => {
  it("a calculation record without its calculation row is not polled forever and does not throw", () => {
    expect(calculationNeedsPolling({ specification: {}, result: null } as never)).toBe(false);
    expect(calculationNeedsPolling(undefined)).toBe(true);
  });
  it("a capabilities reply that is not a list is refused instead of reaching code that calls .find on it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ calculation: { id: "x" } }), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(listCalculationCapabilities("00000000-0000-4000-8000-000000000001")).rejects.toThrow(/unexpected reply/);
  });
  it("a real list passes through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ engine: "pyscf" }]), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(listCalculationCapabilities("00000000-0000-4000-8000-000000000001")).resolves.toEqual([{ engine: "pyscf" }]);
  });
});

describe("0.0.19: the left navigation names one current page", () => {
  const html = (view: "imported" | "result") => renderToStaticMarkup(createElement(GuidedNav, {
    currentView: view, hasStructure: true, hasElectronicResult: true, hasImported: true,
    onNavigateHome: () => {}, onNavigateStructure: () => {}, onNavigateCalculations: () => {}, onNavigateResult: () => {}, onSwitchToAdvanced: () => {},
  }));
  it("Files & Data alone is current on the imported page (no second current page under Results)", () => {
    expect((html("imported").match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(html("imported")).toMatch(/aria-current="page"[^>]*aria-label="Files &amp; Data"|aria-label="Files &amp; Data"[^>]*aria-current="page"/);
  });
  it("Results keeps its own current page", () => {
    expect(html("result")).toMatch(/aria-current="page"[^>]*aria-label="Results"|aria-label="Results"[^>]*aria-current="page"/);
  });
});

describe("0.0.19 release notes", () => {
  const entry = RELEASES.find((r) => r.version === "0.0.19")!;
  it("lists what was checked and says no calculation was performed", () => {
    expect(entry.version).toBe("0.0.19");
    expect(entry.scientificStatus.verified.length).toBeGreaterThan(0);
    expect(entry.scientificStatus.notYetVerified.length).toBeGreaterThan(0);
    expect(entry.scientificStatus.knownLimits.join(" ")).toContain("No scientific calculation was performed");
  });
});
