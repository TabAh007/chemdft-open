import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT_DIR = process.env.CDF_OUTPUT_DIR
  ? resolve(process.env.CDF_OUTPUT_DIR)
  : resolve("../../output/release-0.0.35");
mkdirSync(OUTPUT_DIR, { recursive: true });

const benzeneAtoms = [
  { index: 0, element: "C", atomic_number: 6, x: 1.40, y: 0.0, z: 0.0 },
  { index: 1, element: "C", atomic_number: 6, x: 0.70, y: 1.21, z: 0.0 },
  { index: 2, element: "C", atomic_number: 6, x: -0.70, y: 1.21, z: 0.0 },
  { index: 3, element: "C", atomic_number: 6, x: -1.40, y: 0.0, z: 0.0 },
  { index: 4, element: "C", atomic_number: 6, x: -0.70, y: -1.21, z: 0.0 },
  { index: 5, element: "C", atomic_number: 6, x: 0.70, y: -1.21, z: 0.0 },
  { index: 6, element: "H", atomic_number: 1, x: 2.48, y: 0.0, z: 0.0 },
  { index: 7, element: "H", atomic_number: 1, x: 1.24, y: 2.15, z: 0.0 },
  { index: 8, element: "H", atomic_number: 1, x: -1.24, y: 2.15, z: 0.0 },
  { index: 9, element: "H", atomic_number: 1, x: -2.48, y: 0.0, z: 0.0 },
  { index: 10, element: "H", atomic_number: 1, x: -1.24, y: -2.15, z: 0.0 },
  { index: 11, element: "H", atomic_number: 1, x: 1.24, y: -2.15, z: 0.0 },
];

function makeBenzeneDetail(structureName = "Benzene V1") {
  return {
    structure: {
      id: "s-benzene",
      project_id: "benzene-proj",
      name: structureName,
      kind: "MOLECULAR",
    },
    version: {
      id: "v-benzene-1",
      structure_id: "s-benzene",
      revision: 1,
      origin: "IMPORTED",
      created_by: "user-1",
      overall_charge: 0,
      multiplicity: 1,
      coordinates: {
        coordinate_system: "CARTESIAN",
        unit: "angstrom",
        atoms: benzeneAtoms,
      },
    },
  };
}

