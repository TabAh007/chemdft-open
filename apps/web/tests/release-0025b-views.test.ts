import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ViewerCaption, ViewerToolbar, STATIC_VIEWER_CAPTION, spectraViewerCaption } from "../src/app/_components/viewer-toolbar";
import { energyUnitLabel, formatCoordinateAngstrom, formatEnergyEh, formatFrequencyCm1, formatGradient, formatLocalTime, formatRelativeKcal, displayUnit } from "../src/lib/quantity-format";
import { artifactGroup, convergenceLabel, groupArtifacts, memberLabel, shortId } from "../src/lib/conformer-ensemble";

const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf-8");
const noop = () => undefined;
const toolbar = (prefix: string, withMeasure = false) => renderToStaticMarkup(createElement(ViewerToolbar, {
  testIdPrefix: prefix, style: "ball-stick", styleOptions: [{ value: "ball-stick", label: "Ball and stick" }, { value: "space-fill", label: "Space filling" }],
  onStyleChange: noop, onReset: noop, measure: withMeasure ? { active: "none", onChange: noop } : undefined,
}));

describe("shared viewer toolbar and captions (0.0.25 follow-up)", () => {
  it("renders identically on every page type apart from its test ids; same order and labels", () => {
    const strip = (html: string, prefix: string) => html.replaceAll(prefix, "X");
    expect(strip(toolbar("optimization"), "optimization")).toBe(strip(toolbar("conformer"), "conformer"));
    const html = toolbar("setup", true);
    expect(html.indexOf("Reset view")).toBeLessThan(html.indexOf("Style"));
    expect(html.indexOf("Style")).toBeLessThan(html.indexOf("Distance"));
    expect(html.indexOf("Distance")).toBeLessThan(html.indexOf("Angle"));
    expect(html).toContain("Ball and stick");
    expect(html).toContain("Space filling");
    expect(html).not.toMatch(/Ball &amp; stick|Space fill</);
  });

  it("is keyboard reachable and labelled", () => {
    const html = toolbar("x", true);
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="3D viewer controls"');
    expect(html).toContain('aria-label="Molecule style"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("says what the motion is, and nothing autoplays on load", () => {
    expect(spectraViewerCaption(8)).toBe("Animation of the vibration of mode 8 (exaggerated; an illustration of the calculated mode, not a simulation)");
    expect(STATIC_VIEWER_CAPTION).toBe("Drag to rotate · scroll to zoom");
    expect(renderToStaticMarkup(createElement(ViewerCaption, null, "x"))).toContain("viewer-caption-shared");
    for (const file of ["ir-spectroscopy-panel.tsx", "raman-spectroscopy-panel.tsx"]) {
      const source = read(`src/app/[locale]/projects/[projectId]/workspace/visualization/${file}`);
      expect(source, file).toMatch(/useState<boolean>\(false\);[^\n]*autoplay/i);
      expect(source, file).toContain("spectraViewerCaption(selectedModeIndex + 1)");
    }
    const optimization = read("src/app/[locale]/projects/[projectId]/workspace/visualization/optimization-trajectory-panel.tsx");
    expect(optimization).toContain("const [playing, setPlaying] = useState(false)");
    expect(optimization).toContain("geometries the optimizer visited");
  });
});

describe("precision policy and unit spelling", () => {
  it("applies one policy", () => {
    expect(formatEnergyEh(-280.6721833)).toBe("-280.672183");
    expect(formatRelativeKcal(1.23456)).toBe("1.23");
    expect(formatFrequencyCm1(509.786118)).toBe("509.8");
    expect(formatCoordinateAngstrom(0.123456789)).toBe("0.1235");
    expect(formatGradient(0.000123456)).toBe("1.23e-4");
    for (const unit of ["Eh", "E_h", "HARTREE", "hartree"]) expect(energyUnitLabel(unit)).toBe("Eh");
    expect(displayUnit("E_h")).toBe("Eh");
    const time = formatLocalTime("2026-11-03T22:12:51.442348Z");
    expect(time.utc).toBe("2026-11-03T22:12:51.442Z");
    expect(time.text).not.toContain("T22:12:51.442348Z");
  });
});

describe("CREST ensemble presentation", () => {
  it("groups the native artifacts into result files, logs and internal files", () => {
    const names = ["ensemble-manifest.json", "crest_best.xyz", "crest_conformers.xyz", "crest_rotamers.xyz", "stdout", "stderr", "crestopt.log", "ensemble_energies.log", "coord.tmp", "crest.restart", "scoord.1"];
    const groups = groupArtifacts(names.map((name) => ({ name })));
    expect(groups.map((g) => g.id)).toEqual(["results", "logs", "internal"]);
    expect(groups[0]!.items.map((i) => i.name)).toEqual(["ensemble-manifest.json", "crest_best.xyz", "crest_conformers.xyz", "crest_rotamers.xyz"]);
    expect(groups[2]!.items.map((i) => i.name)).toEqual(["coord.tmp", "crest.restart", "scoord.1"]);
    expect(artifactGroup("crest_best.xyz")).toBe("results");
  });
  it("uses human labels, never a raw UUID or enum", () => {
    expect(memberLabel(1, 2)).toBe("Member 1 of 2 (lowest energy)");
    expect(memberLabel(2, 2)).toBe("Member 2 of 2");
    expect(shortId("ab833ea2-5694-57e9-b252-dacafe4400c8")).toBe("ab833ea2");
    expect(convergenceLabel("NATIVE_GRADIENT_CONVERGED")).toBe("Gradient converged (reported by CREST)");
    const explorer = read("src/app/_components/conformers/conformer-ensemble-explorer.tsx");
    expect(explorer).toContain("Minimum status: not verified");
    expect(explorer).not.toContain("Unverified (UNVERIFIED)");
    expect(explorer).not.toMatch(/currentView: `[^`]*\$\{conformer\.id\}/);
  });
});

