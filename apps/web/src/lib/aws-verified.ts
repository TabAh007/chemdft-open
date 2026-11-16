/**
 * What has actually been EXECUTED on the hosted AWS compute route (PySCF energy and geometry optimization).
 * Single source: services/api/src/chemdft_api/aws_compute.py AWS_VERIFIED_ENERGY_PAIRS.
 * tests/aws-verified.test.ts compares this list with tests/fixtures/aws-verified-pairs.json, and the Python
 * test compares the same fixture with the server constant, so the two cannot drift apart silently.
 * Allowed-by-code is wider than this list: copy must claim only these pairs.
 */
export const AWS_VERIFIED_ENERGY_PAIRS = [
  { method: "hf", basis: "sto-3g", molecule: "H2" },
  { method: "b3lyp", basis: "def2-svp", molecule: "water" },
  { method: "hf", basis: "sto-3g", molecule: "water" },
  { method: "pbe", basis: "6-31g", molecule: "water" },
] as const;

/** Optimization executed on AWS (job ad4a9b01, 2026-10-27). Mirrors aws_compute.py AWS_VERIFIED_OPTIMIZATION_PAIRS. */
export const AWS_VERIFIED_OPTIMIZATION_PAIRS = [{ method: "b3lyp", basis: "def2-svp", molecule: "water" }] as const;

/** Hosted geometry optimization is accepted for at most this many atoms; only the pairs above were executed on AWS. */
export const AWS_OPTIMIZATION_MAX_ATOMS = 12;

/** Frequency analysis executed on AWS (job 0f472396, 2026-10-27). Mirrors aws_compute.py AWS_VERIFIED_FREQUENCY_PAIRS. */
export const AWS_VERIFIED_FREQUENCY_PAIRS = [{ method: "b3lyp", basis: "def2-svp", molecule: "water" }] as const;

/** Thermochemistry executed on AWS (job dbe97dd6, 2026-10-27). Mirrors aws_compute.py AWS_VERIFIED_THERMOCHEMISTRY_PAIRS. */
export const AWS_VERIFIED_THERMOCHEMISTRY_PAIRS = [{ method: "b3lyp", basis: "def2-svp", molecule: "water" }] as const;

/** PySCF TDDFT executed on AWS (job be84c239, 2026-11-02). Mirrors aws_compute.py AWS_VERIFIED_TDDFT_PAIRS. */
export const AWS_VERIFIED_TDDFT_PAIRS = [{ method: "b3lyp", basis: "def2-svp", molecule: "water" }] as const;

/** xTB GFN2 energy executed on AWS (job 69d9052f, 2026-11-02). Mirrors aws_compute.py AWS_VERIFIED_XTB_ENERGY_PAIRS. */
export const AWS_VERIFIED_XTB_ENERGY_PAIRS = [{ method: "gfn2", basis: "builtin", molecule: "water" }] as const;

/** xTB GFN2 optimization executed on AWS (job 8cf0ae40, 2026-11-03). Mirrors aws_compute.py AWS_VERIFIED_XTB_OPTIMIZATION_PAIRS. */
export const AWS_VERIFIED_XTB_OPTIMIZATION_PAIRS = [{ method: "gfn2", basis: "builtin", molecule: "water" }] as const;

/** Hosted frequency analysis is accepted for at most this many atoms; only the pair above was executed on AWS. */
export const AWS_FREQUENCY_MAX_ATOMS = 6;

const METHOD_LABEL: Record<string, string> = { hf: "HF", b3lyp: "B3LYP", pbe: "PBE", gfn2: "GFN2-xTB" };
const BASIS_LABEL: Record<string, string> = { "sto-3g": "STO-3G", "6-31g": "6-31G", "def2-svp": "def2-SVP", "def2-svpd": "def2-SVPD" };

/** "B3LYP/def2-SVP (water)" */
export function verifiedOptimizationPairsText(): string {
  return AWS_VERIFIED_OPTIMIZATION_PAIRS.map((p) => `${METHOD_LABEL[p.method] ?? p.method}/${BASIS_LABEL[p.basis] ?? p.basis} (${p.molecule})`).join(", ");
}

/** "B3LYP/def2-SVP (water)" */
export function verifiedFrequencyPairsText(): string {
  return AWS_VERIFIED_FREQUENCY_PAIRS.map((p) => `${METHOD_LABEL[p.method] ?? p.method}/${BASIS_LABEL[p.basis] ?? p.basis} (${p.molecule})`).join(", ");
}

/** "B3LYP/def2-SVP (water)" */
export function verifiedThermochemistryPairsText(): string {
  return AWS_VERIFIED_THERMOCHEMISTRY_PAIRS.map((p) => `${METHOD_LABEL[p.method] ?? p.method}/${BASIS_LABEL[p.basis] ?? p.basis} (${p.molecule})`).join(", ");
}

/** "HF/STO-3G (H2) and B3LYP/def2-SVP (water)" */
export function verifiedEnergyPairsText(): string {
  const items = AWS_VERIFIED_ENERGY_PAIRS.map((p) => `${METHOD_LABEL[p.method] ?? p.method}/${BASIS_LABEL[p.basis] ?? p.basis} (${p.molecule})`);
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? "");
}

/** "B3LYP/def2-SVP (water)" */
export function verifiedTddftPairsText(): string {
  return AWS_VERIFIED_TDDFT_PAIRS.map((p) => `${METHOD_LABEL[p.method] ?? p.method}/${BASIS_LABEL[p.basis] ?? p.basis} (${p.molecule})`).join(", ");
}

/** "GFN2-xTB (water)": GFN2 has a built-in parameter set, so no basis is shown. */
export function verifiedXtbEnergyPairsText(): string {
  return AWS_VERIFIED_XTB_ENERGY_PAIRS.map((p) => `${METHOD_LABEL[p.method] ?? p.method} (${p.molecule})`).join(", ");
}

/** "GFN2-xTB (water)" */
export function verifiedXtbOptimizationPairsText(): string {
  return AWS_VERIFIED_XTB_OPTIMIZATION_PAIRS.map((p) => `${METHOD_LABEL[p.method] ?? p.method} (${p.molecule})`).join(", ");
}
