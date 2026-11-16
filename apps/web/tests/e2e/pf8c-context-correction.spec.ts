import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { CalculationDetail, ConformerEnsembleResult, ProductContext, StructureVersion } from "@chemdft/schemas";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildConformerSubmission } from "../../src/lib/conformer-ensemble";
import { buildGuidedSubmission } from "../../src/lib/guided-calculation";

const output = resolve("../../output/playwright/pf8c-gate-c1");
mkdirSync(output, { recursive: true });
let project: string, water: StructureVersion, ethanol: StructureVersion;
let waterResult: CalculationDetail, ethanolResult: CalculationDetail, optimization: CalculationDetail;
async function completed(request: APIRequestContext, initial: CalculationDetail) {
  let detail = initial;
  await expect.poll(async () => {
    detail = await (await request.get(`/api/chemdft/v1/projects/${project}/calculations/${initial.calculation.id}`)).json();
    return ["SUCCEEDED", "FAILED", "CANCELED"].includes(detail.calculation.state);
  }, { timeout: 240_000, intervals: [1000] }).toBe(true);
  expect(detail.calculation.state, JSON.stringify(detail.attempt)).toBe("SUCCEEDED");
  expect(detail.result!.validation_state).toBe("VALIDATED");
  return detail;
}
test.beforeAll(async ({ request }) => {
  const created = await request.post("/api/chemdft/v1/projects", { data: { name: "Gate C.1 native context regression", slug: `pf8c-c1-${crypto.randomUUID()}` } });
  expect(created.status()).toBe(201); project = (await created.json()).id;
  for (const name of ["water", "ethanol"]) {
    const xyz = readFileSync(resolve(`../../services/api/tests/fixtures/crest/${name}.xyz`)).toString().replace("\n\n", `\nContext ${name}\n`);
    const imported = await request.post(`/api/chemdft/v1/projects/${project}/structures/imports`, { multipart: {
      upload: { name: `${name}.xyz`, mimeType: "chemical/x-xyz", buffer: Buffer.from(xyz) }, file_format: "XYZ", structure_name: `Context ${name}`, idempotency_key: crypto.randomUUID(),
    } });
    expect(imported.status()).toBe(201); const input: StructureVersion = (await imported.json()).version;
    if (name === "water") water = input; else ethanol = input;
    const submitted = await request.post(`/api/chemdft/v1/projects/${project}/calculations`, { data: buildConformerSubmission(project, input.id, crypto.randomUUID()) });
    expect(submitted.status()).toBe(201);
    const detail = await completed(request, await submitted.json());
    if (name === "water") waterResult = detail; else ethanolResult = detail;
  }
  const submitted = await request.post(`/api/chemdft/v1/projects/${project}/calculations`, { data: buildGuidedSubmission(project, water.id, {
    engine: "xtb", method: "gfn2", basis: null, charge: 0, multiplicity: 1, convergence: 1e-8,
    taskType: "GEOMETRY_OPTIMIZATION", optimizationOptions: { optimizer: "xtb-ancopt", xtb_level: "normal", max_steps: 100 },
  }) });
  expect(submitted.status()).toBe(201); optimization = await completed(request, await submitted.json());
  writeFileSync(resolve(output, "native-records.json"), JSON.stringify({ project, water, ethanol, waterResult, ethanolResult, optimization }, null, 2));
});
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });
test.beforeEach(async ({ page }) => {
  // Keep the user's explicit dock preference open even when the real AI provider is unavailable.
  await page.addInitScript((id) => localStorage.setItem(`chemdft:panels:${id}:guided-ai-dock`, "true"), project);
});
async function dock(page: Page) {
  if (await page.getByTestId("ai-dock-toggle").isVisible() && !await page.getByTestId("ai-current-view").isVisible()) await page.getByTestId("ai-dock-toggle").click();
  if (await page.getByTestId("ai-scientist-tab").isVisible()) await page.getByTestId("ai-scientist-tab").click();
}
async function open(page: Page, detail = ethanolResult) {
  await page.goto(`/en/projects/${project}/workspace?selection=calculationResult:${detail.result!.id}&source=${detail.calculation.id}`);
  await expect(page.getByTestId("guided-result-picker")).toBeVisible(); await dock(page);
}
async function assertContext(page: Page, detail: CalculationDetail, version: StructureVersion) {
  const panel = page.getByTestId("ai-scientist-panel");
  await expect(panel).toHaveAttribute("data-context-result-id", detail.result!.id);
  await expect(panel).toHaveAttribute("data-context-calculation-id", detail.calculation.id);
  await expect(panel).toHaveAttribute("data-context-structure-version-id", version.id);
}

