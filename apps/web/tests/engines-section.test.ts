import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ALL_ENGINE_CARDS, NOT_YET } from "../src/app/_components/home/content";
import { Engines } from "../src/app/_components/home/engines";
import { COMING_SOON, LocaleSwitcher } from "../src/app/_components/locale-switcher";

describe("landing Engines section", () => {
  const html = renderToStaticMarkup(createElement(Engines, { locale: "en" }));

  it("is never collapsed: no disclosure element, anchor kept", () => {
    expect(html).not.toMatch(/<details|<summary/);
    expect(html).toContain('id="engines"');
    expect(html).not.toContain('id="status"');
  });

  it("shows one card per engine, grouped by job, with a text status on each", () => {
    expect(html.match(/data-testid="engine-card"/g)).toHaveLength(ALL_ENGINE_CARDS.length);
    for (const heading of ["Molecular calculations", "Periodic crystals and solids", "Structures and imports", "Not available yet"]) expect(html).toContain(heading);
    for (const name of ["PySCF", "geomeTRIC", "xTB (GFN2)", "CREST", "Quantum ESPRESSO", "PySCF periodic", "RDKit", "pymatgen", "cclib", "Psi4", "DFT-D4", "GPU4PySCF"]) expect(html).toContain(name);
    expect(html).toMatch(/Available/);
  });

  it("labels the three blocked engines Not available with a reason, and the planned ones Not available yet", () => {
    const cards = html.split('data-testid="engine-card"').slice(1);
    for (const name of ["Psi4", "DFT-D4", "GPU4PySCF"]) {
      const card = cards.find((c) => c.includes(`<h4>${name}</h4>`)) ?? "";
      expect(card).toMatch(/○<\/span> Not available<\/span>/);
      expect(card).toContain("Not available: ");
    }
    for (const name of ["nmrglue", "QCElemental"]) expect(cards.find((c) => c.includes(name)) ?? "").toMatch(/Not available yet/);
  });

  it("keeps every existing limit and states the periodic limits", () => {
    for (const item of NOT_YET) expect(html).toContain(item.replaceAll("'", "&#x27;"));
    expect(html).toContain("Γ point only on the hosted worker");
    expect(html).toContain("No cell relaxation");
    expect(html).toContain("cell held fixed");
  });

  it("links the release notes and the Zenodo record without calling any result verified in general", () => {
    expect(html).toContain("https://doi.org/10.5281/zenodo.24209616");
    expect(html).toContain("https://doi.org/10.5281/zenodo.24082321");
    expect(html).not.toContain("24183501");
    expect(html).toContain("/en/releases");
    expect(html).toContain("does not by itself verify any scientific result");
    expect(html).not.toMatch(/\bbest\b|fastest|world-class|revolutionary|state-of-the-art/i);
  });
});

describe("language switcher", () => {
  const html = renderToStaticMarkup(createElement(LocaleSwitcher, { locale: "en" }));

  it("keeps English as the only navigable language", () => {
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/en"');
    for (const code of ["tr", "ru", "de"]) expect(html).not.toContain(`href="/${code}"`);
  });

  it("shows Turkish, Russian and German as disabled, with Coming soon as a tooltip rather than a loose word", () => {
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(3);
    for (const code of ["tr", "ru", "de"]) expect(html).toContain(`data-testid="locale-${code}"`);
    expect(html.match(/title="Coming soon"/g)).toHaveLength(3);
    expect(html.match(/data-soon="Coming soon"/g)).toHaveLength(3);
    // The assistive-technology note stays in the DOM but is visually hidden by CSS (no loose visible word on the header row).
    expect(html).toMatch(/data-testid="locale-soon-note">Coming soon/);
    expect(COMING_SOON).toBe("Coming soon");
  });
});
