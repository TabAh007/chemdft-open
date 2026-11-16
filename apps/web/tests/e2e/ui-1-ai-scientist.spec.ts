import { expect, test, type Page, type Request } from "./offline-test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { openAiPanelTab } from "./ai-composer";
import { resolve } from "node:path";

/**
 * UI-1 AI Scientist — LOCAL BACKEND INTEGRATION TEST.
 * Real Next.js dev server + real FastAPI + disposable SQLite through the isolated runner, dev
 * identity issued by that runner, offline FAKE planning gateway (no NVIDIA call) and the compute
 * worker DISABLED (no scientific execution). The decisions scenario approves one queued job.
 * Sections marked MOCKED intercept one browser response to exercise an error state.
 */
const root = "/api/chemdft/v1/projects";
const shots = resolve(process.env.CHEMDFT_TEST_WORKSPACE ?? "/tmp", "ui-1-browser");
const findings: Record<string, unknown> = { category: "LOCAL_BACKEND_INTEGRATION", provider: process.env.CHEMDFT_AI_PROVIDER, worker: process.env.CHEMDFT_E2E_WORKER_MODE };
const TABS = ["chat", "tools", "evidence", "runs", "settings"] as const;
type AxeViolation = { id: string; impact: string; nodes: number; targets: string[] };

async function showPanel(page: Page) {
  // The dock preference persists per project; right after a reload the toggle can be clicked
  // before the workspace has attached its listeners, so retry until the panel is shown.
  await expect(async () => {
    const show = page.getByRole("button", { name: "Show AI Scientist panel", exact: true });
    if (await show.isVisible()) await show.click();
    await expect(page.getByTestId("ai-scientist-panel")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}
async function openAiTab(page: Page) {
  // A click before hydration can leave Guided mode selected. Check actual mode state before
  // selecting the Advanced dock tab; a loaded structure can also select the Inspector.
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
async function shot(page: Page, name: string, fullPage = false) {
  if (fullPage) await page.screenshot({ path: resolve(shots, `${name}.png`) });
  else await page.getByTestId("ai-scientist-panel").screenshot({ path: resolve(shots, `${name}.png`) });
}
async function panelOverflow(page: Page) {
  return page.getByTestId("ai-scientist-panel").evaluate((element) => element.scrollWidth - element.clientWidth);
}
async function pageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
async function axe(page: Page, selector: string): Promise<AxeViolation[]> {
  return page.evaluate(async (target) => {
    const result = await (window as unknown as { axe: { run: (context: string, options: object) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[]; failureSummary?: string }> }> }> } })
      .axe.run(target, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
    return result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length,
      targets: violation.nodes.slice(0, 5).map((node) => `${node.target.join(" ")} :: ${node.failureSummary ?? ""}`.slice(0, 300)) }));
  }, selector);
}
async function fill(page: Page, text: string) {
  await page.getByTestId("ai-prompt-input").fill(text);
}

