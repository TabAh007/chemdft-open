import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { WATER_EXAMPLE_PROJECT_ID as PROJECT, preferGuidedMode, reachGuidedReview } from "./guided-helpers";
import { OUT, findings, startOutput, sweep, writeFindings } from "./hardening-helpers";

/**
 * Release 0.0.8 UI hardening pass on a DISPOSABLE COPY of the accepted evidence (python3 tools/rw2_evidence_stack.py):
 * the real Guided path up to Review (nothing is submitted), "Cite this calculation" on a genuine stored result, and an
 * audit (overflow, axe serious/critical, small tap targets) of Settings (ORCID panel), How to cite, Releases and the result
 * page at 1280, 768 and 375 px in light and dark colour schemes. Run:
 *   RW2_EVIDENCE_API_PORT=8191 RW2_EVIDENCE_WEB_PORT=3191 RW2_EVIDENCE_SPEC=e2e/hardening-0-0-8.spec.ts \
 *   HARDEN_OUT=/some/new/dir playwright test --config <copy of playwright.rw2-evidence.config.ts with channel chrome>
 * HARDEN_LOGIN_URL (optional) is a jwt-mode sign-in page to include in the audit.
 */
const API = "/api/chemdft";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);
test.beforeAll(() => startOutput());
test.afterAll(() => writeFindings());

test("Guided path: Structure, Configure and Review, without submitting", async ({ page }) => {
  await preferGuidedMode(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/projects/${PROJECT}/workspace`);
  await test.step("the Guided workspace opens on the committed structure", async () => {
    await expect(page.getByTestId("guided-nav-structure")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("guided-nav-structure").click();
    await expect(page.getByTestId("guided-structure-view")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: resolve(OUT, "guided-1-structure.png") });
  });
  await test.step("Configure offers calculation families, Review shows the setup and stays unsubmitted", async () => {
    await reachGuidedReview(page, /Energy|energy/);
    await expect(page.getByTestId("guided-review-stage")).toBeVisible();
    await expect(page.getByTestId("run-calculation-btn")).toBeDisabled(); // the explicit acknowledgement is not ticked
    await page.screenshot({ path: resolve(OUT, "guided-2-review.png") });
  });
});

test("Cite this calculation works on a genuine stored result and states only what is recorded", async ({ page, request }) => {
  const results = (await (await request.get(`${API}/v1/projects/${PROJECT}/results`)).json()) as Json[];
  const row = results.find((entry) => entry.result_type === "chemdft.energy") ?? results[0]!;
  const detail = (await (await request.get(`${API}/v1/projects/${PROJECT}/calculations/${row.calculation_id}`)).json()) as Json;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/en/projects/${PROJECT}/results/${row.id}`);
  const toggle = page.getByTestId("cite-toggle");
  if (!(await toggle.isVisible())) await page.getByRole("button", { name: /Export & reports/ }).first().click();
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  const output = page.getByTestId("cite-output");
  await expect(output).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: resolve(OUT, "cite-bibtex.png") });
  const text = async (format: string) => {
    await page.getByTestId(`cite-format-${format}`).click();
    return (await output.innerText()).trim();
  };
  const bibtex = await text("bibtex");
  expect(bibtex).toContain(detail.calculation.id);
  expect(bibtex).toContain("organization = {ChemDFT}"); // no ORCID, no personal author unless chosen
  expect(bibtex).not.toMatch(/orcid/i);
  const methods = await text("methods");
  expect(methods).toContain(detail.calculation.id);
  expect(methods).toContain(detail.calculation_input_hash);
  expect(methods).toContain(`${detail.result.producer_software.name} ${detail.result.producer_software.version}`);
  const json = JSON.parse(await text("json")) as Json;
  expect(json.schema).toBe("chemdft.calculation-citation.v1");
  expect(json.structure.calculation_input_sha256).toBe(detail.calculation_input_hash);
  expect(JSON.stringify(json)).not.toContain(detail.calculation.project_id); // no project identity in the record
  for (const format of ["ris", "apa", "plain", "references"]) expect((await text(format)).length).toBeGreaterThan(20);
  await page.screenshot({ path: resolve(OUT, "cite-methods.png") });
});

test("Settings (ORCID panel), How to cite, Releases and the result page: overflow, axe and tap targets in light and dark at three widths", async ({ page, request }) => {
  const results = (await (await request.get(`${API}/v1/projects/${PROJECT}/results`)).json()) as Json[];
  const row = results.find((entry) => entry.result_type === "chemdft.energy") ?? results[0]!;
  await sweep(page, "settings", async () => {
    await page.goto("/en/settings/general");
    await expect(page.getByTestId("orcid-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("orcid-panel")).not.toContainText("Loading ORCID status");
  });
  await sweep(page, "how-to-cite", async () => {
    await page.goto("/en/learn/cite");
    await expect(page.getByRole("heading", { name: "Cite the engines" })).toBeVisible();
  });
  await sweep(page, "releases", async () => {
    await page.goto("/en/releases");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
  await sweep(page, "result-cite", async () => {
    await page.goto(`/en/projects/${PROJECT}/results/${row.id}`);
    const toggle = page.getByTestId("cite-toggle");
    if (!(await toggle.isVisible())) await page.getByRole("button", { name: /Export & reports/ }).first().click();
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await expect(page.getByTestId("cite-output")).toBeVisible({ timeout: 15_000 });
  });
  const loginUrl = process.env.HARDEN_LOGIN_URL;
  if (loginUrl) {
    await sweep(page, "sign-in", async () => {
      await page.goto(loginUrl);
      await expect(page.getByTestId("login-orcid")).toBeVisible({ timeout: 20_000 });
    });
  }
  const serious = findings.filter((f) => f.axe.length > 0 || f.overflow);
  expect(serious, "no horizontal scroll and no serious or critical axe violations").toEqual([]);
});
