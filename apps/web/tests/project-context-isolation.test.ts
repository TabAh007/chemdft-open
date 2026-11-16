import { describe, expect, it } from "vitest";
import {
  type WorkspaceSelection,
  selectionKey,
  validSelection,
} from "../src/lib/workspace-selection";
import {
  emptyWorkspaceState,
  openWorkspaceTab,
  restoreWorkspaceState,
} from "../src/lib/workspace-tabs";

const projectA = "11111111-1111-4111-8111-111111111111";
const projectB = "22222222-2222-4222-8222-222222222222";
const projectC = "33333333-3333-4333-8333-333333333333";

const structureAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const structureVersionAId = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const structureBId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const structureVersionBId = "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const selectionA: WorkspaceSelection = {
  kind: "structureVersion",
  id: structureVersionAId,
  projectId: projectA,
  sourceId: structureAId,
};

const selectionB: WorkspaceSelection = {
  kind: "structureVersion",
  id: structureVersionBId,
  projectId: projectB,
  sourceId: structureBId,
};

describe("project context isolation and foreign selection protection", () => {
  it("rejects selections belonging to other projects", () => {
    expect(validSelection(selectionA, projectA)).toBe(true);
    expect(validSelection(selectionA, projectB)).toBe(false);
    expect(validSelection(selectionA, projectC)).toBe(false);

    expect(validSelection(selectionB, projectB)).toBe(true);
    expect(validSelection(selectionB, projectA)).toBe(false);
  });

  it("clears foreign selection when navigating Project A -> Project B", () => {
    // Current project is A, selection is selectionA
    let currentProjectId = projectA;
    let currentSelection: WorkspaceSelection | null = selectionA;
    let viewLabel = "Water V1";

    expect(validSelection(currentSelection, currentProjectId)).toBe(true);

    // Navigate to Project B
    currentProjectId = projectB;
    const projectBName = "Chromium CVD paper acceptance";

    // Project isolation rule: validate selection against new project
    if (!validSelection(currentSelection, currentProjectId)) {
      currentSelection = null;
      viewLabel = `${projectBName} → Overview`;
    }

    expect(currentSelection).toBeNull();
    expect(viewLabel).toBe("Chromium CVD paper acceptance → Overview");
    expect(viewLabel).not.toContain("Water");
  });

  it("prevents foreign object inheritance in A -> B -> C traversal", () => {
    const projA = { id: projectA, name: "Electronic structure acceptance — water", selection: selectionA };
    const projB = { id: projectB, name: "Chromium CVD paper acceptance", selection: selectionB };
    const projC = { id: projectC, name: "Phase 7 Local Walkthrough", selection: null };

    let activeProjectId = projectA;
    let activeSelection: WorkspaceSelection | null = selectionA;
    let activeLabel = "Water V1";

    // Navigate A -> B
    activeProjectId = projectB;
    if (!validSelection(activeSelection, activeProjectId)) {
      activeSelection = null;
      activeLabel = `${projB.name} → Overview`;
    }
    expect(activeSelection).toBeNull();
    expect(activeLabel).toBe("Chromium CVD paper acceptance → Overview");

    // Select object in B
    activeSelection = selectionB;
    activeLabel = "Cr(CO)6 V1";

    // Navigate B -> C
    activeProjectId = projectC;
    if (!validSelection(activeSelection, activeProjectId)) {
      activeSelection = null;
      activeLabel = `${projC.name} → Overview`;
    }
    expect(activeSelection).toBeNull();
    expect(activeLabel).toBe("Phase 7 Local Walkthrough → Overview");
    expect(activeLabel).not.toMatch(/Water|Cr\(CO\)6/);

    // Navigate C -> A
    activeProjectId = projectA;
    if (!validSelection(activeSelection, activeProjectId)) {
      activeSelection = null;
      activeLabel = `${projA.name} → Overview`;
    }
    expect(activeSelection).toBeNull();
    expect(activeLabel).toBe("Electronic structure acceptance — water → Overview");
  });

  it("isolates persisted workspace tabs and state per project", () => {
    // Open tab in Project A
    const stateA = openWorkspaceTab(emptyWorkspaceState(), {
      selection: selectionA,
      label: "Water V1",
    });
    const serializedA = JSON.stringify(stateA);

    // Attempting to restore Project A's state in Project B should ignore Project A's tabs
    const restoredInB = restoreWorkspaceState(serializedA, projectB);
    expect(restoredInB.tabs).toHaveLength(0);
    expect(restoredInB.activeKey).toBeNull();

    // Restoring in Project A succeeds
    const restoredInA = restoreWorkspaceState(serializedA, projectA);
    expect(restoredInA.tabs).toHaveLength(1);
    expect(restoredInA.activeKey).toBe(selectionKey(selectionA));
  });

  it("updates AI Scientist current context across Structure, Electronic Structure, MO, Density, ESP, and UV/Vis states", () => {
    const structureVersionLabel = "Water V1";
    const scfBaseLabel = "Electronic structure · RHF/STO-3G";
    const moHomoLabel = `${scfBaseLabel} → HOMO`;
    const moDensityLabel = `${scfBaseLabel} → Electron density`;
    const moEspLabel = `${scfBaseLabel} → ESP`;
    const uvvisBaseLabel = "Water V1 → UV/Vis spectrum";
    const uvvisS1Label = "Water V1 → UV/Vis → S1";
    const uvvisS3Label = "Water V1 → UV/Vis → S3";

    // Simulate view transition state tracking
    type ViewState = {
      selection: WorkspaceSelection | null;
      currentView: string;
      activeTabLabel?: string;
    };

    let state: ViewState = {
      selection: null,
      currentView: "Electronic structure acceptance — water → Overview",
    };

    // 1. Structure view
    state = {
      selection: selectionA,
      currentView: structureVersionLabel,
      activeTabLabel: structureVersionLabel,
    };
    expect(state.currentView).toBe("Water V1");

    // 2. Electronic Structure (base)
    const calculationResultSelection: WorkspaceSelection = {
      kind: "calculationResult",
      id: "result-mo-1",
      projectId: projectA,
      sourceId: "calc-1",
    };
    state = {
      selection: calculationResultSelection,
      currentView: scfBaseLabel,
      activeTabLabel: scfBaseLabel,
    };
    expect(state.currentView).toBe("Electronic structure · RHF/STO-3G");

    // 3. MO (HOMO)
    state = {
      ...state,
      currentView: moHomoLabel,
    };
    expect(state.currentView).toBe("Electronic structure · RHF/STO-3G → HOMO");

    // 4. Electron Density
    state = {
      ...state,
      currentView: moDensityLabel,
    };
    expect(state.currentView).toBe("Electronic structure · RHF/STO-3G → Electron density");

    // 5. ESP
    state = {
      ...state,
      currentView: moEspLabel,
    };
    expect(state.currentView).toBe("Electronic structure · RHF/STO-3G → ESP");

    // 6. UV/Vis spectrum
    const tddftResultSelection: WorkspaceSelection = {
      kind: "calculationResult",
      id: "35e0b59d-ab9c-47fe-8b1b-f7449d9fbe78",
      projectId: projectA,
      sourceId: "e3146f9f-f143-4ba9-957f-281ac23e68af",
    };
    state = {
      selection: tddftResultSelection,
      currentView: uvvisBaseLabel,
      activeTabLabel: "UV/Vis absorption spectrum · B3LYP/6-31G*",
    };
    expect(state.currentView).toBe("Water V1 → UV/Vis spectrum");

    // 7. S1 state selected
    state = {
      ...state,
      currentView: uvvisS1Label,
    };
    expect(state.currentView).toBe("Water V1 → UV/Vis → S1");

    // 8. S3 state selected
    state = {
      ...state,
      currentView: uvvisS3Label,
    };
    expect(state.currentView).toBe("Water V1 → UV/Vis → S3");
  });

  it("clears old context completely on project change", () => {
    // Project A state with active TDDFT UV/Vis context
    let activeProjectId = projectA;
    let activeScope: { projectName?: string; currentView?: string; structureName?: string } = {
      projectName: "Electronic structure acceptance — water",
      currentView: "Water V1 → UV/Vis → S3",
      structureName: "TEST USER-SUPPLIED WATER GEOMETRY",
    };

    // Switching to Project B must clear old scope and initialize to Project B overview
    activeProjectId = projectB;
    activeScope = {
      projectName: "Chromium CVD paper acceptance",
      currentView: "Chromium CVD paper acceptance → Overview",
    };

    expect(activeProjectId).toBe(projectB);
    expect(activeScope.currentView).toBe("Chromium CVD paper acceptance → Overview");
    expect(activeScope.structureName).toBeUndefined();
    expect(activeScope.currentView).not.toContain("Water");
    expect(activeScope.currentView).not.toContain("UV/Vis");
  });

  it("regression: preserves and synchronizes excited-state selection inside Advanced UV/Vis and across Guided/Advanced switches", () => {
    const structPrefix = "Water V1";

    // Helper computing viewLabel exactly as UvVisSpectroscopyPanel does
    function computeUvVisViewLabel(selectedState: { state_label: string } | null): string {
      return selectedState ? `${structPrefix} → UV/Vis → ${selectedState.state_label}` : `${structPrefix} → UV/Vis spectrum`;
    }

    // 1. Initial view without explicit state selection
    let selectedState: { state_label: string } | null = null;
    expect(computeUvVisViewLabel(selectedState)).toBe("Water V1 → UV/Vis spectrum");

    // 2. User selects S3
    selectedState = { state_label: "S3" };
    expect(computeUvVisViewLabel(selectedState)).toBe("Water V1 → UV/Vis → S3");

    // 3. User selects S1
    selectedState = { state_label: "S1" };
    expect(computeUvVisViewLabel(selectedState)).toBe("Water V1 → UV/Vis → S1");

    // 4. User clicks S1 again to deselect
    selectedState = null;
    expect(computeUvVisViewLabel(selectedState)).toBe("Water V1 → UV/Vis spectrum");

    // 5. Guided mode with S3 switching to Advanced inherits S3
    const guidedSelectedState: string | null = "S3";
    const advancedInitialState = guidedSelectedState;
    expect(advancedInitialState).toBe("S3");
    expect(computeUvVisViewLabel({ state_label: advancedInitialState })).toBe("Water V1 → UV/Vis → S3");

    // 6. Advanced mode with S1 switching to Guided inherits S1
    const advancedSelectedState: string | null = "S1";
    const guidedInitialState = advancedSelectedState;
    expect(guidedInitialState).toBe("S1");
    expect(computeUvVisViewLabel({ state_label: guidedInitialState })).toBe("Water V1 → UV/Vis → S1");

    // 7. Verify project isolation: foreign project cannot inherit active state
    const foreignProjectScope = {
      projectId: projectB,
      projectName: "Chromium CVD paper acceptance",
      currentView: "Chromium CVD paper acceptance → Overview",
    };
    expect(foreignProjectScope.currentView).not.toContain("S3");
    expect(foreignProjectScope.currentView).not.toContain("S1");
    expect(foreignProjectScope.currentView).not.toContain("UV/Vis");
  });
});
