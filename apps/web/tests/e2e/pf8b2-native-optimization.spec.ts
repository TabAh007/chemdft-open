import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { CalculationDetail, OptimizationResult } from "@chemdft/schemas";
import { mkdirSync, writeFileSync } from "node:fs";
import { openGuidedConfigure, openResultFromJob, preferGuidedMode, reviewAndAcknowledge } from "./guided-helpers";
import { resolve } from "node:path";

const output = resolve(process.env.CHEMDFT_PF8B2_OUTPUT ?? "../../output/playwright/pf8b2");
mkdirSync(output, { recursive: true });
const xyz = "3\nDistorted water\nO 0 0 0\nH 0 0 1.2\nH 1.1 0 -0.3\n";
async function seed(request: APIRequestContext, geometry = xyz) {
  const created = await request.post("/api/chemdft/v1/projects", { data: { name: "Disposable PF-8B2 native optimization", slug: `pf8b2-${crypto.randomUUID()}` } });
  expect(created.status()).toBe(201);
  const project: string = (await created.json()).id;
  const imported = await request.post(`/api/chemdft/v1/projects/${project}/structures/imports`, { multipart: { upload: { name: "distorted-water.xyz", mimeType: "chemical/x-xyz", buffer: Buffer.from(geometry) }, file_format: "XYZ", idempotency_key: crypto.randomUUID() } });
  expect(imported.status()).toBe(201);
  return { project, input: (await imported.json()).version };
}
async function completion(request: APIRequestContext, project: string, id: string, state = "SUCCEEDED") {
  let detail: CalculationDetail;
  await expect.poll(async () => {
    detail = await (await request.get(`/api/chemdft/v1/projects/${project}/calculations/${id}`)).json();
    return detail.calculation.state;
  }, { timeout: 120_000, intervals: [500, 1000] }).toBe(state);
  return detail!;
}
async function configure(page: Page, project: string, mode: "guided" | "advanced", engine: "xtb" | "pyscf", maximum: number) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await preferGuidedMode(page);
  await page.goto(`/en/projects/${project}/workspace`);
  await expect(page.getByTestId("guided-project-home")).toBeVisible();
  if (mode === "guided") {
    // Structure (confirm charge and multiplicity) → Configure → geometry optimization → Review & Submit
    await openGuidedConfigure(page);
    await page.getByTestId("guided-family").selectOption({ label: "Geometry optimization" });
    // The first selectable engine (xTB) is preselected; an unavailable engine is never preselected
    await expect(page.getByTestId("guided-engine-xtb-btn")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("guided-engine-pyscf-btn")).toHaveAttribute("aria-checked", "false");
    await page.getByTestId(`guided-engine-${engine}-btn`).click();
    await page.getByText("Advanced settings", { exact: true }).click();
    await page.locator("#calc-max-steps").fill(String(maximum));
    await reviewAndAcknowledge(page);
  } else {
    await page.getByTestId("mode-toggle-advanced").click();
    const panel = page.locator(".calculation-panel");
    await panel.getByRole("combobox", { name: "Engine", exact: true }).selectOption(engine);
    await panel.getByRole("combobox", { name: "Task", exact: true }).selectOption("GEOMETRY_OPTIMIZATION");
    await expect(panel.getByRole("combobox", { name: "Engine", exact: true })).toHaveValue(engine);
    await panel.getByRole("spinbutton", { name: "Maximum steps" }).fill(String(maximum));
  }
}
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });

for (const mode of ["guided", "advanced"] as const) test(`${mode}: real native optimization publishes hash-bound geometry and final energy`, async ({ page, request }) => {
  const { project, input } = await seed(request);
  await configure(page, project, mode, "xtb", 100);
  await page.screenshot({ path: resolve(output, `${mode}-native-setup.png`), fullPage: true });
  const submitted = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/calculations"));
  await (mode === "guided" ? page.getByTestId("run-calculation-btn") : page.getByRole("button", { name: "Optimize geometry", exact: true })).click();
  const response = await submitted;
  expect(response.status(), await response.text()).toBe(201);
  const spec = response.request().postDataJSON().specification;
  expect(spec.engine_preference).toEqual({ engine: "xtb", allowed_version: "6.7.1" });
  expect(spec.basis).toBeNull();
  expect(spec.optimization).toMatchObject({ optimizer: "xtb-ancopt", xtb_level: "normal", max_steps: 100 });
  const queued: CalculationDetail = await response.json();
  const detail = await completion(request, project, queued.calculation.id);
  // A finished job is not opened automatically; the job panel offers "Open result"
  if (mode === "guided") await openResultFromJob(page);
  const payload = detail.result!.payload as OptimizationResult;
  expect(detail.result!.validation_state).toBe("VALIDATED");
  expect(detail.result!.trusted_producer_id).toBe("local.xtb.worker");
  expect(payload.optimization_iterations).toBe(detail.optimization_trajectory!.steps.length - 1);
  const versions = await (await request.get(`/api/chemdft/v1/projects/${project}/structures/${input.structure_id}/versions`)).json();
  expect(versions).toHaveLength(2);
  expect(versions[0].version.coordinates).toEqual(input.coordinates);
  expect(versions[1].version.parent_version_id).toBe(input.id);
  expect(versions[1].version.id).toBe(payload.final_structure_version_id);
  writeFileSync(resolve(output, `${mode}-native-evidence.json`), JSON.stringify({detail, versions}, null, 2));
  if (mode === "advanced") await page.getByRole("button", { name: "Open trajectory", exact: true }).click();
  const player = page.getByRole("region", { name: "Optimization trajectory" });
  await expect(player.locator(".optimization-head strong")).toHaveText("Run: CONVERGED", { timeout: 60_000 });
  await expect(player.getByTestId("optimization-result-summary")).toContainText(payload.final_energy.value.toString());
  await expect(player).toContainText("Final single-point evaluation (not an optimizer iteration)");
  await expect(player).toContainText("local minimum is not established");
  await expect(player.getByLabel("Scientific View molecule viewport")).toBeVisible({timeout: 60_000});
  await expect(player.getByLabel("Scientific View molecule viewport").locator("canvas")).toBeVisible();
  await expect(player).not.toContainText("Loading trajectory viewer");
  if (mode === "guided") {
    await expect(page.getByTestId("guided-nav-optimization")).toHaveAttribute("aria-current", "page");
    await page.getByTestId("guided-nav-overview").click();
    await page.getByTestId("guided-nav-optimization").click();
    await expect(page.getByTestId("selected-optimization-result")).toHaveAttribute("data-result-id", detail.result!.id);
    await expect(player.getByLabel("Scientific View molecule viewport").locator("canvas")).toBeVisible();
    await page.getByRole("button", {name: "Open starting structure", exact: true}).click();
    await expect(page).toHaveURL(new RegExp(input.id));
    await expect(page.getByTestId("guided-structure-view")).toContainText(`V${input.revision}`);
    await page.getByTestId("guided-nav-optimization").click();
    await expect(page.getByTestId("selected-optimization-result")).toHaveAttribute("data-result-id", detail.result!.id);
    await expect(player.getByLabel("Scientific View molecule viewport").locator("canvas")).toBeVisible();
  }
  await page.screenshot({ path: resolve(output, `${mode}-native-final.png`), fullPage: true });
  await player.getByRole("button", { name: "First step", exact: true }).click();
  await expect(player).toContainText("Viewing evaluation 1 /");
  await page.reload();
  await expect(player).toContainText("Viewing evaluation 1 /");
  await player.getByRole("button", { name: "Final available step" }).click();
  await player.getByRole("button", { name: "Open optimized structure" }).click();
  await expect(page).toHaveURL(new RegExp(payload.final_structure_version_id));
});

