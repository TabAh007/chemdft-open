// @vitest-environment jsdom

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ExportMenu } from "../src/app/_components/export/export-menu";

describe("ExportMenu Context Availability & Disabled Reasons (Release 0.0.33)", () => {
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container) {
      container.remove();
      container = null;
    }
    document.querySelectorAll(".bp6-portal, .bp6-popover").forEach((el) => el.remove());
  });

  async function mountAndOpen(element: React.ReactElement): Promise<HTMLElement> {
    const root = createRoot(container!);
    await act(async () => {
      root.render(element);
    });
    const button = container!.querySelector('button[aria-label="Export"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    await act(async () => {
      button.click();
    });
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    return menu;
  }

  it("project context without structure version: structure data items are disabled with honest reasons", async () => {
    const menu = await mountAndOpen(
      createElement(ExportMenu, {
        context: "project",
        projectId: "p1",
      }),
    );

    const xyzItem = menu.querySelector('[data-testid="export-item-xyz"]') as HTMLButtonElement;
    expect(xyzItem).not.toBeNull();
    expect(xyzItem.getAttribute("aria-disabled")).toBe("true");
    expect(xyzItem.textContent).toContain("no committed structure version available");

    const sdfItem = menu.querySelector('[data-testid="export-item-sdf"]') as HTMLButtonElement;
    expect(sdfItem).not.toBeNull();
    expect(sdfItem.getAttribute("aria-disabled")).toBe("true");

    const csvItem = menu.querySelector('[data-testid="export-item-table-csv"]') as HTMLButtonElement;
    expect(csvItem).not.toBeNull();
    expect(csvItem.getAttribute("aria-disabled")).toBe("true");
    expect(csvItem.textContent).toContain("needs a calculation result");

    const htmlItem = menu.querySelector('[data-testid="export-item-html"]') as HTMLButtonElement;
    expect(htmlItem).not.toBeNull();
    expect(htmlItem.getAttribute("aria-disabled")).toBeNull();
  });

  it("structure context without version: items stay visible and disabled with reasons", async () => {
    const menu = await mountAndOpen(
      createElement(ExportMenu, {
        context: "structure",
        projectId: "p1",
      }),
    );

    const htmlItem = menu.querySelector('[data-testid="export-item-html"]') as HTMLButtonElement;
    expect(htmlItem).not.toBeNull();
    expect(htmlItem.getAttribute("aria-disabled")).toBe("true");
    expect(htmlItem.textContent).toContain("select a structure first");

    const pdf3dItem = menu.querySelector('[data-testid="export-item-3d-pdf"]') as HTMLButtonElement;
    expect(pdf3dItem).not.toBeNull();
    expect(pdf3dItem.getAttribute("aria-disabled")).toBe("true");
    expect(pdf3dItem.textContent).toContain("IN TESTING");

    const xyzItem = menu.querySelector('[data-testid="export-item-xyz"]') as HTMLButtonElement;
    expect(xyzItem).not.toBeNull();
    expect(xyzItem.getAttribute("aria-disabled")).toBe("true");
    expect(xyzItem.textContent).toContain("select a structure first");
  });

  it("drawing context without candidate: 3D exports are disabled with clear guidance", async () => {
    const menu = await mountAndOpen(
      createElement(ExportMenu, {
        context: "drawing",
        hasCandidate: false,
        drawingEmpty: false,
        ready: true,
        onExportHtml: () => {},
        onExportPdf: () => {},
        onExportXyz: () => {},
        onExportStructureFile: () => {},
        onExportArchive: () => {},
        onExportImage: () => {},
      }),
    );

    const htmlItem = menu.querySelector('[data-testid="export-item-html"]') as HTMLButtonElement;
    expect(htmlItem.getAttribute("aria-disabled")).toBe("true");
    expect(htmlItem.textContent).toContain("press Generate 3D first");

    const xyzItem = menu.querySelector('[data-testid="export-item-xyz"]') as HTMLButtonElement;
    expect(xyzItem.getAttribute("aria-disabled")).toBe("true");
    expect(xyzItem.textContent).toContain("press Generate 3D first");

    const pdfItem = menu.querySelector('[data-testid="export-item-report-pdf"]') as HTMLButtonElement;
    expect(pdfItem.getAttribute("aria-disabled")).toBeNull();
  });

  it("comparison context: presents comparison reports and tabular data under 4 groups", async () => {
    const menu = await mountAndOpen(
      createElement(ExportMenu, {
        context: "comparison",
        canCompare: true,
        onExport: () => {},
      }),
    );

    expect(menu.querySelector('[data-testid="compare-report-html"]')).not.toBeNull();
    expect(menu.querySelector('[data-testid="compare-export-csv"]')).not.toBeNull();
    expect(menu.querySelector('[data-testid="compare-export-json"]')).not.toBeNull();
  });
});
