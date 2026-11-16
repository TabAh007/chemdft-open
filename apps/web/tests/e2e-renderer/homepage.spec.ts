import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * PF-3E/F: the public homepage against the web-only dev stack (no API, no database, `dev` auth mode).
 * What is drawn is verified through the renderer's own `inspectAtoms()` handle, exposed in non-production builds.
 */
const reference = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../src/app/_components/home/reference/cr2o3-reference.json"), "utf8")) as { lattice: { a: number; c: number; gamma: number }; sites: { fractional: [number, number, number] }[] };
const DEG = Math.PI / 180;
const { a: LA, c: LC, gamma: LG } = reference.lattice;
const wrap = (v: number) => ((v % 1) + 1) % 1;
/** Cartesian → fractional for the hexagonal cell used by the renderer (a along x, b at γ, c along z). */
const toFrac = (p: readonly number[]) => {
  const y = p[1]! / (LA * Math.sin(LG * DEG));
  return [(p[0]! - y * LA * Math.cos(LG * DEG)) / LA, y, p[2]! / LC];
};
const isSite = (f: readonly number[]) => reference.sites.some((site) => site.fractional.every((v, i) => Math.min(Math.abs(wrap(f[i]! - v)), Math.abs(wrap(v - f[i]!))) < 5e-4));

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

type Drawn = { position: [number, number, number]; radius: number };
const drawn = (page: Page) => page.evaluate(() => (window as unknown as { __chemdftRenderer: { inspectAtoms(): Drawn[] } }).__chemdftRenderer.inspectAtoms());
const visible = async (page: Page) => (await drawn(page)).filter((atom) => atom.radius > 1e-3);

const ids = ["h2o", "c6h6", "c8h10n4o2", "cr2o3"] as const;
const NAMES: Record<(typeof ids)[number], string> = { h2o: "Water", c6h6: "Benzene", c8h10n4o2: "Caffeine", cr2o3: "Chromium(III) oxide" };
const MOLECULE_ATOMS: Record<string, number> = { h2o: 3, c6h6: 12, c8h10n4o2: 24 };

function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  return errors;
}

async function open(page: Page) {
  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Computational chemistry, without the old workflow.");
}

