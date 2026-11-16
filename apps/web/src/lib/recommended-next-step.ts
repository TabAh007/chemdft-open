/**
 * Deterministic Recommended Next Step Engine
 *
 * Projects scientifically grounded, deterministic recommendations based strictly on
 * persisted project records, current view, and calculation status.
 *
 * Invariant: AI may explain recommendations, but the deterministic engine is
 * the sole authority on step availability. No imaginary or unconfigured workflows.
 */

export type RecommendedActionKind =
  | "UPLOAD_INPUT"
  | "REVIEW_CANDIDATE"
  | "REVIEW_STRUCTURE"
  | "VIEW_ELECTRONIC_STRUCTURE"
  | "VIEW_ELECTRON_DENSITY"
  | "VIEW_ESP"
  | "REVIEW_UVVIS"
  | "PREPARE_GEOMETRY_OPTIMIZATION"
  | "MEASURE_MOLECULE"
  | "ASK_AI_SCIENTIST"
  | "COMPARE_PAPER";

export type RecommendedAction = {
  kind: RecommendedActionKind;
  label: string;
  badge?: string;
  description: string;
  actionId: string;
  requiresConfirmation?: boolean;
};

export type RecommendedNextStepResult = {
  primary: RecommendedAction;
  secondary: RecommendedAction[];
};

export type ProjectStateForRecommendation = {
  hasStructure: boolean;
  structureName?: string | null;
  structureVersionRevision?: number | null;
  atomCount?: number | null;
  hasUnreviewedCandidate?: boolean;
  candidateCount?: number;
  hasCalculationRunning?: boolean;
  hasElectronicResult?: boolean;
  hasSpectraResult?: boolean;
  electronicMethod?: string | null;
  electronicBasis?: string | null;
  hasOptimizationResult?: boolean;
  hasPaper?: boolean;
  currentView?: string | null;
};

