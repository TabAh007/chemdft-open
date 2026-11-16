// Batch A browser acceptance. Runs ONLY through tools/run_isolated_e2e.py (disposable stack).
// The model is the deterministic FAKE gateway: this verifies the workflow, durability and the
// viewers, not real-provider intelligence.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "./offline-test";
import { choosePlanMode } from "./ai-composer";
import { repositoryPath } from "./offline-test";

const root = "/api/chemdft/v1";
const shots = resolve(process.env.CHEMDFT_TEST_WORKSPACE!, "output/as-a-browser-review");
const PROMPT =
  "Create methane, ethane, benzene, ethanol and acetone. Generate their 3D structures and display them in my workspace.";
const FIVE: Record<string, string> = { methane: "CH4", ethane: "C2H6", benzene: "C6H6", ethanol: "C2H6O", acetone: "C3H6O" };
const dbPath = () => process.env.CHEMDFT_DATABASE_URL!.replace("sqlite:///", "");

// Include cold compilation and five real local 2D/3D viewers in the test budget.
test.setTimeout(180_000);
test.beforeAll(() => mkdirSync(shots, { recursive: true }));

async function newProject(request: APIRequestContext, name: string) {
  const created = await request.post(`${root}/projects`, { data: { name, slug: `as-a-${crypto.randomUUID().slice(0, 8)}` } });
  expect(created.status()).toBe(201);
  return (await created.json()).id as string;
}
async function fakeProvider(request: APIRequestContext) {
  const result = await request.put(`${root}/ai/settings`, { data: { mode: "MANAGED", provider: "fake", model: "fake-standard" } });
  expect(result.ok(), await result.text()).toBe(true);
}
async function openPanel(page: Page, id: string) {
  await page.goto(`/en/projects/${id}/workspace`);
  if (await page.getByTestId("mode-toggle-guided").isVisible()) await page.getByTestId("mode-toggle-guided").click();
  const show = page.getByRole("button", { name: /Show AI Scientist/ });
  if (await show.count()) await show.click();
  await expect(page.getByTestId("ai-scientist-panel")).toBeVisible();
  await expect(page.getByTestId("ai-provider-state")).toBeVisible();
}
const visible = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:visible`);
function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
    if (message.type() === "warning" && /Too many active WebGL contexts/i.test(message.text())) problems.push(message.text());
  });
  return problems;
}
async function send(page: Page, text: string) {
  await page.getByTestId("ai-prompt-input").fill(text);
  await choosePlanMode(page, { general: true });
  await page.getByTestId("ai-prepare-calculation-button").click();
}
async function latestRun(request: APIRequestContext, projectId: string) {
  const list = await (await request.get(`${root}/projects/${projectId}/ai/conversations`)).json();
  const conversation = list.conversations[0];
  const detail = await (await request.get(`${root}/projects/${projectId}/ai/conversations/${conversation.id}`)).json();
  return detail.latest_run as { id: string; status: string };
}
async function events(request: APIRequestContext, projectId: string, runId: string) {
  const response = await request.get(`${root}/projects/${projectId}/ai/runs/${runId}/events`);
  expect(response.status()).toBe(200);
  return (await response.json()).events as Array<{ project_id: string; run_id: string; sequence: number; event_type: string; summary: string; payload: Record<string, unknown> }>;
}
async function drafts(request: APIRequestContext, projectId: string) {
  const response = await request.get(`${root}/projects/${projectId}/geometry-candidates`);
  expect(response.status()).toBe(200);
  return (await response.json()).candidates as Array<{ id: string; state: string; manifest: { formula: string; geometry_class: string; canonical_smiles: string; coordinate_representation: { name: string } } }>;
}
/** A real 3D render: the WebGL canvas exists and its screenshot is not a uniform fill. */
async function expectRenderedViewer(page: Page, name: string) {
  const viewer = visible(page, "geometry-candidate-workspace");
  await expect(viewer).toBeVisible();
  const canvas = viewer.locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => {
    const png = await canvas.screenshot();
    const sample = new Set<number>();
    for (let i = 100; i < png.length; i += Math.max(1, Math.floor(png.length / 400))) sample.add(png[i]!);
    return sample.size;
  }, { timeout: 30000 }).toBeGreaterThan(30);
  await viewer.screenshot({ path: resolve(shots, name) });
}

test("five-molecule request end to end: panel, drafts, activity, Follow AI, 2D/3D viewers, refresh recovery", async ({ page, request }) => {
  await fakeProvider(request);
  const id = await newProject(request, "AS-A five molecules");
  const problems = watchConsole(page);
  await openPanel(page, id);
  await page.screenshot({ path: resolve(shots, "01-panel-open.png") });

  // 1-4. Submit the complete request through the real panel.
  await send(page, PROMPT);
  await expect(page.getByTestId("ai-message-assistant").last()).toContainText("molecular drafts", { timeout: 60000 });
  const run = await latestRun(request, id);
  expect(run.status).toBe("SUCCEEDED");

  // 5-6. Five independent, correctly identified drafts persisted by the backend.
  const list = await drafts(request, id);
  expect(list).toHaveLength(5);
  expect(new Set(list.map((d) => d.id)).size).toBe(5);
  expect(Object.fromEntries(list.map((d) => [d.manifest.coordinate_representation.name, d.manifest.formula]))).toEqual(FIVE);
  for (const draft of list) {
    expect(draft.state).toBe("PENDING_ACCEPTANCE");
    expect(draft.manifest.geometry_class).toBe("GENERATED_CONFORMER_NOT_OPTIMIZED");
  }

  // 7. Activity events match committed backend actions, gap-free.
  const log = await events(request, id, run.id);
  expect(log.map((e) => e.sequence)).toEqual(log.map((_, index) => index + 1));
  const kinds = log.map((e) => e.event_type);
  expect(kinds.filter((k) => k === "run.started")).toHaveLength(1);
  expect(kinds.filter((k) => k === "identity.resolved")).toHaveLength(5);
  expect(kinds.filter((k) => k === "object.created")).toHaveLength(5);
  expect(kinds.filter((k) => k === "run.completed")).toHaveLength(1);
  // molecule.resolve emits its identity observation and the generic successful-tool event.
  // Check committed effects and provenance instead of freezing a total event count.
  const resolvedTools = log.filter(e => e.event_type === "tool.executed" && e.payload.tool_name === "molecule.resolve");
  expect(resolvedTools).toHaveLength(5);
  expect(new Set(log.map(e => e.sequence)).size).toBe(log.length);
  expect(log.every(e => e.project_id === id && e.run_id === run.id)).toBe(true);
  expect(kinds[0]).toBe("run.started");
  expect(kinds.at(-1)).toBe("run.completed");
  expect(kinds).not.toContain("object.reused");
  for (const created of log.filter(e => e.event_type === "object.created")) {
    const identity = log.find(e => e.event_type === "identity.resolved" && e.payload.name === created.payload.name);
    expect(identity).toBeDefined();
    expect(identity!.sequence).toBeLessThan(created.sequence);
    expect(created.payload.formula).toBe(FIVE[String(created.payload.name)]);
  }
  expect((await (await request.get(`${root}/projects/${id}/compute/jobs`)).json()).jobs).toHaveLength(0);
  const createdIds = new Set(log.filter((e) => e.event_type === "object.created").map((e) => String(e.payload.candidate_id)));
  expect(createdIds).toEqual(new Set(list.map((d) => d.id)));
  await expect(page.getByTestId("ai-run-timeline")).toContainText("Created molecular draft for acetone");
  await page.screenshot({ path: resolve(shots, "02-after-run-follow-ai.png") });

  // 8-9. Follow AI opened the last created molecule in the real workspace viewers.
  const acetone = list.find((d) => d.manifest.formula === "C3H6O")!;
  const viewer = visible(page, "geometry-candidate-workspace");
  await expect(viewer).toHaveAttribute("data-candidate-id", acetone.id, { timeout: 30000 });
  await expect(visible(page, "geometry-candidate-meta")).toContainText("acetone");
  await expect(visible(page, "geometry-candidate-class")).toContainText("GENERATED_CONFORMER_NOT_OPTIMIZED");
  await expect(visible(page, "geometry-candidate-class")).not.toContainText("OPTIMIZED_GEOMETRY");
  // 2D depiction: acetone = 4 heavy atoms, 3 bonds (one double) -> 4 lines, 1 oxygen label.
  await expect(visible(page, "geometry-candidate-2d")).toBeVisible();
  const depiction = visible(page, "geometry-candidate-2d");
  // (":visible" is false for zero-width SVG lines such as a vertical C=O, so count inside the svg.)
  await expect(depiction.locator('[data-testid="geometry-candidate-2d-bond"]')).toHaveCount(4);
  await expect(depiction.locator('[data-testid="geometry-candidate-2d-atom"]')).toHaveCount(1);
  await expect(depiction.locator('[data-testid="geometry-candidate-2d-atom"]')).toHaveAttribute("data-element", "O");
  await expectRenderedViewer(page, "03-acetone-2d-3d-viewer.png");

  // Every one of the five opens from the project tree with its own 2D/3D content.
  await page.getByTestId("mode-toggle-advanced").click();
  const expectedBonds: Record<string, number> = { methane: 0, ethane: 1, benzene: 9, ethanol: 2, acetone: 4 };
  for (const [name, formula] of Object.entries(FIVE)) {
    const draft = list.find((d) => d.manifest.formula === formula)!;
    await page.getByText(new RegExp(`${name} · ${formula} · 3D draft`)).first().click();
    await expect(visible(page, "geometry-candidate-workspace")).toHaveAttribute("data-candidate-id", draft.id, { timeout: 30000 });
    await expect(visible(page, "geometry-candidate-meta")).toContainText(formula);
    await expect(visible(page, "geometry-candidate-smiles")).toHaveText(draft.manifest.canonical_smiles);
    if (expectedBonds[name]) await expect(visible(page, "geometry-candidate-2d").locator('[data-testid="geometry-candidate-2d-bond"]')).toHaveCount(expectedBonds[name]!);
    await expectRenderedViewer(page, `04-${name}-viewer.png`);
  }

  // 12. Refresh: the persisted run, events and drafts are all recovered; the tree lists all five.
  await page.reload();
  await expect(page.getByTestId("ai-scientist-panel")).toBeVisible();
  for (const [name, formula] of Object.entries(FIVE)) {
    await expect(page.getByText(new RegExp(`${name} · ${formula} · 3D draft`)).first()).toBeVisible({ timeout: 30000 });
  }
  await expect(page.getByTestId("ai-scientist-panel")).toBeVisible();
  await expect(page.getByText("Created molecular draft for ethanol").first()).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: resolve(shots, "05-after-refresh.png") });
  expect(await drafts(request, id)).toHaveLength(5);

  // 14. No runtime errors.
  expect(problems.filter((p) => !/favicon|404.*(font|icon)/i.test(p))).toEqual([]);
});

test("Stay Here never navigates; Follow AI resumes on demand; clarification continues the conversation", async ({ page, request }) => {
  await fakeProvider(request);
  const id = await newProject(request, "AS-A follow and clarify");
  const problems = watchConsole(page);
  await openPanel(page, id);
  await send(page, "Create methane and show its 3D structure.");
  await expect(visible(page, "geometry-candidate-workspace")).toBeVisible({ timeout: 60000 });
  const methane = (await drafts(request, id))[0]!;
  await expect(visible(page, "geometry-candidate-workspace")).toHaveAttribute("data-candidate-id", methane.id);

  // 10. Stay Here: a new molecule is created but the researcher's view does not move.
  await page.getByTestId("ai-status-details-toggle").click();
  await page.getByRole("button", { name: "Stay here" }).click();
  await send(page, "Create ethanol and show it.");
  await expect(page.getByTestId("ai-run-timeline")).toContainText("Created molecular draft for ethanol", { timeout: 60000 });
  expect((await drafts(request, id))).toHaveLength(2);
  await expect(visible(page, "geometry-candidate-workspace")).toHaveAttribute("data-candidate-id", methane.id);
  await page.screenshot({ path: resolve(shots, "06-stay-here.png") });
  // ...and switching back to Follow AI opens the newest molecule.
  // Details (opened above) still shows the Follow AI / Stay here choice.
  await page.getByRole("button", { name: "Follow AI", exact: true }).click();
  const ethanol = (await drafts(request, id)).find((d) => d.manifest.formula === "C2H6O")!;
  await expect(visible(page, "geometry-candidate-workspace")).toHaveAttribute("data-candidate-id", ethanol.id, { timeout: 30000 });

  // 11. Ambiguity: the AI asks instead of guessing, creates nothing, then continues on the answer.
  const before = (await drafts(request, id)).length;
  await send(page, "Create xylene.");
  await expect(page.getByTestId("ai-clarification-card")).toBeVisible({ timeout: 60000 });
  expect((await drafts(request, id)).length).toBe(before);
  await page.screenshot({ path: resolve(shots, "07-clarification.png") });
  await page.getByRole("button", { name: "p-xylene" }).click();
  await expect(page.getByTestId("ai-run-timeline")).toContainText("Created molecular draft for p-xylene", { timeout: 60000 });
  const after = await drafts(request, id);
  expect(after).toHaveLength(before + 1);
  expect(after.some((d) => d.manifest.formula === "C8H10")).toBe(true);
  expect(problems.filter((p) => !/favicon|404.*(font|icon)/i.test(p))).toEqual([]);
});

test("Pause, Resume and Stop on controlled disposable runs; stopped work is never revived", async ({ page, request }) => {
  await fakeProvider(request);
  const id = await newProject(request, "AS-A controls");
  const conversation = await (await request.post(`${root}/projects/${id}/ai/conversations`, { data: { title: "controls" } })).json();
  const conversationId = conversation.conversation.id as string;
  const seed = (status: string, prompt: string) => execFileSync(repositoryPath(".venv/bin/python"), ["-c", `