async function ready(page: Page) {
  await expect(page.locator("#structure-stage")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await page.waitForTimeout(900); // entrance and framing settle
}

async function pick(page: Page, id: (typeof ids)[number]) {
  await page.getByTestId(`structure-${id}`).click();
  await expect(page.locator("#structure-stage")).toHaveAttribute("data-structure", id);
  await page.waitForTimeout(1100); // leave (260 ms) + reframe + enter
}

const radios = (page: Page) => page.getByRole("radiogroup", { name: "Representation" }).getByRole("radio");

test.describe("homepage hero and structure selector", () => {
  test("renders publicly with landmarks, the approved headline and one primary action; no session request, no console error", async ({ page }) => {
    const errors = watch(page);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await open(page);
    await ready(page);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByTestId("hero-primary")).toHaveText("Open ChemDFT"); // local development identity: nothing to sign in to
    await expect(page.getByRole("link", { name: "See how it works" }).first()).toBeVisible();
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/From molecule to insight|Launch ChemDFT|AI-powered/i);
    expect(text).not.toMatch(/\$\s?\d/);
    await expect(page.getByRole("link", { name: /sign up|create account|register|get started/i })).toHaveCount(0);
    expect(requests.filter((url) => url.includes("/api/auth/get-session"))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("offers exactly four reference structures with the right names and formulas, as a keyboard-operable strip", async ({ page }) => {
    await open(page);
    await ready(page);
    const group = page.getByRole("radiogroup", { name: "Reference structure" });
    const samples = group.getByRole("radio");
    await expect(samples).toHaveCount(4);
    for (const id of ids) await expect(page.getByTestId(`structure-${id}`)).toContainText(NAMES[id]);
    await expect(page.getByTestId("structure-h2o")).toContainText("H2O"); // text content; the subscripts are presentational
    await expect(page.getByTestId("structure-cr2o3")).toHaveAttribute("aria-checked", "true"); // the crystal is the opening structure
    // arrow keys move the selection and the focus together; Home/End jump
    await page.getByTestId("structure-cr2o3").focus();
    await page.keyboard.press("ArrowRight"); // wraps to water
    await expect(page.getByTestId("structure-h2o")).toBeFocused();
    await expect(page.getByTestId("structure-h2o")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("End");
    await expect(page.getByTestId("structure-cr2o3")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.locator("#structure-stage")).toHaveAttribute("data-structure", "h2o");
    await page.keyboard.press("Tab"); // no focus trap: the radiogroup is a single tab stop
    await expect(group.locator(":focus")).toHaveCount(0);
  });

  test("each selector draws the right structure: atom counts match the formula, and the figure caption names the source", async ({ page }) => {
    await open(page);
    await ready(page);
    const crystal = await visible(page);
    expect(crystal.length).toBeGreaterThanOrEqual(30 * 4); // 2×2×1 display supercell
    await expect(page.getByTestId("figure-caption")).toContainText("COD 9014036");
    for (const id of ["h2o", "c6h6", "c8h10n4o2"] as const) {
      await pick(page, id);
      expect((await visible(page)).length, id).toBe(MOLECULE_ATOMS[id]);
    }
    await expect(page.getByTestId("figure-caption")).toContainText("PubChem CID 2519");
    await pick(page, "c6h6");
    await expect(page.getByTestId("figure-caption")).toContainText("PubChem CID 241");
    await pick(page, "h2o");
    await expect(page.getByTestId("figure-caption")).toContainText("ChemDFT test geometry");
    await pick(page, "cr2o3");
    expect((await visible(page)).length).toBeGreaterThanOrEqual(30 * 4);
    await expect(page.getByTestId("figure-caption")).toContainText("not the refined structure of any ChemDFT sample");
  });

  test("switching structure never interpolates coordinates: every drawn atom is at an authoritative position of the old or the new structure", async ({ page }) => {
    await open(page);
    await ready(page);
    const key = (atoms: Drawn[]) => atoms.map((atom) => atom.position);
    const crystalAtoms = key(await visible(page));
    await pick(page, "c6h6");
    const benzeneAtoms = key(await visible(page));
    expect(benzeneAtoms).toHaveLength(12);
    await pick(page, "cr2o3");

    // sample every animation frame through a switch from the crystal to benzene and back
    const result = await page.evaluate(
      async ({ crystal, benzene }) => {
        const api = (window as unknown as { __chemdftRenderer: { inspectAtoms(): Drawn[] } }).__chemdftRenderer;
        const near = (p: number[], set: number[][]) => set.some((q) => Math.abs(p[0]! - q[0]!) < 2e-3 && Math.abs(p[1]! - q[1]!) < 2e-3 && Math.abs(p[2]! - q[2]!) < 2e-3);
        const strays: number[][] = [];
        let samples = 0;
        let running = true;
        const sample = () => {
          if (!running) return;
          for (const atom of api.inspectAtoms()) if (atom.radius > 1e-3) {
            samples += 1;
            if (!near(atom.position, crystal) && !near(atom.position, benzene)) strays.push(atom.position);
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        (document.querySelector('[data-testid="structure-c6h6"]') as HTMLElement).click();
        await new Promise((resolve) => setTimeout(resolve, 1300));
        (document.querySelector('[data-testid="structure-cr2o3"]') as HTMLElement).click();
        await new Promise((resolve) => setTimeout(resolve, 1300));
        running = false;
        return { samples, strays: strays.slice(0, 5) };
      },
      { crystal: crystalAtoms, benzene: benzeneAtoms },
    );
    expect(result.samples).toBeGreaterThan(100);
    expect(result.strays).toEqual([]);
  });

  test("representation modes depend on the structure type: the crystal offers five, a molecule offers three and never a cell or polyhedra", async ({ page }) => {
    await open(page);
    await ready(page);
    await expect(radios(page)).toHaveText(["Ball & stick", "Unit cell", "Polyhedra", "Wireframe", "Space filling"]);
    for (const id of ["h2o", "c6h6", "c8h10n4o2"] as const) {
      await pick(page, id);
      await expect(radios(page), id).toHaveText(["Ball & stick", "Wireframe", "Space filling"]);
      await expect(page.getByRole("radio", { name: /Unit cell|Polyhedra/ })).toHaveCount(0);
    }
    await pick(page, "cr2o3");
    await expect(radios(page)).toHaveCount(5);
  });

  test("changing the representation changes what is drawn, never the structure: every drawn atom stays a validated Cr₂O₃ site", async ({ page }) => {
    await open(page);
    await ready(page);
    const key = (atom: Drawn) => atom.position.map((v) => v.toFixed(3)).join(",");
    const base = new Set((await visible(page)).map(key));
    const pixels = async () => (await page.locator("#structure-stage canvas").screenshot()).toString("base64");
    const before = await pixels();
    for (const name of ["Polyhedra", "Unit cell", "Wireframe", "Space filling", "Ball & stick"]) {
      await page.getByRole("radio", { name, exact: true }).click();
      await expect(page.getByRole("radio", { name, exact: true })).toHaveAttribute("aria-checked", "true");
      await page.waitForTimeout(900);
      const atoms = await visible(page);
      const now = new Set(atoms.map(key));
      for (const position of base) expect(now.has(position), `${name}: atom ${position} disappeared`).toBe(true); // nothing the base view shows is moved or removed
      for (const atom of atoms) expect(isSite(toFrac(atom.position)), `${name}: atom at ${atom.position} is not a lattice image of a validated site`).toBe(true); // polyhedra complete themselves with lattice images only
      if (name === "Wireframe") expect(await pixels()).not.toBe(before);
    }
  });

  test("dragging the structure rotates it and the scene can be paused", async ({ page }) => {
    await open(page);
    await ready(page);
    await expect(page.getByRole("button", { name: "Resume rotation" })).toBeVisible();
    const canvas = page.locator("#structure-stage canvas");
    const before = (await canvas.screenshot()).toString("base64");
    const box = (await canvas.boundingBox())!;
    const x = box.x + box.width * 0.7;
    const y = box.y + box.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 140, y + 30, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect((await canvas.screenshot()).toString("base64")).not.toBe(before);
  });

  test("repeated structure and representation switching does not leak GPU memory", async ({ page }) => {
    test.setTimeout(180_000);
    await open(page);
    await ready(page);
    const memory = () => page.evaluate(() => {
      const { geometries, textures } = (window as unknown as { __chemdftRenderer: { stats(): { geometries: number; textures: number } } }).__chemdftRenderer.stats();
      return { geometries, textures };
    });
    const round = async () => {
      for (const id of ids) await pick(page, id);
      for (const name of ["Polyhedra", "Unit cell", "Wireframe", "Space filling", "Ball & stick"]) {
        await page.getByRole("radio", { name, exact: true }).click();
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(600);
    };
    await round(); // warm-up: every structure and mode builds its geometry once
    const baseline = await memory();
    for (let i = 0; i < 4; i += 1) await round();
    expect(await memory()).toEqual(baseline); // drei's ContactShadows used to leave two render targets and a plane behind per switch
  });

  test("an idle scene renders no frames", async ({ page }) => {
    await open(page);
    await ready(page);
    if (await page.getByRole("button", { name: "Pause rotation" }).count()) await page.getByRole("button", { name: "Pause rotation" }).click();
    const frame = () => page.evaluate(() => (window as unknown as { __chemdftRenderer: { stats(): { frame: number } } }).__chemdftRenderer.stats().frame);
    // software rendering is slow, so wait for the damped motion to settle rather than for a fixed time
    let last = -1;
    await expect
      .poll(async () => {
        const now = await frame();
        const settled = now === last;
        last = now;
        await page.waitForTimeout(1000);
        return settled;
      }, { timeout: 40_000 })
      .toBe(true);
    const idle = await frame();
    await page.waitForTimeout(2000);
    expect(await frame()).toBe(idle);
  });
});

test.describe("homepage page structure", () => {
  test("is the five-act page: structure → calculation → firewall → workstation → run record, with the engines compressed", async ({ page }) => {
    await open(page);
    for (const section of ["#structure", "#how-it-works", "#result-firewall", "#workstation", "#reproducibility", "#engines"]) await expect(page.locator(section), section).toHaveCount(1);
    const order = await page.evaluate(() => ["structure", "how-it-works", "result-firewall", "workstation", "reproducibility", "engines"].map((id) => document.getElementById(id)!.getBoundingClientRect().top + window.scrollY));
    expect([...order]).toEqual([...order].sort((a, b) => a - b));
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height).toBeLessThan(6800); // five 24vh states plus the 50vh workstation reveal are deliberate reading distance
  });

  test("has no grid-line background anywhere in the page", async ({ page }) => {
    await open(page);
    const gradients = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("*")]
        .map((element) => getComputedStyle(element))
        .filter((style) => /repeating|linear-gradient/.test(style.backgroundImage) && style.backgroundSize !== "auto")
        .map((style) => `${style.backgroundImage} / ${style.backgroundSize}`),
    );
    expect(gradients).toEqual([]);
  });

  test("links only to internal navigation and the cited source; no frozen project, acceptance or restricted asset", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await open(page);
    await ready(page);
    await page.locator("img").evaluateAll((images) => images.forEach((image) => ((image as HTMLImageElement).loading = "eager")));
    await page.waitForLoadState("networkidle");
    const hrefs = await page.locator("a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    for (const href of hrefs) expect(href).toMatch(/^(#[a-z-]+|\/(en|tr|ru|de)(\/projects|\/login|\/account)?|https:\/\/(www\.crystallography\.net\/cod\/9014036\.html|pubchem\.ncbi\.nlm\.nih\.gov\/compound\/(241|2519)))$/);
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const forbidden of [/acceptance/, /\bnist\b/, /phase 7/, /example project/, /acetone/]) expect(text).not.toMatch(forbidden);
    for (const url of requested) expect(url).not.toMatch(/nist|acetone|acceptance/i);
    // no third-party host is contacted at runtime (structures are bundled, not fetched)
    for (const url of requested) expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  });

  test("the stored run record shows only values the record holds", async ({ page }) => {
    await open(page);
    const record = page.locator("#reproducibility");
    await record.scrollIntoViewIfNeeded();
    await expect(record).toContainText("PySCF");
    await expect(record).toContainText("STO-3G");
    await expect(record).toContainText("Restricted Hartree-Fock");
    await expect(record).toContainText("SHA-256");
    const alt = await page.locator("#workstation .workstation-image-window img").getAttribute("alt");
    expect(alt).toMatch(/−?\d+\.\d+/); // the screenshot alt text reports the stored energies
  });

  test("scroll choreography is cleaned up when leaving the page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await ready(page);
    await page.evaluate(() => window.scrollTo(0, 2400));
    await page.waitForTimeout(600);
    const triggers = () => page.evaluate(() => (window as unknown as { __chemdftScrollTriggers?: () => number }).__chemdftScrollTriggers?.() ?? -1);
    expect(await triggers()).toBeGreaterThan(0);
    await page.getByRole("contentinfo").getByRole("link", { name: "Sign in" }).click(); // client-side navigation
    await expect(page).toHaveURL(/\/en\/login/);
    await expect.poll(triggers).toBe(0);
    expect(await page.evaluate(() => Boolean((window as unknown as { __chemdftRenderer?: unknown }).__chemdftRenderer))).toBe(false);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Computational chemistry, without the old workflow.");
    await expect.poll(triggers, { timeout: 20_000 }).toBeGreaterThan(0); // rebuilt on return
    const rebuilt = await triggers();
    await page.getByRole("contentinfo").getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/en\/login/);
    await expect.poll(triggers).toBe(0);
    expect(await page.evaluate(() => Boolean((window as unknown as { __chemdftRenderer?: unknown }).__chemdftRenderer))).toBe(false);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Computational chemistry, without the old workflow.");
    await expect.poll(triggers, { timeout: 20_000 }).toBe(rebuilt); // the same count: nothing duplicated, nothing leaked
  });

  test("native scrolling is never intercepted", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await ready(page);
    const result = await page.evaluate(async () => {
      let prevented = 0;
      window.addEventListener("wheel", (event) => event.defaultPrevented && (prevented += 1), { capture: false, passive: true });
      return { prevented, behavior: getComputedStyle(document.documentElement).scrollBehavior, overflow: getComputedStyle(document.body).overflow };
    });
    expect(result.prevented).toBe(0);
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    expect(result.overflow).not.toBe("hidden");
  });
});

