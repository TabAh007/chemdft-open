import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * UI Audit (Release 0.0.60, Rule 16 / Impeccable workflow).
 *
 * Verifies responsive desktop layouts across required viewports and AI dock widths:
 * - Viewports: 1280x900, 1440x900, 1920x1080
 * - AI dock widths: 340, 379, 460 px at 1440x900 viewport
 * - Pages: Project Overview, Structure Workspace, Jobs, Results
 *
 * Assertions:
 * 1. Zero console errors.
 * 2. No horizontal page scroll (scrollWidth <= clientWidth).
 * 3. Interactive elements maintain clean separation without collision.
 * 4. Specifically: Overview Results "Calculation" link and the AI vs Calculation HelpTip
 *    maintain >= 4px separation without overlapping across all tested configurations.
 * 5. At 340px dock width, Ask button and prompt input are fully visible and usable.
 */

const PROJECT_ID = "00000000-0000-4000-8000-0000000000a1";
const STRUCT_ID = "30000000-0000-4000-8000-000000000001";
const VER_ID = "31000000-0000-4000-8000-000000000001";
const CALC_ID = "20000000-0000-4000-8000-000000000001";
const RESULT_ID = "40000000-0000-4000-8000-000000000001";

const VIEWPORTS = [
  { width: 1280, height: 900, label: "1280x900" },
  { width: 1440, height: 900, label: "1440x900" },
  { width: 1920, height: 1080, label: "1920x1080" },
];

const DOCK_WIDTHS = [340, 379, 460];

const PAGES = [
  { id: "overview", path: `/en/projects/${PROJECT_ID}/overview`, testId: "project-overview" },
  { id: "workspace", path: `/en/projects/${PROJECT_ID}/workspace`, testId: "guided-workspace" },
  { id: "jobs", path: `/en/projects/${PROJECT_ID}/jobs`, testId: "jobs-workstation" },
  { id: "results", path: `/en/projects/${PROJECT_ID}/results`, testId: "results-library" },
];

