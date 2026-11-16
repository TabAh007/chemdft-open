/**
 * Quantum ESPRESSO periodic DFT (release 0.0.43): constants, element support, hosted limits and the rough time estimate.
 * Mirrors services/api/src/chemdft_api/scientific/qe_periodic/qe_limits.py; tests/fixtures/contracts/qe_limits_parity.json is the
 * shared golden record that both sides must reproduce. The server stays the authority and refuses again on submit.
 */
import ELEMENTS from "../content/qe-sssp-elements.json";

export const QE_ENGINE_ID = "qe";
export const PYSCF_ENGINE_ID = "pyscf";
export const QE_BASIS_ID = "pw-sssp-pbe-eff-v2";
export const QE_BASIS_DISPLAY = "Plane waves, SSSP PBE Efficiency v2.0";
export const QE_LIBRARY_NAME = ELEMENTS.library;
export const QE_LIBRARY_DOI = ELEMENTS.doi;
export const QE_SCF_MESHES = ["1x1x1", "2x2x2", "3x3x3", "4x4x4"] as const;
export type QeScfMesh = (typeof QE_SCF_MESHES)[number];

export const QE_LIMITS = {
  maxAtoms: 20,
  maxScfK: 4,
  maxDosK: 6,
  maxBandPoints: 100,
  relaxMaxSteps: 30,
  totalSeconds: 3600,
  maxMemoryMb: 6000,
} as const;

/** Points the server generates for the band path are not known before submit; this is the planning figure used for the estimate. */
export const QE_BAND_POINTS_PLANNING = 60;

export function meshTuple(mesh: string): [number, number, number] {
  const n = Number(mesh.split("x")[0]);
  return [n, n, n];
}

type ElementRow = { ecutwfc: number; ecutrho: number; library: string; hubbard3d: boolean };
const TABLE = ELEMENTS.elements as Record<string, ElementRow>;

export function qeElementSupport(symbols: readonly string[]): { usable: boolean; offending: string[] } {
  const offending = [...new Set(symbols.filter((s) => !(s in TABLE)))].sort();
  return { usable: offending.length === 0, offending };
}

export function qeCutoffs(symbols: readonly string[]): { ecutwfc: number; ecutrho: number } | null {
  const rows = symbols.map((s) => TABLE[s]).filter((r): r is ElementRow => Boolean(r));
  if (rows.length === 0) return null;
  return { ecutwfc: Math.max(...rows.map((r) => r.ecutwfc)), ecutrho: Math.max(...rows.map((r) => r.ecutrho)) };
}

export function qeLibraries(symbols: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const s of symbols) if (TABLE[s]) result[s] = TABLE[s]!.library;
  return result;
}

const REFERENCE_ATOMS = 10;
const REFERENCE_ECUTWFC = 45;
const irreducibleUpperBound = (mesh: readonly number[]) => Math.max(1, Math.ceil((mesh[0]! * mesh[1]! * mesh[2]!) / 2));
const scale = (atoms: number, ecutwfc: number) => (atoms / REFERENCE_ATOMS) ** 3 * (ecutwfc / REFERENCE_ECUTWFC) ** 1.5;
const round1 = (v: number) => Math.round(v * 10) / 10;

export type QeEstimateInput = {
  atoms: number;
  ecutwfc: number;
  scfMesh: readonly number[];
  nspin: 1 | 2;
  relax: boolean;
  dos: boolean;
  dosMesh: readonly number[];
  bands: boolean;
  bandPoints: number;
};

