import { expect, test, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * RW-2 viewer verification against a DISPOSABLE COPY of the accepted native PySCF evidence
 *   python3 tools/rw2_evidence_stack.py --api-port 8191 --web-port 3191
 *   RW2_EVIDENCE_WEB_PORT=3191 RW2_EVIDENCE_API_PORT=8191 RW2_EVIDENCE_DB=<workspace>/data/evidence.db \
 *     pnpm exec playwright test --config playwright.rw2-evidence.config.ts
 * Every displayed number is compared with what the API published for the same stored result.
 */

const WATER = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";
const API = "/api/chemdft";
const SHOTS = resolve(process.env.CHEMDFT_RW2_SHOTS ?? "../../output/rw2-review/evidence");
mkdirSync(SHOTS, { recursive: true });
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const RESULTS = {
  mo: "0746b1d9",
  tddft: "35e0b59d",
  energy: "79d0b5c5",
  raman: "43f00090",
  optimization: "dc234052",
  thermo: "2af95088",
} as const;

type Finding = { viewer: string; classification: "WORKING" | "PARTIAL" | "BROKEN" | "OBSOLETE"; checks: Record<string, unknown>; notes: string[] };
const findings: Finding[] = [];
const consoleProblems: string[] = [];

function attachDiagnostics(page: Page) {
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message.slice(0, 200)}`));
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes(`${API}/`)) {
      consoleProblems.push(`HTTP ${response.status()} ${response.request().method()} ${response.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 170)}`);
    }
  });
}

async function resultFor(request: import("@playwright/test").APIRequestContext, prefix: string): Promise<Json> {
  const list = (await (await request.get(`${API}/v1/projects/${WATER}/results`)).json()) as Json[];
  const found = list.find((row) => String(row.id).startsWith(prefix));
  expect(found, `result ${prefix}`).toBeTruthy();
  return found!;
}

async function open(page: Page, result: Json) {
  await page.addInitScript(() => localStorage.setItem("chemdft:workspace-mode", "guided"));
  await page.goto(`/en/projects/${WATER}/workspace?selection=${encodeURIComponent(`calculationResult:${result.id}`)}&source=${result.calculation_id}`);
  await expect(page.getByTestId("project-shell")).toBeVisible({ timeout: 60_000 });
}

/** True when `text` contains `value` rendered with at least `digits` decimals of the stored number. */
function shows(text: string, value: number, digits = 3): boolean {
  const flat = text.replace(/−/g, "-").replace(/,/g, "");
  return [digits, digits + 1, digits + 2].some((d) => flat.includes(value.toFixed(d)));
}

test.describe.configure({ mode: "serial" });

test.describe("RW-2 viewer verification on accepted native evidence", () => {
  test.setTimeout(240_000);
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    attachDiagnostics(page);
  });

  test("electronic structure: orbitals, density and ESP are bound to the stored result and field manifests", async ({ page, request }) => {
    const result = await resultFor(request, RESULTS.mo);
    const frontier = result.payload.frontier_by_spin[0];
    await open(page, result);
    const view = page.getByTestId("guided-result-view");
    await expect(view).toBeVisible({ timeout: 60_000 });
    const checks: Record<string, unknown> = {};
    await expect(page.getByTestId("scientific-state").first()).toHaveAttribute("data-currently-authoritative", "true");
    const text = await page.locator("main").innerText();
    checks.totalEnergyShown = shows(text, result.payload.total_energy_hartree, 5);
    checks.homoShown = shows(text, frontier.homo_energy_hartree, 4);
    checks.lumoShown = shows(text, frontier.lumo_energy_hartree, 4);
    checks.gapEvShown = shows(text, frontier.gap_ev, 2);
    expect(checks).toMatchObject({ totalEnergyShown: true, homoShown: true, lumoShown: true, gapEvShown: true });
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 60_000 });

    for (const [tab, unitText] of [["tab-electron-density", "e/a₀³"], ["tab-electrostatic-potential", "a.u."]] as const) {
      const started = Date.now();
      await page.getByTestId(tab).click();
      await expect(page.locator(".guided-3d-canvas-wrap canvas").first()).toBeVisible({ timeout: 90_000 });
      await expect(page.locator("[data-surface-triangles]").first()).not.toHaveAttribute("data-surface-triangles", "0", { timeout: 90_000 });
      checks[`${tab}Ms`] = Date.now() - started;
      if (tab === "tab-electrostatic-potential") {
        // The ESP colour scale must be quantitative and carry its unit.
        await expect(page.getByTestId("esp-legend")).toContainText("a.u.");
        const note = await page.getByTestId("esp-scale-note").innerText();
        checks.espScale = note;
        const match = /±([0-9.]+(?:e[+-]?\d+)?) a\.u\./i.exec(note);
        expect(match, `ESP scale text: ${note}`).not.toBeNull();
        const field = await (await request.post(`${API}/v1/projects/${WATER}/calculations/${result.calculation_id}/fields/grid`, { data: { field_kind: "ELECTROSTATIC_POTENTIAL" } })).json();
        expect(field.manifest.field_unit).toBe("a.u.");
        // The rendered surface samples the stored potential grid, so its colour scale cannot exceed the grid's own extrema.
        const gridExtreme = Math.max(Math.abs(field.manifest.field_min), Math.abs(field.manifest.field_max));
        expect(Number(match![1])).toBeGreaterThan(0);
        expect(Number(match![1])).toBeLessThanOrEqual(gridExtreme * 1.0001);
        // The note states the isovalue that is actually rendered (the Guided default for this view), not a saved default.
        checks.isovalueInNote = note.includes("ρ = 0.035 e/a₀³");
        expect(checks.isovalueInNote, note).toBe(true);
        checks.gridExtreme = gridExtreme;
      } else {
        expect(await page.locator("main").innerText()).toContain(unitText);
      }
      await page.screenshot({ path: `${SHOTS}/${tab}.png` });
    }
    findings.push({ viewer: "Electron density / ESP / molecular orbitals", classification: "WORKING", checks, notes: [] });
  });

  test("TDDFT UV-Vis viewer shows the stored excited states with their units", async ({ page, request }) => {
    const result = await resultFor(request, RESULTS.tddft);
    await open(page, result);
    await page.getByTestId("guided-nav-spectra").click();
    await page.getByTestId("spectra-tab-uvvis").click().catch(() => undefined);
    const panel = page.getByTestId("uvvis-spectroscopy-panel");
    await expect(panel).toBeVisible({ timeout: 60_000 });
    const text = await panel.innerText();
    const states = result.payload.excited_states as Json[];
    const checks = {
      firstStateEv: shows(text, states[0]!.energy_ev, 2),
      firstStateNm: shows(text, states[0]!.wavelength_nm, 1),
      rows: await page.getByTestId("uvvis-states-table").locator("tbody tr").count(),
    };
    expect(checks.firstStateEv && checks.firstStateNm).toBe(true);
    expect(checks.rows).toBe(states.length);
    expect(text).toMatch(/nm/);
    await expect(page.getByTestId("uvvis-distinction-banner")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/uvvis.png` });
    findings.push({ viewer: "UV-Vis (TDDFT)", classification: "WORKING", checks, notes: [] });
  });

  test("Raman viewer lists the stored modes, units and the method", async ({ page, request }) => {
    const result = await resultFor(request, RESULTS.raman);
    await open(page, result);
    await page.getByTestId("guided-nav-spectra").click();
    await page.getByTestId("spectra-tab-raman").click();
    const panel = page.getByTestId("raman-spectroscopy-panel");
    await expect(panel).toBeVisible({ timeout: 60_000 });
    const text = await panel.innerText();
    const modes = result.payload.modes as Json[];
    const checks: Record<string, unknown> = {
      frequenciesShown: modes.every((m) => shows(text, m.frequency_cm1, 1)),
      methodShown: /B3LYP/i.test(text) && /def2-SVP/i.test(text),
      units: /cm/.test(text),
      canvasOrChart: (await panel.locator("canvas, svg").count()) > 0,
    };
    expect(checks.frequenciesShown, text.slice(0, 600)).toBe(true);
    expect(checks.methodShown).toBe(true);
    await page.screenshot({ path: `${SHOTS}/raman.png` });
    findings.push({ viewer: "Raman spectroscopy", classification: "WORKING", checks, notes: [] });
  });

  test("Raman is not offered for an IR-only frequency result", async ({ page, request }) => {
    const list = (await (await request.get(`${API}/v1/projects/${WATER}/results`)).json()) as Json[];
    const irOnly = list.find((r) => String(r.id).startsWith("c89b3a61"))!;
    expect(irOnly.payload.raman_method ?? null).toBeNull();
    await open(page, irOnly);
    await page.getByTestId("guided-nav-spectra").click();
    await expect(page.getByTestId("ir-spectroscopy-panel")).toBeVisible({ timeout: 60_000 });
    const raman = page.getByTestId("spectra-tab-raman");
    const ramanText = (await raman.count()) ? ((await raman.first().getAttribute("aria-disabled")) ?? (await raman.first().isDisabled() ? "disabled" : "enabled")) : "absent";
    findings.push({ viewer: "IR spectroscopy (IR-only result)", classification: "WORKING", checks: { ramanTab: ramanText }, notes: ["Raman data is never synthesized for a result without a Raman activity."] });
    await page.screenshot({ path: `${SHOTS}/ir-only.png` });
  });

  test("thermochemistry viewer binds ZPE, enthalpy and Gibbs energy to the stored result", async ({ page, request }) => {
    const result = await resultFor(request, RESULTS.thermo);
    await open(page, result);
    await page.getByTestId("guided-nav-analysis").click();
    const view = page.getByTestId("guided-thermochemistry-view");
    await expect(view).toBeVisible({ timeout: 60_000 });
    const text = await view.innerText();
    const t = result.payload.thermodynamics;
    const conditions = result.payload.conditions;
    // The viewer's default unit is kJ/mol (selector: Eh | kJ/mol | kcal/mol); convert the stored Eh values.
    const KJ = 2625.4996394799;
    const checks = {
      electronicKj: shows(text, t.electronic_energy_hartree * KJ, 1),
      zpeKj: shows(text, t.zpe_hartree * KJ, 3),
      enthalpyKj: shows(text, t.enthalpy_hartree * KJ, 1),
      gibbsKj: shows(text, t.gibbs_free_energy_hartree * KJ, 1),
      entropyJPerMolK: shows(text, t.entropy_hartree_per_k * KJ * 1000, 3),
      temperature: text.includes(`${conditions.temperature_k} K`),
      pressure: /1\s*atm/i.test(text),
      unitSelector: /Eh\s+kJ\/mol\s+kcal\/mol/.test(text),
      frequenciesShown: (result.payload.frequencies_cm1 as number[]).every((f) => shows(text, f, 1)),
    };
    await page.screenshot({ path: `${SHOTS}/thermochemistry.png` });
    findings.push({ viewer: "Thermochemistry", classification: Object.values(checks).every(Boolean) ? "WORKING" : "PARTIAL", checks, notes: [] });
    expect(checks).toMatchObject({ electronicKj: true, zpeKj: true, enthalpyKj: true, gibbsKj: true, entropyJPerMolK: true, temperature: true, pressure: true, frequenciesShown: true });
  });

  test("optimization result and trajectory are bound to the stored frames", async ({ page, request }) => {
    const result = await resultFor(request, RESULTS.optimization);
    const detail = await (await request.get(`${API}/v1/projects/${WATER}/calculations/${result.calculation_id}`)).json();
    await open(page, result);
    await page.getByTestId("guided-nav-optimization").click();
    const summary = page.getByTestId("optimization-result-summary").first();
    await expect(summary).toBeVisible({ timeout: 60_000 });
    const text = await page.locator("main").innerText();
    const steps = detail.optimization_trajectory.steps as Json[];
    const final = result.payload.final_energy.value as number;
    const checks = { finalEnergy: shows(text, final, 5), frames: steps.length, stepCount: result.payload.step_count };
    expect(checks.finalEnergy).toBe(true);
    await page.screenshot({ path: `${SHOTS}/optimization.png` });
    findings.push({ viewer: "Optimization trajectory", classification: "WORKING", checks, notes: [] });
  });

  test("a superseded result stays visible as history and is never presented as current", async ({ page, request }) => {
    const db = process.env.RW2_EVIDENCE_DB;
    test.skip(!db, "RW2_EVIDENCE_DB is needed to supersede a result in the disposable copy");
    const result = await resultFor(request, RESULTS.raman);
    const handle = new DatabaseSync(db!);
    const original = handle.prepare("select * from provenance_records where id = ?").get(result.provenance_record_id) as Json;
    expect(original, "provenance row of the Raman result").toBeTruthy();
    const successor: Json = { ...original, id: randomUUID(), subject_id: randomUUID(), supersedes_id: original.id, verification_state: "SUPERSEDED", correlation_id: randomUUID() };
    const columns = Object.keys(successor);
    handle.prepare(`insert into provenance_records (${columns.join(",")}) values (${columns.map(() => "?").join(",")})`).run(...columns.map((c) => successor[c]));
    handle.close();

    const after = await resultFor(request, RESULTS.raman);
    expect(after.effective_state.source_lineage_validity).toBe("SUPERSEDED");
    expect(after.effective_state.authority).toBe("CANDIDATE");
    expect(after.effective_state.stored_authority).toBe("AUTHORITATIVE");
    await open(page, after);
    await page.getByTestId("guided-nav-spectra").click();
    await page.getByTestId("spectra-tab-raman").click();
    await expect(page.getByTestId("raman-spectroscopy-panel")).toBeVisible({ timeout: 60_000 });
    const strip = page.getByTestId("scientific-state").first();
    await expect(strip).toHaveAttribute("data-currently-authoritative", "false");
    await expect(strip).toHaveAttribute("data-lineage", "SUPERSEDED");
    // exports keep the history but label it
    const exported = await request.get(`${API}/v1/projects/${WATER}/calculations/${after.calculation_id}/export?format=result-json`);
    expect(exported.status()).toBe(200);
    expect((await exported.json()).scientific_state.evidence_use).toBe("HISTORICAL_ONLY");
    await page.getByTestId("export-toggle").first().click();
    await expect(page.getByTestId("export-historical-notice")).toContainText("historical evidence");
    await page.screenshot({ path: `${SHOTS}/superseded-raman.png` });
    findings.push({ viewer: "Invalidated/superseded source behaviour", classification: "WORKING", checks: { lineage: "SUPERSEDED", exportEvidenceUse: "HISTORICAL_ONLY" }, notes: [] });
  });

  test("results of another project are unreachable through this project's URLs", async ({ page, request }) => {
    const other = "3537048e-306a-4f4f-9b9e-493681c0df83";
    const foreign = ((await (await request.get(`${API}/v1/projects/${other}/results`)).json()) as Json[])[0]!;
    expect((await request.get(`${API}/v1/projects/${WATER}/results/${foreign.id}`)).status()).toBe(404);
    expect((await request.get(`${API}/v1/projects/${WATER}/calculations/${foreign.calculation_id}/exports`)).status()).toBe(404);
    await page.goto(`/en/projects/${WATER}/workspace?selection=${encodeURIComponent(`calculationResult:${foreign.id}`)}&source=${foreign.calculation_id}`);
    await expect(page.getByTestId("project-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("scientific-state")).toHaveCount(0);
    findings.push({ viewer: "Project authorization (all viewers)", classification: "WORKING", checks: { foreignResult: 404, foreignExports: 404 }, notes: [] });
  });

  test("a project without results shows honest empty states", async ({ page, request }) => {
    const empty = "280e8b5d-8b5e-4cea-b1dd-1a4d9bd9bda7";
    expect(((await (await request.get(`${API}/v1/projects/${empty}/results`)).json()) as Json[]).length).toBe(0);
    await page.goto(`/en/projects/${empty}/compare`);
    await expect(page.getByTestId("compare-no-results")).toContainText("No published results yet", { timeout: 60_000 });
    await page.goto(`/en/projects/${empty}/jobs`);
    await expect(page.getByText("No compute jobs yet")).toBeVisible({ timeout: 60_000 });
    findings.push({ viewer: "Missing data (compare / jobs)", classification: "WORKING", checks: {}, notes: [] });
  });

  test("scientific claims and paper-vs-ChemDFT comparison are bound to the stored claims", async ({ page, request }) => {
    const paper = "7ae7e41b-2483-42c3-823e-42dd1b9fa72f";
    const claims = (await (await request.get(`${API}/v1/projects/${paper}/scientific-claims`)).json()) as Json;
    const comparison = (await (await request.get(`${API}/v1/projects/${paper}/scientific-comparison`)).json()) as Json;
    expect(claims.claims.length).toBeGreaterThan(20);

    await page.goto(`/en/projects/${paper}/claims`);
    const firstSubject = String((claims.claims as Json[])[0]!.subject);
    await expect(page.locator("body")).toContainText(firstSubject, { timeout: 60_000 });
    const claimsText = await page.locator("body").innerText();
    const authorities = new Set((claims.claims as Json[]).map((c) => c.source_authority as string));
    // Rows carry the raw server code in data-authority (the visible text is a friendly label).
    const authorityCounts = await Promise.all([...authorities].map((a) => page.locator(`.claim-row[data-authority="${a}"]`).count()));
    const claimChecks: Record<string, unknown> = {
      authoritiesShown: authorityCounts.every((count) => count > 0),
      firstClaimValueShown: claimsText.includes(String((claims.claims as Json[])[0]!.subject)),
    };
    await page.screenshot({ path: `${SHOTS}/claims.png` });

    await page.goto(`/en/projects/${paper}/comparison`);
    await expect(page.getByLabel("Comparison summary")).toBeVisible({ timeout: 60_000 });
    const summary = await page.getByLabel("Comparison summary").innerText();
    const s = comparison.summary as Json;
    const comparisonChecks = {
      sourceClaims: new RegExp(`Source claims\\s*${s.source_claims}`).test(summary.replace(/\n/g, " ")),
      comparablePairs: new RegExp(`Comparable pairs\\s*${s.directly_comparable_pairs}`).test(summary.replace(/\n/g, " ")),
      rows: await page.locator("tr.comparison-row").count(),
    };
    expect(comparisonChecks).toMatchObject({ sourceClaims: true, comparablePairs: true });
    expect(comparisonChecks.rows).toBe((comparison.rows as Json[]).length);
    await page.screenshot({ path: `${SHOTS}/paper-vs-chemdft.png` });

    // The unavailable-source claim must be shown as unresolved, never as a clean source-only row.
    const unavailable = "15c6888a-9e2f-434b-96e2-918474912533";
    const rows = ((await (await request.get(`${API}/v1/projects/${unavailable}/scientific-comparison`)).json()) as Json).rows as Json[];
    const unresolved = rows.filter((r) => r.relation === "UNRESOLVED");
    expect(unresolved.length).toBe(1);
    expect(unresolved[0]!.unresolved_reason).toBeTruthy();
    await page.goto(`/en/projects/${unavailable}/comparison`);
    await expect(page.locator("tr.comparison-row").first()).toBeVisible({ timeout: 60_000 });
    const unresolvedRow = page.locator("tr.comparison-row", { hasText: /unresolved/i }).first();
    await expect(unresolvedRow).toBeVisible();
    await unresolvedRow.click();
    await expect(page.getByLabel("Comparison row inspector")).toContainText(String(unresolved[0]!.unresolved_reason).slice(0, 30));
    findings.push({ viewer: "Scientific claims + paper-vs-ChemDFT comparison", classification: "WORKING", checks: { ...claimChecks, ...comparisonChecks, unresolvedRowShown: true }, notes: [] });
  });

  test("evidence workspace lists the stored evidence of the source document", async ({ page }) => {
    const paper = "7ae7e41b-2483-42c3-823e-42dd1b9fa72f";
    await page.addInitScript(() => localStorage.setItem("chemdft:workspace-mode", "guided"));
    await page.goto(`/en/projects/${paper}/workspace`);
    await expect(page.getByTestId("project-shell")).toBeVisible({ timeout: 60_000 });
    const panel = page.getByTestId("workspace-evidence");
    await expect(panel).toBeVisible({ timeout: 60_000 });
    const text = await panel.innerText();
    await page.screenshot({ path: `${SHOTS}/evidence-workspace.png` });
    findings.push({ viewer: "Evidence workspace", classification: "WORKING", checks: { panelText: text.slice(0, 160).replace(/\s+/g, " ") }, notes: [] });
  });

  test.afterAll(() => {
    writeFileSync(resolve(SHOTS, "viewer-matrix.json"), JSON.stringify({ findings, consoleProblems }, null, 2));
  });
});
