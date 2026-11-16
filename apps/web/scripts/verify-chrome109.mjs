import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import reference from "../src/app/_components/home/reference/cr2o3-reference.json" with { type: "json" };

const DEG = Math.PI / 180;
function calcLatticeVectors(l) {
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

const cr2o3Detail = {
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

const OUT = path.resolve("../../output/chrome109/after");
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "1093x520_dpr1.25", width: 1093, height: 520, dpr: 1.25 },
  { name: "1366x640_dpr1", width: 1366, height: 640, dpr: 1.0 },
  { name: "1280x600_dpr1", width: 1280, height: 600, dpr: 1.0 },
  { name: "1024x600_dpr1", width: 1024, height: 600, dpr: 1.0 },
  { name: "1024x600_dpr1.25", width: 1024, height: 600, dpr: 1.25 },
];

async function setupRoutes(page, emulateChrome109 = false, emulateTranslation = false) {
  await page.route("**/api/chemdft/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path.includes("/structures/s-cr2o3/versions/v-cr2o3-1")) {
      return route.fulfill({ json: cr2o3Detail });
    }
    if (path.includes("/structures/s-cr2o3/versions")) {
      return route.fulfill({ json: [cr2o3Detail] });
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
          allowed_tools: ["ask_ai_scientist", "plan_investigation"], can_write: true, generated_at: "2026-10-26T10:00:00Z", human_id: "mock", navigator: { blocked: [], goal: null, have: [], next: [], notices: [] },
          organization_id: "00000000-0000-4000-8000-0000000000f0", project_id: "cr2o3-proj", project_kind: "RESEARCH", project_name: "Cr2O3 eskolaite investigation", published_example: false,
          resources: [], role: "OWNER", sealed: false, selection: {},
        },
      });
    }
    if (path.includes("/ai/conversations")) {
      const conv = { id: "conv-1", project_id: "cr2o3-proj", title: "Scientific conversation", created_at: "2026-10-26T10:00:00Z", updated_at: "2026-10-26T10:00:00Z" };
      const msgs = [
        { id: "m-1", conversation_id: "conv-1", role: "user", content: "Tell me about Cr2O3 eskolaite cell", created_at: "2026-10-26T10:00:00Z" },
        { id: "m-2", conversation_id: "conv-1", role: "assistant", content: "Nemotron 3.5 Lightning 30B: Eskolaite is a trigonal chromium oxide mineral with space group R-3c (No. 167) and 30 atoms per unit cell.", created_at: "2026-10-26T10:00:05Z" },
      ];
      if (path.endsWith("/ai/conversations") && request.method() === "GET") return route.fulfill({ json: { conversations: [conv] } });
      return route.fulfill({ json: { conversation: conv, latest_run: { id: "run-1", state: "COMPLETED", model: "nemotron-3.5-lightning" }, messages: msgs } });
    }
    if (path.includes("/investigations")) {
      return route.fulfill({ json: { investigations: [] } });
    }
    if (path.includes("/ai/settings")) {
      return route.fulfill({
        json: {
          availability: {
            allowance_status: "AVAILABLE",
            available: true,
            byok_enabled: false,
            managed_enabled: true,
            mode: "MANAGED",
            model: "nemotron-3.5-lightning",
            provider: "NVIDIA",
            secret_storage_available: true,
          },
          credentials: [],
          preferences: {
            provider: "NVIDIA",
            model: "nemotron-3.5-lightning",
          },
          providers: [
            {
              provider: "NVIDIA",
              models: ["nemotron-3.5-lightning"],
              local_test_only: false,
            },
          ],
          model_capabilities: [
            {
              provider: "NVIDIA",
              model_identifier: "nemotron-3.5-lightning",
              display_name: "Nemotron 3.5 Lightning 30B",
              status: "APPROVED",
              eligibility: "PRODUCTION",
              selectable: true,
              configured: true,
              reviewed_on: "2026-10-26",
              tool_compatibility_verified: true,
              verification_scope: "Structured function calling",
              proposal_workflow_verified: true,
            },
          ],
        },
      });
    }
    if (path.endsWith("/projects/cr2o3-proj")) {
      return route.fulfill({
        json: { id: "cr2o3-proj", name: "Cr2O3 eskolaite investigation" },
      });
    }
    if (path.endsWith("/me")) {
      return route.fulfill({
        json: { id: "user-1", email: "researcher@example.com", name: "Researcher" },
      });
    }
    return route.fulfill({ json: {} });
  });

  // Emulate Chrome 109 by stripping color-mix(), text-wrap, subgrid
  if (emulateChrome109) {
    await page.route("**/*.css*", async (route) => {
      const response = await route.fetch();
      let css = await response.text();
      // Remove declarations containing color-mix, text-wrap, subgrid
      css = css.replace(/[^;{}]+:\s*[^;{}]*color-mix\([^;{}]+\)[^;{}]*;?/gi, "/* stripped-color-mix */");
      css = css.replace(/text-wrap\s*:\s*[^;{}]+;?/gi, "/* stripped-text-wrap */");
      css = css.replace(/grid-template-[a-z]+\s*:\s*subgrid[^;{}]*;?/gi, "/* stripped-subgrid */");
      return route.fulfill({
        response,
        body: css,
        headers: { ...response.headers(), "content-type": "text/css" },
      });
    });
  }

  // Pre-seed storage
  await page.addInitScript(({ translation }) => {
    try {
      localStorage.setItem("chemdft:workspace-mode", "guided");
    } catch {}
    if (translation) {
      // Simulate ~30-40% longer labels like Russian / German translation
      const style = document.createElement("style");
      style.textContent = `
        * { letter-spacing: 0.04em !important; }
        .crumb strong::after { content: " (модель ячейки)"; }
        .project-identity::after { content: " (исследование)"; }
      `;
      document.documentElement.appendChild(style);
    }
    try {
      localStorage.removeItem("chemdft:panels:cr2o3-proj:dock");
      localStorage.removeItem("chemdft:panels:cr2o3-proj:guided-ai-dock");
    } catch {}
  }, { translation: emulateTranslation });
}