test("active water / opened ethanol: real AI context, member navigation, modes, refresh, history and close", async ({ page }) => {
  const contexts: ProductContext[] = [];
  page.on("response", async (response) => {
    if (response.url().endsWith("/ai/context") && response.ok()) contexts.push(await response.json());
  });
  await page.goto(`/en/projects/${project}/workspace?selection=structureVersion:${water.id}&source=${water.structure_id}`);
  await expect(page.getByTestId("guided-structure-view")).toContainText("Context water");
  await page.getByTestId("guided-nav-conformers").click();
  await page.getByTestId("guided-result-picker").selectOption(ethanolResult.result!.id); await dock(page);
  await assertContext(page, ethanolResult, ethanol);
  const ensemble = page.locator('[data-testid="conformer-ensemble"]:visible');
  const payload = ethanolResult.result!.payload as ConformerEnsembleResult;
  expect(payload.manifest.members.length).toBeGreaterThan(1);
  for (const member of payload.manifest.members) {
    await ensemble.getByRole("button", { name: `Select member ${member.application_rank}`, exact: true }).click();
    await assertContext(page, ethanolResult, ethanol);
    await expect(page.getByTestId("ai-current-view")).toContainText("Context ethanol V1");
    await expect(page.getByTestId("ai-current-view")).toContainText(member.conformer.id.slice(0, 8));
    await expect(page.getByTestId("ai-current-view")).toContainText(payload.manifest.execution_id.slice(0, 8));
    await expect(page.getByTestId("ai-current-view")).not.toContainText("Context water");
  }
  await expect(page.getByTestId("ai-conformer-context-limit")).toBeVisible();
  await expect(page.getByTestId("ai-prompt-input")).toBeDisabled();
  await page.screenshot({ path: resolve(output, "guided-ethanol-context.png"), fullPage: true });
  await page.getByTestId("mode-toggle-advanced").click(); await dock(page); await assertContext(page, ethanolResult, ethanol);
  await expect(page.getByTestId("ai-current-view")).toContainText(payload.manifest.members.at(-1)!.conformer.id);
  await page.screenshot({ path: resolve(output, "advanced-ethanol-context.png"), fullPage: true });
  await page.getByTestId("mode-toggle-guided").click(); await assertContext(page, ethanolResult, ethanol);
  await page.reload(); await dock(page); await assertContext(page, ethanolResult, ethanol);
  await expect(page.getByTestId("ai-current-view")).toContainText(payload.manifest.members.at(-1)!.conformer.id);
  await page.getByTestId("guided-result-picker").selectOption(waterResult.result!.id); await assertContext(page, waterResult, water);
  await page.getByTestId("guided-result-picker").selectOption(ethanolResult.result!.id); await assertContext(page, ethanolResult, ethanol);
  await page.goBack(); await assertContext(page, waterResult, water);
  await page.goForward(); await assertContext(page, ethanolResult, ethanol);
  await page.getByTestId("mode-toggle-advanced").click(); await dock(page);
  const activeTab = page.locator(".workspace-tab-wrap").filter({ has: page.locator('[data-testid="workspace-open-tab"][aria-selected="true"]') });
  await activeTab.locator(".workspace-tab-close").click(); await assertContext(page, waterResult, water);
  await page.getByTestId("mode-toggle-guided").click(); await assertContext(page, waterResult, water);
  await page.getByTestId("guided-nav-overview").click();
  await expect(page.getByTestId("ai-scientist-panel")).toHaveAttribute("data-context-result-id", "");
  await expect(page.getByTestId("ai-current-view")).toContainText("Overview");
  await expect(page.getByTestId("ai-current-view")).not.toContainText("CREST ensemble");
  writeFileSync(resolve(output, "server-contexts.json"), JSON.stringify(contexts, null, 2));
});

