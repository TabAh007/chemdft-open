import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CalculationDetail } from "@chemdft/schemas";
import { openGuidedConfigure, openResultFromJob, preferGuidedMode, reviewAndAcknowledge } from "./guided-helpers";

/** Creates a disposable project with a water structure and opens the Guided Configure stage. */
async function setup(page: Page, request: APIRequestContext, inputs: { charge?: number; multiplicity?: number } = {}) {
  const project = await request.post("/api/chemdft/v1/projects", { data: { name: "PF8B1.3 lifecycle disposable", slug: `lifecycle-${crypto.randomUUID()}` } });
  expect(project.status()).toBe(201); const id: string = (await project.json()).id;
  const structure = await request.post(`/api/chemdft/v1/projects/${id}/structures/imports`, { multipart: { upload: { name: "water.xyz", mimeType: "chemical/x-xyz", buffer: readFileSync(resolve("../../services/api/tests/fixtures/structures/test-user-supplied-water.xyz")) }, file_format: "XYZ", idempotency_key: crypto.randomUUID() } });
  expect(structure.status()).toBe(201);
  await preferGuidedMode(page);
  await page.goto(`/en/projects/${id}/workspace`);
  await openGuidedConfigure(page, inputs);
  await expect(page.getByTestId("guided-engine-xtb-btn")).toBeEnabled();
  return id;
}
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });
for (const method of ["b3lyp", "pbe"]) test(`Guided ${method.toUpperCase()} executes with the submitted convergence and supported basis`, async ({ page, request }) => {
  const id = await setup(page, request);
  await page.getByTestId("guided-engine-pyscf-btn").click();
  await page.getByText("Advanced settings", { exact: true }).click();
  await page.locator("#calc-method").selectOption(method);
  const supported = await (await request.get(`/api/chemdft/v1/projects/${id}/calculations/capabilities`)).json();
  expect(await page.locator("#calc-method option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).toEqual(supported.find((entry: { engine: string }) => entry.engine === "pyscf").supported_methods);
  await page.locator("#calc-conv").fill("2e-8");
  await reviewAndAcknowledge(page);
  const submitted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/calculations"));
  await page.getByTestId("run-calculation-btn").click();
  const response = await submitted; expect(response.status()).toBe(201);
  expect(response.request().postDataJSON().specification.method.identifier).toBe(method);
  expect(response.request().postDataJSON().specification.scf.convergence_threshold).toBe(2e-8);
  const initial: CalculationDetail = await response.json();
  // A finished job is not opened automatically; the job panel offers "Open result"
  await openResultFromJob(page);
  await expect(page.getByTestId("energy-precision-plate")).toBeVisible({ timeout: 30_000 });
  const detail: CalculationDetail = await (await request.get(`/api/chemdft/v1/projects/${id}/calculations/${initial.calculation.id}`)).json();
  expect(detail.calculation.state).toBe("SUCCEEDED");
  await expect(page.getByTestId("energy-precision-plate")).toHaveAttribute("data-result-id", detail.result!.id);
});

test("pending submission is visible and blocks duplicate clicks", async ({ page, request }) => {
  await setup(page, request);
  await reviewAndAcknowledge(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let count = 0;
  await page.route("**/calculations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    count++; const response = await route.fetch(); await gate; await route.fulfill({ response });
  });
  const run = page.getByTestId("run-calculation-btn"); await run.click();
  // While the request is pending the control says so, is disabled, and a second activation sends nothing
  await expect(run).toContainText("Submitting");
  await expect(run).toBeDisabled(); await run.evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(count).toBe(1); release();
  await openResultFromJob(page);
  await expect(page.getByTestId("energy-precision-plate")).toBeVisible({ timeout: 30_000 });
  expect(count).toBe(1);
});

/**
 * A consistent calculation + compute-job pair for the state under test. The real POST creates the (queued) records;
 * only the GET/cancel responses are simulated, because a worker is what would otherwise move them. The job panel
 * derives its state from the compute job, so the simulated job and execution must agree with the calculation.
 */
function simulated(record: CalculationDetail, state: "RUNNING" | "FAILED" | "CANCELED"): CalculationDetail {
  const now = new Date().toISOString();
  const job = record.compute_job!;
  const execution = {
    id: crypto.randomUUID(), project_id: job.project_id, job_id: job.id, calculation_id: job.calculation_id, provider: job.provider,
    state, started_at: now, heartbeat_at: state === "RUNNING" ? now : null, finished_at: state === "RUNNING" ? null : now,
    failure_code: state === "FAILED" ? "ENGINE_CRASHED" : null,
    diagnostic: state === "FAILED" ? "Execution failed: worker reported no publishable result" : null,
  } as unknown as NonNullable<typeof job.latest_execution>;
  return {
    ...record, result: null, attempt: null,
    calculation: { ...record.calculation, state, updated_at: now },
    compute_job: { ...job, state, updated_at: now, latest_execution: execution },
  };
}

for (const terminal of ["FAILED", "CANCELED"] as const) test(`simulated API lifecycle displays RUNNING then ${terminal}`, async ({ page, request }) => {
  await setup(page, request);
  await reviewAndAcknowledge(page);
  let record: CalculationDetail | undefined;
  let phase: "RUNNING" | typeof terminal = "RUNNING";
  await page.route("**/calculations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch(); record = await response.json();
    await route.fulfill({ response, json: simulated(record!, "RUNNING") });
  });
  await page.route("**/calculations/*", async (route) => {
    if (route.request().method() !== "GET" || !record || !route.request().url().endsWith(record.calculation.id)) return route.continue();
    await route.fulfill({ json: simulated(record, phase) });
  });
  await page.route("**/calculations/*/cancel", async (route) => {
    phase = "CANCELED";
    await route.fulfill({ json: simulated(record!, "CANCELED") });
  });
  await page.getByTestId("run-calculation-btn").click();
  // Once accepted, the job panel replaces the submit control: a running job cannot be submitted again
  await expect(page.getByTestId("guided-job-state")).toContainText(/running/i);
  await expect(page.getByTestId("run-calculation-btn")).toHaveCount(0);
  await expect(page.getByTestId("energy-precision-plate")).toHaveCount(0);
  if (terminal === "CANCELED") {
    await page.getByTestId("guided-cancel-job").click();
    await page.getByTestId("guided-job-cancel-yes").click();
  } else {
    phase = "FAILED";
  }
  await expect(page.getByTestId("guided-job-state")).toContainText(terminal === "FAILED" ? /failed/i : /canceled/i, { timeout: 30_000 });
  if (terminal === "FAILED") await expect(page.getByTestId("guided-job-failure")).toContainText("Execution failed: worker reported no publishable result");
  await expect(page.getByTestId("energy-precision-plate")).toHaveCount(0);
  // A finished job without a result offers to edit the configuration; nothing is substituted
  await expect(page.getByTestId("guided-primary-edit-configuration")).toBeVisible();
  await expect(page.getByTestId("guided-primary-open-result")).toHaveCount(0);
});

test("real API validation error is visible and no result is substituted", async ({ page, request }) => {
  // Charge +1 with multiplicity 1 is parity-impossible for water; the server must refuse it
  await setup(page, request, { charge: 1 });
  await reviewAndAcknowledge(page);
  const submitted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/calculations"));
  await page.getByTestId("run-calculation-btn").click();
  const response = await submitted; expect([400, 422]).toContain(response.status());
  await expect(page.getByTestId("submit-error")).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("submit-error")).toContainText(/parity|multiplicity|electron/i);
  await expect(page.getByTestId("guided-job-panel")).toHaveCount(0);
  await expect(page.getByTestId("energy-precision-plate")).toHaveCount(0);
});

test("real queued API cancellation is shown without publishing an energy", async ({ page, request }) => {
  const id = await setup(page, request);
  await reviewAndAcknowledge(page);
  let initial: CalculationDetail;
  // Cancel immediately through the real API before releasing the submission response to the browser.
  // UI button behavior is covered separately; this avoids racing a one-second completed calculation.
  await page.route("**/calculations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch(); initial = await response.json();
    const canceled = await request.post(`/api/chemdft/v1/projects/${id}/calculations/${initial.calculation.id}/cancel`);
    expect(canceled.status()).toBe(200);
    await route.fulfill({ response, json: await canceled.json() });
  });
  await page.getByTestId("run-calculation-btn").click();
  await expect(page.getByTestId("guided-job-state")).toContainText(/canceled/i, { timeout: 90_000 });
  const terminal: CalculationDetail = await (await request.get(`/api/chemdft/v1/projects/${id}/calculations/${initial!.calculation.id}`)).json();
  expect(terminal.calculation.state).toBe("CANCELED");
  expect(terminal.result).toBeNull();
  await expect(page.getByTestId("energy-precision-plate")).toHaveCount(0);
});
