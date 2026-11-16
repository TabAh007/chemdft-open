import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import type { CalculationDetail, ConformerEnsembleResult, StructureVersion } from "@chemdft/schemas";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import crypto from "node:crypto";
import { buildConformerSubmission } from "../../src/lib/conformer-ensemble";
import { openGuidedConfigure, openResultFromJob, preferGuidedMode, reviewAndAcknowledge } from "./guided-helpers";

test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });

const output = resolve(process.env.CHEMDFT_PF8D_OUTPUT ?? "../../output/playwright/pf8d-gate-c");
mkdirSync(output, { recursive: true });

const WATER_XYZ = `3
Water molecule ground state
O 0.00000000 0.00000000 0.11730000
H 0.00000000 0.75720000 -0.46920000
H 0.00000000 -0.75720000 -0.46920000
`;

const METHANE_XYZ = `5
Methane molecule ground state
C 0.00000000 0.00000000 0.00000000
H 0.62760000 0.62760000 0.62760000
H -0.62760000 -0.62760000 0.62760000
H -0.62760000 0.62760000 -0.62760000
H 0.62760000 -0.62760000 -0.62760000
`;

const PSI4_GATE_B_CAPABILITY = {
  engine: "psi4",
  availability: "AVAILABLE",
  version: "1.11",
  supported_tasks: ["ENERGY"],
  supported_methods: ["hf", "b3lyp", "pbe", "mp2"],
  supported_basis_sets: ["sto-3g", "def2-svp"],
  supported_method_basis_pairs: [
    { method: "hf", basis: "sto-3g" },
    { method: "hf", basis: "def2-svp" },
    { method: "b3lyp", basis: "def2-svp" },
    { method: "pbe", basis: "def2-svp" },
    { method: "mp2", basis: "def2-svp" },
  ],
  supported_optimizers: [],
  supported_optimization_levels: [],
  diagnostic: null,
};

interface MockCalculation {
  detail: CalculationDetail;
  inputArtifactId: string;
  inputBytes: Buffer;
  inputHash: string;
}

function createDetail(
  projectId: string,
  calcId: string,
  resultId: string,
  structureVersionId: string,
  methodId: "hf" | "b3lyp" | "mp2",
  basisId: "sto-3g" | "def2-svp",
  payloadData: Record<string, unknown>,
  reference: "rhf" | "rks" = "rhf",
): MockCalculation {
  const inputDoc = { structure_version_id: structureVersionId };
  const inputBytes = Buffer.from(JSON.stringify(inputDoc));
  const inputHash = crypto.createHash("sha256").update(inputBytes).digest("hex");
  const inputArtifactId = crypto.randomUUID();
  const inputId = crypto.randomUUID();
  const attestationId = crypto.randomUUID();
  const outputArtifactId = crypto.randomUUID();

  const detail = {
    calculation: {
      id: calcId,
      project_id: projectId,
      input_id: inputId,
      created_by: "user-1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      state: "SUCCEEDED",
    },
    calculation_input_hash: inputHash,
    specification: {
      task_type: "ENERGY",
      engine_preference: {
        engine: "psi4",
        allowed_version: "1.11",
      },
      method: {
        identifier: methodId,
      },
      basis: {
        identifier: basisId,
      },
      molecular_charge: 0,
      spin_multiplicity: 1,
      scf: {
        reference,
        convergence_threshold: null,
        max_iterations: null,
      },
    },
    attempt: {
      id: crypto.randomUUID(),
      project_id: projectId,
      calculation_id: calcId,
      attempt_number: 1,
      state: "SUCCEEDED",
      worker_id: "local.psi4.worker",
      raw_artifacts: [
        {
          artifact_id: inputArtifactId,
          project_id: projectId,
          file_name: "calculation_input.json",
          format_identifier: "application/json",
          sha256: inputHash,
        },
      ],
    },
    result: {
      id: resultId,
      calculation_id: calcId,
      calculation_input_id: inputId,
      created_at: new Date().toISOString(),
      project_id: projectId,
      provenance_record_id: crypto.randomUUID(),
      source_class: "CALCULATED",
      authority: "AUTHORITATIVE",
      validation_state: "VALIDATED",
      verification_state: "UNVERIFIED",
      // The real API always reports the read-time state; the UI never assumes "currently authoritative" without it.
      effective_state: {
        stored_authority: "AUTHORITATIVE", stored_validation_state: "VALIDATED", stored_verification_state: "UNVERIFIED",
        authority: "AUTHORITATIVE", validation_state: "VALIDATED", verification_state: "UNVERIFIED",
        source_lineage_validity: "ACTIVE", eligible_for_derivation: true, inactive_result_ids: [], reason: null,
      },
      trusted_producer_id: "local.psi4.worker",
      trusted_producer_type: "SCIENTIFIC_WORKER",
      producer_attestation_id: attestationId,
      result_type: "chemdft.energy",
      raw_artifacts: [
        {
          artifact_id: outputArtifactId,
          project_id: projectId,
          file_name: "output.dat",
          format_identifier: "text/plain",
          sha256: "output-sha256",
        },
      ],
      producer_software: {
        name: "psi4",
        version: "1.11",
        adapter_version: "1.0.0",
        execution_backend: "local.subprocess",
      },
      payload: {
        payload_schema: "chemdft.energy",
        ...payloadData,
      },
    },
  } as unknown as CalculationDetail;

  return { detail, inputArtifactId, inputBytes, inputHash };
}

