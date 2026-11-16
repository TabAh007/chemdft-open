/**
 * ChemDFT molecular/crystal renderer — shared types.
 *
 * Two kinds of state never mix:
 *  - `ScientificStructure` (and the `DerivedGeometry` computed from it) is authoritative geometry: element
 *    identities, coordinates, lattice, topology rules and provenance. It is immutable and the renderer never
 *    writes to it.
 *  - `PresentationState` is how that geometry is shown: representation, preset, supercell extent, camera,
 *    selection and labels. Animation interpolates presentation state only.
 */
export type Vec3 = readonly [number, number, number];

export type LatticeParameters = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
};

export type StructureSite = {
  readonly element: string;
  /** Cartesian Å in the lattice frame (a along x, b in the xy plane) for crystals; source Cartesian Å for molecules. */
  readonly position: Vec3;
  /** Authoritative fractional coordinates for crystals. `position` is derived from these and the lattice. */
  readonly fractional?: Vec3;
};

export type BondPairRule = { readonly a: string; readonly b: string; readonly maxDistance: number };

/** Display-bond rule: a stated distance cutoff. These bonds are visual aids, never written back as chemistry. */
export type DisplayBondRule = { readonly pairs: readonly BondPairRule[]; readonly label: string };

export type CoordinationRule = {
  readonly center: string;
  readonly ligand: string;
  readonly maxDistance: number;
  /** A polyhedron is drawn only for a site whose neighbour count equals this value. */
  readonly expectedCount: number;
  readonly label: string;
};

export type StructureProvenance = {
  readonly kind: "reference-structure" | "stored-structure-version";
  readonly label: string;
  readonly source?: {
    readonly name: string;
    readonly id?: string;
    readonly url?: string;
    readonly citation?: string;
    readonly licence?: string;
  };
  readonly note?: string;
};

export type ScientificStructure = {
  readonly id: string;
  readonly title: string;
  readonly formula: string;
  readonly kind: "periodic" | "molecule";
  readonly lattice?: { readonly parameters: LatticeParameters; readonly vectors: readonly [Vec3, Vec3, Vec3] };
  readonly sites: readonly StructureSite[];
  /** Authoritative bonds (site index pairs), when the source stores connectivity. */
  readonly canonicalBonds?: readonly (readonly [number, number])[];
  readonly displayBondRule?: DisplayBondRule;
  /** Display-only bonds the source itself inferred (for example ChemDFT's visual-bond inference for molecules). */
  readonly inferredBonds?: { readonly pairs: readonly (readonly [number, number])[]; readonly label: string };
  readonly coordinationRules?: readonly CoordinationRule[];
  /** Formal oxidation states, when the source states them; they enable the ionic radius model. */
  readonly oxidationStates?: Readonly<Record<string, number>>;
  readonly provenance: StructureProvenance;
};

export type Representation = "ball-stick" | "unit-cell" | "polyhedra" | "wireframe" | "space-fill";
export type PresetId = "scientific" | "editorial" | "publication";
export type ProjectionMode = "perspective" | "orthographic";
export type Supercell = readonly [number, number, number];

/** Serializable camera state: enough to reproduce a view exactly. */
export type CameraView = {
  readonly projection: ProjectionMode;
  /** Radians about the scene up axis (the lattice c axis for crystals). */
  readonly azimuth: number;
  /** Radians from the up axis: 0 looks straight down, π/2 looks along the horizon. */
  readonly polar: number;
  /** Multiplies the framing distance (perspective) or framing zoom (orthographic). 1 = fitted. */
  readonly zoom: number;
};

/**
 * Where the structure sits on the stage. The canvas can be larger than the area the structure should occupy (a hero
 * where the text takes the left half): the structure is fitted to a sub-region and shifted by a camera view offset.
 * All fractions of the canvas; positive offsets move the structure right/down. Presentation only.
 */
export type Composition = {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly regionWidth: number;
  readonly regionHeight: number;
};

export const FULL_COMPOSITION: Composition = { offsetX: 0, offsetY: 0, regionWidth: 1, regionHeight: 1 };

export type AtomSelection = { readonly index: number; readonly element: string; readonly position: Vec3 } | null;

export type LabelMode = "none" | "element";

export type PresentationState = {
  readonly representation: Representation;
  readonly preset: PresetId;
  readonly supercell: Supercell;
  readonly showCell: boolean;
  readonly showAxes: boolean;
  readonly labels: LabelMode;
  readonly projection?: ProjectionMode;
  readonly autoRotate: boolean;
  readonly selection: AtomSelection;
};

export const DEFAULT_PRESENTATION: PresentationState = {
  representation: "ball-stick",
  preset: "editorial",
  supercell: [1, 1, 1],
  showCell: true,
  showAxes: false,
  labels: "none",
  autoRotate: false,
  selection: null,
};

/** Imperative handle for the host page: reset, zoom, view get/set. It touches the camera only, never geometry. */
export type RendererHandle = {
  resetView(animate?: boolean): void;
  zoomBy(factor: number): void;
  rotateBy(deltaAzimuth: number, deltaPolar: number): void;
  setView(view: Partial<CameraView>, animate?: boolean): void;
  getView(): CameraView;
  /** Move/resize the region the structure is framed in (damped unless `animate` is false). Never touches geometry. */
  setComposition(composition: Partial<Composition>, animate?: boolean): void;
  /** Review/diagnostic information from the WebGL renderer. */
  stats(): { projectionShiftX?: number; viewOffset: number[] | null; calls: number; triangles: number; geometries: number; textures: number; frame: number };
  /** Projected bounds and intended composition region (normalized canvas coordinates), for review. */
  framing(): { bounds: number[]; region: number[]; structure: string };
  /** The atoms as actually drawn: instance positions (lattice frame, Å) and current drawn radius. For verification. */
  inspectAtoms(): { position: Vec3; radius: number }[];
};
