import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import axe from "axe-core";
import { buildConformerSubmission } from "../../src/lib/conformer-ensemble";

/**
 * RW-2 on a DISPOSABLE stack with real native engines
 *   python3 tools/run_isolated_e2e.py --suite rw2-analysis --api-port 8181 --web-port 3181
 * Every number asserted here is compared with what the API itself published; nothing is hard-coded.
 * Nothing touches the persistent database.
 */

const SHOTS = resolve(process.env.CHEMDFT_RW2_SHOTS ?? "../../output/rw2-review");
mkdirSync(SHOTS, { recursive: true });
const API = "/api/chemdft";
type Json = Record<string, unknown>;

const WATER_XYZ = "3\nwater\nO 0.0 0.0 0.1173\nH 0.0 0.7572 -0.4692\nH 0.0 -0.7572 -0.4692\n";

const state: {
  projectId: string;
  versionId: string;
  calc: Record<string, { calculationId: string; resultId: string | null; jobId: string }>;
  capabilities: Record<string, string>;
  canceled?: { calculationId: string; jobId: string };
} = { projectId: "", versionId: "", calc: {}, capabilities: {} };

function specification(task: string, engine: string, method: string, basis: string | null, extra: Json = {}) {
  return {
    task_type: task,
    engine_preference: { engine },
    method: { identifier: method, display_name: method.toUpperCase(), registry: "chemdft.method" },
    basis: basis ? { identifier: basis, display_name: basis.toUpperCase(), registry: "chemdft.basis" } : null,
    charge: 0,
    multiplicity: 1,
    ...extra,
  };
}

async function submit(request: APIRequestContext, label: string, spec: Json) {
  const response = await request.post(`${API}/v1/projects/${state.projectId}/calculations`, {
    data: {
      structure_version: { project_id: state.projectId, entity_type: "structure.version", entity_id: state.versionId },
      specification: spec,
      provider_preference: "AUTO",
      idempotency_key: `rw2-${label}-${randomUUID()}`,
    },
  });
  expect(response.status(), `${label}: ${await response.text()}`).toBeLessThan(300);
  const detail = (await response.json()) as { calculation: Json; compute_job: Json };
  state.calc[label] = { calculationId: detail.calculation.id as string, resultId: null, jobId: detail.compute_job.id as string };
}

async function settle(request: APIRequestContext, labels: string[], timeout = 420_000) {
  await expect
    .poll(
      async () => {
        const jobs = ((await (await request.get(`${API}/v1/projects/${state.projectId}/compute/jobs`)).json()) as { jobs: Json[] }).jobs;
        return jobs.filter((job) => labels.some((l) => state.calc[l]?.jobId === job.id) && !["SUCCEEDED", "FAILED", "CANCELED"].includes(job.state as string)).length;
      },
      { timeout, intervals: [2_000] },
    )
    .toBe(0);
  const results = (await (await request.get(`${API}/v1/projects/${state.projectId}/results`)).json()) as Json[];
  for (const label of labels) {
    state.calc[label]!.resultId = (results.find((r) => r.calculation_id === state.calc[label]!.calculationId)?.id as string | undefined) ?? null;
  }
}

async function apiJson<T = Json>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`${API}${path}`);
  expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
  return (await response.json()) as T;
}

function cubeStats(text: string) {
  const lines = text.split("\n");
  const natoms = Number(lines[2]!.trim().split(/\s+/)[0]);
  const axes = [3, 4, 5].map((i) => lines[i]!.trim().split(/\s+/).map(Number));
  const dims = axes.map((a) => a[0]!);
  const voxel = axes[0]![1]!;
  const values = lines.slice(6 + natoms).join(" ").trim().split(/\s+/).map(Number);
  const dv = voxel ** 3;
  return {
    natoms, dims, voxel, count: values.length,
    sum: values.reduce((a, b) => a + b, 0) * dv,
    sumSquares: values.reduce((a, b) => a + b * b, 0) * dv,
  };
}

test.describe.configure({ mode: "serial" });

