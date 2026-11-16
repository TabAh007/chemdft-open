import { expect, test, type Page } from "@playwright/test";
// The Guided AI Scientist dock defaults to collapsed on Spectra; open it explicitly.
async function openAiDock(page: Page) {
  const dock = page.locator(".context-dock");
  if (!(await dock.isVisible())) await page.getByTestId("ai-dock-toggle").click();
  await expect(dock).toBeVisible();
}


const WATER_PROJECT_ID = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";

test.describe("TDDFT Workflow and Navigation Acceptance", () => {
  test.setTimeout(120_000);

  test("verifies full human flow: Guided Spectra -> S3 -> Advanced -> Results deduplication -> Guided return", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });

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

    // -------------------------------------------------------------------------
    // D. PROJECT OVERVIEW DETERMINISTIC NEXT-STEP
    // -------------------------------------------------------------------------
    // Water has both electronic structure and spectroscopy complete.
    // It should NOT recommend "Explore electronic structure" as primary next step.
    const recommendationCard = page.getByTestId("recommended-next-step");
    await expect(recommendationCard).toBeVisible({ timeout: 10_000 });
    const recText = await recommendationCard.textContent();
    expect(recText).toContain("Review UV/Vis result");
    expect(recText).toContain("TDDFT spectra ready");

    // -------------------------------------------------------------------------
    // A. GUIDED -> SPECTRA -> S3 -> ADVANCED WORKBENCH
    // -------------------------------------------------------------------------
    // Click primary recommended action to open spectra
    const reviewUvVisBtn = page.getByTestId("guided-primary-action-btn");
    await expect(reviewUvVisBtn).toBeVisible();
    await reviewUvVisBtn.click();
    await page.waitForTimeout(1500);

    // Verify Guided Spectra View is active
    await expect(page.getByTestId("guided-spectra-view")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("uvvis-spectroscopy-panel")).toBeVisible();

    // Context before explicit state selection should be "Water V1 → UV/Vis spectrum"
    await openAiDock(page);
    const aiContext = page.getByTestId("ai-current-view");
    await expect(aiContext).toBeVisible({ timeout: 10_000 });
    const initialSpectraContext = await aiContext.textContent();
    expect(initialSpectraContext?.trim()).toMatch(/^Water V\d → UV\/Vis spectrum$/);

    // Select state S3
    const s3Row = page.getByTestId("state-row-S3");
    await expect(s3Row).toBeVisible();
    await s3Row.click();
    await page.waitForTimeout(1000);

    // Inspector shows State S3 Inspector
    const inspector = page.getByTestId("selected-state-inspector");
    await expect(inspector).toBeVisible();
    const inspectorText = await inspector.textContent();
    expect(inspectorText).toContain("State S3 Inspector");

    // AI Context must now be "Water V1 → UV/Vis → S3"
    await expect(aiContext).toHaveText(/^Water V\d → UV\/Vis → S3$/);

    // Click Advanced Workbench mode switch
    const advancedToggle = page.getByTestId("mode-toggle-advanced");
    await advancedToggle.click();
    await page.waitForTimeout(1500);

    // Advanced workbench active
    await expect(page.locator(".workspace-tabs")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("tab", { name: /UV\/Vis absorption spectrum/, selected: true })).toBeVisible();

    // Same TDDFT result and S3 state preserved in Advanced mode
    const advInspector = page.getByTestId("selected-state-inspector");
    await expect(advInspector).toBeVisible({ timeout: 10_000 });
    const advInspectorText = await advInspector.textContent();
    expect(advInspectorText).toContain("State S3 Inspector");

    // AI context in Advanced mode must remain "Water V1 → UV/Vis → S3"
    await expect(aiContext).toHaveText(/^Water V\d → UV\/Vis → S3$/);

    // -------------------------------------------------------------------------
    // B. RESULTS -> UV/VIS ABSORPTION SPECTRUM REUSES EXISTING TAB
    // -------------------------------------------------------------------------
    // Count active workspace tabs before
    const tabsBefore = await page.getByRole("tab").count();

    // Click "UV/Vis absorption spectrum" item in Explorer tree under Results
    const explorerUvVisItem = page.getByRole("button", { name: /UV\/Vis absorption spectrum/ });
    if (await explorerUvVisItem.first().isVisible()) {
      await explorerUvVisItem.first().click();
      await page.waitForTimeout(1000);

      // Verify no duplicate tab created
      const tabsAfter = await page.getByRole("tab").count();
      expect(tabsAfter).toBeLessThanOrEqual(tabsBefore);
    }

    // Now select state S1 in Advanced mode
    const s1Row = page.getByTestId("state-row-S1");
    await expect(s1Row).toBeVisible();
    await s1Row.click();
    await page.waitForTimeout(1000);

    // Inspector shows State S1 Inspector
    await expect(inspector).toContainText("State S1 Inspector");

    // AI Context updates to "Water V1 → UV/Vis → S1"
    await expect(aiContext).toHaveText(/^Water V\d → UV\/Vis → S1$/);

    // -------------------------------------------------------------------------
    // C. ADVANCED UV/VIS -> GUIDED RETURNS TO SPECTRA WITH S1 PRESERVED
    // -------------------------------------------------------------------------
    await guidedToggle.click();
    await page.waitForTimeout(1500);

    // Return to Guided Spectra view
    await expect(page.getByTestId("guided-spectra-view")).toBeVisible({ timeout: 10_000 });

    // S1 preserved in Guided mode
    await expect(page.getByTestId("selected-state-inspector")).toContainText("State S1 Inspector");
    await expect(aiContext).toHaveText(/^Water V\d → UV\/Vis → S1$/);
  });
});