export function qeEstimateSeconds(input: QeEstimateInput): { total: number; stages: Record<string, number> } {
  const s = scale(input.atoms, input.ecutwfc);
  const spin = input.nspin === 2 ? 1 : 0.5;
  const scf = (48.5 + 3.46 * irreducibleUpperBound(input.scfMesh)) * s * spin;
  const stages: Record<string, number> = { scf: input.relax ? 0 : scf, projwfc_lowdin: 5 * s };
  if (input.relax) stages.relax = scf * 0.8 * 7;
  if (input.dos) stages.nscf_dos = ((211 / 108) * irreducibleUpperBound(input.dosMesh) + 14) * s * spin * 0.7;
  if (input.bands) stages.bands = ((327 / 49) * input.bandPoints + 98 * (input.nspin === 2 ? 2 : 1)) * s * spin * 0.7;
  const total = Object.values(stages).reduce((a, b) => a + b, 0);
  return { total: round1(total), stages: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, round1(v)])) };
}

export function qeEstimateMemoryMb(input: { atoms: number; ecutwfc: number; bandPoints: number; bands: boolean; dos: boolean }): number {
  const ratio = input.atoms / REFERENCE_ATOMS;
  const cut = (input.ecutwfc / REFERENCE_ECUTWFC) ** 1.5;
  let peak = 350 * ratio ** 2 * cut;
  if (input.dos) peak = Math.max(peak, 500 * ratio ** 2);
  if (input.bands) peak = Math.max(peak, 1100 * ratio ** 2 * cut * (Math.max(input.bandPoints, 1) / 49));
  return round1(peak);
}

export function humanDuration(seconds: number): string {
  if (seconds < 90) return `about ${Math.round(seconds)} s`;
  if (seconds < 5400) return `about ${Math.round(seconds / 60)} min`;
  return `about ${(seconds / 3600).toFixed(1)} h`;
}

export function qeRefusal(input: QeEstimateInput & { relaxMaxSteps?: number }): string | null {
  if (input.atoms > QE_LIMITS.maxAtoms) {
    return `Hosted Quantum ESPRESSO periodic DFT is limited to ${QE_LIMITS.maxAtoms} atoms in the cell; this structure has ${input.atoms}.`;
  }
  const mesh = input.scfMesh;
  if (!QE_SCF_MESHES.includes(`${mesh[0]}x${mesh[1]}x${mesh[2]}` as QeScfMesh) || Math.max(...mesh) > QE_LIMITS.maxScfK) {
    return "The SCF k-point mesh for Quantum ESPRESSO must be Gamma, 2x2x2, 3x3x3 or 4x4x4.";
  }
  if (input.dos && (Math.min(...input.dosMesh) < 1 || Math.max(...input.dosMesh) > QE_LIMITS.maxDosK)) {
    return `The DOS k-point mesh is limited to ${QE_LIMITS.maxDosK}x${QE_LIMITS.maxDosK}x${QE_LIMITS.maxDosK}.`;
  }
  if (input.bands && !(input.bandPoints >= 2 && input.bandPoints <= QE_LIMITS.maxBandPoints)) {
    return `The band path is limited to ${QE_LIMITS.maxBandPoints} k-points in total.`;
  }
  if (input.relax && !((input.relaxMaxSteps ?? QE_LIMITS.relaxMaxSteps) >= 1 && (input.relaxMaxSteps ?? QE_LIMITS.relaxMaxSteps) <= QE_LIMITS.relaxMaxSteps)) {
    return `Relaxation is limited to ${QE_LIMITS.relaxMaxSteps} ionic steps.`;
  }
  const memory = qeEstimateMemoryMb(input);
  if (memory > QE_LIMITS.maxMemoryMb) {
    return `Estimated memory ${(memory / 1000).toFixed(1)} GB exceeds the hosted limit of ${(QE_LIMITS.maxMemoryMb / 1000).toFixed(1)} GB; use fewer atoms, fewer band k-points or fewer stages.`;
  }
  const total = qeEstimateSeconds(input).total;
  if (total > QE_LIMITS.totalSeconds) {
    return `The rough time estimate (${humanDuration(total)}) is above the whole-job cap of ${humanDuration(QE_LIMITS.totalSeconds)}; reduce the k-mesh, the stages or the cell size.`;
  }
  return null;
}
