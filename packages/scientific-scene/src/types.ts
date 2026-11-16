export type SceneSchemaVersion = "1.0.0";

export type Vec3 = readonly [number, number, number];

export type DisplayUnit = "angstrom";

export type SceneKind = "MOLECULE" | "PERIODIC";

export type StructureVersionReference = {
  readonly projectId: string;
  readonly structureId: string;
  readonly structureVersionId: string;
  readonly revision: number;
};

export type AtomColorScheme = "conventional" | "colorblind" | "monochrome";

export type RepresentationMode = "ball-stick" | "sticks" | "wireframe" | "space-fill";

export type RendererMode = "scientific-3d" | "studio";

export type ProjectionMode = "perspective" | "orthographic";

export type SelectionState =
  | { readonly type: "none" }
  | { readonly type: "atom"; readonly atomIndex: number }
  | { readonly type: "bond"; readonly atomIndexA: number; readonly atomIndexB: number };

export type MeasurementKind = "distance" | "angle" | "dihedral";

export type MeasurementSelection = {
  readonly kind: MeasurementKind;
  readonly atomIndices: readonly number[];
};

export type ScientificSceneAtom = {
  readonly id: string;
  readonly index: number;
  readonly element: string;
  readonly atomicNumber: number;
  readonly position: Vec3;
  readonly sourcePosition: Vec3;
  readonly sourceCoordinateSystem: "CARTESIAN" | "FRACTIONAL";
  readonly occupancy?: number;
  readonly label?: string;
  readonly formalCharge?: number;
};

export type ScientificSceneBond = {
  readonly id: string;
  readonly atomIndexA: number;
  readonly atomIndexB: number;
  readonly order: number | null;
  readonly source: "canonical" | "derived";
};

export type ScientificSceneCell = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
  readonly latticeVectors: readonly [Vec3, Vec3, Vec3];
  readonly periodicDimensions: readonly [boolean, boolean, boolean];
};

export type SceneDiagnostic = {
  readonly severity: string;
  readonly code: string;
  readonly message: string;
  readonly atomIndex?: number | null;
};

export type RenderableSceneData = {
  readonly id: string;
  readonly kind: SceneKind;
  readonly atoms: readonly ScientificSceneAtom[];
  readonly bonds: readonly ScientificSceneBond[];
  readonly cell?: ScientificSceneCell;
};

export type ScientificScene = RenderableSceneData & {
  readonly schemaVersion: SceneSchemaVersion;
  readonly structureVersion: StructureVersionReference;
  readonly displayUnit: DisplayUnit;
  readonly diagnostics: readonly SceneDiagnostic[];
  readonly derivation: {
    readonly sourceCoordinateSystem: "CARTESIAN" | "FRACTIONAL";
    readonly sourceUnit: "angstrom" | "bohr";
    readonly displayUnit: DisplayUnit;
    readonly transforms: readonly string[];
    readonly periodicMeasurementConvention?: "display-cartesian-no-minimum-image";
  };
};

/** A visualization-only candidate conformer. It has no StructureVersion authority. */
export type PreviewScene = {
  readonly kind: SceneKind;
  readonly candidateId: string;
  readonly representationId: string;
  readonly representationRevision: number;
  readonly renderable: RenderableSceneData;
  readonly warning: "UNVERIFIED_GENERATED_PREVIEW";
};

export type CameraState = {
  readonly projection: ProjectionMode;
  readonly target: Vec3;
  readonly orientation: readonly [number, number, number, number];
  readonly distance: number;
  readonly zoom: number;
};

export type SupercellState = {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
};

export type CellBoundaryMode = "cell" | "coordination";

export type ViewPreset =
  | "along-a"
  | "along-b"
  | "along-c"
  | "along-a-star"
  | "oblique"
  | "front"
  | "back"
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "isometric";

export type VisualizationState = {
  readonly mode: RendererMode;
  readonly representation: RepresentationMode;
  readonly colorScheme: AtomColorScheme;
  readonly selection: SelectionState;
  readonly camera: CameraState;
  readonly labels: "none" | "element" | "index";
  readonly hydrogensVisible: boolean;
  readonly unitCellVisible: boolean;
  readonly axesVisible: boolean;
  readonly supercell: SupercellState;
  readonly background: "laboratory" | "white" | "transparent" | "dark-neutral";
  readonly measurement: MeasurementSelection | null;
  readonly cellContents?: CellBoundaryMode | undefined;
  readonly polyhedraVisible?: boolean | undefined;
  readonly atomScale?: number | undefined;
  readonly labelScale?: number | undefined;
  readonly legendVisible?: boolean | undefined;
  readonly presetView?: ViewPreset | null | undefined;
  readonly keepCVertical?: boolean | undefined;
};

export const DEFAULT_CAMERA_STATE: CameraState = {
  projection: "perspective",
  target: [0, 0, 0],
  orientation: [0, 0, 0, 1],
  distance: 12,
  zoom: 1,
};

export const DEFAULT_VISUALIZATION_STATE: VisualizationState = {
  mode: "scientific-3d",
  representation: "ball-stick",
  colorScheme: "conventional",
  selection: { type: "none" },
  camera: DEFAULT_CAMERA_STATE,
  labels: "none",
  hydrogensVisible: true,
  unitCellVisible: true,
  axesVisible: false,
  supercell: { nx: 1, ny: 1, nz: 1 },
  background: "laboratory",
  measurement: null,
  cellContents: "coordination",
  polyhedraVisible: false,
  atomScale: 1,
  labelScale: 1,
  legendVisible: true,
  presetView: null,
  keepCVertical: false,
};