async function verifyEnergyLayout(page: Page, label: string) {
  const plate = page.getByTestId("energy-precision-plate").filter({ visible: true });
  for (const width of [1440, 1280, 1024, 375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await plate.scrollIntoViewIfNeeded();
    const bounds = await plate.evaluate((element) => {
      const pane = element.closest(".project-document")!;
      const parent = pane.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, paneLeft: parent.left, paneRight: parent.right,
        overflow: element.scrollWidth - element.clientWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(bounds.paneLeft - 1);
    expect(bounds.right).toBeLessThanOrEqual(bounds.paneRight + 1);
    expect(bounds.overflow, JSON.stringify({ label, width, bounds })).toBeLessThanOrEqual(1);
    await page.screenshot({ path: resolve(output, `${label}-${width}.png`) });
  }
}

async function routeCalculation(page: Page, mock: MockCalculation) {
  const { detail, inputArtifactId, inputBytes } = mock;
  await page.route(new RegExp(`/calculations/${detail.calculation.id}($|\\?)`), async (route) => {
    await route.fulfill({ json: detail });
  });
  await page.route(
    new RegExp(`/calculations/${detail.calculation.id}/artifacts/${inputArtifactId}($|\\?)`),
    async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-disposition": 'attachment; filename="calculation_input.json"',
        },
        body: inputBytes,
      });
    },
  );
  await page.route(new RegExp("/ai/context($|\\?)"), async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        project_id: detail.calculation.project_id,
        current_selection: null,
        suggested_actions: [],
        entities: [],
      },
    });
  });
  await page.route(new RegExp("/compute/jobs($|\\?)"), async (route) => {
    const res = await route.fetch();
    const existing = await res.json().catch(() => ({ jobs: [] }));
    const jobs = Array.isArray(existing.jobs) ? existing.jobs : [];
    if (!jobs.some((j: { calculation_id: string }) => j.calculation_id === detail.calculation.id)) {
      jobs.push({
        id: detail.calculation.id,
        calculation_id: detail.calculation.id,
        state: "SUCCEEDED",
        provider: "LOCAL",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    await route.fulfill({ json: { jobs } });
  });
}

async function seedProjectAndMolecule(
  request: APIRequestContext,
  name: string,
  xyz: string,
  existingProjectId?: string,
) {
  const projectId =
    existingProjectId ??
    (await (async () => {
      const res = await request.post("/api/chemdft/v1/projects", {
        data: {
          name: `PF-8D ${name}`,
          slug: `pf8d-${crypto.randomUUID()}`,
        },
      });
      expect(res.status()).toBe(201);
      return (await res.json()).id as string;
    })());

  const imported = await request.post(
    `/api/chemdft/v1/projects/${projectId}/structures/imports`,
    {
      multipart: {
        upload: {
          name: `${name}.xyz`,
          mimeType: "chemical/x-xyz",
          buffer: Buffer.from(xyz),
        },
        file_format: "XYZ",
        idempotency_key: crypto.randomUUID(),
      },
    },
  );
  expect(imported.status()).toBe(201);
  const data = await imported.json();
  return { projectId, structureVersion: data.version as StructureVersion };
}

/** Structure (inputs confirmed) → Configure. Nothing is submitted. */
async function navigateToGuidedSetup(page: Page, projectId: string) {
  await preferGuidedMode(page);
  await page.goto(`/en/projects/${projectId}/workspace`);
  await page.waitForLoadState("networkidle");
  await openGuidedConfigure(page);
  return page.getByTestId("guided-calculation-setup");
}

test.describe("PF-8D Gate C — Synthetic response UI coverage and live native acceptance", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.text().includes("Error") || msg.text().includes("Failed")) {
        console.log("BROWSER CONSOLE:", msg.text());
      }
    });
    page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));
    page.on("response", async (res) => {
      if (res.status() >= 400) {
        console.log("HTTP ERROR:", res.status(), res.request().method(), res.url(), await res.text().catch(() => ""));
      }
    });
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("1. Synthetic unavailable capability — fail-closed protection", async ({
    page,
    request,
  }) => {
    const { projectId } = await seedProjectAndMolecule(request, "diagnostic-test", WATER_XYZ);

    await page.route("**/calculations/capabilities", async (route) => {
      const res = await route.fetch();
      const list = await res.json();
      await route.fulfill({ json: list.map((entry: { engine: string }) => entry.engine === "psi4" ? { ...PSI4_GATE_B_CAPABILITY, availability: "MISCONFIGURED", supported_tasks: [], supported_method_basis_pairs: [], diagnostic: "Synthetic runtime integrity failure" } : entry) });
    });
    const setup = await navigateToGuidedSetup(page, projectId);
    await expect(setup).toBeVisible({ timeout: 15_000 });

    const psi4Btn = page.getByTestId("guided-engine-psi4-btn");
    await expect(psi4Btn).toBeVisible();

    // Verify fail-closed behavior: button is disabled when engine is unavailable or misconfigured
    const isDisabled = await psi4Btn.isDisabled();
    expect(isDisabled).toBe(true);

    // Verify diagnostic notice is displayed
    // The engine states its availability and the worker's own diagnostic; it cannot be selected
    await expect(psi4Btn).toContainText("Worker unavailable");
    await expect(psi4Btn).toContainText("Synthetic runtime integrity failure", { timeout: 30_000 });
    await expect(psi4Btn).toHaveAttribute("aria-checked", "false");

    // Capture screenshot of diagnostic notice
    await page.screenshot({
      path: resolve(output, "psi4-misconfigured-diagnostic.png"),
      fullPage: true,
    });
  });

  test("2. Synthetic Guided Mode — Psi4 HF/STO-3G setup, confirmation & result presentation", async ({
    page,
    request,
  }) => {
    const { projectId, structureVersion } = await seedProjectAndMolecule(
      request,
      "water-hf",
      WATER_XYZ,
    );

    await page.route("**/calculations/capabilities", async (route) => {
      const res = await route.fetch();
      const list = await res.json();
      const updated = list.map((entry: { engine: string }) =>
        entry.engine === "psi4" ? PSI4_GATE_B_CAPABILITY : entry,
      );
      if (!updated.some((e: { engine: string }) => e.engine === "psi4")) {
        updated.push(PSI4_GATE_B_CAPABILITY);
      }
      await route.fulfill({ json: updated });
    });

    let submittedPayload: Record<string, unknown> | null = null;
    const calcId = crypto.randomUUID();
    const resultId = crypto.randomUUID();

    // Synthetic response using Gate B HF/STO-3G result fixture values: -74.9629282311457 Hartree, 8 iterations
    const hfMock = createDetail(
      projectId,
      calcId,
      resultId,
      structureVersion.id,
      "hf",
      "sto-3g",
      {
        total_energy: {
          value: -74.9629282311457,
          unit: { code: "HARTREE" },
        },
        method: "hf",
        basis: "sto-3g",
        converged: true,
        scf_iterations: 8,
        final_delta_energy_hartree: 1.2e-9,
      },
      "rhf",
    );

    await page.route("**/calculations", async (route) => {
      if (route.request().method() === "POST") {
        submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ status: 201, json: hfMock.detail });
      } else {
        await route.continue();
      }
    });

    await routeCalculation(page, hfMock);

    const setup = await navigateToGuidedSetup(page, projectId);

    const psi4Btn = page.getByTestId("guided-engine-psi4-btn");
    await expect(psi4Btn).toBeEnabled({ timeout: 30_000 });
    await psi4Btn.click();

    // Verify molecular restrictions banner is visible
    await expect(page.getByTestId("engine-caveat-psi4")).toContainText("H, C and O");

    // Open Advanced settings
    await page.getByText("Advanced settings", { exact: true }).click();

    // Select HF and STO-3G
    await setup.locator("#calc-method").selectOption("hf");
    await setup.locator("#calc-basis").selectOption("sto-3g");

    // Charge and multiplicity are fixed on the Structure stage; Psi4's scope requires a neutral closed-shell singlet
    await expect(setup).toContainText(/charge \+0, multiplicity 1/);
    await expect(setup.locator("#calc-charge")).toHaveCount(0);

    // Capture guided setup screenshot
    await page.screenshot({
      path: resolve(output, "guided-psi4-hf-setup.png"),
      fullPage: true,
    });

    // Review the exact configuration and give the explicit confirmation
    await reviewAndAcknowledge(page);
    await expect(page.getByTestId("review-configuration")).toContainText("Psi4");

    // Verify run button enabled and click
    const runBtn = page.getByTestId("run-calculation-btn");
    await expect(runBtn).toBeEnabled();
    await runBtn.click();

    // Verify payload contract. Submission first re-reads engine availability, so the request follows the click.
    await expect.poll(() => submittedPayload).not.toBeNull();
    const payload = submittedPayload as unknown as {
      specification: {
        engine_preference: { engine: string };
        method: { identifier: string };
        basis: { identifier: string };
        charge: number;
        multiplicity: number;
        scf: { reference: string };
      };
    };
    expect(payload.specification.engine_preference.engine).toBe("psi4");
    expect(payload.specification.method.identifier).toBe("hf");
    expect(payload.specification.basis.identifier).toBe("sto-3g");
    expect(payload.specification.charge).toBe(0);
    expect(payload.specification.multiplicity).toBe(1);
    expect(payload.specification.scf.reference).toBe("rhf");

    // The accepted calculation is shown by the job panel; its result opens only when the researcher asks
    await openResultFromJob(page, 15_000);

    // Verify EnergyPrecisionPlate
    const plate = page.locator('[data-testid="energy-precision-plate"]');
    await expect(plate).toBeVisible({ timeout: 15_000 });
    await expect(plate).toHaveAttribute("data-engine", "psi4");
    await expect(plate).toHaveAttribute("data-method", "hf");
    await expect(plate).toContainText("-74.9629282311");
    await expect(plate).toContainText("HF");
    await expect(plate).toContainText("STO-3G");
    await expect(plate).toContainText("Authoritative Engine Result");

    // Capture guided result screenshot
    await page.screenshot({
      path: resolve(output, "guided-psi4-hf-result.png"),
      fullPage: true,
    });
  });

  test("3. Synthetic Guided Mode — DFT B3LYP/def2-SVP calculation and result presentation", async ({
    page,
    request,
  }) => {
    const { projectId, structureVersion } = await seedProjectAndMolecule(
      request,
      "water-b3lyp",
      WATER_XYZ,
    );

    await page.route("**/calculations/capabilities", async (route) => {
      const res = await route.fetch();
      const list = await res.json();
      const updated = list.map((entry: { engine: string }) =>
        entry.engine === "psi4" ? PSI4_GATE_B_CAPABILITY : entry,
      );
      await route.fulfill({ json: updated });
    });

    const calcId = crypto.randomUUID();
    const resultId = crypto.randomUUID();

    // Synthetic response using Gate B B3LYP/def2-SVP fixture: -76.35812084220528 Hartree, 11 iterations
    const dftMock = createDetail(
      projectId,
      calcId,
      resultId,
      structureVersion.id,
      "b3lyp",
      "def2-svp",
      {
        total_energy: {
          value: -76.35812084220528,
          unit: { code: "HARTREE" },
        },
        method: "b3lyp",
        basis: "def2-svp",
        converged: true,
        scf_iterations: 11,
        final_delta_energy_hartree: 4.5e-9,
      },
      "rks",
    );

    await page.route("**/calculations", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 201, json: dftMock.detail });
      } else {
        await route.continue();
      }
    });

    await routeCalculation(page, dftMock);

    const setup = await navigateToGuidedSetup(page, projectId);
    await expect(page.getByTestId("guided-engine-psi4-btn")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("guided-engine-psi4-btn").click();
    await page.getByText("Advanced settings", { exact: true }).click();

    await setup.locator("#calc-method").selectOption("b3lyp");
    await expect(setup.locator("#calc-basis")).toHaveValue("def2-svp");

    await reviewAndAcknowledge(page);
    await page.getByTestId("run-calculation-btn").click();
    await openResultFromJob(page, 15_000);

    const plate = page.locator('[data-testid="energy-precision-plate"]');
    await expect(plate).toBeVisible({ timeout: 15_000 });
    await expect(plate).toContainText("B3LYP");
    await expect(plate).toContainText("DEF2-SVP");
    await expect(plate).toContainText("-76.3581208422");

    await page.screenshot({
      path: resolve(output, "guided-psi4-dft-result.png"),
      fullPage: true,
    });
  });

  test("4. Synthetic Advanced Workbench — Conventional MP2/def2-SVP setup & energy decomposition plate", async ({
    page,
    request,
  }) => {
    const { projectId, structureVersion } = await seedProjectAndMolecule(
      request,
      "water-mp2",
      WATER_XYZ,
    );

    await page.route("**/calculations/capabilities", async (route) => {
      const res = await route.fetch();
      const list = await res.json();
      const updated = list.map((entry: { engine: string }) =>
        entry.engine === "psi4" ? PSI4_GATE_B_CAPABILITY : entry,
      );
      await route.fulfill({ json: updated });
    });

    const calcId = crypto.randomUUID();
    const resultId = crypto.randomUUID();

    // Synthetic response using Gate B Conventional MP2/def2-SVP fixture values:
    // Total energy: -76.16457152292773 Hartree
    // HF reference: -75.96101481661853 Hartree
    // MP2 correlation: -0.2035567063092003 Hartree
    // Same-spin: -0.05126376552069602 Hartree
    // Opposite-spin: -0.1522929407885108 Hartree
    const mp2Mock = createDetail(
      projectId,
      calcId,
      resultId,
      structureVersion.id,
      "mp2",
      "def2-svp",
      {
        total_energy: {
          value: -76.16457152292773,
          unit: { code: "HARTREE" },
        },
        method: "mp2",
        basis: "def2-svp",
        converged: true,
        scf_iterations: 8,
        hf_reference_hartree: -75.96101481661853,
        mp2_correlation_hartree: -0.2035567063092003,
        mp2_same_spin_hartree: -0.05126376552069602,
        mp2_opposite_spin_hartree: -0.1522929407885108,
      },
      "rhf",
    );

    let submittedPayload: Record<string, unknown> | null = null;
    await page.route("**/calculations", async (route) => {
      if (route.request().method() === "POST") {
        submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ status: 201, json: mp2Mock.detail });
      } else {
        await route.continue();
      }
    });

    await routeCalculation(page, mp2Mock);

    await page.goto(
      `/en/projects/${projectId}/workspace?selection=structureVersion:${structureVersion.id}&source=${structureVersion.structure_id}`,
    );
    await page.waitForLoadState("networkidle");

    // Switch to Advanced Workbench
    await page.getByTestId("mode-toggle-advanced").click();
    const calculateBtn = page.getByRole("button", { name: "Calculate" });
    if (await calculateBtn.isVisible()) {
      await calculateBtn.click();
    } else {
      const projectTab = page.getByRole("tab", { name: "Project" });
      if (await projectTab.isVisible()) {
        await projectTab.click();
      }
    }
    const calcPanel = page.locator(".calculation-panel");
    await expect(calcPanel).toBeVisible({ timeout: 30_000 });

    // Select Task: Single-point energy
    await calcPanel.getByLabel("Task").selectOption("ENERGY");

    // Select Engine: Psi4
    await calcPanel.getByLabel("Engine").selectOption("psi4");

    // Select Method: MP2
    await calcPanel.getByLabel("Method").selectOption("mp2");

    // Basis should automatically cascade to def2-svp
    await expect(calcPanel.getByLabel("Basis")).toHaveValue("def2-svp");

    // Charge and multiplicity should be locked to 0 and 1
    await expect(calcPanel.getByLabel("Charge")).toBeDisabled();
    await expect(calcPanel.getByLabel("Charge")).toHaveValue("0");
    await expect(calcPanel.getByLabel("Multiplicity")).toBeDisabled();
    await expect(calcPanel.getByLabel("Multiplicity")).toHaveValue("1");

    // Capture advanced setup screenshot
    await page.screenshot({
      path: resolve(output, "advanced-psi4-mp2-setup.png"),
      fullPage: true,
    });

    // Run Psi4 energy
    await calcPanel.getByRole("button", { name: "Run Psi4 energy" }).click();

    // Verify payload contract
    expect(submittedPayload).not.toBeNull();
    const payload = submittedPayload as unknown as {
      specification: {
        engine_preference: { engine: string };
        method: { identifier: string };
        basis: { identifier: string };
        scf: { reference: string };
      };
    };
    expect(payload.specification.engine_preference.engine).toBe("psi4");
    expect(payload.specification.method.identifier).toBe("mp2");
    expect(payload.specification.basis.identifier).toBe("def2-svp");
    expect(payload.specification.scf.reference).toBe("rhf");

    // Verify Advanced EnergyPrecisionPlate
    const plate = page.locator('[data-testid="energy-precision-plate"]');
    await expect(plate).toBeVisible({ timeout: 15_000 });
    await expect(plate).toContainText("Conventional MP2");
    await expect(plate).toContainText("Post-Hartree–Fock");
    await expect(plate).toContainText("-76.1645715229");

    // Verify MP2 correlation decomposition plate
    await expect(plate).toContainText("MP2 Energy Decomposition");
    await expect(plate).toContainText("-75.9610148166"); // HF Reference
    await expect(plate).toContainText("-0.2035567063"); // MP2 Correlation
    await expect(plate).toContainText("-0.0512637655"); // Same-spin
    await expect(plate).toContainText("-0.1522929408"); // Opposite-spin

    await verifyEnergyLayout(page, "synthetic-mp2-decomposition");

    // Capture advanced MP2 result screenshot
    await page.screenshot({
      path: resolve(output, "advanced-psi4-mp2-result.png"),
      fullPage: true,
    });
  });

  test("5. Synthetic Scientific Identity Safety — Cross-molecule context isolation", async ({
    page,
    request,
  }) => {
    // Seed water and methane in same project
    const { projectId, structureVersion: waterVersion } = await seedProjectAndMolecule(
      request,
      "water-identity",
      WATER_XYZ,
    );
    const { structureVersion: methaneVersion } = await seedProjectAndMolecule(
      request,
      "methane-identity",
      METHANE_XYZ,
      projectId,
    );

    const waterCalcId = crypto.randomUUID();
    const waterResultId = crypto.randomUUID();

    const waterMock = createDetail(
      projectId,
      waterCalcId,
      waterResultId,
      waterVersion.id,
      "hf",
      "def2-svp",
      {
        total_energy: {
          value: -75.96101481661853,
          unit: { code: "HARTREE" },
        },
        method: "hf",
        basis: "def2-svp",
        converged: true,
        scf_iterations: 8,
      },
      "rhf",
    );

    await routeCalculation(page, waterMock);

    // 1. Visit workspace with methane actively selected
    await page.goto(
      `/en/projects/${projectId}/workspace?selection=structureVersion:${methaneVersion.id}&source=${methaneVersion.structure_id}`,
    );
    await page.waitForLoadState("networkidle");

    // 2. Open water calculation result explicitly
    await page.goto(
      `/en/projects/${projectId}/workspace?selection=calculationResult:${waterResultId}&source=${waterCalcId}`,
    );
    await page.waitForLoadState("networkidle");

    // 3. Verify plate explicitly references water's structure version ID and NOT methane
    const plate = page.locator('[data-testid="energy-precision-plate"]');
    await expect(plate).toBeVisible({ timeout: 15_000 });
    await expect(plate).toHaveAttribute("data-calculation-id", waterCalcId);
    await expect(plate).toHaveAttribute("data-result-id", waterResultId);
    await expect(plate).toHaveAttribute("data-structure-version-id", waterVersion.id);

    // Capture screenshot of cross-molecule identity verification
    await page.screenshot({
      path: resolve(output, "cross-molecule-identity-safety.png"),
      fullPage: true,
    });
  });

  test("6. Performance — Bounded capability caching with no polling loops", async ({
    page,
    request,
  }) => {
    const { projectId } = await seedProjectAndMolecule(request, "perf-test", WATER_XYZ);

    // The capability contract is served with the synthetic Psi4 entry so the test does not depend on a local Psi4
    // install; every request is still made, counted and answered by the real API for the other engines.
    await page.route("**/calculations/capabilities", async (route) => {
      const res = await route.fetch();
      const list = await res.json();
      await route.fulfill({ json: list.map((entry: { engine: string }) => entry.engine === "psi4" ? PSI4_GATE_B_CAPABILITY : entry) });
    });
    let capabilityRequests = 0;
    page.on("request", (req) => {
      if (req.url().includes("/calculations/capabilities")) {
        capabilityRequests++;
      }
    });

    await preferGuidedMode(page);
    await page.goto(`/en/projects/${projectId}/workspace`);
    await page.waitForLoadState("networkidle");

    await openGuidedConfigure(page);
    await expect(page.getByTestId("guided-engine-psi4-btn")).toBeEnabled({ timeout: 30_000 });
    expect(capabilityRequests).toBe(1);
    await page.getByTestId("guided-engine-psi4-btn").click();
    await page.getByText("Advanced settings", { exact: true }).click();
    await page.locator("#calc-method").selectOption("b3lyp");
    await page.getByTestId("mode-toggle-advanced").click();
    const calculate = page.getByRole("button", { name: "Calculate", exact: true });
    if (await calculate.isVisible()) await calculate.click();
    else await page.getByRole("tab", { name: "Project", exact: true }).click();
    await expect(page.locator(".calculation-panel")).toBeVisible();
    await page.getByTestId("mode-toggle-guided").click();
    await page.getByTestId("guided-nav-calculations").click();
    await page.waitForTimeout(5000);
    expect(capabilityRequests).toBe(1);
    writeFileSync(resolve(output, "capability-navigation-count.json"), JSON.stringify({ capabilityRequests, observationSeconds: 5, navigation: ["Guided setup", "method change", "Advanced Calculate", "Guided setup"] }, null, 2));

  });

  test("7. Responsive Design — Guided Mode on mobile viewport", async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const { projectId } = await seedProjectAndMolecule(request, "mobile-test", WATER_XYZ);

    await page.route("**/calculations/capabilities", async (route) => {
      const res = await route.fetch();
      const list = await res.json();
      const updated = list.map((entry: { engine: string }) =>
        entry.engine === "psi4" ? PSI4_GATE_B_CAPABILITY : entry,
      );
      await route.fulfill({ json: updated });
    });

    const setup = await navigateToGuidedSetup(page, projectId);
    await expect(setup).toBeVisible({ timeout: 15_000 });

    const psi4Btn = page.getByTestId("guided-engine-psi4-btn");
    await expect(psi4Btn).toBeVisible();
    await psi4Btn.click();

    await page.screenshot({
      path: resolve(output, "responsive-guided-psi4-mobile.png"),
      fullPage: true,
    });
  });
});

