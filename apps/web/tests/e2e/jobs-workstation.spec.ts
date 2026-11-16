import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Jobs workstation against the presentation-fixture mock API (see playwright.jobs.config.ts). Fixture jobs are NOT
 * scientific results. The fixture ids below come from tests/fixtures/jobs-mock-api.mjs.
 */
const SHOTS = process.env.JOBS_SHOTS ?? "/tmp/chemdft-jobs-screens";
mkdirSync(SHOTS, { recursive: true });
const SMALL = "00000000-0000-4000-8000-0000000000a1";
const BIG = "00000000-0000-4000-8000-0000000000b2";
const EMPTY = "00000000-0000-4000-8000-0000000000c3";
const READONLY = "00000000-0000-4000-8000-0000000000d4";
const job = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const url = (project: string, query = "") => `/en/projects/${project}/jobs${query}`;

async function axeViolations(page: Page) {
  await page.evaluate(axe.source);
  const result = await page.evaluate(() =>
    (window as unknown as { axe: typeof axe }).axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }),
  );
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const inViewport = async (page: Page, testId: string) => {
  const box = await page.getByTestId(testId).first().boundingBox();
  const size = page.viewportSize()!;
  return box !== null && box.y >= 0 && box.y + box.height <= size.height + 1 && box.x >= 0 && box.x + box.width <= size.width + 1;
};

