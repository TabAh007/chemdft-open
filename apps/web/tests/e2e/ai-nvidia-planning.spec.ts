import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, repositoryPath, test, type APIRequestContext, type Page } from "./stand-in-test";
import { choosePlanMode, openAiPanelTab } from "./ai-composer";

/**
 * AI-6 browser acceptance for the two NVIDIA development models — OFFLINE STAND-IN, NOT HOSTED EVIDENCE.
 *
 * Real Next.js + FastAPI + disposable SQLite through the offline isolated runner. The real HTTP
 * gateway talks to a loopback stand-in for the NVIDIA endpoint (tools/e2e_offline/nvidia_stub.py)
 * whose replies this file scripts; no provider is contacted, the key is a fixed non-secret test
 * string, the compute worker is disabled and no proposal is ever approved. What is verified is the
 * product around the model: eligibility, model-specific sampling on the wire, identity and run
 * binding, request matching, bounded repair, the real blocker, the approval screen and responsive
 * layout. How either model really behaves is not shown here.
 */
const root = "/api/chemdft/v1";
const projectsPath = `${root}/projects`;
const shots = resolve(process.env.CHEMDFT_TEST_WORKSPACE ?? "/tmp", "output/ai-nvidia-planning");
const STAND_IN = process.env.CHEMDFT_E2E_STAND_IN_URL ?? "";
const STAND_IN_KEY = "chemdft-e2e-stand-in-key-not-a-credential";
const REASONING_CANARY = "STAND-IN-REASONING-MUST-NEVER-BE-STORED";

type Expect = { task: string; engine: string; method: string; basis: string; charge: number; multiplicity: number };
type Molecule = { file: string; format: string; sha256: string; structure_name: string; media_type: string; formula: string; atoms: number; charge: number; multiplicity: number; source: string };
type Case = { id: string; molecule: string; prompt: string; kind: "PROPOSE" | "EXPLAIN_UNAVAILABLE" | "EXPLAIN_OUT_OF_SCOPE"; expect: Expect };
type Project = { key: string; id: string; versionId: string; structureId: string; molecule: Molecule };
type Approval = {
  id: string;
  normalized_arguments: { structure_version: { entity_id: string }; specification: { task_type: string; charge: number; multiplicity: number; method: { identifier: string }; basis: { identifier: string }; engine_preference: { engine: string } } };
  proposal_provenance?: { model: string; provider: string; eligibility?: string; repair_attempts?: number; sampling?: { source: string; temperature: number; top_p?: number | null; chat_template_kwargs?: Record<string, boolean> | null } | null } | null;
  request_match?: Array<{ parameter: string; outcome: string; requested?: unknown; proposed?: unknown }>;
};
type Run = {
  id: string; status: string; ai_model: string | null; ai_provider?: string | null; error_code?: string | null;
  pending_approval?: Approval | null;
  blocker?: { attempts: number; code: string; summary: string; issues?: Array<{ field?: string | null; allowed?: unknown[] | null }> } | null;
};
type Wire = {
  index: number; authorized: boolean; model: string; temperature: number | null; top_p: number | null;
  chat_template_kwargs: Record<string, boolean> | null; max_tokens: number | null; tool_names: string[]; roles: string[];
  prompt: string; feedback: { code: string; fields: string[]; has_next_step: boolean } | null; has_context: boolean;
  structure_version_id: string | null; reply: string;
};
type Step = { kind: "propose"; task: string; method: string; basis: string; engine: string; charge: number; multiplicity: number } | { kind: "text"; content: string };

const fixture = JSON.parse(process.env.CHEMDFT_E2E_PLANNING_FIXTURE ?? '{"molecules":{},"cases":[]}') as { molecules: Record<string, Molecule>; cases: Case[] };
const caseById = (id: string) => {
  const found = fixture.cases.find((item) => item.id === id);
  if (!found) throw new Error(`unknown planning case ${id}`);
  return found;
};
const LIGHTNING = "nvidia/nemotron-3.5-lightning-30b-a3b";
const MODELS = [
  { id: "nvidia/nemotron-3-super-120b-a12b", name: "Nemotron 3 Super", thinking: true, repair: "h2o-pbe-def2svp", unavailable: "h2-unavailable-ccsdt", stubborn: "h2o-optimization-out-of-scope" },
  { id: "stepfun-ai/step-5-preview", name: "Step 5 Preview", thinking: false, repair: "ethanol-b3lyp-631g", unavailable: "ethanol-unavailable-pbe0", stubborn: "h2-unavailable-ccsdt" },
] as const;
type ModelRow = (typeof MODELS)[number];
const METHOD_LABEL: Record<string, string> = { hf: "Hartree–Fock (HF)", b3lyp: "B3LYP", pbe: "PBE" };
const BASIS_LABEL: Record<string, string> = { "sto-3g": "STO-3G", "6-31g": "6-31G", "def2-svp": "def2-SVP" };
const REQUEST_PARAMETERS = ["task", "engine", "method", "basis", "charge", "multiplicity"] as const;
const SIZES = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }] as const;

