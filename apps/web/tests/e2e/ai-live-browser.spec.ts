import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { choosePlanMode } from "./ai-composer";

/**
 * AI-8 live browser acceptance of the real NVIDIA models — PROPOSALS ONLY, NO SCIENTIFIC EXECUTION.
 *
 * Real Next.js + FastAPI + disposable SQLite, no compute worker. The API process is the budget
 * launcher (tools/nvidia_probe/browser_live.py): every model request the real AI Scientist service
 * makes passes through the authorized ledger. For each authorized model and case the researcher
 * opens the project, selects the model in the right-side switcher, asks, and the page is inspected;
 * a proposal that reaches approval is REJECTED (never approved), and nothing may create a compute
 * job. A model that fails to produce a valid proposal is a finding recorded in the report, not a
 * test failure; the invariants below hold either way. All values come from the real endpoint.
 */
const root = "/api/chemdft/v1";
const projectsPath = `${root}/projects`;
const workspace = process.env.CHEMDFT_TEST_WORKSPACE ?? "/tmp";
const shots = resolve(workspace, "output/ai-live-browser");
const MODEL_NAMES: Record<string, string> = { "nvidia/nemotron-3-super-120b-a12b": "Nemotron 3 Super", "stepfun-ai/step-5-preview": "Step 5 Preview", "kimi-k2.6": "Kimi K2.6", "kimi-k3": "Kimi K3" };
const providerOf = (model: string) => (model.startsWith("kimi") ? "moonshot" : "nvidia");
const METHOD_LABEL: Record<string, string> = { hf: "Hartree–Fock (HF)", b3lyp: "B3LYP", pbe: "PBE" };
const BASIS_LABEL: Record<string, string> = { "sto-3g": "STO-3G", "6-31g": "6-31G", "def2-svp": "def2-SVP" };
const REQUEST_PARAMETERS = ["task", "engine", "method", "basis", "charge", "multiplicity"] as const;

type Expect = { task: string; engine: string; method: string; basis: string; charge: number; multiplicity: number };
type Molecule = { file: string; format: string; sha256: string; structure_name: string; media_type: string; formula: string; atoms: number; charge: number; multiplicity: number };
type Case = { id: string; molecule: string; prompt: string; kind: string; expect: Expect };
type Project = { id: string; versionId: string; structureId: string; molecule: Molecule };
type Approval = {
  normalized_arguments: { structure_version: { entity_id: string }; specification: { task_type: string; charge: number; multiplicity: number; method: { identifier: string }; basis: { identifier: string }; engine_preference: { engine: string } } };
  proposal_provenance?: { model: string; provider: string; eligibility?: string; repair_attempts?: number; sampling?: { source: string; temperature: number; top_p?: number | null } | null } | null;
  request_match?: Array<{ parameter: string; outcome: string }>;
};
type Run = { id: string; status: string; ai_model: string | null; ai_provider?: string | null; error_code?: string | null; pending_approval?: Approval | null; blocker?: { attempts: number; code: string; summary: string } | null };

const fixture = JSON.parse(process.env.CHEMDFT_E2E_PLANNING_FIXTURE ?? '{"molecules":{},"cases":[]}') as { molecules: Record<string, Molecule>; cases: Case[] };
const liveCases: string[] = JSON.parse(process.env.CHEMDFT_E2E_LIVE_CASES ?? "[]");
const liveModels: string[] = JSON.parse(process.env.CHEMDFT_E2E_LIVE_MODELS ?? "[]");
const cases = liveCases.map((id) => {
  const found = fixture.cases.find((item) => item.id === id);
  if (!found) throw new Error(`unknown case ${id}`);
  return found;
});
// Rehearsal only (the same launcher and spec against the loopback stand-in): script a competent reply
// per request. In a real run CHEMDFT_E2E_STAND_IN_URL is unset and nothing here runs.
const STAND_IN = process.env.CHEMDFT_E2E_STAND_IN_URL ?? "";
async function scriptStandIn(request: APIRequestContext, e: Expect) {
  if (!STAND_IN) return;
  expect((await request.post(`${STAND_IN}/__control/reset`)).status()).toBe(200);
  const step = { kind: "propose", task: e.task, method: e.method, basis: e.basis, engine: e.engine, charge: e.charge, multiplicity: e.multiplicity };
  expect((await request.post(`${STAND_IN}/__control/script`, { data: { steps: [step], repeat_last: true } })).status()).toBe(200);
}
const projects: Record<string, Project> = {};
type Finding = { model: string; case: string; molecule: string; outcome: string; run_status: string; repairs: number | null; request_match: Record<string, string> | null; blocker: string | null; sampling: unknown; duration_ms: number; };
const findings: Finding[] = [];

