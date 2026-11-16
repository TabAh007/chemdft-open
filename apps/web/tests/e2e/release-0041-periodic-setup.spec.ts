import { expect, test, type Page, type Route } from "@playwright/test";
import reference from "../../src/app/_components/home/reference/cr2o3-reference.json" with { type: "json" };

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

function makeCr2O3Detail() {
  return {
    structure: {
      id: "s-cr2o3",
      project_id: "cr2o3-proj",
      name: "Cr2O3 eskolaite unit cell",
      kind: "PERIODIC",
    },
    version: {
      id: "v-cr2o3-1",
      structure_id: "s-cr2o3",
      revision: 1,
      origin: "IMPORTED",
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

async function setupMockRoutes(page: Page, detail: unknown) {
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
            name: "Cr2O3 eskolaite unit cell",
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
            supported_tasks: ["ENERGY", "PERIODIC_ENERGY", "GEOMETRY_OPTIMIZATION"],
            supported_methods: ["hf", "pbe", "pbe+u"],
            supported_basis_sets: ["sto-3g", "gth-dzvp-molopt-sr"],
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
    if (path.includes("/ai/conversations")) {
      return route.fulfill({ json: { conversations: [] } });
    }
    if (path.endsWith("/projects/cr2o3-proj")) {
      return route.fulfill({ json: { id: "cr2o3-proj", name: "Cr2O3 eskolaite investigation" } });
    }
    if (path.endsWith("/me")) {
      return route.fulfill({ json: { id: "user-1", email: "researcher@example.com", name: "Researcher" } });
    }
    if (path.includes("/calculations")) {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: {} });
  });
}

test.describe("Release 0.0.41 — Periodic DFT setup form and compact layout", () => {
  const VIEWPORTS = [
    { name: "1440x800", width: 1440, height: 800 },
    { name: "1280x720", width: 1280, height: 720 },
  ];

  for (const vp of VIEWPORTS) {
    test(`renders periodic setup form without page scroll at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const detail = makeCr2O3Detail();
      await setupMockRoutes(page, detail);

      await page.goto("/en/projects/cr2o3-proj/workspace?structureId=s-cr2o3&structureVersionId=v-cr2o3-1");

      const advBtn = page.getByRole("button", { name: "Advanced Workbench" });
      await expect(advBtn).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expect(async () => {
        if ((await advBtn.getAttribute("aria-pressed")) !== "true") await advBtn.click();
        await expect(advBtn).toHaveAttribute("aria-pressed", "true", { timeout: 1_500 });
      }).toPass({ timeout: 20_000 });
      // Verify the periodic setup form appears
      const setupForm = page.locator('[data-testid="periodic-setup-form"]');
      await expect(setupForm).toBeVisible({ timeout: 15_000 });

      // Verify controls
      const kmeshSelect = page.locator('[data-testid="periodic-kmesh-select"]');
      await expect(kmeshSelect).toBeVisible();
      await expect(kmeshSelect).toHaveValue("1x1x1");

      const magneticSelect = page.locator('[data-testid="periodic-magnetic-select"]');
      await expect(magneticSelect).toBeVisible();
      await expect(magneticSelect).toHaveValue("antiferromagnetic");

      const plusUToggle = page.locator('[data-testid="periodic-plus-u-toggle"]');
      await expect(plusUToggle).toBeVisible();
      await expect(plusUToggle).toBeChecked();

      const crUInput = page.locator('[data-testid="periodic-u-input-Cr"]');
      await expect(crUInput).toBeVisible();
      await expect(crUInput).toHaveValue("3.7");

      // 0.0.42: honest note about the default U values sits directly under the U fields
      const uNote = page.locator('[data-testid="periodic-u-defaults-note"]');
      await expect(uNote).toBeVisible();
      await expect(uNote).toContainText("Materials Project starting values for oxides");
      await expect(uNote).toContainText("not fitted to this basis or to band gaps");
      await expect(uNote).toContainText("Test the sensitivity by changing U");

      // Verify action button shows "Run periodic energy"
      const runBtn = page.getByRole("button", { name: "Run periodic energy" });
      await expect(runBtn).toBeVisible();

      // Verify the 3D viewer is visible
      const viewer = page.locator(".scientific-scene, canvas, .viewer-stage").first();
      await expect(viewer).toBeVisible();

      // Verify no vertical page-level scroll occurs
      const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      const innerHeight = await page.evaluate(() => window.innerHeight);
      expect(scrollHeight).toBeLessThanOrEqual(innerHeight + 1);
    });
  }

  for (const vp of VIEWPORTS) {
    test(`a molecular structure keeps the normal calculation panel and no periodic fields at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const base = makeCr2O3Detail();
      const detail = {
        structure: { ...base.structure, name: "Water", kind: "MOLECULAR" },
        version: {
        ...base.version,
        periodic_cell: null,
        coordinates: {
          coordinate_system: "CARTESIAN",
          unit: "angstrom",
          atoms: [
            { index: 0, element: "O", atomic_number: 8, x: 0, y: 0, z: 0.1173 },
            { index: 1, element: "H", atomic_number: 1, x: 0, y: 0.7572, z: -0.4692 },
            { index: 2, element: "H", atomic_number: 1, x: 0, y: -0.7572, z: -0.4692 },
          ],
        },
        },
      };
      await setupMockRoutes(page, detail);
      await page.goto("/en/projects/cr2o3-proj/workspace?structureId=s-cr2o3&structureVersionId=v-cr2o3-1");

      const advBtn = page.getByRole("button", { name: "Advanced Workbench" });
      await expect(advBtn).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expect(async () => {
        if ((await advBtn.getAttribute("aria-pressed")) !== "true") await advBtn.click();
        await expect(advBtn).toHaveAttribute("aria-pressed", "true", { timeout: 1_500 });
      }).toPass({ timeout: 20_000 });

      // The normal (molecular) calculation panel is shown...
      await expect(page.locator(".calculation-form-grid").first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: "Run periodic energy" })).toHaveCount(0);
      // ...and none of the periodic fields exist.
      for (const id of ["periodic-setup-form", "periodic-kmesh-select", "periodic-magnetic-select", "periodic-plus-u-toggle", "periodic-u-input-Cr", "periodic-u-defaults-note"]) {
        await expect(page.locator(`[data-testid="${id}"]`)).toHaveCount(0);
      }
    });
  }
});
