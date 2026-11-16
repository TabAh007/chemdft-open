import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, repositoryPath, test, type APIRequestContext, type Page } from "./stand-in-test";
import { choosePlanMode } from "./ai-composer";

/**
 * AI-8 browser acceptance of the direct Kimi integration — OFFLINE STAND-IN, NOT HOSTED EVIDENCE.
 *
 * The real app, API and HTTP gateway run against the loopback stand-in, which here also answers as
 * Moonshot through the test-only base override. What is verified is the product around the model:
 * server-side eligibility, provider routing, per-user selection, the Moonshot request shape on the
 * wire, run-bound model identity when the preference changes mid-run, historical provenance,
 * mandatory human approval and failure behaviour without fallback. How Kimi really behaves is
 * shown only by the budgeted live acceptance, never by this file.
 */
const root = "/api/chemdft/v1";
const projectsPath = `${root}/projects`;
const shots = resolve(process.env.CHEMDFT_TEST_WORKSPACE ?? "/tmp", "output/ai-kimi-integration");
const STAND_IN = process.env.CHEMDFT_E2E_STAND_IN_URL ?? "";
const LIGHTNING = "nvidia/nemotron-3.5-lightning-30b-a3b";
const SUPER = "nvidia/nemotron-3-super-120b-a12b";
const KIMI = [
  { id: "kimi-k2.6", name: "Kimi K2.6", fields: ["max_tokens", "messages", "model", "thinking", "tools"] },
  { id: "kimi-k3", name: "Kimi K3", fields: ["max_completion_tokens", "messages", "model", "reasoning_effort", "tools"] },
] as const;

type Expect = { task: string; engine: string; method: string; basis: string; charge: number; multiplicity: number };
type Molecule = { file: string; format: string; sha256: string; structure_name: string; media_type: string; formula: string; charge: number; multiplicity: number };
type Case = { id: string; molecule: string; prompt: string; kind: string; expect: Expect };
type Project = { id: string; versionId: string; structureId: string; molecule: Molecule };
type Run = { id: string; status: string; ai_model: string | null; ai_provider?: string | null; error_code?: string | null; pending_approval?: { id: string; proposal_provenance?: { model: string; provider: string; eligibility?: string; sampling?: unknown } | null; request_match?: Array<{ parameter: string; outcome: string }> } | null };
type Wire = { model: string; temperature: number | null; top_p: number | null; chat_template_kwargs: unknown; max_tokens: number | null; body_keys: string[]; thinking: unknown; reasoning_effort: unknown; max_completion_tokens: number | null; tool_names: string[]; authorized: boolean; structure_version_id: string | null };

const fixture = JSON.parse(process.env.CHEMDFT_E2E_PLANNING_FIXTURE ?? '{"molecules":{},"cases":[]}') as { molecules: Record<string, Molecule>; cases: Case[] };
const caseById = (id: string) => fixture.cases.find((item) => item.id === id)!;
const projects: Record<string, Project> = {};
const findings: Record<string, unknown> = { category: "OFFLINE_KIMI_STAND_IN", hostedEvidence: false };

test.describe.configure({ mode: "serial" });
test.beforeAll(() => mkdirSync(shots, { recursive: true }));
test.afterAll(() => writeFileSync(resolve(shots, "findings.json"), JSON.stringify(findings, null, 2)));

