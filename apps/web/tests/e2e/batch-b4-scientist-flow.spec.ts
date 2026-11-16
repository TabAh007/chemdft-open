import { expect, test, type APIRequestContext, type Page } from "./offline-test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { choosePlanMode } from "./ai-composer";
import { repositoryPath } from "./offline-test";

// Saved synthetic recognition; no model inference and no quantum worker. Real HTTP/RDKit/Ketcher.
const shots = resolve(process.env.CHEMDFT_TEST_WORKSPACE!, "output/playwright/b4");
const root = "/api/chemdft/v1";
test.setTimeout(180_000);
test.use({ viewport: { width: 1600, height: 1000 }, actionTimeout: 25_000 });
test.beforeAll(() => mkdirSync(shots, { recursive: true }));
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: resolve(shots, `failure-${info.testId.replace(/[^a-z0-9]/gi, "_")}.png`), fullPage: true });
});
async function setup(request: APIRequestContext) {
  const created = await request.post(`${root}/projects`, { data: { name: "B4 isolated synthetic saved proposal", slug: `b4-${crypto.randomUUID()}` } });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).id as string;
  const fixture = JSON.parse(execFileSync(repositoryPath(".venv/bin/python"), [repositoryPath("tools/create_b4_e2e_fixture.py")], { input: JSON.stringify({ project_id: projectId, smiles: "CCO" }), encoding: "utf8", env: process.env }));
  expect((await request.put(`${root}/ai/settings`, { data: { mode: "MANAGED", provider: "fake", model: "fake-standard" } })).ok()).toBe(true);
  return { projectId, ...fixture } as { projectId: string; document_id: string; candidate_id: string; original_id: string };
}
async function showPanel(page: Page) {
  const show = page.getByRole("button", { name: "Show AI Scientist panel", exact: true });
  if (await show.isVisible()) await show.click();
  await expect(page.getByTestId("ai-scientist-panel")).toBeVisible();
}
async function latest(request: APIRequestContext, projectId: string) {
  const conversations = await (await request.get(`${root}/projects/${projectId}/ai/conversations`)).json();
  return (await (await request.get(`${root}/projects/${projectId}/ai/conversations/${conversations.conversations[0].id}`)).json()).latest_run;
}

