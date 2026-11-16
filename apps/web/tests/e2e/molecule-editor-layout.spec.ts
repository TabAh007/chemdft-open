import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { EDITOR_PROJECT_ID, preferAdvancedWorkbench, setupEditorMocks, openImport, pickTemplate } from "./helpers/molecule-editor-mocks";

const output = resolve("../../output/playwright/molecule-editor");
mkdirSync(output, { recursive: true });

const VIEWPORTS = [
  { name: "1093x520", width: 1093, height: 520 },
  { name: "1024x600", width: 1024, height: 600 },
  { name: "1280x600", width: 1280, height: 600 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

async function open(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await setupEditorMocks(page);
  await preferAdvancedWorkbench(page);
  await page.goto(`/en/projects/${EDITOR_PROJECT_ID}/workspace`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Create molecule/i }).first().click({ timeout: 20_000 });
  await page.getByRole("button", { name: /Draw manually/i }).click();
  await expect(page.getByTestId("generate-3d-btn")).toBeEnabled({ timeout: 60_000 });
  await pickTemplate(page, "ethanol");
  await expect(page.getByTestId("check-formula")).toHaveText("C2H6O");
}

/** Remove every rule a Chrome 109 engine would drop (color-mix 111, text-wrap 114, subgrid 117, @starting-style, @scope, anchor positioning, field-sizing). */
async function stripPostChrome109Css(page: Page) {
  return page.evaluate(() => {
    const bad = /color-mix\(|text-wrap|subgrid|@starting-style|@scope|anchor-name|field-sizing/;
    let removed = 0;
    (window as unknown as { __removedRules: string[] }).__removedRules = [];
    const walk = (rules: CSSRuleList) => {
      for (let i = rules.length - 1; i >= 0; i -= 1) {
        const rule = rules[i] as CSSRule & { cssRules?: CSSRuleList; parentRule?: CSSRule | null; parentStyleSheet?: CSSStyleSheet | null };
        if (rule.cssRules && rule.cssRules.length && !/^@(media|supports)/.test(rule.cssText) === false) walk(rule.cssRules);
        if (bad.test(rule.cssText) && !rule.cssRules?.length) {
          const owner = (rule.parentRule as (CSSRule & { deleteRule?: (index: number) => void }) | null) ?? rule.parentStyleSheet;
          try { (window as unknown as { __removedRules: string[] }).__removedRules.push(rule.cssText.slice(0, 110)); owner?.deleteRule?.(i); removed += 1; } catch { /* cross-origin sheet */ }
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) { try { walk(sheet.cssRules); } catch { /* cross-origin */ } }
    return removed;
  });
}

/** Grow every visible label by ~40 % (Russian/German length) without changing its meaning. */
async function growLabels(page: Page) {
  await page.evaluate(() => {
    const roots = document.querySelectorAll('[data-testid="ketcher-editor-panel"] button, [data-testid="ketcher-editor-panel"] label, [data-testid="ketcher-editor-panel"] h1, [data-testid="ketcher-editor-panel"] p, [data-testid="ketcher-editor-panel"] span');
    roots.forEach((element) => {
      if (element.children.length > 0 || element.closest('[class*="frame"]')) return;
      const text = element.textContent ?? "";
      if (text.trim().length < 3) return;
      element.textContent = `${text}${"ы".repeat(Math.ceil(text.length * 0.4))}`;
    });
  });
}

type Metrics = {
  docOverflow: number;
  panelOverflow: number;
  bar: { top: number; bottom: number; height: number };
  generate: { top: number; bottom: number; left: number; right: number; width: number; height: number; whiteSpace: string; lines: number };
  panelTop: number;
  viewportWidth: number;
  viewportHeight: number;
  canvasHeight: number;
  buttons: { id: string; label: string; name: string; left: number; right: number; width: number; height: number; clipped: boolean }[];
  previewEmpty: boolean;
};

async function measure(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const rect = (element: Element | null) => (element ? element.getBoundingClientRect() : null);
    const panel = document.querySelector<HTMLElement>('[data-testid="ketcher-editor-panel"]')!.closest<HTMLElement>(".workbench-panel")!;
    const bar = rect(document.querySelector('[data-testid="editor-action-bar"]'))!;
    const gen = document.querySelector<HTMLElement>('[data-testid="generate-3d-btn"]')!;
    const genRect = gen.getBoundingClientRect();
    const doc = document.documentElement;
    const toolbarRect = rect(document.querySelector('[data-testid="editor-toolbar"]'))!;
    const rowRect = rect(document.querySelector('[data-testid="editor-atoms-row"]'))!;
    const frame = rect(document.querySelector('[data-testid="editor-canvas-frame"] [class~="Ketcher-root"] [data-testid="ketcher-canvas"]'))!;
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="tool-"], [data-testid^="atom-"], [data-testid^="group-"]')).map((button) => {
      const r = button.getBoundingClientRect();
      const label = (button.textContent ?? "").trim();
      const container = button.closest('[data-testid="editor-toolbar"]') ?? button.closest('[data-testid="editor-atoms-row"]');
      const c = container!.getBoundingClientRect();
      return {
        id: button.getAttribute("data-testid") ?? "",
        label,
        name: button.getAttribute("aria-label") ?? label,
        left: r.left, right: r.right, width: r.width, height: r.height,
        clipped: r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.width === 0 || r.height === 0,
      };
    });
    void toolbarRect; void rowRect;
    const lines = Math.round(genRect.height / parseFloat(getComputedStyle(gen).lineHeight || "18"));
    return {
      docOverflow: doc.scrollWidth - doc.clientWidth,
      panelOverflow: panel.scrollWidth - panel.clientWidth,
      bar: { top: bar.top, bottom: bar.bottom, height: bar.height },
      generate: { top: genRect.top, bottom: genRect.bottom, left: genRect.left, right: genRect.right, width: genRect.width, height: genRect.height, whiteSpace: getComputedStyle(gen).whiteSpace, lines },
      panelTop: panel.getBoundingClientRect().top,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      canvasHeight: frame.height,
      buttons,
      previewEmpty: Boolean(document.querySelector('[data-testid="editor-preview-empty"]')),
    };
  });
}