test("LIVE NATIVE — five Psi4 pairs submitted through Guided/Advanced with persisted result identities", async ({ page, request }) => {
  test.setTimeout(600_000);
  const { projectId, structureVersion } = await seedProjectAndMolecule(request, "native-water", WATER_XYZ);
  const { structureVersion: other } = await seedProjectAndMolecule(request, "native-methane", METHANE_XYZ, projectId);
  const records: CalculationDetail[] = [];
  const capabilityCalls: string[] = [];
  page.on("request", (req) => { if (req.url().endsWith("/calculations/capabilities")) capabilityCalls.push(req.url()); });
  const pairs = [["hf", "sto-3g", "guided"], ["b3lyp", "def2-svp", "guided"], ["mp2", "def2-svp", "advanced"], ["hf", "def2-svp", "guided"], ["pbe", "def2-svp", "guided"]] as const;
  async function verify(record: CalculationDetail) {
    const plate = page.getByTestId("energy-precision-plate").filter({ visible: true });
    const payload = record.result!.payload as unknown as { total_energy: { value: number; unit: { code: string } }; [key: string]: unknown };
    await expect(plate).toHaveAttribute("data-calculation-id", record.calculation.id);
    await expect(plate).toHaveAttribute("data-result-id", record.result!.id);
    await expect(plate).toHaveAttribute("data-structure-version-id", structureVersion.id);
    await expect(plate).toHaveAttribute("data-input-hash", record.calculation_input_hash);
    await expect(plate).toHaveAttribute("data-engine", "psi4");
    await expect(plate).toHaveAttribute("data-method", record.specification.method.identifier);
    await expect(plate.getByTestId("energy-readout-value")).toHaveText(payload.total_energy.value.toFixed(10));
    await expect(plate).toContainText(payload.total_energy.unit.code);
    await expect(plate).toContainText(record.result!.provenance_record_id);
    await expect(plate).toContainText(record.result!.producer_software.version);
    await expect(plate).toContainText(record.result!.validation_state);
    if (record.specification.method.identifier === "mp2") {
      for (const [key, id] of [["hf_reference_hartree", "mp2-reference-energy"], ["mp2_correlation_hartree", "mp2-correlation-energy"]] as const) {
        if (typeof payload[key] === "number") {
          await expect(plate.getByTestId(id)).toContainText(payload[key].toFixed(10));
        } else {
          await expect(plate.getByTestId(id)).toHaveCount(0);
        }
      }
      for (const key of ["mp2_same_spin_hartree", "mp2_opposite_spin_hartree"]) {
        if (typeof payload[key] === "number") await expect(plate).toContainText(payload[key].toFixed(10));
      }
    }
    return { calculationId: record.calculation.id, resultId: record.result!.id, versionId: structureVersion.id, persisted: payload, missingPublishedMp2Components: record.specification.method.identifier === "mp2" ? ["hf_reference_hartree", "mp2_correlation_hartree", "mp2_same_spin_hartree", "mp2_opposite_spin_hartree"].filter((key) => typeof payload[key] !== "number") : [], displayed: await plate.innerText() };
  }
  const comparisons = [];
  for (const [method, basis, mode] of pairs) {
    console.log(`Native UI start: ${mode} ${method}/${basis}`);
    await page.goto(`/en/projects/${projectId}/workspace?selection=structureVersion:${structureVersion.id}&source=${structureVersion.structure_id}`);
    await expect(page.getByTestId("guided-nav-calculations")).toBeVisible();
    if (mode === "guided") {
      await openGuidedConfigure(page);
      await expect(page.getByTestId("guided-engine-psi4-btn")).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId("guided-engine-psi4-btn").click();
      await page.getByText("Advanced settings", { exact: true }).click();
      const setup = page.getByTestId("guided-calculation-setup").filter({ visible: true });
      await setup.locator("#calc-method").selectOption(method);
      await setup.locator("#calc-basis").selectOption(basis);
      await reviewAndAcknowledge(page);
      // Confirmation belongs to this exact engine/method/basis selection: changing it withdraws the confirmation.
      await page.getByTestId("guided-stage-configure").click();
      await setup.locator("#calc-method").selectOption(method === "hf" ? "b3lyp" : "hf");
      await page.getByTestId("guided-stage-review").click();
      await expect(page.getByTestId("setup-confirm-checkbox")).not.toBeChecked();
      await page.getByTestId("guided-stage-configure").click();
      await setup.locator("#calc-method").selectOption(method); await setup.locator("#calc-basis").selectOption(basis);
      await reviewAndAcknowledge(page);
    } else {
      await page.getByTestId("mode-toggle-advanced").click();
      const calculate = page.getByRole("button", { name: "Calculate", exact: true });
      if (await calculate.isVisible()) await calculate.click();
      const panel = page.locator(".calculation-panel"); await expect(panel).toBeVisible();
      await panel.getByLabel("Task").selectOption("ENERGY");
      await expect(panel.getByLabel("Engine").locator('option[value="psi4"]')).toBeEnabled({ timeout: 30_000 });
      await panel.getByLabel("Engine").selectOption("psi4");
      await panel.getByLabel("Method").selectOption(method);
      await panel.getByLabel("Basis").selectOption(basis);
    }
    const nativeRun = mode === "guided" ? page.getByTestId("run-calculation-btn") : page.getByRole("button", { name: "Run Psi4 energy", exact: true });
    await expect(nativeRun).toBeEnabled({ timeout: 30_000 });
    if (mode === "advanced") {
      const panel = page.locator(".calculation-panel");
      const overflow = await panel.locator(".calculation-form-grid").evaluate((grid) => grid.scrollWidth > grid.clientWidth + 1);
      expect(overflow).toBe(false);
    }
    await page.screenshot({ path: resolve(output, `native-${method}-${basis}-setup.png`), fullPage: true });
    const submitted = page.waitForResponse((res) => res.request().method() === "POST" && res.url().endsWith("/calculations"), { timeout: 60_000 });
    await (mode === "guided" ? page.getByTestId("run-calculation-btn") : page.getByRole("button", { name: "Run Psi4 energy", exact: true })).click();
    const response = await submitted; expect(response.status(), await response.text()).toBe(201);
    const sent = response.request().postDataJSON();
    expect(sent.structure_version.entity_id).toBe(structureVersion.id);
    expect(sent.specification.engine_preference.engine).toBe("psi4");
    expect(sent.specification.method.identifier).toBe(method); expect(sent.specification.basis.identifier).toBe(basis);
    expect(sent.specification.scf.reference).toBe(["b3lyp", "pbe"].includes(method) ? "rks" : "rhf");
    expect(sent.specification.scf.convergence_threshold).toBeUndefined();
    let record: CalculationDetail = await response.json();
    await expect.poll(async () => {
      record = await (await request.get(`/api/chemdft/v1/projects/${projectId}/calculations/${record.calculation.id}`)).json();
      return record.calculation.state;
    }, { timeout: 180_000, intervals: [1500] }).toBe("SUCCEEDED");
    expect(record.result!.validation_state).toBe("VALIDATED"); records.push(record);
    console.log(`Native published: ${method}/${basis} ${record.calculation.id}`);
    // Keep the unrelated methane as current structure, then open the water calculation in this workspace.
    if (mode === "advanced") {
      const panel = page.locator(".calculation-panel");
      await panel.getByLabel("Task").selectOption("TDDFT");
      await expect(panel.getByLabel("Engine")).toHaveValue("pyscf");
      await expect(panel.getByLabel("Method")).toHaveValue("b3lyp");
      await expect(panel.getByLabel("Basis")).toHaveValue("def2-svpd");
      await page.getByTestId("mode-toggle-guided").click();
    }
    await page.goto(`/en/projects/${projectId}/workspace?selection=structureVersion:${other.id}&source=${other.structure_id}`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(new RegExp(`selection=structureVersion:${other.id}`));
    await page.getByTestId("guided-nav-results").click();
    const picker = page.getByTestId("guided-result-picker");
    await expect(picker).toBeVisible(); await picker.selectOption(record.result!.id);
    comparisons.push(await verify(record));
    await page.screenshot({ path: resolve(output, `native-${method}-${basis}-result.png`), fullPage: true });
    await page.getByTestId("mode-toggle-advanced").click(); await verify(record);
    if (method === "mp2") await verifyEnergyLayout(page, "native-mp2-provenance");
    await page.getByTestId("mode-toggle-guided").click(); await verify(record);
    // Save the real native artifacts returned by the persisted calculation record.
    for (const artifact of record.attempt?.raw_artifacts ?? []) {
      const res = await request.get(`/api/chemdft/v1/projects/${projectId}/calculations/${record.calculation.id}/artifacts/${artifact.artifact_id}`);
      expect(res.ok()).toBe(true);
      const bytes = await res.body(); expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
      writeFileSync(resolve(output, `${record.calculation.id}--${artifact.artifact_id}.bin`), bytes);
    }
    writeFileSync(resolve(output, "live-native-records.json"), JSON.stringify({ projectId, structureVersion, other, records, comparisons, capabilityCalls }, null, 2));
  }
  // Repeated single-result selection must retain the exact published result identity.
  const picker = page.getByTestId("guided-result-picker");
  for (const record of [records[0]!, records[2]!, records[1]!, records[0]!]) {
    await picker.selectOption(record.result!.id); await verify(record);
  }
  const before = capabilityCalls.length;
  await page.getByTestId("mode-toggle-advanced").click(); await page.getByTestId("mode-toggle-guided").click();
  await page.waitForTimeout(3000); expect(capabilityCalls.length).toBe(before);
  writeFileSync(resolve(output, "live-native-records.json"), JSON.stringify({ projectId, structureVersion, other, records, comparisons, capabilityCalls }, null, 2));
});

for (const mode of ["guided", "advanced"] as const) test(`Synthetic ${mode} transport retry retains one idempotency key`, async ({ page, request }) => {
  test.setTimeout(120_000);
  const { projectId, structureVersion } = await seedProjectAndMolecule(request, `retry-${mode}`, WATER_XYZ);
  await page.route("**/calculations/capabilities", (route) => route.fulfill({ json: [PSI4_GATE_B_CAPABILITY] }));
  const mock = createDetail(projectId, crypto.randomUUID(), crypto.randomUUID(), structureVersion.id, "hf", "sto-3g", {
    total_energy: { value: -74.9, unit: { code: "Eh" } }, method: "hf", basis: "sto-3g", converged: true,
  });
  await routeCalculation(page, mock);
  const payloads: Array<{ idempotency_key: string }> = [];
  await page.route("**/calculations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    payloads.push(route.request().postDataJSON());
    if (payloads.length === 1) return route.abort("failed");
    return route.fulfill({ status: 201, json: mock.detail });
  });
  await page.goto(`/en/projects/${projectId}/workspace?selection=structureVersion:${structureVersion.id}&source=${structureVersion.structure_id}`);
  let run;
  if (mode === "guided") {
    await openGuidedConfigure(page);
    await expect(page.getByTestId("guided-engine-psi4-btn")).toBeEnabled();
    await page.getByTestId("guided-engine-psi4-btn").click();
    await page.getByText("Advanced settings", { exact: true }).click();
    await page.locator("#calc-basis").selectOption("sto-3g");
    await reviewAndAcknowledge(page);
    run = page.getByTestId("run-calculation-btn");
  } else {
    await page.getByTestId("mode-toggle-advanced").click();
    await page.getByRole("button", { name: "Calculate", exact: true }).click();
    const panel = page.locator(".calculation-panel");
    await panel.getByLabel("Task").selectOption("ENERGY");
    await expect(panel.getByLabel("Engine").locator('option[value="psi4"]')).toBeEnabled();
    await panel.getByLabel("Engine").selectOption("psi4");
    run = panel.getByRole("button", { name: "Run Psi4 energy" });
  }
  await run.click();
  await expect.poll(() => payloads.length).toBe(1);
  await expect(run).toBeEnabled();
  if (mode === "guided") await expect(page.getByTestId("submit-error")).toBeVisible();
  await expect(page.getByTestId("energy-precision-plate")).toHaveCount(0);
  await run.click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[0]!.idempotency_key).toBe(payloads[1]!.idempotency_key);
  if (mode === "guided") await openResultFromJob(page, 15_000);
  await expect(page.getByTestId("energy-precision-plate").filter({ visible: true })).toBeVisible();
  if (mode === "advanced") {
    await expect(run).toBeEnabled(); await run.click();
    await expect.poll(() => payloads.length).toBe(3);
    expect(payloads[2]!.idempotency_key).not.toBe(payloads[1]!.idempotency_key);
  }
});

