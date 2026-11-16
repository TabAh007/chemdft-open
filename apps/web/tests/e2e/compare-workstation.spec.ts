import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import axe from "axe-core";
import { resolve } from "node:path";

/**
 * Compare workstation against genuine stored evidence on a DISPOSABLE COPY of the accepted native-engine database
 * (no scientific engine, AI provider or live data is touched):
 *   python3 tools/rw2_evidence_stack.py --api-port 8191 --web-port 3191
 *   RW2_EVIDENCE_API_PORT=8191 RW2_EVIDENCE_WEB_PORT=3191 RW2_EVIDENCE_SPEC=e2e/compare-workstation.spec.ts \
 *   playwright test --config playwright.rw2-evidence.config.ts
 * Every scientific value asserted is compared with what the API itself published; nothing is hard-coded. Saved
 * comparisons are written only to the disposable copy.
 */
const PROJECT = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d"; // 15 genuine PySCF results
const OTHER_PROJECT = "3537048e-306a-4f4f-9b9e-493681c0df83";
const API = "/api/chemdft";
const BASE = `/en/projects/${PROJECT}`;
const SHOTS = resolve(process.env.CHEMDFT_COMPARE_SHOTS ?? "../../output/compare-review");
mkdirSync(SHOTS, { recursive: true });
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

let rows: Json[] = [];
const byTask = (task: string) => rows.filter((r) => r.task === task && r.result_id);

