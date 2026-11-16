import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import axe from "axe-core";

/**
 * RW-3 on a DISPOSABLE COPY of the accepted native-engine evidence:
 *   python3 tools/rw2_evidence_stack.py --api-port 8191 --web-port 3191   (prints RW2_EVIDENCE_READY ... workspace=<dir>)
 *   RW2_EVIDENCE_API_PORT=8191 RW2_EVIDENCE_WEB_PORT=3191 RW2_EVIDENCE_DB=<dir>/data/evidence.db \
 *   RW2_EVIDENCE_SPEC=e2e/rw3-workflows.spec.ts playwright test --config playwright.rw2-evidence.config.ts
 * Every number asserted is compared with what the API itself published. The persistent database is never opened.
 */
const PROJECT = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d"; // 15 genuine PySCF results
const OTHER_PROJECT = "3537048e-306a-4f4f-9b9e-493681c0df83";
const API = "/api/chemdft";
const BASE = `/en/projects/${PROJECT}`;
const SHOTS = resolve(process.env.CHEMDFT_RW3_SHOTS ?? "../../output/rw3-review");
mkdirSync(SHOTS, { recursive: true });
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

let saved: Json;
let energyRows: Json[] = [];

async function overview(request: import("@playwright/test").APIRequestContext): Promise<Json> {
  return (await (await request.get(`${API}/v1/projects/${PROJECT}/research-overview`)).json()) as Json;
}

/** Every published result, read through the server's paginated endpoint (never the 300-calculation overview). */
async function published(request: import("@playwright/test").APIRequestContext, params: Record<string, string> = {}): Promise<{ rows: Json[]; last: Json; pages: number }> {
  const rows: Json[] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const query = new URLSearchParams({ limit: "4", ...params, ...(cursor ? { cursor } : {}) });
    const body = (await (await request.get(`${API}/v1/projects/${PROJECT}/published-results?${query}`)).json()) as Json;
    rows.push(...body.rows);
    pages += 1;
    cursor = body.next_cursor;
    if (!cursor) return { rows, last: body, pages };
    expect(pages).toBeLessThan(50);
  }
}

async function axeViolations(page: Page) {
  await page.evaluate(axe.source);
  const result = await page.evaluate(() =>
    (window as unknown as { axe: typeof axe }).axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }),
  );
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

