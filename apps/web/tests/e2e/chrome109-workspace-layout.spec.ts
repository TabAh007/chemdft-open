import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
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

type ProjectedBoundsData = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  midX: number;
  midY: number;
  allInside: boolean;
};

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

const output = resolve("../../output/playwright/chrome109-workspace");
mkdirSync(output, { recursive: true });

const VIEWPORTS = [
  { name: "1093x520", width: 1093, height: 520 },
  { name: "1024x600", width: 1024, height: 600 },
  { name: "1280x600", width: 1280, height: 600 },
  { name: "1366x768", width: 1366, height: 768 },
];

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
    if (path.includes("/ai/conversations")) {
      return route.fulfill({ json: { conversations: [] } });
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

test.describe("Chrome 109 & Small Laptop Responsive Workspace Refinement", () => {
  for (const vp of VIEWPORTS) {
    test(`[${vp.name}] fits viewer panel and note in viewport with camera centered (drawer closed)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const detail = makeCr2O3Detail("Cr2O3 eskolaite unit cell");
      await setupMockRoutes(page, detail);

      await page.addInitScript(() => {
        try {
          localStorage.setItem("chemdft:workspace-mode", "guided");
          localStorage.removeItem("chemdft:panels:cr2o3-proj:dock");
          localStorage.removeItem("chemdft:panels:cr2o3-proj:guided-ai-dock");
        } catch {}
      });

      await page.goto("/en/projects/cr2o3-proj/workspace", { waitUntil: "networkidle" });

      // Navigate to Structure stage if on home
      const inspectBtn = page.locator('[data-testid="guided-inspect-geom-btn"]');
      const navStructure = page.locator('[data-testid="guided-nav-structure"]');
      if (await inspectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await inspectBtn.dispatchEvent("click");
      } else if (await navStructure.isVisible({ timeout: 3000 }).catch(() => false)) {
        await navStructure.dispatchEvent("click");
      }

      await page.waitForSelector(".scientific-canvas canvas", { timeout: 8000 });
      await page.waitForTimeout(600);

      const metrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const canvasEl = document.querySelector(".scientific-canvas canvas");
        const canvasHost = document.querySelector<HTMLElement>(".scientific-canvas");
        const noteEl = document.querySelector<HTMLElement>('[class*="viewerNote"]');
        const pane = document.querySelector<HTMLElement>(".guided-view-pane");
        const strongEl = document.querySelector<HTMLElement>('[class*="crumb"] strong');

        let projectedBounds: ProjectedBoundsData | null = null;
        if (canvasHost?.dataset.projectedBounds) {
          try { projectedBounds = JSON.parse(canvasHost.dataset.projectedBounds) as ProjectedBoundsData; } catch {}
        }

        const cRect = canvasEl ? canvasEl.getBoundingClientRect() : null;
        const nRect = noteEl ? noteEl.getBoundingClientRect() : null;

        return {
          docScrollWidth: doc.scrollWidth,
          docClientWidth: doc.clientWidth,
          winHeight: window.innerHeight,
          winWidth: window.innerWidth,
          paneScrollTop: pane ? pane.scrollTop : 0,
          canvasTop: cRect ? cRect.top : 0,
          canvasBottom: cRect ? cRect.bottom : 0,
          canvasHeight: cRect ? cRect.height : 0,
          noteTop: nRect ? nRect.top : 0,
          noteBottom: nRect ? nRect.bottom : 0,
          titleTooltip: strongEl ? strongEl.getAttribute("title") : null,
          projectedBounds,
        };
      });

      console.log(`[${vp.name} CLOSED] metrics:`, metrics);

      // 1. Zero horizontal page overflow
      expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.docClientWidth + 1);

      // 2. Initial state has zero page scroll
      expect(metrics.paneScrollTop).toBe(0);

      // 3. Canvas is fully visible inside the visible area without scrolling
      expect(metrics.canvasTop).toBeGreaterThanOrEqual(0);
      expect(metrics.canvasBottom).toBeLessThanOrEqual(metrics.winHeight);
      expect(metrics.canvasHeight).toBeGreaterThanOrEqual(200);

      // 4. Viewer note is fully inside the viewport without scrolling
      expect(metrics.noteTop).toBeGreaterThanOrEqual(0);
      expect(metrics.noteBottom).toBeLessThanOrEqual(metrics.winHeight);

      // 5. Title tooltip is present for breadcrumb title
      expect(metrics.titleTooltip).toContain("Cr2O3 eskolaite unit cell");

      // 6. Projected cell/atom bounds centered within 5% of canvas center, nothing outside [-1, 1]
      expect(metrics.projectedBounds).not.toBeNull();
      expect(Math.abs(metrics.projectedBounds!.midX)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(metrics.projectedBounds!.midY)).toBeLessThanOrEqual(0.05);
      expect(metrics.projectedBounds!.allInside).toBe(true);
      expect(metrics.projectedBounds!.minX).toBeGreaterThanOrEqual(-1.0);
      expect(metrics.projectedBounds!.maxX).toBeLessThanOrEqual(1.0);
      expect(metrics.projectedBounds!.minY).toBeGreaterThanOrEqual(-1.0);
      expect(metrics.projectedBounds!.maxY).toBeLessThanOrEqual(1.0);

      await page.screenshot({ path: resolve(output, `workspace-${vp.name}-drawer-closed.png`) });
    });

    test(`[${vp.name}] opens AI drawer without breaking zero horizontal overflow or viewer layout`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const detail = makeCr2O3Detail("Cr2O3 eskolaite unit cell");
      await setupMockRoutes(page, detail);

      await page.addInitScript(() => {
        try {
          localStorage.setItem("chemdft:workspace-mode", "guided");
        } catch {}
      });

      await page.goto("/en/projects/cr2o3-proj/workspace", { waitUntil: "networkidle" });

      const inspectBtn = page.locator('[data-testid="guided-inspect-geom-btn"]');
      const navStructure = page.locator('[data-testid="guided-nav-structure"]');
      if (await inspectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await inspectBtn.dispatchEvent("click");
      } else if (await navStructure.isVisible({ timeout: 3000 }).catch(() => false)) {
        await navStructure.dispatchEvent("click");
      }

      await page.waitForSelector(".scientific-canvas canvas", { timeout: 8000 });

      // Open AI drawer
      const dockToggle = page.locator('[data-testid="ai-dock-toggle"]');
      if (await dockToggle.isVisible()) {
        await dockToggle.click();
        await page.waitForTimeout(500);
      }

      const metrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const canvasHost = document.querySelector<HTMLElement>(".scientific-canvas");
        let projectedBounds: ProjectedBoundsData | null = null;
        if (canvasHost?.dataset.projectedBounds) {
          try { projectedBounds = JSON.parse(canvasHost.dataset.projectedBounds) as ProjectedBoundsData; } catch {}
        }
        return {
          docScrollWidth: doc.scrollWidth,
          docClientWidth: doc.clientWidth,
          projectedBounds,
        };
      });

      console.log(`[${vp.name} DRAWER OPEN] metrics:`, metrics);

      // Zero horizontal page overflow with AI drawer open
      expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.docClientWidth + 1);

      await page.screenshot({ path: resolve(output, `workspace-${vp.name}-drawer-open.png`) });
    });

    test(`[${vp.name}] handles Russian-length translation simulation with clean header wrap and visible viewer`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const ruStructureName = "Кристаллическая решётка оксида хрома(III) Cr2O3 (эсколаит)";
      const detail = makeCr2O3Detail(ruStructureName);
      await setupMockRoutes(page, detail);

      await page.addInitScript(() => {
        try {
          localStorage.setItem("chemdft:workspace-mode", "guided");
          localStorage.removeItem("chemdft:panels:cr2o3-proj:dock");
        } catch {}
      });

      // Navigate with Russian locale
      await page.goto("/ru/projects/cr2o3-proj/workspace", { waitUntil: "networkidle" });

      const inspectBtn = page.locator('[data-testid="guided-inspect-geom-btn"]');
      const navStructure = page.locator('[data-testid="guided-nav-structure"]');
      if (await inspectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await inspectBtn.dispatchEvent("click");
      } else if (await navStructure.isVisible({ timeout: 3000 }).catch(() => false)) {
        await navStructure.dispatchEvent("click");
      }

      await page.waitForSelector(".scientific-canvas canvas", { timeout: 8000 });
      await page.waitForTimeout(600);

      const metrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const noteEl = document.querySelector<HTMLElement>('[class*="viewerNote"]');
        const strongEl = document.querySelector<HTMLElement>('[class*="crumb"] strong');
        const nRect = noteEl ? noteEl.getBoundingClientRect() : null;

        return {
          docScrollWidth: doc.scrollWidth,
          docClientWidth: doc.clientWidth,
          winHeight: window.innerHeight,
          noteBottom: nRect ? nRect.bottom : 0,
          titleTooltip: strongEl ? strongEl.getAttribute("title") : null,
        };
      });

      console.log(`[${vp.name} RU SIMULATION] metrics:`, metrics);

      // 1. Zero horizontal overflow even with long Russian strings
      expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.docClientWidth + 1);

      // 2. Viewer note still fits inside viewport
      expect(metrics.noteBottom).toBeLessThanOrEqual(metrics.winHeight);

      // 3. Full Russian title is preserved in tooltip
      expect(metrics.titleTooltip).toContain(ruStructureName);

      await page.screenshot({ path: resolve(output, `workspace-${vp.name}-ru.png`) });
    });
  }
});