async function navigateToStructureStage(page, openAi = false) {
  await page.goto("/en/projects/cr2o3-proj/workspace", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  // If on Guided home, click inspect 3D geometry or structures nav
  const inspectBtn = page.locator('[data-testid="guided-inspect-geom-btn"]');
  const navStructure = page.locator('[data-testid="guided-nav-structure"]');
  if (await inspectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log("  Clicking Inspect 3D geometry button...");
    await inspectBtn.dispatchEvent("click");
  } else if (await navStructure.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log("  Clicking nav Structure button...");
    await navStructure.dispatchEvent("click");
  }

  // Wait for canvas to appear
  await page.waitForSelector(".scientific-canvas canvas", { timeout: 8000 }).catch((e) => {
    console.log("  Notice: canvas selector wait:", e.message);
  });
  await page.waitForTimeout(1000);

  if (openAi) {
    const aiToggle = page.locator('[data-testid="ai-dock-toggle"]');
    const aiPanelCheck = page.locator('[data-testid="ai-scientist-panel"]');
    if (await aiToggle.isVisible() && !(await aiPanelCheck.isVisible())) {
      console.log("  Opening AI scientist dock...");
      await aiToggle.click();
      await page.waitForTimeout(600);
    }
  }
}

async function measureMetrics(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const canvasEl = document.querySelector(".scientific-canvas canvas");
    const canvasHost = document.querySelector(".scientific-canvas");
    const viewerPanel = document.querySelector('[data-testid="guided-viewer"]');
    const canvasWrap = document.querySelector('[class*="canvas"]');
    const stages = document.querySelector('[data-testid="guided-stages"]');
    const toolbar = document.querySelector('[class*="toolbar"]');
    const head = document.querySelector('[class*="head"]');
    const aiPanel = document.querySelector('[data-testid="ai-scientist-panel"]');
    const resetBtn = document.querySelector('[data-testid="guided-reset-view-btn"]');
    const stageBtn = document.querySelector('[data-testid="guided-stage-review"]');

    return {
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      hasHorizontalOverflow: doc.scrollWidth > doc.clientWidth,
      canvasHostHeight: canvasHost ? canvasHost.getBoundingClientRect().height : 0,
      canvasBufferHeight: canvasEl ? canvasEl.height : 0,
      canvasRenderedHeight: canvasEl ? canvasEl.getBoundingClientRect().height : 0,
      canvasWrapHeight: canvasWrap ? canvasWrap.getBoundingClientRect().height : 0,
      viewerPanelHeight: viewerPanel ? viewerPanel.getBoundingClientRect().height : 0,
      aiPanelWidth: aiPanel ? aiPanel.getBoundingClientRect().width : 0,
      isResetBtnVisible: resetBtn ? (resetBtn.getBoundingClientRect().right <= window.innerWidth) : false,
      isStageBtnVisible: stageBtn ? (stageBtn.getBoundingClientRect().right <= window.innerWidth) : false,
    };
  });
}

