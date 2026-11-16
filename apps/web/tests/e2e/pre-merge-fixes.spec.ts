import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const OUTPUT_DIR = path.resolve(process.cwd(), "../../output/pre-merge-visualization-fixes");

const WATER_PROJECT_ID = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";
const CHROMIUM_PROJECT_ID = "7ae7e41b-2483-42c3-823e-42dd1b9fa72f";
const PHASE7_PROJECT_ID = "3606543b-cee0-47fa-b000-ec06645549c4";
const PHASE7_REVIEW_ID = "b4c43287-48aa-4dd0-9c13-1ecec8c389cf";

test.describe("Pre-Merge Visualization Fixes Acceptance", () => {
  test.setTimeout(180_000);

  test("captures all 6 acceptance screenshots and verifies project context isolation", async ({ page }) => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // =========================================================================
    // CHECK 1 & 2: ADVANCED TOOLBAR (1600px & 1024px)
    // =========================================================================
    await page.setViewportSize({ width: 1600, height: 1000 });

    // Set advanced mode
    await page.addInitScript(() => {
      localStorage.setItem("chemdft:workspace-mode", "advanced");
    });

    await page.goto(`/en/projects/${WATER_PROJECT_ID}/workspace`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Switch to advanced if still in guided
    const toggleBtn = page.getByTestId("workspace-mode-toggle");
    if (await toggleBtn.isVisible()) {
      const text = await toggleBtn.textContent();
      if (text?.includes("Advanced")) {
        await toggleBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    // If Project tab is present, click it to show main project visualization
    const projectTab = page.getByRole("tab", { name: "Project" });
    if (await projectTab.isVisible()) {
      await projectTab.click();
      await page.waitForTimeout(1000);
    }

    const vizPane = page.locator(".visualization-pane");
    await expect(vizPane).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);

    // Capture 01-advanced-toolbar-1600.png
    const shot1 = path.join(OUTPUT_DIR, "01-advanced-toolbar-1600.png");
    await page.screenshot({ path: shot1 });
    console.log(`Saved: ${shot1}`);

    // Resize to 1024x900 for 02-advanced-toolbar-1024.png
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(1000);
    const shot2 = path.join(OUTPUT_DIR, "02-advanced-toolbar-1024.png");
    await page.screenshot({ path: shot2 });
    console.log(`Saved: ${shot2}`);

    // Return to 1600x1000
    await page.setViewportSize({ width: 1600, height: 1000 });

    // =========================================================================
    // CHECK 1: AI SCIENTIST CONTEXT ISOLATION
    // =========================================================================
    // Ensure AI Scientist panel is open in Water project
    const aiTabBtn = page.getByRole("tab", { name: "AI Scientist" });
    if (await aiTabBtn.isVisible()) {
      await aiTabBtn.click();
      await page.waitForTimeout(1000);
    } else {
      const openAiBtn = page.locator("button:has-text('Open AI Scientist')");
      if (await openAiBtn.isVisible()) {
        await openAiBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    const aiHeaderWater = page.getByTestId("ai-current-view");
    await expect(aiHeaderWater).toBeVisible({ timeout: 10_000 });
    const waterContextText = await aiHeaderWater.textContent();
    console.log("Water AI Context:", waterContextText);

    const shot3 = path.join(OUTPUT_DIR, "03-water-ai-context.png");
    await page.screenshot({ path: shot3 });
    console.log(`Saved: ${shot3}`);

    // Navigate to Chromium project
    console.log("Navigating to Chromium project...");
    await page.goto(`/en/projects/${CHROMIUM_PROJECT_ID}/workspace`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const aiHeaderChromium = page.getByTestId("ai-current-view");
    await expect(aiHeaderChromium).toBeVisible({ timeout: 10_000 });
    const chromiumContextText = await aiHeaderChromium.textContent();
    console.log("Chromium AI Context:", chromiumContextText);
    expect(chromiumContextText).not.toContain("Water");

    const shot4 = path.join(OUTPUT_DIR, "04-chromium-ai-context.png");
    await page.screenshot({ path: shot4 });
    console.log(`Saved: ${shot4}`);

    // Navigate to Phase 7 Local Walkthrough
    console.log("Navigating to Phase 7 Local Walkthrough...");
    await page.goto(`/en/projects/${PHASE7_PROJECT_ID}/workspace`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const aiHeaderPhase7 = page.getByTestId("ai-current-view");
    await expect(aiHeaderPhase7).toBeVisible({ timeout: 10_000 });
    const phase7ContextText = await aiHeaderPhase7.textContent();
    console.log("Phase 7 Local Walkthrough AI Context:", phase7ContextText);
    expect(phase7ContextText).not.toContain("Water");
    expect(phase7ContextText).not.toContain("Chromium");

    const shot5 = path.join(OUTPUT_DIR, "05-phase7-ai-context.png");
    await page.screenshot({ path: shot5 });
    console.log(`Saved: ${shot5}`);

    // Navigate to Phase 7 review
    console.log("Navigating to Phase 7 review...");
    await page.goto(`/en/projects/${PHASE7_REVIEW_ID}/workspace`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const aiHeaderPhase7Review = page.getByTestId("ai-current-view");
    await expect(aiHeaderPhase7Review).toBeVisible({ timeout: 10_000 });
    const phase7ReviewContextText = await aiHeaderPhase7Review.textContent();
    console.log("Phase 7 review AI Context:", phase7ReviewContextText);
    expect(phase7ReviewContextText).not.toContain("Water");
    expect(phase7ReviewContextText).not.toContain("Chromium");

    // =========================================================================
    // CHECK 3: DENSITY ISOVALUE / UNIT PRESENTATION
    // =========================================================================
    await page.goto(`/en/projects/${WATER_PROJECT_ID}/workspace`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);

    const guidedToggle = page.getByTestId("mode-toggle-guided");
    if (await guidedToggle.isVisible()) {
      await guidedToggle.click();
      await page.waitForTimeout(1000);
    }

    // The Results group of the Guided navigation opens the newest published energy result; the molecular-orbital /
    // density view belongs to the published "Electronic structure" result, which the researcher picks explicitly.
    await page.getByTestId("guided-nav-electronic").click();
    const picker = page.getByLabel("Published result");
    const electronicLabel = (await picker.locator("option").allTextContents()).find((label) => label.startsWith("Electronic structure"));
    expect(electronicLabel, "the evidence project publishes an Electronic structure result").toBeTruthy();
    await picker.selectOption({ label: electronicLabel! });

    await expect(page.getByTestId("guided-result-view")).toBeVisible({ timeout: 20_000 });
    const densityTab = page.getByTestId("tab-electron-density");
    await expect(densityTab).toBeVisible({ timeout: 10_000 });
    await densityTab.click();
    await page.waitForTimeout(2000);

    const isoInput = page.locator("#guided-isovalue-control");
    const isoUnit = page.locator(".electronic-isovalue-controls label span");
    await expect(isoInput).toBeVisible({ timeout: 15_000 });
    const isovalue = await isoInput.inputValue();
    const unitText = await isoUnit.textContent();
    console.log(`EXACT DISPLAYED ISOVALUE: ${isovalue}`);
    console.log(`EXACT DISPLAYED UNIT: ${unitText}`);
    expect(isovalue).toBe("0.001");
    expect(unitText?.trim()).toBe("e/a₀³");

    const shot6 = path.join(OUTPUT_DIR, "06-density-isovalue.png");
    await page.screenshot({ path: shot6 });
    console.log(`Saved: ${shot6}`);
  });
});
