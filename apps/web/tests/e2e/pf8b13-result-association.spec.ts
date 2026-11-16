import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { CalculationDetail } from "@chemdft/schemas";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openGuidedConfigure, preferGuidedMode, reviewAndAcknowledge } from "./guided-helpers";

const output = process.env.CHEMDFT_CORRECTIONS_SCREENSHOTS ?? "/tmp/chemdft-pf8b13-corrections/screenshots";
mkdirSync(output, { recursive: true });
const water = readFileSync(resolve("../../services/api/tests/fixtures/structures/test-user-supplied-water.xyz"));
let projectId: string;
let inputVersion: string;
let inputStructure: string;
let records: CalculationDetail[];

async function compute(request: APIRequestContext, engine: "pyscf" | "xtb", task: "ENERGY" | "ORBITAL" = "ENERGY") {
  const response = await request.post(`/api/chemdft/v1/projects/${projectId}/calculations`, { data: {
    structure_version: { project_id: projectId, entity_type: "structure.version", entity_id: inputVersion },
    specification: { task_type: task, method: { identifier: engine === "xtb" ? "gfn2" : "hf", display_name: engine === "xtb" ? "GFN2-xTB" : "HF", registry: "chemdft.method" }, basis: engine === "xtb" ? null : { identifier: "sto-3g", display_name: "STO-3G", registry: "chemdft.basis" }, charge: 0, multiplicity: 1, engine_preference: { engine } },
    provider_preference: "AUTO", idempotency_key: crypto.randomUUID(),
  } });
  expect(response.status(), await response.text()).toBe(201);
  let detail: CalculationDetail = await response.json();
  await expect.poll(async () => {
    detail = await (await request.get(`/api/chemdft/v1/projects/${projectId}/calculations/${detail.calculation.id}`)).json();
    return detail.calculation.state;
  }, { timeout: 90_000, intervals: [500, 1000] }).toBe("SUCCEEDED");
  return detail;
}

