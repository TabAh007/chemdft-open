// @vitest-environment jsdom

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { Export3dPdfDialog } from "../src/app/_components/export/export-3d-pdf-dialog";
import { ProjectExportMenu } from "../src/app/_components/export/project-export-menu";
import { ExportMenu, EXPORT_GROUPS_ORDER, type ExportContextKind } from "../src/app/_components/export/export-menu";
import { ShareDialog } from "../src/app/_components/export/share-dialog";
import { exportFilename } from "../src/lib/molecule-editor/export-name";

describe("Export and Share UI Components (Release 0.0.13)", () => {
  it("renders ProjectExportMenu with export button and share button", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectExportMenu, {
        projectId: "test-proj-123",
        projectName: "Lophine Oxidation",
        structureLabel: "Lophine A1 · V1",
        formula: "C21H16N2",
        atomCount: 39,
        authority: "CALCULATED",
      }),
    );

    expect(html).toContain("Export ▾");
    expect(html).toContain("Share…");
    expect(html).toContain('data-testid="project-export-controls"');
    expect(html).toContain('data-testid="project-export-menu-btn"');
    expect(html).toContain('data-testid="project-share-btn"');
  });

  it("renders ShareDialog with Phase 1 device share, mailto, whatsapp and honest badges", () => {
    const html = renderToStaticMarkup(
      createElement(ShareDialog, {
        isOpen: true,
        onClose: () => {},
        title: "Lophine A1",
        shareSummary: "ChemDFT Evidence: Lophine A1 (C21H16N2) · CALCULATED",
        downloadFilename: "lophine_a1_3d.pdf",
        onDownload: () => {},
        downloadLabel: "Download 3D PDF",
      }),
    );

    expect(html).toContain("Share Research Evidence");
    expect(html).toContain("Lophine A1");
    expect(html).toContain("lophine_a1_3d.pdf");
    expect(html).toContain("Download 3D PDF");
    expect(html).toContain("Device Share Sheet");
    expect(html).toContain("Email Draft (mailto:)");
    expect(html).toContain("WhatsApp Message");
    expect(html).toContain("Hosted Public Link with Expiry");
    expect(html).toContain("PLANNED");
    expect(html).toContain("AVAILABLE");
    expect(html).toContain("mailto:?subject=");
    expect(html).toContain("https://api.whatsapp.com/send?text=");
  });

  it("renders Export3dPdfDialog with honest Acrobat compatibility callout and content options", () => {
    const htmlTesting = renderToStaticMarkup(
      createElement(Export3dPdfDialog, {
        isOpen: true,
        onClose: () => {},
        onOpenShare: () => {},
        projectId: "test-proj-123",
        structureName: "Lophine A1",
        formula: "C21H16N2",
        atomCount: 39,
        authority: "CALCULATED",
        isAvailable: false,
      }),
    );

    expect(htmlTesting).toContain("Export 3D PDF (Adobe Acrobat)");
    expect(htmlTesting).toContain("Lophine A1");
    expect(htmlTesting).toContain("C21H16N2 · 39 atoms");
    expect(htmlTesting).toContain("[CALCULATED]");
    expect(htmlTesting).toContain("IN TESTING — NOT AVAILABLE YET");
    expect(htmlTesting).toContain("In Testing — Not Available");
    expect(htmlTesting).toContain("Adobe Acrobat or Adobe Acrobat Reader on Windows/macOS is required");

    const htmlAvailable = renderToStaticMarkup(
      createElement(Export3dPdfDialog, {
        isOpen: true,
        onClose: () => {},
        onOpenShare: () => {},
        projectId: "test-proj-123",
        structureName: "Lophine A1",
        formula: "C21H16N2",
        atomCount: 39,
        authority: "CALCULATED",
        isAvailable: true,
      }),
    );
    expect(htmlAvailable).toContain("AVAILABLE");
    expect(htmlAvailable).toContain("Download 3D PDF");
  });

  it("correctly sanitizes export filenames across all supported extensions", () => {
    expect(exportFilename("Lophine / HNO3 complex", "pdf")).toBe("Lophine-HNO3-complex.pdf");
    expect(exportFilename("Ethanol (C2H6O)", "mol")).toBe("Ethanol-(C2H6O).mol");
    expect(exportFilename("Water", "sdf")).toBe("Water.sdf");
    expect(exportFilename("Benzene", "smi")).toBe("Benzene.smi");
    expect(exportFilename("Drawing *?<>|", "svg")).toBe("Drawing.svg");
  });
});