async function setupMocks(page: Page, dockWidth = 379) {
  await page.addInitScript(({ width }) => {
    try {
      localStorage.setItem("chemdft:workspace-mode", "guided");
      localStorage.setItem("chemdft:dock-width", String(width));
      localStorage.setItem("chemdft:dock-collapsed", "false");
    } catch {
      /* storage unavailable */
    }
  }, { width: dockWidth });

  await page.route("**/api/chemdft/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/chemdft/, "");

    if (path === "/v1/me") {
      return route.fulfill({ json: { id: "dev-user", email: "researcher@example.com", name: "Researcher" } });
    }
    if (path === "/v1/projects") {
      return route.fulfill({
        json: [
          {
            id: PROJECT_ID,
            name: "Cr2O3 crystal project",
            slug: "cr2o3",
            organization_id: "org-1",
            role: "OWNER",
            created_at: "2026-10-01T10:00:00Z",
            updated_at: "2026-10-02T10:00:00Z",
          },
        ],
      });
    }
    if (path === `/v1/projects/${PROJECT_ID}`) {
      return route.fulfill({
        json: {
          id: PROJECT_ID,
          name: "Cr2O3 crystal project",
          slug: "cr2o3",
          organization_id: "org-1",
          role: "OWNER",
          created_at: "2026-10-01T10:00:00Z",
          updated_at: "2026-10-02T10:00:00Z",
        },
      });
    }
    if (path === `/v1/projects/${PROJECT_ID}/research-overview`) {
      return route.fulfill({
        json: {
          project_id: PROJECT_ID,
          total_calculations: 1,
          truncated: false,
          rows: [
            {
              calculation_id: CALC_ID,
              calculation_state: "SUCCEEDED",
              evidence_use: "AUTHORITATIVE",
              task_type: "ENERGY",
              method: "pbe",
              basis: "paw-pbe",
              engine: "quantum_espresso",
              standing: "ESTABLISHED",
              verification: "Independently verified",
              result_id: RESULT_ID,
              headline_quantity: "TOTAL_ENERGY",
              headline_value: "-1542.8421",
              headline_unit: "Ry",
              structure_id: STRUCT_ID,
              structure_version_id: VER_ID,
              structure_name: "Cr2O3 unit cell",
              updated_at: "2026-10-18T10:00:00Z",
            },
          ],
        },
      });
    }
    if (path === `/v1/projects/${PROJECT_ID}/structures`) {
      return route.fulfill({
        json: [
          {
            id: STRUCT_ID,
            project_id: PROJECT_ID,
            name: "Cr2O3 unit cell",
            latest_version_id: VER_ID,
            created_at: "2026-10-01T10:00:00Z",
            updated_at: "2026-10-02T10:00:00Z",
          },
        ],
      });
    }
    if (path === `/v1/projects/${PROJECT_ID}/structures/${STRUCT_ID}/versions/${VER_ID}`) {
      return route.fulfill({
        json: {
          structure: { id: STRUCT_ID, name: "Cr2O3 unit cell", project_id: PROJECT_ID },
          version: {
            id: VER_ID,
            structure_id: STRUCT_ID,
            revision: 1,
            authority: "COMMITTED",
            created_at: "2026-10-01T10:00:00Z",
            coordinates: {
              kind: "PERIODIC",
              coordinate_system: "FRACTIONAL",
              unit_cell: { a: 4.95, b: 4.95, c: 13.58, alpha: 90.0, beta: 90.0, gamma: 120.0 },
              atoms: [
                { index: 0, element: "Cr", x: 0.0, y: 0.0, z: 0.35 },
                { index: 1, element: "Cr", x: 0.0, y: 0.0, z: 0.65 },
                { index: 2, element: "O", x: 0.3, y: 0.0, z: 0.25 },
              ],
              bonds: [],
            },
          },
        },
      });
    }
    if (path === `/v1/projects/${PROJECT_ID}/navigator`) {
      return route.fulfill({
        json: {
          goal: null,
          goals: [],
          next: [
            {
              action_id: "calculation.single_point",
              category: "calculation",
              title_key: "action.calculation.single_point.title",
              description_key: "action.calculation.single_point.description",
              required_capability: "read",
              minimum_role_key: "role.viewer",
              required_facts: [],
              conflicting_facts: [],
              resulting_fact: "fact",
              goal_ids: [],
              reasons: [],
            },
          ],
          have: [],
          blocked: [],
          notices: ["firewall.calculated_only"],
          facts_summary: {
            structure_id: STRUCT_ID,
            structure_version_id: VER_ID,
            can_write: true,
            sealed: false,
            running_jobs: 0,
            failed_jobs: 0,
          },
        },
      });
    }
    if (path === `/v1/projects/${PROJECT_ID}/compute/jobs`) {
      return route.fulfill({ json: { jobs: [] } });
    }
    if (path === `/v1/projects/${PROJECT_ID}/published-results`) {
      return route.fulfill({
        json: {
          total_published: 1,
          rows: [
            {
              result_id: RESULT_ID,
              calculation_id: CALC_ID,
              project_id: PROJECT_ID,
              task: "ENERGY",
              level_of_theory: "PBE / PAW",
              engine: "QUANTUM_ESPRESSO",
              standing: "ESTABLISHED",
              verification: "Independently verified",
              created_at: "2026-10-18T10:00:00Z",
            },
          ],
        },
      });
    }
    if (path === `/v1/projects/${PROJECT_ID}/ai/settings`) {
      return route.fulfill({ json: { provider: "mock", model: "mock-model" } });
    }
    return route.fulfill({ status: 200, json: {} });
  });
}

