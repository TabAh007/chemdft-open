import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import axe from "axe-core";

/**
 * RW-3.2 researcher UX on a DISPOSABLE COPY of the accepted native-engine evidence:
 *   python3 tools/rw2_evidence_stack.py --api-port 8191 --web-port 3191
 *   RW2_EVIDENCE_API_PORT=8191 RW2_EVIDENCE_WEB_PORT=3191 RW2_EVIDENCE_SPEC=e2e/rw32-researcher-ux.spec.ts \
 *   playwright test --config playwright.rw2-evidence.config.ts
 * Writes (molecules, structure versions) go only to that copy. No engine calculation is run here; the
 * molecule flow uses the server's RDKit conformer generation and geometry acceptance.
 */
const PROJECT = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d"; // 15 genuine PySCF results
const API = "/api/chemdft";
const BASE = `/en/projects/${PROJECT}`;
const SHOTS = resolve(process.env.CHEMDFT_RW32_SHOTS ?? "../../output/rw32-review/screens");
mkdirSync(SHOTS, { recursive: true });
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

/** Read-only API GET; retried on a dropped dev-proxy keep-alive socket (ECONNRESET), never on an HTTP error. */
async function getJson(request: APIRequestContext, url: string): Promise<Json> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await request.get(url);
      expect(response.ok(), url).toBe(true);
      return (await response.json()) as Json;
    } catch (error) {
      if (attempt >= 2 || !String(error).includes("ECONNRESET")) throw error;
    }
  }
}

async function overview(request: APIRequestContext, project = PROJECT): Promise<Json> {
  return getJson(request, `${API}/v1/projects/${project}/research-overview`);
}

async function setMode(page: Page, mode: "guided" | "advanced") {
  await page.addInitScript((value) => { try { localStorage.setItem("chemdft:workspace-mode", value); } catch { /* ignore */ } }, mode);
}

async function axeViolations(page: Page) {
  await page.evaluate(axe.source);
  const result = await page.evaluate(() =>
    (window as unknown as { axe: typeof axe }).axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }),
  );
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

