import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, request as playwrightRequest, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

// DATA HYGIENE: this suite never touches the persistent Water acceptance project. It runs in the
// Playwright-managed isolated stack (disposable database, moved aside whenever that stack starts) and
// creates its own disposable project in `beforeAll` through the public API. No calculation is run: every
// scientific record here comes from importing external Gaussian/ORCA output files.
//
// The third-party Gaussian/ORCA outputs are NOT in git. They are fetched (pinned commit + SHA-256) by
// tools/fetch_external_import_fixtures.py into .chemdft/external-fixtures; the suite skips if that
// corpus is absent. Rejection tests that need no third-party text use synthetic bytes.
const API_BASE = `http://127.0.0.1:${process.env.CHEMDFT_E2E_API_PORT ?? 8123}`;
const FIXTURE_ROOT = path.resolve(process.cwd(), "../../.chemdft/external-fixtures");
const PINNED_CCLIB_COMMIT = "b1364ecf5ac21042c5a37ed5446771217e0431ea";

const FIXTURES = {
  gaussianWater: { dir: "g16-water-hf-freq", file: "01a_water_hf_freq.log" },
  orcaDvbRaman: { dir: "orca6-dvb-raman", file: "dvb_raman.out" },
  orcaFormaldehydeTd: { dir: "orca6-formaldehyde-td", file: "13_formaldehyde_tddft_s1.out" },
  gaussianOptNotConverged: { dir: "g16-opt-notconverged", file: "52_err_opt_not_converged_maxcycles.log" },
} as const;

function fixturePath(key: keyof typeof FIXTURES): string {
  return path.join(FIXTURE_ROOT, FIXTURES[key].dir, FIXTURES[key].file);
}

const corpusAvailable = Object.keys(FIXTURES).every((key) => existsSync(fixturePath(key as keyof typeof FIXTURES)));
const sha256 = (path_: string) => createHash("sha256").update(readFileSync(path_)).digest("hex");

let projectId = "";
let api: APIRequestContext;

async function body<T>(response: APIResponse, what: string): Promise<T> {
  if (!response.ok()) throw new Error(`${what} failed: ${response.status()} ${(await response.text()).slice(0, 600)}`);
  return (await response.json()) as T;
}

