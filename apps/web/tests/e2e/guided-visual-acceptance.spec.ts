import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { openGuidedElectronicResult, openGuidedStructure, preferGuidedMode, reachGuidedReview } from "./guided-helpers";

/**
 * Guided workspace visual and scientific-presentation acceptance against the real API and database (the disposable
 * evidence stack: genuine stored PySCF results, no worker, no calculation submitted, no AI request).
 *
 * Replaces the earlier walkthrough that targeted the removed empty-project experience, "what ChemDFT found"
 * panel, structure-view action pane and per-result buttons. Every scientific value below is read from the stored
 * result; the values asserted are the ones recorded in the accepted evidence.
 */

const WATER_PROJECT_ID = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";
const OUTPUT_DIR = "../../output/guided-visual-redesign";
const FINAL_DIR = "../../output/guided-visual-redesign/final";

test.describe("ChemDFT Guided Visual Redesign Acceptance", () => {
  test.setTimeout(240_000);

  test("welcome entry, Guided home, structure, electronic results, review, Advanced, responsive, accessibility", async ({ page, request }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("PAGE ERROR LOG:", msg.text());
    });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await preferGuidedMode(page);

    // ---- Screen 1: the entry to a new project is the welcome page; choosing a path creates nothing -------------
    const projectsBefore = ((await (await request.get("/api/chemdft/v1/projects")).json()) as unknown[]).length;
    await page.goto("/en/projects");
    await expect(page.getByText("Loading projects")).toBeHidden({ timeout: 15_000 });
    const newProjectBtn = page.getByTestId("new-project-toggle-btn");
    await expect(newProjectBtn).toBeVisible();
    await newProjectBtn.click();
    await expect(page).toHaveURL(/\/en\/welcome$/);
    await expect(page.getByRole("heading", { name: "Where would you like to begin?" })).toBeVisible();
    for (const path of ["Start with a molecule", "Import a calculation", "Analyze experimental data", "Explore an example project"]) {
      await expect(page.getByText(path, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("Choosing a path creates nothing")).toBeVisible();
    await page.screenshot({ path: `${OUTPUT_DIR}/01-welcome.png` });
    expect(((await (await request.get("/api/chemdft/v1/projects")).json()) as unknown[]).length).toBe(projectsBefore);

    // ---- Screen 2: Guided home of the accepted water project ---------------------------------------------------
    await page.goto(`/en/projects/${WATER_PROJECT_ID}/workspace`);
    const guidedBtn = page.getByTestId("mode-toggle-guided");
    await expect(guidedBtn).toBeVisible({ timeout: 25_000 });
    await expect(guidedBtn).toHaveAttribute("aria-pressed", "true");
    const projectHome = page.getByTestId("guided-project-home");
    await expect(projectHome).toBeVisible({ timeout: 25_000 });
    await expect(projectHome).toContainText(/water/i);
    await expect(projectHome).toContainText("3 atoms");
    await expect(projectHome).toContainText(/recommended next action/i);
    await page.screenshot({ path: `${OUTPUT_DIR}/05-project-home.png` });
    await page.screenshot({ path: `${FINAL_DIR}/05-project-home.png` });

    // ---- Screen 3: Structure stage -----------------------------------------------------------------------------
    await openGuidedStructure(page, WATER_PROJECT_ID);
    const structureView = page.getByTestId("guided-structure-view");
    await expect(structureView).toContainText(/water.*v\d/i);
    await expect(structureView).toContainText("Atoms3");
    await expect(structureView).toContainText("Imported coordinate file");
    // The formula is derived from the atoms, never taken from the structure title
    const formula = structureView.locator("dt:has-text('Formula') + dd");
    await expect(formula).toHaveText("H₂O");
    await expect(formula).not.toHaveText("TEST USER-SUPPLIED WATER GEOMETRY");
    // An import is not a scientific review
    await expect(page.getByTestId("structure-review-state")).toContainText("Not reviewed");
    // Raw inspector tabs belong to Advanced
    await expect(page.locator(".dock-tabs")).toBeHidden();
    await page.screenshot({ path: `${OUTPUT_DIR}/06-structure.png` });
    await page.screenshot({ path: `${FINAL_DIR}/06-structure.png` });

    // ---- Screen 4: the published electronic-structure result (orbitals, density, ESP) --------------------------
    await openGuidedElectronicResult(page);
    const resultView = page.getByTestId("guided-result-view");
    await expect(resultView).toContainText("Electronic structure");
    await expect(resultView).toContainText("HF / STO-3G");

    // One authoritative total energy (-74.962928 Eh) with its deterministic eV conversion
    const totalEnergy = resultView.locator(".guided-metric-card:has-text('Total Energy')");
    await expect(totalEnergy).toContainText("-74.962928");
    await expect(totalEnergy).toContainText("-2039.85 eV");
    await expect(totalEnergy).not.toContainText("-74.962949");
    // Orbital numbering is 1-based and consistent
    await expect(resultView.locator(".guided-metric-card:has-text('HOMO Energy')")).toContainText("Orbital 5 (Occupied)");
    await expect(resultView.locator(".guided-metric-card:has-text('LUMO Energy')")).toContainText("Orbital 6 (Unoccupied)");
    await page.screenshot({ path: `${OUTPUT_DIR}/07-electronic-structure.png` });
    await page.screenshot({ path: `${FINAL_DIR}/07-electronic-structure.png` });

    const moTab = page.getByTestId("tab-molecular-orbitals");
    await expect(moTab).toHaveClass(/active/);
    await page.screenshot({ path: `${OUTPUT_DIR}/08-mo.png` });

    const densityTab = page.getByTestId("tab-electron-density");
    await densityTab.click();
    await expect(densityTab).toHaveClass(/active/);
    await expect(resultView).toContainText("Electron Density");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUTPUT_DIR}/09-density.png` });

    const espTab = page.getByTestId("tab-electrostatic-potential");
    await espTab.click();
    await expect(espTab).toHaveClass(/active/);
    await expect(resultView).toContainText("Electrostatic Potential (ESP)");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUTPUT_DIR}/10-esp.png` });

    for (const width of [1440, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      const box = await resultView.locator(".guided-3d-canvas-wrap").boundingBox();
      expect(box).toBeTruthy();
      expect(box!.height).toBeGreaterThanOrEqual(440);
    }
    await page.setViewportSize({ width: 1600, height: 1000 });

    // ---- Screen 5: AI Scientist is a docked panel scoped to this project (nothing is asked) -------------------
    const aiPanel = page.getByTestId("ai-scientist-panel");
    if (!(await aiPanel.isVisible())) await page.getByTestId("ai-dock-toggle").click();
    await expect(aiPanel).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("ai-current-context-header")).toContainText(/water/i);
    await page.screenshot({ path: `${OUTPUT_DIR}/11-ai-idle.png` });

    // ---- Screen 6: Configure → Review & Submit for a geometry optimization; stop before submission -----------
    await reachGuidedReview(page, "Geometry optimization");
    const review = page.getByTestId("guided-review-stage");
    await expect(review).toContainText(/geometry optimization/i);
    await expect(page.getByTestId("review-configuration")).toBeVisible();
    await expect(page.getByTestId("review-checks")).toBeVisible();
    // Submitting needs the researcher's explicit confirmation; this run never confirms or submits
    const runBtn = page.getByTestId("run-calculation-btn");
    await expect(runBtn).toBeDisabled();
    await expect(page.getByTestId("setup-confirm-checkbox")).not.toBeChecked();
    await page.screenshot({ path: `${OUTPUT_DIR}/15-review.png` });
    await page.screenshot({ path: `${FINAL_DIR}/15-review.png` });

    // ---- Guided ↔ Advanced ------------------------------------------------------------------------------------
    await page.getByTestId("mode-toggle-advanced").click();
    await expect(page.getByTestId("project-explorer-panel")).toBeVisible();
    await expect(page.locator(".dock-tabs")).toBeVisible();
    await page.screenshot({ path: `${OUTPUT_DIR}/17-advanced-workbench.png` });

    // Returning to Guided starts from the Guided home; the Configure/Review draft survives the mode switch
    await page.getByTestId("mode-toggle-guided").click();
    await page.getByTestId("guided-nav-calculations").click();
    await expect(page.getByTestId("guided-workspace")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("guided-stage-configure").click();
    await expect(page.getByTestId("guided-family")).toHaveValue(/opt/i);
    await page.getByTestId("guided-stage-review").click();
    await expect(page.getByTestId("guided-review-stage")).toBeVisible();
    await expect(page.getByTestId("run-calculation-btn")).toBeDisabled();

    // ---- Responsive and accessibility -------------------------------------------------------------------------
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUTPUT_DIR}/18-responsive-1024.png` });
    await page.screenshot({ path: `${FINAL_DIR}/18-responsive-1024.png` });

    await page.evaluate(axe.source);
    const axeResults = await page.evaluate(async () => {
      return await (window as unknown as { axe: typeof axe }).axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
    });
    console.log(`[A11y Audit] Total violations: ${axeResults.violations.length}`);
    for (const violation of axeResults.violations) {
      console.log(`- [${violation.impact}] ${violation.id}: ${violation.description}`);
      for (const node of violation.nodes) console.log(`  target: ${node.target.join(", ")} | html: ${node.html}`);
    }
    expect(axeResults.violations.filter((v: axe.Result) => v.impact === "critical").length).toBe(0);
  });
});