for (const choice of ["APPROVE", "REJECT"] as const) {
test(`B4 ${choice}: persisted gate, premature resume refusal, exact Ketcher correction and promotion, calculation decision`, async ({ page, request }) => {
  const caseShots = resolve(shots, choice.toLowerCase());
  mkdirSync(caseShots, { recursive: true });
  const fixture = await setup(request);
  const base = `${root}/projects/${fixture.projectId}`;
  await page.goto(`/en/projects/${fixture.projectId}/workspace`);
  await showPanel(page);
  await expect(page.getByTestId("ai-prompt-input")).toBeEnabled({ timeout: 40_000 });
  await page.getByTestId("ai-prompt-input").fill(`Extract figures from document ${fixture.document_id} using the saved proposal; request researcher review.`);
  await choosePlanMode(page, { general: true });
  await page.getByTestId("ai-prepare-calculation-button").click();
  // The shipped fake provider handles extraction as a separate turn. Its general evidence
  // response ends that run; start candidate recognition explicitly without changing the backend.
  await expect(page.getByTestId("ai-scientific-workflow")).toContainText("Completed", { timeout: 30_000 });
  const extractionRun = await latest(request, fixture.projectId);
  const extractionEvents = (await (await request.get(`${base}/ai/runs/${extractionRun.id}/events`)).json()).events;
  expect(extractionEvents.some((event: { event_type: string }) => event.event_type === "document.figures_extracted")).toBe(true);
  await page.getByTestId("ai-prompt-input").fill(`Extract candidate ${fixture.candidate_id} from document ${fixture.document_id}.`);
  await choosePlanMode(page, { general: true });
  await page.getByTestId("ai-prepare-calculation-button").click();
  const gate = page.getByTestId("ai-researcher-gate");
  await expect(gate).toBeVisible({ timeout: 50_000 });
  await expect(gate).toContainText(fixture.candidate_id);
  await expect(gate).toContainText(fixture.original_id);
  await expect(gate).toContainText("UNVERIFIED MOLECULAR PROPOSAL");
  await expect(gate.getByTestId("candidate-figure-recognition-panel")).toBeVisible();
  await expect(gate.getByTestId("original-figure-image")).toBeVisible();
  expect(await gate.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const run = await latest(request, fixture.projectId);
  expect(run.status).toBe("PAUSED");
  expect(run.pending_researcher_gate.expected_representation_id).toBe(fixture.original_id);
  const events = (await (await request.get(`${base}/ai/runs/${run.id}/events`)).json()).events;
  for (const kind of ["candidate.diagram_recognized", "candidate.graph_validated", "researcher_gate.requested"]) expect(events.some((event: { event_type: string }) => event.event_type === kind)).toBe(true);
  expect(events.map((event: { sequence: number }) => event.sequence)).toEqual(events.map((_: unknown, index: number) => index + 1));
  await gate.getByText("UNVERIFIED MOLECULAR PROPOSAL", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(caseShots, "01-unverified-researcher-gate.png"), fullPage: true });
  await gate.getByTestId("original-figure-image").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(caseShots, "01b-source-figure-and-saved-proposal.png"), fullPage: true });

  // Real HTTP conflict through the rendered Resume control; no automatic retry or clearance.
  const refused = page.waitForResponse(response => response.url().endsWith(`/ai/runs/${run.id}/resume`));
  await gate.getByRole("button", { name: "Resume after researcher promotion", exact: true }).click();
  expect((await refused).status()).toBe(409);
  await expect(page.getByTestId("ai-submit-error")).toContainText("RESEARCHER_GATE_PENDING");
  await expect(gate).toContainText(fixture.original_id);
  await page.reload();
  await showPanel(page);
  await expect(gate).toContainText(fixture.original_id, { timeout: 30_000 });
  await expect(page.getByTestId("ai-scientific-workflow").getByRole("status").first()).toHaveAttribute("aria-live", "polite");
  await expect(page.getByTestId("ai-run-timeline").locator("li")).toHaveCount(events.length);
  await page.route(`**/ai/runs/${run.id}/events?*`, route => route.abort());
  await expect(page.getByRole("button", { name: "Reconnect timeline", exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("ai-run-timeline").locator("li")).toHaveCount(events.length);
  await page.unroute(`**/ai/runs/${run.id}/events?*`);
  await page.getByRole("button", { name: "Reconnect timeline", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reconnect timeline", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("ai-run-timeline").locator("li")).toHaveCount(events.length);

  // A different saved preference must not override the backend's requested representation.
  await page.evaluate(({ projectId, candidateId }) => localStorage.setItem(`chemdft:b3-revision:${projectId}:${candidateId}`, "not-the-requested-representation"), { projectId: fixture.projectId, candidateId: fixture.candidate_id });
  await gate.getByRole("button", { name: "Inspect & Correct in Ketcher", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`selection=candidateRepresentation%3A${fixture.original_id}.*source=${fixture.candidate_id}`));
  const workbench = page.getByTestId("b3-workbench");
  await expect(workbench).toBeVisible({ timeout: 40_000 });
  await expect(workbench.getByLabel("Saved representation revision")).toHaveValue(fixture.original_id);
  await workbench.getByRole("button", { name: "Correct graph in Ketcher", exact: true }).click();
  await expect(workbench.getByRole("button", { name: "Validate edited graph", exact: true })).toBeEnabled({ timeout: 45_000 });
  await expect(gate.getByRole("button", { name: "Inspect & Correct in Ketcher", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "N", exact: true }).click();
  await page.locator(".ketcher-frame svg text").filter({ hasText: /^O$/ }).first().click({ force: true });
  await workbench.getByRole("button", { name: "Validate edited graph", exact: true }).click();
  await expect(workbench.getByTestId("b3-validation")).toContainText("C2H7N");
  await page.screenshot({ path: resolve(caseShots, "02-real-ketcher-correction.png"), fullPage: true });
  const saving = page.waitForResponse(response => response.url().endsWith(`${fixture.candidate_id}/representations`) && response.request().method() === "POST");
  await workbench.getByRole("button", { name: "Save corrected representation", exact: true }).click();
  const saved = await saving;
  expect(saved.status()).toBe(201);
  const corrected = (await saved.json()).representation;
  expect(corrected.mol_block).toMatch(/\bN\s+0/);
  await expect(workbench.getByLabel("Saved representation revision")).toHaveValue(corrected.id);
  const generation = page.waitForResponse(response => response.url().endsWith("/generate-conformer"));
  await workbench.getByRole("button", { name: "Generate 3D conformer explicitly", exact: true }).click();
  const generated = await generation;
  expect(generated.status()).toBe(201);
  const conformer = (await generated.json()).representation;
  expect(conformer.source_representation_id).toBe(corrected.id);
  expect(conformer.coordinate_representation.coordinates.atoms.some((atom: { element: string }) => atom.element === "N")).toBe(true);
  expect(conformer.coordinate_representation.coordinates.atoms.some((atom: { element: string }) => atom.element === "O")).toBe(false);
  await expect(workbench.getByRole("checkbox")).toHaveCount(9);
  for (const box of await workbench.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
  await expect(workbench.getByRole("button", { name: "Promote reviewed structure", exact: true })).toBeDisabled();
  expect((await request.post(`${base}/structure-candidates/${fixture.candidate_id}/promote`, { data: { representation_id: conformer.id } })).status()).toBe(409);
  await workbench.getByRole("button", { name: "Record source candidate review", exact: true }).click();
  for (const box of await workbench.getByRole("checkbox").all()) await box.check();
  await workbench.getByRole("button", { name: "Record conformer review", exact: true }).click();
  const promoting = page.waitForResponse(response => response.url().endsWith(`/${fixture.candidate_id}/promote`));
  await workbench.getByRole("button", { name: "Promote reviewed structure", exact: true }).click();
  const promoted = await promoting;
  expect(promoted.status()).toBe(201);
  const authoritative = (await promoted.json()).version;
  await expect(workbench).toContainText("PROMOTED STRUCTURE");
  await expect(gate).toBeVisible(); // promotion must not resume automatically
  expect((await latest(request, fixture.projectId)).status).toBe("PAUSED");

  const resumed = page.waitForResponse(response => response.url().endsWith(`/ai/runs/${run.id}/resume`));
  await gate.getByRole("button", { name: "Resume after researcher promotion", exact: true }).click();
  expect((await resumed).status()).toBe(200);
  const plan = page.getByTestId("ai-calculation-proposal");
  const approval = page.getByTestId("ai-approval-card");
  await expect(approval).toBeVisible();
  await expect(plan).toBeVisible();
  await expect(gate).toHaveCount(0);
  await expect(plan).toContainText(authoritative.id);
  await expect(plan).toContainText("C2H7N");
  await expect(approval).toContainText("Estimate unavailable");
  const proposed = await latest(request, fixture.projectId);
  expect(proposed.status).toBe("WAITING_FOR_APPROVAL");
  expect(proposed.pending_approval.status).toBe("PENDING");
  expect(proposed.waiting_calculation_id).toBeNull();
  const cleared = (await (await request.get(`${base}/ai/runs/${run.id}/events`)).json()).events;
  expect(cleared.filter((event: { event_type: string }) => event.event_type === "researcher_gate.cleared")).toHaveLength(1);
  await page.reload(); await showPanel(page);
  await expect(plan).toContainText(authoritative.id, { timeout: 30_000 });
  await expect(page.getByTestId("ai-approve-button")).toBeEnabled();
  await expect(plan).toContainText("C2H7N");
  await expect(plan).not.toContainText("Checking engine availability…");
  await expect(page.getByText("Loading selected project item…", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Initializing project-scoped AI Scientist…", { exact: true })).toHaveCount(0);
  await approval.getByRole("heading", { name: "Scientific parameters" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(caseShots, "03-persisted-calculation-approval.png"), fullPage: true });
  // The panel's scroll region is small: capture the whole proposal card and its exact text.
  await expect(plan).toContainText(/generated conformer.*not.*optimized/i);
  await expect(plan).toContainText("does not establish the physical spin state");
  await expect(plan.getByText("Engine availability (reported)", { exact: true })).toBeVisible();
  await approval.screenshot({ path: resolve(caseShots, "03b-calculation-proposal-card.png") });
  writeFileSync(resolve(caseShots, "03b-calculation-proposal-card.txt"), await approval.innerText());
  await page.addScriptTag({ path: resolve("node_modules/axe-core/axe.min.js") });
  const accessibility = await page.evaluate(async () => (window as unknown as { axe: { run: (context: string, options: object) => Promise<{ violations: { impact: string; id: string }[] }> } }).axe.run('[data-testid="ai-scientist-panel"]', { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }));
  writeFileSync(resolve(caseShots, "accessibility.json"), JSON.stringify(accessibility, null, 2));
  expect(accessibility.violations.filter(item => ["serious", "critical"].includes(item.impact))).toEqual([]);
  const deciding = page.waitForResponse(response => response.url().endsWith(`/approvals/${proposed.pending_approval.id}/decision`));
  await page.getByTestId(choice === "APPROVE" ? "ai-approve-button" : "ai-reject-button").click();
  const decision = await deciding;
  expect(decision.status()).toBe(200);
  expect(decision.request().postDataJSON().decision).toBe(choice);
  const queued = await decision.json();
  if (choice === "APPROVE") {
    expect(queued.status).toBe("WAITING_FOR_CALCULATION");
    await expect(page.getByTestId("ai-scientific-workflow")).toContainText("Calculation queued");
    await expect(page.getByTestId("ai-calculation-status")).toContainText("No persisted engine result; no scientific values are inferred");
  } else {
    expect(queued.status).toBe("SUCCEEDED");
    expect(queued.waiting_calculation_id).toBeNull();
    await expect(plan).toHaveCount(0);
    await page.reload(); await showPanel(page);
    await expect(page.getByTestId("ai-scientist-panel")).toContainText("The proposed calculation was rejected.");
    await expect(page.getByTestId("ai-calculation-status")).toHaveCount(0);
  }
  await page.screenshot({ path: resolve(caseShots, "04-calculation-decision-no-quantum-results.png"), fullPage: true });
  writeFileSync(resolve(caseShots, "acceptance.json"), JSON.stringify({ fixture: "SYNTHETIC SAVED DECIMER; NO INFERENCE", quantumComputation: false, runId: run.id, requestedRepresentation: fixture.original_id, promotedVersion: authoritative.id, resultingRunStatus: queued.status, events: cleared.map((event: { event_type: string }) => event.event_type) }, null, 2));
});

}
