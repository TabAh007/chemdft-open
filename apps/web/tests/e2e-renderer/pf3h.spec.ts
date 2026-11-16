import { expect, test, type Page } from "@playwright/test";

const sourceIds: Record<string, string> = { h2o: "chemdft-test-water", c6h6: "pubchem-cid-241-benzene", c8h10n4o2: "pubchem-cid-2519-caffeine", cr2o3: "cod-9014036-cr2o3" };
async function open(page: Page) {
  await page.goto("/en");
  await expect(page.locator("#structure-stage")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await expect(page.locator("#structure-stage")).toHaveAttribute("data-phase", "settled");
  await page.waitForFunction(() => Boolean((window as unknown as { __chemdftRenderer?: { framing(): unknown } }).__chemdftRenderer?.framing()));
  await page.waitForTimeout(600);
}
async function sample(page: Page, action: { structure?: string; representation?: string }) {
  return page.evaluate(async ({ action, sourceIds }) => {
    const w = window as unknown as { __chemdftRenderer: { framing(): { bounds: number[]; region: number[]; structure: string }; inspectAtoms(): { radius: number }[] } };
    const stage = document.querySelector<HTMLElement>("#structure-stage")!;
    const frames: { phase: string; id: string; caption: string; source: string; expected: string; clipped: boolean; empty: boolean }[] = [];
    const control = action.structure ? document.querySelector<HTMLElement>(`[data-testid="structure-${action.structure}"]`) : [...document.querySelectorAll<HTMLElement>('[aria-label="Representation"] button')].find(e => e.textContent === action.representation);
    control!.click();
    const acknowledged = action.structure ? control!.getAttribute("aria-checked") : null;
    const start = performance.now();
    await new Promise<void>(resolve => {
      const tick = () => {
        const opacity = +getComputedStyle(stage.querySelector(".stage-visual")!).opacity;
        const f = w.__chemdftRenderer.framing();
        if (opacity > 0.02 && f) frames.push({ phase: stage.dataset.phase!, id: stage.dataset.structure!, caption: document.querySelector<HTMLElement>('[data-testid="figure-caption"]')!.dataset.structure!, source: f.structure, expected: sourceIds[stage.dataset.structure!]!, clipped: f.bounds[0]! < f.region[0]! - 0.002 || f.bounds[1]! < f.region[1]! - 0.002 || f.bounds[2]! > f.region[2]! + 0.002 || f.bounds[3]! > f.region[3]! + 0.002, empty: w.__chemdftRenderer.inspectAtoms().filter(a => a.radius > 0.01).length === 0 });
        if (performance.now() - start < 650 || (stage.dataset.phase !== "settled" && performance.now() - start < 8000)) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    return { frames, acknowledged };
  }, { action, sourceIds });
}

// Frame-by-frame choreography uses installed Chrome's native GPU/compositor; the shared renderer suite also runs SwiftShader.
test.use({ launchOptions: { channel: "chrome", args: [] } });

test.describe("PF-3H continuity", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("every visible transition frame keeps scientific identity and final fit together, including physical radii and periodic ligands", async ({ page }) => {
    await open(page);
    for (const action of [{ structure: "h2o" }, { structure: "c6h6" }, { structure: "c8h10n4o2" }, { structure: "cr2o3" }, { representation: "Polyhedra" }, { representation: "Space filling" }, { representation: "Unit cell" }, { representation: "Ball & stick" }]) {
      const sampled = await sample(page, action);
      expect(sampled.frames.length, JSON.stringify(action)).toBeGreaterThan(0);
      for (const frame of sampled.frames) {
        expect(frame.caption).toBe(frame.id);
        expect(frame.source).toBe(frame.expected);
        expect(frame.clipped, JSON.stringify(frame)).toBe(false);
        expect(frame.empty).toBe(false);
      }
      await expect(page.locator("#structure-stage")).toHaveAttribute("data-phase", "settled");
    }
  });

  test("rapid requests cancel obsolete presentations and resolve to the final choice", async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      for (const id of ["h2o", "c6h6", "cr2o3", "h2o", "c8h10n4o2"]) {
        document.querySelector<HTMLElement>(`[data-testid="structure-${id}"]`)!.click();
        await new Promise(r => setTimeout(r, 35));
      }
    });
    await expect(page.locator("#structure-stage")).toHaveAttribute("data-structure", "c8h10n4o2");
    await expect(page.locator("#structure-stage")).toHaveAttribute("data-phase", "settled");
    await expect(page.getByTestId("figure-caption")).toHaveAttribute("data-structure", "c8h10n4o2");
    await page.waitForTimeout(450);
    await expect(page.locator("#structure-stage")).toHaveAttribute("data-structure", "c8h10n4o2");
  });

  test("ordinary native wheel scrolling reaches all five states with one persistent record and stable water", async ({ page }) => {
    await open(page);
    const start = await page.locator("#how-it-works").evaluate(e => e.getBoundingClientRect().top + scrollY - 54);
    await page.evaluate(y => scrollTo(0, y + 20), start);
    await page.waitForTimeout(650);
    await expect(page.getByTestId("stored-water-handoff")).toHaveText("Stored calculation example · Water · HF / STO-3G");
    await expect(page.locator("#structure-stage")).toHaveAttribute("data-context", "stored-run");
    await page.locator(".process-record").evaluate(e => e.setAttribute("data-persistence-check", "same-node"));
    const reached = new Set<string>();
    for (let i = 0; i < 8; i++) {
      reached.add((await page.locator("#how-it-works").getAttribute("data-stage"))!);
      expect(await page.locator('.process-step[data-active="true"]').count()).toBe(1);
      await expect(page.locator(".process-record")).toHaveAttribute("data-persistence-check", "same-node");
      await page.mouse.wheel(0, 160);
      await page.waitForTimeout(180);
    }
    expect([...reached]).toEqual(["structure", "prepare", "calculate", "verify", "explore"]);
  });

  test("fast scroll and reverse resolve the destination and restore the visitor's reference and representation", async ({ page }) => {
    await open(page);
    await page.getByTestId("structure-c6h6").click();
    await expect(page.locator("#structure-stage")).toHaveAttribute("data-phase", "settled");
    await page.getByRole("radio", { name: "Space filling", exact: true }).click();
    await expect(page.locator("#structure-stage")).toHaveAttribute("data-phase", "settled");
    const start = await page.locator("#how-it-works").evaluate(e => e.getBoundingClientRect().top + scrollY - 54);
    await page.evaluate(y => scrollTo(0, y + 1060), start);
    await expect(page.locator("#how-it-works")).toHaveAttribute("data-stage", "explore");
    await expect(page.locator("#structure-stage")).toHaveAttribute("data-structure", "h2o");
    await page.evaluate(y => scrollTo(0, y + 300), start);
    await expect(page.locator("#how-it-works")).toHaveAttribute("data-stage", "prepare");
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.locator("#structure-stage")).toHaveAttribute("data-structure", "c6h6");
    await expect(page.getByRole("radio", { name: "Space filling", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("figure-caption")).toHaveAttribute("data-context", "reference");
    await expect(page.getByTestId("firewall-run-identity")).toContainText("Water · HF / STO-3G · PySCF");
  });

  test("returning from an offscreen act redraws and reveals a previously acknowledged structure", async ({ page }) => {
    await open(page);
    await page.locator("#workstation").scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.locator("#structure-stage")).toHaveAttribute("data-structure", "cr2o3");
    await expect(page.locator("#structure-stage")).toHaveAttribute("data-phase", "settled");
    await expect.poll(() => page.locator(".stage-visual").evaluate(e => +getComputedStyle(e).opacity)).toBe(1);
  });

  test("workstation begins with real scientific content and expands to software context; final CTA is singular", async ({ page }) => {
    await open(page);
    const start = await page.locator(".workstation-reveal").evaluate(e => e.getBoundingClientRect().top + scrollY - 54);
    await page.evaluate(y => scrollTo(0, y), start);
    const origin = page.getByTestId("workstation-scientific-origin");
    await expect(origin).toBeVisible();
    expect(await origin.evaluate(e => +getComputedStyle(e).opacity)).toBeGreaterThan(0.9);
    expect(await origin.locator("img").getAttribute("src")).toContain("workstation-water-homo.webp");
    await page.mouse.wheel(0, 460);
    await expect.poll(() => page.getByTestId("workstation-frame").evaluate(e => getComputedStyle(e).clipPath)).toBe("inset(0%)");
    const box = (await page.getByTestId("workstation-frame").boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(20);
    expect(box.y).toBeLessThanOrEqual(54);
    const width = box.width;
    expect(width / 1440).toBeGreaterThan(0.9);
    expect(width / 1440).toBeLessThan(0.94);
    await expect(page.locator(".final-cta a")).toHaveCount(1);
    await expect(page.locator(".final-cta")).not.toContainText("See how it works");
  });
});

test("reduced motion retains every static state, changes representations immediately and shows the full workstation", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL: baseURL!, reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await open(page);
  await page.getByTestId("structure-h2o").click();
  await expect(page.locator("#structure-stage")).toHaveAttribute("data-phase", "settled");
  await expect(page.locator("#structure-stage")).toHaveAttribute("data-structure", "h2o");
  await page.getByRole("radio", { name: "Space filling", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Space filling", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".process-step")).toHaveCount(5);
  expect(await page.locator(".process-step").evaluateAll(nodes => nodes.every(e => getComputedStyle(e).visibility === "visible"))).toBe(true);
  expect(await page.getByTestId("workstation-frame").evaluate(e => getComputedStyle(e).clipPath)).toBe("none");
  await expect(page.getByRole("button", { name: /rotation/ })).toHaveCount(0);
  await context.close();
});

test("390px keeps recognizable software chrome and legible stored values in one truthful evidence frame", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL: baseURL!, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await open(page);
  await page.locator("#workstation").scrollIntoViewIfNeeded();
  await expect(page.locator(".workstation-mobile-context")).toContainText("ChemDFT");
  await expect(page.locator(".workstation-mobile-context")).toContainText("Guided · Electronic structure");
  await expect(page.locator(".workstation-mobile-readout")).toContainText("-74.962928 Eh");
  expect(await page.locator(".workstation-mobile-readout dd").first().evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.locator("#how-it-works")).not.toHaveAttribute("data-mode", "pinned");
  await expect(page.locator("#workstation")).not.toHaveAttribute("data-reveal", "active");
  await context.close();
});
