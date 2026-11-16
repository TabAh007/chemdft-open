import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openGuidedConfigure, openResultFromJob, preferGuidedMode, reviewAndAcknowledge } from "./guided-helpers";

/**
 * RW-1 researcher journey on a DISPOSABLE stack (python3 tools/run_isolated_e2e.py --suite rw1-journey).
 * Real xTB execution through the accepted API and worker; nothing here touches the persistent database.
 * Scientific assertions compare the UI with the API's own published result; no value is hard-coded.
 */

const SHOTS = resolve(process.env.CHEMDFT_RW1_SHOTS ?? "../../output/rw1-review");
mkdirSync(SHOTS, { recursive: true });

const WATER_XYZ = `3
Water RW-1 fixture
O 0.00000000 0.00000000 0.11730000
H 0.00000000 0.75720000 -0.46920000
H 0.00000000 -0.75720000 -0.46920000
`;
const IODOMETHANE_XYZ = `5
Iodomethane RW-1 fixture (Z=53 present)
C 0.00000000 0.00000000 -1.08000000
I 0.00000000 0.00000000 1.06000000
H 1.02800000 0.00000000 -1.43000000
H -0.51400000 0.89000000 -1.43000000
H -0.51400000 -0.89000000 -1.43000000
`;

type Json = Record<string, unknown>;
const API = "/api/chemdft";

async function createProjectWithStructure(request: APIRequestContext, xyz: string, name: string) {
  const slug = `rw1-${randomUUID().slice(0, 12)}`;
  const project = await (await request.post(`${API}/v1/projects`, { data: { name: `RW-1 ${name}`, slug } })).json() as Json;
  const imported = await request.post(`${API}/v1/projects/${project.id}/structures/imports`, {
    multipart: {
      upload: { name: `${slug}.xyz`, mimeType: "chemical/x-xyz", buffer: Buffer.from(xyz) },
      file_format: "XYZ", idempotency_key: `rw1-${randomUUID()}`, structure_name: name,
    },
  });
  expect(imported.status(), await imported.text()).toBe(201);
  return { projectId: project.id as string };
}