test("UI-1 five-tab AI Scientist against the real local app (fake planning, no compute)", async ({ page, request }) => {
  test.setTimeout(360_000);
  expect(process.env.CHEMDFT_AI_PROVIDER).toBe("fake");
  expect(process.env.CHEMDFT_E2E_WORKER_MODE).toBe("disabled");
  mkdirSync(shots, { recursive: true });

  const created = await request.post(root, { data: { name: "UI-1 acceptance", slug: `ui1-${crypto.randomUUID()}` } });
  expect(created.status()).toBe(201);
  const project = (await created.json()).id as string;
  const imported = await request.post(`${root}/${project}/structures/imports`, { multipart: {
    file_format: "XYZ", idempotency_key: crypto.randomUUID(),
    upload: { name: "h2.xyz", mimeType: "chemical/x-xyz", buffer: Buffer.from("2\nSupplied H2 reference | chemdft:charge=0;multiplicity=1\nH 0 0 -0.37\nH 0 0 0.37\n") },
  } });
  expect(imported.status()).toBe(201);
  const importedBody = await imported.json();
  const versionId = importedBody.version.id as string;
  const structureId = (importedBody.structure?.id ?? importedBody.version.structure_id) as string;
  const empty = await request.post(root, { data: { name: "UI-1 empty", slug: `ui1-empty-${crypto.randomUUID()}` } });
  const emptyProject = (await empty.json()).id as string;

  const posted: Array<Record<string, unknown>> = [];
  page.on("request", (req: Request) => {
    if (req.method() === "POST" && /\/ai\/conversations\/[^/]+\/messages$/.test(req.url())) posted.push(req.postDataJSON());
  });
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  // ---- Empty project: one status bar, two modes, one send button; Ask sends cited-evidence GENERAL.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/en/projects/${emptyProject}/workspace`);
  await showPanel(page);
  const status = page.getByTestId("ai-model-provider-card");
  await expect(status).toContainText("fake-standard", { timeout: 40_000 });
  await page.getByTestId("ai-status-details-toggle").click();
  await expect(status).toContainText("Local test fixture");
  await page.getByTestId("ai-status-details-toggle").click();
  await expect(status).not.toContainText(/NVIDIA|MANAGED|USER_SUPPLIED/);
  // 0.0.58: one box, no Ask / Plan tab switch; Ask sends CHAT GENERAL. In empty project, no prepare calculation button.
  await expect(page.locator('[data-testid="ai-input-dock"] [role="radio"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="ai-ask-button"]')).toHaveCount(1);
  await expect(page.getByTestId("ai-prepare-calculation-button")).toHaveCount(0);
  await expect(page.getByTestId("ai-composer-mode-scope")).toContainText("Ask anything about this project");
  await shot(page, "06b-plan-prerequisite-empty");
  expect(posted).toHaveLength(0);
  await fill(page, "What is in this project?");
  await page.getByTestId("ai-ask-button").click();
  await expect.poll(() => posted.length, { timeout: 30_000 }).toBe(1);
  expect(posted[0]).toMatchObject({ planning_profile: "GENERAL", mode: "CHAT" });
  await expect(page.getByTestId("ai-prompt-input")).toBeEnabled({ timeout: 60_000 });

  // ---- H2 project overview in Advanced mode, nothing selected: the server resolves the project's
  // current version (Navigator facts) for planning.
  await page.goto(`/en/projects/${project}/workspace`);
  await page.getByTestId("mode-toggle-advanced").click();
  await openAiTab(page);
  await expect(status).toContainText("fake-standard", { timeout: 40_000 });
  await expect(page.getByTestId("ai-prepare-calculation-button")).toBeVisible();
  await expect(page.getByTestId("ai-scientist-panel")).toHaveAttribute("data-context-structure-version-id", versionId);
  findings.serverResolvedScope = await page.getByTestId("ai-composer-mode-scope").innerText();
  await shot(page, "06c-plan-server-resolved-version");
  expect(posted).toHaveLength(1);
  await page.getByTestId("mode-toggle-guided").click();

  // ---- H2 saved version selected by URL: Prepare calculation sends the scoped profile and the offline fake
  // gateway (which honours the two-tool profile) returns a proposal for the selected version.
  await page.goto(`/en/projects/${project}/workspace?selection=${encodeURIComponent(`structureVersion:${versionId}`)}&source=${structureId}`);
  await showPanel(page);
  await expect(status).toContainText("fake-standard", { timeout: 40_000 });
  await expect(page.getByTestId("ai-prepare-calculation-button")).toBeVisible();
  await fill(page, "Calculate the HF/STO-3G single-point energy for H2 with charge 0 and multiplicity 1.");
  await page.getByTestId("ai-prepare-calculation-button").click();
  await expect.poll(() => posted.length, { timeout: 30_000 }).toBe(2);
  expect(posted[1]).toMatchObject({ planning_profile: "PYSCF_ENERGY_PROPOSAL", mode: "STANDARD", selected_structure_version_id: versionId });

  // ---- Dedicated approval screen (1A).
  const screen = page.getByTestId("ai-approval-card");
  await expect(screen).toBeVisible({ timeout: 90_000 });
  await expect(screen).toHaveClass(/is-screen/);
  await expect(page.getByTestId("ai-input-dock")).toHaveCount(0);
  await expect(screen).toContainText("Approval Required");
  await expect(screen.getByTestId("ai-approval-geometry")).toContainText(versionId, { timeout: 40_000 });
  await expect(screen.getByTestId("ai-proposal-argument-check")).toContainText("Exact saved geometry resolved");
  await expect(screen.getByTestId("ai-proposal-decision-summary")).toContainText("PySCF · Hartree–Fock (HF) / STO-3G · Single-point energy · charge 0 · multiplicity 1 (singlet)");
  await expect(screen.getByTestId("ai-approval-countdown")).toContainText(/left/);
  for (const heading of ["Scientific parameters", "Molecular geometry and provenance", "Estimated resources", "Rationale and effect", "Approval record"]) {
    await expect(screen.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(screen.getByTestId("ai-approve-button")).toBeEnabled();
  await expect(screen.getByTestId("ai-approve-button")).toBeInViewport();
  await expect(screen.getByTestId("ai-reject-button")).toBeInViewport();
  await expect(screen).not.toContainText(/Low \(CPU\)|Input validation.*Passed|USER_SUPPLIED/);
  await expect(page.getByTestId("ai-chat-approval-badge")).toContainText("Approval waiting");
  await expect(page.getByTestId("ai-dock-toggle")).toHaveAttribute("aria-describedby", "ai-dock-toggle-pending");
  await shot(page, "13-approval-screen-docked");
  await screen.locator(".ai-approval-screen-body").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(screen.getByTestId("ai-approve-button")).toBeInViewport();
  await shot(page, "13b-approval-screen-docked-scrolled");
  expect((await (await request.get(`${root}/${project}/compute/jobs`)).json()).jobs).toHaveLength(0);

  // Defer, see the banner, reopen.
  await page.getByTestId("ai-approval-back").click();
  await expect(screen).toHaveCount(0);
  await expect(page.getByTestId("ai-approval-pending-banner")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review proposal" })).toBeFocused();
  await expect(page.getByTestId("ai-input-dock")).toBeVisible();
  await expect(page.getByTestId("ai-composer-paused")).toContainText("waits for your decision");
  await expect(page.getByTestId("ai-working-state")).toHaveCount(0);

  // While the proposal waits the composer is one row: the reason and "Stop run" (no Ask/Plan, no textarea).
  await expect(page.getByTestId("ai-prompt-input")).toHaveCount(0);
  await expect(page.getByTestId("ai-composer-mode-plan")).toHaveCount(0);
  for (const size of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await expect(page.getByTestId("ai-composer-paused")).toBeInViewport();
    await expect(page.getByRole("button", { name: "Stop run" })).toBeInViewport();
    await shot(page, `12-chat-docked-${size.width}x${size.height}`);
  }
  // Critique P0 regression: at docked 1366×768 the approval evidence is on screen, not a 16 px window.
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole("button", { name: "Review proposal" }).click();
  await expect(screen).toBeVisible();
  await expect(page.getByRole("heading", { name: /Approval Required/ })).toBeFocused();
  await expect(page.getByTestId("ai-model-provider-card")).toHaveCount(0);
  await expect(screen.getByRole("heading", { name: "Scientific parameters" })).toBeInViewport();
  await expect(screen.getByTestId("ai-approve-button")).toBeInViewport();
  await expect(screen.getByTestId("ai-approve-button")).toBeEnabled();
  findings.approvalVisibleEvidencePx = await screen.evaluate((element) => {
    const footer = element.querySelector(".ai-approval-screen-footer")!.getBoundingClientRect();
    return Math.round(footer.top - element.getBoundingClientRect().top);
  });
  expect(findings.approvalVisibleEvidencePx as number).toBeGreaterThan(200);
  await shot(page, "13c-approval-screen-docked-1366x768");
  await page.setViewportSize({ width: 1440, height: 1000 });

  // ---- Tools
  await page.getByTestId("ai-nav-chat").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("ai-nav-evidence")).toBeFocused();
  await openAiPanelTab(page, "tools");
  await expect(page.getByTestId("ai-tools-view")).toBeVisible();
  const pyscfPill = page.getByTestId("ai-tool-card-pyscf").getByTestId("ai-tool-status");
  await expect(pyscfPill).not.toHaveText("Checking", { timeout: 30_000 });
  findings.pyscfToolStatus = await pyscfPill.innerText();
  await expect(page.getByTestId("ai-tool-card-orca")).toHaveAttribute("data-status", "roadmap");
  await expect(page.getByTestId("ai-tools-view")).not.toContainText(/Add tool|CCSD|6-31G\*/);
  await page.getByTestId("ai-tools-search-input").fill("web search");
  await expect(page.locator('[data-testid^="ai-tool-card-"]')).toHaveCount(1);
  await page.getByTestId("ai-tools-search-input").fill("");
  // Critique regression: the status pill never covers the tool description at docked width.
  const overlap = await page.getByTestId("ai-tool-card-pyscf").evaluate((card) => {
    const a = card.querySelector(".ai-tool-desc")!.getBoundingClientRect();
    const b = card.querySelector(".ai-tool-status-pill")!.getBoundingClientRect();
    return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  });
  expect(overlap).toBe(0);
  const opener = page.getByTestId("ai-tool-card-pyscf").locator(".ai-tool-open-detail");
  await opener.click();
  await expect(page.getByTestId("ai-tool-detail")).toContainText("STO-3G");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ai-tool-detail")).toHaveCount(0);
  await expect(opener).toBeFocused();

  // ---- Evidence: researcher terms, no raw authority codes, no blanket trust.
  await page.getByTestId("ai-nav-evidence").click();
  await expect(page.getByTestId("ai-evidence-view")).toBeVisible();
  findings.evidenceStates = await page.getByTestId("ai-evidence-state").allInnerTexts();
  await expect(page.getByTestId("ai-evidence-view")).not.toContainText(/USER_SUPPLIED|NOT REVIEWED|Trusted/);

  // ---- Runs: planning record + coverage limit.
  await page.getByTestId("ai-nav-runs").click();
  await expect(page.getByTestId("ai-runs-coverage")).toContainText("earlier conversations are not listed");
  findings.runPhases = await page.getByTestId("ai-run-phase").allInnerTexts();
  // Critique regression: the run card uses the content column, not the 14 px timeline column.
  findings.runCardWidthPx = await page.locator(".ai-run-card").first().evaluate((element) => Math.round(element.getBoundingClientRect().width));
  expect(findings.runCardWidthPx as number).toBeGreaterThan(200);
  await expect(page.getByTestId("ai-runs-view")).not.toContainText(/SCF Iteration|\d+%|current session|Verified calculation output|did not converge/);

  // ---- Settings: server preference, nothing saved without a change, no browser storage.
  await openAiPanelTab(page, "settings");
  await expect(page.getByTestId("ai-settings-current")).toContainText("fake-standard", { timeout: 30_000 });
  await expect(page.getByTestId("ai-settings-current")).not.toContainText("MANAGED");
  await expect(page.getByTestId("ai-settings-save")).toBeDisabled();
  expect(await page.evaluate(() => Object.keys(window.localStorage))).not.toContain("chemdft:ai-scientist-settings");

  // ---- Screenshots of all five tabs: docked, then expanded.
  for (const tab of TABS) {
    await openAiPanelTab(page, tab);
    await shot(page, `0${TABS.indexOf(tab) + 1}-${tab}-docked`);
  }
  findings.dockedOverflowPx = await panelOverflow(page);
  await page.getByTestId("ai-expand-toggle").click();
  await expect(page.getByTestId("ai-scientist-panel")).toHaveClass(/is-expanded/);
  for (const tab of TABS) {
    await openAiPanelTab(page, tab);
    await shot(page, `08-expanded-${tab}`);
  }
  findings.expandedOverflowPx = await panelOverflow(page);
  await shot(page, "08-expanded-page", true);
  await page.getByTestId("ai-expand-toggle").click();

  // ---- Accessibility (axe-core, WCAG 2 A/AA) on every tab and the approval screen.
  await page.addScriptTag({ path: resolve("node_modules/axe-core/axe.min.js") });
  const axeResults: Record<string, AxeViolation[]> = {};
  for (const tab of TABS) {
    await openAiPanelTab(page, tab);
    axeResults[tab] = await axe(page, '[data-testid="ai-scientist-panel"]');
  }
  await page.getByTestId("ai-nav-chat").click();
  await expect(screen).toBeVisible();
  axeResults.approvalScreen = await axe(page, '[data-testid="ai-approval-card"]');

  // ---- ≤760 px: bottom sheet over the workspace, keyboard open/close with focus return.
  await page.setViewportSize({ width: 390, height: 844 });
  const toggle = page.getByTestId("ai-dock-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 });
  await expect(page.locator(".project-document")).toBeVisible();
  await shot(page, "15-mobile-workspace-sheet-closed", true);
  await toggle.click();
  const drawer = page.locator(".workspace-slide-over-drawer");
  const sheet = page.locator(".context-dock");
  await expect(sheet).toBeVisible();
  await expect(drawer).toHaveCSS("position", "fixed");
  await expect(page.locator(".project-document")).toBeVisible();
  await expect(page.locator(".context-dock :focus")).toHaveCount(1);
  findings.mobilePageOverflowPx = await pageOverflow(page);
  findings.mobilePanelOverflowPx = await panelOverflow(page);
  await expect(screen).toBeVisible();
  await expect(screen.getByTestId("ai-approve-button")).toBeEnabled();
  await expect(screen.getByTestId("ai-approve-button")).toBeInViewport();
  await shot(page, "14-mobile-approval-screen", true);
  await page.getByTestId("ai-approval-back").click();
  // The proposal still waits, so the composer is the one-row paused explanation with "Stop run".
  await expect(page.getByTestId("ai-composer-paused")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Stop run" })).toBeInViewport();
  await shot(page, "09-mobile-chat", true);
  await openAiPanelTab(page, "tools");
  await shot(page, "10-mobile-tools", true);
  await page.getByTestId("ai-nav-tools").focus();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(sheet).toBeVisible();
  axeResults.mobileSheet = await axe(page, ".context-dock");

  // Advanced mode at ≤760 px: the toggle stays available, opens the AI tab, and the sheet has a close control.
  // Guided mode hides the panel's duplicate close button; the header toggle closes the sheet.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByTestId("mode-toggle-advanced").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toggle).toBeVisible();
  // Right after the viewport change the dock can still be in its desktop layout for a moment and then
  // collapses to the closed sheet by itself (observed once: a click on a close button that never became
  // visible). Click only a close button that is visible, and pass once the sheet is closed.
  await expect(async () => {
    const close = page.getByTestId("dock-sheet-close");
    if (await close.isVisible()) await close.click({ timeout: 2_000 });
    await expect(sheet).toBeHidden({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await toggle.click();
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("ai-scientist-tab")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("dock-sheet-close")).toBeVisible();
  await shot(page, "16-mobile-advanced-sheet", true);
  await page.getByTestId("dock-sheet-close").click();
  await expect(sheet).toBeHidden();
  await expect(toggle).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByTestId("mode-toggle-guided").click();
  findings.axe = axeResults;

  // ---- MOCKED BROWSER INTEGRATION: settings read failure shows an error, never a success.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/api/chemdft/v1/ai/settings", (route) => route.fulfill({ status: 500, json: { detail: "SETTINGS_UNAVAILABLE_TEST" } }));
  await page.reload();
  await showPanel(page);
  await openAiPanelTab(page, "settings");
  await expect(page.getByTestId("ai-settings-notice")).toBeVisible({ timeout: 30_000 });
  findings.settingsErrorText = await page.getByTestId("ai-settings-notice").innerText();
  await shot(page, "11-settings-error-mocked");
  await page.unroute("**/api/chemdft/v1/ai/settings");

  expect((await (await request.get(`${root}/${project}/compute/jobs`)).json()).jobs).toHaveLength(0);
  findings.postedMessages = posted.map((body) => ({ planning_profile: body.planning_profile, mode: body.mode, selected_structure_version_id: body.selected_structure_version_id ?? null }));
  findings.consoleErrors = consoleErrors.slice(0, 20);
  writeFileSync(resolve(shots, "findings.json"), JSON.stringify(findings, null, 2));
  expect(findings.mobilePageOverflowPx).toBeLessThanOrEqual(1);
  const serious = Object.values(axeResults).flat().filter((violation) => violation.impact === "critical" || violation.impact === "serious");
  expect(serious, JSON.stringify(serious)).toEqual([]);
  expect(readFileSync(resolve(shots, "findings.json"), "utf8")).toContain("LOCAL_BACKEND_INTEGRATION");
});


/**
 * Pass 4 — desktop decisions in Advanced mode against the real local app. The compute worker is
 * DISABLED: an approved proposal becomes a QUEUED job record that nothing executes, and the test
 * cancels it. No scientific result is created, so validated-result navigation is NOT covered here
 * (unit-tested); record navigation (structure source, calculation record, chat) is.
 */
test("UI-1 desktop decisions: reject, approve without execution, record navigation", async ({ page, request }) => {
  test.setTimeout(300_000);
  expect(process.env.CHEMDFT_AI_PROVIDER).toBe("fake");
  expect(process.env.CHEMDFT_E2E_WORKER_MODE).toBe("disabled");
  mkdirSync(shots, { recursive: true });
  const decisions: Record<string, unknown> = { category: "LOCAL_BACKEND_INTEGRATION", worker: process.env.CHEMDFT_E2E_WORKER_MODE };
  const created = await request.post(root, { data: { name: "UI-1 decisions", slug: `ui1-decisions-${crypto.randomUUID()}` } });
  const project = (await created.json()).id as string;
  const imported = await (await request.post(`${root}/${project}/structures/imports`, { multipart: {
    file_format: "XYZ", idempotency_key: crypto.randomUUID(),
    upload: { name: "h2.xyz", mimeType: "chemical/x-xyz", buffer: Buffer.from("2\nSupplied H2 reference | chemdft:charge=0;multiplicity=1\nH 0 0 -0.37\nH 0 0 0.37\n") },
  } })).json();
  const versionId = imported.version.id as string;
  const structureId = (imported.structure?.id ?? imported.version.structure_id) as string;
  const jobs = async () => (await (await request.get(`${root}/${project}/compute/jobs`)).json()).jobs as Array<{ state: string }>;
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/en/projects/${project}/workspace?selection=${encodeURIComponent(`structureVersion:${versionId}`)}&source=${structureId}`);
  await openAiTab(page);
  await expect(page.getByTestId("ai-model-provider-card")).toContainText("fake-standard", { timeout: 40_000 });
  const viewer = page.getByRole("group", { name: "Scientific View molecule viewport", exact: true });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator("canvas")).toBeVisible();
  await expect(page.locator(".project-document")).toContainText("Supplied H2 reference");
  const dockWidth = () => page.locator(".context-dock").evaluate((element) => Math.round(element.getBoundingClientRect().width));
  const workspaceWidth = () => page.locator(".project-document").evaluate((element) => Math.round(element.getBoundingClientRect().width));
  decisions.dockedWidth1920 = await dockWidth();

  async function propose() {
    await choosePlanModeHere();
    await page.getByTestId("ai-prompt-input").fill("Calculate the HF/STO-3G single-point energy for H2 with charge 0 and multiplicity 1.");
    await page.getByTestId("ai-prepare-calculation-button").click();
    await expect(page.getByTestId("ai-approval-card")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("ai-approval-geometry")).toContainText(versionId, { timeout: 40_000 });
  }
  async function choosePlanModeHere() {
    await expect(page.getByTestId("ai-prepare-calculation-button")).toBeVisible();
  }

  // ---- Approval comfort at the three desktop sizes: the dock widens while a proposal is inspected,
  // the molecular workspace stays usable and parameters plus the decision controls are on screen.
  await propose();
  const comfort: Record<string, unknown> = {};
  for (const size of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(size);
    const screen = page.getByTestId("ai-approval-card");
    // Decision context sits under the title: the originating request, compute preference and estimate.
    await expect(screen.getByTestId("ai-approval-context")).toContainText("Your request");
    await expect(screen.getByTestId("ai-approval-context")).toContainText("Calculate the HF/STO-3G single-point energy for H2");
    await expect(screen.getByTestId("ai-approval-context")).toContainText(/Compute/);
    await expect(screen.getByTestId("ai-approval-countdown")).toBeInViewport();
    await expect(screen.getByRole("heading", { name: "Scientific parameters" })).toBeInViewport();
    await expect(screen.getByTestId("ai-approve-button")).toBeInViewport();
    await expect(screen.getByTestId("ai-approve-button")).toBeEnabled();
    await expect(screen.getByTestId("ai-reject-button")).toBeInViewport();
    await expect(viewer.locator("canvas")).toBeVisible();
    const viewerBox = await viewer.boundingBox();
    const dockBox = await page.locator(".context-dock").boundingBox();
    expect(viewerBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    expect(viewerBox!.x + viewerBox!.width).toBeLessThanOrEqual(dockBox!.x + 1);
    expect(await pageOverflow(page)).toBe(0);
    const evidencePx = await screen.evaluate((element) => Math.round(element.querySelector(".ai-approval-screen-footer")!.getBoundingClientRect().top - element.getBoundingClientRect().top));
    comfort[`${size.width}x${size.height}`] = { dockPx: await dockWidth(), workspacePx: await workspaceWidth(), visibleEvidencePx: evidencePx };
    expect(await dockWidth()).toBeGreaterThanOrEqual(340);
    expect(await workspaceWidth()).toBeGreaterThanOrEqual(700);
    expect(evidencePx).toBeGreaterThan(250);
    await page.screenshot({ path: resolve(shots, `20-approval-advanced-${size.width}x${size.height}.png`) });
  }
  decisions.approvalComfort = comfort;
  expect(await jobs()).toHaveLength(0);

  // ---- Rejection end to end, with a recorded reason: no job, run closes, banner and badges clear.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("ai-approval-card").locator(".ai-approval-reject-note > summary").click();
  await page.getByTestId("ai-reject-note").fill("UI-1 acceptance: rejecting to verify the decision path.");
  await page.getByTestId("ai-reject-button").click();
  await expect(page.getByTestId("ai-approval-card")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("ai-approval-pending-banner")).toHaveCount(0);
  await expect(page.getByTestId("ai-chat-approval-badge")).toHaveCount(0);
  await expect(page.getByTestId("ai-message-assistant").last()).toContainText("The proposed calculation was rejected", { timeout: 30_000 });
  await expect(page.getByTestId("ai-ask-button")).toBeVisible();
  expect(await jobs()).toHaveLength(0);
  decisions.dockedWidthAfterDecision = await dockWidth();
  // The dock never resizes itself when an approval opens or closes.
  expect(decisions.dockedWidthAfterDecision).toBe((comfort["1440x900"] as { dockPx: number }).dockPx);
  await page.screenshot({ path: resolve(shots, "21-after-rejection-1440x900.png") });

  // ---- Approval with the worker disabled: one QUEUED job record, nothing executes.
  await page.setViewportSize({ width: 1366, height: 768 });
  await propose();
  await page.getByTestId("ai-approve-button").click();
  await expect(page.getByTestId("ai-approval-card")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await jobs()).length, { timeout: 30_000 }).toBe(1);
  const queuedState = (await jobs())[0]!.state;
  await page.waitForTimeout(5_000);
  const laterState = (await jobs())[0]!.state;
  decisions.jobStates = { afterApproval: queuedState, fiveSecondsLater: laterState };
  expect(["QUEUED", "AUTHORIZED", "READY"]).toContain(laterState);
  await page.screenshot({ path: resolve(shots, "22-after-approval-worker-disabled-1366x768.png") });

  // ---- Runs: the queued calculation record and the planning run; open the calculation record.
  await page.getByTestId("ai-nav-runs").click();
  const queued = page.locator('[data-testid^="ai-run-item-"][data-phase="QUEUED"]');
  await expect(queued).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId("ai-runs-view")).not.toContainText(/Total energy|\d+%/);
  decisions.runPhases = await page.getByTestId("ai-run-phase").allInnerTexts();
  await page.screenshot({ path: resolve(shots, "23-runs-queued-1366x768.png") });
  await queued.getByRole("button", { name: "Open calculation" }).click();
  await expect(page).toHaveURL(/selection=calculation/, { timeout: 30_000 });
  decisions.calculationNavigationUrl = page.url().replace(/^https?:\/\/[^/]+/, "");
  // Cancel the queued job from the Runs tab (confirmation dialog accepted).
  await openAiTab(page);
  await page.getByTestId("ai-nav-runs").click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator('[data-testid^="ai-run-item-"][data-phase="QUEUED"]').getByRole("button", { name: "Cancel" }).click();
  await expect.poll(async () => (await jobs())[0]!.state, { timeout: 30_000 }).toMatch(/CANCEL/);
  decisions.jobStateAfterCancel = (await jobs())[0]!.state;

  // ---- Evidence: open the saved structure source in the workspace.
  await page.getByTestId("ai-nav-evidence").click();
  const structureRecord = page.locator(".ai-evidence-list").getByRole("button", { name: /Open source: Supplied H2 reference/ }).first();
  await structureRecord.click();
  await expect(page).toHaveURL(new RegExp(`selection=structureVersion%3A${versionId}`), { timeout: 30_000 });
  // ---- Runs → Chat navigation.
  await openAiTab(page);
  await page.getByTestId("ai-nav-runs").click();
  await page.getByRole("button", { name: "Open in Chat" }).first().click();
  await expect(page.getByTestId("ai-nav-chat")).toHaveAttribute("aria-selected", "true");

  decisions.consoleErrors = consoleErrors.slice(0, 20);
  writeFileSync(resolve(shots, "decisions.json"), JSON.stringify(decisions, null, 2));
  expect(consoleErrors.filter((text) => !/WebGL|GL Driver|favicon/.test(text))).toEqual([]);
});

test("UI-1 header identity stays visible at 1280/1440/1920 with the AI panel open and closed", async ({ page, request }) => {
  test.setTimeout(180_000);
  mkdirSync(shots, { recursive: true });
  const created = await request.post(root, { data: { name: "UI-1 identity", slug: `ui1-identity-${crypto.randomUUID()}` } });
  const project = (await created.json()).id as string;
  await page.goto(`/en/projects/${project}/workspace`);
  const identity = page.getByTestId("header-identity");
  const toggle = page.getByTestId("ai-dock-toggle");
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const open of [true, false]) {
      // The toggle's name is the dock state: "Hide ..." while the panel is open.
      await expect(async () => {
        const isOpen = (await toggle.getAttribute("aria-label")) === "Hide AI Scientist panel";
        if (isOpen !== open) await toggle.click();
        await expect(toggle).toHaveAttribute("aria-label", open ? "Hide AI Scientist panel" : "Show AI Scientist panel", { timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
      await expect(identity).toBeVisible();
      await expect(identity).toBeInViewport({ ratio: 1 });
      await expect(identity).toHaveAttribute("href", "/en/account");
      const box = (await identity.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      if (width === 1440) await page.screenshot({ path: resolve(shots, `header-identity-1440-${open ? "panel-open" : "panel-closed"}.png`), clip: { x: width - 520, y: 0, width: 520, height: 64 } });
    }
  }
});

test("One shared product header on Projects, Jobs, Learn, Settings and Account at 1280/1440/1920", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(shots, { recursive: true });
  const pages = ["projects", "jobs", "learn", "settings/general", "account"];
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of pages) {
      await page.goto(`/en/${path}`);
      const nav = page.getByRole("navigation", { name: "Product navigation" });
      await expect(nav.getByRole("link")).toHaveText(["Projects", "Jobs", "Learn", "Releases", "Feedback", "Settings"]);
      const hrefs = await nav.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      expect(hrefs).toEqual(["/en/projects", "/en/jobs", "/en/learn", "/en/releases", "/en/feedback", "/en/settings/general"]);
      const identity = page.getByTestId("header-identity");
      await expect(identity).toBeVisible();
      await expect(identity).toHaveAttribute("href", "/en/account");
      await expect(page.locator("header .header-account-link")).toHaveCount(0); // the avatar is the Account link, no separate text link
      await expect(page.locator('header a[href="/en/account"]')).toHaveCount(1);
      const current = path.startsWith("settings") ? "Settings" : path === "account" ? null : path[0]!.toUpperCase() + path.slice(1);
      if (current) await expect(nav.locator('[aria-current="page"]')).toHaveText(current);
      else await expect(identity).toHaveAttribute("aria-current", "page");
      const box = (await identity.boundingBox())!;
      expect(width - (box.x + box.width), `${path} @${width}: avatar gap to the right edge`).toBeGreaterThanOrEqual(16);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      // Header content lines up with the page content column, not the window edge.
      const main = (await page.locator("main").first().boundingBox())!;
      expect(Math.abs(width - (box.x + box.width) - (width - (main.x + main.width))), `${path} @${width}: avatar right edge vs content right edge`).toBeLessThanOrEqual(34);
      if (width === 1440) await page.screenshot({ path: resolve(shots, `shared-header-${path.replace("/", "-")}-1440.png`) });
    }
  }
  // Settings is reachable from Projects and Account, and Billing from Settings.
  for (const from of ["projects", "account"]) {
    await page.goto(`/en/${from}`);
    await page.getByRole("navigation", { name: "Product navigation" }).getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/en\/settings\/general$/);
  }
  await page.getByRole("navigation", { name: "Settings sections" }).locator('[data-section="billing"]').click();
  await expect(page).toHaveURL(/\/en\/settings\/billing$/);
});

/**
 * Opt-in hold for the Impeccable critique: seeds one disposable project and keeps the isolated
 * stack alive so independent reviewers can inspect the live page. Skipped unless
 * CHEMDFT_UI1_CRITIQUE_HOLD_SECONDS is set (max 1800). Creates no proposals and no jobs.
 */
test("UI-1 critique hold (opt-in)", async ({ request }) => {
  const seconds = Number(process.env.CHEMDFT_UI1_CRITIQUE_HOLD_SECONDS ?? 0);
  test.skip(!(seconds > 0), "critique hold not requested");
  test.setTimeout((Math.min(seconds, 1800) + 120) * 1000);
  const created = await request.post(root, { data: { name: "UI-1 critique", slug: `ui1-critique-${crypto.randomUUID()}` } });
  const project = (await created.json()).id as string;
  const imported = await (await request.post(`${root}/${project}/structures/imports`, { multipart: {
    file_format: "XYZ", idempotency_key: crypto.randomUUID(),
    upload: { name: "h2.xyz", mimeType: "chemical/x-xyz", buffer: Buffer.from("2\nSupplied H2 reference | chemdft:charge=0;multiplicity=1\nH 0 0 -0.37\nH 0 0 0.37\n") },
  } })).json();
  const versionId = imported.version.id as string;
  const structureId = (imported.structure?.id ?? imported.version.structure_id) as string;
  // One offline (fake planner) proposal so reviewers can inspect the approval screen; never approved.
  const conversation = await (await request.post(`${root}/${project}/ai/conversations`, { data: { title: "Critique" } })).json();
  await request.post(`${root}/${project}/ai/conversations/${conversation.conversation.id}/messages`, { data: {
    content: "Calculate the HF/STO-3G single-point energy for H2 with charge 0 and multiplicity 1.", mode: "STANDARD",
    planning_profile: "PYSCF_ENERGY_PROPOSAL", selected_structure_id: structureId, selected_structure_version_id: versionId,
    current_view: "Supplied H2 reference V1 → Structure",
  } });
  const url = `http://127.0.0.1:${process.env.CHEMDFT_E2E_WEB_PORT}/en/projects/${project}/workspace?selection=${encodeURIComponent(`structureVersion:${versionId}`)}&source=${structureId}`;
  writeFileSync(resolve(process.env.CHEMDFT_E2E_REPOSITORY_ROOT ?? ".", ".chemdft/audits/ui-1-critique-hold-url.txt"), `${url}\n`);
  console.log(`UI1_CRITIQUE_URL ${url}`);
  await new Promise((done) => setTimeout(done, Math.min(seconds, 1800) * 1000));
});
