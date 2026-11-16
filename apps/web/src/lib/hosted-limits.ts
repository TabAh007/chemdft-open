/**
 * Hosted-route limits the researcher must see BEFORE pressing Run (F-008/9/10/20/27). Mirrors the server
 * (services/api config.py aws_* settings and aws_compute.py refusals); the server remains the authority and
 * still refuses on submit. Values: xTB 50 atoms, PySCF optimization 12, orbitals 12, frequencies 6, TDDFT 6,
 * CREST 12 atoms of H/C/O only.
 */
export type HostedLimitInput = {
  task: string;
  engine: "pyscf" | "xtb" | "psi4";
  atomCount: number;
  atomicNumbers: number[];
  periodic?: boolean;
};

const ATOM_LIMITS: Record<string, { pyscf?: number; xtb?: number; label: string }> = {
  GEOMETRY_OPTIMIZATION: { pyscf: 12, xtb: 50, label: "geometry optimization" },
  ORBITAL: { pyscf: 12, label: "molecular-orbital analysis" },
  FREQUENCY: { pyscf: 6, label: "vibrational analysis" },
  TDDFT: { pyscf: 6, label: "TDDFT" },
  ENERGY: { xtb: 50, label: "energy" },
  PERIODIC_ENERGY: { pyscf: 20, label: "periodic DFT energy" },
};
export const CREST_HOSTED_MAX_ATOMS = 12;
export const PERIODIC_HOSTED_MAX_ATOMS = 20;
const CREST_ELEMENTS = new Set([1, 6, 8]);

export type HostedLimitView = { limit: number | null; refusal: string | null; note: string };

export function hostedLimit({ task, engine, atomCount, atomicNumbers, periodic }: HostedLimitInput): HostedLimitView {
  if (periodic || task === "PERIODIC_ENERGY") {
    const refusal = atomCount > PERIODIC_HOSTED_MAX_ATOMS
      ? `Hosted periodic DFT is limited to ${PERIODIC_HOSTED_MAX_ATOMS} atoms in the unit cell; this structure has ${atomCount}.`
      : null;
    return {
      limit: PERIODIC_HOSTED_MAX_ATOMS,
      refusal,
      note: `Hosted limit: ${PERIODIC_HOSTED_MAX_ATOMS} atoms in the unit cell (this cell: ${atomCount}). Allowed PySCF k-mesh: Gamma-only (bigger meshes: Quantum ESPRESSO).`,
    };
  }
  if (task === "CONFORMER_SEARCH") {
    const bad = atomicNumbers.some((z) => !CREST_ELEMENTS.has(z));
    const refusal = bad
      ? "Hosted conformer search supports hydrogen, carbon and oxygen only. This structure contains other elements (for example nitrogen); that is not verified yet."
      : atomCount > CREST_HOSTED_MAX_ATOMS ? `Hosted conformer search is limited to ${CREST_HOSTED_MAX_ATOMS} atoms; this structure has ${atomCount}.` : null;
    return { limit: CREST_HOSTED_MAX_ATOMS, refusal, note: `Hosted limit: ${CREST_HOSTED_MAX_ATOMS} atoms, H/C/O only.` };
  }
  const entry = ATOM_LIMITS[task];
  const limit = entry?.[engine === "xtb" ? "xtb" : "pyscf"] ?? null;
  if (limit === null || engine === "psi4") return { limit: null, refusal: null, note: "" };
  const refusal = atomCount > limit ? `Hosted ${engine === "xtb" ? "xTB " : ""}${entry!.label} is limited to ${limit} atoms; this structure has ${atomCount}.` : null;
  return { limit, refusal, note: `Hosted limit for ${entry!.label}: ${limit} atoms (this structure: ${atomCount}).` };
}

/**
 * PySCF single points have no atom limit. Measured once on the hosted worker (m7i-flex.large, 1 thread): a 39-atom
 * B3LYP/def2-SVP single point converged in 11 min 36 s (12 SCF iterations), but the app lost the result at the
 * collection step on both attempts (cause not found), so such a job is not reliable yet.
 */
export function pyscfEnergyTimeNote(atomCount: number, basis: string): string | null {
  if (atomCount < 20 || basis === "sto-3g") return null;
  return `Heavy for ${atomCount} atoms with ${basis.toUpperCase()}: one 39-atom B3LYP/def2-SVP run took about 12 minutes on the hosted worker (the limit is 30 minutes), and its result was then lost by the app on both attempts, so it did not publish. Until that is fixed, use STO-3G or xTB for molecules this size (confidence: low, one measurement).`;
}
