import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildScientificScene, inferVisualBonds } from "@chemdft/scientific-scene";
import type { StructureVersionDetail } from "@chemdft/schemas";
import water from "../../../packages/scientific-scene/tests/fixtures/water-version.json";

const waterDetail = water as unknown as StructureVersionDetail;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("advanced scientific visualization toolbar layout", () => {
  it("defines compact horizontal toolbar with expected control order", () => {
    const panelSource = read(
      "../src/app/[locale]/projects/[projectId]/workspace/visualization/scientific-visualization-panel.tsx"
    );

    // Verify toolbar container has role and label
    expect(panelSource).toContain('role="toolbar"');
    expect(panelSource).toContain('aria-label="Scientific visualization controls"');

    // Verify control order within toolbar
    const toolbarStart = panelSource.indexOf('role="toolbar"');
    const toolbarEnd = panelSource.indexOf('className="scientific-viewport"');
    const toolbarSource = panelSource.slice(toolbarStart, toolbarEnd);

    const fitIndex = toolbarSource.indexOf('text="Fit"');
    const repIndex = toolbarSource.indexOf("Representation");
    const labelIndex = toolbarSource.indexOf("Labels");
    const paletteIndex = toolbarSource.indexOf("Palette");
    const projIndex = toolbarSource.indexOf("Projection");
    const visualBondsIndex = toolbarSource.indexOf("Visual bonds");
    const measureIndex = toolbarSource.indexOf("Measure");
    const exportIndex = toolbarSource.indexOf('text="Export"');

    expect(fitIndex).toBeGreaterThan(-1);
    expect(repIndex).toBeGreaterThan(fitIndex);
    // 0.0.40: the Display popover is gone; Fit, Representation, Projection, Labels, Palette, Atom size, Label size and Measure sit in the wrapping "Look" group, then (molecules only) Visual bonds and View, then Export.
    expect(toolbarSource).not.toContain("viewer-view-options-btn");
    expect(toolbarSource).toContain('aria-label="Look"');
    expect(toolbarSource).toContain('aria-label="Crystal"');
    expect(projIndex).toBeGreaterThan(repIndex);
    expect(labelIndex).toBeGreaterThan(projIndex);
    expect(paletteIndex).toBeGreaterThan(labelIndex);
    expect(measureIndex).toBeGreaterThan(paletteIndex);
    expect(visualBondsIndex).toBeGreaterThan(measureIndex);
    expect(exportIndex).toBeGreaterThan(visualBondsIndex);
  });

  it("omits unit cell controls when structure has no periodic cell (data-driven)", () => {
    const scene = buildScientificScene(waterDetail);
    expect(scene.kind).toBe("MOLECULE");
    expect(scene.cell).toBeUndefined();

    const panelSource = read(
      "../src/app/[locale]/projects/[projectId]/workspace/visualization/scientific-visualization-panel.tsx"
    );

    // Check condition guarding unit cell controls
    expect(panelSource).toContain("{hasCell ? (");
    expect(panelSource).toContain('scene?.kind === "PERIODIC" && Boolean(scene.cell)');

    // Unit cell is strictly omitted when hasCell is false (no disabled/meaningless control rendered)
    const hasCell = scene.kind === "PERIODIC" && Boolean(scene.cell);
    expect(hasCell).toBe(false);
  });

  it("applies flex-column layout to prevent dead space in visualization pane", () => {
    const cssSource = read("../src/app/shell.css");

    // Verify .visualization-pane overrides two-column grid to full-width flex column
    expect(cssSource).toContain(".visualization-pane {");
    expect(cssSource).toMatch(/\.visualization-pane\s*\{[^}]*display:\s*flex\s*!important;/);
    expect(cssSource).toMatch(/\.visualization-pane\s*\{[^}]*flex-direction:\s*column\s*!important;/);

    // Verify compact toolbar styling
    expect(cssSource).toContain(".visualization-toolbar {");
    expect(cssSource).toMatch(/\.visualization-toolbar\s*\{[^}]*flex-wrap:\s*wrap;/);
    expect(cssSource).toMatch(/\.visualization-toolbar\s*\{[^}]*align-items:\s*center;/);
  });

  it("preserves compact bottom status bar with authoritative and inferred facts", () => {
    const scene = buildScientificScene(waterDetail);
    const inferred = inferVisualBonds(scene);

    expect(scene.atoms).toHaveLength(3);
    expect(scene.bonds).toHaveLength(0); // authoritative
    expect(inferred).toHaveLength(2); // visual-only

    const panelSource = read(
      "../src/app/[locale]/projects/[projectId]/workspace/visualization/scientific-visualization-panel.tsx"
    );
    expect(panelSource).toContain('className="visualization-status"');
    expect(panelSource).toContain("authoritative bonds");
    expect(panelSource).toContain("inferred visual bonds");
  });
});
