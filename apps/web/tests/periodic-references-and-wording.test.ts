import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ENGINE_REFERENCES } from "../src/content/engine-citations";
import { QE_LIBRARY_REFERENCE, engineAttribution, methodsParagraph, referencesBibTeX, referencesPlain, referencesRis, type CitationFacts } from "../src/lib/calculation-citation";
import ELEMENTS from "../src/content/qe-sssp-elements.json";
import { ENGINE_HELP_QE, KS_GAP_LABEL, KS_GAP_NOTE, LOCAL_SPIN_LABEL, LOCAL_SPIN_TOOLTIP, QE_AFM_LOCAL_MINIMUM_NOTE, QE_BANDS_CAPTION, QE_DOS_CAPTION, QE_LOCAL_SPIN_LABEL, U_DEFAULTS_NOTE } from "../src/lib/periodic-wording";

// Crossref-verified values (release 0.0.42). Changing any of these without re-verifying against Crossref must fail.
const PINNED: Record<string, { title: string; journal: string; volume: string; pages: string; year: number; doi: string }> = {
  perdew1996pbe: { title: "Generalized Gradient Approximation Made Simple", journal: "Physical Review Letters", volume: "77", pages: "3865-3868", year: 1996, doi: "10.1103/PhysRevLett.77.3865" },
  goedecker1996gth: { title: "Separable dual-space Gaussian pseudopotentials", journal: "Physical Review B", volume: "54", pages: "1703-1710", year: 1996, doi: "10.1103/PhysRevB.54.1703" },
  hartwigsen1998gth: { title: "Relativistic separable dual-space Gaussian pseudopotentials from H to Rn", journal: "Physical Review B", volume: "58", pages: "3641-3662", year: 1998, doi: "10.1103/PhysRevB.58.3641" },
  krack2005gth: { title: "Pseudopotentials for H to Kr optimized for gradient-corrected exchange-correlation functionals", journal: "Theoretical Chemistry Accounts", volume: "114", pages: "145-152", year: 2005, doi: "10.1007/s00214-005-0655-y" },
  vandevondele2007molopt: { title: "Gaussian basis sets for accurate calculations on molecular systems in gas and condensed phases", journal: "The Journal of Chemical Physics", volume: "127", pages: "114105", year: 2007, doi: "10.1063/1.2770708" },
  dudarev1998plusu: { title: "Electron-energy-loss spectra and the structural stability of nickel oxide: An LSDA+U study", journal: "Physical Review B", volume: "57", pages: "1505-1509", year: 1998, doi: "10.1103/PhysRevB.57.1505" },
  jain2011materials: { title: "Formation enthalpies by mixing GGA and GGA+U calculations", journal: "Physical Review B", volume: "84", pages: "045115", year: 2011, doi: "10.1103/PhysRevB.84.045115" },
};

const facts = (periodic: CitationFacts["periodic"]): CitationFacts => ({
  calculationId: "c1", jobId: null, year: 2026, task: "PERIODIC_ENERGY", method: "PBE+U", basis: "gth-dzvp-molopt-sr", charge: 0, multiplicity: 1,
  structure: { versionId: "v1", revision: 1, inputSha256: "a".repeat(64) },
  engine: { name: "pyscf", version: "2.14.0", adapterVersion: "1.0.0", backend: "AWS", hardware: null, environmentDigest: null, libraries: [] },
  platform: null, firewall: null, appVersion: "0.0.42", softwareDoi: null, periodic,
} as unknown as CitationFacts);