async function published(request: APIRequestContext, params = ""): Promise<Json> {
  return (await (await request.get(`${API}/v1/projects/${PROJECT}/published-results?limit=200${params}`)).json()) as Json;
}
async function serverComparison(request: APIRequestContext, ids: string[]): Promise<Json> {
  const response = await request.get(`${API}/v1/projects/${PROJECT}/calculation-comparison?${ids.map((i) => `result_id=${i}`).join("&")}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Json;
}

async function open(page: Page, ids: string[] = [], opts: { dock?: "open" | "closed"; width?: number; height?: number } = {}) {
  await page.setViewportSize({ width: opts.width ?? 1440, height: opts.height ?? 900 });
  await page.addInitScript(() => { try { localStorage.setItem("chemdft:workspace-mode", "guided"); } catch { /* optional */ } });
  await page.goto(`${BASE}/compare${ids.length ? `?${ids.map((i) => `result=${i}`).join("&")}` : ""}`);
  // below ~860px one pane shows at a time, and a link that names results opens on the comparison
  await expect(page.getByTestId("compare-candidate").first()).toBeAttached({ timeout: 90_000 });
  if ((opts.width ?? 1440) >= 900) await expect(page.getByTestId("compare-candidate").first()).toBeVisible();
  if (opts.dock) {
    // the dock choice is remembered per project, so set it explicitly rather than toggling blindly
    const collapsed = (await page.locator(".project-shell.dock-collapsed").count()) === 1;
    if (collapsed !== (opts.dock === "closed")) await page.getByTestId("ai-dock-toggle").click();
    await expect(page.locator(".project-shell.dock-collapsed")).toHaveCount(opts.dock === "closed" ? 1 : 0);
  }
}
const tick = (page: Page, resultId: string) => page.locator(`[data-testid=compare-candidate][data-result-id="${resultId}"] input[type=checkbox]`);
const cards = (page: Page) => page.getByTestId("compare-selected-card");
const idsInUrl = (page: Page) => new URL(page.url()).searchParams.getAll("result");
const noPageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("setup: the project's published results come from the paginated endpoint", async ({ request }) => {
  const body = await published(request);
  rows = body.rows;
  expect(body.total_published).toBe(15);
  expect(byTask("THERMOCHEMISTRY").length).toBeGreaterThanOrEqual(3);
  expect(byTask("ENERGY").length).toBeGreaterThanOrEqual(2);
});

test("empty state: a useful prompt, the full library beside it, no empty comparison table", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("compare-empty")).toContainText("Select a result to begin comparing.");
  await expect(page.getByTestId("compare-empty")).toContainText("two to 8 published results");
  await expect(page.getByTestId("compare-candidate")).toHaveCount(15);
  await expect(page.getByTestId("compare-output")).toHaveCount(0);
  await expect(page.getByTestId("compare-deltas")).toHaveCount(0);
  await expect(page.getByTestId("compare-selected-count")).toContainText("0 of 8");
  expect(await noPageOverflow(page)).toBe(true);
});

test("one result is the reference and asks for another; two results compare immediately, in view, with no scrolling", async ({ page, request }) => {
  const [a, b] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  await open(page);
  await tick(page, a!).check();
  await expect(page.getByTestId("compare-need-more")).toBeVisible();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toHaveAttribute("data-reference", "true");
  await expect(page.getByTestId("compare-selected-count")).toContainText("1 of 8");
  await tick(page, b!).check();
  // the cards respond before any server answer, and the verdict lands in the same visible workspace
  await expect(cards(page)).toHaveCount(2);
  const verdict = page.getByTestId("compare-overall");
  await expect(verdict).toBeVisible({ timeout: 60_000 });
  await expect(verdict).toBeInViewport();
  await expect(page.getByTestId("compare-deltas")).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.querySelector("[data-testid=project-shell]")!.scrollTop)).toBe(0);
  // the verdict is the server's, in words
  const server = await serverComparison(request, [a!, b!]);
  const WORDS: Record<string, string> = { DIRECTLY_COMPARABLE: "Directly comparable", COMPARABLE_WITH_LIMITATIONS: "Comparable with limitations", NOT_SCIENTIFICALLY_COMPARABLE: "Not scientifically comparable" };
  await expect(verdict).toHaveText(WORDS[server.overall]!);
  await expect(page.getByTestId("compare-output")).toHaveAttribute("data-overall", server.overall);
  expect(idsInUrl(page)).toEqual([a, b]);
  await page.screenshot({ path: `${SHOTS}/two-results.png` });
});

test("every displayed difference is the server's own and incompatible pairings show none", async ({ page, request }) => {
  const thermo = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  const energies = byTask("ENERGY");
  const hf = energies.find((r) => r.method === "hf")!;
  const [a, b] = thermo;
  await open(page, [a!, b!]);
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  const server = await serverComparison(request, [a!, b!]);
  const stored = (server.pairs[0].deltas as Json[]).find((d) => d.quantity_kind === "total_electronic_energy")!;
  const shown = await page.getByTestId("compare-delta").first().innerText();
  expect(Math.abs(parseFloat(shown.replace("+", "")) - stored.delta)).toBeLessThanOrEqual(Math.max(1e-7, Math.abs(stored.delta) * 1e-7));
  // B3LYP thermochemistry against HF/STO-3G is a different level of theory: no difference may appear anywhere
  await open(page, [a!, hf.result_id]);
  await expect(page.getByTestId("compare-overall")).toHaveText("Not scientifically comparable", { timeout: 60_000 });
  await expect(page.getByTestId("compare-delta")).toHaveCount(0);
  await expect(page.getByTestId("compare-delta-blocked").first()).toBeVisible();
  await expect(page.getByTestId("compare-remedy")).toContainText("No numerical difference is shown.");
  await expect(page.getByTestId("compare-remedy")).toContainText("same method, basis");
  await page.getByTestId("compare-tab-plots").click();
  await expect(page.getByTestId("compare-no-plot")).toContainText("No scientifically supported plot");
  await expect(page.getByTestId("compare-chart")).toHaveCount(0);
  await page.getByTestId("compare-tab-rules").click();
  await expect(page.getByTestId("compare-pair")).toHaveAttribute("data-label", "NOT_SCIENTIFICALLY_COMPARABLE");
  await expect(page.getByTestId("compare-pair")).toContainText("R5_LEVEL");
  await expect(page.getByTestId("compare-pair")).toContainText("share no common energy zero");
  await page.screenshot({ path: `${SHOTS}/incompatible.png` });
});

test("thermochemical conditions are the stored ones and thermal differences are withheld when they differ", async ({ page, request }) => {
  const [a, b] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  const stored = async (id: string) => ((await (await request.get(`${API}/v1/projects/${PROJECT}/results/${id}`)).json()) as Json).payload.conditions as Json;
  const [ca, cb] = [await stored(a!), await stored(b!)];
  await open(page, [a!, b!]);
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  const shown = page.getByTestId("compare-conditions");
  await expect(shown).toHaveCount(2);
  await expect(shown.nth(0)).toContainText(`${Number(ca.temperature_k.toFixed(2))} K`);
  await expect(shown.nth(1)).toContainText(`${Number(cb.temperature_k.toFixed(2))} K`);
  if (ca.temperature_k !== cb.temperature_k || ca.pressure_pa !== cb.pressure_pa) {
    await expect(page.getByTestId("compare-compat")).toContainText("Thermochemical conditions");
    await expect(page.getByTestId("compare-delta-withheld").first()).toContainText("Not formed");
    await expect(page.getByTestId("compare-delta-withheld").first()).toContainText("conditions differ");
  }
  // plots: stored thermal values, one marker per result, with a data-table equivalent; never an interpolated curve
  await page.getByTestId("compare-tab-plots").click();
  const plot = page.getByTestId("compare-plot-thermo");
  await expect(plot).toBeVisible({ timeout: 30_000 });
  await expect(plot).toContainText("not joined");
  await expect(plot.getByTestId("compare-chart")).toHaveAttribute("role", "img");
  await plot.getByText("Data table for this plot").click();
  const server = await serverComparison(request, [a!, b!]);
  const quantity = server.results[0].quantities.find((q: Json) => q.kind === "enthalpy" || q.kind === "gibbs_free_energy");
  expect(quantity).toBeTruthy();
  await expect(plot.locator("table")).toContainText(String(ca.temperature_k));
});

test("reference switching: reorders the URL, re-asks the server and relabels every difference", async ({ page, request }) => {
  const [a, b, c] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  await open(page, [a!, b!, c!]);
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  await expect(cards(page)).toHaveCount(3);
  const asked = page.waitForRequest((r) => r.url().includes("/calculation-comparison?") && r.url().includes(`result_id=${c}`) && r.url().indexOf(`result_id=${c}`) < r.url().indexOf(`result_id=${a}`));
  await cards(page).nth(2).getByTestId("compare-make-reference").click();
  await asked;
  await expect.poll(() => idsInUrl(page)).toEqual([c, a, b]);
  await expect(cards(page).first()).toHaveAttribute("data-result-id", c!);
  await expect(cards(page).first()).toHaveAttribute("data-reference", "true");
  await expect(cards(page).first()).toContainText("Reference");
  await expect(page.getByTestId("compare-nav-slot").first()).toHaveAttribute("data-reference", "true");
  const server = await serverComparison(request, [c!, a!, b!]);
  expect(server.reference_result_id).toBe(c);
  await expect(page.getByTestId("compare-output")).toHaveAttribute("data-overall", server.overall, { timeout: 60_000 });
  // sorting the library does not change the reference
  await page.getByTestId("compare-sort").selectOption("task:asc");
  await expect(cards(page).first()).toHaveAttribute("data-result-id", c!);
  expect(idsInUrl(page)).toEqual([c, a, b]);
});

test("remove, clear, and the ninth result is refused", async ({ page }) => {
  const all = rows.filter((r) => r.result_id).map((r) => r.result_id as string);
  await open(page);
  for (const id of all.slice(0, 8)) await tick(page, id).check();
  await expect(page.getByTestId("compare-selected-count")).toContainText("8 of 8");
  await expect(cards(page)).toHaveCount(8);
  await expect(tick(page, all[8]!)).toBeDisabled();
  await expect(page.getByTestId("compare-limit")).toContainText("maximum of 8");
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  expect(await noPageOverflow(page)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/eight-results.png` });
  await cards(page).nth(7).getByTestId("compare-remove").click();
  await expect(cards(page)).toHaveCount(7);
  await expect(tick(page, all[8]!)).toBeEnabled();
  await page.getByTestId("compare-reset").click();
  await expect(page.getByTestId("compare-empty")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  await expect(page.getByTestId("compare-selected-count")).toContainText("0 of 8");
});

