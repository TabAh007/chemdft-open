import { expect, test, type Page } from "@playwright/test";
// The Guided AI Scientist dock defaults to collapsed on Spectra; open it explicitly.
async function openAiDock(page: Page) {
  const dock = page.locator(".context-dock");
  if (!(await dock.isVisible())) await page.getByTestId("ai-dock-toggle").click();
  await expect(dock).toBeVisible();
}


const WATER_PROJECT_ID = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";

test.describe("IR Spectroscopy Workflow and Navigation Acceptance", () => {
  test.setTimeout(120_000);

  test("verifies full human flow: Guided Spectra -> IR -> Mode 1 -> Advanced -> Mode 1 preserved -> Guided return", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });

    page.on("console", (msg) => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on("pageerror", (err) => console.log(`[BROWSER ERROR] ${err.message}`));

    // Open Water workspace
    await page.goto(`/en/projects/${WATER_PROJECT_ID}/workspace`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);

    // Ensure Guided mode is active initially
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

    // Wait for project loading to finish
    await expect(page.getByRole("heading", { name: "Loading project inventory…" })).not.toBeVisible({ timeout: 20_000 });

    // -------------------------------------------------------------------------
    // 1. GUIDED -> SPECTRA -> SWITCH TO IR
    // -------------------------------------------------------------------------
    const spectraStepBtn = page.getByTestId("guided-nav-spectra");
    await expect(spectraStepBtn).toBeVisible({ timeout: 15_000 });
    await spectraStepBtn.click();
    await page.waitForTimeout(1000);

    await expect(page.getByTestId("guided-spectra-view")).toBeVisible({ timeout: 15_000 });

    // Switch to IR tab
    const irTab = page.getByTestId("spectra-tab-ir");
    await expect(irTab).toBeVisible({ timeout: 10_000 });
    await irTab.click();
    await page.waitForTimeout(1000);

    // Verify IR panel is visible
    const irPanel = page.getByTestId("ir-spectroscopy-panel");
    await expect(irPanel).toBeVisible({ timeout: 10_000 });

    // Verify spectrum title and engine provenance
    await expect(irPanel).toContainText("IR spectrum");
    await expect(irPanel).toContainText("PySCF");

    // Mode rows: Mode 1, Mode 2, Mode 3
    const mode1Row = page.getByTestId("mode-row-1");
    await expect(mode1Row).toBeVisible();
    const mode3Row = page.getByTestId("mode-row-3");
    await expect(mode3Row).toBeVisible();
    // The antisymmetric O-H stretch (3800-4100 cm^-1 depending on the geometry) is listed in full
    await expect(mode3Row).toContainText(/(3[89]|40)\d\d\.\d/);

    // Verify the axis covers the highest mode (4000 baseline, auto-expanded when a mode exceeds it)
    await expect(irPanel).toContainText(/4000|4200/);
    await expect(page.getByTestId("ir-stick-3")).toBeVisible();

    // Context before selection or with default selection
    await openAiDock(page);
    const aiContext = page.getByTestId("ai-current-view");
    await expect(aiContext).toBeVisible({ timeout: 10_000 });

    // -------------------------------------------------------------------------
    // 2. SELECT STRONGEST MODE (MODE 1)
    // -------------------------------------------------------------------------
    await mode1Row.click();
    await page.waitForTimeout(1000);

    // Inspector shows Mode 1 details
    const modeInspector = page.getByTestId("selected-mode-inspector");
    await expect(modeInspector).toBeVisible();
    await expect(modeInspector).toContainText("Mode 1");

    // Animation controls are available
    await expect(page.getByTestId("ir-play-pause-btn")).toBeVisible();
    await expect(page.getByTestId("ir-amplitude-control")).toBeVisible();

    // AI Context should show Mode 1
    const contextText = await aiContext.textContent();
    expect(contextText).toContain("IR");
    expect(contextText).toContain("Mode 1");

    // -------------------------------------------------------------------------
    // 3. ADVANCED WORKBENCH PRESERVATION
    // -------------------------------------------------------------------------
    const advancedToggle = page.getByTestId("mode-toggle-advanced");
    await advancedToggle.click();
    await page.waitForTimeout(1500);

    // Advanced workbench active
    await expect(page.locator(".workspace-tabs")).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("tab", { name: /IR spectrum/, selected: true })
    ).toBeVisible();

    // Verify IR panel and Mode 1 preserved in Advanced mode
    const advIrPanel = page.getByTestId("ir-spectroscopy-panel");
    await expect(advIrPanel).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("selected-mode-inspector")).toContainText("Mode 1");

    // AI context in Advanced mode must remain synchronized
    const advContextText = await aiContext.textContent();
    expect(advContextText).toContain("IR");
    expect(advContextText).toContain("Mode 1");

    // -------------------------------------------------------------------------
    // 4. RETURN TO GUIDED MODE
    // -------------------------------------------------------------------------
    await guidedToggle.click();
    await page.waitForTimeout(1500);

    // Guided mode returns to the same IR spectrum and Mode 1
    await expect(page.getByTestId("guided-spectra-view")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("ir-spectroscopy-panel")).toBeVisible();
    await expect(page.getByTestId("selected-mode-inspector")).toContainText("Mode 1");
  });

  test("regression: IR result opens with immediate IR AI context without clicking mode, and answers strongest vibration using IR record", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });

    // Open Water workspace
    await page.goto(`/en/projects/${WATER_PROJECT_ID}/workspace`);
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

    // 1. Open/select UV/Vis result
    const spectraStepBtn = page.getByTestId("guided-nav-spectra");
    await spectraStepBtn.click();
    await page.waitForTimeout(1000);

    const uvvisTab = page.getByTestId("spectra-tab-uvvis");
    await uvvisTab.click();
    await page.waitForTimeout(1000);

    // 2. Confirm AI context is UV/Vis
    await openAiDock(page);
    const aiContext = page.getByTestId("ai-current-view");
    await expect(aiContext).toContainText("UV/Vis");

    // 3. Switch/open existing IR result without clicking any mode
    const irTab = page.getByTestId("spectra-tab-ir");
    await irTab.click();
    await page.waitForTimeout(1000);

    // 4 & 5. Confirm AI context immediately becomes IR WITHOUT clicking any mode
    await expect(aiContext).toContainText("IR");
    await expect(aiContext).not.toContainText("UV/Vis");

    // 6. Ask "Which vibration is strongest?"
    const promptInput = page.getByTestId("ai-prompt-input");
    await promptInput.fill("Which vibration is strongest?");
    const sendBtn = page.getByTestId("ai-ask-button");
    await sendBtn.click();

    // 7. Confirm the answer uses the displayed IR result: its strongest band is Mode 1 (the bend)
    //    and the frequency / intensity quoted by the AI match the IR table row.
    const latestAssistantMessage = page.locator(".ai-message-bubble.assistant").last();
    await expect(latestAssistantMessage).toContainText("Mode 1", { timeout: 15_000 });
    const modeRowText = (await page.getByTestId("mode-row-1").innerText()).replace(/\s+/g, " ");
    const shownFrequency = /(\d{3,4}\.\d) /.exec(modeRowText)?.[1];
    const shownIntensity = /\d{3,4}\.\d (\d+\.\d{2}) /.exec(modeRowText)?.[1];
    expect(shownFrequency).toBeTruthy();
    expect(shownIntensity).toBeTruthy();
    await expect(latestAssistantMessage).toContainText(shownFrequency!);
    await expect(latestAssistantMessage).toContainText(shownIntensity!);

    // 8. Confirm answer does NOT contain TDDFT artifacts
    const answerText = await latestAssistantMessage.textContent();
    expect(answerText?.toLowerCase()).not.toContain("s3");
    expect(answerText?.toLowerCase()).not.toContain("oscillator strength");
    expect(answerText?.toLowerCase()).not.toContain("9.52 ev");
    expect(answerText?.toLowerCase()).not.toContain("130.3 nm");

    // Also test direct page load where URL already selects the IR result
    const irResultId = "1f2f7725-d3ea-4893-a285-52418c697771";
    const calcId = "cf9d7da1-f52c-4452-95af-0fb5ba9bc7dc";
    const encodedSelection = encodeURIComponent(JSON.stringify({
      kind: "calculationResult",
      id: irResultId,
      projectId: WATER_PROJECT_ID,
      sourceId: calcId,
    }));
    await page.goto(`/en/projects/${WATER_PROJECT_ID}/workspace?selection=${encodedSelection}`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const directAiContext = page.getByTestId("ai-current-view");
    await expect(directAiContext).toContainText("IR");
    await expect(directAiContext).not.toContainText("UV/Vis");
  });
});