import sqlite3, sys, uuid
db = sqlite3.connect(sys.argv[1]); c = db.cursor()
user = c.execute("select created_by from ai_conversations where id=?", (sys.argv[3],)).fetchone()[0]
c.execute("insert into ai_messages (id, project_id, conversation_id, role, content, citations_json, evidence_refs_json, created_at) values (?,?,?,?,?,?,?,datetime('now'))",
          (str(uuid.uuid4()), sys.argv[2], sys.argv[3], "user", sys.argv[5], "[]", "[]"))
run = str(uuid.uuid4())
c.execute("insert into ai_runs (id, project_id, conversation_id, actor_id, status, current_step, max_steps, fencing_epoch, state_version, last_event_sequence, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))",
          (run, sys.argv[2], sys.argv[3], user, sys.argv[4], 0, 10, 1, 0, 0))
db.commit(); print(run)
`, dbPath(), id, conversationId, status, prompt]).toString().trim();
  const problems = watchConsole(page);

  // A run that is still executing: Pause -> banner, Resume -> completes and creates the molecule once.
  const runId = seed("PLANNING", "Create ethane and show it.");
  await openPanel(page, id);
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: resolve(shots, "08-running-controls.png") });
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByTestId("ai-paused-banner")).toBeVisible();
  expect((await latestRun(request, id)).status).toBe("PAUSED");
  expect(await drafts(request, id)).toHaveLength(0); // paused runs dispatch nothing
  await page.screenshot({ path: resolve(shots, "09-paused.png") });
  await page.getByTestId("ai-input-dock").getByRole("button", { name: "Resume" }).click();
  await expect(page.getByTestId("ai-message-assistant").last()).toContainText("molecular drafts", { timeout: 60000 });
  expect((await latestRun(request, id)).status).toBe("SUCCEEDED");
  expect(await drafts(request, id)).toHaveLength(1);
  const log = await events(request, id, runId);
  expect(log.map((e) => e.sequence)).toEqual(log.map((_, index) => index + 1));
  expect(log.filter((e) => e.event_type === "object.created")).toHaveLength(1);
  await page.screenshot({ path: resolve(shots, "10-resumed-completed.png") });

  // Stop: the run is terminal, creates nothing, and a repeated Stop / Resume cannot revive it.
  const stopped = seed("PLANNING", "Create benzene and show it.");
  await page.reload();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible({ timeout: 30000 });
  page.once("dialog", (dialog) => void dialog.accept()); // Stop asks for confirmation (UI-1 pass 4).
  await page.getByRole("button", { name: "Stop" }).click();
  await expect.poll(async () => (await latestRun(request, id)).status).toBe("CANCELED");
  expect(await drafts(request, id)).toHaveLength(1);
  const resume = await request.post(`${root}/projects/${id}/ai/runs/${stopped}/resume`);
  expect((await resume.json()).status).toBe("CANCELED");
  expect((await request.post(`${root}/projects/${id}/ai/runs/${stopped}/pause`)).status()).toBe(409);
  expect((await request.post(`${root}/projects/${id}/ai/runs/${stopped}/cancel`)).ok()).toBe(true); // idempotent
  expect(await drafts(request, id)).toHaveLength(1);
  await page.screenshot({ path: resolve(shots, "11-stopped.png") });
  expect(problems.filter((p) => !/favicon|404.*(font|icon)/i.test(p))).toEqual([]);
});
