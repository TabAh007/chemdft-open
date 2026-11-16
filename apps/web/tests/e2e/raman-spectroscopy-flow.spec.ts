import { expect, test, type Page } from "@playwright/test";
// The Guided AI Scientist dock defaults to collapsed on Spectra; open it explicitly.
async function openAiDock(page: Page) {
  const dock = page.locator(".context-dock");
  if (!(await dock.isVisible())) await page.getByTestId("ai-dock-toggle").click();
  await expect(dock).toBeVisible();
}


const WATER_PROJECT_ID = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";
// Definitive Raman result: Water / B3LYP/def2-SVP / Placzek static FEF
const RAMAN_CALC_ID = "0bd1d4ad-b221-42b7-9cf8-75ee3a536613";
const RAMAN_RESULT_ID = "43f00090-5a06-4bc9-9246-e4351008dc08";
// Requires the persisted Water project/Raman result, so it targets a live dev
// environment (web -> API with real data). Override with RAMAN_E2E_BASE_URL.
const DEV_BASE = process.env.RAMAN_E2E_BASE_URL ?? "http://localhost:3000";

test.describe("Raman Spectroscopy Workflow and Navigation Acceptance", () => {
  test.setTimeout(120_000);

  test("verifies full human flow: Guided Spectra -> Raman tab -> Mode 2 (symmetric stretch) -> Advanced -> Mode preserved -> Guided return", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });

    page.on("console", (msg) =>
      console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`)
    );
    page.on("pageerror", (err) =>
      console.log(`[BROWSER ERROR] ${err.message}`)
    );

    // Open Water workspace
    await page.goto(`${DEV_BASE}/en/projects/${WATER_PROJECT_ID}/workspace`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);

    // Ensure Guided mode is active
    const guidedToggle = page.getByTestId("mode-toggle-guided");
    if (await guidedToggle.isVisible()) {
      await guidedToggle.click();
      await page.waitForTimeout(1000);
    }

    // Ensure AI Scientist panel is open
    const aiTabBtn = page.getByRole("tab", { name: "AI Scientist" });
    if (await aiTabBtn.isVisible()) {
      await aiTabBtn.click();
      await page.waitForTimeout(500);
    }

    // Wait for project loading to complete
    await expect(
      page.getByRole("heading", { name: "Loading project inventory…" })
    ).not.toBeVisible({ timeout: 20_000 });

    // -----------------------------------------------------------------------
    // 1. GUIDED -> SPECTRA -> SWITCH TO RAMAN
    // -----------------------------------------------------------------------
    const spectraStepBtn = page.getByTestId("guided-nav-spectra");
    await expect(spectraStepBtn).toBeVisible({ timeout: 15_000 });
    await spectraStepBtn.click();
    await page.waitForTimeout(1000);

    await expect(page.getByTestId("guided-spectra-view")).toBeVisible({
      timeout: 15_000,
    });

    // Switch to Raman tab
    const ramanTab = page.getByTestId("spectra-tab-raman");
    await expect(ramanTab).toBeVisible({ timeout: 10_000 });
    await ramanTab.click();
    await page.waitForTimeout(1500);

    // Verify Raman panel is visible
    const ramanPanel = page.getByTestId("raman-spectroscopy-panel");
    await expect(ramanPanel).toBeVisible({ timeout: 10_000 });

    // Verify spectrum title and engine provenance
    await expect(ramanPanel).toContainText("Raman Spectroscopy");
    await expect(ramanPanel).toContainText("PySCF");
    // Implementation details live in the provenance section, not the primary view
    await expect(ramanPanel.getByText("Calculation & Spectroscopy Provenance")).toBeVisible();

    // -----------------------------------------------------------------------
    // 2. MODE ROWS: Verify all 3 water modes are present
    // -----------------------------------------------------------------------
    const mode1Row = page.getByTestId("mode-row-1");
    const mode2Row = page.getByTestId("mode-row-2");
    const mode3Row = page.getByTestId("mode-row-3");

    await expect(mode1Row).toBeVisible({ timeout: 10_000 });
    await expect(mode2Row).toBeVisible();
    await expect(mode3Row).toBeVisible();

    // Mode 3 (antisymmetric stretch): ~4020.2 cm⁻¹ — depolarized (ρ=0.75)
    await expect(mode3Row).toContainText("4020.2");

    // Raman sticks visible in SVG spectrum
    await expect(page.getByTestId("raman-stick-1")).toBeVisible();
    await expect(page.getByTestId("raman-stick-2")).toBeVisible();
    await expect(page.getByTestId("raman-stick-3")).toBeVisible();

    // AI context updated on Raman activation
    await openAiDock(page);
    const aiContext = page.getByTestId("ai-current-view");
    await expect(aiContext).toBeVisible({ timeout: 10_000 });

    // -----------------------------------------------------------------------
    // 3. SELECT MODE 2 (symmetric stretch — most intense, ρ≈0.1669)
    // -----------------------------------------------------------------------
    await mode2Row.click();
    await page.waitForTimeout(1000);

    // Selected-mode inspector shows Mode 2 details
    const modeInspector = page.getByTestId("selected-mode-inspector");
    await expect(modeInspector).toBeVisible();
    await expect(modeInspector).toContainText("Mode 2");

    // 3D animation controls
    await expect(page.getByTestId("raman-play-pause-btn")).toBeVisible();
    await expect(page.getByTestId("raman-amplitude-control")).toBeVisible();

    // AI context references Raman and Mode 2
    const contextText = await aiContext.textContent();
    expect(contextText).toContain("Raman");
    expect(contextText).toContain("Mode 2");

    // -----------------------------------------------------------------------
    // 4. ACTIVITY / INTENSITY TOGGLE
    // -----------------------------------------------------------------------
    // Activity view: laser/temperature do not affect Raman activity, so they are hidden
    await expect(page.getByTestId("raman-laser-select")).toHaveCount(0);
    const intensityBtn = page.getByTestId("raman-view-intensity-btn");
    await expect(intensityBtn).toBeVisible();
    await intensityBtn.click();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("raman-laser-select")).toBeVisible();
    await expect(page.getByTestId("raman-temp-input")).toBeVisible();
    // Spectrum re-renders (sticks still present under Intensity view)
    await expect(page.getByTestId("raman-stick-2")).toBeVisible();

    // Switch back to Activity
    const activityBtn = page.getByTestId("raman-view-activity-btn");
    await activityBtn.click();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("raman-stick-2")).toBeVisible();

    // -----------------------------------------------------------------------
    // 5. ADVANCED WORKBENCH — Mode 2 preserved
    // -----------------------------------------------------------------------
    const advancedToggle = page.getByTestId("mode-toggle-advanced");
    await advancedToggle.click();
    await page.waitForTimeout(1500);

    // Advanced workbench active
    await expect(page.locator(".workspace-tabs")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("tab", { name: /Raman spectrum/, selected: true })
    ).toBeVisible();

    // Raman panel and Mode 2 preserved
    const advRamanPanel = page.getByTestId("raman-spectroscopy-panel");
    await expect(advRamanPanel).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("selected-mode-inspector")).toContainText(
      "Mode 2"
    );

    // AI context preserved in Advanced mode
    const advContextText = await aiContext.textContent();
    expect(advContextText).toContain("Raman");
    expect(advContextText).toContain("Mode 2");

    // -----------------------------------------------------------------------
    // 6. RETURN TO GUIDED MODE — Mode 2 still preserved
    // -----------------------------------------------------------------------
    await guidedToggle.click();
    await page.waitForTimeout(1500);

    await expect(page.getByTestId("guided-spectra-view")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("raman-spectroscopy-panel")).toBeVisible();
    await expect(page.getByTestId("selected-mode-inspector")).toContainText(
      "Mode 2"
    );
  });

  test("regression: Raman result activates Raman AI context immediately and answers strongest Raman band using Raman artifact data", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });

    // Open Water workspace
    await page.goto(`${DEV_BASE}/en/projects/${WATER_PROJECT_ID}/workspace`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);

    // Ensure Guided mode
    const guidedToggle = page.getByTestId("mode-toggle-guided");
    if (await guidedToggle.isVisible()) {
      await guidedToggle.click();
      await page.waitForTimeout(500);
    }

    // Ensure AI Scientist panel is open
    const aiTabBtn = page.getByRole("tab", { name: "AI Scientist" });
    if (await aiTabBtn.isVisible()) {
      await aiTabBtn.click();
      await page.waitForTimeout(500);
    }

    // 1. Open IR first to establish a different context
    const spectraStepBtn = page.getByTestId("guided-nav-spectra");
    await spectraStepBtn.click();
    await page.waitForTimeout(1000);

    const irTab = page.getByTestId("spectra-tab-ir");
    await irTab.click();
    await page.waitForTimeout(1000);

    await openAiDock(page);

    const aiContext = page.getByTestId("ai-current-view");
    await expect(aiContext).toContainText("IR");

    // 2. Switch to Raman — AI context must update immediately
    const ramanTab = page.getByTestId("spectra-tab-raman");
    await ramanTab.click();
    await page.waitForTimeout(1500);

    await expect(aiContext).toContainText("Raman");
    await expect(aiContext).not.toContainText("UV/Vis");

    // 3. Ask which Raman band is most intense
    const promptInput = page.getByTestId("ai-prompt-input");
    await promptInput.fill("Which Raman band is most intense?");
    const sendBtn = page.getByTestId("ai-ask-button");
    await sendBtn.click();

    // 4. Confirm answer uses Raman data: Mode 2 (symmetric stretch),
    //    ~74.42 Å⁴/amu, freq ~3913.6 cm⁻¹ — must NOT reference IR intensities
    const latestMsg = page.locator(".ai-message-bubble.assistant").last();
    await expect(latestMsg).toContainText("Mode 2", { timeout: 20_000 });
    await expect(latestMsg).toContainText("3913");

    const answerText = await latestMsg.textContent();
    // Must not bleed IR artifacts into Raman answer
    expect(answerText?.toLowerCase()).not.toContain("km/mol");
    expect(answerText?.toLowerCase()).not.toContain("oscillator strength");
  });

  test("direct URL activation: loading workspace with Raman result in selection query activates Raman AI context", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });

    // Navigate directly to workspace with Raman result pre-selected
    await page.goto(
      `${DEV_BASE}/en/projects/${WATER_PROJECT_ID}/workspace?selection=${encodeURIComponent(
        `calculationResult:${RAMAN_RESULT_ID}`
      )}&source=${RAMAN_CALC_ID}`
    );
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2500);

    // Ensure AI Scientist panel is open
    const aiTabBtn = page.getByRole("tab", { name: "AI Scientist" });
    if (await aiTabBtn.isVisible()) {
      await aiTabBtn.click();
      await page.waitForTimeout(500);
    }

    // AI context should reflect Raman from URL-loaded state
    const directAiContext = page.getByTestId("ai-current-view");
    await expect(directAiContext).toContainText("Raman");
    await expect(directAiContext).not.toContainText("UV/Vis");
    await expect(directAiContext).not.toContainText("IR");
  });

  test("layout: viewer and spectrum are large; AI dock defaults collapsed on Spectra and remembers explicit choices", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const gotoRaman = async () => {
      await page.goto(`${DEV_BASE}/en/projects/${WATER_PROJECT_ID}/workspace`);
      await expect(
        page.getByRole("heading", { name: "Loading project inventory…" })
      ).not.toBeVisible({ timeout: 30_000 });
      await page.getByTestId("guided-nav-spectra").click();
      await page.getByTestId("spectra-tab-raman").click();
      await expect(page.getByTestId("raman-spectroscopy-panel")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("raman-stick-3")).toBeVisible();
    };
    await gotoRaman();
    const panel = page.getByTestId("raman-spectroscopy-panel");
    const dock = page.locator(".context-dock");

    // No prior preference: AI Scientist is collapsed on Spectra
    await expect(dock).toBeHidden();

    const viewer = panel.locator(".spectro-viewer");
    const chart = panel.locator(".spectro-chart svg");
    const viewerBox = await viewer.boundingBox();
    const chartBox = await chart.boundingBox();
    expect(viewerBox?.height ?? 0).toBeGreaterThanOrEqual(300);
    expect(chartBox?.height ?? 0).toBeGreaterThanOrEqual(240);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Explicit open is remembered across reloads
    const widthCollapsed = chartBox?.width ?? 0;
    await page.getByTestId("ai-dock-toggle").click();
    await expect(dock).toBeVisible();
    await expect.poll(async () => (await chart.boundingBox())?.width ?? 0).toBeLessThan(widthCollapsed - 200);
    await gotoRaman();
    await expect(dock).toBeVisible();

    // Explicit close is remembered too
    await page.getByTestId("ai-dock-close").click();
    await expect(dock).toBeHidden();
    await gotoRaman();
    await expect(dock).toBeHidden();
  });

  test("visual exaggeration is display-only and keeps visual bonds during animation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${DEV_BASE}/en/projects/${WATER_PROJECT_ID}/workspace`);
    await expect(
      page.getByRole("heading", { name: "Loading project inventory…" })
    ).not.toBeVisible({ timeout: 30_000 });
    await page.getByTestId("guided-nav-spectra").click();
    await page.getByTestId("spectra-tab-raman").click();
    const control = page.getByTestId("raman-amplitude-control");
    await expect(control).toContainText("Visual exaggeration");
    await expect(control).not.toContainText("Å");

    const slider = page.getByLabel("Visual exaggeration");
    await expect(slider).toHaveAttribute("min", "0.5");
    await expect(slider).toHaveAttribute("max", "2");
    await expect(slider).toHaveValue("1");

    // At maximum exaggeration, the equilibrium visual bonds must persist in every frame
    await slider.fill("2");
    await expect(control).toContainText("2.00×");
    const canvas = page.locator(".spectro-viewer .structure-canvas");
    await expect(canvas).toBeVisible();
    const counts: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      counts.push((await canvas.getAttribute("data-visual-bonds")) ?? "missing");
      await page.waitForTimeout(120);
    }
    expect(new Set(counts)).toEqual(new Set(["2"]));
  });

  test("Advanced explorer labels Raman-bearing results as Raman, IR-only as IR", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${DEV_BASE}/en/projects/${WATER_PROJECT_ID}/workspace`);
    await expect(
      page.getByRole("heading", { name: "Loading project inventory…" })
    ).not.toBeVisible({ timeout: 30_000 });
    await page.getByTestId("mode-toggle-advanced").click();
    const explorer = page.locator(".project-explorer");
    await expect(explorer).toContainText("Raman spectrum · 3 modes", { timeout: 15_000 });
    // IR-only results keep their IR label; the four historical Raman-bearing results are Raman
    expect(await explorer.getByText("IR spectrum · 3 modes").count()).toBeGreaterThanOrEqual(1);
    expect(await explorer.getByText("Raman spectrum · 3 modes").count()).toBeGreaterThanOrEqual(4);
  });
});