test.describe.configure({ mode: "serial" });
test.beforeAll(() => mkdirSync(shots, { recursive: true }));
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: resolve(shots, `failed-${info.workerIndex}-${Date.now()}.png`) }).catch(() => undefined);
});
test.afterAll(() => {
  const budget = resolve(workspace, "live-report.json");
  writeFileSync(resolve(shots, "findings.json"), JSON.stringify({ category: "LIVE_NVIDIA_BROWSER_PROPOSALS_ONLY", hostedEvidence: true, flows: findings, budget: existsSync(budget) ? JSON.parse(readFileSync(budget, "utf8")) : null }, null, 2));
});

async function ensureProjects(request: APIRequestContext) {
  for (const key of new Set(cases.map((item) => item.molecule))) {
    if (projects[key]) continue;
    const molecule = fixture.molecules[key]!;
    const bytes = readFileSync(resolve(process.env.CHEMDFT_E2E_REPOSITORY_ROOT ?? "../..", "tools/nvidia_probe/molecules", molecule.file));
    expect(createHash("sha256").update(bytes).digest("hex"), `${key} source bytes`).toBe(molecule.sha256);
    const created = await request.post(projectsPath, { data: { name: `AI-8 live ${molecule.formula}`, slug: `ai8-${key}-${crypto.randomUUID().slice(0, 8)}` } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).id as string;
    const imported = await request.post(`${projectsPath}/${id}/structures/imports`, { multipart: { file_format: molecule.format, idempotency_key: crypto.randomUUID(), structure_name: molecule.structure_name, upload: { name: molecule.file, mimeType: molecule.media_type, buffer: bytes } } });
    expect(imported.status(), `${key} import`).toBe(201);
    const body = await imported.json();
    projects[key] = { id, versionId: body.version.id as string, structureId: (body.structure?.id ?? body.version.structure_id) as string, molecule };
  }
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
    // The workspace can fall back to the Inspector tab after hydration: only a visible status bar counts.
    await expect(page.getByTestId("ai-model-name")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
}
async function openWorkspace(page: Page, project: Project) {
  await page.goto(`/en/projects/${project.id}/workspace?selection=${encodeURIComponent(`structureVersion:${project.versionId}`)}&source=${project.structureId}`);
  await openAiPanel(page);
  await expect(page.getByTestId("ai-model-name")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("ai-scientist-panel")).toHaveAttribute("data-context-structure-version-id", project.versionId, { timeout: 60_000 });
}
async function chooseModel(page: Page, id: string) {
  const name = page.getByTestId("ai-model-name");
  await expect(name).toHaveAttribute("title", /.+/, { timeout: 60_000 });
  if ((await name.getAttribute("title")) === id) return;
  // The dock can fall back to the Inspector tab after hydration: re-open it until the trigger works.
  await expect(async () => {
    await openAiPanel(page);
    await page.getByTestId("ai-model-switch-trigger").click({ timeout: 5_000 });
    await expect(page.getByTestId("ai-model-switcher")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
  const saving = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith("/ai/settings"));
  await page.getByTestId(`ai-model-option-${id}`).click();
  expect((await saving).status()).toBe(200);
  await expect(name).toHaveAttribute("title", id);
}
async function jobs(request: APIRequestContext, project: Project) {
  return (await (await request.get(`${projectsPath}/${project.id}/compute/jobs`)).json()).jobs as unknown[];
}

test("the server offers both models as development use and refuses any other model", async ({ request }) => {
  await ensureProjects(request);
  const settings = await (await request.get(`${root}/ai/settings`)).json();
  // A Kimi-only pass runs with no NVIDIA key, so the primary provider is only required when it is exercised.
  if (liveModels.some((id) => providerOf(id) === "nvidia")) expect(settings.availability).toMatchObject({ available: true, provider: "nvidia" });
  const rows = Object.fromEntries((settings.model_capabilities as Array<Record<string, unknown>>).map((row) => [row.model_identifier as string, row]));
  for (const id of liveModels) expect(rows[id], id).toMatchObject({ eligibility: "DEVELOPMENT", selectable: true, proposal_workflow_verified: false });
  const refused = await request.put(`${root}/ai/settings`, { data: { mode: "MANAGED", provider: "nvidia", model: "nvidia/nemotron-3-ultra-550b-a55b" } });
  expect(refused.status()).toBe(422);
});

for (const model of liveModels) {
  for (const c of cases) {
    test(`LIVE ${MODEL_NAMES[model] ?? model} · ${c.id}: select the real model, request, inspect, never approve`, async ({ page, request }) => {
      test.setTimeout(420_000);
      await ensureProjects(request);
      const project = projects[c.molecule]!;
      await page.setViewportSize({ width: 1440, height: 900 });
      await openWorkspace(page, project);
      await chooseModel(page, model);
      await choosePlanMode(page, { general: false });
      await scriptStandIn(request, c.expect);
      await page.getByTestId("ai-prompt-input").fill(c.prompt);
      const began = Date.now();
      const posted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/messages"), { timeout: 300_000 });
      await page.getByTestId("ai-prepare-calculation-button").click();
      const response = await posted;
      expect(response.status()).toBe(201);
      const run = (await response.json()).latest_run as Run;
      const duration = Date.now() - began;
      // Identity binding: the run belongs to exactly the model that was selected, on the real provider.
      expect(run.ai_model).toBe(model);
      expect(run.ai_provider).toBe(providerOf(model));
      const finding: Finding = { model, case: c.id, molecule: c.molecule, outcome: "", run_status: run.status, repairs: null, request_match: null, blocker: null, sampling: null, duration_ms: duration };
      const approval = run.pending_approval;
      if (run.status === "WAITING_FOR_APPROVAL" && approval) {
        const e = c.expect;
        const args = approval.normalized_arguments;
        expect(args.structure_version.entity_id).toBe(project.versionId);
        const provenance = approval.proposal_provenance!;
        expect(provenance).toMatchObject({ model, provider: providerOf(model), eligibility: "DEVELOPMENT" });
        const outcomes = Object.fromEntries((approval.request_match ?? []).map((item) => [item.parameter, item.outcome]));
        finding.repairs = provenance.repair_attempts ?? 0;
        finding.request_match = outcomes;
        finding.sampling = provenance.sampling ?? null;
        const card = page.getByTestId("ai-approval-card");
        await expect(card).toBeVisible({ timeout: 90_000 });
        await expect(card.getByTestId("ai-approval-model")).toContainText(model);
        await expect(card.getByTestId("ai-approval-eligibility")).toHaveText("Development use only");
        await expect(card.getByTestId("ai-approval-geometry")).toContainText(project.versionId, { timeout: 60_000 });
        const allMatch = REQUEST_PARAMETERS.every((parameter) => outcomes[parameter] === "MATCH");
        if (allMatch) {
          // The proposal is what the researcher asked for and what the page says it is.
          expect(args.specification).toMatchObject({ task_type: e.task, charge: e.charge, multiplicity: e.multiplicity });
          expect(args.specification.method.identifier).toBe(e.method);
          expect(args.specification.basis.identifier).toBe(e.basis);
          expect(args.specification.engine_preference.engine).toBe(e.engine);
          await expect(card.getByTestId("ai-request-check-summary")).toHaveText(/^6 named parameters match your request$/);
          await expect(card.getByTestId("ai-proposal-decision-summary")).toContainText(`PySCF · ${METHOD_LABEL[e.method]} / ${BASIS_LABEL[e.basis]}`);
          await expect(card.getByTestId("ai-approve-button")).toBeEnabled();
          finding.outcome = "PROPOSAL_MATCHES_REQUEST";
        } else {
          // A difference must block approval; the server's own gate decides, the page must agree.
          await expect(card.getByTestId("ai-approve-button")).toBeDisabled();
          finding.outcome = "PROPOSAL_DIFFERS_FROM_REQUEST_APPROVE_BLOCKED";
        }
        await page.screenshot({ path: resolve(shots, `${model.replace("/", "_")}-${c.id}-approval.png`) });
        expect(await jobs(request, project), "nothing is queued before a decision").toHaveLength(0);
        await card.getByTestId("ai-reject-button").click(); // never approve in this suite
        await expect(page.getByTestId("ai-approval-card")).toHaveCount(0, { timeout: 60_000 });
      } else {
        finding.blocker = run.blocker ? `${run.blocker.code} after ${run.blocker.attempts}` : (run.error_code ?? null);
        finding.outcome = run.blocker ? "NO_VALID_PROPOSAL_BLOCKER_SHOWN" : `RUN_ENDED_${run.status}`;
        if (run.blocker) await expect(page.getByTestId("ai-proposal-blocker")).toBeVisible({ timeout: 30_000 });
        await page.screenshot({ path: resolve(shots, `${model.replace("/", "_")}-${c.id}-ended.png`) });
      }
      expect(await jobs(request, project), "no compute job exists").toHaveLength(0);
      const page_text = await page.content();
      expect(page_text).not.toMatch(/nvapi-[A-Za-z0-9_-]{8,}/);
      findings.push(finding);
    });
  }
}

test("the live pass queued no compute job anywhere and stayed inside the authorized models", async ({ request }) => {
  for (const project of Object.values(projects)) {
    expect(await jobs(request, project)).toHaveLength(0);
  }
  for (const finding of findings) expect(liveModels).toContain(finding.model);
  expect(findings.length).toBe(liveModels.length * cases.length);
});