test("out-of-order native-result and AI-context responses cannot replace the selected run/member", async ({ page }) => {
  await open(page); await assertContext(page, ethanolResult, ethanol);
  let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
  let contextRequested!: () => void; const requested = new Promise<void>((resolve) => { contextRequested = resolve; });
  let resultRequested = false, delivered = 0;
  await page.route(`**/calculations/${waterResult.calculation.id}`, async (route) => { const response = await route.fetch(); resultRequested = true; await pending; await route.fulfill({ response }); delivered++; });
  await page.route("**/ai/context", async (route) => {
    const request = route.request().postDataJSON(); const response = await route.fetch();
    if (request.selected_result_id === waterResult.result!.id) { contextRequested(); await pending; }
    await route.fulfill({ response });
    if (request.selected_result_id === waterResult.result!.id) delivered++;
  });
  await page.getByTestId("guided-result-picker").selectOption(waterResult.result!.id);
  await requested;
  await expect.poll(() => resultRequested).toBe(true);
  await expect(page.getByTestId("ai-scientist-panel")).toHaveAttribute("data-context-result-id", "");
  await page.getByTestId("guided-result-picker").selectOption(ethanolResult.result!.id);
  await assertContext(page, ethanolResult, ethanol);
  release(); await expect.poll(() => delivered).toBeGreaterThanOrEqual(2); await page.unrouteAll({ behavior: "wait" }); await assertContext(page, ethanolResult, ethanol);
  await expect(page.getByTestId("ai-current-view")).toContainText("Context ethanol");
  await page.evaluate(({ project, waterResult }) => window.dispatchEvent(new CustomEvent("chemdft:workspace-selection", { detail: {
    projectId: project, calculationId: waterResult.calculation.id, resultId: waterResult.result!.id, currentView: "Optimization trajectory · unrelated water",
  } })), { project, waterResult });
  await assertContext(page, ethanolResult, ethanol);
  await expect(page.getByTestId("ai-current-view")).toContainText("Context ethanol");
  await expect(page.getByTestId("ai-current-view")).not.toContainText("unrelated water");
  const payload = ethanolResult.result!.payload as ConformerEnsembleResult;
  let releaseMember!: () => void; const memberPending = new Promise<void>((resolve) => { releaseMember = resolve; });
  let memberRequested!: () => void; const memberRequest = new Promise<void>((resolve) => { memberRequested = resolve; });
  let memberDelivered = false;
  await page.getByRole("button", { name: "Select member 1", exact: true }).click();
  await expect(page.getByTestId("ai-scientist-panel")).toHaveAttribute("data-context-view", new RegExp(payload.manifest.members[0]!.conformer.id));
  await page.route("**/ai/context", async (route) => {
    const response = await route.fetch();
    const delayedMember = route.request().postDataJSON().current_view.includes(payload.manifest.members[1]!.conformer.id);
    if (delayedMember) { memberRequested(); await memberPending; }
    await route.fulfill({ response });
    if (delayedMember) memberDelivered = true;
  });
  await page.getByRole("button", { name: "Select member 2", exact: true }).click(); await memberRequest;
  await page.getByRole("button", { name: "Select member 1", exact: true }).click();
  await expect(page.getByTestId("ai-scientist-panel")).toHaveAttribute("data-context-view", new RegExp(payload.manifest.members[0]!.conformer.id));
  releaseMember(); await expect.poll(() => memberDelivered).toBe(true); await page.unrouteAll({ behavior: "wait" });
  await expect(page.getByTestId("ai-scientist-panel")).toHaveAttribute("data-context-view", new RegExp(payload.manifest.members[0]!.conformer.id));
});

