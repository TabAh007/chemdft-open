import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Compare with a NONZERO server-formed difference, on explicitly labelled TEST FIXTURES in the DISPOSABLE stack.
 *
 * The accepted evidence contains no pair with a nonzero comparable difference, so tools/compare_fixture_seed.py adds a
 * project named "COMPARE TEST FIXTURE (deterministic test values, not scientific results)" whose results are copies of
 * the accepted PySCF HF/STO-3G water record with labelled energy offsets (and one other level of theory). The verdicts and
 * the deltas are still produced by the server's own evaluator; this spec only checks that plots, tables, unit
 * conversions and verdicts agree with it. None of these values is a ChemDFT scientific result.
 *
 *   python3 tools/rw2_evidence_stack.py --api-port 8191 --web-port 3191
 *   .venv/bin/python tools/compare_fixture_seed.py --api-url http://127.0.0.1:8191 --database <workspace>/data/evidence.db --out output/compare-fixture.json
 *   CHEMDFT_COMPARE_FIXTURE=$PWD/../../output/compare-fixture.json RW2_EVIDENCE_API_PORT=8191 RW2_EVIDENCE_WEB_PORT=3191 \
 *   RW2_EVIDENCE_SPEC=e2e/compare-fixture.spec.ts playwright test --config playwright.rw2-evidence.config.ts
 */
const FIXTURE_FILE = process.env.CHEMDFT_COMPARE_FIXTURE;
const SHOTS = resolve(process.env.CHEMDFT_COMPARE_SHOTS ?? "../../output/compare-review");
mkdirSync(SHOTS, { recursive: true });
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
test.skip(!FIXTURE_FILE, "CHEMDFT_COMPARE_FIXTURE is required (see the header)");

const fixture = (): Json => JSON.parse(readFileSync(FIXTURE_FILE!, "utf8")) as Json;
const API = "/api/chemdft";