describe("periodic references are pinned to Crossref values", () => {
  for (const [key, expected] of Object.entries(PINNED)) {
    it(key, () => {
      const ref = ENGINE_REFERENCES[key]!;
      expect(ref).toBeDefined();
      expect({ title: ref.title, journal: ref.journal, volume: ref.volume, pages: ref.pages, year: ref.year, doi: ref.doi }).toEqual(expected);
    });
  }

  it("the MOLOPT authors are VandeVondele and Hutter", () => {
    expect(ENGINE_REFERENCES.vandevondele2007molopt!.authors).toEqual([["VandeVondele", "Joost"], ["Hutter", "Jürg"]]);
  });

  it("BibTeX, RIS and plain/APA exports show the corrected MOLOPT title, and the Methods text carries the honest wording", () => {
    const f = facts({ kMesh: "2x2x2", uEffectiveEv: { Cr: 3.7 }, hasPlusU: true, usedDefaultU: true, magneticOrder: "antiferromagnetic" });
    const attribution = engineAttribution(f);
    const title = PINNED.vandevondele2007molopt!.title;
    expect(referencesBibTeX(attribution)).toContain(`title = {${title}}`);
    expect(referencesRis(attribution)).toContain(`TI  - ${title}`);
    expect(referencesPlain(attribution)).toContain(`${title}. The Journal of Chemical Physics 2007, 127, 114105.`);
    expect(referencesPlain(attribution)).not.toContain("molecular and periodic calculations");
    const methods = methodsParagraph(f);
    expect(methods).toContain(U_DEFAULTS_NOTE);
    expect(methods).toContain("Kohn-Sham gap from the converged SCF at the k-points used");
    expect(methods).toContain("Local spin population (Mulliken-type):");
    expect(methods.toLowerCase()).not.toContain("magnetic moment");
  });

  it("a molecular calculation gets no periodic wording", () => {
    const methods = methodsParagraph(facts(null));
    expect(methods).not.toContain("Kohn-Sham");
    expect(methods).not.toContain(U_DEFAULTS_NOTE);
  });
});

describe("periodic wording is identical in the AI app guide", () => {
  it("states the same three facts as the UI constants", () => {
    const guide = readFileSync(resolve(__dirname, "../../../services/api/src/chemdft_api/ai/app_guide.py"), "utf8");
    expect(U_DEFAULTS_NOTE).toContain("calibrated for formation energies with PAW potentials, not fitted to this basis or to band gaps");
    expect(guide).toContain("calibrated for formation energies with PAW potentials, not fitted to this basis or to band gaps");
    expect(guide).toContain("test the sensitivity by changing U");
    expect(guide).toContain("Kohn-Sham gap from the converged SCF at the k-points used");
    expect(guide).toContain("local spin population (Mulliken-type)");
    expect(guide).toContain("basis-dependent projection of the spin density onto atoms");
    expect(guide).toContain("not directly comparable with an experimental magnetisation or neutron moment");
    expect(LOCAL_SPIN_TOOLTIP).toContain("not directly comparable with an experimental magnetisation or neutron moment");
    expect(LOCAL_SPIN_LABEL).toBe("Local spin population (Mulliken-type)");
    expect(KS_GAP_LABEL).toContain("Kohn-Sham gap");
    expect(KS_GAP_NOTE).toContain("not an optical gap");
  });
});