test("history, refresh and shared links reproduce the selection", async ({ page }) => {
  const [a, b, c] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  await open(page);
  await tick(page, a!).check();
  await tick(page, b!).check();
  await tick(page, c!).check();
  await expect(cards(page)).toHaveCount(3);
  await page.goBack();
  await expect(cards(page)).toHaveCount(2);
  expect(idsInUrl(page)).toEqual([a, b]);
  await expect(tick(page, c!)).not.toBeChecked();
  await page.goForward();
  await expect(cards(page)).toHaveCount(3);
  await page.reload();
  await expect(cards(page)).toHaveCount(3);
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  expect(idsInUrl(page)).toEqual([a, b, c]);
  await expect(tick(page, a!)).toBeChecked();
});

test("rapid selection never lets a stale answer replace a newer selection", async ({ page, request }) => {
  const [a, b, c] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  let delayed = 0;
  await page.route("**/calculation-comparison?*", async (route) => {
    const url = route.request().url();
    if (url.includes(`result_id=${b}`) && !url.includes(`result_id=${c}`)) { delayed += 1; await new Promise((r) => setTimeout(r, 2500)); }
    await route.continue();
  });
  await open(page);
  await tick(page, a!).check();
  await tick(page, b!).check();
  await expect.poll(() => delayed, { timeout: 10_000 }).toBe(1);
  await expect(page.getByTestId("compare-checking")).toBeVisible();
  await tick(page, c!).check(); // the A+B answer is still in flight
  const server = await serverComparison(request, [a!, b!, c!]);
  await expect(page.getByTestId("compare-output")).toHaveAttribute("data-overall", server.overall, { timeout: 60_000 });
  await page.waitForTimeout(3500); // the slow, older answer would arrive by now
  await expect(cards(page)).toHaveCount(3);
  await expect(page.getByTestId("compare-compat").getByRole("listitem", { name: /against the reference/ }).or(page.locator("[aria-label='Each result against the reference'] li"))).toHaveCount(2);
});

