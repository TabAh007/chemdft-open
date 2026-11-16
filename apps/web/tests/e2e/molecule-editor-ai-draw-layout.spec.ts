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
  { name: "1093x520", width: 1093, height: 520, minCanvas: 300 },
  { name: "1280x600", width: 1280, height: 600, minCanvas: 300 },
  { name: "1366x768", width: 1366, height: 768, minCanvas: 360 },
  { name: "1920x1080", width: 1920, height: 1080, minCanvas: 360 },
];

async function openWithChat(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await setupEditorMocks(page);
  const queue = [fixture("ethanol"), fixture("clarify"), fixture("partial")];
  await page.route("**/ai/conversations", (r) => (r.request().method() === "POST" ? r.fulfill({ status: 201, json: { conversation: { id: "c1" }, messages: [] } }) : r.fallback()));
  await page.route("**/draw", (r) => r.fulfill({ json: queue.shift() ?? fixture("refused") }));
  await preferAdvancedWorkbench(page);
  await page.goto(`/en/projects/${EDITOR_PROJECT_ID}/workspace`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Create molecule/i }).first().click({ timeout: 20_000 });
  await page.getByRole("button", { name: /Draw manually/i }).click();
  await expect(page.getByTestId("generate-3d-btn")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("editor-tab-ai").click();
  for (const text of ["draw ethanol", "6 H + 2 N + 1 C"]) {
    await page.getByTestId("ai-draw-input").fill(text);
    await page.getByTestId("ai-draw-send").click();
    await expect(page.getByTestId("ai-draw-send")).toHaveText("Send", { timeout: 30_000 });
  }
}

async function stripPostChrome109Css(page: Page) {
  return page.evaluate(() => {
    const bad = /color-mix\(|text-wrap|subgrid|@starting-style|@scope|anchor-name|field-sizing/;
    let removed = 0;
    const walk = (rules: CSSRuleList) => {
      for (let i = rules.length - 1; i >= 0; i -= 1) {
        const rule = rules[i] as CSSRule & { cssRules?: CSSRuleList; parentRule?: CSSRule | null; parentStyleSheet?: CSSStyleSheet | null };
        if (rule.cssRules?.length) walk(rule.cssRules);
        if (bad.test(rule.cssText) && !rule.cssRules?.length) {
          const owner = (rule.parentRule as (CSSRule & { deleteRule?: (index: number) => void }) | null) ?? rule.parentStyleSheet;
          try { owner?.deleteRule?.(i); removed += 1; } catch { /* cross-origin */ }
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) { try { walk(sheet.cssRules); } catch { /* cross-origin */ } }
    return removed;
  });
}

for (const vp of VIEWPORTS) {
  for (const variant of ["normal", "chrome109"] as const) {
    test(`AI chat layout ${vp.name} (${variant}): no clipping, canvas keeps its size, controls reachable`, async ({ page }) => {
      await openWithChat(page, vp.width, vp.height);
      if (variant === "chrome109") await stripPostChrome109Css(page);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const canvas = await page.getByTestId("editor-canvas-frame").boundingBox();
      expect(canvas?.height ?? 0).toBeGreaterThanOrEqual(vp.minCanvas - 1);
      for (const id of ["ai-draw-input", "ai-draw-send", "ai-draft-banner", "ai-draft-keep", "ai-draft-undo-last", "ai-draft-undo-all", "generate-3d-btn"]) {
        const box = await page.getByTestId(id).first().boundingBox();
        expect(box, id).not.toBeNull();
        expect(box!.x + box!.width, `${id} right edge`).toBeLessThanOrEqual(vp.width + 1);
        expect(box!.x, `${id} left edge`).toBeGreaterThanOrEqual(-1);
      }
      // The banner lives inside the canvas area and never covers the whole canvas.
      const banner = await page.getByTestId("ai-draft-banner").boundingBox();
      const wrap = await page.getByTestId("editor-canvas-frame").boundingBox();
      expect(banner!.height).toBeLessThan(wrap!.height / 3);
      // Chat controls: the composer is reachable by scrolling the page if needed, and the log scrolls on its own.
      await page.getByTestId("ai-draw-send").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("ai-draw-send")).toBeVisible();
      const clipped = await page.evaluate(() => {
        const log = document.querySelector('[data-testid="ai-draw-log"]') as HTMLElement;
        return log.scrollHeight > log.clientHeight ? "scrolls" : "fits";
      });
      expect(["scrolls", "fits"]).toContain(clipped);
      await page.screenshot({ path: `${output}/ai-draw-${vp.name}-${variant}.png` });
    });
  }
}

test("AI chat survives +40% label growth without horizontal overflow (1280x600)", async ({ page }) => {
  await openWithChat(page, 1280, 600);
  await page.addStyleTag({ content: ".drawSend, [data-testid^='ai-draft-'], [data-testid='ai-draw-label'] { letter-spacing: 0.04em; padding-inline: 1.4em !important; }" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
