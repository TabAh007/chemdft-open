import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, request as playwrightRequest, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

// DATA HYGIENE: runs only in the Playwright-managed isolated stack, in its own disposable project. Every spectrum here is
// ChemDFT-authored synthetic text. The calculated source is a REAL Gaussian 16 water HF frequency output imported through the
// External Import pipeline (third-party file, fetched by tools/fetch_external_import_fixtures.py, never committed).
const API_BASE = `http://127.0.0.1:${process.env.CHEMDFT_E2E_API_PORT ?? 8123}`;
const WATER_LOG = path.resolve(process.cwd(), "../../.chemdft/external-fixtures/g16-water-hf-freq/01a_water_hf_freq.log");
const sourceAvailable = existsSync(WATER_LOG);

let projectId = "";
let api: APIRequestContext;
let importedVibrations: { id: string; modes: number[] } | null = null;

async function body<T>(response: APIResponse, what: string): Promise<T> {
  if (!response.ok()) throw new Error(`${what} failed: ${response.status()} ${(await response.text()).slice(0, 600)}`);
  return (await response.json()) as T;
}

function lorentz(x: number, centre: number, fwhm: number, height: number): number {
  const half = fwhm / 2;
  return (height * half * half) / ((x - centre) ** 2 + half * half);
}

/** Deterministic pseudo-random noise so that every run produces byte-identical spectra. */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0xffffffff - 0.5) * 2;
  };
}

function irText(peaks: Array<[number, number, number]>, header: string | null = "Wavenumber (cm-1)\tAbsorbance", lo = 400, hi = 4800): string {
  const rnd = noise(7);
  const rows: string[] = [];
  for (let x = lo; x <= hi; x += 4) {
    const y = peaks.reduce((sum, [c, w, h]) => sum + lorentz(x, c, w, h), 0) + 0.03 + 3e-6 * (x - lo) + 0.001 * rnd();
    rows.push(`${x.toFixed(2)}\t${y.toFixed(6)}`);
  }
  return `${header ? `${header}\n` : ""}${rows.join("\n")}\n`;
}

function ramanText(): string {
  const rnd = noise(11);
  const rows: string[] = [];
  for (let x = 100; x <= 3200; x += 2) {
    const y = 800 + 0.05 * x + lorentz(x, 787, 9, 2500) + lorentz(x, 1710, 12, 900) + lorentz(x, 2925, 20, 1400) + 15 * rnd();
    rows.push(`${x.toFixed(3)}\t${y.toFixed(2)}`);
  }
  return `Sample: example liquid\nLaser wavelength: Not supplied\nRaman shift (cm^-1)\tIntensity (counts)\n${rows.join("\n")}\n`;
}

function uvText(): string {
  const rows: string[] = [];
  const centre = 1e7 / 280;
  for (let nm = 200; nm <= 400; nm += 0.2) {
    const nu = 1e7 / nm;
    const shape = Math.exp(-0.5 * ((nu - centre) / 2000) ** 2) / (2000 * Math.sqrt(2 * Math.PI));
    rows.push(`${nm.toFixed(2)},${((0.042 / 1.1296e12) * shape).toExponential(6)}`);
  }
  return `Wavelength (nm),Cross section (cm^2/molecule)\n${rows.join("\n")}\n`;
}