/** Compact chrome: >= 360 px at 1366x768, >= 300 px at the smaller laptop sizes. */
function minCanvas(width: number, height: number): number {
  return width >= 1366 && height >= 768 ? 360 : 300;
}

function assertFits(m: Metrics) {
  expect(m.docOverflow, "document horizontal overflow").toBeLessThanOrEqual(0);
  expect(m.panelOverflow, "editor pane horizontal overflow").toBeLessThanOrEqual(0);
  expect(m.bar.top, "action bar top inside pane").toBeGreaterThanOrEqual(m.panelTop - 1);
  expect(m.bar.bottom, "action bar bottom inside viewport").toBeLessThanOrEqual(m.viewportHeight);
  expect(m.generate.left).toBeGreaterThanOrEqual(0);
  expect(m.generate.right, "Generate 3D right edge inside viewport").toBeLessThanOrEqual(m.viewportWidth);
  expect(m.generate.bottom, "Generate 3D inside viewport").toBeLessThanOrEqual(m.viewportHeight);
  expect(m.generate.whiteSpace).toBe("nowrap");
  expect(m.generate.height, "Generate 3D label on one line").toBeLessThan(44);
  expect(m.canvasHeight, "canvas height").toBeGreaterThanOrEqual(minCanvas(m.viewportWidth, m.viewportHeight));
  expect(m.buttons.length).toBeGreaterThanOrEqual(30);
  for (const button of m.buttons) {
    expect(button.label, `${button.id} has a visible text label`).not.toBe("");
    expect(button.name, `${button.id} has an accessible name`).not.toBe("");
    expect(button.clipped, `${button.id} is fully visible inside its toolbar`).toBe(false);
  }
  expect(m.previewEmpty, "3D preview empty before Generate").toBe(true);
}