test("LIVE IDENTITY — native one-member CREST ensemble and Psi4 results retain independent identities", async ({ page, request }) => {
  test.setTimeout(300_000);
  const native = JSON.parse(readFileSync(resolve(output, "live-native-records.json"), "utf8")) as {
    projectId: string; structureVersion: StructureVersion; other: StructureVersion; records: CalculationDetail[];
  };
  const { projectId, structureVersion: input, other, records } = native;
  // Seed a genuine native ensemble through the accepted API; all five Psi4 submissions above use the real UI.
  const submitted = await request.post(`/api/chemdft/v1/projects/${projectId}/calculations`, {
    data: buildConformerSubmission(projectId, input.id, crypto.randomUUID()),
  });
  expect(submitted.status(), await submitted.text()).toBe(201);
  let ensembleDetail: CalculationDetail = await submitted.json();
  await expect.poll(async () => {
    ensembleDetail = await (await request.get(`/api/chemdft/v1/projects/${projectId}/calculations/${ensembleDetail.calculation.id}`)).json();
    return ensembleDetail.calculation.state;
  }, { timeout: 240_000, intervals: [1500] }).toBe("SUCCEEDED");
  expect(ensembleDetail.result!.validation_state).toBe("VALIDATED");
  expect(ensembleDetail.result!.trusted_producer_id).toBe("local.crest.worker");
  const payload = ensembleDetail.result!.payload as ConformerEnsembleResult;
  expect(payload.manifest.members).toHaveLength(1);
  const member = payload.manifest.members[0]!;
  await page.goto(`/en/projects/${projectId}/workspace?selection=structureVersion:${other.id}&source=${other.structure_id}`);
  await page.getByTestId("guided-nav-results").click();
  const picker = page.getByTestId("guided-result-picker");
  async function verifyEnsemble() {
    const ensemble = page.locator('[data-testid="conformer-ensemble"]:visible');
    await expect(ensemble).toHaveAttribute("data-result-id", ensembleDetail.result!.id);
    await expect(ensemble).toHaveAttribute("data-calculation-id", ensembleDetail.calculation.id);
    await expect(ensemble).toHaveAttribute("data-member-id", member.conformer.id);
    await expect(ensemble).toContainText("One retained member; no inter-member comparison");
    await expect(ensemble).toContainText("Minimum status: Unverified (UNVERIFIED)");
    await expect(ensemble.getByTestId("conformer-selected-energy")).toContainText(`${member.native_electronic_energy.value.toFixed(8)} Eh`);
    await expect(ensemble.getByTestId("conformer-geometry")).toHaveAttribute("data-native-record-sha256", member.native_record_sha256);
    await expect(page.locator('[data-testid="energy-precision-plate"]:visible')).toHaveCount(0);
  }
  for (const energy of [records[0]!, records[2]!]) {
    await picker.selectOption(ensembleDetail.result!.id); await verifyEnsemble();
    await picker.selectOption(energy.result!.id);
    const plate = page.locator('[data-testid="energy-precision-plate"]:visible');
    await expect(plate).toHaveAttribute("data-result-id", energy.result!.id);
    await expect(plate).toHaveAttribute("data-calculation-id", energy.calculation.id);
    await expect(plate).toHaveAttribute("data-structure-version-id", input.id);
    await expect(plate).toContainText((energy.result!.payload as { total_energy: { value: number } }).total_energy.value.toFixed(10));
    await expect(page.locator('[data-testid="conformer-ensemble"]:visible')).toHaveCount(0);
  }
  await picker.selectOption(ensembleDetail.result!.id); await verifyEnsemble();
  await page.getByTestId("mode-toggle-advanced").click(); await verifyEnsemble();
  await page.getByTestId("mode-toggle-guided").click(); await verifyEnsemble();
  const versions = await (await request.get(`/api/chemdft/v1/projects/${projectId}/structures/${input.structure_id}/versions`)).json();
  expect(versions).toHaveLength(1); expect(versions[0].version.coordinates).toEqual(input.coordinates);
  writeFileSync(resolve(output, "one-member-identity.json"), JSON.stringify({ ensembleDetail, member, activeUnrelatedVersion: other.id, psi4Results: [records[0]!.result!.id, records[2]!.result!.id], inputUnchanged: true }, null, 2));
  await page.screenshot({ path: resolve(output, "native-one-member-cross-result.png"), fullPage: true });
});