test("results library lists every published result from the paginated endpoint, filters and sorts", async ({ page, request }) => {
  const api = await overview(request);
  expect(api.rows).toHaveLength(15);
  energyRows = api.rows.filter((r: Json) => r.task === "ENERGY");
  // the paginated endpoint returns exactly the published results, with exact counts, whatever the page size
  const all = await published(request);
  expect(all.pages).toBeGreaterThan(1);
  expect(new Set(all.rows.map((r: Json) => r.result_id)).size).toBe(15);
  expect(all.last.total_published).toBe(15);
  expect(all.last.total_matching).toBe(15);
  expect(all.last.total_calculations).toBe(15);
  expect(all.last.without_result).toEqual({ pending: 0, failed: 0, canceled: 0, no_result: 0 });
  await page.goto(`${BASE}/results`);
  await expect(page.getByTestId("results-total")).toHaveText("15 published results");
  await expect(page.getByTestId("results-calculation-count")).toContainText("15 calculation records");
  await expect(page.getByTestId("results-count")).toHaveText("15 of 15 shown");
  await expect(page.getByTestId("results-row")).toHaveCount(15);
  await expect(page.getByTestId("jobs-pointer")).toHaveCount(0); // every calculation produced a result
  // displayed standing and value are the server's, not recomputed
  const first = api.rows.find((r: Json) => r.task === "ENERGY");
  const row = page.locator(`[data-testid="results-row"][data-result-id="${first.result_id}"]`);
  await expect(row).toContainText("Current");
  await expect(row).toContainText("Not independently verified");
  await expect(row).toContainText(String(first.quantities[0].value).slice(0, 8));
  await expect(row).toContainText("Eh");
  await page.screenshot({ path: `${SHOTS}/rw3-results-overview.png`, fullPage: true });

  // filters and search are the server's: the table equals the endpoint's own answer for the same filter
  await page.getByTestId("results-task").selectOption("FREQUENCY");
  const frequency = await published(request, { task: "FREQUENCY" });
  await expect(page.getByTestId("results-row")).toHaveCount(frequency.rows.length);
  await expect(page.getByTestId("results-count")).toHaveText(`${frequency.rows.length} of ${frequency.last.total_matching} shown`);
  expect(frequency.rows.length).toBe(api.rows.filter((r: Json) => r.task === "FREQUENCY").length);
  await page.getByTestId("results-clear").click();
  await page.getByTestId("results-search").fill("def2-svpd");
  const basis = await published(request, { q: "def2-svpd" });
  await expect(page.getByTestId("results-row")).toHaveCount(basis.rows.length);
  expect(basis.rows.length).toBe(api.rows.filter((r: Json) => r.basis === "def2-svpd").length);
  await page.getByTestId("results-search").fill("zzz-no-match");
  await expect(page.getByText("No published result matches these filters.")).toBeVisible();
  await expect(page.getByTestId("results-row")).toHaveCount(0);
  await expect(page.locator("[data-mode=multiple]")).toBeVisible(); // a filter never turns the table into an empty state
  await page.getByTestId("results-clear").click();
  await page.getByTestId("results-standing").selectOption("historical");
  await expect(page.getByTestId("results-row")).toHaveCount(0);
  expect((await published(request, { standing: "historical" })).last.total_matching).toBe(0);
  await page.getByTestId("results-clear").click();
  await page.getByTestId("results-sort-energy").click();
  await expect(page.locator('th[aria-sort="ascending"]')).toHaveCount(1);
  await page.getByTestId("results-sort-energy").click();
  await expect(page.locator('th[aria-sort="descending"]')).toHaveCount(1);
  // a sorted table is the server's order: stored energies ascending, results without a total energy last
  await page.getByTestId("results-sort-energy").click();
  await page.getByTestId("results-sort-energy").click();
  const sorted = await published(request, { sort: "energy", direction: "asc" });
  const energies = sorted.rows.filter((r: Json) => r.quantities.some((q: Json) => q.kind === "total_electronic_energy" && q.unit === "Eh"))
    .map((r: Json) => r.quantities.find((q: Json) => q.kind === "total_electronic_energy").value as number);
  expect(energies).toEqual([...energies].sort((x, y) => x - y));
  expect(sorted.rows.slice(energies.length).every((r: Json) => !r.quantities.some((q: Json) => q.kind === "total_electronic_energy"))).toBe(true);
});

test("pagination is stable and complete for every ordering on the real evidence", async ({ request }) => {
  for (const sort of ["updated", "task", "engine", "formula", "energy"]) {
    for (const direction of ["asc", "desc"]) {
      const { rows, last, pages } = await published(request, { sort, direction });
      const ids = rows.map((r: Json) => r.result_id);
      expect(new Set(ids).size, `${sort} ${direction} has no duplicates`).toBe(ids.length);
      expect(ids.length, `${sort} ${direction} is complete`).toBe(15);
      expect(pages).toBe(4);
      expect(last.total_published).toBe(15);
      const again = (await published(request, { sort, direction, limit: "7" })).rows.map((r: Json) => r.result_id);
      expect(again, "the page size never changes the order").toEqual(ids);
    }
  }
  const ascending = (await published(request, { sort: "updated", direction: "asc" })).rows.map((r: Json) => r.result_id);
  const descending = (await published(request, { sort: "updated", direction: "desc" })).rows.map((r: Json) => r.result_id);
  expect(new Set(ascending)).toEqual(new Set(descending));
});

