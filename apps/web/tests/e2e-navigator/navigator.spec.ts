import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import type { NavigatorState } from "@chemdft/schemas";

const axe = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const water = readFileSync(resolve(process.cwd(), "../../services/api/tests/fixtures/structures/test-user-supplied-water.xyz"));
const crystal = readFileSync(resolve(process.cwd(), "src/app/_components/home/reference/cod-9014036-cr2o3.cif"));

async function readableInViewport(element: Locator) {
  return element.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const main = document.querySelector(".project-document")!.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    return rect.top >= main.top && rect.bottom <= window.innerHeight &&
      rect.left >= 0 && rect.right <= window.innerWidth &&
      el.contains(document.elementFromPoint(x, y));
  });
}

// Input events only: never set scrollTop or call scrollIntoView to reach an assertion target.
async function wheelTo(page: Page, element: Locator) {
  const x = await element.evaluate(el => {
    const rect = (el.closest('[data-testid="project-navigator"]') ?? el).getBoundingClientRect();
    return rect.left + Math.min(180, rect.width / 2);
  });
  await page.mouse.move(x, 600);
  for (let step = 0; step < 24 && !(await readableInViewport(element)); step++) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(80); // Browser wheel/compositor settling, not application loading.
  }
  expect(await readableInViewport(element)).toBe(true);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`ordinary wheel and PageDown reach all Overview content at ${viewport.width}px`, async ({ page, request }) => {
    const id = await project(request, "water");
    await page.setViewportSize(viewport);
    await page.goto(`/en/projects/${id}/overview`);
    const panel = page.getByTestId("project-navigator");
    const main = page.locator(".project-document");
    await expect(panel).toContainText("Molecular structure");
    expect(await main.evaluate(el => el.scrollTop)).toBe(0);
    await expandAll(panel);
    const finalAction = panel.getByRole("link", { name: "Edit structure: Edit molecular structure" });
    await wheelTo(page, finalAction);
    await expect(finalAction).toBeEnabled();
    // "Expand all" (used above) opened every "More workflows" and "Unavailable" disclosure.
    // The last unavailable-workflow reason is the end of the catalogue: it must be reachable with input events alone.
    const reasons = panel.locator("[data-reason-code]");
    expect(await reasons.count()).toBeGreaterThan(0);
    const lastReason = reasons.last();
    await wheelTo(page, lastReason);
    const bottom = panel.locator("footer p").last();
    await wheelTo(page, bottom);
    expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
    expect(await panel.evaluate(el => {
      let current: Element | null = el;
      const scrollers = [];
      while (current) {
        const style = getComputedStyle(current);
        if (/auto|scroll/.test(style.overflowY) && current.scrollHeight > current.clientHeight) scrollers.push(current.className);
        current = current.parentElement;
      }
      return scrollers;
    })).toEqual(["project-document"]);

    // A fresh navigation starts at the top; keyboard focus and input must reach the same real bottom.
    await page.goto(`/en/projects/${id}/overview`);
    await expect(panel).toContainText("Molecular structure");
    expect(await main.evaluate(el => el.scrollTop)).toBe(0);
    // The full catalogue is a "Browse all workflows" disclosure that starts closed; a researcher opens it, then scrolls.
    await openBrowse(panel);
    await panel.getByRole("heading", { name: "Project Navigator", exact: true }).click();
    await page.keyboard.press("PageDown");
    await expect.poll(() => main.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    for (let step = 0; step < 12 && !(await readableInViewport(bottom)); step++) {
      await page.keyboard.press("PageDown");
      await page.waitForTimeout(80);
    }
    expect(await readableInViewport(bottom)).toBe(true);
  });

  test(`Guided home keeps its established content scroller at ${viewport.width}px`, async ({ page, request }) => {
    const id = await project(request, "water");
    await page.setViewportSize(viewport);
    await page.goto(`/en/projects/${id}/workspace`);
    await page.getByTestId("mode-toggle-guided").click();
    // The full catalogue is a collapsed disclosure on Guided home and is mounted only when opened
    await expect(page.getByTestId("guided-project-home")).toBeVisible();
    await expect(page.getByTestId("project-navigator")).toHaveCount(0);
    await page.getByTestId("guided-navigator-details").locator("summary").click();
    const panel = page.getByTestId("guided-project-home").getByTestId("project-navigator");
    await expect(panel).toContainText("Molecular structure");
    await expect(page.locator(".project-overview")).toHaveCount(0);
    expect(await page.locator(".project-document").evaluate(el => getComputedStyle(el).overflowY)).toBe("hidden");
    expect(await page.locator(".guided-view-pane").evaluate(el => getComputedStyle(el).overflowY)).toBe("auto");
    await wheelTo(page, panel.locator("footer p").last());
    expect(await page.locator(".guided-view-pane").evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator(".project-document").evaluate(el => el.scrollTop)).toBe(0);
  });
}