async function script(request: APIRequestContext, steps: unknown[]) {
  expect((await request.post(`${STAND_IN}/__control/reset`)).status()).toBe(200);
  expect((await request.post(`${STAND_IN}/__control/script`, { data: { steps, repeat_last: false } })).status()).toBe(200);
}
const proposeStep = (e: Expect) => ({ kind: "propose", task: e.task, method: e.method, basis: e.basis, engine: e.engine, charge: e.charge, multiplicity: e.multiplicity });
async function wire(request: APIRequestContext) {
  return (await (await request.get(`${STAND_IN}/__control/requests`)).json()) as Wire[];
}
async function ensureProject(request: APIRequestContext, key: string) {
  if (projects[key]) return projects[key]!;
  const molecule = fixture.molecules[key]!;
  const bytes = readFileSync(repositoryPath("tools/nvidia_probe/molecules", molecule.file));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(molecule.sha256);
  const created = await request.post(projectsPath, { data: { name: `AI-8 Kimi ${molecule.formula}`, slug: `ai8k-${key}-${crypto.randomUUID().slice(0, 8)}` } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id as string;
  const imported = await request.post(`${projectsPath}/${id}/structures/imports`, { multipart: { file_format: molecule.format, idempotency_key: crypto.randomUUID(), structure_name: molecule.structure_name, upload: { name: molecule.file, mimeType: molecule.media_type, buffer: bytes } } });
  expect(imported.status()).toBe(201);
  const body = await imported.json();
  projects[key] = { id, versionId: body.version.id as string, structureId: (body.structure?.id ?? body.version.structure_id) as string, molecule };
  return projects[key]!;
}
async function openAiPanel(page: Page) {
  await expect(async () => {
    const advanced = page.getByTestId("mode-toggle-advanced");
    if ((await advanced.isVisible()) && (await advanced.getAttribute("aria-pressed")) !== "true") await advanced.click();
    const show = page.getByRole("button", { name: "Show AI Scientist panel", exact: true });
    if (await show.isVisible()) await show.click();
    const tab = page.getByTestId("ai-scientist-tab");
    if ((await tab.isVisible()) && (await tab.getAttribute("aria-selected")) !== "true") await tab.click();
    await expect(page.getByTestId("ai-scientist-panel")).toBeVisible({ timeout: 2_000 });
    await expect(page.getByTestId("ai-model-name")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
}
async function openWorkspace(page: Page, project: Project) {
  await page.goto(`/en/projects/${project.id}/workspace?selection=${encodeURIComponent(`structureVersion:${project.versionId}`)}&source=${project.structureId}`);
  await openAiPanel(page);
  await expect(page.getByTestId("ai-scientist-panel")).toHaveAttribute("data-context-structure-version-id", project.versionId, { timeout: 60_000 });
}
async function chooseModel(page: Page, id: string) {
  const name = page.getByTestId("ai-model-name");
  await expect(name).toHaveAttribute("title", /.+/, { timeout: 60_000 });
  if ((await name.getAttribute("title")) === id) return;
  await page.getByTestId("ai-model-switch-trigger").click();
  await expect(page.getByTestId("ai-model-switcher")).toBeVisible();
  const saving = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith("/ai/settings"));
  await page.getByTestId(`ai-model-option-${id}`).click();
  expect((await saving).status()).toBe(200);
  await expect(name).toHaveAttribute("title", id);
}
async function ask(page: Page, prompt: string): Promise<Run> {
  await choosePlanMode(page, { general: false });
  await page.getByTestId("ai-prompt-input").fill(prompt);
  const posted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/messages"), { timeout: 120_000 });
  await page.getByTestId("ai-prepare-calculation-button").click();
  const response = await posted;
  expect(response.status()).toBe(201);
  return (await response.json()).latest_run as Run;
}
const jobs = async (request: APIRequestContext, project: Project) => (await (await request.get(`${projectsPath}/${project.id}/compute/jobs`)).json()).jobs as unknown[];
const preferences = async (request: APIRequestContext) => (await (await request.get(`${root}/ai/settings`)).json()).preferences as { provider: string; model: string };

test("the server offers Kimi as a development-use second provider and refuses what it does not list", async ({ request }) => {
  const settings = await (await request.get(`${root}/ai/settings`)).json();
  expect(settings.providers.map((p: { provider: string }) => p.provider)).toEqual(["nvidia", "moonshot"]);
  expect([...settings.providers[1].models].sort()).toEqual(KIMI.map((m) => m.id).sort());
  const rows = Object.fromEntries((settings.model_capabilities as Array<Record<string, unknown>>).map((row) => [`${row.provider}/${row.model_identifier}`, row]));
  for (const model of KIMI) {
    const row = rows[`moonshot/${model.id}`]!;
    expect(row, model.id).toMatchObject({ eligibility: "DEVELOPMENT", configured: true, selectable: true, tool_compatibility_verified: false, proposal_workflow_verified: false });
    expect(row.status).not.toBe("LIVE-VERIFIED");
    expect(row.planning_profiles).toEqual(["PYSCF_ENERGY_PROPOSAL"]);
    expect((row.development_evidence as string[]).join(" ")).toMatch(/AI-9/);
  }
  const unlisted = await request.put(`${root}/ai/settings`, { data: { mode: "MANAGED", provider: "moonshot", model: "kimi-k2.5" } });
  expect(unlisted.status()).toBe(422);
  const crossed = await request.put(`${root}/ai/settings`, { data: { mode: "MANAGED", provider: "moonshot", model: SUPER } });
  expect(crossed.status()).toBe(422);
  expect((await preferences(request)).model).toBe(LIGHTNING);
});

test("the right-side switcher shows both providers' development models and the server saves a Kimi choice", async ({ page, request }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page, await ensureProject(request, "h2"));
  await page.getByTestId("ai-model-switch-trigger").click();
  await expect(page.getByTestId("ai-model-switcher")).toBeVisible();
  for (const model of KIMI) {
    const option = page.getByTestId(`ai-model-option-${model.id}`);
    await expect(option).toContainText(model.name);
    await expect(option).toContainText("Moonshot");
    await expect(option).toContainText("Development");
    await expect(option).not.toContainText("Not selectable");
    await option.focus();
    const detail = page.getByTestId("ai-model-detail");
    await expect(detail).toContainText("Eligible for development use only");
    await expect(detail).toContainText("Not verified");
    await expect(detail).not.toContainText(/live-verified/i);
  }
  await expect(page.getByTestId(`ai-model-option-${SUPER}`)).toContainText("NVIDIA");
  await page.screenshot({ path: resolve(shots, "01-switcher-1440.png") });
  await page.keyboard.press("Escape");
  for (const id of [KIMI[0].id, SUPER, KIMI[1].id]) {
    await chooseModel(page, id);
    const saved = await preferences(request);
    expect(saved.model).toBe(id);
    expect(saved.provider).toBe(id.startsWith("kimi") ? "moonshot" : "nvidia");
  }
  await page.reload();
  await openAiPanel(page);
  await expect(page.getByTestId("ai-model-name")).toHaveAttribute("title", KIMI[1].id, { timeout: 60_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await openAiPanel(page); // on a phone the dock is a sheet that has to be opened
  await expect(page.getByTestId("ai-model-name")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

for (const model of KIMI) {
  test(`${model.name}: a proposal reaches approval bound to the model, sends only Moonshot's reviewed fields, and is never approved`, async ({ page, request }) => {
    test.setTimeout(300_000);
    const c = caseById(model.id === "kimi-k2.6" ? "h2-hf-sto3g" : "h2o-hf-631g");
    const project = await ensureProject(request, c.molecule);
    await script(request, [proposeStep(c.expect)]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page, project);
    await chooseModel(page, model.id);
    const run = await ask(page, c.prompt);
    expect(run.status).toBe("WAITING_FOR_APPROVAL");
    expect(run.ai_model).toBe(model.id);
    expect(run.ai_provider).toBe("moonshot");
    expect(run.pending_approval!.proposal_provenance).toMatchObject({ model: model.id, provider: "moonshot", eligibility: "DEVELOPMENT" });
    expect(run.pending_approval!.proposal_provenance!.sampling ?? null).toBeNull(); // Moonshot fixes sampling: nothing is claimed
    const outcomes = Object.fromEntries((run.pending_approval!.request_match ?? []).map((item) => [item.parameter, item.outcome]));
    for (const parameter of ["task", "engine", "method", "basis", "charge", "multiplicity"]) expect(outcomes[parameter], parameter).toBe("MATCH");
    const card = page.getByTestId("ai-approval-card");
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card.getByTestId("ai-approval-model")).toContainText(model.id);
    await expect(card.getByTestId("ai-approval-model")).toContainText("Moonshot");
    await expect(card.getByTestId("ai-approval-eligibility")).toHaveText("Development use only");
    await expect(card.getByTestId("ai-request-check-summary")).toHaveText(/^6 named parameters match your request$/);
    await expect(card.getByTestId("ai-approval-geometry")).toContainText(project.versionId, { timeout: 60_000 });
    await expect(card.getByTestId("ai-approval-sampling")).toHaveCount(0);
    // The wire: Moonshot's own request shape, no sampling, no NVIDIA-only fields, the bound structure version.
    const sent = (await wire(request)).filter((entry) => entry.model === model.id);
    expect(sent).toHaveLength(1);
    const entry = sent[0]!;
    expect(entry.authorized).toBe(true);
    expect([...entry.body_keys].sort()).toEqual([...model.fields].sort());
    expect(entry.temperature).toBeNull();
    expect(entry.top_p).toBeNull();
    expect(entry.chat_template_kwargs).toBeNull();
    expect(entry.structure_version_id).toBe(project.versionId);
    if (model.id === "kimi-k2.6") expect(entry.thinking).toEqual({ type: "disabled" });
    else expect(entry.reasoning_effort).toBe("low");
    await page.screenshot({ path: resolve(shots, `02-approval-${model.id}.png`) });
    expect(await jobs(request, project)).toHaveLength(0);
    await card.getByTestId("ai-reject-button").click();
    await expect(page.getByTestId("ai-approval-card")).toHaveCount(0, { timeout: 60_000 });
    expect(await jobs(request, project)).toHaveLength(0);
    findings[model.id] = { runStatus: run.status, wireFields: entry.body_keys };
  });
}

test("changing the preference mid-run does not change the model bound to the pending run, and history keeps its provenance", async ({ page, request }) => {
  test.setTimeout(300_000);
  const c = caseById("ethanol-hf-sto3g");
  const project = await ensureProject(request, c.molecule);
  await script(request, [proposeStep(c.expect)]);
  await openWorkspace(page, project);
  await chooseModel(page, KIMI[0].id);
  const pending = await ask(page, c.prompt);
  expect(pending.status).toBe("WAITING_FOR_APPROVAL");
  // The researcher switches provider while the approval is open.
  expect((await request.put(`${root}/ai/settings`, { data: { mode: "MANAGED", provider: "nvidia", model: SUPER } })).status()).toBe(200);
  const view = (await (await request.get(`${projectsPath}/${project.id}/ai/runs/${pending.id}`)).json()) as Run;
  expect(view).toMatchObject({ ai_model: KIMI[0].id, ai_provider: "moonshot", status: "WAITING_FOR_APPROVAL" });
  expect(view.pending_approval!.proposal_provenance).toMatchObject({ model: KIMI[0].id, provider: "moonshot" });
  expect((await preferences(request)).model).toBe(SUPER);
  await page.reload();
  await openAiPanel(page);
  await expect(page.getByTestId("ai-model-name")).toHaveAttribute("title", SUPER, { timeout: 60_000 });
  const card = page.getByTestId("ai-approval-card");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByTestId("ai-approval-model")).toContainText(KIMI[0].id);
  await expect(card.getByTestId("ai-approval-model")).toContainText("Moonshot");
  await card.getByTestId("ai-reject-button").click();
  await expect(page.getByTestId("ai-approval-card")).toHaveCount(0, { timeout: 60_000 });
  const settled = (await (await request.get(`${projectsPath}/${project.id}/ai/runs/${pending.id}`)).json()) as Run;
  expect(settled).toMatchObject({ ai_model: KIMI[0].id, ai_provider: "moonshot" }); // history keeps what proposed it
  expect(await jobs(request, project)).toHaveLength(0);
});

test("a Moonshot refusal ends the run with a visible provider error, one request and no fallback to another model", async ({ page, request }) => {
  test.setTimeout(300_000);
  const c = caseById("h2-hf-sto3g");
  const project = await ensureProject(request, c.molecule);
  await script(request, [{ kind: "http_error", status: 429 }]);
  await openWorkspace(page, project);
  await chooseModel(page, KIMI[1].id);
  const run = await ask(page, c.prompt);
  expect(run.status).toBe("FAILED");
  expect(run.ai_model).toBe(KIMI[1].id);
  expect(run.error_code).toBeTruthy();
  const log = await wire(request);
  expect(log).toHaveLength(1); // no retry
  expect(log.every((entry) => entry.model === KIMI[1].id)).toBe(true); // no substitution
  expect(await jobs(request, project)).toHaveLength(0);
  await page.screenshot({ path: resolve(shots, "03-provider-error.png") });
});
