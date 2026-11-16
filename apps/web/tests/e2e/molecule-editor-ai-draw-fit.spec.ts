import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { EDITOR_PROJECT_ID, preferAdvancedWorkbench, setupEditorMocks } from "./helpers/molecule-editor-mocks";

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve("../../output/playwright/molecule-editor");
mkdirSync(output, { recursive: true });
const fixture = (name: string) => JSON.parse(readFileSync(join(here, "fixtures", "ai-draw", `${name}.json`), "utf8")) as Record<string, unknown>;

const VIEWPORTS = [
  { name: "1093x520", width: 1093, height: 520 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

async function open(page: Page, width: number, height: number, script: string[]) {
  await page.setViewportSize({ width, height });
  await setupEditorMocks(page);
  const queue = script.map(fixture);
  await page.route("**/ai/conversations", (r) => (r.request().method() === "POST" ? r.fulfill({ status: 201, json: { conversation: { id: "c1" }, messages: [] } }) : r.fallback()));
  await page.route("**/draw", (r) => r.fulfill({ json: queue.shift() ?? fixture("refused") }));
  await preferAdvancedWorkbench(page);
  await page.goto(`/en/projects/${EDITOR_PROJECT_ID}/workspace`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Create molecule/i }).first().click({ timeout: 20_000 });
  await page.getByRole("button", { name: /Draw manually/i }).click();
  await expect(page.getByTestId("generate-3d-btn")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("editor-tab-ai").click();
}

async function ask(page: Page, text: string) {
  await page.getByTestId("ai-draw-input").fill(text);
  await page.getByTestId("ai-draw-send").click();
  await expect(page.getByTestId("ai-draw-send")).toHaveText("Send", { timeout: 30_000 });
}

/** Atom and bond positions on screen (px) and the canvas rectangle, read from Ketcher's own render state. */
async function measure(page: Page) {
  return page.evaluate(() => {
    type Vec = { x: number; y: number };
    const k = (window as unknown as { __ketcher: { editor: { zoom(): number; render: { options: { microModeScale: number; zoom: number }; clientArea: HTMLElement; viewBox: { minX: number; minY: number }; ctab: { atoms: Map<number, { a: { pp: Vec } }>; bonds: Map<number, { b: { begin: number; end: number } }> } } } } }).__ketcher;
    const render = k.editor.render;
    const micro = render.options.microModeScale;
    const zoom = render.options.zoom;
    const area = render.clientArea.getBoundingClientRect();
    const at = (pp: Vec) => ({ x: area.left + (pp.x * micro - render.viewBox.minX) * zoom, y: area.top + (pp.y * micro - render.viewBox.minY) * zoom });
    const atoms = [...render.ctab.atoms.values()].map((atom) => at(atom.a.pp));
    const bonds = [...render.ctab.bonds.values()].map((bond) => {
      const a = render.ctab.atoms.get(bond.b.begin)!.a.pp;
      const b = render.ctab.atoms.get(bond.b.end)!.a.pp;
      return Math.hypot((a.x - b.x) * micro * zoom, (a.y - b.y) * micro * zoom);
    });
    return { zoom: k.editor.zoom(), area: { left: area.left, top: area.top, right: area.right, bottom: area.bottom }, atoms, bonds };
  });
}

function assertInside(m: Awaited<ReturnType<typeof measure>>, pad = 6) {
  expect(m.atoms.length).toBeGreaterThan(0);
  for (const p of m.atoms) {
    expect(p.x).toBeGreaterThanOrEqual(m.area.left + pad);
    expect(p.x).toBeLessThanOrEqual(m.area.right - pad);
    expect(p.y).toBeGreaterThanOrEqual(m.area.top + pad);
    expect(p.y).toBeLessThanOrEqual(m.area.bottom - pad);
  }
}

test.describe("Draw mode: the drawing stays in view at a readable size (mock transport, real Ketcher)", () => {
  for (const vp of VIEWPORTS) {
    test(`6 waters at ${vp.name}: every atom inside the canvas, readable spacing`, async ({ page }) => {
      await open(page, vp.width, vp.height, ["six-waters"]);
      await ask(page, "draw 6 water molecules");
      await expect(page.getByTestId("ai-draw-message-assistant")).toHaveAttribute("data-status", "OK");
      const m = await measure(page);
      expect(m.atoms).toHaveLength(18); // each water is O + 2 H as real atoms, not a bare "H2O" label
      expect(m.bonds).toHaveLength(12);
      assertInside(m);
      expect(m.zoom).toBeGreaterThanOrEqual(0.5);
      expect(Math.min(...m.bonds)).toBeGreaterThanOrEqual(18);
      await page.screenshot({ path: join(output, `ai-draw-fit-6-waters-${vp.name}.png`) });
    });

    test(`3 ethanol at ${vp.name}: atoms inside, minimum rendered bond length`, async ({ page }) => {
      await open(page, vp.width, vp.height, ["three-ethanol"]);
      await ask(page, "draw 3 ethanol");
      const m = await measure(page);
      expect(m.atoms).toHaveLength(9);
      assertInside(m);
      expect(Math.min(...m.bonds)).toBeGreaterThanOrEqual(18);
    });
  }

  test("12 copies stay inside the canvas at a readable zoom at 1366x768", async ({ page }) => {
    await open(page, 1366, 768, ["twelve-ethanol"]);
    await ask(page, "draw 12 ethanol");
    const m = await measure(page);
    expect(m.atoms).toHaveLength(36);
    assertInside(m);
    expect(Math.min(...m.bonds)).toBeGreaterThanOrEqual(18);
  });

  test("a drawing too large to fit readably is fitted on its main fragment; Fit all shows everything", async ({ page }) => {
    await open(page, 1093, 520, ["big-chain"]);
    await ask(page, "draw a long chain and two waters");
    await expect(page.getByTestId("ai-draft-partial-view")).toBeVisible();
    const partial = await measure(page);
    expect(partial.zoom).toBeGreaterThanOrEqual(0.5);
    expect(Math.min(...partial.bonds)).toBeGreaterThanOrEqual(18);
    await page.getByTestId("ai-draft-fit").click();
    await expect.poll(async () => (await measure(page)).zoom).toBeLessThanOrEqual(partial.zoom);
  });

  test("Fit button re-centres the drawing after the user zoomed and panned away", async ({ page }) => {
    await open(page, 1366, 768, ["three-ethanol"]);
    await ask(page, "draw 3 ethanol");
    await page.evaluate(() => {
      const k = (window as unknown as { __ketcher: { editor: { zoom(v: number): number } } }).__ketcher;
      k.editor.zoom(3.5);
    });
    await page.getByTestId("ai-draft-fit").click();
    await expect.poll(async () => (await measure(page)).zoom).toBeLessThan(3);
    assertInside(await measure(page));
  });

  test("a plain Fit button is available before any AI draft", async ({ page }) => {
    await open(page, 1366, 768, []);
    await expect(page.getByTestId("editor-fit")).toBeVisible();
  });

  test("6 waters: info line instead of a warning, combined formula and per-molecule count in the checks card", async ({ page }) => {
    await open(page, 1366, 768, ["six-waters"]);
    await ask(page, "draw 6 water molecules");
    await expect(page.getByTestId("ai-draw-info")).toHaveText("6 molecules");
    await expect(page.getByText(/separate fragments/)).toHaveCount(0);
    await expect(page.getByTestId("check-formula")).toHaveText("H12O6");
    await expect(page.getByTestId("check-molecules")).toHaveText("6 × H2O");
    await expect(page.getByTestId("check-heavy-atoms")).toHaveText("6");
  });

  test("clear: the drawing becomes empty, Undo last step brings it back", async ({ page }) => {
    await open(page, 1366, 768, ["ethanol", "clear"]);
    await ask(page, "draw ethanol");
    await expect.poll(() => page.getByTestId("editor-smiles").innerText()).toBe("CCO");
    await ask(page, "clear the drawing");
    await expect.poll(async () => (await measure(page)).atoms.length).toBe(0);
    await page.getByTestId("ai-draft-undo-last").click();
    await expect.poll(() => page.getByTestId("editor-smiles").innerText()).toBe("CCO");
    assertInside(await measure(page));
  });

  test("needs-attention is shown honestly, never as Done", async ({ page }) => {
    await open(page, 1366, 768, ["needs-attention"]);
    await ask(page, "draw 6 water molecules");
    const bubble = page.getByTestId("ai-draw-message-assistant");
    await expect(bubble).toHaveAttribute("data-status", "NEEDS_ATTENTION");
    await expect(bubble).toContainText("Needs attention");
    await expect(bubble).not.toContainText("Done");
  });
});