test("unavailable results are reported and never compared; the other selections survive; foreign ids stay hidden", async ({ page, request }) => {
  const [a, b] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  const foreignPage = (await (await request.get(`${API}/v1/projects/${OTHER_PROJECT}/published-results?limit=1`)).json()) as Json;
  const foreign = foreignPage.rows[0].result_id as string;
  const missing = "11111111-2222-4333-8444-555555555555";
  // the same answer for a missing id and another project's id
  const asForeign = (await (await request.get(`${API}/v1/projects/${PROJECT}/published-results?result_id=${foreign}`)).json()) as Json;
  const asMissing = (await (await request.get(`${API}/v1/projects/${PROJECT}/published-results?result_id=${missing}`)).json()) as Json;
  expect(asForeign.rows).toEqual([]);
  expect(asMissing.rows).toEqual([]);
  expect((await request.get(`${API}/v1/projects/${PROJECT}/calculation-comparison?result_id=${a}&result_id=${foreign}`)).status()).toBe(404);
  await open(page, [a!, foreign, b!, missing]);
  await expect(page.getByTestId("compare-unavailable")).toContainText("2 selected results are not available", { timeout: 60_000 });
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("compare-save-open")).toBeDisabled();
  await page.getByTestId("compare-remove-unavailable").first().click();
  await page.getByTestId("compare-remove-unavailable").first().click();
  await expect(page.getByTestId("compare-unavailable")).toHaveCount(0);
  expect(idsInUrl(page)).toEqual([a, b]);
  await expect(page.getByTestId("compare-save-open")).toBeEnabled();
});

test("saved comparisons: save the exact members in reference order, reopen, archive", async ({ page, request }) => {
  const [a, b, c] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  await open(page, [b!, a!, c!]); // b is the reference
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  const name = `Compare redesign ${Date.now()}`;
  await page.getByTestId("compare-save-open").click();
  await page.getByTestId("compare-save-name").fill(name);
  await page.getByTestId("compare-save").click();
  await expect(page.getByTestId("compare-feedback")).toContainText(`Saved “${name}”`);
  const list = (await (await request.get(`${API}/v1/projects/${PROJECT}/saved-comparisons`)).json()) as Json;
  const saved = list.comparisons.find((s: Json) => s.name === name);
  expect(saved.result_ids).toEqual([b, a, c]);
  // open from the empty state of a fresh page: exact members and the saved reference
  await open(page);
  await page.getByTestId("saved-menu").click();
  await page.getByTestId("saved-item").filter({ hasText: name }).getByTestId("saved-open").click();
  await expect(page.getByTestId("revalidation")).toHaveAttribute("data-status", "CURRENT", { timeout: 60_000 });
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).first()).toHaveAttribute("data-result-id", b!);
  expect(new URL(page.url()).searchParams.get("saved")).toBe(saved.id);
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  // editing leaves the saved link and says so; the saved record itself is unchanged
  await cards(page).nth(2).getByTestId("compare-remove").click();
  await expect(page.getByTestId("revalidation")).toContainText("selection has been changed");
  expect(new URL(page.url()).searchParams.get("saved")).toBeNull();
  const after = (await (await request.get(`${API}/v1/projects/${PROJECT}/saved-comparisons/${saved.id}`)).json()) as Json;
  expect(after.saved.result_ids).toEqual([b, a, c]);
  await page.screenshot({ path: `${SHOTS}/saved-opened.png` });
  // archive
  await page.getByTestId("saved-menu").click();
  await page.getByRole("button", { name: `Archive saved comparison ${name}` }).click();
  await expect(page.getByTestId("saved-item").filter({ hasText: name })).toHaveCount(0);
});

