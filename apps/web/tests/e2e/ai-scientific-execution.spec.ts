import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { choosePlanMode } from "./ai-composer";

/**
 * AI-7 browser acceptance for the first real scientific cases (H2, water, ethanol; HF/STO-3G).
 *
 * Two modes, selected by what the runner started and never by a default:
 *
 *  - PREPARATION (worker disabled, offline sandbox). For each case the researcher asks, the approval
 *    screen is inspected field by field, and the proposal is REJECTED. Nothing is ever approved, no
 *    job or calculation exists afterwards, and no number is shown as calculated.
 *  - EXECUTION (worker enabled, non-offline stack). Runs ONLY the single case named by
 *    CHEMDFT_AI7_AUTHORIZED_CASE, after the researcher has separately authorized that exact run. It
 *    approves in the browser, waits for the real PySCF worker and checks that the result, the
 *    provenance and the artifacts come from the engine. Planning uses the fake provider; every
 *    number comes from PySCF.
 *
 * With neither precondition a test is skipped, so this file cannot run a calculation by accident.
 */
const root = "/api/chemdft/v1";
const shots = resolve(process.env.CHEMDFT_TEST_WORKSPACE ?? "/tmp", "output/ai-scientific-execution");
const WORKER_ENABLED = process.env.CHEMDFT_E2E_WORKER_MODE === "enabled";
const AUTHORIZED = process.env.CHEMDFT_AI7_AUTHORIZED_CASE ?? "";

type Expect = { task: string; engine: string; method: string; basis: string; charge: number; multiplicity: number };
type ExecutionCase = { id: string; label: string; prompt: string; filename: string; format: string; mediaType: string; structureName: string; dataBase64: string; sha256: string; geometryBasis: string; expect: Expect; referenceEnergy: number | null; referenceTolerance: number | null };
const fixture = JSON.parse(process.env.CHEMDFT_E2E_EXECUTION_FIXTURE ?? '{"cases":[]}') as { cases: ExecutionCase[]; engineVersion: string };
const METHOD_LABEL: Record<string, string> = { hf: "Hartree–Fock (HF)" };
const BASIS_LABEL: Record<string, string> = { "sto-3g": "STO-3G" };
const REQUEST_PARAMETERS = ["task", "engine", "method", "basis", "charge", "multiplicity"] as const;

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);
test.use({ viewport: { width: 1600, height: 1100 } });
test.beforeAll(() => mkdirSync(shots, { recursive: true }));

type Project = { id: string; versionId: string; structureId: string };