/** Neither the page nor the document column scrolls sideways; wide tables scroll in their own regions. */
async function noPageOverflow(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector(".project-document");
    return document.documentElement.scrollWidth <= window.innerWidth + 1 && (!main || main.scrollWidth <= main.clientWidth + 1);
  });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.jpg`, type: "jpeg", quality: 72 });
}

// ------------------------------------------------------------------ navigation / information architecture

test("one ordered section navigation in both modes, with exact active section", async ({ page }) => {
  for (const mode of ["guided", "advanced"] as const) {
    await setMode(page, mode);
    await page.goto(`${BASE}/compare`);
    const nav = page.getByRole("navigation", { name: "Project sections" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link")).toHaveText(["Overview", "Workspace", "Results", "Compare", "Jobs", "Claims", "Paper vs ChemDFT", "Settings"]);
    await expect(nav.locator('[aria-current="page"]')).toHaveText("Compare");
    await page.goto(`${BASE}/comparison`);
    await expect(nav.locator('[aria-current="page"]')).toHaveText("Paper vs ChemDFT"); // "compare" never matches "comparison"
    await page.goto(`${BASE}/results`);
    await expect(nav.locator('[aria-current="page"]')).toHaveText("Results");
    await expect(page.locator(".document-tabs")).toHaveCount(0); // the per-page strips are gone
    // Results is scrollable in both modes (Guided previously locked the document scroller).
    const scroller = page.locator(".project-document");
    expect(await scroller.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    await expect(page.getByTestId("results-row").first()).toBeVisible();
  }
  expect(await axeViolations(page)).toEqual([]);
});

// ------------------------------------------------------------------ results navigation

test("Inspect result opens the Results-owned inspector (both modes); the workspace deep link stays compatible", async ({ page, request }) => {
  const rows = (await overview(request)).rows as Json[];
  const orbital = rows.find((row) => row.task === "ORBITAL" && row.result_id)!;
  const stored = (await getJson(request, `${API}/v1/projects/${PROJECT}/results/${orbital.result_id}`)) as Json;
  for (const mode of ["advanced", "guided"] as const) {
    await setMode(page, mode);
    await page.goto(`${BASE}/results`);
    const row = page.locator(`[data-testid="results-row"][data-result-id="${orbital.result_id}"]`);
    const open = row.getByTestId("results-open");
    await expect(open).toHaveText("Inspect result");
    await expect(open).toHaveAttribute("href", `${BASE}/results/${orbital.result_id}`);
    await open.click();
    // the detail page belongs to Results: no workspace, no older Guided result flow
    await expect(page).toHaveURL(new RegExp(`${BASE}/results/${orbital.result_id}$`));
    const inspector = page.getByTestId("result-inspector");
    await expect(inspector).toBeVisible({ timeout: 60_000 });
    await expect(inspector).toHaveAttribute("data-result-id", orbital.result_id);
    await expect(inspector).toHaveAttribute("data-viewer", "orbitals");
    await expect(page.getByTestId("inspector-title")).toContainText("Molecular orbitals");
    await expect(page.getByTestId("context-facts")).toContainText(/pyscf/);
    await expect(page.getByTestId("context-facts")).toContainText(/hf|hartree/i);
    await expect(page.getByTestId("authority-panel")).toContainText("Not independently verified");
    await expect(page.getByTestId("authority-panel")).toContainText("Authoritative");
    await expect(page.getByTestId("result-viewer")).toBeVisible({ timeout: 60_000 });
    expect([stored.authority, stored.validation_state, stored.verification_state]).toEqual(["AUTHORITATIVE", "VALIDATED", "UNVERIFIED"]);
    expect(await noPageOverflow(page)).toBe(true);
    await shot(page, `result-orbital-inspector-${mode}-1440`);

    // compatibility: the bookmarked workspace deep link still opens the result's workspace viewer with its context
    const workspace = page.getByTestId("inspector-workspace");
    await expect(workspace).toHaveAttribute("href", new RegExp(`selection=calculationResult%3A${orbital.result_id}&source=${orbital.calculation_id}`));
    await workspace.click();
    await expect(page).toHaveURL(new RegExp(`selection=calculationResult%3A${orbital.result_id}`));
    const context = page.getByTestId("result-context").first();
    await expect(context).toBeVisible({ timeout: 60_000 });
    await expect(context).toContainText("Molecular orbitals");
    await expect(context).toContainText("Not independently verified");
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${BASE}/results/${orbital.result_id}$`));
    await page.getByTestId("results-back").click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/results$`));
    await expect(page.getByTestId("results-row").first()).toBeVisible();
  }
});

test("a result link that is missing or foreign explains itself in Results and shows nothing", async ({ page }) => {
  await page.goto(`${BASE}/results/${randomUUID()}`);
  const error = page.getByTestId("result-error");
  await expect(error).toBeVisible({ timeout: 60_000 });
  await expect(error).toHaveAttribute("data-kind", "missing");
  await expect(page.getByTestId("primary-readout")).toHaveCount(0);
  await expect(page.getByTestId("results-back")).toBeVisible();
});

test("a calculation record is never blank and offers its result", async ({ page, request }) => {
  const rows = (await overview(request)).rows as Json[];
  for (const task of ["ORBITAL", "TDDFT", "FREQUENCY", "THERMOCHEMISTRY"]) {
    const row = rows.find((item) => item.task === task && item.result_id)!;
    await setMode(page, "advanced");
    await page.goto(`${BASE}/workspace?selection=calculation%3A${row.calculation_id}`);
    await expect(page.getByTestId("workspace-calculation-summary")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("result-context")).toContainText(task === "TDDFT" ? "TDDFT" : /./);
    await page.getByTestId("result-context-open-result").click();
    await expect(page).toHaveURL(new RegExp(`selection=calculationResult%3A${row.result_id}`));
  }
});

test("a missing or foreign result link explains itself and substitutes nothing", async ({ page }) => {
  for (const mode of ["advanced", "guided"] as const) {
    await setMode(page, mode);
    await page.goto(`${BASE}/workspace?selection=calculationResult%3A${randomUUID()}&source=${randomUUID()}`);
    await expect(page.getByTestId("workspace-stale-notice")).toContainText("not available in this project", { timeout: 60_000 });
    await expect(page.getByTestId("result-context")).toHaveCount(0);
  }
});

// ------------------------------------------------------------------ exports

test("export panel groups deliverables and states the archive class the download produces", async ({ page, request }) => {
  const rows = (await overview(request)).rows as Json[];
  const energy = rows.find((row) => row.task === "ENERGY" && row.result_id)!;
  const catalog = await getJson(request, `${API}/v1/projects/${PROJECT}/calculations/${energy.calculation_id}/exports`);
  const archive = catalog.formats.find((f: Json) => f.format === "reproducibility-bundle");
  const download = await request.get(`${API}/v1/projects/${PROJECT}/calculations/${energy.calculation_id}/export?format=reproducibility-bundle`);
  expect(download.status()).toBe(200);
  const filename = download.headers()["content-disposition"] ?? "";
  const produced = filename.includes("reproducibility-package") ? "REPRODUCIBILITY_PACKAGE" : "PROVENANCE_ARCHIVE";
  expect(archive.variants[0].key).toBe(produced);

  await setMode(page, "advanced");
  await page.goto(`${BASE}/results`);
  const row = page.locator(`[data-testid="results-row"][data-calculation-id="${energy.calculation_id}"]`);
  await row.getByTestId("row-actions").click();
  await page.locator('[data-testid="row-menu"] [data-action="export"]').click();
  await expect(page).toHaveURL(new RegExp(`${BASE}/results/${energy.result_id}\\?section=export`));
  const panel = page.getByTestId("export-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId("export-group-raw")).toContainText("Raw scientific data");
  await expect(panel.getByTestId("export-group-report")).toContainText("Human-readable report");
  await expect(panel.getByTestId("export-group-archive")).toContainText("Evidence archive");
  await expect(panel.getByTestId("export-archive-class")).toHaveAttribute("data-class", produced);
  expect(await noPageOverflow(page)).toBe(true);
  await shot(page, "results-export-panel-1440");
});

// ------------------------------------------------------------------ molecule identity and versions

const WATER_MOL = "\n  ChemDFT\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\nM  END\n";
const ETHANOL_MOL = "\n  ChemDFT\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    1.2990    0.7500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    2.5981    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0  0  0  0\n  2  3  1  0  0  0  0\nM  END\n";

async function drawAndCommit(page: Page, mol: string, name?: string, options: { expectComposition?: boolean } = {}) {
  await expect(page.getByTestId("generate-3d-btn")).toBeEnabled({ timeout: 90_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __ketcher?: unknown }).__ketcher));
  await page.evaluate(async (molfile) => {
    await (window as unknown as { __ketcher: { setMolecule(m: string): Promise<void> } }).__ketcher.setMolecule(molfile);
  }, mol);
  if (name !== undefined) await page.getByTestId("molecule-name-input").fill(name);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/geometry-candidates") && r.request().method() === "POST"),
    page.getByTestId("generate-3d-btn").click(),
  ]);
  await expect(page.getByTestId("candidate-preview-container")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("ack-inspected-geometry").check();
  await page.getByTestId("ack-understands-not-optimized").check();
  if (options.expectComposition) return;
  await Promise.all([
    page.waitForResponse((r) => /\/geometry-candidates\/[^/]+\/accept$/.test(r.url()) && r.request().method() === "POST"),
    page.getByTestId("accept-geometry-btn").click(),
  ]);
}

async function structures(request: APIRequestContext, project: string): Promise<Json[]> {
  return (await getJson(request, `${API}/v1/projects/${project}/structures`)) as unknown as Json[];
}

async function versions(request: APIRequestContext, project: string, structure: string): Promise<Json[]> {
  return (await getJson(request, `${API}/v1/projects/${project}/structures/${structure}/versions`)) as unknown as Json[];
}

function formula(atoms: Json[]): string {
  const counts: Record<string, number> = {};
  for (const atom of atoms) counts[atom.element] = (counts[atom.element] ?? 0) + 1;
  return Object.keys(counts).sort().map((e) => `${e}${counts[e]}`).join("");
}

test("New molecule and New version are distinct, explicit and never confused", async ({ page, request }) => {
  const created = await request.post(`${API}/v1/projects`, { data: { name: "RW-3.2 molecule identity", slug: `rw32-${Date.now()}` } });
  expect(created.status()).toBe(201);
  const project = (await created.json()).id as string;
  await setMode(page, "advanced");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/projects/${project}/workspace`);

  // 1. Water as a new molecule.
  await page.getByTestId("toolbar-new-molecule").click();
  await page.getByRole("button", { name: /Draw manually/i }).click();
  await expect(page.getByTestId("ketcher-editor-panel")).toHaveAttribute("data-target-kind", "new-molecule");
  await expect(page.getByTestId("molecule-name-input")).toHaveValue("");
  await drawAndCommit(page, WATER_MOL, "Water");
  await expect(page.getByTestId("workspace-message")).toContainText("Committed Water V1 as a new molecule", { timeout: 30_000 });

  // 2. From the Water structure tab: New molecule is offered next to New version, and starts clean.
  await expect(page.getByTestId("toolbar-new-version")).toBeVisible();
  await shot(page, "structure-toolbar-new-molecule-new-version-1440");
  await page.getByTestId("toolbar-new-molecule").click();
  await page.getByRole("button", { name: /Draw manually/i }).click();
  await expect(page.getByTestId("ketcher-editor-panel")).toHaveAttribute("data-target-kind", "new-molecule");
  await expect(page.getByTestId("molecule-name-input")).toHaveValue(""); // never the previous molecule's name
  await shot(page, "editor-new-molecule-1440");
  await drawAndCommit(page, ETHANOL_MOL, "Ethanol");
  await expect(page.getByTestId("workspace-message")).toContainText("Committed Ethanol V1 as a new molecule", { timeout: 30_000 });

  let list = await structures(request, project);
  expect(list.map((s) => s.name).sort()).toEqual(["Ethanol", "Water"]);
  const water = list.find((s) => s.name === "Water")!;
  const ethanol = list.find((s) => s.name === "Ethanol")!;
  expect(water.latest_revision).toBe(1);
  expect(ethanol.latest_revision).toBe(1);
  expect(formula((await versions(request, project, water.id))[0]!.version.coordinates.atoms)).toBe("H2O1");
  expect(formula((await versions(request, project, ethanol.id))[0]!.version.coordinates.atoms)).toBe("C2H6O1");

  // 3. New version of Water: the target is explicit and frozen; a different composition needs a decision.
  await page.getByRole("tablist", { name: "Open workspace items" }).getByRole("tab", { name: /Water V1/ }).click();
  await page.getByTestId("toolbar-new-version").click();
  // Phase 1 editor: the target is the panel's data-target-kind and the title ("New version of “Water”"); the "Saves as Water · V2" line is in the info popover.
  await expect(page.getByTestId("ketcher-editor-panel")).toHaveAttribute("data-target-kind", "new-version");
  await expect(page.getByTestId("editor-title")).toHaveText("New version of “Water”");
  await expect(page.getByTestId("editor-lineage-name")).toContainText("Water");
  await expect(page.getByTestId("molecule-name-input")).toHaveCount(0); // the lineage name is not editable here
  // Phase 1 editor: the editor replaces the Project pane and hides the structure switcher and workspace tabs, so the visible structure cannot
  // be changed while the target is frozen.
  await expect(page.getByRole("combobox", { name: "Open structure" })).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "Open workspace items" })).toHaveCount(0);
  await expect(page.getByTestId("editor-title")).toHaveText("New version of “Water”");
  await drawAndCommit(page, ETHANOL_MOL, undefined, { expectComposition: true });
  await expect(page.getByTestId("editor-composition-warning")).toContainText("C2H6O");
  await expect(page.getByTestId("editor-composition-warning")).toContainText("H2O");
  await expect(page.getByTestId("accept-geometry-btn")).toBeDisabled();
  await shot(page, "editor-new-version-composition-warning-1440");
  // Choose "new molecule instead": the drawing is kept, the target and name reset.
  await page.getByTestId("editor-composition-switch").click();
  await expect(page.getByTestId("ketcher-editor-panel")).toHaveAttribute("data-target-kind", "new-molecule");
  await expect(page.getByTestId("molecule-name-input")).toHaveValue("");
  await page.getByTestId("editor-cancel").click();
  await expect(page.getByTestId("ketcher-editor-panel")).toHaveCount(0);

  // 4. A same-composition new version of Water is an intentional lineage step.
  await page.getByRole("tablist", { name: "Open workspace items" }).getByRole("tab", { name: /Water V1/ }).click();
  await page.getByTestId("toolbar-new-version").click();
  await expect(page.getByTestId("editor-title")).toHaveText("New version of “Water”");
  await drawAndCommit(page, WATER_MOL);
  await expect(page.getByTestId("workspace-message")).toContainText("Committed Water V2 as a new version of this structure (parent V1)", { timeout: 30_000 });
  const waterVersions = await versions(request, project, water.id);
  expect(waterVersions.map((v) => v.version.revision)).toEqual([1, 2]);
  expect(waterVersions[1]!.version.parent_version_id).toBe(waterVersions[0]!.version.id);
  expect(waterVersions.every((v) => formula(v.version.coordinates.atoms) === "H2O1")).toBe(true);
  list = await structures(request, project);
  expect(list.find((s) => s.id === ethanol.id)!.latest_revision).toBe(1); // Ethanol untouched

  // 5. An open drawing is not silently discarded by a mode switch.
  await page.getByTestId("toolbar-new-molecule").click();
  await page.getByRole("button", { name: /Draw manually/i }).click();
  await expect(page.getByTestId("ketcher-editor-panel")).toBeVisible();
  page.once("dialog", (dialog) => { expect(dialog.message()).toContain("new molecule is open"); void dialog.dismiss(); });
  await page.getByTestId("mode-toggle-guided").click();
  await expect(page.getByTestId("ketcher-editor-panel")).toBeVisible();
  await expect(page.getByTestId("mode-toggle-advanced")).toHaveAttribute("aria-pressed", "true");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("mode-toggle-guided").click();
  await expect(page.getByTestId("guided-mode-container")).toBeVisible();
  await page.getByTestId("mode-toggle-advanced").click();
  await expect(page.getByTestId("ketcher-editor-panel")).toHaveCount(0);
});

