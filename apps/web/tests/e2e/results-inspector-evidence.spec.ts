import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Results inspector against genuine stored evidence on a DISPOSABLE COPY of the accepted native-engine database:
 *   python3 tools/rw2_evidence_stack.py --api-port 8191 --web-port 3191
 *   RW2_EVIDENCE_API_PORT=8191 RW2_EVIDENCE_WEB_PORT=3191 RW2_EVIDENCE_SPEC=e2e/results-inspector-evidence.spec.ts \
 *   playwright test --config playwright.rw2-evidence.config.ts
 * Every value asserted is compared with what the API itself stored and published; nothing is hard-coded. The test only
 * reads: stored results, artifacts and their SHA-256 hashes must be identical before and after the UI has been used.
 */
const PROJECT = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d"; // genuine PySCF results
const OTHER_PROJECT = "3537048e-306a-4f4f-9b9e-493681c0df83";
const API = "/api/chemdft";
const BASE = `/en/projects/${PROJECT}`;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

let row: Json;
let detail: Json;
let result: Json;
let snapshot = "";

async function storedState(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const results = (await (await request.get(`${API}/v1/projects/${PROJECT}/results`)).json()) as Json[];
  const hashes: string[] = [];
  for (const record of results) {
    for (const ref of record.raw_artifacts as Json[]) {
      const download = await request.get(`${API}/v1/projects/${PROJECT}/calculations/${record.calculation_id}/artifacts/${ref.artifact_id}`);
      expect(download.status()).toBe(200);
      expect(sha256(await download.body()), `artifact ${ref.artifact_id} still hashes to its recorded SHA-256`).toBe(ref.sha256);
      hashes.push(`${ref.artifact_id}:${ref.sha256}`);
    }
  }
  return JSON.stringify({ results, hashes });
}

test("setup: pick a stored single-point energy and record the stored state", async ({ request }) => {
  const page = (await (await request.get(`${API}/v1/projects/${PROJECT}/published-results?task=ENERGY&limit=1`)).json()) as Json;
  row = page.rows[0];
  expect(row?.result_id).toBeTruthy();
  detail = (await (await request.get(`${API}/v1/projects/${PROJECT}/calculations/${row.calculation_id}`)).json()) as Json;
  result = (await (await request.get(`${API}/v1/projects/${PROJECT}/results/${row.result_id}`)).json()) as Json;
  snapshot = await storedState(request);
});

test("the primary output is the stored energy, with its unit, convergence and the precise label", async ({ page }) => {
  await page.goto(`${BASE}/results/${result.id}`);
  await expect(page.getByTestId("primary-readout")).toBeVisible({ timeout: 60_000 });
  const stored = result.payload.total_energy;
  await expect(page.getByTestId("primary-value")).toHaveText((stored.value as number).toFixed(10));
  await expect(page.getByTestId("primary-value")).toHaveAttribute("title", `Stored value: ${stored.value}`);
  await expect(page.getByTestId("primary-unit")).toHaveText("Eh");
  await expect(page.getByTestId("primary-convergence")).toContainText(result.payload.converged ? "SCF converged" : "SCF not converged");
  await expect(page.getByTestId("primary-note")).toContainText("includes nuclear repulsion and is not the electronic-only component");
  expect(await page.locator("body").innerText()).not.toContain("Total electronic energy");
  await expect(page.getByTestId("primary-derived")).toContainText("Derived");
  // the stored value is shown once, prominently
  const body = await page.getByTestId("result-inspector").innerText();
  expect(body.split((stored.value as number).toFixed(10)).length - 1).toBe(1);
});

test("authority, validation, independent verification and standing are four separate stored facts", async ({ page }) => {
  await page.goto(`${BASE}/results/${result.id}`);
  const axes = page.locator("[data-testid=authority-panel] [data-axis]");
  await expect(axes).toHaveCount(4);
  await expect(page.locator('[data-axis="authority"]')).toContainText(result.authority === "AUTHORITATIVE" ? "Authoritative" : /./);
  await expect(page.locator('[data-axis="validation"]')).toContainText(new RegExp(result.validation_state, "i"));
  await expect(page.locator('[data-axis="verification"]')).toContainText(result.verification_state === "UNVERIFIED" ? "Not independently verified" : /./);
  await expect(page.getByTestId("standing-tag")).toHaveText(row.evidence_use === "CURRENT" ? "Current" : "Historical");
  await expect(page.getByTestId("authority-notes")).toContainText("Validation confirms the platform's checks passed, not that another method reproduced the value");
});