test("exports reflect the selected results and the real compatibility status", async ({ page, request }) => {
  const [a, b] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  const hf = byTask("ENERGY").find((r) => r.method === "hf")!;
  await open(page, [a!, b!, hf.result_id]);
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  const server = await serverComparison(request, [a!, b!, hf.result_id]);
  await page.getByTestId("compare-export").click();
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByTestId("compare-export-csv").click()]);
  const csvText = readFileSync((await csv.path())!, "utf8");
  expect(csvText).toContain(`# overall: ${server.overall}`);
  for (const id of [a, b, hf.result_id]) expect(csvText).toContain(id);
  await page.getByTestId("compare-export").click();
  const [json] = await Promise.all([page.waitForEvent("download"), page.getByTestId("compare-export-json").click()]);
  const doc = JSON.parse(readFileSync((await json.path())!, "utf8")) as Json;
  expect(doc.overall).toBe(server.overall);
  expect(doc.results.map((r: Json) => r.result_id)).toEqual([a, b, hf.result_id]);
  await page.getByTestId("compare-export").click();
  const [report] = await Promise.all([page.waitForEvent("download"), page.getByTestId("compare-report-html").click()]);
  const html = readFileSync((await report.path())!, "utf8");
  for (const id of [a, b, hf.result_id]) expect(html).toContain(id);
  expect(html).not.toMatch(/<script/i);
  expect(html).toMatch(/not scientifically comparable|NOT_SCIENTIFICALLY_COMPARABLE/i); // the warning is never dropped from the report
  await expect(page.getByTestId("compare-feedback")).toContainText("Saved chemdft-report");
});

test("structures: the recorded input geometry of each selected result, in the one molecular viewer", async ({ page }) => {
  const [a, b] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  await open(page, [a!, b!]);
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("compare-tab-structures").click();
  await expect(page.getByTestId("compare-structure")).toHaveCount(2);
  await expect(page.getByTestId("overview-viewer")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId("compare-structure-basis").first()).toContainText("not aligned or overlaid");
  await expect(page.getByRole("button", { name: "Reset view" }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/structures.png` });
});

test("provenance and rules name the stored facts; verification never changes because numbers agree", async ({ page }) => {
  const [a, b] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  await open(page, [a!, b!]);
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("compare-tab-provenance").click();
  for (const strip of await page.getByTestId("compare-state").all()) {
    await expect(strip).toContainText("Not independently verified");
    await expect(strip).not.toContainText(/\bVerified\b/);
  }
  await expect(page.getByTestId("compare-provenance")).toContainText(a!.slice(0, 8));
  await expect(page.getByTestId("compare-notice")).toContainText("not independent verification");
});

test("layout: both panes stay visible and the verdict stays in view at 1366, 1440 and 1920, dock open and closed", async ({ page }) => {
  const [a, b] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]] as const) {
    for (const dock of ["open", "closed"] as const) {
      await open(page, [a!, b!], { width, height, dock });
      await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("compare-library")).toBeInViewport();
      await expect(page.getByTestId("compare-analysis")).toBeInViewport();
      await expect(page.getByTestId("compare-head")).toBeInViewport();
      await expect(page.getByTestId("compare-overall")).toBeInViewport();
      // the title, both result identities, the verdict and the beginning of the table are all on the first screen
      await expect(page.getByTestId("compare-selected-card")).toHaveCount(2);
      for (const card of await page.getByTestId("compare-selected-card").all()) await expect(card).toBeInViewport({ ratio: 0.99 });
      await expect(page.getByTestId("compare-deltas").locator("tbody tr").first(), `table starts in view at ${width}x${height} dock ${dock}`).toBeInViewport({ ratio: 0.6 });
      expect(await noPageOverflow(page), `${width}x${height} ${dock}`).toBe(true);
      const split = await page.getByTestId("compare-split").boundingBox();
      const library = await page.getByTestId("compare-library").boundingBox();
      const analysis = await page.getByTestId("compare-analysis").boundingBox();
      expect(analysis!.width, "analysis gets more room than the library at normal widths").toBeGreaterThan(library!.width);
      expect(library!.x + library!.width).toBeLessThanOrEqual(analysis!.x);
      expect(split!.height).toBeGreaterThan(height * 0.6);
      await page.screenshot({ path: `${SHOTS}/layout-${width}x${height}-dock-${dock}.png` });
    }
  }
});

test("the divider resizes with the keyboard, is announced, and remembers its place", async ({ page }) => {
  const [a, b] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  await open(page, [a!, b!], { dock: "closed" });
  const divider = page.getByTestId("compare-divider");
  await expect(divider).toHaveAttribute("role", "separator");
  const width = async () => Math.round((await page.getByTestId("compare-library").boundingBox())!.width);
  const before = await width();
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(width).toBeGreaterThan(before + 20);
  const widened = await width();
  expect(Number(await divider.getAttribute("aria-valuenow"))).toBe(widened);
  await page.reload();
  await expect(page.getByTestId("compare-candidate").first()).toBeVisible({ timeout: 90_000 });
  await page.getByTestId("ai-dock-toggle").click().catch(() => {});
  await expect.poll(width).toBeGreaterThan(before + 20);
  await page.getByTestId("compare-divider").focus();
  await page.keyboard.press("Enter"); // reset to the default
  await expect.poll(width).toBeLessThanOrEqual(before + 20);
  await expect(page.getByTestId("compare-overall")).toBeVisible();
});

test("keyboard: the list, the reference controls and the tabs work without a mouse", async ({ page }) => {
  const [a, b] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  await open(page);
  await tick(page, a!).focus();
  await page.keyboard.press("Space");
  await tick(page, b!).focus();
  await page.keyboard.press("Space");
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByTestId("compare-announcement")).toContainText("2 results selected");
  await page.getByTestId("compare-tab-key").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("compare-tab-plots")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.getByTestId("compare-tab-rules")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("compare-tab-rules")).toBeFocused(); // roving focus has landed before we move on
  await cards(page).nth(1).getByTestId("compare-make-reference").focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => idsInUrl(page)).toEqual([b, a]);
});

test("narrow screens switch between the library and the comparison instead of breaking", async ({ page }) => {
  const [a, b] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  await open(page, [a!, b!], { width: 390, height: 844 });
  await expect(page.getByTestId("compare-pane-analysis")).toContainText("Comparison (2)");
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 }); // a shared link opens on the comparison
  expect(await noPageOverflow(page)).toBe(true);
  await page.getByRole("button", { name: "Results", exact: true }).click();
  await expect(page.getByTestId("compare-candidate").first()).toBeVisible();
  await expect(page.getByTestId("compare-overall")).toBeHidden();
  expect(await noPageOverflow(page)).toBe(true);
  await page.getByTestId("compare-pane-analysis").click();
  await expect(page.getByTestId("compare-overall")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/narrow-390.png` });
});

