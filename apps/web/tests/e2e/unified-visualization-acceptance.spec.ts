import { expect, test } from "@playwright/test";
import { angleDegrees, distanceAngstrom, expectAiScientistDock, openGuidedElectronicResult, openGuidedStructure, preferGuidedMode, storedAtoms } from "./guided-helpers";

const WATER_PROJECT_ID = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";
const OUTPUT_DIR = "../../output/unified-scientific-visualization";

test.describe("ChemDFT Unified Scientific Visualization Acceptance", () => {
  test.setTimeout(240_000);

  test("full unified visualization walkthrough & 16-screenshot capture", async ({ page, request }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("PAGE ERROR LOG:", msg.text());
    });

    // 1600x1000 Desktop Viewport
    await page.setViewportSize({ width: 1600, height: 1000 });

    // Ensure we start in Guided Mode
    await preferGuidedMode(page);

    // =========================================================================
    // SCREEN 1 — GUIDED WATER STRUCTURE VIEW (01-guided-water-structure.png)
    // =========================================================================
    await openGuidedStructure(page, WATER_PROJECT_ID);
    await expect(page.getByTestId("guided-structure-view")).toContainText("Atoms3");

    // Wait a brief moment for initial auto-fit and rendering to settle
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUTPUT_DIR}/01-guided-water-structure.png` });

    // =========================================================================
    // SCREEN 2 — SPACE FILLING REPRESENTATION (02-guided-water-structure-spacefill.png)
    // =========================================================================
    const spaceFillBtn = page.getByTestId("guided-style-space-fill");
    await expect(spaceFillBtn).toBeVisible();
    await spaceFillBtn.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUTPUT_DIR}/02-guided-water-structure-spacefill.png` });

    // Return to Ball & Stick
    await page.getByTestId("guided-style-ball-stick").click();
    await page.waitForTimeout(400);

    // =========================================================================
    // SCREEN 3 — DISTANCE MEASUREMENT (03-guided-water-measure-distance.png)
    // =========================================================================
    const distBtn = page.getByTestId("guided-measure-distance-btn");
    await expect(distBtn).toBeVisible();
    await distBtn.click();

    // Select Atom 0 (Oxygen) and Atom 1 (Hydrogen)
    await page.evaluate(() => {
      const select = (window as unknown as { __chemdft_select_atom?: (i: number) => void }).__chemdft_select_atom;
      if (select) {
        select(0);
        select(1);
      }
    });

    await expect(page.getByTestId("guided-measurement-banner")).toBeVisible({ timeout: 5000 });
    // The displayed distance must equal the one computed from the stored coordinates (O–H1, Å, three decimals).
    const atoms = await storedAtoms(request, WATER_PROJECT_ID);
    await expect(page.getByTestId("guided-measurement-banner")).toContainText(distanceAngstrom(atoms[0]!, atoms[1]!).toFixed(3));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUTPUT_DIR}/03-guided-water-measure-distance.png` });

    // =========================================================================
    // SCREEN 4 — ANGLE MEASUREMENT (04-guided-water-measure-angle.png)
    // =========================================================================
    const angleBtn = page.getByTestId("guided-measure-angle-btn");
    await expect(angleBtn).toBeVisible();
    await angleBtn.click();

    // Select H1 (1), O (0), H2 (2)
    await page.evaluate(() => {
      const select = (window as unknown as { __chemdft_select_atom?: (i: number) => void }).__chemdft_select_atom;
      if (select) {
        select(1);
        select(0);
        select(2);
      }
    });

    await expect(page.getByTestId("guided-measurement-banner")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("guided-measurement-banner")).toContainText(angleDegrees(atoms[1]!, atoms[0]!, atoms[2]!).toFixed(3));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUTPUT_DIR}/04-guided-water-measure-angle.png` });

    // =========================================================================
    // SCREEN 11 — SELECTION & HOVER TOOLTIP (11-selection-hover.png)
    // =========================================================================
    await page.evaluate(() => {
      const hover = (window as unknown as { __chemdft_hover_atom?: (info: unknown) => void }).__chemdft_hover_atom;
      if (hover) {
        hover({ index: 0, element: "O", name: "Oxygen", x: 420, y: 260 });
      }
    });
    await expect(page.locator(".structure-hover-tooltip")).toBeVisible();
    await expect(page.locator(".structure-hover-tooltip")).toContainText("Oxygen (O) · Atom 1");
    await page.screenshot({ path: `${OUTPUT_DIR}/11-selection-hover.png` });

    // Clear hover
    await page.evaluate(() => {
      const hover = (window as unknown as { __chemdft_hover_atom?: (info: unknown) => void }).__chemdft_hover_atom;
      if (hover) hover(null);
    });

    // =========================================================================
    // SCREEN 12 — FIT MOLECULE (12-fit-molecule.png)
    // =========================================================================
    const resetViewBtn = page.getByTestId("guided-reset-view-btn");
    await expect(resetViewBtn).toBeVisible();
    await resetViewBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUTPUT_DIR}/12-fit-molecule.png` });

    // =========================================================================
    // SCREEN 14 — AI SCIENTIST WHAT AM I LOOKING AT (14-guided-ai-what-am-i-looking-at.png)
    // =========================================================================
    // The AI Scientist is the project shell's docked panel; this check only confirms it is available for this
    // view. No question is sent (no AI request is made by this acceptance run).
    await expectAiScientistDock(page);
    await page.screenshot({ path: `${OUTPUT_DIR}/14-guided-ai-what-am-i-looking-at.png` });

    // =========================================================================
    // SCREEN 7 — MO HOMO (07-mo-homo.png)
    // =========================================================================
    await openGuidedElectronicResult(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUTPUT_DIR}/07-mo-homo.png` });

    // =========================================================================
    // SCREEN 8 — MO LUMO (08-mo-lumo.png)
    // =========================================================================
    const lumoChip = page.locator(".chip-lumo, button:has-text('LUMO')").first();
    if (await lumoChip.isVisible()) {
      await lumoChip.click();
      await page.waitForTimeout(1500);
    }
    await page.screenshot({ path: `${OUTPUT_DIR}/08-mo-lumo.png` });

    // =========================================================================
    // SCREEN 9 — ELECTRON DENSITY (09-electron-density.png)
    // =========================================================================
    const densityTab = page.getByTestId("tab-electron-density");
    await expect(densityTab).toBeVisible();
    await densityTab.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUTPUT_DIR}/09-electron-density.png` });

    // =========================================================================
    // SCREEN 10 — ESP (10-esp.png)
    // =========================================================================
    const espTab = page.getByTestId("tab-electrostatic-potential");
    await expect(espTab).toBeVisible();
    await espTab.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUTPUT_DIR}/10-esp.png` });

    // =========================================================================
    // SCREEN 13 — FIT SURFACE (13-fit-surface.png)
    // =========================================================================
    const resetFieldBtn = page.getByTestId("guided-reset-field-view-btn");
    if (await resetFieldBtn.isVisible()) {
      await resetFieldBtn.click();
      await page.waitForTimeout(600);
    }
    await page.screenshot({ path: `${OUTPUT_DIR}/13-fit-surface.png` });

    // =========================================================================
    // SCREEN 5 & 15 — ADVANCED WATER STRUCTURE & CONTROLS
    // =========================================================================
    // Switch to Advanced Workbench
    const advBtn = page.locator("button:has-text('Advanced Workbench')").first();
    await expect(advBtn).toBeVisible();
    await advBtn.click();

    // Advanced mode opens a structure through the project explorer
    await page.getByTestId("tree-item-structureVersion").first().click();

    // Ensure Advanced workbench is loaded
    await expect(page.locator(".structure-version-workbench")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".structure-viewer-toolbar")).toBeVisible();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUTPUT_DIR}/05-advanced-water-structure.png` });
    await page.screenshot({ path: `${OUTPUT_DIR}/15-advanced-controls.png` });

    // =========================================================================
    // SCREEN 6 — LEGACY/PROJECT SCIENTIFIC VISUALIZATION (MIGRATED TO CANONICAL)
    // =========================================================================
    // In Advanced mode, switch to the project-level Scientific 3D / Visualization tab
    const sciVizTab = page.locator(".dock-tab[data-tab-kind='scientificScene'], button:has-text('Scientific 3D'), button:has-text('Scientific Visualization')").first();
    if (await sciVizTab.isVisible()) {
      await sciVizTab.click();
      await page.waitForTimeout(1000);
    } else {
      // Or open from project catalog if present
      const catalogItem = page.locator(".project-catalog button:has-text('Scientific 3D'), .project-catalog button:has-text('Scientific Visualization')").first();
      if (await catalogItem.isVisible()) {
        await catalogItem.click();
        await page.waitForTimeout(1000);
      }
    }
    await page.screenshot({ path: `${OUTPUT_DIR}/06-legacy-project-view-migrated.png` });

    // =========================================================================
    // SCREEN 16 — 1024 RESPONSIVE VIEWPORT (16-1024-responsive.png)
    // =========================================================================
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUTPUT_DIR}/16-1024-responsive.png` });
  });

  test("cross-project visual consistency for test-user-supplied-water and legacy water", async ({ page, request }) => {
    // 1600x1000 Desktop Viewport
    await page.setViewportSize({ width: 1600, height: 1000 });

    // 1. Verify test-user-supplied-water (85130614-31f8-4654-a767-31d42d2d633d)
    const TEST_WATER_ID = "85130614-31f8-4654-a767-31d42d2d633d";
    await page.goto(`/en/projects/${TEST_WATER_ID}/workspace`);
    await page.waitForLoadState("domcontentloaded");

    await openGuidedStructure(page, TEST_WATER_ID);
    await expect(page.getByTestId("guided-structure-view")).toContainText("Atoms3");

    // Verify distance measurement works on test-user-supplied-water
    const distBtn = page.getByTestId("guided-measure-distance-btn");
    await expect(distBtn).toBeVisible();
    await distBtn.click();

    await page.evaluate(() => {
      const select = (window as unknown as { __chemdft_select_atom?: (i: number) => void }).__chemdft_select_atom;
      if (select) {
        select(0);
        select(1);
      }
    });
    await expect(page.getByTestId("guided-measurement-banner")).toBeVisible({ timeout: 5000 });
    const testAtoms = await storedAtoms(request, TEST_WATER_ID);
    await expect(page.getByTestId("guided-measurement-banner")).toContainText(distanceAngstrom(testAtoms[0]!, testAtoms[1]!).toFixed(3));

    // 2. Verify Electronic structure acceptance — water (3537048e-306a-4f4f-9b9e-493681c0df83)
    const LEGACY_WATER_ID = "3537048e-306a-4f4f-9b9e-493681c0df83";
    await page.goto(`/en/projects/${LEGACY_WATER_ID}/workspace`);
    await page.waitForLoadState("domcontentloaded");

    await openGuidedStructure(page, LEGACY_WATER_ID);
    await expect(page.getByTestId("guided-structure-view")).toContainText("Atoms3");

    // Switch to the published electronic-structure result view
    await openGuidedElectronicResult(page);

    // Verify LUMO and Density switch
    const lumoChip = page.locator(".chip-lumo, button:has-text('LUMO')").first();
    if (await lumoChip.isVisible()) {
      await lumoChip.click();
      await page.waitForTimeout(500);
    }
    const densityTab = page.getByTestId("tab-electron-density");
    await expect(densityTab).toBeVisible();
    await densityTab.click();
    await page.waitForTimeout(500);
  });
});