test.describe("RW-1 researcher workstation", () => {
  test.setTimeout(240_000);

  test("project to structure to xTB energy to job to validated result to provenance", async ({ page, request }) => {
    const { projectId } = await createProjectWithStructure(request, WATER_XYZ, "Water");
    await page.setViewportSize({ width: 1440, height: 900 });

    // PROJECT -> STRUCTURE
    await preferGuidedMode(page);
    await page.goto(`/en/projects/${projectId}/workspace`);
    await expect(page.getByTestId("guided-project-home")).toBeVisible({ timeout: 45_000 });
    await page.getByTestId("guided-nav-structure").click();
    const structureView = page.getByTestId("guided-structure-view");
    await expect(structureView).toContainText("Atoms3", { timeout: 30_000 });
    await expect(structureView).toContainText("Supplied by you"); // an import is the researcher's own, unreviewed input
    await expect(structureView.locator("dt:has-text('Formula') + dd")).toHaveText("H₂O");
    // XYZ carries no connectivity; bonds are labelled as inferred
    await expect(page.getByTestId("structure-connectivity")).toContainText("No source-provided authoritative bonds");
    const canvas = page.getByTestId("guided-viewer").locator("canvas").first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box && box.width > 100 && box.height > 100).toBeTruthy();
    await page.screenshot({ path: `${SHOTS}/01-structure.png` });

    // CALCULATION SETUP (engine list comes from the backend capability response)
    // The electronic-state inputs are confirmed on the Structure stage before Configure opens
    await page.getByTestId("guided-primary-confirm-inputs").click();
    await page.getByTestId("guided-primary-to-configure").click();
    const setup = page.getByTestId("guided-calculation-setup");
    await expect(setup).toBeVisible();
    const capabilities = await (await request.get(`${API}/v1/projects/${projectId}/calculations/capabilities`)).json() as Json[];
    const xtb = capabilities.find((item) => item.engine === "xtb")!;
    expect(xtb.availability, "isolated stack must have xTB available").toBe("AVAILABLE");
    await page.getByTestId("guided-engine-xtb-btn").click();
    await page.screenshot({ path: `${SHOTS}/02-setup.png` });

    // SCIENTIFIC EXECUTION -> JOB STATUS -> VALIDATED RESULT
    await reviewAndAcknowledge(page);
    await page.getByTestId("run-calculation-btn").click();
    await expect(page.getByTestId("guided-job-panel")).toBeVisible({ timeout: 30_000 });
    // A finished job is not opened automatically; the job panel offers "Open result"
    await openResultFromJob(page, 150_000);
    const state = page.getByTestId("scientific-state");
    await expect(state).toBeVisible({ timeout: 150_000 });
    await expect(state).toHaveAttribute("data-currently-authoritative", "true");
    await expect(state).toContainText("Authoritative engine result");
    await expect(state.locator('[data-axis="authority"]')).toContainText("Authoritative");
    await expect(state.locator('[data-axis="validation"]')).toContainText("Validated");
    await expect(state.locator('[data-axis="verification"]')).toContainText("Not independently verified");
    await expect(state).not.toContainText(/\bVERIFIED\b/);
    await page.screenshot({ path: `${SHOTS}/03-result.png` });

    // UI must show the API's published numbers, not derived or fabricated ones.
    const results = await (await request.get(`${API}/v1/projects/${projectId}/results`)).json() as Json[];
    expect(results).toHaveLength(1);
    const result = results[0]!;
    const effective = result.effective_state as Json;
    expect([effective.authority, effective.validation_state, effective.verification_state, effective.source_lineage_validity])
      .toEqual(["AUTHORITATIVE", "VALIDATED", "UNVERIFIED", "ACTIVE"]);
    const energy = ((result.payload as Json).total_energy as Json).value as number;
    expect(Number.isFinite(energy) && energy < 0).toBe(true);
    await expect(page.getByTestId("energy-precision-plate")).toContainText(energy.toFixed(10));

    // PROVENANCE
    await page.getByTestId("provenance-toggle").click();
    const inspector = page.getByTestId("provenance-inspector");
    await expect(inspector).toBeVisible({ timeout: 15_000 });
    const software = result.producer_software as Json;
    await expect(inspector).toContainText(String(software.name));
    await expect(inspector).toContainText(String(software.environment_digest));
    const rawArtifacts = result.raw_artifacts as Json[];
    expect(rawArtifacts.length).toBeGreaterThan(0);
    for (const artifact of rawArtifacts) await expect(inspector).toContainText(String(artifact.sha256));
    const exportHref = await page.getByTestId("lineage-export-link").getAttribute("href");
    const exported = await request.get(exportHref!);
    expect(exported.status()).toBe(200);
    expect((await exported.json() as Json).schema).toBe("chemdft.result-lineage-export.v1");
    await page.screenshot({ path: `${SHOTS}/04-provenance.png` });

    // JOBS (a project section; the Guided sidebar no longer duplicates it)
    await page.getByTestId("project-section-jobs").click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/jobs`));
    const rows = page.getByTestId("job-row");
    await expect(rows).toHaveCount(1, { timeout: 20_000 });
    await expect(rows.first()).toHaveAttribute("data-job-state", "SUCCEEDED");
    await expect(rows.first()).toContainText("Single-point energy");
    await expect(rows.first()).toContainText("xTB");
    await expect(rows.first()).toContainText("Succeeded");
    await page.screenshot({ path: `${SHOTS}/05-jobs.png` });
    const apiJobs = (await (await request.get(`${API}/v1/projects/${projectId}/compute/jobs`)).json() as { jobs: Json[] }).jobs;
    expect(apiJobs).toHaveLength(1);
    expect(apiJobs[0]!.state).toBe("SUCCEEDED");

    // Back to the result through the job (deep link keeps working)
    await page.getByTestId("job-open").click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/workspace\\?selection=calculation`));
    await expect(page.getByTestId("project-shell")).toBeVisible();
  });

  test("authorization boundaries and unknown projects", async ({ page, request }) => {
    const { projectId } = await createProjectWithStructure(request, WATER_XYZ, "Auth");
    const me = await (await request.get(`${API}/v1/me`)).json() as Json;
    // Browser-supplied identity headers never reach the API; the server-resolved identity is unchanged.
    const forged = await (await request.get(`${API}/v1/me`, {
      headers: { "X-ChemDFT-User-ID": randomUUID(), "X-ChemDFT-Organization-ID": randomUUID() },
    })).json() as Json;
    expect(forged.id).toBe(me.id);
    // A project that does not exist (or is not visible) is reported as unavailable, never rendered empty.
    const missing = randomUUID();
    expect((await request.get(`${API}/v1/projects/${missing}`)).status()).toBe(404);
    await page.goto(`/en/projects/${missing}/workspace`);
    await expect(page.locator("main.project-availability-state")).toContainText("no longer available", { timeout: 30_000 });
    // The real project remains reachable and its result list is project-scoped.
    expect((await request.get(`${API}/v1/projects/${projectId}/results`)).status()).toBe(200);
    expect((await request.get(`${API}/v1/projects/${missing}/results/${randomUUID()}/provenance`)).status()).toBe(404);
  });

  test("PySCF basis choices follow the backend element limits", async ({ page, request }) => {
    const { projectId } = await createProjectWithStructure(request, IODOMETHANE_XYZ, "Iodomethane");
    const capabilities = await (await request.get(`${API}/v1/projects/${projectId}/calculations/capabilities`)).json() as Json[];
    const pyscf = capabilities.find((item) => item.engine === "pyscf")!;
    test.skip(pyscf.availability !== "AVAILABLE", "PySCF is not available on this stack");
    const limits = pyscf.max_atomic_number_by_basis as Record<string, number>;
    expect(limits["def2-svp"]).toBe(36);
    expect(limits["sto-3g"]).toBe(53);

    await page.setViewportSize({ width: 1440, height: 900 });
    await preferGuidedMode(page);
    await page.goto(`/en/projects/${projectId}/workspace`);
    await expect(page.getByTestId("guided-project-home")).toBeVisible({ timeout: 45_000 });
    await openGuidedConfigure(page);
    await page.getByTestId("guided-engine-pyscf-btn").click();
    await page.getByText("Advanced settings", { exact: true }).click();
    const basis = page.locator("#calc-basis");
    await expect(basis).toBeVisible();
    // Iodine (Z = 53): STO-3G covers it; 6-31G and the def2 bases do not.
    await expect(basis.locator('option[value="sto-3g"]')).toBeEnabled();
    for (const unavailable of ["6-31g", "def2-svp", "def2-svpd"]) {
      await expect(basis.locator(`option[value="${unavailable}"]`)).toBeDisabled();
    }
    await reviewAndAcknowledge(page); // STO-3G is selectable for this structure, so Review can be confirmed
    await expect(page.getByTestId("run-calculation-btn")).toBeEnabled();
    await page.screenshot({ path: `${SHOTS}/06-basis-limits.png` });
  });

  test("every published result type opens in its existing viewer with real engine data", async ({ page, request }) => {
    test.setTimeout(600_000);
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      void Promise.all(message.args().map((arg) => arg.jsonValue().catch(() => "?")))
        .then((values) => consoleErrors.push(`${message.text().slice(0, 140)} :: ${JSON.stringify(values.slice(1)).slice(0, 200)}`));
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && response.url().includes("/api/chemdft/")) {
        consoleErrors.push(`HTTP ${response.status()} ${response.request().method()} ${response.url().replace(/^https?:\/\/[^/]+/, "")}`);
      }
    });
    const { projectId } = await createProjectWithStructure(request, WATER_XYZ, "Water results");
    const structures = await (await request.get(`${API}/v1/projects/${projectId}/structures`)).json() as Json[];
    const versions = await (await request.get(`${API}/v1/projects/${projectId}/structures/${structures[0]!.id}/versions`)).json() as Json[];
    const versionId = (versions[0]!.version as Json).id as string;

    const base = (task: string, engine: string, method: string, basis: string | null, extra: Json = {}) => ({
      structure_version: { project_id: projectId, entity_type: "structure.version", entity_id: versionId },
      specification: {
        task_type: task, engine_preference: { engine },
        method: { identifier: method, display_name: method.toUpperCase(), registry: "chemdft.method" },
        basis: basis ? { identifier: basis, display_name: basis.toUpperCase(), registry: "chemdft.basis" } : null,
        charge: 0, multiplicity: 1, ...extra,
      },
      provider_preference: "AUTO", idempotency_key: `rw1-${randomUUID()}`,
    });
    const scf = { scf: { convergence_threshold: 1e-9 } };
    const requests: Array<[string, Json]> = [
      ["optimization", base("GEOMETRY_OPTIMIZATION", "xtb", "gfn2", null, { optimization: { optimizer: "xtb-ancopt", xtb_level: "normal", max_steps: 100 } })],
      ["energy", base("ENERGY", "pyscf", "hf", "sto-3g", scf)],
      ["orbitals", base("ORBITAL", "pyscf", "hf", "sto-3g", scf)],
      ["frequency", base("FREQUENCY", "pyscf", "hf", "sto-3g", { ...scf, hessian: { strategy: "ANALYTIC", exclude_translation_rotation: true, coordinate_unit: "angstrom", hessian_unit: "Eh/bohr^2", frequency_unit: "cm^-1" } })],
      ["tddft", base("TDDFT", "pyscf", "b3lyp", "def2-svp", { scf: { convergence_threshold: 1e-7 }, tddft: { nstates: 5, spin: "singlet", gauge: "length", conv_tol: 1e-7 } })],
    ];
    const submitted: Array<{ label: string; calculationId: string }> = [];
    for (const [label, payload] of requests) {
      const response = await request.post(`${API}/v1/projects/${projectId}/calculations`, { data: payload });
      expect(response.status(), `${label}: ${await response.text()}`).toBeLessThan(300);
      submitted.push({ label, calculationId: ((await response.json()) as { calculation: Json }).calculation.id as string });
    }
    // Wait for every job to reach a terminal state through the API (the same state the Jobs page shows).
    await expect.poll(async () => {
      const jobs = (await (await request.get(`${API}/v1/projects/${projectId}/compute/jobs`)).json() as { jobs: Json[] }).jobs;
      return jobs.filter((job) => !["SUCCEEDED", "FAILED", "CANCELED"].includes(job.state as string)).length;
    }, { timeout: 420_000, intervals: [2_000] }).toBe(0);

    const results = await (await request.get(`${API}/v1/projects/${projectId}/results`)).json() as Json[];
    const report: Array<Json> = [];
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const item of submitted) {
      const detail = await (await request.get(`${API}/v1/projects/${projectId}/calculations/${item.calculationId}`)).json() as Json;
      const calc = detail.calculation as Json;
      const result = results.find((row) => row.calculation_id === item.calculationId);
      const entry: Json = { label: item.label, calculationState: calc.state, resultType: result?.result_type ?? null };
      if (!result) { entry.note = String((detail.attempt as Json | null)?.diagnostic ?? "no result published"); report.push(entry); continue; }
      const selection = `calculationResult:${result.id}`;
      for (const mode of ["guided", "advanced"] as const) {
        await page.goto(`/en/projects/${projectId}/workspace?selection=${encodeURIComponent(selection)}&source=${item.calculationId}`);
        await expect(page.getByTestId("project-shell")).toBeVisible({ timeout: 45_000 });
        const toggle = page.getByTestId(mode === "guided" ? "mode-toggle-guided" : "mode-toggle-advanced");
        if (await toggle.isVisible().catch(() => false)) await toggle.click();
        await page.waitForTimeout(2500);
        const strip = page.getByTestId("scientific-state");
        entry[`${mode}Strip`] = await strip.first().isVisible().catch(() => false);
        entry[`${mode}Canvases`] = await page.locator("main canvas").count();
        entry[`${mode}Svgs`] = await page.locator("main svg[role='img'], main .echarts, main [_echarts_instance_]").count();
        entry[`${mode}Text`] = (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 400);
        await page.screenshot({ path: `${SHOTS}/results-${item.label}-${mode}.png` });
      }
      report.push(entry);
    }
    const out = resolve(SHOTS, "result-inventory.json");
    (await import("node:fs")).writeFileSync(out, JSON.stringify({ report, consoleErrors }, null, 2));
    // Minimal contract: every successful result is shown with its scientific state in at least one mode.
    for (const entry of report.filter((row) => row.resultType)) {
      expect(entry.guidedStrip || entry.advancedStrip, `${entry.label} shows scientific state`).toBe(true);
    }
  });
});
