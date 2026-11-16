// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ResultActionRow } from "../src/app/_components/results/result-action-row";
import { ScientificStateStrip } from "../src/app/_components/scientific-state-strip";
import { CiteCalculation } from "../src/app/_components/cite-calculation";
import { askAiAboutResult, resultSelectionDetail } from "../src/lib/result-ai-context";
import { readStored, writeStored } from "../src/lib/safe-storage";

const row = () => renderToStaticMarkup(createElement(ResultActionRow, { projectId: "p1", calculationId: "c1", resultId: "r1", label: "IR spectrum" }));

describe("one action row on every results view (0.0.25)", () => {
  it("has Export ▾, Share…, Cite and Ask AI about this result, in this order", () => {
    const html = row();
    const order = ["Export ▾", "Share…", "Cite", "Ask AI about this result"].map((label) => html.indexOf(label));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('data-testid="result-action-row"');
    expect(html).toContain('data-testid="result-ask-ai"');
  });

  it("appears under the status block for IR, Raman, UV/Vis, optimization, thermochemistry and energy results", () => {
    for (const resultType of ["chemdft.vibrational-analysis", "chemdft.tddft", "chemdft.optimization", "chemdft.thermochemistry", "chemdft.energy"]) {
      const html = renderToStaticMarkup(createElement(ScientificStateStrip, {
        projectId: "p1", resultId: "r1",
        result: { calculation_id: "c1", result_type: resultType, authority: "AUTHORITATIVE", validation_state: "VALIDATED", verification_state: "UNVERIFIED" } as never,
      }));
      expect(html, resultType).toContain('data-testid="result-action-row"');
      expect(html).toContain("Ask AI about this result");
      // one status block: the verification fact appears once as a chip, never as a second bullet
      expect(html.split("Not independently verified").length - 1, resultType).toBe(1);
    }
  });

  it("keeps the citation component's own wording; the row only relabels the button", () => {
    const plain = renderToStaticMarkup(createElement(CiteCalculation, { projectId: "p1", calculationId: "c1" }));
    const inline = renderToStaticMarkup(createElement(CiteCalculation, { projectId: "p1", calculationId: "c1", inline: true }));
    expect(plain).toContain("Cite this calculation");
    expect(inline).not.toContain("<h4");
    expect(inline).toContain(">Cite<");
  });

  it("Ask AI selects the result as context and opens the AI panel (no model call)", () => {
    const seen: Array<{ type: string; detail: unknown }> = [];
    const listener = (event: Event) => seen.push({ type: event.type, detail: (event as CustomEvent).detail });
    window.addEventListener("chemdft:workspace-selection", listener);
    window.addEventListener("chemdft:open-ai-scientist", listener);
    askAiAboutResult({ projectId: "p1", calculationId: "c1", resultId: "r1", label: "IR spectrum" });
    window.removeEventListener("chemdft:workspace-selection", listener);
    window.removeEventListener("chemdft:open-ai-scientist", listener);
    expect(seen.map((s) => s.type)).toEqual(["chemdft:workspace-selection", "chemdft:open-ai-scientist"]);
    expect(seen[0]!.detail).toMatchObject({ projectId: "p1", calculationId: "c1", resultId: "r1", currentView: "IR spectrum (selected result)" });
    expect(resultSelectionDetail({ projectId: "p", calculationId: "c", resultId: "r" })).toMatchObject({ currentView: "Selected scientific result" });
  });

  it("panel state persistence never throws when storage is unavailable", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readStored("chemdft:panels:p:dock")).toBeNull();
    expect(() => writeStored("chemdft:panels:p:dock", "true")).not.toThrow();
    spy.mockRestore(); set.mockRestore();
    writeStored("k", "v");
    expect(readStored("k")).toBe("v");
  });

  it("opening the cite panel keeps the action row stable with buttons preceding the full-width panel", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(ResultActionRow, { projectId: "p1", calculationId: "c1", resultId: "r1", label: "IR spectrum" }));
    });

    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="cite-toggle"]')!;
    expect(toggle.textContent).toBe("Cite");
    await act(async () => {
      toggle.click();
    });

    expect(toggle.textContent).toBe("Hide citation");
    const panel = container.querySelector<HTMLDivElement>('[data-testid="cite-panel"]')!;
    expect(panel).not.toBeNull();
    expect(panel.style.order).toBe("10");
    expect(panel.style.width).toBe("100%");

    const askAi = container.querySelector<HTMLButtonElement>('[data-testid="result-ask-ai"]')!;
    expect(askAi).not.toBeNull();
  });
});