test.describe("RW-2 analysis, exports, comparison and job diagnostics (native engines)", () => {
  test.setTimeout(900_000);

  test.beforeAll(async ({ playwright, baseURL }) => {
    test.setTimeout(900_000); // native engines (xTB, PySCF, Psi4, DFT-D4) run inside this hook
    const request = await playwright.request.newContext(baseURL ? { baseURL } : {});
    const slug = `rw2-${randomUUID().slice(0, 12)}`;
    const project = (await (await request.post(`${API}/v1/projects`, { data: { name: "RW-2 analysis", slug } })).json()) as Json;
    state.projectId = project.id as string;
    const imported = await request.post(`${API}/v1/projects/${state.projectId}/structures/imports`, {
      multipart: {
        upload: { name: "water.xyz", mimeType: "chemical/x-xyz", buffer: Buffer.from(WATER_XYZ) },
        file_format: "XYZ", idempotency_key: `rw2-import-${randomUUID()}`, structure_name: "Water",
      },
    });
    expect(imported.status()).toBe(201);
    state.versionId = ((await imported.json()) as { version: Json }).version.id as string;

    const caps = (await (await request.get(`${API}/v1/projects/${state.projectId}/calculations/capabilities`)).json()) as Json[];
    for (const c of caps) state.capabilities[c.engine as string] = c.availability as string;

    const scf = { scf: { convergence_threshold: 1e-9 } };
    await submit(request, "xtb-opt", specification("GEOMETRY_OPTIMIZATION", "xtb", "gfn2", null, { optimization: { optimizer: "xtb-ancopt", xtb_level: "normal", max_steps: 100 } }));
    await submit(request, "xtb-energy", specification("ENERGY", "xtb", "gfn2", null));
    await submit(request, "pyscf-energy", specification("ENERGY", "pyscf", "hf", "sto-3g", scf));
    await submit(request, "pyscf-orbitals", specification("ORBITAL", "pyscf", "hf", "sto-3g", scf));
    await submit(request, "pyscf-frequency", specification("FREQUENCY", "pyscf", "hf", "sto-3g", {
      ...scf, hessian: { strategy: "ANALYTIC", exclude_translation_rotation: true, coordinate_unit: "angstrom", hessian_unit: "Eh/bohr^2", frequency_unit: "cm^-1" },
    }));
    await submit(request, "pyscf-tddft", specification("TDDFT", "pyscf", "b3lyp", "def2-svp", {
      scf: { convergence_threshold: 1e-7 }, tddft: { nstates: 5, spin: "singlet", gauge: "length", conv_tol: 1e-7 },
    }));
    if (state.capabilities.psi4 === "AVAILABLE") {
      await submit(request, "psi4-energy", specification("ENERGY", "psi4", "hf", "sto-3g", { scf: { reference: "rhf" } }));
      await submit(request, "psi4-b3lyp", specification("ENERGY", "psi4", "b3lyp", "def2-svp", { scf: { reference: "rks" } }));
    }
    await settle(request, Object.keys(state.calc));

    // DFT-D4 combined total on the Psi4 B3LYP/def2-SVP result (native dftd4), when both engines are present.
    const b3lyp = state.calc["psi4-b3lyp"];
    if (b3lyp?.resultId) {
      const capability = await request.get(`${API}/v1/projects/${state.projectId}/dispersion-corrections/capability?source_result_id=${b3lyp.resultId}`);
      if (capability.status() === 200 && ((await capability.json()) as Json).available === true) {
        const response = await request.post(`${API}/v1/projects/${state.projectId}/dispersion-corrections`, {
          data: { source_result_id: b3lyp.resultId, variant: "d4.bj-eeq-atm", idempotency_key: `rw2-d4-${randomUUID()}` },
        });
        expect(response.status(), await response.text()).toBeLessThan(300);
        const detail = (await response.json()) as { calculation: Json; compute_job: Json };
        state.calc["dftd4-total"] = { calculationId: detail.calculation.id as string, resultId: null, jobId: detail.compute_job.id as string };
        await settle(request, ["dftd4-total"]);
      }
    }

    // A queued job canceled before any worker starts it (canceled-job diagnostics). The single worker is kept
    // busy with a real TDDFT job so the cancellation deterministically lands on a queued job.
    await submit(request, "blocker-tddft", specification("TDDFT", "pyscf", "b3lyp", "def2-svp", {
      scf: { convergence_threshold: 1e-7 }, tddft: { nstates: 8, spin: "singlet", gauge: "length", conv_tol: 1e-7 },
    }));
    await submit(request, "xtb-energy-to-cancel", specification("ENERGY", "xtb", "gfn2", null));
    const cancel = await request.post(`${API}/v1/projects/${state.projectId}/calculations/${state.calc["xtb-energy-to-cancel"]!.calculationId}/cancel`);
    expect(cancel.status()).toBeLessThan(300);
    state.canceled = { calculationId: state.calc["xtb-energy-to-cancel"]!.calculationId, jobId: state.calc["xtb-energy-to-cancel"]!.jobId };
    await settle(request, ["blocker-tddft", "xtb-energy-to-cancel"]);
    await request.dispose();
  });

  test("native results export faithfully: trajectory, IR, UV-Vis, JSON and CUBE", async ({ request }) => {
    const base = `${API}/v1/projects/${state.projectId}/calculations`;
    const must = (label: string) => {
      const entry = state.calc[label]!;
      expect(entry.resultId, `${label} produced a result`).toBeTruthy();
      return entry;
    };

    // --- optimization trajectory: exactly the stored frames, original atom order and units
    const opt = must("xtb-opt");
    const detail = await apiJson<{ optimization_trajectory: { steps: Json[]; atom_identities: Json[] } }>(request, `/v1/projects/${state.projectId}/calculations/${opt.calculationId}`);
    const trajectory = await request.get(`${base}/${opt.calculationId}/export?format=trajectory-xyz`);
    expect(trajectory.status()).toBe(200);
    expect(trajectory.headers()["content-type"]).toContain("chemical/x-xyz");
    const lines = (await trajectory.text()).trimEnd().split("\n");
    const atoms = detail.optimization_trajectory.atom_identities;
    expect(lines.length).toBe((atoms.length + 2) * detail.optimization_trajectory.steps.length);
    detail.optimization_trajectory.steps.forEach((step, frame) => {
      const block = lines.slice(frame * (atoms.length + 2), (frame + 1) * (atoms.length + 2));
      expect(block[1]).toContain(`energy_Eh=${step.energy_hartree as number}`);
      (step.coordinates_angstrom as number[][]).forEach((xyz, i) => {
        const [symbol, ...c] = block[2 + i]!.trim().split(/\s+/);
        expect(symbol).toBe(atoms[i]!.element);
        c.map(Number).forEach((value, axis) => expect(Math.abs(value - xyz[axis]!)).toBeLessThan(1e-9));
      });
    });

    // --- IR stick data equals the stored modes
    const freq = must("pyscf-frequency");
    const freqResult = await apiJson<{ payload: { modes: Json[] } }>(request, `/v1/projects/${state.projectId}/results/${freq.resultId}`);
    const ir = await request.get(`${base}/${freq.calculationId}/export?format=spectrum-csv&variant=ir`);
    expect(ir.status()).toBe(200);
    const irRows = (await ir.text()).split("\n").filter((l) => l && !l.startsWith("#")).slice(1).map((l) => l.split(","));
    expect(irRows.length).toBe(freqResult.payload.modes.length);
    irRows.forEach((row, i) => {
      const mode = freqResult.payload.modes[i]!;
      expect(Number(row[1])).toBe(mode.frequency_cm1);
      expect(Number(row[2])).toBe(((mode.ir_intensity as Json).value as number));
    });

    // --- UV-Vis states
    const tddft = must("pyscf-tddft");
    const tddftResult = await apiJson<{ payload: { excited_states: Json[] } }>(request, `/v1/projects/${state.projectId}/results/${tddft.resultId}`);
    const uv = await request.get(`${base}/${tddft.calculationId}/export?format=spectrum-csv&variant=uvvis`);
    const uvRows = (await uv.text()).split("\n").filter((l) => l && !l.startsWith("#")).slice(1).map((l) => l.split(","));
    expect(uvRows.length).toBe(tddftResult.payload.excited_states.length);
    uvRows.forEach((row, i) => expect(Number(row[3])).toBe(tddftResult.payload.excited_states[i]!.wavelength_nm));

    // --- result JSON carries state, provenance and the unmodified payload
    const sp = must("pyscf-energy");
    const json = await request.get(`${base}/${sp.calculationId}/export?format=result-json`);
    expect(json.status()).toBe(200);
    // The browser proxy forwards only an allow-listed set of response headers; the evidence-use header is
    // therefore asserted against the API itself, and the same standing is inside the document.
    const direct = await request.get(`http://127.0.0.1:${process.env.CHEMDFT_E2E_API_PORT}/v1/projects/${state.projectId}/calculations/${sp.calculationId}/export?format=result-json`);
    expect(direct.headers()["x-chemdft-evidence-use"]).toBe("CURRENT");
    expect(direct.headers()["x-chemdft-effective-authority"]).toBe("AUTHORITATIVE");
    expect(direct.headers()["cache-control"]).toBe("no-store");
    const doc = (await json.json()) as Json;
    const published = await apiJson<Json>(request, `/v1/projects/${state.projectId}/results/${sp.resultId}`);
    expect(doc.result && (doc.result as Json).payload).toEqual(published.payload);
    expect(((doc.scientific_state as Json).effective as Json).verification_state).toBe("UNVERIFIED");

    // --- CUBE: generate through the existing viewer endpoints, then export; check units physically
    const orbitals = must("pyscf-orbitals");
    const before = await apiJson<{ formats: Json[] }>(request, `/v1/projects/${state.projectId}/calculations/${orbitals.calculationId}/exports`);
    expect((before.formats.find((f) => f.format === "cube") as Json).available).toBe(false); // nothing is computed at export time
    const orbitalPayload = (await apiJson<{ payload: { electron_count: number; frontier_by_spin: Json[] } }>(request, `/v1/projects/${state.projectId}/results/${orbitals.resultId}`)).payload;
    const homo = (orbitalPayload.frontier_by_spin[0] as Json).homo_index as number;
    for (const body of [
      { field_kind: "ELECTRON_DENSITY" },
      { field_kind: "MO_AMPLITUDE", orbital_index: homo, spin_channel: "restricted" },
    ]) {
      const generated = await request.post(`${base}/${orbitals.calculationId}/fields/grid`, { data: body });
      expect(generated.status(), await generated.text()).toBeLessThan(300);
    }
    const after = await apiJson<{ formats: Json[] }>(request, `/v1/projects/${state.projectId}/calculations/${orbitals.calculationId}/exports`);
    const cube = after.formats.find((f) => f.format === "cube") as { available: boolean; variants: { key: string; label: string }[] };
    expect(cube.available).toBe(true);
    expect(cube.variants).toHaveLength(2);
    for (const variant of cube.variants) {
      const response = await request.get(`${base}/${orbitals.calculationId}/export?format=cube&variant=${variant.key}`);
      expect(response.status()).toBe(200);
      const stats = cubeStats(await response.text());
      expect(stats.natoms).toBe(3);
      expect(stats.count).toBe(stats.dims[0]! * stats.dims[1]! * stats.dims[2]!);
      if (/density/i.test(variant.label)) {
        // integral of rho dV over the stored bohr grid recovers the electron count (the app's own 5 % QA tolerance)
        expect(Math.abs(stats.sum - orbitalPayload.electron_count) / orbitalPayload.electron_count).toBeLessThan(0.05);
      } else {
        // MO amplitudes are normalised in a0^-3/2: the sum of psi^2 dV is 1
        expect(stats.sumSquares).toBeGreaterThan(0.98);
        expect(stats.sumSquares).toBeLessThan(1.02);
      }
    }
  });

  test("Export panel offers only what is stored and downloads through the browser", async ({ page }) => {
    const freq = state.calc["pyscf-frequency"]!;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/en/projects/${state.projectId}/workspace?selection=${encodeURIComponent(`calculationResult:${freq.resultId}`)}&source=${freq.calculationId}`);
    await expect(page.getByTestId("project-shell")).toBeVisible({ timeout: 60_000 });
    const toggle = page.getByTestId("export-toggle").first();
    await expect(toggle).toBeVisible({ timeout: 60_000 });
    await toggle.click();
    const panel = page.getByTestId("export-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("export-result-json")).toHaveAttribute("data-available", "true");
    await expect(page.getByTestId("export-spectrum-csv")).toHaveAttribute("data-available", "true");
    await expect(page.getByTestId("export-trajectory-xyz")).toHaveAttribute("data-available", "false");
    await expect(page.getByTestId("export-reason-trajectory-xyz")).toContainText("never invents missing frames");
    await expect(page.getByTestId("export-reason-cube")).toContainText("Only SCF orbital results");
    await page.screenshot({ path: `${SHOTS}/export-panel.png` });
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-run-spectrum-csv-ir").click()]);
    expect(download.suggestedFilename()).toMatch(/^spectrum-ir-[0-9a-f]{8}\.csv$/);
    const path = await download.path();
    const text = readFileSync(path!, "utf8");
    expect(text).toContain("# intensity_unit: km/mol");
    await expect(page.getByTestId("export-status")).toContainText("Saved spectrum-ir-");
    // unsupported formats are refused by the API with an explicit error, never an empty file
    const refused = await page.request.get(`${API}/v1/projects/${state.projectId}/calculations/${freq.calculationId}/export?format=trajectory-xyz`);
    expect(refused.status()).toBe(422);
  });

  async function openCompare(page: Page, labels: string[]) {
    const query = labels.map((l) => `result=${state.calc[l]!.resultId}`).join("&");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.setItem("chemdft:workspace-mode", "guided"));
    await page.goto(`/en/projects/${state.projectId}/compare?${query}`);
    await expect(page.getByTestId("compare-overall")).toBeVisible({ timeout: 90_000 });
  }
  /** The comparison workstation keeps rule detail, provenance and numbers in tabs of one live panel. */
  const showTab = (page: Page, tab: "key" | "plots" | "data" | "structures" | "provenance" | "rules") => page.getByTestId(`compare-tab-${tab}`).click();

  test("comparison: xTB vs HF is blocked, HF vs HF across engines is limited, values equal the API", async ({ page, request }) => {
    const labels = ["pyscf-energy", "xtb-energy", ...(state.calc["psi4-energy"] ? ["psi4-energy"] : [])];
    await openCompare(page, labels);
    const api = await apiJson<{ overall: string; pairs: { label: string; deltas: { delta: number | null; unit: string }[]; rules: { rule_id: string; outcome: string }[] }[] }>(
      request,
      `/v1/projects/${state.projectId}/calculation-comparison?${labels.map((l) => `result_id=${state.calc[l]!.resultId}`).join("&")}`,
    );
    await showTab(page, "rules");
    const pairs = page.getByTestId("compare-pair");
    await expect(pairs).toHaveCount(labels.length - 1);
    // pyscf vs xtb: different methods; never an energy difference.
    await expect(pairs.nth(0)).toHaveAttribute("data-label", "NOT_SCIENTIFICALLY_COMPARABLE");
    await expect(pairs.nth(0)).toContainText("share no common energy zero");
    expect(api.pairs[0]!.deltas).toHaveLength(0);
    await showTab(page, "key");
    await expect(page.getByTestId("compare-delta-blocked").first()).toBeVisible();
    if (labels.includes("psi4-energy")) {
      await showTab(page, "rules");
      await expect(pairs.nth(1)).toHaveAttribute("data-label", "COMPARABLE_WITH_LIMITATIONS");
      await expect(pairs.nth(1)).toContainText("Different engines");
      const delta = api.pairs[1]!.deltas[0]!.delta!;
      expect(Math.abs(delta)).toBeLessThan(1e-4); // same HF/STO-3G water: engines agree to implementation tolerance
      await showTab(page, "key");
      await expect(page.getByTestId("compare-delta").first()).not.toHaveText("—");
    }
    // verification never changes because two numbers agree
    await showTab(page, "provenance");
    for (const strip of await page.getByTestId("compare-state").all()) {
      await expect(strip).toContainText("Not independently verified");
      await expect(strip).not.toContainText(/\bVerified\b/);
    }
    await expect(page.getByTestId("compare-notice")).toContainText("not independent verification");
    await page.screenshot({ path: `${SHOTS}/compare-engines.png`, fullPage: true });

    await page.getByTestId("compare-export").click();
    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByTestId("compare-export-csv").click()]);
    expect(csv.suggestedFilename()).toBe("calculation-comparison.csv");
    const text = readFileSync((await csv.path())!, "utf8");
    expect(text).toContain("# overall:");
    expect(text).toContain("delta_other_minus_reference");
  });

  test("comparison: optimized geometry against a single point reports geometry, not silence", async ({ page, request }) => {
    const labels = ["xtb-energy", "xtb-opt"];
    await openCompare(page, labels);
    const api = await apiJson<{ pairs: { label: string; geometry: { relation: string; rmsd_angstrom: number | null } }[] }>(
      request,
      `/v1/projects/${state.projectId}/calculation-comparison?${labels.map((l) => `result_id=${state.calc[l]!.resultId}`).join("&")}`,
    );
    const pair = api.pairs[0]!;
    await showTab(page, "rules");
    const card = page.getByTestId("compare-pair").first();
    await expect(card).toHaveAttribute("data-label", pair.label);
    if (pair.geometry.relation === "SAME_ATOM_ORDER_DIFFERENT_COORDINATES") {
      await expect(card).toContainText("Different geometries");
      await expect(card).toContainText(`${pair.geometry.rmsd_angstrom!.toFixed(4)} Å`);
    }
    await page.screenshot({ path: `${SHOTS}/compare-geometry.png`, fullPage: true });
  });

  test("DFT-D4 combined total keeps its state, exports as JSON and is not comparable with the uncorrected energy", async ({ page, request }) => {
    const d4 = state.calc["dftd4-total"];
    test.skip(!d4?.resultId, "Psi4 and DFT-D4 executables are not configured on this stack");
    const plain = state.calc["psi4-b3lyp"]!;
    const published = await apiJson<Json>(request, `/v1/projects/${state.projectId}/results/${d4!.resultId}`);
    const effective = published.effective_state as Json;
    expect([effective.authority, effective.validation_state, effective.verification_state, effective.source_lineage_validity])
      .toEqual(["AUTHORITATIVE", "VALIDATED", "UNVERIFIED", "ACTIVE"]);
    const exported = await request.get(`${API}/v1/projects/${state.projectId}/calculations/${d4!.calculationId}/export?format=result-json`);
    expect(exported.status()).toBe(200);
    const doc = (await exported.json()) as Json;
    expect(((doc.scientific_state as Json).independent_verification as Json).state).toBe("UNVERIFIED");
    const payload = (doc.result as Json).payload as Json;
    expect(((doc.summary as Json).quantities as Json[]).find((q) => q.kind === "dispersion_corrected_total_energy")!.value)
      .toBe((payload.corrected_total_energy as Json).value);
    // corrected = uncorrected + D4 term, in Hartree, exactly as published
    expect(Math.abs(((payload.corrected_total_energy as Json).value as number) - ((payload.uncorrected_dft_energy as Json).value as number) - ((payload.d4_correction_energy as Json).value as number))).toBeLessThan(1e-10);

    const api = await apiJson<{ pairs: { label: string; blockers: string[]; deltas: unknown[] }[] }>(
      request,
      `/v1/projects/${state.projectId}/calculation-comparison?result_id=${plain.resultId}&result_id=${d4!.resultId}`,
    );
    expect(api.pairs[0]!.label).toBe("NOT_SCIENTIFICALLY_COMPARABLE");
    expect(api.pairs[0]!.deltas).toHaveLength(0);
    await openCompare(page, ["psi4-b3lyp", "dftd4-total"]);
    await showTab(page, "rules");
    await expect(page.getByTestId("compare-pair").first()).toContainText("dispersion");
    await showTab(page, "provenance");
    for (const strip of await page.getByTestId("compare-state").all()) await expect(strip).toContainText("Not independently verified");
    await page.screenshot({ path: `${SHOTS}/compare-d4.png`, fullPage: true });
  });

  test("Project navigation reaches comparison and the compare page rejects foreign ids", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/en/projects/${state.projectId}/workspace`);
    await expect(page.getByTestId("guided-project-home")).toBeVisible({ timeout: 60_000 });
    // Compare is a project section (the Guided sidebar no longer repeats it)
    await expect(page.getByTestId("guided-nav-compare")).toHaveCount(0);
    await page.getByTestId("project-section-compare").click();
    await expect(page).toHaveURL(new RegExp(`/projects/${state.projectId}/compare`));
    await expect(page.getByTestId("compare-candidates")).toBeVisible();
    const rows = page.getByTestId("compare-candidate");
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    // Selecting through the UI builds the same comparison a shared link would.
    await rows.nth(0).getByTestId("compare-select").check();
    await expect(page.getByTestId("compare-need-more")).toBeVisible();
    await rows.nth(1).getByTestId("compare-select").check();
    await expect(page.getByTestId("compare-output")).toBeVisible({ timeout: 60_000 });
    expect(new URL(page.url()).searchParams.getAll("result")).toHaveLength(2);
    // A result id that does not belong to this project is reported as unavailable and never compared or forwarded.
    await page.goto(`/en/projects/${state.projectId}/compare?result=${randomUUID()}&result=${randomUUID()}`);
    await expect(page.getByTestId("compare-candidates")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("compare-unavailable")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("compare-output")).toHaveCount(0);
    expect((await request.get(`${API}/v1/projects/${state.projectId}/calculation-comparison?result_id=${randomUUID()}&result_id=${randomUUID()}`)).status()).toBe(404);
  });

  test("Jobs: persisted executions, attempts, artifacts, logs and honest progress", async ({ page, request }) => {
    const job = state.calc["pyscf-energy"]!;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/en/projects/${state.projectId}/jobs`);
    const rows = page.getByTestId("job-row");
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    const row = page.locator(`[data-testid="job-row"][data-job-id="${job.jobId}"]`);
    await expect(row).toHaveAttribute("data-job-state", "SUCCEEDED");
    await expect(row.getByTestId("job-specification")).toContainText("hf / sto-3g");
    await row.getByTestId("job-select").click(); // the persistent inspector replaces the expanding details row
    await expect(page.getByTestId("job-inspector")).toHaveAttribute("data-job-id", job.jobId);
    await expect(page.getByTestId("job-inspector")).toContainText("Completed");
    const diagnostics = page.getByTestId("job-diagnostics");
    await expect(diagnostics).toBeVisible({ timeout: 30_000 });
    await expect(diagnostics).toHaveAttribute("data-heartbeat", "NOT_APPLICABLE");
    await expect(page.getByTestId("job-progress-note")).toContainText("trustworthy percent-complete");
    await expect(page.locator("main")).not.toContainText(/\d+\s?%\s*(complete|done)/i);
    const api = await apiJson<{ executions: Json[]; attempts: Json[] }>(request, `/v1/projects/${state.projectId}/compute/jobs/${job.jobId}/diagnostics`);
    await expect(page.getByTestId("job-executions").locator("tbody tr")).toHaveCount(api.executions.length);
    await expect(page.getByTestId("job-attempts").locator("tbody tr")).toHaveCount(api.attempts.length);
    await page.screenshot({ path: `${SHOTS}/jobs-diagnostics.png`, fullPage: true });

    // Native evidence: open an engine log (when the engine persists one) and download an artifact.
    const artifacts = api.attempts.flatMap((a) => (a.artifacts as Json[]) ?? []);
    expect(artifacts.length).toBeGreaterThan(0);
    await expect(page.getByTestId("job-artifact-availability")).toContainText("native artifact");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("job-artifact-download").first().click()]);
    expect(download.suggestedFilename()).toMatch(/^calculation-/);
    if (artifacts.some((a) => a.log_readable)) {
      await page.getByTestId("job-log-open").first().click();
      await expect(page.getByTestId("job-log")).toBeVisible();
      await expect(page.getByTestId("job-log").locator("pre")).toBeVisible({ timeout: 15_000 });
    }

    // Canceled job: preserved with its state, no fabricated execution or result.
    const canceled = page.locator(`[data-testid="job-row"][data-job-id="${state.canceled!.jobId}"]`);
    await expect(canceled).toHaveAttribute("data-job-state", "CANCELED");
    await expect(canceled).toContainText("Canceled");
    await canceled.getByTestId("job-select").click();
    await expect(page.getByTestId("job-inspector")).toHaveAttribute("data-job-id", state.canceled!.jobId);
    await expect(page.getByTestId("job-diagnostics")).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-testid="jobs-filter-chip"][data-filter="canceled"]').click();
    await expect(page.getByTestId("job-row")).toHaveCount(1);
    await page.locator('[data-testid="jobs-filter-chip"][data-filter="failed"]').click();
    await expect(page.getByText("No jobs match these filters.")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/jobs-canceled.png`, fullPage: true });
  });

  test("CREST conformer ensemble viewer is bound to the stored native result", async ({ page, request }) => {
    test.skip(state.capabilities.crest !== "AVAILABLE", "CREST is not available on this stack");
    const fixture = readFileSync(resolve("../../services/api/tests/fixtures/crest/ethanol.xyz")).toString().replace("\n\n", "\nNative ethanol input\n");
    const project = (await (await request.post(`${API}/v1/projects`, { data: { name: "RW-2 conformers", slug: `rw2c-${randomUUID().slice(0, 10)}` } })).json()) as Json;
    const imported = await request.post(`${API}/v1/projects/${project.id}/structures/imports`, {
      multipart: { upload: { name: "ethanol.xyz", mimeType: "chemical/x-xyz", buffer: Buffer.from(fixture) }, file_format: "XYZ", idempotency_key: randomUUID() },
    });
    expect(imported.status(), await imported.text()).toBe(201);
    const version = ((await imported.json()) as { version: Json }).version;
    const submitted = await request.post(`${API}/v1/projects/${project.id}/calculations`, {
      data: buildConformerSubmission(project.id as string, version.id as string, randomUUID()),
    });
    expect(submitted.status(), await submitted.text()).toBe(201);
    const calculationId = ((await submitted.json()) as { calculation: Json }).calculation.id as string;
    let detail: { calculation: Json; result: Json | null } = { calculation: {}, result: null };
    await expect
      .poll(async () => {
        detail = (await (await request.get(`${API}/v1/projects/${project.id}/calculations/${calculationId}`)).json()) as typeof detail;
        return ["SUCCEEDED", "FAILED", "CANCELED"].includes(detail.calculation.state as string);
      }, { timeout: 300_000, intervals: [2_000] })
      .toBe(true);
    expect(detail.calculation.state).toBe("SUCCEEDED");
    const payload = detail.result!.payload as { manifest: { members: Json[] } };
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/en/projects/${project.id}/workspace?selection=calculationResult:${detail.result!.id}&source=${calculationId}`);
    const ensemble = page.locator('[data-testid="conformer-ensemble"]:visible');
    await expect(ensemble).toBeVisible({ timeout: 90_000 });
    await expect(ensemble).toHaveAttribute("data-result-id", detail.result!.id as string);
    await expect(ensemble).toContainText("UNVERIFIED");
    await expect(page.getByTestId("scientific-state").first()).toHaveAttribute("data-currently-authoritative", "true");
    const first = payload.manifest.members[0] as { native_electronic_energy: { value: number } };
    await expect(page.getByTestId("conformer-selected-energy")).toContainText(first.native_electronic_energy.value.toFixed(8));
    await page.screenshot({ path: `${SHOTS}/conformer-ensemble.png`, fullPage: true });
    // The same ensemble also exports as stored result JSON.
    const exported = await request.get(`${API}/v1/projects/${project.id}/calculations/${calculationId}/export?format=result-json`);
    expect(exported.status()).toBe(200);
    expect((((await exported.json()) as Json).summary as Json).task).toBe("CONFORMER_SEARCH");
  });

  test("accessibility: new surfaces have no serious or critical axe violations", async ({ page }) => {
    const audit = async (label: string) => {
      await page.evaluate(axe.source);
      const results = await page.evaluate(async () =>
        (window as unknown as { axe: typeof axe }).axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }),
      );
      const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      console.log(`[A11y] ${label}: ${results.violations.length} violations, ${blocking.length} serious/critical ${blocking.map((v) => `${v.id} @ ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ")}`).join(" | ")}`);
      return blocking.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
    };
    await openCompare(page, ["pyscf-energy", "xtb-energy"]);
    const compareIssues = await audit("compare");
    await page.goto(`/en/projects/${state.projectId}/jobs`);
    await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("job-select").first().click();
    await expect(page.getByTestId("job-diagnostics")).toBeVisible({ timeout: 30_000 });
    const jobIssues = await audit("jobs");
    const freq = state.calc["pyscf-frequency"]!;
    await page.goto(`/en/projects/${state.projectId}/workspace?selection=${encodeURIComponent(`calculationResult:${freq.resultId}`)}&source=${freq.calculationId}`);
    await page.getByTestId("export-toggle").first().click();
    await expect(page.getByTestId("export-panel")).toBeVisible({ timeout: 60_000 });
    const exportIssues = await audit("export panel");
    expect([...compareIssues, ...jobIssues, ...exportIssues]).toEqual([]);
  });

  test("viewer inventory: every native result type is bound to a viewer with scientific state", async ({ page }) => {
    const report: Json[] = [];
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const label of ["pyscf-energy", "xtb-opt", "pyscf-orbitals", "pyscf-frequency", "pyscf-tddft"]) {
      const entry = state.calc[label]!;
      if (!entry.resultId) { report.push({ label, note: "no result" }); continue; }
      await page.goto(`/en/projects/${state.projectId}/workspace?selection=${encodeURIComponent(`calculationResult:${entry.resultId}`)}&source=${entry.calculationId}`);
      await expect(page.getByTestId("project-shell")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("scientific-state").first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("export-toggle").first()).toBeVisible();
      report.push({ label, state: await page.getByTestId("scientific-state").first().getAttribute("data-currently-authoritative"), canvases: await page.locator("main canvas").count() });
    }
    writeFileSync(resolve(SHOTS, "native-viewer-inventory.json"), JSON.stringify({ report, errors }, null, 2));
    expect(errors).toEqual([]);
    for (const row of report.filter((r) => r.state !== undefined)) expect(row.state).toBe("true");
  });
});
