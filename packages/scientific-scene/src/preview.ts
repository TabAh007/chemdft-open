import type {
  PreviewScene,
  RenderableSceneData,
  ScientificSceneAtom,
  ScientificSceneBond,
  ScientificSceneCell,
  Vec3,
} from "./types";

export type CandidatePreviewInput = {
  candidateId: string;
  representationId: string;
  representationRevision: number;
  representation: {
    kind: string;
    coordinates: {
      coordinate_system: "CARTESIAN" | "FRACTIONAL";
      unit: "angstrom" | "bohr";
      atoms: readonly {
        index: number;
        element: string;
        atomic_number: number;
        x: number;
        y: number;
        z: number;
        occupancy?: number | null;
        label?: string | null;
        formal_charge?: number | null;
      }[];
      bonds?: readonly {
        atom_index_a: number;
        atom_index_b: number;
        order?: number | null;
      }[];
    };
    periodic_cell?: {
      a: number;
      b: number;
      c: number;
      alpha: number;
      beta: number;
      gamma: number;
    } | null;
  };
};

/** Maps candidate data into renderer geometry without giving it StructureVersion identity. */
export function buildCandidatePreviewScene(input: CandidatePreviewInput): PreviewScene {
  const candidate = input.representation;
  const kind = candidate.kind === "PERIODIC" ? "PERIODIC" : "MOLECULE";
  const cell = kind === "PERIODIC" && candidate.periodic_cell
    ? previewCell(candidate.periodic_cell)
    : undefined;
  const atoms: ScientificSceneAtom[] = candidate.coordinates.atoms.map((atom) => {
    let position: Vec3 = [atom.x, atom.y, atom.z];
    if (candidate.coordinates.coordinate_system === "FRACTIONAL" && cell) {
      const [a, b, c] = cell.latticeVectors;
      position = add(add(scale(a, atom.x), scale(b, atom.y)), scale(c, atom.z));
    }
    if (candidate.coordinates.unit === "bohr") position = scale(position, 0.529177210903);
    return {
      id: `candidate-preview-atom-${atom.index}`,
      index: atom.index,
      element: atom.element,
      atomicNumber: atom.atomic_number,
      position,
      sourcePosition: [atom.x, atom.y, atom.z],
      sourceCoordinateSystem: candidate.coordinates.coordinate_system,
      ...(atom.occupancy != null ? { occupancy: atom.occupancy } : {}),
      ...(atom.label != null ? { label: atom.label } : {}),
      ...(atom.formal_charge != null ? { formalCharge: atom.formal_charge } : {}),
    };
  });
  const bonds: ScientificSceneBond[] = (candidate.coordinates.bonds ?? []).map((bond, index) => ({
    id: `candidate-preview-bond-${index}`,
    atomIndexA: bond.atom_index_a,
    atomIndexB: bond.atom_index_b,
    order: bond.order ?? 1,
    source: "canonical",
  }));
  const renderable: RenderableSceneData = {
    id: `candidate-preview-${input.representationId}`,
    kind,
    atoms,
    bonds,
    ...(cell ? { cell } : {}),
  };
  return {
    kind,
    candidateId: input.candidateId,
    representationId: input.representationId,
    representationRevision: input.representationRevision,
    renderable,
    warning: "UNVERIFIED_GENERATED_PREVIEW",
  };
}

function previewCell(cell: NonNullable<CandidatePreviewInput["representation"]["periodic_cell"]>): ScientificSceneCell {
  const radians = Math.PI / 180;
  const alpha = cell.alpha * radians;
  const beta = cell.beta * radians;
  const gamma = cell.gamma * radians;
  const cosAlpha = Math.cos(alpha);
  const cosBeta = Math.cos(beta);
  const cosGamma = Math.cos(gamma);
  const sinGamma = Math.sin(gamma);
  const cY = cell.c * (cosAlpha - cosBeta * cosGamma) / sinGamma;
  const cZ = Math.sqrt(Math.max(0, cell.c ** 2 - (cell.c * cosBeta) ** 2 - cY ** 2));
  return {
    ...cell,
    latticeVectors: [[cell.a, 0, 0], [cell.b * cosGamma, cell.b * sinGamma, 0], [cell.c * cosBeta, cY, cZ]],
    periodicDimensions: [true, true, true],
  };
}

function scale(vector: Vec3, factor: number): Vec3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function add(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}
