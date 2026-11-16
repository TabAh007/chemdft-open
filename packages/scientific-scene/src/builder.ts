import type { Atom, PeriodicCell, StructureVersionDetail } from "@chemdft/schemas";

import { convertCoordinateToAngstrom, fractionalToCartesian } from "./geometry";
import type {
  SceneDiagnostic,
  ScientificScene,
  ScientificSceneAtom,
  ScientificSceneBond,
  ScientificSceneCell,
  StructureVersionReference,
  Vec3,
} from "./types";

export class SceneBuildError extends Error {
  constructor(readonly code: "STRUCTURE_COORDINATES_UNAVAILABLE" | "SCENE_BUILD_FAILED", message: string) {
    super(message);
    this.name = "SceneBuildError";
  }
}

export function buildScientificScene(detail: StructureVersionDetail): ScientificScene {
  const coordinates = detail.version.coordinates;
  if (!coordinates) {
    throw new SceneBuildError(
      "STRUCTURE_COORDINATES_UNAVAILABLE",
      "The selected StructureVersion does not contain coordinate data.",
    );
  }
  const transforms: string[] = [];
  const cell = detail.version.periodic_cell ? sceneCell(detail.version.periodic_cell) : undefined;
  const atoms = coordinates.atoms.map((atom) => {
    const sourcePosition: Vec3 = [atom.x, atom.y, atom.z];
    let position = sourcePosition;
    if (coordinates.coordinate_system === "FRACTIONAL") {
      if (!cell) {
        throw new SceneBuildError("SCENE_BUILD_FAILED", "Fractional coordinates require a periodic cell.");
      }
      position = fractionalToCartesian(sourcePosition, cell.latticeVectors);
      pushUnique(transforms, "fractional-to-cartesian-from-lattice-vectors");
    }
    position = convertCoordinateToAngstrom(position, coordinates.unit);
    if (coordinates.unit === "bohr") pushUnique(transforms, "bohr-to-angstrom");
    return sceneAtom(atom, position, sourcePosition, coordinates.coordinate_system);
  });
  return {
    schemaVersion: "1.0.0",
    id: `${detail.structure.id}:${detail.version.id}`,
    kind: detail.structure.kind === "PERIODIC" ? "PERIODIC" : "MOLECULE",
    structureVersion: structureVersionReference(detail),
    displayUnit: "angstrom",
    atoms,
    bonds: (coordinates.bonds ?? []).map((bond): ScientificSceneBond => ({
      id: `${detail.version.id}:bond:${bond.atom_index_a}-${bond.atom_index_b}`,
      atomIndexA: bond.atom_index_a,
      atomIndexB: bond.atom_index_b,
      order: bond.order ?? null,
      source: "canonical",
    })),
    ...(cell ? { cell } : {}),
    diagnostics: (detail.diagnostics ?? detail.version.diagnostics ?? []).map((diagnostic): SceneDiagnostic => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.atom_index === undefined ? {} : { atomIndex: diagnostic.atom_index }),
    })),
    derivation: {
      sourceCoordinateSystem: coordinates.coordinate_system,
      sourceUnit: coordinates.unit,
      displayUnit: "angstrom",
      transforms: transforms.length === 0 ? ["identity"] : transforms,
      ...(detail.structure.kind === "PERIODIC"
        ? { periodicMeasurementConvention: "display-cartesian-no-minimum-image" }
        : {}),
    },
  };
}

function sceneAtom(
  atom: Atom,
  position: Vec3,
  sourcePosition: Vec3,
  sourceCoordinateSystem: "CARTESIAN" | "FRACTIONAL",
): ScientificSceneAtom {
  return {
    id: `atom:${atom.index}`,
    index: atom.index,
    element: atom.element,
    atomicNumber: atom.atomic_number,
    position,
    sourcePosition,
    sourceCoordinateSystem,
    ...(atom.occupancy == null ? {} : { occupancy: atom.occupancy }),
  };
}

function sceneCell(cell: PeriodicCell): ScientificSceneCell {
  const latticeVectors = cell.lattice_vectors as readonly [Vec3, Vec3, Vec3];
  return {
    a: cell.a,
    b: cell.b,
    c: cell.c,
    alpha: cell.alpha,
    beta: cell.beta,
    gamma: cell.gamma,
    latticeVectors,
    periodicDimensions: cell.periodic_dimensions as readonly [boolean, boolean, boolean],
  };
}

function structureVersionReference(detail: StructureVersionDetail): StructureVersionReference {
  return {
    projectId: detail.structure.project_id,
    structureId: detail.structure.id,
    structureVersionId: detail.version.id,
    revision: detail.version.revision,
  };
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}