test.beforeAll(async ({ request }) => {
  const project = await request.post("/api/chemdft/v1/projects", { data: { name: "PF-8B1.3 multiple results regression", slug: `pf8b13-${crypto.randomUUID()}` } });
  expect(project.status()).toBe(201);
  projectId = (await project.json()).id;
  const imported = await request.post(`/api/chemdft/v1/projects/${projectId}/structures/imports`, { multipart: { upload: { name: "water.xyz", mimeType: "chemical/x-xyz", buffer: water }, file_format: "XYZ", structure_name: "Calculation input water", idempotency_key: crypto.randomUUID() } });
  expect(imported.status()).toBe(201);
  const input = await imported.json(); inputVersion = input.version.id; inputStructure = input.structure.id;
  records = [await compute(request, "pyscf"), await compute(request, "xtb"), await compute(request, "pyscf", "ORBITAL")];
  // A different current molecule must never supply the displayed energy's input provenance.
  const unrelated = await request.post(`/api/chemdft/v1/projects/${projectId}/structures/imports`, { multipart: { upload: { name: "other-water.xyz", mimeType: "chemical/x-xyz", buffer: Buffer.from(water.toString().replace("0.957200", "0.970000")) }, file_format: "XYZ", structure_name: "Other active water", idempotency_key: crypto.randomUUID() } });
  expect(unrelated.status()).toBe(201);
  writeFileSync(resolve(output, "multiple-result-api-records.json"), JSON.stringify({ projectId, inputVersion, inputStructure, records }, null, 2));
});
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });
async function open(page: Page, record = records[0]!) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/projects/${projectId}/workspace?selection=calculationResult:${record.result!.id}&source=${record.calculation.id}`);
  await expect(page.getByTestId("guided-result-picker")).toBeVisible();
}
async function assertEnergy(page: Page, detail: CalculationDetail) {
  const plate = page.getByTestId("energy-precision-plate");
  const result = detail.result!;
  expect(result.payload.payload_schema).toBe("chemdft.energy");
  const payload = result.payload as { total_energy: { value: number; unit: { code: string } } };
  await expect(plate).toHaveAttribute("data-calculation-id", detail.calculation.id);
  await expect(plate).toHaveAttribute("data-result-id", result.id);
  await expect(plate).toHaveAttribute("data-structure-version-id", inputVersion);
  await expect(plate).toHaveAttribute("data-engine", result.producer_software.name);
  await expect(plate).toHaveAttribute("data-method", detail.specification.method.identifier);
  await expect(plate).toHaveAttribute("data-input-hash", detail.calculation_input_hash);
  await expect(page.getByTestId("energy-readout-value")).toHaveText(payload.total_energy.value.toFixed(10));
  await expect(plate).toContainText(payload.total_energy.unit.code);
  await expect(plate).toContainText(inputStructure);
  await expect(plate).toContainText(result.provenance_record_id);
  await expect(plate).toContainText(result.validation_state);
  await expect(plate).toContainText(result.producer_software.version);
  await expect(plate).toContainText("Calculation input water V1");
  await expect(plate).not.toContainText("Other active water");
  await expect(page.getByTestId("ai-current-view")).toContainText("Total Energy");
  await expect(page.getByTestId("ai-current-view")).toContainText("Calculation input water V1");
}

test("repeated selection binds each actual PySCF/xTB result and keeps orbital results separate", async ({ page }) => {
  await open(page);
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const detail of records.slice(0, 2)) {
      await page.getByTestId("guided-result-picker").selectOption(detail.result!.id);
      await assertEnergy(page, detail);
      await expect(page.getByTestId("ai-current-view")).not.toContainText("HOMO");
      if (cycle === 0) await page.screenshot({ path: resolve(output, `selected-${detail.specification.engine_preference.engine}-energy.png`) });
    }
    await page.getByTestId("guided-result-picker").selectOption(records[2]!.result!.id);
    await expect(page.getByTestId("guided-result-view")).toBeVisible();
    const orbital = records[2]!;
    const boundOrbital = page.getByTestId("selected-orbital-result");
    await expect(boundOrbital).toHaveAttribute("data-result-id", orbital.result!.id);
    await expect(boundOrbital).toHaveAttribute("data-calculation-id", orbital.calculation.id);
    await expect(boundOrbital).toHaveAttribute("data-structure-version-id", inputVersion);
    await expect(boundOrbital).toHaveAttribute("data-engine", orbital.result!.producer_software.name);
    await expect(boundOrbital).toHaveAttribute("data-method", orbital.specification.method.identifier);
    await expect(boundOrbital).toContainText((orbital.result!.payload as { total_energy_hartree: number }).total_energy_hartree.toFixed(6));
    await expect(page.getByTestId("energy-precision-plate")).toHaveCount(0);
  }
  await page.getByTestId("guided-result-picker").selectOption(records[0]!.result!.id);
  await assertEnergy(page, records[0]!);
  await page.screenshot({ path: resolve(output, "switching-calculations.png") });
});

test("a delayed previous response cannot replace the latest selection", async ({ page }) => {
  await open(page, records[1]);
  await assertEnergy(page, records[1]!);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/calculations/${records[0]!.calculation.id}`, async (route) => {
    const response = await route.fetch();
    await pending;
    await route.fulfill({ response });
  });
  await page.getByTestId("guided-result-picker").selectOption(records[0]!.result!.id);
  await expect(page.getByTestId("selected-result-loading")).toBeVisible();
  await expect(page.getByTestId("energy-precision-plate")).toHaveCount(0);
  await page.getByTestId("guided-result-picker").selectOption(records[1]!.result!.id);
  await assertEnergy(page, records[1]!);
  release();
  await page.unrouteAll({ behavior: "wait" });
  await assertEnergy(page, records[1]!);
  // Rapidly change the selection before any selected-result fetch can settle.
  for (const detail of [records[0]!, records[2]!, records[0]!, records[1]!]) {
    await page.getByTestId("guided-result-picker").selectOption(detail.result!.id);
  }
  await assertEnergy(page, records[1]!);
});