async function axeViolations(page: Page) {
  await page.evaluate(axe.source);
  const result = await page.evaluate(() => (window as unknown as { axe: typeof axe }).axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }));
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

test("accessibility: no serious or critical axe violations in any state, tab or open menu", async ({ page }) => {
  const [a, b] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  const hf = byTask("ENERGY").find((r) => r.method === "hf")!;
  await open(page);
  expect(await axeViolations(page), "empty").toEqual([]);
  await open(page, [a!]);
  await expect(page.getByTestId("compare-need-more")).toBeVisible();
  expect(await axeViolations(page), "one result").toEqual([]);
  await open(page, [a!, b!, hf.result_id]);
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  for (const tab of ["key", "plots", "data", "structures", "provenance", "rules"] as const) {
    await page.getByTestId(`compare-tab-${tab}`).click();
    await page.waitForTimeout(tab === "structures" ? 4000 : 600);
    expect(await axeViolations(page), `tab ${tab}`).toEqual([]);
  }
  await page.getByTestId("compare-export").click();
  await expect(page.getByTestId("compare-export-menu")).toBeVisible();
  expect(await axeViolations(page), "export menu").toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByTestId("compare-save-open").click();
  await expect(page.getByTestId("compare-save-form")).toBeVisible();
  expect(await axeViolations(page), "save popover").toEqual([]);
});

