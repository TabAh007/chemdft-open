import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { choosePlanMode } from "./ai-composer";

/**
 * AI-10 end-to-end acceptance: a REAL model's proposal, explicit approval in the browser, ONE local PySCF run.
 *
 * Real Next.js + FastAPI (through the budget launcher) + disposable SQLite. The model is the real NVIDIA
 * Nemotron 3 Super; the structure is the supplied H2 (H at (0, 0, -0.37) and (0, 0, +0.37) Angstrom); the
 * request is HF/STO-3G, charge 0, singlet. The Approve button is clicked ONLY when the persisted proposal is
 * bound to the selected structure version, names exactly the requested engine, method, basis, charge and
 * multiplicity, and every named parameter reads MATCH; otherwise the proposal is rejected and the test fails.
 * Every number comes from PySCF; the earlier accepted value is recorded as a comparison, never an input.
 *
 * REHEARSAL (CHEMDFT_E2E_LIVE_REHEARSAL=1: loopback stand-in, worker off): the same path up to the approval
 * decision, which is REJECTED; nothing is queued and nothing is computed.
 */
const root = "/api/chemdft/v1";
const workspace = process.env.CHEMDFT_TEST_WORKSPACE ?? "/tmp";
const shots = resolve(workspace, "output/ai-live-execution");
const REHEARSAL = process.env.CHEMDFT_E2E_LIVE_REHEARSAL === "1";
const STAND_IN = process.env.CHEMDFT_E2E_STAND_IN_URL ?? "";
const WORKER_ENABLED = process.env.CHEMDFT_E2E_WORKER_MODE === "enabled";
const SUPER = "nvidia/nemotron-3-super-120b-a12b";
const REFERENCE_ENERGY = -1.1167593073964255; // PySCF 2.14.0, same geometry and settings (comparison only)
const REQUEST_PARAMETERS = ["task", "engine", "method", "basis", "charge", "multiplicity"] as const;

type Expect = { task: string; engine: string; method: string; basis: string; charge: number; multiplicity: number };
type ExecutionCase = { id: string; label: string; prompt: string; filename: string; format: string; mediaType: string; structureName: string; dataBase64: string; sha256: string; expect: Expect };
type Approval = {
  id: string;
  normalized_arguments: { structure_version: { entity_id: string }; specification: { task_type: string; charge: number; multiplicity: number; method: { identifier: string }; basis: { identifier: string }; engine_preference: { engine: string } } };
  proposal_provenance?: { provider: string; model: string; eligibility?: string; repair_attempts?: number } | null;
  request_match?: Array<{ parameter: string; outcome: string }>;
};
type Run = { id: string; status: string; ai_model: string | null; ai_provider?: string | null; pending_approval?: Approval | null; blocker?: { code: string; attempts: number } | null };

const fixture = JSON.parse(process.env.CHEMDFT_E2E_EXECUTION_FIXTURE ?? '{"cases":[],"engineVersion":""}') as { cases: ExecutionCase[]; engineVersion: string };
const c = fixture.cases.find((item) => item.id === "A-h2-hf-sto3g")!;

