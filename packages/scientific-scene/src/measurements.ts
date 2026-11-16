import { angleDegrees, dihedralDegrees, distance } from "./geometry";
import type { MeasurementKind, ScientificScene } from "./types";

export type MeasurementResult = {
  readonly kind: MeasurementKind;
  readonly atomIndices: readonly number[];
  readonly value: number;
  readonly unit: "angstrom" | "degree";
  readonly convention: "display-cartesian" | "display-cartesian-no-minimum-image";
};

export function measureScene(
  scene: ScientificScene,
  kind: MeasurementKind,
  atomIndices: readonly number[],
): MeasurementResult {
  const atoms = atomIndices.map((index) => {
    const atom = scene.atoms.find((candidate) => candidate.index === index);
    if (!atom) throw new Error(`Atom ${index} is not present in the scene.`);
    return atom;
  });
  const convention = scene.kind === "PERIODIC" ? "display-cartesian-no-minimum-image" : "display-cartesian";
  if (kind === "distance") {
    if (atoms.length !== 2) throw new Error("Distance measurement requires exactly 2 atoms.");
    const [first, second] = atoms as [typeof atoms[number], typeof atoms[number]];
    return {
      kind,
      atomIndices,
      value: distance(first.position, second.position),
      unit: "angstrom",
      convention,
    };
  }
  if (kind === "angle") {
    if (atoms.length !== 3) throw new Error("Angle measurement requires exactly 3 atoms.");
    const [first, second, third] = atoms as [typeof atoms[number], typeof atoms[number], typeof atoms[number]];
    return {
      kind,
      atomIndices,
      value: angleDegrees(first.position, second.position, third.position),
      unit: "degree",
      convention,
    };
  }
  if (atoms.length !== 4) throw new Error("Dihedral measurement requires exactly 4 atoms.");
  const [first, second, third, fourth] = atoms as [
    typeof atoms[number],
    typeof atoms[number],
    typeof atoms[number],
    typeof atoms[number],
  ];
  return {
    kind,
    atomIndices,
    value: dihedralDegrees(first.position, second.position, third.position, fourth.position),
    unit: "degree",
    convention,
  };
}

export function formatMeasurement(result: MeasurementResult): string {
  if (result.unit === "angstrom") return `${result.value.toFixed(3)} Å`;
  return `${result.value.toFixed(2)}°`;
}