test("library rows tell identical-looking results apart: stored conditions, short id and stored time", async ({ page, request }) => {
  const thermo = byTask("THERMOCHEMISTRY");
  await open(page);
  const identities = new Set<string>();
  for (const stored of thermo) {
    const rowLocator = page.locator(`[data-testid=compare-candidate][data-result-id="${stored.result_id}"]`);
    const payload = ((await (await request.get(`${API}/v1/projects/${PROJECT}/results/${stored.result_id}`)).json()) as Json).payload.conditions as Json;
    const atm = Number((payload.pressure_pa / 101325).toPrecision(4));
    await expect(rowLocator.getByTestId("compare-row-conditions")).toHaveText(`T ${Number(payload.temperature_k.toFixed(2))} K · p ${atm} atm`);
    const identity = await rowLocator.getByTestId("compare-row-identity").innerText();
    expect(identity).toContain(`#${String(stored.result_id).slice(0, 8)}`);
    identities.add(identity);
  }
  expect(identities.size, "every thermochemistry row has its own identity line").toBe(thermo.length);
  // other result types show no conditions they do not have
  const energy = byTask("ENERGY")[0]!;
  await expect(page.locator(`[data-testid=compare-candidate][data-result-id="${energy.result_id}"]`).getByTestId("compare-row-conditions")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/library-identity.png` });
});

test("A–H navigator: all slots, the reference, previous/next, and navigating never changes the selection", async ({ page }) => {
  const all = rows.filter((r) => r.result_id).map((r) => r.result_id as string);
  await open(page, all.slice(0, 8), { dock: "closed" });
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("compare-nav-count")).toHaveText("8 of 8 selected");
  const slots = page.getByTestId("compare-nav-slot");
  await expect(slots).toHaveText(["A", "B", "C", "D", "E", "F", "G", "H"]);
  await expect(slots.first()).toHaveAttribute("data-reference", "true");
  await expect(slots.first()).toHaveAttribute("aria-label", /reference/);
  // previous / next move the card row; the last card is reachable with the buttons alone
  const strip = page.getByTestId("compare-selection");
  expect(await strip.evaluate((n) => n.scrollWidth > n.clientWidth)).toBe(true);
  const before = await strip.evaluate((n) => n.scrollLeft);
  await page.getByTestId("compare-strip-next").click();
  await expect.poll(() => strip.evaluate((n) => n.scrollLeft)).toBeGreaterThan(before);
  // a slot brings its card into view; with the keyboard too
  await slots.nth(7).focus();
  await page.keyboard.press("Enter");
  await expect(cards(page).nth(7)).toHaveAttribute("data-active", "true");
  await expect(cards(page).nth(7)).toBeInViewport({ ratio: 0.9 });
  await expect(slots.nth(7)).toHaveAttribute("aria-current", "true");
  // reference switching from a card and removal stay understandable, and the URL follows
  const ids = idsInUrl(page);
  await cards(page).nth(7).getByTestId("compare-make-reference").click();
  await expect.poll(() => idsInUrl(page)[0]).toBe(ids[7]);
  await expect(slots.first()).toHaveAttribute("data-reference", "true");
  await expect(cards(page).first()).toContainText("Reference");
  await cards(page).nth(3).getByTestId("compare-remove").click();
  await expect(page.getByTestId("compare-nav-count")).toHaveText("7 of 8 selected");
  await expect(slots).toHaveCount(7);
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 }); // settled: the verdict for the new selection has arrived
  await expect(page.getByTestId("compare-checking")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/eight-results-navigator.png` });
});

test("quantity-level status: identical thermal values are still 'not formed' when the conditions differ", async ({ page, request }) => {
  const thermo = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  const [a, b] = thermo;
  const server = await serverComparison(request, [a!, b!]);
  const conditions = async (id: string) => ((await (await request.get(`${API}/v1/projects/${PROJECT}/results/${id}`)).json()) as Json).payload.conditions as Json;
  const [ca, cb] = [await conditions(a!), await conditions(b!)];
  test.skip(ca.temperature_k === cb.temperature_k && ca.pressure_pa === cb.pressure_pa, "the first two thermochemistry results share their conditions");
  await open(page, [a!, b!]);
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
  const zpe = page.locator("[data-testid=compare-deltas] tbody tr[data-kind=zero_point_energy]");
  const stored = (server.results as Json[]).map((r) => r.quantities.find((q: Json) => q.kind === "zero_point_energy").value as number);
  expect(stored[0], "the two ZPE values are identical").toBe(stored[1]);
  await expect(zpe.locator("td").nth(0)).toContainText(stored[0]!.toFixed(10));
  await expect(zpe.locator("td").nth(1)).toContainText(stored[1]!.toFixed(10));
  await expect(zpe.getByTestId("compare-delta-withheld")).toContainText("Not formed");
  await expect(zpe.getByTestId("compare-delta")).toHaveCount(0); // no difference is computed from two equal numbers
  expect(server.pairs[0].deltas.find((d: Json) => d.quantity_kind === "zero_point_energy"), "the server formed none").toBeUndefined();
  // the electronic energy is T-independent: the server authorizes it, with limitations
  const energy = page.locator("[data-testid=compare-deltas] tbody tr[data-kind=total_electronic_energy]");
  await expect(energy.getByTestId("compare-delta")).toContainText("With limitations");
  await expect(page.getByTestId("compare-key-legend")).toContainText("Unavailable");
  // an explanation is reachable for assistive technology, once per status rather than a long warning in every cell
  await expect(zpe.getByTestId("compare-delta-withheld")).toHaveAttribute("title", /thermal difference/);
});

