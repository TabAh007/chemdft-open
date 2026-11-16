import { expect, test } from "@playwright/test";

const h2Xyz = `2\nH2 browser investigation\nH 0 0 -0.37\nH 0 0 0.37\n`;
const apiBase = process.env.CHEMDFT_API_BASE_URL ?? `http://127.0.0.1:${process.env.CHEMDFT_E2E_API_PORT ?? 8123}`;

test("H2 investigation survives refresh and completes through both workers", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Investigation acceptance is desktop-oriented.");
  test.setTimeout(120_000);
  const suffix = Date.now().toString(36);
  await page.goto("/en");
  await page.getByRole("link", { name: "Open ChemDFT" }).first().click();
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByLabel("Project name").fill("H2 Investigation E2E");
  await page.getByLabel("Project slug").fill(`h2-investigation-${suffix}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Import a structure to begin" })).toBeVisible();

  await page.setInputFiles("#structure-upload", {
    name: "h2.xyz",
    mimeType: "chemical/x-xyz",
    buffer: Buffer.from(h2Xyz),
  });
  await page.getByRole("combobox", { name: "Structure format" }).selectOption("XYZ");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("heading", { name: "h2" })).toBeVisible({ timeout: 20_000 });

  const projectId = page.url().match(/projects\/([^/]+)/)?.[1];
  expect(projectId).toBeTruthy();
  const structures = await request.get(`${apiBase}/v1/projects/${projectId}/structures`);
  const structure = (await structures.json())[0] as { latest_version_id: string };
  const headers = { "content-type": "application/json" };
  const investigationResponse = await request.post(
    `${apiBase}/v1/projects/${projectId}/investigations`,
    { headers, data: { title: "H2 comparison", objective: "Compare HF and B3LYP energies for H2" } },
  );
  const investigation = await investigationResponse.json() as { id: string };
  await request.post(
    `${apiBase}/v1/projects/${projectId}/investigations/${investigation.id}/hypotheses`,
    { headers, data: { statement: "The bounded methods can be compared", source_class: "AI_HYPOTHESIS" } },
  );
  await request.post(
    `${apiBase}/v1/projects/${projectId}/investigations/${investigation.id}/plans`,
    {
      headers,
      data: {
        steps: [{
          action: "calculation.submit",
          intent: "Run HF/STO-3G",
          approval_class: "EXPENSIVE",
          tool_arguments: {
            structure_version: { project_id: projectId, entity_type: "structure.version", entity_id: structure.latest_version_id },
            specification: {
              task_type: "ENERGY",
              method: { identifier: "hf", display_name: "Hartree-Fock", registry: "chemdft.method" },
              basis: { identifier: "sto-3g", display_name: "STO-3G", registry: "chemdft.basis" },
              charge: 0,
              multiplicity: 1,
              engine_preference: { engine: "pyscf" },
            },
            provider_preference: "LOCAL",
          },
        }],
      },
    },
  );

  await page.reload();
  await expect(page.getByText(/PLANNED · 1 hypotheses/)).toBeVisible();
  await page.getByTestId("ai-investigation-strip").getByRole("button", { name: "Run" }).click();
  const investigationStrip = page.getByTestId("ai-investigation-strip");
  await expect(investigationStrip.getByText(/WAITING_FOR_APPROVAL/)).toBeVisible({ timeout: 15_000 });
  await investigationStrip.getByRole("button", { name: "Approve" }).click();
  await expect(investigationStrip.getByText(/WAITING_FOR_RESULT|WAITING_FOR_APPROVAL/)).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId("ai-investigation-strip").getByText(/WAITING_FOR_APPROVAL|COMPLETED/)).toBeVisible({ timeout: 90_000 });
  const secondApproval = page.getByTestId("ai-investigation-strip").getByRole("button", { name: "Approve" });
  if (await secondApproval.isVisible()) {
    await secondApproval.click();
  }
  await expect(page.getByText("COMPLETED · 1 hypotheses · Steps 2/10 · Calculations 2/3 · AI calls 2/10")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Assessment", { exact: true })).toBeVisible();
  await expect(page.getByText("SUPPORTED ·")).toBeVisible();
  await expect(page.getByText(/storage_key|object_key|OPENAI_API_KEY|\/tmp\/chemdft/)).toHaveCount(0);
});
