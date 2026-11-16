/**
 * Deterministic Guided Workflow Machine
 *
 * Uses XState v5 for client product journey state orchestration.
 * Invariant: XState orchestrates the user experience and progressive disclosure.
 * Scientific engine execution, validation, and persistence remain strictly
 * authoritative on the ChemDFT server.
 */

import { setup, assign, type SnapshotFrom, type ActorRefFrom } from "xstate";

export type InputKind = "structure" | "paper" | "experimental" | "example";

export type ImportStage = "uploading" | "reading" | "detecting" | "building" | "ready";

export type GoalKind =
  | "review_structure"
  | "view_electronic_structure"
  | "optimize_geometry"
  | "predict_spectrum"
  | "measure"
  | "ask_ai";

export type GuidedWorkflowContext = {
  projectId: string | null;
  projectName: string | null;
  inputKind: InputKind | null;
  inputFile: { name: string; size: number } | null;
  importStage: ImportStage | null;
  structureId: string | null;
  structureVersionId: string | null;
  structureSummary: {
    name: string;
    revision: number;
    atomCount: number;
    hasAuthoritativeBonds: boolean;
    coordinateSystem: string;
    origin: string;
  } | null;
  calculationId: string | null;
  calculationType: "energy" | "optimization" | null;
  resultId: string | null;
  resultSummary: {
    method: string;
    basis: string;
    totalEnergy: number | null;
    homoEnergy: number | null;
    lumoEnergy: number | null;
    gap: number | null;
    hasDensity: boolean;
    hasEsp: boolean;
  } | null;
  activeGoal: GoalKind | null;
  activeResultTab: "MO" | "DENSITY" | "ESP";
  error: string | null;
};

export type GuidedWorkflowEvent =
  | { type: "INIT_PROJECT"; projectId: string; projectName?: string }
  | { type: "SELECT_INPUT"; inputKind: InputKind; file?: { name: string; size: number } }
  | { type: "START_IMPORT"; stage?: ImportStage }
  | { type: "UPDATE_IMPORT_STAGE"; stage: ImportStage }
  | {
      type: "IMPORT_SUCCESS";
      structureId: string;
      structureVersionId: string;
      structureSummary: GuidedWorkflowContext["structureSummary"];
    }
  | { type: "IMPORT_FAILED"; error: string }
  | { type: "ACKNOWLEDGE_FOUND" }
  | { type: "SELECT_GOAL"; goal: GoalKind }
  | { type: "VIEW_STRUCTURE"; structureVersionId?: string }
  | { type: "VIEW_RESULT"; resultId: string; tab?: "MO" | "DENSITY" | "ESP" }
  | { type: "CHANGE_RESULT_TAB"; tab: "MO" | "DENSITY" | "ESP" }
  | { type: "SETUP_CALCULATION"; calculationType: "energy" | "optimization" }
  | { type: "START_CALCULATION"; calculationId: string }
  | {
      type: "CALCULATION_SUCCEEDED";
      resultId: string;
      resultSummary: GuidedWorkflowContext["resultSummary"];
    }
  | { type: "CALCULATION_FAILED"; error: string }
  | { type: "NAVIGATE_HOME" }
  | { type: "RESET" }
  | {
      type: "RECONCILE_SERVER_STATE";
      payload: ServerReconciliationPayload;
    };

export type ServerReconciliationPayload = {
  projectId: string;
  projectName?: string;
  structures?: Array<{
    id: string;
    name: string;
    versions_count?: number;
  }>;
  latestVersion?: {
    id: string;
    revision: number;
    atomCount: number;
    hasAuthoritativeBonds: boolean;
    coordinateSystem: string;
    origin: string;
  } | null;
  calculations?: Array<{
    id: string;
    status: string;
    calculation_type?: string;
  }>;
  latestResult?: {
    id: string;
    calculationId?: string;
    method: string;
    basis: string;
    totalEnergy: number | null;
    homoEnergy: number | null;
    lumoEnergy: number | null;
    gap: number | null;
    hasDensity: boolean;
    hasEsp: boolean;
  } | null;
};

export const initialWorkflowContext: GuidedWorkflowContext = {
  projectId: null,
  projectName: null,
  inputKind: null,
  inputFile: null,
  importStage: null,
  structureId: null,
  structureVersionId: null,
  structureSummary: null,
  calculationId: null,
  calculationType: null,
  resultId: null,
  resultSummary: null,
  activeGoal: null,
  activeResultTab: "MO",
  error: null,
};