const projects: Record<string, Project> = {};
const findings: Record<string, unknown> = {
  category: "OFFLINE_NVIDIA_STAND_IN", hostedEvidence: false, provider: process.env.CHEMDFT_AI_PROVIDER, worker: process.env.CHEMDFT_E2E_WORKER_MODE,
};

// ---- stand-in control ---------------------------------------------------------------------------
const propose = (e: Expect): Step => ({ kind: "propose", task: e.task, method: e.method, basis: e.basis, engine: e.engine, charge: e.charge, multiplicity: e.multiplicity });
const NAIVE: Step = propose({ task: "ENERGY", method: "hf", basis: "sto-3g", engine: "pyscf", charge: 0, multiplicity: 1 });
async function script(request: APIRequestContext, steps: Step[], repeatLast = false) {
  expect((await request.post(`${STAND_IN}/__control/reset`)).status()).toBe(200);
  expect((await request.post(`${STAND_IN}/__control/script`, { data: { steps, repeat_last: repeatLast } })).status()).toBe(200);
}
async function wire(request: APIRequestContext) {
  return (await (await request.get(`${STAND_IN}/__control/requests`)).json()) as Wire[];
}
function expectSampling(entry: Wire, model: ModelRow, project: Project) {
  expect(entry.authorized).toBe(true);
  expect(entry.model).toBe(model.id);
  expect(entry.temperature).toBe(1);
  expect(entry.top_p).toBe(0.95);
  expect(entry.chat_template_kwargs).toEqual(model.thinking ? { enable_thinking: true, low_effort: true } : null);
  expect(entry.tool_names).toEqual(expect.arrayContaining(["calculation__submit"]));
  expect(entry.has_context).toBe(true);
  expect(entry.structure_version_id).toBe(project.versionId);
  expect(entry.max_tokens ?? 0).toBeGreaterThan(0);
}

// ---- workstation helpers (same patterns as the AI-2 switcher spec) -------------------------------
/**
 * Bring the AI Scientist panel on screen whatever the saved layout is: Advanced mode, dock shown,
 * AI tab selected. A project opened after another can come up with the dock closed or on the
 * Inspector tab, and on a phone the dock is a sheet, so each state is checked rather than assumed.
 */