async function openWorkspace(page: Page) {
  await page.addInitScript(() => localStorage.setItem("chemdft:workspace-mode", "guided"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/projects/${projectId}/workspace`);
  await expect(page.getByRole("heading", { name: "Loading project inventory…" })).not.toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("guided-mode-container")).toBeVisible({ timeout: 30_000 });
}

async function openSpectrumDialog(page: Page, technique: "IR" | "RAMAN" | "UVVIS") {
  await page.getByTestId("guided-nav-imported").click();
  await page.getByTestId("guided-nav-import-spectrum").click();
  await expect(page.getByTestId("import-spectrum-dialog")).toBeVisible();
  await page.getByTestId(`spectrum-technique-${technique}`).check();
}

async function pickFile(page: Page, name: string, text: string) {
  await page.getByTestId("spectrum-file").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  await expect(page.getByTestId("import-spectrum-preview")).toBeVisible({ timeout: 60_000 });
}

async function datasets(): Promise<Array<{ id: string; kind: string; arrays_sha256: string | null; point_count: number; name: string }>> {
  return (await body<{ datasets: Array<{ id: string; kind: string; arrays_sha256: string | null; point_count: number; name: string }> }>(await api.get(`/v1/projects/${projectId}/experimental/spectra/datasets`), "list spectra")).datasets;
}

async function computeJobCount(): Promise<number> {
  const jobs = await body<{ jobs: unknown[] }>(await api.get(`/v1/projects/${projectId}/compute/jobs`), "jobs");
  return jobs.jobs.length;
}

test.describe("Experimental spectra V1 (disposable project)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);
  test.skip(({ isMobile }) => isMobile, "Experimental spectra acceptance is desktop-oriented.");

  test.beforeAll(async () => {
    if (new URL(API_BASE).port === "8000") throw new Error("Refusing to create E2E records in the persistent dev API.");
    api = await playwrightRequest.newContext({ baseURL: API_BASE });
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    projectId = (await body<{ id: string }>(await api.post("/v1/projects", { data: { name: `Experimental spectra E2E (disposable ${suffix})`, slug: `xspec-e2e-${suffix}` } }), "create project")).id;
    if (sourceAvailable) {
      const upload = await body<{ id: string; preview_sha256: string }>(
        await api.post(`/v1/projects/${projectId}/external-imports`, { multipart: { upload: { name: "water.log", mimeType: "text/plain", buffer: readFileSync(WATER_LOG) }, idempotency_key: `e2e-xspec-import-${suffix}` } }),
        "upload external import",
      );
      const detail = await body<{ results: Array<{ id: string; result_type: string; payload: { modes: Array<{ frequency_cm1: number }> } }> }>(
        await api.post(`/v1/projects/${projectId}/external-imports/${upload.id}/confirm`, { data: { preview_sha256: upload.preview_sha256, idempotency_key: `e2e-xspec-confirm-${suffix}` } }),
        "confirm external import",
      );
      const vib = detail.results.find((item) => item.result_type === "chemdft.imported.vibrations")!;
      importedVibrations = { id: vib.id, modes: vib.payload.modes.map((mode) => mode.frequency_cm1) };
    }
  });

  test.afterAll(async () => { await api?.dispose(); });

  test("IR: a unit the file does not state must be confirmed; the preview writes nothing; import creates one RAW dataset", async ({ page }) => {
    const modes = importedVibrations?.modes ?? [1776, 4113, 4212];
    const peaks = modes.map((f, i) => [f * 0.9, i === 0 ? 24 : 40, 0.8 - 0.2 * i] as [number, number, number]);
    await openWorkspace(page);
    await openSpectrumDialog(page, "IR");
    await pickFile(page, "water-vapour.txt", irText(peaks, null));

    await expect(page.getByTestId("spectrum-evidence-x")).toHaveAttribute("data-evidence", "HINT_ONLY");
    await expect(page.getByTestId("spectrum-evidence-x")).toContainText("not accepted until you choose it");
    await expect(page.getByTestId("spectrum-import-confirm")).toBeDisabled();
    await expect(page.getByTestId("spectrum-needs")).toContainText("Confirm the x-axis unit");
    await expect(page.getByTestId("spectrum-preview-chart")).toBeVisible();
    expect(await datasets()).toHaveLength(0); // previewing wrote no experiment and no dataset

    await page.getByTestId("spectrum-x-unit").selectOption("cm^-1");
    await expect(page.getByTestId("spectrum-evidence-x")).toHaveAttribute("data-evidence", "USER_CONFIRMED");
    await expect(page.getByTestId("spectrum-import-confirm")).toBeDisabled(); // the signal is still unconfirmed
    await page.getByTestId("spectrum-y-unit").selectOption("ABSORBANCE|absorbance");
    await expect(page.getByTestId("spectrum-evidence-y")).toHaveAttribute("data-evidence", "USER_CONFIRMED");
    await expect(page.getByTestId("spectrum-import-confirm")).toBeEnabled();
    await expect(page.getByTestId("spectrum-preview-hash")).toContainText("bound to exactly this preview");
    await page.getByTestId("spectrum-import-confirm").click();

    await expect(page.getByTestId("spectrum-workspace")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("spectrum-authority")).toContainText("RAW · EXPERIMENTAL");
    await expect(page.getByTestId("spectrum-identity-x")).toContainText("Unit confirmed by you");
    await expect(page.getByTestId("spectrum-raw-chart")).toBeVisible();
    const all = await datasets();
    expect(all).toHaveLength(1);
    expect(all[0]!.kind).toBe("RAW");
  });

  test("Processing creates new versions; the raw data never change; history and provenance are visible", async ({ page }) => {
    await openWorkspace(page);
    await page.getByTestId("guided-nav-experimental").click();
    await expect(page.getByTestId("spectrum-workspace")).toBeVisible();
    const before = (await datasets())[0]!;

    await page.getByTestId("spectrum-tab-processed").click();
    await page.getByTestId("proc-baseline-method").selectOption("baseline.snip");
    await page.getByTestId("proc-baseline-value").fill("200");
    await page.getByTestId("proc-baseline-create").click();
    await expect(page.getByTestId("spectrum-notice")).toContainText("New version created", { timeout: 60_000 });
    for (const id of ["input", "baseline", "version"]) await expect(page.getByTestId(`spectrum-processed-trace-${id}`)).toBeVisible(); // raw, baseline and corrected together
    await expect(page.getByTestId("spectrum-authority")).toContainText("DERIVED · TRANSFORM");

    await page.getByText("Smoothing (Savitzky–Golay)").click(); // sections other than baseline and peaks start collapsed
    await page.getByTestId("proc-smooth-window").fill("24");
    await page.getByTestId("proc-smooth-create").click();
    await expect(page.getByTestId("spectrum-versions").locator("[data-testid^='spectrum-version-']")).toHaveCount(3, { timeout: 60_000 });

    const after = await datasets();
    const raw = after.find((item) => item.kind === "RAW")!;
    expect(raw.arrays_sha256).toBe(before.arrays_sha256); // raw unchanged
    expect(after.filter((item) => item.kind === "TRANSFORM")).toHaveLength(2);

    await page.getByTestId("spectrum-tab-provenance").click();
    await expect(page.getByTestId("spectrum-history-0")).toContainText("Raw measurement");
    await expect(page.getByTestId("spectrum-history-1")).toContainText("Baseline · SNIP");
    await expect(page.getByTestId("spectrum-history-2")).toContainText("Smoothing · Savitzky–Golay");
    await expect(page.getByTestId("spectrum-transform-record")).toContainText("scipy");
    await expect(page.getByTestId("spectrum-provenance-evidence-x")).toContainText("Unit confirmed by you");
    await expect(page.getByTestId("spectrum-meta-row-phase")).toContainText("Not supplied");

    // go back to the raw version: identical, still RAW
    await page.getByTestId(`spectrum-version-${raw.id}`).click();
    await page.getByTestId("spectrum-tab-raw").click();
    await expect(page.getByTestId("spectrum-authority")).toContainText("RAW · EXPERIMENTAL");
  });

  test("Peaks are derived, not raw; comparison gives candidate matches with coverage first, never an assignment", async ({ page }) => {
    test.skip(!importedVibrations, "The real Gaussian water output is not fetched (tools/fetch_external_import_fixtures.py).");
    await openWorkspace(page);
    await page.getByTestId("guided-nav-experimental").click();
    const versions = page.getByTestId("spectrum-versions").locator("[data-testid^='spectrum-version-']");
    await versions.nth(2).click();
    await page.getByTestId("spectrum-tab-peaks").click();
    await page.getByTestId("proc-peaks-sigma").fill("10");
    await page.getByTestId("proc-peaks-create").click();
    await expect(page.getByTestId("spectrum-notice")).toContainText("Peak set created", { timeout: 60_000 });
    await expect(page.getByTestId("spectrum-peak-table")).toBeVisible();
    await expect(page.getByTestId("spectrum-peaks")).toContainText("DERIVED · NOT RAW");

    await page.getByTestId("spectrum-tab-compare").click();
    await page.getByTestId("spectrum-compare-tolerance").fill("40");
    await page.getByTestId("spectrum-compare-run").click();
    const result = page.getByTestId("spectrum-comparison-result");
    await expect(result).toBeVisible({ timeout: 90_000 });
    // unscaled: the calculation overestimates by ~10 %, so the gate finds nothing and says so
    await expect(page.getByTestId("spectrum-metric-coverage-exp")).toContainText("0 of");
    await expect(page.getByTestId("spectrum-metric-unmatched-calc")).not.toHaveText("0");
    await expect(page.getByTestId("spectrum-mae-note")).toContainText("matched pairs only");

    await page.getByTestId("spectrum-compare-user-scale").check();
    await page.getByTestId("spectrum-compare-factor").fill("0.9");
    await page.getByTestId("spectrum-compare-run").click();
    await expect(page.getByTestId("spectrum-comparison-headline")).not.toContainText("0 of", { timeout: 90_000 });
    await expect(page.getByTestId("spectrum-metric-coverage-exp")).not.toContainText("0 of");
    await expect(page.getByTestId("spectrum-candidate-statement")).toContainText("not assignments");
    await expect(page.getByTestId("spectrum-delta-table")).toBeVisible();
    await expect(page.getByTestId("spectrum-comparison-diagnostics")).toContainText("phase");
    const text = (await result.innerText()).toLowerCase();
    expect(text).not.toMatch(/(?<!not )(?<!no )\bassigned\b/);
    expect(text).toContain("candidate");
    expect(text).toContain("scale factor 0.9");
    await page.screenshot({ path: "test-results/experimental-spectra-comparison.png", fullPage: true });
  });

  test("Selecting a calculated mode animates it in 3D and highlights its candidate experimental peak", async ({ page }) => {
    test.skip(!importedVibrations, "The real Gaussian water output is not fetched.");
    await openWorkspace(page);
    await page.getByTestId("guided-nav-experimental").click();
    const versions = page.getByTestId("spectrum-versions").locator("[data-testid^='spectrum-version-']");
    await versions.nth(2).click();
    await page.getByTestId("spectrum-tab-compare").click();
    await page.getByTestId("spectrum-compare-tolerance").fill("40");
    await page.getByTestId("spectrum-compare-user-scale").check();
    await page.getByTestId("spectrum-compare-factor").fill("0.9");
    await page.getByTestId("spectrum-compare-run").click();
    await expect(page.getByTestId("spectrum-comparison-result")).toBeVisible({ timeout: 90_000 });

    await expect(page.getByTestId("spectrum-mode-link")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("spectrum-no-displacement-statement")).toContainText("Experimental peaks do not contain displacement vectors");
    await page.getByTestId("spectrum-pair-0").click();
    await expect(page.getByTestId("spectrum-mode-label")).toContainText("Calculated mode 1", { timeout: 30_000 });
    await expect(page.getByTestId("spectrum-mode-label")).toContainText("animating");
    await expect(page.getByTestId("spectrum-mode-statement")).toContainText("Candidate match: calculated mode 1");
    await expect(page.getByTestId("spectrum-mode-candidate")).toBeVisible();
    await expect(page.locator("[data-testid^='spectrum-compare-peak-'].is-selected")).toHaveCount(1); // the candidate peak is highlighted
    await expect(page.locator("[data-testid^='spectrum-compare-stick-'].is-selected")).toHaveCount(1);

    await page.getByTestId("spectrum-pair-1").click();
    await expect(page.getByTestId("spectrum-mode-label")).toContainText("Calculated mode 2");
    await page.screenshot({ path: "test-results/experimental-spectra-mode-link.png", fullPage: true });
  });

  test("A comparison writes no calculation, and Raman and UV/Vis import with their own units and metadata", async ({ page }) => {
    const jobsBefore = await computeJobCount();
    await openWorkspace(page);
    await page.getByTestId("guided-nav-experimental").click();
    await page.getByTestId("spectrum-import-another").click();
    await expect(page.getByTestId("import-spectrum-dialog")).toBeVisible();
    await page.getByTestId("spectrum-technique-RAMAN").check();
    await pickFile(page, "liquid-raman.txt", ramanText());
    await page.getByTestId("spectrum-x-unit").selectOption("cm^-1");
    await page.getByTestId("spectrum-y-unit").selectOption("INTENSITY|counts");
    await page.getByText("Instrument, sample and acquisition metadata").click();
    await expect(page.getByTestId("spectrum-meta-excitation_wavelength_nm")).toContainText("Not supplied");
    await page.getByTestId("spectrum-import-confirm").click();
    await expect(page.getByTestId("import-spectrum-dialog")).not.toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("spectrum-title")).toHaveText("liquid-raman", { timeout: 30_000 });
    await page.getByTestId("spectrum-tab-provenance").click();
    await expect(page.getByTestId("spectrum-meta-row-excitation_wavelength_nm")).toContainText("Not supplied"); // never invented

    await page.getByTestId("spectrum-import-another").click();
    await page.getByTestId("spectrum-technique-UVVIS").check();
    await pickFile(page, "uv-cross-section.csv", uvText());
    await expect(page.getByTestId("spectrum-evidence-y")).toHaveAttribute("data-evidence", "EXPLICIT_UNIT");
    await page.getByTestId("spectrum-import-confirm").click();
    await expect(page.getByTestId("import-spectrum-dialog")).not.toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("spectrum-title")).toHaveText("uv-cross-section", { timeout: 30_000 });
    await expect.poll(async () => (await datasets()).filter((item) => item.kind === "RAW").length).toBe(3);
    expect(await computeJobCount()).toBe(jobsBefore);
  });

  test("Advanced (Files & Data): the explorer offers the import and lists raw, derived and peak records with their authority", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("chemdft:workspace-mode", "advanced"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/en/projects/${projectId}/workspace`);
    await expect(page.getByTestId("tree-section-experimentalData")).toBeVisible({ timeout: 60_000 });
    const section = page.getByTestId("tree-section-experimentalData");
    if ((await section.getAttribute("aria-expanded")) !== "true") await section.click();
    await page.getByTestId("explorer-import-spectrum").click();
    await expect(page.getByTestId("import-spectrum-dialog")).toBeVisible();
    await page.getByTestId("spectrum-cancel").click();
    await expect(page.getByTestId("import-spectrum-dialog")).not.toBeVisible();

    const items = page.getByTestId("tree-item-experimentalSpectrum");
    expect(await items.count()).toBeGreaterThanOrEqual(5); // 3 raw spectra + 2 derived versions + 1 peak set
    await expect(items.first()).toContainText("EXPERIMENTAL");
    await expect(page.locator(".workspace-tree-authority.experimental").first()).toBeVisible();
    await items.first().click();
    await expect(page.getByTestId("spectrum-workspace")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".workspace-canvas-authority.experimental")).toContainText("RAW IS NEVER EDITED");
  });

  test("Saving a spectrum association (PUT) reaches the FastAPI route through the web layer instead of answering 405", async ({ page }) => {
    const raw = (await datasets()).find((item) => item.kind === "RAW")!;
    const route = `/v1/projects/${projectId}/experimental/spectra/datasets/${raw.id}/association`;
    const association = async () => (await body<{ association: { state: string; sample_label: string | null } }>(await api.get(`/v1/projects/${projectId}/experimental/spectra/datasets/${raw.id}`), "dataset")).association;

    // Straight through the Next Route Handler (page.request targets the web origin): the PUT must reach FastAPI.
    const forwarded = await page.request.put(`/api/chemdft${route}`, { data: { state: "ASSOCIATED_WITH_SAMPLE", sample_label: "PF-0 via web layer" } });
    expect(forwarded.status(), await forwarded.text()).toBe(200);
    expect((await association()).sample_label).toBe("PF-0 via web layer");
    // A FastAPI validation error keeps its status and body (not a Next 405 and not a masked 500).
    const rejected = await page.request.put(`/api/chemdft${route}`, { data: { state: "ASSOCIATED_WITH_SAMPLE" } });
    expect(rejected.status()).toBe(422);
    expect(await rejected.json()).toHaveProperty("detail");
    // A spoofed identity header never reaches the API: the request still runs as the server-assigned user.
    const spoofed = await page.request.put(`/api/chemdft${route}`, {
      headers: { "X-ChemDFT-User-ID": "00000000-0000-4000-8000-0000000000f1", "X-ChemDFT-Organization-ID": "00000000-0000-4000-8000-0000000000f0" },
      data: { state: "ASSOCIATED_WITH_SAMPLE", sample_label: "PF-0 spoof ignored" },
    });
    expect(spoofed.status(), await spoofed.text()).toBe(200);

    // And the user-facing path that exposed the bug: Change -> Save in the workspace.
    await page.addInitScript(() => localStorage.setItem("chemdft:workspace-mode", "advanced"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/en/projects/${projectId}/workspace`);
    await expect(page.getByTestId("tree-section-experimentalData")).toBeVisible({ timeout: 60_000 });
    const section = page.getByTestId("tree-section-experimentalData");
    if ((await section.getAttribute("aria-expanded")) !== "true") await section.click();
    await page.getByTestId("tree-item-experimentalSpectrum").first().click();
    await expect(page.getByTestId("spectrum-workspace")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("spectrum-association-edit").click();
    await page.getByTestId("spectrum-association-state").selectOption("ASSOCIATED_WITH_SAMPLE");
    await page.getByTestId("spectrum-association-sample").fill("acetone, saved in the UI");
    await page.getByTestId("spectrum-association-save").click();
    await expect(page.getByTestId("spectrum-association-text")).toContainText("acetone, saved in the UI", { timeout: 30_000 });
    expect((await association()).sample_label).toBe("acetone, saved in the UI");
  });

  test("A rejected file stores nothing and says why", async ({ page }) => {
    const before = (await datasets()).length;
    await openWorkspace(page);
    await openSpectrumDialog(page, "IR");
    await page.getByTestId("spectrum-file").setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from(irText([[1700, 20, 1]]).replace("404.00", "400.00")) });
    await expect(page.getByTestId("spectrum-diagnostics")).toContainText("duplicate x", { timeout: 60_000 });
    await expect(page.getByTestId("spectrum-import-confirm")).toBeDisabled();
    expect((await datasets()).length).toBe(before);
  });
});