test("Synthetic Advanced cancellation cannot be replaced by an older status response", async ({ page, request }) => {
  const { projectId, structureVersion } = await seedProjectAndMolecule(request, "cancel-race", WATER_XYZ);
  await page.route("**/calculations/capabilities", (route) => route.fulfill({ json: [PSI4_GATE_B_CAPABILITY] }));
  const mock = createDetail(projectId, crypto.randomUUID(), crypto.randomUUID(), structureVersion.id, "hf", "sto-3g", {
    total_energy: { value: -74.9, unit: { code: "Eh" } }, method: "hf", basis: "sto-3g", converged: true,
  });
  const running = { ...mock.detail, result: null, calculation: { ...mock.detail.calculation, state: "RUNNING" },
    compute_job: { id: crypto.randomUUID(), state: "RUNNING", provider: "LOCAL" } };
  const canceled = { ...running, calculation: { ...running.calculation, state: "CANCELED" } };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let statusCalls = 0;
  await page.route("**/calculations", (route) => route.request().method() === "POST" ? route.fulfill({ status: 201, json: running }) : route.continue());
  await page.route(`**/calculations/${running.calculation.id}`, async (route) => {
    statusCalls++; await gate; await route.fulfill({ json: running });
  });
  await page.route(`**/calculations/${running.calculation.id}/cancel`, (route) => route.fulfill({ json: canceled }));
  await page.goto(`/en/projects/${projectId}/workspace?selection=structureVersion:${structureVersion.id}&source=${structureVersion.structure_id}`);
  await page.getByTestId("mode-toggle-advanced").click();
  await page.getByRole("button", { name: "Calculate", exact: true }).click();
  const panel = page.locator(".calculation-panel");
  await panel.getByLabel("Task").selectOption("ENERGY");
  await expect(panel.getByLabel("Engine").locator('option[value="psi4"]')).toBeEnabled();
  await panel.getByLabel("Engine").selectOption("psi4");
  await panel.getByRole("button", { name: "Run Psi4 energy", exact: true }).click();
  await expect.poll(() => statusCalls).toBe(1);
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(panel.getByLabel("Calculation result")).toContainText("CANCELED");
  release(); await page.waitForTimeout(3500);
  await expect(panel.getByLabel("Calculation result")).toContainText("CANCELED");
  expect(statusCalls).toBe(1);
  await expect(panel.getByTestId("energy-precision-plate")).toHaveCount(0);
});
