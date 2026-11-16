import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("real optimization trajectory survives reopening and publishes an optimized version", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  test.skip(testInfo.project.name !== "desktop", "Optimization workstation is captured at desktop size.");
  const screenshots = path.resolve(process.cwd(), "../../output/optimization-qa");
  fs.mkdirSync(screenshots, { recursive: true });
  const capture = (name: string) => page.screenshot({ path: path.join(screenshots, name), fullPage: true,
    style: ".skip-link { display: none !important; }" });

  await page.goto("/en");
  await page.getByRole("link", { name: "Open ChemDFT" }).first().click();
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByLabel("Project name").fill("Optimization QA");
  await page.getByLabel("Project slug").fill(`optimization-qa-${Date.now().toString(36)}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.locator(".skip-link").evaluate((element) => { (element as HTMLElement).style.opacity = "0"; });
  await page.setInputFiles("#structure-upload", {
    name: "water.sdf", mimeType: "chemical/x-mdl-sdfile",
    buffer: Buffer.from(`Water
  ChemDFT  3D

  3  2  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
    1.4000    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0
    0.0000    1.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
  1  3  1  0  0  0  0
M  END
$$$$
`),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".calculation-panel")).toBeVisible();
  await page.locator(".calculation-panel label").filter({ hasText: "Task" }).locator("select").selectOption("GEOMETRY_OPTIMIZATION");
  await page.locator(".calculation-panel label").filter({ hasText: "Method" }).locator("select").selectOption("B3LYP");
  await page.locator(".calculation-panel label").filter({ hasText: "Basis" }).locator("select").selectOption("def2-svp");
  await expect(page.getByRole("button", { name: "Optimize geometry" })).toBeEnabled();
  await capture("01-optimization-configuration.png");

  await page.getByRole("button", { name: "Optimize geometry" }).click();
  await expect(page.getByRole("button", { name: "Open trajectory" })).toBeVisible();
  await page.getByRole("button", { name: "Open trajectory" }).click();
  const player = page.getByRole("region", { name: "Optimization trajectory" });
  await expect(player).toBeVisible();
  await expect(player.getByText(/Viewing step \d+ \/ \d+/)).toBeVisible({ timeout: 45_000 });
  await expect(player.locator(".optimization-head strong")).toHaveText("Run: RUNNING");
  await capture("02-running-real-step.png");

  await expect(player.locator(".optimization-head strong")).toHaveText("Run: CONVERGED", { timeout: 120_000 });
  await expect(player.getByRole("img", { name: "Electronic energy by optimization step" })).toBeVisible();
  await expect(player.getByRole("img", { name: "Gradient norm by optimization step" })).toBeVisible();
  const scrubber = player.getByRole("slider", { name: "Optimization step" });
  const max = Number(await scrubber.getAttribute("max"));
  expect(max).toBeGreaterThan(0);
  await player.getByRole("button", { name: "First step" }).click();
  await expect(player.getByText(`Viewing step 1 / ${max + 1}`)).toBeVisible();
  await player.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => Number((await player.locator(".optimization-controls > span").textContent())?.split("/")[0])).toBeGreaterThan(1);
  await player.getByRole("button", { name: "Pause" }).click();
  await scrubber.fill("0");
  await expect(player.getByText(`Viewing step 1 / ${max + 1}`)).toBeVisible();
  await player.getByRole("button", { name: "Next step" }).click();
  await expect(player.getByText(`Viewing step 2 / ${max + 1}`)).toBeVisible();
  await capture("03-trajectory-player-energy-plot.png");

  await page.reload();
  await page.locator(".skip-link").evaluate((element) => { (element as HTMLElement).style.opacity = "0"; });
  await expect(player).toBeVisible();
  await expect(player.locator(".optimization-head strong")).toHaveText("Run: CONVERGED");
  await player.getByRole("button", { name: "Final available step" }).click();
  await expect(player.getByText(`Viewing step ${max + 1} / ${max + 1}`)).toBeVisible();
  await expect(player.getByText("CONVERGED ENDPOINT")).toBeVisible();
  await capture("04-final-converged-geometry.png");
  await expect(page.getByTestId("tree-item-optimizationTrajectory")).toBeVisible();
  await expect(page.getByTestId("tree-item-optimizedStructureVersion")).toBeVisible();
  await expect(page.getByRole("button", { name: /Geometry optimization result/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "water · V1" })).toBeVisible();
  await page.getByRole("complementary", { name: "Project explorer" }).screenshot({
    path: path.join(screenshots, "05-input-and-optimized-tree.png"),
  });

  await player.getByRole("button", { name: "Open optimized structure" }).click();
  await expect(page.getByTestId("selected-workspace-canvas")).toContainText("OPTIMIZED");
  await expect(page.getByTestId("selected-workspace-canvas")).toContainText("chemdft.structure.optimized");
  await expect(page.getByTestId("selected-workspace-canvas")).toContainText("Authority: CALCULATED");
  await expect(page.getByTestId("selected-workspace-canvas")).toContainText("Verification: NOT REVIEWED");
  await expect(page.getByTestId("selected-workspace-canvas")).toContainText("No parser diagnostics were reported for this version.");
  await expect(page.getByLabel("3Dmol.js scientific structure viewport")).toBeVisible();
  await capture("06-provenance-and-optimized-version.png");

  await page.getByRole("button", { name: "Hide Explorer" }).click();
  await page.getByRole("button", { name: "Hide AI panel" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Show Explorer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show AI panel" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "water" })).toBeVisible();
});
