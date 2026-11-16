import { expect, test, type Page } from "@playwright/test";

import { makeCr2O3Detail, makeCr2O3PrimitiveDetail, setupMockRoutes } from "./release-0043-support";

/**
 * Release 0.0.43 (Quantum ESPRESSO plane-wave engine): offline spec, no stack needed.
 * Everything the mocked backend returns here is a TEST FIXTURE ("fixture-only", arbitrary placeholder numbers). It exists to
 * prove layout, labels and that the DOS and band charts render; it is never a scientific result and never reachable from the product.
 */

const VIEWPORTS = [
  { name: "1440x800", width: 1440, height: 800 },
  { name: "1280x720", width: 1280, height: 720 },
];

async function openAdvanced(page: Page) {
  await page.goto("/en/projects/cr2o3-proj/workspace?structureId=s-cr2o3&structureVersionId=v-cr2o3-1");
  const advBtn = page.getByRole("button", { name: "Advanced Workbench" });
  await expect(advBtn).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(async () => {
    if ((await advBtn.getAttribute("aria-pressed")) !== "true") await advBtn.click();
    await expect(advBtn).toHaveAttribute("aria-pressed", "true", { timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
}

function fixtureResult() {
  const energy = Array.from({ length: 120 }, (_, i) => -20 + i * 0.25);
  const bump = (centre: number, width: number) => energy.map((e) => Math.exp(-((e - centre) ** 2) / (2 * width ** 2)));
  const dos = {
    reference: "fermi_level", fermi_ev: 12.798, spin_polarized: true, k_mesh: [6, 6, 6],
    energy_rel_fermi_ev: energy, total_up: bump(-4, 2).map((v) => v * 4), total_down: bump(-4, 2).map((v) => v * 4),
    projected_energy_rel_fermi_ev: energy,
    projected: [
      { element: "Cr", orbital: "d", up: bump(-3, 1.5), down: bump(1, 1.5) },
      { element: "O", orbital: "p", up: bump(-6, 2), down: bump(-6, 2) },
    ],
    gap_from_eigenvalues_ev: 3.234, gap_note: "TEST FIXTURE",
  };
  const k = Array.from({ length: 49 }, (_, i) => i / 48);
  const bands = {
    reference: "fermi_level", fermi_ev: 12.798, k_distance: k,
    nodes: [{ index: 0, label: "Γ", distance: 0 }, { index: 12, label: "Z", distance: 12 / 48 }, { index: 24, label: "F", distance: 0.5 }, { index: 36, label: "Γ", distance: 0.75 }, { index: 48, label: "L", distance: 1 }],
    bands_up: [k.map((x) => -4 + Math.cos(6 * x)), k.map((x) => 2 + Math.cos(5 * x))],
    bands_down: [k.map((x) => -4 + Math.cos(6 * x)), k.map((x) => 2.1 + Math.cos(5 * x))],
    vbm_ev: 0.1, cbm_ev: 3.3, gap_along_path_ev: 3.2, path_source: "TEST FIXTURE path",
  };
  const payload = {
    payload_schema: "chemdft.periodic-energy", task_type: "PERIODIC_ENERGY", engine: "qe", converged: true, method: "pbe+u", basis: null,
    total_energy: { value: -1.0, unit: { code: "Eh" } }, scf_iterations: 3, parser_version: "fixture", validator_version: "fixture",
    band_gap: { value: 3.247, unit: { code: "eV" } }, k_mesh: [3, 3, 3], magnetic_order: "antiferromagnetic", u_effective_ev: { Cr: 3.7 },
    local_magnetic_moments: { "0": -2.5, "1": 2.5 }, local_moment_kind: "lowdin-projected", total_magnetization: 0, absolute_magnetization: 12.0,
    fermi_energy_ev: 12.798, irreducible_k_points: 6, pseudopotential_library: "SSSP PBE Efficiency v2.0", cutoffs_ry: { ecutwfc: 45, ecutrho: 540 },
    relaxation: { converged: true, ionic_steps: 4, scf_cycles: 5, initial_energy_hartree: -1.0, final_energy_hartree: -1.001, max_force_ry_per_bohr: 0.0004, force_threshold_ry_per_bohr: 0.001,
      final_positions: [{ index: 0, element: "Cr", species: "Cr1", fractional: [0.1, 0.1, 0.1] }, { index: 1, element: "O", species: "O", fractional: [0.4, 0.05, 0.75] }] },
    dos, bands,
  };
  return {
    calculation: { id: "calc-fixture", project_id: "cr2o3-proj", state: "SUCCEEDED", created_at: "2026-11-12T10:00:00Z" },
    calculation_input_hash: "f".repeat(64),
    specification: { task_type: "PERIODIC_ENERGY", method: { identifier: "pbe+u", display_name: "PBE+U", registry: "chemdft.method" }, charge: 0, multiplicity: 1, engine_preference: { engine: "qe" }, periodic: { k_mesh: [3, 3, 3] } },
    compute_job: { id: "job-fixture", state: "SUCCEEDED", provider: "AWS", attempt_count: 1, estimate: { provider_summary: "TEST FIXTURE" } },
    attempt: { raw_artifacts: [] },
    result: {
      id: "result-fixture", result_type: "chemdft.periodic-energy", validation_state: "VALIDATED", verification_state: "UNVERIFIED", authority: "AUTHORITATIVE", source_class: "CALCULATED",
      provenance_record_id: "prov-fixture", created_at: "2026-11-12T10:00:00Z", payload,
      producer_software: { name: "qe", version: "7.6", adapter_version: "1.0.0", execution_backend: "AWS", hardware_class: "x86_64" },
      effective_state: { authority: "AUTHORITATIVE", validation_state: "VALIDATED", verification_state: "UNVERIFIED" },
    },
  };
}

test.describe("Release 0.0.43 — Quantum ESPRESSO periodic setup and results (offline, fixture only)", () => {
  for (const vp of VIEWPORTS) {
    test(`engine selector and QE options show without page scroll at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMockRoutes(page, makeCr2O3Detail());
      await openAdvanced(page);
      const form = page.locator('[data-testid="periodic-setup-form"]');
      await expect(form).toBeVisible({ timeout: 15_000 });
      const engine = page.locator('[data-testid="periodic-engine-select"]');
      await expect(engine).toBeVisible();
      await expect(engine).toHaveValue("pyscf");
      await expect(page.locator('[data-testid="periodic-kmesh-select"]')).toBeVisible(); // PySCF options unchanged
      await expect(page.locator('[data-testid="qe-options"]')).toHaveCount(0);

      await engine.selectOption("qe");
      await expect(page.locator('[data-testid="qe-options"]')).toBeVisible();
      await expect(page.locator('[data-testid="periodic-kmesh-select"]')).toHaveCount(0);
      const kmesh = page.locator('[data-testid="qe-kmesh-select"]');
      await expect(kmesh.locator("option")).toHaveText(["Gamma only", "2×2×2", "3×3×3", "4×4×4"]);
      await expect(page.locator('[data-testid="qe-pseudo-library"]')).toHaveValue("SSSP PBE Efficiency v2.0");
      await expect(page.locator('[data-testid="qe-pseudo-library"]')).toHaveAttribute("readonly", "");
      for (const id of ["qe-relax-toggle", "qe-dos-toggle", "qe-bands-toggle"]) await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
      await page.locator('[data-testid="qe-dos-toggle"]').check();
      await expect(page.locator('[data-testid="qe-dos-mesh-select"]')).toBeVisible();
      await expect(page.locator('[data-testid="qe-estimate"]')).toContainText("Rough estimate");
      await expect(page.locator('[data-testid="periodic-engine-help"]')).toContainText("fixed, library-recommended cutoffs and pseudopotentials");
      await expect(page.locator('[data-testid="qe-footnote"]')).toContainText("local minima");
      await expect(page.getByRole("button", { name: "Run Quantum ESPRESSO periodic job" })).toBeVisible();

      const viewer = page.locator(".scientific-scene, canvas, .viewer-stage").first();
      await expect(viewer).toBeVisible();
      const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      const innerHeight = await page.evaluate(() => window.innerHeight);
      expect(scrollHeight).toBeLessThanOrEqual(innerHeight + 1);
    });

    test(`a molecular structure keeps the normal panel and no engine selector at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const base = makeCr2O3Detail();
      const water = {
        structure: { ...base.structure, name: "Water", kind: "MOLECULAR" },
        version: { ...base.version, periodic_cell: null, coordinates: { coordinate_system: "CARTESIAN", unit: "angstrom", atoms: [
          { index: 0, element: "O", atomic_number: 8, x: 0, y: 0, z: 0.1173 },
          { index: 1, element: "H", atomic_number: 1, x: 0, y: 0.7572, z: -0.4692 },
          { index: 2, element: "H", atomic_number: 1, x: 0, y: -0.7572, z: -0.4692 },
        ] } },
      };
      await setupMockRoutes(page, water);
      await openAdvanced(page);
      await expect(page.locator(".calculation-form-grid").first()).toBeVisible({ timeout: 15_000 });
      for (const id of ["periodic-setup-form", "periodic-engine-select", "qe-options", "qe-kmesh-select"]) await expect(page.locator(`[data-testid="${id}"]`)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Quantum ESPRESSO/ })).toHaveCount(0);
    });
  }

  test("Quantum ESPRESSO is offered but disabled, with the reason, when the deployment does not have it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await setupMockRoutes(page, makeCr2O3Detail(), { qe: false });
    await openAdvanced(page);
    await expect(page.locator('[data-testid="periodic-setup-form"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="periodic-engine-select"] option[value="qe"]')).toHaveAttribute("disabled", "");
    await expect(page.locator('[data-testid="qe-unavailable-reason"]')).toBeVisible();
  });

  test("a published QE result shows engine, Lowdin label, relaxation, and renders the DOS and band charts (FIXTURE)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupMockRoutes(page, makeCr2O3PrimitiveDetail(), { calculations: fixtureResult() });
    await openAdvanced(page);
    await page.locator('[data-testid="periodic-engine-select"]').selectOption("qe");
    await page.getByRole("button", { name: "Run Quantum ESPRESSO periodic job" }).click();
    const plate = page.locator('[data-testid="energy-precision-plate"]');
    await expect(plate).toBeVisible({ timeout: 20_000 });
    await expect(plate).toContainText("Quantum ESPRESSO");
    await expect(page.locator('[data-testid="periodic-local-moments-label"]')).toContainText("Local spin moment (Lowdin projected)");
    await expect(page.locator('[data-testid="periodic-band-gap"]')).toContainText("3.2470 eV");
    await expect(page.locator('[data-testid="qe-relaxation"]')).toContainText("converged");
    await expect(page.locator('[data-testid="qe-relaxation"]'));
    const dosChart = page.locator('[data-testid="qe-dos-chart"] canvas, [data-testid="qe-dos-chart"] svg').first();
    await expect(dosChart).toBeVisible({ timeout: 15_000 });
    const bandsChart = page.locator('[data-testid="qe-bands-chart"] canvas, [data-testid="qe-bands-chart"] svg').first();
    await expect(bandsChart).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="qe-dos-caption"]')).toContainText("relative to the Fermi level");
    await expect(page.locator('[data-testid="qe-dos-gap"]')).toContainText("eigenvalues");
    await expect(page.locator('[data-testid="qe-bands-gap"]')).toContainText("Gap along the chosen path");
    await expect(page.locator('[data-testid="qe-bands-caption"]')).toContainText("not the global gap");
    await expect(page.locator('[data-testid="qe-dos-toggles"]')).toContainText("Cr d");
    await expect(page.locator('[data-testid="qe-dos-export"]')).toBeVisible();
    // Stress and pressure are never shown. The only mention is the sentence saying they are NOT offered.
    const text = (await plate.innerText()).toLowerCase();
    expect(text).not.toMatch(/kbar|gpa|\bpressure\s*[:=]|\bstress\s*[:=]/);
    const withoutLimitNote = text.replace(/[^.]*stress[^.]*not (?:offered|reliable)[^.]*\./g, "");
    expect(withoutLimitNote).not.toContain("stress");
    expect(withoutLimitNote).not.toContain("pressure");
  });
});