describe("Unified Export Control (Release 0.0.14)", () => {
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
    // Clean up any Blueprint popovers in document body
    document.querySelectorAll(".bp6-portal, .bp6-popover").forEach((el) => el.remove());
  });

  async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
    const root = createRoot(container!);
    await act(async () => {
      root.render(element);
    });
    return container!;
  }

  it("renders the exact same button label 'Export ▾' and accessible name 'Export' in every context", () => {
    const contexts: ExportContextKind[] = ["project", "structure", "drawing", "result", "comparison"];
    for (const ctx of contexts) {
      let el: React.ReactElement;
      if (ctx === "project") {
        el = createElement(ExportMenu, { context: "project", projectId: "p1" });
      } else if (ctx === "structure") {
        el = createElement(ExportMenu, { context: "structure", projectId: "p1", structureId: "s1", structureVersionId: "v1" });
      } else if (ctx === "drawing") {
        el = createElement(ExportMenu, {
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
        });
      } else if (ctx === "result") {
        el = createElement(ExportMenu, { context: "result", projectId: "p1", calculationId: "c1" });
      } else {
        el = createElement(ExportMenu, { context: "comparison", canCompare: true, onExport: () => {} });
      }

      const html = renderToStaticMarkup(el);
      expect(html).toContain('aria-label="Export"');
      expect(html).toContain("Export ▾");
    }
  });

  it("renders the strict fixed group order in menu: Share and read, Structure data, Pictures and tables, Whole project .zip", async () => {
    expect(EXPORT_GROUPS_ORDER.map((g) => g.key)).toEqual(["SHARE_AND_READ", "STRUCTURE_DATA", "PICTURES_AND_TABLES", "PROJECT_ZIP"]);

    await mount(
      createElement(ExportMenu, {
        context: "project",
        projectId: "p1",
        structureId: "s1",
        structureVersionId: "v1",
      }),
    );

    const button = container!.querySelector('button[aria-label="Export"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    await act(async () => {
      button.click();
    });

    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();

    const expectedLabels = ["Share and read", "Structure data", "Pictures and tables", "Whole project .zip"];
    const groupHeaders = [...menu.querySelectorAll("div")].filter(
      (el) => el.getAttribute("role") === "presentation" && expectedLabels.includes(el.textContent ?? ""),
    );
    expect(groupHeaders.map((el) => el.textContent)).toEqual(expectedLabels);
  });

  it("drawing context: keeps items visible but disabled with an honest reason when 3D is not generated", async () => {
    await mount(
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

    const button = container!.querySelector('button[aria-label="Export"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();

    // 1. Interactive 3D web page: visible but disabled
    const htmlItem = menu.querySelector('[data-testid="export-item-html"]') as HTMLButtonElement;
    expect(htmlItem).not.toBeNull();
    expect(htmlItem.getAttribute("aria-disabled")).toBe("true");
    expect(htmlItem.textContent).toContain("press Generate 3D first");

    // 2. 3D PDF: visible but disabled
    const pdf3dItem = menu.querySelector('[data-testid="export-item-3d-pdf"]') as HTMLButtonElement;
    expect(pdf3dItem).not.toBeNull();
    expect(pdf3dItem.getAttribute("aria-disabled")).toBe("true");
    expect(pdf3dItem.textContent).toContain("press Generate 3D first");

    // 3. 2D Report PDF: enabled
    const reportItem = menu.querySelector('[data-testid="export-item-report-pdf"]') as HTMLButtonElement;
    expect(reportItem).not.toBeNull();
    expect(reportItem.getAttribute("aria-disabled")).toBeNull();

    // 4. Molfile: enabled
    const molItem = menu.querySelector('[data-testid="export-item-mol"]') as HTMLButtonElement;
    expect(molItem).not.toBeNull();
    expect(molItem.getAttribute("aria-disabled")).toBeNull();
  });

  it("comparison context: presents comparison reports and data under standard 4-group order", async () => {
    await mount(
      createElement(ExportMenu, {
        context: "comparison",
        canCompare: true,
        onExport: () => {},
      }),
    );

    const button = container!.querySelector('button[aria-label="Export"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();

    expect(menu.querySelector('[data-testid="compare-report-html"]')).not.toBeNull();
    expect(menu.querySelector('[data-testid="compare-report-markdown"]')).not.toBeNull();
    expect(menu.querySelector('[data-testid="compare-report-json"]')).not.toBeNull();
    expect(menu.querySelector('[data-testid="compare-export-csv"]')).not.toBeNull();
    expect(menu.querySelector('[data-testid="compare-export-json"]')).not.toBeNull();
  });

  it("result context: renders unified Export button and standard 4-group order", async () => {
    await mount(
      createElement(ExportMenu, {
        context: "result",
        projectId: "p1",
        calculationId: "c1",
        resultId: "r1",
        structureLabel: "Water",
      }),
    );

    const button = container!.querySelector('button[aria-label="Export"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.textContent).toContain("Export ▾");
    await act(async () => {
      button.click();
    });

    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    const expectedLabels = ["Share and read", "Structure data", "Pictures and tables", "Whole project .zip"];
    const groupHeaders = [...menu.querySelectorAll("div")].filter(
      (el) => el.getAttribute("role") === "presentation" && expectedLabels.includes(el.textContent ?? ""),
    );
    expect(groupHeaders.map((el) => el.textContent)).toEqual(expectedLabels);
  });
});