test("the published-results endpoint is project-scoped and rejects bad cursors", async ({ request }) => {
  const foreign = (await (await request.get(`${API}/v1/projects/${OTHER_PROJECT}/published-results`)).json()) as Json;
  const mine = await published(request);
  expect(foreign.rows.every((r: Json) => !mine.rows.some((m: Json) => m.result_id === r.result_id))).toBe(true);
  expect((await request.get(`${API}/v1/projects/${PROJECT}/published-results?cursor=garbage`)).status()).toBe(422);
  expect((await request.get(`${API}/v1/projects/${randomUUID()}/published-results`)).status()).toBe(404);
  // reads only: the stored result keeps its authority, validation and verification axes
  const before = mine.rows[0]!;
  const stored = (await (await request.get(`${API}/v1/projects/${PROJECT}/results/${before.result_id}`)).json()) as Json;
  expect([stored.authority, stored.validation_state, stored.verification_state]).toEqual(["AUTHORITATIVE", "VALIDATED", "UNVERIFIED"]);
});

test("keyboard only: choose two results, compare them, save, report", async ({ page }) => {
  await page.goto(`${BASE}/results`);
  await page.getByTestId("results-task").selectOption("ENERGY");
  await expect(page.getByTestId("results-row")).toHaveCount(energyRows.length);
  const boxes = page.getByTestId("results-select");
  await boxes.nth(0).focus();
  await page.keyboard.press("Space");
  await boxes.nth(1).focus();
  await page.keyboard.press("Space");
  const compare = page.getByTestId("results-compare");
  await expect(compare).toHaveText("Compare 2 results");
  await compare.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/compare\?result=/);
  await expect(page.getByTestId("compare-output")).toBeVisible();
  // save with the keyboard: open the Save popover, name the comparison, submit with Enter
  await page.getByTestId("compare-save-open").focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("compare-save-name").focus();
  const name = `Water HF/STO-3G pair ${Date.now()}`;
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("compare-feedback")).toContainText(`Saved “${name}”`);
  await page.getByTestId("saved-menu").click();
  await expect(page.getByTestId("saved-item").filter({ hasText: name })).toHaveCount(1);
  await page.keyboard.press("Escape");
  const list = (await (await page.request.get(`${API}/v1/projects/${PROJECT}/saved-comparisons`)).json()) as Json;
  saved = list.comparisons.find((c: Json) => c.name === name);
  expect(saved).toBeTruthy();
  await page.screenshot({ path: `${SHOTS}/rw3-compare-save.png`, fullPage: true });
});