// ---- Quantum ESPRESSO (release 0.0.43). Every value below was read from the Crossref / DataCite record on 2026-11-12. ----
const QE_PINNED: Record<string, { title: string; journal: string; volume: string; pages: string; year: number; doi: string }> = {
  giannozzi2017qe: { title: "Advanced capabilities for materials modelling with Quantum ESPRESSO", journal: "Journal of Physics: Condensed Matter", volume: "29", pages: "465901", year: 2017, doi: "10.1088/1361-648X/aa8f79" },
  giannozzi2009qe: { title: "QUANTUM ESPRESSO: a modular and open-source software project for quantum simulations of materials", journal: "Journal of Physics: Condensed Matter", volume: "21", pages: "395502", year: 2009, doi: "10.1088/0953-8984/21/39/395502" },
  giannozzi2020qe: { title: "Quantum ESPRESSO toward the exascale", journal: "The Journal of Chemical Physics", volume: "152", pages: "154105", year: 2020, doi: "10.1063/5.0005082" },
  timrov2020orthoatomic: { title: "Pulay forces in density-functional theory with extended Hubbard functionals: From nonorthogonalized to orthogonalized manifolds", journal: "Physical Review B", volume: "102", pages: "235159", year: 2020, doi: "10.1103/PhysRevB.102.235159" },
  lowdin1950orthogonalization: { title: "On the Non-Orthogonality Problem Connected with the Use of Atomic Wave Functions in the Theory of Molecules and Crystals", journal: "The Journal of Chemical Physics", volume: "18", pages: "365-375", year: 1950, doi: "10.1063/1.1747632" },
  prandini2018sssp: { title: "Precision and efficiency in solid-state pseudopotential calculations", journal: "npj Computational Materials", volume: "4", pages: "72", year: 2018, doi: "10.1038/s41524-018-0127-2" },
  garrity2014gbrv: { title: "Pseudopotentials for high-throughput DFT calculations", journal: "Computational Materials Science", volume: "81", pages: "446-452", year: 2014, doi: "10.1016/j.commatsci.2013.08.053" },
  dalcorso2014pslibrary: { title: "Pseudopotentials periodic table: From H to Pu", journal: "Computational Materials Science", volume: "95", pages: "337-350", year: 2014, doi: "10.1016/j.commatsci.2014.07.043" },
  vansetten2018pseudodojo: { title: "The PseudoDojo: Training and grading a 85 element optimized norm-conserving pseudopotential table", journal: "Computer Physics Communications", volume: "226", pages: "39-54", year: 2018, doi: "10.1016/j.cpc.2018.01.012" },
  schlipf2015sg15: { title: "Optimization algorithm for the generation of ONCV pseudopotentials", journal: "Computer Physics Communications", volume: "196", pages: "36-44", year: 2015, doi: "10.1016/j.cpc.2015.05.011" },
  shojaei2023spms: { title: "Soft and transferable pseudopotentials from multi-objective optimization", journal: "Computer Physics Communications", volume: "283", pages: "108594", year: 2023, doi: "10.1016/j.cpc.2022.108594" },
  jollet2014jth: { title: "Generation of Projector Augmented-Wave atomic data: A 71 element validated table in the XML format", journal: "Computer Physics Communications", volume: "185", pages: "1246-1254", year: 2014, doi: "10.1016/j.cpc.2013.12.023" },
  topsakal2014tw14: { title: "Accurate projected augmented wave (PAW) datasets for rare-earth elements (RE=La–Lu)", journal: "Computational Materials Science", volume: "95", pages: "263-270", year: 2014, doi: "10.1016/j.commatsci.2014.07.030" },
};

describe("Quantum ESPRESSO references are pinned to Crossref values", () => {
  for (const [key, expected] of Object.entries(QE_PINNED)) {
    it(key, () => {
      const ref = ENGINE_REFERENCES[key]!;
      expect(ref).toBeDefined();
      expect({ title: ref.title, journal: ref.journal, volume: ref.volume, pages: ref.pages, year: ref.year, doi: ref.doi }).toEqual(expected);
    });
  }
  it("the SSSP library record and the pslibrary 0.x preprint carry their DataCite DOIs", () => {
    expect(ENGINE_REFERENCES.prandini2023sssplibrary!.doi).toBe("10.24435/materialscloud:f3-ym");
    expect(ENGINE_REFERENCES.prandini2023sssplibrary!.kind).toBe("dataset");
    expect(ENGINE_REFERENCES.kucukbenli2014pslibrary!.doi).toBe("10.48550/arXiv.1404.3015");
    expect(ENGINE_REFERENCES.kucukbenli2014pslibrary!.kind).toBe("preprint");
  });
});

const qeFacts = (periodic: NonNullable<CitationFacts["periodic"]>): CitationFacts => ({
  ...facts(periodic),
  engine: { name: "qe", version: "7.6", adapterVersion: "1.0.0", backend: "AWS", hardware: null, environmentDigest: null, libraries: [] },
});