async function run() {
  console.log("Launching Chromium for After Verification...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
  });

  const report = [];
  let allPass = true;

  for (const vp of VIEWPORTS) {
    console.log(`\nTesting viewport: ${vp.name} (${vp.width}x${vp.height} @ ${vp.dpr}x)`);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.dpr,
      baseURL: "http://127.0.0.1:3210",
    });
    const page = await context.newPage();
    page.on("requestfailed", (req) => console.log("REQUEST FAILED:", req.url(), req.failure()?.errorText));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("PAGE ERROR:", msg.text());
    });
    await setupRoutes(page, false, false);
    await navigateToStructureStage(page);

    const metrics = await measureMetrics(page);
    console.log(`  After Metrics:`, metrics);
    report.push({ viewport: vp.name, ...metrics });

    if (metrics.hasHorizontalOverflow) {
      console.error(`  FAIL: Horizontal overflow detected at ${vp.name} (scrollWidth: ${metrics.docScrollWidth}, clientWidth: ${metrics.docClientWidth})`);
      allPass = false;
    }
    // Verify canvas rendered height matches host height (no 520px canvas trapped in 240px container)
    if (metrics.canvasHostHeight > metrics.canvasWrapHeight + 5) {
      console.error(`  FAIL: Canvas host height (${metrics.canvasHostHeight}px) overflows canvas wrap (${metrics.canvasWrapHeight}px)!`);
      allPass = false;
    }

    const shotPath = path.join(OUT, `after_${vp.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`  Saved screenshot: ${shotPath}`);

    await context.close();
  }

  // Also test AI Scientist drawer overlay on small screen
  console.log("\nTesting AI Scientist drawer overlay on 1093x520...");
  {
    const context = await browser.newContext({
      viewport: { width: 1093, height: 520 },
      deviceScaleFactor: 1.25,
      baseURL: "http://127.0.0.1:3210",
    });
    const page = await context.newPage();
    await setupRoutes(page, false, false);
    await navigateToStructureStage(page, true);

    const shotPath = path.join(OUT, `after_1093x520_ai_dock_drawer.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`  Saved: ${shotPath}`);
    await context.close();
  }

  // Also run Chrome 109 emulation on 1093x520
  console.log("\nRunning Chrome 109 emulation on 1093x520...");
  {
    const context = await browser.newContext({
      viewport: { width: 1093, height: 520 },
      deviceScaleFactor: 1.25,
      baseURL: "http://127.0.0.1:3210",
    });
    const page = await context.newPage();
    await setupRoutes(page, true, false);
    await navigateToStructureStage(page);

    const metrics = await measureMetrics(page);
    console.log(`  After Chrome 109 metrics:`, metrics);
    report.push({ viewport: "chrome109_emulated_1093x520", ...metrics });

    if (metrics.hasHorizontalOverflow) {
      console.error(`  FAIL: Horizontal overflow in Chrome 109 emulation!`);
      allPass = false;
    }

    const shotPath = path.join(OUT, `after_chrome109_emulated_1093x520.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`  Saved: ${shotPath}`);
    await context.close();
  }

  // Also run translation simulation on 1093x520 and 1024x600
  console.log("\nRunning Translation simulation on 1093x520 and 1024x600...");
  for (const vp of [VIEWPORTS[0], VIEWPORTS[3]]) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.dpr,
      baseURL: "http://127.0.0.1:3210",
    });
    const page = await context.newPage();
    await setupRoutes(page, false, true);
    await navigateToStructureStage(page);

    const metrics = await measureMetrics(page);
    console.log(`  After Translation (${vp.name}) metrics:`, metrics);
    report.push({ viewport: `translation_${vp.name}`, ...metrics });

    if (metrics.hasHorizontalOverflow) {
      console.error(`  FAIL: Horizontal overflow with translation at ${vp.name}!`);
      allPass = false;
    }

    const shotPath = path.join(OUT, `after_translation_${vp.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`  Saved: ${shotPath}`);
    await context.close();
  }

  await browser.close();
  console.log("\nVerification complete! Results:", JSON.stringify(report, null, 2));
  if (!allPass) {
    throw new Error("One or more layout verification checks failed.");
  }
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