export function projectRecommendedNextStep(
  state: ProjectStateForRecommendation,
): RecommendedNextStepResult {
  // Case 1: Active Calculation in Progress
  if (state.hasCalculationRunning) {
    return {
      primary: {
        kind: "ASK_AI_SCIENTIST",
        label: "Monitor running calculation",
        badge: "Compute running",
        description: "Calculation is executing via Compute Gateway. You can ask AI Scientist about expected convergence or monitor progress.",
        actionId: "monitor_calculation",
      },
      secondary: [
        {
          kind: "REVIEW_STRUCTURE",
          label: "Inspect input geometry",
          description: "Verify the input structure currently undergoing calculation.",
          actionId: "review_structure",
        },
      ],
    };
  }

  // Case 2a: Both Electronic Structure and UV/Vis Spectra are complete
  if (state.hasElectronicResult && state.hasSpectraResult) {
    const isAlreadyOnSpectra =
      state.currentView?.toLowerCase().includes("uv/vis") ||
      state.currentView?.toLowerCase().includes("spectra");

    return {
      primary: isAlreadyOnSpectra
        ? {
            kind: "ASK_AI_SCIENTIST",
            label: "Analyze transitions with AI Scientist",
            badge: "TDDFT spectra grounded",
            description: "Ask AI Scientist to explain the dominant electronic transitions, oscillator strengths, and orbital contributions.",
            actionId: "ask_ai_spectra",
          }
        : {
            kind: "REVIEW_UVVIS",
            label: "Review UV/Vis result",
            badge: "TDDFT spectra ready",
            description: "Inspect the predicted UV/Vis absorption spectrum, oscillator strengths, and electronic excitation transitions.",
            actionId: "view_spectra",
          },
      secondary: [
        {
          kind: "ASK_AI_SCIENTIST",
          label: "Ask AI Scientist",
          description: "Synthesize findings across ground-state electronic structure and excited-state optical transitions.",
          actionId: "ask_ai",
        },
        {
          kind: "VIEW_ELECTRONIC_STRUCTURE",
          label: "Explore electronic structure",
          description: "Inspect molecular orbitals, HOMO/LUMO levels, and electron density.",
          actionId: "view_electronic_structure",
        },
        {
          kind: "VIEW_ESP",
          label: "View electrostatic potential",
          description: "Map the electrostatic potential onto the electron density isosurface.",
          actionId: "view_esp",
        },
        {
          kind: "PREPARE_GEOMETRY_OPTIMIZATION",
          label: "Prepare geometry optimization",
          description: "Set up relaxation to locate the local energy minimum on the potential energy surface.",
          actionId: "prepare_optimization",
          requiresConfirmation: true,
        },
      ],
    };
  }

  // Case 2: Electronic Structure Result Already Available (e.g. Water HF/STO-3G)
  if (state.hasElectronicResult) {
    const methodStr = state.electronicMethod && state.electronicBasis
      ? `${state.electronicMethod} / ${state.electronicBasis}`
      : "HF / STO-3G";

    const isAlreadyOnResult =
      state.currentView?.toLowerCase().includes("electronic") ||
      state.currentView?.toLowerCase().includes("orbital") ||
      state.currentView?.toLowerCase().includes("density") ||
      state.currentView?.toLowerCase().includes("esp");

    return {
      primary: isAlreadyOnResult
        ? {
            kind: "VIEW_ELECTRON_DENSITY",
            label: "Explore electron density",
            badge: "Deterministic grid ready",
            description: `Inspect the spatial distribution of valence electrons calculated with ${methodStr}.`,
            actionId: "view_density",
          }
        : {
            kind: "VIEW_ELECTRONIC_STRUCTURE",
            label: "Explore electronic structure",
            badge: `${methodStr} ready`,
            description: `Inspect molecular orbitals, HOMO/LUMO energies, and electron density calculated using ${methodStr}.`,
            actionId: "view_electronic_structure",
          },
      secondary: [
        {
          kind: "VIEW_ESP",
          label: "View electrostatic potential",
          description: "Map the electrostatic potential onto the electron density isosurface.",
          actionId: "view_esp",
        },
        {
          kind: "PREPARE_GEOMETRY_OPTIMIZATION",
          label: "Prepare geometry optimization",
          description: "Set up relaxation to locate the local energy minimum on the potential energy surface.",
          actionId: "prepare_optimization",
          requiresConfirmation: true,
        },
        {
          kind: "MEASURE_MOLECULE",
          label: "Measure bonds and angles",
          description: "Inspect interatomic distances and bond angles in the 3D viewer.",
          actionId: "measure_molecule",
        },
        {
          kind: "ASK_AI_SCIENTIST",
          label: "Ask AI Scientist",
          description: "Get an explanation of orbital symmetries, frontier energy levels, and next steps.",
          actionId: "ask_ai",
        },
      ],
    };
  }

  // Case 3: Structure imported/ready, but no calculations run yet
  if (state.hasStructure) {
    const structName = state.structureName ?? "Imported molecule";
    return {
      primary: {
        kind: "VIEW_ELECTRONIC_STRUCTURE",
        label: "Calculate electronic structure",
        badge: "PySCF engine ready",
        description: `Run a Hartree-Fock calculation on ${structName} to obtain molecular orbitals and electron density.`,
        actionId: "setup_scf",
        requiresConfirmation: true,
      },
      secondary: [
        {
          kind: "PREPARE_GEOMETRY_OPTIMIZATION",
          label: "Optimize geometry",
          description: "Relax the molecular coordinates to find the equilibrium ground-state geometry.",
          actionId: "prepare_optimization",
          requiresConfirmation: true,
        },
        {
          kind: "MEASURE_MOLECULE",
          label: "Measure structure",
          description: "Check atomic coordinates, bond distances, and angles.",
          actionId: "measure_molecule",
        },
        {
          kind: "ASK_AI_SCIENTIST",
          label: "Ask AI Scientist",
          description: "Ask about this structure's origin, coordinate representation, and suggested calculations.",
          actionId: "ask_ai",
        },
      ],
    };
  }

  // Case 4: Paper with unreviewed structure candidate (e.g. Chromium paper)
  if (state.hasUnreviewedCandidate) {
    return {
      primary: {
        kind: "REVIEW_CANDIDATE",
        label: "Review proposed structure candidate",
        badge: "Human review required",
        description: "Scientific paper provided a reconstructed candidate. Verify coordinates before promoting to an authoritative StructureVersion.",
        actionId: "review_candidate",
      },
      secondary: [
        {
          kind: "COMPARE_PAPER",
          label: "Compare paper evidence vs ChemDFT",
          description: "Inspect digitized XRD patterns, DLS curves, and experimental data extracted from the paper.",
          actionId: "compare_paper",
        },
        {
          kind: "ASK_AI_SCIENTIST",
          label: "Ask AI Scientist",
          description: "Ask what experimental claims and synthesis details were reported in the paper.",
          actionId: "ask_ai",
        },
      ],
    };
  }

  // Case 5: Empty project (No structure, no paper)
  return {
    primary: {
      kind: "UPLOAD_INPUT",
      label: "Add molecular structure or scientific paper",
      badge: "Get started",
      description: "Upload an XYZ, MOL, or CIF file, or import a scientific paper PDF to extract candidate structures and experimental data.",
      actionId: "upload_input",
    },
    secondary: [
      {
        kind: "UPLOAD_INPUT",
        label: "Load Water acceptance example",
        description: "Open the verified 3-atom H₂O benchmark project with Hartree-Fock/STO-3G results.",
        actionId: "load_water_example",
      },
    ],
  };
}
