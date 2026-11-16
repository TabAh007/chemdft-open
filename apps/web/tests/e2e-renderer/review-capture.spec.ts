import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

/** Review-only: records the interaction clip into the untracked review output. Run with CHEMDFT_RENDERER_CAPTURE=1. */
test.skip(!process.env.CHEMDFT_RENDERER_CAPTURE, "review capture is opt-in");

const OUT = resolve(import.meta.dirname, "../../../../output/renderer-review");
test.use({ viewport: { width: 1280, height: 800 }, video: { mode: "on", size: { width: 1280, height: 800 } }, launchOptions: { args: ["--use-angle=metal", "--ignore-gpu-blocklist"] } });

test("records drag rotation, representation switching and the supercell transition", async ({ page }) => {
  test.setTimeout(150_000);
  mkdirSync(OUT, { recursive: true });
  await page.goto("/renderer-review?preset=editorial&rep=ball-stick&n=1&az=0.7&pol=1.05");
  await page.waitForFunction(() => Boolean((window as unknown as { __chemdftRenderer?: unknown }).__chemdftRenderer), undefined, { timeout: 60_000 });
  await page.waitForTimeout(1200);
  const box = (await page.locator("canvas").first().boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 260, cy + 40, { steps: 50 });
  await page.mouse.move(cx - 120, cy - 30, { steps: 60 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  for (const label of ["Unit cell", "Polyhedra", "Space filling", "Wireframe", "Ball & stick"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForTimeout(1500);
  }
  await page.getByRole("button", { name: "2×2×2", exact: true }).click();
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: "Polyhedra", exact: true }).click();
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "1×1×1", exact: true }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "reset view" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "publication" }).click();
  await page.waitForTimeout(1500);
  expect(await page.locator("[data-molecular-renderer]").getAttribute("data-preset")).toBe("publication");
  const video = page.video()!;
  await page.close(); // saveAs waits for the page to close
  await video.saveAs(resolve(OUT, "renderer-interaction.webm"));
});
