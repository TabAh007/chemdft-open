import { chromium } from "@playwright/test";
const out = process.argv[2];
const base = "http://localhost:3111/en";
const pages = { home: "", principles: "/principles", validation: "/validation", "cost-and-support": "/cost-and-support" };
const b = await chromium.launch({ channel: "chrome" });
for (const [w, h] of [[1568, 1000], [390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  for (const [name, path] of Object.entries(pages)) {
    await p.goto(base + path, { waitUntil: "load", timeout: 90000 });
    await p.screenshot({ path: `${out}/${name}-${w}.png`, fullPage: true });
    const m = await p.evaluate(() => {
      const de = document.documentElement;
      const small = [...document.querySelectorAll("a,button,input,select,summary")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 24); }).map(e => `${e.tagName}:${(e.textContent || "").trim().slice(0, 24)}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
      const h1 = document.querySelectorAll("h1").length;
      const heads = [...document.querySelectorAll("h1,h2,h3,h4")].map(e => e.tagName[1]).join("");
      const noAlt = [...document.querySelectorAll("img:not([alt])")].length;
      return { hscroll: de.scrollWidth > de.clientWidth, sw: de.scrollWidth, cw: de.clientWidth, h1, heads, noAlt, small: small.slice(0, 12), title: document.title, lang: de.lang, main: !!document.querySelector("main") };
    });
    console.log(w, name, JSON.stringify(m));
  }
  await ctx.close();
}
await b.close();