describe("optimization and orbital screens", () => {
  it("has the renamed buttons and a styled summary card that keeps the honesty statements", () => {
    const optimization = read("src/app/[locale]/projects/[projectId]/workspace/visualization/optimization-trajectory-panel.tsx");
    expect(optimization).toContain("Open optimized structure");
    expect(optimization).not.toContain(">Open optimized StructureVersion<");
    expect(optimization).toContain("A local minimum is not established without vibrational analysis.");
    expect(optimization).toContain("Connectivity is not independently verified.");
    expect(optimization).toContain('className="optimization-summary-card"');
    expect(read("src/app/_components/guided/selected-guided-result.tsx")).toContain("Open starting structure");
  });
  it("suggests optimization only when the recorded state says none exists", () => {
    const view = read("src/app/_components/guided/guided-result-view.tsx");
    expect(view).toContain("hasOptimizedGeometry === false ?");
    expect(view).not.toContain("E_h");
  });
});

import { compactContextLabel } from "../src/lib/context-label";
describe("third PR: context line and toolbar test ids", () => {
  it("keeps the first and last segment of a long context line and leaves short ones alone", () => {
    expect(compactContextLabel("Paper test - S9 HNO3 and imidazole → hno3 V2 → CREST ensemble → Member 1 of 2 (lowest energy) · member ab833ea2 · ensemble c4bdaaf3 · minimum not verified"))
      .toBe("Paper test - S9 HNO3 and imidazole → … → Member 1 of 2 (lowest energy) · member ab833ea2 · ensemble c4bdaaf3 · minimum not verified");
    expect(compactContextLabel("hno3 V3 → IR → Mode 8")).toBe("hno3 V3 → IR → Mode 8");
  });
  it("the shared toolbar can carry the Calculation-setup test ids, so every existing e2e hook keeps working", () => {
    const html = renderToStaticMarkup(createElement(ViewerToolbar, {
      testIdPrefix: "guided", style: "ball-stick", styleOptions: [], onStyleChange: noop, onReset: noop, resetTestId: "guided-reset-view-btn",
      styleButtons: [{ value: "ball-stick", label: "Ball and stick", testId: "guided-style-ball-stick" }, { value: "space-fill", label: "Space filling", testId: "guided-style-space-fill" }],
      measure: { active: "none", onChange: noop }, measureTestIds: { distance: "guided-measure-distance-btn", angle: "guided-measure-angle-btn" },
    }));
    for (const id of ["guided-reset-view-btn", "guided-style-ball-stick", "guided-style-space-fill", "guided-measure-distance-btn", "guided-measure-angle-btn"]) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain('aria-pressed="true"');
  });
});
