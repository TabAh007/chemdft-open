import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Engines } from "../src/app/_components/home/engines";
import { Licences } from "../src/app/_components/home/licences";
import { ALL_ENGINE_CARDS } from "../src/app/_components/home/content";
import { LicenseView } from "../src/app/_components/public-doc/license-view";
import { HELD_BACK_FILES, LICENCE_NOT_RECORDED, OPEN_CORE_STATEMENT, THIRD_PARTY, ZENODO_SNAPSHOT_DOI, licenceForCard } from "../src/content/license";

const root = resolve(__dirname, "../../..");
const decode = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");

describe("Licences: one data file for the page, the section and the Engines cards", () => {
  it("gives every Engines card a licence or the explicit not-recorded text, from the table", () => {
    const html = decode(renderToStaticMarkup(createElement(Engines, { locale: "en" })));
    expect(html.match(/Licence: /g)).toHaveLength(ALL_ENGINE_CARDS.length);
    for (const card of ALL_ENGINE_CARDS) {
      const licence = licenceForCard(card.name);
      expect(licence.trim(), card.name).not.toBe("");
      expect(html, card.name).toContain(`Licence: ${licence}`);
    }
    // The cards whose licence the table records show it; Psi4 and DFT-D4 stay in the table too.
    expect(licenceForCard("Quantum ESPRESSO")).toBe("GPL-2.0-or-later");
    expect(licenceForCard("nmrglue · pyOpenMS")).toBe(LICENCE_NOT_RECORDED);
  });

  it("gives every table row a licence name or the explicit not-recorded text, and an upstream link or a stated absence", () => {
    const html = decode(renderToStaticMarkup(createElement(LicenseView)));
    expect(html.match(/data-testid="third-party-row"/g)).toHaveLength(THIRD_PARTY.length);
    for (const row of THIRD_PARTY) {
      expect(row.short === null || row.short.trim() !== "", row.name).toBe(true);
      expect(html, row.name).toContain(row.short ?? LICENCE_NOT_RECORDED);
      if (row.upstream) expect(row.upstream, row.name).toMatch(/^https:\/\//);
    }
    // Rows without a recorded licence never carry an invented one.
    for (const row of THIRD_PARTY.filter((r) => r.short === null)) expect(row.status, row.name).toBe("not verified");
  });

  it("covers every engine the Engines cards name, including Psi4 and DFT-D4", () => {
    const names = THIRD_PARTY.map((row) => row.name.toLowerCase()).join(" | ");
    for (const required of ["pyscf", "geometric", "xtb", "crest", "quantum espresso", "sssp", "rdkit", "pymatgen", "cclib", "libxc", "libcint", "psi4", "dft-d4"]) expect(names, required).toContain(required);
  });

  it("shows the same open-core statement on the licence page and on the home page", () => {
    const page = decode(renderToStaticMarkup(createElement(LicenseView)));
    const home = decode(renderToStaticMarkup(createElement(Licences, { locale: "en" })));
    expect(page).toContain(OPEN_CORE_STATEMENT);
    expect(home).toContain(OPEN_CORE_STATEMENT);
    expect(OPEN_CORE_STATEMENT).not.toMatch(/open source/i);
  });

  it("states the held-back files exactly as the snapshot script lists them, and links the Zenodo record", () => {
    const script = readFileSync(resolve(root, "scripts/build_zenodo_snapshot.py"), "utf8");
    const held = [...(/HELD_BACK = frozenset\(\s*\{([\s\S]*?)\}/.exec(script)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect([...HELD_BACK_FILES].sort()).toEqual(held.sort());
    const page = renderToStaticMarkup(createElement(LicenseView));
    for (const file of HELD_BACK_FILES) expect(page).toContain(file.split("/").pop()!);
    expect(page).toContain(`https://doi.org/${ZENODO_SNAPSHOT_DOI}`);
    expect(page).toMatch(/not legal advice/i);
    expect(page).toMatch(/legal read[^.]*pending/i);
  });

  it("makes the home section a compact pointer with the row count and a link to the table", () => {
    const home = renderToStaticMarkup(createElement(Licences, { locale: "en" }));
    expect(home).toContain('id="licences"');
    expect(home).toContain(`calls ${THIRD_PARTY.length} third-party`);
    expect(home).toContain('href="/en/license#third-party"');
  });

  it("adds a licence line with a link to the cite page", () => {
    const cite = readFileSync(resolve(__dirname, "../src/app/_components/learn/cite-client.tsx"), "utf8");
    expect(cite).toContain('data-testid="cite-licence-line"');
    expect(cite).toContain("/license`}>See the licences");
  });

  it("keeps the TR, RU and DE switcher entries unchanged (coming soon)", () => {
    const src = readFileSync(resolve(__dirname, "../src/app/_components/locale-switcher.tsx"), "utf8");
    expect(src).toContain('ACTIVE_LOCALES: readonly Locale[] = ["en"]');
  });
});
