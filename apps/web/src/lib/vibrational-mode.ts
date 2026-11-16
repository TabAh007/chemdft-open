import type { StructureVersionDetail, VibrationalAnalysis } from "@chemdft/schemas";

/** Build a disposable display frame from the immutable equilibrium and PySCF vectors. */
export function vibrationalFrameDetail(
  source: StructureVersionDetail,
  analysis: VibrationalAnalysis,
  modeIndex: number,
  phase: number,
  amplitudeAngstrom: number,
): StructureVersionDetail | null {
  const coordinates = source.version.coordinates;
  const mode = analysis.modes[modeIndex];
  if (!coordinates || !mode || !Number.isFinite(phase) || !Number.isFinite(amplitudeAngstrom)) return null;
  const base = analysis.equilibrium_coordinates_angstrom;
  const vectors = mode.displacement_vectors;
  if (coordinates.atoms.length !== base.length || vectors.length !== base.length) return null;
  if (coordinates.atoms.some((atom, index) => atom.element !== analysis.atom_identities[index])) return null;
  const numericVectors = vectors.map((vector) => vector.map(Number));
  const numericBase = base.map((point) => point.map(Number));
  const largest = Math.max(...numericVectors.map((vector) => Math.hypot(...vector)));
  if (!Number.isFinite(largest) || largest <= 0) return null;
  const scale = amplitudeAngstrom * Math.sin(phase) / largest;
  const atoms = coordinates.atoms.map((atom, index) => {
    const point = numericBase[index];
    const vector = numericVectors[index];
    if (!point || !vector || [...point, ...vector].some((value) => !Number.isFinite(value))) return null;
    return {
      ...atom,
      x: point[0]! + scale * vector[0]!,
      y: point[1]! + scale * vector[1]!,
      z: point[2]! + scale * vector[2]!,
    };
  });
  if (atoms.some((atom) => atom === null)) return null;
  return {
    ...source,
    version: {
      ...source.version,
      coordinates: { ...coordinates, unit: "angstrom", atoms: atoms as typeof coordinates.atoms },
    },
  };
}

/**
 * Display-only exaggeration of normal-mode motion. This is NOT a physical
 * vibrational amplitude: normal-mode vectors are never modified, only the
 * size of the animated excursion in the disposable display frame.
 */
export const VISUAL_BASE_DISPLACEMENT_ANGSTROM = 0.2;
export const MIN_VISUAL_EXAGGERATION = 0.5;
export const MAX_VISUAL_EXAGGERATION = 2;
export const DEFAULT_VISUAL_EXAGGERATION = 1;

/** Largest per-atom display excursion (Å) for a given exaggeration factor, clamped to a chemically sane range. */
export function visualDisplacementAngstrom(exaggeration: number): number {
  const clamped = Math.min(MAX_VISUAL_EXAGGERATION, Math.max(MIN_VISUAL_EXAGGERATION, exaggeration));
  return clamped * VISUAL_BASE_DISPLACEMENT_ANGSTROM;
}

/**
 * Display-only arrows for one normal mode: origin at each atom of the shown frame, direction and relative size from the
 * stored mode vector, the longest arrow drawn `longestAngstrom` long. Not a physical amplitude.
 */
export function modeDisplacementArrows(
  frame: StructureVersionDetail | null,
  mode: { displacement_vectors: readonly (readonly unknown[])[] } | undefined,
  longestAngstrom = 1.2,
): { origin: readonly [number, number, number]; vector: readonly [number, number, number] }[] | undefined {
  const atoms = frame?.version.coordinates?.atoms;
  if (!atoms || !mode) return undefined;
  const vectors = mode.displacement_vectors.map((vector) => vector.map(Number) as [number, number, number]);
  if (vectors.length !== atoms.length) return undefined;
  const largest = Math.max(...vectors.map((vector) => Math.hypot(...vector)));
  if (!Number.isFinite(largest) || largest <= 0) return undefined;
  const scale = longestAngstrom / largest;
  return atoms.map((atom, index) => ({
    origin: [atom.x, atom.y, atom.z] as const,
    vector: vectors[index]!.map((value) => value * scale) as unknown as [number, number, number],
  }));
}

export const ARROW_SCALE_NOTE =
  "Arrows show the stored mode-vector direction and relative size per atom; lengths are scaled for display (longest = 1.2 Å), not physical amplitudes.";