async function openWorkspace(page: Page, mode: "guided" | "advanced" = "guided") {
  await page.addInitScript((value) => {
    localStorage.setItem("chemdft:workspace-mode", value);
  }, mode);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/projects/${projectId}/workspace`);
  await expect(page.getByRole("heading", { name: "Loading project inventory…" })).not.toBeVisible({ timeout: 45_000 });
  if (mode === "guided") await expect(page.getByTestId("guided-mode-container")).toBeVisible({ timeout: 30_000 });
  else await expect(page.getByTestId("explorer-import-calculation")).toBeVisible({ timeout: 30_000 });
}

async function openImportDialog(page: Page, mode: "guided" | "advanced" = "guided") {
  if (mode === "guided") await page.getByTestId("guided-nav-imported").click();
  await page.getByTestId(mode === "guided" ? "guided-nav-import" : "explorer-import-calculation").click();
  await expect(page.getByTestId("import-calculation-dialog")).toBeVisible();
}

async function uploadFile(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByTestId("import-calculation-file").setInputFiles(file);
  await expect(page.getByTestId("import-preview")).toBeVisible({ timeout: 120_000 });
}

async function importThroughUi(page: Page, key: keyof typeof FIXTURES) {
  await openImportDialog(page);
  await uploadFile(page, fixturePath(key));
  await expect(page.getByTestId("import-preview")).toHaveAttribute("data-preview-status", "READY");
  await page.getByTestId("import-confirm-button").click();
  await expect(page.getByTestId("imported-workspace")).toHaveAttribute("data-import-state", "IMPORTED", { timeout: 60_000 });
}

async function importedCount(): Promise<number> {
  const list = await body<{ imports: Array<{ state: string }> }>(await api.get(`/v1/projects/${projectId}/external-imports`), "list imports");
  return list.imports.filter((item) => item.state === "IMPORTED").length;
}

test.describe("External calculation import V1 (disposable project, real Gaussian/ORCA outputs)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  test.skip(({ isMobile }) => isMobile, "External import acceptance is desktop-oriented.");
  test.skip(!corpusAvailable, "External import fixtures are not fetched (run tools/fetch_external_import_fixtures.py).");

  test.beforeAll(async () => {
    if (new URL(API_BASE).port === "8000") throw new Error("Refusing to create E2E records in the persistent dev API.");
    api = await playwrightRequest.newContext({ baseURL: API_BASE });
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const project = await body<{ id: string }>(
      await api.post("/v1/projects", { data: { name: `External import E2E (disposable ${suffix})`, slug: `ext-import-e2e-${suffix}` } }),
      "create project",
    );
    projectId = project.id;
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test("Guided: upload shows a detected/unavailable/warning preview and publishes nothing before confirmation", async ({ page }) => {
    await openWorkspace(page);
    await openImportDialog(page);
    await uploadFile(page, fixturePath("gaussianWater"));

    const preview = page.getByTestId("import-preview");
    await expect(preview).toHaveAttribute("data-preview-status", "READY");
    await expect(page.getByTestId("import-program")).toContainText("Gaussian 16");
    await expect(page.getByTestId("import-job-type")).toHaveText("freq");
    await expect(page.getByTestId("import-method")).toHaveText("HF");
    await expect(page.getByTestId("import-basis")).toHaveText("6-31G(d)");
    await expect(page.getByTestId("import-charge")).toHaveText("0");
    await expect(page.getByTestId("import-multiplicity")).toHaveText("1");
    await expect(page.getByTestId("import-termination")).toHaveText("Terminated normally");
    await expect(page.getByTestId("import-scf")).toHaveText("Converged");
    await expect(page.getByTestId("import-parsed-types")).toContainText("Imported vibrational analysis");
    await expect(page.getByTestId("import-source-sha")).toHaveText(sha256(fixturePath("gaussianWater")));
    await expect(page.getByTestId("import-preview-sha")).toBeVisible();

    await expect(page.getByTestId("import-group-DETECTED")).toBeVisible();
    await expect(page.getByTestId("import-group-UNAVAILABLE")).toBeVisible();
    await expect(page.getByTestId("import-group-WARNING")).toBeVisible();
    await expect(page.getByTestId("import-item-ir")).toHaveAttribute("data-state", "DETECTED");
    await expect(page.getByTestId("import-item-raman")).toHaveAttribute("data-state", "DETECTED");
    await expect(page.getByTestId("import-item-depolarization")).toHaveAttribute("data-state", "UNAVAILABLE");
    await expect(page.getByTestId("import-item-mo-isosurfaces")).toHaveAttribute("data-state", "UNAVAILABLE");
    for (const step of ["upload", "detect", "parse", "preview"]) {
      await expect(page.getByTestId(`import-step-${step}`)).toHaveAttribute("data-state", "done");
    }

    // The preview is a stored, hash-bound record only: no structure or imported result exists yet.
    const structures = await body<unknown[]>(await api.get(`/v1/projects/${projectId}/structures`), "list structures");
    expect(structures).toHaveLength(0);
    expect(await importedCount()).toBe(0);
    const list = await body<{ imports: Array<{ state: string; id: string }> }>(await api.get(`/v1/projects/${projectId}/external-imports`), "list");
    expect(list.imports.map((item) => item.state)).toEqual(["PREVIEW_READY"]);
    const detail = await body<{ results?: unknown[] }>(await api.get(`/v1/projects/${projectId}/external-imports/${list.imports[0]!.id}`), "detail");
    expect(detail.results ?? []).toHaveLength(0);
    await page.screenshot({ path: "test-results/external-import-preview.png" });
  });

  test("Guided: confirming imports an Imported calculation with the source named in the badge", async ({ page }) => {
    await openWorkspace(page);
    await importThroughUi(page, "gaussianWater");
    await expect(page.getByTestId("imported-badge")).toContainText("Imported");
    await expect(page.getByTestId("imported-source")).toContainText("Gaussian 16");
    await expect(page.getByTestId("imported-workspace")).toContainText("Not calculated by ChemDFT");
    await expect(page.getByTestId("overview-source")).toContainText("Gaussian 16");
    await expect(page.getByTestId("overview-scf-energy")).toContainText("-76.0");
    await expect(page.getByTestId("imported-unavailable")).toContainText("Depolarization ratios");
    // Imported spectra are labelled as imported; the nav must not claim ChemDFT calculated nothing, nor that it calculated them.
    await expect(page.getByTestId("guided-nav-spectra")).toContainText("Imported");
    await expect(page.getByTestId("guided-nav-spectra")).not.toContainText("Not calculated");
    await expect(page.getByTestId("guided-nav-spectra")).not.toContainText("TDDFT");
    await expect(page.getByTestId("guided-nav-imported")).toBeVisible();
    expect(await importedCount()).toBe(1);

    const results = await body<{ results: Array<{ authority: string; source_class: string; producer_type: string; result_type: string }> }>(
      await api.get(`/v1/projects/${projectId}/external-imports/${(await body<{ imports: Array<{ id: string }> }>(await api.get(`/v1/projects/${projectId}/external-imports`), "list")).imports[0]!.id}`),
      "detail",
    );
    expect(results.results.length).toBeGreaterThanOrEqual(5);
    for (const item of results.results) {
      expect(item.authority).toBe("IMPORTED");
      expect(item.source_class).toBe("IMPORTED");
      expect(item.producer_type).toBe("VALIDATED_IMPORT_PIPELINE");
    }
    await page.screenshot({ path: "test-results/external-import-overview.png" });
  });

  test("Imported 3D structure: existing viewer, representation persistence and XYZ export", async ({ page }) => {
    await openWorkspace(page);
    await page.getByTestId("guided-nav-imported").click();
    await page.getByTestId("imported-tab-structure").click();
    const workbench = page.getByTestId("structure-version-workbench");
    await expect(workbench).toBeVisible({ timeout: 30_000 });
    await expect(workbench.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
    await expect(workbench).toContainText("IMPORTED");
    await expect(workbench).toContainText("IMPORTED_CALCULATION");
    await expect(workbench).toContainText("3");
    // The detected engine/version is shown whole, never clipped to something like "Gaus V1".
    await expect(workbench.locator("h2").first()).toContainText("imported from Gaussian 16 Rev C.01");

    await workbench.getByLabel("Representation").selectOption("space-fill");
    await workbench.getByLabel("Measure").selectOption("distance");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Loading project inventory…" })).not.toBeVisible({ timeout: 45_000 });
    await page.getByTestId("guided-nav-imported").click();
    await page.getByTestId("imported-tab-structure").click();
    await expect(page.getByTestId("structure-version-workbench").getByLabel("Representation")).toHaveValue("space-fill", { timeout: 30_000 });

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("imported-export-xyz").click();
    const download = await downloadPromise;
    const xyz = readFileSync(await download.path(), "utf8");
    expect(xyz.trim().split("\n")[0]).toBe("3");
    await page.screenshot({ path: "test-results/external-import-structure.png" });
  });

  test("Imported IR: stick spectrum, mode selection and honest source labelling", async ({ page }) => {
    await openWorkspace(page);
    await page.getByTestId("guided-nav-imported").click();
    await page.getByTestId("imported-tab-ir").click();
    const panel = page.getByTestId("imported-ir-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText("Imported IR spectrum");
    await expect(panel).toContainText("Imported · Gaussian 16");
    await expect(panel).not.toContainText("PySCF");
    for (const mode of [1, 2, 3]) await expect(page.getByTestId(`imported-ir-stick-${mode}`)).toBeVisible();
    await expect(page.getByTestId("imported-ir-table").locator("tbody tr")).toHaveCount(3);
    // Sticks are thin SVG targets: select through the keyboard-accessible peak, as a screen-reader user would.
    await page.getByTestId("imported-ir-stick-2").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("selected-mode-inspector")).toContainText("Mode 2");
    await page.getByTestId("imported-mode-row-3").click();
    await expect(page.getByTestId("selected-mode-inspector")).toContainText("Mode 3");
    await expect(page.getByTestId("imported-ir-caption")).toContainText("reported by Gaussian 16");
    await page.screenshot({ path: "test-results/external-import-ir.png" });
  });

  test("Imported Raman: activities as reported, depolarization 'Not reported'", async ({ page }) => {
    await openWorkspace(page);
    await page.getByTestId("guided-nav-imported").click();
    await page.getByTestId("imported-tab-raman").click();
    const panel = page.getByTestId("imported-raman-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText("Imported Raman spectrum");
    await expect(panel).toContainText("Depolarization ratio");
    await expect(page.getByTestId("selected-mode-inspector")).toContainText("Not reported");
    await expect(page.getByTestId("imported-raman-caption")).toContainText("depolarization ratios are not reported");
    await expect(panel).not.toContainText("PySCF");
    await expect(page.getByTestId("imported-raman-stick-1")).toBeVisible();
    await page.screenshot({ path: "test-results/external-import-raman.png" });
  });

  test("Imported orbital energies, read-only thermochemistry and provenance", async ({ page }) => {
    await openWorkspace(page);
    await page.getByTestId("guided-nav-imported").click();

    await page.getByTestId("imported-tab-orbitals").click();
    await expect(page.getByTestId("imported-orbitals-panel")).toBeVisible();
    await expect(page.getByTestId("imported-orbital-note")).toContainText("Orbital energies only");
    await expect(page.locator('[data-frontier="HOMO"]').first()).toBeVisible();
    await expect(page.getByTestId("imported-orbital-channel-restricted").locator("tbody tr")).toHaveCount(19);

    await page.getByTestId("imported-tab-thermochemistry").click();
    const thermo = page.getByTestId("imported-thermochemistry-panel");
    await expect(thermo).toContainText("Thermochemistry reported by Gaussian");
    await expect(thermo).toContainText("298.15");
    await expect(page.getByTestId("imported-thermo-note")).toContainText("did not recompute");
    // Read-only: no ChemDFT temperature/pressure controls.
    await expect(thermo.locator("input, select, button")).toHaveCount(0);
    await page.screenshot({ path: "test-results/external-import-thermo.png" });

    await page.getByTestId("imported-tab-provenance").click();
    const prov = page.getByTestId("imported-provenance-panel");
    await expect(prov).toBeVisible();
    await expect(page.getByTestId("prov-filename")).toHaveText(FIXTURES.gaussianWater.file);
    await expect(page.getByTestId("prov-source-sha")).toHaveText(sha256(fixturePath("gaussianWater")));
    await expect(page.getByTestId("prov-size")).toContainText(String(readFileSync(fixturePath("gaussianWater")).length.toLocaleString("en-US")));
    await expect(page.getByTestId("prov-engine")).toContainText("Gaussian 16");
    await expect(page.getByTestId("prov-parser")).toContainText("cclib");
    await expect(page.getByTestId("prov-parser-commit")).toHaveText(PINNED_CCLIB_COMMIT);
    await expect(page.getByTestId("prov-job-type")).toHaveText("freq");
    await expect(page.getByTestId("prov-termination")).toContainText("COMPLETED");
    await expect(page.getByTestId("prov-normalization")).not.toBeEmpty();
    await expect(page.getByTestId("prov-conversions")).toContainText("cclib");
    await expect(page.getByTestId("prov-preview-sha")).toHaveText(/^[0-9a-f]{64}$/);
    await expect(page.getByTestId("prov-confirmed-at")).not.toHaveText("—");
    await expect(page.getByTestId("prov-parse-time")).not.toHaveText("—");
    await expect(page.getByTestId("prov-locators")).toContainText("lines");
    await expect(prov).toContainText("Not a ChemDFT engine result");
    await page.screenshot({ path: "test-results/external-import-provenance.png" });
  });

  test("ORCA 6.0.1: IR and Raman import through the Advanced workbench", async ({ page }) => {
    await openWorkspace(page, "advanced");
    await openImportDialog(page, "advanced");
    await uploadFile(page, fixturePath("orcaDvbRaman"));
    await expect(page.getByTestId("import-program")).toContainText("ORCA 6.0.1");
    await expect(page.getByTestId("import-method")).toHaveText("B3LYP");
    await expect(page.getByTestId("import-item-raman")).toHaveAttribute("data-state", "DETECTED");
    await page.getByTestId("import-confirm-button").click();
    await expect(page.getByTestId("imported-workspace")).toHaveAttribute("data-import-state", "IMPORTED", { timeout: 60_000 });
    await expect(page.getByTestId("imported-source")).toContainText("ORCA 6.0.1");
    await expect(page.getByTestId("selected-workspace-canvas")).toContainText("IMPORTED · NOT A CHEMDFT ENGINE RESULT");
    await page.getByTestId("imported-tab-ir").click();
    await expect(page.getByTestId("imported-ir-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("imported-ir-table").locator("tbody tr")).toHaveCount(54);
    await page.getByTestId("imported-tab-raman").click();
    await expect(page.getByTestId("imported-raman-panel")).toBeVisible();
    await page.getByTestId("imported-tab-structure").click();
    await expect(page.getByTestId("structure-version-workbench").locator("h2").first()).toContainText("imported from ORCA 6.0.1", { timeout: 30_000 });
    expect(await importedCount()).toBe(2);
  });

  test("Advanced explorer marks imported records and opens them", async ({ page }) => {
    await openWorkspace(page, "advanced");
    const calculations = page.getByRole("region", { name: "Calculations" });
    await expect(calculations.getByTestId("tree-item-externalImport")).toHaveCount(2);
    await expect(calculations.locator(".workspace-tree-authority.imported").first()).toBeVisible();
    const results = page.getByRole("region", { name: "Results" });
    await expect(results.getByText(/Imported vibrational analysis · IR \+ Raman · Gaussian 16/)).toBeVisible();
    await results.getByText(/Imported vibrational analysis · IR \+ Raman · Gaussian 16/).click();
    await expect(page.getByTestId("imported-workspace")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("imported-tab-ir")).toHaveAttribute("aria-selected", "true");
  });

  test("Imported electronic excitations keep spin labels and are not a ChemDFT UV/Vis result", async ({ page }) => {
    await openWorkspace(page);
    await importThroughUi(page, "orcaFormaldehydeTd");
    await page.getByTestId("imported-tab-excitations").click();
    const panel = page.getByTestId("imported-excitations-panel");
    await expect(panel).toContainText("Imported electronic excitations");
    await expect(page.getByTestId("imported-excitation-semantics")).toContainText("Not a ChemDFT UV/Vis calculation");
    await expect(page.getByTestId("imported-excitation-table").locator("tbody tr")).toHaveCount(3);
    await expect(page.getByTestId("imported-excitation-spin-1")).toContainText("Singlet");
    await expect(page.getByTestId("imported-excitation-transitions")).toBeVisible();
    await expect(page.getByTestId("guided-nav-spectra")).toContainText("Imported");
    await expect(page.getByTestId("guided-nav-spectra")).not.toContainText("TDDFT");
    await page.screenshot({ path: "test-results/external-import-excitations.png" });
  });

  test("Rejected file: clear reason, no import button, nothing imported", async ({ page }) => {
    await openWorkspace(page);
    const before = await importedCount();
    await openImportDialog(page);
    await uploadFile(page, fixturePath("gaussianOptNotConverged"));
    await expect(page.getByTestId("import-preview")).toHaveAttribute("data-preview-status", "REJECTED");
    await expect(page.getByTestId("import-preview-status")).toHaveText("Rejected");
    await expect(page.getByTestId("import-rejection")).toContainText("OPTIMIZATION_NOT_CONVERGED");
    await expect(page.getByTestId("import-group-REJECTED")).toBeVisible();
    await expect(page.getByTestId("import-confirm-button")).toHaveCount(0);
    await expect(page.getByTestId("import-step-parse")).toHaveAttribute("data-state", "failed");
    await page.screenshot({ path: "test-results/external-import-rejected.png" });
    await page.getByTestId("import-choose-another").click();
    await expect(page.getByTestId("import-calculation-file")).toBeVisible();
    expect(await importedCount()).toBe(before);
  });

  test("Unrecognized text is rejected without guessing the program from its filename", async ({ page }) => {
    await openWorkspace(page);
    await openImportDialog(page);
    await uploadFile(page, { name: "gaussian16_output.log", mimeType: "text/plain", buffer: Buffer.from("this is not a computational chemistry output\n") });
    await expect(page.getByTestId("import-preview")).toHaveAttribute("data-preview-status", "REJECTED");
    await expect(page.getByTestId("import-program")).toHaveText("Unidentified program");
    await expect(page.getByTestId("import-confirm-button")).toHaveCount(0);
    await expect(page.getByTestId("import-step-detect")).toHaveAttribute("data-state", "failed");
  });

  test("A stored preview reopened from the Explorer imports exactly the preview that was stored", async ({ page }) => {
    const before = await importedCount();
    await openWorkspace(page, "advanced");
    const files = page.getByRole("region", { name: "Files" });
    const previewItem = files.getByText(`Import preview · ${FIXTURES.gaussianWater.file}`).first();
    await expect(previewItem).toBeVisible();
    await previewItem.click();
    await expect(page.getByTestId("imported-workspace")).toHaveAttribute("data-import-state", "PREVIEW_READY", { timeout: 30_000 });
    await expect(page.getByTestId("import-program")).toContainText("Gaussian 16");
    await expect(page.getByTestId("import-source-sha")).toHaveText(sha256(fixturePath("gaussianWater")));
    await page.getByTestId("import-confirm-button").click();
    await expect(page.getByTestId("imported-workspace")).toHaveAttribute("data-import-state", "IMPORTED", { timeout: 60_000 });
    await expect(page.getByTestId("imported-badge")).toContainText("Gaussian 16");
    expect(await importedCount()).toBe(before + 1);
  });
});
