import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import axe from "axe-core";
import reference from "../../src/app/_components/home/reference/cr2o3-reference.json" with { type: "json" };

const OUTPUT_DIR = resolve("../../output/release-0.0.33");
mkdirSync(OUTPUT_DIR, { recursive: true });

const DEG = Math.PI / 180;
function calcLatticeVectors(l: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number }) {
  const ca = Math.cos(l.alpha * DEG);
  const cb = Math.cos(l.beta * DEG);
  const cg = Math.cos(l.gamma * DEG);
  const sg = Math.sin(l.gamma * DEG);
  const cy = (ca - cb * cg) / sg;
  return [
    [l.a, 0, 0],
    [l.b * cg, l.b * sg, 0],
    [l.c * cb, l.c * cy, l.c * Math.sqrt(Math.max(0, 1 - cb * cb - cy * cy))],
  ];
}

const latticeVectors = calcLatticeVectors(reference.lattice);
const cr2o3Atoms = reference.sites.map((site, i) => ({
  index: i,
  element: site.element,
  atomic_number: site.element === "Cr" ? 24 : 8,
  x: site.fractional[0],
  y: site.fractional[1],
  z: site.fractional[2],
}));

function makeCr2O3Detail(structureName = "Cr2O3 eskolaite unit cell") {
  return {
    structure: {
      id: "s-cr2o3",
      project_id: "cr2o3-proj",
      name: structureName,
      kind: "PERIODIC",
    },
    version: {
      id: "v-cr2o3-1",
      structure_id: "s-cr2o3",
      revision: 1,
      origin: "IMPORTED",
      created_by: "user-1",
      overall_charge: 0,
      multiplicity: 1,
      periodic_cell: {
        a: reference.lattice.a,
        b: reference.lattice.b,
        c: reference.lattice.c,
        alpha: reference.lattice.alpha,
        beta: reference.lattice.beta,
        gamma: reference.lattice.gamma,
        lattice_vectors: latticeVectors,
        periodic_dimensions: [true, true, true],
        unit: "angstrom",
      },
      coordinates: {
        coordinate_system: "FRACTIONAL",
        unit: "angstrom",
        atoms: cr2o3Atoms,
      },
    },
  };
}

