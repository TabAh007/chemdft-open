import { expect, test } from "./offline-test";
import { resolve } from "node:path";
import { choosePlanMode } from "./ai-composer";

test("offline geometry: exact server input, no consent or compute, stale coordinates block approval", async ({ page, request }) => {
  test.setTimeout(120_000);
  expect(process.env.CHEMDFT_AI_PROVIDER).toBe("fake");
  expect(process.env.CHEMDFT_E2E_WORKER_MODE).toBe("disabled");
  const root = "/api/chemdft/v1/projects";
  const created = await request.post(root, { data: { name: "Offline approval geometry", slug: `geometry-${crypto.randomUUID()}` } });
  expect(created.status()).toBe(201);
  const project = (await created.json()).id;
  const imported = await request.post(`${root}/${project}/structures/imports`, { multipart: {
    file_format: "XYZ", idempotency_key: crypto.randomUUID(),
    upload: { name: "h2.xyz", mimeType: "chemical/x-xyz", buffer: Buffer.from("2\nSupplied H2 reference | chemdft:charge=0;multiplicity=1\nH 0 0 -0.37\nH 0 0 0.37\n") },
  } });
  expect(imported.status()).toBe(201);
  const input = await imported.json();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`/en/projects/${project}/workspace`);
  const show = page.getByRole("button", { name: "Show AI Scientist panel", exact: true });
  if (await show.isVisible()) await show.click();
  await expect(page.getByTestId("ai-prompt-input")).toBeEnabled({ timeout: 40_000 });
  await page.getByTestId("ai-prompt-input").fill("Calculate the HF/STO-3G single-point energy for H2 with charge 0 and multiplicity 1.");
  await choosePlanMode(page, { general: false });
  await page.getByTestId("ai-prepare-calculation-button").click();
  const card = page.getByTestId("ai-approval-card");
  const table = card.getByTestId("ai-approval-geometry");
  await expect(table).toContainText("Units: Angstrom", { timeout: 40_000 });
  await expect(table).toContainText(input.version.id);
  await expect(table.locator("tbody tr")).toHaveCount(2);
  const cells = table.locator("tbody tr").first().locator("td");
  expect(await cells.allTextContents()).toEqual(["H", "1", "0.00", "0.00", "-0.37"]);
  expect(await table.locator("tbody tr").nth(1).locator("td").allTextContents()).toEqual(["H", "1", "0.00", "0.00", "0.37"]);
  await expect(card.getByTestId("ai-approve-button")).toBeEnabled();
  expect(await table.locator(".ai-approval-coordinate-scroll").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await table.screenshot({ path: resolve(process.env.CHEMDFT_TEST_WORKSPACE!, "approval-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(show).toBeVisible();
  await show.click();
  await expect(table).toBeVisible();
  await table.screenshot({ path: resolve(process.env.CHEMDFT_TEST_WORKSPACE!, "approval-mobile.png") });
  expect((await (await request.get(`${root}/${project}/compute/jobs`)).json()).jobs).toHaveLength(0);

  // Simulate an incorrect server/cache response. No accepted structure is mutated.
  await page.route(/\/structures\/[^/]+\/versions$/, async route => {
    const response = await route.fetch();
    const versions = await response.json();
    for (const item of versions) item.version.coordinates.structure_version_id = crypto.randomUUID();
    await route.fulfill({ response, json: versions });
  });
  await page.reload();
  if (await show.isVisible()) await show.click();
  await expect(card).toContainText("Exact geometry unavailable", { timeout: 40_000 });
  await expect(card.getByTestId("ai-approve-button")).toBeDisabled();
  await expect(card.getByTestId("ai-reject-button")).toBeEnabled();
  await expect(table).toHaveCount(0);
  expect((await (await request.get(`${root}/${project}/compute/jobs`)).json()).jobs).toHaveLength(0);
});