test("Guided native maxcycle=1 shows nonconvergence without a published endpoint", async ({ page, request }) => {
  const { project, input } = await seed(request);
  await configure(page, project, "guided", "xtb", 1);
  const submitted = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/calculations"));
  await page.getByTestId("run-calculation-btn").click();
  const initial: CalculationDetail = await (await submitted).json();
  const detail = await completion(request, project, initial.calculation.id, "FAILED");
  expect(detail.attempt!.failure_code).toBe("NONCONVERGED");
  expect(detail.result).toBeNull();
  expect(detail.optimization_trajectory!.state).toBe("NOT_CONVERGED");
  expect(detail.optimization_trajectory!.final_structure_version_id).toBeNull();
  await expect(page.getByTestId("guided-job-state")).toContainText("Failed");
  await expect(page.getByTestId("guided-job-failure")).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("guided-primary-open-result")).toHaveCount(0);
  const versions = await (await request.get(`/api/chemdft/v1/projects/${project}/structures/${input.structure_id}/versions`)).json();
  expect(versions).toHaveLength(1);
  await page.getByTestId("mode-toggle-advanced").click();
  await page.goto(`/en/projects/${project}/workspace?selection=calculation:${detail.calculation.id}`);
  await expect(page.getByRole("region", { name: "Optimization trajectory" })).toContainText("NOT CONVERGED");
  await expect(page.getByRole("button", { name: "Open optimized structure" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Optimization trajectory" }).getByLabel("Scientific View molecule viewport").locator("canvas")).toBeVisible();
  await page.screenshot({ path: resolve(output, "native-nonconvergence.png"), fullPage: true });
});

test("Advanced real PySCF optimization remains publishable", async ({ page, request }) => {
  const { project } = await seed(request);
  await configure(page, project, "advanced", "pyscf", 100);
  const submitted = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/calculations"));
  await page.getByRole("button", { name: "Optimize geometry", exact: true }).click();
  const response = await submitted;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON().specification.optimization.optimizer).toBe("geometric");
  const detail = await completion(request, project, (await response.json()).calculation.id);
  expect(detail.result!.producer_software.name).toBe("pyscf");
  await page.getByRole("button", { name: "Open trajectory", exact: true }).click();
  await expect(page.getByRole("region", { name: "Optimization trajectory" })).toContainText("PySCF + geomeTRIC");
  await expect(page.getByRole("region", { name: "Optimization trajectory" }).getByLabel("Scientific View molecule viewport").locator("canvas")).toBeVisible();
  await page.screenshot({ path: resolve(output, "pyscf-optimization-regression.png"), fullPage: true });
});

test("multiple energy/optimization results and versions remain associated during delayed switching", async ({ page, request }) => {
  const { project, input } = await seed(request);
  const records: CalculationDetail[] = [];
  let versionId = input.id;
  for (const task of ["ENERGY", "GEOMETRY_OPTIMIZATION", "GEOMETRY_OPTIMIZATION"] as const) {
    const submitted = await request.post(`/api/chemdft/v1/projects/${project}/calculations`, { data: {
      structure_version: { project_id: project, entity_type: "structure.version", entity_id: versionId },
      specification: { task_type: task, method: { identifier: "gfn2", display_name: "GFN2-xTB", registry: "chemdft.method" }, basis: null, charge: 0, multiplicity: 1, engine_preference: { engine: "xtb", allowed_version: "6.7.1" }, ...(task === "GEOMETRY_OPTIMIZATION" ? { optimization: { optimizer: "xtb-ancopt", xtb_level: "normal", max_steps: 100 } } : {}) },
      idempotency_key: crypto.randomUUID(),
    } });
    expect(submitted.status()).toBe(201);
    const detail = await completion(request, project, (await submitted.json()).calculation.id);
    records.push(detail);
    if (task === "GEOMETRY_OPTIMIZATION") versionId = (detail.result!.payload as OptimizationResult).final_structure_version_id;
  }
  await page.goto(`/en/projects/${project}/workspace?selection=calculationResult:${records[1]!.result!.id}&source=${records[1]!.calculation.id}`);
  await expect(page.getByTestId("selected-optimization-result")).toHaveAttribute("data-result-id", records[1]!.result!.id);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/calculations/${records[1]!.calculation.id}`, async (route) => { const response = await route.fetch(); await gate; await route.fulfill({response}); });
  const picker = page.getByTestId("guided-result-picker");
  await picker.selectOption(records[0]!.result!.id);
  await expect(page.getByTestId("energy-precision-plate")).toHaveAttribute("data-result-id", records[0]!.result!.id);
  await picker.selectOption(records[1]!.result!.id);
  await expect(page.getByTestId("selected-result-loading")).toBeVisible();
  await expect(page.getByTestId("optimization-result-summary")).toHaveCount(0);
  await picker.selectOption(records[2]!.result!.id);
  await expect(page.getByTestId("selected-optimization-result")).toHaveAttribute("data-result-id", records[2]!.result!.id);
  release();
  await expect(page.getByTestId("selected-optimization-result")).toHaveAttribute("data-result-id", records[2]!.result!.id);
  await expect(page.getByTestId("selected-optimization-result")).toHaveAttribute("data-structure-version-id", (records[1]!.result!.payload as OptimizationResult).final_structure_version_id);
  await expect(page.getByTestId("optimization-result-summary")).toHaveAttribute("data-calculation-id", records[2]!.calculation.id);
  await expect(page.getByTestId("optimization-result-summary")).toContainText((records[2]!.result!.payload as OptimizationResult).final_energy.value.toString());
  await page.screenshot({ path: resolve(output, "multiple-results-selected-optimization.png"), fullPage: true });
});

test("registry withholds unsupported native optimization and no engine is silently substituted", async ({ page, request }) => {
  const { project } = await seed(request);
  await page.route("**/calculations/capabilities", async (route) => {
    const response = await route.fetch();
    const items = await response.json();
    await route.fulfill({response, json: items.map((item: {engine: string}) => item.engine === "xtb" ? {...item, version: "6.6.1", supported_tasks: ["ENERGY"], supported_optimizers: [], supported_optimization_levels: []} : item)});
  });
  await preferGuidedMode(page);
  await page.goto(`/en/projects/${project}/workspace`);
  await openGuidedConfigure(page);
  await page.getByTestId("guided-family").selectOption({ label: "Geometry optimization" });
  // The withheld engine is shown with its reason, cannot be chosen, and is never substituted silently
  await expect(page.getByTestId("guided-engine-xtb-btn")).toBeDisabled();
  await expect(page.getByTestId("guided-engine-xtb-btn")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("guided-engine-pyscf-btn")).toBeEnabled();
  await page.getByTestId("guided-engine-pyscf-btn").click();
  await reviewAndAcknowledge(page);
  await expect(page.getByTestId("review-configuration")).toContainText("PySCF");
  await expect(page.getByTestId("review-configuration")).not.toContainText("xTB");
  await expect(page.getByTestId("run-calculation-btn")).toBeEnabled();
  await page.getByTestId("mode-toggle-advanced").click();
  // Advanced mode opens a structure through the project explorer
  await page.getByTestId("tree-item-structureVersion").first().click();
  await page.getByRole("button", { name: "Calculate", exact: true }).click();
  const panel = page.locator(".calculation-panel");
  await panel.getByRole("combobox", {name: "Engine", exact: true}).selectOption("xtb");
  await panel.getByRole("combobox", {name: "Task", exact: true}).selectOption("FREQUENCY");
  await expect(panel.getByRole("combobox", {name: "Engine", exact: true})).toHaveValue("xtb");
  await expect(panel.getByRole("button", {name: "Run vibrational analysis", exact: true})).toBeDisabled();
  await expect(panel).toContainText("does not support frequency");
  await panel.getByRole("combobox", {name: "Engine", exact: true}).selectOption("pyscf");
  await expect(panel.getByRole("button", {name: "Run vibrational analysis", exact: true})).toBeEnabled();
});

test("real separated H-H endpoint warns without rejecting physical dissociation", async ({ page, request }) => {
  const { project } = await seed(request, "2\nSeparated H-H\nH 0 0 0\nH 0 0 5\n");
  await configure(page, project, "guided", "xtb", 100);
  const submitted = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/calculations"));
  await page.getByTestId("run-calculation-btn").click();
  const detail = await completion(request, project, (await (await submitted).json()).calculation.id);
  expect(detail.result!.validation_state).toBe("VALIDATED");
  await openResultFromJob(page);
  const player = page.getByRole("region", { name: "Optimization trajectory" });
  await expect(player).toContainText("H–H separation is 5.000 Å");
  await expect(player).toContainText("geometry convergence alone does not establish a bound molecule");
  await expect(player).toContainText("Connectivity is not independently verified");
  await expect(player.getByLabel("Scientific View molecule viewport").locator("canvas")).toBeVisible();
  await page.screenshot({ path: resolve(output, "native-hh-geometry.png"), fullPage: true });
  await player.getByText("Geometry review warning:", { exact: false }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, "native-hh-dissociation-warning.png"), fullPage: true });
});
