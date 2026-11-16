import { expect, test } from "@playwright/test";

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

test("localhost creates a real project, imports a real SDF, and opens current workspace tools", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The full local editing and visualization flow is desktop-only.");
  test.setTimeout(90_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const suffix = Date.now().toString(36);
  const name = "Local Test";
  const slug = `local-test-${suffix}`;

  await page.goto("/en");
  await expect(page.getByRole("heading", { name: /Computational chemistry/ })).toBeVisible();
  await page.getByRole("link", { name: "Open ChemDFT" }).first().click();
  await expect(page.getByText("Local development identity")).toBeVisible();
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("Project slug").fill(slug);
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("heading", { name: "Import a structure to begin" })).toBeVisible({ timeout: 15_000 });
  await page.goto("/en/projects");
  await expect(page.getByRole("link", { name: new RegExp(`${name}.*${slug}`) })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: new RegExp(`${name}.*${slug}`) })).toBeVisible();
  await page.getByRole("link", { name: new RegExp(`${name}.*${slug}`) }).click();

  await page.setInputFiles("#structure-upload", {
    name: "methane.sdf",
    mimeType: "chemical/x-mdl-sdfile",
    buffer: Buffer.from(sdfMethane),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();

  await expect(page.getByRole("heading", { name: "methane" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("cell", { name: "C" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "0.6291" }).first()).toBeVisible();
  await expect(page.getByText("Storage")).toBeVisible();
  await expect(page.getByText(/storage_key|object_key|\/tmp\/chemdft|\.chemdft\/objects/)).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "Scientific visualization" })).toBeVisible();
  await page.getByRole("button", { name: "Scientific 3D" }).click();
  await page.getByRole("button", { name: "Studio" }).click();
  await expect(page.locator('[data-renderer-mode="studio"]')).toBeVisible();

  await page.getByRole("button", { name: "New molecule" }).click();
  await expect(page.getByRole("region", { name: "New molecule options" })).toBeVisible();
  await expect(page.getByLabel("Molecule editor")).toHaveCount(0);
  await page.getByRole("button", { name: "Draw manually" }).click();
  await expect(page.getByLabel("Molecule editor")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("heading", { name: "Calculation" })).toBeVisible();
  const unavailable = page.getByText("PySCF worker unavailable in this development environment");
  const available = page.getByText(/^AVAILABLE/);
  if (await unavailable.isVisible().catch(() => false)) {
    await expect(unavailable).toBeVisible();
  } else {
    await expect(available).toBeVisible();
    await page.getByRole("button", { name: "Run energy" }).click();
    await expect(page.getByText("CALCULATED", { exact: true })).toBeVisible({ timeout: 60_000 });
  }
  expect(consoleErrors).toEqual([]);
});