async function importCase(request: APIRequestContext, c: ExecutionCase): Promise<Project> {
  const bytes = Buffer.from(c.dataBase64, "base64");
  expect(createHash("sha256").update(bytes).digest("hex"), `${c.id} source bytes`).toBe(c.sha256);
  const created = await request.post(`${root}/projects`, { data: { name: `AI-7 ${c.label}`, slug: `ai7-${crypto.randomUUID().slice(0, 8)}` } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id as string;
  const imported = await request.post(`${root}/projects/${id}/structures/imports`, {
    multipart: { file_format: c.format, idempotency_key: crypto.randomUUID(), structure_name: c.structureName, upload: { name: c.filename, mimeType: c.mediaType, buffer: bytes } },
  });
  expect(imported.status(), `${c.id} import`).toBe(201);
  const body = await imported.json();
  expect(body.version.overall_charge).toBe(c.expect.charge);
  expect(body.version.multiplicity).toBe(c.expect.multiplicity);
  expect((await request.put(`${root}/ai/settings`, { data: { mode: "MANAGED", provider: "fake", model: "fake-standard" } })).ok()).toBe(true);
  return { id, versionId: body.version.id as string, structureId: (body.structure?.id ?? body.version.structure_id) as string };
}

async function openWorkspace(page: Page, project: Project) {
  await page.goto(`/en/projects/${project.id}/workspace?selection=${encodeURIComponent(`structureVersion:${project.versionId}`)}&source=${project.structureId}`);
  await expect(async () => {
    const show = page.getByRole("button", { name: "Show AI Scientist panel", exact: true });
    if (await show.isVisible()) await show.click();
    await expect(page.getByTestId("ai-scientist-panel")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByTestId("ai-prompt-input")).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByTestId("ai-scientist-panel")).toHaveAttribute("data-context-structure-version-id", project.versionId, { timeout: 60_000 });
}

type Approval = { normalized_arguments: { structure_version: { entity_id: string }; specification: { task_type: string; charge: number; multiplicity: number; method: { identifier: string }; basis: { identifier: string }; engine_preference: { engine: string } } }; proposal_provenance?: { provider: string; model: string } | null; request_match?: Array<{ parameter: string; outcome: string }> };
type Run = { id: string; status: string; pending_approval?: Approval | null };

async function ask(page: Page, prompt: string): Promise<Run> {
  await choosePlanMode(page, { general: false });
  await page.getByTestId("ai-prompt-input").fill(prompt);
  const posted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/messages"), { timeout: 120_000 });
  await page.getByTestId("ai-prepare-calculation-button").click();
  const response = await posted;
  expect(response.status()).toBe(201);
  return (await response.json()).latest_run as Run;
}

function expectBoundProposal(run: Run, c: ExecutionCase, project: Project) {
  expect(run.status).toBe("WAITING_FOR_APPROVAL");
  const approval = run.pending_approval!;
  const args = approval.normalized_arguments;
  const e = c.expect;
  expect(args.structure_version.entity_id, "the proposal is bound to the selected structure version").toBe(project.versionId);
  expect(args.specification).toMatchObject({ task_type: e.task, charge: e.charge, multiplicity: e.multiplicity });
  expect(args.specification.method.identifier).toBe(e.method);
  expect(args.specification.basis.identifier).toBe(e.basis);
  expect(args.specification.engine_preference.engine).toBe(e.engine);
  expect(approval.proposal_provenance?.provider).toBe("fake");
  const outcomes = Object.fromEntries((approval.request_match ?? []).map((item) => [item.parameter, item.outcome]));
  for (const parameter of REQUEST_PARAMETERS) expect(outcomes[parameter], parameter).toBe("MATCH");
}

async function inspectApprovalScreen(page: Page, c: ExecutionCase, project: Project) {
  const e = c.expect;
  const card = page.getByTestId("ai-approval-card");
  await expect(card).toBeVisible({ timeout: 90_000 });
  const summary = card.getByTestId("ai-proposal-decision-summary");
  await expect(summary).toContainText(`PySCF · ${METHOD_LABEL[e.method]} / ${BASIS_LABEL[e.basis]} · Single-point energy · charge ${e.charge} · multiplicity ${e.multiplicity} (singlet)`);
  await expect(summary).toContainText(c.structureName);
  await expect(card.getByTestId("ai-approval-geometry")).toContainText(project.versionId, { timeout: 60_000 });
  await expect(card.getByTestId("ai-approval-model")).toContainText(/fake/i);
  const check = card.getByTestId("ai-request-check");
  for (const parameter of REQUEST_PARAMETERS) await expect(check.locator(`li[data-parameter="${parameter}"]`)).toHaveAttribute("data-outcome", "MATCH");
  await expect(check.locator('li[data-outcome="MISMATCH"]')).toHaveCount(0);
  await expect(card.getByTestId("ai-approve-button")).toBeEnabled();
  await expect(card.getByTestId("ai-reject-button")).toBeEnabled();
  // Nothing on the screen is a calculated number: no readout exists before an engine has run.
  await expect(page.getByTestId("energy-readout-value")).toHaveCount(0);
  await expect(page.getByTestId("ai-calculation-result")).toHaveCount(0);
}

async function collection(request: APIRequestContext, project: Project, name: "compute/jobs" | "calculations") {
  const body = await (await request.get(`${root}/projects/${project.id}/${name}`)).json();
  return (body.jobs ?? body.calculations ?? []) as unknown[];
}

for (const c of fixture.cases) {
  test(`AI-7 preparation · ${c.id}: the approval screen shows the exact proposal and a rejection creates nothing`, async ({ page, request }) => {
    test.skip(WORKER_ENABLED, "preparation never runs with a worker");
    expect(process.env.CHEMDFT_E2E_WORKER_MODE).toBe("disabled");
    const project = await importCase(request, c);
    await openWorkspace(page, project);
    const run = await ask(page, c.prompt);
    expectBoundProposal(run, c, project);
    await inspectApprovalScreen(page, c, project);
    expect(await collection(request, project, "compute/jobs"), "nothing is queued before a decision").toHaveLength(0);
    await page.getByTestId("ai-approval-card").screenshot({ path: resolve(shots, `${c.id}-approval.png`) });
    // Preparation only ever rejects.
    await page.getByTestId("ai-reject-button").click();
    await expect(page.getByTestId("ai-approval-card")).toHaveCount(0, { timeout: 60_000 });
    expect(await collection(request, project, "compute/jobs")).toHaveLength(0);
    expect(await collection(request, project, "calculations")).toHaveLength(0);
    await expect(page.getByTestId("energy-readout-value")).toHaveCount(0);
    const settled = await (await request.get(`${root}/projects/${project.id}/ai/runs/${run.id}`)).json();
    expect(settled.pending_approval ?? null).toBeNull();
  });

  test(`AI-7 execution · ${c.id}: authorized real PySCF run, approved in the browser`, async ({ page, request }) => {
    test.skip(!WORKER_ENABLED || AUTHORIZED !== c.id, `runs only when the researcher has authorized ${c.id} and the worker is enabled`);
    const project = await importCase(request, c);
    const base = `${root}/projects/${project.id}`;
    await openWorkspace(page, project);
    const run = await ask(page, c.prompt);
    expectBoundProposal(run, c, project);
    await inspectApprovalScreen(page, c, project);
    expect(await collection(request, project, "compute/jobs")).toHaveLength(0);
    const decision = page.waitForResponse((response) => response.url().includes("/approvals/") && response.url().endsWith("/decision"));
    await page.getByTestId("ai-approve-button").click();
    const response = await decision;
    expect(response.status()).toBe(200);
    const submitted = await response.json();
    expect(submitted.status).toBe("WAITING_FOR_CALCULATION");
    const calculationId = submitted.waiting_calculation_id as string;
    const resultPanel = page.getByTestId("ai-calculation-result");
    await expect(resultPanel.getByTestId("energy-readout-value")).toHaveText(/^-\d+\.\d+$/, { timeout: 150_000 });
    await expect(page.getByTestId("ai-scientific-workflow")).toContainText("Completed · SUCCEEDED", { timeout: 30_000 });
    const detail = await (await request.get(`${base}/calculations/${calculationId}`)).json();
    // Every field below is persisted engine output or execution record, never a planning value.
    expect(detail.calculation.state).toBe("SUCCEEDED");
    expect(detail.compute_job.state).toBe("SUCCEEDED");
    expect(detail.compute_execution.state).toBe("FINISHED");
    const energy = detail.result.payload.total_energy;
    expect(energy.unit.code).toBe("Eh");
    expect(Number.isFinite(energy.value) && energy.value < 0).toBe(true);
    expect(detail.result.payload.converged).toBe(true);
    expect(detail.result.producer_software.name).toBe("pyscf");
    expect(detail.result.producer_software.version).toBe(fixture.engineVersion);
    // What the engine was actually given is what the researcher approved.
    expect(detail.specification).toMatchObject({ task_type: c.expect.task, charge: c.expect.charge, multiplicity: c.expect.multiplicity });
    expect(detail.specification.method.identifier).toBe(c.expect.method);
    expect(detail.specification.basis.identifier).toBe(c.expect.basis);
    expect(detail.specification.engine_preference.engine).toBe(c.expect.engine);
    expect(detail.result.payload.method).toBe(c.expect.method);
    expect(detail.result.payload.basis).toBe(c.expect.basis);
    expect(detail.result.payload.scf_iterations).toBeGreaterThan(0);
    expect(detail.calculation_input_hash).toMatch(/^[0-9a-f]{64}$/);
    // Result Firewall: engine-produced, validated, attested, lineage active, never approximated by the AI.
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
      // Keep the native bytes next to the report so the log can be read and cross-checked later.
      writeFileSync(resolve(shots, `${c.id}-native-${artifact.artifact_id}.txt`), body);
      artifacts.push({ id: artifact.artifact_id, kind: artifact.kind, bytes: body.length, sha256: digest });
    }
    expect(artifacts.length, "the engine retained its native output").toBeGreaterThan(0);
    // A reference is recorded, never required: it applies only when geometry and settings agree.
    const comparison = c.referenceEnergy === null ? { verdict: "NO_REFERENCE" } : { verdict: "RECORDED", reference: c.referenceEnergy, difference: energy.value - c.referenceEnergy, tolerance: c.referenceTolerance };
    if (c.referenceEnergy !== null) expect.soft(energy.value).toBeCloseTo(c.referenceEnergy, 10);
    writeFileSync(resolve(shots, `${c.id}-acceptance.json`), JSON.stringify({ case: c.id, planningProvider: "fake (planning only)", quantumComputation: "REAL PYSCF", workspace: process.env.CHEMDFT_TEST_WORKSPACE, project, run, detail, artifacts, comparison }, null, 2));
    await page.getByTestId("ai-scientist-panel").screenshot({ path: resolve(shots, `${c.id}-result.png`) });
  });
}
