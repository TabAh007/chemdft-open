import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { AI_MAY, AI_MAY_NOT, ALL_ENGINE_CARDS, ENGINE_STATUS_LABEL, FIREWALL_CHAIN, NOT_YET, PROCESS_STEPS, SUPPORTED_BASES, SUPPORTED_METHODS, SUPPORTED_NOW } from "../src/app/_components/home/content";
import { RUN, shortHash } from "../src/app/_components/home/run-record";

const ROOT = resolve(import.meta.dirname, "..");
const HOME_DIR = join(ROOT, "src/app/_components/home");
const registry = readFileSync(resolve(ROOT, "../../services/api/src/chemdft_api/scientific/engines/registry.py"), "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const homepageSources = [...files(HOME_DIR).filter((path) => /\.(tsx?|css)$/.test(path)), join(ROOT, "src/app/[locale]/page.tsx"), join(ROOT, "src/app/landing.css")];
const sourceText = homepageSources.map((path) => readFileSync(path, "utf8")).join("\n");
const css = readFileSync(join(ROOT, "src/app/landing.css"), "utf8");

describe("homepage claims match the code that exists", () => {
  it("lists exactly the PySCF methods and basis sets the engine registry accepts", () => {
    const methods = /PYSCF_METHODS = frozenset\(\{([^}]*)\}\)/.exec(registry)?.[1]?.match(/"([^"]+)"/g)?.map((m) => m.replaceAll('"', "").toUpperCase()).sort();
    const bases = /PYSCF_BASES = frozenset\(\{([^}]*)\}\)/.exec(registry)?.[1]?.match(/"([^"]+)"/g)?.map((m) => m.replaceAll('"', "").toUpperCase()).sort();
    expect([...SUPPORTED_METHODS].map((m) => m.toUpperCase()).sort()).toEqual(methods);
    expect([...SUPPORTED_BASES].map((b) => b.toUpperCase()).sort()).toEqual(bases);
    expect(SUPPORTED_NOW.join(" ")).toMatch(/HF, B3LYP and PBE/);
  });

  it("labels the integrated product engines as running and only the unintegrated ones as planned", () => {
    const byStatus = (status: string) => ALL_ENGINE_CARDS.filter((e) => e.status === status).map((e) => e.name);
    expect(byStatus("available")).toEqual(["PySCF", "geomeTRIC", "xTB (GFN2)", "CREST", "Quantum ESPRESSO", "PySCF periodic", "RDKit", "pymatgen", "cclib"]);
    // Psi4 and DFT-D4 are not configured on this deployment: shown as unavailable, never as available.
    expect(byStatus("unavailable")).toEqual(["Psi4", "DFT-D4", "GPU4PySCF"]);
    // The blocked engines say "Not available" with one factual reason from the registry; no promise, no date.
    expect(ENGINE_STATUS_LABEL.unavailable).toBe("Not available");
    expect(ENGINE_STATUS_LABEL.planned).toBe("Not available yet");
    for (const name of ["Psi4", "DFT-D4", "GPU4PySCF"]) expect(ALL_ENGINE_CARDS.find((e) => e.name === name)?.reason).toMatch(/Not available: /);
    // Psi4 1.11 runs exactly the accepted ENERGY task with the accepted methods and bases.
    expect(registry).toMatch(/"psi4": EngineCapability\(\s*"psi4",\s*frozenset\(\{CalculationTaskType\.ENERGY\}\),\s*frozenset\(\{"hf", "b3lyp", "pbe", "mp2"\}\),\s*frozenset\(\{"sto-3g", "def2-svp"\}\),?\s*\)/);
    const psi4Source = readFileSync(resolve(ROOT, "../../services/api/src/chemdft_api/scientific/engines/psi4.py"), "utf8");
    const pairs = /PAIRS = frozenset\(\s*\{([\s\S]*?)\}\s*\)/.exec(psi4Source)?.[1]?.match(/\("[^"]+", "[^"]+"\)/g) ?? [];
    expect(pairs).toHaveLength(5);
    const psi4 = ALL_ENGINE_CARDS.find((e) => e.name === "Psi4");
    expect(psi4?.reason).toMatch(/five accepted method\/basis pairs/);
    expect(psi4?.reason).toMatch(/neutral singlets only/);
    expect(psi4?.reason).not.toMatch(/optimi|frequenc|thermochem|TDDFT/i);
    // DFT-D4 never claims independent verification of combined totals.
    expect(ALL_ENGINE_CARDS.find((e) => e.name === "DFT-D4")?.reason).toMatch(/not independently verified/);
    expect(registry).toMatch(/"crest": EngineCapability\([\s\S]*?CalculationTaskType\.CONFORMER_SEARCH/);
    expect(registry).toMatch(/"xtb": EngineCapability\([\s\S]*?tasks=frozenset\({\s*CalculationTaskType\.ENERGY,\s*CalculationTaskType\.GEOMETRY_OPTIMIZATION\s*}\)/);
    const planned = byStatus("planned").join(" ");
    for (const name of ["nmrglue", "pyOpenMS", "QCEngine", "QCFractal", "ASE"]) expect(planned).toContain(name);
    for (const name of ["Psi4", "CREST", "DFT-D4", "GPU4PySCF"]) expect(planned).not.toContain(name);
    expect(NOT_YET.join(" ")).not.toMatch(/CREST and Psi4 calculations/);
    expect(SUPPORTED_NOW.join(" ")).not.toMatch(/Psi4/);
    expect(NOT_YET.join(" ")).toMatch(/Psi4 isn't configured on this deployment/);
  });

  it("does not advertise capabilities the product does not have", () => {
    expect(NOT_YET.join(" ")).toMatch(/Molecular dynamics/);
    expect(NOT_YET.join(" ")).toMatch(/Bring-your-own-key.*public collaboration/);
    expect(NOT_YET.join(" ")).not.toMatch(/ORCID/);
    expect(SUPPORTED_NOW.join(" ")).toMatch(/ORCID sign-in for accounts that already linked an ORCID iD in Settings/);
    expect(NOT_YET.join(" ")).toMatch(/Public sign-up and pricing/);
  });

  it("states the result firewall as AI → registry → engine → result → AI interpretation", () => {
    expect(FIREWALL_CHAIN.map((n) => n.id)).toEqual(["ai", "registry", "engine", "result", "explain"]);
    expect(FIREWALL_CHAIN.filter((n) => n.kind === "ai").map((n) => n.id)).toEqual(["ai", "explain"]);
    expect(AI_MAY_NOT.join(" ")).toMatch(/Write an energy, spectrum, orbital/);
    expect(AI_MAY.length).toBeGreaterThan(0);
  });

  it("walks the five stages of a calculation in order", () => {
    expect(PROCESS_STEPS.map((s) => s.label)).toEqual(["Structure", "Prepare", "Calculate", "Verify", "Explore"]);
  });
});

describe("homepage assets and links", () => {
  it("references no restricted NIST spectral asset and no acceptance or frozen project", () => {
    expect(sourceText).not.toMatch(/\bNIST\b/i);
    expect(sourceText).not.toMatch(/acetone/i);
    expect(sourceText).not.toMatch(/acceptance/i);
    expect(sourceText).not.toMatch(/projects\/[0-9a-f-]{8,}/i);
    expect(sourceText).not.toMatch(/f39aefcf|7ae7e41b|ACCEPTANCE_FROZEN|LEGACY_LOCAL/);
    // chromium as an element or as the reference crystal Chromium(III) oxide is fine; the frozen paper project is caught by the id and "acceptance" checks above
    for (const asset of files(join(ROOT, "public"))) expect(asset).not.toMatch(/\bnist\b|nist-|acetone|acceptance/i);
  });

  it("publishes no price and offers no registration route", () => {
    expect(sourceText).not.toMatch(/\$\s?\d[\d,.]*\s*(\/|per\b|a\b|USD|month|mo\b|year)|\b\d+\s?(USD|EUR)\b|\/(month|mo|year)\b|per (month|seat|user)/i);
    expect(sourceText).not.toMatch(/href=[{"`'][^>]*(sign-?up|register|create-account)/i);
    expect(sourceText).not.toMatch(/create (an )?account|get started free|start free/i);
  });

  it("uses GSAP (pinned) for scroll storytelling and no other animation, scroll or UI framework", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    for (const pinned of ["gsap", "motion", "@react-three/fiber", "@react-three/drei", "@react-three/postprocessing", "postprocessing"]) expect(pkg.dependencies[pinned], pinned).toMatch(/^\d/);
    for (const banned of ["lenis", "@studio-freight/lenis", "locomotive-scroll", "@theatre/core", "@theatre/studio", "lottie-web", "@lottiefiles/react-lottie-player", "@mui/material", "@chakra-ui/react", "tailwindcss", "framer-motion", "@gsap/react"]) expect(pkg.dependencies, banned).not.toHaveProperty(banned);
  });

  it("loads GSAP lazily, never from the statically imported part of a homepage component", () => {
    for (const path of files(HOME_DIR).filter((p) => p.endsWith(".tsx") || p.endsWith(".ts"))) expect(readFileSync(path, "utf8"), path).not.toMatch(/^import[^;]*from "gsap(\/[^"]*)?";/m);
    expect(readFileSync(join(HOME_DIR, "gsap.ts"), "utf8")).toContain('import("gsap/ScrollTrigger")');
  });

  it("never intercepts scrolling", () => {
    const motionSource = files(HOME_DIR).filter((p) => /\.(tsx?)$/.test(p)).map((p) => readFileSync(p, "utf8")).join("\n");
    expect(motionSource).not.toMatch(/preventDefault\(\)[^;]*wheel|addEventListener\(["']wheel|ScrollSmoother|scrollTo\(|normalizeScroll|pinSpacing/);
    expect(motionSource).not.toMatch(/pin:\s*true/); // sticky positioning holds the stage; ScrollTrigger only reads progress
    expect(css).not.toMatch(/scroll-snap|overscroll-behavior\s*:\s*none/);
  });
});

describe("the retired hero and its look are gone", () => {
  it("has the approved headline and wording, and none of the retired copy", () => {
    expect(sourceText).toContain("Computational chemistry, without the old workflow.");
    expect(sourceText).not.toMatch(/From molecule to insight/);
    expect(sourceText).not.toMatch(/Launch ChemDFT/);
    expect(sourceText).not.toMatch(/AI-powered/i);
    expect(sourceText).toMatch(/See how it works/);
    expect(sourceText).toMatch(/Open ChemDFT/);
    expect(sourceText).toMatch(/>\s*\{open \? "Open ChemDFT" : "Sign in"\}/);
  });

  it("removed the homepage's own renderer: one rendering architecture", () => {
    for (const gone of ["hero-visual.tsx", "crystal-canvas.tsx", "crystal-static.tsx", "crystal.ts", "workflow-section.tsx", "sections.tsx", "benzene-static.tsx", "molecule-canvas.tsx", "molecule-data.ts"]) expect(existsSync(join(HOME_DIR, gone)), gone).toBe(false);
    const stage = readFileSync(join(HOME_DIR, "stage.tsx"), "utf8");
    expect(stage).toContain('import("../molecular-renderer/MolecularRenderer")');
    expect(sourceText).not.toMatch(/SphereGeometry|InstancedMesh|from "three"/);
  });

  it("has no grid-line or graph-paper background", () => {
    expect(css).not.toMatch(/repeating-linear-gradient/);
    expect(css).not.toMatch(/linear-gradient\([^)]*\b1px\b[^)]*\)[^;{}]*,\s*linear-gradient\(/); // two hairline gradients tiled = a grid
    expect(css).not.toMatch(/background-size:\s*\d+px\s+\d+px/);
  });

  it("uses no glass, glow or neon: no backdrop blur, no coloured shadows", () => {
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/box-shadow:[^;]*(rgba?\(\s*(0|1?\d{0,2}),\s*(1?\d{2}|2[0-4]\d),\s*2[0-5]\d)/);
  });
});

describe("no invented scientific outputs", () => {
  const record = RUN;

  it("the stored run record is internally consistent (energies, electrons, hashes)", () => {
    const r = record.result;
    expect(r.gap_hartree).toBeCloseTo(r.lumo.energy_hartree - r.homo.energy_hartree, 10);
    expect(r.gap_ev).toBeCloseTo(r.lumo.energy_ev - r.homo.energy_ev, 8);
    expect(r.electron_count).toBe(r.alpha_electrons + r.beta_electrons);
    expect(r.homo.index).toBe(r.alpha_electrons); // closed-shell: the HOMO is the last doubly occupied orbital
    expect(r.lumo.index).toBe(r.homo.index + 1);
    expect(r.converged).toBe(true);
    expect(record.engine.name).toBe("PySCF");
    expect(record.method.method).toBe("Restricted Hartree-Fock");
    expect(record.method.basis).toBe("STO-3G");
    expect(record.attempt.state).toBe("SUCCEEDED");
    for (const hash of [record.structure.input_structure_sha256, record.provenance.result_sha256, record.provenance.calculation_input_sha256, record.provenance.coefficient_artifact_sha256, record.engine.environment_sha256]) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(record)).not.toMatch(/f39aefcf|project_id|artifact_id|structure_version_id/); // identifiers are not exported
    expect(shortHash(record.provenance.result_sha256)).toMatch(/^[0-9a-f]{12}…[0-9a-f]{6}$/);
  });

  it("the page's screenshots state only numbers the record has", () => {
    const alt = readFileSync(join(HOME_DIR, "workstation.tsx"), "utf8");
    const r = record.result;
    expect(alt).toContain(`−${Math.abs(r.total_energy_hartree).toFixed(6)}`);
    expect(alt).toContain(`−${Math.abs(r.homo.energy_hartree).toFixed(4)}`);
    expect(alt).toContain(r.lumo.energy_hartree.toFixed(4));
    expect(alt).toContain(r.gap_hartree.toFixed(4));
  });

  it("no scientific quantity is typed into homepage source: energies and orbital values only come from the record", () => {
    const quantity = /[-−+]?\d+\.\d{3,}\s*(Eh|eV|hartree|E_h|kJ|kcal|cm⁻¹|cm-1|Hz|nm)\b/;
    for (const path of files(HOME_DIR).filter((p) => /\.tsx?$/.test(p) && !p.endsWith("workstation.tsx") && !p.endsWith("structures.ts"))) expect(readFileSync(path, "utf8"), path).not.toMatch(quantity);
    const structures = readFileSync(join(HOME_DIR, "structures.ts"), "utf8");
    expect(structures).not.toMatch(/\b(Eh|eV|hartree|band gap|energy)\b/i); // reference structures carry geometry, never results
  });

  it("labels every reference structure as not a ChemDFT calculation", () => {
    const structures = readFileSync(join(HOME_DIR, "structures.ts"), "utf8");
    expect((structures.match(/note: "Reference (geometry|structure) for illustration\. Not a (ChemDFT )?(calculation|calculation result)\.?"|note: CR2O3_STRUCTURE\.provenance\.note/g) ?? []).length).toBe(4);
  });
});
