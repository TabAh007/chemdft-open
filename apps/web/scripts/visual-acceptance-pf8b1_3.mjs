import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

const OUTPUT_DIR = "<local-path>/.gemini/antigravity-ide/brain/064ca4d8-a112-4355-9e36-09f696717207/screenshots/pf8b1_3";
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function main() {
  console.log("Starting visual acceptance inspection...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // 1. Dashboard
  console.log("1. Inspecting Project Dashboard...");
  await page.goto("http://127.0.0.1:3000/en/projects", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "01_updated_project_dashboard.png") });
  console.log("Saved: 01_updated_project_dashboard.png");

  // Narrow dashboard
  await page.setViewportSize({ width: 840, height: 800 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "11_responsive_narrow_dashboard.png") });
  console.log("Saved: 11_responsive_narrow_dashboard.png");

  // Reset viewport
  await page.setViewportSize({ width: 1440, height: 900 });

  // 2. Open project workspace
  console.log("2. Navigating to project workspace...");
  const projectId = "4a41918f-7ce3-45a5-8784-c95c8826f0dd";
  await page.goto(`http://127.0.0.1:3000/en/projects/${projectId}/workspace`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Ensure Guided Mode is active
  const guidedToggle = page.getByTestId("mode-toggle-guided");
  if (await guidedToggle.isVisible()) {
    await guidedToggle.click();
    await page.waitForTimeout(800);
  }

  // 2. Guided project overview
  await page.screenshot({ path: path.join(OUTPUT_DIR, "02_guided_project_overview.png") });
  console.log("Saved: 02_guided_project_overview.png");

  // 3. Structure selection
  console.log("3. Inspecting structure geometry...");
  const inspectGeomBtn = page.getByTestId("guided-inspect-geom-btn");
  if (await inspectGeomBtn.isVisible()) {
    await inspectGeomBtn.click();
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: path.join(OUTPUT_DIR, "03_structure_selection.png") });
  console.log("Saved: 03_structure_selection.png");

  // 4. Calculation selection
  console.log("4. Navigating to calculation setup...");
  const breadcrumbLink = page.locator(".guided-breadcrumb-link");
  if (await breadcrumbLink.first().isVisible()) {
    await breadcrumbLink.first().click();
    await page.waitForTimeout(800);
  }

  const goalEnergyBtn = page.getByTestId("guided-goal-energy");
  if (await goalEnergyBtn.isVisible()) {
    await goalEnergyBtn.click();
    await page.waitForTimeout(800);
  } else {
    const primaryActionBtn = page.getByTestId("guided-primary-action-btn");
    if (await primaryActionBtn.isVisible()) {
      await primaryActionBtn.click();
      await page.waitForTimeout(800);
    }
  }

  await page.waitForSelector("[data-testid='guided-calculation-setup']", { timeout: 10000 });
  await page.screenshot({ path: path.join(OUTPUT_DIR, "04_calculation_selection.png") });
  console.log("Saved: 04_calculation_selection.png");

  // 5. PySCF configuration
  console.log("5. Configuring PySCF...");
  const pyscfBtn = page.getByTestId("guided-engine-pyscf-btn");
  if (await pyscfBtn.isVisible()) {
    await pyscfBtn.click();
    await page.waitForTimeout(500);
  }
  // Expand advanced settings
  const advancedSummary = page.locator(".guided-disclosure summary, button.guided-disclosure-summary");
  if (await advancedSummary.first().isVisible()) {
    await advancedSummary.first().click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(OUTPUT_DIR, "05_pyscf_configuration.png") });
  console.log("Saved: 05_pyscf_configuration.png");

  // 6. xTB GFN2 configuration
  console.log("6. Configuring xTB GFN2...");
  const xtbBtn = page.getByTestId("guided-engine-xtb-btn");
  if (await xtbBtn.isVisible()) {
    await xtbBtn.click();
    await page.waitForTimeout(500);
  }
  // Check confirmation box
  const confirmCheck = page.getByTestId("setup-confirm-checkbox");
  if (await confirmCheck.isVisible()) {
    await confirmCheck.check();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(OUTPUT_DIR, "06_xtb_gfn2_configuration.png") });
  console.log("Saved: 06_xtb_gfn2_configuration.png");

  // 7. Running calculation
  console.log("7. Submitting real xTB calculation...");
  const runBtn = page.getByTestId("run-calculation-btn");
  await runBtn.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "07_running_calculation.png") });
  console.log("Saved: 07_running_calculation.png");

  // 8. Authoritative xTB energy result
  console.log("8. Waiting for authoritative result...");
  // Wait up to 25 seconds for calculation to complete and precision plate to show
  try {
    await page.waitForSelector("[data-testid='energy-precision-plate']", { timeout: 25000 });
    await page.waitForTimeout(1000);
  } catch (err) {
    console.log("Plate not visible yet, checking canvas tabs...", err.message);
  }
  await page.screenshot({ path: path.join(OUTPUT_DIR, "08_authoritative_xtb_energy_result.png") });
  console.log("Saved: 08_authoritative_xtb_energy_result.png");

  // 9. AI Scientist collapsed state
  console.log("9. Collapsing context panel / AI Scientist...");
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
    } else {
      const panelToggle = page.locator(".workspace-panel-toggle");
      if (await panelToggle.isVisible()) {
        await panelToggle.click();
        await page.waitForTimeout(600);
      }
    }
  }
  await page.screenshot({ path: path.join(OUTPUT_DIR, "09_ai_scientist_collapsed_state.png") });
  console.log("Saved: 09_ai_scientist_collapsed_state.png");

  // 10. Switch to Advanced Workbench
  console.log("10. Switching to Advanced Workbench...");
  const advToggle = page.getByTestId("mode-toggle-advanced");
  if (await advToggle.isVisible()) {
    await advToggle.click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: path.join(OUTPUT_DIR, "10_advanced_workbench_unchanged.png") });
  console.log("Saved: 10_advanced_workbench_unchanged.png");

  // 12. Narrow viewport workspace
  console.log("11. Capturing responsive narrow viewport workspace...");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "12_responsive_narrow_workspace.png") });
  console.log("Saved: 12_responsive_narrow_workspace.png");

  await browser.close();
  console.log("Visual acceptance completed successfully!");
}

main().catch((err) => {
  console.error("Visual acceptance error:", err);
  process.exit(1);
});