describe("every Quantum ESPRESSO periodic task cites what it must", () => {
  it("QE, PBE, SSSP library + Prandini and the original library of each pseudopotential used (Cr: GBRV, O: pslibrary 0.x)", () => {
    const keys = engineAttribution(qeFacts({ kMesh: "3x3x3", uEffectiveEv: null, hasPlusU: false, usedDefaultU: false, magneticOrder: "none", qe: { libraries: ["gbrv", "pslibrary-0"], hasLocalMoments: false } })).references.map((r) => r.key);
    expect(keys).toEqual(["giannozzi2017qe", "giannozzi2009qe", "giannozzi2020qe", "perdew1996pbe", "prandini2018sssp", "prandini2023sssplibrary", "garrity2014gbrv", "kucukbenli2014pslibrary"]);
    expect(keys).not.toContain("dudarev1998plusu");
    expect(keys.some((k) => k.includes("gth") || k.includes("molopt") || k.includes("sun20"))).toBe(false);
  });
  it("+U adds Dudarev and the ortho-atomic reference, a default U adds Jain, local moments add Lowdin", () => {
    const keys = engineAttribution(qeFacts({ kMesh: "3x3x3", uEffectiveEv: { Cr: 3.7 }, hasPlusU: true, usedDefaultU: true, magneticOrder: "antiferromagnetic", qe: { libraries: ["gbrv", "pslibrary-0"], hasLocalMoments: true } })).references.map((r) => r.key);
    for (const key of ["dudarev1998plusu", "timrov2020orthoatomic", "jain2011materials", "lowdin1950orthogonalization", "perdew1996pbe"]) expect(keys).toContain(key);
    const explicit = engineAttribution(qeFacts({ kMesh: "2x2x2", uEffectiveEv: { Cr: 2.0 }, hasPlusU: true, usedDefaultU: false, magneticOrder: "antiferromagnetic", qe: { libraries: ["gbrv"], hasLocalMoments: true } })).references.map((r) => r.key);
    expect(explicit).not.toContain("jain2011materials");
  });
  it("a missing reference fails: every library the SSSP table can produce maps to a pinned reference, and the exports print them", () => {
    const used = new Set(Object.values(ELEMENTS.elements).map((e) => e.library));
    expect([...used].sort()).toEqual(Object.keys(QE_LIBRARY_REFERENCE).sort());
    for (const key of Object.values(QE_LIBRARY_REFERENCE)) expect(ENGINE_REFERENCES[key]).toBeDefined();
    const attribution = engineAttribution(qeFacts({ kMesh: "1x1x1", uEffectiveEv: null, hasPlusU: false, magneticOrder: "none", qe: { libraries: [...used], hasLocalMoments: false } }));
    const bib = referencesBibTeX(attribution);
    const plain = referencesPlain(attribution);
    const ris = referencesRis(attribution);
    for (const ref of attribution.references) {
      expect(bib).toContain(ref.doi);
      expect(plain).toContain(`https://doi.org/${ref.doi}`);
      expect(ris).toContain(`DO  - ${ref.doi}`);
    }
    expect(plain).toContain("10.24435/materialscloud:f3-ym");
  });
  it("the Methods text names the engine-specific wording and not the PySCF one", () => {
    const methods = methodsParagraph(qeFacts({ kMesh: "3x3x3", uEffectiveEv: { Cr: 3.7 }, hasPlusU: true, usedDefaultU: true, magneticOrder: "antiferromagnetic", qe: { libraries: ["gbrv"], hasLocalMoments: true } }));
    expect(methods).toContain("SSSP PBE Efficiency v2.0");
    expect(methods).toContain(QE_LOCAL_SPIN_LABEL);
    expect(methods).not.toContain("Mulliken-type):");
  });
});

describe("Quantum ESPRESSO wording is bounded and identical in the AI app guide", () => {
  it("says what is and is not offered", () => {
    const guide = readFileSync(resolve(__dirname, "../../../services/api/src/chemdft_api/ai/app_guide.py"), "utf8");
    for (const needle of ["Quantum ESPRESSO", "atom relaxation with the cell fixed", "NOT offered: cell relaxation, stress or pressure, phonons, hybrid functionals, noncollinear or spin-orbit, molecular dynamics", "local minima that depend on U and on the pseudopotentials", "Gaps come from eigenvalues, never from a DOS curve"]) {
      expect(guide).toContain(needle);
    }
    expect(QE_AFM_LOCAL_MINIMUM_NOTE).toContain("local minima");
    expect(ENGINE_HELP_QE).toContain("SSSP PBE Efficiency v2.0");
    expect(QE_DOS_CAPTION).toContain("relative to the Fermi level");
    expect(QE_BANDS_CAPTION).toContain("not the global gap");
  });
});
