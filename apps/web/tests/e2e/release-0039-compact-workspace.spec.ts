import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT_DIR = process.env.CDF_OUTPUT_DIR
  ? resolve(process.env.CDF_OUTPUT_DIR)
  : resolve("../../output/release-0.0.39");
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

const VIEWPORTS = [
  { name: "1440x800", width: 1440, height: 800 },
  { name: "1280x720", width: 1280, height: 720 },
];

for (const vp of VIEWPORTS) {
  test.describe(`Release 0.0.39 compact workspace at ${vp.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMockRoutes(page, makeBenzeneDetail());
      await page.addInitScript(() => {
        try {
          localStorage.setItem("chemdft:workspace-mode", "advanced");
          localStorage.removeItem("chemdft:workspace:focus-mode");
        } catch {}
      });
      await page.goto("/en/projects/benzene-proj/workspace", { waitUntil: "networkidle" });
      await expect(page.locator(".project-shell")).toBeVisible({ timeout: 15_000 });
      await ensureAdvancedMode(page);
    });

    test("viewer is fully visible without page scroll", async ({ page }) => {
      const canvas = page.locator("canvas").first();
      await expect(canvas).toBeVisible({ timeout: 20_000 });
      const m = await page.evaluate(() => ({
        scrollHeight: document.scrollingElement!.scrollHeight,
        innerHeight: window.innerHeight,
      }));
      const box = (await canvas.boundingBox())!;
      console.log(`LAYOUT ${vp.name}`, JSON.stringify({ ...m, canvasTop: box.y, canvasHeight: box.height, canvasBottom: box.y + box.height }));
      expect(m.scrollHeight).toBeLessThanOrEqual(m.innerHeight);
      expect(box.y + box.height).toBeLessThanOrEqual(m.innerHeight);
      expect(box.height).toBeGreaterThanOrEqual(m.innerHeight * 0.6);
    });

    test("view buttons do not scroll the page", async ({ page }) => {
      await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
      for (const id of ["view-bar-front", "view-bar-top"]) {
        const btn = page.getByTestId(id);
        if (await btn.count()) {
          await btn.click();
          expect(await page.evaluate(() => window.scrollY)).toBe(0);
        }
      }
      const fit = page.getByTestId("view-bar-fit");
      await expect(fit).toBeVisible();
      await fit.click();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });

    test("Explorer and Context toggles work", async ({ page }) => {
      const explorer = page.getByRole("button", { name: /Explorer/ }).first();
      const before = await explorer.getAttribute("aria-pressed");
      await explorer.click();
      expect(await explorer.getAttribute("aria-pressed")).not.toBe(before);
      const ctx = page.getByRole("button", { name: /context panel/i }).first();
      const cb = await ctx.getAttribute("aria-pressed");
      await ctx.click();
      expect(await ctx.getAttribute("aria-pressed")).not.toBe(cb);
    });

    test("Import popover imports a CIF and an SDF through the same import action", async ({ page }) => {
      const posts: string[] = [];
      await page.route("**/api/chemdft/v1/**", async (route) => {
        const req = route.request();
        if (req.method() === "POST" && /import/i.test(req.url())) {
          posts.push(req.url());
          return route.fulfill({ status: 422, json: { detail: "mock: not imported" } });
        }
        return route.fallback();
      });
      const trigger = page.getByTestId("toolbar-import-btn");
      for (const [name, body] of [["a.cif", "data_x\n_cell_length_a 1\n"], ["b.sdf", "x\n\n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n$$$$\n"]] as const) {
        await trigger.click();
        await expect(page.getByRole("dialog", { name: "Import structure" })).toBeVisible();
        await expect(page.getByTestId("toolbar-import-format-select")).toBeVisible();
        await page.locator("#structure-upload").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(body) });
        await expect.poll(() => posts.length, { timeout: 10_000 }).toBeGreaterThan(posts.length - 1);
      }
      await expect.poll(() => posts.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    });

    test("0.0.40: the Display popover is gone and its five controls are inline", async ({ page }) => {
      await expect(page.getByTestId("viewer-view-options-btn")).toHaveCount(0);
      for (const name of ["Labels", "Palette", "Visual bonds", "View preset", "Atom size"]) {
        await expect(page.locator(".visualization-toolbar").getByLabel(name, { exact: true }).first()).toBeVisible();
      }
    });
  });
}