test("native evidence: derived quantities, display excerpt, and the original log downloaded byte-for-byte", async ({ page, request }) => {
  await page.goto(`${BASE}/results/${result.id}`);
  await page.getByTestId("section-toggle-evidence").click();
  const diagnostics = (await (await request.get(`${API}/v1/projects/${PROJECT}/compute/jobs/${detail.compute_job.id}/diagnostics`)).json()) as Json;
  const logArtifact = (diagnostics.attempts as Json[]).flatMap((a) => a.artifacts ?? []).find((a: Json) => a.kind === "ENGINE_LOG" && a.log_readable);
  expect(logArtifact, "the stored evidence has a readable PySCF log").toBeTruthy();
  await expect(page.getByTestId("native-quantities")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("evidence-classification")).toContainText("Evidence-derived, display only");
  await expect(page.getByTestId("log-scope-note")).toContainText("Display excerpt, not the original");
  await expect(page.getByTestId("log-original")).toContainText(logArtifact.sha256);
  // search and sections act on the excerpt
  const sections = await page.locator("[data-testid=log-sections] button").allInnerTexts();
  expect(sections).toContain("Convergence & final energy");
  await page.getByTestId("log-search").fill("converged SCF energy");
  await expect(page.getByTestId("log-match-count")).toContainText("1 of 1");
  await page.getByTestId("log-search").fill("");
  // the original: downloaded through the authorized route and identical to the stored artifact
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download original native log" }).click();
  const file = await download;
  const downloaded = readFileSync((await file.path())!);
  expect(sha256(downloaded)).toBe(logArtifact.sha256);
  const direct = await request.get(`${API}/v1/projects/${PROJECT}/calculations/${row.calculation_id}/artifacts/${logArtifact.artifact_id}`);
  expect(Buffer.compare(downloaded, await direct.body())).toBe(0);
  // the displayed excerpt is not the original
  const excerpt = await page.getByTestId("log-text").innerText();
  expect(excerpt.length).toBeLessThan(downloaded.length);
});

test("provenance and artifacts: recorded identifiers and hashes, input artifact integrity through the UI", async ({ page }) => {
  await page.goto(`${BASE}/results/${result.id}`);
  await page.getByTestId("section-toggle-provenance").click();
  const facts = page.getByTestId("provenance-facts");
  await expect(facts).toContainText(result.id);
  await expect(facts).toContainText(detail.calculation.id);
  await expect(facts).toContainText(detail.calculation_input_hash);
  await expect(facts).toContainText(result.producer_attestation_id);
  await expect(facts).toContainText("UTC:");
  await page.getByTestId("provenance-toggle").click();
  await expect(page.getByTestId("provenance-inspector")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("section-toggle-artifacts").click();
  const refs = result.raw_artifacts as Json[];
  await expect(page.locator("[data-testid=artifacts-table] tbody tr")).toHaveCount(refs.length);
  const input = refs.find((ref) => ref.sha256 === detail.calculation_input_hash)!;
  const row = page.locator(`[data-artifact-id="${input.artifact_id}"]`);
  await expect(row).toContainText("Immutable calculation input");
  const download = page.waitForEvent("download");
  await row.getByTestId("artifact-download").click();
  const file = await download;
  expect(sha256(readFileSync((await file.path())!))).toBe(detail.calculation_input_hash);
});

test("coordinates are the immutable input, and export is catalog-driven", async ({ page, request }) => {
  await page.goto(`${BASE}/results/${result.id}`);
  await page.getByTestId("section-toggle-coordinates").click();
  await expect(page.locator("[data-testid=coordinates-table] tbody tr")).toHaveCount(row.atom_count);
  await page.getByTestId("section-toggle-export").click();
  await expect(page.getByTestId("export-panel")).toBeVisible({ timeout: 30_000 });
  const catalog = (await (await request.get(`${API}/v1/projects/${PROJECT}/calculations/${row.calculation_id}/exports`)).json()) as Json;
  for (const format of catalog.formats as Json[]) {
    await expect(page.getByTestId(`export-${format.format}`)).toHaveAttribute("data-available", format.available ? "true" : "false");
  }
});

test("another project cannot open this project's result, and nothing in the stored evidence changed", async ({ page, request }) => {
  await page.goto(`/en/projects/${OTHER_PROJECT}/results/${result.id}`);
  const error = page.getByTestId("result-error");
  await expect(error).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("primary-readout")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toContain((result.payload.total_energy.value as number).toFixed(10));
  expect(await storedState(request), "stored results and every artifact hash are unchanged after using the UI").toBe(snapshot);
});
