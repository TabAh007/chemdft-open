import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

const OUTPUT_DIR = "<local-path>/.gemini/antigravity-ide/brain/064ca4d8-a112-4355-9e36-09f696717207/screenshots/pf8b1_3_nav_correction";
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function main() {
  console.log("Starting Navigation Correction Visual Acceptance...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const projectId = "4a41918f-7ce3-45a5-8784-c95c8826f0dd";
  console.log(`Navigating to project ${projectId} workspace...`);
  await page.goto(`http://127.0.0.1:3000/en/projects/${projectId}/workspace`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Ensure Guided Mode is active
  const guidedToggle = page.getByTestId("mode-toggle-guided");
  if (await guidedToggle.isVisible()) {
    await guidedToggle.click();
    await page.waitForTimeout(800);
  }

  // Ensure on home/overview
  const navOverview = page.getByTestId("guided-nav-overview");
  if (await navOverview.isVisible()) {
    await navOverview.click();
    await page.waitForTimeout(800);
  }

  // 1. Overview with new navigation
  console.log("1. Capturing Overview with new navigation...");
  await page.screenshot({ path: path.join(OUTPUT_DIR, "01_overview_new_navigation.png") });
  console.log("Saved: 01_overview_new_navigation.png");

  // 2. Structure workspace
  console.log("2. Navigating to Structures via left navigation...");
  const navStructure = page.getByTestId("guided-nav-structure");
  await navStructure.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "02_structure_workspace.png") });
  console.log("Saved: 02_structure_workspace.png");

  // 3. Calculation setup
  console.log("3. Navigating to Calculations via left navigation...");
  const navCalculations = page.getByTestId("guided-nav-calculations");
  await navCalculations.click();
  await page.waitForTimeout(1000);
  await page.waitForSelector("[data-testid='guided-calculation-setup']", { timeout: 10000 });
  await page.screenshot({ path: path.join(OUTPUT_DIR, "03_calculation_setup.png") });
  console.log("Saved: 03_calculation_setup.png");

  // 4. Energy results
  console.log("4. Navigating to Results via left navigation...");
  const navResults = page.getByTestId("guided-nav-results");
  if (await navResults.isVisible()) {
    await navResults.click();
    await page.waitForTimeout(1200);
  } else {
    // If electronic subitem directly visible
    const navElectronic = page.getByTestId("guided-nav-electronic");
    if (await navElectronic.isVisible()) {
      await navElectronic.click();
      await page.waitForTimeout(1200);
    }
  }
  await page.screenshot({ path: path.join(OUTPUT_DIR, "04_energy_results.png") });
  console.log("Saved: 04_energy_results.png");

  // 4b. Files & Data workspace
  console.log("4b. Navigating to Files & Data via left navigation...");
  const navImported = page.getByTestId("guided-nav-imported");
  if (await navImported.isVisible()) {
    await navImported.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "08_files_and_data_workspace.png") });
    console.log("Saved: 08_files_and_data_workspace.png");
  }

  // 5. Collapsed AI Scientist
  console.log("5. Collapsing AI Scientist dock...");
  const dockCloseBtn = page.locator(".dock-close-button, button:has-text('✕')");
  if (await dockCloseBtn.first().isVisible()) {
    await dockCloseBtn.first().click();
    await page.waitForTimeout(600);
  } else {
    const aiToggle = page.getByTestId("ai-dock-toggle");
    if (await aiToggle.isVisible()) {
      const isPressed = await aiToggle.getAttribute("aria-pressed");
      if (isPressed === "true") {
        await aiToggle.click();
        await page.waitForTimeout(600);
      }
    }
  }
  await page.screenshot({ path: path.join(OUTPUT_DIR, "05_collapsed_ai_scientist.png") });
  console.log("Saved: 05_collapsed_ai_scientist.png");

  // 6. Narrow viewport
  console.log("6. Testing responsive narrow viewport (1000px)...");
  await page.setViewportSize({ width: 1000, height: 750 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "06_narrow_viewport.png") });
  console.log("Saved: 06_narrow_viewport.png");

  // 7. Advanced Workbench regression check
  console.log("7. Switching to Advanced Workbench regression check...");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  const advToggle = page.getByTestId("mode-toggle-advanced");
  if (await advToggle.isVisible()) {
    await advToggle.click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: path.join(OUTPUT_DIR, "07_advanced_workbench_regression.png") });
  console.log("Saved: 07_advanced_workbench_regression.png");

  await browser.close();
  console.log("Navigation correction visual acceptance completed successfully!");
}

main().catch((err) => {
  console.error("Visual acceptance error:", err);
  process.exit(1);
});
