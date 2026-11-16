import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve(process.env.CHEMDFT_PF8D_OUTPUT ?? "../../output/playwright/pf8d-c1");
mkdirSync(output, { recursive: true });

test("Advanced setup fits its document pane across resizing and engines", async ({ page, request }) => {
  const project = await request.post("/api/chemdft/v1/projects", { data: {
    name: "C.1 responsive calculation panel", slug: `c1-layout-${crypto.randomUUID()}`,
  } });
  expect(project.status()).toBe(201);
  const id = (await project.json()).id;
  const imported = await request.post(`/api/chemdft/v1/projects/${id}/structures/imports`, { multipart: {
    upload: { name: "water.xyz", mimeType: "chemical/x-xyz", buffer: Buffer.from("3\nwater\nO 0 0 0\nH 0 0.758 0.588\nH 0 -0.758 0.588\n") },
    file_format: "XYZ", idempotency_key: crypto.randomUUID(),
  } });
  expect(imported.status()).toBe(201);
  await page.goto(`/en/projects/${id}/workspace`);
  await page.getByTestId("mode-toggle-advanced").click();
  const calculate = page.getByRole("button", { name: "Calculate", exact: true });
  if (await calculate.isVisible()) await calculate.click();
  const panel = page.locator(".calculation-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Engine").locator('option[value="psi4"]')).toBeEnabled({ timeout: 30_000 });
  const measurements = [];
  for (const engine of ["psi4", "pyscf", "xtb"]) {
    await panel.getByLabel("Engine").selectOption(engine);
    for (const width of [1440, 1280, 1024, 768, 375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await panel.scrollIntoViewIfNeeded();
      const measurement = await panel.evaluate((element) => {
        const pane = element.closest(".workbench-panel")!;
        const bounds = pane.getBoundingClientRect();
        const nodes = [element, ...element.querySelectorAll("input,select,.pane-heading")];
        return { paneLeft: bounds.left, paneRight: bounds.right,
          paneOverflow: pane.scrollWidth - pane.clientWidth,
          documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
          controls: nodes.map((node) => { const rect = node.getBoundingClientRect(); return {
            left: rect.left, right: rect.right, overflow: node.scrollWidth - node.clientWidth,
          }; }) };
      });
      measurements.push({ engine, width, ...measurement });
      expect(measurement.paneOverflow, JSON.stringify(measurement)).toBeLessThanOrEqual(1);
      expect(measurement.documentOverflow).toBeLessThanOrEqual(1);
      for (const control of measurement.controls) {
        expect(control.left).toBeGreaterThanOrEqual(measurement.paneLeft - 1);
        expect(control.right).toBeLessThanOrEqual(measurement.paneRight + 1);
      }
      if (engine === "psi4") {
        await expect(panel.getByLabel("Engine").locator('option[value="psi4"]')).toBeEnabled({ timeout: 30_000 });
        await expect(panel.getByRole("button", { name: "Run Psi4 energy", exact: true })).toBeEnabled({ timeout: 30_000 });
        await page.screenshot({ path: resolve(output, `advanced-setup-${width}.png`) });
      }
    }
  }
  const provenance = page.locator(".structure-inspector").filter({ has: page.getByRole("heading", { name: "Provenance", exact: true }) });
  await provenance.scrollIntoViewIfNeeded();
  await expect(provenance).toContainText("USER_SUPPLIED");
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await provenance.scrollIntoViewIfNeeded();
    expect(await provenance.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: resolve(output, `advanced-structure-provenance-${width}.png`) });
  }
  await test.info().attach("pane-boundaries", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
});
