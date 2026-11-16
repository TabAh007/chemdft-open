import type { Locale } from "@chemdft/i18n";

export const HELP_MESSAGES = {
  "structure.charge": {
    title: "Charge",
    summary:
      "Net electric charge sets the electron count for a molecular calculation. It is separate from spin multiplicity.",
  },
  "structure.multiplicity": {
    title: "Spin multiplicity",
    summary:
      "Multiplicity is 2S + 1, where S is the total spin quantum number. A singlet has multiplicity 1.",
  },
  "calculation.method": {
    title: "Electronic-structure method",
    summary:
      "The method specifies the electronic-structure approximation. A method name is not a guarantee of suitability or accuracy.",
  },
  "calculation.basis": {
    title: "Basis sets",
    summary:
      "A basis represents the functions used to describe molecular orbitals. Changing it changes the calculation model.",
  },
  "calculation.optimization": {
    title: "Geometry optimization",
    summary:
      "Optimization changes atomic positions under a selected method and basis. A converged result does not, by itself, prove the global minimum.",
  },
  "calculation.frequency": {
    title: "Frequency calculations",
    summary:
      "A harmonic frequency calculation describes local vibrational modes from the molecular Hessian. Frequencies and intensities are distinct quantities.",
  },
  "spectra.ir": {
    title: "Infrared spectra",
    summary:
      "ChemDFT separates a calculated harmonic IR spectrum from an imported experimental measurement. They have different source classes.",
  },
  "spectra.raman": {
    title: "Raman spectra",
    summary:
      "Raman activities belong to the supported calculated Raman result. They are not a measured Raman spectrum or an automatic experimental assignment.",
  },
  "spectra.uv_vis": {
    title: "UV/Vis spectra",
    summary:
      "Electronic excitation energies and oscillator strengths are distinct from a HOMO–LUMO orbital gap. The gap is not an excited-state calculation.",
  },
  "spectra.experimental": {
    title: "Experimental spectra and association",
    summary:
      "Confirm technique and units before importing a measurement. Association explicitly connects it to a structure; it is not inferred from similar-looking peaks.",
  },
  "thermochemistry.frequency_requirement": {
    title: "Thermochemistry prerequisites",
    summary:
      "ChemDFT thermochemistry reuses eligible recorded frequency and electronic-energy data with explicit temperature and pressure. It does not rerun electronic structure on opening the panel.",
  },
  "electronic.homo_lumo": {
    title: "HOMO / LUMO",
    summary:
      "HOMO and LUMO are frontier molecular orbitals identified from the result’s energies and occupations. Their energy gap is not an optical excitation energy.",
  },
  "crystal.unit_cell": {
    title: "Unit cells",
    summary:
      "Cell vectors and the atoms expressed in that cell define the periodic structural reference. Cell angles need not be right angles.",
  },
  "crystal.supercell": {
    title: "Supercell viewing",
    summary:
      "A supercell view repeats the reference cell along selected lattice directions. Replication changes the view, not the stored atomic structure.",
  },
  "provenance.authority": {
    title: "Scientific provenance",
    summary:
      "Every scientific record has a source and validation context. Imported evidence, reference structures and calculated engine results are different classes.",
  },
  "firewall.ai_vs_calculation": {
    title: "AI and scientific authority",
    summary:
      "AI explanation is not an authoritative scientific calculation. Onboarding and contextual help require no AI provider.",
  },
} as const;

export const HELP_UI = {
  help: "Help",
  close: "Close help",
  more: "Learn more",
  title: "Learn",
  description:
    "Short explanations of ChemDFT workflows, prerequisites and scientific authority.",
  meaning: "What it means",
  product: "In ChemDFT",
  prerequisite: "What is required",
  use: "Choose a starting path",
  return: "Return to workspace",
  sources: "Definition source",
  examples: "Examples",
  welcome: "Choose a starting path",
  signIn: "Sign in",
  structure: "Structures",
  calculation: "Calculations",
  spectra: "Experimental and calculated spectra",
  integrity: "Sources and authority",
  index: "All topics",
} as const;
export type HelpUiKey = keyof typeof HELP_UI;
export function helpUi(_locale: Locale, key: HelpUiKey): string {
  return HELP_UI[key];
}