test("AI Scientist context: the dock follows the comparison, keeps its history under its own context and sends nothing", async ({ page }) => {
  const [a, b] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  const aiPosts: string[] = [];
  const contextBodies: Array<Record<string, unknown>> = [];
  page.on("request", (r) => {
    if (r.method() === "GET" || !r.url().includes("/ai/")) return;
    if (r.url().includes("/ai/context")) contextBodies.push((r.postDataJSON() ?? {}) as Record<string, unknown>);
    else aiPosts.push(`${r.method()} ${r.url()}`);
  });
  await open(page, [], { dock: "open" });
  const history = page.getByText("Previous conversation").first();
  await expect(history).toBeVisible({ timeout: 60_000 }); // the saved conversation has loaded
  await expect(page.getByTestId("compare-dock-context")).toHaveText("No results are selected for comparison.");
  await page.waitForTimeout(1500);
  await tick(page, a!).check();
  await tick(page, b!).check();
  await expect(page.getByTestId("compare-dock-context")).toHaveText(/^Comparing 2 results \(A, B\); reference: Thermochemistry · b3lyp/);
  await expect(page.getByTestId("compare-dock-notice")).toContainText("named, not grounded");
  await expect(page.getByTestId("compare-dock-notice")).toContainText("Nothing is sent unless you ask.");
  const chip = page.getByTestId("ai-scientist-panel");
  await expect(chip).toHaveAttribute("data-context-page", "compare");
  await expect(chip).toHaveAttribute("data-grounding", "named");
  await expect(page.getByTestId("ai-context-readonly")).toBeVisible();
  // the earlier answer belongs to its own context: under the comparison it is only in the collapsed history, never the answer
  await expect(history, "the conversation history is preserved").toBeVisible();
  // (the Evidence desk may still list a stored answer; what must not happen is an answer in this context's own thread)
  expect(await page.evaluate(() => [...document.querySelectorAll(".ai-scientist-panel .ai-message-bubble")].filter((el) => !el.closest("[data-testid=ai-history]")).length),
    "no earlier answer sits in the comparison's own thread").toBe(0);
  await expect(page.getByTestId("ai-empty-state")).toContainText("Ask about this comparison");
  await page.waitForTimeout(1500);
  expect(aiPosts, "comparing creates no AI run, message or approval").toEqual([]);
  const latest = contextBodies.at(-1) ?? {};
  expect(latest.current_view, "the assistant is told what is compared, by name").toMatch(/Calculation comparison \(A, B; reference Thermochemistry/);
  expect(Object.keys(latest), "no result id is sent: the server accepts one, never a list").toEqual(["current_view"]);
  // the note belongs to Compare only
  await page.goto(`${BASE}/results`);
  await expect(page.getByTestId("results-library")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("compare-dock-notice")).toHaveCount(0);
  await expect(page.getByTestId("ai-scientist-panel")).toHaveAttribute("data-context-page", "project");
});

test("narrow screens: no clipped card, no page overflow, tables scroll in their own region, actions reachable (390 and 820)", async ({ page }) => {
  const [a, b, c] = byTask("THERMOCHEMISTRY").map((r) => r.result_id as string);
  for (const [width, height, dock] of [[390, 844, "closed"], [820, 1000, "open"], [820, 1000, "closed"]] as const) {
    await open(page, [a!, b!, c!], { width, height, dock });
    await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 60_000 });
    expect(await noPageOverflow(page), `${width} ${dock}: no page-level overflow`).toBe(true);
    // every visible card sits fully inside the viewport
    for (const card of await cards(page).all()) {
      if (!(await card.isVisible())) continue;
      const box = (await card.boundingBox())!;
      if (width < 500) { expect(box.x, `${width} card left`).toBeGreaterThanOrEqual(0); expect(box.x + box.width, `${width} card right`).toBeLessThanOrEqual(width + 1); }
    }
    for (const label of ["compare-export", "compare-reset"]) await expect(page.getByTestId(label)).toBeInViewport();
    if (width < 500) {
      // reference + one chosen result at a time, chosen with the A–H slots
      await expect(page.locator("[data-testid=compare-selected-card]:visible")).toHaveCount(2);
      await page.getByTestId("compare-nav-slot").nth(2).click();
      await expect(cards(page).nth(2)).toBeVisible();
      await expect(cards(page).nth(1)).toBeHidden();
      await expect(cards(page).first()).toBeVisible(); // the reference stays
      await expect(page.getByTestId("compare-nav-slot").first()).toHaveAttribute("data-reference", "true");
    }
    // wide tables are intentionally scrollable inside a focusable region
    const region = page.getByTestId("compare-key").getByRole("region").first();
    await expect(region).toHaveAttribute("tabindex", "0");
    expect(await noPageOverflow(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/narrow-${width}-dock-${dock}.png` });
  }
});

test("the stored results are untouched by comparing, exporting and saving", async ({ request }) => {
  const after = await published(request);
  expect(after.total_published).toBe(15);
  for (const row of after.rows) {
    const before = rows.find((r) => r.result_id === row.result_id)!;
    expect(row.quantities).toEqual(before.quantities);
    expect(row.evidence_use).toBe(before.evidence_use);
    expect(row.effective_state).toEqual(before.effective_state);
  }
});
