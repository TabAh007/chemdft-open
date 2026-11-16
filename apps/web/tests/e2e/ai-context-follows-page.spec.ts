import { expect, test, type Page } from "@playwright/test";
import { mockAi, type AiMock } from "./ai-context-mock";

/**
 * The AI Scientist dock follows the page. Each scenario asks one question on a page, moves to another page inside the
 * app (no reload, so the panel keeps its state), and checks that the answer is not shown under the other context, that it
 * comes back with its own context, and what the dock told the server. AI endpoints are mocked in the browser.
 * Select a scenario with --grep @jobs | @claims | @comparison | @settings (the fixture mock APIs) or @workspace | @results
 * | @overview | @compare (the RW2 evidence stack).
 */
const FORBIDDEN_IDS = ["selected_result_id", "selected_structure_id", "selected_structure_version_id", "selected_spectrum_id"];
const chip = (page: Page) => page.getByTestId("ai-scientist-panel");
const answer = (text: string | RegExp) => typeof text === "string" ? `Mock answer under: ${text}` : text;

async function ask(page: Page, mock: AiMock, question: string) {
  const before = mock.messagePosts.length;
  await page.getByTestId("ai-prompt-input").fill(question);
  await page.getByTestId("ai-prompt-input").press("Enter");
  await expect.poll(() => mock.messagePosts.length, { timeout: 30_000 }).toBe(before + 1);
  return mock.messagePosts.at(-1)!;
}
async function openPage(page: Page, mock: AiMock, url: string) {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.addInitScript(() => { try { localStorage.setItem("chemdft:workspace-mode", "guided"); } catch { /* optional */ } });
  await page.goto(url);
  await expect(page.getByTestId("ai-scientist-panel")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("ai-prompt-input")).toBeEnabled({ timeout: 60_000 });
  void mock;
}

/** Ask on this page, leave for `other`, come back: the answer lives only under its own context. */
async function followsPage(page: Page, mock: AiMock, opts: { expectPage: string; expectKey: RegExp; other: string; otherPage?: string }) {
  await expect(chip(page)).toHaveAttribute("data-context-page", opts.expectPage, { timeout: 60_000 });
  const key = await chip(page).getAttribute("data-context-key");
  expect(key).toMatch(opts.expectKey);
  // the earlier exchange (asked about something else) is history, never the answer
  await expect(page.getByText("Earlier answer: the Raman peak", { exact: false })).not.toBeVisible();
  await expect(page.getByTestId("ai-history")).toBeVisible();
  const view = String((await page.getByTestId("ai-current-view").getAttribute("title")) ?? "");
  const posted = await ask(page, mock, "What is shown here?");
  expect(posted.current_view).toBe(view);
  for (const field of FORBIDDEN_IDS) if (opts.expectPage !== "workspace" && opts.expectPage !== "result") expect(posted[field], `${field} must not be sent from ${opts.expectPage}`).toBeUndefined();
  const mine = page.getByText(answer(view), { exact: true });
  await expect(mine).toBeVisible({ timeout: 30_000 });

  await page.getByTestId(`project-section-${opts.other}`).click();
  await expect(chip(page)).toHaveAttribute("data-context-page", opts.otherPage ?? "project", { timeout: 60_000 });
  await expect(chip(page)).not.toHaveAttribute("data-context-key", key!);
  await expect(page.getByText(answer(view), { exact: true }), "an answer is never shown under a context it was not given for").not.toBeVisible();
  await expect(page.getByText("Earlier answer: the Raman peak", { exact: false })).not.toBeVisible();
  await expect(page.getByTestId("ai-history")).toBeVisible();
  expect(mock.messagePosts.length, "navigating asks nothing").toBe(1);
  return { key: key!, view };
}