export const guidedWorkflowMachine = setup({
  types: {
    context: {} as GuidedWorkflowContext,
    events: {} as GuidedWorkflowEvent,
  },
  actions: {
    setProject: assign({
      projectId: ({ event }) => (event.type === "INIT_PROJECT" ? event.projectId : null),
      projectName: ({ event }) => (event.type === "INIT_PROJECT" ? (event.projectName ?? null) : null),
    }),
    setInput: assign({
      inputKind: ({ event }) => (event.type === "SELECT_INPUT" ? event.inputKind : null),
      inputFile: ({ event }) => (event.type === "SELECT_INPUT" ? (event.file ?? null) : null),
      error: () => null,
    }),
    setImportStage: assign({
      importStage: ({ event }) =>
        event.type === "START_IMPORT"
          ? (event.stage ?? "uploading")
          : event.type === "UPDATE_IMPORT_STAGE"
          ? event.stage
          : null,
    }),
    setImportSuccess: assign({
      importStage: () => "ready" as ImportStage,
      structureId: ({ event }) => (event.type === "IMPORT_SUCCESS" ? event.structureId : null),
      structureVersionId: ({ event }) =>
        event.type === "IMPORT_SUCCESS" ? event.structureVersionId : null,
      structureSummary: ({ event }) =>
        event.type === "IMPORT_SUCCESS" ? event.structureSummary : null,
      error: () => null,
    }),
    setImportError: assign({
      error: ({ event }) => (event.type === "IMPORT_FAILED" ? event.error : "Import failed"),
      importStage: () => null,
    }),
    setGoal: assign({
      activeGoal: ({ event }) => (event.type === "SELECT_GOAL" ? event.goal : null),
    }),
    setCalculationSetup: assign({
      calculationType: ({ event }) =>
        event.type === "SETUP_CALCULATION" ? event.calculationType : null,
      error: () => null,
    }),
    setCalculationRunning: assign({
      calculationId: ({ event }) =>
        event.type === "START_CALCULATION" ? event.calculationId : null,
      error: () => null,
    }),
    setCalculationSuccess: assign({
      resultId: ({ event }) => (event.type === "CALCULATION_SUCCEEDED" ? event.resultId : null),
      resultSummary: ({ event }) =>
        event.type === "CALCULATION_SUCCEEDED" ? event.resultSummary : null,
      error: () => null,
    }),
    setCalculationFailed: assign({
      error: ({ event }) =>
        event.type === "CALCULATION_FAILED" ? event.error : "Calculation failed",
    }),
    setResultTab: assign({
      activeResultTab: ({ event }) =>
        event.type === "CHANGE_RESULT_TAB"
          ? event.tab
          : event.type === "VIEW_RESULT" && event.tab
          ? event.tab
          : "MO",
    }),
    reconcileWithServer: assign(({ context, event }) => {
      if (event.type !== "RECONCILE_SERVER_STATE") return context;
      const { payload } = event;
      const nextContext = { ...context };

      nextContext.projectId = payload.projectId;
      if (payload.projectName) nextContext.projectName = payload.projectName;

      if (payload.latestVersion) {
        nextContext.structureVersionId = payload.latestVersion.id;
        nextContext.structureSummary = {
          name: payload.structures?.[0]?.name ?? "Imported Structure",
          revision: payload.latestVersion.revision,
          atomCount: payload.latestVersion.atomCount,
          hasAuthoritativeBonds: payload.latestVersion.hasAuthoritativeBonds,
          coordinateSystem: payload.latestVersion.coordinateSystem,
          origin: payload.latestVersion.origin,
        };
        if (payload.structures?.[0]?.id) {
          nextContext.structureId = payload.structures[0].id;
        }
      }

      if (payload.latestResult) {
        nextContext.resultId = payload.latestResult.id;
        nextContext.resultSummary = {
          method: payload.latestResult.method,
          basis: payload.latestResult.basis,
          totalEnergy: payload.latestResult.totalEnergy,
          homoEnergy: payload.latestResult.homoEnergy,
          lumoEnergy: payload.latestResult.lumoEnergy,
          gap: payload.latestResult.gap,
          hasDensity: payload.latestResult.hasDensity,
          hasEsp: payload.latestResult.hasEsp,
        };
      }

      return nextContext;
    }),
  },
}).createMachine({
  id: "guidedWorkflow",
  initial: "empty",
  context: initialWorkflowContext,
  on: {
    RESET: { target: ".empty", actions: assign(() => initialWorkflowContext) },
    RECONCILE_SERVER_STATE: [
      {
        guard: ({ event }) => Boolean(event.payload.latestResult),
        target: ".resultView",
        actions: "reconcileWithServer",
      },
      {
        guard: ({ event }) =>
          Boolean(
            event.payload.calculations?.some(
              (c) => c.status === "QUEUED" || c.status === "RUNNING",
            ),
          ),
        target: ".calculationRunning",
        actions: "reconcileWithServer",
      },
      {
        guard: ({ event }) => Boolean(event.payload.latestVersion),
        target: ".projectHome",
        actions: "reconcileWithServer",
      },
      {
        target: ".empty",
        actions: "reconcileWithServer",
      },
    ],
  },
  states: {
    empty: {
      on: {
        INIT_PROJECT: {
          target: "newProject",
          actions: "setProject",
        },
        SELECT_INPUT: {
          target: "newProject",
          actions: "setInput",
        },
      },
    },
    newProject: {
      on: {
        SELECT_INPUT: {
          actions: "setInput",
        },
        START_IMPORT: {
          target: "importing",
          actions: "setImportStage",
        },
        VIEW_STRUCTURE: {
          target: "structureView",
        },
        NAVIGATE_HOME: {
          target: "projectHome",
        },
      },
    },
    importing: {
      on: {
        UPDATE_IMPORT_STAGE: {
          actions: "setImportStage",
        },
        IMPORT_SUCCESS: {
          target: "whatFound",
          actions: "setImportSuccess",
        },
        IMPORT_FAILED: {
          target: "error",
          actions: "setImportError",
        },
      },
    },
    whatFound: {
      on: {
        ACKNOWLEDGE_FOUND: {
          target: "projectHome",
        },
        VIEW_STRUCTURE: {
          target: "structureView",
        },
        VIEW_RESULT: {
          target: "resultView",
          actions: "setResultTab",
        },
        SETUP_CALCULATION: {
          target: "calculationSetup",
          actions: "setCalculationSetup",
        },
      },
    },
    projectHome: {
      on: {
        SELECT_GOAL: {
          actions: "setGoal",
        },
        VIEW_STRUCTURE: {
          target: "structureView",
        },
        VIEW_RESULT: {
          target: "resultView",
          actions: "setResultTab",
        },
        SETUP_CALCULATION: {
          target: "calculationSetup",
          actions: "setCalculationSetup",
        },
        NAVIGATE_HOME: {
          target: "projectHome",
        },
      },
    },
    structureView: {
      on: {
        VIEW_RESULT: {
          target: "resultView",
          actions: "setResultTab",
        },
        SETUP_CALCULATION: {
          target: "calculationSetup",
          actions: "setCalculationSetup",
        },
        NAVIGATE_HOME: {
          target: "projectHome",
        },
      },
    },
    calculationSetup: {
      on: {
        START_CALCULATION: {
          target: "calculationRunning",
          actions: "setCalculationRunning",
        },
        VIEW_STRUCTURE: {
          target: "structureView",
        },
        NAVIGATE_HOME: {
          target: "projectHome",
        },
      },
    },
    calculationRunning: {
      on: {
        CALCULATION_SUCCEEDED: {
          target: "resultView",
          actions: "setCalculationSuccess",
        },
        CALCULATION_FAILED: {
          target: "error",
          actions: "setCalculationFailed",
        },
      },
    },
    resultView: {
      on: {
        CHANGE_RESULT_TAB: {
          actions: "setResultTab",
        },
        VIEW_STRUCTURE: {
          target: "structureView",
        },
        SETUP_CALCULATION: {
          target: "calculationSetup",
          actions: "setCalculationSetup",
        },
        NAVIGATE_HOME: {
          target: "projectHome",
        },
      },
    },
    error: {
      on: {
        SELECT_INPUT: {
          target: "newProject",
          actions: "setInput",
        },
        NAVIGATE_HOME: {
          target: "projectHome",
        },
        RESET: {
          target: "empty",
          actions: assign(() => initialWorkflowContext),
        },
      },
    },
  },
});

export type GuidedWorkflowSnapshot = SnapshotFrom<typeof guidedWorkflowMachine>;
export type GuidedWorkflowActor = ActorRefFrom<typeof guidedWorkflowMachine>;