for (const vp of VIEWPORTS) {
  test.describe(`molecule editor layout ${vp.name}`, () => {
    test("fits without horizontal overflow; sticky bar, Generate 3D, labelled toolbar, canvas >= 300 px", async ({ page }) => {
      await open(page, vp.width, vp.height);
      const metrics = await measure(page);
      assertFits(metrics);
      await page.screenshot({ path: `${output}/compact-${vp.name}.png` });

      // Sticky: scroll the pane to the bottom, the bar and Generate 3D stay visible.
      await page.evaluate(() => document.querySelector('[data-testid="ketcher-editor-panel"]')!.closest<HTMLElement>(".workbench-panel")!.scrollTo(0, 99999));
      await page.waitForTimeout(150);
      const scrolled = await measure(page);
      assertFits(scrolled);
      expect(scrolled.bar.top, "sticky bar stays at the top of the pane").toBeLessThanOrEqual(scrolled.panelTop + 1);
      await page.screenshot({ path: `${output}/compact-${vp.name}-scrolled.png` });
    });

    test("with the context panel (AI Scientist drawer) open", async ({ page }) => {
      await open(page, vp.width, vp.height);
      const dock = page.getByTestId("ai-dock-toggle");
      if ((await dock.getAttribute("aria-pressed")) !== "true") await dock.click();
      await page.waitForTimeout(500);
      const metrics = await measure(page);
      expect(metrics.docOverflow).toBeLessThanOrEqual(0);
      expect(metrics.panelOverflow).toBeLessThanOrEqual(0);
      expect(metrics.generate.right).toBeLessThanOrEqual(metrics.viewportWidth);
      expect(metrics.canvasHeight).toBeGreaterThanOrEqual(300);
      await page.screenshot({ path: `${output}/compact-${vp.name}-drawer.png` });
    });

    test("Chrome 109 emulation (post-109 CSS removed)", async ({ page }) => {
      await open(page, vp.width, vp.height);
      const removed = await stripPostChrome109Css(page);
      await page.waitForTimeout(200);
      const metrics = await measure(page);
      console.log("REMOVED", JSON.stringify(await page.evaluate(() => (window as unknown as { __removedRules: string[] }).__removedRules)));
      console.log(`CHROME109 ${vp.name}: removed ${removed} post-109 rules; canvas ${Math.round(metrics.canvasHeight)} px`);
      assertFits(metrics);
      await page.screenshot({ path: `${output}/compact-${vp.name}-chrome109.png` });
    });

    test("labels 40 % longer (Russian-length simulation) do not clip or overflow", async ({ page }) => {
      await open(page, vp.width, vp.height);
      await growLabels(page);
      await page.waitForTimeout(200);
      const metrics = await measure(page);
      expect(metrics.docOverflow).toBeLessThanOrEqual(0);
      expect(metrics.panelOverflow).toBeLessThanOrEqual(0);
      expect(metrics.generate.right).toBeLessThanOrEqual(metrics.viewportWidth);
      expect(metrics.generate.whiteSpace).toBe("nowrap");
      expect(metrics.canvasHeight).toBeGreaterThanOrEqual(300);
      for (const button of metrics.buttons) expect(button.clipped, `${button.id} clipped under long labels`).toBe(false);
      await page.screenshot({ path: `${output}/compact-${vp.name}-ru.png` });
    });
  });
}


test.describe("molecule editor compact chrome", () => {
  test("project tabs and document toolbar are hidden while editing and return on close", async ({ page }) => {
    await open(page, 1366, 768);
    await expect(page.locator(".workspace-tabs")).toBeHidden();
    await expect(page.locator(".document-toolbar")).toBeHidden();
    await page.getByTestId("editor-cancel").click();
    await expect(page.locator(".workspace-tabs")).toBeVisible();
    await expect(page.locator(".document-toolbar")).toBeVisible();
  });

  test("action bar is one line (~44 px) at 1366x768 and 1280x600", async ({ page }) => {
    for (const [w, h] of [[1366, 768], [1280, 600], [1093, 520]] as const) {
      await open(page, w, h);
      const bar = await page.getByTestId("editor-action-bar").boundingBox();
      expect(bar!.height, `action bar height at ${w}x${h}`).toBeLessThanOrEqual(48);
    }
  });

  test("info popover carries the subtitle and schematic note; Escape closes it and returns focus", async ({ page }) => {
    await open(page, 1366, 768);
    await expect(page.getByTestId("editor-schematic-badge")).toHaveText("2D · schematic");
    await page.getByTestId("editor-info").click();
    await expect(page.getByTestId("editor-info-panel")).toContainText("2D drawing is schematic");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("editor-info-panel")).toHaveCount(0);
    await expect(page.getByTestId("editor-info")).toBeFocused();
  });

  test("Import popover: SMILES paste + Load works, invalid SMILES shows an error, closed popover shows a strip", async ({ page }) => {
    await open(page, 1366, 768);
    await openImport(page);
    await page.getByTestId("editor-load-input").fill("CC(=O");
    await page.getByTestId("editor-load-button").click();
    await expect(page.getByTestId("editor-load-message")).toHaveAttribute("role", "alert");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("editor-start-row")).toHaveCount(0);
    await expect(page.getByTestId("editor-load-message")).toBeVisible();
    await openImport(page);
    await page.getByTestId("editor-load-input").fill("CCO");
    await page.getByTestId("editor-load-button").click();
    await expect(page.getByTestId("check-formula")).toHaveText("C2H6O");
    await expect(page.getByTestId("editor-start-row")).toHaveCount(0);
  });

  test("Focus mode hides the app header and project navigation; Esc and the button restore; announced", async ({ page }) => {
    await open(page, 1366, 768);
    const before = (await page.getByTestId("editor-canvas-frame").boundingBox())!.height;
    await page.getByTestId("editor-focus").click();
    await expect(page.getByTestId("editor-focus")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("header.project-header")).toBeHidden();
    await expect(page.getByTestId("project-sections")).toBeHidden();
    await expect(page.getByTestId("editor-status")).toContainText("Focus mode on");
    await expect(page.getByTestId("generate-3d-btn")).toBeVisible();
    const focused = (await page.getByTestId("editor-canvas-frame").boundingBox())!.height;
    expect(focused, "canvas grows in focus mode").toBeGreaterThan(before + 60);
    await page.keyboard.press("Escape");
    await expect(page.locator("header.project-header")).toBeVisible();
    await expect(page.getByTestId("editor-status")).toContainText("Focus mode off");
    await page.getByTestId("editor-focus").click();
    await page.getByTestId("editor-focus").click();
    await expect(page.locator("header.project-header")).toBeVisible();
    // Keyboard shortcut.
    await page.keyboard.press("Control+Shift+F");
    await expect(page.locator("header.project-header")).toBeHidden();
    await page.getByTestId("editor-cancel").click();
    await expect(page.locator("header.project-header")).toBeVisible();
  });

  test("keyboard-only path: tab through the action bar, tool rail and atoms rail; Enter activates a tool", async ({ page }) => {
    await open(page, 1366, 768);
    await page.getByTestId("editor-back").focus();
    const order: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.id ?? ""));
    }
    const joined = order.join(",");
    expect(joined).toContain("editor-info");
    expect(joined).toContain("molecule-name-input");
    expect(joined).toContain("editor-import");
    expect(joined).toContain("generate-3d-btn");
    expect(joined).toContain("tool-select");
    await page.getByTestId("tool-bond-double").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tool-bond-double")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("atom-O").focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("atom-O")).toHaveAttribute("aria-pressed", "true");
  });

  test("tool rail and atoms rail sit beside the canvas, not above it", async ({ page }) => {
    await open(page, 1366, 768);
    const canvas = (await page.getByTestId("editor-canvas-frame").boundingBox())!;
    const rail = (await page.getByTestId("editor-toolbar").boundingBox())!;
    const atoms = (await page.getByTestId("editor-atoms-row").boundingBox())!;
    expect(rail.x + rail.width).toBeLessThanOrEqual(canvas.x + 1);
    expect(atoms.x).toBeGreaterThanOrEqual(canvas.x + canvas.width - 1);
    expect(Math.abs(rail.y - canvas.y)).toBeLessThan(4);
  });
});