test("unavailable and mismatched selected records show errors without another energy", async ({ page }) => {
  await open(page, records[1]); await assertEnergy(page, records[1]!);
  await page.route(`**/calculations/${records[0]!.calculation.id}`, (route) => route.fulfill({ status: 200, json: records[1] }));
  await page.getByTestId("guided-result-picker").selectOption(records[0]!.result!.id);
  await expect(page.getByTestId("selected-result-error")).toContainText("unavailable");
  await expect(page.getByTestId("energy-precision-plate")).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  await page.getByTestId("guided-result-picker").selectOption(records[1]!.result!.id); await assertEnergy(page, records[1]!);
  await page.route(`**/calculations/${records[0]!.calculation.id}`, (route) => route.fulfill({ status: 404, json: { detail: "Selected result unavailable" } }));
  await page.getByTestId("guided-result-picker").selectOption(records[0]!.result!.id);
  await expect(page.getByTestId("selected-result-error")).toContainText("unavailable");
  await expect(page.getByTestId("energy-precision-plate")).toHaveCount(0);
});

test("Advanced geometry opens the actual immutable calculation input", async ({ page }) => {
  await open(page); await assertEnergy(page, records[0]!);
  await page.getByTestId("mode-toggle-advanced").click();
  await expect(page.getByTestId("energy-precision-plate")).toBeVisible();
  await page.screenshot({ path: resolve(output, "advanced-energy-plate.png") });
  await page.getByRole("button", { name: "3D Geometry", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`selection=structureVersion(:|%3A)${inputVersion}`));
  const workbench = page.getByTestId("structure-version-workbench");
  await expect(workbench).toBeVisible();
  await expect(workbench).toContainText("Calculation input water");
  await expect(workbench.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect(workbench).not.toContainText("Loading Scientific View");
  await page.screenshot({ path: resolve(output, "advanced-input-geometry.png") });
});

test("narrow result navigation and keyboard focus remain accessible", async ({ page }) => {
  await open(page); await assertEnergy(page, records[0]!);
  await page.setViewportSize({ width: 1024, height: 768 });
  const results = page.getByTestId("guided-nav-results");
  await results.focus(); await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("guided-nav-electronic")).toBeFocused();
  await page.keyboard.press("ArrowUp"); await expect(results).toBeFocused();
  await page.keyboard.press("End"); await expect(page.getByTestId("guided-nav-imported")).toBeFocused();
  await page.keyboard.press("Home"); await expect(page.getByTestId("guided-nav-overview")).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByTestId("guided-nav-structure")).toBeFocused();
  await page.screenshot({ path: resolve(output, "narrow-results-navigation.png") });
  await page.addScriptTag({ path: resolve("node_modules/axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axeWindow = window as typeof window & { axe: { run: (target: Element | null, options: unknown) => Promise<{ violations: Array<{ id: string }> }> } };
    return (await axeWindow.axe.run(document.querySelector('[data-testid="guided-left-nav"]'), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map((violation) => violation.id);
  });
  expect(violations).toEqual([]);
});

test("Guided Overview recognizes published energy and preserves the selected calculation", async ({ page }) => {
  await open(page, records[0]); await assertEnergy(page, records[0]!);
  await page.getByTestId("guided-nav-overview").click();
  await expect(page.getByTestId("guided-primary-action-btn")).toContainText("Explore results");
  await page.getByTestId("guided-primary-action-btn").click();
  await assertEnergy(page, records[0]!);
});

test("a completed submission cannot take over a result selected while it was pending", async ({ page }) => {
  await preferGuidedMode(page);
  await open(page, records[0]); await assertEnergy(page, records[0]!);
  // The project's structure now has a newer (unrelated) version; confirm its inputs and configure an xTB energy
  await openGuidedConfigure(page);
  await expect(page.getByTestId("guided-engine-xtb-btn")).toBeEnabled();
  await page.getByTestId("guided-engine-xtb-btn").click();
  await reviewAndAcknowledge(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/calculations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch(); await gate; await route.fulfill({ response });
  });
  await page.getByTestId("run-calculation-btn").click();
  await expect(page.getByTestId("run-calculation-btn")).toContainText("Submitting");
  await page.getByTestId("guided-nav-results").click();
  await page.getByTestId("guided-result-picker").selectOption(records[1]!.result!.id);
  await assertEnergy(page, records[1]!);
  release();
  await page.getByTestId("guided-nav-calculations").click();
  await expect(page.getByTestId("guided-job-state")).toContainText("Succeeded", { timeout: 90_000 });
  await page.getByTestId("guided-nav-results").click();
  await assertEnergy(page, records[1]!);
});