test.describe("Jobs workstation", () => {
  test("1366x768 with the AI dock open and closed: library, inspector and actions are on the first screen", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(url(SMALL));
    await expect(page.getByTestId("job-row")).toHaveCount(8, { timeout: 30_000 });
    await expect(page.getByTestId("job-inspector")).toBeVisible();
    expect(await inViewport(page, "job-open")).toBe(true);
    expect(await inViewport(page, "jobs-search")).toBe(true);
    expect(await inViewport(page, "queue-status")).toBe(true);
    expect(await noHorizontalOverflow(page)).toBe(true);
    // at least three library rows fit above the fold
    const rows = page.getByTestId("job-row");
    for (let i = 0; i < 3; i += 1) expect(await rows.nth(i).boundingBox().then((b) => (b ? b.y + 40 < 768 : false))).toBe(true);
    await page.screenshot({ path: `${SHOTS}/01-desktop-dock-open.png` });
    await page.getByTestId("ai-dock-toggle").click();
    await expect(page.locator(".project-shell")).toHaveClass(/dock-collapsed/);
    expect(await noHorizontalOverflow(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/02-desktop-dock-closed.png` });
  });

  test("selection is in the URL; reload and history reproduce it", async ({ page }) => {
    await page.goto(url(SMALL));
    await expect(page.getByTestId("job-row")).toHaveCount(8, { timeout: 30_000 });
    await page.locator(`[data-job-id="${job(4)}"] [data-testid="job-select"]`).click();
    await expect(page).toHaveURL(new RegExp(`job=${job(4)}`));
    await expect(page.getByTestId("job-inspector")).toHaveAttribute("data-job-id", job(4));
    await page.locator(`[data-job-id="${job(1)}"] [data-testid="job-select"]`).click();
    await expect(page.getByTestId("job-inspector")).toHaveAttribute("data-job-id", job(1));
    await page.goBack();
    await expect(page.getByTestId("job-inspector")).toHaveAttribute("data-job-id", job(4));
    await page.reload();
    await expect(page.getByTestId("job-inspector")).toHaveAttribute("data-job-id", job(4), { timeout: 30_000 });
  });

  test("state chips with counts, search and provider filter live in the URL", async ({ page }) => {
    await page.goto(url(SMALL));
    await expect(page.getByTestId("job-row")).toHaveCount(8, { timeout: 30_000 });
    const failedChip = page.locator('[data-testid="jobs-filter-chip"][data-filter="failed"]');
    await expect(failedChip).toContainText("2"); // failed + lost
    await failedChip.click();
    await expect(page.getByTestId("job-row")).toHaveCount(2);
    await expect(page).toHaveURL(/state=failed/);
    await page.locator('[data-testid="jobs-filter-chip"][data-filter="all"]').click();
    await page.getByTestId("jobs-search").fill("ethanol");
    await expect(page.getByTestId("job-row")).toHaveCount(2);
    await page.getByTestId("jobs-search").fill("c2h6o");
    await expect(page.getByTestId("job-row")).toHaveCount(2);
    await page.getByTestId("jobs-search").fill("");
    await page.locator('[data-testid="jobs-provider-filter"] [data-provider="aws"]').click();
    await expect(page.getByTestId("job-row")).toHaveCount(3);
    await expect(page).toHaveURL(/provider=aws/);
    await page.getByTestId("jobs-search").fill("zzz-nothing");
    await expect(page.getByText("No jobs match these filters.")).toBeVisible();
  });

  test("provider, waiting reason, estimate, reservation and reported cost are labelled and server-provided", async ({ page }) => {
    await page.goto(url(SMALL, `?job=${job(3)}`));
    await expect(page.getByTestId("job-worker-status")).toContainText("AWS worker is starting");
    await expect(page.getByTestId("job-provider")).toHaveText("AWS");
    await expect(page.getByTestId("job-estimate")).toContainText("Estimated cost");
    await expect(page.getByTestId("job-estimate")).toContainText("at least $0.05");
    await expect(page.getByTestId("job-reservation")).toContainText("Authorized maximum");
    await expect(page.getByTestId("job-reservation")).toContainText("$1.00");
    await page.screenshot({ path: `${SHOTS}/03-aws-waiting.png` });

    await page.goto(url(SMALL, `?job=${job(7)}`));
    await expect(page.getByTestId("job-estimate")).toContainText("$0.08 to $0.22");
    await expect(page.getByTestId("job-reservation")).toContainText("Cost reported by provider");
    await expect(page.getByTestId("job-reservation")).toContainText("$0.11");

    await page.goto(url(SMALL, `?job=${job(1)}`));
    await expect(page.getByTestId("job-estimate")).toContainText("not provided"); // local estimate has no cost
    await expect(page.getByTestId("job-reservation")).toContainText("not reported by the provider");

    await page.goto(url(SMALL, `?job=${job(8)}`));
    await expect(page.getByTestId("job-estimate-none")).toHaveText("No estimate recorded for this job.");
    await expect(page.getByTestId("job-worker-status")).toHaveCount(0);
    expect(await page.locator("main, body").first().innerText()).not.toMatch(/\d+\s?%\s*(complete|done)/i);
  });

  test("failed and lost jobs show the recorded reason; structure identity shows name, formula and version", async ({ page }) => {
    await page.goto(url(SMALL, `?job=${job(4)}`));
    await expect(page.getByTestId("job-failure")).toContainText("engine failed — xtb exited with status 1");
    await expect(page.getByTestId("job-inspector")).toContainText("Ethanol");
    await expect(page.getByTestId("job-inspector")).toContainText("C2H6O");
    await expect(page.getByTestId("job-inspector")).toContainText("version 2");
    await expect(page.getByTestId("job-open-structure")).toHaveAttribute("href", /workspace\?selection=structureVersion/);
    await page.screenshot({ path: `${SHOTS}/04-failed.png` });
    await expect(page.locator(`[data-job-id="${job(6)}"]`)).toContainText("Execution lost");
  });

  test("diagnostics, log and queue strip keep their evidence", async ({ page }) => {
    await page.goto(url(SMALL, `?job=${job(1)}`));
    const diagnostics = page.getByTestId("job-diagnostics");
    await expect(diagnostics).toBeVisible({ timeout: 30_000 });
    await expect(diagnostics).toHaveAttribute("data-heartbeat", "NOT_APPLICABLE");
    await expect(page.getByTestId("job-progress-note")).toContainText("trustworthy percent-complete");
    await expect(page.getByTestId("job-executions").locator("tbody tr")).toHaveCount(1);
    await expect(page.getByTestId("job-attempts").locator("tbody tr")).toHaveCount(1);
    await expect(page.getByTestId("job-artifact-availability")).toContainText("native artifact");
    await page.getByTestId("job-log-open").first().click();
    await expect(page.getByTestId("job-log").locator("pre")).toBeVisible({ timeout: 15_000 });
    const queue = page.getByTestId("queue-status");
    await expect(page.getByTestId("queue-queued")).toHaveText("2");
    await expect(page.getByTestId("queue-running")).toHaveText("2");
    await expect(queue).toContainText("cannot observe a worker");
    await expect(queue).toContainText("No percent-complete is shown");
  });

  test("cancel is the only write request and updates the row", async ({ page }) => {
    const writes: string[] = [];
    page.on("request", (request) => { if (request.method() !== "GET") writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
    await page.goto(url(SMALL, `?job=${job(2)}`));
    await expect(page.getByTestId("job-cancel")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("job-cancel").click();
    await expect(page.locator(`[data-testid="job-row"][data-job-id="${job(2)}"]`)).toHaveAttribute("data-job-state", "CANCELED", { timeout: 15_000 });
    expect(writes).toEqual([expect.stringMatching(/^POST \/api\/chemdft\/v1\/projects\/.+\/calculations\/.+\/cancel$/)]);
  });

  test("Show more pages the library 100 at a time", async ({ page }) => {
    await page.goto(url(BIG));
    await expect(page.getByTestId("job-row")).toHaveCount(100, { timeout: 30_000 });
    await page.getByTestId("jobs-more").click();
    await expect(page.getByTestId("job-row")).toHaveCount(200);
    await page.getByTestId("jobs-more").click();
    await expect(page.getByTestId("job-row")).toHaveCount(230);
    await expect(page.getByTestId("jobs-more")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/05-long-list.png` });
  });

  test("empty project, unknown job and a read-only role", async ({ page }) => {
    await page.goto(url(EMPTY));
    await expect(page.getByText("No compute jobs yet.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("jobs-explainer")).toContainText("Real compute jobs created by authorized calculation submissions.");
    await page.screenshot({ path: `${SHOTS}/06-empty.png` });
    await page.goto(url(SMALL, `?job=${job(999)}`));
    await expect(page.getByTestId("job-missing")).toBeVisible({ timeout: 30_000 });
    await page.goto(url(READONLY, `?job=${job(2)}`));
    await expect(page.getByTestId("job-inspector")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("job-open")).toBeVisible();
    await expect(page.getByTestId("job-cancel")).toHaveCount(0);
    await expect(page.getByTestId("job-reuse")).toHaveCount(0);
  });

  test("keyboard: the divider resizes and every control is reachable", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url(SMALL));
    await expect(page.getByTestId("job-row")).toHaveCount(8, { timeout: 30_000 });
    const divider = page.getByTestId("jobs-divider");
    const before = Number(await divider.getAttribute("aria-valuenow"));
    await divider.focus();
    await page.keyboard.press("ArrowRight");
    expect(Number(await divider.getAttribute("aria-valuenow"))).toBe(before + 16);
    await page.keyboard.press("Enter");
    expect(Number(await divider.getAttribute("aria-valuenow"))).toBe(before);
    await page.getByTestId("jobs-search").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator('[data-testid="jobs-filter-chip"]').first()).toBeFocused();
  });

  test("tablet 820 and phone 390: one pane at a time, no page overflow", async ({ page }) => {
    for (const [width, height, name] of [[820, 1024, "tablet"], [390, 844, "phone"]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(url(SMALL));
      await expect(page.getByTestId("job-row")).toHaveCount(8, { timeout: 30_000 });
      expect(await noHorizontalOverflow(page), `${name} library`).toBe(true);
      await page.screenshot({ path: `${SHOTS}/07-${name}-library.png` });
      await page.locator(`[data-job-id="${job(3)}"] [data-testid="job-select"]`).click();
      await expect(page.getByTestId("job-inspector")).toBeVisible();
      await expect(page.getByTestId("jobs-library")).toBeHidden();
      expect(await noHorizontalOverflow(page), `${name} inspector`).toBe(true);
      await page.screenshot({ path: `${SHOTS}/08-${name}-inspector.png` });
      await page.getByRole("button", { name: "Jobs", exact: true }).click();
      await expect(page.getByTestId("jobs-library")).toBeVisible();
    }
  });

  test("accessibility: no serious or critical axe violations", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(url(SMALL, `?job=${job(1)}`));
    await expect(page.getByTestId("job-diagnostics")).toBeVisible({ timeout: 30_000 });
    expect(await axeViolations(page), "jobs, succeeded job").toEqual([]);
    await page.goto(url(SMALL, `?job=${job(3)}`));
    await expect(page.getByTestId("job-worker-status")).toBeVisible({ timeout: 30_000 });
    expect(await axeViolations(page), "jobs, waiting AWS job").toEqual([]);
  });
});