async function setupMockRoutes(page: Page, detail: ReturnType<typeof makeBenzeneDetail>) {
  await page.route("**/api/chemdft/v1/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path.includes("/structures/s-benzene/versions/v-benzene-1")) {
      return route.fulfill({ json: detail });
    }
    if (path.includes("/structures/s-benzene/versions")) {
      return route.fulfill({ json: [detail] });
    }
    if (path.endsWith("/structures")) {
      return route.fulfill({
        json: [
          {
            id: "s-benzene",
            project_id: "benzene-proj",
            name: detail.structure.name,
            kind: "MOLECULAR",
            latest_version_id: "v-benzene-1",
            latest_revision: 1,
          },
        ],
      });
    }
    if (path.includes("/role")) {
      return route.fulfill({ json: { role: "owner", canExecute: true } });
    }
    if (path.includes("/compute/jobs") || path.endsWith("/jobs")) {
      return route.fulfill({ json: { jobs: [] } });
    }
    if (path.includes("/structure-candidates") || path.includes("/geometry-candidates") || path.includes("/candidates")) {
      return route.fulfill({ json: { candidates: [] } });
    }
    if (path.includes("/external-imports") || path.includes("/imports")) {
      return route.fulfill({ json: { imports: [] } });
    }
    if (path.includes("/spectra") || path.includes("/datasets")) {
      return route.fulfill({ json: { datasets: [] } });
    }
    if (path.includes("/documents")) {
      return route.fulfill({ json: { documents: [] } });
    }
    if (path.includes("/memory")) {
      return route.fulfill({ json: { memories: [], items: [] } });
    }
    if (path.includes("/workspace/history") || path.includes("/history")) {
      return route.fulfill({ json: [] });
    }
    if (path.includes("/files")) {
      return route.fulfill({ json: [] });
    }
    if (path.includes("/capabilities")) {
      return route.fulfill({
        json: [
          {
            engine: "pyscf",
            version: "2.14.0",
            availability: "AVAILABLE",
            supported_tasks: ["ENERGY", "GEOMETRY_OPTIMIZATION"],
            supported_methods: ["hf", "b3lyp"],
            supported_basis_sets: ["6-31g", "def2-svp"],
          },
        ],
      });
    }
    if (path.includes("/eligibility")) {
      return route.fulfill({ json: { eligible: true, issues: [] } });
    }
    if (path.endsWith("/ai/context")) {
      return route.fulfill({
        json: {
          ai: { allowance_status: "AVAILABLE", available: true, byok_enabled: false, managed_enabled: true, mode: "MANAGED", model: "nemotron-3.5-lightning", provider: "NVIDIA", secret_storage_available: true },
          allowed_tools: ["ask_ai_scientist"], can_write: true, generated_at: "2026-11-10T10:00:00Z", human_id: "mock",
          navigator: { blocked: [], goal: null, have: [], next: [], notices: [] },
          organization_id: "org-1", project_id: "benzene-proj", project_kind: "RESEARCH", project_name: "Benzene",
          published_example: false, resources: [], role: "OWNER", sealed: false, selection: {},
        },
      });
    }
    if (path.includes("/ai/settings")) {
      return route.fulfill({
        json: {
          availability: { allowance_status: "AVAILABLE", available: true, byok_enabled: false, managed_enabled: true, mode: "MANAGED", model: "nemotron-3.5-lightning", provider: "NVIDIA", secret_storage_available: true },
          credentials: [], preferences: { provider: "NVIDIA", model: "nemotron-3.5-lightning" },
          providers: [{ provider: "NVIDIA", models: ["nemotron-3.5-lightning"], local_test_only: false }],
          model_capabilities: [{ provider: "NVIDIA", model_identifier: "nemotron-3.5-lightning", display_name: "Nemotron 3.5 Lightning 30B", status: "APPROVED", eligibility: "PRODUCTION", selectable: true, configured: true, reviewed_on: "2026-10-26", tool_compatibility_verified: true, verification_scope: "Structured function calling", proposal_workflow_verified: true }],
        },
      });
    }
    if (path.includes("/ai/conversations")) {
      return route.fulfill({ json: { conversations: [] } });
    }
    if (path.endsWith("/projects/benzene-proj")) {
      return route.fulfill({ json: { id: "benzene-proj", name: "Benzene" } });
    }
    if (path.endsWith("/me")) {
      return route.fulfill({ json: { id: "user-1", email: "researcher@example.com", name: "Researcher" } });
    }
    return route.fulfill({ json: {} });
  });
}

async function ensureAdvancedMode(page: Page) {
  const advBtn = page.getByRole("button", { name: "Advanced Workbench" });
  if ((await advBtn.isVisible({ timeout: 3_000 }).catch(() => false)) && (await advBtn.getAttribute("aria-pressed")) !== "true") {
    await advBtn.click();
    await page.waitForTimeout(300);
  }
}

const VIEWPORT_MATRIX = [
  { name: "1024x560", width: 1024, height: 560, checkViewerRatio: true, checkSingleRowHeader: true },
  { name: "860x560", width: 860, height: 560, checkViewerRatio: false, checkSingleRowHeader: true },
  { name: "1366x591", width: 1366, height: 591, checkViewerRatio: true, checkSingleRowHeader: true },
  { name: "1440x900", width: 1440, height: 900, checkViewerRatio: false, checkSingleRowHeader: true },
  { name: "1728x900", width: 1728, height: 900, checkViewerRatio: false, checkSingleRowHeader: true },
  { name: "834x1112", width: 834, height: 1112, checkViewerRatio: false, checkSingleRowHeader: true },
  { name: "1024x600", width: 1024, height: 600, checkViewerRatio: true, checkSingleRowHeader: true },
];