test("mismatched server context fails safely; existing native xTB optimization context remains associated", async ({ page }) => {
  await open(page, optimization); await assertContext(page, optimization, water);
  await expect(page.getByTestId("ai-current-view")).toContainText("Optimization trajectory");
  await expect(page.getByTestId("ai-conformer-context-limit")).toHaveCount(0);
  await page.getByTestId("mode-toggle-advanced").click(); await dock(page); await assertContext(page, optimization, water);
  await page.getByTestId("mode-toggle-guided").click();
  const waterContext = await (await page.request.post(`/api/chemdft/v1/projects/${project}/ai/context`, { data: { selected_result_id: waterResult.result!.id } })).json();
  await page.route("**/ai/context", async (route) => {
    const request = route.request().postDataJSON();
    if (request.selected_result_id === ethanolResult.result!.id) await route.fulfill({ json: { ...waterContext, selection: { ...waterContext.selection, current_view: request.current_view } } });
    else await route.continue();
  });
  await page.getByTestId("guided-result-picker").selectOption(ethanolResult.result!.id);
  await expect(page.getByRole("alert").filter({ hasText: "AI context does not match" })).toBeVisible();
  await expect(page.getByTestId("ai-scientist-panel")).toHaveAttribute("data-context-result-id", "");
  await expect(page.getByTestId("ai-prompt-input")).toBeDisabled();
  await expect(page.getByTestId("ai-current-view")).toContainText("Context ethanol");
  await page.screenshot({ path: resolve(output, "mismatched-context-fail-safe.png"), fullPage: true });
});

test("queued and terminal status wording, including completed cancellation notice", async ({ page, request }) => {
  const response = await request.post(`/api/chemdft/v1/projects/${project}/calculations`, { data: buildConformerSubmission(project, water.id, crypto.randomUUID()) });
  expect(response.status()).toBe(201); const initial: CalculationDetail = await response.json();
  await request.post(`/api/chemdft/v1/projects/${project}/calculations/${initial.calculation.id}/cancel`);
  const original: CalculationDetail = await (await request.get(`/api/chemdft/v1/projects/${project}/calculations/${initial.calculation.id}`)).json();
  let state = "QUEUED", diagnostic = "Gate C.1 labeled UI status fault injection";
  await page.route(`**/calculations/${initial.calculation.id}`, (route) => route.fulfill({ json: { ...original, result: null, calculation: { ...original.calculation, state }, attempt: { ...original.attempt, diagnostic, raw_artifacts: [] }, compute_execution: null } }));
  await page.goto(`/en/projects/${project}/workspace?selection=calculation:${initial.calculation.id}`);
  const region = page.getByRole("region", { name: "Conformer search status" });
  await expect(region).toContainText("CREST sampling has not started"); await expect(region).not.toContainText("sampling is in progress");
  await region.getByRole("button", { name: "Cancel conformer search", exact: true }).click();
  await expect(region).toContainText("Cancellation requested");
  state = "CANCELED"; await expect(region).toContainText("Search: Canceled");
  await expect(region).not.toContainText("Cancellation requested"); await expect(region).not.toContainText("#494");
  await page.screenshot({ path: resolve(output, "cancellation-completed.png"), fullPage: true });
  for (const [text, expected] of [["Native wall timeout", "Timed out"], ["Incomplete native evidence", "Incomplete native evidence"], ["Outer lower-conformer restart rejected (upstream #494)", "Failed"]]) {
    state = "FAILED"; diagnostic = `Gate C.1 labeled UI status fault injection: ${text}`;
    await page.reload(); await expect(region).toContainText(`Search: ${expected}`);
    if (expected === "Failed") await expect(region).toContainText("#494"); else await expect(region).not.toContainText("#494");
    await expect(page.getByRole("button", { name: "Open completed ensemble", exact: true })).toHaveCount(0);
  }
});
