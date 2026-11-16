import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Navigation helpers for the Guided workspace (Structure → Configure → Review & Submit).
 * They drive only controls a researcher sees; none submits a calculation or an AI request.
 */

export const WATER_EXAMPLE_PROJECT_ID = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";

/** Start in Guided mode (the stored preference) before the first navigation. */
export async function preferGuidedMode(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem("chemdft:workspace-mode", "guided"); } catch { /* storage unavailable */ }
  });
}

/** Open the Guided Structure stage: the persistent molecular view and the committed-structure inspector. */
export async function openGuidedStructure(page: Page, projectId: string) {
  await page.goto(`/en/projects/${projectId}/workspace`);
  await page.waitForLoadState("domcontentloaded");
  const nav = page.getByTestId("guided-nav-structure");
  await expect(nav).toBeEnabled({ timeout: 25_000 });
  await nav.click();
  await expect(page.getByTestId("guided-workspace")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("guided-structure-view")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("guided-viewer").locator("canvas").first()).toBeVisible({ timeout: 20_000 });
}

/**
 * Open a published "Electronic structure" result (orbitals, density, ESP) from the Guided Results group.
 * "Energy & Orbitals" opens the newest published energy; the orbital view is a different published result that the
 * researcher picks from the Published result list.
 */
export async function openGuidedElectronicResult(page: Page) {
  await page.getByTestId("guided-nav-electronic").click();
  const picker = page.getByLabel("Published result");
  await expect(picker).toBeVisible({ timeout: 20_000 });
  const label = (await picker.locator("option").allTextContents()).find((text) => text.startsWith("Electronic structure"));
  expect(label, "the project publishes an Electronic structure result").toBeTruthy();
  await picker.selectOption({ label: label! });
  await expect(page.getByTestId("guided-result-view")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("guided-result-view").locator("canvas").first()).toBeVisible({ timeout: 20_000 });
}

/** The AI Scientist is a docked panel owned by the project shell, not a Guided button. Nothing is sent to it. */
export async function expectAiScientistDock(page: Page) {
  const panel = page.getByTestId("ai-scientist-panel");
  if (!(await panel.isVisible())) await page.getByTestId("ai-dock-toggle").click();
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("ai-current-view")).toBeVisible();
}

type Atom = { x: number; y: number; z: number };

/** The stored Cartesian coordinates (Å) of the project's newest structure version, straight from the API. */
export async function storedAtoms(request: APIRequestContext, projectId: string): Promise<Atom[]> {
  const structures = (await (await request.get(`/api/chemdft/v1/projects/${projectId}/structures`)).json()) as { id: string; latest_version_id: string }[];
  const head = structures[0]!;
  const detail = (await (await request.get(`/api/chemdft/v1/projects/${projectId}/structures/${head.id}/versions/${head.latest_version_id}`)).json()) as { version: { coordinates: { atoms: Atom[] } } };
  return detail.version.coordinates.atoms;
}

/** Reference values for measurement checks, derived from the stored coordinates instead of a remembered number. */
export function distanceAngstrom(a: Atom, b: Atom): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function angleDegrees(a: Atom, vertex: Atom, c: Atom): number {
  const u = [a.x - vertex.x, a.y - vertex.y, a.z - vertex.z];
  const v = [c.x - vertex.x, c.y - vertex.y, c.z - vertex.z];
  const dot = u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
  return (Math.acos(dot / (Math.hypot(...u) * Math.hypot(...v))) * 180) / Math.PI;
}

/**
 * Walk Structure → Configure → Review & Submit as a researcher would, choosing the calculation family, and stop
 * at Review. It confirms the electronic-state inputs (a draft decision kept in the browser) but NEVER submits.
 */
export async function reachGuidedReview(page: Page, family: string | RegExp) {
  await page.getByTestId("guided-nav-structure").click();
  const confirm = page.getByTestId("guided-primary-confirm-inputs");
  await expect(confirm.or(page.getByTestId("guided-primary-to-configure"))).toBeVisible({ timeout: 20_000 });
  if (await confirm.isVisible()) await confirm.click();
  await page.getByTestId("guided-primary-to-configure").click();

  const select = page.getByTestId("guided-family");
  await expect(select).toBeVisible({ timeout: 10_000 });
  const options = await select.locator("option").allTextContents();
  const label = options.find((text) => (typeof family === "string" ? text === family : family.test(text)));
  expect(label, `the Configure stage offers the "${String(family)}" calculation`).toBeTruthy();
  await select.selectOption({ label: label! });

  await page.getByTestId("guided-primary-to-review").click();
  await expect(page.getByTestId("guided-review-stage")).toBeVisible({ timeout: 10_000 });
}

/**
 * Structure → Configure for a project that has a committed structure: optionally set the electronic-state inputs
 * (charge, multiplicity), confirm them, and continue. Nothing is submitted.
 */
export async function openGuidedConfigure(page: Page, inputs: { charge?: number; multiplicity?: number } = {}) {
  const nav = page.getByTestId("guided-nav-structure");
  await expect(nav).toBeEnabled({ timeout: 25_000 });
  await nav.click();
  await expect(page.getByTestId("guided-structure-view")).toBeVisible({ timeout: 20_000 });
  if (inputs.charge !== undefined) await page.locator("#gw-charge").fill(String(inputs.charge));
  if (inputs.multiplicity !== undefined) await page.locator("#gw-multiplicity").fill(String(inputs.multiplicity));
  const confirm = page.getByTestId("guided-primary-confirm-inputs");
  await expect(confirm).toBeVisible({ timeout: 20_000 });
  await confirm.click();
  await page.getByTestId("guided-primary-to-configure").click();
  await expect(page.getByTestId("guided-calculation-setup")).toBeVisible({ timeout: 10_000 });
}

/** Configure → Review & Submit and tick the researcher's explicit acknowledgement. Does not press Submit. */
export async function reviewAndAcknowledge(page: Page) {
  await page.getByTestId("guided-primary-to-review").click();
  await expect(page.getByTestId("guided-review-stage")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("setup-confirm-checkbox").check();
  await expect(page.getByTestId("run-calculation-btn")).toBeEnabled();
}

/** After a calculation succeeded the panel offers "Open result"; a finished job is never opened automatically. */
export async function openResultFromJob(page: Page, timeout = 90_000) {
  await expect(page.getByTestId("guided-job-state")).toContainText("Succeeded", { timeout });
  await page.getByTestId("guided-primary-open-result").click();
}