async function openAiPanel(page: Page) {
  await expect(async () => {
    const advanced = page.getByTestId("mode-toggle-advanced");
    if ((await advanced.isVisible()) && (await advanced.getAttribute("aria-pressed")) !== "true") await advanced.click();
    const show = page.getByRole("button", { name: "Show AI Scientist panel", exact: true });
    if (await show.isVisible()) await show.click();
    const tab = page.getByTestId("ai-scientist-tab");
    if ((await tab.isVisible()) && (await tab.getAttribute("aria-selected")) !== "true") await tab.click();
    await expect(page.getByTestId("ai-scientist-panel")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}
async function openWorkspace(page: Page, project: Project) {
  await page.goto(`/en/projects/${project.id}/workspace?selection=${encodeURIComponent(`structureVersion:${project.versionId}`)}&source=${project.structureId}`);
  await openAiPanel(page);
  await expect(page.getByTestId("ai-model-name")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("ai-scientist-panel")).toHaveAttribute("data-context-structure-version-id", project.versionId, { timeout: 60_000 });
}
async function pageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
async function axeViolations(page: Page, selector: string) {
  return page.evaluate(async (target) => {
    const result = await (window as unknown as { axe: { run: (context: string, options: object) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } })
      .axe.run(target, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
    return result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")) }));
  }, selector);
}
async function openSwitcher(page: Page) {
  await page.getByTestId("ai-model-switch-trigger").click();
  const dialog = page.getByTestId("ai-model-switcher");
  await expect(dialog).toBeVisible();
  let previous = "";
  await expect(async () => {
    const box = JSON.stringify(await dialog.boundingBox());
    const stable = box === previous;
    previous = box;
    expect(stable).toBe(true);
  }).toPass({ timeout: 5_000 });
}
async function chooseModel(page: Page, id: string) {
  const name = page.getByTestId("ai-model-name");
  await expect(name).toHaveAttribute("title", /.+/, { timeout: 60_000 });
  if ((await name.getAttribute("title")) === id) return;
  await openSwitcher(page);
  const saving = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith("/ai/settings"));
  await page.getByTestId(`ai-model-option-${id}`).click();
  expect((await saving).status()).toBe(200);
  await expect(name).toHaveAttribute("title", id);
}
async function planAsk(page: Page, prompt: string, general = false): Promise<Run> {
  await choosePlanMode(page, { general });
  await page.getByTestId("ai-prompt-input").fill(prompt);
  const posted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/messages"), { timeout: 120_000 });
  await page.getByTestId("ai-prepare-calculation-button").click();
  const response = await posted;
  expect(response.status()).toBe(201);
  return (await response.json()).latest_run as Run;
}
async function jobs(request: APIRequestContext, project: Project) {
  return (await (await request.get(`${projectsPath}/${project.id}/compute/jobs`)).json()).jobs as unknown[];
}
async function expectNoSecretsOrReasoning(page: Page, ...payloads: unknown[]) {
  const seen = [await page.content(), ...payloads.map((payload) => JSON.stringify(payload))].join("\n");
  expect(seen).not.toContain(REASONING_CANARY);
  expect(seen).not.toContain(STAND_IN_KEY);
}
/** In the viewport is not enough: the composer is sticky over the bottom of the chat column. */
async function expectAboveComposer(page: Page, target: ReturnType<Page["locator"]>, what: string) {
  await expect(async () => {
    const box = await target.boundingBox();
    const dock = await page.getByTestId("ai-input-dock").boundingBox();
    expect(box && dock, `${what} and the composer are laid out`).toBeTruthy();
    expect(box!.y, `${what} starts above the composer`).toBeLessThan(dock!.y - 8);
    expect(box!.y, `${what} is not scrolled out above`).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: resolve(shots, `${name}.png`) });
}
async function reject(page: Page, request: APIRequestContext, project: Project) {
  await page.getByTestId("ai-reject-button").click();
  await expect(page.getByTestId("ai-approval-card")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId("ai-prompt-input")).toBeEnabled({ timeout: 60_000 });
  expect(await jobs(request, project)).toHaveLength(0);
}

// ---- what a proposal that reached approval must show --------------------------------------------
function expectBoundProposal(run: Run, model: ModelRow, project: Project, c: Case, repairs: number) {
  const e = c.expect;
  expect(run.status).toBe("WAITING_FOR_APPROVAL");
  expect(run.ai_model).toBe(model.id);
  expect(run.ai_provider).toBe("nvidia");
  const approval = run.pending_approval!;
  const args = approval.normalized_arguments;
  expect(args.structure_version.entity_id).toBe(project.versionId);
  expect(args.specification).toMatchObject({ task_type: e.task, charge: e.charge, multiplicity: e.multiplicity });
  expect(args.specification.method.identifier).toBe(e.method);
  expect(args.specification.basis.identifier).toBe(e.basis);
  expect(args.specification.engine_preference.engine).toBe(e.engine);
  const provenance = approval.proposal_provenance!;
  expect(provenance).toMatchObject({ model: model.id, provider: "nvidia", eligibility: "DEVELOPMENT", repair_attempts: repairs });
  expect(provenance.sampling).toMatchObject({ source: "MODEL_CARD_PROFILE", temperature: 1, top_p: 0.95 });
  expect(provenance.sampling?.chat_template_kwargs ?? null).toEqual(model.thinking ? { enable_thinking: true, low_effort: true } : null);
  const outcomes = Object.fromEntries((approval.request_match ?? []).map((item) => [item.parameter, item.outcome]));
  for (const parameter of REQUEST_PARAMETERS) expect(outcomes[parameter], parameter).toBe("MATCH");
}
async function inspectApproval(page: Page, model: ModelRow, project: Project, c: Case, repairs: number) {
  const e = c.expect;
  const card = page.getByTestId("ai-approval-card");
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(card.getByTestId("ai-approval-model")).toContainText(model.id);
  await expect(card.getByTestId("ai-approval-model")).toContainText(/NVIDIA/i);
  await expect(card.getByTestId("ai-approval-eligibility")).toHaveText("Development use only");
  await expect(card.getByTestId("ai-request-check-summary")).toHaveText(/^6 named parameters match your request$/);
  await expect(card.getByTestId("ai-request-check-summary")).toBeInViewport();
  const sampling = card.getByTestId("ai-approval-sampling");
  await expect(sampling).toContainText("Model-card profile: temperature 1 · top-p 0.95");
  if (model.thinking) await expect(sampling).toContainText("reasoning enable thinking on, low effort on");
  else await expect(sampling).not.toContainText("reasoning");
  if (repairs) await expect(card.getByTestId("ai-approval-repairs")).toContainText(`Corrected ${repairs} time`);
  else await expect(card.getByTestId("ai-approval-repairs")).toHaveCount(0);
  const check = card.getByTestId("ai-request-check");
  for (const parameter of REQUEST_PARAMETERS) await expect(check.locator(`li[data-parameter="${parameter}"]`)).toHaveAttribute("data-outcome", "MATCH");
  await expect(check.locator('li[data-outcome="MISMATCH"]')).toHaveCount(0);
  await expect(check.locator('li[data-parameter="method"]')).toContainText(METHOD_LABEL[e.method]!);
  await expect(check.locator('li[data-parameter="basis"]')).toContainText(BASIS_LABEL[e.basis]!);
  await expect(card.getByTestId("ai-approval-geometry")).toContainText(project.versionId, { timeout: 60_000 });
  const summary = card.getByTestId("ai-proposal-decision-summary");
  await expect(summary).toContainText(`PySCF · ${METHOD_LABEL[e.method]} / ${BASIS_LABEL[e.basis]} · Single-point energy · charge ${e.charge} · multiplicity ${e.multiplicity} (singlet)`);
  await expect(summary).toContainText(project.molecule.structure_name);
  // The researcher can inspect everything and decide; this suite only ever rejects.
  await expect(card.getByTestId("ai-approve-button")).toBeEnabled();
  await expect(card.getByTestId("ai-reject-button")).toBeEnabled();
}

/** One project per reference molecule, imported through the real route from the unmodified source bytes. */
async function ensureProjects(request: APIRequestContext) {
  expect(Object.keys(fixture.molecules).sort()).toEqual(["ethanol", "h2", "h2o"]);
  for (const [key, molecule] of Object.entries(fixture.molecules)) {
    if (projects[key]) continue;
    const bytes = readFileSync(repositoryPath("tools/nvidia_probe/molecules", molecule.file));
    expect(createHash("sha256").update(bytes).digest("hex"), `${key} source bytes`).toBe(molecule.sha256);
    const created = await request.post(projectsPath, { data: { name: `AI-6 ${molecule.formula}`, slug: `ai6-${key}-${crypto.randomUUID().slice(0, 8)}` } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).id as string;
    const imported = await request.post(`${projectsPath}/${id}/structures/imports`, { multipart: {
      file_format: molecule.format, idempotency_key: crypto.randomUUID(), structure_name: molecule.structure_name,
      upload: { name: molecule.file, mimeType: molecule.media_type, buffer: bytes },
    } });
    expect(imported.status(), `${key} import`).toBe(201);
    const body = await imported.json();
    expect(body.version.overall_charge).toBe(molecule.charge);
    expect(body.version.multiplicity).toBe(molecule.multiplicity);
    if (body.version.coordinates?.atoms) expect(body.version.coordinates.atoms).toHaveLength(molecule.atoms);
    projects[key] = { key, id, versionId: body.version.id as string, structureId: (body.structure?.id ?? body.version.structure_id) as string, molecule };
  }
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => mkdirSync(shots, { recursive: true }));
test.afterAll(() => writeFileSync(resolve(shots, "findings.json"), JSON.stringify(findings, null, 2)));

test("the three reference molecules import unchanged and both models are server-reported development models", async ({ request }) => {
  test.setTimeout(240_000);
  await ensureProjects(request);
  const settings = await (await request.get(`${root}/ai/settings`)).json();
  expect(settings.availability).toMatchObject({ available: true, provider: "nvidia" });
  expect(settings.preferences.model).toBe(LIGHTNING);
  expect([...settings.providers[0].models].sort()).toEqual([LIGHTNING, ...MODELS.map((model) => model.id)].sort());
  const rows = Object.fromEntries((settings.model_capabilities as Array<Record<string, unknown>>).map((row) => [row.model_identifier as string, row]));
  for (const model of MODELS) {
    const row = rows[model.id]!;
    expect(row, model.id).toMatchObject({ eligibility: "DEVELOPMENT", configured: true, selectable: true, tool_compatibility_verified: false, proposal_workflow_verified: false });
    expect(row.status).not.toBe("LIVE-VERIFIED");
    expect(row.planning_profiles).toEqual(["PYSCF_ENERGY_PROPOSAL"]);
    expect((row.development_evidence as string[]).join(" ")).toMatch(/run 5/i);
  }
  expect(rows[LIGHTNING]).toMatchObject({ eligibility: "STANDARD" });
  // A registry model this server did not configure is still refused by the server, whatever the browser says.
  const refused = await request.put(`${root}/ai/settings`, { data: { mode: "MANAGED", provider: "nvidia", model: "nvidia/nemotron-3-ultra-550b-a55b" } });
  expect(refused.status()).toBe(422);
  expect((await (await request.get(`${root}/ai/settings`)).json()).preferences.model).toBe(LIGHTNING);
  findings.catalogue = Object.fromEntries(MODELS.map((model) => [model.id, { eligibility: rows[model.id]!.eligibility, status: rows[model.id]!.status, profiles: rows[model.id]!.planning_profiles }]));
});

test("the right-side selector offers both models as development use and the server saves the choice", async ({ page, request }) => {
  test.setTimeout(300_000);
  await ensureProjects(request);
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page, projects.h2!);
  const name = page.getByTestId("ai-model-name");
  await expect(name).toHaveAttribute("title", LIGHTNING, { timeout: 60_000 });
  await openSwitcher(page);
  await expect(page.getByTestId(`ai-model-option-${LIGHTNING}`)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId(`ai-model-option-${LIGHTNING}`)).not.toContainText("Development");
  for (const model of MODELS) {
    const option = page.getByTestId(`ai-model-option-${model.id}`);
    await expect(option).toContainText(model.name);
    await expect(option).toContainText("Development");
    await expect(option).toContainText("development use only: Plan (PySCF energy)");
    await expect(option).not.toContainText("Not selectable");
    await option.focus();
    const detail = page.getByTestId("ai-model-detail");
    await expect(detail).toContainText("Eligible for development use only");
    await expect(detail).toContainText("Development evidence");
    await expect(detail).toContainText("Plan (PySCF energy)");
    await expect(detail).toContainText("Not verified");
    await expect(detail).not.toContainText(/live-verified/i);
  }
  await page.getByTestId(`ai-model-option-${MODELS[0].id}`).focus();
  await shot(page, "01-switcher-development-1440");
  await page.keyboard.press("Escape");

  // Choosing a model is validated and saved by the server, survives a reload and binds new runs.
  for (const model of [MODELS[0], MODELS[1], MODELS[0]]) {
    await chooseModel(page, model.id);
    await expect(page.getByTestId("ai-model-switch-status")).toContainText(`New requests use ${model.name}`);
    expect((await (await request.get(`${root}/ai/settings`)).json()).preferences.model).toBe(model.id);
  }
  await page.reload();
  await openAiPanel(page);
  await expect(page.getByTestId("ai-model-name")).toHaveAttribute("title", MODELS[0].id, { timeout: 60_000 });
  await openAiPanelTab(page, "settings");
  await expect(page.getByTestId("ai-settings-current")).toContainText(MODELS[0].id);
  await page.getByTestId("ai-nav-chat").click();
  expect(consoleErrors.filter((text) => !/favicon|Failed to load resource/.test(text))).toEqual([]);
});

for (const model of MODELS) {
  test(`${model.name}: planning requests for H2, water and ethanol reach approval exactly as asked`, async ({ page, request }) => {
    test.setTimeout(900_000);
    await ensureProjects(request);
    const consoleErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.setViewportSize({ width: 1440, height: 900 });
    const record: Record<string, unknown> = {};
    let open: string | null = null;
    for (const c of fixture.cases.filter((item) => item.kind === "PROPOSE")) {
      const project = projects[c.molecule]!;
      if (open !== project.key) {
        await openWorkspace(page, project);
        await chooseModel(page, model.id);
        open = project.key;
      }
      await script(request, [propose(c.expect)]);
      const run = await planAsk(page, c.prompt);
      expectBoundProposal(run, model, project, c, 0);
      await inspectApproval(page, model, project, c, 0);
      const entries = await wire(request);
      expect(entries, `${c.id}: one model request`).toHaveLength(1);
      expectSampling(entries[0]!, model, project);
      expect(entries[0]!.prompt).toBe(c.prompt);
      expect(entries[0]!.feedback).toBeNull();
      await expectNoSecretsOrReasoning(page, run);
      if (["h2o-pbe-def2svp", "ethanol-b3lyp-631g"].includes(c.id)) {
        const label = `${model.thinking ? "super" : "step5"}-${c.molecule}`;
        await shot(page, `02-approval-${label}-1440`);
        await page.getByTestId("ai-request-check").scrollIntoViewIfNeeded();
        await shot(page, `02b-request-check-${label}-1440`);
      }
      record[c.id] = { runModel: run.ai_model, sampling: run.pending_approval!.proposal_provenance!.sampling, requests: entries.length };
      await reject(page, request, project);
    }
    findings[`proposals:${model.id}`] = record;
    expect(consoleErrors.filter((text) => !/favicon|Failed to load resource/.test(text))).toEqual([]);
  });

  test(`${model.name}: a substituted first proposal is corrected after structured feedback`, async ({ page, request }) => {
    test.setTimeout(300_000);
    await ensureProjects(request);
    const c = caseById(model.repair);
    const project = projects[c.molecule]!;
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page, project);
    await chooseModel(page, model.id);
    await script(request, [NAIVE, propose(c.expect)]);
    const run = await planAsk(page, c.prompt);
    expectBoundProposal(run, model, project, c, 1);
    await inspectApproval(page, model, project, c, 1);
    const entries = await wire(request);
    expect(entries).toHaveLength(2);
    entries.forEach((entry) => expectSampling(entry, model, project));
    expect(entries[0]!.feedback).toBeNull();
    expect(entries[1]!.feedback).toMatchObject({ code: "REQUEST_MISMATCH", has_next_step: true });
    expect(entries[1]!.feedback!.fields).toEqual(expect.arrayContaining(["specification.method.identifier", "specification.basis.identifier"]));
    await expectNoSecretsOrReasoning(page, run);
    await shot(page, `03-repaired-${model.thinking ? "super" : "step5"}-1440`);
    findings[`repair:${model.id}`] = { case: c.id, requests: entries.length, feedback: entries[1]!.feedback, repairAttempts: run.pending_approval!.proposal_provenance!.repair_attempts };
    await reject(page, request, project);
  });

  test(`${model.name}: a request the server cannot meet ends as an explanation, never a substitute`, async ({ page, request }) => {
    test.setTimeout(300_000);
    await ensureProjects(request);
    const c = caseById(model.unavailable);
    const project = projects[c.molecule]!;
    const explanation = `Stand-in explanation for ${c.id}: this method is not available in the PySCF planning scope, so no calculation was proposed.`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page, project);
    await chooseModel(page, model.id);
    await script(request, [NAIVE, { kind: "text", content: explanation }]);
    const run = await planAsk(page, c.prompt);
    expect(run.status).toBe("SUCCEEDED");
    expect(run.ai_model).toBe(model.id);
    expect(run.pending_approval ?? null).toBeNull();
    expect(run.blocker ?? null).toBeNull();
    await expect(page.getByTestId("ai-scientist-panel")).toContainText(explanation, { timeout: 60_000 });
    await expect(page.getByTestId("ai-scientist-panel")).toContainText(c.prompt);
    await expectAboveComposer(page, page.getByTestId("ai-scientist-panel").getByText(explanation), "the answer");
    await expect(page.getByTestId("ai-refused-proposals")).toContainText("ChemDFT refused 1 proposal before approval");
    await expect(page.getByTestId("ai-scientist-panel")).not.toContainText("TOOL_REJECTED");
    await expect(page.getByTestId("ai-approval-card")).toHaveCount(0);
    await expect(page.getByTestId("ai-proposal-blocker")).toHaveCount(0);
    const entries = await wire(request);
    expect(entries).toHaveLength(2);
    expect(entries[1]!.feedback).toMatchObject({ code: "REQUEST_MISMATCH", has_next_step: true });
    expect(entries[1]!.feedback!.fields).toContain("specification.method.identifier");
    expect(await jobs(request, project)).toHaveLength(0);
    await expectNoSecretsOrReasoning(page, run);
    await shot(page, `04-explanation-${model.thinking ? "super" : "step5"}-1440`);
    findings[`unavailable:${model.id}`] = { case: c.id, status: run.status, requests: entries.length, feedback: entries[1]!.feedback };
  });

  test(`${model.name}: a model that keeps substituting ends with the real blocker`, async ({ page, request }) => {
    test.setTimeout(300_000);
    await ensureProjects(request);
    const c = caseById(model.stubborn);
    const project = projects[c.molecule]!;
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page, project);
    await chooseModel(page, model.id);
    await script(request, [NAIVE], true);
    const run = await planAsk(page, c.prompt);
    expect(run).toMatchObject({ status: "FAILED", error_code: "PROPOSAL_NOT_REPAIRED", ai_model: model.id });
    expect(run.pending_approval ?? null).toBeNull();
    expect(run.blocker).toMatchObject({ attempts: 3, code: "REQUEST_MISMATCH" });
    const blocker = page.getByTestId("ai-proposal-blocker");
    await expect(blocker).toBeVisible({ timeout: 60_000 });
    await expect(blocker).toContainText("No valid proposal after 3 attempts");
    await expect(blocker).toContainText("The proposals did not match what you asked for.");
    await expect(blocker).toContainText("Nothing was submitted or computed");
    await expect(blocker).not.toContainText("Do not substitute");
    expect(await blocker.getByTestId("ai-blocker-issue").count()).toBeGreaterThan(0);
    await expect(blocker).toContainText("Available here");
    await expect(blocker.getByTestId("ai-blocker-retry")).toBeEnabled();
    await expectAboveComposer(page, blocker.getByTestId("ai-blocker-retry"), "the retry action");
    await expect(page.getByTestId("ai-scientist-panel")).not.toContainText("TOOL_REJECTED");
    await expect(page.getByTestId("ai-scientist-panel")).not.toContainText("PROPOSAL_NOT_REPAIRED");
    await expect(page.getByTestId("ai-approval-card")).toHaveCount(0);
    await expect(page.getByTestId("ai-scientist-panel")).toContainText(c.prompt);
    const entries = await wire(request);
    expect(entries).toHaveLength(3);
    entries.forEach((entry) => expect(entry.model).toBe(model.id));
    expect(await jobs(request, project)).toHaveLength(0);
    await expectNoSecretsOrReasoning(page, run);
    await shot(page, `05-blocker-${model.thinking ? "super" : "step5"}-1440`);
    findings[`blocker:${model.id}`] = { case: c.id, attempts: run.blocker!.attempts, requests: entries.length, issues: (run.blocker!.issues ?? []).map((issue) => issue.field) };
  });
}