test("Overview fix leaves Advanced workbench and other route scroll owners unchanged", async ({ page, request }) => {
  const id = await project(request, "water");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/projects/${id}/overview`);
  const panel = page.getByTestId("project-navigator");
  await expect(panel).toContainText("Molecular structure");
  await expandAll(panel);
  await panel.getByRole("link", { name: "Configure optimization: Optimize the geometry" }).last().click(); // the catalogue entry (the Continue list may show it too)
  await expect(page.locator(".calculation-panel")).toBeVisible();
  expect(await page.locator(".project-document").evaluate(el => getComputedStyle(el).overflowY)).toBe("hidden");
  const workbench = page.getByRole("tabpanel", { name: "Project workbench", exact: true });
  expect(await workbench.evaluate(el => getComputedStyle(el).overflowY)).toBe("auto");
  await page.mouse.move(580, 650);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => workbench.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator(".project-overview")).toHaveCount(0);
  for (const route of ["jobs", "settings"]) {
    await page.goto(`/en/projects/${id}/${route}`);
    await expect(page.locator(".project-shell")).toBeVisible();
    await expect(page.locator(".project-overview")).toHaveCount(0);
    // These regular document routes already use the base Advanced document scroller.
    expect(await page.locator(".project-document").evaluate(el => getComputedStyle(el).overflowY)).toBe("auto");
  }
});

// The Overview shows one recommendation and a short "Continue your research" list. "Browse all workflows" holds the
// complete catalogue (goal selector, grouped workflows, "More workflows", "Unavailable" reasons).
async function openBrowse(panel: Locator) {
  const browse = panel.getByTestId("browse-workflows");
  if (!(await browse.evaluate(element => (element as HTMLDetailsElement).open))) await browse.locator("summary").first().click(); // the disclosure's own summary; nested groups have theirs
}
async function expandAll(panel: Locator) {
  await openBrowse(panel);
  const button = panel.getByRole("button", { name: "Expand all" });
  if (await button.count()) await button.click();
}

async function project(request: APIRequestContext, kind?: "water" | "crystal") {
  const created = await request.post("/api/chemdft/v1/projects", { data: { name: "PF-4 Navigator verification", slug: `navigator-${Date.now()}-${Math.random().toString(16).slice(2)}` } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  if (kind) {
    const response = await request.post(`/api/chemdft/v1/projects/${id}/structures/imports`, { multipart: {
      upload: { name: kind === "water" ? "water.xyz" : "cr2o3.cif", mimeType: kind === "water" ? "chemical/x-xyz" : "chemical/x-cif", buffer: kind === "water" ? water : crystal },
      file_format: kind === "water" ? "XYZ" : "CIF", structure_name: kind === "water" ? "Water" : "α-Cr₂O₃ · COD 9014036", idempotency_key: crypto.randomUUID(),
    } });
    expect(response.status()).toBe(201);
  }
  return id as string;
}

async function navigator(request: APIRequestContext, id: string): Promise<NavigatorState> {
  const response = await request.get(`/api/chemdft/v1/projects/${id}/navigator`);
  expect(response.status()).toBe(200);
  return response.json();
}

test("empty overview and Guided home both use server Navigator; import opens existing file control", async ({ page, request }) => {
  const id = await project(request);
  await page.goto(`/en/projects/${id}/overview`);
  const panel = page.getByTestId("project-navigator");
  await expect(panel).toContainText("No scientific assets have been recorded yet.");
  await expect(panel.getByRole("link", { name: "Import structure: Import a structure" })).toBeVisible();
  const filePromise = page.waitForEvent("filechooser");
  await panel.getByRole("link", { name: "Import structure: Import a structure" }).click();
  const file = await filePromise;
  expect(await file.element().getAttribute("id")).toBe("structure-upload");
  await page.getByTestId("mode-toggle-guided").click();
  await page.getByTestId("guided-navigator-details").locator("summary").click();
  await expect(page.getByTestId("guided-project-home").getByTestId("project-navigator")).toContainText("No scientific assets");
});

test("molecule energy and optimization deep links select the real task without submitting", async ({ page, request }) => {
  const id = await project(request, "water");
  await page.goto(`/en/projects/${id}/overview`);
  const panel = page.getByTestId("project-navigator");
  await expect(panel).toContainText("Molecular structure");
  await expandAll(panel);
  await panel.getByRole("link", { name: "Configure optimization: Optimize the geometry" }).last().click(); // the catalogue entry (the Continue list may show it too)
  await expect(page.locator(".calculation-panel")).toBeVisible();
  await expect(page.locator(".calculation-panel").getByLabel(/Task/)).toHaveValue("GEOMETRY_OPTIMIZATION");
  const state = await navigator(request, id);
  expect(state.facts_summary.running_jobs).toBe(0);
  await page.goto(`/en/projects/${id}/overview`);
  await openBrowse(panel);
  await panel.getByLabel("Goal", { exact: true }).selectOption("energy");
  await expandAll(panel);
  await panel.getByRole("link", { name: "Configure calculation: Calculate single-point energy" }).last().click(); // the catalogue entry (the Continue list may show it too)
  await expect(page.locator(".calculation-panel").getByLabel(/Task/)).toHaveValue("ENERGY");
  expect((await navigator(request, id)).facts_summary.running_jobs).toBe(0);
});

test("thermochemistry names the missing optimization, frequency and stationarity gates", async ({ page, request }) => {
  const id = await project(request, "water");
  await page.goto(`/en/projects/${id}/overview`);
  const panel = page.getByTestId("project-navigator");
  await openBrowse(panel);
  await expect(panel.getByLabel("Goal", { exact: true })).toBeEnabled();
  await panel.getByLabel("Goal", { exact: true }).selectOption("thermochemistry");
  const blocked = panel.locator('[data-action-id="thermochemistry.calculate"]');
  await expect(blocked).toContainText("frequency calculation");
  await expect(blocked).toContainText("converged optimization");
  await expect(blocked).toContainText("final optimization gradient");
  await expect(blocked.getByRole("link")).toHaveCount(0);
});

test("Cr2O3 exposes existing cell and supercell controls and withholds molecular computation", async ({ page, request }) => {
  const id = await project(request, "crystal");
  await page.goto(`/en/projects/${id}/overview`);
  const panel = page.getByTestId("project-navigator");
  await expect(panel).toContainText("Crystal structure");
  await expect(panel).toContainText("Periodic DFT execution is not supported");
  await expect(panel.getByRole("link", { name: /Optimize|single-point|Predict/ })).toHaveCount(0);
  await expandAll(panel);
  await panel.getByRole("link", { name: "View supercell: View a supercell" }).last().click(); // the catalogue entry (the Continue list may show it too)
  await expect(page.getByTestId("structure-version-workbench")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Supercell", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Supercell", exact: true }).selectOption("2x2x2");
  await expect(page.getByRole("checkbox", { name: "Unit cell", exact: true })).toBeChecked();
});

test("experimental import and forged action links preserve server prerequisites", async ({ page, request }) => {
  const id = await project(request, "water");
  await page.goto(`/en/projects/${id}/overview`);
  const panel = page.getByTestId("project-navigator");
  await expandAll(panel);
  await panel.getByRole("link", { name: "Import spectrum: Import an experimental spectrum" }).last().click(); // the catalogue entry (the Continue list may show it too)
  await expect(page.getByTestId("import-spectrum-dialog")).toBeVisible();
  await page.goto(`/en/projects/${id}/workspace?navigator_action=thermochemistry.calculate`);
  // A forged link cannot turn a blocked action into an automatic launch or calculation.
  await expect(page.getByText("This action is no longer available", { exact: false })).toBeVisible();
  expect((await navigator(request, id)).facts_summary.running_jobs).toBe(0);
});

test("mobile Navigator has no overflow; semantic controls are keyboard reachable and accessible", async ({ page, request }) => {
  const id = await project(request, "water");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/projects/${id}/overview`);
  const panel = page.getByTestId("project-navigator");
  await expect(panel).toContainText("Molecular structure");
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
  await openBrowse(panel);
  await panel.getByLabel("Goal", { exact: true }).focus();
  await expect(panel.getByLabel("Goal", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "Expand all" })).toBeFocused();
  await page.addScriptTag({ content: axe });
  const violations = await page.evaluate(async () => {
    const axeWindow = window as unknown as { axe: { run: (context: Element, options: object) => Promise<{ violations: { id: string; impact: string }[] }> } };
    return (await axeWindow.axe.run(document.querySelector('[data-testid="project-navigator"]')!, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations;
  });
  expect(violations).toEqual([]);
});
