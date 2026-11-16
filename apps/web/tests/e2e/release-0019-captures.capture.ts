import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { mockAi } from "./ai-context-mock";

/**
 * 0.0.19 captures and axe scans at 1280 and 1440 px, AI dock open and closed, LIGHT only (ChemDFT has no dark theme).
 * Presentation-fixture mock APIs only; R19_PHASE=before|after chooses the folder. Fixture rows are not scientific results.
 */
const PHASE = process.env.R19_PHASE ?? "after";
const SHOTS = process.env.R19_SHOTS ?? `/tmp/chemdft-release-0019/${PHASE}`;
mkdirSync(SHOTS, { recursive: true });
const JOBS = "/en/projects/00000000-0000-4000-8000-0000000000a1";
const CMP = "/en/projects/00000000-0000-4000-8000-0000000000d1";
const SIZES = [[1280, 800], [1440, 900]] as const;

async function axe(page: Page) {
  await page.addScriptTag({ path: resolve("node_modules/axe-core/axe.min.js") });
  return page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } })
      .axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
  });
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function boot(page: Page, url: string, w: number, h: number, dock: "open" | "closed", noJobs = false) {
  await mockAi(page, { emptyInventory: true, noJobs });
  await page.setViewportSize({ width: w, height: h });
  await page.addInitScript(() => { try { localStorage.setItem("chemdft:workspace-mode", "guided"); } catch { /* optional */ } });
  await page.goto(url);
  await expect(page.getByTestId("ai-scientist-panel")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("ai-prompt-input")).toBeEnabled({ timeout: 60_000 });
  if (dock === "closed") {
    await page.getByRole("button", { name: "Hide AI Scientist panel" }).click();
    await expect(page.locator(".project-shell")).toHaveClass(/dock-collapsed/);
  }
}

for (const [w, h] of SIZES) for (const dock of ["open", "closed"] as const) {
  test.describe(`${w}px dock ${dock}`, () => {
    test.setTimeout(180_000);
    const name = (n: string) => `${SHOTS}/${n}-${w}-dock-${dock}.png`;

    test("Jobs page with the AI panel (Chat)", async ({ page }) => {
      await boot(page, `${JOBS}/jobs`, w, h, dock);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: name("jobs-chat") });
      console.log(`AXE jobs-chat ${w} ${dock}`, JSON.stringify(await axe(page)));
    });

    for (const tab of ["tools", "evidence", "runs", "settings"] as const) {
      test(`AI panel tab: ${tab}`, async ({ page }) => {
        test.skip(dock === "closed", "the panel is hidden when the dock is closed");
        await boot(page, `${JOBS}/jobs`, w, h, dock);
        if (tab === "tools" || tab === "settings") { await page.getByTestId("ai-nav-more").click(); await page.getByTestId(`ai-menu-${tab}`).click(); }
        else await page.getByTestId(`ai-nav-${tab}`).click();
        await page.waitForTimeout(800);
        const crashed = await page.getByText(/could not load|Application error|Something went wrong/i).count();
        console.log(`TAB ${tab} ${w} crashed=${crashed}`);
        await page.screenshot({ path: name(`tab-${tab}`) });
        console.log(`AXE tab-${tab} ${w}`, JSON.stringify(await axe(page)));
        expect(crashed, "the tab renders instead of the error screen").toBe(0);
        await expect(page.getByTestId("ai-scientist-panel")).toBeVisible();
      });
    }

    test("Paper vs ChemDFT with a selected row", async ({ page }) => {
      await boot(page, `${CMP}/comparison`, w, h, dock, true);
      await expect(page.locator("tr.comparison-row").first()).toBeVisible({ timeout: 60_000 });
      await page.locator("tr.comparison-row").first().click();
      await expect(page.getByLabel("Comparison row inspector")).toBeVisible();
      await page.screenshot({ path: name("paper-vs-chemdft") });
      console.log(`AXE paper ${w} ${dock}`, JSON.stringify(await axe(page)));
    });

    test("Left navigation on Jobs", async ({ page }) => {
      await boot(page, `${JOBS}/jobs`, w, h, dock);
      const nav = page.locator("nav, aside").first();
      await nav.screenshot({ path: name("left-nav") }).catch(() => undefined);
    });
  });
}