// ------------------------------------------------------------------ guided journey

test("Guided mode shows the three calculation stages with one primary action, and results stay one click away", async ({ page }) => {
  await setMode(page, "guided");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/workspace`);
  await expect(page.getByTestId("guided-project-home")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("guided-nav-structure").click();

  // Structure → Configure → Review & Submit; execution, results and export are not wizard steps
  const stages = page.getByTestId("guided-stages");
  await expect(stages).toBeVisible({ timeout: 60_000 });
  await expect(stages.locator("li")).toHaveCount(3);
  await expect(page.getByTestId("guided-stage-structure")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("guided-stage-configure")).toBeVisible();
  await expect(page.getByTestId("guided-stage-review")).toBeVisible();

  // Exactly one primary action for the current stage: here, the researcher's own decision about the electronic state
  const primary = page.locator('[data-testid^="guided-primary-"]');
  await expect(primary).toHaveCount(1);
  await expect(page.getByTestId("guided-primary-confirm-inputs")).toBeVisible();
  await shot(page, "guided-stages-structure-1440");

  // Stages can be visited freely, but submission is not possible before the inputs are confirmed and acknowledged
  await page.getByTestId("guided-stage-review").click();
  await expect(page.getByTestId("guided-review-stage")).toBeVisible();
  await expect(page.getByTestId("run-calculation-btn")).toBeDisabled();
  await page.getByTestId("guided-stage-structure").click();

  // The sidebar offers the published results; Jobs, Compare and Settings are project sections, not repeated here
  await expect(page.getByTestId("guided-nav-jobs")).toHaveCount(0);
  await page.getByTestId("project-section-results").click();
  await expect(page).toHaveURL(new RegExp(`${BASE}/results`));
  expect(await axeViolations(page)).toEqual([]);
});

// ------------------------------------------------------------------ layout at representative widths

for (const width of [1920, 1440, 1024, 640]) {
  test(`layout at ${width}px keeps pages inside the viewport`, async ({ page, request }) => {
    const rows = (await overview(request)).rows as Json[];
    const orbital = rows.find((row) => row.task === "ORBITAL" && row.result_id)!;
    await page.setViewportSize({ width, height: 900 });
    for (const mode of ["advanced", "guided"] as const) {
      await setMode(page, mode);
      await page.goto(`${BASE}/results`);
      await expect(page.getByTestId("results-row").first()).toBeVisible({ timeout: 60_000 });
      expect(await noPageOverflow(page), `results ${mode} ${width}`).toBe(true);
      await shot(page, `results-${mode}-${width}`);
      await page.goto(`${BASE}/compare?result=${rows.filter((r) => r.task === "ENERGY" && r.result_id).map((r) => r.result_id).slice(0, 2).join("&result=")}`);
      await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
      expect(await noPageOverflow(page), `compare ${mode} ${width}`).toBe(true);
      await shot(page, `compare-${mode}-${width}`);
      await page.goto(`${BASE}/workspace?selection=calculationResult%3A${orbital.result_id}&source=${orbital.calculation_id}`);
      await expect(page.getByTestId("result-context").first()).toBeVisible({ timeout: 60_000 });
      expect(await noPageOverflow(page), `result ${mode} ${width}`).toBe(true);
      await shot(page, `workspace-result-${mode}-${width}`);
    }
  });
}
