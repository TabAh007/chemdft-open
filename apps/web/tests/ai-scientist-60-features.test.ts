import { describe, expect, it, vi } from "vitest";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AIApprovalView } from "@chemdft/schemas";
import { AIScientistComposer } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-composer";
import { ApprovalCard } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-approval-screen";

vi.mock("@/app/_components/workspace-state-provider", () => ({ useOptionalWorkspaceState: () => null }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));

describe("Release 0.0.60 frontend components", () => {
  const defaultRun = {
    approvalWaiting: false,
    composerPaused: false,
    isRunActive: false,
    isRunPaused: false,
    waitingForCalculation: false,
    onPause: () => {},
    onResume: () => {},
    onStop: () => {},
  };

  const defaultPlanning = {
    planNeedsVersion: false,
    planAwaitingChoice: false,
    energyPlanningReady: true,
    candidateSelection: false,
    savedVersions: [],
    planningVersionLabel: "Cr2O3 v1",
    planningVersionChosenByServer: false,
    effectiveView: "Crystal Structure",
    blockedReason: null,
    generalPlan: false,
    onGeneralPlanChange: () => {},
    onUseVersion: () => {},
  };

  const defaultLimits = {
    limitRun: false,
    onLimitRunChange: () => {},
    values: { calls: "2", input: "60000", output: "4096" },
    onValuesChange: () => {},
    valid: true,
  };

  describe("Composer actions (Part B1)", () => {
    it("renders 'Prepare periodic calculation for approval' on periodic crystal and puts 'Set up in Calculation panel' in More menu", () => {
      const html = renderToStaticMarkup(
        createElement(AIScientistComposer, {
          prompt: "Calculate energy",
          onPromptChange: () => {},
          inputRef: createRef<HTMLTextAreaElement>(),
          onSubmit: () => {},
          onPreparePeriodicCalculation: () => {},
          onOpenCalculationPanel: () => {},
          canPreparePeriodicCalculation: true,
          canPrepareCalculation: false,
          isCrystalOrPeriodic: true,
          canProposeStructureEdit: true,
          aiAvailable: true,
          submitting: false,
          run: defaultRun,
          planning: defaultPlanning,
          limits: defaultLimits,
          error: null,
          onRefreshStatus: () => {},
        })
      );

      // Periodic button is visible on toolbar
      expect(html).toContain('data-testid="ai-prepare-periodic-calculation-button"');
      expect(html).toContain("Prepare periodic calculation for approval");

      // Molecular button is NOT present
      expect(html).not.toContain('data-testid="ai-prepare-calculation-button"');

      // More menu contains 'Propose structure edit' and 'Set up in Calculation panel'
      expect(html).toContain('data-testid="ai-propose-structure-edit-button"');
      expect(html).toContain('data-testid="ai-open-calculation-panel-button"');
    });

    it("renders 'Prepare calculation for approval' on molecular version", () => {
      const html = renderToStaticMarkup(
        createElement(AIScientistComposer, {
          prompt: "Calculate energy",
          onPromptChange: () => {},
          inputRef: createRef<HTMLTextAreaElement>(),
          onSubmit: () => {},
          onPrepareCalculation: () => {},
          canPreparePeriodicCalculation: false,
          canPrepareCalculation: true,
          isCrystalOrPeriodic: false,
          canProposeStructureEdit: true,
          aiAvailable: true,
          submitting: false,
          run: defaultRun,
          planning: { ...defaultPlanning, effectiveView: "Molecule Overview" },
          limits: defaultLimits,
          error: null,
          onRefreshStatus: () => {},
        })
      );

      // Molecular button is visible
      expect(html).toContain('data-testid="ai-prepare-calculation-button"');
      expect(html).toContain("Prepare calculation for approval");

      // Periodic button is NOT present
      expect(html).not.toContain('data-testid="ai-prepare-periodic-calculation-button"');

      // More menu has structure edit
      expect(html).toContain('data-testid="ai-propose-structure-edit-button"');
    });

    it("renders fallback 'Set up in Calculation panel' on toolbar when periodic is unsaved or read-only", () => {
      const html = renderToStaticMarkup(
        createElement(AIScientistComposer, {
          prompt: "",
          onPromptChange: () => {},
          inputRef: createRef<HTMLTextAreaElement>(),
          onSubmit: () => {},
          onOpenCalculationPanel: () => {},
          canPreparePeriodicCalculation: false,
          canPrepareCalculation: false,
          isCrystalOrPeriodic: true,
          canProposeStructureEdit: false,
          aiAvailable: true,
          submitting: false,
          run: defaultRun,
          planning: defaultPlanning,
          limits: defaultLimits,
          error: null,
          onRefreshStatus: () => {},
        })
      );

      // Toolbar fallback button is visible
      expect(html).toContain('data-testid="ai-open-calculation-panel-button"');
      expect(html).toContain("Set up in Calculation panel");

      // Proposal buttons are NOT present
      expect(html).not.toContain('data-testid="ai-prepare-periodic-calculation-button"');
      expect(html).not.toContain('data-testid="ai-prepare-calculation-button"');
    });
  });

  describe("Structure edit proposal approval card (Part B2)", () => {
    it("renders formula/atom diff, distance check, immutability notice, and edit approval text", () => {
      const editApproval: AIApprovalView = {
        id: "app-edit-1",
        run_id: "run-1",
        project_id: "proj-1",
        tool_name: "structure.edit.propose",
        tool_version: "1.0.0",
        action_fingerprint: "fp-edit",
        scientific_summary: "Propose structure edit: add atom O, remove atom H",
        reason: "User requested structure modification",
        status: "PENDING",
        expires_at: "2099-01-01T00:00:00Z",
        created_at: "2026-11-15T00:00:00Z",
        normalized_arguments: {
          structure_version_id: "ver-parent-1",
          operations: [
            { op_type: "add_atom", element: "O", coordinates: [0.0, 1.2, 0.0] },
            { op_type: "remove_atom", index: 1 },
          ],
          diff: {
            parent_version_id: "ver-parent-1",
            formula_before: "H2O",
            formula_after: "O2",
            atom_count_before: 3,
            atom_count_after: 2,
            atoms_added: [{ index: 2, element: "O", coordinates: [0.0, 1.2, 0.0] }],
            atoms_removed: [{ index: 1, element: "H", coordinates: [0.0, 0.0, 1.0] }],
            atoms_moved: [],
            elements_replaced: [],
            min_distance_before: 0.96,
            min_distance_after: 1.2,
            distance_warnings: [],
          },
        },
      } as unknown as AIApprovalView;

      const html = renderToStaticMarkup(
        createElement(ApprovalCard, {
          approval: editApproval,
          submitting: false,
          onApprove: () => {},
          onReject: () => {},
        })
      );

      // Title
      expect(html).toContain("Proposed structure edit");

      // Immutability notice
      expect(html).toContain('data-testid="ai-structure-edit-immutability-notice"');
      expect(html).toContain("Committed versions are immutable; approving creates a new AI-proposed version (unverified). Parent version is unchanged.");

      // Formula and atom count diff
      expect(html).toContain("H2O");
      expect(html).toContain("O2");
      expect(html).toContain("ver-parent-1");

      // Distance check passed
      expect(html).toContain('data-testid="ai-structure-edit-distance-ok"');
      expect(html).toContain("1.200 Å");

      // Diffs
      expect(html).toContain('data-testid="ai-structure-edit-added-atom"');
      expect(html).toContain("Add <strong>O</strong> at [0.000, 1.200, 0.000]");
      expect(html).toContain('data-testid="ai-structure-edit-removed-atom"');
      expect(html).toContain("Remove atom #1 (H)");

      // Button
      expect(html).toContain('data-testid="ai-approve-button"');
      expect(html).toContain("Approve and create new structure version");
    });

    it("renders distance warning when minimum distance < 0.8 Å", () => {
      const editApprovalWarning: AIApprovalView = {
        id: "app-edit-2",
        run_id: "run-2",
        project_id: "proj-1",
        tool_name: "structure.edit.propose",
        tool_version: "1.0.0",
        action_fingerprint: "fp-edit-warn",
        scientific_summary: "Add atom close to another",
        status: "PENDING",
        expires_at: "2099-01-01T00:00:00Z",
        created_at: "2026-11-15T00:00:00Z",
        normalized_arguments: {
          structure_version_id: "ver-parent-1",
          diff: {
            parent_version_id: "ver-parent-1",
            formula_before: "H2",
            formula_after: "H3",
            atom_count_before: 2,
            atom_count_after: 3,
            atoms_added: [{ index: 2, element: "H", coordinates: [0.0, 0.0, 0.3] }],
            atoms_removed: [],
            atoms_moved: [],
            elements_replaced: [],
            min_distance_after: 0.3,
            distance_warnings: ["Minimum interatomic distance 0.300 Å is under 0.800 Å (unphysical overlap)"],
          },
        },
      } as unknown as AIApprovalView;

      const html = renderToStaticMarkup(
        createElement(ApprovalCard, {
          approval: editApprovalWarning,
          submitting: false,
          onApprove: () => {},
          onReject: () => {},
        })
      );

      expect(html).toContain('data-testid="ai-structure-edit-distance-warning"');
      expect(html).toContain("under 0.800 Å (unphysical overlap)");
    });
  });

  describe("Periodic calculation proposal approval card (Part B2)", () => {
    it("renders periodic settings source and parameters", () => {
      const periodicApproval: AIApprovalView = {
        id: "app-periodic-1",
        run_id: "run-3",
        project_id: "proj-1",
        tool_name: "calculation.submit",
        tool_version: "1.0.0",
        action_fingerprint: "fp-periodic",
        scientific_summary: "Periodic calculation proposal for crystal structure. (settings source: copied from calculation calc-qe-cr2o3)",
        status: "PENDING",
        expires_at: "2099-01-01T00:00:00Z",
        created_at: "2026-11-15T00:00:00Z",
        normalized_arguments: {
          structure_version: { entity_id: "ver-cr2o3", project_id: "proj-1" },
          specification: {
            charge: 0,
            multiplicity: 1,
            task_type: "PERIODIC_ENERGY",
            engine_preference: { engine: "qe" },
            method: { identifier: "pbe" },
            basis: { identifier: "sssp_efficiency" },
            periodic: {
              k_mesh: [4, 4, 4],
              ecutwfc_ry: 50.0,
              ecutrho_ry: 400.0,
              pseudopotential_family: "sssp_efficiency",
              spin_polarized: true,
              magnetic_ordering: "AFM",
              hubbard_u: { Cr: 3.5 },
            },
          },
        },
      } as unknown as AIApprovalView;

      const html = renderToStaticMarkup(
        createElement(ApprovalCard, {
          approval: periodicApproval,
          submitting: false,
          onApprove: () => {},
          onReject: () => {},
        })
      );

      // Periodic settings source badge
      expect(html).toContain('data-testid="ai-periodic-settings-source"');
      expect(html).toContain("copied from calculation calc-qe-cr2o3");

      // Parameters
      expect(html).toContain("4 × 4 × 4");
      expect(html).toContain("50 Ry (wfc) / 400 Ry (rho)");
      expect(html).toContain("AFM (spin-polarized)");
      expect(html).toContain("Cr: 3.5 eV");
      expect(html).toContain("sssp_efficiency");
    });
  });
});
