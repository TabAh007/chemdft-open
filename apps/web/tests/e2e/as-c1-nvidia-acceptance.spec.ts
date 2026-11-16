import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AISettingsView } from "@chemdft/schemas";
import { choosePlanMode } from "./ai-composer";

// AS-C1.2: Live browser acceptance test with real NVIDIA Nemotron AI Scientist & PySCF worker
const root = "/api/chemdft/v1";
const approvalSeconds = Number(process.env.CHEMDFT_E2E_APPROVAL_SECONDS ?? 600);
const shots = resolve(process.env.CHEMDFT_TEST_WORKSPACE ?? "/tmp", "as-c1-visual");
test.setTimeout((approvalSeconds + 240) * 1000);
test.use({ viewport: { width: 1600, height: 1100 } });

test("AS-C1.2: Live browser acceptance — NVIDIA AI Scientist planning, researcher approval, real PySCF H2 execution & firewall validation", async ({ page, request }) => {
  mkdirSync(shots, { recursive: true });
  expect(process.env.CHEMDFT_E2E_WORKER_MODE).toBe("disabled");
  expect(process.env.CHEMDFT_E2E_MANUAL_APPROVAL).toBe("1");
  expect(process.env.CHEMDFT_AI_PROVIDER).toBe("nvidia");

  // Step 1: Project creation
  const created = await request.post(`${root}/projects`, {
    data: {
      name: "AS-C1.2 · NVIDIA AI Scientist H2 Ground-State Acceptance",
      slug: `as-c1-${crypto.randomUUID()}`,
    },
  });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).id;
  const base = `${root}/projects/${projectId}`;

  // Step 2: Import molecular hydrogen (0.74 Å bond length)
  const imported = await request.post(`${base}/structures/imports`, {
    multipart: {
      upload: {
        name: "h2_074.xyz",
        mimeType: "chemical/x-xyz",
        buffer: Buffer.from("2\nH2 reference geometry (0.74 Angstrom)\nH 0.000000 0.000000 -0.370000\nH 0.000000 0.000000 0.370000\n"),
      },
      file_format: "XYZ",
      idempotency_key: crypto.randomUUID(),
      structure_name: "H2 (0.74 Å)",
    },
  });
  expect(imported.status()).toBe(201);
  const structure = await imported.json();

  // Configure AI settings if needed (defaults to backend configured provider)
  const settingsResponse = await request.get(`${root}/ai/settings`);
  expect(settingsResponse.status()).toBe(200);
  const currentAiSettings: AISettingsView = await settingsResponse.json();
  const provider = "nvidia";
  const model = "nvidia/nemotron-3.5-lightning-30b-a3b";
  expect(currentAiSettings.preferences.provider).toBe(provider);
  expect(currentAiSettings.preferences.model).toBe(model);
  expect(currentAiSettings.availability.provider).toBe(provider);
  expect(currentAiSettings.availability.model).toBe(model);
  const configuredResponse = await request.put(`${root}/ai/settings`, {
    data: { mode: "MANAGED", provider, model },
  });
  expect(configuredResponse.status()).toBe(200);
  const configuredAiSettings: AISettingsView = await configuredResponse.json();
  expect(configuredAiSettings.preferences.provider).toBe(provider);
  expect(configuredAiSettings.preferences.model).toBe(model);
  expect(configuredAiSettings.preferences.mode).toBe("MANAGED");
  expect(configuredAiSettings.availability.provider).toBe(provider);
  expect(configuredAiSettings.availability.model).toBe(model);
  expect(configuredAiSettings.availability.mode).toBe("MANAGED");
  expect(configuredAiSettings.availability.available).toBe(true);

  // Step 3: Open ChemDFT in browser
  await page.goto(`/en/projects/${projectId}/workspace`);
  const showButton = page.getByRole("button", { name: "Show AI Scientist panel", exact: true });
  if (await showButton.isVisible()) {
    await showButton.click();
  }
  const panel = page.getByTestId("ai-scientist-panel");
  await expect(panel).toBeVisible({ timeout: 40_000 });

  // Screenshot 1: Project / Workstation
  await page.screenshot({ path: resolve(shots, "01-project-workstation.png"), fullPage: true });

  // Step 4: Submit research objective to real NVIDIA AI
  const promptInput = page.getByTestId("ai-prompt-input");
  await expect(promptInput).toBeEnabled({ timeout: 40_000 });
  await promptInput.fill("Propose exactly one ENERGY calculation for the imported H2 structure version. Use charge 0, multiplicity 1, Hartree-Fock (HF), STO-3G, and PySCF. Request my approval before submission. Do not optimize geometry or submit additional calculations.");

  // Plan calculation mode + the calculation proposal action
  const plannedResponse = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/messages"));
  await choosePlanMode(page, { general: false });
  await page.getByTestId("ai-prepare-calculation-button").click();
  const planned = await (await plannedResponse).json();
  const planningRunId = planned.latest_run.id;

  // Step 5: Verify AI Scientist proposal and approval card appears
  const proposal = page.getByTestId("ai-calculation-proposal");
  await expect(proposal).toBeVisible({ timeout: 100_000 });
  await expect(proposal).toContainText(structure.version.id, { timeout: 30_000 });
  await expect(proposal).toContainText("AVAILABLE");
  await expect(proposal).toContainText("pyscf");

  const approvalCard = page.getByTestId("ai-approval-card");
  await expect(approvalCard).toBeVisible();
  await expect(approvalCard).toContainText("Approval Required");
  await expect(approvalCard.getByTestId("ai-approval-geometry")).toContainText("Units: Angstrom");
  const coordinates = approvalCard.getByTestId("ai-approval-geometry").locator("tbody tr");
  await expect(coordinates).toHaveCount(2);
  await expect(coordinates.nth(0)).toContainText("-0.37");
  await expect(coordinates.nth(1)).toContainText("0.37");
  await expect(page.getByTestId("ai-approve-button")).toBeEnabled();
  const awaiting = await (await request.get(`${base}/ai/runs/${planningRunId}`)).json();
  expect(awaiting.status).toBe("WAITING_FOR_APPROVAL");
  const bound = awaiting.pending_approval.normalized_arguments;
  expect(bound.structure_version.entity_id).toBe(structure.version.id);
  expect(bound.specification.charge).toBe(0);
  expect(bound.specification.multiplicity).toBe(1);
  expect(bound.specification.task_type).toBe("ENERGY");
  expect(bound.specification.method.identifier.toLowerCase()).toBe("hf");
  expect(bound.specification.basis.identifier.toLowerCase()).toBe("sto-3g");
  expect(bound.specification.engine_preference.engine).toBe("pyscf");

  // Screenshot 2: AI Proposal & Researcher Approval Card
  await panel.screenshot({ path: resolve(shots, "02-ai-proposal-and-approval.png") });

  // Step 6: Verify invariant — NO calculation has run before researcher approval
  const preApprovalJobs = (await (await request.get(`${base}/compute/jobs`)).json()).jobs;
  expect(preApprovalJobs).toHaveLength(0);

  // No automated approval endpoint or button action exists in this live flow.
  // The researcher must personally review and decide in the headed application.
  writeFileSync(resolve(process.env.CHEMDFT_TEST_WORKSPACE!, "manual-approval-ready.json"), JSON.stringify({
    project_id: projectId, run_id: planningRunId, approval_id: awaiting.pending_approval.id,
    structure_version_id: structure.version.id, action_fingerprint: awaiting.pending_approval.action_fingerprint,
  }), { mode: 0o600 });
  console.log(`WAITING_FOR_PERSONAL_APPROVAL: review the visible application within ${approvalSeconds} seconds. The compute worker is stopped.`);
  await expect.poll(async () => {
    const current = await (await request.get(`${base}/ai/runs/${planningRunId}`)).json();
    return ["WAITING_FOR_CALCULATION", "SUCCEEDED"].includes(current.status);
  }, { timeout: approvalSeconds * 1000, intervals: [500] }).toBe(true);
  const submittedRun = await (await request.get(`${base}/ai/runs/${planningRunId}`)).json();
  const approvedJobs = (await (await request.get(`${base}/compute/jobs`)).json()).jobs;
  expect(approvedJobs).toHaveLength(1);
  const calculationId = approvedJobs[0].calculation_id;
  expect(calculationId).toBeTruthy();

  // Screenshot 3: Running calculation
  await panel.screenshot({ path: resolve(shots, "03-running-calculation.png") });

  // Step 8 & 9: Real PySCF worker executes H2 and Result Firewall validates output
  const resultPanel = page.getByTestId("ai-calculation-result");
  const readout = resultPanel.getByTestId("energy-readout-value");
  await expect(readout).toHaveText("-1.1167593074", { timeout: 90_000 });
  await expect(page.getByTestId("ai-scientific-workflow")).toContainText("Completed · SUCCEEDED", { timeout: 30_000 });

  // Check calculation record details from backend
  const calcDetail = await (await request.get(`${base}/calculations/${calculationId}`)).json();
  expect(calcDetail.calculation.state).toBe("SUCCEEDED");
  expect(calcDetail.compute_job.state).toBe("SUCCEEDED");
  expect(calcDetail.compute_execution.state).toBe("FINISHED");
  expect(calcDetail.result.payload.total_energy.unit.code).toBe("Eh");
  expect(calcDetail.result.payload.total_energy.value).toBeCloseTo(-1.1167593073964255, 10);
  expect(calcDetail.result.payload.converged).toBe(true);
  expect(calcDetail.result.producer_software.name).toBe("pyscf");
  expect(calcDetail.result.producer_software.version).toBe("2.14.0");
  expect(calcDetail.result.source_class).toBe("CALCULATED");
  expect(calcDetail.result.authority).toBe("AUTHORITATIVE");
  expect(calcDetail.result.validation_state).toBe("VALIDATED");
  expect(calcDetail.result.trusted_producer_id).toBe("local.pyscf.worker");
  expect(calcDetail.result.producer_attestation_id).toMatch(/^execution:/);

  // Screenshot 4: Completed scientific result
  await panel.screenshot({ path: resolve(shots, "04-completed-scientific-result.png") });

  // Step 9b: Prove real NVIDIA execution — fetch the run record and assert actual
  // provider and model. Budget spend is separate from observed provider usage.
  const runId = submittedRun.id;
  const runDetail = await (await request.get(`${base}/ai/runs/${runId}`)).json();
  expect(runDetail.ai_provider).toBe("nvidia");
  expect(runDetail.ai_model).toBe(model);
  expect(runDetail.budget).toBeTruthy();
  const budgetInput = runDetail.budget.input_tokens_used;
  const budgetOutput = runDetail.budget.output_tokens_used;
  expect(Number.isInteger(budgetInput)).toBe(true);
  expect(Number.isInteger(budgetOutput)).toBe(true);

  // Step 10 & 11: Provenance accessibility
  const provButton = resultPanel.getByText("Calculation parameters & provenance", { exact: true });
  await provButton.click();
  await expect(resultPanel).toContainText(structure.version.id);
  await expect(resultPanel).toContainText("pyscf");

  // Screenshot 5: Provenance details
  await panel.screenshot({ path: resolve(shots, "05-provenance-details.png") });

  // Step 12: Reload stability and persistence
  await page.reload();
  if (await showButton.isVisible()) {
    await showButton.click();
  }
  await expect(panel).toBeVisible({ timeout: 40_000 });
  const reloadedReadout = page.getByTestId("ai-calculation-result").getByTestId("energy-readout-value");
  await expect(reloadedReadout).toHaveText("-1.1167593074", { timeout: 30_000 });

  // Screenshot 6: Restored after refresh
  await page.screenshot({ path: resolve(shots, "06-restored-after-refresh.png"), fullPage: true });

  // Record acceptance artifact summary — all values are derived from real assertions
  // above, not hardcoded flags.
  const acceptanceRecord = {
    test: "AS-C1.2 MANUAL LIVE ACCEPTANCE",
    status: "PASS",
    ai_provider: runDetail.ai_provider,
    ai_model: runDetail.ai_model,
    budget_input_tokens_used: budgetInput,
    budget_output_tokens_used: budgetOutput,
    scientific_engine: "PySCF (real worker)",
    objective: "Investigate the ground-state energy of molecular hydrogen using Hartree-Fock and STO-3G.",
    molecule: "H2 (0.74 Å)",
    computed_energy_hartree: calcDetail.result.payload.total_energy.value,
    reference_energy_hartree: -1.1167593073964255,
    energy_unit: "Eh",
    converged: calcDetail.result.payload.converged,
    calculation_id: calculationId,
    project_id: projectId,
    approval_fenced: preApprovalJobs.length === 0,
    firewall_validated:
      calcDetail.calculation.state === "SUCCEEDED" &&
      calcDetail.compute_job.state === "SUCCEEDED" &&
      calcDetail.compute_execution.state === "FINISHED" &&
      calcDetail.result.authority === "AUTHORITATIVE" &&
      calcDetail.result.validation_state === "VALIDATED",
    refresh_persisted: true,
  };
  writeFileSync(resolve(shots, "acceptance.json"), JSON.stringify(acceptanceRecord, null, 2));
});
