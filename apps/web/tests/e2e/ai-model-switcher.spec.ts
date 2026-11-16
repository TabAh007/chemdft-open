import { expect, test, type Page } from "./offline-test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { choosePlanMode, openAiPanelTab } from "./ai-composer";

/**
 * AI-2 quick model switcher — LOCAL BACKEND INTEGRATION TEST.
 * Real Next.js + FastAPI + disposable SQLite through the offline isolated runner: fake provider
 * (two deterministic local fixture models), compute worker DISABLED, no external request. Timings
 * and counts in this scenario are synthetic fixture data and are not evidence about any real model.
 */
const root = "/api/chemdft/v1";
const projects = `${root}/projects`;
const shots = resolve(process.env.CHEMDFT_TEST_WORKSPACE ?? "/tmp", "output/ai-model-switcher");
const sizes = [
  { width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 },
] as const;

type Run = { id: string; ai_model: string | null; pending_approval?: { id: string; normalized_arguments: unknown } | null };

async function showPanel(page: Page) {
  await expect(async () => {
    const show = page.getByRole("button", { name: "Show AI Scientist panel", exact: true });
    if (await show.isVisible()) await show.click();
    await expect(page.getByTestId("ai-scientist-panel")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}
async function openAiTab(page: Page) {
  await expect(async () => {
    const advanced = page.getByTestId("mode-toggle-advanced");
    if ((await advanced.getAttribute("aria-pressed")) !== "true") await advanced.click();
    await expect(advanced).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 });
    const tab = page.getByTestId("ai-scientist-tab");
    await expect(tab).toBeVisible({ timeout: 2_000 });
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
    await expect(page.getByTestId("ai-scientist-panel")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 40_000 });
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
async function sendAsk(page: Page, text: string): Promise<Run> {
  await page.getByTestId("ai-prompt-input").fill(text);
  const posted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/messages"), { timeout: 90_000 });
  await page.getByTestId("ai-prepare-calculation-button").click();
  const response = await posted;
  expect(response.status()).toBe(201);
  const run = (await response.json()).latest_run as Run;
  await expect(page.getByTestId("ai-prompt-input")).toBeEnabled({ timeout: 90_000 });
  return run;
}
/** The opened switcher must be what the user sees at its own centre (not under the dock sheet). */
async function expectTopmost(page: Page) {
  const covered = await page.getByTestId("ai-model-switcher").evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, Math.min(box.top + 24, window.innerHeight - 1));
    return !hit || !element.contains(hit);
  });
  expect(covered, "switcher is covered by another layer").toBe(false);
}
async function openSwitcher(page: Page) {
  await page.getByTestId("ai-model-switch-trigger").click();
  const dialog = page.getByTestId("ai-model-switcher");
  await expect(dialog).toBeVisible();
  // Measure only the settled popover: same box on two consecutive reads.
  let previous = "";
  await expect(async () => {
    const box = JSON.stringify(await dialog.boundingBox());
    const stable = box === previous;
    previous = box;
    expect(stable).toBe(true);
  }).toPass({ timeout: 5_000 });
}

