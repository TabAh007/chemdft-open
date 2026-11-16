import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 0.0.22 logo captures at 1547x784, 1280x800 and 390x844, DPR 1 and 2, LIGHT only (ChemDFT has no dark theme).
 * Fixture mock APIs only. R22_PHASE=before|after chooses the folder. Prints axe results and the logo geometry.
 */
const PHASE = process.env.R22_PHASE ?? "after";
const SHOTS = process.env.R22_SHOTS ?? `<local-path>/Desktop/chemdft/output/release-0022/${PHASE}`;
mkdirSync(SHOTS, { recursive: true });
const JOBS = "/en/projects/00000000-0000-4000-8000-0000000000a1/jobs";
const PAGES = [["landing", "/en"], ["projects", "/en/projects"], ["workspace", JOBS], ["login", "/en/login"]] as const;
const SIZES = [[1547, 784], [1280, 800], [390, 844]] as const;

async function axe(page: Page) {
  await page.addScriptTag({ path: resolve("node_modules/axe-core/axe.min.js") });
  return page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[] }> }> }> } })
      .axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
    return r.violations.map((v) => ({ id: v.id, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
  });
}

for (const dpr of [1, 2]) for (const [w, h] of SIZES) for (const [name, url] of PAGES) {
  test(`${name} ${w}px @${dpr}x`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem("chemdft:workspace-mode", "guided"); } catch { /* optional */ } });
    await page.goto(url);
    await page.waitForTimeout(2500);
    const brand = page.locator(".brand-mark").first();
    await expect(brand).toBeVisible();
    const geo = await page.evaluate(() => {
      const el = document.querySelector(".brand-mark");
      const img = el?.querySelector("img");
      const link = el?.closest("a");
      const hdr = el?.closest("header");
      const r = (e: Element | null | undefined) => { const b = e?.getBoundingClientRect(); return b ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] : null; };
      return { img: r(img), link: r(link), header: r(hdr), headerBg: hdr ? getComputedStyle(hdr).backgroundColor : null, loaded: img ? img.complete && img.naturalWidth > 0 : null,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    console.log(`GEO ${PHASE} ${name} ${w} @${dpr}x`, JSON.stringify(geo));
    if (dpr === 1) await page.screenshot({ path: `${SHOTS}/${name}-${w}.png` });
    else {
      const hdr = page.locator("header").first();
      await hdr.screenshot({ path: `${SHOTS}/${name}-${w}-header@2x.png` });
    }
    if (dpr === 1 && w === 1547) console.log(`AXE ${PHASE} ${name}`, JSON.stringify(await axe(page)));
    await ctx.close();
  });
}

test("favicon files at 16, 32 and 48 px (actual size and 8x pixelated)", async ({ browser }) => {
  if (PHASE === "before") test.skip(true, "no favicon files exist before this release");
  const page = await (await browser.newContext({ viewport: { width: 760, height: 330 }, deviceScaleFactor: 1 })).newPage();
  const sz = [16, 32, 48];
  await page.setContent(`<body style="margin:0;font:12px sans-serif;background:#fff;display:flex;gap:24px;padding:16px;align-items:flex-end">${sz.map((s) =>
    `<figure style="margin:0"><img src="${process.env.R22_BASE ?? "http://127.0.0.1:3322"}/brand/png/favicon-${s}.png" width="${s}" height="${s}"><br><img src="${process.env.R22_BASE ?? "http://127.0.0.1:3322"}/brand/png/favicon-${s}.png" width="${s * 4}" height="${s * 4}" style="image-rendering:pixelated"><figcaption>${s}px</figcaption></figure>`).join("")}</body>`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/favicons-16-32-48.png` });
  const head = await (await page.request.get("/en/login")).text();
  console.log("HEADLINKS", head.match(/<link[^>]*icon[^>]*>/g)?.length);
});
