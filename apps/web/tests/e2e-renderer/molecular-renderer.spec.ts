import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * The renderer is verified through what it actually draws: `inspectAtoms()` reads the instance matrices of the
 * atom mesh. Expected positions are computed here independently from the validated reference JSON and the lattice
 * formula, so a rendering bug cannot hide behind the renderer's own derivation.
 */
const reference = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../src/app/_components/home/reference/cr2o3-reference.json"), "utf8")) as {
  lattice: { a: number; b: number; c: number; gamma: number };
  sites: { element: string; fractional: [number, number, number] }[];
};

const DEG = Math.PI / 180;
const { a, c, gamma } = reference.lattice;
const va = [a, 0, 0] as const;
const vb = [a * Math.cos(gamma * DEG), a * Math.sin(gamma * DEG), 0] as const;
const vc = [0, 0, c] as const;
const toCart = (f: readonly number[]) => [0, 1, 2].map((i) => f[0]! * va[i]! + f[1]! * vb[i]! + f[2]! * vc[i]!);
const toFrac = (p: readonly number[]) => {
  const z = p[2]! / c;
  const y = (p[1]! - 0) / vb[1];
  const x = (p[0]! - y * vb[0]) / a;
  return [x, y - 0, z];
};
const wrap = (v: number) => ((v % 1) + 1) % 1;
const isSite = (f: readonly number[]) =>
  reference.sites.some((site) => site.fractional.every((v, i) => Math.min(Math.abs(wrap(f[i]! - v)), Math.abs(wrap(v - f[i]!))) < 5e-4)); // instance matrices are float32

type Drawn = { position: [number, number, number]; radius: number };
const drawn = (page: Page) => page.evaluate(() => (window as unknown as { __chemdftRenderer: { inspectAtoms(): Drawn[] } }).__chemdftRenderer.inspectAtoms());
const visible = async (page: Page) => (await drawn(page)).filter((atom) => atom.radius > 1e-3);
const view = (page: Page) => page.evaluate(() => (window as unknown as { __chemdftRenderer: { getView(): { azimuth: number; polar: number; zoom: number; projection: string } } }).__chemdftRenderer.getView());
const frame = (page: Page) => page.evaluate(() => (window as unknown as { __chemdftRenderer: { stats(): { frame: number } } }).__chemdftRenderer.stats().frame);

