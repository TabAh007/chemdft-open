import { expect, request as playwrightRequest, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

// DATA HYGIENE: this suite never touches the persistent Water acceptance project. It runs in the
// Playwright-managed isolated stack (disposable database /tmp/chemdft-e2e-localhost.db, moved aside
// whenever that stack starts) and builds its own disposable Water project in `beforeAll` through the
// public API: import -> ChemDFT optimization -> frequency -> thermochemistry (298.15 K, 1 atm).
// The "authoritative recalculation" test therefore only ever adds records to that disposable project.
const API_BASE = `http://127.0.0.1:${process.env.CHEMDFT_E2E_API_PORT ?? 8123}`;
const WATER_XYZ = "3\nwater\nO 0 0 0\nH 0 0 0.9572\nH 0.926627 0 -0.239987\n";

let projectId = "";

async function body<T>(response: APIResponse, what: string): Promise<T> {
  if (!response.ok()) throw new Error(`${what} failed: ${response.status()} ${(await response.text()).slice(0, 600)}`);
  return (await response.json()) as T;
}

function specification(task: string, extra: Record<string, unknown> = {}) {
  return {
    task_type: task,
    method: { identifier: "b3lyp", display_name: "B3LYP", registry: "chemdft.method" },
    basis: { identifier: "def2-svp", display_name: "def2-SVP", registry: "chemdft.basis" },
    charge: 0,
    multiplicity: 1,
    engine_preference: { engine: "pyscf", allowed_version: "2.14.0" },
    ...extra,
  };
}

async function createDisposableWaterProject(api: APIRequestContext): Promise<string> {
  if (new URL(API_BASE).port === "8000") throw new Error("Refusing to create E2E records in the persistent dev API.");
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const project = await body<{ id: string }>(
    await api.post("/v1/projects", { data: { name: `Thermochemistry E2E (disposable ${suffix})`, slug: `thermo-e2e-${suffix}` } }),
    "create project",
  );
  const imported = await body<{ version: { id: string; structure_id: string } }>(
    await api.post(`/v1/projects/${project.id}/structures/imports`, {
      multipart: {
        upload: { name: "water.xyz", mimeType: "chemical/x-xyz", buffer: Buffer.from(WATER_XYZ) },
        file_format: "XYZ",
        idempotency_key: `thermo-e2e-import-${suffix}`,
        structure_name: "Water",
      },
    }),
    "import structure",
  );

  const run = async (versionId: string, spec: Record<string, unknown>, key: string) => {
    const submitted = await body<{ calculation: { id: string } }>(
      await api.post(`/v1/projects/${project.id}/calculations`, {
        data: {
          structure_version: { project_id: project.id, entity_type: "structure.version", entity_id: versionId },
          specification: spec,
          idempotency_key: `${key}-${suffix}`,
        },
      }),
      `submit ${key}`,
    );
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      const detail = await body<{ calculation: { state: string }; result?: { id: string; payload: Record<string, unknown> } }>(
        await api.get(`/v1/projects/${project.id}/calculations/${submitted.calculation.id}`),
        `poll ${key}`,
      );
      if (detail.calculation.state === "SUCCEEDED") return detail;
      if (["FAILED", "CANCELED"].includes(detail.calculation.state)) throw new Error(`${key} ended ${detail.calculation.state}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error(`${key} timed out (is the isolated compute worker running?)`);
  };

  const optimization = await run(
    imported.version.id,
    specification("GEOMETRY_OPTIMIZATION", { optimization: { optimizer: "geometric", max_steps: 100 } }),
    "thermo-e2e-opt",
  );
  const optimizedVersionId = String(optimization.result?.payload.final_structure_version_id);
  const frequency = await run(
    optimizedVersionId,
    specification("FREQUENCY", {
      hessian: {
        strategy: "ANALYTIC",
        exclude_translation_rotation: true,
        coordinate_unit: "angstrom",
        hessian_unit: "Eh/bohr^2",
        frequency_unit: "cm^-1",
      },
    }),
    "thermo-e2e-freq",
  );
  await run(
    optimizedVersionId,
    specification("THERMOCHEMISTRY", {
      thermochemistry: { source_frequency_result_id: String(frequency.result?.id), temperature_k: 298.15, pressure_pa: 101325.0 },
    }),
    "thermo-e2e-thermo-298",
  );
  return project.id;
}

async function openThermochemistry(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/projects/${projectId}/workspace`);
  await expect(page.getByRole("heading", { name: "Loading project inventory…" })).not.toBeVisible({ timeout: 45_000 });
  await page.getByTestId("guided-nav-analysis").click({ timeout: 30_000 });
  await expect(page.getByTestId("thermochemistry-panel")).toBeVisible({ timeout: 30_000 });
}

const num = async (page: Page, id: string) => Number((await page.getByTestId(`thermo-value-${id}`).innerText()).replace(/[^0-9eE+.-]/g, ""));

test.describe("Thermochemistry V1 (disposable Water project, B3LYP/def2-SVP, ideal-gas RRHO)", () => {
  // One worker, one disposable project for the whole suite (the fixture is built once in beforeAll).
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  test.skip(({ isMobile }) => isMobile, "Thermochemistry acceptance is desktop-oriented.");

  test.beforeAll(async () => {
    test.setTimeout(420_000);
    const api = await playwrightRequest.newContext({ baseURL: API_BASE });
    try {
      projectId = await createDisposableWaterProject(api);
    } finally {
      await api.dispose();
    }
  });

  test("Guided page: header, 3D optimized geometry, authoritative values and unit switching", async ({ page }) => {
    await openThermochemistry(page);
    const panel = page.getByTestId("thermochemistry-panel");
    await expect(panel).toContainText("Thermochemistry");
    await expect(panel).toContainText("Calculated");
    await expect(panel).toContainText("B3LYP / def2-svp");
    await expect(panel).toContainText("298.15 K · 1 atm");
    await expect(page.getByTestId("thermo-conditions")).toBeVisible();

    // Large canonical 3D viewer of the optimized geometry (not coloured by any thermodynamic value)
    const viewer = page.getByTestId("thermo-viewer");
    await expect(viewer.locator("canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("thermo-viewer-label")).toContainText("Optimized geometry · B3LYP / def2-svp");
    expect((await viewer.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(330);
    await expect(viewer.getByRole("button", { name: "Fit" })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Export" })).toBeVisible();
    await expect(viewer.locator("select[aria-label='Representation']")).toBeVisible();
    await viewer.getByText("View options").click();
    await expect(viewer.locator("select[aria-label='Projection']")).toBeVisible();
    await expect(viewer.locator("select[aria-label='Visual bonds']")).toBeVisible();
    await expect(viewer.locator("select[aria-label='Measure']")).toBeVisible();

    // Reference neighbourhood from the validated spike (validation only; the page shows stored values)
    await page.getByTestId("thermo-unit-kcal").click();
    expect(await num(page, "zpe")).toBeCloseTo(13.319, 1);
    expect(await num(page, "u-corr")).toBeCloseTo(15.098, 1);
    expect(await num(page, "h-corr")).toBeCloseTo(15.691, 1);
    expect(await num(page, "g-corr")).toBeCloseTo(2.235, 1);
    await expect(page.getByTestId("thermo-row-entropy")).toContainText("cal/mol/K");
    expect(await num(page, "entropy")).toBeCloseTo(188.83 / 4.184, 1);
    await page.getByTestId("thermo-unit-kj").click();
    expect(await num(page, "zpe")).toBeCloseTo(55.727, 1);
    expect(await num(page, "entropy")).toBeCloseTo(188.83, 1);
    expect(await num(page, "cv")).toBeCloseTo(25.135, 1);
    expect(await num(page, "cp")).toBeCloseTo(33.449, 1);
    await expect(page.getByTestId("thermo-row-entropy")).toContainText("J/mol/K");
    await page.getByTestId("thermo-unit-eh").click();
    expect(await num(page, "e0")).toBeCloseTo(-76.358315, 5);
    await expect(page.getByTestId("thermo-row-entropy")).toContainText("Eh/K");
    // definitions are explicit: corrections relative to E0 and include ZPE; totals include E0
    await expect(page.getByTestId("thermo-summary")).toContainText("relative to E₀");
    await expect(page.getByTestId("thermo-row-e0")).toContainText("T-independent");
    await expect(page.getByTestId("thermo-row-zpe")).toContainText("T-independent");
    // totals = E0 + corrections (Eh)
    const e0 = await num(page, "e0");
    expect(await num(page, "h")).toBeCloseTo(e0 + (await num(page, "h-corr")), 5);
  });

  test("contributions: energy bars separate E0, entropy donut, temperature trend", async ({ page }) => {
    await openThermochemistry(page);
    const contributions = page.getByTestId("thermo-contributions");
    await expect(contributions).toBeVisible();
    for (const id of ["zpe", "vibrational", "translational", "rotational", "electronic"]) {
      await expect(page.getByTestId(`thermo-energy-bar-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId("thermo-energy-card")).toContainText("shown separately");
    for (const id of ["translational", "rotational", "vibrational", "electronic"]) {
      await expect(page.getByTestId(`thermo-entropy-${id}`)).toBeVisible();
    }
    // translational dominates water's entropy; electronic is zero for a singlet
    await expect(page.getByTestId("thermo-entropy-translational")).toContainText("76.");
    await expect(page.getByTestId("thermo-entropy-electronic")).toContainText("0.0%");
    await expect(page.getByTestId("thermo-trend-chart")).toBeVisible();
    await expect(page.getByTestId("thermo-trend-marker")).toBeVisible();
    await page.getByTestId("thermo-trend-select").selectOption("cp");
    await expect(page.getByTestId("thermo-trend-chart")).toContainText("Cp");
    await expect(page.getByTestId("thermo-trend-card")).toContainText("not separate calculations");
  });

  test("temperature/pressure: preview is deterministic, labelled, and never reruns DFT", async ({ page }) => {
    await openThermochemistry(page);
    const calculationRequests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/calculations")) calculationRequests.push(request.url());
    });
    await page.getByTestId("thermo-unit-kj").click();
    const e0Before = await page.getByTestId("thermo-value-e0").innerText();
    const zpeBefore = await page.getByTestId("thermo-value-zpe").innerText();
    const gibbsBefore = await num(page, "g");
    await page.getByTestId("thermo-temperature-input").fill("400");
    await expect(page.getByTestId("thermo-preview-banner")).toBeVisible();
    await expect(page.getByTestId("thermo-preview-banner")).toContainText("not an authoritative record");
    await expect(page.getByTestId("thermo-preview-banner")).toContainText("no SCF or Hessian is rerun");
    await expect(page.getByTestId("thermochemistry-panel")).toContainText("Preview");
    await expect(page.getByTestId("thermo-value-e0")).toHaveText(e0Before);
    await expect(page.getByTestId("thermo-value-zpe")).toHaveText(zpeBefore);
    expect(await num(page, "g")).not.toBeCloseTo(gibbsBefore, 1);
    expect(await num(page, "entropy")).toBeGreaterThan(188.83);
    const trendMarker = page.getByTestId("thermo-trend-marker");
    await expect(trendMarker).toBeVisible();
    // pressure affects entropy / G (translational) but not enthalpy
    await page.getByTestId("thermo-temperature-input").fill("298.15");
    await expect(page.getByTestId("thermo-preview-banner")).toHaveCount(0);
    const hBefore = await num(page, "h");
    const sBefore = await num(page, "entropy");
    await page.getByTestId("thermo-pressure-input").fill("10");
    await expect(page.getByTestId("thermo-preview-banner")).toBeVisible();
    expect(await num(page, "h")).toBeCloseTo(hBefore, 3);
    expect(await num(page, "entropy")).toBeLessThan(sBefore - 10);
    // nonsense is rejected and not previewed
    await page.getByTestId("thermo-temperature-input").fill("0");
    await expect(page.getByTestId("thermo-validation-error")).toContainText("greater than 0 K");
    await page.getByTestId("thermo-temperature-input").fill("-20");
    await expect(page.getByTestId("thermo-validation-error")).toBeVisible();
    await page.getByTestId("thermo-temperature-input").fill("298.15");
    await page.getByTestId("thermo-pressure-input").fill("0");
    await expect(page.getByTestId("thermo-validation-error")).toContainText("greater than 0");
    await page.getByTestId("thermo-pressure-input").fill("1");
    await expect(page.getByTestId("thermo-validation-error")).toHaveCount(0);
    // preview never submitted a calculation
    expect(calculationRequests).toEqual([]);
  });

  test("authoritative recalculation at new conditions reuses persisted data (disposable project only)", async ({ page }) => {
    await openThermochemistry(page);
    const submitted: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/calculations")) submitted.push(request.postData() ?? "");
    });
    await page.getByTestId("thermo-temperature-input").fill("310.15");
    const banner = page.getByTestId("thermo-preview-banner");
    await expect(banner).toBeVisible();
    await page.getByTestId("thermo-calculate-btn").click();
    await expect(banner).toHaveCount(0, { timeout: 60_000 });
    expect(submitted).toHaveLength(1);
    const requestBody = JSON.parse(submitted[0]!);
    expect(requestBody.specification.task_type).toBe("THERMOCHEMISTRY");
    expect(requestBody.specification.thermochemistry.temperature_k).toBe(310.15);
    // only thermochemistry options: no Hessian / optimization / TDDFT / Raman work is requested
    expect(requestBody.specification.hessian ?? null).toBeNull();
    expect(requestBody.specification.optimization ?? null).toBeNull();
    expect(requestBody.specification.raman ?? null).toBeNull();
    expect(requestBody.specification.tddft ?? null).toBeNull();
    await expect(page.getByTestId("thermo-active-conditions")).toContainText("310.15 K|1 atm|authoritative");
    await expect(page.getByTestId("thermo-family")).toContainText("310.15 K · 1 atm");
    await expect(page.getByTestId("thermo-family")).toContainText("298.15 K · 1 atm");
  });

  test("invalid temperature/pressure draft is unambiguous: last valid result stays, labelled, nothing recomputed or submitted", async ({ page }) => {
    await openThermochemistry(page);
    const submitted: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/calculations")) submitted.push(request.url());
    });
    const panel = page.getByTestId("thermochemistry-panel");
    const chip = page.getByTestId("thermo-status-chip");
    const alert = page.getByTestId("thermo-validation-error");
    await page.getByTestId("thermo-unit-kj").click();

    // (a) invalid draft on top of the authoritative record
    const authoritativeG = await page.getByTestId("thermo-value-g").innerText();
    const authoritativeS = await page.getByTestId("thermo-value-entropy").innerText();
    await expect(chip).toHaveText("Calculated");
    await page.getByTestId("thermo-temperature-input").fill("10");
    await expect(alert).toContainText("Invalid temperature.");
    await expect(alert).toContainText("Showing last valid result at 298.15 K · 1 atm.");
    await expect(chip).toHaveText("Invalid input");
    await expect(chip).not.toHaveText("Calculated");
    await expect(panel).toHaveAttribute("data-draft-invalid", "true");
    await expect(page.getByTestId("thermo-temperature-input")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("thermo-active-conditions")).toContainText("298.15 K|1 atm|authoritative");
    await expect(page.getByTestId("thermo-value-g")).toHaveText(authoritativeG);
    await expect(page.getByTestId("thermo-value-entropy")).toHaveText(authoritativeS);
    await expect(page.getByTestId("thermo-calculate-btn")).toHaveCount(0);
    await expect(page.getByTestId("thermo-preview-banner")).toHaveCount(0);

    // (b) a valid preview, then an invalid draft: the preview (not 10 K) remains, labelled as such
    await page.getByTestId("thermo-temperature-input").fill("748.15");
    await expect(page.getByTestId("thermo-preview-banner")).toBeVisible();
    await expect(chip).toHaveText("Preview");
    await expect(alert).toHaveCount(0);
    const previewG = await page.getByTestId("thermo-value-g").innerText();
    const previewS = await page.getByTestId("thermo-value-entropy").innerText();
    expect(previewG).not.toBe(authoritativeG);
    await page.getByTestId("thermo-temperature-input").fill("10");
    await expect(alert).toContainText("Invalid temperature.");
    await expect(alert).toContainText("Showing last valid preview at 748.15 K · 1 atm.");
    await expect(chip).toHaveText("Invalid input");
    await expect(page.getByTestId("thermo-active-conditions")).toContainText("748.15 K|1 atm|preview");
    await expect(page.getByTestId("thermo-value-g")).toHaveText(previewG);
    await expect(page.getByTestId("thermo-value-entropy")).toHaveText(previewS);
    await expect(page.getByTestId("thermo-calculate-btn")).toHaveCount(0);

    // (c) invalid pressure, then recovery to a valid draft
    await page.getByTestId("thermo-temperature-input").fill("298.15");
    await expect(chip).toHaveText("Calculated");
    await page.getByTestId("thermo-pressure-input").fill("0");
    await expect(alert).toContainText("Invalid pressure.");
    await expect(alert).toContainText("Showing last valid result at 298.15 K · 1 atm.");
    await page.getByTestId("thermo-pressure-input").fill("1");
    await expect(alert).toHaveCount(0);
    await expect(chip).toHaveText("Calculated");
    await expect(panel).not.toHaveAttribute("data-draft-invalid", "true");
    await expect(page.getByTestId("thermo-value-g")).toHaveText(authoritativeG);

    // the authoritative record is untouched and no calculation was created from invalid values
    expect(submitted).toEqual([]);
  });

  test("vibrational modes: select, animate in the shared viewer, safe visual exaggeration", async ({ page }) => {
    await openThermochemistry(page);
    await expect(page.getByTestId("thermo-modes-table")).toContainText("1638.8");
    await expect(page.getByTestId("thermo-modes-table")).toContainText("3791.4");
    await expect(page.getByTestId("thermo-modes-table")).toContainText("3886.6");
    // wait for the persisted source normal modes to load before animating
    await expect(page.getByRole("button", { name: "Animate mode 2" })).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("thermo-mode-row-2").click();
    await expect(page.getByTestId("thermo-viewer-label")).toContainText("Mode 2 · 3791.4 cm⁻¹");
    await expect(page.getByTestId("thermo-viewer-label")).toContainText("animating");
    const controls = page.getByTestId("thermo-mode-controls");
    await expect(controls).toContainText("Visual exaggeration");
    await expect(controls).not.toContainText("Å");
    const slider = page.getByLabel("Visual exaggeration");
    await expect(slider).toHaveAttribute("min", "0.5");
    await expect(slider).toHaveAttribute("max", "2");
    await expect(slider).toHaveValue("1");
    await slider.fill("2");
    const canvas = page.locator(".thermo-workspace .structure-canvas");
    const bonds = new Set<string>();
    for (let i = 0; i < 15; i += 1) {
      bonds.add((await canvas.getAttribute("data-visual-bonds")) ?? "missing");
      await page.waitForTimeout(120);
    }
    expect(bonds).toEqual(new Set(["2"]));
    await page.getByTestId("thermo-play-pause-btn").click();
    await expect(page.getByTestId("thermo-viewer-label")).toContainText("paused");
    await page.getByTestId("thermo-play-pause-btn").click();
    await expect(page.getByTestId("thermo-viewer-label")).toContainText("animating");
    await page.getByRole("button", { name: "Animate mode 3" }).click();
    await expect(page.getByTestId("thermo-viewer-label")).toContainText("Mode 3 · 3886.6 cm⁻¹");
    await page.getByTestId("thermo-clear-mode-btn").click();
    await expect(page.getByTestId("thermo-viewer-label")).toContainText("Optimized geometry");
  });

  test("AI Scientist: collapsed by default, context grounded in Structure → Thermochemistry → T/P", async ({ page }) => {
    await openThermochemistry(page);
    await expect(page.locator(".context-dock")).toBeHidden();
    await page.getByTestId("ai-dock-toggle").click();
    await expect(page.locator(".context-dock")).toBeVisible();
    const context = page.getByTestId("ai-current-view");
    await expect(context).toContainText("Thermochemistry");
    await expect(context).toContainText("298.15 K · 1 atm");
    await expect(context).toContainText("B3LYP");
    await page.getByTestId("thermo-temperature-input").fill("350");
    await expect(context).toContainText("350 K · 1 atm");
    await page.getByTestId("ai-dock-close").click();
    await expect(page.locator(".context-dock")).toBeHidden();
  });

  test("Advanced: complete conditions, quantities, provenance, symmetry, diagnostics and constants", async ({ page }) => {
    await openThermochemistry(page);
    await page.getByTestId("thermo-open-advanced-btn").click();
    const advanced = page.getByTestId("thermochemistry-advanced-panel");
    await expect(advanced).toBeVisible({ timeout: 20_000 });
    for (const text of [
      "Conditions",
      "Canonical quantities",
      "Contribution breakdown",
      "Harmonic modes",
      "Molecule and symmetry",
      "Diagnostics",
      "Input references and provenance",
      "Engine, constants and conventions",
      "ideal-gas-rrho",
      "Rotational symmetry number σ",
      "chemdft-proper-rotation-count",
      "optimization-trajectory-final-step",
      "Frequency result SHA-256",
      "E0 artifact SHA-256",
      "pyscf.data.nist",
      "pyscf.hessian.thermo.thermo",
      "Imaginary-mode policy",
      "reject",
    ]) {
      await expect(advanced).toContainText(text);
    }
    await expect(page.locator(".project-explorer")).toContainText("Thermochemistry · 298.15 K · 1 atm");
    // back to Guided keeps the Thermochemistry page
    await page.getByTestId("mode-toggle-guided").click();
    await expect(page.getByTestId("thermochemistry-panel")).toBeVisible({ timeout: 20_000 });
  });

  test("responsive: 1024px layout has no horizontal overflow and keeps the viewer large", async ({ page }) => {
    await openThermochemistry(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.getByTestId("thermo-viewer")).toBeVisible();
    expect((await page.getByTestId("thermo-viewer").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(330);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByTestId("thermo-summary")).toBeVisible();
    await expect(page.getByTestId("thermo-modes-table")).toBeVisible();
  });
});