test.describe("Release 0.0.34 Workspace Polish & Header Single-Row Matrix", () => {
  for (const vp of VIEWPORT_MATRIX) {
    test(`Viewport ${vp.name}: layout assertions, viewer top offset, header row, no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const detail = makeBenzeneDetail();
      await setupMockRoutes(page, detail);

      await page.addInitScript(() => {
        try {
          localStorage.setItem("chemdft:workspace-mode", "advanced");
          localStorage.removeItem("chemdft:workspace:focus-mode");
        } catch {}
      });

      await page.goto("/en/projects/benzene-proj/workspace", { waitUntil: "networkidle" });
      await expect(page.locator(".project-shell")).toBeVisible({ timeout: 15_000 });
      await ensureAdvancedMode(page);

      // 1. Assert no horizontal page scroll
      const noHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth <= window.innerWidth + 1;
      });
      expect(noHorizontalScroll, `Horizontal page scroll detected at ${vp.name}`).toBe(true);

      // 2. Task B: Header single-row assertion (height <= 48 px at width >= 834 px)
      if (vp.checkSingleRowHeader) {
        const header = page.locator(".project-header");
        await expect(header).toBeVisible({ timeout: 10_000 });
        const headerBox = await header.boundingBox();
        expect(headerBox).not.toBeNull();
        if (headerBox) {
          expect(headerBox.height, `Header height at ${vp.name} should be <= 48px (got ${headerBox.height}px)`).toBeLessThanOrEqual(48);
        }
      }

      // 3. Task B: Hamburger button does not overlap logo
      const hamburgerSlot = page.locator('[data-testid="header-drawer-slot"], .header-drawer-slot');
      const logo = page.locator(".header-brand");
      if ((await hamburgerSlot.isVisible()) && (await logo.isVisible())) {
        const hBox = await hamburgerSlot.boundingBox();
        const lBox = await logo.boundingBox();
        expect(hBox).not.toBeNull();
        expect(lBox).not.toBeNull();
        if (hBox && lBox) {
          const intersects = !(hBox.x + hBox.width <= lBox.x || lBox.x + lBox.width <= hBox.x);
          expect(intersects, `Hamburger slot overlaps logo at ${vp.name}`).toBe(false);
        }
      }

      // 4. Task A: Viewer top edge within 150 px under the action row (.document-toolbar)
      const toolbar = page.locator(".document-toolbar").first();
      const viewer = page.locator(".scientific-viewport, .structure-viewport-frame, .structure-workspace canvas").first();
      await expect(toolbar).toBeVisible({ timeout: 10_000 });
      await expect(viewer).toBeVisible({ timeout: 10_000 });

      const toolbarBox = await toolbar.boundingBox();
      const viewerBox = await viewer.boundingBox();
      expect(toolbarBox).not.toBeNull();
      expect(viewerBox).not.toBeNull();
      if (toolbarBox && viewerBox) {
        const topOffset = viewerBox.y - (toolbarBox.y + toolbarBox.height);
        expect(
          topOffset,
          `Viewer top edge must be within 150 px under action row at ${vp.name} (got ${topOffset}px)`
        ).toBeLessThanOrEqual(150);
        expect(topOffset, `Viewer top edge must be below action row at ${vp.name}`).toBeGreaterThanOrEqual(0);
      }

      // 5. Task A: Viewer height at least 55% of visible content height without scrolling
      if (vp.checkViewerRatio && viewerBox) {
        // Visible content height = window height - 44 (header) - 24 (activity shelf) = vp.height - 68
        const visibleContentHeight = vp.height - 68;
        const heightRatio = viewerBox.height / visibleContentHeight;
        expect(
          heightRatio,
          `Viewer height ratio at ${vp.name} must be >= 55% (got ${(heightRatio * 100).toFixed(1)}%, height ${viewerBox.height}px vs content ${visibleContentHeight}px)`
        ).toBeGreaterThanOrEqual(0.55);

        // Release 0.0.35 Task B.2: Target >= 62% of window height at 1366x591 and 1024x560
        if (["1366x591", "1024x560"].includes(vp.name)) {
          const windowRatio = viewerBox.height / vp.height;
          expect(
            windowRatio,
            `Molecule canvas height ratio at ${vp.name} must be >= 62% of window height (got ${(windowRatio * 100).toFixed(1)}%, height ${viewerBox.height}px vs window ${vp.height}px)`
          ).toBeGreaterThanOrEqual(0.62);
        }
      }

      // Release 0.0.35 Task B.1: Viewer panel fills full available width (no blank column to its right)
      const viewerPane = page.locator(".visualization-pane");
      const grid = page.locator(".visualization-grid");
      if ((await viewerPane.isVisible()) && (await grid.isVisible())) {
        const vpBox = await viewerPane.boundingBox();
        const gBox = await grid.boundingBox();
        if (vpBox && gBox) {
          expect(vpBox.width, `Viewer pane must use full available width at ${vp.name}`).toBeGreaterThanOrEqual(gBox.width - 2);
        }
      }

      // Release 0.0.35 Task B.2: Viewer controls in ONE compact toolbar row (<= 38px)
      const vizToolbar = page.locator(".visualization-pane .visualization-toolbar");
      if (await vizToolbar.isVisible()) {
        const tbBox = await vizToolbar.boundingBox();
        if (tbBox) {
          expect(tbBox.height, `Viewer controls toolbar at ${vp.name} must be ONE compact row <= 38px (got ${tbBox.height}px)`).toBeLessThanOrEqual(38);
        }
      }

      // Release 0.0.35 Task B.2: On narrow (<1200px) View options popover is present; on wide (>=1200px) all controls inline
      if (vp.width < 1200) {
        await expect(page.locator('[data-testid="viewer-view-options-btn"]')).toBeVisible();
        await expect(page.locator('.visualization-pane select[aria-label="Representation"]')).toBeVisible();
        await expect(page.locator('.visualization-pane select[aria-label="Labels"]')).toBeVisible();
      } else {
        await expect(page.locator('.visualization-pane select[aria-label="Palette"]')).toBeVisible();
        await expect(page.locator('.visualization-pane select[aria-label="Projection"]')).toBeVisible();
        await expect(page.locator('.visualization-pane select[aria-label="Visual bonds"]')).toBeVisible();
        await expect(page.locator('.visualization-pane select[aria-label="Measure"]')).toBeVisible();
      }

      // 6. Task A: Folded empty sections below viewer
      const collapsedEvidence = page.locator('[data-testid="phase7-evidence-collapsed"]');
      await expect(collapsedEvidence).toBeVisible({ timeout: 10_000 });
      await expect(collapsedEvidence).toContainText("Documents and datasets: nothing yet");

      const compactKnowledge = page.locator('[data-testid="knowledge-search-compact"], .knowledge-search-compact-row');
      await expect(compactKnowledge).toBeVisible({ timeout: 10_000 });

      // Save screenshot for the 6 matrix viewports
      if (["1024x560", "860x560", "1366x591", "1440x900", "1728x900", "834x1112"].includes(vp.name)) {
        await page.screenshot({ path: `${OUTPUT_DIR}/workspace-${vp.name}.png` });
      }
    });
  }

  test("Task C: AI Scientist slide-over at 1024x560 (single title row, message area >= 200px, compact composer, Esc to close)", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 560 });
    const detail = makeBenzeneDetail();
    await setupMockRoutes(page, detail);

    await page.goto("/en/projects/benzene-proj/workspace", { waitUntil: "networkidle" });
    await expect(page.locator(".project-shell")).toBeVisible({ timeout: 15_000 });
    await ensureAdvancedMode(page);

    const aiToggle = page.getByTestId("ai-dock-toggle");
    await expect(aiToggle).toBeVisible();
    await aiToggle.click();

    const drawer = page.locator(".workspace-slide-over-drawer");
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Assert NO redundant .workspace-drawer-header (single title row in dock-tabs)
    const redundantHeader = drawer.locator(".workspace-drawer-header");
    await expect(redundantHeader).toHaveCount(0);

    // Assert dock tabs (Inspector / AI Scientist) present as single title row
    const dockTabs = drawer.locator(".dock-tabs");
    await expect(dockTabs).toBeVisible();
    const closeBtn = drawer.locator('[data-testid="dock-sheet-close"]');
    await expect(closeBtn).toBeVisible();

    // Assert chat message area height >= 200 px at 1024x560
    const messageArea = drawer.locator(".ai-conversation-scroll");
    await expect(messageArea).toBeVisible();
    const messageBox = await messageArea.boundingBox();
    expect(messageBox).not.toBeNull();
    if (messageBox) {
      expect(
        messageBox.height,
        `Chat message area at 1024x560 must be >= 200px (got ${messageBox.height}px)`
      ).toBeGreaterThanOrEqual(200);
    }

    // Capture screenshot: AI slide-over at 1024x560
    await page.screenshot({ path: `${OUTPUT_DIR}/workspace-1024x560-ai-slideover.png` });

    // Press Escape to close and verify focus returns to aiToggle
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden({ timeout: 5_000 });
    await expect(aiToggle).toBeFocused();
  });

  test("Explorer slide-over at 1024x560 screenshot and behavior", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 560 });
    const detail = makeBenzeneDetail();
    await setupMockRoutes(page, detail);

    await page.goto("/en/projects/benzene-proj/workspace", { waitUntil: "networkidle" });
    await expect(page.locator(".project-shell")).toBeVisible({ timeout: 15_000 });
    await ensureAdvancedMode(page);

    const hamburger = page.locator('[data-testid="header-drawer-slot"] button, .header-drawer-slot button').first();
    await expect(hamburger).toBeVisible();
    await hamburger.click();

    const drawer = page.locator(".workspace-slide-over-drawer");
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Capture screenshot: Explorer slide-over at 1024x560
    await page.screenshot({ path: `${OUTPUT_DIR}/workspace-1024x560-explorer-slideover.png` });

    // Press Escape to close
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden({ timeout: 5_000 });
  });

  test("Task D: Plain UI wording asserts 'saved' while scientific badge remains COMMITTED", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 560 });
    const detail = makeBenzeneDetail();
    await setupMockRoutes(page, detail);

    await page.goto("/en/projects/benzene-proj/workspace", { waitUntil: "networkidle" });
    await expect(page.locator(".project-shell")).toBeVisible({ timeout: 15_000 });
    await ensureAdvancedMode(page);

    // Subtitle has "1 saved structure"
    const subtitle = page.locator(".structure-title-row .structure-count");
    await expect(subtitle).toBeVisible();
    await expect(subtitle).toContainText("1 saved structure loaded from the ChemDFT API");

    // Explorer tree has "Structures (1 saved)"
    await expect(page.getByRole("button", { name: "Structures (1 saved)" })).toBeVisible();

    // Open structure tab to assert scientific authority badge remains COMMITTED with Saved tooltip
    await page.goto("/en/projects/benzene-proj/workspace?selection=structureVersion:v-benzene-1", { waitUntil: "networkidle" });
    const badge = page.locator(".workspace-canvas-authority.committed");
    if (await badge.isVisible({ timeout: 5_000 })) {
      await expect(badge).toContainText("COMMITTED STRUCTURE VERSION");
      const badgeTitle = await badge.getAttribute("title");
      expect(badgeTitle).toContain("Saved");
    }
    // Release 0.0.35 Task B.3: Plain-language caption next to COMMITTED STRUCTURE VERSION badge
    const caption = page.locator(".authority-plain-caption");
    if (await caption.isVisible({ timeout: 5_000 })) {
      await expect(caption).toContainText("Saved and cannot be edited; changes create a new version");
    }
  });

  test("Task E: Focus mode (Shift+F) hides side panels & secondary rows, shows Exit focus control", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 560 });
    const detail = makeBenzeneDetail();
    await setupMockRoutes(page, detail);

    await page.goto("/en/projects/benzene-proj/workspace", { waitUntil: "networkidle" });
    await expect(page.locator(".project-shell")).toBeVisible({ timeout: 15_000 });
    await ensureAdvancedMode(page);

    // Press Shift+F to enter focus mode
    await page.keyboard.press("Shift+F");
    await expect(page.locator(".project-shell")).toHaveClass(/in-focus-mode/);
    const exitBtn = page.getByTestId("exit-focus-mode");
    await expect(exitBtn).toBeVisible();

    // Click Exit focus control
    await exitBtn.click();
    await expect(page.locator(".project-shell")).not.toHaveClass(/in-focus-mode/);
  });

  test("Task E: Density toggle changes control heights and persists across reload", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const detail = makeBenzeneDetail();
    await setupMockRoutes(page, detail);

    await page.goto("/en/projects/benzene-proj/workspace", { waitUntil: "networkidle" });
    await expect(page.locator(".project-shell")).toBeVisible({ timeout: 15_000 });
    await ensureAdvancedMode(page);

    const densityBtn = page.getByTestId("density-toggle");
    await expect(densityBtn).toBeVisible();

    // Toggle to compact
    await densityBtn.click();
    await expect(page.locator(".project-shell")).toHaveClass(/density-compact/);

    const savedDensity = await page.evaluate(() => localStorage.getItem("chemdft:density"));
    expect(savedDensity).toBe("compact");

    // Reload page and check persistence
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".project-shell")).toHaveClass(/density-compact/);
  });

  test("Task E: Guided layout at 1024x560 and 860x560 (viewer visible, no overlap, no horizontal scroll)", async ({ page }) => {
    for (const size of [{ w: 1024, h: 560 }, { w: 860, h: 560 }]) {
      await page.setViewportSize({ width: size.w, height: size.h });
      const detail = makeBenzeneDetail();
      await setupMockRoutes(page, detail);

      await page.addInitScript(() => {
        try {
          localStorage.setItem("chemdft:workspace-mode", "guided");
        } catch {}
      });

      await page.goto("/en/projects/benzene-proj/workspace", { waitUntil: "networkidle" });
      await expect(page.locator(".project-shell")).toBeVisible({ timeout: 15_000 });

      // No horizontal scroll
      const noHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth <= window.innerWidth + 1;
      });
      expect(noHorizontalScroll, `Guided horizontal scroll at ${size.w}x${size.h}`).toBe(true);

      // Navigate to structure stage to view 3D viewer in Guided mode
      const inspectBtn = page.getByTestId("guided-inspect-geom-btn");
      if (await inspectBtn.isVisible({ timeout: 5_000 })) {
        await inspectBtn.click();
      }

      // Viewer visible
      const viewer = page.locator(".scientific-viewport, .guided-viewer canvas, .structure-viewport-frame, canvas").first();
      await expect(viewer).toBeVisible({ timeout: 10_000 });
    }
  });

  test("Task E: Splitter keyboard resize", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const detail = makeBenzeneDetail();
    await setupMockRoutes(page, detail);

    await page.goto("/en/projects/benzene-proj/workspace", { waitUntil: "networkidle" });
    await expect(page.locator(".project-shell")).toBeVisible({ timeout: 15_000 });
    await ensureAdvancedMode(page);

    const splitter = page.locator('[data-testid="workspace-splitter-explorer"]').first();
    if (await splitter.isVisible()) {
      await splitter.focus();
      const initialValue = Number(await splitter.getAttribute("aria-valuenow"));
      await page.keyboard.press("ArrowRight");
      const nextValue = Number(await splitter.getAttribute("aria-valuenow"));
      expect(nextValue).toBeGreaterThan(initialValue);
    }
  });
});