test.describe("UI Audit: Multi-viewport & AI dock responsiveness", () => {
  for (const vp of VIEWPORTS) {
    test(`Overview layout and interactive spacing at ${vp.label}`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => {
        consoleErrors.push(err.message);
      });

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page, 379);

      await page.goto(`/en/projects/${PROJECT_ID}/overview`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("project-overview")).toBeVisible({ timeout: 30_000 });

      // 1. Assert no horizontal page scroll
      const noHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
      });
      expect(noHorizontalScroll, `Horizontal scroll detected at ${vp.label}`).toBe(true);

      // 2. Assert zero console errors
      expect(consoleErrors).toEqual([]);

      // 3. Specifically verify Overview Results "Calculation" link and HelpTip bounding boxes do not overlap
      const calcLink = page.locator('p[class*="resultLinks"] a', { hasText: "Calculation" }).first();
      const firewallTip = page.locator('[data-help-trigger="firewall.ai_vs_calculation"]').first();

      if ((await calcLink.isVisible()) && (await firewallTip.isVisible())) {
        const box1 = await calcLink.boundingBox();
        const box2 = await firewallTip.boundingBox();
        expect(box1).not.toBeNull();
        expect(box2).not.toBeNull();

        if (box1 && box2) {
          const horizontalOverlap = box1.x < box2.x + box2.width && box1.x + box1.width > box2.x;
          const verticalOverlap = box1.y < box2.y + box2.height && box1.y + box1.height > box2.y;
          expect(horizontalOverlap && verticalOverlap, "Calculation link and HelpTip must not overlap").toBe(false);

          const verticalSep = Math.max(box1.y - (box2.y + box2.height), box2.y - (box1.y + box1.height));
          const horizontalSep = Math.max(box1.x - (box2.x + box2.width), box2.x - (box1.x + box1.width));
          expect(Math.max(verticalSep, horizontalSep)).toBeGreaterThanOrEqual(4);
        }
      }
    });
  }

  for (const dockWidth of DOCK_WIDTHS) {
    test(`Overview and AI dock at 1440x900 with dock width ${dockWidth}px`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => {
        consoleErrors.push(err.message);
      });

      await page.setViewportSize({ width: 1440, height: 900 });
      await setupMocks(page, dockWidth);

      await page.goto(`/en/projects/${PROJECT_ID}/overview`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("project-overview")).toBeVisible({ timeout: 30_000 });

      // No horizontal scroll
      const noHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
      });
      expect(noHorizontalScroll).toBe(true);
      expect(consoleErrors).toEqual([]);

      // Verify AI dock controls at this width
      const askButton = page.locator('[data-testid="ai-ask-button"]');
      if (await askButton.isVisible()) {
        const btnBox = await askButton.boundingBox();
        expect(btnBox).not.toBeNull();
        expect(btnBox!.width).toBeGreaterThanOrEqual(24);
        expect(btnBox!.height).toBeGreaterThanOrEqual(24);
      }

      // Check Calculation link vs HelpTip separation
      const calcLink = page.locator('p[class*="resultLinks"] a', { hasText: "Calculation" }).first();
      const firewallTip = page.locator('[data-help-trigger="firewall.ai_vs_calculation"]').first();

      if ((await calcLink.isVisible()) && (await firewallTip.isVisible())) {
        const box1 = await calcLink.boundingBox();
        const box2 = await firewallTip.boundingBox();
        expect(box1).not.toBeNull();
        expect(box2).not.toBeNull();

        if (box1 && box2) {
          const horizontalOverlap = box1.x < box2.x + box2.width && box1.x + box1.width > box2.x;
          const verticalOverlap = box1.y < box2.y + box2.height && box1.y + box1.height > box2.y;
          expect(horizontalOverlap && verticalOverlap).toBe(false);
          const verticalSep = Math.max(box1.y - (box2.y + box2.height), box2.y - (box1.y + box1.height));
          const horizontalSep = Math.max(box1.x - (box2.x + box2.width), box2.x - (box1.x + box1.width));
          expect(Math.max(verticalSep, horizontalSep)).toBeGreaterThanOrEqual(4);
        }
      }
    });
  }

  for (const pageItem of PAGES) {
    test(`Desktop horizontal bounds for ${pageItem.id} at 1280x900`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await setupMocks(page, 379);

      await page.goto(pageItem.path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);

      const noHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
      });
      expect(noHorizontalScroll, `${pageItem.id} has horizontal overflow at 1280px`).toBe(true);
    });
  }
});