async function setupMockRoutes(page: Page, detail: unknown, options?: { withApproval?: boolean }) {
  await page.route("**/api/chemdft/v1/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/structures/s-cr2o3/versions/v-cr2o3-1")) {
      return route.fulfill({ json: detail });
    }
    if (path.includes("/structures/s-cr2o3/versions")) {
      return route.fulfill({ json: [detail] });
    }
    if (path.endsWith("/structures")) {
      return route.fulfill({
        json: [
          {
            id: "s-cr2o3",
            project_id: "cr2o3-proj",
            name: (detail as { structure: { name: string } }).structure.name,
            kind: "PERIODIC",
            latest_version_id: "v-cr2o3-1",
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
            supported_basis_sets: ["sto-3g", "def2-svp"],
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
          allowed_tools: ["ask_ai_scientist"], can_write: true, generated_at: "2026-10-26T10:00:00Z", human_id: "mock",
          navigator: { blocked: [], goal: null, have: [], next: [], notices: [] },
          organization_id: "org-1", project_id: "cr2o3-proj", project_kind: "RESEARCH", project_name: "Cr2O3 eskolaite investigation",
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
    if (path.includes("/ai/conversations/conv-appr-1")) {
      const mockRun = {
        id: "run-appr-1",
        conversation_id: "conv-appr-1",
        status: "WAITING_FOR_APPROVAL",
        created_at: "2026-11-10T12:00:00Z",
        pending_approval: {
          id: "appr-test-1",
          kind: "CALCULATION",
          status: "PENDING",
          expires_at: new Date(Date.now() + 600_000).toISOString(),
          calculation_proposal: {
            task: "ENERGY",
            method: { identifier: "b3lyp" },
            basis_set: "def2-svp",
            structure_version_id: "v-cr2o3-1",
            parameters: {},
            engine: "pyscf",
          },
          provenance: {
            provider: "NVIDIA",
            model: "nemotron-3.5-lightning",
            eligibility: "PRODUCTION",
          },
        },
        steps: [],
      };
      return route.fulfill({
        json: {
          conversation: {
            id: "conv-appr-1",
            project_id: "cr2o3-proj",
            title: "Calculation proposal",
          },
          latest_run: mockRun,
          messages: [],
        },
      });
    }
    if (path.includes("/ai/runs/run-appr-1")) {
      return route.fulfill({
        json: {
          id: "run-appr-1",
          conversation_id: "conv-appr-1",
          status: "WAITING_FOR_APPROVAL",
          created_at: "2026-11-10T12:00:00Z",
          pending_approval: {
            id: "appr-test-1",
            kind: "CALCULATION",
            status: "PENDING",
            expires_at: new Date(Date.now() + 600_000).toISOString(),
            calculation_proposal: {
              task: "ENERGY",
              method: { identifier: "b3lyp" },
              basis_set: "def2-svp",
              structure_version_id: "v-cr2o3-1",
              parameters: {},
              engine: "pyscf",
            },
            provenance: {
              provider: "NVIDIA",
              model: "nemotron-3.5-lightning",
              eligibility: "PRODUCTION",
            },
          },
          steps: [],
        },
      });
    }
    if (path.includes("/ai/conversations")) {
      return route.fulfill({
        json: options?.withApproval
          ? { conversations: [{ id: "conv-appr-1", title: "Calculation proposal" }] }
          : { conversations: [] },
      });
    }
    if (path.endsWith("/projects/cr2o3-proj")) {
      return route.fulfill({ json: { id: "cr2o3-proj", name: "Cr2O3 eskolaite investigation" } });
    }
    if (path.endsWith("/me")) {
      return route.fulfill({ json: { id: "user-1", email: "researcher@example.com", name: "Researcher" } });
    }
    return route.fulfill({ json: {} });
  });
}

const VIEWPORT_MATRIX = [
  { name: "1024x600", width: 1024, height: 600, checkHeightRatio: true },
  { name: "1280x720", width: 1280, height: 720, checkHeightRatio: false },
  { name: "1366x768", width: 1366, height: 768, checkHeightRatio: true },
  { name: "1440x900", width: 1440, height: 900, checkHeightRatio: false },
  { name: "1728x900", width: 1728, height: 900, checkHeightRatio: false },
  { name: "860x800", width: 860, height: 800, checkHeightRatio: false },
  { name: "834x1112", width: 834, height: 1112, checkHeightRatio: false },
];

test.describe("Release 0.0.33 Adaptive Workspace & Export Matrix", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => console.log("BROWSER PAGEERROR:", err));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("BROWSER CONSOLE ERROR:", msg.text());
    });
  });

  for (const vp of VIEWPORT_MATRIX) {
    test(`Viewport ${vp.name}: no horizontal scroll, Export visible, Set up calculation visible, viewer height ratio`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const detail = makeCr2O3Detail();
      await setupMockRoutes(page, detail);

      await page.addInitScript(() => {
        try {
          localStorage.setItem("chemdft:workspace-mode", "advanced");
          localStorage.removeItem("chemdft:workspace:focus-mode");
        } catch {}
      });

      await page.goto("/en/projects/cr2o3-proj/workspace", { waitUntil: "networkidle" });
      await expect(page.locator(".project-shell")).toBeVisible({ timeout: 15_000 });

      // 1. Assert no horizontal page scroll
      const noHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth <= window.innerWidth + 1;
      });
      expect(noHorizontalScroll, `Horizontal page scroll detected at ${vp.name}`).toBe(true);

      // 2. Assert Export control is visible on the page's action row
      const exportBtn = page.locator('.document-toolbar [data-testid="unified-export-btn"], .document-toolbar button:has-text("Export")').first();
      await expect(exportBtn).toBeVisible({ timeout: 10_000 });

      // 3. Assert Set up calculation is visible
      const setupCalcBtn = page.locator('[data-testid="setup-calculation-action-btn"], button:has-text("Calculate")').first();
      await expect(setupCalcBtn).toBeVisible({ timeout: 10_000 });

      // 4. Assert viewer height ratio (at least 55% of window height at 1024x600 and 1366x768)
      if (vp.checkHeightRatio) {
        const viewerHeight = await page.evaluate(() => {
          const viewportEl = document.querySelector(".scientific-viewport, .structure-viewport-frame, .structure-workspace canvas");
          if (viewportEl) return viewportEl.getBoundingClientRect().height;
          const workspaceEl = document.querySelector(".structure-workspace");
          return workspaceEl ? workspaceEl.getBoundingClientRect().height : 0;
        });
        const minExpectedHeight = vp.height * 0.55;
        expect(viewerHeight, `Viewer height at ${vp.name} must be >= 55% of ${vp.height} (got ${viewerHeight})`).toBeGreaterThanOrEqual(minExpectedHeight);
      }

      // 5. Test AI slide-over drawer behavior on narrow viewports (< 1100 px)
      if (vp.width < 1100) {
        const aiToggle = page.getByTestId("ai-dock-toggle");
        await expect(aiToggle).toBeVisible();
        await aiToggle.click();

        const drawer = page.locator(".workspace-slide-over-drawer");
        await expect(drawer).toBeVisible({ timeout: 5_000 });

        // Capture AI slide-over screenshot on 1024x600
        if (vp.name === "1024x600") {
          await page.screenshot({ path: `${OUTPUT_DIR}/workspace-1024x600-ai-drawer.png` });
        }

        // Press Escape to close drawer
        await page.keyboard.press("Escape");
        await expect(drawer).toBeHidden({ timeout: 5_000 });

        // Focus returned to trigger button
        await expect(aiToggle).toBeFocused();
      }

      // Save main screenshot
      await page.screenshot({ path: `${OUTPUT_DIR}/workspace-${vp.name}.png` });
    });
  }

  test("Focus mode toggle (Shift+F) hides side panels & secondary rows at 1024x600", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    const detail = makeCr2O3Detail();
    await setupMockRoutes(page, detail);

    await page.goto("/en/projects/cr2o3-proj/workspace", { waitUntil: "networkidle" });
    await expect(page.locator(".project-shell")).toBeVisible({ timeout: 10_000 });

    // Press Shift+F to enter focus mode
    await page.keyboard.press("Shift+F");
    await expect(page.locator(".project-shell")).toHaveClass(/in-focus-mode/);
    const exitBtn = page.getByTestId("exit-focus-mode");
    await expect(exitBtn).toBeVisible();

    await page.screenshot({ path: `${OUTPUT_DIR}/workspace-1024x600-focus-mode.png` });

    // Click Exit focus mode
    await exitBtn.click();
    await expect(page.locator(".project-shell")).not.toHaveClass(/in-focus-mode/);
  });

  test("Accessibility audit via axe-core at 1024x600", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    const detail = makeCr2O3Detail();
    await setupMockRoutes(page, detail);

    await page.goto("/en/projects/cr2o3-proj/workspace", { waitUntil: "networkidle" });
    await expect(page.locator(".project-shell")).toBeVisible({ timeout: 10_000 });

    await page.evaluate(axe.source);
    const results = await page.evaluate(async () => {
      const a = (window as unknown as { axe: typeof axe }).axe;
      return a.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
    });

    const criticalOrSerious = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(criticalOrSerious, `Axe critical/serious violations found: ${JSON.stringify(criticalOrSerious, null, 2)}`).toEqual([]);
  });

  test("Carry-over item a: AI approval screen usability at 1280x720", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const detail = makeCr2O3Detail();
    await setupMockRoutes(page, detail, { withApproval: true });

    await page.goto("/en/projects/cr2o3-proj/workspace", { waitUntil: "networkidle" });
    await expect(page.locator(".project-shell")).toBeVisible({ timeout: 10_000 });

    const approvalCard = page.getByTestId("ai-approval-card");
    await expect(approvalCard).toBeVisible({ timeout: 10_000 });

    const approveBtn = approvalCard.getByTestId("ai-approve-button");
    const rejectBtn = approvalCard.getByTestId("ai-reject-button");
    await expect(approveBtn).toBeVisible({ timeout: 5_000 });
    await expect(rejectBtn).toBeVisible({ timeout: 5_000 });

    const btnBounds = await approveBtn.boundingBox();
    expect(btnBounds).not.toBeNull();
    if (btnBounds) {
      expect(btnBounds.x).toBeGreaterThanOrEqual(0);
      expect(btnBounds.x + btnBounds.width).toBeLessThanOrEqual(1280);
      expect(btnBounds.y + btnBounds.height).toBeLessThanOrEqual(720);
    }

    await page.screenshot({ path: `${OUTPUT_DIR}/approval-screen-1280x720.png` });
  });

  test("Carry-over item a: AI approval screen usability at 1024x600", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    const detail = makeCr2O3Detail();
    await setupMockRoutes(page, detail, { withApproval: true });

    await page.goto("/en/projects/cr2o3-proj/workspace", { waitUntil: "networkidle" });
    await expect(page.locator(".project-shell")).toBeVisible({ timeout: 10_000 });

    const aiToggle = page.getByTestId("ai-dock-toggle");
    await expect(aiToggle).toBeVisible();
    await aiToggle.click();

    const drawer = page.locator(".workspace-slide-over-drawer");
    await expect(drawer).toBeVisible({ timeout: 5_000 });
    // Wait for slide-over drawer entrance animation to finish
    await expect(drawer).toHaveClass(/bp6-overlay-enter-done/, { timeout: 5_000 });

    const approvalCard = drawer.getByTestId("ai-approval-card");
    await expect(approvalCard).toBeVisible({ timeout: 10_000 });

    const approveBtn = approvalCard.getByTestId("ai-approve-button");
    const rejectBtn = approvalCard.getByTestId("ai-reject-button");
    await expect(approveBtn).toBeVisible({ timeout: 5_000 });
    await expect(rejectBtn).toBeVisible({ timeout: 5_000 });

    const btnBounds = await approveBtn.boundingBox();
    expect(btnBounds).not.toBeNull();
    if (btnBounds) {
      expect(btnBounds.x).toBeGreaterThanOrEqual(0);
      expect(btnBounds.x + btnBounds.width).toBeLessThanOrEqual(1024);
      expect(btnBounds.y + btnBounds.height).toBeLessThanOrEqual(600);
    }

    await page.screenshot({ path: `${OUTPUT_DIR}/approval-screen-1024x600.png` });
  });
});