test("the standard model keeps the server defaults and sends no development sampling", async ({ page, request }) => {
  test.setTimeout(240_000);
  await ensureProjects(request);
  const project = projects.h2!;
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page, project);
  await chooseModel(page, LIGHTNING);
  await script(request, [{ kind: "text", content: "Stand-in answer." }]);
  const run = await planAsk(page, "Explain a qualitative concept.", true);
  expect(run.ai_model).toBe(LIGHTNING);
  const entries = await wire(request);
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    expect(entry).toMatchObject({ model: LIGHTNING, temperature: 0, top_p: null, chat_template_kwargs: null, authorized: true });
  }
  findings.standardModel = { model: LIGHTNING, requests: entries.length, temperature: entries[0]!.temperature };
});

test("the selector's observed counts come from the user's own recorded runs and say what they do not show", async ({ page, request }) => {
  test.setTimeout(240_000);
  await ensureProjects(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page, projects.h2!);
  await openSwitcher(page);
  const rows: Record<string, string> = {};
  for (const model of MODELS) {
    await page.getByTestId(`ai-model-option-${model.id}`).focus();
    const observed = page.getByTestId("ai-model-observed");
    await expect(observed).toBeVisible({ timeout: 30_000 });
    const text = (await observed.innerText()).replace(/\s+/g, " ");
    rows[model.id] = text;
    // Six requests that reached approval at once, one that was corrected after a refusal; every
    // refused proposal is counted by validation outcome only, never as scientific correctness.
    expect(text, model.id).toMatch(/7 reached approval \(6 on the first attempt\)/);
    expect(text, model.id).toMatch(/5 refused by validation \(5 request mismatch\)/);
    expect(text, model.id).toMatch(/1 corrected after a refusal/);
    expect(text, model.id).toMatch(/1 run ended without a valid proposal/);
    expect(text, model.id).toContain("validation, not scientific correctness");
    expect(text, model.id).not.toMatch(/synthetic/i);
  }
  await page.keyboard.press("Escape");
  findings.observedCounts = rows;
});