test("AI-2 quick model switcher: server-validated, synchronized, provenance-preserving (fake fixture, no compute)", async ({ page, request }) => {
  test.setTimeout(420_000);
  expect(process.env.CHEMDFT_AI_PROVIDER).toBe("fake");
  expect(process.env.CHEMDFT_E2E_WORKER_MODE).toBe("disabled");
  mkdirSync(shots, { recursive: true });
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  const created = await request.post(projects, { data: { name: "AI-2 model switching", slug: `ai2-${crypto.randomUUID()}` } });
  expect(created.status()).toBe(201);
  const project = (await created.json()).id as string;
  const imported = await (await request.post(`${projects}/${project}/structures/imports`, { multipart: {
    file_format: "XYZ", idempotency_key: crypto.randomUUID(),
    upload: { name: "h2.xyz", mimeType: "chemical/x-xyz", buffer: Buffer.from("2\nSupplied H2 reference | chemdft:charge=0;multiplicity=1\nH 0 0 -0.37\nH 0 0 0.37\n") },
  } })).json();
  const versionId = imported.version.id as string;
  const structureId = (imported.structure?.id ?? imported.version.structure_id) as string;
  const jobs = async () => (await (await request.get(`${projects}/${project}/compute/jobs`)).json()).jobs as Array<{ state: string }>;
  const preference = async () => (await (await request.get(`${root}/ai/settings`)).json()).preferences.model as string;
  const runModel = async (id: string) => (await (await request.get(`${projects}/${project}/ai/runs/${id}`)).json()).ai_model as string;
  const findings: Record<string, unknown> = { category: "LOCAL_BACKEND_INTEGRATION", provider: process.env.CHEMDFT_AI_PROVIDER, worker: process.env.CHEMDFT_E2E_WORKER_MODE };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/projects/${project}/workspace?selection=${encodeURIComponent(`structureVersion:${versionId}`)}&source=${structureId}`);
  await showPanel(page);
  await openAiTab(page);

  // ---- Current model, eligible models, ineligible states: all from the server's settings view.
  const trigger = page.getByTestId("ai-model-switch-trigger");
  await expect(trigger).toContainText("fake-standard", { timeout: 40_000 });
  await openSwitcher(page);
  await expect(page.getByTestId("ai-model-option-fake-standard")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("ai-model-option-fake-alternate")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("ai-model-option-fake-alternate")).toContainText("Selectable");
  await expect(page.getByTestId("ai-model-detail")).toContainText("All request types (offline fixture)");
  await expect(page.getByTestId("ai-model-detail")).toContainText("Not applicable: no hosted endpoint");
  await expect(page.getByTestId("ai-model-detail")).toContainText("No runs recorded for this model yet.");
  await page.screenshot({ path: resolve(shots, "01-switcher-open-1440.png") });
  // Registry models this server cannot offer are honest, disabled and explained; clicking one
  // sends nothing and changes nothing.
  const toggle = page.getByTestId("ai-model-unavailable-toggle");
  await expect(toggle).toContainText("cannot be selected");
  await expect(page.getByTestId("ai-model-option-nvidia/nemotron-3-super-120b-a12b")).toHaveCount(0);
  await toggle.click();
  const superRow = page.getByTestId("ai-model-option-nvidia/nemotron-3-super-120b-a12b");
  await expect(superRow).toHaveAttribute("aria-disabled", "true");
  await expect(superRow).toContainText("Not selectable");
  const unexpected: string[] = [];
  page.on("request", (req) => { if (req.method() === "PUT" && req.url().endsWith("/ai/settings")) unexpected.push(req.url()); });
  await superRow.click({ force: true }); // aria-disabled rows stay focusable so keyboard users can read why
  await expect(page.getByTestId("ai-model-detail")).toContainText("Tool calling is not verified");
  await expect(page.getByTestId("ai-model-detail")).toContainText("Request types");
  await page.getByTestId("ai-model-option-moonshotai/kimi-k3").click({ force: true });
  await expect(page.getByTestId("ai-model-detail")).toContainText("deprecated");
  expect(unexpected).toEqual([]);
  expect(await preference()).toBe("fake-standard");
  await page.screenshot({ path: resolve(shots, "01b-unavailable-expanded-1440.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ai-model-switcher")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // ---- A first request is bound to fake-standard.
  const first = await sendAsk(page, "Explain a qualitative concept.");
  expect(first.ai_model).toBe("fake-standard");

  // ---- Keyboard: open, move, choose. The choice is validated and saved by the server.
  await trigger.press("Enter");
  await expect(page.getByTestId("ai-model-switcher")).toBeVisible();
  await expect(page.getByTestId("ai-model-option-fake-standard")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("ai-model-option-fake-alternate")).toBeFocused();
  const saving = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith("/ai/settings"));
  await page.keyboard.press("Enter");
  expect((await saving).status()).toBe(200);
  await expect(trigger).toContainText("fake-alternate");
  await expect(page.getByTestId("ai-model-switch-status")).toContainText("New requests use fake-alternate.");
  expect(await preference()).toBe("fake-alternate");

  // ---- Settings tab agrees; saving there is reflected back in the quick switcher.
  await openAiPanelTab(page, "settings");
  await expect(page.getByTestId("ai-settings-current")).toContainText("fake-alternate");
  await expect(page.getByTestId("ai-model-select")).toHaveValue("fake::fake-alternate");
  await page.getByTestId("ai-model-select").selectOption("fake::fake-standard");
  await page.getByTestId("ai-settings-save").click();
  await expect(page.getByTestId("ai-settings-current")).toContainText("fake-standard");
  await page.getByTestId("ai-nav-chat").click();
  await expect(trigger).toContainText("fake-standard", { timeout: 20_000 });
  await openSwitcher(page);
  const choosing = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith("/ai/settings"));
  await page.getByTestId("ai-model-option-fake-alternate").click();
  expect((await choosing).status()).toBe(200);
  await expect(trigger).toContainText("fake-alternate");

  // ---- Persistence across reload; new requests use it; earlier runs keep their model.
  await page.reload();
  await openAiTab(page);
  await expect(trigger).toContainText("fake-alternate", { timeout: 40_000 });
  const second = await sendAsk(page, "Explain a qualitative concept.");
  expect(second.ai_model).toBe("fake-alternate");
  expect(await runModel(first.id)).toBe("fake-standard");

  // ---- The server, not the browser, decides: an invalid pair is refused and nothing changes.
  const refused = await request.put(`${root}/ai/settings`, { data: { mode: "MANAGED", provider: "fake", model: "invented-model" } });
  expect(refused.status()).toBe(422);
  expect(await preference()).toBe("fake-alternate");

  // ---- A proposal awaiting approval is not altered by a later model change.
  await choosePlanMode(page, { general: false });
  await page.getByTestId("ai-prompt-input").fill("Calculate the HF/STO-3G single-point energy for H2 with charge 0 and multiplicity 1.");
  const proposing = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/messages"), { timeout: 90_000 });
  await page.getByTestId("ai-prepare-calculation-button").click();
  const proposed = (await (await proposing).json()).latest_run as Run;
  await expect(page.getByTestId("ai-approval-card")).toBeVisible({ timeout: 90_000 });
  expect(proposed.ai_model).toBe("fake-alternate");
  const fingerprint = JSON.stringify(proposed.pending_approval?.normalized_arguments);
  expect((await request.put(`${root}/ai/settings`, { data: { mode: "MANAGED", provider: "fake", model: "fake-standard" } })).status()).toBe(200);
  const afterSwitch = await (await request.get(`${projects}/${project}/ai/runs/${proposed.id}`)).json() as Run & { status: string };
  expect(afterSwitch.status).toBe("WAITING_FOR_APPROVAL");
  expect(afterSwitch.ai_model).toBe("fake-alternate");
  expect(JSON.stringify(afterSwitch.pending_approval?.normalized_arguments)).toBe(fingerprint);
  expect(await jobs()).toHaveLength(0);
  await page.getByTestId("ai-reject-button").click();
  await expect(page.getByTestId("ai-approval-card")).toHaveCount(0, { timeout: 30_000 });
  expect(await jobs()).toHaveLength(0);

  // ---- Observed operational counts come from the user's own recorded model requests (the
  // proposal run), per model, and label fixture timings as synthetic.
  await openSwitcher(page);
  await page.getByTestId("ai-model-option-fake-alternate").focus();
  await expect(page.getByTestId("ai-model-observed")).toContainText("succeeded");
  await expect(page.getByTestId("ai-model-observed")).toContainText("Offline fixture timings are synthetic");
  await page.getByTestId("ai-model-option-fake-standard").focus();
  await expect(page.getByTestId("ai-model-detail")).toContainText("No runs recorded for this model yet.");
  await page.keyboard.press("Escape");

  // ---- Responsive and accessibility checks at the requested sizes.
  await page.addScriptTag({ path: resolve("node_modules/axe-core/axe.min.js") });
  const layout: Record<string, unknown> = {};
  for (const size of sizes) {
    await page.setViewportSize(size);
    await expect(trigger).toBeVisible();
    await openSwitcher(page);
    const box = (await page.getByTestId("ai-model-switcher").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    await expectTopmost(page);
    const viewerBox = await page.getByRole("group", { name: "Scientific View molecule viewport", exact: true }).boundingBox();
    const dockBox = await page.locator(".context-dock").boundingBox();
    expect(viewerBox && dockBox && viewerBox.x + viewerBox.width <= dockBox.x + 1).toBe(true);
    await page.screenshot({ path: resolve(shots, `02-switcher-${size.width}x${size.height}.png`) });
    const violations = await axeViolations(page, '[data-testid="ai-model-switcher"]');
    layout[`${size.width}x${size.height}`] = { popoverWidth: Math.round(box.width), popoverHeight: Math.round(box.height), pageOverflowPx: await pageOverflow(page), axe: violations };
    expect(violations).toEqual([]);
    expect(await pageOverflow(page)).toBe(0);
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const dockToggle = page.getByTestId("ai-dock-toggle");
  await expect(dockToggle).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 });
  await dockToggle.click();
  await expect(page.locator(".context-dock")).toBeVisible();
  await expect(trigger).toBeVisible();
  await openSwitcher(page);
  const phone = (await page.getByTestId("ai-model-switcher").boundingBox())!;
  expect(phone.x).toBeGreaterThanOrEqual(0);
  expect(phone.x + phone.width).toBeLessThanOrEqual(390);
  expect(phone.y).toBeGreaterThanOrEqual(0);
  expect(phone.y + phone.height).toBeLessThanOrEqual(844);
  await expectTopmost(page);
  const phoneViolations = await axeViolations(page, '[data-testid="ai-model-switcher"]');
  layout["390x844"] = { popoverWidth: Math.round(phone.width), pageOverflowPx: await pageOverflow(page), axe: phoneViolations };
  expect(phoneViolations).toEqual([]);
  expect(await pageOverflow(page)).toBe(0);
  await page.screenshot({ path: resolve(shots, "02-switcher-390x844.png") });
  await page.keyboard.press("Escape");

  expect(await jobs()).toHaveLength(0);
  expect(consoleErrors.filter((text) => !/favicon|Failed to load resource/.test(text))).toEqual([]);
  findings.layout = layout;
  writeFileSync(resolve(shots, "findings.json"), JSON.stringify(findings, null, 2));
});