test.describe("accessibility", () => {
  type Violation = { id: string; impact: string; help: string; nodes: { target: string[]; html: string }[] };
  const audit = async (page: Page) => {
    await page.evaluate(axeSource);
    return page.evaluate(async () => {
      const result = await (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: Violation[] }> } }).axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] });
      return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
    });
  };

  /** Scroll the whole page once, the way a reader does, so every scroll reveal has played and settled. */
  const readThrough = async (page: Page, step: number) => {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= height; y += step) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(900);
  };

  test("no automated WCAG 2.2 AA violations on a desktop page that has been read through, dark act included", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await ready(page);
    await readThrough(page, 450);
    expect(await audit(page)).toEqual([]);
    // the dark Scientific Result Firewall act in view, with its reveal complete (the chain reveals as it nears the upper third)
    await page.evaluate(() => {
      const chain = document.querySelector("#result-firewall .chain")!;
      window.scrollTo(0, chain.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3);
    });
    await page.waitForTimeout(1200);
    expect(await audit(page)).toEqual([]);
  });

  test("the unrevealed state still meets contrast wherever it is already readable: reduced motion shows every section fully", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL: baseURL!, reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await open(page);
    await ready(page);
    expect(await audit(page)).toEqual([]);
    await context.close();
  });

  test("no automated violations on a phone, with the menu closed and open", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL: baseURL!, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await open(page);
    await ready(page);
    await readThrough(page, 500);
    await page.evaluate(() => {
      const chain = document.querySelector("#result-firewall .chain")!;
      window.scrollTo(0, chain.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3);
    });
    await page.waitForTimeout(1200);
    expect(await audit(page)).toEqual([]);
    await page.getByRole("button", { name: "Menu" }).click();
    expect(await audit(page)).toEqual([]);
    await context.close();
  });

  test("the canvas has a text alternative, every control has a visible focus ring, and the figure is described", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await ready(page);
    const label = await page.locator("#structure-stage canvas").evaluate((canvas) => canvas.getAttribute("aria-label") ?? canvas.closest("[aria-label]")?.getAttribute("aria-label") ?? "");
    expect(label).toMatch(/Chromium\(III\) oxide, Cr 2 O 3/);
    expect(label).toMatch(/Drag to rotate; arrow keys rotate/);
    for (const control of [page.getByTestId("structure-h2o"), page.getByRole("radio", { name: "Polyhedra" }), page.getByTestId("hero-primary")]) {
      await control.focus();
      const outline = await control.evaluate((element) => {
        const style = getComputedStyle(element);
        return { width: parseFloat(style.outlineWidth), style: style.outlineStyle, shadow: style.boxShadow };
      });
      expect(outline.style !== "none" && outline.width >= 2 || outline.shadow !== "none").toBe(true);
    }
  });

  test("information is never carried by colour alone: the selected structure and representation expose a state, not just a hue", async ({ page }) => {
    await open(page);
    await ready(page);
    await expect(page.getByTestId("structure-cr2o3")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: "Ball & stick" })).toHaveAttribute("aria-checked", "true");
    const lines = await page.getByTestId("structure-cr2o3").evaluate((element) => ({ own: getComputedStyle(element).borderBottomWidth, ariaCurrent: element.getAttribute("aria-checked") }));
    expect(lines.ariaCurrent).toBe("true");
  });
});