test("reopening a saved comparison revalidates; supersession is shown as historical", async ({ page, request }) => {
  await page.goto(`${BASE}/compare?saved=${saved.id}`);
  const panel = page.getByTestId("revalidation");
  await expect(panel).toHaveAttribute("data-status", "CURRENT");
  await expect(page.getByTestId("compare-output")).toBeVisible();

  const db = process.env.RW2_EVIDENCE_DB;
  test.skip(!db, "RW2_EVIDENCE_DB is required to supersede evidence in the disposable copy");
  const resultId = saved.result_ids[1] as string;
  const result = ((await (await request.get(`${API}/v1/projects/${PROJECT}/results/${resultId}`)).json()) as Json);
  const handle = new DatabaseSync(db!);
  handle.exec("PRAGMA busy_timeout = 20000");
  const original = handle.prepare("select * from provenance_records where id = ?").get(result.provenance_record_id) as Json;
  const successor: Json = { ...original, id: randomUUID(), subject_id: randomUUID(), supersedes_id: original.id, verification_state: "SUPERSEDED", correlation_id: randomUUID() };
  const columns = Object.keys(successor);
  handle.prepare(`insert into provenance_records (${columns.join(",")}) values (${columns.map(() => "?").join(",")})`).run(...columns.map((c) => successor[c]));
  handle.close();

  await page.goto(`${BASE}/compare?saved=${saved.id}`);
  await expect(panel).toHaveAttribute("data-status", "CHANGED");
  const changed = page.locator(`[data-testid="revalidation-table"] tr[data-status="STATE_CHANGED"]`);
  await expect(changed).toHaveCount(1);
  await expect(changed).toContainText("Historical");
  await expect(changed).toContainText("Scientific standing changed");
  await expect(page.getByTestId("compare-historical")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/rw3-saved-revalidated.png`, fullPage: true });

  // the overview now labels that calculation historical, and exports agree
  await page.goto(`${BASE}/results`);
  const row = page.locator(`[data-testid="results-row"][data-result-id="${resultId}"]`);
  await expect(row).toHaveAttribute("data-standing", "historical");
  await expect(row).toContainText("Historical · superseded");
  const header = await request.get(`${API}/v1/projects/${PROJECT}/scientific-report?format=html&result_id=${resultId}`);
  expect(header.headers()["x-chemdft-evidence-use"]).toBe("HISTORICAL_ONLY");
  expect(header.headers()["cache-control"]).toBe("no-store");
});

test("report download from the UI states the standing it was generated with", async ({ page }) => {
  await page.goto(`${BASE}/compare?saved=${saved.id}`);
  await expect(page.getByTestId("compare-output")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByTestId("compare-export").click();
  await page.getByTestId("compare-report-html").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^chemdft-report-\d{4}-\d{2}-\d{2}\.html$/);
  const text = readFileSync((await file.path())!, "utf8");
  expect(text).toContain("Evidence use: HISTORICAL_ONLY");
  expect(text).toContain("must not be cited as current");
  expect(text).toContain("<svg");
  expect(text).not.toMatch(/<script/i);
  await expect(page.getByText(/^Saved chemdft-report-.*\.html\.$/)).toBeVisible();
});

test("export panel offers the report and an honestly classified evidence archive", async ({ page, request }) => {
  await page.goto(`${BASE}/results`);
  await page.getByTestId("results-task").selectOption("FREQUENCY");
  // the row menu leads to the inspector with its Export section already open
  await page.getByTestId("results-row").first().getByTestId("row-actions").click();
  await page.locator('[data-testid="row-menu"] [data-action="export"]').click();
  await expect(page).toHaveURL(/\/results\/[0-9a-f-]+\?section=export/);
  await expect(page.getByTestId("export-panel")).toBeVisible();
  await expect(page.getByTestId("export-report")).toBeVisible();
  await expect(page.getByTestId("export-reproducibility-bundle")).toContainText(/Provenance archive|Reproducibility package/);
  await expect(page.getByTestId("export-reproducibility-bundle")).toContainText("exact reproduction is never claimed");
  const api = await overview(request);
  const calc = api.rows.find((r: Json) => r.task === "FREQUENCY").calculation_id as string;
  const bundle = await request.get(`${API}/v1/projects/${PROJECT}/calculations/${calc}/export?format=reproducibility-bundle`);
  expect(bundle.status()).toBe(200);
  expect(bundle.headers()["content-type"]).toBe("application/zip");
  expect(bundle.headers()["cache-control"]).toBe("no-store");
  expect((await bundle.body()).subarray(0, 2).toString()).toBe("PK");
  await page.screenshot({ path: `${SHOTS}/rw3-export-panel.png`, fullPage: true });
});

test("reuse: plan checks, confirmation creates a NEW calculation and leaves the old one untouched", async ({ page, request }) => {
  const before = await overview(request);
  const source = before.rows.find((r: Json) => r.task === "ENERGY" && r.result_id);
  await page.goto(`${BASE}/results`);
  await page.getByTestId("results-task").selectOption("ENERGY");
  await page.locator(`[data-testid="results-row"][data-calculation-id="${source.calculation_id}"]`).getByTestId("row-actions").click();
  await page.locator('[data-testid="row-menu"] [data-action="reuse"]').click();
  const dialog = page.getByTestId("reuse-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("reuse-checks")).toContainText("STRUCTURE_IDENTITY");
  await expect(page.getByTestId("reuse-checks")).toContainText("ELECTRONIC_STATE");
  await expect(page.getByTestId("reuse-checks")).toContainText("ENGINE_CAPABILITY");
  await page.screenshot({ path: `${SHOTS}/rw3-reuse-dialog.png` });
  const plan = (await (await request.get(`${API}/v1/projects/${PROJECT}/calculations/${source.calculation_id}/reuse-plan`)).json()) as Json;
  const confirm = page.getByTestId("reuse-confirm");
  if (!plan.can_reuse) {
    await expect(confirm).toBeDisabled(); // blocked plans can never be submitted
    await expect(page.getByTestId("reuse-checks").locator('[data-outcome="FAIL"]').first()).toBeVisible();
    return;
  }
  await confirm.click();
  await expect(page).toHaveURL(/\/workspace\?selection=calculation(:|%3A)/);
  const after = await overview(request);
  expect(after.rows).toHaveLength(before.rows.length + 1);
  const created = after.rows.find((r: Json) => !before.rows.some((b: Json) => b.calculation_id === r.calculation_id));
  expect(created.calculation_id).not.toBe(source.calculation_id);
  expect(created.task).toBe("ENERGY");
  expect(created.structure_version_id).toBe(source.structure_version_id);
  const old = after.rows.find((r: Json) => r.calculation_id === source.calculation_id);
  expect(old.result_id).toBe(source.result_id);
  expect(old.quantities).toEqual(source.quantities);
  expect(old.evidence_use).toBe(source.evidence_use);
});

test("jobs page shows persisted queue state and never a percentage", async ({ page, request }) => {
  const queue = (await (await request.get(`${API}/v1/projects/${PROJECT}/compute/queue-status`)).json()) as Json;
  await page.goto(`${BASE}/jobs`);
  const panel = page.getByTestId("queue-status");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("queue-queued")).toHaveText(String(queue.counts.queued));
  await expect(panel).toContainText("cannot observe a worker");
  await expect(panel).toContainText("No percent-complete is shown");
  expect(await page.locator("body").innerText()).not.toMatch(/\d+\s?%\s*(complete|done)/i);
  await page.screenshot({ path: `${SHOTS}/rw3-jobs-queue.png`, fullPage: true });
});

test("authorization: other projects cannot see or reopen this project's work", async ({ request }) => {
  const foreign = await request.get(`${API}/v1/projects/${OTHER_PROJECT}/saved-comparisons/${saved.id}`);
  expect(foreign.status()).toBe(404);
  expect(foreign.headers()["cache-control"]).toBe("no-store");
  const other = (await (await request.get(`${API}/v1/projects/${OTHER_PROJECT}/research-overview`)).json()) as Json;
  expect(other.rows.every((r: Json) => r.result_id !== saved.result_ids[0])).toBe(true);
  expect(JSON.stringify(other.saved_comparisons)).not.toContain(saved.id);
  const report = await request.get(`${API}/v1/projects/${OTHER_PROJECT}/scientific-report?format=html&result_id=${saved.result_ids[0]}`);
  expect(report.status()).toBe(404);
  const missing = await request.get(`${API}/v1/projects/${randomUUID()}/research-overview`);
  expect(missing.status()).toBe(404);
});

test("accessibility: no serious or critical axe violations on the RW-3 surfaces", async ({ page }) => {
  await page.goto(`${BASE}/results`);
  await expect(page.getByTestId("results-row").first()).toBeVisible();
  expect(await axeViolations(page), "results table").toEqual([]);
  await page.getByTestId("results-row").first().getByTestId("row-actions").click();
  await expect(page.getByTestId("row-menu")).toBeVisible();
  expect(await axeViolations(page), "row menu").toEqual([]);
  await page.locator('[data-testid="row-menu"] [data-action="reuse"]').click();
  await expect(page.getByTestId("reuse-dialog")).toBeVisible();
  expect(await axeViolations(page), "reuse dialog").toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("reuse-dialog")).toBeHidden();
  await page.getByTestId("results-open").first().click();
  await expect(page.getByTestId("result-inspector")).toBeVisible();
  await page.getByTestId("inspector-export").click();
  await expect(page.getByTestId("export-panel")).toBeVisible();
  expect(await axeViolations(page), "result inspector + export").toEqual([]);
  await page.goto(`${BASE}/compare?saved=${saved.id}`);
  await expect(page.getByTestId("revalidation")).toBeVisible();
  expect(await axeViolations(page), "compare + revalidation").toEqual([]);
  await page.goto(`${BASE}/jobs`);
  await expect(page.getByTestId("queue-status")).toBeVisible();
  expect(await axeViolations(page), "jobs").toEqual([]);
});