test.describe("shell chrome (single-row header, pointer density, panel toggles)", () => {
  test("wide screens: project navigation sits inside the 42 px app header; narrower keeps two rows", async ({ page }) => {
    await open(page, 1366, 768);
    const wide = await page.evaluate(() => {
      const header = document.querySelector("header.project-header")!.getBoundingClientRect();
      const nav = document.querySelector('[data-testid="project-sections"]')!;
      const r = nav.getBoundingClientRect();
      return { headerH: header.height, navBottom: r.bottom, inHeader: Boolean(nav.closest("header.project-header")), links: nav.querySelectorAll("a").length };
    });
    expect(wide.inHeader).toBe(true);
    expect(wide.navBottom).toBeLessThanOrEqual(wide.headerH + 1);
    expect(wide.links, "no project tab removed").toBe(8);
    const action = (await page.getByTestId("editor-action-bar").boundingBox())!;
    expect(action.y, "action bar directly under the one-row header").toBeLessThanOrEqual(46);

    await open(page, 1093, 520);
    const narrow = await page.evaluate(() => ({ inHeader: Boolean(document.querySelector('[data-testid="project-sections"]')!.closest("header.project-header")), links: document.querySelectorAll('[data-testid="project-sections"] a').length }));
    expect(narrow.inHeader).toBe(false);
    expect(narrow.links).toBe(8);
  });

  test("header controls are compact for a mouse (<= 42 px) but not below 24 px", async ({ page }) => {
    await open(page, 1280, 600);
    const sizes = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("header.project-header a, header.project-header button")).filter((e) => e.offsetParent !== null).map((e) => ({ t: (e.textContent ?? e.getAttribute("aria-label") ?? "").trim().slice(0, 20), h: e.getBoundingClientRect().height })));
    for (const item of sizes) { expect(item.h, item.t).toBeLessThanOrEqual(42); expect(item.h, item.t).toBeGreaterThanOrEqual(24); }
  });

  test("panel toggles are icon buttons with tooltips below 1280 px and keep full text from 1280 px", async ({ page }) => {
    await open(page, 1366, 768);
    await page.getByTestId("editor-cancel").click();
    const explorer = page.getByRole("button", { name: /Explorer/ }).first();
    expect(await explorer.textContent()).toContain("Explorer");
    expect(await explorer.evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(70);
    await page.setViewportSize({ width: 1100, height: 700 });
    expect(await explorer.getAttribute("title")).toMatch(/Explorer/);
    expect(await explorer.evaluate((e) => e.getBoundingClientRect().width)).toBeLessThanOrEqual(40);
    expect(await explorer.evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThanOrEqual(24);
  });
});
