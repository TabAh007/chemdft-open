import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Claims workstation against the presentation-fixture mock API (see playwright.claims.config.ts). Fixture claims are NOT
 * scientific results; the numbers are digit-preservation probes. Desktop only (>= 1280 px).
 */
const SHOTS = process.env.CLAIMS_SHOTS ?? "/tmp/chemdft-claims-screens";
mkdirSync(SHOTS, { recursive: true });
const API = `http://127.0.0.1:${process.env.CHEMDFT_E2E_API_PORT ?? 8292}`;
const RICH = "00000000-0000-4000-8000-0000000000a1";
const BIG = "00000000-0000-4000-8000-0000000000b2";
const EMPTY = "00000000-0000-4000-8000-0000000000c3";
const cid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const url = (project: string, query = "") => `/en/projects/${project}/claims${query}`;
const row = (page: Page, n: number) => page.locator(`.claim-row[data-claim-id="${cid(n)}"]`);
const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function axeViolations(page: Page) {
  await page.evaluate(axe.source);
  const result = await page.evaluate(() => (window as unknown as { axe: typeof axe }).axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }));
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function open(page: Page, project = RICH, query = "") {
  await page.goto(url(project, query));
  await expect(page.getByRole("heading", { name: "Scientific claims" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".claim-row").first()).toBeVisible({ timeout: 30_000 });
}

test.describe("Claims workstation (desktop)", () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

  test("shows every digit the server recorded, in rows and in the inspector", async ({ page }) => {
    await open(page);
    await expect(row(page, 1)).toContainText("24.4565");
    await expect(row(page, 6)).toContainText("-1.1167593073964255");
    await expect(row(page, 7)).toContainText("0.123456789");
    await expect(row(page, 8)).toContainText("1e-10");
    await expect(row(page, 15)).toContainText("123456789012.12344");
    // Range only where the server says so; negative bounds are unambiguous.
    await expect(row(page, 9)).toContainText("-700.5 to -600.25");
    await expect(row(page, 10)).toContainText("100 to 1500.125");
    // Search matches the full-precision digits.
    await page.getByLabel("Search claims").fill("-1.1167593073964255");
    await expect(page.locator(".claim-row")).toHaveCount(1);
    await expect(page).toHaveURL(/q=-1\.1167593073964255/);
  });

  test("qualifier and uncertainty are shown as recorded, objects as labelled fields", async ({ page }) => {
    await open(page);
    await row(page, 12).click();
    const inspector = page.getByRole("complementary", { name: "Selected claim inspector" });
    await expect(inspector).toContainText("Qualifier (as recorded)");
    await expect(inspector).toContainText("Source table token scaled from OCR context; inspect source text.");
    await row(page, 6).click();
    await expect(inspector).toContainText("Uncertainty (as recorded)");
    await expect(inspector).toContainText("0.02 Eh");
    await expect(inspector).not.toContainText("±");
    await row(page, 7).click();
    await expect(inspector.locator(".claim-uncertainty")).toContainText("low");
    await expect(inspector.locator(".claim-uncertainty")).toContainText("0.1236");
    await expect(inspector.locator(".claim-uncertainty")).not.toContainText("{");
    await row(page, 13).click();
    await expect(inspector.locator(".claim-value")).toContainText("angles[0]");
    await expect(inspector.locator(".claim-value")).toContainText("3.14159265358979");
    await expect(inspector.locator(".claim-value")).not.toContainText("{");
    await expect(row(page, 13)).toContainText("more");
  });

  test("friendly labels keep the raw server code; unknown codes fall back to raw", async ({ page }) => {
    await open(page);
    await expect(row(page, 2)).toHaveAttribute("data-authority", "DIGITIZED");
    await expect(row(page, 2)).toContainText("Digitized");
    await expect(row(page, 2)).toContainText("Committed");
    await expect(row(page, 14)).toContainText("FUTURE_AUTHORITY");
    await expect(row(page, 14)).toContainText("FUTURE_STATE");
    await expect(page.locator(".claims-group th", { hasText: "FUTURE_TYPE" })).toBeVisible();
    await expect(page.locator(".claims-group th", { hasText: "Calculation result" })).toBeVisible();
    await expect(page.locator(".claims-group th", { hasText: "Numeric value" })).toBeVisible();
  });

  test("the type filter lists the missing types and every option carries a count", async ({ page }) => {
    await open(page);
    const select = page.getByLabel("Filter by claim type");
    await expect(select.locator("option", { hasText: /Numeric value \(\d+\)/ })).toHaveCount(1);
    await expect(select.locator("option", { hasText: /Calculation result \(3\)/ })).toHaveCount(1);
    await select.selectOption("CALCULATION_RESULT");
    await expect(page.locator(".claim-row")).toHaveCount(3);
    await expect(page.getByLabel("Active filters")).toContainText("Type: Calculation result");
    await page.getByRole("button", { name: /Remove filter Type: Calculation result/ }).click();
    await expect(page.getByLabel("Active filters")).toHaveCount(0);
    await expect(page.locator(".claim-row")).toHaveCount(15);
    // Counts ignore only their own facet.
    await page.getByLabel("Filter by authority").selectOption("DIGITIZED");
    await expect(select.locator("option", { hasText: /Peak position \(1\)/ })).toHaveCount(1);
    await expect(page.getByLabel("Filter by authority").locator("option", { hasText: /Extracted \(\d+\)/ })).toHaveCount(1);
  });

  test("selection and filters live in the URL: push for selection, replace for filters, Back and reload restore", async ({ page }) => {
    await open(page);
    await row(page, 1).click();
    await expect(page).toHaveURL(new RegExp(`claim=${cid(1)}`));
    await row(page, 2).click();
    await expect(page).toHaveURL(new RegExp(`claim=${cid(2)}`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`claim=${cid(1)}`));
    await expect(row(page, 1)).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await expect(row(page, 2)).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Filter by authority").selectOption("DIGITIZED");
    await page.getByLabel("Filter by review state").selectOption("COMMITTED");
    await expect(page).toHaveURL(/authority=DIGITIZED/);
    await expect(page).toHaveURL(/review=COMMITTED/);
    await page.reload();
    await expect(page.getByLabel("Filter by authority")).toHaveValue("DIGITIZED");
    await expect(page.getByLabel("Filter by review state")).toHaveValue("COMMITTED");
    await expect(row(page, 2)).toHaveAttribute("aria-selected", "true");
  });

  test("a selection hidden by the filters is reported, never silently replaced", async ({ page }) => {
    await open(page, RICH, `?claim=${cid(1)}&authority=DIGITIZED`);
    await expect(page.locator(".claim-row", { hasText: "digitized peak" })).toBeVisible();
    await expect(page.locator(".claim-row[aria-selected='true']")).toHaveCount(0);
    await expect(page.getByText("Select a claim to see")).toBeVisible();
    await expect(page.locator(".claims-hidden-selection")).toContainText("hidden by the current filters");
    await page.getByRole("button", { name: "Clear filters to show it" }).click();
    await expect(row(page, 1)).toHaveAttribute("aria-selected", "true");
  });

  test("inactive sources are flagged and the effective state is shown", async ({ page }) => {
    await open(page);
    await expect(row(page, 8)).toContainText("Inactive source");
    await row(page, 8).click();
    const inspector = page.getByRole("complementary", { name: "Selected claim inspector" });
    await expect(inspector).toContainText("Inactive source: Source result retracted (fixture reason).");
    await expect(inspector.getByLabel("Effective result state")).toContainText("RETRACTED");
    await expect(inspector.getByLabel("Effective result state")).toContainText("Not eligible");
  });

  test("ids are plain text and the only link is the server's source_href", async ({ page }) => {
    await open(page);
    await row(page, 1).click();
    const inspector = page.getByRole("complementary", { name: "Selected claim inspector" });
    await expect(inspector).toContainText(cid(8001));
    await expect(inspector).toContainText(cid(7000));
    await expect(inspector.getByRole("link")).toHaveCount(1);
    await row(page, 6).click();
    await expect(inspector.getByRole("link")).toHaveCount(0);
    await expect(inspector).toContainText("The server provided no link for this source.");
  });

  test("the page makes no write request and its only claims call is a GET", async ({ page, request }) => {
    await request.delete(`${API}/__requests`);
    await open(page);
    await row(page, 1).click();
    await page.getByLabel("Search claims").fill("peak");
    await page.getByLabel("Filter by authority").selectOption("EXTRACTED");
    await page.keyboard.press("Tab");
    const log = (await (await request.get(`${API}/__requests`)).json()) as Array<{ method: string; path: string }>;
    expect(log.length).toBeGreaterThan(0);
    expect(log.filter((entry) => entry.method !== "GET")).toEqual([]);
    expect(log.filter((entry) => entry.path.endsWith("/scientific-claims")).length).toBeGreaterThanOrEqual(1);
  });

  test("empty and large projects", async ({ page }) => {
    await open(page, BIG);
    await expect(page.locator(".claim-row")).toHaveCount(400);
    expect(await noHorizontalOverflow(page)).toBe(true);
    await page.goto(url(EMPTY));
    await expect(page.getByText("This project has no scientific claims yet.")).toBeVisible({ timeout: 30_000 });
  });

  test("keyboard: Enter selects a focused row", async ({ page }) => {
    await open(page);
    await row(page, 3).focus();
    await page.keyboard.press("Enter");
    await expect(row(page, 3)).toHaveAttribute("aria-selected", "true");
  });

  test("no serious or critical axe violations", async ({ page }) => {
    await open(page);
    await row(page, 7).click();
    expect(await axeViolations(page)).toEqual([]);
  });

  for (const width of [1280, 1440, 1920]) {
    for (const dock of ["open", "closed"] as const) {
      test(`${width}px with the AI dock ${dock}: no page overflow, library and inspector side by side`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 1920 ? 1080 : 800 });
        await open(page);
        if (dock === "closed") {
          await page.getByRole("button", { name: "Hide AI Scientist panel" }).click();
          await expect(page.locator(".project-shell")).toHaveClass(/dock-collapsed/);
          await expect(page.locator(".context-dock")).toBeHidden();
        } else {
          await expect(page.getByRole("button", { name: "Hide AI Scientist panel" })).toBeVisible();
          await expect(page.locator(".context-dock")).toBeVisible();
        }
        await row(page, 7).click();
        await expect(page.locator(".claim-inspector")).toBeVisible();
        expect(await noHorizontalOverflow(page)).toBe(true);
        const geometry = await page.evaluate(() => {
          const table = document.querySelector(".claims-table-wrap")!.getBoundingClientRect();
          const inspector = document.querySelector(".claim-inspector")!.getBoundingClientRect();
          return { tableRight: table.right, inspectorLeft: inspector.left, inspectorRight: inspector.right, tableWidth: table.width, inspectorWidth: inspector.width, viewport: window.innerWidth };
        });
        expect(geometry.tableRight).toBeLessThanOrEqual(geometry.inspectorLeft + 1);
        expect(geometry.inspectorRight).toBeLessThanOrEqual(geometry.viewport + 1);
        expect(geometry.tableWidth).toBeGreaterThan(dock === "closed" ? 700 : 480);
        expect(geometry.inspectorWidth).toBeGreaterThanOrEqual(320);
        // Every row cell stays inside its own column.
        const cellsDisjoint = await row(page, 15).evaluate((el) => {
          const cells = [...el.querySelectorAll("td")].map((cell) => cell.getBoundingClientRect());
          return cells.every((cell, index) => index === 0 || cells[index - 1]!.right <= cell.left + 1);
        });
        expect(cellsDisjoint).toBe(true);
        await page.screenshot({ path: `${SHOTS}/claims-${width}-dock-${dock}.png` });
      });
    }
  }

  test("capture states for review", async ({ page }) => {
    await open(page);
    await row(page, 12).click();
    await page.screenshot({ path: `${SHOTS}/claims-qualifier.png` });
    await row(page, 13).click();
    await page.screenshot({ path: `${SHOTS}/claims-object.png` });
    await row(page, 8).click();
    await page.screenshot({ path: `${SHOTS}/claims-inactive.png` });
    await page.getByLabel("Filter by claim type").selectOption("CALCULATION_RESULT");
    await page.screenshot({ path: `${SHOTS}/claims-filtered.png` });
    await page.goto(url(EMPTY));
    await expect(page.getByText("This project has no scientific claims yet.")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/claims-empty.png` });
  });
});