async function open(page: Page, query = "") {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/renderer-review?${query}`);
  await page.waitForFunction(() => Boolean((window as unknown as { __chemdftRenderer?: unknown }).__chemdftRenderer), undefined, { timeout: 60_000 });
  await page.waitForTimeout(800);
  return errors;
}

const button = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true });

test.describe("molecular renderer", () => {
  test("renders the validated α-Cr₂O₃ sites exactly, with no console errors", async ({ page }) => {
    const errors = await open(page);
    const atoms = await visible(page);
    expect(atoms.length).toBeGreaterThanOrEqual(30);
    // every drawn atom is a validated site translated by whole lattice vectors (cell atoms and face images)
    for (const atom of atoms) {
      expect(isSite(toFrac(atom.position)), `unexpected atom at ${atom.position}`).toBe(true);
    }
    // every one of the 30 sites is drawn exactly where the lattice puts it
    const drawnKeys = new Set(atoms.map((atom) => atom.position.map((v) => Math.round(v * 100)).join(",")));
    for (const site of reference.sites) expect(drawnKeys.has(toCart(site.fractional).map((v) => Math.round(v * 100)).join(","))).toBe(true);
    expect(errors.filter((message) => !/Clock/.test(message))).toEqual([]);
  });

  test("representation switches change radii, never positions", async ({ page }) => {
    await open(page);
    const base = await visible(page);
    const baseKeys = new Set(base.map((atom) => atom.position.map((v) => Math.round(v * 1000)).join(",")));
    const radii = async () => [...new Set((await visible(page)).map((atom) => +atom.radius.toFixed(3)))].sort((x, y) => x - y);

    const editorial = await radii(); // ball-and-stick: display scale, with the Editorial finish (×0.84) on top
    expect(editorial).toHaveLength(2);
    [0.358, 0.56].forEach((r, i) => expect(Math.abs(editorial[i]! - r * 0.84)).toBeLessThan(0.003));
    await button(page, "Space filling").click();
    await page.waitForTimeout(1500);
    expect(await radii()).toEqual([0.615, 1.38]); // Shannon ionic radii, Cr3+ (CN 6) and O2- (CN 4)
    await button(page, "Wireframe").click();
    await page.waitForTimeout(1500);
    expect((await radii()).every((r) => r < 0.2)).toBe(true);
    await button(page, "Polyhedra").click();
    await page.waitForTimeout(1500);
    expect((await visible(page)).length).toBeGreaterThan(base.length); // ligands completing each CrO₆ appear
    await button(page, "Ball & stick").click();
    await page.waitForTimeout(1500);
    const again = await visible(page);
    expect(again).toHaveLength(base.length);
    for (const atom of again) expect(baseKeys.has(atom.position.map((v) => Math.round(v * 1000)).join(","))).toBe(true);
  });

  test("the preset finish scales only display-scale radii: Scientific keeps them, space filling is physical in every preset", async ({ page }) => {
    await open(page, "preset=scientific");
    const radii = async () => [...new Set((await visible(page)).map((atom) => +atom.radius.toFixed(3)))].sort((x, y) => x - y);
    expect(await radii()).toEqual([0.358, 0.56]);
    await button(page, "Space filling").click();
    await page.waitForTimeout(1500);
    expect(await radii()).toEqual([0.615, 1.38]);
    await page.goto("/renderer-review?preset=editorial&rep=space-fill");
    await page.waitForFunction(() => Boolean((window as unknown as { __chemdftRenderer?: unknown }).__chemdftRenderer), undefined, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    expect(await radii()).toEqual([0.615, 1.38]); // Editorial must not shrink physical radii
  });

  test("2×2×2 replicates the cell exactly and returns to 1×1×1 unchanged", async ({ page }) => {
    await open(page);
    const one = await visible(page);
    await button(page, "2×2×2").click();
    await page.waitForTimeout(2500);
    const two = await visible(page);
    expect(two.length).toBeGreaterThan(one.length * 4);
    const keys = two.map((atom) => atom.position.map((v) => Math.round(v * 1000)).join(","));
    expect(new Set(keys).size).toBe(keys.length); // no duplicated boundary atoms
    const set = new Set(keys);
    for (const atom of one) expect(set.has(atom.position.map((v) => Math.round(v * 1000)).join(","))).toBe(true);
    for (const atom of two) {
      expect(isSite(toFrac(atom.position))).toBe(true);
    }
    await button(page, "1×1×1").click();
    await page.waitForTimeout(2500);
    const back = await visible(page);
    expect(back).toHaveLength(one.length);
  });

  test("drag rotates smoothly, reset restores the authored view, and an idle scene renders no frames", async ({ page }) => {
    await open(page, "az=0.7&pol=1.1");
    const start = await view(page);
    const canvas = page.locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 30, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const rotated = await view(page);
    expect(Math.abs(rotated.azimuth - start.azimuth)).toBeGreaterThan(0.3);
    await page.evaluate(() => (window as unknown as { __chemdftRenderer: { resetView(a: boolean): void } }).__chemdftRenderer.resetView(true));
    await page.waitForTimeout(2000);
    const reset = await view(page);
    expect(reset.azimuth).toBeCloseTo(0.7, 2);
    expect(reset.polar).toBeCloseTo(1.1, 2);
    const before = await frame(page);
    await page.waitForTimeout(1200);
    expect(await frame(page)).toBe(before); // demand rendering: nothing moves, nothing renders
  });

  test("keyboard rotates and resets without any pointer", async ({ page }) => {
    await open(page, "az=0.7&pol=1.1");
    await page.locator("[data-molecular-renderer]").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(600);
    expect((await view(page)).azimuth).not.toBeCloseTo(0.7, 1);
    await page.keyboard.press("0");
    await page.waitForTimeout(1800);
    expect((await view(page)).azimuth).toBeCloseTo(0.7, 2);
  });

  test("presets change the finish only: Publication is orthographic on white with the same atoms", async ({ page }) => {
    await open(page);
    const editorial = await visible(page);
    await button(page, "publication").click();
    await page.waitForTimeout(1500);
    await expect(page.locator("[data-molecular-renderer]")).toHaveAttribute("data-preset", "publication");
    expect((await view(page)).projection).toBe("orthographic");
    const bg = await page.locator("[data-molecular-renderer]").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgb(255, 255, 255)");
    const publication = await visible(page);
    expect(publication).toHaveLength(editorial.length);
    publication.forEach((atom, i) => expect(atom.position).toEqual(editorial[i]!.position));
  });

  test("switches to a stored water StructureVersion without rebuilding the renderer", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Water (fixture)" }).click();
    await page.waitForTimeout(2000);
    const atoms = await visible(page);
    expect(atoms).toHaveLength(3);
    const oxygen = atoms.find((atom) => atom.radius > 0.3)!;
    const hydrogens = atoms.filter((atom) => atom !== oxygen);
    expect(oxygen.position.every((v) => Math.abs(v) < 1e-5)).toBe(true); // the fixture's O sits at the source origin: drawn coordinates are the stored ones
    const dist = (p: number[], q: number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
    expect(dist(oxygen.position, hydrogens[0]!.position)).toBeCloseTo(0.9572, 3); // the fixture's O–H distance, Å
    expect(dist(oxygen.position, hydrogens[1]!.position)).toBeCloseTo(0.9572, 3);
    await expect(page.getByText(/Display bonds inferred|Radius model/)).toBeVisible();
  });

  test("clicking an atom selects it (and only an atom); clicking empty space clears the selection", async ({ page }) => {
    await open(page, "structure=water&ui=1&preset=scientific");
    const box = (await page.locator("canvas").first().boundingBox())!;
    const status = page.locator("p", { hasText: "Radius model" });
    let selected: string | null = null;
    // sweep the stage with real pointer clicks; the first hit must be an atom of the stored water molecule
    for (let gy = 0.3; gy <= 0.7 && !selected; gy += 0.04)
      for (let gx = 0.3; gx <= 0.7 && !selected; gx += 0.04) {
        await page.mouse.click(box.x + box.width * gx, box.y + box.height * gy);
        const text = (await status.textContent()) ?? "";
        const match = /selected (O|H) #(\d)/.exec(text);
        if (match) selected = `${match[1]}#${match[2]}`;
      }
    expect(selected).toMatch(/^(O#0|H#[12])$/);
    await page.mouse.click(box.x + 8, box.y + 8);
    await expect(status).not.toContainText("selected");
  });

  test("polyhedra are the structure's real CrO₆ units", async ({ page }) => {
    await open(page, "rep=polyhedra");
    await expect(page.getByText(/polyhedra: 12/)).toBeVisible();
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("fits the structure in a 390px stage, keeps the page scrollable and does not overflow", async ({ page }) => {
    await open(page, "ui=0&h=560");
    const canvas = page.locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await canvas.evaluate((el) => getComputedStyle(el).touchAction)).toBe("pan-y");
    expect((await visible(page)).length).toBeGreaterThanOrEqual(30);
  });
});
