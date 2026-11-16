import { expect, test } from "./offline-test";
import { choosePlanMode } from "./ai-composer";

const sdfMethane = `Methane
  ChemDFT

  5  4  0  0  0  0            999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.6291    0.6291    0.6291 H   0  0  0  0  0  0  0  0  0  0  0  0
   -0.6291   -0.6291    0.6291 H   0  0  0  0  0  0  0  0  0  0  0  0
   -0.6291    0.6291   -0.6291 H   0  0  0  0  0  0  0  0  0  0  0  0
    0.6291   -0.6291   -0.6291 H   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0
  1  3  1  0
  1  4  1  0
  1  5  1  0
M  END
$$$$
`;

test("AI Scientist copilot inspects project, grounds answers, and queues only after approval", async ({ page, request }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const suffix = Date.now().toString(36);
  const name = "AI Copilot Project";
  const slug = `ai-copilot-${suffix}`;

  // 1. Create project
  // Exercise the research workflow without compiling the unrelated 3D marketing/onboarding routes.
  await page.goto("/en/projects");
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("Project slug").fill(slug);
  const creating = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/v1/projects"));
  await page.getByRole("button", { name: "Create project" }).click();
  const created = await creating;
  expect(created.status()).toBe(201);
  const createdProject = (await created.json()).id;
  // The actual router transition can wait for a cold Next dev compilation on the local machine.
  await expect(page).toHaveURL(new RegExp(`/projects/${createdProject}/workspace$`), { timeout: 90_000 });
  await expect(async () => {
    const advanced = page.getByTestId("mode-toggle-advanced");
    if ((await advanced.getAttribute("aria-pressed")) !== "true") await advanced.click();
    await expect(advanced).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 });
    await expect(page.locator("#structure-upload")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 40_000 });

  // 2. Import structure
  await page.setInputFiles("#structure-upload", {
    name: "methane.sdf",
    mimeType: "chemical/x-mdl-sdfile",
    buffer: Buffer.from(sdfMethane),
  });
  await page.getByRole("form", { name: "Import structure" }).getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("heading", { name: /methane/i }).first()).toBeVisible({ timeout: 30_000 });

  // 3. Verify AI Scientist panel in dock
  const aiTab = page.getByTestId("ai-scientist-tab");
  await expect(aiTab).toBeVisible();
  await aiTab.click();
  await expect(page.getByTestId("ai-scientist-panel")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("ai-model-provider-card")).toContainText("fake-standard");
  for (const tab of ["chat", "evidence", "runs"]) {
    await expect(page.getByTestId(`ai-nav-${tab}`)).toBeVisible();
  }
  // Tools and Settings sit behind the overflow menu.
  await expect(page.getByTestId("ai-nav-more")).toBeVisible();
  await expect(page.getByTestId("ai-nav-tools")).toHaveCount(0);
  await expect(page.getByTestId("ai-nav-settings")).toHaveCount(0);
  await expect(page.getByTestId("ai-empty-state")).toBeVisible();

  // 4. Starters now fill the composer for review; explicitly send an Ask request.
  await page.getByTestId("ai-prompt-input").fill("Summarize this project from its saved records.");
  await page.getByTestId("ai-prepare-calculation-button").click();
  await expect(page.getByTestId("ai-message-user")).toBeVisible({ timeout: 10_000 });
  const summary = page.getByTestId("ai-message-assistant").last();
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await expect(summary).toContainText("methane");
  await expect(summary).toContainText("[P");
  await expect(summary).not.toContainText("INSUFFICIENT EVIDENCE");

  // 5. Ask for calculation planning
  const promptInput = page.getByTestId("ai-prompt-input");
  await promptInput.fill("Plan and submit an HF/STO-3G single-point energy calculation for this molecule.");
  await choosePlanMode(page, { general: false });
  const proposing = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/messages"));
  await page.getByTestId("ai-prepare-calculation-button").click();
  const proposed = await proposing;
  expect(proposed.status()).toBe(201);
  expect(proposed.request().postDataJSON()).toMatchObject({ planning_profile: "PYSCF_ENERGY_PROPOSAL", mode: "STANDARD" });
  const pending = (await proposed.json()).latest_run;
  expect(pending.status).toBe("WAITING_FOR_APPROVAL");
  expect(pending.waiting_calculation_id).toBeNull();
  const project = pending.project_id;
  const jobs = async () => (await (await request.get(`/api/chemdft/v1/projects/${project}/compute/jobs`)).json()).jobs;
  expect(await jobs()).toHaveLength(0);

  // 6. Verify approval card appears
  await expect(page.getByTestId("ai-approval-card")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("ai-approval-card").getByRole("heading", { name: "Approval Required" })).toBeVisible();
  await expect(page.getByTestId("ai-approve-button")).toBeVisible();
  await expect(page.getByTestId("ai-reject-button")).toBeVisible();

  // 7. Approve the calculation
  const deciding = page.waitForResponse(response => response.url().endsWith(`/approvals/${pending.pending_approval.id}/decision`));
  await page.getByTestId("ai-approve-button").click();
  const decision = await deciding;
  expect(decision.status()).toBe(200);
  expect(decision.request().postDataJSON().decision).toBe("APPROVE");
  expect((await decision.json()).status).toBe("WAITING_FOR_CALCULATION");

  // 8. The worker is disabled: one real queued record, never a numerical result.
  await expect.poll(async () => (await jobs()).length).toBe(1);
  expect((await jobs())[0].state).toBe("READY");
  await page.getByTestId("ai-nav-runs").click();
  await expect(page.locator('[data-testid^="ai-run-item-"][data-phase="QUEUED"]')).toHaveCount(1);
  await expect(page.getByTestId("ai-runs-view")).not.toContainText(/Total energy|SCF Iteration|\d+%/);

  // 9. Verify no leaked secrets or storage paths
  await expect(page.getByText(/storage_key|object_key|OPENAI_API_KEY|\/tmp\/chemdft/)).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
