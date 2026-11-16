import { buildScientificScene, type ScientificScene } from "@chemdft/scientific-scene";
import type { OptimizationStep, StructureVersionDetail } from "@chemdft/schemas";

/** A frame exists only when an engine evaluation with matching atom order exists. */
export function sceneForOptimizationStep(
  source: StructureVersionDetail,
  step: OptimizationStep,
): ScientificScene | null {
  const coordinates = source.version.coordinates;
  if (!coordinates || step.coordinates_angstrom.length !== coordinates.atoms.length) return null;
  const positions = step.coordinates_angstrom.map((row) => row.map(Number));
  if (positions.some((row) => row.length !== 3 || row.some((value) => !Number.isFinite(value)))) return null;
  return buildScientificScene({
    ...source,
    version: {
      ...source.version,
      coordinates: {
        ...coordinates,
        unit: "angstrom",
        atoms: coordinates.atoms.map((atom, index) => ({
          ...atom, x: positions[index]![0]!, y: positions[index]![1]!, z: positions[index]![2]!,
        })) as typeof coordinates.atoms,
      },
    },
  });
}

export function optimizationSeries(steps: readonly OptimizationStep[]) {
  return {
    energy: steps.map((step) => [step.index + 1, step.energy_hartree] as const),
    gradient: steps.map((step) => [step.index + 1, step.gradient_norm_hartree_per_bohr] as const),
  };
}

/** Distance review only: neither assigns bond orders nor verifies fragmentation. */
export function optimizationSeparationWarnings(source: StructureVersionDetail, endpoint: OptimizationStep): string[] {
  const coordinates = source.version.coordinates;
  if (!coordinates || coordinates.coordinate_system !== "CARTESIAN" ||
    coordinates.atoms.length !== endpoint.coordinates_angstrom.length) return [];
  const scale = coordinates.unit === "bohr" ? 1 / 1.8897261254578281 : 1;
  const initial = coordinates.atoms.map((atom) => [atom.x * scale, atom.y * scale, atom.z * scale]);
  const final = endpoint.coordinates_angstrom.map((row) => row.map(Number));
  const bonds = coordinates.bonds ?? [];
  const pairs = bonds.length ? bonds.map((bond) =>
    [bond.atom_index_a, bond.atom_index_b] as const) : initial.length === 2 ? [[0, 1] as const] : [];
  const warnings = pairs.flatMap(([a, b]) => {
    const before = Math.hypot(...initial[a]!.map((value, axis) => value - initial[b]![axis]!));
    const after = Math.hypot(...final[a]!.map((value, axis) => value - final[b]![axis]!));
    if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0 || after <= 2 * before || after - before <= 1) return [];
    return [`Atoms ${a + 1}–${b + 1}: separation increased from ${before.toFixed(3)} Å to ${after.toFixed(3)} Å. Review possible dissociation or connectivity change; distance alone does not establish either.`];
  });
  if (initial.length === 2 && coordinates.atoms.every((atom) => atom.element === "H")) {
    const separation = Math.hypot(...final[0]!.map((value, axis) => value - final[1]![axis]!));
    // A conservative review threshold, not an authoritative chemical bond cutoff.
    if (Number.isFinite(separation) && separation > 2 && !warnings.length) {
      warnings.push(`H–H separation is ${separation.toFixed(3)} Å. Review possible dissociation; geometry convergence alone does not establish a bound molecule.`);
    }
  }
  return warnings;
}