test.describe("AI context follows the page", () => {
  test.setTimeout(120_000);
  test("@jobs Jobs publishes the selected job: named, not grounded, no id the server does not accept", async ({ page }) => {
    const mock = await mockAi(page, { emptyInventory: true });
    await openPage(page, mock, "/en/projects/00000000-0000-4000-8000-0000000000a1/jobs");
    await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 60_000 });
    await expect(chip(page)).toHaveAttribute("data-grounding", "named");
    await expect(page.getByTestId("ai-context-grounding")).toHaveText("Named, not grounded");
    const { key, view } = await followsPage(page, mock, { expectPage: "job", expectKey: /^job:/, other: "overview" });
    expect(view).toMatch(/→ Compute Jobs · job /);
    // back on Jobs the same job's thread returns with its answer
    await page.getByTestId("project-section-jobs").click();
    await expect(chip(page)).toHaveAttribute("data-context-key", key, { timeout: 60_000 });
    await expect(page.getByText(answer(view), { exact: true })).toBeVisible();
    for (const request of mock.contextRequests) for (const field of FORBIDDEN_IDS) expect(request[field]).toBeUndefined();
  });

  test("@claims Claims publishes the selected claim; only its source paper can be grounded", async ({ page }) => {
    const mock = await mockAi(page, { emptyInventory: true, noJobs: true });
    await openPage(page, mock, "/en/projects/00000000-0000-4000-8000-0000000000a1/claims");
    await page.locator("[data-claim-id]").first().click();
    await expect(chip(page)).toHaveAttribute("data-context-page", "claim", { timeout: 60_000 });
    await expect(page.getByTestId("ai-context-grounding")).toContainText("Named");
    await followsPage(page, mock, { expectPage: "claim", expectKey: /^claim:/, other: "overview" });
    for (const request of mock.contextRequests) for (const field of FORBIDDEN_IDS) expect(request[field]).toBeUndefined();
  });

  test("@comparison Paper vs ChemDFT is read-only and named, not grounded", async ({ page }) => {
    const mock = await mockAi(page, { emptyInventory: true, noJobs: true });
    await openPage(page, mock, "/en/projects/00000000-0000-4000-8000-0000000000d1/comparison");
    await expect(chip(page)).toHaveAttribute("data-context-page", "paper-vs-chemdft", { timeout: 60_000 });
    await expect(page.getByTestId("ai-context-readonly")).toBeVisible();
    await expect(page.getByTestId("ai-context-grounding")).toHaveText("Named, not grounded");
    await followsPage(page, mock, { expectPage: "paper-vs-chemdft", expectKey: /^paper:/, other: "overview" });
    for (const request of mock.contextRequests) for (const field of FORBIDDEN_IDS) expect(request[field]).toBeUndefined();
  });

  test("@settings Settings has no AI-relevant selection: the project thread, not the previous page's", async ({ page }) => {
    const mock = await mockAi(page, { emptyInventory: true, noJobs: true });
    await openPage(page, mock, "/en/projects/00000000-0000-4000-8000-0000000000e1/settings/general");
    await expect(chip(page)).toHaveAttribute("data-context-page", "project", { timeout: 60_000 });
    await expect(chip(page)).toHaveAttribute("data-grounding", "project");
    await expect(page.getByTestId("ai-context-grounding")).toHaveCount(0);
    expect(String(mock.contextRequests.at(-1)?.current_view)).toMatch(/→ Settings$/);
    expect(Object.keys(mock.contextRequests.at(-1) ?? {})).toEqual(["current_view"]);
  });

  // --- the RW2 evidence stack (a disposable copy of stored evidence; the AI endpoints are still mocked) -----------------
  const EVIDENCE = "/en/projects/f39aefcf-a1cd-4606-8f03-f9b18eadb96d";

  test("@overview Overview is the project thread, and an answer given there is not shown on Compare", async ({ page }) => {
    const mock = await mockAi(page);
    await openPage(page, mock, `${EVIDENCE}/overview`);
    await expect(chip(page)).toHaveAttribute("data-context-page", "project", { timeout: 60_000 });
    await expect(chip(page)).toHaveAttribute("data-context-key", "project");
    await followsPage(page, mock, { expectPage: "project", expectKey: /^project$/, other: "compare", otherPage: "compare" });
  });

  test("@workspace The Workspace is bridged: project thread with nothing selected, and not shown on Compare", async ({ page }) => {
    const mock = await mockAi(page);
    await openPage(page, mock, `${EVIDENCE}/workspace`);
    await expect(chip(page)).toHaveAttribute("data-context-page", "workspace", { timeout: 60_000 });
    await followsPage(page, mock, { expectPage: "workspace", expectKey: /^project$/, other: "compare", otherPage: "compare" });
  });

  test("@results A result being inspected is the dock's context, not the Workspace's last selection", async ({ page, request }) => {
    const rows = ((await (await request.get("/api/chemdft/v1/projects/f39aefcf-a1cd-4606-8f03-f9b18eadb96d/published-results?limit=5")).json()) as { rows: Array<{ result_id: string; calculation_id: string }> }).rows;
    const row = rows.find((item) => item.result_id && item.calculation_id)!;
    const resultId = row.result_id;
    const mock = await mockAi(page, { result: { resultId, calculationId: row.calculation_id } });
    await openPage(page, mock, `${EVIDENCE}/results`);
    await expect(chip(page)).toHaveAttribute("data-context-page", "project", { timeout: 60_000 });
    await page.goto(`${EVIDENCE}/results/${resultId}`);
    await expect(chip(page)).toHaveAttribute("data-context-page", "result", { timeout: 60_000 });
    await expect(chip(page)).toHaveAttribute("data-context-key", `calculationResult:${resultId}`);
    await expect.poll(() => mock.contextRequests.at(-1)?.selected_result_id, { timeout: 30_000 }).toBe(resultId);
    await expect(page.getByTestId("ai-prompt-input")).toBeEnabled({ timeout: 60_000 });
    await followsPage(page, mock, { expectPage: "result", expectKey: /^calculationResult:/, other: "overview" });
  });

  test("@compare Compare names the compared results (read-only, named, not grounded) and keeps answers out of it", async ({ page, request }) => {
    const mock = await mockAi(page);
    const rows = ((await (await request.get("/api/chemdft/v1/projects/f39aefcf-a1cd-4606-8f03-f9b18eadb96d/published-results?limit=200")).json()) as { rows: Array<{ result_id: string; task: string }> }).rows;
    const [a, b] = rows.filter((row) => row.task === "THERMOCHEMISTRY" && row.result_id).map((row) => row.result_id);
    await openPage(page, mock, `${EVIDENCE}/compare?result=${a}&result=${b}`);
    await expect(chip(page)).toHaveAttribute("data-context-page", "compare", { timeout: 90_000 });
    await expect(page.getByTestId("ai-context-readonly")).toBeVisible();
    await expect(page.getByTestId("ai-context-grounding")).toHaveText("Named, not grounded");
    await expect(page.getByTestId("compare-dock-context")).toContainText("Comparing 2 results (A, B)");
    await followsPage(page, mock, { expectPage: "compare", expectKey: /^compare:/, other: "overview" });
    for (const request of mock.contextRequests) for (const field of FORBIDDEN_IDS) expect(request[field], "Compare sends no result id").toBeUndefined();
  });
});