async function server(request: import("@playwright/test").APIRequestContext, ids: string[]): Promise<Json> {
  const response = await request.get(`${API}/v1/projects/${fixture().project_id}/calculation-comparison?${ids.map((i) => `result_id=${i}`).join("&")}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Json;
}

async function open(page: Page, keys: string[], opts: { width?: number; height?: number; dock?: "open" | "closed" } = {}) {
  const f = fixture();
  await page.setViewportSize({ width: opts.width ?? 1440, height: opts.height ?? 900 });
  await page.addInitScript(() => { try { localStorage.setItem("chemdft:workspace-mode", "guided"); } catch { /* optional */ } });
  await page.goto(`/en/projects/${f.project_id}/compare?${keys.map((k) => `result=${f.results[k]}`).join("&")}`);
  await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 90_000 });
  if (opts.dock) {
    const collapsed = (await page.locator(".project-shell.dock-collapsed").count()) === 1;
    if (collapsed !== (opts.dock === "closed")) await page.getByTestId("ai-dock-toggle").click();
  }
}

test("the fixture is labelled as a test fixture everywhere a researcher could meet it", async ({ page }) => {
  await open(page, ["reference", "directly_comparable"]);
  await expect(page.locator("[data-testid=research-context]")).toContainText("COMPARE TEST FIXTURE");
  await expect(page.getByTestId("compare-selected-card").first()).toContainText("FIXTURE water (test values, not scientific evidence)");
});

test("directly comparable: a nonzero difference, authorized, agreeing with the server in every unit", async ({ page, request }) => {
  const f = fixture();
  const ids = [f.results.reference, f.results.directly_comparable];
  const api = await server(request, ids);
  expect(api.overall).toBe("DIRECTLY_COMPARABLE");
  const delta = api.pairs[0].deltas.find((d: Json) => d.quantity_kind === "total_electronic_energy");
  expect(delta.delta).not.toBe(0);
  expect(Math.abs(delta.delta - f.offsets_eh.directly_comparable)).toBeLessThan(1e-9); // the server subtracted the stored values
  await open(page, ["reference", "directly_comparable"], { dock: "closed" });
  await expect(page.getByTestId("compare-overall")).toHaveText("Directly comparable");
  await expect(page.getByTestId("compare-pass-count")).toContainText("All 7 rules pass");
  // key table: the delta cell, its sub-lines and its status
  const cell = page.getByTestId("compare-delta");
  await expect(cell).toContainText(delta.delta.toPrecision(7).slice(0, 8));
  await expect(cell).toContainText(String(delta.delta_kcal_per_mol).slice(0, 6));
  await expect(cell).toContainText(String(delta.delta_kj_per_mol).slice(0, 6));
  await expect(cell).toContainText("Authorized");
  await page.screenshot({ path: `${SHOTS}/two-comparable-fixture.png` });
  // plot: one bar, value and unit equal to the server's own conversions
  await page.getByTestId("compare-tab-plots").click();
  const plot = page.getByTestId("compare-plot-delta");
  await expect(plot).toBeVisible({ timeout: 30_000 });
  await expect(plot.getByTestId("compare-chart")).toHaveAttribute("role", "img");
  await expect(plot.getByTestId("compare-plot-identical")).toHaveCount(0);
  await plot.getByText("Data table for this plot").click();
  const table = plot.locator("table");
  await expect(table).toContainText("Δ (kcal/mol)");
  await expect(table).toContainText(String(delta.delta_kcal_per_mol).slice(0, 7));
  await plot.getByTestId("compare-plot-unit").selectOption("kj");
  await expect(table).toContainText("Δ (kJ/mol)");
  await expect(table).toContainText(String(delta.delta_kj_per_mol).slice(0, 7));
  await plot.getByTestId("compare-plot-unit").selectOption("native");
  await expect(table).toContainText("Δ (Eh)");
  await expect(table).toContainText(String(delta.delta).slice(0, 10));
  await plot.getByTestId("compare-plot-unit").selectOption("kcal");
  await page.screenshot({ path: `${SHOTS}/plot-nonzero-difference.png` });
});

test("comparable with limitations: authorized with a stated limitation, and drawn hatched", async ({ page, request }) => {
  const f = fixture();
  const api = await server(request, [f.results.reference, f.results.with_limitations]);
  expect(api.overall).toBe("COMPARABLE_WITH_LIMITATIONS");
  expect(api.pairs[0].rules.filter((r: Json) => r.outcome === "LIMITATION").map((r: Json) => r.rule_id)).toEqual(["R6_ENGINE"]);
  await open(page, ["reference", "with_limitations"]);
  await expect(page.getByTestId("compare-overall")).toHaveText("Comparable with limitations");
  await expect(page.getByTestId("compare-compat")).toContainText("Engine.");
  await expect(page.getByTestId("compare-compat")).toContainText("Different pyscf versions");
  await expect(page.getByTestId("compare-delta")).toContainText("With limitations");
  await expect(page.getByTestId("compare-delta")).toContainText("engine");
  await page.getByTestId("compare-tab-plots").click();
  await expect(page.getByTestId("compare-plot-delta")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("compare-plot-delta").getByText("Data table for this plot").click();
  await expect(page.getByTestId("compare-plot-delta").locator("table")).toContainText("Comparable with limitations");
});

test("incompatible: no difference, no plot, the failed rule and what to change", async ({ page, request }) => {
  const f = fixture();
  const api = await server(request, [f.results.reference, f.results.incompatible_other_level]);
  expect(api.overall).toBe("NOT_SCIENTIFICALLY_COMPARABLE");
  expect(api.pairs[0].deltas).toEqual([]);
  await open(page, ["reference", "incompatible_other_level"]);
  await expect(page.getByTestId("compare-overall")).toHaveText("Not scientifically comparable");
  await expect(page.getByTestId("compare-delta")).toHaveCount(0);
  await expect(page.getByTestId("compare-delta-blocked")).toContainText("Incompatible");
  await expect(page.getByTestId("compare-delta-blocked")).toContainText("level of theory");
  await expect(page.getByTestId("compare-remedy")).toContainText("No numerical difference is shown.");
  await page.getByTestId("compare-tab-plots").click();
  await expect(page.getByTestId("compare-no-plot")).toBeVisible();
  await expect(page.getByTestId("compare-chart")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/two-incompatible-fixture.png` });
});

test("four results: the plot draws only the pairings the server authorized and says what it left out", async ({ page, request }) => {
  const f = fixture();
  const keys = ["reference", "directly_comparable", "with_limitations", "incompatible_other_level"];
  const api = await server(request, keys.map((k) => f.results[k]));
  await open(page, keys);
  await expect(page.getByTestId("compare-output")).toHaveAttribute("data-overall", api.overall);
  await expect(page.getByTestId("compare-nav-count")).toHaveText("4 of 8 selected");
  await page.getByTestId("compare-tab-plots").click();
  const plot = page.getByTestId("compare-plot-delta");
  await expect(plot).toBeVisible({ timeout: 30_000 });
  await expect(plot).toContainText("1 not scientifically comparable result is not drawn");
  await plot.getByText("Data table for this plot").click();
  const rowsText = await plot.locator("tbody tr").allInnerTexts();
  expect(rowsText).toHaveLength(3); // the reference at zero and the two authorized pairings
  await page.getByTestId("compare-tab-key").click();
  const statuses = await page.locator("[data-testid=compare-deltas] tbody tr[data-kind=total_electronic_energy] [data-status]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-status")));
  expect(statuses).toEqual(["authorized", "limited", "incompatible"]);
  await page.screenshot({ path: `${SHOTS}/four-results-fixture.png` });
});
