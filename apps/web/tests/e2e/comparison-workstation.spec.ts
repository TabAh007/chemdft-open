import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

/**
 * Paper vs ChemDFT against the presentation-fixture mock API (see playwright.comparison.config.ts). Fixture rows are NOT scientific
 * results; the numbers are digit-preservation probes. Desktop only (>= 1280 px).
 */
const SHOTS = process.env.COMPARISON_SHOTS ?? "/tmp/chemdft-comparison-screens";
mkdirSync(SHOTS, { recursive: true });
const API = `http://127.0.0.1:${process.env.CHEMDFT_E2E_API_PORT ?? 8293}`;
const RICH = "00000000-0000-4000-8000-0000000000d1";
const BIG = "00000000-0000-4000-8000-0000000000e2";
const EMPTY = "00000000-0000-4000-8000-0000000000f3";
const rid = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const url = (project: string, query = "") => `/en/projects/${project}/comparison${query}`;
const row = (page: Page, n: number) => page.locator(`tr.comparison-row[data-row-id="${rid(n)}"]`);
const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function axeViolations(page: Page) {
  await page.evaluate(axe.source);
  const result = await page.evaluate(() => (window as unknown as { axe: typeof axe }).axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }));
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function open(page: Page, project = RICH, query = "") {
  await page.goto(url(project, query));
  await expect(page.getByRole("heading", { name: "Paper vs ChemDFT" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("tr.comparison-row").first()).toBeVisible({ timeout: 30_000 });
}

test.describe("Paper vs ChemDFT workstation", () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

  test("every digit the server sent is shown; nothing is rounded", async ({ page }) => {
    await open(page);
    await expect(row(page, 4)).toContainText("0.0255 degree");
    await expect(row(page, 4)).toContainText("24.482");
    await expect(row(page, 4)).toContainText("24.4565");
    await expect(row(page, 5)).toContainText("0.07654321100000001 degree");
    await expect(row(page, 5)).toContainText("33.123456789");
    await expect(row(page, 9)).toContainText("-1.1167593073964255");
    await expect(row(page, 10)).toContainText("42.1 nm");
    await expect(page.locator(".comparison-page")).not.toContainText("0.0765 degree");
    await expect(page.locator(".comparison-page")).not.toContainText("+0.0255");
  });

  test("qualifier and uncertainty are shown as recorded on both the row and the inspector", async ({ page }) => {
    await open(page);
    await expect(row(page, 4)).toContainText("approximate, read from the printed table");
    await expect(row(page, 2)).toContainText("Uncertainty (as recorded):");
    await expect(row(page, 2)).toContainText("0.002 Å");
    await expect(row(page, 9)).toContainText("HF/STO-3G, fixture value");
    await expect(row(page, 9)).toContainText("1e-10 Eh");
    await row(page, 4).click();
    const inspector = page.getByLabel("Comparison row inspector");
    await expect(inspector).toContainText("Qualifier (as recorded)");
    await expect(inspector).toContainText("approximate, read from the printed table");
  });

  test("why a row is not comparable is shown in the row itself, in the server's words", async ({ page }) => {
    await open(page);
    for (const [n, text] of [
      [6, "DLS quantities have different semantics; no conversion is inferred."],
      [7, "declared units differ and no deterministic conversion is defined."],
      [8, "The source claim has no valid linked passage."],
    ] as const) {
      const why = page.locator(`tr[data-for="${rid(n)}"] [role="note"]`);
      await expect(why).toBeVisible();
      await expect(why).toContainText(n === 8 ? "Why this is unresolved" : "Why this is not directly comparable");
      await expect(why).toContainText(text);
    }
    // A comparable row carries its rule as a quiet line, not a warning.
    await expect(page.locator(`tr[data-for="${rid(4)}"]`)).toContainText("Delta convention: source minus ChemDFT.");
    await expect(page.locator(`tr[data-for="${rid(4)}"] [role="note"]`)).toHaveCount(0);
    // Rows without a server delta never claim a difference.
    await expect(row(page, 6)).not.toContainText("Source minus ChemDFT");
    await expect(row(page, 4)).toContainText("Source minus ChemDFT");
  });

  test("server codes get friendly labels and the raw code is kept", async ({ page }) => {
    await open(page);
    await expect(row(page, 6).locator("[data-code]").first()).toHaveAttribute("data-code", "NOT_DIRECTLY_COMPARABLE");
    await expect(row(page, 6)).toContainText("Not directly comparable");
    await expect(row(page, 7).locator("[data-code]").first()).toHaveAttribute("data-code", "SEMANTICS_DIFFER");
    await expect(row(page, 4).locator('[data-authority="DIGITIZED"]')).toHaveText("Digitized");
    await expect(row(page, 3).locator('[data-authority="RECONSTRUCTED"]')).toHaveText("Reconstructed");
  });

  test("filters have counts, live in the URL, and survive reload and Back", async ({ page }) => {
    await open(page);
    await expect(page.getByLabel("Filter by relation").locator("option", { hasText: "Same quantity (3)" })).toHaveCount(1);
    await page.getByLabel("Filter by relation").selectOption("SAME_QUANTITY");
    await expect(page).toHaveURL(/relation=SAME_QUANTITY/);
    await expect(page.locator("tr.comparison-row")).toHaveCount(3);
    // The Section count ignores only its own facet, so it reflects the Relation filter.
    await expect(page.getByLabel("Filter by section").locator("option", { hasText: "XRD (2)" })).toHaveCount(1);
    await page.getByLabel("Search comparison rows").fill("peak 2");
    await expect(page.locator("tr.comparison-row")).toHaveCount(1);
    await expect(page).toHaveURL(/q=peak\+2/);
    await row(page, 5).click();
    await expect(page).toHaveURL(new RegExp(`row=${rid(5)}`));
    await page.reload();
    await expect(page.locator("tr.comparison-row")).toHaveCount(1);
    await expect(row(page, 5)).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(row(page, 5)).toHaveAttribute("aria-selected", "false");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.locator("tr.comparison-row")).toHaveCount(10);
    await page.getByLabel("Filter by relation").selectOption("SAME_QUANTITY");
    await expect(page.locator("tr.comparison-row")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Comparable", exact: true })).toHaveCount(0);
    await page.getByLabel("Filter by relation").selectOption("all");
    await expect(page.locator("tr.comparison-row")).toHaveCount(10);
  });

  test("a row hidden by the filters is reported, never replaced by another row", async ({ page }) => {
    await open(page, RICH, `?row=${rid(6)}&relation=SAME_QUANTITY`);
    await expect(page.locator(".claims-hidden-selection")).toContainText("hidden by the current filters");
    await expect(page.getByLabel("Comparison row inspector")).toContainText("Select a row");
    await page.getByRole("button", { name: "Clear filters to show it" }).click();
    await expect(row(page, 6)).toHaveAttribute("aria-selected", "true");
  });

  test("each side jumps to the server-provided source and a missing link is said so", async ({ page }) => {
    await open(page);
    const paper = page.getByRole("link", { name: "Open source for 2θ peak 1" });
    await expect(paper).toHaveAttribute("href", new RegExp(`/en/projects/${RICH}/workspace\\?selection=documentEvidence:`));
    const record = page.getByRole("link", { name: "Open ChemDFT record for 2θ peak 1" });
    await expect(record).toHaveAttribute("href", new RegExp("selection=experimentalDataset:"));
    await expect(row(page, 8)).toContainText("No link");
    // Following the link does not select the row (and the link is not in the middle of the row).
    await row(page, 3).click();
    await expect(page.getByRole("link", { name: "View structure" })).toHaveAttribute("href", /selection=structureVersion:/);
    await expect(page.getByText(/paper did not provide these full coordinates/i)).toBeVisible();
  });

  test("Agreement view plots only directly comparable rows, in one chart per unit, with exact values", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /Agreement/ }).click();
    await expect(page).toHaveURL(/view=agreement/);
    await expect(page.getByLabel("Agreement in degree")).toBeVisible();
    await expect(page.getByLabel("Agreement in nm")).toBeVisible();
    await expect(page.getByTestId("agreement-chart")).toHaveCount(2);
    await expect(page.locator("canvas")).toHaveCount(2, { timeout: 15_000 });
    const degree = page.getByLabel("Agreement in degree");
    await expect(degree).toContainText("24.482 degree");
    await expect(degree).toContainText("24.4565 degree");
    await expect(degree).toContainText("33.123456789 degree");
    await expect(degree).not.toContainText("1524.4");
    await expect(page.getByLabel("Agreement in nm")).toContainText("1524.4 nm");
    await expect(page.getByText("3 of 10 visible rows plotted")).toBeVisible();
    const excluded = page.locator("details", { hasText: "rows not plotted" });
    await excluded.locator("summary").click();
    await expect(excluded).toContainText("Hydrodynamic radius");
    await expect(excluded).toContainText("not directly comparable by value");
    await page.getByLabel("Agreement in degree").getByRole("row", { name: /2θ peak 2/ }).click();
    await expect(page).toHaveURL(new RegExp(`row=${rid(5)}`));
    await expect(page.getByLabel("Comparison row inspector")).toContainText("2θ peak 2");
    await page.screenshot({ path: `${SHOTS}/comparison-agreement.png` });
  });

  test("inspector leads with the relation, and ids and hashes come last", async ({ page }) => {
    await open(page);
    await row(page, 4).click();
    const inspector = page.getByLabel("Comparison row inspector");
    const order = await inspector.evaluate((el) => {
      const text = el.textContent ?? "";
      return ["RELATION", "Source minus ChemDFT", "PAPER", "Provenance hash"].map((label) => text.toUpperCase().indexOf(label.toUpperCase()));
    });
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("no text on the page is smaller than 12 px", async ({ page }) => {
    await open(page);
    await row(page, 4).click();
    const small = await page.evaluate(() => [...document.querySelectorAll(".comparison-page *, [aria-label='Comparison row inspector'] *")]
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "") && parseFloat(getComputedStyle(el).fontSize) < 12)
      .map((el) => `${el.tagName}.${el.className} ${getComputedStyle(el).fontSize} "${(el.textContent ?? "").trim().slice(0, 30)}"`));
    expect(small).toEqual([]);
  });

  test("Export CSV downloads the visible rows with the server's values verbatim", async ({ page }) => {
    await open(page, RICH, "?relation=SAME_QUANTITY");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV (3)" }).click()]);
    expect(download.suggestedFilename()).toBe(`paper-vs-chemdft-${RICH}.csv`);
    const text = readFileSync((await download.path())!, "utf8");
    expect(text.startsWith("﻿row_id,section,topic")).toBe(true);
    const lines = text.slice(1).trimEnd().split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(`${rid(4)},XRD,2θ peak 1,xrd.two_theta.peak_position,SAME_QUANTITY,24.482,degree`);
    expect(lines[1]).toContain(",0.0255,degree,");
    expect(lines[2]).toContain("0.07654321100000001");
    expect(lines[3]).toContain(",42.1,nm,");
  });

  test("the page makes no write request and its only comparison call is a GET", async ({ page, request }) => {
    await request.delete(`${API}/__requests`);
    await open(page);
    await row(page, 4).click();
    await page.getByLabel("Search comparison rows").fill("peak");
    await page.getByLabel("Filter by relation").selectOption("SAME_QUANTITY");
    await page.getByRole("button", { name: /Agreement/ }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export CSV/ }).click()]);
    await download.path();
    const log = (await (await request.get(`${API}/__requests`)).json()) as Array<{ method: string; path: string }>;
    expect(log.length).toBeGreaterThan(0);
    expect(log.filter((entry) => entry.method !== "GET")).toEqual([]);
    expect(log.filter((entry) => entry.path.endsWith("/scientific-comparison")).length).toBeGreaterThanOrEqual(1); // React strict mode runs the dev effect twice
  });

  test("empty and large projects", async ({ page }) => {
    await open(page, BIG);
    await expect(page.locator("tr.comparison-row")).toHaveCount(300);
    expect(await noHorizontalOverflow(page)).toBe(true);
    await page.goto(url(EMPTY));
    await expect(page.getByText("This project has no comparison rows yet.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Export CSV/ })).toBeDisabled();
  });

  test("keyboard: Enter selects a focused row", async ({ page }) => {
    await open(page);
    await row(page, 6).focus();
    await page.keyboard.press("Enter");
    await expect(row(page, 6)).toHaveAttribute("aria-selected", "true");
  });

  test("no serious or critical axe violations (rows and Agreement)", async ({ page }) => {
    await open(page);
    await row(page, 6).click();
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: /Agreement/ }).click();
    await expect(page.locator("canvas")).toHaveCount(2, { timeout: 15_000 });
    expect(await axeViolations(page)).toEqual([]);
  });

  for (const width of [1280, 1440, 1920]) {
    for (const dock of ["open", "closed"] as const) {
      test(`${width}px with the AI dock ${dock}: no page overflow, cells stay in their columns`, async ({ page }) => {
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
        await row(page, 4).click();
        await expect(page.getByLabel("Comparison row inspector")).toBeVisible();
        expect(await noHorizontalOverflow(page)).toBe(true);
        const geometry = await page.evaluate(() => {
          const matrix = document.querySelector('[aria-label="Scientific comparison matrix"]')!.getBoundingClientRect();
          const inspector = document.querySelector('[aria-label="Comparison row inspector"]')!.getBoundingClientRect();
          return { matrixRight: matrix.right, matrixBottom: matrix.bottom, matrixWidth: matrix.width, inspectorLeft: inspector.left, inspectorTop: inspector.top, inspectorRight: inspector.right, inspectorWidth: inspector.width, viewport: window.innerWidth };
        });
        const sideBySide = geometry.matrixRight <= geometry.inspectorLeft + 1;
        const stacked = geometry.matrixBottom <= geometry.inspectorTop + 1;
        expect(sideBySide || stacked).toBe(true);
        expect(geometry.inspectorRight).toBeLessThanOrEqual(geometry.viewport + 1);
        expect(geometry.matrixWidth).toBeGreaterThan(sideBySide ? 480 : 700);
        if (dock === "closed") expect(sideBySide).toBe(true);
        const cellsDisjoint = await row(page, 4).evaluate((el) => {
          const cells = [...el.querySelectorAll("td")].map((cell) => cell.getBoundingClientRect());
          return cells.every((cell, index) => index === 0 || cells[index - 1]!.right <= cell.left + 1);
        });
        expect(cellsDisjoint).toBe(true);
        const clipped = await page.evaluate(() => [...document.querySelectorAll("tr.comparison-row td")].filter((td) => td.scrollWidth > td.clientWidth + 1).length);
        expect(clipped).toBe(0);
        await page.screenshot({ path: `${SHOTS}/comparison-${width}-dock-${dock}.png` });
      });
    }
  }

  test("capture states for review", async ({ page }) => {
    await open(page);
    await row(page, 6).click();
    await page.screenshot({ path: `${SHOTS}/comparison-not-comparable.png` });
    await page.locator("tr.comparison-row", { has: page.locator("[data-code='NOT_DIRECTLY_COMPARABLE']") }).screenshot({ path: `${SHOTS}/comparison-not-comparable-row.png` });
    await row(page, 4).click();
    await page.screenshot({ path: `${SHOTS}/comparison-comparable.png` });
    await page.goto(url(EMPTY));
    await expect(page.getByText("This project has no comparison rows yet.")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/comparison-empty.png` });
  });
});