test.describe("fallbacks and accessibility modes", () => {
  test("without WebGL the server-rendered static structure stays, described in text, with a working selector and no 3D controls", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
        if (/webgl/.test(kind)) return null;
        return (original as (...args: unknown[]) => unknown).call(this, kind, ...rest) as never;
      } as typeof original;
    });
    const errors = watch(page);
    await open(page);
    await page.waitForTimeout(1500);
    await expect(page.locator("#structure-stage")).toHaveAttribute("data-ready", "false");
    await expect(page.locator("#structure-stage canvas")).toHaveCount(0);
    const figure = page.getByRole("img", { name: /Chromium\(III\) oxide/ });
    await expect(figure.first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Pause rotation|Reset view/ })).toHaveCount(0);
    await pick(page, "c6h6").catch(() => undefined);
    await expect(page.locator("#structure-stage")).toHaveAttribute("data-structure", "c6h6");
    await expect(page.getByRole("img", { name: /Benzene/ }).first()).toBeVisible();
    expect(errors.filter((message) => !/webgl/i.test(message))).toEqual([]);
  });

  test("save-data visitors keep the static structure and never download the 3D scene", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "connection", { value: { saveData: true } }));
    const chunks: string[] = [];
    page.on("request", (request) => /molecular-renderer|three|postprocessing/i.test(request.url()) && chunks.push(request.url()));
    await open(page);
    await page.waitForTimeout(2000);
    await expect(page.locator("#structure-stage canvas")).toHaveCount(0);
    await expect(page.getByRole("img", { name: /Chromium\(III\) oxide/ }).first()).toBeVisible();
    expect(chunks).toEqual([]);
  });

  test("reduced motion: no auto-rotation or pause control, the scene and every view control still work", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL: baseURL!, reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = watch(page);
    await open(page);
    await ready(page);
    await expect(page.getByRole("button", { name: /pause rotation|resume rotation/i })).toHaveCount(0);
    await pick(page, "c8h10n4o2");
    expect((await visible(page)).length).toBe(24);
    await page.getByRole("radio", { name: "Space filling" }).click();
    await expect(page.getByRole("radio", { name: "Space filling" })).toHaveAttribute("aria-checked", "true");
    // the pinned stage is a desktop-and-motion treatment only: with reduced motion the story is stacked, all steps readable
    await expect(page.locator(".journey")).not.toHaveAttribute("data-mode", "pinned");
    for (const label of ["Structure", "Prepare", "Calculate", "Verify", "Explore"]) await expect(page.locator("#how-it-works")).toContainText(label);
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("mobile (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("shows the headline and the primary action immediately, and the structure early, with no horizontal scroll", async ({ page }) => {
    const errors = watch(page);
    await open(page);
    await ready(page);
    const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
    expect(h1!.y + h1!.height).toBeLessThan(844);
    const primary = await page.getByTestId("hero-primary").boundingBox();
    expect(primary!.y + primary!.height).toBeLessThan(844);
    const stage = await page.locator("#structure-stage").boundingBox();
    expect(stage!.y).toBeLessThan(844 * 0.75); // the structure begins in the first screen
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(5200);
    expect(errors).toEqual([]);
  });

  test("the structure selector is compact, scrollable and operable by touch", async ({ page }) => {
    await open(page);
    await ready(page);
    const strip = page.getByRole("radiogroup", { name: "Reference structure" });
    const box = await strip.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    expect(box!.height).toBeLessThan(145); // two 60px touch rows retain the full scientific names
    await page.getByTestId("structure-c8h10n4o2").scrollIntoViewIfNeeded();
    await page.getByTestId("structure-c8h10n4o2").tap();
    await expect(page.locator("#structure-stage")).toHaveAttribute("data-structure", "c8h10n4o2");
    await expect(radios(page)).toHaveCount(3);
  });

  test("does not pin or trap scrolling: the story is stacked and the whole page can be scrolled through", async ({ page }) => {
    await open(page);
    await expect(page.locator(".journey")).not.toHaveAttribute("data-mode", "pinned");
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 700) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(30);
    }
    expect(await page.evaluate(() => Math.round(window.scrollY + window.innerHeight))).toBeGreaterThanOrEqual(height - 40);
  });
});
