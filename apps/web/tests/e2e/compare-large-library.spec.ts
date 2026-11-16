import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A LONG results library, to show that selecting deep in the list updates a comparison that is already in view.
 *
 * On the disposable copy of the accepted evidence (see compare-workstation.spec.ts) the 15 genuine results are listed
 * AFTER 1,200 padding rows. The padding rows exist only inside this test's network layer: they carry no stored
 * quantities, are never selected, and are never sent to the real server, which keeps answering every real request
 * (comparison, results, saved comparisons). Real server-side pagination, ordering and counts for more than 300
 * results are asserted by services/api/tests/test_published_results.py.
 *   RW2_EVIDENCE_API_PORT=8191 RW2_EVIDENCE_WEB_PORT=3191 RW2_EVIDENCE_SPEC=e2e/compare-large-library.spec.ts \
 *   playwright test --config playwright.rw2-evidence.config.ts
 */
const PROJECT = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";
const API = "/api/chemdft";
const SHOTS = resolve(process.env.CHEMDFT_COMPARE_SHOTS ?? "../../output/compare-review");
mkdirSync(SHOTS, { recursive: true });
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PADDING = 1200;

test.setTimeout(240_000);

async function realPage(request: APIRequestContext): Promise<Json> {
  return (await (await request.get(`${API}/v1/projects/${PROJECT}/published-results?limit=200`)).json()) as Json;
}

test("selecting deep in a 1,215-result library keeps the comparison in view and the selection through filters", async ({ page, request }) => {
  const real = await realPage(request);
  const thermo = (real.rows as Json[]).filter((r) => r.task === "THERMOCHEMISTRY");
  const padding: Json[] = Array.from({ length: PADDING }, (_, i) => ({
    ...structuredClone(real.rows[0]), result_id: randomUUID(), calculation_id: randomUUID(), result_type: "chemdft.energy", quantities: [], structure_name: `Test-only padding ${i + 1}`,
    updated_at: new Date(Date.UTC(2027, 0, 1) - i * 1000).toISOString(), visualizations: [], exports: [], saved_comparison_ids: [],
  }));
  const everything = [...padding, ...(real.rows as Json[])];
  let pagesServed = 0;
  await page.route("**/published-results?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("result_id")) { await route.continue(); return; } // by-id reads are the real server's
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("cursor") ?? 0);
    const task = url.searchParams.get("task");
    const list = task ? everything.filter((r) => r.task === task) : everything;
    const slice = list.slice(offset, offset + limit);
    pagesServed += 1;
    await route.fulfill({
      json: { ...real, rows: slice, total_published: everything.length, total_matching: list.length, limit, next_cursor: offset + limit < list.length ? String(offset + limit) : null },
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => { try { localStorage.setItem("chemdft:workspace-mode", "guided"); } catch { /* optional */ } });
  await page.goto(`/en/projects/${PROJECT}/compare`);
  await expect(page.getByTestId("compare-candidate").first()).toBeVisible({ timeout: 90_000 });
  // the count line separates what is loaded in the browser from what the server says matches
  await expect(page.getByTestId("compare-loaded")).toHaveText("100 loaded of 1,215 published");
  await expect(page.getByTestId("compare-more")).toContainText("1,115 not loaded yet");
  await expect(page.getByTestId("compare-candidate")).toHaveCount(100);

  // page through to the genuine results at the bottom of the list
  const target = thermo.slice(0, 2).map((r) => r.result_id as string);
  for (let i = 0; i < 13; i += 1) {
    if (await page.locator(`[data-result-id="${target[1]}"]`).count()) break;
    await page.getByTestId("compare-more").scrollIntoViewIfNeeded();
    await page.getByTestId("compare-more").click();
    await expect(page.getByTestId("compare-candidate")).toHaveCount(Math.min(1215, 100 * (i + 2)));
  }
  await expect(page.getByTestId("compare-candidate")).toHaveCount(1215);
  expect(pagesServed).toBeGreaterThanOrEqual(13);
  await expect(page.getByTestId("compare-more")).toHaveCount(0);
  await expect(page.getByTestId("compare-loaded")).toHaveText("1,215 results");

  // the library is its own scroller: scrolled to the very bottom, the comparison panel is still on screen
  const scroller = page.getByTestId("compare-list-scroll");
  await scroller.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  expect(await scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(1000);
  const tickTarget = (id: string) => page.locator(`[data-testid=compare-candidate][data-result-id="${id}"] input[type=checkbox]`);
  await tickTarget(target[0]!).scrollIntoViewIfNeeded();
  await tickTarget(target[0]!).check();
  const started = Date.now();
  await tickTarget(target[1]!).scrollIntoViewIfNeeded();
  const scrollBefore = await scroller.evaluate((node) => node.scrollTop);
  await tickTarget(target[1]!).check();
  await expect(page.getByTestId("compare-selected-card")).toHaveCount(2);
  const selectedIn = Date.now() - started;
  await expect(page.getByTestId("compare-overall")).toBeInViewport({ timeout: 60_000 });
  await expect(page.getByTestId("compare-head")).toBeInViewport();
  // selecting did not move the list, and the whole page did not scroll
  expect(Math.abs((await scroller.evaluate((node) => node.scrollTop)) - scrollBefore)).toBeLessThan(40);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(selectedIn, "two clicks in a 1,215-row list update the visible panel promptly").toBeLessThan(5_000);
  await page.screenshot({ path: `${SHOTS}/long-library-selected-deep.png` });

  // filters, search and sorting change the list, never the selection
  await page.getByTestId("compare-type-THERMOCHEMISTRY").click();
  await expect(page.getByTestId("compare-selected-card")).toHaveCount(2);
  expect(new URL(page.url()).searchParams.getAll("result")).toEqual(target);
  await page.getByTestId("compare-type-all").click();
  await expect(page.getByTestId("compare-candidate").first()).toBeVisible();
  await expect(page.getByTestId("compare-selected-card")).toHaveCount(2);
  await expect(page.getByTestId("compare-selected-count")).toContainText("2 of 8");

  // a reload restores a selection whose rows are not on the first page: they are read by id, not by paging
  await page.reload();
  await expect(page.getByTestId("compare-selected-card")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  expect(await page.getByTestId("compare-candidate").count()).toBeLessThanOrEqual(100);
});
