/** Researcher-facing descriptions of the engines and methods, kept to what the platform actually runs. */
export type EngineInfo = { name: string; summary: string; caveat: string | null };

export const ENGINE_INFO: Record<string, EngineInfo> = {
  pyscf: {
    name: "PySCF",
    summary: "Gaussian-basis package: Hartree–Fock and density-functional SCF.",
    caveat: null,
  },
  xtb: {
    name: "xTB",
    summary: "GFN2-xTB semi-empirical tight-binding: fast and approximate, with built-in parameters (no basis set).",
    caveat: "Its total energies are on a different scale from ab initio energies and must not be compared with them directly.",
  },
  psi4: {
    name: "Psi4",
    summary: "Ab initio package: Hartree–Fock, DFT and conventional MP2 single points.",
    caveat: "Restricted here to neutral closed-shell singlets of H, C and O (charge 0, multiplicity 1), single-point energy only.",
  },
};

const METHODS: Record<string, string> = {
  hf: "Hartree–Fock: mean-field wavefunction without electron correlation.",
  b3lyp: "B3LYP: hybrid density functional.",
  pbe: "PBE: generalized-gradient density functional.",
  mp2: "MP2: second-order Møller–Plesset perturbation theory (adds electron correlation to Hartree–Fock).",
  gfn2: "GFN2-xTB: semi-empirical extended tight-binding.",
};

export function methodDescription(method: string): string {
  return METHODS[method.toLowerCase()] ?? "Method identifier as reported by the engine.";
}

export function methodLabel(method: string): string {
  switch (method.toLowerCase()) {
    case "hf": return "Hartree–Fock (HF)";
    case "mp2": return "MP2";
    case "gfn2": return "GFN2-xTB";
    default: return method.toUpperCase();
  }
}

export const TASK_LABEL: Record<"energy" | "optimization" | "tddft" | "ir" | "raman" | "conformer", string> = {
  energy: "Single-point energy",
  optimization: "Geometry optimization",
  tddft: "UV/Vis excited states (TDDFT)",
  ir: "Infrared spectrum (harmonic)",
  raman: "Raman spectrum (harmonic, Placzek)",
  conformer: "Conformer search (CREST)",
};
