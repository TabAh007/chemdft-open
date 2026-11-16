import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(webRoot, "../..");

function filesBelow(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

describe("Phase 1 application boundaries", () => {
  it("keeps Blueprint imports behind the UI package", () => {
    const applicationSources = filesBelow(join(webRoot, "src")).filter((path) => /\.[jt]sx?$/.test(path));
    const violations = applicationSources.filter((path) => readFileSync(path, "utf8").includes("@blueprintjs/"));
    expect(violations.map((path) => relative(repositoryRoot, path))).toEqual([]);
  });

  it("contains every contracted locale and project route", () => {
    const routeRoot = join(webRoot, "src/app/[locale]");
    const expected = [
      "page.tsx",
      "projects/page.tsx",
      "jobs/page.tsx",
      "settings/[section]/page.tsx",
      "projects/[projectId]/overview/page.tsx",
      "projects/[projectId]/workspace/page.tsx",
      "projects/[projectId]/jobs/page.tsx",
      "projects/[projectId]/settings/[section]/page.tsx",
    ];
    for (const route of expected) expect(statSync(join(routeRoot, route)).isFile()).toBe(true);
  });

  it("does not install deferred scientific engines, AI, billing, or compute implementations", () => {
    const manifest = readFileSync(join(webRoot, "package.json"), "utf8");
    for (const forbidden of ["openai", "stripe", "rdkit", "pyscf", "psi4", "qcengine", "xtb", "crest"])
      expect(manifest.toLowerCase()).not.toContain(`\"${forbidden}`);
  });

  it("labels unavailable execution instead of inventing results", () => {
    const sources = filesBelow(join(webRoot, "src/app")).filter((path) => path.endsWith(".tsx"));
    const content = sources.map((path) => readFileSync(path, "utf8")).join("\n");
    expect(content).toContain("No compute jobs yet. No synthetic progress is shown.");
    expect(content).toContain("Real compute jobs created by authorized calculation submissions.");
    expect(content).toContain("not a calculated result"); // the homepage illustration discloses that it is schematic
    expect(content).not.toContain("No provider configured; no calls made");
    // PF-4 replaces the administrative AI overview with server-derived project guidance.
    const overview = readFileSync(join(webRoot, "src/app/[locale]/projects/[projectId]/overview/page.tsx"), "utf8");
    // DESIGN-04: the Overview page renders ProjectOverview, which reads the same server Navigator through its hook.
    expect(overview).toContain("ProjectOverview");
    expect(readFileSync(join(webRoot, "src/lib/use-overview-navigator.ts"), "utf8")).toContain("getNavigator(");
    expect(overview).not.toContain("CHEMDFT_AI_PROVIDER");
  });

  it("defines the workstation landmarks and a keyboard skip target", () => {
    const shell = readFileSync(join(webRoot, "src/app/_components/project-shell.tsx"), "utf8");
    const rootLayout = readFileSync(join(webRoot, "src/app/layout.tsx"), "utf8");
    expect(shell).toContain('aria-label="Project sections"');
    expect(readFileSync(join(webRoot, "src/app/_components/project-explorer.tsx"), "utf8")).toContain('aria-label="Project explorer"');
    expect(shell).toContain('aria-label="Inspector and AI context"');
    expect(rootLayout).toContain('href="#main-content"');
  });

  it("keeps scientific demo fixture data out of production workspace source", () => {
    const productionSources = filesBelow(join(webRoot, "src")).filter((path) => /\.[jt]sx?$|\.css$/.test(path));
    const content = productionSources.map((path) => readFileSync(path, "utf8")).join("\n");
    for (const forbidden of [
      "moleculeAtoms",
      "moleculeBonds",
      "crystalSites",
      "molecule-sketch",
      "5.6402",
      "0.6291",
      "NaCl",
    ]) {
      expect(content).not.toContain(forbidden);
    }
  });

  it("keeps the renderer-neutral scene package free of UI and renderer dependencies", () => {
    const sceneRoot = join(repositoryRoot, "packages/scientific-scene/src");
    const sceneSources = filesBelow(sceneRoot).filter((path) => /\.ts$/.test(path));
    const content = sceneSources.map((path) => readFileSync(path, "utf8")).join("\n");
    for (const forbidden of ["react", "next", "three", "3dmol", "ketcher", "@blueprintjs"]) {
      expect(content.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("confines drei and postprocessing to the molecular renderer module", () => {
    const offenders = filesBelow(join(webRoot, "src"))
      .filter((path) => /\.[jt]sx?$/.test(path))
      .filter((path) => /from "(@react-three\/drei|@react-three\/postprocessing|postprocessing)"/.test(readFileSync(path, "utf8")))
      .map((path) => relative(repositoryRoot, path))
      .filter((path) => !path.startsWith("apps/web/src/app/_components/molecular-renderer/"));
    expect(offenders).toEqual([]);
  });

  it("keeps renderer libraries isolated behind visualization adapters", () => {
    const productionSources = filesBelow(join(webRoot, "src")).filter((path) => /\.[jt]sx?$/.test(path));
    const rendererImports = productionSources
      .filter((path) => {
        const content = readFileSync(path, "utf8");
        return content.includes('from "three"') || content.includes('import("3dmol")');
      })
      .map((path) => relative(repositoryRoot, path))
      // PF-3D: the reusable ChemDFT molecular renderer is itself the visualization adapter; its own directory is the one
      // place (besides the workspace viewports below) that may import three. drei/postprocessing are checked separately.
      .filter((path) => !path.startsWith("apps/web/src/app/_components/molecular-renderer/"));
    expect(rendererImports.sort()).toEqual([
      "apps/web/src/app/[locale]/projects/[projectId]/workspace/visualization/orbital-isosurface-viewport.tsx",
      "apps/web/src/app/[locale]/projects/[projectId]/workspace/visualization/structure-viewport.tsx",
      "apps/web/src/app/[locale]/projects/[projectId]/workspace/visualization/studio-viewport.tsx",
      "apps/web/src/app/[locale]/projects/[projectId]/workspace/visualization/three-dmol-viewport.tsx",
    ]);
  });

  it("does not ship fake calculated visualization layers", () => {
    const productionSources = filesBelow(join(webRoot, "src")).filter((path) => /\.[jt]sx?$|\.css$/.test(path));
    const content = productionSources.map((path) => readFileSync(path, "utf8")).join("\n").toLowerCase();
    for (const forbidden of ["fake homo", "fake lumo", "fake esp", "fake orbital", "fake vibration"]) {
      expect(content).not.toContain(forbidden);
    }
  });
});
