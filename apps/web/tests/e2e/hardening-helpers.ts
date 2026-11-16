import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

export const OUT = process.env.HARDEN_OUT ?? resolve("/tmp/chemdft-hardening-out");
export const VIEWPORTS = [
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "phone-375", width: 375, height: 812 },
] as const;
export type Finding = { page: string; viewport: string; scheme: string; overflow: boolean; axe: string[]; smallTargets: string[]; background: string };
export const findings: Finding[] = [];
export const startOutput = () => mkdirSync(OUT, { recursive: true });
export const writeFindings = () => writeFileSync(resolve(OUT, `audit-${process.pid}.json`), JSON.stringify(findings, null, 1));

export async function audit(page: Page, name: string, viewport: (typeof VIEWPORTS)[number], scheme: "light" | "dark") {
  await page.waitForTimeout(600);
  await page.addScriptTag({ path: resolve("node_modules/axe-core/axe.min.js") });
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axe = (window as any).axe;
    const run = await axe.run(document, { resultTypes: ["violations"] });
    const small: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, a[href], input:not([type=hidden]), select, textarea, [role=tab]"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.width < 24 || rect.height < 24) small.push(`${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? el.textContent?.trim().slice(0, 24) ?? ""}] ${Math.round(rect.width)}x${Math.round(rect.height)}`);
    }
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      axe: run.violations.filter((v: { impact: string }) => v.impact === "serious" || v.impact === "critical").map((v: { id: string; nodes: unknown[] }) => `${v.id} (${v.nodes.length})`),
      small,
      background: getComputedStyle(document.body).backgroundColor,
    };
  });
  findings.push({ page: name, viewport: viewport.name, scheme, overflow: result.overflow, axe: result.axe, smallTargets: result.small, background: result.background });
  await page.screenshot({ path: resolve(OUT, `${name}-${viewport.name}-${scheme}.png`), fullPage: false });
}

export async function sweep(page: Page, name: string, open: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await open();
      await audit(page, name, viewport, scheme);
    }
  }
}