test.setTimeout(900_000);
test.use({ viewport: { width: 1600, height: 1100 } });
test.beforeAll(() => mkdirSync(shots, { recursive: true }));
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: resolve(shots, `failed-${Date.now()}.png`) }).catch(() => undefined);
});

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
async function chooseModel(page: Page, id: string) {
  const name = page.getByTestId("ai-model-name");
  await expect(name).toHaveAttribute("title", /.+/, { timeout: 60_000 });
  if ((await name.getAttribute("title")) === id) return;
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
async function importCase(request: APIRequestContext) {
  const bytes = Buffer.from(c.dataBase64, "base64");
  expect(createHash("sha256").update(bytes).digest("hex"), "structure bytes").toBe(c.sha256);
  const created = await request.post(`${root}/projects`, { data: { name: "AI-10 live H2", slug: `ai10-${crypto.randomUUID().slice(0, 8)}` } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id as string;
  const imported = await request.post(`${root}/projects/${id}/structures/imports`, { multipart: { file_format: c.format, idempotency_key: crypto.randomUUID(), structure_name: c.structureName, upload: { name: c.filename, mimeType: c.mediaType, buffer: bytes } } });
  expect(imported.status()).toBe(201);
  const body = await imported.json();
  expect(body.version.overall_charge).toBe(0);
  expect(body.version.multiplicity).toBe(1);
  return { id, versionId: body.version.id as string, structureId: (body.structure?.id ?? body.version.structure_id) as string };
}
async function scriptStandIn(request: APIRequestContext) {
  if (!REHEARSAL || !STAND_IN) return;
  expect((await request.post(`${STAND_IN}/__control/reset`)).status()).toBe(200);
  const e = c.expect;
  const step = { kind: "propose", task: e.task, method: e.method, basis: e.basis, engine: e.engine, charge: e.charge, multiplicity: e.multiplicity };
  expect((await request.post(`${STAND_IN}/__control/script`, { data: { steps: [step], repeat_last: true } })).status()).toBe(200);
}

test("real Nemotron 3 Super proposal for H2 → explicit approval → local PySCF → verified result and provenance", async ({ page, request }) => {
  expect(WORKER_ENABLED, "the worker runs only in the real execution pass").toBe(!REHEARSAL);
  const project = await importCase(request);
  const base = `${root}/projects/${project.id}`;
  await scriptStandIn(request);
  await page.goto(`/en/projects/${project.id}/workspace?selection=${encodeURIComponent(`structureVersion:${project.versionId}`)}&source=${project.structureId}`);
  await openAiPanel(page);
  await expect(page.getByTestId("ai-scientist-panel")).toHaveAttribute("data-context-structure-version-id", project.versionId, { timeout: 60_000 });
  await chooseModel(page, SUPER);
  await choosePlanMode(page, { general: false });
  await page.getByTestId("ai-prompt-input").fill(c.prompt);
  const posted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/messages"), { timeout: 400_000 });
  await page.getByTestId("ai-prepare-calculation-button").click();
  const response = await posted;
  expect(response.status()).toBe(201);
  const run = (await response.json()).latest_run as Run;
  expect(run.ai_model).toBe(SUPER);
  expect(run.ai_provider).toBe("nvidia");
  const card = page.getByTestId("ai-approval-card");

  // The approval gate: approve only a proposal that is exactly what was asked, bound to this structure version.
  const approval = run.pending_approval;
  const outcomes = Object.fromEntries((approval?.request_match ?? []).map((item) => [item.parameter, item.outcome]));
  const spec = approval?.normalized_arguments.specification;
  const e = c.expect;
  const reasons: string[] = [];
  if (run.status !== "WAITING_FOR_APPROVAL" || !approval) reasons.push(`run is ${run.status}${run.blocker ? ` with blocker ${run.blocker.code}` : ""}`);
  if (approval) {
    if (approval.normalized_arguments.structure_version.entity_id !== project.versionId) reasons.push("not bound to the selected structure version");
    if (spec?.engine_preference.engine !== e.engine || spec?.method.identifier !== e.method || spec?.basis.identifier !== e.basis || spec?.task_type !== e.task || spec?.charge !== e.charge || spec?.multiplicity !== e.multiplicity) reasons.push("parameters differ from the request");
    for (const parameter of REQUEST_PARAMETERS) if (outcomes[parameter] !== "MATCH") reasons.push(`${parameter} is ${outcomes[parameter]}`);
    if (approval.proposal_provenance?.model !== SUPER || approval.proposal_provenance?.provider !== "nvidia") reasons.push("provenance names another model");
  }
  if (reasons.length || REHEARSAL) {
    if (approval && (await card.isVisible())) await card.getByTestId("ai-reject-button").click();
    if (REHEARSAL && !reasons.length) {
      await expect(card.getByTestId("ai-approve-button")).toBeEnabled().catch(() => undefined);
      writeFileSync(resolve(shots, "rehearsal.json"), JSON.stringify({ outcome: "REHEARSAL_PROPOSAL_VALID_NOT_APPROVED", stoppedBeforeApproval: true }, null, 2));
      return;
    }
    throw new Error(`NOT APPROVED: ${reasons.join("; ")}`);
  }

  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(card.getByTestId("ai-approval-model")).toContainText(SUPER);
  await expect(card.getByTestId("ai-approval-eligibility")).toHaveText("Development use only");
  await expect(card.getByTestId("ai-request-check-summary")).toHaveText(/^6 named parameters match your request$/);
  await expect(card.getByTestId("ai-approval-geometry")).toContainText(project.versionId, { timeout: 60_000 });
  await page.screenshot({ path: resolve(shots, "01-human-approval.png") });
  expect((await (await request.get(`${base}/compute/jobs`)).json()).jobs, "nothing is queued before the decision").toHaveLength(0);

  const decision = page.waitForResponse((r) => r.url().includes("/approvals/") && r.url().endsWith("/decision"));
  await card.getByTestId("ai-approve-button").click();
  const decided = await decision;
  expect(decided.status()).toBe(200);
  const submitted = await decided.json();
  expect(submitted.status).toBe("WAITING_FOR_CALCULATION");
  const calculationId = submitted.waiting_calculation_id as string;
  const resultPanel = page.getByTestId("ai-calculation-result");
  await expect(resultPanel.getByTestId("energy-readout-value")).toHaveText(/^-\d+\.\d+$/, { timeout: 200_000 });
  await expect(page.getByTestId("ai-scientific-workflow")).toContainText("Completed · SUCCEEDED", { timeout: 60_000 });

  const detail = await (await request.get(`${base}/calculations/${calculationId}`)).json();
  // Keep the real evidence first, so a later assertion can never lose what the engine produced.
  writeFileSync(resolve(shots, "result-detail.json"), JSON.stringify({ model: SUPER, structure: project, run, calculationId, detail }, null, 2));
  expect(detail.calculation.state).toBe("SUCCEEDED");
  expect(detail.compute_job.state).toBe("SUCCEEDED");
  expect(detail.compute_execution.state).toBe("FINISHED");
  const seconds = (Date.parse(`${detail.compute_execution.finished_at}Z`) - Date.parse(`${detail.compute_execution.started_at}Z`)) / 1000;
  expect.soft(seconds, "inside the 180 s limit").toBeLessThan(180);
  const energy = detail.result.payload.total_energy;
  expect(energy.unit.code).toBe("Eh");
  expect(Number.isFinite(energy.value) && energy.value < 0).toBe(true);
  expect(detail.result.payload.converged).toBe(true);
  expect(detail.result.payload.scf_iterations).toBeGreaterThan(0);
  expect(detail.result.producer_software.name).toBe("pyscf");
  expect(detail.result.producer_software.version).toBe(fixture.engineVersion);
  expect(detail.specification).toMatchObject({ task_type: e.task, charge: e.charge, multiplicity: e.multiplicity });
  expect(detail.specification.method.identifier).toBe(e.method);
  expect(detail.specification.basis.identifier).toBe(e.basis);
  expect(detail.specification.engine_preference.engine).toBe(e.engine);
  expect(detail.result.payload.method).toBe(e.method);
  expect(detail.result.payload.basis).toBe(e.basis);
  expect(detail.calculation_input_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(detail.result.source_class).toBe("CALCULATED");
  expect(detail.result.authority).toBe("AUTHORITATIVE");
  expect(detail.result.validation_state).toBe("VALIDATED");
  expect(detail.result.trusted_producer_type).toBe("SCIENTIFIC_WORKER");
  expect(detail.result.producer_attestation_id).toBeTruthy();
  expect(detail.result.provenance_record_id).toBeTruthy();
  expect(detail.result.effective_state.source_lineage_validity).toBe("ACTIVE");
  expect(detail.result.effective_state.eligible_for_derivation).toBe(true);
  await resultPanel.getByText("Calculation parameters & provenance", { exact: true }).click();
  await expect(resultPanel).toContainText(project.versionId);
  const artifacts = [];
  for (const artifact of detail.result.raw_artifacts) {
    const downloaded = await request.get(`${base}/calculations/${calculationId}/artifacts/${artifact.artifact_id}`);
    expect(downloaded.status()).toBe(200);
    const body = await downloaded.body();
    const digest = createHash("sha256").update(body).digest("hex");
    if (artifact.sha256) expect(digest, `artifact ${artifact.artifact_id} hash`).toBe(artifact.sha256);
    writeFileSync(resolve(shots, `native-${artifact.artifact_id}.txt`), body);
    artifacts.push({ id: artifact.artifact_id, bytes: body.length, sha256: digest });
  }
  expect(artifacts.length, "the engine retained its native output").toBeGreaterThan(0);
  const comparison = { reference: REFERENCE_ENERGY, difference: energy.value - REFERENCE_ENERGY, note: "same geometry, method, basis, state and engine version; recorded, never a gate" };
  expect.soft(energy.value).toBeCloseTo(REFERENCE_ENERGY, 10);
  const runView = await (await request.get(`${base}/ai/runs/${submitted.id}`)).json();
  const conversation = await (await request.get(`${base}/ai/conversations/${runView.conversation_id}`)).json();
  const finalMessage = conversation.messages.at(-1);
  expect.soft(finalMessage.evidence_status).toBe("SUPPORTED");
  expect.soft(finalMessage.content).toContain(`${energy.value} Eh`);
  expect.soft(finalMessage.citations[0].entity_id).toBe(calculationId);
  writeFileSync(resolve(shots, "acceptance.json"), JSON.stringify({ model: SUPER, structure: project, run, approval: { id: approval!.id, request_match: approval!.request_match, provenance: approval!.proposal_provenance }, detail, artifacts, comparison, finalMessage }, null, 2));
  await page.getByTestId("ai-scientist-panel").screenshot({ path: resolve(shots, "02-result.png") });
  expect(existsSync(resolve(shots, "acceptance.json"))).toBe(true);
});