test("the approval screen, blocker and selector stay usable from desktop to phone width", async ({ page, request }) => {
  test.setTimeout(600_000);
  await ensureProjects(request);
  const model = MODELS[0];
  const c = caseById("h2o-pbe-def2svp");
  const project = projects[c.molecule]!;
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page, project);
  await chooseModel(page, model.id);
  await script(request, [propose(c.expect)]);
  const run = await planAsk(page, c.prompt);
  expectBoundProposal(run, model, project, c, 0);
  await page.addScriptTag({ path: resolve("node_modules/axe-core/axe.min.js") });
  const layout: Record<string, unknown> = {};
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await openAiPanel(page);
    const card = page.getByTestId("ai-approval-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.evaluate((element) => {
      element.scrollTop = 0;
      element.querySelector(".ai-approval-screen-body")?.scrollTo(0, 0);
      let ancestor = element.parentElement;
      while (ancestor) { ancestor.scrollTop = 0; ancestor = ancestor.parentElement; }
    });
    await expect(card.getByTestId("ai-request-check-summary")).toBeInViewport();
    await expect(card.getByTestId("ai-request-check")).toBeVisible();
    const check = await card.getByTestId("ai-request-check").boundingBox();
    expect(check && check.x >= 0 && check.x + check.width <= size.width, `${size.width}: request check inside the viewport`).toBe(true);
    expect(await pageOverflow(page), `${size.width}: page overflow`).toBe(0);
    await card.getByTestId("ai-approval-model").scrollIntoViewIfNeeded();
    await shot(page, `10-approval-${size.width}x${size.height}`);
    await card.getByTestId("ai-request-check").scrollIntoViewIfNeeded();
    await shot(page, `11-request-check-${size.width}x${size.height}`);
    await card.getByTestId("ai-approve-button").scrollIntoViewIfNeeded();
    await expect(card.getByTestId("ai-approve-button")).toBeInViewport();
    await expect(card.getByTestId("ai-reject-button")).toBeInViewport();
    const violations = await axeViolations(page, '[data-testid="ai-approval-card"]');
    layout[`approval ${size.width}x${size.height}`] = { overflowPx: await pageOverflow(page), axe: violations };
    expect(violations, `${size.width}: accessibility`).toEqual([]);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAiPanel(page);
  await reject(page, request, project);

  // The blocker and the selector at phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await openAiPanel(page);
  await script(request, [NAIVE], true);
  const stubborn = caseById("h2o-optimization-out-of-scope");
  const failed = await planAsk(page, stubborn.prompt);
  expect(failed).toMatchObject({ status: "FAILED", error_code: "PROPOSAL_NOT_REPAIRED" });
  const blocker = page.getByTestId("ai-proposal-blocker");
  await expect(blocker).toBeVisible({ timeout: 60_000 });
  await blocker.scrollIntoViewIfNeeded();
  const box = (await blocker.boundingBox())!;
  expect(box.x >= 0 && box.x + box.width <= 390, "blocker inside the viewport").toBe(true);
  expect(await pageOverflow(page)).toBe(0);
  const blockerViolations = await axeViolations(page, '[data-testid="ai-proposal-blocker"]');
  expect(blockerViolations).toEqual([]);
  await shot(page, "12-blocker-390x844");
  await openSwitcher(page);
  const popover = (await page.getByTestId("ai-model-switcher").boundingBox())!;
  expect(popover.x >= 0 && popover.x + popover.width <= 390 && popover.y >= 0 && popover.y + popover.height <= 844, "selector inside the viewport").toBe(true);
  const switcherViolations = await axeViolations(page, '[data-testid="ai-model-switcher"]');
  expect(switcherViolations).toEqual([]);
  await page.getByTestId(`ai-model-option-${MODELS[1].id}`).focus();
  await shot(page, "13-switcher-390x844");
  layout["blocker 390x844"] = { overflowPx: await pageOverflow(page), axe: blockerViolations };
  layout["switcher 390x844"] = { width: Math.round(popover.width), axe: switcherViolations };
  await page.keyboard.press("Escape");
  expect(await jobs(request, project)).toHaveLength(0);
  findings.layout = layout;
});
