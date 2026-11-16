import { expect, test } from "@playwright/test";
import { preferGuidedMode } from "./guided-helpers";

/**
 * Overview, Guided workspace and Results working together on the accepted evidence (real API, disposable database,
 * no worker, no calculation submitted, no AI request): section navigation, the Overview's result links, the Results
 * Library's exact counts, the result inspector, and the workspace deep links that must keep working.
 */

const PROJECT = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";
const BASE = `/en/projects/${PROJECT}`;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test("Overview, Results, the inspector and the Guided deep links agree on one published result", async ({ page, request }) => {
  await preferGuidedMode(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const published = (await (await request.get(`/api/chemdft/v1/projects/${PROJECT}/published-results?limit=200`)).json()) as Json;
  expect(published.total_published).toBe(published.rows.length);
  const energy = published.rows.find((row: Json) => row.task === "ENERGY");
  expect(energy, "the evidence project publishes an energy result").toBeTruthy();

  // Overview: identity, recommendation, results panel with links into the workspace
  await page.goto(`${BASE}/overview`);
  await expect(page.getByTestId("project-overview")).toBeVisible({ timeout: 45_000 });
  const panel = page.getByTestId("overview-results");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("link", { name: "Result", exact: true }).first()).toHaveAttribute("href", /selection=calculationResult/);

  // Overview → Results: the Library shows the server's exact published count
  await panel.getByRole("link", { name: "Results", exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`${BASE}/results$`));
  await expect(page.getByTestId("results-row")).toHaveCount(Math.min(published.rows.length, 50), { timeout: 30_000 });
  await expect(page.getByTestId("results-library")).toContainText(String(published.total_published));

  // Results → inspector (Results-owned page) and back
  const row = page.locator(`[data-testid="results-row"][data-result-id="${energy.result_id}"]`);
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: /inspect/i }).first().click();
  await expect(page).toHaveURL(new RegExp(`${BASE}/results/${energy.result_id}`));
  await expect(page.getByTestId("result-inspector")).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${BASE}/results$`));

  // The workspace deep link keeps working in Guided mode and opens the same published result
  await page.goto(`${BASE}/workspace?selection=calculationResult:${energy.result_id}&source=${energy.calculation_id}`);
  await expect(page.getByTestId("guided-result-picker")).toHaveValue(energy.result_id, { timeout: 45_000 });
  await expect(page.getByTestId("energy-precision-plate")).toHaveAttribute("data-result-id", energy.result_id);
  await expect(page.getByTestId("energy-precision-plate")).toHaveAttribute("data-calculation-id", energy.calculation_id);

  // Guided stages are reachable from here and project sections lead back to Results and Overview
  await page.getByTestId("guided-nav-structure").click();
  await expect(page.getByTestId("guided-stages")).toBeVisible();
  await page.getByTestId("project-section-results").click();
  await expect(page).toHaveURL(new RegExp(`${BASE}/results`));
  await page.getByTestId("project-section-overview").click();
  await expect(page.getByTestId("project-overview")).toBeVisible();
});
